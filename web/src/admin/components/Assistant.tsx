import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ApiError } from '../../shared/api';
import { AIcon } from './AIcon';
import { DATA_CHANGED, errMsg, useAuth } from '../ctx';

// Səsli köməkçi: səs/yazı → /admin/assistant → təklif kartları → təsdiqdə real sorğu.
type Proposal = { index: number; action: string; method: string; path: string; body: Record<string, unknown> | null; summary: string; warning: string | null };
type Reply = { reply: string; proposals: Proposal[]; remaining: number };
type PState = { status: 'busy' | 'done' | 'rejected' | 'error'; msg?: string };
type Turn = { role: 'user' | 'model'; text: string; voice?: boolean; dur?: number; proposals?: Proposal[]; states?: Record<number, PState>; ids?: Record<number, number> };

const MAX_SEC = 120;
const MIMES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
const pickMime = () => (typeof MediaRecorder === 'undefined' ? '' : MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '');

function toBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

const ref = (v: unknown): number | null =>
  v && typeof v === 'object' && '$ref' in v && typeof (v as { $ref: unknown }).$ref === 'number' ? (v as { $ref: number }).$ref : null;

export function AssistantButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="a-fab" aria-label="Köməkçi" title="Köməkçi" onClick={() => setOpen(true)}><AIcon name="mic" size={24} /></button>
      <Assistant open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { call } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [rec, setRec] = useState(false);
  const [sec, setSec] = useState(0);
  const secRef = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const dropped = useRef(new WeakSet<MediaRecorder>()); // bağlananda ləğv edilən yazılar: göndərilmir
  const openRef = useRef(open);
  openRef.current = open;
  const canRecord = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns, busy]);
  // Yazını ləğv et: səs atılır (AI-ə getmir), mikrofon buraxılır
  function cancelRec() {
    window.clearInterval(timer.current);
    const mr = recorder.current;
    if (!mr) return;
    dropped.current.add(mr);
    if (mr.state !== 'inactive') mr.stop();
    mr.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    setRec(false);
  }
  useEffect(() => { if (!open) cancelRec(); }, [open]);
  useEffect(() => () => { openRef.current = false; cancelRec(); }, []);

  async function ask(input: { text?: string; audio?: string; mime?: string }) {
    setBusy(true); setErr('');
    const history = turns.slice(-10).map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));
    const shown: Turn = { role: 'user', text: input.text ?? '(səs)', voice: !!input.audio, dur: input.audio ? secRef.current : undefined };
    setTurns((t) => [...t, shown]);
    try {
      const r = await call<Reply>('/assistant', { body: { ...input, history }, timeout: 70_000 });
      const heard = r.reply.split('\n').find((l) => l.trim().startsWith('Eşitdim'));
      setTurns((t) => {
        const c = [...t];
        if (input.audio) c[c.length - 1] = { ...shown, text: heard?.trim() ?? '(səs)' };
        return [...c, { role: 'model', text: r.reply, proposals: r.proposals, states: {}, ids: {} }];
      });
      setRemaining(r.remaining);
    } catch (e) {
      setErr(e instanceof ApiError && (e.status === 429 || e.status === 503) ? e.message : errMsg(e));
      setTurns((t) => t.slice(0, -1));
      if (input.text) setText(input.text);
    } finally { setBusy(false); }
  }

  function sendText() {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    ask({ text: t });
  }

  async function start() {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!openRef.current) { stream.getTracks().forEach((t) => t.stop()); return; } // icazə gözləyəndə panel bağlanıb
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(timer.current);
        setRec(false);
        if (dropped.current.has(mr)) return;
        const type = mr.mimeType || mime || 'audio/webm';
        if (!chunks.length) return;
        try { ask({ audio: await toBase64(new Blob(chunks, { type })), mime: type.split(';')[0] }); }
        catch { setErr('Səs oxunmadı. Yenidən cəhd edin.'); }
      };
      recorder.current = mr;
      mr.start();
      setRec(true); setSec(0); secRef.current = 0;
      timer.current = window.setInterval(() => setSec((s) => { secRef.current = s + 1; if (s + 1 >= MAX_SEC) mr.state !== 'inactive' && mr.stop(); return s + 1; }), 1000);
    } catch { setErr('Mikrofona icazə verilmədi və ya mikrofon tapılmadı. Mətn yazın.'); }
  }
  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };

  // --- təkliflər ---
  function patch(ti: number, idx: number, st: PState, id?: number) {
    setTurns((all) => all.map((t, i) => i !== ti ? t : { ...t, states: { ...t.states, [idx]: st }, ids: id !== undefined ? { ...t.ids, [idx]: id } : t.ids }));
  }

  /** Təsdiq: body.client_id {"$ref": N} olarsa, N-ci təklifin yaratdığı id götürülür. */
  async function approve(ti: number, p: Proposal, ids: Record<number, number>): Promise<boolean> {
    const body = p.body ? { ...p.body } : undefined;
    for (const [k, v] of Object.entries(body ?? {})) {
      const n = ref(v);
      if (n !== null) { if (ids[n] === undefined) return false; body![k] = ids[n]; }
    }
    patch(ti, p.index, { status: 'busy' });
    try {
      const res = await call<{ id?: number }>(p.path.replace(/^\/admin/, ''), { method: p.method, body });
      ids[p.index] = res?.id as number;
      patch(ti, p.index, { status: 'done' }, res?.id);
      window.dispatchEvent(new Event(DATA_CHANGED));
      return true;
    } catch (e) { patch(ti, p.index, { status: 'error', msg: errMsg(e) }); return false; }
  }

  async function approveAll(ti: number) {
    const t = turns[ti];
    const ids = { ...t.ids };
    for (const p of t.proposals ?? []) {
      const s = t.states?.[p.index]?.status;
      if (s === 'done' || s === 'rejected') continue;
      if (!(await approve(ti, p, ids))) break;
    }
  }

  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const mmss = fmt(sec);

  // açıq paneldə Esc bağlayır, fon sürüşməsi dayanır
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const pending = (t: Turn) => t.proposals?.filter((p) => { const s = t.states?.[p.index]?.status; return s !== 'done' && s !== 'rejected'; }).length ?? 0;
  const bulk = turns.map((t, i) => [t, i] as const).reverse().find(([t]) => pending(t) > 1)?.[1];
  if (!open) return null;
  return (
    <div className="a-ovl" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="a-asst" role="dialog" aria-modal="true" aria-label="Köməkçi" tabIndex={-1} ref={panel}>
        <div className="a-grab" aria-hidden="true" />
        <header className="a-ah">
          <span className="a-ic a-ic-acc"><AIcon name="spark" size={16} /></span>
          <h2>Köməkçi</h2>
          {bulk !== undefined && <button type="button" className="a-pb a-pri" disabled={busy} onClick={() => approveAll(bulk)}>Hamısını təsdiqlə</button>}
          <button type="button" className="a-ib a-gl" aria-label="Bağla" onClick={onClose}><AIcon name="x" size={18} /></button>
        </header>
        {turns.length === 0 && !busy ? (
          <div className="a-abody emp">
            <span className="a-emp-ic"><AIcon name="mic" size={20} /></span>
            <h3 className="a-emp-h">Mikrofona basıb danışın və ya yazın.</h3>
            <p className="a-emp-p">Məsələn: «Aysel Məmmədova üçün sabah 15:00-da 2 kameralı çəkiliş yaz». Köməkçi təklif hazırlayır, siz təsdiqləyəndə icra olunur.</p>
          </div>
        ) : (
          <div className="a-abody">
            {turns.map((t, ti) => (
              <Fragment key={ti}>
                {t.role === 'user'
                  ? <div className="a-m-me">{t.voice && <div className="v"><AIcon name="mic" size={14} />Səsli mesaj{t.dur ? ` · ${fmt(t.dur)}` : ''}</div>}{t.text}</div>
                  : <div className="a-m-ai">{t.text}</div>}
                {t.proposals?.map((p, pi) => {
                  const st = t.states?.[p.index];
                  const blocked = !!p.body && Object.values(p.body).some((v) => { const n = ref(v); return n !== null && t.ids?.[n] === undefined; });
                  const rejected = st?.status === 'rejected';
                  return (
                    <div key={p.index} className={`a-prop${rejected ? ' dim' : ''}`} style={{ '--i': pi } as CSSProperties}>
                      <div className="a-prop-t">{p.summary}</div>
                      {p.warning && <div className="a-prop-w" role="alert"><AIcon name="warn" size={14} />{p.warning}</div>}
                      {st?.status === 'done' ? <div className="a-prop-ok"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path pathLength="1" d="M20 6 9 17l-5-5" /></svg>Edildi</div>
                        : rejected ? <div className="a-prop-no">İmtina edildi</div>
                        : (
                          <>
                            {st?.status === 'error' && <div className="a-ferr" role="alert" style={{ marginTop: 8 }}><AIcon name="alert" size={14} />{st.msg}</div>}
                            {blocked && <div className="a-prop-x">Əvvəl müştərini təsdiqləyin</div>}
                            <div className="a-prop-b">
                              <button type="button" className="a-pb a-pri" disabled={st?.status === 'busy' || blocked} onClick={() => approve(ti, p, { ...t.ids })}>{st?.status === 'busy' ? 'Gözləyin…' : 'Təsdiqlə'}</button>
                              <button type="button" className="a-pb a-gl" disabled={st?.status === 'busy'} onClick={() => patch(ti, p.index, { status: 'rejected' })}>İmtina</button>
                            </div>
                          </>
                        )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
            {busy && <div className="a-m-ai" role="status"><span className="typing"><i /><i /><i /></span> <span className="t12 muted">düşünür…</span></div>}
            <div ref={end} />
          </div>
        )}
        <div className="a-afoot">
          {rec && (
            <div className="a-rec">
              <span className="dot" aria-hidden="true" />
              <span className="tm" role="timer">Yazılır · {mmss}</span>
              <div className="a-wv" aria-hidden="true">{Array.from({ length: 22 }, (_, k) => <i key={k} />)}</div>
              <button type="button" className="a-stop" onClick={stop}>Dayandır</button>
            </div>
          )}
          <form className="a-arow" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
            <textarea className="a-ain" rows={1} placeholder="Əmr yazın…" aria-label="Əmr yazın" aria-describedby="mic-err" maxLength={2000} value={text} disabled={busy || rec} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }} />
            {canRecord && <div className={`a-micw${rec ? ' rec' : ''}`}><button type="button" className="a-ib a-gl" aria-label={rec ? 'Dayandır' : 'Səslə danış'} disabled={busy} onClick={rec ? stop : start}><AIcon name="mic" size={20} /></button></div>}
            <button type="submit" className="a-ib a-pri" aria-label="Göndər" disabled={busy || rec || !text.trim()}><AIcon name="send" size={20} /></button>
          </form>
          {err && <div id="mic-err" className="a-ferr" role="alert"><AIcon name="alert" size={14} />{err}</div>}
          {remaining !== null && <div className="a-left">Bu gün qalan sorğu: {remaining}</div>}
        </div>
      </section>
    </div>
  );
}
