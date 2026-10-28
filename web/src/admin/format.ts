// Bakı vaxtı (UTC+4, yay vaxtı yoxdur) və AZN mətn çevirmələri. Təmiz funksiyalardır.
const MS_H = 3600_000;
const OFFSET = 4 * MS_H;

const p2 = (n: number) => String(n).padStart(2, '0');

/** "35", "35,5", "35.50", "1 200" → qəpik. Yanlış yazılışda null. signed=true: "+5"/"−5" də olar. */
export function parseAzn(text: string, signed = false): number | null {
  const t = text.trim().replace(/\s+/g, '').replace('−', '-').replace(/AZN$/i, '');
  const m = (signed ? /^([+-])?(\d+)(?:[.,](\d{1,2}))?$/ : /^()(\d+)(?:[.,](\d{1,2}))?$/).exec(t);
  if (!m) return null;
  const q = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  return m[1] === '-' ? -q : q;
}

/** qəpik → giriş sahəsi mətni: 3500 → "35", 3550 → "35,50". */
export function aznInput(qepik: number): string {
  const v = Math.abs(qepik);
  return `${Math.floor(v / 100)}${v % 100 ? ',' + p2(v % 100) : ''}`;
}

/** ISO → Bakı tarixi/saatı ("2026-10-28", "14:30"). */
export function bakuParts(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + OFFSET);
  return { date: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`, time: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` };
}

/** Bakı tarixi + saatı → server üçün ISO (+04:00). */
export function toIso(date: string, time: string): string {
  return `${date}T${time}:00+04:00`;
}

export const bakuNow = () => bakuParts(new Date().toISOString());
export const bakuToday = () => bakuNow().date;

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/** 0 = bazar ertəsi … 6 = bazar. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
export const weekStart = (date: string) => addDays(date, -weekday(date));

const DAYS = ['Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə', 'Bazar'];
const DAYS_SHORT = ['B.e.', 'Ç.a.', 'Ç.', 'C.a.', 'C.', 'Ş.', 'B.'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];

const parts = (date: string) => date.split('-').map(Number);
export const dayShort = (date: string) => DAYS_SHORT[weekday(date)];
/** "Çərşənbə, 28 oktyabr" */
export function dateLong(date: string): string {
  const [, m, d] = parts(date);
  return `${DAYS[weekday(date)]}, ${d} ${MONTHS[m - 1]}`;
}
/** "28 okt" */
export function dateShort(date: string): string {
  const [, m, d] = parts(date);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}
/** "28 oktyabr 2026" */
export function dateFull(date: string): string {
  const [y, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export const dayNum = (date: string) => parts(date)[2];
export const monthShortUp = (date: string) => MONTHS_SHORT[parts(date)[1] - 1].toUpperCase();

/** ISO + dəqiqə → "14:00–15:00" */
export function timeRange(iso: string, minutes: number): string {
  const s = bakuParts(iso).time;
  return `${s}–${bakuParts(new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()).time}`;
}
export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const endMs = (iso: string, minutes: number) => new Date(iso).getTime() + minutes * 60_000;

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function range(fromDate: string, toDateExclusive: string): string {
  return `from=${encodeURIComponent(toIso(fromDate, '00:00'))}&to=${encodeURIComponent(toIso(toDateExclusive, '00:00'))}`;
}

/** "09:45" + dəqiqə → "10:15" (gecəyarısı dövrəsi ilə). */
export function addMin(time: string, min: number): string {
  const m = (((minutesOf(time) + min) % 1440) + 1440) % 1440;
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}

/** Studiyanın məşğul aralığı: başlanğıc − hazırlıq … bitmə + yığışdırma ("09:45–11:30"). */
export function busyRange(time: string, dur: number, prep: number, wrap: number): string {
  return `${addMin(time, -prep)}–${addMin(time, dur + wrap)}`;
}
