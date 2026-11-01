// Admin Neon · batch 3 ortaq parçaları: avatar, boş vəziyyət, tarix sahəsi.
import type { CSSProperties, ReactNode } from 'react';
import { initials } from '../format';
import { AIcon, type AIconName } from './AIcon';

export const Av = ({ name, size = 40 }: { name: string; size?: number }) => (
  <span className="a3-av" aria-hidden="true" style={{ width: size, height: size, borderRadius: size / 2, fontSize: size >= 40 ? 13 : 11 }}>{initials(name)}</span>
);

/** Boş vəziyyət: ikon çipi, başlıq, izah, ixtiyari düymə (360ms qalxır). */
export function AEmpty({ icon, tone, title, text, action }: { icon: AIconName; tone?: 'pkg' | 'acc'; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="a3-empty">
      <span className={`a3-empty-i a3-empty-${tone ?? 'acc'}`}><AIcon name={icon} size={20} /></span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

export const stag = (i: number): CSSProperties => ({ '--i': i } as CSSProperties);

/** Tarix sahəsi: fokusda yerli seçici, qalan vaxt «4 noy, çərşənbə» mətni + təqvim ikonu. */
export function ADate({ id, value, onChange, text }: { id: string; value: string; onChange: (v: string) => void; text: string }) {
  return (
    <div className={`a3-date${value ? '' : ' empty'}`}>
      <input id={id} type="date" className="inp" value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <span className="a3-dv" aria-hidden="true">{text}</span>}
      <AIcon name="cal" size={18} />
    </div>
  );
}
