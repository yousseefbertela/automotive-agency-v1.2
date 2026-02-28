/**
 * TraceRunList.jsx — List of TraceRuns, newest first.
 *
 * Props:
 *   runs        {array}    Array of run objects from the debug API
 *   loading     {boolean}  True while fetching runs
 *   onSelectRun {function} Called with run object when user clicks a row
 *   selectedRunId {string} ID of the currently selected run
 */
export default function TraceRunList({ runs = [], loading, onSelectRun, selectedRunId }) {
  const statusBadge = (status) => {
    const styles = {
      RUNNING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      SUCCESS: 'bg-green-500/20  text-green-400  border-green-500/30',
      ERROR:   'bg-red-500/20    text-red-400    border-red-500/30',
    };
    return (
      <span
        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status] || 'bg-slate-700 text-slate-400 border-slate-600'}`}
      >
        {status === 'RUNNING' && (
          <span className="mr-1 h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
        )}
        {status}
      </span>
    );
  };

  const formatDuration = (ms) => {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  if (loading && !runs.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-500">
        <div className="w-5 h-5 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
        <span className="text-xs">Loading runs…</span>
      </div>
    );
  }

  if (!runs.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-slate-500 text-sm">
        <span className="text-2xl mb-2 opacity-40">🔍</span>
        No trace runs yet for this session.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-slate-700/50 overflow-y-auto">
      {runs.map((run) => {
        const isSelected = run.id === selectedRunId;
        return (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelectRun(run)}
            className={`w-full text-left px-4 py-3 transition-colors ${
              isSelected
                ? 'bg-sky-500/10 border-l-2 border-sky-400'
                : 'hover:bg-slate-800/60 border-l-2 border-transparent'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              {statusBadge(run.status)}
              <span className="text-[10px] text-slate-500 tabular-nums">
                {formatTime(run.started_at)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-slate-400 truncate">
                {(run.correlation_id || run.id || '').slice(0, 14)}…
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {formatDuration(run.duration_ms)}
                </span>
                <span className="text-[10px] text-slate-600">
                  {run.event_count ?? 0} steps
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
