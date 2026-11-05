import { useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../shared/api';
import { NIcon } from '../shared/ui';
import { AuthCtx, dl, ErrorState, Loading, NEmpty, Screen, useApi } from './core';
import { waLink } from './util';

// ---------- AI dəstəkçi (A5a–A5f) ----------
type Msg = { role: 'user' | 'model'; text: string; created_at?: string; whatsapp?: boolean; fresh?: boolean };
type AiData = { enabled: boolean; remaining: number; messages: Msg[] };
type Reply = { text: string; whatsapp: boolean; remaining: number };

const SUGGEST = ['Qiymətlər', 'Çəkilişə necə hazırlaşım?', 'Reels mətnimi axıcı et', 'Mənə kontent ideyası ver'];
const WA_HELP = 'Salam, AI dəstəkçi ilə bağlı yazıram.';

function WaButton({ text, label = 'WhatsApp-da yazın' }: { text: string; label?: string }) {
  return <a className="nb nb-s nb-auto nai-sm" href={waLink(text)} target="_blank" rel="noopener" style={{ alignSelf: 'flex-start' }}><NIcon name="msg" size={16} />{label}</a>;
}

function Top() {
  return <header className="ncal-head rise"><h1 className="n-h1">AI köməkçi</h1></header>;
}

/** Cavab mətni: «- » / «* » / «• » ilə başlayan ardıcıl sətirlər siyahı olur, qalanı abzas. */
function AiText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{para.join('\n')}</p>);
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    para = []; list = [];
  };
  for (const line of text.split('\n')) {
    const m = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (m) { if (para.length) flush(); list.push(m[1]); }
    else if (!line.trim()) flush();
    else { if (list.length) flush(); para.push(line); }
  }
  flush();
  return <>{out}</>;
}

export function AiChat() {
  const { token, signOut } = useContext(AuthCtx);
  const q = useApi<AiData>('/me/ai');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [fly, setFly] = useState(false);
  const [fail, setFail] = useState<{ text: string; msg: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (q.data) { setMsgs(q.data.messages); setRemaining(q.data.remaining); } }, [q.data]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, pending, fail]);

  async function send(t: string, retry = false) {
    const body = t.trim();
    if (!body || pending) return;
    setFail(null); setPending(true);
    if (!retry) { setMsgs((m) => [...m, { role: 'user', text: body, fresh: true }]); setText(''); }
    try {
      const r = await api<Reply>('/me/ai', { token, body: { text: body }, timeout: 70_000 });
      setMsgs((m) => [...m, { role: 'model', text: r.text, whatsapp: r.whatsapp, fresh: true }]);
      setRemaining(r.remaining);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) return signOut();
      if (err.status === 429 && /limit/i.test(err.message)) setRemaining(0);
      setFail({ text: body, msg: err.status === 0 ? 'Bağlantıda problem oldu. Yenidən cəhd edin və ya bizə yazın.' : err.message });
    } finally { setPending(false); }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (limited || pending || !text.trim()) return;
    setFly(true); setTimeout(() => setFly(false), 260);
    send(text);
  }

  const d = q.data;
  const limited = remaining <= 0;
  if (!d) return <Screen tab="ai"><Top />{q.loading ? <Loading /> : <ErrorState q={q} />}</Screen>;
  if (!d.enabled) {
    return (
      <Screen tab="ai">
        <Top />
        <NEmpty fill icon="spark" tone="ac" title="AI köməkçi tezliklə" text="Tezliklə burada suallarınıza cavab verəcək və kontent ideyaları təklif edəcək. Hələlik bizə WhatsApp-da yazın.">
          <a className="nb nb-p nb-auto" href={waLink(WA_HELP)} target="_blank" rel="noopener"><NIcon name="msg" size={18} />WhatsApp-da yazın</a>
        </NEmpty>
      </Screen>
    );
  }
  const empty = msgs.length === 0 && !pending;
  return (
    <Screen tab="ai">
      <Top />
      <div className={`nai${empty ? ' nai-e' : ''}`} role="log" aria-label="Söhbət" aria-live="polite">
        {empty ? (
          <>
            <span className="nai-ic rz" style={dl(30)} aria-hidden="true"><NIcon name="spark" size={24} /></span>
            <h2 className="n-h2 nai-h rz" style={dl(60)}>Studiya haqqında soruşun və ya kontentiniz üzərində birlikdə işləyək</h2>
            <div className="nai-chips" role="group" aria-label="Təkliflər">
              {SUGGEST.map((t, i) => <button key={t} type="button" className="nai-chip rz" style={dl(90 + i * 40)} disabled={limited} onClick={() => send(t)}>{t}</button>)}
            </div>
            <p className="n-meta c3 nai-note rz" style={dl(280)}>Montaj və çəkiliş studiya komandası tərəfindən edilir; köməkçi sual və mətnlərdə kömək edir.</p>
          </>
        ) : (
          <>
            {msgs.map((m, i) => {
              const me = m.role === 'user';
              return (
                <div key={i} className={`nai-m${me ? ' me' : ''}${m.fresh ? ' nai-fresh' : ''}`}>
                  <div className={`nai-b${me ? '' : ' ai'}`}><span className="nsr">{me ? 'Siz: ' : 'Köməkçi: '}</span>{me ? <p>{m.text}</p> : <AiText text={m.text} />}</div>
                  {!me && m.whatsapp && <WaButton text={WA_HELP} />}
                </div>
              );
            })}
            {pending && <div className="nai-typ nai-fresh" role="status" aria-label="Köməkçi yazır…"><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>}
            {fail && (
              <section className="g nai-card nai-fresh" role="alert" aria-label="Xəta">
                <div className="nai-ch"><span className="nchip"><NIcon name="alert" size={16} /></span><h2 className="n-h2">Cavab almaq alınmadı</h2></div>
                <p className="nai-cp">{fail.msg}</p>
                <div className="nai-cb">
                  {!limited && <button type="button" className="nb nb-s nai-sm" onClick={() => send(fail.text, true)}><NIcon name="retry" size={16} />Yenidən cəhd et</button>}
                  <a className="nb nb-s nai-sm" href={waLink(WA_HELP)} target="_blank" rel="noopener"><NIcon name="msg" size={16} />WhatsApp-da yazın</a>
                </div>
              </section>
            )}
            {limited && !pending && (
              <section className="g nai-card nai-fresh" aria-label="Limit">
                <div className="nai-ch"><span className="nchip"><NIcon name="clock" size={16} /></span><h2 className="n-h2">Bu gün üçün limit doldu</h2></div>
                <p className="nai-cp">Sabah yenidən yaza bilərsiniz. Təcili sualınız varsa, WhatsApp-da yazın.</p>
                <a className="nb nb-p nb-full nai-full" href={waLink(WA_HELP)} target="_blank" rel="noopener"><NIcon name="msg" size={18} />WhatsApp-da yazın</a>
              </section>
            )}
          </>
        )}
        <div ref={end} className="nai-end" />
      </div>
      <div className="nai-bar">
        <form className={`nai-cap${limited ? ' off' : ''}`} onSubmit={onSubmit}>
          <label htmlFor="ai-msg" className="nsr">Mesajınız</label>
          <input id="ai-msg" className="nai-in" type="text" autoComplete="off" placeholder="Mesaj yazın…" maxLength={1000} value={text} disabled={limited} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className={`nai-send${fly ? ' fly' : ''}`} aria-label="Göndər" disabled={limited || pending || !text.trim()}><span><NIcon name="up" size={18} sw={2} /></span></button>
        </form>
        <span className="n-meta c3 nai-hint">{limited ? 'Bu gün üçün limit doldu' : `Bu gün qalan sual: ${remaining}`}</span>
      </div>
    </Screen>
  );
}
