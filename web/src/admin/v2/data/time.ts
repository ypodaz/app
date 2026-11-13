import { bakuParts, dateShort } from '../../format';

const MIN = 60_000;
const HOUR = 3_600_000;

/** Gözləmə müddəti (sətrin sağında): "33 dəq", "3 saat", "1,5 saat", "2 gün". */
export function fmtWait(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${Math.max(1, m)} dəq`;
  if (m < 24 * 60) return `${String(Math.round((m / 60) * 2) / 2).replace('.', ',')} saat`;
  return `${Math.floor(m / 1440)} gün`;
}

/** Qalan vaxt: "36 dəq", "1 saat 6 dəq", "2 saat" (01 R10). */
export function fmtLeft(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} dəq`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} saat ${r} dəq` : `${h} saat`;
}

/** "2026-11-10" → "10.11" */
export const ddmm = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
/** ISO → "10.11, 14:00" */
export function ddmmTime(iso: string): string { const p = bakuParts(iso); return `${ddmm(p.date)}, ${p.time}`; }
export { dateShort };

/** 994501234567 → "+994 50 ••• •• 67" (siyahılarda maskalı, 00 §1.1). */
export function maskPhone(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 11) return d ? `+${d}` : '';
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ••• •• ${d.slice(-2)}`;
}

export const hhmmToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const minToHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const msOf = (iso: string) => new Date(iso).getTime();
export { MIN, HOUR };
