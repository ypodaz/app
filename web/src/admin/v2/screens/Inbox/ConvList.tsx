import { useEffect, useMemo, useState } from 'react';
import type { Conv } from '../../../components/crm';
import { go } from '../../../router';
import { fmtWait, msOf } from '../../data/time';
import { Avatar, EmptyState, ErrorBox, LoadingRows, V2Icon } from '../../ui';
import { clockOf, effMode, groupOf, phoneLabel, preview, sortGroup, type Group } from './logic';

const nameOf = (c: Conv) => (c.contact.name || '').trim() || phoneLabel(c.contact.phone) || 'Naməlum';
const personal = (c: Conv) => !(c.contact.name || '').trim();

/** Sətirin alt sətri (03 §Q8–Q9, S6). Yalnız serverdə olan sahələrə söykənir. */
function subLine(c: Conv, g: Group, now: number, botOn: boolean): { text: string; tone?: 'warn' | 'brand' } | null {
  if (g !== 'you') return null;
  const e = effMode(c, botOn);
  // TODO [API] ötürmənin başlama vaxtı (wait_since) və səbəb kodu siyahı cavabında yoxdur: gözləmə son mesajdan hesablanır, səbəb göstərilmir.
  if (e === 'wait') return { text: `Komandaya ötürülüb · ${fmtWait(now - msOf(c.last_message_at ?? new Date(now).toISOString()))}`, tone: 'warn' };
  // TODO [API] qaralamanın auto_at (taymer) draft_out/inbox siyahısında yoxdur: «N dəq sonra özü gedəcək» yazıla bilmir.
  if (e === 'owner' && c.pending_drafts > 0) return { text: 'Qaralama hazırdır · siz yazdınız', tone: 'brand' };
  if (personal(c)) return { text: 'Şəxsi kontakt · bot cavab vermədi' };
  return { text: e === 'bot' ? 'Bot söndürülüb · cavab gözləyir' : 'Bot susur · cavab gözləyir' };
}

function Row({ c, g, sel, now, botOn, faded }: { c: Conv; g: Group; sel: boolean; now: number; botOn: boolean; faded?: boolean }) {
  const name = nameOf(c);
  const sub = subLine(c, g, now, botOn);
  const unread = c.unread > 0;
  const time = g === 'you' ? clockOf(c.last_message_at) : c.last_message_at ? fmtWait(now - msOf(c.last_message_at)) : '';
  return (
    <button type="button" className={`ibr${sel ? ' ibr--sel' : ''}${faded ? ' ibr--faded' : ''}`} aria-current={sel ? 'true' : undefined} onClick={() => go(`inbox/${c.id}`)} data-conv={c.id}>
      {personal(c) ? <span className="av" aria-hidden="true"><V2Icon name="user" /></span> : <Avatar name={name} tone={sel ? 'brand' : 'neutral'} large />}
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

type Props = {
  convs: Conv[] | null;
  error: string;
  onRetry: () => void;
  botOn: boolean;
  now: number;
  sel?: number;
  searchRef: React.RefObject<HTMLInputElement>;
  /** Növbəti/əvvəlki üçün görünən sıra çağırana qaytarılır. */
  onOrder: (ids: number[]) => void;
};

/** Siyahı sütunu (02 #1–#9). Kanal filtri və Instagram/komment qrupları: API yoxdur, gizlədilib. */
export function ConvList({ convs, error, onRetry, botOn, now, sel, searchRef, onOrder }: Props) {
  const [more, setMore] = useState(false);
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setQ(raw), 200); return () => window.clearTimeout(t); }, [raw]); // 02: 200 ms gecikmə
  const [mSearch, setMSearch] = useState(false);

  // TODO [API] kanal filtri (WhatsApp · Instagram DM · Komment): Instagram DM/komment üçün admin endpoint yoxdur (yalnız webhook), filtr gizlədilib.
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, '');
    const hit = (c: Conv) => !s || nameOf(c).toLowerCase().includes(s) || (c.contact.name ?? '').toLowerCase().includes(s)
      || (digits.length >= 3 && (c.contact.phone ?? '').replace(/\D/g, '').includes(digits)) || (c.last_message?.text ?? '').toLowerCase().includes(s);
    const by: Record<Group, Conv[]> = { you: [], bot: [], theirs: [] };
    for (const c of convs ?? []) if (hit(c)) by[groupOf(c, botOn)].push(c);
    return { you: sortGroup(by.you, 'you', botOn), bot: sortGroup(by.bot, 'bot', botOn), theirs: sortGroup(by.theirs, 'theirs', botOn) };
  }, [convs, q, botOn]);

  const botShown = more || q.trim() ? groups.bot : groups.bot.slice(0, 2);
  const order = useMemo(() => [...groups.you, ...botShown, ...groups.theirs].map((c) => c.id), [groups, botShown]);
  const orderKey = order.join(',');
  useEffect(() => onOrder(order), [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = convs?.length ?? 0;
  const longest = groups.you.reduce((m, c) => Math.max(m, c.last_message_at ? now - msOf(c.last_message_at) : 0), 0);
  const searching = q.trim().length > 0;
  const none = !!convs && searching && !groups.you.length && !groups.bot.length && !groups.theirs.length;

  return (
    <section className="ib__list" aria-label="Söhbətlər">
      <header className="ib__lh">
        <div className="ib__lt">
          <h1 className="ib__h1">Inbox</h1>
          <p className="ib__sub ib__sub--web">Kim məni gözləyir?</p>
          <p className="ib__sub ib__sub--mob">{convs ? <><b>{groups.you.length}</b> söhbət sizi gözləyir{groups.you.length > 0 && longest >= 60_000 ? <> · ən uzunu <span className="mono">{fmtWait(longest)}</span></> : null}</> : ' '}</p>
        </div>
        <button type="button" className="ib__sbtn" aria-label="Axtar" aria-expanded={mSearch} onClick={() => { setMSearch((v) => !v); window.setTimeout(() => searchRef.current?.focus(), 0); }}><V2Icon name="search" size={20} /></button>
      </header>
      <div className={`ib__search${mSearch || raw ? ' ib__search--open' : ''}`}>
        <V2Icon name="search" size={18} />
        <input ref={searchRef} className="ib__sin" type="search" value={raw} placeholder="Ad və ya mesaj axtar" aria-label="Ad və ya mesaj axtar"
          onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setRaw(''); setQ(''); e.currentTarget.blur(); } }} />
        <kbd className="mono">/</kbd>
      </div>

      <div className="ib__scroll">
        {error && <div className="ib__pad"><ErrorBox title="Söhbətlər yüklənmədi" detail="İnternet bağlantısını yoxlayın" onRetry={onRetry} /></div>}
        {!convs && !error && <LoadingRows rows={7} label="Söhbətlər yüklənir" />}
        {convs && total === 0 && <div className="ib__pad"><EmptyState title="Hələ söhbət yoxdur" reason="Müştəri WhatsApp-dan yazanda burada görünəcək." /></div>}
        {none && (
          <div className="ib__pad"><EmptyState title={`«${q.trim()}» tapılmadı`} reason="Axtarış ad, telefon və mesaj mətnində aparılır." /></div>
          /* TODO [API] «Yeni kontakt yarat» (99 G8): kontakt yaratmaq üçün admin endpoint yoxdur. */
        )}

        {convs && total > 0 && !none && (
          <>
            <h2 className="ibg"><span>Sizi gözləyir</span> <span className="mono ibg__n">{groups.you.length}</span><span className="ibg__keys"><kbd className="mono">J</kbd><kbd className="mono">K</kbd></span></h2>
            {groups.you.length === 0
              ? <div className="ib__pad"><EmptyState title="Heç kim sizi gözləmir" reason={`bot ${groups.bot.length} söhbəti aparır`} /></div>
              : groups.you.map((c) => <Row key={c.id} c={c} g="you" sel={c.id === sel} now={now} botOn={botOn} />)}

            {groups.bot.length > 0 && (
              <>
                <h2 className="ibg"><span>Bot aparır</span> <span className="mono ibg__n">{groups.bot.length}</span><span className="ibg__hint">· özü cavablayır, gecə də</span></h2>
                {botShown.map((c) => <Row key={c.id} c={c} g="bot" sel={c.id === sel} now={now} botOn={botOn} faded />)}
                {!more && groups.bot.length > 2 && !searching && (
                  <button type="button" className="ib__more" onClick={() => setMore(true)}>daha {groups.bot.length - 2}</button>
                )}
                {more && groups.bot.length > 2 && !searching && <button type="button" className="ib__more" onClick={() => setMore(false)}>yığ</button>}
              </>
            )}

            {groups.theirs.length > 0 && (
              <>
                <h2 className="ibg"><span>Müştəridən cavab gözləyirik</span> <span className="mono ibg__n">{groups.theirs.length}</span></h2>
                {groups.theirs.map((c) => <Row key={c.id} c={c} g="theirs" sel={c.id === sel} now={now} botOn={botOn} faded />)}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
