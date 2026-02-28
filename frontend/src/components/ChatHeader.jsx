const Logo = ({ dark }) => (
  <svg
    width="40"
    height="40"
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="flex-shrink-0"
    aria-hidden
  >
    <defs>
      <linearGradient id="header-logo-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38bdf8" />
        <stop offset="0.6" stopColor="#0ea5e9" />
        <stop offset="1" stopColor="#0284c7" />
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="10" fill="url(#header-logo-grad)" />
    <path
      d="M10 24v-4l6-8h2l-5 8h2l6-8h2l-5 8h4v4H10z"
      fill={dark ? 'rgba(7,10,15,0.9)' : 'rgba(255,255,255,0.95)'}
    />
    <circle cx="27" cy="22" r="4" stroke={dark ? 'rgba(7,10,15,0.9)' : 'rgba(255,255,255,0.95)'} strokeWidth="1.5" fill="none" />
  </svg>
);

import ThemeToggle from './ThemeToggle';

export default function ChatHeader({ theme, onThemeToggle, onDebugToggle, debugOpen }) {
  const isDark = theme === 'dark';
  return (
    <header className="luxury-header flex items-center justify-between gap-4 px-6 py-4">
      <div className="flex items-center gap-4">
        <Logo dark={isDark} />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-inherit">PartPilot</h1>
          <p className="text-xs text-sky-500 tracking-wide">Luxury Parts Assistant</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* Examine Backend toggle */}
        <button
          type="button"
          onClick={onDebugToggle}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
            debugOpen
              ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
              : 'text-slate-400 hover:text-sky-400 border-slate-700 hover:border-sky-500/30'
          }`}
          title="Toggle backend trace inspector"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Examine Backend
        </button>
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
      </div>
    </header>
  );
}
