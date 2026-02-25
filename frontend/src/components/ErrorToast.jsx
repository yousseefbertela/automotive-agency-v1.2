export default function ErrorToast({ message, onDismiss }) {
  return (
    <div
      className="luxury-toast animate-toast-in fixed top-6 right-6 z-[100] max-w-sm rounded-xl px-4 py-3 shadow-xl backdrop-blur-md"
      role="alert"
    >
      <p className="text-sm text-slate-200">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs font-medium text-sky-400 hover:text-sky-300 underline"
      >
        Dismiss
      </button>
    </div>
  );
}
