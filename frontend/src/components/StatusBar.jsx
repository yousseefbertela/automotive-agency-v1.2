import { shortSessionId } from '../lib/format';

export default function StatusBar({ connected, sessionId }) {
  return (
    <div className="status-bar flex items-center justify-between gap-4 px-4 py-2 text-xs text-slate-400">
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-500'}`}
          aria-hidden
        />
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <span className="font-mono text-slate-500">
        Session: {shortSessionId(sessionId)}
      </span>
    </div>
  );
}
