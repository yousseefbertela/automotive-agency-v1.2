import { shortSessionId } from '../lib/format';

export default function StatusBar({ connected, sseConnected, sessionId }) {
  return (
    <div className="status-bar flex items-center justify-between gap-4 px-4 py-2 text-xs text-slate-400">
      {/* HTTP connection status */}
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-500'}`}
          aria-hidden
        />
        {connected ? 'Connected' : 'Disconnected'}
      </span>

      {/* SSE live push status */}
      <span className="flex items-center gap-1.5" title="Real-time push notifications">
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${
            sseConnected ? 'bg-amber-400 shadow-[0_0_4px_1px_rgba(251,191,36,0.6)]' : 'bg-slate-600'
          }`}
          aria-hidden
        />
        <span className={sseConnected ? 'text-amber-400/80' : 'text-slate-600'}>
          {sseConnected ? 'Live' : 'Offline'}
        </span>
      </span>

      {/* Session ID */}
      <span className="font-mono text-slate-500">
        Session: {shortSessionId(sessionId)}
      </span>
    </div>
  );
}
