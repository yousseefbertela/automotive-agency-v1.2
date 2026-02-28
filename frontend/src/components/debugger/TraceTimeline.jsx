/**
 * TraceTimeline.jsx — Vertical timeline of TraceEvents ordered by sequence.
 *
 * Props:
 *   events        {array}    TraceEvent objects with: sequence, step_name, domain,
 *                            duration_ms, status, replay_safe, timestamp
 *   onSelectEvent {function} Called with event object when user clicks a row
 *   selectedEventId {string} ID of currently selected event
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

function domainBadge(domain) {
  const cls = DOMAIN_COLORS[domain] || DOMAIN_COLORS.general;
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {domain}
    </span>
  );
}

function statusIcon(status) {
  if (status === 'error') {
    return <span className="text-red-400 text-xs font-bold">✗</span>;
  }
  return <span className="text-green-400 text-xs">✓</span>;
}

function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function TraceTimeline({ events = [], onSelectEvent, selectedEventId }) {
  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-xs">
        No events recorded yet.
      </div>
    );
  }

  // Compute max duration for relative bar widths
  const maxDuration = Math.max(...events.map(e => e.duration_ms || 0), 1);

  return (
    <div className="flex flex-col overflow-y-auto">
      {events.map((event, idx) => {
        const isSelected = event.id === selectedEventId;
        const barWidth = maxDuration > 0
          ? Math.max(2, Math.round((event.duration_ms || 0) / maxDuration * 100))
          : 0;
        const isLast = idx === events.length - 1;

        return (
          <button
            key={event.id || event.sequence}
            type="button"
            onClick={() => onSelectEvent(event)}
            className={`relative w-full text-left px-4 py-2.5 transition-colors ${
              isSelected
                ? 'bg-sky-500/10'
                : 'hover:bg-slate-800/50'
            }`}
          >
            {/* Vertical connector line */}
            {!isLast && (
              <div className="absolute left-[22px] top-8 bottom-0 w-px bg-slate-700/50 pointer-events-none" />
            )}

            <div className="flex items-start gap-3">
              {/* Sequence dot + status */}
              <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center z-10 ${
                    event.status === 'error'
                      ? 'bg-red-900/40 border-red-500/50'
                      : 'bg-slate-800 border-slate-600'
                  }`}
                >
                  {statusIcon(event.status)}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs font-mono text-slate-200 truncate">
                    {event.step_name}
                  </span>
                  {domainBadge(event.domain || 'general')}
                  {event.replay_safe && (
                    <span className="inline-flex items-center rounded border border-slate-600/30 bg-slate-700/20 px-1.5 py-0.5 text-[9px] text-slate-500 uppercase tracking-wide">
                      replayable
                    </span>
                  )}
                </div>

                {/* Duration bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        event.status === 'error' ? 'bg-red-500/60' : 'bg-sky-500/50'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums w-12 text-right flex-shrink-0">
                    {formatDuration(event.duration_ms)}
                  </span>
                </div>
              </div>

              {/* Sequence badge */}
              <span className="flex-shrink-0 text-[10px] text-slate-600 tabular-nums pt-0.5">
                #{event.sequence}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
