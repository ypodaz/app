import type { ReactNode } from 'react';
import { AIcon } from './AIcon';
import type { Shoot } from '../types';

export const TAG: Record<string, string> = { podcast: 'Podcast', reels: 'Reels', other: 'Digər' };

/** "Çəkiliş · Podcast" / "Reels paketi" / "Studiya icarəsi" */
export function serviceName(s: Pick<Shoot, 'kind' | 'tag'>): string {
  return s.kind === 'reels_pack' ? 'Reels paketi' : s.kind === 'studio_rent' ? 'Studiya icarəsi' : `Çəkiliş · ${TAG[s.tag]}`;
}

export function Err({ msg }: { msg: string }) {
  return msg ? <p className="err" role="alert">{msg}</p> : null;
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

/** "Çəkiliş · Podcast · Studiyada · 2 kamera · montaj" */
export function shootDesc(s: Shoot): string {
  if (s.kind === 'studio_rent') return 'Studiya icarəsi';
  if (s.kind === 'reels_pack') return `Reels paketi · ${s.location === 'studio' ? 'Studiyada' : 'Məkanda'}`;
  return [serviceName(s), s.location === 'studio' ? 'Studiyada' : 'Məkanda', `${s.cameras} kamera`, s.editing && 'montaj', s.package_id && 'paketdən']
    .filter(Boolean).join(' · ');
}

/** Say seçici (Reels sayı kimi): 0..max. */
export function CountStepper({ value, onChange, max = 50, disabled, label }: { value: number; onChange: (n: number) => void; max?: number; disabled?: boolean; label: string }) {
  return (
    <div className="a-st" role="group" aria-label={label}>
      <button type="button" className="a-stb" aria-label="Azalt" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}><AIcon name="minus" size={20} /></button>
      <span key={value} className="a-stv nr" aria-live="polite">{value}</span>
      <button type="button" className="a-stb" aria-label="Artır" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><AIcon name="plus" size={20} /></button>
    </div>
  );
}

export const SOURCES: [string, string][] = [
  ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['google', 'Google'], ['youtube', 'YouTube'], ['referral', 'Dost tövsiyəsi'], ['other', 'Digər'],
];
export const sourceName = (s: string | null | undefined) => SOURCES.find(([k]) => k === s)?.[1] ?? '';

/** Açar (switch) — mövcud .tgl üslubu. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`tgl${on ? ' tgl-on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}
