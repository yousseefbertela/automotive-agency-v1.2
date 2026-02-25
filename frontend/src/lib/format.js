export function formatTime(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function shortSessionId(id) {
  if (!id || typeof id !== 'string') return '—';
  return id.slice(0, 6);
}
