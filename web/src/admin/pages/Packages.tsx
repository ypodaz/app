import { useEffect, useState } from 'react';
import { AdminShell, Button, Card, EmptyState, Icon, Stepper, formatHours, formatMoney } from '../../shared/ui';
import { Avatar, BackLink, Err, Field } from '../components/common';
import { ClientPickerSheet } from '../components/ClientPicker';
import { useAction, useAuth, useLoad } from '../ctx';
import { bakuToday, dateFull } from '../format';
import { go } from '../router';
import type { Client, Package } from '../types';

const SIZES: [number, number][] = [[5, 2], [10, 4], [15, 8], [20, 12]]; // saat → ay

// B7a: paketlər
export function Packages() {
  const { call } = useAuth();
  const { data, err, reload } = useLoad<Package[]>('/packages');
  const [addTo, setAddTo] = useState<Package | null>(null);
  const act = useAction();
  const today = bakuToday();
  const remove = (p: Package, cid: number) => act.run(() => call(`/packages/${p.id}/members/${cid}`, { method: 'DELETE' })).then((r) => r !== undefined && reload());
  const add = (c: Client) => addTo && act.run(() => call(`/packages/${addTo.id}/members`, { body: { client_id: c.id } })).then((r) => r !== undefined && reload());

  return (
    <AdminShell active="packages" title="Paketlər" actions={<a className="btn btn-primary btn-sm btn-auto" href="#/packages/new"><Icon name="plus" size={18} strokeWidth={2.4} /> Paket</a>}>
      <Err msg={err || act.err} />
      <div className="rs-cols">
        {data?.map((p) => {
          const left = p.minutes_left / p.minutes_total;
          const days = Math.ceil((Date.parse(p.ends_on) - Date.parse(today)) / 86400000);
          return (
            <Card key={p.id} tone="cream">
              <span className="lbl">{days < 0 ? 'Müddəti bitib' : 'Aktiv paket'}</span>
              <span className="t15 w8">{p.title} · {p.minutes_total / 60} saat · {p.cameras} kamera</span>
              <span className="num-l">{String(p.minutes_left / 60).replace('.', ',')}<span className="unit" style={{ fontSize: 20 }}> / {p.minutes_total / 60} saat</span></span>
              <div className="prog" role="progressbar" aria-valuemin={0} aria-valuemax={p.minutes_total / 60} aria-valuenow={p.minutes_left / 60} aria-label="Qalan saat"><span style={{ width: `${left * 100}%` }} /></div>
              <span className="t13 w7">{dateFull(p.starts_on)} – {dateFull(p.ends_on)}</span>
              <span className="t13 w8">Sahibi: {p.owner_name}</span>
              {days >= 0 && days <= 30 && <div className="banner" style={{ color: '#1a0b2e' }}><Icon name="alert" size={18} /><span className="w7">Bitməyə {days} gün</span></div>}
              <hr className="hr" />
              <span className="lbl">Üzvlər</span>
              {p.members.map((m) => (
                <div key={m.client_id} className="row">
                  <Avatar name={m.full_name} />
                  <span className="col grow" style={{ gap: 0 }}><a className="t14 w8" href={`#/clients/${m.client_id}`} style={{ color: 'inherit' }}>{m.full_name}</a><span className="t12 muted">{m.role === 'owner' ? 'Sahib' : 'Üzv'}</span></span>
                  {m.role !== 'owner' && <button type="button" className="iconbtn" aria-label={`${m.full_name} çıxar`} onClick={() => confirm(`${m.full_name} paketdən çıxarılsın?`) && remove(p, m.client_id)}><Icon name="close" size={18} /></button>}
                </div>
              ))}
              <Button variant="out" small onClick={() => setAddTo(p)}><Icon name="plus" size={18} /> Üzv əlavə et</Button>
            </Card>
          );
        })}
      </div>
      {data && !data.length && <EmptyState icon="building" title="Paket yoxdur" text="Korporativ müştəri üçün saat paketi əlavə edin." action={<a className="btn btn-cream btn-sm btn-auto" href="#/packages/new">Paket əlavə et</a>} />}
      <ClientPickerSheet open={!!addTo} onClose={() => setAddTo(null)} onPick={add} title="Üzv əlavə et" exclude={addTo?.members.map((m) => m.client_id)} />
    </AdminShell>
  );
}

// B7b: paket əlavə et
export function PackageForm() {
  const { call } = useAuth();
  const [owner, setOwner] = useState<Client | null>(null);
  const [pickOwner, setPickOwner] = useState(false);
  const [pickMember, setPickMember] = useState(false);
  const [members, setMembers] = useState<Client[]>([]);
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState(20);
  const [cameras, setCameras] = useState(2);
  const [start, setStart] = useState(bakuToday());
  const [used, setUsed] = useState(0);
  const act = useAction();
  const months = SIZES.find(([h]) => h === hours)![1];
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setPrice(null);
    call<{ price: number }>(`/packages/quote?hours=${hours}&cameras=${cameras}`).then((q) => live && setPrice(q.price)).catch(() => {});
    return () => { live = false; };
  }, [hours, cameras, call]);

  async function create() {
    if (!owner) return;
    const r = await act.run(() => call('/packages', { body: { owner_client_id: owner.id, title: title.trim(), hours, cameras, starts_on: start, used_minutes: used, member_ids: members.map((m) => m.id) } }));
    if (r) go('packages');
  }

  return (
    <AdminShell active="packages" title="Paket əlavə et">
      <BackLink to="packages" />
      <div className="ax-narrow col" style={{ gap: 14 }}>
        <div className="field">
          <span className="flabel">Paket sahibi</span>
          <button type="button" className="inp" style={{ justifyContent: 'space-between' }} onClick={() => setPickOwner(true)}>
            <span className="row">{owner ? <><Avatar name={owner.full_name} /><span className="t15 w8">{owner.full_name}</span></> : <span className="muted">Müştəri seçin</span>}</span><Icon name="chevron" size={18} />
          </button>
        </div>
        <Field label="Paket adı" id="pk-n"><input id="pk-n" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="məs. Nümunə MMC" /></Field>
        <div className="field"><span className="flabel">Paket ölçüsü</span>
          <div className="g2">
            {SIZES.map(([h, m]) => (
              <button key={h} type="button" className={`opt${h === hours ? ' opt-on' : ''}`} aria-pressed={h === hours} onClick={() => { setHours(h); setUsed(Math.min(used, h * 60)); }} style={{ flexDirection: 'column', gap: 4, padding: '10px 14px' }}>
                <span className="row sb" style={{ width: '100%' }}><span className="num-m">{h}</span><span className="rad">{h === hours && <Icon name="check" size={14} strokeWidth={3} />}</span></span>
                <span className="t14 w8">saat</span><span className="t12 soft">{m} ay</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field"><span className="flabel">Kamera sayı</span>
          <div className="segw" role="group" aria-label="Kamera sayı">{[1, 2, 3].map((n) => <button key={n} type="button" className={`seg${n === cameras ? ' seg-on' : ''}`} aria-pressed={n === cameras} onClick={() => setCameras(n)}>{n}</button>)}</div>
        </div>
        <Card tone="cream">
          <span className="lbl">Paketin qiyməti</span>
          <span className="num-m">{price === null ? '…' : formatMoney(price)}</span>
          <span className="t13 w7">{hours} saat · {cameras} kamera · {months} ay</span>
        </Card>
        <Field label="Başlama tarixi" id="pk-d" hint={`Paket ${months} ay etibarlıdır. Keçmiş tarix də olar.`}>
          <input id="pk-d" type="date" className="inp" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <div className="field"><span className="flabel">Artıq istifadə olunub</span>
          <Stepper minutes={used} onChange={setUsed} min={0} max={hours * 60} />
          <span className="hint">Paket əvvəl başlayıbsa, istifadə olunmuş saatı daxil edin ({formatHours(used)}).</span>
        </div>
        <div className="field"><span className="flabel">Üzvlər</span>
          {members.map((m) => (
            <div key={m.id} className="row"><Avatar name={m.full_name} /><span className="t14 w8 grow">{m.full_name}</span><button type="button" className="iconbtn" aria-label={`${m.full_name} çıxar`} onClick={() => setMembers(members.filter((x) => x.id !== m.id))}><Icon name="close" size={18} /></button></div>
          ))}
          <Button variant="out" small onClick={() => setPickMember(true)}><Icon name="plus" size={18} /> Üzv əlavə et</Button>
        </div>
        <Card>
          {['Montaj daxil deyil (ayrıca 100 AZN)', 'Yalnız studiyada keçərlidir', 'Paket alışına keşbek yazılmır', 'Əlavə kamera saatda 50 AZN'].map((t) => <div key={t} className="row" style={{ alignItems: 'flex-start' }}><Icon name="check" size={16} /><span className="t13 soft lh">{t}</span></div>)}
        </Card>
        <Err msg={act.err} />
        <Button disabled={!owner || !title.trim() || !start || act.busy} onClick={create}>Paketi əlavə et</Button>
      </div>
      <ClientPickerSheet open={pickOwner} onClose={() => setPickOwner(false)} onPick={(c) => { setOwner(c); if (!title) setTitle(c.full_name); }} title="Paket sahibi" />
      <ClientPickerSheet open={pickMember} onClose={() => setPickMember(false)} onPick={(c) => setMembers([...members, c])} title="Üzv əlavə et" exclude={[...members.map((m) => m.id), owner?.id ?? 0]} />
    </AdminShell>
  );
}
