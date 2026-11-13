import { useEffect, useMemo, useState } from 'react';
import type { Conv } from '../../../components/crm';
import { go } from '../../../router';
import { channelLabel, inKanal, KANAL, socialGroup, socialName, socialPath, type Kanal, type SocialThread } from '../../data/social';
import { fmtWait, msOf } from '../../data/time';
import { Avatar, EmptyState, ErrorBox, LoadingRows, Segmented, V2Icon } from '../../ui';
import { IbIcon } from './icons';
import { clockOf, effMode, groupOf, phoneLabel, preview, rank, sortGroup, type Group } from './logic';

const nameOf = (c: Conv) => (c.contact.name || '').trim() || phoneLabel(c.contact.phone) || 'Naməlum';
const personal = (c: Conv) => !(c.contact.name || '').trim();

/** Sətirin alt sətri (03 §Q8–Q9, S6). Yalnız serverdə olan sahələrə söykənir. */
function subLine(c: Conv, g: Group, now: number, botOn: boolean): { text: string; tone?: 'warn' | 'brand' } | null {
  if (g !== 'you') return null;
  const e = effMode(c, botOn);
  // Səbəb kodu siyahıda yoxdur; gözləmə ötürmə anından (wait_since), yoxdursa son mesajdan hesablanır.
  if (e === 'wait') return { text: `Komandaya ötürülüb · ${fmtWait(now - msOf(c.wait_since ?? c.last_message_at ?? new Date(now).toISOString()))}`, tone: 'warn' };
  if (e === 'owner' && c.pending_drafts > 0) {
    const min = c.draft_auto_at ? Math.ceil((msOf(c.draft_auto_at) - now) / 60_000) : 0;
    return { text: min > 0 ? `${min} dəq sonra bot özü göndərəcək` : 'Qaralama hazırdır · siz yazdınız', tone: 'brand' };
  }
  if (personal(c)) return { text: 'Şəxsi kontakt · bot cavab vermədi' };
  return { text: e === 'bot' ? 'Bot söndürülüb · cavab gözləyir' : 'Bot susur · cavab gözləyir' };
}

const CH = { wa: 'WhatsApp', ig: 'Instagram', yt: 'YouTube' } as const;

/** Avatar + sağ-alt küncdə kanal nişanı: mesajın haradan gəldiyi bilinsin (FableInbox). */
function ChAvatar({ ch, children }: { ch: keyof typeof CH; children: React.ReactNode }) {
  return (
    <span className="ibr__avw">
      {children}
      <span className={`ibr__ch ibr__ch--${ch}`} role="img" aria-label={CH[ch]} title={CH[ch]}><IbIcon name={ch} size={10} sw={2} /></span>
    </span>
  );
}

function Row({ c, g, sel, now, botOn, faded }: { c: Conv; g: Group; sel: boolean; now: number; botOn: boolean; faded?: boolean }) {
  const name = nameOf(c);
  const sub = subLine(c, g, now, botOn);
  const unread = c.unread > 0;
  const time = g === 'you' ? clockOf(c.last_message_at) : c.last_message_at ? fmtWait(now - msOf(c.last_message_at)) : '';
  return (
    <button type="button" className={`ibr${sel ? ' ibr--sel' : ''}${faded ? ' ibr--faded' : ''}`} aria-current={sel ? 'true' : undefined} onClick={() => go(`inbox/${c.id}`)} data-conv={c.id}>
      <ChAvatar ch="wa">{personal(c) ? <span className="av av--lg" aria-hidden="true"><V2Icon name="user" /></span> : <Avatar name={name} tone={sel ? 'brand' : 'neutral'} large />}</ChAvatar>
      <span className="ibr__main">
        <span className="ibr__top">
          <span className={`ibr__name${unread ? ' ibr__name--unread' : ''}${personal(c) ? ' mono' : ''}`}>{name}</span>
          {unread && <span className="ibr__dot" role="img" aria-label="Oxunmamış" />}
          <span className="ibr__time mono">{time}</span>
        </span>
        <span className="ibr__msg">{preview(c.last_message)}</span>
        {sub && <span className={`ibr__sub${sub.tone ? ` ibr__sub--${sub.tone}` : ''}`}>{sub.text}</span>}
      </span>
      <V2Icon name="chev" size={16} className="ibr__go" />
    </button>
  );
}

/** Instagram DM / komment sətrinin alt sətri (02 «Komment · qaralama rejimi»). */
function socialSub(t: SocialThread, commentMode: 'auto' | 'draft' | undefined): { text: string; tone?: 'warn' | 'brand' } {
  const ch = channelLabel(t);
  if (t.kind === 'comment') {
    if (!t.pending) return { text: `${ch} · cavablanıb` };
    const n = t.pending > 1 ? ` · ${t.pending} gözləyən` : '';
    return t.drafted ? { text: `${ch} · qaralama hazırdır${n}`, tone: 'brand' } : { text: `${ch} · ${commentMode === 'draft' ? 'qaralama rejimi' : 'cavabsız'}${n}` };
  }
  if (t.mode === 'wait') return { text: `${ch} · komandaya ötürülüb`, tone: 'warn' };
  if (t.drafted) return { text: `${ch} · qaralama hazırdır`, tone: 'brand' };
  if (t.pending || t.last_in) return { text: `${ch} · cavab gözləyir` };
  return { text: t.mode === 'bot' ? `${ch} · bot aparır` : ch };
}

function SocialRow({ t, g, sel, now, faded, commentMode }: { t: SocialThread; g: Group; sel: boolean; now: number; faded?: boolean; commentMode?: 'auto' | 'draft' }) {
  const sub = socialSub(t, commentMode);
  const at = g === 'you' ? t.customer_at : t.last_at;
  const time = g === 'you' ? clockOf(at) : at ? fmtWait(now - msOf(at)) : '';
  const tag = t.channel === 'youtube' ? 'YouTube' : t.kind === 'comment' ? 'Komment' : 'Instagram';
  return (
    <button type="button" className={`ibr${sel ? ' ibr--sel' : ''}${faded ? ' ibr--faded' : ''}`} aria-current={sel ? 'true' : undefined} onClick={() => go(socialPath(t))}>
      <ChAvatar ch={t.channel === 'youtube' ? 'yt' : 'ig'}><Avatar name={t.author || tag} tone={sel ? 'brand' : 'neutral'} large /></ChAvatar>
      <span className="ibr__main">
        <span className="ibr__top">
          <span className={`ibr__name${g === 'you' ? ' ibr__name--unread' : ''}`}>{socialName(t)}</span>
          <span className="ibr__tag">{tag}</span>
          <span className="ibr__time mono">{time}</span>
        </span>
        <span className="ibr__msg">{t.kind === 'comment' ? `«${t.last_text}»` : t.last_text}</span>
        {(g === 'you' || t.kind === 'comment') && <span className={`ibr__sub${sub.tone ? ` ibr__sub--${sub.tone}` : ''}`}>{sub.text}</span>}
      </span>
      <V2Icon name="chev" size={16} className="ibr__go" />
    </button>
  );
}

type Entry = { t: 'wa'; c: Conv; path: string; at: string | null } | { t: 'so'; s: SocialThread; path: string; at: string | null };

type Props = {
  convs: Conv[] | null;
  social?: SocialThread[];
  commentMode?: 'auto' | 'draft';
  kanal: Kanal;
  onKanal: (k: Kanal) => void;
  error: string;
  onRetry: () => void;
  botOn: boolean;
  now: number;
  /** Açıq söhbətin yolu (`inbox/12`, `inbox/ig/…`). */
  sel?: string;
  searchRef: React.RefObject<HTMLInputElement>;
  /** Növbəti/əvvəlki üçün görünən sıra (yollar) çağırana qaytarılır. */
  onOrder: (paths: string[]) => void;
};

const CLOSED_KEY = 'ypod.v2.inbox.closed';
type Closed = Record<Group, boolean>;
// «Dostlar» və «Arxiv» standart yığılıdır (sahibkar açmayınca görünmür)
const readClosed = (): Closed => {
  try {
    const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '{}');
    return { you: !!v.you, bot: !!v.bot, theirs: !!v.theirs, friends: v.friends !== false, archive: v.archive !== false };
  } catch { return { you: false, bot: false, theirs: false, friends: true, archive: true }; }
};
const ALL_OPEN: Closed = { you: false, bot: false, theirs: false, friends: false, archive: false };

/** Bölmə başlığı: basanda yığılır/açılır, seçim bu brauzerdə yadda qalır. */
function GroupHead({ g, label, n, closed, onToggle, children }: { g: Group; label: string; n: number; closed: boolean; onToggle: (g: Group) => void; children?: React.ReactNode }) {
  return (
    <h2 className="ibg">
      <button type="button" className="ibg__tog" aria-expanded={!closed} onClick={() => onToggle(g)}>
        <span className={`ibg__chev${closed ? ' is-closed' : ''}`} aria-hidden="true"><IbIcon name="chevDown" size={14} /></span>
        <span>{label}</span> <span className="mono ibg__n">{n}</span>
      </button>
      {!closed && children}
    </h2>
  );
}

const byTimeDesc = (a: Entry, b: Entry) => (b.at ?? '').localeCompare(a.at ?? '');

/** Siyahı sütunu (02 #1–#9): WhatsApp + Instagram DM + Instagram/YouTube kommentləri, kanal filtri ilə. */
export function ConvList({ convs, social, commentMode, kanal, onKanal, error, onRetry, botOn, now, sel, searchRef, onOrder }: Props) {
  const [more, setMore] = useState(false);
  const [closedSt, setClosed] = useState<Closed>(readClosed);
  const toggle = (g: Group) => setClosed((c) => { const n = { ...c, [g]: !c[g] }; try { localStorage.setItem(CLOSED_KEY, JSON.stringify(n)); } catch { /* yaddaş bağlıdır */ } return n; });
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setQ(raw), 200); return () => window.clearTimeout(t); }, [raw]); // 02: 200 ms gecikmə
  const [mSearch, setMSearch] = useState(false);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, '');
    const hit = (c: Conv) => !s || nameOf(c).toLowerCase().includes(s) || (c.contact.name ?? '').toLowerCase().includes(s)
      || (digits.length >= 3 && (c.contact.phone ?? '').replace(/\D/g, '').includes(digits)) || (c.last_message?.text ?? '').toLowerCase().includes(s);
    const hitS = (t: SocialThread) => !s || t.author.toLowerCase().includes(s.replace(/^@/, '')) || t.last_text.toLowerCase().includes(s);
    const wa: Record<Group, Conv[]> = { you: [], bot: [], theirs: [], friends: [], archive: [] };
    if (kanal === 'hamisi' || kanal === 'whatsapp') for (const c of convs ?? []) if (hit(c)) wa[groupOf(c, botOn)].push(c);
    const so: Record<Group, Entry[]> = { you: [], bot: [], theirs: [], friends: [], archive: [] };
    for (const t of social ?? []) {
      if (!inKanal(t, kanal) || !hitS(t)) continue;
      const g = socialGroup(t);
      so[g].push({ t: 'so', s: t, path: socialPath(t), at: g === 'you' ? t.customer_at : t.last_at });
    }
    const waE = (c: Conv): Entry => ({ t: 'wa', c, path: `inbox/${c.id}`, at: c.last_message_at });
    // «Sizi gözləyir» (03 §Q8): ötürülən və qaralamalı WhatsApp → Instagram (ən çox gözləyən əvvəl) → qalan WhatsApp
    const youWa = sortGroup(wa.you, 'you', botOn);
    const you = [...youWa.filter((c) => rank(c, botOn) < 2).map(waE), ...so.you.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')),
      ...youWa.filter((c) => rank(c, botOn) >= 2).map(waE)];
    return {
      you,
      bot: [...wa.bot.map(waE), ...so.bot].sort(byTimeDesc),
      theirs: [...wa.theirs.map(waE), ...so.theirs].sort(byTimeDesc),
      friends: [...wa.friends.map(waE), ...so.friends].sort(byTimeDesc),
      archive: [...wa.archive.map(waE), ...so.archive].sort(byTimeDesc),
    };
  }, [convs, social, kanal, q, botOn]);

  // Axtarışda bütün bölmələr açıq görünür (tapılan gizli qalmasın)
  const closed: Closed = q.trim() ? ALL_OPEN : closedSt;
  const botShown = more || q.trim() ? groups.bot : groups.bot.slice(0, 2);
  const order = useMemo(() => [...(closed.you ? [] : groups.you), ...(closed.bot ? [] : botShown), ...(closed.theirs ? [] : groups.theirs),
    ...(closed.friends ? [] : groups.friends), ...(closed.archive ? [] : groups.archive)].map((e) => e.path),
  [groups, botShown, closed]);
  const orderKey = order.join(',');
  useEffect(() => onOrder(order), [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = !!convs;
  const total = (convs?.length ?? 0) + (social?.length ?? 0);
  const longest = groups.you.reduce((m, e) => Math.max(m, e.at ? now - msOf(e.at) : 0), 0);
  const searching = q.trim().length > 0;
  const empty = !groups.you.length && !groups.bot.length && !groups.theirs.length && !groups.friends.length && !groups.archive.length;
  const none = loaded && searching && empty;
  const pendingComments = (social ?? []).filter((t) => t.kind === 'comment').reduce((n, t) => n + t.pending, 0);
  const row = (e: Entry, g: Group, faded?: boolean) => e.t === 'wa'
    ? <Row key={e.path} c={e.c} g={g} sel={e.path === sel} now={now} botOn={botOn} faded={faded} />
    : <SocialRow key={e.path} t={e.s} g={g} sel={e.path === sel} now={now} faded={faded} commentMode={commentMode} />;

  return (
    <section className="ib__list" aria-label="Söhbətlər">
      <header className="ib__lh">
        <div className="ib__lt">
          <h1 className="ib__h1">Inbox</h1>
          <p className="ib__sub ib__sub--web">Kim məni gözləyir?</p>
          <p className="ib__sub ib__sub--mob">{loaded ? <><b>{groups.you.length}</b> söhbət sizi gözləyir{groups.you.length > 0 && longest >= 60_000 ? <> · ən uzunu <span className="mono">{fmtWait(longest)}</span></> : null}</> : ' '}</p>
        </div>
        <button type="button" className="ib__sbtn" aria-label="Axtar" aria-expanded={mSearch} onClick={() => { setMSearch((v) => !v); window.setTimeout(() => searchRef.current?.focus(), 0); }}><V2Icon name="search" size={20} /></button>
      </header>
      <div className={`ib__search${mSearch || raw ? ' ib__search--open' : ''}`}>
        <V2Icon name="search" size={18} />
        <input ref={searchRef} className="ib__sin" type="search" value={raw} placeholder="Ad və ya mesaj axtar" aria-label="Ad və ya mesaj axtar"
          onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setRaw(''); setQ(''); e.currentTarget.blur(); } }} />
        <kbd className="mono">/</kbd>
      </div>
      <div className="ib__kanal">
        <Segmented label="Kanal" value={kanal} onChange={onKanal}
          options={KANAL.map((k) => (k.value === 'komment' && pendingComments > 0 ? { ...k, count: pendingComments } : k))} />
      </div>

      <div className="ib__scroll">
        {error && <div className="ib__pad"><ErrorBox title="Söhbətlər yüklənmədi" detail="İnternet bağlantısını yoxlayın" onRetry={onRetry} /></div>}
        {!loaded && !error && <LoadingRows rows={7} label="Söhbətlər yüklənir" />}
        {loaded && total === 0 && <div className="ib__pad"><EmptyState title="Hələ söhbət yoxdur" reason="Müştəri WhatsApp və ya Instagram-dan yazanda burada görünəcək." /></div>}
        {loaded && total > 0 && !searching && empty && <div className="ib__pad"><EmptyState title="Bu kanalda söhbət yoxdur" reason="Başqa kanal seçin." /></div>}
        {none && (
          <div className="ib__pad"><EmptyState title={`«${q.trim()}» tapılmadı`} reason="Axtarış ad, telefon, Instagram adı və mesaj mətnində aparılır." /></div>
          /* TODO [API] «Yeni kontakt yarat» (99 G8): kontakt yaratmaq üçün admin endpoint yoxdur. */
        )}

        {loaded && !empty && (
          <>
            <GroupHead g="you" label="Sizi gözləyir" n={groups.you.length} closed={closed.you} onToggle={toggle}>
              <span className="ibg__keys"><kbd className="mono">J</kbd><kbd className="mono">K</kbd></span>
            </GroupHead>
            {closed.you ? null : groups.you.length === 0
              ? <div className="ib__pad"><EmptyState title="Heç kim sizi gözləmir" reason={`bot ${groups.bot.length} söhbəti aparır`} /></div>
              : groups.you.map((e) => row(e, 'you'))}

            {groups.bot.length > 0 && (
              <>
                <GroupHead g="bot" label="Bot aparır" n={groups.bot.length} closed={closed.bot} onToggle={toggle}>
                  <span className="ibg__hint">· özü cavablayır, gecə də</span>
                </GroupHead>
                {!closed.bot && <>
                  {botShown.map((e) => row(e, 'bot', true))}
                  {!more && groups.bot.length > 2 && !searching && (
                    <button type="button" className="ib__more" onClick={() => setMore(true)}>daha {groups.bot.length - 2}</button>
                  )}
                  {more && groups.bot.length > 2 && !searching && <button type="button" className="ib__more" onClick={() => setMore(false)}>yığ</button>}
                </>}
              </>
            )}

            {groups.theirs.length > 0 && (
              <>
                <GroupHead g="theirs" label="Müştəridən cavab gözləyirik" n={groups.theirs.length} closed={closed.theirs} onToggle={toggle} />
                {!closed.theirs && groups.theirs.map((e) => row(e, 'theirs', true))}
              </>
            )}

            {groups.friends.length > 0 && (
              <>
                <GroupHead g="friends" label="Dostlar" n={groups.friends.length} closed={closed.friends} onToggle={toggle}>
                  <span className="ibg__hint">· bot yazmır</span>
                </GroupHead>
                {!closed.friends && groups.friends.map((e) => row(e, 'friends', true))}
              </>
            )}

            {groups.archive.length > 0 && (
              <>
                <GroupHead g="archive" label="Arxiv" n={groups.archive.length} closed={closed.archive} onToggle={toggle}>
                  <span className="ibg__hint">· müştəri yazanda geri qayıdır</span>
                </GroupHead>
                {!closed.archive && groups.archive.map((e) => row(e, 'archive', true))}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
