import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';

export default function MessageList({ messages, loading, onFormSubmit, formDisabled }) {
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth">
      {messages.length === 0 && !loading && (
        <div className="luxury-empty flex flex-col items-center justify-center min-h-[280px] text-center px-4">
          <div className="bmw-logo-center mb-6" aria-hidden>
            <img
              src="/bmw-hero.png"
              alt=""
              className="w-40 h-40 md:w-52 md:h-52 object-contain mx-auto drop-shadow-2xl"
            />
          </div>
          <p className="text-slate-500 text-sm font-medium theme-light:text-slate-600">
            Start by typing…
          </p>
          <p className="text-slate-600 text-xs mt-1 theme-light:text-slate-500">
            or upload a photo for OCR
          </p>
        </div>
      )}

      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          onFormSubmit={onFormSubmit}
          formDisabled={formDisabled}
        />
      ))}

      {loading && (
        <div className="flex justify-start">
          <div className="luxury-bubble-assistant rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400/90 animate-pulse" />
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400/90 animate-pulse [animation-delay:0.15s]" />
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400/90 animate-pulse [animation-delay:0.3s]" />
          </div>
        </div>
      )}

      {/* Invisible anchor for auto-scroll */}
      <div ref={bottomRef} />
    </div>
  );
}
