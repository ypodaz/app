import { Fragment, useEffect, useRef, useState } from 'react';
import { usePoll, type ConvMode, type Draft } from '../../../components/crm';
import { errMsg, useAuth, useLoad } from '../../../ctx';
import { bakuParts } from '../../../format';
import { socialName, type SocialItem, type SocialMode } from '../../data/social';
import { fmtWait, msOf } from '../../data/time';
import { Avatar, Button, ErrorBox, LoadingRows, Segmented, useOnline, useToast, V2Icon } from '../../ui';
import { DraftCard, FreeComposer } from './Composer';
import { dayLabel, MODE_META } from './logic';
import { ModeChip } from './ModeMenu';

const IG_MODES: ConvMode[] = ['bot', 'owner', 'wait']; // Instagram DM-də «Bot susur» yoxdur
const igProfile = (author: string) => (author ? `https://www.instagram.com/${encodeURIComponent(author)}/` : null);

/** «Lead kimi əlavə et» (02 #57–58): lead varsa kartına keçid. */
function LeadButton({ itemId, leadId, who, onDone }: { itemId?: number; leadId?: number | null; who: string; onDone: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (leadId) return <a className="ibk__link" href={`#/insanlar/lead-${leadId}`}>Lead kartı</a>;
  if (!itemId) return null;
  return (
    <Button variant="text" size="md" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await call<{ lead_id: number; created: boolean }>(`/social-inbox/items/${itemId}/lead`, { method: 'POST' });
        toast.show(r.created ? `Lead əlavə edildi · ${who}` : `Mövcud lead-ə bağlandı · ${who}`);
        onDone();
      } catch (e) { toast.show(`Alınmadı: ${errMsg(e)}`, { error: true }); } finally { setBusy(false); }
    }}>Lead kimi əlavə et</Button>
  );
}

const UNDO_MS = 5000; // 99 G2

type DmMsg = { key: string; role: 'in' | 'bot' | 'you'; text: string; at: string };
type DmOpen = {
  thread_id: string; author: string; mode: SocialMode; window_open: boolean; window_expires_at: string | null; lead_id: number | null;
  messages: DmMsg[]; pending: SocialItem[];
};
type PostOpen = {
  channel: 'instagram' | 'youtube'; thread_id: string; comment_mode: 'auto' | 'draft'; items: SocialItem[];
  post: { permalink?: string | null; caption?: string; media_type?: string; timestamp?: string; like_count?: number; comments_count?: number };
};

/** Lead düyməsi üçün söhbətin hər hansı item-i: mesaj açarı `i<id>`-dir. */
const lastId = (d: { messages: { key: string }[] }) => { const k = [...d.messages].reverse().find((m) => /^i\d+$/.test(m.key))?.key; return k ? Number(k.slice(1)) : undefined; };

const asDraft = (i: SocialItem): Draft => ({ id: i.id, conversation_id: 0, text: i.draft_text ?? '', status: 'pending', reason: null, model_output: null, created_at: i.created_at });
const ddmmyyyy = (iso: string) => bakuParts(iso).date.split('-').reverse().join('.');

function Head({ name, meta, href, onBack, children }: { name: string; meta: string; href?: string | null; onBack: () => void; children?: React.ReactNode }) {
  return (
    <header className="ibh">
      <button type="button" className="ibh__back" aria-label="Geri" onClick={onBack}><V2Icon name="back" size={20} /></button>
      <Avatar name={name.replace(/^@/, '')} tone="brand" large />
      <div className="ibh__id">
        <h2 className="ibh__name">{href ? <a href={href} target="_blank" rel="noopener noreferrer">{name}</a> : name}</h2>
        <p className="ibh__meta">{meta}</p>
      </div>
      {children}
    </header>
  );
}

type DmProps = { thread: string; onChanged: () => void; onBack: () => void };

/** Instagram DM söhbəti (02 «Söhbət sütunu — WhatsApp / Instagram DM»). */
export function DmChat({ thread, onChanged, onBack }: DmProps) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const conv = useLoad<DmOpen>(`/social-inbox/dm/${encodeURIComponent(thread)}`);
  usePoll(conv.reload, 10_000);
  const data = conv.data?.thread_id === thread ? conv.data : null;
  const [hidden, setHidden] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [menu, setMenu] = useState(false);
  const [modeOv, setModeOv] = useState<SocialMode | null>(null);
  useEffect(() => { setModeOv(null); }, [data?.mode]);
  const endRef = useRef<HTMLDivElement>(null);
  const n = data?.messages.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [n]);
  const refresh = () => { conv.reload(); onChanged(); };

  const draftItem = data ? [...data.pending].filter((i) => i.draft_text && i.id !== hidden).pop() : undefined;
  const name = data ? socialName({ author: data.author, kind: 'dm', channel: 'instagram' }) : 'Instagram';

  function sendDraft(text: string, edited: boolean) {
    if (!draftItem) return;
    const id = draftItem.id;
    setHidden(id);
    const run = async () => {
      try { await call(`/social-inbox/items/${id}/send`, { method: 'POST', body: edited ? { text } : {} }); refresh(); }
      catch (e) { setHidden(null); toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => { setHidden(id); void run(); } }); }
    };
    const t = window.setTimeout(() => { void run(); }, UNDO_MS);
    toast.show('Göndərildi · söhbəti yenə bot aparır', { undo: () => { window.clearTimeout(t); setHidden(null); } });
  }

  async function act(path: 'reject' | 'regenerate') {
    if (!draftItem) return;
    try {
      await call(`/social-inbox/items/${draftItem.id}/${path}`, { method: 'POST' });
      if (path === 'regenerate') toast.show('Yenidən yazılır · bir neçə saniyəyə gələcək');
      refresh();
    } catch (e) { toast.show(`Alınmadı: ${errMsg(e)}`, { error: true }); }
  }

  async function sendFree(text: string): Promise<boolean> {
    setBusy(true); setSendErr('');
    try {
      await call(`/social-inbox/dm/${encodeURIComponent(thread)}/send`, { method: 'POST', body: { text } });
      toast.show('Siz yazdınız · bot indi yalnız qaralama hazırlayır');
      refresh();
      return true;
    } catch (e) { setSendErr(errMsg(e)); return false; } finally { setBusy(false); }
  }

  async function pickMode(m: SocialMode) {
    if (!data) return;
    const prev = modeOv ?? data.mode;
    const api = (x: SocialMode) => call(`/social-inbox/dm/${encodeURIComponent(thread)}/mode`, { method: 'POST', body: { mode: x } });
    setModeOv(m);
    try {
      await api(m);
      refresh();
      toast.show(`Rejim: ${MODE_META[m].label}`, { undo: () => { setModeOv(prev); void api(prev).then(refresh); } });
    } catch (e) { setModeOv(null); toast.show(`Alınmadı: ${errMsg(e)}`, { error: true, retry: () => void pickMode(m) }); }
  }

  if (!data) {
    return (
      <div className="ib__cw ib__cw--solo">
        <section className="ib__chat" aria-label="Söhbət">
          <Head name="Instagram" meta="Instagram DM" onBack={onBack} />
          {conv.err ? <div className="ib__pad"><ErrorBox title="Söhbət yüklənmədi" detail={conv.err} onRetry={conv.reload} /></div> : <LoadingRows rows={4} label="Söhbət yüklənir" />}
        </section>
      </div>
    );
  }

  const mode = modeOv ?? data.mode;
  const meta = MODE_META[mode];
  const autoMin = draftItem?.auto_at ? Math.max(1, Math.ceil((msOf(draftItem.auto_at) - Date.now()) / 60_000)) : 0;
  const note = autoMin ? `${autoMin} dəq sonra bot özü göndərəcək` : mode === 'wait' ? 'Siz baxana qədər gözləyir' : 'Siz göndərənə qədər gözləyir';
  const noDraftPending = data.pending.some((i) => !i.draft_text);

  return (
    <div className="ib__cw ib__cw--solo">
      <section className="ib__chat" aria-label="Söhbət">
        <Head name={name} meta={data.author ? 'Instagram DM · ada basın, profil açılır' : 'Instagram DM'} href={igProfile(data.author)} onBack={onBack}>
          <LeadButton itemId={data.pending[0]?.id ?? lastId(data)} leadId={data.lead_id} who={name} onDone={refresh} />
          <ModeChip current={mode} friend={false} modes={IG_MODES} open={menu} setOpen={setMenu} disabled={!online} onPick={(m) => void pickMode(m as SocialMode)} />
        </Head>
        <div className={`ibs ibs--${mode}`} role="status"><b>{meta.label}</b><span> · {meta.hint}</span></div>
        {!data.window_open && <div className="ib__warn" role="status">24 saat keçib · müştəri yazmayınca Instagram cavaba icazə vermir</div>}
        <div className="ibt" tabIndex={-1}>
          {data.messages.map((m, i) => {
            const day = dayLabel(m.at);
            const prev = data.messages[i - 1];
            const out = m.role !== 'in';
            return (
              <Fragment key={m.key}>
                {(!prev || dayLabel(prev.at) !== day) && <div className="ibt__day">{day}</div>}
                <div className={`ibm-row${out ? ' ibm-row--out' : ''}`}>
                  <div className={`ibmsg${out ? (m.role === 'bot' ? ' ibmsg--bot' : ' ibmsg--you') : ''}`}>
                    {out && <span className="ibmsg__who">{m.role === 'bot' ? 'Bot' : 'Siz'}</span>}
                    <span className="ibmsg__t">{m.text}</span>
                  </div>
                  <span className="ibmsg__time mono">{bakuParts(m.at).time}</span>
                </div>
              </Fragment>
            );
          })}
          {noDraftPending && !draftItem && <div className="ibt__sys">Bot bu mesaja qaralama yaza bilmədi · özünüz cavab yazın</div>}
          <div ref={endRef} />
        </div>
        <div className="ibf-wrap">
          {sendErr && <ErrorBox title="Mesaj getmədi" detail={sendErr} />}
          {draftItem
            ? <DraftCard draft={asDraft(draftItem)} mode={mode} note={note} windowOpen={data.window_open} online={online}
                onSend={sendDraft} onReject={() => void act('reject')} onRegenerate={draftItem.regen < 3 ? () => void act('regenerate') : undefined} />
            : <>
                {mode === 'bot' && <div className="ibb"><div className="ibb__t"><b>Bot bu söhbəti aparır.</b><span>Siz yazsanız, bot yalnız qaralama hazırlayacaq</span></div></div>}
                <FreeComposer windowOpen={data.window_open} online={online} busy={busy} onSend={sendFree} />
              </>}
        </div>
      </section>
    </div>
  );
}

function doneLabel(i: SocialItem): string {
  if (i.status === 'sent') return i.by_owner ? 'Siz cavab verdiniz' : i.auto ? 'Bot özü cavab verdi' : 'Cavab göndərildi';
  if (i.status === 'rejected') return 'Rədd edildi';
  return i.hidden ? 'Gizlədildi' : 'Cavabsız buraxıldı';
}

/** Gözləyən komment: qaralama yerində redaktə olunur, «Göndər» açıq cavab kimi dərc edir (02 #39–#40, #45). */
function PendingComment({ i, online, onDone }: { i: SocialItem; online: boolean; onDone: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const [text, setText] = useState(i.draft_text ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(i.draft_text ?? ''); }, [i.draft_text]);
  const who = socialName(i);

  async function act(path: 'send' | 'reject' | 'regenerate' | 'hide') {
    setBusy(true);
    try {
      await call(`/social-inbox/items/${i.id}/${path}`, { method: 'POST', body: path === 'send' ? { text: text.trim() } : undefined });
      toast.show(path === 'send' ? 'Cavab dərc olundu' : path === 'regenerate' ? 'Yenidən yazılır · bir neçə saniyəyə gələcək' : path === 'hide' ? 'Komment gizlədildi' : 'Rədd edildi');
      onDone();
    } catch (e) { toast.show(`Alınmadı: ${errMsg(e)}`, { error: true }); } finally { setBusy(false); }
  }

  return (
    <article className="ibk">
      <div className="ibk__top">
        <Avatar name={i.author || 'İzləyici'} />
        <b>{who}</b>
        <span className="mono ibk__time">{bakuParts(i.created_at).time}</span>
      </div>
      <p className="ibk__text">{i.text}</p>
      <p className="ibk__st">{i.draft_text ? 'Bot cavabı yazdı · siz göndərənə qədər gözləyir' : `cavabsız · ${fmtWait(Date.now() - msOf(i.created_at))}`}</p>
      <div className="ibd__card">
        <div className="ibd__top"><span /><span className="ibd__ai">{i.draft_text ? 'AI qaralaması · redaktə edə bilərsiniz' : 'Açıq cavab'}</span></div>
        <textarea className="ibd__ta" rows={2} aria-label={`${who} kommentinə açıq cavab`} placeholder={`${who} kommentinə açıq cavab`} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="ibd__acts">
        <Button variant="primary" size="md" disabled={!text.trim() || !online || busy} onClick={() => void act('send')}>Göndər</Button>
        {i.regen < 3 && <Button variant="text" size="md" disabled={!online || busy} onClick={() => void act('regenerate')}>Yenidən yaz</Button>}
        <Button variant="text" size="md" disabled={busy} onClick={() => void act('reject')}>Rədd et</Button>
        {i.channel === 'instagram' && <Button variant="text" size="md" disabled={!online || busy} onClick={() => void act('hide')}>Gizlət</Button>}
        <LeadButton itemId={i.id} leadId={i.lead_id} who={who} onDone={onDone} />
      </div>
    </article>
  );
}

type PostProps = { channel: 'instagram' | 'youtube'; thread: string; onChanged: () => void; onBack: () => void };

/** Komment görünüşü (02 #34–#46): söhbət yox, post açılır; gözləyən kommentlər yuxarıda, cavablananlar yığılır. */
export function PostView({ channel, thread, onChanged, onBack }: PostProps) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const post = useLoad<PostOpen>(`/social-inbox/post/${channel}/${encodeURIComponent(thread)}`);
  usePoll(post.reload, 15_000);
  const data = post.data?.thread_id === thread ? post.data : null;
  const [showDone, setShowDone] = useState(false);
  const [modeOv, setModeOv] = useState<'auto' | 'draft' | null>(null);
  const refresh = () => { post.reload(); onChanged(); };
  const yt = channel === 'youtube';

  async function setMode(m: 'auto' | 'draft') {
    setModeOv(m);
    try { await call('/social-inbox/comment-mode', { method: 'POST', body: { mode: m } }); refresh(); toast.show(m === 'auto' ? 'Komment cavabları: avtomatik' : 'Komment cavabları: qaralama'); }
    catch (e) { setModeOv(null); toast.show(`Alınmadı: ${errMsg(e)}`, { error: true }); }
  }

  const pending = data?.items.filter((i) => i.status === 'pending') ?? [];
  const done = data?.items.filter((i) => i.status !== 'pending') ?? [];
  const first = pending[0] ?? data?.items[0];
  const name = first ? socialName(first) : yt ? 'YouTube' : 'Instagram';
  const mode = modeOv ?? data?.comment_mode ?? 'auto';
  const p = data?.post;
  const postMeta = p ? [p.timestamp ? ddmmyyyy(p.timestamp) : '', p.like_count != null ? `${p.like_count} bəyənmə` : '', p.comments_count != null ? `${p.comments_count} komment` : ''].filter(Boolean).join(' · ') : '';

  return (
    <div className="ib__cw ib__cw--solo">
      <section className="ib__chat" aria-label="Kommentlər">
        <Head name={name} meta={`${yt ? 'YouTube' : 'Instagram'} komment · açıq, hamı görür`} href={!yt && first ? igProfile(first.author) : null} onBack={onBack}>
          {p?.permalink && <a className="ibk__link" href={p.permalink} target="_blank" rel="noopener noreferrer">{yt ? 'YouTube-da aç' : 'Instagram-da aç'}</a>}
        </Head>
        {!data
          ? (post.err ? <div className="ib__pad"><ErrorBox title="Kommentlər yüklənmədi" detail={post.err} onRetry={post.reload} /></div> : <LoadingRows rows={4} label="Kommentlər yüklənir" />)
          : (
            <div className="ibt ibk__list" tabIndex={-1}>
              <div className="ibk__mode">
                <span>Komment cavabları</span>
                <Segmented label="Komment cavabları" value={mode} onChange={(v) => void setMode(v)}
                  options={[{ value: 'auto', label: 'Avtomatik' }, { value: 'draft', label: 'Qaralama' }]} />
                <small>{mode === 'draft' ? 'bot ictimai cavabı yazır, siz göndərirsiniz' : 'bot ictimai cavabı özü yazır və göndərir'}</small>
              </div>
              {(p?.caption || postMeta) && (
                <div className="ibk__post">
                  <span className="ibk__pl">Paylaşım</span>
                  {p?.caption && <b>{p.caption.split('\n')[0]}</b>}
                  {postMeta && <span className="mono">{postMeta}</span>}
                </div>
              )}
              {pending.length === 0 && <p className="ibt__empty">Gözləyən komment yoxdur</p>}
              {pending.map((i) => <PendingComment key={i.id} i={i} online={online} onDone={refresh} />)}
              {done.length > 0 && (
                <button type="button" className="ib__more" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? 'yığ' : `Postun digər ${done.length} kommenti cavablanıb · hamısını göstər`}
                </button>
              )}
              {showDone && done.map((i) => (
                <article key={i.id} className="ibk ibk--done">
                  <div className="ibk__top"><Avatar name={i.author || 'İzləyici'} /><b>{socialName(i)}</b><span className="mono ibk__time">{ddmmyyyy(i.created_at)}</span></div>
                  <p className="ibk__text">{i.text}</p>
                  {i.status === 'sent' && i.draft_text && <p className="ibk__reply">↳ {i.draft_text}</p>}
                  <p className="ibk__st">{doneLabel(i)} <LeadButton itemId={i.id} leadId={i.lead_id} who={socialName(i)} onDone={refresh} /></p>
                </article>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
