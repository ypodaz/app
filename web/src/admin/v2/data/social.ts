// Instagram DM, Instagram komment və YouTube komment (server: routes/admin_social_inbox.py, 02-inbox.md).
export type SocialMode = 'bot' | 'owner' | 'wait';

export type SocialThread = {
  key: string; channel: 'instagram' | 'youtube'; kind: 'dm' | 'comment'; thread_id: string; author: string;
  last_text: string; last_in: boolean; last_at: string | null; customer_at: string | null;
  pending: number; drafted: number; total: number; mode: SocialMode | null; window_open: boolean | null;
};
export type SocialList = { threads: SocialThread[]; comment_mode: 'auto' | 'draft' };

export type SocialItem = {
  id: number; channel: 'instagram' | 'youtube'; kind: 'dm' | 'comment'; thread_id: string; author: string; text: string;
  draft_text: string | null; status: 'pending' | 'sent' | 'rejected' | 'ignored'; auto: boolean; by_owner: boolean;
  hidden: boolean; regen: number; lead_id?: number | null; auto_at: string | null; created_at: string; decided_at: string | null;
};

export type SocialGroup = 'you' | 'bot' | 'theirs';

/** 03 §Q8: cavabsız (gözləyən) hər şey «Sizi gözləyir»; cavablanmış komment postu «Bot aparır»da soluq durur. */
export function socialGroup(t: SocialThread): SocialGroup {
  if (t.pending > 0) return 'you';
  if (t.kind === 'comment' || t.mode === 'bot') return 'bot';
  return t.last_in ? 'you' : 'theirs';
}

/** Inbox yolu: DM `inbox/ig/<thread>`, komment `inbox/komment/<kanal>/<post>`. */
export const socialPath = (t: Pick<SocialThread, 'kind' | 'channel' | 'thread_id'>) =>
  t.kind === 'dm' ? `inbox/ig/${encodeURIComponent(t.thread_id)}` : `inbox/komment/${t.channel}/${encodeURIComponent(t.thread_id)}`;

export const socialName = (t: { author: string; kind: string; channel: string }) =>
  t.author ? `@${t.author}` : t.kind === 'comment' && t.channel === 'youtube' ? 'YouTube izləyicisi' : 'Instagram istifadəçisi';

export const channelLabel = (t: { kind: string; channel: string }) =>
  t.kind === 'dm' ? 'Instagram DM' : t.channel === 'youtube' ? 'YouTube komment' : 'Instagram komment';

export type Kanal = 'hamisi' | 'whatsapp' | 'instagram' | 'komment';
export const KANAL: { value: Kanal; label: string }[] = [
  { value: 'hamisi', label: 'Hamısı' }, { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' }, { value: 'komment', label: 'Komment' },
];
export const inKanal = (t: SocialThread, k: Kanal) => k === 'hamisi' || (k === 'instagram' ? t.kind === 'dm' : k === 'komment' && t.kind === 'comment');
