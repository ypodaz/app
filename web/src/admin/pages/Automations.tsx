import { useEffect, useState, type ReactNode } from 'react';
import { AIcon, type AIconName } from '../components/AIcon';
import { Err, Field, Toggle } from '../components/common';
import { useAction, useAuth, useLoad } from '../ctx';
import { aznInput, parseAzn } from '../format';
import type { Automations as Auto } from '../types';

type Block = { enabled: boolean; title: string; body: string };
type Form = {
  send_hour: string; from: string; to: string;
  winback: Block & { days: string }; cashback: Block & { min: string }; birthday: Block & { gift: string }; review: Block & { url: string };
};

const toForm = (a: Auto): Form => ({
  send_hour: String(a.send_hour), from: hhmm(a.studio_hours[0]), to: hhmm(a.studio_hours[1]),
  winback: { ...a.winback, days: String(a.winback.days) },
  cashback: { ...a.cashback, min: aznInput(a.cashback.min) },
  birthday: { ...a.birthday, gift: aznInput(a.birthday.gift) },
  review: { ...a.review },
});

const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;
// Saat sahəsi: «10» və ya «10:00» (server yalnız tam saat saxlayır).
const hourOf = (s: string) => { const m = /^(\d{1,2})(?::00)?$/.exec(s.trim()); return m ? Number(m[1]) : NaN; };
const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);

/** Formu serverin tələb etdiyi tam obyektə çevirir; səhv varsa mətn qaytarır. */
function toBody(f: Form): { body?: Auto; error?: string; field?: string } {
  const hour = int(f.send_hour), a = hourOf(f.from), b = hourOf(f.to), days = int(f.winback.days);
  const min = parseAzn(f.cashback.min), gift = parseAzn(f.birthday.gift);
  if (!(hour >= 8 && hour <= 21)) return { error: 'Göndərmə saatı 8 ilə 21 arasında olmalıdır.', field: 'hour' };
  if (!(a >= 0 && b <= 24 && a < b)) return { error: 'Studiya iş saatlarını düzgün yazın (məs. 10 və 22).', field: 'hours' };
  if (!(days >= 14 && days <= 365)) return { error: 'Geri qaytarma günü 14 ilə 365 arasında olmalıdır.', field: 'days' };
  if (min === null || min < 100) return { error: 'Keşbek həddi ən azı 1 AZN olmalıdır.', field: 'min' };
  if (gift === null || gift > 50000) return { error: 'Ad günü hədiyyəsi 0 ilə 500 AZN arasında olmalıdır.', field: 'gift' };
  if (f.review.enabled && !/^https:\/\/\S+$/.test(f.review.url.trim())) return { error: 'Rəy sorğusu üçün https:// ilə başlayan link yazın.', field: 'url' };
  const t = (x: Block) => ({ enabled: x.enabled, title: x.title.trim(), body: x.body.trim() });
  return {
    body: {
      send_hour: hour, studio_hours: [a, b],
      winback: { ...t(f.winback), days },
      cashback: { ...t(f.cashback), min },
      birthday: { ...t(f.birthday), gift },
      review: { ...t(f.review), url: f.review.url.trim() },
    },
  };
}

function AutoCard({ title, desc, icon, tone, v, on, vars, children }: { title: string; desc: string; icon: AIconName; tone?: 'cb'; v: Block; on: (p: Partial<Block>) => void; vars: string[]; children: ReactNode }) {
  const id = title.replace(/\s/g, '');
  return (
    <section className={`a-g a3-ac${v.enabled ? '' : ' off'}`} aria-label={title}>
      <div className="a3-ach">
        <span className={`a-ic${tone ? ` a-ic-${tone}` : ''}`}><AIcon name={icon} size={16} /></span>
        <span className="a3-act"><b>{title}</b><span>{desc}</span></span>
        <Toggle on={v.enabled} onChange={(enabled) => on({ enabled })} label={title} />
      </div>
      {children}
      <Field label="Başlıq" id={`${id}-t`}><input id={`${id}-t`} className="inp" maxLength={80} value={v.title} onChange={(e) => on({ title: e.target.value })} /></Field>
      <Field label="Mətn" id={`${id}-b`}><textarea id={`${id}-b`} className="inp ta" maxLength={400} value={v.body} onChange={(e) => on({ body: e.target.value })} /></Field>
      <div className="a3-vars"><span>Dəyişənlər</span>{vars.map((x) => <code key={x}>{x}</code>)}</div>
    </section>
  );
}

const FErr = ({ show, msg }: { show: boolean; msg: string }) => show ? <p className="a-ferr" role="alert"><AIcon name="alert" size={16} />{msg}</p> : null;

// Avtomatik bildirişlər: hər biri üçün açar, parametr, başlıq və mətn.
export function Automations() {
  const { call } = useAuth();
  const { data, err } = useLoad<Auto>('/automations');
  const save = useAction();
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState('');
  const [badF, setBadF] = useState('');
  useEffect(() => { if (data) setF(toForm(data)); }, [data]);

  if (!f) return err ? <Err msg={err} /> : <div className="a-sk" style={{ height: 160, borderRadius: 22 }} aria-busy="true" />;
  const set = <K extends keyof Form>(k: K, p: Partial<Form[K]>) => { setF({ ...f, [k]: { ...(f[k] as object), ...p } }); setMsg(''); };

  async function submit() {
    const r = toBody(f!);
    setMsg(''); setBad(r.error ?? ''); setBadF(r.field ?? '');
    if (!r.body) return;
    const out = await save.run(() => call<Auto>('/automations', { method: 'PATCH', body: r.body }));
    if (out) { setF(toForm(out)); setMsg('Yadda saxlanıldı.'); }
  }

  const bi = (k: string) => (badF === k ? ' bad' : '');
  return (
    <>
      <div className="a3-info"><AIcon name="info" size={18} /><span>Bir müştəriyə gündə ən çox 1, həftədə ən çox 2 avtomatik mesaj gedir. Ad günü hədiyyəsi Təkliflər bağlı olsa da yazılır.</span></div>
      <section className="a-g a3-gen" aria-label="Ümumi">
        <h2 className="a-cardh">Ümumi</h2>
        <Field label="Göndərmə saatı (8–21)" id="au-h"><input id="au-h" className={`inp${bi('hour')}`} inputMode="numeric" value={f.send_hour} onChange={(e) => { setF({ ...f, send_hour: e.target.value }); setMsg(''); }} /></Field>
        <FErr show={badF === 'hour'} msg={bad} />
        <div className="a3-two">
          <Field label="Açılış" id="au-f"><input id="au-f" className={`inp${bi('hours')}`} inputMode="numeric" aria-label="Açılış saatı" value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setMsg(''); }} /></Field>
          <Field label="Bağlanış" id="au-t"><input id="au-t" className={`inp${bi('hours')}`} inputMode="numeric" aria-label="Bağlanış saatı" value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setMsg(''); }} /></Field>
        </div>
        <FErr show={badF === 'hours'} msg={bad} />
        <p className="a3-sp"><b>Studiya iş saatları.</b> «Boş saat» şablonu bu aralığa görə hesablanır.</p>
      </section>
      <div className="a3-acs">
        <AutoCard title="Geri qaytarma" desc="Uzun müddət gəlməyənlərə" icon="rotate" v={f.winback} on={(p) => set('winback', p)} vars={['{name}']}>
          <Field label="Neçə gün gəlməyibsə" id="au-wd"><input id="au-wd" className={`inp${bi('days')}`} inputMode="numeric" value={f.winback.days} onChange={(e) => set('winback', { days: e.target.value })} /></Field>
          <FErr show={badF === 'days'} msg={bad} />
        </AutoCard>
        <AutoCard title="Keşbek xatırlatma" desc="Balansı xərclənməyənlərə" icon="coins" tone="cb" v={f.cashback} on={(p) => set('cashback', p)} vars={['{name}', '{balance}']}>
          <Field label="Minimum balans (AZN)" id="au-cm"><input id="au-cm" className={`inp${bi('min')}`} inputMode="decimal" value={f.cashback.min} onChange={(e) => set('cashback', { min: e.target.value })} /></Field>
          <FErr show={badF === 'min'} msg={bad} />
        </AutoCard>
        <AutoCard title="Ad günü" desc="Doğum günündə hədiyyə keşbek" icon="gift" v={f.birthday} on={(p) => set('birthday', p)} vars={['{name}', '{gift}']}>
          <Field label="Hədiyyə (AZN)" id="au-bg"><input id="au-bg" className={`inp${bi('gift')}`} inputMode="decimal" value={f.birthday.gift} onChange={(e) => set('birthday', { gift: e.target.value })} /></Field>
          <FErr show={badF === 'gift'} msg={bad} />
        </AutoCard>
        <AutoCard title="Rəy sorğusu" desc="Çəkilişdən sonra rəy istəyi" icon="star" v={f.review} on={(p) => set('review', p)} vars={['{name}']}>
          <Field label="Rəy linki" id="au-rl"><input id="au-rl" className={`inp${bi('url')}`} inputMode="url" autoCapitalize="none" value={f.review.url} onChange={(e) => set('review', { url: e.target.value })} placeholder="https://g.page/…" /></Field>
          <FErr show={badF === 'url'} msg={bad} />
        </AutoCard>
      </div>
      <Err msg={(badF ? '' : bad) || save.err} />
      <div className="a3-save">
        <button type="button" className="a-bp" disabled={save.busy} onClick={submit}>Yadda saxla</button>
        {msg && <p className="a3-saved" role="status"><AIcon name="check" size={16} /> {msg}</p>}
      </div>
    </>
  );
}
