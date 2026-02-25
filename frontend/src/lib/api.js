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
