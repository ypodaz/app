import type { ReactNode } from 'react';
import { formatMoney } from '../../../../shared/ui';
import { DATA_CHANGED } from '../../../ctx';
import { addDays, bakuParts, dateLong, dateShort, endMs, minutesOf } from '../../../format';
import { go } from '../../../router';
import type { Block, Shoot } from '../../../types';
import { depositPending, shootStatus } from '../../data/status';
import { ddmm, fmtLeft, fmtWait, minToHhmm, msOf, HOUR } from '../../data/time';
import type { ShootStatusV2 } from '../../ui';
import { shootLabel } from '../Today/helpers';

export const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
export const monthName = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1];
export const DAY_MIN = 8 * 60;
export const DAY_MAX = 22 * 60;

/** Mutasiyadan sonra bütün açıq yükləyicilər (useLoad + ShellData) yenilənir. */
export const refresh = () => window.dispatchEvent(new Event(DATA_CHANGED));

// ---- Yerli ikonlar (ui/Icon.tsx-ə toxunmamaq üçün; "ortaq ola bilər") ----
const IC = {
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  chevd: <path d="m6 9 6 6 6-6" />,
  chevu: <path d="m6 15 6-6 6 6" />,
  drive: <><path d="M12 3 3 19h6l9-16z" /><path d="M9 19h12l-3-5.2" /></>,
  ext: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  sync: <><path d="M20 11a8 8 0 0 0-14-4M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14 4M20 19v-4h-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4z" />,
} as const;
export type CkIcon = keyof typeof IC;
export function Ic({ name, size = 16 }: { name: CkIcon; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{IC[name]}</svg>;
}

// ---- Mənbə (Apple təqvim sinxronu) ----
/** `source_note`: "calendar" = Apple təqvimindən gələn, "calendar-archive" = köçürülmüş keçmiş çəkiliş. Başlığı «… Y Pod» ilə bitən = Öz layihə. */
export type Src = 'app' | 'apple' | 'arxiv' | 'own';
export function srcOf(s: Shoot): Src {
  if (s.source_note === 'calendar-archive') return 'arxiv';
  if ((s.title ?? '').trim().endsWith('Y Pod')) return 'own';
  if (s.source_note === 'calendar') return 'apple';
  return 'app';
}
/** Arxiv və Öz layihə redaktə olunmur, pul/keşbek yazmır (00 §1.2, §5.2). */
export const readOnly = (s: Shoot) => srcOf(s) === 'arxiv' || srcOf(s) === 'own';
export const SRC_LABEL: Record<Exclude<Src, 'app'>, string> = { apple: 'Apple təqvimindən', arxiv: 'Arxiv', own: 'Öz layihə' };

/** Ləğv statuslu çəkiliş təqvimdə göstərilmir (10: Məlumat). */
export const visibleInCalendar = (s: Shoot) => s.status !== 'cancelled' && s.status !== 'no_show';

export const personName = (s: Shoot) => s.client_name || 'Adsız';
export const svcText = (s: Shoot) => (s.kind === 'studio_rent' ? 'Müştəri özü çəkir' : shootLabel(s)) + (s.editing && s.kind !== 'reels_pack' ? ' + montaj' : '');
export const money = (q: number) => (q > 0 ? formatMoney(q) : '—');

/** Statusdan təqvim bloku/sətir sinfi. */
export const EV: Record<ShootStatusV2, string> = { deposit: 'dep', confirmed: 'conf', now: 'now', to_close: 'close', editing: 'edit', delivered: 'done', done: 'done', cancelled: 'off' };

/** «Sizdən iş gözləyən»: Beh gözlənilir və Bağlanmalı (10, 12). Arxiv/Öz layihə daxil deyil. */
export function needsMe(s: Shoot, now: number): boolean {
  if (readOnly(s)) return false;
  const st = shootStatus(s, now);
  return st === 'deposit' || st === 'to_close';
}
/** 00 §4: əvvəl çəkilişə ≤2 saat qalıb + beh yox, sonra bağlanmalı (köhnə yuxarıda), sonra qalan behlər. */
export function waitingSort(list: Shoot[], now: number): Shoot[] {
  const grp = (s: Shoot) => { const st = shootStatus(s, now); return st === 'deposit' && msOf(s.starts_at) - now <= 2 * HOUR ? 0 : st === 'to_close' ? 1 : 2; };
  return [...list].sort((a, b) => grp(a) - grp(b) || msOf(a.starts_at) - msOf(b.starts_at));
}

export type Next = { text: string; ctx?: string; tone?: 'warn' | 'danger'; act?: 'deposit' | 'close' | 'extend' };
/** Növbəti addım mətni (12: cədvəl). «Xatırlat» (WhatsApp) API-də yoxdur. */
export function nextStep(s: Shoot, now: number): Next {
  const src = srcOf(s);
  if (src === 'arxiv') return { text: 'Addım yoxdur', ctx: 'keçmiş çəkilişə keşbek yazılmır' };
  if (src === 'own') return { text: 'Addım yoxdur', ctx: 'müştəri çəkilişi deyil, ödəniş yoxdur' };
  const st = shootStatus(s, now);
  const start = msOf(s.starts_at), end = endMs(s.starts_at, s.duration_min);
  switch (st) {
    case 'deposit': { const left = start - now; return { text: `Beh al · ${formatMoney(s.deposit_expected)}`, ctx: left > 0 ? `${fmtLeft(left)} qalıb` : 'vaxt gəlib', tone: left <= 2 * HOUR ? 'warn' : undefined, act: 'deposit' }; }
    case 'confirmed': return { text: 'Çəkilişi gözləyir', ctx: `${fmtLeft(start - now)} qalıb` };
    case 'now': return { text: `Bitəndə bağla · ${bakuParts(new Date(end).toISOString()).time}`, ctx: `${fmtLeft(end - now)} qalıb`, act: 'extend' };
    case 'to_close': {
      const days = Math.max(0, Math.round((msOf(`${bakuParts(new Date(now).toISOString()).date}T00:00:00+04:00`) - msOf(`${bakuParts(s.starts_at).date}T00:00:00+04:00`)) / (24 * HOUR)));
      return { text: 'Çəkilişi bağla', ctx: days > 0 ? `${days} gün keçib` : `${fmtWait(now - end)} keçib`, tone: 'danger', act: 'close' };
    }
    case 'editing': return { text: 'Montaj', ctx: s.delivery_on ? `təhvil ${ddmm(s.delivery_on)}` : 'təhvil tarixi yoxdur' };
    case 'delivered': return { text: 'Təhvil verilib' };
    case 'done': return { text: 'Bağlanıb' };
    default: return { text: 'Ləğv edilib' };
  }
}

// ---- Boş vaxtlar (08:00–22:00) ----
export function busyOfDay(date: string, shoots: Shoot[], blocks: Block[]): [number, number][] {
  const day0 = msOf(`${date}T00:00:00+04:00`);
  const m = (ms: number) => Math.round((ms - day0) / 60_000);
  const out: [number, number][] = [];
  for (const s of shoots) if (visibleInCalendar(s)) out.push([m(msOf(s.starts_at)), m(endMs(s.starts_at, s.duration_min))]);
  for (const b of blocks) out.push([m(msOf(b.starts_at)), m(msOf(b.ends_at))]);
  return out.filter(([a, b]) => b > 0 && a < 1440).sort((x, y) => x[0] - y[0]);
}
/** Günün boş fasilələri (dəq). Bu gün üçün keçmiş vaxt çıxılır. */
export function freeOfDay(date: string, shoots: Shoot[], blocks: Block[], nowMs = Date.now(), minLen = 30): [number, number][] {
  const nowP = bakuParts(new Date(nowMs).toISOString());
  let cur = DAY_MIN;
  if (date < nowP.date) return [];
  if (date === nowP.date) cur = Math.max(cur, Math.ceil(minutesOf(nowP.time) / 30) * 30);
  const out: [number, number][] = [];
  for (const [a, b] of busyOfDay(date, shoots, blocks)) {
    if (a > cur) out.push([cur, Math.min(a, DAY_MAX)]);
    cur = Math.max(cur, b);
  }
  if (cur < DAY_MAX) out.push([cur, DAY_MAX]);
  return out.filter(([a, b]) => b - a >= minLen);
}
export const rangeTxt = (r: [number, number][]) => r.map(([a, b]) => `${minToHhmm(a)}–${minToHhmm(b)}`).join(', ');
/** 99 E: «Cümə, 13 noy: 11:00–13:30, 17:30–18:30» (≥30 dəq, keçməmiş). */
export function freeCopyText(dates: string[], shoots: Shoot[], blocks: Block[]): string {
  const lines: string[] = [];
  for (const d of dates) {
    const free = freeOfDay(d, shoots.filter((s) => bakuParts(s.starts_at).date === d), blocks, Date.now());
    if (free.length) lines.push(`${dateLong(d).split(',')[0]}, ${dateShort(d)}: ${rangeTxt(free)}`);
  }
  return lines.join('\n');
}

export function weekRangeText(wk: string): string {
  const end = addDays(wk, 6);
  const a = wk.slice(8), b = end.slice(8);
  return monthName(wk) === monthName(end) ? `${Number(a)}–${Number(b)} ${monthName(end)}` : `${Number(a)} ${monthName(wk)} – ${Number(b)} ${monthName(end)}`;
}

/** Çəkiliş sərhədləri üçün qısa «status» etiketi (sətirlərdə). */
export function Note({ children }: { children: ReactNode }) { return <p className="ck-note">{children}</p>; }

export const openNew = (q: Record<string, string> = {}) => go(`cekilisler/yeni${Object.keys(q).length ? '?' + new URLSearchParams(q).toString() : ''}`);
export { depositPending };
