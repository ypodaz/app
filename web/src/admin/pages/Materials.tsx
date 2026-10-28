import { useState } from 'react';
import { AdminShell, Button, Card, EmptyState, Icon, Segmented } from '../../shared/ui';
import { Err, Field, ShootTicket } from '../components/common';
import { useAction, useAuth, useLoad } from '../ctx';
import { addDays, bakuToday, range } from '../format';
import type { Material, Production, Shoot } from '../types';

// B5: materiallar. Bağlanmış çəkilişlər (montajlılar «Gözləyənlər»də): status, təhvil tarixi, Drive linki.
export function Materials() {
  const today = bakuToday();
  const { data, err, reload } = useLoad<Shoot[]>(`/shoots?${range(addDays(today, -120), addDays(today, 14))}`);
  const [all, setAll] = useState(false);
  const list = (data ?? []).filter((s) => s.status === 'completed' && (all || (s.editing && s.production !== 'ready'))).reverse();
  return (
    <AdminShell active="materials" title="Materiallar">
      <Segmented label="Filtr" value={all ? 'all' : 'wait'} onChange={(v) => setAll(v === 'all')} options={[{ value: 'wait', label: 'Gözləyənlər' }, { value: 'all', label: 'Hamısı' }]} />
      <Err msg={err} />
      <div className="rs-cols">{list.map((s) => <MaterialCard key={s.id} s={s} onChange={reload} />)}</div>
      {data && !list.length && <EmptyState icon="media" title="Material gözləyən çəkiliş yoxdur" text="Montajlı bağlanmış çəkilişlər burada görünəcək. Montajsız çəkilişlər «Hamısı»ndadır." />}
    </AdminShell>
  );
}

export function MaterialCard({ s, onChange }: { s: Shoot; onChange: () => void }) {
  const { call } = useAuth();
  const [prod, setProd] = useState<Production>(s.production);
  const [delivery, setDelivery] = useState(s.delivery_on ?? '');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const save = useAction();
  const add = useAction();
  const del = useAction();
  const urlOk = /^https:\/\/\S+$/.test(url.trim());

  async function saveStatus() {
    if (await save.run(() => call(`/shoots/${s.id}/production`, { method: 'PATCH', body: { production: prod, delivery_on: delivery || null } })) !== undefined) onChange();
  }
  async function addLink() {
    if (await add.run(() => call<Material>(`/shoots/${s.id}/materials`, { body: { title: title.trim(), drive_url: url.trim() } })) !== undefined) { setTitle(''); setUrl(''); onChange(); }
  }
  async function remove(m: Material) {
    if (confirm(`"${m.title}" silinsin?`) && await del.run(() => call(`/materials/${m.id}`, { method: 'DELETE' })) !== undefined) onChange();
  }

  return (
    <Card>
      <ShootTicket s={s}><span className="t15 w8">{s.client_name}</span></ShootTicket>
      <span className="lbl">Status</span>
      <Segmented label="Status" value={prod} onChange={setProd} options={[{ value: 'none', label: 'Gözləyir' }, { value: 'editing', label: 'Montajda' }, { value: 'ready', label: 'Hazırdır' }]} />
      <Field label="Təhvil tarixi" id={`dl-${s.id}`}><input id={`dl-${s.id}`} type="date" className="inp" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
      {prod === 'ready' && <div className="banner"><Icon name="alert" size={18} /><span><b>Hazırdır seçiləndə müştəriyə bildiriş göndəriləcək.</b></span></div>}
      <Err msg={save.err} />
      <Button variant="cream" small disabled={save.busy} onClick={saveStatus}>Statusu yadda saxla</Button>
      <hr className="hr" />
      <span className="lbl">Drive linkləri</span>
      {s.materials.map((m) => (
        <div key={m.id} className="row">
          <Icon name="link" size={18} />
          <a className="t13 w7 grow" href={m.drive_url} target="_blank" rel="noopener" style={{ overflowWrap: 'anywhere' }}>{m.title}</a>
          <button type="button" className="iconbtn" aria-label={`${m.title} sil`} onClick={() => remove(m)}><Icon name="close" size={18} /></button>
        </div>
      ))}
      <Field label="Material adı" id={`mt-${s.id}`}><input id={`mt-${s.id}`} className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="məs. Söhbət #13" /></Field>
      <Field label="Google Drive linki" id={`mu-${s.id}`} hint="Link https:// ilə başlamalıdır."><input id={`mu-${s.id}`} className={`inp${url && !urlOk ? ' inp-err' : ''}`} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://drive.google.com/…" /></Field>
      <Err msg={add.err || del.err} />
      <Button small disabled={!title.trim() || !urlOk || add.busy} onClick={addLink}>Link əlavə et</Button>
    </Card>
  );
}
