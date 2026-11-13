import { useEffect, useState } from 'react';
import { useAction, useAuth, useLoad } from '../../../ctx';
import { aznInput, parseAzn } from '../../../format';
import type { Automations } from '../../../types';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, ErrorBox, Field, Switch, TextArea, TextInput, UnitInput, useOnline, useToast, V2Icon } from '../../ui';
import { Gate } from './kit';
import './tenzimleme.css';

type Key = 'winback' | 'cashback' | 'birthday' | 'review';
type Block = { enabled: boolean; title: string; body: string };
type Form = {
  send_hour: string; from: string; to: string;
  winback: Block & { days: string }; cashback: Block & { min: string }; birthday: Block & { gift: string }; review: Block & { url: string };
};
const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;
const hourOf = (s: string) => { const m = /^(\d{1,2})(?::00)?$/.exec(s.trim()); return m ? Number(m[1]) : NaN; };
const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);
const toForm = (a: Automations): Form => ({
  send_hour: String(a.send_hour), from: hhmm(a.studio_hours[0]), to: hhmm(a.studio_hours[1]),
  winback: { ...a.winback, days: String(a.winback.days) }, cashback: { ...a.cashback, min: aznInput(a.cashback.min) },
  birthday: { ...a.birthday, gift: aznInput(a.birthday.gift) }, review: { ...a.review },
});
/** Formu serverin tələb etdiyi tam obyektə çevirir; səhv varsa mətn + sahə qaytarır. */
function toBody(f: Form): { body?: Automations; error?: string; field?: string } {
  const hour = int(f.send_hour), a = hourOf(f.from), b = hourOf(f.to), days = int(f.winback.days);
  const min = parseAzn(f.cashback.min), gift = parseAzn(f.birthday.gift);
  if (!(hour >= 8 && hour <= 21)) return { error: 'Göndərmə saatı 8 ilə 21 arasında olmalıdır.', field: 'hour' };
  if (!(a >= 0 && b <= 24 && a < b)) return { error: 'Studiya iş saatlarını düzgün yazın (məs. 10 və 22).', field: 'hours' };
  if (!(days >= 14 && days <= 365)) return { error: 'Geri qaytarma günü 14 ilə 365 arasında olmalıdır.', field: 'winback' };
  if (min === null || min < 100) return { error: 'Keşbek həddi ən azı 1 AZN olmalıdır.', field: 'cashback' };
  if (gift === null || gift > 50000) return { error: 'Ad günü hədiyyəsi 0 ilə 500 AZN arasında olmalıdır.', field: 'birthday' };
  if (f.review.enabled && !/^https:\/\/\S+$/.test(f.review.url.trim())) return { error: 'Rəy sorğusu üçün https:// ilə başlayan link yazın.', field: 'review' };
  const t = (x: Block) => ({ enabled: x.enabled, title: x.title.trim(), body: x.body.trim() });
  return { body: { send_hour: hour, studio_hours: [a, b], winback: { ...t(f.winback), days }, cashback: { ...t(f.cashback), min }, birthday: { ...t(f.birthday), gift }, review: { ...t(f.review), url: f.review.url.trim() } } };
}

const RULES: { key: Key; title: string; when: string; vars: string[]; param: string }[] = [
  { key: 'winback', title: 'Geri qaytarma', when: 'Müştəri gəlməyəndən N gün sonra', vars: ['{name}'], param: 'days' },
  { key: 'cashback', title: 'Keşbek xatırlatma', when: 'Balans həddi aşanda və xərclənməyəndə', vars: ['{name}', '{balance}'], param: 'min' },
  { key: 'birthday', title: 'Ad günü', when: 'Doğum günündə, hədiyyə keşbek ilə', vars: ['{name}', '{gift}'], param: 'gift' },
  { key: 'review', title: 'Rəy sorğusu', when: 'Çəkilişdən sonra rəy istəyi', vars: ['{name}'], param: 'url' },
];
const paramText = (k: Key, f: Form) => k === 'winback' ? `${f.winback.days} gün` : k === 'cashback' ? `≥ ${f.cashback.min} AZN` : k === 'birthday' ? `${f.birthday.gift} AZN hədiyyə` : (f.review.url || 'link yoxdur');

/** Avtomat qaydalar (33-avtomat.md). Route: /tenzimleme/avtomat, köhnə /automations. Açar dərhal yadda qalır (G9). */
export function Avtomat() {
  const { call } = useAuth();
  const q = useLoad<Automations>('/automations');
  const save = useAction();
  const online = useOnline();
  const toast = useToast();
  const [f, setF] = useState<Form | null>(null);
  const [open, setOpen] = useState<Key | null>(null);
  const [bad, setBad] = useState<{ field: string; error: string } | null>(null);
  useEffect(() => { if (q.data) setF(toForm(q.data)); }, [q.data]);

  async function commit(next: Form, msg?: string) {
    const r = toBody(next);
    setBad(r.body ? null : { field: r.field!, error: r.error! });
    if (!r.body) return false;
    const out = await save.run(() => call<Automations>('/automations', { method: 'PATCH', body: r.body }));
    if (out) { setF(toForm(out)); if (msg) toast.show(msg); return true; }
    return false;
  }
  const patch = <K extends Key>(k: K, p: Partial<Form[K]>) => setF((x) => x && ({ ...x, [k]: { ...x[k], ...p } }));
  async function flip(k: Key, enabled: boolean) {
    if (!f) return;
    const next = { ...f, [k]: { ...f[k], enabled } };
    setF(next); // dərhal görünür; xəta olsa serverdən qayıdan dəyər / köhnə forma bərpa olunur
    if (!(await commit(next, enabled ? 'Qayda açıldı' : 'Qayda söndürüldü')) && q.data) setF(toForm(q.data));
  }

  // «Ümumi» sahələri çıxanda saxlanır, dəyişməyibsə sorğu getmir
  function general() {
    if (!f) return;
    const o = q.data && toForm(q.data);
    if (o && o.send_hour === f.send_hour && o.from === f.from && o.to === f.to) return;
    commit(f, 'Yadda saxlanıldı');
  }
  const err = (field: string) => (bad?.field === field ? bad.error : undefined);
  return (
    <>
      <PageHeader title="Avtomat qaydalar" newShoot={false} sub="Müştərilərə vaxtında, özü gedən mesajlar" />
      <div className="tz">
        <div className="tz-info"><V2Icon name="alert" size={14} /><span>Bir müştəriyə gündə ən çox 1, həftədə ən çox 2 avtomatik mesaj gedir. Ad günü hədiyyəsi Təkliflər bağlı olsa da yazılır.</span></div>
        {save.err && <ErrorBox title="Yadda saxlanmadı" detail={save.err} />}
        <Gate q={q} title="Qaydalar yüklənmədi">
          {() => f && (
            <>
              <Card title="Qaydalar">
                {RULES.map((r) => {
                  const b = f[r.key];
                  return (
                    <div key={r.key} className="au-row" data-off={!b.enabled}>
                      <div className="au-line">
                        <span className="au-sw"><Switch checked={b.enabled} disabled={save.busy || !online} label={r.title} onChange={(v) => flip(r.key, v)} /><b>{r.title}</b></span>
                        <span className="au-box"><small>Nə vaxt</small><b>{r.when}</b></span>
                        <span className="au-arrow"><V2Icon name="chev" size={14} /></span>
                        <span className="au-box"><small>Mesaj · {paramText(r.key, f)}</small><b className="tz-clip">{b.title || '—'}</b></span>
                        <Button size="row" variant="text" onClick={() => { setOpen(open === r.key ? null : r.key); setBad(null); }}>{open === r.key ? 'Bağla' : 'Redaktə et'}</Button>
                      </div>
                      {/* TODO [API] Son işləmə vaxtı və aylıq göndərmə sayı (33): qayda başına statistika yoxdur. «Yeni qayda» və ⋯ menyusu (təkrar/sil): yalnız 4 sabit qayda var. */}
                      {open === r.key && (
                        <div className="au-edit">
                          {r.key === 'winback' && <Field label="Neçə gün gəlməyibsə" error={err('winback')}>{(id, inv) => <TextInput id={id} invalid={inv} inputMode="numeric" value={f.winback.days} onChange={(e) => patch('winback', { days: e.target.value })} />}</Field>}
                          {r.key === 'cashback' && <Field label="Minimum balans" error={err('cashback')}>{(id, inv) => <UnitInput id={id} unit="AZN" invalid={inv} inputMode="decimal" value={f.cashback.min} onChange={(e) => patch('cashback', { min: e.target.value })} />}</Field>}
                          {r.key === 'birthday' && <Field label="Hədiyyə" error={err('birthday')}>{(id, inv) => <UnitInput id={id} unit="AZN" invalid={inv} inputMode="decimal" value={f.birthday.gift} onChange={(e) => patch('birthday', { gift: e.target.value })} />}</Field>}
                          {r.key === 'review' && <Field label="Rəy linki" error={err('review')}>{(id, inv) => <TextInput id={id} invalid={inv} inputMode="url" autoCapitalize="none" value={f.review.url} onChange={(e) => patch('review', { url: e.target.value })} placeholder="https://g.page/…" />}</Field>}
                          <Field label="Başlıq">{(id) => <TextInput id={id} maxLength={80} value={b.title} onChange={(e) => patch(r.key, { title: e.target.value })} />}</Field>
                          <Field label="Mətn">{(id) => <TextArea id={id} maxLength={400} value={b.body} onChange={(e) => patch(r.key, { body: e.target.value })} />}</Field>
                          <div className="tz-vars"><span className="tz-muted">Dəyişənlər</span>{r.vars.map((v) => <code key={v} className="tz-var">{v}</code>)}</div>
                          <div className="tz-actions tz-actions--end">
                            <Button variant="primary" disabled={save.busy || !online} onClick={async () => { if (await commit(f, 'Yadda saxlanıldı')) setOpen(null); }}>Yadda saxla</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
              <Card title="Ümumi">
                <div className="tz-row2">
                  <Field label="Göndərmə saatı (8–21)" error={err('hour')}>{(id, inv) => <TextInput id={id} invalid={inv} inputMode="numeric" value={f.send_hour} onChange={(e) => setF({ ...f, send_hour: e.target.value })} onBlur={general} />}</Field>
                  <Field label="Studiya açılışı" error={err('hours')}>{(id, inv) => <TextInput id={id} invalid={inv} inputMode="numeric" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} onBlur={general} />}</Field>
                  <Field label="Bağlanış">{(id, inv) => <TextInput id={id} invalid={inv} inputMode="numeric" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} onBlur={general} />}</Field>
                </div>
                <p className="tz-muted" style={{ marginTop: 8 }}>Studiya iş saatları «Boş saat» şablonu üçün istifadə olunur.</p>
              </Card>
            </>
          )}
        </Gate>
      </div>
    </>
  );
}
