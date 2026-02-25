import { formatTime } from '../lib/format';
import InlineForm from './InlineForm';

/**
 * Try to parse the message content as a structured form payload.
 * Returns the parsed object if it has { type: 'form' }, otherwise null.
 */
function tryParseForm(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.type === 'form' && Array.isArray(parsed?.fields)) return parsed;
  } catch {
    // not JSON
  }
  return null;
}

/**
 * SSE push events arrive as assistant messages with sseEvent:true.
 * Render them with a subtle left border to distinguish from regular replies.
 */
function SSEEventBubble({ message }) {
  return (
    <div className="flex justify-start message-bubble-wrap">
      <div className="max-w-[85%] rounded-2xl px-4 py-2.5 luxury-bubble-assistant rounded-bl-md border-l-2 border-amber-500/60">
        <p className="text-sm whitespace-pre-wrap break-words text-inherit">{message.content}</p>
        <p className="text-xs mt-1 text-slate-400">{formatTime(message.timestamp)}</p>
      </div>
    </div>
  );
}

export default function MessageBubble({ message, onFormSubmit, formDisabled }) {
  const isUser = message.role === 'user';

  // SSE push event — different visual style
  if (message.sseEvent) {
    return <SSEEventBubble message={message} />;
  }

  // Try to parse assistant message as a structured form
  const form = !isUser ? tryParseForm(message.content) : null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} message-bubble-wrap`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'luxury-bubble-user rounded-br-md'
            : 'luxury-bubble-assistant rounded-bl-md'
        }`}
      >
        {/* Image preview (photo upload) */}
        {message.imagePreview && (
          <div className="mb-2 overflow-hidden rounded-lg">
            <img
              src={message.imagePreview}
              alt="Upload"
              className="max-h-32 w-auto object-cover"
            />
          </div>
        )}

        {/* OCR preview */}
        {message.ocrPreview && (
          <p className="text-xs text-slate-400 mb-1 italic">{message.ocrPreview}</p>
        )}

        {/* Structured form — render as interactive inputs */}
        {form ? (
          <InlineForm
            form={form}
            onSubmit={(action, data) => onFormSubmit && onFormSubmit(message.id, action, data)}
            disabled={formDisabled}
          />
        ) : (
          /* Regular text message */
          <p className="text-sm whitespace-pre-wrap break-words text-inherit">{message.content}</p>
        )}

        <p className={`text-xs mt-1 ${isUser ? 'text-slate-300' : 'text-slate-400'}`}>
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
