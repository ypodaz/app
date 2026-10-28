import { useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../shared/api';
import { Card, EmptyState, Icon } from '../shared/ui';
import { AuthCtx, ErrorState, Loading, Screen, useApi, XIcon } from './core';
import { waLink } from './util';

// ---------- AI dəstəkçi (A5a–A5f) ----------
type Msg = { role: 'user' | 'model'; text: string; created_at?: string; whatsapp?: boolean };
type AiData = { enabled: boolean; remaining: number; messages: Msg[] };
type Reply = { text: string; whatsapp: boolean; remaining: number };

const SUGGEST = ['Qiymətlər', 'Çəkilişə necə hazırlaşım?', 'Reels mətnimi axıcı et', 'Mənə kontent ideyası ver'];
const WA_HELP = 'Salam, AI dəstəkçi ilə bağlı yazıram.';

function WaButton({ text, label = 'WhatsApp-da yazın', cls = 'btn btn-cream' }: { text: string; label?: string; cls?: string }) {
  return <a className={cls} href={waLink(text)} target="_blank" rel="noopener" style={{ alignSelf: 'flex-start' }}><XIcon name="wa" size={18} />{label}</a>;
}

function Top() {
  return <div className="top"><h1 className="h1" style={{ fontSize: 22 }}>AI dəstəkçi</h1></div>;
}

export function AiChat() {
  const { token } = useContext(AuthCtx);
  const q = useApi<AiData>('/me/ai');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [fail, setFail] = useState<{ text: string; msg: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (q.data) { setMsgs(q.data.messages); setRemaining(q.data.remaining); } }, [q.data]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, pending, fail]);

  async function send(t: string, retry = false) {
    const body = t.trim();
    if (!body || pending) return;
    setFail(null); setPending(true);
    if (!retry) { setMsgs((m) => [...m, { role: 'user', text: body }]); setText(''); }
    try {
      const r = await api<Reply>('/me/ai', { token, body: { text: body } });
      setMsgs((m) => [...m, { role: 'model', text: r.text, whatsapp: r.whatsapp }]);
      setRemaining(r.remaining);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429 && /limit/i.test(err.message)) setRemaining(0);
      setFail({ text: body, msg: err.status === 0 ? 'Bağlantıda problem oldu. Yenidən cəhd edin və ya bizə yazın.' : err.message });
    } finally { setPending(false); }
  }

  const d = q.data;
  if (!d) return <Screen tab="ai"><Top />{q.loading ? <Loading /> : <ErrorState q={q} />}</Screen>;
  if (!d.enabled) {
    return (
      <Screen tab="ai">
        <Top />
        <EmptyState icon="sparkle" title="AI köməkçi tezliklə" text="Tezliklə burada suallarınıza cavab verəcək və kontent ideyaları təklif edəcək. Hələlik bizə WhatsApp-da yazın."
          action={<a className="btn btn-cream" href={waLink(WA_HELP)} target="_blank" rel="noopener"><XIcon name="wa" size={18} />WhatsApp-da yazın</a>} />
      </Screen>
    );
  }
  const limited = remaining <= 0;
  return (
    <Screen tab="ai">
      <Top />
      <div className="aichat">
        {msgs.length === 0 && !pending ? (
          <div className="col ctr" style={{ gap: 18, padding: '24px 0 0' }}>
            <span className="ic ic-grad ic-l" style={{ width: 72, height: 72, borderRadius: 36 }}><Icon name="sparkle" size={32} /></span>
            <h2 className="h2" style={{ maxWidth: 300 }}>Studiya haqqında soruşun və ya kontentiniz üzərində birlikdə işləyək</h2>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {SUGGEST.map((s) => <button key={s} type="button" className="chip" disabled={limited} onClick={() => send(s)}>{s}</button>)}
            </div>
            <p className="hint" style={{ maxWidth: 300 }}>Montaj və çəkiliş studiya komandası tərəfindən edilir; dəstəkçi sual və mətnlərdə kömək edir.</p>
          </div>
        ) : (
          <div className="chat">
            {msgs.map((m, i) => (
              <div key={i} className="col" style={{ gap: 8, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', minWidth: 0 }}>
                <div className={`msg ${m.role === 'user' ? 'msg-me' : 'msg-ai'}`}>{m.text}</div>
                {m.role === 'model' && m.whatsapp && <WaButton text={WA_HELP} />}
              </div>
            ))}
            {pending && <div className="msg msg-ai" role="status" aria-label="Cavab yazılır"><span className="typing"><i /><i /><i /></span> <span className="t12 muted">yazır…</span></div>}
            {fail && (
              <div className="banner" role="alert" style={{ flexDirection: 'column', gap: 10 }}>
                <span className="row" style={{ alignItems: 'flex-start' }}><Icon name="alert" size={20} /><span className="col" style={{ minWidth: 0 }}><b className="w8 t14">Cavab almaq alınmadı</b><span className="t13 soft" style={{ overflowWrap: 'anywhere' }}>{fail.msg}</span></span></span>
                <div className="btns">
                  {!limited && <button type="button" className="btn btn-sm" onClick={() => send(fail.text, true)}><XIcon name="retry" size={16} />Yenidən cəhd et</button>}
                  <a className="btn btn-sm btn-out" href={waLink(WA_HELP)} target="_blank" rel="noopener"><XIcon name="wa" size={16} />WhatsApp-da yazın</a>
                </div>
              </div>
            )}
            {limited && !pending && (
              <Card tone="accent">
                <h3 className="h2">Bu gün üçün limit doldu</h3>
                <p className="t14 soft lh">Sabah yenidən yaza bilərsiniz. Təcili sualınız varsa, WhatsApp-da yazın.</p>
                <WaButton text={WA_HELP} />
              </Card>
            )}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="aibar">
        <div className="aibar-in">
          <form onSubmit={(e) => { e.preventDefault(); send(text); }} style={limited ? { opacity: 0.4 } : undefined}>
            <input className="inp" type="text" placeholder="Mesaj yazın…" aria-label="Mesaj" maxLength={1000} value={text} disabled={limited} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="iconbtn iconbtn-cream" aria-label="Göndər" disabled={limited || pending || !text.trim()}><XIcon name="send" /></button>
          </form>
          <span className="hint">{limited ? 'Bu gün üçün limit doldu' : `Bu gün qalan sual: ${remaining}`}</span>
        </div>
      </div>
    </Screen>
  );
}
