import { useState } from 'react';
import { AdminShell } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { AEmpty, ADate, stag } from '../components/a3';
import { ASeg, ConfirmDialog, useToast } from '../components/neon';
import { Err, Field, serviceName } from '../components/common';
import { useAction, useAuth, useLoad } from '../ctx';
import { addDays, bakuParts, bakuToday, dateShort, dateWd, range } from '../format';
import { useDesktop } from '../router';
import type { Material, Production, Shoot } from '../types';

// B5: materiallar. Bağlanmış çəkilişlər (montajlılar «Gözləyənlər»də): status, təhvil tarixi, Drive linki.
export function Materials() {
  const today = bakuToday();
  const desktop = useDesktop();
  const { data, err, reload } = useLoad<Shoot[]>(`/shoots?${range(addDays(today, -120), addDays(today, 14))}`);
  const [all, setAll] = useState(false);
  const list = (data ?? []).filter((s) => s.status === 'completed' && (all || (s.editing && s.production !== 'ready'))).reverse();
  // Masonry: kompüterdə iki sütun (tək/cüt sıra), digər ölçülərdə tək sütun.
  const col = (n: number) => list.filter((_, i) => i % 2 === n).map((s) => <MaterialCard key={s.id} s={s} idx={list.indexOf(s)} onChange={reload} />);
  return (
    <AdminShell
      active="materials"
      title="Materiallar"
      sub="Çəkilişlərin montaj statusu və Drive linkləri"
      actions={<ASeg<'wait' | 'all'> label="Filtr" pill className="a3-tabs a3-tabs2" value={all ? 'all' : 'wait'} onChange={(v) => setAll(v === 'all')} options={[{ value: 'wait', label: 'Gözləyənlər' }, { value: 'all', label: 'Hamısı' }]} />}
    >
      <Err msg={err} />
      {desktop ? <div className="a3-pkg2"><div>{col(0)}</div><div>{col(1)}</div></div> : <div className="a3-pkg1">{list.map((s, i) => <MaterialCard key={s.id} s={s} idx={i} onChange={reload} />)}</div>}
      {data && !list.length && <AEmpty icon="folder" title="Material gözləyən çəkiliş yoxdur" text="Montajlı bağlanmış çəkilişlər burada görünəcək. Montajsız çəkilişlər «Hamısı»ndadır." />}
    </AdminShell>
  );
}

const PROD: Record<Production, { label: string; cls: string }> = { none: { label: 'Gözləyir', cls: 'off' }, editing: { label: 'Montajda', cls: 'mat' }, ready: { label: 'Hazırdır', cls: 'cb' } };

export function MaterialCard({ s, idx = 0, onChange }: { s: Shoot; idx?: number; onChange: () => void }) {
  const { call } = useAuth();
  const [prod, setProd] = useState<Production>(s.production);
  const [delivery, setDelivery] = useState(s.delivery_on ?? '');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [ask, setAsk] = useState<Material | null>(null);
  const save = useAction();
  const add = useAction();
  const del = useAction();
  const toast = useToast();
  const urlOk = /^https:\/\/\S+$/.test(url.trim());
  const p = bakuParts(s.starts_at);

  async function saveStatus() {
    if (await save.run(() => call(`/shoots/${s.id}/production`, { method: 'PATCH', body: { production: prod, delivery_on: delivery || null } })) !== undefined) { onChange(); toast.show('Yadda saxlanıldı'); }
  }
  async function addLink() {
    if (await add.run(() => call<Material>(`/shoots/${s.id}/materials`, { body: { title: title.trim(), drive_url: url.trim() } })) !== undefined) { setTitle(''); setUrl(''); onChange(); }
  }
  async function remove(m: Material) {
    setAsk(null);
    if (await del.run(() => call(`/materials/${m.id}`, { method: 'DELETE' })) !== undefined) onChange();
  }

  return (
    <section className="a-g a3-mc a-rise" style={stag(idx)} aria-label={s.client_name ?? undefined}>
      <span className="a-hot-glow a3-glow-m" aria-hidden="true" />
      <div className="a3-mh">
        <span className="a-ic a-ic-mat"><AIcon name="folder" size={16} /></span>
        <span className="a3-mt">
          <span className="a3-mn1"><b>{s.client_name}</b><em>Bilet #{s.id}</em></span>
          <span className="a3-ms">{serviceName(s)} · {s.cameras} kamera · {dateShort(p.date)}, {p.time}</span>
        </span>
        <span className={`a-chip a3-pc a3-pc-${PROD[s.production].cls}`}><i />{PROD[s.production].label}</span>
      </div>
      <span className="a3-lb">Status</span>
      <ASeg<Production> label="Status" value={prod} onChange={setProd} pill className="a3-mseg" options={[{ value: 'none', label: 'Gözləyir' }, { value: 'editing', label: 'Montajda', tone: 'mat' }, { value: 'ready', label: 'Hazırdır', tone: 'ok' }]} />
      {prod === 'ready' && <div className="a3-ban ok a3-drop"><AIcon name="bell" size={18} /><span>Hazırdır seçiləndə müştəriyə bildiriş göndəriləcək.</span></div>}
      <Field label="Təhvil tarixi" id={`dl-${s.id}`}><ADate id={`dl-${s.id}`} value={delivery} onChange={setDelivery} text={delivery ? dateWd(delivery) : ''} /></Field>
      <Err msg={save.err} />
      <button type="button" className="a-bp a3-fit" disabled={save.busy} onClick={saveStatus}>Statusu yadda saxla</button>
      <hr className="a3-hr2" />
      <h3 className="a3-dh">Drive linkləri</h3>
      {s.materials.map((m) => (
        <div key={m.id} className="a3-ln">
          <AIcon name="drive" size={18} />
          <span>{m.title}</span>
          <a className="a3-lo" href={m.drive_url} target="_blank" rel="noopener" aria-label={`${m.title} — aç`}><AIcon name="ext" size={18} /></a>
          <button type="button" className="a3-lo" aria-label={`${m.title} sil`} onClick={() => setAsk(m)}><AIcon name="x" size={18} /></button>
        </div>
      ))}
      {!s.materials.length && <p className="a3-nol">Hələ link əlavə olunmayıb.</p>}
      <div className="a3-addl">
        <Field label="Material adı" id={`mt-${s.id}`}><input id={`mt-${s.id}`} className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="məs. Söhbət #13" /></Field>
        <Field label="Google Drive linki" id={`mu-${s.id}`} hint="Link https:// ilə başlamalıdır."><input id={`mu-${s.id}`} className={`inp${url && !urlOk ? ' inp-err' : ''}`} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://drive.google.com/…" /></Field>
        <Err msg={add.err || del.err} />
        <button type="button" className="a-bg a3-fit" disabled={!title.trim() || !urlOk || add.busy} onClick={addLink}><AIcon name="plus" size={18} /> Link əlavə et</button>
      </div>
      <ConfirmDialog open={!!ask} confirmLabel="Sil" title="Link silinsin?" text={`«${ask?.title}» linki materialdan silinəcək.`} onCancel={() => setAsk(null)} onConfirm={() => ask && remove(ask)} />
      {toast.node}
    </section>
  );
}
