import { useState } from 'react';
import { AdminShell } from '../../shared/ui';
import { Err, Field, Toggle } from '../components/common';
import { ASeg, ConfirmDialog, PageHead } from '../components/neon';
import { whenFull } from '../components/crm';
import { useAction, useAuth, useLoad } from '../ctx';

type Settings = { bot_enabled: boolean; bot_mode: 'draft' | 'auto'; kapso_month_count: number; kapso_month_limit: number };
type Faq = { id: number; question: string; answer: string; active: boolean };
type Quick = { id: number; title: string; text: string };
type Unanswered = { id: number; conversation_id: number | null; question: string; created_at: string };
type TestOut = {
  reply: string; language: string | null; handoff: boolean; handoff_reason: string | null; intent?: string; stage?: string | null;
  lead?: Record<string, unknown>; filtered?: string | null; unanswered_question?: string | null;
};

export function BotSettings() {
  return (
    <AdminShell active="inbox" title="Bot ayarları" bare full>
      <PageHead title="Bot ayarları" sub="WhatsApp botu necə cavab verir" back="inbox" label="Yazışmalar" />
      <div className="c-bot">
        <Switches />
        <Faqs />
        <Quicks />
        <Unans />
        <Tester />
      </div>
    </AdminShell>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="a-g c-card"><h2 className="c-h3">{title}</h2>{sub && <p className="c-mut">{sub}</p>}{children}</section>;
}

function Switches() {
  const { call } = useAuth();
  const s = useLoad<Settings>('/bot/settings');
  const act = useAction();
  const [ask, setAsk] = useState(false);
  async function save(body: Partial<Settings>) {
    setAsk(false);
    const r = await act.run(() => call('/bot/settings', { method: 'POST', body }));
    if (r) s.reload();
  }
  const d = s.data;
  const pct = d ? Math.min(100, (d.kapso_month_count / Math.max(1, d.kapso_month_limit)) * 100) : 0;
  return (
    <Card title="Bot">
      <Err msg={s.err || act.err} />
      <div className="c-row"><span>Bot {d?.bot_enabled ? 'açıqdır' : 'bağlıdır'}</span><Toggle on={!!d?.bot_enabled} disabled={!d || act.busy} label="Bot açıq" onChange={(v) => save({ bot_enabled: v })} /></div>
      <ASeg<'draft' | 'auto'> pill label="Rejim" disabled={!d || act.busy} value={d?.bot_mode ?? 'draft'}
        options={[{ value: 'draft', label: 'Qaralama (mən təsdiqləyirəm)' }, { value: 'auto', label: 'Avtomatik' }]}
        onChange={(v) => (v === 'auto' ? setAsk(true) : save({ bot_mode: 'draft' }))} />
      <div className="c-kv"><span>Bu ay Kapso mesajı</span><span>{d ? `${d.kapso_month_count} / ${d.kapso_month_limit}` : '…'}</span></div>
      <div className="a3-prog" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <ConfirmDialog open={ask} title="Avtomatik rejim?" text="Bot cavabları təsdiqsiz birbaşa müştəriyə göndərəcək." confirmLabel="Avtomatikə keç" onCancel={() => setAsk(false)} onConfirm={() => save({ bot_mode: 'auto' })} />
    </Card>
  );
}

function Faqs() {
  const { call } = useAuth();
  const l = useLoad<Faq[]>('/faqs');
  const act = useAction();
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  function open(f: Faq | null) { setEdit(f ? f.id : 'new'); setQ(f?.question ?? ''); setA(f?.answer ?? ''); }
  async function save() {
    const body = { question: q.trim(), answer: a.trim() };
    const r = await act.run(() => (edit === 'new' ? call('/faqs', { method: 'POST', body }) : call(`/faqs/${edit}`, { method: 'PATCH', body })));
    if (r) { setEdit(null); l.reload(); }
  }
  async function active(f: Faq, v: boolean) {
    const r = await act.run(() => call(`/faqs/${f.id}`, { method: 'PATCH', body: { active: v } }));
    if (r) l.reload();
  }
  return (
    <Card title="Tez-tez verilən suallar" sub="Bot cavabı buradan götürür. Passiv sual nəzərə alınmır.">
      <Err msg={l.err || act.err} />
      {l.data?.map((f) => (
        <div key={f.id} className={`c-it${f.active ? '' : ' off'}`}>
          <button type="button" className="c-itb" onClick={() => open(f)}><b>{f.question}</b><span>{f.answer}</span></button>
          <Toggle on={f.active} label={`Aktiv: ${f.question}`} disabled={act.busy} onChange={(v) => active(f, v)} />
        </div>
      ))}
      {l.data && !l.data.length && edit === null && <p className="c-mut">Hələ sual əlavə edilməyib.</p>}
      {edit !== null ? (
        <div className="c-box">
          <Field label="Sual" id="f-q"><input id="f-q" className="inp" maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Cavab" id="f-a"><textarea id="f-a" className="inp c-ta" rows={4} maxLength={3000} value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <div className="c-btns">
            <button type="button" className="btn btn-out btn-sm" onClick={() => setEdit(null)}>Bağla</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={act.busy || !q.trim() || !a.trim()} onClick={save}>Yadda saxla</button>
          </div>
        </div>
      ) : <button type="button" className="btn btn-out btn-sm" onClick={() => open(null)}>Sual əlavə et</button>}
    </Card>
  );
}

function Quicks() {
  const { call } = useAuth();
  const l = useLoad<Quick[]>('/quick-replies');
  const act = useAction();
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const [t, setT] = useState('');
  const [x, setX] = useState('');
  function open(r: Quick | null) { setEdit(r ? r.id : 'new'); setT(r?.title ?? ''); setX(r?.text ?? ''); }
  async function save() {
    const body = { title: t.trim(), text: x.trim() };
    const r = await act.run(() => (edit === 'new' ? call('/quick-replies', { method: 'POST', body }) : call(`/quick-replies/${edit}`, { method: 'PATCH', body })));
    if (r) { setEdit(null); l.reload(); }
  }
  return (
    <Card title="Hazır cavablar" sub="Söhbətdə bir toxunuşla yazı sahəsinə düşür.">
      <Err msg={l.err || act.err} />
      {l.data?.map((r) => (
        <div key={r.id} className="c-it"><button type="button" className="c-itb" onClick={() => open(r)}><b>{r.title}</b><span>{r.text}</span></button></div>
      ))}
      {l.data && !l.data.length && edit === null && <p className="c-mut">Hələ hazır cavab yoxdur.</p>}
      {edit !== null ? (
        <div className="c-box">
          <Field label="Başlıq" id="q-t"><input id="q-t" className="inp" maxLength={80} placeholder="Kart nömrəsi" value={t} onChange={(e) => setT(e.target.value)} /></Field>
          <Field label="Mətn" id="q-x"><textarea id="q-x" className="inp c-ta" rows={4} maxLength={4000} placeholder="Kart nömrəsi: …" value={x} onChange={(e) => setX(e.target.value)} /></Field>
          <div className="c-btns">
            <button type="button" className="btn btn-out btn-sm" onClick={() => setEdit(null)}>Bağla</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={act.busy || !t.trim() || !x.trim()} onClick={save}>Yadda saxla</button>
          </div>
        </div>
      ) : <button type="button" className="btn btn-out btn-sm" onClick={() => open(null)}>Hazır cavab əlavə et</button>}
    </Card>
  );
}

function Unans() {
  const { call } = useAuth();
  const l = useLoad<Unanswered[]>('/unanswered');
  const act = useAction();
  const [open, setOpen] = useState<number | null>(null);
  const [ans, setAns] = useState('');
  async function resolve(u: Unanswered, answer?: string) {
    const r = await act.run(() => call(`/unanswered/${u.id}/resolve`, { method: 'POST', body: answer ? { answer } : {} }));
    if (r) { setOpen(null); setAns(''); l.reload(); }
  }
  return (
    <Card title="Cavabsız suallar" sub="Bot bilmədiyi sualları burada toplayır.">
      <Err msg={l.err || act.err} />
      {l.data && !l.data.length && <p className="c-mut">Cavabsız sual yoxdur.</p>}
      {l.data?.map((u) => (
        <div key={u.id} className="c-it c-un">
          <b>{u.question}</b>
          <small className="c-mut">{whenFull(u.created_at)}</small>
          {open === u.id ? (
            <>
              <textarea className="inp c-ta" rows={3} aria-label="Cavab" placeholder="Cavabı yazın, FAQ-a əlavə olunacaq" value={ans} onChange={(e) => setAns(e.target.value)} />
              <div className="c-btns">
                <button type="button" className="btn btn-out btn-sm" onClick={() => setOpen(null)}>Bağla</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={act.busy || !ans.trim()} onClick={() => resolve(u, ans.trim())}>FAQ-a əlavə et</button>
              </div>
            </>
          ) : (
            <div className="c-btns">
              {u.conversation_id && <a className="btn btn-out btn-sm" href={`#/inbox/${u.conversation_id}`}>Söhbətə keç</a>}
              <button type="button" className="btn btn-out btn-sm" disabled={act.busy} onClick={() => { setOpen(u.id); setAns(''); }}>Cavab yaz → FAQ-a əlavə et</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => resolve(u)}>Həll olunub</button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

type Turn = { role: 'user' | 'bot'; text: string; out?: TestOut };

function Tester() {
  const { call } = useAuth();
  const act = useAction();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [msg, setMsg] = useState('');
  async function send() {
    const m = msg.trim();
    if (!m) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    const out = await act.run(() => call<TestOut>('/bot/test', { method: 'POST', timeout: 60000, body: { history, message: m, first_message: !turns.length } }));
    if (out) { setTurns([...turns, { role: 'user', text: m }, { role: 'bot', text: out.reply, out }]); setMsg(''); }
  }
  return (
    <Card title="Sınaq pəncərəsi" sub="Botu yoxlayın. Heç nə göndərilmir və saxlanmır.">
      <div className="c-msgs c-tmsgs" aria-live="polite">
        {!turns.length && <p className="c-mut">Müştəri kimi bir mesaj yazın.</p>}
        {turns.map((t, i) => (
          <div key={i} className={`c-b ${t.role === 'user' ? 'in' : 'out'}`}>
            <span className="c-bt">{t.text || '(cavab yoxdur)'}</span>
            {t.out && (
              <small>
                Dil: {t.out.language ?? '—'} · Ötürmə: {t.out.handoff ? `bəli${t.out.handoff_reason ? ` (${t.out.handoff_reason})` : ''}` : 'xeyr'}
                {t.out.filtered ? ` · Filtr: ${t.out.filtered}` : ''}
                {t.out.lead && Object.entries(t.out.lead).some(([, v]) => v !== null && v !== '') && <><br />Lead: {Object.entries(t.out.lead).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}=${String(v)}`).join(', ')}</>}
              </small>
            )}
          </div>
        ))}
      </div>
      <Err msg={act.err} />
      <form className="c-comp" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea className="inp c-ta" rows={2} aria-label="Sınaq mesajı" placeholder="Mesaj yazın…" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button type="submit" className="a-bp" disabled={act.busy || !msg.trim()}>{act.busy ? '…' : 'Göndər'}</button>
      </form>
      {turns.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTurns([])}>Təzədən başla</button>}
    </Card>
  );
}
