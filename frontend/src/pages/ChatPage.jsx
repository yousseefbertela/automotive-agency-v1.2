import { useState, useCallback, useEffect } from 'react';
import ChatHeader from '../components/ChatHeader';
import MessageList from '../components/MessageList';
import ChatInput from '../components/ChatInput';
import UploadButton from '../components/UploadButton';
import SettingsPanel from '../components/SettingsPanel';
import StatusBar from '../components/StatusBar';
import ErrorToast from '../components/ErrorToast';
import BrandLogos from '../components/BrandLogos';
import { sendMessage, sendPhoto, healthCheck } from '../lib/api';
import { getSessionId, setSessionId } from '../lib/session';
import { getTheme, setTheme } from '../lib/theme';

function nextId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function ChatPage() {
  const [sessionId, setSessionIdState] = useState(() => getSessionId());
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [theme, setThemeState] = useState(() => getTheme());

  const handleThemeToggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    setTheme(next);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    healthCheck().then(({ ok }) => setConnected(ok));
    const t = setInterval(() => healthCheck().then(({ ok }) => setConnected(ok)), 30000);
    return () => clearInterval(t);
  }, []);

  const updateSession = useCallback((id) => {
    setSessionIdState(id);
    if (id) setSessionId(id);
  }, []);

  const handleSendMessage = useCallback(async (text) => {
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: text, timestamp: new Date() },
    ]);
    setLoading(true);
    try {
      const res = await sendMessage(sessionId, text);
      updateSession(res.session_id);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: res.reply || '(No response)',
          timestamp: new Date(),
        },
      ]);
    } catch (e) {
      const errMsg = e?.message || 'Something went wrong';
      setError(errMsg);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: `Error: ${errMsg}`, timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, updateSession]);

  const handleUpload = useCallback(async (file) => {
    setError(null);
    const imagePreview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: 'user',
        content: `[Photo: ${file.name}]`,
        timestamp: new Date(),
        ocrPreview: 'Sending for OCR...',
        imagePreview,
      },
    ]);
    setLoading(true);
    try {
      const res = await sendPhoto(sessionId, file);
      updateSession(res.session_id);
      setMessages((prev) => {
        const withoutLast = prev.slice(0, -1);
        const last = prev[prev.length - 1];
        const updatedUser = last
          ? {
              ...last,
              content: res.ocr_text ? `[Photo]\n${res.ocr_text}` : '[Photo]',
              ocrPreview: res.ocr_text ? `OCR: ${res.ocr_text.slice(0, 60)}...` : undefined,
              imagePreview: last.imagePreview ?? null,
            }
          : {
              id: nextId(),
              role: 'user',
              content: res.ocr_text ? `[Photo]\n${res.ocr_text}` : '[Photo]',
              timestamp: new Date(),
              imagePreview: null,
            };
        return [
          ...withoutLast,
          updatedUser,
          {
            id: nextId(),
            role: 'assistant',
            content: res.reply || '(No response)',
            timestamp: new Date(),
          },
        ];
      });
    } catch (e) {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      const errMsg = e?.message || 'Upload failed';
      setError(errMsg);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: `Error: ${errMsg}`, timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, updateSession]);

  return (
    <div className={`luxury-app theme-${theme} h-screen flex flex-col overflow-hidden`} data-theme={theme}>
      <div className="luxury-bg" aria-hidden />
      <div className="luxury-watermark" aria-hidden />
      <ChatHeader theme={theme} onThemeToggle={handleThemeToggle} />
      <BrandLogos />
      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
      <div className="luxury-chat-container flex-1 flex flex-col min-h-0">
        <MessageList messages={messages} loading={loading} />
        <StatusBar connected={connected} sessionId={sessionId} />
        <div className="flex items-center gap-2 px-4 pb-2">
          <UploadButton onUpload={handleUpload} disabled={loading} />
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="luxury-btn-upload flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
            title="Session settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
        <ChatInput onSend={handleSendMessage} disabled={loading} />
      </div>
      {showSettings && (
        <SettingsPanel
          sessionId={sessionId}
          onSessionChange={setSessionIdState}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
