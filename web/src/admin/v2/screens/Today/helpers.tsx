import { Fragment, type ReactNode } from 'react';
import { bakuParts, bakuToday, minutesOf } from '../../../format';
import type { Block, Shoot } from '../../../types';
import { minToHhmm } from '../../data/time';

/** Mətndəki rəqəm qrupları (saat, tarix, müddət) .mono olur — dizayndakı kimi. */
export function mx(text: string): ReactNode {
  return text.split(/(\d[\d:.,]*)/).map((p, i) => (i % 2 ? <span key={i} className="mono">{p}</span> : <Fragment key={i}>{p}</Fragment>));
}

const TAG: Record<string, string> = { podcast: 'Podkast', reels: 'Reels', other: 'Digər' };
/** "Podkast · 3 kamera", "Reels paketi", "Müştəri özü çəkir" ("icarə" sözü qadağandır). */
export function shootLabel(s: Pick<Shoot, 'kind' | 'tag' | 'cameras'>): string {
  const base = s.kind === 'reels_pack' ? 'Reels paketi' : s.kind === 'single_reel' ? 'Tək Reels' : s.kind === 'studio_rent' ? 'Müştəri özü çəkir' : TAG[s.tag] ?? 'Çəkiliş';
  return s.cameras > 0 && s.kind !== 'reels_pack' && s.kind !== 'single_reel' ? `${base} · ${s.cameras} kamera` : base;
}

/** "Nümunə Müştəri" → "Nümunə M." */
export function shortName(full: string | null): string {
  const w = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${w[1][0].toLocaleUpperCase('az')}.` : w[0] ?? '';
}

export const DAY_FROM = 8 * 60;
export const DAY_TO = 22 * 60;

/** Bu günün boş vaxtları (08:00–22:00, çəkilişlər və bloklar çıxılır): [[başlanğıc dəq, son dəq], …] */
export function freeRanges(shoots: Shoot[], blocks: Block[]): [number, number][] {
  const today = bakuToday();
  const minOf = (iso: string) => { const p = bakuParts(iso); return p.date < today ? 0 : p.date > today ? 24 * 60 : minutesOf(p.time); };
  const busy: [number, number][] = [
    ...shoots.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show').map((s) => [minOf(s.starts_at), minOf(s.starts_at) + s.duration_min] as [number, number]),
    ...blocks.map((b) => [minOf(b.starts_at), minOf(b.ends_at)] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = DAY_FROM;
  for (const [a, b] of busy) {
    if (a > cur) out.push([cur, Math.min(a, DAY_TO)]);
    cur = Math.max(cur, b);
  }
  if (cur < DAY_TO) out.push([cur, DAY_TO]);
  return out.filter(([a, b]) => b > a && a < DAY_TO);
}

/** 99 E «Təqvim»: «Cümə, 13 noy: 11:00–13:30, 17:30–18:30». Bu gün üçün «Bu gün boşdur: …». */
export function freeText(ranges: [number, number][]): string {
  if (!ranges.length) return 'Bu gün boş vaxt yoxdur';
  return `Bu gün boşdur: ${ranges.map(([a, b]) => `${minToHhmm(a)}–${minToHhmm(b)}`).join(', ')}`;
}
