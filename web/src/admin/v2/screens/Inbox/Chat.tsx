import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { stageName, usePoll, type ConvMode, type ConvOpen, type Msg, type Park } from '../../../components/crm';
import { parkOf } from '../../data/queue';
import { errMsg, useAuth, useLoad } from '../../../ctx';
import { bakuParts } from '../../../format';
import { useMedia } from '../../../router';
import { msOf } from '../../data/time';
import { Avatar, ErrorBox, LoadingRows, useOnline, useToast, V2Icon } from '../../ui';
import { BotBar, DraftCard, FreeComposer, NoteComposer, ReplyTabs, SilentBar, type ReplyTab } from './Composer';
import { EventLine, mergeTimeline } from './Events';
import { IbIcon } from './icons';
import { dayLabel, effMode, MODE_META, phoneLabel, typing } from './logic';
import { ModeChip } from './ModeMenu';
import { Side } from './Side';

const UNDO_MS = 5000; // 99 G2

function AudioBtn({ src }: { src: string | null }) {
  const [on, setOn] = useState(false);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { el.current?.pause(); }, []);
  const toggle = () => {
    if (!src) return;
    if (!el.current) { el.current = new Audio(src); el.current.onended = () => setOn(false); el.current.onerror = () => setOn(false); }
    if (on) { el.current.pause(); setOn(false); } else { void el.current.play().then(() => setOn(true)).catch(() => setOn(false)); }
  };
  return (
    <button type="button" className="ibv" aria-label={on ? 'Səsi dayandır' : 'Səsi oxut'} disabled={!src} onClick={toggle}>
      <span className="ibv__b"><IbIcon name={on ? 'pause' : 'play'} size={14} /></span>
      <span className="ibv__w" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ height: 6 + ((i * 7) % 13) }} />)}</span>
    </button>
  );
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === 'out';
  const bot = out && m.source === 'bot';
  const voice = m.type === 'audio' || m.type === 'voice';
  return (
    <div className={`ibm-row${out ? ' ibm-row--out' : ''}`}>
      <div className={`ibmsg${out ? (bot ? ' ibmsg--bot' : ' ibmsg--you') : ''}${m.status === 'failed' ? ' ibmsg--fail' : ''}`}>
        {out && <span className="ibmsg__who">{bot ? 'Bot' : 'Siz'}</span>}
        {voice && <AudioBtn src={m.media_url} />}
        {m.type === 'image' && m.media_url && <a href={m.media_url} target="_blank" rel="noopener noreferrer"><img className="ibmsg__img" src={m.media_url} alt="Şəkil" loading="lazy" /></a>}
        {(m.text || (!voice && m.type !== 'image')) && <span className="ibmsg__t">{m.text || `[${m.type}]`}</span>}
      </div>
      <span className="ibmsg__time mono">{bakuParts(m.created_at).time}{m.status === 'failed' ? ` · getmədi${m.error ? `: ${m.error}` : ''}` : ''}</span>
    </div>
  );
}

type Props = { id: number; botOn: boolean; onChanged: () => void; onBack: () => void };

/** Söhbət sütunu + İnsan paneli (02 #10–#33, #47–#55). Instagram DM/komment: API yoxdur. */
export function Chat({ id, botOn, onChanged, onBack }: Props) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const conv = useLoad<ConvOpen>(`/inbox/${id}`);
  usePoll(conv.reload, 10_000);
  const data = conv.data?.id === id ? conv.data : null;

  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false); // ⋯ menyusu
  const moreRef = useRef<HTMLDivElement>(null);
  const [modeOv, setModeOv] = useState<ConvMode | null>(null);
  const [exclOv, setExclOv] = useState<boolean | null>(null);
  const [parkOv, setParkOv] = useState<Park['to'] | null | undefined>(undefined); // undefined: serverdəki kimi
  const [writing, setWriting] = useState(false); // «Cavabı mən yazım»
  const [busy, setBusy] = useState(false);
  const [hiddenDraft, setHiddenDraft] = useState<number | null>(null); // 5 s gecikmədə gizlədilən qaralama
  const [sendErr, setSendErr] = useState('');
  const [tabSel, setTab] = useState<ReplyTab>('reply'); // «Cavab | Daxili qeyd» (02 #19), yalnız kompüterdə
  const [noteBusy, setNoteBusy] = useState(false);
  const mobile = useMedia('(max-width: 767px)');
  const endRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  // Açanda server oxunmamışı sıfırlayır: siyahı gözləməsin.
  const loaded = !!data;
  useEffect(() => { if (loaded) onChanged(); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setModeOv(null); setExclOv(null); }, [data?.mode, data?.contact.excluded]);
  useEffect(() => { setWriting(false); setHiddenDraft(null); setSendErr(''); setTab('reply'); }, [id]);
  const n = (data?.messages.length ?? 0) + (data?.thread_events?.length ?? 0);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [n, id, loaded]);

  const refresh = useCallback(() => { conv.reload(); onChanged(); }, [conv, onChanged]);
  const excluded = exclOv ?? data?.contact.excluded ?? false;
  const mode = data ? effMode({ mode: modeOv ?? data.mode, contact: { excluded } }, botOn) : 'bot';
  const draft = data ? [...data.drafts].filter((d) => d.status === 'pending' && d.id !== hiddenDraft).pop() : undefined;
  const lastMsg = data?.messages[data.messages.length - 1] ?? null;
  const parked = parkOv !== undefined ? parkOv : data ? parkOf({ park: data.park, pending_drafts: data.drafts.filter((d) => d.status === 'pending').length,
    last_message: lastMsg, last_message_at: lastMsg?.created_at ?? null }) : null;

  useEffect(() => {
    if (!more) return;
    const onDown = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [more]);

  /** «Oxunmamış et»: söhbət açıq qalsa GET yenə oxunmuş edərdi, ona görə siyahıya çıxırıq. */
  async function markUnread() {
    setMore(false);
    try {
      await call(`/inbox/${id}/unread`, { method: 'POST' });
      onChanged();
      onBack();
    } catch (e) {
      toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void markUnread() });
    }
  }

  async function apiMode(m: ConvMode) { await call(`/inbox/${id}/mode`, { method: 'POST', body: { mode: m } }); }

  async function pickMode(m: ConvMode) {
    if (!data) return;
    const prev = modeOv ?? data.mode;
    setModeOv(m);
    try {
      await apiMode(m);
      refresh();
      toast.show(`Rejim: ${MODE_META[m].label}`, { undo: () => { setModeOv(prev); void apiMode(prev).then(refresh); } });
    } catch (e) {
      setModeOv(null);
      toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void pickMode(m) });
    }
  }

  async function setFriend(v: boolean) {
    if (!data) return;
    const prevMode = modeOv ?? data.mode;
    setExclOv(v);
    try {
      await call(`/contacts/${data.contact.id}/exclude`, { method: 'POST', body: { excluded: v } });
      // «Bot yazsın» / dost açarı bağlandı → Bot aparır (03 T10).
      if (!v && prevMode === 'human') { setModeOv('bot'); await apiMode('bot'); }
      refresh();
      toast.show(v ? 'Dostdur · bot yazmır' : 'Bot yenə yazır');
    } catch (e) {
      setExclOv(null); setModeOv(null);
      toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void setFriend(v) });
    }
  }

  /** «Cavab gözləyirəm» / «Arxivə at» / «Geri qaytar»: söhbət «Sizi gözləyir»dən çıxır, müştəriyə heç nə getmir. */
  async function park(to: Park['to'] | null) {
    const prev = parked;
    setParkOv(to);
    try {
      await call(`/inbox/${id}/park`, { method: 'POST', body: { to } });
      if (to && (modeOv ?? data?.mode) === 'wait') setModeOv('owner');
      refresh();
      const msg = to === 'theirs' ? '«Müştəridən cavab gözləyirik»ə keçdi' : to === 'archive' ? 'Arxivə atıldı · müştəri yazanda geri qayıdır' : 'Geri qaytarıldı';
      toast.show(msg, to ? { undo: () => { setParkOv(prev); void call(`/inbox/${id}/park`, { method: 'POST', body: { to: prev } }).then(refresh); } } : undefined);
    } catch (e) {
      setParkOv(undefined);
      toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void park(to) });
    }
  }

  /** «Daxili qeyd»: müştəriyə getmir, rejim və qaralama dəyişmir; İnsan kartının tarixçəsinə də düşür. */
  async function saveNote(text: string): Promise<boolean> {
    setNoteBusy(true);
    try {
      await call(`/inbox/${id}/note`, { method: 'POST', body: { text } });
      refresh();
      toast.show('Qeyd yazıldı · müştəriyə getmir');
      return true;
    } catch (e) { toast.show(`Alınmadı: ${errMsg(e)}`, { error: true }); return false; } finally { setNoteBusy(false); }
  }

  async function sendFree(text: string): Promise<boolean> {
    setBusy(true); setSendErr('');
    try {
      await call(`/inbox/${id}/send`, { method: 'POST', body: { text } });
      if (mode === 'bot') toast.show('Siz yazdınız · bot indi yalnız qaralama hazırlayır');
      setWriting(false);
      refresh();
      return true;
    } catch (e) { setSendErr(errMsg(e)); return false; } finally { setBusy(false); }
  }

  /** Qaralama: 5 s gecikmə, «Geri al» (99 G2). Müştəriyə mesaj getdiyi üçün xəta olsa kart qayıdır. */
  function sendDraft(text: string, edited: boolean) {
    if (!draft) return;
    const dId = draft.id;
    setHiddenDraft(dId);
    const run = async () => {
      try {
        await call(`/drafts/${dId}/send`, { method: 'POST', body: edited ? { text } : undefined });
        refresh();
      } catch (e) {
        setHiddenDraft(null);
        toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => { setHiddenDraft(dId); void run(); } });
      }
    };
    const t = window.setTimeout(() => { void run(); }, UNDO_MS);
    timers.current.push(t);
    toast.show('Göndərildi · söhbəti yenə bot aparır', { undo: () => { window.clearTimeout(t); setHiddenDraft(null); } });
  }

  async function reject() {
    if (!draft) return;
    try { await call(`/drafts/${draft.id}/reject`, { method: 'POST' }); refresh(); }
    catch (e) { toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void reject() }); }
  }

  // E: «Cavabı mən yazım»; ↵: qaralamanı göndər (fokus mətn sahəsində/düymədə deyilsə, 02 Q4).
  const keyRef = useRef<(e: KeyboardEvent) => void>();
  keyRef.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || (e.target instanceof HTMLElement && /^(BUTTON|A)$/.test(e.target.tagName))) return;
    if ((e.key === 'e' || e.key === 'E') && data && !draft && mode === 'bot' && !writing && online) { e.preventDefault(); setWriting(true); }
    if (e.key === 'Enter' && draft && data?.window_open && online) { e.preventDefault(); sendDraft(draft.text, false); }
  };
  useEffect(() => { const on = (e: KeyboardEvent) => keyRef.current?.(e); window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on); }, []);

  const humanHref = data?.client ? `#/insanlar/${data.client.id}` : data?.lead ? `#/insanlar/lead-${data.lead.id}` : '';
  const head = (
    <header className="ibh">
      <button type="button" className="ibh__back" aria-label="Geri" onClick={onBack}><V2Icon name="back" size={20} /></button>
      {data ? (
        <>
          {(data.contact.name || '').trim() ? <Avatar name={(data.contact.name || '').trim()} tone="brand" large /> : <span className="av av--lg" aria-hidden="true"><V2Icon name="user" /></span>}
          <div className="ibh__id">
            <h2 className="ibh__name">{(data.contact.name || '').trim() || phoneLabel(data.contact.phone)}</h2>
            <p className="ibh__meta">{(data.contact.name || '').trim() && <span className="ibh__ph"><span className="mono">{phoneLabel(data.contact.phone)}</span> · </span>}WhatsApp{data.lead && <span className="ibh__lead"> · lead · {stageName(data.lead.stage)}</span>}</p>
          </div>
          <ModeChip current={mode} friend={excluded} open={menu} setOpen={setMenu} disabled={!online} onPick={(m) => void pickMode(m)} />
          <div className="ibm ibm--more" ref={moreRef}>
            <button type="button" className="ibh__more" aria-haspopup="menu" aria-expanded={more} aria-label="Daha çox" disabled={!online} onClick={() => setMore(!more)}><IbIcon name="more" size={18} /></button>
            {more && (
              <div className="ibm__pop ibm__pop--sm">
                <div role="menu" aria-label="Daha çox" className="ibm__list">
                  {humanHref && <a role="menuitem" className="ibm__item" href={humanHref} onClick={() => setMore(false)}><span className="ibm__t">İnsan kartını aç</span></a>}
                  <button type="button" role="menuitem" className="ibm__item" onClick={() => void markUnread()}><span className="ibm__t">Oxunmamış et</span></button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : <span className="ibh__name">Söhbət</span>}
    </header>
  );

  if (!data) {
    return (
      <section className="ib__chat" aria-label="Söhbət">
        {head}
        {conv.err ? <div className="ib__pad"><ErrorBox title="Söhbət yüklənmədi" detail={conv.err} onRetry={conv.reload} /></div> : <LoadingRows rows={4} label="Söhbət yüklənir" />}
      </section>
    );
  }

  const meta = MODE_META[mode];
  const last = data.messages[data.messages.length - 1];
  const sinceMin = last && last.direction === 'in' ? Math.max(1, Math.round((Date.now() - new Date(last.created_at).getTime()) / 60_000)) : 0;
  const reason = mode === 'wait' ? [...data.drafts].reverse().find((d) => d.model_output?.handoff_reason)?.model_output?.handoff_reason : null;
  const tevents = data.thread_events ?? [];
  const reasonLogged = tevents.some((e) => e.meta?.code === 'handoff_reason'); // yeni söhbətlərdə səbəb sistem sətridir
  // TODO [API] «Bot yazır» göstəricisi: bot cavab hazırlayarkən vəziyyət serverdə açıq deyil, gizlədilib.
  const noteTab = tabSel === 'note' && !mobile;
  const showFree = !draft && (mode !== 'bot' || writing);
  const timeline = mergeTimeline(data.messages, (m) => m.created_at, tevents);

  return (
    <div className="ib__cw">
      <section className="ib__chat" aria-label="Söhbət">
        {head}
        <div className={`ibs ibs--${parked ? 'park' : mode}`}>
          <span className="ibs__txt" role="status">
            {parked
              ? <><b>{parked === 'archive' ? 'Arxivdə' : 'Müştəridən cavab gözləyirik'}</b><span> · müştəri yazanda «Sizi gözləyir»ə qayıdır</span></>
              : <><b>{meta.label}</b><span> · {meta.hint}</span>{mode === 'bot' && sinceMin > 0 && <span> · müştəri <span className="mono">{sinceMin}</span> dəq əvvəl yazdı</span>}
                {!botOn && data.mode === 'bot' && !excluded && <span className="ibs__x"> · Bot söndürülüb: bütün mesajlar sizə düşür</span>}</>}
          </span>
          {!excluded && (
            <span className="ibs__acts">
              {parked
                ? <button type="button" className="ibs__btn" onClick={() => void park(null)}>Geri qaytar</button>
                : <>
                  <button type="button" className="ibs__btn" title="Zənglə danışdınız və ya cavab gözləyirsiniz" onClick={() => void park('theirs')}>Cavab gözləyirəm</button>
                  <button type="button" className="ibs__btn" title="Söhbət bitib: siyahıdan gizlənir" onClick={() => void park('archive')}>Arxivə at</button>
                </>}
            </span>
          )}
        </div>
        {!data.window_open && <div className="ib__warn" role="status">24 saat keçib · müştəri yazmayınca sərbəst mətn göndərilmir</div>}
        <div className="ibt" tabIndex={-1}>
          {timeline.length === 0 && <p className="ibt__empty">Hələ mesaj yoxdur</p>}
          {timeline.map((r, i) => {
            const day = dayLabel(r.at);
            const prev = timeline[i - 1];
            return (
              <Fragment key={r.t === 'm' ? `m${r.m.id}` : `e${r.e.id}`}>
                {(!prev || dayLabel(prev.at) !== day) && <div className="ibt__day">{day}</div>}
                {r.t === 'm' ? <Bubble m={r.m} /> : <EventLine e={r.e} />}
              </Fragment>
            );
          })}
          {reason && !reasonLogged && <div className="ibt__sys ibt__sys--why">Bot niyə ötürdü: {reason}</div>}
          <div ref={endRef} />
        </div>
        <div className="ibf-wrap">
          {!mobile && <ReplyTabs value={tabSel} onChange={setTab} />}
          {noteTab && <NoteComposer online={online} busy={noteBusy} onSave={saveNote} />}
          {!noteTab && <>
          {sendErr && <ErrorBox title="Mesaj getmədi" detail={sendErr} />}
          {mode === 'human' && <SilentBar friend={excluded} disabled={!online} onFriend={(v) => void setFriend(v)} onBot={() => void setFriend(false)} />}
          {draft && <DraftCard draft={draft} mode={mode} windowOpen={data.window_open} online={online} onSend={sendDraft} onReject={() => void reject()}
            note={draft.auto_at && mode === 'owner' && msOf(draft.auto_at) > Date.now() ? `${Math.ceil((msOf(draft.auto_at) - Date.now()) / 60_000)} dəq sonra bot özü göndərəcək` : undefined} />}
          {mode === 'bot' && !draft && !writing && <BotBar friend={excluded} disabled={!online} onFriend={(v) => void setFriend(v)} onWrite={() => setWriting(true)} />}
          {showFree && <FreeComposer autoFocus={writing} windowOpen={data.window_open} online={online} busy={busy} onSend={sendFree} />}
          </>}
        </div>
      </section>
      <Side data={data} mode={mode} />
    </div>
  );
}
