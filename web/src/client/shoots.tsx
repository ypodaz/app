import type { CSSProperties } from 'react';
import { NIcon } from '../shared/ui';
import { dayNum, dur, endTimeOf, monLow, timeOf, weekday, type Shoot } from './util';

const WD_SHORT = (iso: string) => {
  const w = weekday(iso);
  return { Bazar: 'B', 'Bazar ertəsi': 'B.e', 'Çərşənbə axşamı': 'Ç.a', Çərşənbə: 'Ç', 'Cümə axşamı': 'C.a', Cümə: 'C', Şənbə: 'Ş' }[w] ?? w.slice(0, 1);
};

export type ChipTone = 'cal' | 'pkg' | 'cb' | 'off';
/** Status çipi: mətn + rəng. Beh gözlənilən çəkiliş də «Təsdiqləndi»dir (beh sətri ayrıca göstərilir). */
export function shootChip(s: Shoot): { label: string; tone: ChipTone } {
  if (s.status === 'cancelled') return { label: 'Ləğv olunub', tone: 'off' };
  if (s.status === 'no_show') return { label: 'Gəlinmədi', tone: 'off' };
  if (s.status === 'completed') return s.production === 'ready' ? { label: 'Hazırdır', tone: 'cb' } : { label: 'Montajda', tone: 'pkg' };
  return { label: 'Təsdiqləndi', tone: 'cal' };
}
export const StatusChip = ({ s }: { s: Shoot }) => {
  const c = shootChip(s);
  return <span className={`nstat nstat-${c.tone}`}><i aria-hidden="true" />{c.label}</span>;
};

export const kindLabel = (s: Shoot) => (s.kind === 'reels_pack' ? 'Reels paketi' : s.kind === 'single_reel' ? 'Tək Reels' : s.kind === 'studio_rent' ? 'Studiya icarəsi' : s.tag === 'podcast' ? 'Podcast' : s.tag === 'reels' ? 'Reels' : 'Çəkiliş');
const setup = (s: Shoot) => {
  const extras = [s.editing ? 'montaj' : '', s.reels_count ? `${s.reels_count} Reels` : ''].filter(Boolean);
  return `${s.cameras} kamera${extras.length ? ' + ' + extras.join(' + ') : ''}`;
};
/** «Podcast · 2 kamera + montaj» / «Podcast · Söhbət #13» */
const ticketTitle = (s: Shoot) => [kindLabel(s), s.title || (s.mine && s.status === 'confirmed' && s.kind === 'shoot' ? setup(s) : '')].filter(Boolean).join(' · ');

/** Bilet tarix kvadratı: həftə günü, gün, ay. */
export const DateBox = ({ iso }: { iso: string }) => (
  <span className="ndate"><small>{WD_SHORT(iso)}</small><b>{dayNum(iso)}</b><small>{monLow(iso)}</small></span>
);

/** Siyahı bileti. showWho: paket görünüşü, sağda «Sizin» / üzvün adı. */
export function TicketCard({ s, showWho, i = 0 }: { s: Shoot; showWho?: boolean; i?: number }) {
  const sub = s.mine && s.status === 'confirmed' ? s.payment_line : s.mine && s.status === 'completed' && s.materials.length ? 'Material hazırdır' : null;
  const time = `${timeOf(s.starts_at)} · ${dur(s.duration_min)}`;
  return (
    <a className={`nticket rise${s.status === 'cancelled' || s.status === 'no_show' ? ' dim' : ''}`} href={`#/shoots/${s.id}`} style={{ '--i': i } as CSSProperties}>
      <DateBox iso={s.starts_at} />
      <span className="nticket-body">
        {showWho
          ? <span className="nticket-top"><span className="n-meta">{time}</span><span className={`nowner${s.mine ? ' nowner-me' : ''}`}>{s.mine ? 'Sizin' : s.who}</span></span>
          : <span className="n-meta">{time}</span>}
        <span className="n-body6">{ticketTitle(s)}</span>
        <span className="nticket-st"><StatusChip s={s} />{sub && <span className="n-meta">{sub}</span>}</span>
      </span>
      <NIcon name="chev" style={{ flex: 'none', alignSelf: 'center', color: 'var(--yp-text-3)' }} />
    </a>
  );
}

export const timeRange = (s: Shoot) => `${timeOf(s.starts_at)}–${endTimeOf(s.starts_at, s.duration_min)} · ${dur(s.duration_min)}`;

/** Seqment açarı: pill ikinci seçimdə 240ms ilə sürüşür. */
export function NSeg<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="tablist" aria-label={label} className="nseg">
      <span className="nseg-pill" aria-hidden="true" style={{ transform: value === options[0].value ? undefined : 'translateX(100%)' }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : undefined} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
