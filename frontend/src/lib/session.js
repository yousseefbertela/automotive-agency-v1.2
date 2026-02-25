const KEY = 'partpilot_session_id';

export function getSessionId() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setSessionId(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
}

export function clearSessionId() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
