// Tarix/saat köməkçiləri (Asia/Baku = UTC+4 sabit), əlaqə linkləri, .ics.
import { formatMoney } from '../shared/ui';

export const WA_NUMBER = '994555303532';
export const PHONE_HREF = 'tel:+994555303532';
export const MAP_URL = 'https://waze.com/ul/htp5mys9kw';
export const ADDRESS = 'Zaur Nudirəliyev küçəsi 34A, Bakı';

export const waLink = (text: string) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

const WD = ['Bazar', 'Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə'];
const MON = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const MON_SHORT = ['YAN', 'FEV', 'MAR', 'APR', 'MAY', 'İYN', 'İYL', 'AVQ', 'SEN', 'OKT', 'NOY', 'DEK'];
export const WD_HEAD = ['B.e.', 'Ç.a.', 'Ç.', 'C.a.', 'C.', 'Ş.', 'B.'];
export const monthName = (m: number) => MON[m];
export const monthTitle = (y: number, m: number) => `${MON[m][0].toUpperCase()}${MON[m].slice(1)} ${y}`;

const H4 = 4 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Baku-dakı hissələr (Date-in UTC alətləri ilə). */
export function baku(iso: string | number | Date) {
  const d = new Date(new Date(iso).getTime() + H4);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
export const dayKey = (iso: string | number | Date) => { const b = baku(iso); return `${b.y}-${pad(b.m + 1)}-${pad(b.d)}`; };
export const todayKey = () => dayKey(Date.now());
export const timeOf = (iso: string) => { const b = baku(iso); return `${pad(b.h)}:${pad(b.mi)}`; };
export const endTimeOf = (iso: string, min: number) => timeOf(new Date(new Date(iso).getTime() + min * 60000).toISOString());
export const weekday = (iso: string) => WD[baku(iso).wd];
export const dayNum = (iso: string) => baku(iso).d;
export const monShort = (iso: string) => MON_SHORT[baku(iso).m];
export const dateLong = (iso: string) => { const b = baku(iso); return `${WD[b.wd]}, ${b.d} ${MON[b.m]}`; };
export const dateShort = (iso: string) => { const b = baku(iso); return `${b.d} ${MON[b.m].slice(0, 3)}`; };
export const dateFull = (iso: string) => { const b = baku(iso); return `${b.d} ${MON[b.m]} ${b.y}`; };
/** 'YYYY-MM-DD' (təqvim tarixi, qurşaqsız) üçün. */
export const plainDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
export const plainDateShort = (s: string) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MON[m - 1]}`; };

const dayIndex = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const daysBetween = (fromKey: string, toKey: string) => dayIndex(toKey) - dayIndex(fromKey);

export function relDay(iso: string): string {
  const n = daysBetween(todayKey(), dayKey(iso));
  if (n === 0) return 'Bu gün';
  if (n === 1) return 'Sabah';
  if (n === -1) return 'Dünən';
  if (n > 0) return `${n} gün sonra`;
  return n <= -14 ? `${Math.round(-n / 7)} həftə əvvəl` : `${-n} gün əvvəl`;
}

export function dur(min: number): string {
  if (min < 60) return `${min} dəq`;
  if (min % 30) return `${Math.floor(min / 60)} saat ${min % 60} dəq`;
  return `${fmtHours(min)} saat`;
}
export function fmtHours(min: number): string {
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h},${Math.round((r / 60) * 10)}` : String(h);
}

export const money = formatMoney;

// --- çəkilişin təsviri ---
export type Shoot = {
  id: number; package_id: number | null; starts_at: string; duration_min: number; kind: string; tag: string; location: string;
  address: string | null; cameras: number; editing: boolean; reels_count: number; title: string | null; status: string;
  production: string; delivery_on: string | null; price_base: number; price_editing: number; price_reels: number;
  price_extra_camera: number; discount: number; extras?: { name: string; amount: number }[]; total: number; mine: boolean; who: string; cashback_used: number | null;
  payment_line: string | null; studio_balance: number | null; deposit_expected: number | null;
  materials: { id: number; title: string; drive_url: string }[]; cashback_earned: number | null;
  cashback_expected: { amount: number; first_shoot: boolean } | null;
};

const TAG: Record<string, string> = { podcast: 'Podcast', reels: 'Reels', other: 'Digər' };
export const serviceLabel = (s: Shoot) => (s.kind === 'reels_pack' ? 'Reels paketi' : s.kind === 'studio_rent' ? 'Studiya icarəsi' : `Çəkiliş · ${TAG[s.tag] ?? s.tag}`);
export const placeLabel = (s: Shoot) => (s.location === 'studio' ? 'Studiyada' : s.address ? `Sizin məkanda · ${s.address}` : 'Sizin məkanda');
export const editLabel = (s: Shoot) =>
  s.kind === 'studio_rent' ? '' : s.kind === 'reels_pack' ? `${s.reels_count} Reels` : s.editing ? (s.reels_count ? `Montaj + ${s.reels_count} Reels` : 'Var · Reels yoxdur') : 'Yoxdur';

export type StatusKey = 'confirmed' | 'deposit' | 'done' | 'cancelled' | 'noshow';
export function statusKey(s: Shoot): StatusKey {
  if (s.status === 'completed') return 'done';
  if (s.status === 'cancelled') return 'cancelled';
  if (s.status === 'no_show') return 'noshow';
  return s.payment_line?.startsWith('Beh gözlənilir') ? 'deposit' : 'confirmed';
}
export const isFuture = (s: Shoot) => s.status === 'confirmed' && new Date(s.starts_at).getTime() > Date.now();

// --- əlaqə mətnləri ---
export const BOOK_TEXT = 'Salam, çəkilişə yazılmaq istəyirəm.';
export const shootWaText = (s: Shoot) => `Salam, ${dateLong(s.starts_at)} saat ${timeOf(s.starts_at)} çəkilişi ilə bağlı yazıram.`;

// --- .ics ---
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = (t: string) => t.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
export function downloadIcs(s: Shoot) {
  const start = new Date(s.starts_at), end = new Date(start.getTime() + s.duration_min * 60000);
  const where = s.location === 'studio' ? `Y Pod studiyası, ${ADDRESS}` : s.address || 'Sizin məkanda';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Y Pod//App//AZ', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:ypod-shoot-${s.id}@ypodaz.github.io`, `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEsc('Y Pod · ' + serviceLabel(s))}`, `LOCATION:${icsEsc(where)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Y Pod çəkilişi', 'TRIGGER:-PT2H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `ypod-cekilis-${s.id}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

/** VAPID açarı (base64url) → pushManager.subscribe üçün bayt massivi. */
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
