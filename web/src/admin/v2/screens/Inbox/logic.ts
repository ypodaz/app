import type { Conv, ConvMode, Msg } from '../../../components/crm';
import { addDays, bakuParts, bakuToday } from '../../../format';
import { ddmm, maskPhone } from '../../data/time';
import type { ChipTone } from '../../ui';

/** 03 §Q8 qrupları: «Sizi gözləyir» · «Bot aparır» · «Müştəridən cavab gözləyirik». */
export type Group = 'you' | 'bot' | 'theirs';

/** Server rejimləri (crm/turns.py): bot · owner (Siz yazdınız) · wait (Komandaya ötürülüb) · human (Bot susur). */
export const MODE_META: Record<ConvMode, { label: string; hint: string; tone: ChipTone }> = {
  bot: { label: 'Bot aparır', hint: 'Bot özü cavab yazır', tone: 'brand' },
  owner: { label: 'Siz yazdınız', hint: 'Növbə sizdədir · bot yalnız qaralama hazırlayır', tone: 'neutral' },
  wait: { label: 'Komandaya ötürülüb', hint: 'Bot asan suallara cavab verir, çətinləri sizə saxlayır', tone: 'deposit' },
  human: { label: 'Bot susur', hint: 'Bot heç nə yazmır · tam əl ilə', tone: 'neutral' },
};
export const MODE_ORDER: ConvMode[] = ['bot', 'owner', 'wait', 'human'];

type ModeSrc = { mode: ConvMode; contact: { excluded: boolean } };

/** Effektiv rejim (03 §Q1): dost və ya qlobal söndürülmüş bot → «Bot susur». */
export function effMode(c: ModeSrc, botOn: boolean): ConvMode {
  if (c.contact.excluded) return 'human';
  if (!botOn && c.mode === 'bot') return 'human';
  return c.mode;
}

export const lastIn = (c: Conv) => c.last_message?.direction === 'in';

export function groupOf(c: Conv, botOn: boolean): Group {
  const e = effMode(c, botOn);
  if (e === 'wait') return 'you';
  if (e === 'bot') return 'bot';
  return lastIn(c) || c.pending_drafts > 0 ? 'you' : 'theirs';
}

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** «Sizi gözləyir» sırası (03 §Q8): ən çox gözləyən «Komandaya ötürülüb» → qaralaması olan → qalanı (şəxsi/bot susur). */
function rank(c: Conv, botOn: boolean): number {
  const e = effMode(c, botOn);
  if (e === 'wait') return 0;
  if (e === 'owner' && c.pending_drafts > 0) return 1;
  return 2;
}

export function sortGroup(list: Conv[], g: Group, botOn: boolean): Conv[] {
  const out = [...list];
  if (g === 'you') out.sort((a, b) => rank(a, botOn) - rank(b, botOn) || ms(a.last_message_at) - ms(b.last_message_at));
  else out.sort((a, b) => ms(b.last_message_at) - ms(a.last_message_at));
  return out;
}

/** Sətrin sağ vaxtı (02 Q2): «Sizi gözləyir»də saat/«dünən»/dd.mm, qalanında nisbi vaxt (çağıran verir). */
export function clockOf(iso: string | null): string {
  if (!iso) return '';
  const p = bakuParts(iso);
  const today = bakuToday();
  if (p.date === today) return p.time;
  if (p.date === addDays(today, -1)) return 'dünən';
  return ddmm(p.date);
}

/** Gün ayırıcısı: «Bu gün» / «Dünən» / 12.11.2026 */
export function dayLabel(iso: string): string {
  const d = bakuParts(iso).date;
  const today = bakuToday();
  if (d === today) return 'Bu gün';
  if (d === addDays(today, -1)) return 'Dünən';
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

/** Mesajın qısa mətni (siyahı sətri): «Bot: …», «Siz: …», səs/şəkil. */
export function preview(m: Msg | null): string {
  if (!m) return 'Mesaj yoxdur';
  const body = (m.text || '').split('\n').find((x) => x.trim())?.trim()
    || (m.type === 'audio' || m.type === 'voice' ? 'Səs mesajı' : m.type === 'image' ? 'Şəkil' : `[${m.type}]`);
  if (m.direction === 'in') return body;
  return `${m.source === 'bot' ? 'Bot' : 'Siz'}: ${body}`;
}

export const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** +994 nömrələri maskalı (00 §1.1); xarici/şəxsi nömrə olduğu kimi (02 «Şəxsi kontakt»). */
export function phoneLabel(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.startsWith('994') ? maskPhone(d) : d ? `+${d}` : '';
}
