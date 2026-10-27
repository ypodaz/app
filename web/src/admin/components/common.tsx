import type { ReactNode } from 'react';
import { Icon, Pill, formatMoney } from '../../shared/ui';
import { bakuParts, dateShort, dayNum, dayShort, initials, monthShortUp, timeRange } from '../format';
import type { Shoot } from '../types';

export const TAG: Record<string, string> = { podcast: 'Podcast', reels: 'Reels', other: 'Digər' };

export function Err({ msg }: { msg: string }) {
  return msg ? <p className="err" role="alert">{msg}</p> : null;
}

export function BackLink({ to, label = 'Geri' }: { to: string; label?: string }) {
  return (
    <a className="btn btn-ghost btn-sm btn-auto ax-back" href={`#/${to}`}>
      <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" size={18} /></span> {label}
    </a>
  );
}

export function Avatar({ name }: { name: string }) {
  return <span className="ic"><span className="t13 w8">{initials(name)}</span></span>;
}

export function Field({ label, id, hint, children }: { label: ReactNode; id?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function depositPending(s: Shoot): boolean {
  return s.status === 'confirmed' && s.deposit_expected > 0 && !s.deposit_received_at && !s.deposit_waived;
}

export function ShootPill({ s }: { s: Shoot }) {
  if (s.status === 'completed') return <Pill status="done" />;
  if (s.status === 'cancelled') return <Pill status="cancelled" />;
  if (s.status === 'no_show') return <Pill status="noshow" />;
  return depositPending(s) ? <Pill status="deposit">{`Beh gözlənilir ${formatMoney(s.deposit_expected)}`}</Pill> : <Pill status="confirmed" />;
}

/** "Çəkiliş · Podcast · Studiyada · 2 kamera · montaj" */
export function shootDesc(s: Shoot): string {
  if (s.kind === 'reels_pack') return `Reels Paketi · ${s.location === 'studio' ? 'Studiyada' : 'Məkanda'}`;
  return ['Çəkiliş', TAG[s.tag], s.location === 'studio' ? 'Studiyada' : 'Məkanda', `${s.cameras} kamera`, s.editing && 'montaj', s.package_id && 'paketdən']
    .filter(Boolean).join(' · ');
}

/** Tarix bloku + vaxt + təsvir (tcard). */
export function ShootTicket({ s, children }: { s: Shoot; children?: ReactNode }) {
  const d = bakuParts(s.starts_at).date;
  return (
    <div className="tcard"><div className="tk">
      <div className="tk-date"><small>{dayShort(d)}</small><b>{dayNum(d)}</b><small>{monthShortUp(d)}</small></div>
      <div className="tk-body">
        <span className="row sb wrap"><span className="num-s neon">{timeRange(s.starts_at, s.duration_min)}</span><ShootPill s={s} /></span>
        <span className="t13 w7 soft">{shootDesc(s)}</span>
        {children}
      </div>
    </div></div>
  );
}

/** Siyahı sətri: vaxt + ad + təsvir, ShootPill. */
export function ShootRow({ s, withDate }: { s: Shoot; withDate?: boolean }) {
  const p = bakuParts(s.starts_at);
  return (
    <a className="li" href={`#/shoots/${s.id}`}>
      <span className="t14 w8 ax-time">{withDate ? dateShort(p.date) : p.time}</span>
      <span className="col grow" style={{ gap: 4 }}>
        <span className="t13"><b>{s.client_name}</b> · {withDate ? p.time + ' · ' : ''}{shootDesc(s)}</span>
        <ShootPill s={s} />
      </span>
    </a>
  );
}

/** Say seçici (Reels sayı kimi): 0..max. */
export function CountStepper({ value, onChange, max = 50, disabled, label }: { value: number; onChange: (n: number) => void; max?: number; disabled?: boolean; label: string }) {
  return (
    <div className="stp" role="group" aria-label={label} style={disabled ? { opacity: 0.4 } : undefined}>
      <button type="button" aria-label="Azalt" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}><Icon name="minus" /></button>
      <span className="v rs-nowrap" aria-live="polite" style={{ minWidth: 56 }}>{value}</span>
      <button type="button" aria-label="Artır" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><Icon name="plus" /></button>
    </div>
  );
}
