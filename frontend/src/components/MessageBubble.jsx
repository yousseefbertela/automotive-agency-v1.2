import { formatTime } from '../lib/format';

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} message-bubble-wrap`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'luxury-bubble-user rounded-br-md'
            : 'luxury-bubble-assistant rounded-bl-md'
        }`}
      >
        {message.imagePreview && (
          <div className="mb-2 overflow-hidden rounded-lg">
            <img
              src={message.imagePreview}
              alt="Upload"
              className="max-h-32 w-auto object-cover"
            />
          </div>
        )}
        {message.ocrPreview && (
          <p className="text-xs text-slate-400 mb-1 italic">{message.ocrPreview}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words text-inherit">{message.content}</p>
        <p className={`text-xs mt-1 ${isUser ? 'text-slate-300' : 'text-slate-400'}`}>
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
