/**
 * DebugPanel.jsx — Split panel: TraceRunList (left) | TraceTimeline (right).
 *
 * Props:
 *   sessionId  {string}  Current session ID to filter runs
 *   sseRef     {ref}     Ref to the existing EventSource — listens for 'trace_event'
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchTraceRuns, fetchTraceRun } from '../../lib/debugApi';
import TraceRunList from './TraceRunList';
import TraceTimeline from './TraceTimeline';
import TraceEventDetail from './TraceEventDetail';

export default function DebugPanel({ sessionId, sseRef }) {
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const mounted = useRef(true);

  // ── Load runs on mount (and whenever sessionId changes) ────────────────────
  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    setFetchError(null);
    try {
      const data = await fetchTraceRuns({ session_id: sessionId, limit: 30 });
      if (mounted.current) {
        setRuns(data.runs || []);
      }
    } catch (err) {
      if (mounted.current) setFetchError(err.message);
    } finally {
      if (mounted.current) setLoadingRuns(false);
    }
  }, [sessionId]);

  useEffect(() => {
    mounted.current = true;
    loadRuns();
    return () => { mounted.current = false; };
  }, [loadRuns]);

  // ── SSE: listen for trace_event on the existing EventSource ───────────────
  useEffect(() => {
    const evtSource = sseRef?.current;
    if (!evtSource) return;

    const handler = (e) => {
      try {
        const payload = JSON.parse(e.data);
        // Prepend new run or append event to matching run
        setRuns(prev => {
          const existing = prev.find(r => r.id === payload.trace_run_id);
          if (existing) {
            // Update event_count on the matching run
            return prev.map(r =>
              r.id === payload.trace_run_id
                ? { ...r, event_count: (r.event_count || 0) + 1, status: 'RUNNING' }
                : r
            );
          }
          // New run we haven't fetched yet — reload the list
          loadRuns();
          return prev;
        });

        // If this event belongs to the currently selected run, append it to events
        setSelectedRun(prev => {
          if (prev && prev.id === payload.trace_run_id) {
            setEvents(evts => {
              const alreadyExists = evts.some(ev => ev.sequence === payload.sequence);
              if (alreadyExists) return evts;
              return [...evts, {
                id:          `sse-${payload.trace_run_id}-${payload.sequence}`,
                trace_run_id: payload.trace_run_id,
                sequence:    payload.sequence,
                step_name:   payload.step_name,
                domain:      payload.domain,
                duration_ms: payload.duration_ms,
                status:      payload.status,
                replay_safe: payload.replay_safe,
                timestamp:   new Date().toISOString(),
                input_json:  null, // SSE is lightweight — full data fetched on demand
                output_json: null,
                error_json:  null,
              }];
            });
          }
          return prev;
        });
      } catch { /* ignore malformed SSE data */ }
    };

    evtSource.addEventListener('trace_event', handler);
    return () => evtSource.removeEventListener('trace_event', handler);
  }, [sseRef, loadRuns]);

  // ── Load full run + events when a run is selected ─────────────────────────
  const handleSelectRun = useCallback(async (run) => {
    setSelectedRun(run);
    setSelectedEvent(null);
    setEvents([]);
    setLoadingEvents(true);
    try {
      const data = await fetchTraceRun(run.id);
      if (mounted.current) {
        setSelectedRun(data.run || run);
        setEvents(data.events || []);
        // Also update status in the runs list
        setRuns(prev => prev.map(r => r.id === run.id ? { ...r, ...(data.run || {}) } : r));
      }
    } catch (err) {
      if (mounted.current) setFetchError(err.message);
    } finally {
      if (mounted.current) setLoadingEvents(false);
    }
  }, []);

  // ── Select event → when it's from SSE (no full payload), reload the run ──
  const handleSelectEvent = useCallback(async (event) => {
    // If the event came via SSE it may lack input/output — fetch fresh
    if (event.id?.startsWith('sse-') && selectedRun) {
      try {
        const data = await fetchTraceRun(selectedRun.id);
        const fullEvent = (data.events || []).find(e => e.sequence === event.sequence);
        setSelectedEvent(fullEvent || event);
        setEvents(data.events || []);
      } catch {
        setSelectedEvent(event);
      }
    } else {
      setSelectedEvent(event);
    }
  }, [selectedRun]);

  const formatDuration = (ms) => {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-300">

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="text-xs font-semibold text-slate-200 tracking-wide">Examine Backend</span>
        </div>
        <div className="flex items-center gap-2">
          {fetchError && (
            <span className="text-[10px] text-red-400 truncate max-w-[180px]" title={fetchError}>
              {fetchError}
            </span>
          )}
          <button
            type="button"
            onClick={loadRuns}
            disabled={loadingRuns}
            className="text-[10px] text-slate-400 hover:text-sky-400 transition-colors px-2 py-1 rounded hover:bg-slate-800/60 disabled:opacity-40"
            title="Refresh trace runs"
          >
            {loadingRuns ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Main split */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: run list */}
        <div className="w-52 flex-shrink-0 border-r border-slate-700/50 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/30 bg-slate-800/20 flex-shrink-0">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">Runs ({runs.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <TraceRunList
              runs={runs}
              loading={loadingRuns}
              onSelectRun={handleSelectRun}
              selectedRunId={selectedRun?.id}
            />
          </div>
        </div>

        {/* Right: timeline */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedRun ? (
            <>
              {/* Run summary bar */}
              <div className="px-4 py-2 border-b border-slate-700/30 bg-slate-800/20 flex-shrink-0 flex items-center gap-3">
                <span
                  className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
                    selectedRun.status === 'SUCCESS' ? 'text-green-400 border-green-500/30 bg-green-500/10' :
                    selectedRun.status === 'ERROR'   ? 'text-red-400 border-red-500/30 bg-red-500/10' :
                    'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
                  }`}
                >
                  {selectedRun.status}
                </span>
                <span className="text-[10px] text-slate-500 font-mono truncate flex-1">
                  {(selectedRun.correlation_id || selectedRun.id || '').slice(0, 20)}…
                </span>
                <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">
                  {formatDuration(selectedRun.duration_ms)} · {events.length} steps
                </span>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingEvents ? (
                  <div className="flex items-center justify-center h-20 gap-2 text-slate-500">
                    <div className="w-4 h-4 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
                    <span className="text-xs">Loading events…</span>
                  </div>
                ) : (
                  <TraceTimeline
                    events={events}
                    onSelectEvent={handleSelectEvent}
                    selectedEventId={selectedEvent?.id}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-slate-600 text-xs gap-2">
              <span className="text-3xl opacity-20">⌛</span>
              Select a run to see its timeline
            </div>
          )}
        </div>
      </div>

      {/* Event detail drawer */}
      {selectedEvent && (
        <TraceEventDetail
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
