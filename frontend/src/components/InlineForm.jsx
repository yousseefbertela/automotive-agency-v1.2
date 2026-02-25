import { useState } from 'react';

/**
 * InlineForm
 *
 * Renders a structured form inside a chat bubble when the backend sends:
 *   { type: 'form', action: 'COLLECT_CUSTOMER_DATA' | 'CHOOSE_PRODUCT', fields: [...] }
 *
 * Supported field types: text, tel, number, select
 *
 * After submission it shows a ✅ confirmation and disables all inputs.
 */
export default function InlineForm({ form, onSubmit, disabled: outerDisabled }) {
  const [values, setValues] = useState(() => {
    const init = {};
    for (const f of form.fields || []) {
      // Pre-select first option for select fields
      init[f.name] =
        f.type === 'select' && f.options?.length ? String(f.options[0].value) : '';
    }
    return init;
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleChange = (name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitted || loading || outerDisabled) return;
    setLocalError(null);
    setLoading(true);
    try {
      await onSubmit(form.action, values);
      setSubmitted(true);
    } catch (err) {
      setLocalError(err?.message || 'حصل خطأ، حاول تاني');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-emerald-400 font-medium">
        <span>✅</span>
        <span>تم الإرسال بنجاح</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-3 w-full">
      {form.message && (
        <p className="text-sm text-slate-300 leading-relaxed">{form.message}</p>
      )}

      {(form.fields || []).map((field) => (
        <div key={field.name} className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-400 tracking-wide">
            {field.label}
            {field.required && <span className="text-amber-400 ml-1">*</span>}
          </label>

          {field.type === 'select' ? (
            <select
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              required={field.required}
              disabled={loading || submitted}
              className="rounded-lg px-3 py-2 text-sm bg-slate-700/80 text-white border border-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-60"
            >
              {(field.options || []).map((opt) => (
                <option key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type || 'text'}
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              required={field.required}
              disabled={loading || submitted}
              placeholder={field.placeholder || ''}
              dir={field.type === 'tel' || field.type === 'number' ? 'ltr' : 'auto'}
              className="rounded-lg px-3 py-2 text-sm bg-slate-700/80 text-white border border-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-500 disabled:opacity-60"
            />
          )}
        </div>
      ))}

      {localError && (
        <p className="text-xs text-red-400 bg-red-900/30 rounded px-2 py-1">{localError}</p>
      )}

      <button
        type="submit"
        disabled={loading || submitted || outerDisabled}
        className="luxury-btn-send w-full rounded-xl font-semibold px-5 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed mt-1"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-white/60 animate-pulse" />
            <span className="inline-block w-2 h-2 rounded-full bg-white/60 animate-pulse [animation-delay:0.15s]" />
            <span className="inline-block w-2 h-2 rounded-full bg-white/60 animate-pulse [animation-delay:0.3s]" />
          </span>
        ) : (
          'إرسال'
        )}
      </button>
    </form>
  );
}
