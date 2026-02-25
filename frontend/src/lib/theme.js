const KEY = 'partpilot_theme';

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {}
  return 'dark';
}

export function setTheme(theme) {
  try {
    if (theme === 'light' || theme === 'dark') {
      localStorage.setItem(KEY, theme);
    }
  } catch {}
}
