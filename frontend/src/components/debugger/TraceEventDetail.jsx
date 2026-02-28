/**
 * TraceEventDetail.jsx — Slide-in drawer showing full detail of a TraceEvent.
 *
 * Props:
 *   event   {object}   TraceEvent with input_json, output_json, error_json, etc.
 *   onClose {function} Called when user closes the drawer
 */

const DOMAIN_COLORS = {
  ai:       'bg-purple-500/20  text-purple-300  border-purple-500/30',
  odoo:     'bg-orange-500/20  text-orange-300  border-orange-500/30',
  sheets:   'bg-green-500/20   text-green-300   border-green-500/30',
  vin:      'bg-blue-500/20    text-blue-300    border-blue-500/30',
  whatsapp: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  state:    'bg-slate-500/20   text-slate-300   border-slate-500/30',
  routing:  'bg-cyan-500/20    text-cyan-300    border-cyan-500/30',
  scraper:  'bg-yellow-500/20  text-yellow-300  border-yellow-500/30',
  finalize: 'bg-rose-500/20    text-rose-300    border-rose-500/30',
  general:  'bg-slate-600/20   text-slate-400   border-slate-600/30',
};

function JsonBlock({ label, data, isError }) {
  if (data == null) return null;
  const formatted = (() => {
    try {
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  })();

  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${isError ? 'text-red-400' : 'text-slate-400'}`}>
        {label}
      </p>
      <pre
        className={`text-xs overflow-auto rounded-lg p-3 font-mono leading-relaxed whitespace-pre-wrap break-words max-h-64 ${
          isError
            ? 'bg-red-950/40 text-red-300 border border-red-500/20'
            : 'bg-slate-900 text-slate-300 border border-slate-700/50'
        }`}
      >
        {formatted}
      </pre>
    </div>
  );
}

export default function TraceEventDetail({ event, onClose }) {
  if (!event) return null;

  const domain = event.domain || 'general';
  const domainCls = DOMAIN_COLORS[domain] || DOMAIN_COLORS.general;

  const formatDuration = (ms) => {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(3)}s`;
  };

  const formatTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
      });
    } catch {
      return iso;
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[420px] max-w-[95vw] flex flex-col
                   bg-slate-900/95 border-l border-slate-700/60 shadow-2xl overflow-hidden"
        style={{ animation: 'slideInRight 0.18s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-700/60 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">
              Step #{event.sequence}
            </p>
            <h2 className="text-sm font-mono font-semibold text-slate-100 truncate">
              {event.step_name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-slate-400
                       hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Meta row */}
        <div className="flex items-center flex-wrap gap-2 px-5 py-3 border-b border-slate-700/40 flex-shrink-0 bg-slate-800/30">
          <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${domainCls}`}>
            {domain}
          </span>
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              event.status === 'error'
                ? 'bg-red-500/20 text-red-400 border-red-500/30'
                : 'bg-green-500/20 text-green-400 border-green-500/30'
            }`}
          >
            {event.status === 'error' ? '✗ error' : '✓ success'}
          </span>
          {event.replay_safe && (
            <span className="inline-flex items-center rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-400 uppercase tracking-wide">
              replayable
            </span>
          )}
          <span className="ml-auto text-[10px] text-slate-500 tabular-nums">
            {formatDuration(event.duration_ms)}
          </span>
        </div>

        {/* Timestamp */}
        <div className="px-5 py-2 border-b border-slate-700/30 flex-shrink-0">
          <span className="text-[10px] text-slate-500">
            {formatTime(event.timestamp)}
          </span>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          <JsonBlock label="Input" data={event.input_json} />
          <JsonBlock label="Output" data={event.output_json} />
          {event.error_json && <JsonBlock label="Error" data={event.error_json} isError />}
          {!event.input_json && !event.output_json && !event.error_json && (
            <p className="text-xs text-slate-600 italic">No payload captured for this step.</p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}
