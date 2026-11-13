import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { stageName, usePoll, type ConvMode, type ConvOpen, type Msg } from '../../../components/crm';
import { errMsg, useAuth, useLoad } from '../../../ctx';
import { bakuParts } from '../../../format';
import { Avatar, ErrorBox, LoadingRows, useOnline, useToast, V2Icon } from '../../ui';
import { BotBar, DraftCard, FreeComposer, SilentBar } from './Composer';
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
  const [modeOv, setModeOv] = useState<ConvMode | null>(null);
  const [exclOv, setExclOv] = useState<boolean | null>(null);
  const [writing, setWriting] = useState(false); // «Cavabı mən yazım»
  const [busy, setBusy] = useState(false);
  const [hiddenDraft, setHiddenDraft] = useState<number | null>(null); // 5 s gecikmədə gizlədilən qaralama
  const [sendErr, setSendErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  // Açanda server oxunmamışı sıfırlayır: siyahı gözləməsin.
  const loaded = !!data;
  useEffect(() => { if (loaded) onChanged(); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setModeOv(null); setExclOv(null); }, [data?.mode, data?.contact.excluded]);
  useEffect(() => { setWriting(false); setHiddenDraft(null); setSendErr(''); }, [id]);
  const n = data?.messages.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [n, id, loaded]);

  const refresh = useCallback(() => { conv.reload(); onChanged(); }, [conv, onChanged]);
  const excluded = exclOv ?? data?.contact.excluded ?? false;
  const mode = data ? effMode({ mode: modeOv ?? data.mode, contact: { excluded } }, botOn) : 'bot';
  const draft = data ? [...data.drafts].filter((d) => d.status === 'pending' && d.id !== hiddenDraft).pop() : undefined;

  async function apiMode(m: 'bot' | 'human') { await call(`/inbox/${id}/mode`, { method: 'POST', body: { mode: m } }); }

  async function pickMode(m: ConvMode) {
    if (!data || (m !== 'bot' && m !== 'human')) return;
    const prev = modeOv ?? data.mode;
    setModeOv(m);
    try {
      await apiMode(m);
      refresh();
      toast.show(`Rejim: ${MODE_META[m].label}`, prev === 'bot' || prev === 'human' ? { undo: () => { setModeOv(prev); void apiMode(prev as 'bot' | 'human').then(refresh); } } : undefined);
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
          {/* TODO [API] «Daha çox» (⋯) menyusu: «İnsan kartını aç» (kontaktdan müştəri id-si yoxdur), «Oxunmamış et» (endpoint yoxdur). */}
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
  // TODO [API] sistem sətirləri (ötürmə vaxtı, «Xatırlatma göndərildi», «Bot özü göndərdi», rejim dəyişikliyi) mesaj siyahısında yoxdur; səbəb yalnız qaralamanın handoff_reason sahəsindən göstərilir.
  // TODO [API] «Bot yazır» göstəricisi və «Daxili qeyd» (tablar, İnsan kartına yazılması): endpoint yoxdur, gizlədilib.
  const showFree = !draft && (mode !== 'bot' || writing);

  return (
    <div className="ib__cw">
      <section className="ib__chat" aria-label="Söhbət">
        {head}
        <div className={`ibs ibs--${mode}`} role="status">
          <b>{meta.label}</b><span> · {meta.hint}</span>{mode === 'bot' && sinceMin > 0 && <span> · müştəri <span className="mono">{sinceMin}</span> dəq əvvəl yazdı</span>}
          {!botOn && data.mode === 'bot' && !excluded && <span className="ibs__x"> · Bot söndürülüb: bütün mesajlar sizə düşür</span>}
        </div>
        {!data.window_open && <div className="ib__warn" role="status">24 saat keçib · müştəri yazmayınca sərbəst mətn göndərilmir</div>}
        <div className="ibt" tabIndex={-1}>
          {data.messages.length === 0 && <p className="ibt__empty">Hələ mesaj yoxdur</p>}
          {data.messages.map((m, i) => {
            const day = dayLabel(m.created_at);
            const prev = data.messages[i - 1];
            return (
              <Fragment key={m.id}>
                {(!prev || dayLabel(prev.created_at) !== day) && <div className="ibt__day">{day}</div>}
                <Bubble m={m} />
              </Fragment>
            );
          })}
          {reason && <div className="ibt__sys ibt__sys--why">Bot niyə ötürdü: {reason}</div>}
          <div ref={endRef} />
        </div>
        <div className="ibf-wrap">
          {sendErr && <ErrorBox title="Mesaj getmədi" detail={sendErr} />}
          {mode === 'human' && <SilentBar friend={excluded} disabled={!online} onFriend={(v) => void setFriend(v)} onBot={() => void setFriend(false)} />}
          {draft && <DraftCard draft={draft} mode={mode} windowOpen={data.window_open} online={online} onSend={sendDraft} onReject={() => void reject()} />}
          {mode === 'bot' && !draft && !writing && <BotBar friend={excluded} disabled={!online} onFriend={(v) => void setFriend(v)} onWrite={() => setWriting(true)} />}
          {showFree && <FreeComposer autoFocus={writing} windowOpen={data.window_open} online={online} busy={busy} onSend={sendFree} />}
        </div>
      </section>
      <Side data={data} mode={mode} />
    </div>
  );
}
