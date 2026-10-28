import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api';
import { Button, Icon, Sheet } from '../../shared/ui';
import { DATA_CHANGED, errMsg, useAuth } from '../ctx';
import { Err } from './common';

// Səsli köməkçi: səs/yazı → /admin/assistant → təklif kartları → təsdiqdə real sorğu.
type Proposal = { index: number; action: string; method: string; path: string; body: Record<string, unknown> | null; summary: string; warning: string | null };
type Reply = { reply: string; proposals: Proposal[]; remaining: number };
type PState = { status: 'busy' | 'done' | 'rejected' | 'error'; msg?: string };
type Turn = { role: 'user' | 'model'; text: string; voice?: boolean; proposals?: Proposal[]; states?: Record<number, PState>; ids?: Record<number, number> };

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
      <button type="button" className="ax-fab" aria-label="Köməkçi" title="Köməkçi" onClick={() => setOpen(true)}><Icon name="mic" size={24} /></button>
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
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const canRecord = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns, busy]);
  useEffect(() => () => { window.clearInterval(timer.current); recorder.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function ask(input: { text?: string; audio?: string; mime?: string }) {
    setBusy(true); setErr('');
    const history = turns.slice(-10).map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));
    const shown: Turn = { role: 'user', text: input.text ?? '(səs)', voice: !!input.audio };
    setTurns((t) => [...t, shown]);
    try {
      const r = await call<Reply>('/assistant', { body: { ...input, history } });
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
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(timer.current);
        setRec(false);
        const type = mr.mimeType || mime || 'audio/webm';
        if (!chunks.length) return;
        try { ask({ audio: await toBase64(new Blob(chunks, { type })), mime: type.split(';')[0] }); }
        catch { setErr('Səs oxunmadı. Yenidən cəhd edin.'); }
      };
      recorder.current = mr;
      mr.start();
      setRec(true); setSec(0);
      timer.current = window.setInterval(() => setSec((s) => { if (s + 1 >= MAX_SEC) mr.state !== 'inactive' && mr.stop(); return s + 1; }), 1000);
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

  const mmss = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return (
    <Sheet open={open} onClose={onClose} title="Köməkçi">
      <div className="ax-chat">
        {turns.length === 0 && <p className="t13 muted lh">Mikrofona basıb danışın və ya yazın. Məsələn: “Aysel Məmmədova üçün sabah 15:00-da 2 kameralı çəkiliş yaz”. Köməkçi təklif hazırlayır, siz təsdiqləyəndə icra olunur.</p>}
        {turns.map((t, ti) => (
          <div key={ti} className="col" style={{ gap: 8, alignItems: t.role === 'user' ? 'flex-end' : 'flex-start', minWidth: 0 }}>
            <div className={`ax-msg ${t.role === 'user' ? 'ax-me' : 'ax-ai'}`}>{t.voice && <><Icon name="mic" size={14} />{' '}</>}{t.text}</div>
            {t.proposals?.map((p) => {
              const st = t.states?.[p.index];
              const blocked = !!p.body && Object.values(p.body).some((v) => { const n = ref(v); return n !== null && t.ids?.[n] === undefined; });
              const rejected = st?.status === 'rejected';
              return (
                <div key={p.index} className={`ax-prop${rejected ? ' ax-dim' : ''}`}>
                  <span className="t14 w8">{p.summary}</span>
                  {p.warning && <span className="ax-warn" role="alert"><Icon name="alert" size={16} /> {p.warning}</span>}
                  {st?.status === 'done' ? <span className="t13 w8 neon"><Icon name="check" size={16} /> Edildi ✓</span>
                    : rejected ? <span className="t12 muted">İmtina edildi</span>
                    : (
                      <>
                        {st?.status === 'error' && <Err msg={st.msg ?? ''} />}
                        {blocked && <span className="t12 muted">Əvvəl müştərini təsdiqləyin</span>}
                        <div className="btns">
                          <Button variant="cream" small disabled={st?.status === 'busy' || blocked} onClick={() => approve(ti, p, { ...t.ids })}>{st?.status === 'busy' ? 'Gözləyin…' : 'Təsdiqlə'}</Button>
                          <Button variant="out" small disabled={st?.status === 'busy'} onClick={() => patch(ti, p.index, { status: 'rejected' })}>İmtina</Button>
                        </div>
                      </>
                    )}
                </div>
              );
            })}
            {(t.proposals?.filter((p) => { const s = t.states?.[p.index]?.status; return s !== 'done' && s !== 'rejected'; }).length ?? 0) > 1 && (
              <Button small disabled={busy} onClick={() => approveAll(ti)}>Hamısını təsdiqlə</Button>
            )}
          </div>
        ))}
        {busy && <div className="ax-msg ax-ai" role="status"><span className="typing"><i /><i /><i /></span> <span className="t12 muted">düşünür…</span></div>}
        <div ref={end} />
      </div>
      <Err msg={err} />
      {rec ? (
        <div className="row">
          <span className="grow t14 w8 ax-recdot">Yazılır · {mmss}</span>
          <Button variant="danger" small auto onClick={stop}><Icon name="stop" size={16} /> Dayandır</Button>
        </div>
      ) : (
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); sendText(); }}>
          <textarea className="inp ta ax-ta" rows={2} placeholder="Əmr yazın…" aria-label="Əmr" maxLength={2000} value={text} disabled={busy} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendText(); } }} />
          <div className="col" style={{ gap: 8 }}>
            {canRecord && <button type="button" className="iconbtn" aria-label="Səslə danış" disabled={busy} onClick={start}><Icon name="mic" size={22} /></button>}
            <button type="submit" className="iconbtn iconbtn-cream" aria-label="Göndər" disabled={busy || !text.trim()}><Icon name="send" size={20} /></button>
          </div>
        </form>
      )}
      {remaining !== null && <span className="hint">Bu gün qalan sorğu: {remaining}</span>}
    </Sheet>
  );
}
