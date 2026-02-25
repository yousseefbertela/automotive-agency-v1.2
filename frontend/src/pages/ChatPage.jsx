import { useState, useCallback, useEffect, useRef } from 'react';
import ChatHeader from '../components/ChatHeader';
import MessageList from '../components/MessageList';
import ChatInput from '../components/ChatInput';
import UploadButton from '../components/UploadButton';
import SettingsPanel from '../components/SettingsPanel';
import StatusBar from '../components/StatusBar';
import ErrorToast from '../components/ErrorToast';
import BrandLogos from '../components/BrandLogos';
import {
  sendMessage,
  sendPhoto,
  submitForm,
  createSSEConnection,
  healthCheck,
} from '../lib/api';
import { getSessionId, setSessionId } from '../lib/session';
import { getTheme, setTheme } from '../lib/theme';

function nextId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Map SSE event type → human-readable Arabic message */
function sseEventToText(type, data) {
  switch (type) {
    case 'order_confirmed':
      return [
        '✅ تم تأكيد الطلب من قبل العميل!',
        data.customer_name ? `العميل: ${data.customer_name}` : '',
        data.total_cost ? `الإجمالي: ${data.total_cost} EGP` : '',
        data.vin ? `VIN: ${data.vin}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'order_cancelled':
      return [
        '❌ تم إلغاء / تعديل الطلب من قبل العميل.',
        data.customer_name ? `العميل: ${data.customer_name}` : '',
        data.vin ? `VIN: ${data.vin}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'quote_sent':
      return [
        '📤 تم إرسال عرض السعر للعميل على واتساب.',
        data.total_cost ? `الإجمالي: ${data.total_cost} EGP` : '',
        data.labor_cost ? `(شامل عمالة: ${data.labor_cost} EGP)` : '',
      ]
        .filter(Boolean)
        .join('\n');

    default:
      return `📬 ${type}: ${JSON.stringify(data)}`;
  }
}

export default function ChatPage() {
  const [sessionId, setSessionIdState] = useState(() => getSessionId());
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [theme, setThemeState] = useState(() => getTheme());

  const sseRef = useRef(null);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const handleThemeToggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    setTheme(next);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── HTTP health-check ──────────────────────────────────────────────────────
  useEffect(() => {
    healthCheck().then(({ ok }) => setConnected(ok));
    const t = setInterval(() => healthCheck().then(({ ok }) => setConnected(ok)), 30000);
    return () => clearInterval(t);
  }, []);

  // ── SSE connection ─────────────────────────────────────────────────────────
  // Opens a persistent SSE stream after session is established.
  // Receives push events when the customer interacts on WhatsApp.
  useEffect(() => {
    if (!sessionId) return;

    // Close any existing connection before opening a new one
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
      setSseConnected(false);
    }

    const evtSource = createSSEConnection(sessionId);
    if (!evtSource) return;
    sseRef.current = evtSource;

    // Handshake — server sends this immediately on connect
    evtSource.addEventListener('connected', () => {
      setSseConnected(true);
    });

    // Push event: customer confirmed order on WhatsApp
    evtSource.addEventListener('order_confirmed', (e) => {
      try {
        const data = JSON.parse(e.data);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: sseEventToText('order_confirmed', data),
            timestamp: new Date(),
            sseEvent: true,
          },
        ]);
      } catch { /* ignore malformed event */ }
    });

    // Push event: customer cancelled order on WhatsApp
    evtSource.addEventListener('order_cancelled', (e) => {
      try {
        const data = JSON.parse(e.data);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: sseEventToText('order_cancelled', data),
            timestamp: new Date(),
            sseEvent: true,
          },
        ]);
      } catch { /* ignore */ }
    });

    // Push event: WA quote template sent after CHOOSE_PRODUCT
    evtSource.addEventListener('quote_sent', (e) => {
      try {
        const data = JSON.parse(e.data);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: sseEventToText('quote_sent', data),
            timestamp: new Date(),
            sseEvent: true,
          },
        ]);
      } catch { /* ignore */ }
    });

    evtSource.onerror = () => {
      setSseConnected(false);
      // EventSource auto-reconnects — no manual action needed
    };

    return () => {
      evtSource.close();
      sseRef.current = null;
      setSseConnected(false);
    };
  }, [sessionId]);

  // ── Session helpers ────────────────────────────────────────────────────────
  const updateSession = useCallback((id) => {
    setSessionIdState(id);
    if (id) setSessionId(id);
  }, []);

  // ── Send text message ──────────────────────────────────────────────────────
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

  // ── Upload photo ───────────────────────────────────────────────────────────
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

  // ── Form submit (COLLECT_CUSTOMER_DATA / CHOOSE_PRODUCT) ──────────────────
  // Called by InlineForm inside a MessageBubble when the agent fills a form.
  const handleFormSubmit = useCallback(async (_msgId, action, formData) => {
    setError(null);
    setLoading(true);
    try {
      const res = await submitForm(sessionId, action, formData);
      if (res.session_id) updateSession(res.session_id);
      if (res.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: res.reply,
            timestamp: new Date(),
          },
        ]);
      }
    } catch (e) {
      const errMsg = e?.message || 'Form submission failed';
      setError(errMsg);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: `Error: ${errMsg}`,
          timestamp: new Date(),
        },
      ]);
      // Re-throw so InlineForm can show its own local error too
      throw e;
    } finally {
      setLoading(false);
    }
  }, [sessionId, updateSession]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`luxury-app theme-${theme} h-screen flex flex-col overflow-hidden`}
      data-theme={theme}
    >
      <div className="luxury-bg" aria-hidden />
      <div className="luxury-watermark" aria-hidden />

      <ChatHeader theme={theme} onThemeToggle={handleThemeToggle} />
      <BrandLogos />

      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}

      <div className="luxury-chat-container flex-1 flex flex-col min-h-0">
        <MessageList
          messages={messages}
          loading={loading}
          onFormSubmit={handleFormSubmit}
          formDisabled={loading}
        />

        <StatusBar
          connected={connected}
          sseConnected={sseConnected}
          sessionId={sessionId}
        />

        <div className="flex items-center gap-2 px-4 pb-2">
          <UploadButton onUpload={handleUpload} disabled={loading} />
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="luxury-btn-upload flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
            title="Session settings"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
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
