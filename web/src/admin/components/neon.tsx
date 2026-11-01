// Admin Neon ortaq parçaları (batch 2–3 də istifadə olunur): status çipi, sayğac, toast.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AIcon } from './AIcon';
import { formatMoney } from '../../shared/ui';
import type { Shoot } from '../types';
import { depositPending } from './common';

export type ChipTone = 'cal' | 'cb' | 'beh' | 'off';

/** Rəngli nöqtəli status çipi (Neon). tone: cal=təsdiqləndi, cb=tamamlandı, beh=beh gözlənilir (qırıq xətt), off=ləğv/gəlmədi. */
export function AChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`a-chip a-chip-${tone}`}><i />{children}</span>;
}

/** Çəkilişin status çipi; withAmount=true olanda behdə məbləğ də yazılır. */
export function ShootChip({ s, withAmount }: { s: Shoot; withAmount?: boolean }) {
  if (s.status === 'completed') return <AChip tone="cb">Tamamlandı</AChip>;
  if (s.status === 'cancelled') return <AChip tone="off">Ləğv olundu</AChip>;
  if (s.status === 'no_show') return <AChip tone="off">Gəlmədi</AChip>;
  return depositPending(s)
    ? <AChip tone="beh">{withAmount ? `Beh gözlənilir · ${formatMoney(s.deposit_expected)}` : 'Beh gözlənilir'}</AChip>
    : <AChip tone="cal">Təsdiqləndi</AChip>;
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Rəqəm 0-dan (və ya əvvəlki dəyərdən) 500ms ərzində sayır; azaldılmış hərəkətdə dərhal son dəyər. */
export function useCountUp(target: number | undefined, ms = 500): number | undefined {
  const [v, setV] = useState<number | undefined>(target === undefined || reducedMotion() ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target === undefined) { setV(undefined); return; }
    if (reducedMotion()) { setV(target); from.current = target; return; }
    const a = from.current;
    let raf = 0, t0: number | null = null;
    const step = (t: number) => {
      if (t0 === null) t0 = t;
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Yuxarıdan düşən 3 saniyəlik toast: show(text) ilə çağırın, node-u səhifədə render edin. */
export function useToast() {
  const [t, setT] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (text: string) => {
    window.clearTimeout(timer.current);
    setT({ id: Date.now(), text });
    timer.current = window.setTimeout(() => setT(null), 3500);
  };
  const node = t && (
    <div className="a-toastw"><div key={t.id} className="a-toast" role="status">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      <span>{t.text}</span>
    </div></div>
  );
  return { show, node };
}

/** Səhifə başlığı: telefonda geri düyməsi, ≥640-da sağda əməliyyatlar (məs. «Ləğv et»). label verilsə kompüterdə başlığın üstündə «‹ Etiket» keçidi görünür. */
export function PageHead({ title, sub, back, label, actions }: { title: string; sub?: string; back: string; label?: string; actions?: ReactNode }) {
  return (
    <header className={`a-ph${label ? ' a-ph-l' : ''}`}>
      <a className="a-back" href={`#/${back}`} aria-label={label ? `Geri: ${label}` : 'Geri'}><AIcon name="chevl" size={20} />{label && <span>{label}</span>}</a>
      <div className="a-ph-t"><h1>{title}</h1>{sub && <div className="a-sub">{sub}</div>}</div>
      {actions && <div className="a-acts">{actions}</div>}
    </header>
  );
}

/** Sürüşən fonlu seqment (Neon). pill: yumru variant (tablar, Materiallar statusu); option.tone: aktiv seçimin rəngi. */
export function ASeg<T extends string | number>({ options, value, onChange, label, disabled, locked, pill, className = '' }: { options: { value: T; label: string; disabled?: boolean; tone?: 'mat' | 'ok' }[]; value: T; onChange?: (v: T) => void; label?: string; disabled?: boolean; locked?: boolean; pill?: boolean; className?: string }) {
  const k = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`a-sg${locked ? ' lock' : ''}${pill ? ' a-sg-p' : ''}${className ? ' ' + className : ''}`} role="group" aria-label={label} data-tone={options[k]?.tone ?? ''} style={{ '--n': options.length, '--k': k } as CSSProperties}>
      <span className="a-sg-i" aria-hidden="true" />
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} disabled={disabled || o.disabled} onClick={() => onChange?.(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Dairəvi − / + düymələri və dəyər (dəyişəndə kiçik «pop»). */
export function AStep({ text, onDec, onInc, decDisabled, incDisabled, label, narrow }: { text: ReactNode; onDec: () => void; onInc: () => void; decDisabled?: boolean; incDisabled?: boolean; label?: string; narrow?: boolean }) {
  return (
    <div className="a-st" role="group" aria-label={label}>
      <button type="button" className="a-stb" aria-label="Azalt" disabled={decDisabled} onClick={onDec}><AIcon name="minus" size={20} /></button>
      <span key={String(text)} className={`a-stv${narrow ? ' nr' : ''}`} aria-live="polite">{text}</span>
      <button type="button" className="a-stb" aria-label="Artır" disabled={incDisabled} onClick={onInc}><AIcon name="plus" size={20} /></button>
    </div>
  );
}

/** Mərkəzdə təsdiq dialoqu (brauzerin confirm() əvəzinə). title verilməsə, text başlıq kimi göstərilir. */
export function ConfirmDialog({ open, title, text, cancelLabel = 'Ləğv et', confirmLabel, onCancel, onConfirm }: { open: boolean; title?: string; text: ReactNode; cancelLabel?: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="a-dlg-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="a-dlg" role="alertdialog" aria-modal="true" aria-label={title ?? 'Təsdiq'} tabIndex={-1} ref={ref}>
        <h2>{title ?? text}</h2>
        {title && <p>{text}</p>}
        <div className="a-dlg-b">
          <button type="button" className="a-bg" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="a-bd" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
