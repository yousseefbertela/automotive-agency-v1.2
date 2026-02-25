import { useState } from 'react';
import { clearSessionId } from '../lib/session';

export default function SettingsPanel({ sessionId, onSessionChange, onClose }) {
  const [resetConfirm, setResetConfirm] = useState(false);

  const handleReset = () => {
    if (resetConfirm) {
      clearSessionId();
      onSessionChange(null);
      setResetConfirm(false);
      onClose();
    } else {
      setResetConfirm(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        className="luxury-panel w-full max-w-md rounded-2xl border border-sky-500/20 p-6 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title" className="text-lg font-semibold text-white mb-4">Session</h2>
        <p className="text-slate-400 text-sm mb-2">Current session ID:</p>
        <code className="block bg-slate-900/80 rounded-lg px-3 py-2 text-xs text-slate-300 break-all mb-4 font-mono">
          {sessionId || '(none — will be created on first message)'}
        </code>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg px-4 py-2 text-sm font-medium bg-red-900/40 text-red-200 hover:bg-red-900/60 border border-red-800/50"
          >
            {resetConfirm ? 'Confirm reset' : 'Reset session'}
          </button>
          {resetConfirm && (
            <button
              type="button"
              onClick={() => setResetConfirm(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium bg-slate-600/50 text-slate-300 hover:bg-slate-600/70"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-4 py-2 text-sm font-medium bg-gradient-to-r from-sky-500 to-sky-600 text-slate-900 hover:from-sky-400 hover:to-sky-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
