import { useState } from 'react';
import { useAction, useAuth, useLoad } from '../../../ctx';
import { whenFull } from '../../../components/crm';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, ChangeNote, Dialog, EmptyState, ErrorBox, Field, Segmented, Switch, TextArea, TextInput, useOnline } from '../../ui';
import { Gate } from './kit';
import './tenzimleme.css';

export type Mode = 'draft' | 'auto' | 'new_auto';
export type Settings = { bot_enabled: boolean; bot_mode: Mode; kapso_month_count: number; kapso_month_limit: number };
type Faq = { id: number; question: string; answer: string; active: boolean };
type Quick = { id: number; title: string; text: string };
type Unanswered = { id: number; conversation_id: number | null; question: string; created_at: string };
type TestOut = { reply: string; language: string | null; handoff: boolean; handoff_reason: string | null; filtered?: string | null; lead?: Record<string, unknown> };
type Turn = { role: 'user' | 'bot'; text: string; out?: TestOut };
type Tab = 'qayda' | 'nobe' | 'bilik' | 'hazir';

/** Botun AI açarı: dərhal saxlanır (G9). Həm /tenzimleme/bot, həm /m/bot istifadə edir. */
export function useBotSettings() {
  const { call } = useAuth();
  const s = useLoad<Settings>('/bot/settings');
  const act = useAction();
  async function save(body: Partial<Settings>) {
    const r = await act.run(() => call('/bot/settings', { method: 'POST', body }));
    if (r) s.reload();
    return !!r;
  }
  return { s, act, save };
}

export function KapsoMeter({ d }: { d: Settings }) {
  return (
    <>
      <div className="hs-kv"><span>Bu ay WhatsApp mesajı (Kapso)</span><span className="mono">{d.kapso_month_count} / {d.kapso_month_limit}</span></div>
      <div className="bt-bar"><i style={{ width: `${Math.min(100, (d.kapso_month_count / Math.max(1, d.kapso_month_limit)) * 100)}%` }} /></div>
    </>
  );
}

/** Bot (34-bot.md). Route: /tenzimleme/bot, köhnə /bot. 4 bölmə: Qaydalar, Növbə qaydaları, Bilik bazası, Hazır cavablar. */
export function Bot() {
  const [tab, setTab] = useState<Tab>('qayda');
  return (
    <>
      <PageHeader title="Bot" newShoot={false} sub="Bot necə cavab verir və nəyi bilir" />
      <div className="tz">
        <div className="tz-tabs">
          <Segmented<Tab> label="Bot bölmələri" value={tab} onChange={setTab} options={[
            { value: 'qayda', label: 'Qaydalar' }, { value: 'nobe', label: 'Növbə qaydaları' }, { value: 'bilik', label: 'Bilik bazası' }, { value: 'hazir', label: 'Hazır cavablar' },
          ]} />
        </div>
        {tab === 'qayda' && <Rules />}
        {tab === 'nobe' && <Queue />}
        {tab === 'bilik' && <Knowledge />}
        {tab === 'hazir' && <Quicks />}
      </div>
    </>
  );
}

function Rules() {
  const { s, act, save } = useBotSettings();
  const online = useOnline();
  return (
    <div className="tz-grid2">
      <Card title="AI cavab">
        <Gate q={s} title="Ayarlar yüklənmədi" rows={2}>
          {(d) => (
            <>
              {act.err && <ErrorBox title="Saxlanmadı" detail={act.err} />}
              <div className="bt-switch">
                <span><b>Bot {d.bot_enabled ? 'açıqdır' : 'bağlıdır'}</b><span className="tz-sub" style={{ display: 'block' }}>{d.bot_enabled ? 'WhatsApp-da gələn mesajlara cavab hazırlayır.' : 'Mesajlara cavab hazırlanmır.'}</span></span>
                <Switch ai checked={d.bot_enabled} disabled={act.busy || !online} label="Bot açıq" onChange={(v) => save({ bot_enabled: v })} />
              </div>
              <KapsoMeter d={d} />
              {/* TODO [API] Ötürmə səbəbləri açarları (Şikayət/Məxfi həmişə açıq), ton, gecə qaydaları, dil: serverdə yalnız bot_enabled və bot_mode var. */}
            </>
          )}
        </Gate>
      </Card>
      <Tester />
    </div>
  );
}

function Queue() {
  const { s, act, save } = useBotSettings();
  const online = useOnline();
  const [ask, setAsk] = useState<Mode | null>(null);
  return (
    <Card title="Növbə qaydaları" aside={<span className="tz-aside">Bot cavabı kimin təsdiqi ilə gedir</span>}>
      <Gate q={s} title="Ayarlar yüklənmədi" rows={2}>
        {(d) => (
          <div className="tz-stack">
            {act.err && <ErrorBox title="Saxlanmadı" detail={act.err} />}
            <Segmented<Mode> label="Rejim" value={d.bot_mode} onChange={(v) => (v === 'draft' ? save({ bot_mode: 'draft' }) : setAsk(v))}
              options={[{ value: 'draft', label: 'Qaralama' }, { value: 'new_auto', label: 'Yenilərə avtomatik' }, { value: 'auto', label: 'Avtomatik' }]} />
            <p className="tz-muted">{d.bot_mode === 'draft' ? 'Bot cavabı qaralama kimi hazırlayır, siz təsdiqləyirsiniz.' : d.bot_mode === 'new_auto' ? 'İlk dəfə yazanlara bot təsdiqsiz cavab verir; köhnə müştərilərin qaralaması Telegram-a gəlir.' : 'Bot cavabları təsdiqsiz birbaşa müştəriyə göndərir.'}</p>
            {/* TODO [API] Sessiya/gözləmə vaxtı, növbəyə düşmə qaydaları, Push ötürmə: serverdə yoxdur. */}
            <Dialog open={ask !== null} onClose={() => setAsk(null)} title="Avtomatik rejim?" subtitle={ask === 'new_auto' ? 'İlk dəfə yazanlara bot təsdiqsiz cavab verəcək.' : 'Bot cavabları təsdiqsiz birbaşa müştəriyə göndərəcək.'}
              footer={<><Button variant="text" onClick={() => setAsk(null)}>Ləğv et</Button><Button variant="primary" disabled={act.busy || !online} onClick={async () => { const m = ask; setAsk(null); if (m) await save({ bot_mode: m }); }}>Avtomatikə keç</Button></>}>
              <ChangeNote changes={['Bot cavabları müştəriyə təsdiqsiz göndərilir']} unchanged={['FAQ və hazır cavablar', 'Köhnə söhbətlər']} />
            </Dialog>
          </div>
        )}
      </Gate>
    </Card>
  );
}

function Knowledge() {
  const { call } = useAuth();
  const faqs = useLoad<Faq[]>('/faqs');
  const un = useLoad<Unanswered[]>('/unanswered');
  const act = useAction();
  const online = useOnline();
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [ans, setAns] = useState('');
  const openEdit = (f: Faq | null) => { setEdit(f ? f.id : 'new'); setQ(f?.question ?? ''); setA(f?.answer ?? ''); };
  async function saveFaq() {
    const body = { question: q.trim(), answer: a.trim() };
    const r = await act.run(() => (edit === 'new' ? call('/faqs', { method: 'POST', body }) : call(`/faqs/${edit}`, { method: 'PATCH', body })));
    if (r) { setEdit(null); faqs.reload(); }
  }
  async function active(f: Faq, v: boolean) { if (await act.run(() => call(`/faqs/${f.id}`, { method: 'PATCH', body: { active: v } }))) faqs.reload(); }
  async function resolve(u: Unanswered, answer?: string) {
    const r = await act.run(() => call(`/unanswered/${u.id}/resolve`, { method: 'POST', body: answer ? { answer } : {} }));
    if (r) { setOpen(null); setAns(''); un.reload(); if (answer) faqs.reload(); }
  }
  return (
    <div className="tz-grid2">
      <Card title="Tez-tez verilən suallar" aside={<Button size="row" variant="text" disabled={!online} onClick={() => openEdit(null)}>Sual əlavə et</Button>}>
        {act.err && <ErrorBox title="Əməliyyat alınmadı" detail={act.err} />}
        <Gate q={faqs} title="Suallar yüklənmədi">
          {(list) => list.length === 0 ? <EmptyState title="Hələ sual əlavə edilməyib" reason="Bot cavabı buradan götürür." action={<Button onClick={() => openEdit(null)}>Sual əlavə et</Button>} /> : (
            <>{list.map((f) => (
              <div key={f.id} className="bt-item" data-off={!f.active}>
                <div className="bt-head">
                  <button type="button" className="tz-link" style={{ textAlign: 'left' }} onClick={() => openEdit(f)}><span className="bt-q">{f.question}</span></button>
                  <Switch checked={f.active} disabled={act.busy || !online} label={`Aktiv: ${f.question}`} onChange={(v) => active(f, v)} />
                </div>
                <p className="bt-a">{f.answer}</p>
              </div>
            ))}</>
          )}
        </Gate>
      </Card>
      <Card title="Cavabsız suallar" aside={<span className="tz-aside">Bot bilmədiyi sualları toplayır</span>}>
        <Gate q={un} title="Suallar yüklənmədi" rows={2}>
          {(list) => list.length === 0 ? <EmptyState title="Cavabsız sual yoxdur" /> : (
            <>{list.map((u) => (
              <div key={u.id} className="bt-item">
                <span className="bt-q">{u.question}</span>
                <span className="tz-sub">{whenFull(u.created_at)}</span>
                {open === u.id ? (
                  <>
                    <TextArea aria-label="Cavab" placeholder="Cavabı yazın, bilik bazasına əlavə olunacaq" value={ans} onChange={(e) => setAns(e.target.value)} />
                    <div className="tz-actions"><Button variant="text" onClick={() => setOpen(null)}>Bağla</Button><Button variant="primary" disabled={act.busy || !online || !ans.trim()} onClick={() => resolve(u, ans.trim())}>Bilik bazasına əlavə et</Button></div>
                  </>
                ) : (
                  <div className="tz-actions">
                    {u.conversation_id && <a className="btn btn--secondary btn--row" href={`#/inbox/${u.conversation_id}`}>Söhbətə keç</a>}
                    <Button size="row" disabled={act.busy || !online} onClick={() => { setOpen(u.id); setAns(''); }}>Cavab yaz</Button>
                    <Button size="row" variant="text" disabled={act.busy || !online} onClick={() => resolve(u)}>Həll olunub</Button>
                  </div>
                )}
              </div>
            ))}</>
          )}
        </Gate>
      </Card>
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Yeni sual' : 'Sualı redaktə et'}
        footer={<><Button variant="text" onClick={() => setEdit(null)}>Bağla</Button><Button variant="primary" disabled={act.busy || !online || !q.trim() || !a.trim()} onClick={saveFaq}>Yadda saxla</Button></>}>
        <Field label="Sual">{(id) => <TextInput id={id} maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label="Cavab">{(id) => <TextArea id={id} maxLength={3000} value={a} onChange={(e) => setA(e.target.value)} />}</Field>
        {act.err && <ErrorBox title="Saxlanmadı" detail={act.err} />}
      </Dialog>
    </div>
  );
}

function Quicks() {
  const { call } = useAuth();
  const l = useLoad<Quick[]>('/quick-replies');
  const act = useAction();
  const online = useOnline();
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const [t, setT] = useState('');
  const [x, setX] = useState('');
  const [del, setDel] = useState(false);
  const openEdit = (r: Quick | null) => { setEdit(r ? r.id : 'new'); setT(r?.title ?? ''); setX(r?.text ?? ''); };
  async function save() {
    const body = { title: t.trim(), text: x.trim() };
    const r = await act.run(() => (edit === 'new' ? call('/quick-replies', { method: 'POST', body }) : call(`/quick-replies/${edit}`, { method: 'PATCH', body })));
    if (r) { setEdit(null); l.reload(); }
  }
  async function remove() {
    const r = await act.run(() => call(`/quick-replies/${edit}`, { method: 'DELETE' }));
    setDel(false);
    if (r !== null && r !== undefined) { setEdit(null); l.reload(); }
  }
  return (
    <Card title="Hazır cavablar" aside={<Button size="row" variant="text" disabled={!online} onClick={() => openEdit(null)}>Hazır cavab əlavə et</Button>}>
      <p className="tz-muted" style={{ marginBottom: 6 }}>Söhbətdə bir toxunuşla yazı sahəsinə düşür.</p>
      <Gate q={l} title="Hazır cavablar yüklənmədi">
        {(list) => list.length === 0 ? <EmptyState title="Hələ hazır cavab yoxdur" action={<Button onClick={() => openEdit(null)}>Hazır cavab əlavə et</Button>} /> : (
          <>{list.map((r) => (
            <div key={r.id} className="bt-item">
              <button type="button" className="tz-link" style={{ textAlign: 'left' }} onClick={() => openEdit(r)}><span className="bt-q">{r.title}</span></button>
              <p className="bt-a">{r.text}</p>
            </div>
          ))}</>
        )}
      </Gate>
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Yeni hazır cavab' : 'Hazır cavabı redaktə et'}
        footer={<>{edit !== 'new' && <Button variant="danger" disabled={act.busy || !online} onClick={() => setDel(true)}>Sil</Button>}<Button variant="text" onClick={() => setEdit(null)}>Bağla</Button><Button variant="primary" disabled={act.busy || !online || !t.trim() || !x.trim()} onClick={save}>Yadda saxla</Button></>}>
        <Field label="Başlıq">{(id) => <TextInput id={id} maxLength={80} placeholder="Kart nömrəsi" value={t} onChange={(e) => setT(e.target.value)} />}</Field>
        <Field label="Mətn">{(id) => <TextArea id={id} maxLength={4000} value={x} onChange={(e) => setX(e.target.value)} />}</Field>
        {act.err && <ErrorBox title="Saxlanmadı" detail={act.err} />}
      </Dialog>
      <Dialog open={del} onClose={() => setDel(false)} title="Hazır cavab silinsin?" subtitle={`«${t}» geri qaytarılmır.`}
        footer={<><Button variant="text" onClick={() => setDel(false)}>Geri</Button><Button variant="danger" disabled={act.busy} onClick={remove}>Sil</Button></>} />
    </Card>
  );
}

/** Sınaq pəncərəsi: /bot/test-ə yazır, heç nə göndərilmir və saxlanmır. */
function Tester() {
  const { call } = useAuth();
  const act = useAction();
  const online = useOnline();
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
    <Card title="Sınaq pəncərəsi" aside={turns.length > 0 ? <Button size="row" variant="text" onClick={() => setTurns([])}>Təzədən başla</Button> : undefined}>
      <p className="tz-muted" style={{ marginBottom: 8 }}>Botu yoxlayın. Heç nə göndərilmir və saxlanmır.</p>
      <div className="bt-chat" aria-live="polite">
        {!turns.length && <p className="tz-muted">Müştəri kimi bir mesaj yazın.</p>}
        {turns.map((t, i) => t.role === 'user' ? (
          <div key={i} className="bt-msg"><div className="tz-bubble tz-bubble--in">{t.text}</div></div>
        ) : (
          <div key={i} className="bt-msg bt-msg--bot">
            <div className="bt-who">Bot</div>
            <div className="tz-bubble">{t.text || '(cavab yoxdur)'}</div>
            {t.out && <div className="bt-res">Dil: {t.out.language ?? '—'} · Ötürmə: {t.out.handoff ? `bəli${t.out.handoff_reason ? ` (${t.out.handoff_reason})` : ''}` : 'xeyr'}{t.out.filtered ? ` · Filtr: ${t.out.filtered}` : ''}</div>}
          </div>
        ))}
      </div>
      {act.err && <ErrorBox title="Cavab alınmadı" detail={act.err} />}
      <form className="bt-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <TextInput aria-label="Sınaq mesajı" placeholder="Mesaj yazın…" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <Button variant="secondary" type="submit" disabled={act.busy || !online || !msg.trim()}>{act.busy ? '…' : 'Göndər'}</Button>
      </form>
    </Card>
  );
}
