const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 60000;

function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function sendMessage(sessionId, message) {
  const res = await fetchWithTimeout(`${BASE}/api/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId || undefined, message }),
    credentials: 'include',
  });
  const text = await res.text();
  const data = safeJson(text);
  if (!res.ok) {
    throw new Error(data.reply || data.error || text || `Request failed (${res.status})`);
  }
  if (data && typeof data.session_id === 'string') {
    return data;
  }
  throw new Error('Invalid response from server');
}

export async function sendPhoto(sessionId, file) {
  const form = new FormData();
  form.append('photo', file);
  if (sessionId) form.append('session_id', sessionId);
  const res = await fetchWithTimeout(`${BASE}/api/chat/photo`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  const text = await res.text();
  const data = safeJson(text);
  if (!res.ok) {
    throw new Error(data.reply || data.error || text || `Upload failed (${res.status})`);
  }
  if (data && typeof data.session_id === 'string') {
    return data;
  }
  throw new Error('Invalid response from server');
}

/**
 * Submit a structured form (COLLECT_CUSTOMER_DATA or CHOOSE_PRODUCT).
 * Called when the user fills and submits an InlineForm rendered in the chat.
 */
export async function submitForm(sessionId, action, formData) {
  const res = await fetchWithTimeout(`${BASE}/api/chat/submit-form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, action, data: formData }),
    credentials: 'include',
  });
  const text = await res.text();
  const data = safeJson(text);
  if (!res.ok) {
    throw new Error(data.error || text || `Submit failed (${res.status})`);
  }
  return data;
}

/**
 * Poll for pending notifications (SSE fallback for disconnected clients).
 * Returns array of { type, data } objects.
 */
export async function pollNotifications(sessionId) {
  if (!sessionId) return [];
  try {
    const res = await fetchWithTimeout(
      `${BASE}/api/chat/notifications?session_id=${encodeURIComponent(sessionId)}`,
      { credentials: 'include' },
      10000
    );
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.notifications) ? data.notifications : [];
  } catch {
    return [];
  }
}

/**
 * Open an SSE connection to receive real-time push events from the backend.
 * Returns the EventSource instance — caller must close it on cleanup.
 *
 * Events emitted by the backend:
 *   connected        — initial handshake { session_id }
 *   order_confirmed  — customer tapped "تأكيد العمل" on WhatsApp
 *   order_cancelled  — customer tapped "تعديل / إلغاء" on WhatsApp
 *   quote_sent       — WA quote template sent after CHOOSE_PRODUCT submit
 */
export function createSSEConnection(sessionId) {
  if (!sessionId) return null;
  const url = `${BASE}/api/chat/events?session_id=${encodeURIComponent(sessionId)}`;
  return new EventSource(url, { withCredentials: true });
}

export async function healthCheck() {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${BASE}/api/health`, { credentials: 'include', signal: ctrl.signal });
    clearTimeout(id);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !!data?.ok, time: data?.time };
  } catch {
    return { ok: false };
  }
}
