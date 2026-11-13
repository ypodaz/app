import { useMemo, useState } from 'react';
import { useAction, useAuth, useLoad } from '../../../ctx';
import { addDays, bakuParts, bakuToday, dateWd, toIso } from '../../../format';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, Chip, Dialog, EmptyState, ErrorBox, Field, Switch, TextArea, TextInput, useOnline, useToast, type ChipTone } from '../../ui';
import { ChangeNote } from '../../ui';
import { Gate, ddmm } from './kit';
import { MarketinqTabs } from './Marketinq';
import './tenzimleme.css';

type Status = 'planned' | 'queued' | 'published' | 'error' | 'cancelled';
type Post = {
  id: number; platform: string; scheduled_at: string; text: string; title: string | null; status: Status;
  external_id: string | null; error: string | null; attempts: number;
  media: { id: number; number: number; day: number; slot: 'seher' | 'axsam'; title: string; file_name: string; public_url: string | null };
};
type Channel = { id: string; service: string; name: string; queue_paused: boolean | null };
type Info = { queue_enabled: boolean; channels: Channel[] | { error: string } | null; requests_today: number; request_cap: number; next_posts: Post[]; recent_errors: Post[] };

const PLAT: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook' };
const ST: Record<Status, string> = { planned: 'Planlanıb', queued: 'Buffer-də', published: 'Paylaşıldı', error: 'Xəta', cancelled: 'Ləğv' };
const TONE: Record<Status, ChipTone> = { planned: 'neutral', queued: 'edit', published: 'done', error: 'cancel', cancelled: 'neutral' };
// Bir videonun ümumi vəziyyəti: Xəta > Buffer-də > Planlanıb > Paylaşıldı
const RANK: Status[] = ['error', 'queued', 'planned', 'published', 'cancelled'];
const SLOT = { seher: 'Səhər', axsam: 'Axşam' };
const AHEAD = 14, BACK = 7;

type Group = { media: Post['media']; posts: Post[]; at: string; status: Status };

/** Paylaşım növbəsi (32-paylasim.md). Route: /tenzimleme/marketinq/paylasim, köhnə /social. */
export function Paylasim() {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  // /social/status Buffer-ə sorğu atır (gündə 80 limit): yalnız açılanda bir dəfə və «Yenilə» ilə; avtomatik yoxlama yoxdur.
  const info = useLoad<Info>('/social/status');
  const posts = useLoad<Post[]>('/social/posts');
  const act = useAction();
  const [ask, setAsk] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const refresh = () => { info.reload(); posts.reload(); };

  async function setQueue(enabled: boolean) {
    setAsk(false);
    const r = await act.run(() => call('/social/queue', { method: 'POST', body: { enabled } }));
    if (r) { toast.show(enabled ? 'Növbə başladıldı.' : 'Növbə dayandırıldı.'); info.reload(); }
  }
  async function sync() {
    const r = await act.run(() => call('/social/sync', { method: 'POST' }));
    if (r) { toast.show('Sinxronlandı.'); refresh(); }
  }

  const today = bakuToday();
  const groups = useMemo(() => {
    const m = new Map<number, Group>();
    for (const p of posts.data ?? []) {
      const g = m.get(p.media.id) ?? { media: p.media, posts: [], at: p.scheduled_at, status: p.status };
      g.posts.push(p);
      if (p.scheduled_at < g.at) g.at = p.scheduled_at;
      m.set(p.media.id, g);
    }
    for (const g of m.values()) g.status = RANK.find((s) => g.posts.some((p) => p.status === s)) ?? 'planned';
    return [...m.values()].sort((a, b) => a.at.localeCompare(b.at));
  }, [posts.data]);
  const from = addDays(today, -BACK), to = addDays(today, AHEAD);
  const inRange = groups.filter((g) => { const d = bakuParts(g.at).date; return d >= from && d <= to; });
  const shown = more ? groups : inRange;
  const byDay = useMemo(() => {
    const m = new Map<string, Group[]>();
    for (const g of shown) { const d = bakuParts(g.at).date; m.set(d, [...(m.get(d) ?? []), g]); }
    return [...m.entries()];
  }, [shown]);

  // Ehtiyat: planlanmış (hələ paylaşılmamış) videoların sonuncu tarixi
  const pending = groups.filter((g) => g.status === 'planned' || g.status === 'queued');
  const lastD = pending.length ? bakuParts(pending[pending.length - 1].at).date : null;
  const left = lastD ? Math.round((Date.parse(lastD) - Date.parse(today)) / 86_400_000) : 0;
  const i = info.data;
  const ch = i?.channels;
  const sel = posts.data?.find((p) => p.id === open) ?? null;

  return (
    <>
      <PageHeader title="Marketinq" newShoot={false} sub="Reels-lərin avtomatik paylaşılması · gündə bir dəfə 20:00"
        actions={<Button variant="primary" size="lg" disabled={act.busy || !online} onClick={sync}>İndi sinxronla</Button>} />
      <div className="tz">
        <div className="tz-tabs"><MarketinqTabs value="paylasim" /></div>
        {act.err && <ErrorBox title="Əməliyyat alınmadı" detail={act.err} />}
        <div className="tz-grid2">
          <Card title="Növbə">
            <div className="bt-switch">
              <span><b>Növbə {i ? (i.queue_enabled ? 'açıqdır' : 'bağlıdır') : ''}</b><span className="tz-sub" style={{ display: 'block' }}>{i?.queue_enabled ? 'Postlar vaxtında avtomatik paylaşılır.' : 'Heç nə Buffer-ə göndərilmir.'}</span></span>
              <Switch checked={!!i?.queue_enabled} disabled={!i || act.busy || !online} label="Növbə" onChange={(v) => (v ? setAsk(true) : setQueue(false))} />
            </div>
            <div className="hs-kv"><span>Kanallar</span><span className="tz-muted">
              {!i && !info.err && '…'}{info.err && 'Yüklənmədi'}
              {ch === null && 'Buffer qoşulmayıb'}
              {ch && !Array.isArray(ch) && `Xəta: ${ch.error}`}
              {Array.isArray(ch) && (ch.length ? ch.map((c) => `${c.service}${c.queue_paused ? ' (dayandırılıb)' : ''}`).join(', ') : 'Kanal yoxdur')}
            </span></div>
            <div className="hs-kv"><span>Bugünkü Buffer sorğusu</span><span className="mono">{i ? `${i.requests_today} / ${i.request_cap}` : '…'}</span></div>
            {i && <div className="bt-bar"><i style={{ width: `${Math.min(100, (i.requests_today / Math.max(1, i.request_cap)) * 100)}%` }} /></div>}
            <div style={{ marginTop: 10 }}><Button size="row" variant="text" disabled={!online} onClick={() => info.reload()}>Statusu yenilə</Button></div>
            {info.err && !i && <ErrorBox title="Status alınmadı" detail={info.err} onRetry={info.reload} />}
            {/* TODO [API] Kanal başına bağlantı vəziyyəti/son paylaşım və «Yenidən cəhd et»: yalnız kanal adı və növbə pauzası gəlir. */}
          </Card>
          <Card title="Ehtiyat">
            {posts.data === null ? <p className="tz-muted">…</p> : pending.length === 0 ? (
              <p className="tz-warn-text">Planlanmış video qalmayıb. Yeni videolar yükləyin.</p>
            ) : (
              <>
                <p><b className="mono">{pending.length}</b> video planlanıb · sonuncu <b className="mono">{lastD && ddmm(lastD)}</b></p>
                {left <= 7 && <div className="tz-info" style={{ marginTop: 10, marginBottom: 0 }}><span>Ehtiyat {left} günə çatır — yeni videolar hazırlayın.</span></div>}
              </>
            )}
            {/* TODO [API] «Paylaşım planla» (yeni video seçib tarix təyin etmə) və qlobal «Vaxtı dəyiş»: serverdə yoxdur, videolar kənardan yüklənir. */}
          </Card>
        </div>

        {i && i.recent_errors.length > 0 && (
          <Card title="Son xətalar">
            {i.recent_errors.map((p) => <button key={p.id} type="button" className="tz-link" style={{ display: 'block', textAlign: 'left', padding: '6px 0' }} onClick={() => setOpen(p.id)}>Video {p.media.number} · {PLAT[p.platform] ?? p.platform}: {p.error || 'naməlum xəta'}</button>)}
          </Card>
        )}

        <Card title="Paylaşım təqvimi" aside={<span className="tz-aside">{AHEAD} gün irəli · {BACK} gün geri</span>}>
          <Gate q={posts} title="Postlar yüklənmədi">
            {() => byDay.length === 0 ? (
              <EmptyState title="Planlanmış post yoxdur" reason="Videolar yüklənəndə burada görünəcək." />
            ) : (
              <>
                {byDay.map(([d, gs]) => (
                  <div key={d} className="sp-day" role="group" aria-label={dateWd(d)}>
                    <div className="tz-grouph">{d === today ? 'Bu gün' : dateWd(d)}</div>
                    {gs.map((g) => (
                      <div key={g.media.id} className="tz-tr" style={{ '--cols': '56px minmax(0,1.6fr) minmax(0,1.6fr) auto' } as React.CSSProperties}>
                        <span className="sp-thumb">{g.media.number}</span>
                        <span className="tz-c"><b>Video {g.media.number} · {g.media.title}</b><span className="tz-sub">{SLOT[g.media.slot]} · {bakuParts(g.at).time}{!g.media.public_url && ' · video yüklənməyib'}</span></span>
                        <span className="sp-plat">{g.posts.map((p) => (
                          <button key={p.id} type="button" className="tz-pill" onClick={() => setOpen(p.id)} aria-label={`${PLAT[p.platform] ?? p.platform}: ${ST[p.status]}`}>{PLAT[p.platform] ?? p.platform}</button>
                        ))}</span>
                        <span className="tz-c"><Chip tone={TONE[g.status]}>{ST[g.status]}</Chip></span>
                      </div>
                    ))}
                  </div>
                ))}
                {groups.length > inRange.length && <div style={{ paddingTop: 8 }}><Button size="row" variant="text" onClick={() => setMore(!more)}>{more ? 'Yığ' : 'Daha çox'}</Button></div>}
              </>
            )}
          </Gate>
        </Card>
      </div>

      <Dialog open={ask} onClose={() => setAsk(false)} title="Növbəni başlat?" subtitle="Postlar Buffer-ə göndəriləcək və vaxtında avtomatik paylaşılacaq."
        footer={<><Button variant="text" onClick={() => setAsk(false)}>Ləğv et</Button><Button variant="primary" onClick={() => setQueue(true)}>Başlat</Button></>} />
      {sel && <PostDialog key={sel.id} post={sel} onClose={() => setOpen(null)} onSaved={refresh} />}
    </>
  );
}

function PostDialog({ post, onClose, onSaved }: { post: Post; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const act = useAction();
  const online = useOnline();
  const toast = useToast();
  const edit = post.status === 'planned';
  const redo = post.status === 'error' || post.status === 'cancelled';
  const t0 = bakuParts(post.scheduled_at);
  const [text, setText] = useState(post.text);
  const [title, setTitle] = useState(post.title ?? '');
  const [date, setDate] = useState(t0.date);
  const [time, setTime] = useState(t0.time);
  const [ask, setAsk] = useState(false);

  async function patch(body: Record<string, unknown>) {
    const r = await act.run(() => call(`/social/posts/${post.id}`, { method: 'PATCH', body }));
    if (r) { onSaved(); onClose(); }
  }
  async function requeue() {
    const r = await act.run(() => call<Post>(`/social/posts/${post.id}/requeue`, { method: 'POST' }));
    if (r) { const t = bakuParts(r.scheduled_at); onSaved(); onClose(); toast.show(`Sıraya qoyuldu · ${ddmm(t.date)} ${t.time}`); }
  }
  function save() {
    const body: Record<string, unknown> = {};
    if (text.trim() !== post.text) body.text = text.trim();
    if (post.platform === 'youtube' && title.trim() !== (post.title ?? '')) body.title = title.trim();
    if (date !== t0.date || time !== t0.time) body.scheduled_at = toIso(date, time);
    if (!Object.keys(body).length) { onClose(); return; }
    patch(body);
  }
  return (
    <>
      <Dialog open={!ask} onClose={onClose} title={`${PLAT[post.platform] ?? post.platform} · Video ${post.media.number}`} subtitle={<Chip tone={TONE[post.status]}>{ST[post.status]}</Chip>}
        footer={edit ? <><Button variant="danger" disabled={act.busy || !online} onClick={() => setAsk(true)}>Ləğv et</Button><Button variant="primary" disabled={act.busy || !online || !text.trim()} onClick={save}>Yadda saxla</Button></> : <>{redo && <Button variant="primary" disabled={act.busy || !online} onClick={requeue}>Sıraya qoy</Button>}<Button onClick={onClose}>Bağla</Button></>}>
        {post.error && <ErrorBox title="Paylaşım xətası" detail={post.error} />}
        {!edit && post.status !== 'cancelled' && <p className="tz-muted">Yalnız «Planlanıb» post dəyişdirilə bilər.</p>}
        {post.media.public_url ? <video className="sp-video" src={post.media.public_url} controls playsInline preload="metadata" /> : <p className="tz-muted">Video yüklənməyib</p>}
        {post.platform === 'youtube' && <Field label="YouTube başlığı">{(id) => <TextInput id={id} maxLength={200} value={title} disabled={!edit} onChange={(e) => setTitle(e.target.value)} />}</Field>}
        <Field label="Mətn">{(id) => <TextArea id={id} value={text} disabled={!edit} onChange={(e) => setText(e.target.value)} />}</Field>
        <div className="tz-row2">
          <Field label="Tarix">{(id) => <TextInput id={id} type="date" value={date} disabled={!edit} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Saat">{(id) => <TextInput id={id} type="time" value={time} disabled={!edit} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        {act.err && <ErrorBox title={redo ? 'Sıraya qoyulmadı' : 'Saxlanmadı'} detail={act.err} />}
      </Dialog>
      <Dialog open={ask} onClose={() => setAsk(false)} title="Post ləğv olunsun?" subtitle="Bu post paylaşılmayacaq."
        footer={<><Button variant="text" onClick={() => setAsk(false)}>Geri</Button><Button variant="danger" disabled={act.busy} onClick={() => { setAsk(false); patch({ status: 'cancelled' }); }}>Ləğv et</Button></>}>
        <ChangeNote changes={[`${PLAT[post.platform] ?? post.platform} postu ləğv olunur`]} unchanged={['Digər platformalardakı postlar']} />
      </Dialog>
    </>
  );
}
