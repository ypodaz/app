import { useMemo, useState } from 'react';
import { AdminShell, Sheet } from '../../shared/ui';
import { AEmpty } from '../components/a3';
import { Err, Field, Toggle } from '../components/common';
import { ConfirmDialog, useToast } from '../components/neon';
import { usePoll } from '../components/crm';
import { useAction, useAuth, useLoad } from '../ctx';
import { bakuParts, bakuToday, dateWd, toIso } from '../format';

type Status = 'planned' | 'queued' | 'published' | 'error' | 'cancelled';
type Post = {
  id: number; platform: string; scheduled_at: string; text: string; title: string | null; status: Status;
  external_id: string | null; error: string | null; attempts: number;
  media: { id: number; number: number; day: number; slot: 'seher' | 'axsam'; title: string; file_name: string; public_url: string | null };
};
type Channel = { id: string; service: string; name: string; queue_paused: boolean | null };
type Info = {
  queue_enabled: boolean; channels: Channel[] | { error: string } | null; requests_today: number; request_cap: number;
  next_posts: Post[]; recent_errors: Post[];
};

const PLAT: Record<string, string> = { instagram: 'IG', tiktok: 'TikTok', youtube: 'YT', facebook: 'FB' };
const ST: Record<Status, string> = { planned: 'Planlandı', queued: 'Növbədə', published: 'Paylaşıldı', error: 'Xəta', cancelled: 'Ləğv' };
const SLOT: Record<string, string> = { seher: 'Səhər', axsam: 'Axşam' };
const when = (iso: string) => `${bakuParts(iso).time}`;

export function Social() {
  const { call } = useAuth();
  const info = useLoad<Info>('/social/status');
  const posts = useLoad<Post[]>('/social/posts');
  usePoll(() => { info.reload(); posts.reload(); }, 30000);
  const act = useAction();
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [past, setPast] = useState(false);
  const refresh = () => { info.reload(); posts.reload(); };

  async function setQueue(enabled: boolean) {
    setAsk(false);
    const r = await act.run(() => call(`/social/queue`, { method: 'POST', body: { enabled } }));
    if (r) { toast.show(enabled ? 'Növbə başladıldı.' : 'Növbə dayandırıldı.'); info.reload(); }
  }
  async function sync() {
    const r = await act.run(() => call(`/social/sync`, { method: 'POST' }));
    if (r) { toast.show('Sinxronlandı.'); refresh(); }
  }

  const days = useMemo(() => {
    const today = bakuToday();
    const m = new Map<string, Map<string, Post[]>>();
    for (const p of posts.data ?? []) {
      const d = bakuParts(p.scheduled_at).date;
      if (d < today && !past) continue;
      const key = `${p.media.slot}:${p.media.id}`;
      const day = m.get(d) ?? new Map<string, Post[]>();
      day.set(key, [...(day.get(key) ?? []), p]);
      m.set(d, day);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [posts.data, past]);

  const i = info.data;
  const sel = posts.data?.find((p) => p.id === open) ?? null;
  const ch = i?.channels;
  return (
    <AdminShell active="social" title="Paylaşım" sub="Reels-lərin avtomatik paylaşılması"
      actions={<button type="button" className="a-bg" disabled={act.busy} onClick={sync}>İndi sinxronla</button>}>
      {toast.node}
      <Err msg={info.err || act.err} />
      <section className="a-g c-sc" aria-label="Status">
        <div className="c-row">
          <span><b>Növbə {i ? (i.queue_enabled ? 'açıqdır' : 'bağlıdır') : ''}</b><small className="c-mut">{i?.queue_enabled ? 'Postlar vaxtında avtomatik paylaşılır.' : 'Heç nə Buffer-ə göndərilmir.'}</small></span>
          <Toggle on={!!i?.queue_enabled} disabled={!i || act.busy} label="Növbə" onChange={(v) => (v ? setAsk(true) : setQueue(false))} />
        </div>
        <div className="c-kv">
          <span>Kanallar</span>
          <span>
            {ch === null && 'Buffer qoşulmayıb'}
            {ch && !Array.isArray(ch) && `Xəta: ${ch.error}`}
            {Array.isArray(ch) && (ch.length ? ch.map((c) => `${c.service}${c.queue_paused ? ' (dayandırılıb)' : ''}`).join(', ') : 'Kanal yoxdur')}
            {!i && '…'}
          </span>
        </div>
        <div className="c-kv"><span>Bugünkü sorğu</span><span>{i ? `${i.requests_today} / ${i.request_cap}` : '…'}</span></div>
        {i && <div className="a3-prog" aria-hidden="true"><span style={{ width: `${Math.min(100, (i.requests_today / Math.max(1, i.request_cap)) * 100)}%` }} /></div>}
        {i && i.recent_errors.length > 0 && (
          <div className="c-errs">
            <b>Son xətalar</b>
            {i.recent_errors.map((p) => (
              <button type="button" key={p.id} onClick={() => setOpen(p.id)}>Video {p.media.number} · {PLAT[p.platform] ?? p.platform}: {p.error || 'naməlum xəta'}</button>
            ))}
          </div>
        )}
      </section>

      <div className="c-sh"><h2 className="c-h3">Təqvim</h2><button type="button" className="a-bg" onClick={() => setPast((v) => !v)}>{past ? 'Keçmişi gizlət' : 'Keçmiş günlər'}</button></div>
      <Err msg={posts.err} />
      {!posts.data && !posts.err && <div className="a-sk" style={{ height: 160, borderRadius: 22 }} aria-busy="true" />}
      {posts.data && !days.length && <AEmpty icon="cal" title="Planlanmış post yoxdur" text="Videolar yüklənəndə burada görünəcək." />}
      {days.map(([d, slots]) => (
        <section key={d} className="c-day" aria-label={dateWd(d)}>
          <h3>{dateWd(d)}</h3>
          {[...slots.values()].sort((a, b) => a[0].scheduled_at.localeCompare(b[0].scheduled_at)).map((ps) => {
            const m = ps[0].media;
            return (
              <div key={m.id} className="a-g c-slotc">
                <div className="c-st"><b>{SLOT[m.slot]} · {when(ps[0].scheduled_at)}</b><span>Video {m.number} · {m.title}</span></div>
                {!m.public_url && <p className="c-miss">Video yüklənməyib</p>}
                <div className="c-pls">
                  {ps.map((p) => (
                    <button type="button" key={p.id} className={`c-pl s-${p.status}`} onClick={() => setOpen(p.id)} aria-label={`${PLAT[p.platform] ?? p.platform}: ${ST[p.status]}`}>
                      <b>{PLAT[p.platform] ?? p.platform}</b><span>{ST[p.status]}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}

      <ConfirmDialog open={ask} title="Növbəni başlat?" text="Postlar Buffer-ə göndəriləcək və vaxtında avtomatik paylaşılacaq." confirmLabel="Başlat" onCancel={() => setAsk(false)} onConfirm={() => setQueue(true)} />
      {sel && <PostSheet key={sel.id} post={sel} onClose={() => setOpen(null)} onSaved={() => { refresh(); }} />}
    </AdminShell>
  );
}

function PostSheet({ post, onClose, onSaved }: { post: Post; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const act = useAction();
  const edit = post.status === 'planned';
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
  function save() {
    const body: Record<string, unknown> = {};
    if (text.trim() !== post.text) body.text = text.trim();
    if (post.platform === 'youtube' && title.trim() !== (post.title ?? '')) body.title = title.trim();
    if (date !== t0.date || time !== t0.time) body.scheduled_at = toIso(date, time);
    if (!Object.keys(body).length) { onClose(); return; }
    patch(body);
  }
  return (
    <Sheet open onClose={onClose} title={`${PLAT[post.platform] ?? post.platform} · Video ${post.media.number}`}>
      <div className="c-pd">
        <span className={`c-pl s-${post.status} static`}><b>{ST[post.status]}</b></span>
        {post.error && <p className="c-miss">{post.error}</p>}
        {!edit && post.status !== 'cancelled' && <p className="c-mut">Yalnız «Planlandı» post dəyişdirilə bilər.</p>}
        {post.media.public_url
          ? <video className="c-vid" src={post.media.public_url} controls playsInline preload="metadata" />
          : <p className="c-miss">Video yüklənməyib</p>}
        {post.platform === 'youtube' && (
          <Field label="YouTube başlığı" id="p-title"><input id="p-title" className="inp" maxLength={200} value={title} disabled={!edit} onChange={(e) => setTitle(e.target.value)} /></Field>
        )}
        <Field label="Mətn" id="p-text"><textarea id="p-text" className="inp c-ta" rows={6} value={text} disabled={!edit} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="c-two">
          <Field label="Tarix" id="p-date"><input id="p-date" type="date" className="inp" value={date} disabled={!edit} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Saat" id="p-time"><input id="p-time" type="time" className="inp" value={time} disabled={!edit} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <Err msg={act.err} />
        {edit && (
          <div className="c-btns">
            <button type="button" className="btn btn-danger btn-sm" disabled={act.busy} onClick={() => setAsk(true)}>Ləğv et</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={act.busy || !text.trim()} onClick={save}>Yadda saxla</button>
          </div>
        )}
      </div>
      <ConfirmDialog open={ask} title="Post ləğv olunsun?" text="Bu post paylaşılmayacaq." cancelLabel="Geri" confirmLabel="Ləğv et" onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); patch({ status: 'cancelled' }); }} />
    </Sheet>
  );
}
