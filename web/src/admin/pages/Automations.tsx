import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card } from '../../shared/ui';
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
  send_hour: String(a.send_hour), from: String(a.studio_hours[0]), to: String(a.studio_hours[1]),
  winback: { ...a.winback, days: String(a.winback.days) },
  cashback: { ...a.cashback, min: aznInput(a.cashback.min) },
  birthday: { ...a.birthday, gift: aznInput(a.birthday.gift) },
  review: { ...a.review },
});

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);

/** Formu serverin tələb etdiyi tam obyektə çevirir; səhv varsa mətn qaytarır. */
function toBody(f: Form): { body?: Auto; error?: string } {
  const hour = int(f.send_hour), a = int(f.from), b = int(f.to), days = int(f.winback.days);
  const min = parseAzn(f.cashback.min), gift = parseAzn(f.birthday.gift);
  if (!(hour >= 8 && hour <= 21)) return { error: 'Göndərmə saatı 8 ilə 21 arasında olmalıdır.' };
  if (!(a >= 0 && b <= 24 && a < b)) return { error: 'Studiya iş saatlarını düzgün yazın (məs. 10 və 22).' };
  if (!(days >= 14 && days <= 365)) return { error: 'Geri qaytarma günü 14 ilə 365 arasında olmalıdır.' };
  if (min === null || min < 100) return { error: 'Keşbek həddi ən azı 1 AZN olmalıdır.' };
  if (gift === null || gift > 50000) return { error: 'Ad günü hədiyyəsi 0 ilə 500 AZN arasında olmalıdır.' };
  if (f.review.enabled && !/^https:\/\/\S+$/.test(f.review.url.trim())) return { error: 'Rəy sorğusu üçün https:// ilə başlayan link yazın.' };
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

function AutoCard({ title, desc, v, on, vars, children }: { title: string; desc: string; v: Block; on: (p: Partial<Block>) => void; vars: string; children: ReactNode }) {
  const id = title.replace(/\s/g, '');
  return (
    <Card>
      <div className="row sb" style={{ gap: 12 }}>
        <span className="col" style={{ gap: 2, minWidth: 0 }}><span className="h3">{title}</span><span className="t12 muted">{desc}</span></span>
        <Toggle on={v.enabled} onChange={(enabled) => on({ enabled })} label={title} />
      </div>
      {children}
      <Field label="Başlıq" id={`${id}-t`}><input id={`${id}-t`} className="inp" maxLength={80} value={v.title} onChange={(e) => on({ title: e.target.value })} /></Field>
      <Field label="Mətn" id={`${id}-b`} hint={vars}><textarea id={`${id}-b`} className="inp ta" maxLength={400} value={v.body} onChange={(e) => on({ body: e.target.value })} /></Field>
    </Card>
  );
}

// Avtomatik bildirişlər: hər biri üçün açar, parametr, başlıq və mətn.
export function Automations() {
  const { call } = useAuth();
  const { data, err } = useLoad<Auto>('/automations');
  const save = useAction();
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState('');
  useEffect(() => { if (data) setF(toForm(data)); }, [data]);

  if (!f) return err ? <Err msg={err} /> : <div className="sk" style={{ height: 160, borderRadius: 24 }} aria-busy="true" />;
  const set = <K extends keyof Form>(k: K, p: Partial<Form[K]>) => { setF({ ...f, [k]: { ...(f[k] as object), ...p } }); setMsg(''); };

  async function submit() {
    const r = toBody(f!);
    setMsg(''); setBad(r.error ?? '');
    if (!r.body) return;
    const out = await save.run(() => call<Auto>('/automations', { method: 'PATCH', body: r.body }));
    if (out) { setF(toForm(out)); setMsg('Yadda saxlanıldı.'); }
  }

  return (
    <>
      <div className="banner"><span>Bir müştəriyə gündə ən çox 1, həftədə ən çox 2 avtomatik mesaj gedir. Ad günü hədiyyəsi Təkliflər bağlı olsa da yazılır.</span></div>
      <Card>
        <span className="h3">Ümumi</span>
        <Field label="Göndərmə saatı (8–21)" id="au-h"><input id="au-h" className="inp" inputMode="numeric" value={f.send_hour} onChange={(e) => { setF({ ...f, send_hour: e.target.value }); setMsg(''); }} /></Field>
        <Field label="Studiya iş saatları" hint="«Boş saat» şablonu bu aralığa görə hesablanır.">
          <div className="row" style={{ gap: 8 }}>
            <input className="inp" inputMode="numeric" aria-label="Açılış saatı" value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setMsg(''); }} />
            <span className="muted">–</span>
            <input className="inp" inputMode="numeric" aria-label="Bağlanış saatı" value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setMsg(''); }} />
          </div>
        </Field>
      </Card>
      <div className="rs-cols">
        <AutoCard title="Geri qaytarma" desc="Uzun müddət gəlməyənlərə" v={f.winback} on={(p) => set('winback', p)} vars="Dəyişən: {name} — müştərinin adı.">
          <Field label="Neçə gün gəlməyibsə" id="au-wd"><input id="au-wd" className="inp" inputMode="numeric" value={f.winback.days} onChange={(e) => set('winback', { days: e.target.value })} /></Field>
        </AutoCard>
        <AutoCard title="Keşbek xatırlatma" desc="Balansı xərclənməyənlərə" v={f.cashback} on={(p) => set('cashback', p)} vars="Dəyişən: {name} — ad, {balance} — keşbek balansı.">
          <Field label="Minimum balans (AZN)" id="au-cm"><input id="au-cm" className="inp" inputMode="decimal" value={f.cashback.min} onChange={(e) => set('cashback', { min: e.target.value })} /></Field>
        </AutoCard>
        <AutoCard title="Ad günü" desc="Doğum günündə hədiyyə keşbek" v={f.birthday} on={(p) => set('birthday', p)} vars="Dəyişən: {name} — ad, {gift} — hədiyyə məbləği.">
          <Field label="Hədiyyə (AZN)" id="au-bg"><input id="au-bg" className="inp" inputMode="decimal" value={f.birthday.gift} onChange={(e) => set('birthday', { gift: e.target.value })} /></Field>
        </AutoCard>
        <AutoCard title="Rəy sorğusu" desc="Çəkilişdən sonra rəy istəyi" v={f.review} on={(p) => set('review', p)} vars="Dəyişən: {name} — müştərinin adı.">
          <Field label="Rəy linki (https://…)" id="au-rl"><input id="au-rl" className="inp" inputMode="url" autoCapitalize="none" value={f.review.url} onChange={(e) => set('review', { url: e.target.value })} placeholder="https://g.page/…" /></Field>
        </AutoCard>
      </div>
      <Err msg={bad || save.err} />
      {msg && <p className="t13 neon" role="status">{msg}</p>}
      <Button disabled={save.busy} onClick={submit}>Yadda saxla</Button>
    </>
  );
}
