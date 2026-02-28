/**
 * debugApi.js — Client for the internal debug trace endpoints.
 *
 * Endpoints:
 *   GET /api/debug/trace/runs   — list TraceRuns (filterable by session_id)
 *   GET /api/debug/trace/run/:id — full run + events
 *
 * Auth: x-debug-api-key header (from VITE_DEBUG_API_KEY env var).
 * Dev mode: if VITE_DEBUG_API_KEY is not set, header is omitted (server
 *           allows all requests when DEBUG_API_KEY is also not set).
 */

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const KEY  = import.meta.env.VITE_DEBUG_API_KEY || '';

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (KEY) h['x-debug-api-key'] = KEY;
  return h;
}

async function request(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Debug API ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * List TraceRuns, newest first.
 * @param {{ session_id?: string, chat_id?: string, limit?: number, offset?: number }} opts
 */
export async function fetchTraceRuns({ session_id, chat_id, limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (session_id) params.set('session_id', session_id);
  if (chat_id)    params.set('chat_id', chat_id);
  params.set('limit', String(Math.min(limit, 100)));
  params.set('offset', String(offset));
  return request(`/api/debug/trace/runs?${params.toString()}`);
}

/**
 * Fetch a single TraceRun with all its TraceEvents.
 * @param {string} runId
 */
export async function fetchTraceRun(runId) {
  return request(`/api/debug/trace/run/${encodeURIComponent(runId)}`);
}
