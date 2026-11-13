import { formatMoney } from '../../../shared/ui';
import type { Conv, Park } from '../../components/crm';
import { contactName } from '../../components/crm';
import { bakuParts, bakuToday, addDays, endMs } from '../../format';
import type { Shoot } from '../../types';
import type { AvatarTone } from '../ui';
import { ddmm, ddmmTime, fmtLeft, fmtWait, msOf, HOUR } from './time';

/** Növbə sətri = bir növbəti addım (00 §4). */
export type QueueItem = {
  key: string;
  kind: 'chat' | 'deposit' | 'close' | 'delivery';
  /** Sıralama qrupu (00 §4 + 99 M23); kiçik = təcili. */
  group: number;
  /** Qrup daxilində artan. */
  sort: number;
  name: string;
  /** "Cavab ver", "Beh al", "Çəkilişi bağla", "Montajı təhvil ver" */
  verb: string;
  /** Sətir başlığında ada əlavə (məs. "75 AZN"). */
  amount?: string;
  meta: string;
  metaTone?: 'warn' | 'danger';
  /** Sağdakı gözləmə müddəti. */
  right?: string;
  avatar: AvatarTone;
  conv?: Conv;
  shoot?: Shoot;
};

/** Kənara qoyulma hələ qüvvədədirmi: qaralama yoxdur və müştəri sonradan yazmayıb.
 *  Müştəri yenə yazanda (və ya bot qaralama hazırlayanda) söhbət öz bölməsinə qayıdır. */
export function parkOf(c: Pick<Conv, 'park' | 'pending_drafts' | 'last_message' | 'last_message_at'>): Park['to'] | null {
  const p = c.park;
  if (!p || c.pending_drafts > 0) return null;
  const newerIn = c.last_message?.direction === 'in' && new Date(c.last_message_at ?? 0).getTime() > new Date(p.at).getTime();
  return newerIn ? null : p.to;
}

/** Bot ümumi söndürülübsə bütün cavabsız mesajlar sahibkara düşür (01 «Bot söndürülüb»). */
export function chatWaiting(c: Conv, botOn: boolean, withExcluded = false): boolean {
  if (c.contact.excluded && !withExcluded) return false;
  if (parkOf(c)) return false;
  const lastIn = c.last_message?.direction === 'in';
  switch (c.mode) {
    case 'wait': return true; // bot komandaya ötürüb
    case 'owner': return c.pending_drafts > 0 || lastIn; // «Siz yazdınız»
    case 'human': return lastIn; // bot susur
    default: return !botOn && lastIn;
  }
}

/** "təxminən N dəq": iş sayı × 1,5 dəq, 5-ə yuvarlaq (99 E «Bu gün»). */
export function estimateMin(count: number): number {
  if (!count) return 0;
  return Math.max(5, Math.round((count * 1.5) / 5) * 5);
}

/** Beh-i olmayan çəkilişə bu qədər qalanda «Beh al» ən yuxarı qrupa çıxır (00 §4 b.1; hədd 99-da yoxdur). */
// TODO [Sual] 00 §4: «çəkilişə az qalıb, beh yoxdur» həddi (2 saat götürüldü).
const URGENT_DEPOSIT_MS = 2 * HOUR;

export function buildQueue(input: { convs: Conv[]; depositShoots: Shoot[]; shoots: Shoot[]; botOn: boolean; now: number }): QueueItem[] {
  const { convs, depositShoots, shoots, botOn, now } = input;
  const out: QueueItem[] = [];
  const today = bakuToday();

  for (const c of convs) {
    if (!chatWaiting(c, botOn)) continue;
    const name = contactName(c.contact);
    const since = c.last_message?.direction === 'in' ? c.last_message.created_at : c.last_message_at;
    const wait = since ? Math.max(0, now - msOf(since)) : 0;
    const base = { key: `chat:${c.id}`, kind: 'chat' as const, name, verb: 'Cavab ver', right: since ? fmtWait(wait) : undefined, avatar: 'neutral' as const, conv: c, sort: -wait };
    // TODO [API] 4 rejimin tam məlumatı: ötürmə səbəbi siyahı cavabında yoxdur, xatırlatmanın getdiyi və qaralama taymeri (auto_at) API-də açıq deyil.
    if (c.mode === 'wait') out.push({ ...base, group: 2, meta: `Komandaya ötürülüb · ${fmtWait(wait)}` });
    else if (c.mode === 'owner') out.push({ ...base, group: 3, meta: c.pending_drafts > 0 ? 'Siz yazdınız · qaralama gözləyir' : 'Siz yazdınız · müştəri cavab yazdı' });
    else if (c.mode === 'human') out.push({ ...base, group: 7, meta: 'Bot susur · yeni mesaj' });
    else out.push({ ...base, group: 7, meta: 'Bot söndürülüb · qaralama yoxdur' });
  }

  for (const s of depositShoots) {
    const start = msOf(s.starts_at), end = endMs(s.starts_at, s.duration_min);
    if (now >= end) continue; // vaxtı keçib: «Çəkilişi bağla» işi
    const left = start - now;
    const amount = formatMoney(s.deposit_expected);
    const p = bakuParts(s.starts_at);
    let meta: string; let tone: QueueItem['metaTone'];
    if (left <= 0) { meta = 'Çəkiliş gedir · beh alınmayıb'; tone = 'warn'; }
    else if (left <= 24 * HOUR) { meta = `Çəkilişə ${fmtLeft(left)} qalıb`; tone = left <= URGENT_DEPOSIT_MS ? 'warn' : undefined; }
    else meta = `Çəkiliş ${ddmm(p.date)}, ${p.time} · hələ vaxt var`;
    out.push({ key: `deposit:${s.id}`, kind: 'deposit', group: left <= URGENT_DEPOSIT_MS ? 1 : 6, sort: start, name: s.client_name ?? 'Naməlum', verb: 'Beh al', amount, meta, metaTone: tone, avatar: 'deposit', shoot: s });
  }

  for (const s of shoots) {
    if (s.status === 'confirmed' && endMs(s.starts_at, s.duration_min) < now) {
      const end = endMs(s.starts_at, s.duration_min);
      const days = Math.floor((now - end) / (24 * HOUR));
      const pay = s.deposit_received_at || s.paid_at_studio ? '' : ' · ödəniş daxil edilməyib';
      out.push({ key: `close:${s.id}`, kind: 'close', group: 4, sort: end, name: s.client_name ?? 'Naməlum', verb: 'Çəkilişi bağla', meta: `${ddmmTime(s.starts_at)}${pay}${days >= 1 ? ` · ${days} gün` : ''}`, right: fmtWait(now - end), avatar: 'cancel', shoot: s });
    } else if (s.status === 'completed' && s.editing && s.production !== 'ready') {
      // 01: son günə ≤1 gün qalıb VƏ YA montaj hazırdır (Drive linki var) → iş yaranır (99 E).
      const hasLink = s.materials.length > 0;
      const due = s.delivery_on;
      const soon = !!due && due <= addDays(today, 1);
      if (!hasLink && !soon) continue;
      const late = !!due && due < today;
      const dueTxt = due ? ` · ${late ? 'son gün keçib' : 'son gün'} ${ddmm(due)}` : '';
      out.push({ key: `delivery:${s.id}`, kind: 'delivery', group: 5, sort: due ? Date.parse(due) : Number.MAX_SAFE_INTEGER, name: s.client_name ?? 'Naməlum', verb: 'Montajı təhvil ver',
        meta: `${hasLink ? 'Montaj hazırdır · Drive linki var' : 'Drive linki yoxdur'}${dueTxt}`, metaTone: late ? 'danger' : undefined, avatar: 'edit', shoot: s });
    }
  }
  return out.sort((a, b) => a.group - b.group || a.sort - b.sort);
}
