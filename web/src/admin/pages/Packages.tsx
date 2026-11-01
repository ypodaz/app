import { useEffect, useState } from 'react';
import { AdminShell, Button, Stepper, formatHours, formatMoney } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { AEmpty, Av, stag } from '../components/a3';
import { ConfirmDialog, PageHead, useCountUp } from '../components/neon';
import { Err, Field } from '../components/common';
import { ClientPickerSheet } from '../components/ClientPicker';
import { useAction, useAuth, useLoad } from '../ctx';
import { bakuToday, dateFull } from '../format';
import { go, useDesktop } from '../router';
import type { Client, Package } from '../types';

const SIZES: [number, number][] = [[5, 2], [10, 4], [15, 8], [20, 12]]; // saat → ay

// B7a: paketlər
export function Packages() {
  const { call } = useAuth();
  const desktop = useDesktop();
  const { data, err, reload } = useLoad<Package[]>('/packages');
  const [addTo, setAddTo] = useState<Package | null>(null);
  const [ask, setAsk] = useState<{ p: Package; cid: number; name: string } | null>(null);
  const act = useAction();
  const today = bakuToday();
  const daysOf = (p: Package) => Math.ceil((Date.parse(p.ends_on) - Date.parse(today)) / 86400000);
  const remove = (p: Package, cid: number) => act.run(() => call(`/packages/${p.id}/members/${cid}`, { method: 'DELETE' })).then((r) => r !== undefined && reload());
  const add = (c: Client) => addTo && act.run(() => call(`/packages/${addTo.id}/members`, { body: { client_id: c.id } })).then((r) => r !== undefined && reload());
  const active = (data ?? []).filter((p) => daysOf(p) >= 0).length;
  const expired = (data?.length ?? 0) - active;

  const card = (p: Package, i: number) => {
    const left = p.minutes_left / p.minutes_total;
    const days = daysOf(p);
    const off = days < 0;
    return (
      <section key={p.id} className={`a-g a3-pkc a-rise${off ? ' off' : ''}`} style={stag(i)} aria-label={p.title}>
        {!off && <span className="a-hot-glow a3-glow-y" aria-hidden="true" />}
        <div className="a3-pkh">
          <span className="a-ic a-ic-pkg"><AIcon name="pkg" size={16} /></span>
          <span className="a3-pkl">{off ? 'Müddəti bitib' : 'Aktiv paket'}</span>
          {days >= 0 && days <= 30 && <span className="a-chip a-chip-warn"><i />Bitməyə {days} gün</span>}
        </div>
        <h2 className="a3-pkt">{p.title} · {p.minutes_total / 60} saat · {p.cameras} kamera</h2>
        <div className="a3-pkn">{String(p.minutes_left / 60).replace('.', ',')}<small>/ {p.minutes_total / 60} saat</small></div>
        <div className="a3-prog" role="progressbar" aria-valuemin={0} aria-valuemax={p.minutes_total / 60} aria-valuenow={p.minutes_left / 60} aria-label="Qalan saat"><span style={{ width: `${left * 100}%` }} /></div>
        <div className="a3-pkm"><AIcon name="cal" size={14} /><span>{dateFull(p.starts_on)} – {dateFull(p.ends_on)}</span></div>
        <div className="a3-pkm"><AIcon name="user" size={14} /><span>Sahibi: {p.owner_name}</span></div>
        <hr className="a3-hr2" />
        <span className="a3-pkx">Üzvlər</span>
        {p.members.map((m) => (
          <div key={m.client_id} className="a3-mr">
            <Av name={m.full_name} size={36} />
            <a className="a3-mn" href={`#/clients/${m.client_id}`}>{m.full_name}</a>
            <span className={`a3-role${m.role === 'owner' ? ' own' : ''}`}>{m.role === 'owner' ? 'Sahib' : 'Üzv'}</span>
            {m.role !== 'owner' ? <button type="button" className="a3-mx" aria-label={`${m.full_name} çıxar`} onClick={() => setAsk({ p, cid: m.client_id, name: m.full_name })}><AIcon name="x" size={18} /></button> : <span className="a3-mx" aria-hidden="true" />}
          </div>
        ))}
        <button type="button" className="a-bg a3-add" onClick={() => setAddTo(p)}><AIcon name="plus" size={18} /> Üzv əlavə et</button>
      </section>
    );
  };
  const list = [...(data ?? [])].sort((a, b) => Number(daysOf(a) < 0) - Number(daysOf(b) < 0)); // aktivlər əvvəl, müddəti bitənlər sonda

  return (
    <AdminShell active="packages" title="Paketlər" sub={data?.length ? `${active} aktiv · ${expired} müddəti bitib` : undefined} actions={<a className="a-bp" href="#/packages/new"><AIcon name="plus" size={18} /> Paket</a>}>
      <Err msg={err || act.err} />
      {desktop
        ? <div className="a3-pkg2"><div>{list.filter((_, i) => i % 2 === 0).map((p) => card(p, list.indexOf(p) + 1))}</div><div>{list.filter((_, i) => i % 2 === 1).map((p) => card(p, list.indexOf(p) + 1))}</div></div>
        : <div className="a3-pkg1">{list.map((p, i) => card(p, i + 1))}</div>}
      {data && !data.length && <AEmpty icon="pkg" tone="pkg" title="Paket yoxdur" text="Korporativ müştəri üçün saat paketi əlavə edin." action={<a className="a-bp" href="#/packages/new">Paket əlavə et</a>} />}
      <ClientPickerSheet open={!!addTo} onClose={() => setAddTo(null)} onPick={add} title="Üzv əlavə et" exclude={addTo?.members.map((m) => m.client_id)} />
      <ConfirmDialog open={!!ask} confirmLabel="Çıxar" text={`${ask?.name} paketdən çıxarılsın?`} onCancel={() => setAsk(null)} onConfirm={() => { const a = ask!; setAsk(null); remove(a.p, a.cid); }} />
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
  const shown = useCountUp(price ?? undefined, 180);
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
    <AdminShell active="packages" title="Paket əlavə et" bare full>
      <PageHead back="packages" title="Paket əlavə et" label="Paketlər" />
      <div className="a3-form">
        <div className="field a-rise" style={stag(1)}>
          <span className="flabel">Paket sahibi</span>
          <button type="button" className="a3-pick" onClick={() => setPickOwner(true)}>
            {owner ? <span>{owner.full_name}</span> : <span className="ph">Müştəri seçin</span>}<AIcon name="chevd" size={18} />
          </button>
        </div>
        <Field label="Paket adı" id="pk-n"><input id="pk-n" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="məs. Nümunə MMC" /></Field>
        <div className="field"><span className="flabel">Paket ölçüsü</span>
          <div className="a3-sizes">
            {SIZES.map(([h, m]) => (
              <button key={h} type="button" className={`a3-size${h === hours ? ' on' : ''}`} aria-pressed={h === hours} onClick={() => { setHours(h); setUsed(Math.min(used, h * 60)); }}>
                <b>{h} saat</b><span>{m} ay</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field"><span className="flabel">Kamera sayı</span>
          <div className="a3-cams" role="group" aria-label="Kamera sayı">{[1, 2, 3].map((n) => <button key={n} type="button" className={n === cameras ? 'on' : ''} aria-pressed={n === cameras} onClick={() => setCameras(n)}>{n}</button>)}</div>
        </div>
        <section className="a-g a3-price" aria-label="Paketin qiyməti">
          <span className="a-hot-glow a3-glow-y" aria-hidden="true" />
          <div className="a3-pkh"><span className="a-ic a-ic-pkg"><AIcon name="pkg" size={16} /></span><span className="a3-pkl">Paketin qiyməti</span></div>
          <div className="a3-pp">{price === null ? '…' : formatMoney(shown ?? price)}</div>
          <span className="a3-pm">{hours} saat · {cameras} kamera · {months} ay</span>
        </section>
        <Field label="Başlama tarixi" id="pk-d" hint={`Paket ${months} ay etibarlıdır. Keçmiş tarix də olar.`}>
          <div className={`a3-date${start ? '' : ' empty'}`}>
            <input id="pk-d" type="date" className="inp" value={start} onChange={(e) => setStart(e.target.value)} />
            {start && <span className="a3-dv" aria-hidden="true">{dateFull(start)}</span>}
            <AIcon name="cal" size={18} />
          </div>
        </Field>
        <div className="field"><span className="flabel">Artıq istifadə olunub</span>
          <Stepper minutes={used} onChange={setUsed} min={0} max={hours * 60} />
          <span className="hint">Paket əvvəl başlayıbsa, istifadə olunmuş saatı daxil edin ({formatHours(used)}).</span>
        </div>
        <div className="a3-mem">
          <h2>Üzvlər</h2>
          {!members.length && <p>Üzv əlavə edilməyib. Paket sahibi avtomatik daxildir.</p>}
          {members.map((m) => (
            <div key={m.id} className="a3-mr"><Av name={m.full_name} size={36} /><span className="a3-mn">{m.full_name}</span><button type="button" className="a3-mx" aria-label={`${m.full_name} çıxar`} onClick={() => setMembers(members.filter((x) => x.id !== m.id))}><AIcon name="x" size={18} /></button></div>
          ))}
          <button type="button" className="a-bg a3-add" onClick={() => setPickMember(true)}><AIcon name="plus" size={18} /> Üzv əlavə et</button>
        </div>
        <section className="a-g a3-rules" aria-label="Qaydalar">
          <span className="a3-rt">Qaydalar</span>
          {['Montaj daxil deyil (ayrıca 100 AZN)', 'Yalnız studiyada keçərlidir', 'Paket alışına keşbek yazılmır', 'Əlavə kamera saatda 50 AZN'].map((t) => <div key={t} className="a3-ru"><AIcon name="info" size={16} /><span>{t}</span></div>)}
        </section>
        <Err msg={act.err} />
        <Button disabled={!owner || !title.trim() || !start || act.busy} onClick={create}>Paketi əlavə et</Button>
      </div>
      <ClientPickerSheet open={pickOwner} onClose={() => setPickOwner(false)} onPick={(c) => { setOwner(c); if (!title) setTitle(c.full_name); }} title="Paket sahibi" />
      <ClientPickerSheet open={pickMember} onClose={() => setPickMember(false)} onPick={(c) => setMembers([...members, c])} title="Üzv əlavə et" exclude={[...members.map((m) => m.id), owner?.id ?? 0]} />
    </AdminShell>
  );
}
