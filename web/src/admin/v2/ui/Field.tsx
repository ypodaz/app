import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

/** Etiket + sahə + göstəriş/xəta. children render-prop id alır ki, label bağlansın. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string, invalid: boolean) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children(id, !!error)}
      {error ? <span className="field__err" role="alert">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, className = '', ...rest } = props;
  return <input className={`input${className ? ' ' + className : ''}`} aria-invalid={invalid || undefined} {...rest} />;
}

/** Məbləğ kimi vahidli sahə: yazının sağında «AZN». */
export function UnitInput({ unit, ...props }: InputHTMLAttributes<HTMLInputElement> & { unit: string; invalid?: boolean }) {
  return <div className="input-unit"><TextInput {...props} /><span aria-hidden="true">{unit}</span></div>;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function TextArea(props, ref) {
  const { invalid, className = '', ...rest } = props;
  return <textarea ref={ref} className={`input${className ? ' ' + className : ''}`} aria-invalid={invalid || undefined} {...rest} />;
});

/** Açıq = qara; yalnız botun/AI-nin əsas açarı ai=true (bənövşəyi). Dərhal saxlanır (99 G9). */
export function Switch({ checked, onChange, label, ai, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; ai?: boolean; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch${ai ? ' switch--ai' : ''}`} onClick={() => onChange(!checked)} />;
}
