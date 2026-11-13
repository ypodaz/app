import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from '../../../../shared/ui';
import { useAction, useAuth, useLoad } from '../../../ctx';
import { bakuToday } from '../../../format';
import { go, useRoute } from '../../../router';
import type { ClientRow, Package, Subscription } from '../../../types';
import { PageHeader } from '../../shell/PageHeader';
import { Avatar, Button, Card, Chip, Dialog, EmptyState, ErrorBox, Field, LoadingRows, Segmented, TextArea, TextInput, UnitInput, V2Icon, useOnline, useToast } from '../../ui';
import { ChangeNote } from '../../ui';
import { Chosen, ClientPickDialog, ClientResults, Fld, Gate, daysBetween, dmy, hrs, pct, useClients } from './kit';
import './tenzimleme.css';

const HOURS = [5, 10, 15, 20] as const;
const CAMS = [1, 2, 3] as const;
const DISC: Record<number, number> = { 5: 10, 10: 20, 15: 30, 20: 40 }; // 00 §5.7
type Grid = Record<number, { months: number; prices: Record<number, number> }>;

/** Saat paketi qiymətləri: /packages/quote (server/money.py), 4 saat × 3 kamera. */
function usePriceGrid() {
  const { call } = useAuth();
  const [grid, setGrid] = useState<Grid | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setErr('');
    Promise.all(HOURS.flatMap((h) => CAMS.map((c) => call<{ price: number; months: number }>(`/packages/quote?hours=${h}&cameras=${c}`).then((q) => [h, c, q] as const))))
      .then((rows) => {
        if (!live) return;
        const g: Grid = {};
        for (const [h, c, q] of rows) (g[h] ??= { months: q.months, prices: {} }).prices[c] = q.price;
        setGrid(g);
      })
      .catch(() => live && setErr('Qiymətlər yüklənmədi'));
    return () => { live = false; };
  }, [call, tick]);
  return { grid, err, retry: () => setTick((t) => t + 1) };
}

const addMonths = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

type Owner = { id: number; full_name: string };

/** Paket sat (30-paketler.md §Paket sat). Hesablama brauzerdədir, server qiyməti /packages/quote-dan gəlir. */
function SellDialog({ open, onClose, onDone, grid, owner0, packages }: { open: boolean; onClose: () => void; onDone: () => void; grid: Grid | null; owner0: Owner | null; packages: Package[] }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const act = useAction();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [q, setQ] = useState('');
  const [hours, setHours] = useState<number>(10);
  const [cams, setCams] = useState<number>(2);
  const [start, setStart] = useState(bakuToday());
  const [used, setUsed] = useState(0);
  const [title, setTitle] = useState('');
  const { list, err, retry } = useClients(open && !owner);
  useEffect(() => {
    if (!open) return;
    setOwner(owner0); setQ(''); setHours(10); setCams(2); setStart(bakuToday()); setUsed(0); setTitle(''); act.setErr('');
  }, [open, owner0]); // eslint-disable-line react-hooks/exhaustive-deps

  const price = grid?.[hours]?.prices[cams];
  const months = grid?.[hours]?.months;
  const disc = DISC[hours];
  const standard = price !== undefined ? Math.round(price / (1 - disc / 100)) : undefined;
  const ends = months ? addMonths(start, months) : '';
  const existing = owner ? packages.filter((p) => p.owner_client_id === owner.id && daysBetween(bakuToday(), p.ends_on) >= 0 && p.minutes_left > 0).sort((a, b) => a.ends_on.localeCompare(b.ends_on))[0] : undefined;
  const usedOpts = Array.from({ length: hours * 2 + 1 }, (_, i) => i * 30);

  async function submit() {
    if (!owner || price === undefined) return;
    const name = title.trim() || owner.full_name;
    const r = await act.run(() => call('/packages', { body: { owner_client_id: owner.id, title: name, hours, cameras: cams, starts_on: start, used_minutes: Math.min(used, hours * 60), member_ids: [] } }));
    if (r !== undefined) { onClose(); onDone(); toast.show(`Paket satıldı · ${name} · ${hours} saat · ${formatMoney(price)}`); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Paket sat" subtitle="Korporativ saat paketi"
      footer={<><Button variant="text" onClick={onClose}>Ləğv et</Button><Button variant="primary" disabled={!owner || price === undefined || !online || act.busy} onClick={submit}>{price !== undefined ? `Paketi sat · ${formatMoney(price)}` : 'Paketi sat'}</Button></>}>
      <Field label="İnsan və ya şirkət">
        {(id) => owner ? (
          <div className="tz-pickbox"><Chosen name={owner.full_name} onRemove={() => setOwner(null)} /></div>
        ) : (
          <div className="tz-pick">
            <div className="tz-pickbox"><V2Icon name="search" /><input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon, şirkət" autoFocus /></div>
            {q.trim() && <ClientResults list={list} err={err} retry={retry} q={q} onPick={(c: ClientRow) => { setOwner({ id: c.id, full_name: c.full_name }); setQ(''); }} />}
          </div>
        )}
      </Field>
      {existing && <p className="tz-muted">Aktiv paket {dmy(existing.ends_on).slice(0, 5)}-də bitir · yeniləmə. Köhnə paket öz bitmə tarixinə qədər qalır.</p>}
      {/* TODO [API] 99 S8: qalıq saatın yeni pakete keçməsi: POST /packages bunu dəstəkləmir (used_minutes yalnız keçmiş istifadə üçündür). */}
      <Fld label="Paket"><Segmented label="Saat" options={HOURS.map((h) => ({ value: String(h), label: `${h} saat` }))} value={String(hours)} onChange={(v) => { setHours(Number(v)); setUsed(0); }} /></Fld>
      <Fld label="Kamera"><Segmented label="Kamera sayı" options={CAMS.map((c) => ({ value: String(c), label: String(c) }))} value={String(cams)} onChange={(v) => setCams(Number(v))} /></Fld>
      <div className="tz-calc" aria-live="polite">
        {price === undefined ? <span>Qiymət hesablanır…</span> : (
          <>
            <div><span>Standart qiymət</span><span className="mono">{formatMoney(standard!)}</span></div>
            <div><span>Endirim −{disc}%</span><span className="mono">−{formatMoney(standard! - price)}</span></div>
            <hr />
            <div><b style={{ color: 'var(--text)' }}>Cəmi</b><span className="mono tz-tot">{formatMoney(price)}</span></div>
            <div><span>1 saat = {formatMoney(Math.round(price / hours))}</span><span className="mono">bitmə {dmy(ends)} · {months} ay</span></div>
            <span>Montaj hər epizod +100 AZN (paketə daxil deyil). Paketdən olan çəkilişə keşbek yazılmır.</span>
          </>
        )}
      </div>
      {/* TODO [API] «Ödəniş: Tam / 2 hissə» (99 E Paketlər): POST /packages ödəniş bölgüsü və ikinci hissənin xatırlatması saxlamır. */}
      <details className="tz-det">
        <summary>Əlavə: ad, başlama tarixi, artıq istifadə</summary>
        <div className="tz-stack">
          <Field label="Paket adı" hint="Boş qalsa sahibin adı yazılır">{(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={owner?.full_name ?? ''} />}</Field>
          <div className="tz-row2">
            <Field label="Başlama tarixi" hint="Keçmiş tarix də olar">{(id) => <TextInput id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
            <Field label="Artıq istifadə olunub" hint="Paket əvvəl başlayıbsa">
              {(id) => <select id={id} className="input" value={used} onChange={(e) => setUsed(Number(e.target.value))}>{usedOpts.map((m) => <option key={m} value={m}>{hrs(m)} saat</option>)}</select>}
            </Field>
          </div>
        </div>
      </details>
      {act.err && <ErrorBox title="Alınmadı" detail={act.err} />}
      <ChangeNote unchanged={['Qiymət cədvəli', 'Şirkətin mövcud paketləri', 'Çəkilişlər']} />
    </Dialog>
  );
}

function Members({ p, onChanged }: { p: Package; onChanged: () => void }) {
  const { call } = useAuth();
  const act = useAction();
  const toast = useToast();
  const [add, setAdd] = useState(false);
  const [ask, setAsk] = useState<{ id: number; name: string } | null>(null);
  const online = useOnline();
  async function addMember(c: ClientRow) {
    const r = await act.run(() => call(`/packages/${p.id}/members`, { body: { client_id: c.id } }));
    if (r !== undefined) { onChanged(); toast.show(`Üzv əlavə edildi · ${c.full_name}`); }
  }
  async function remove() {
    if (!ask) return;
    const a = ask; setAsk(null);
    const r = await act.run(() => call(`/packages/${p.id}/members/${a.id}`, { method: 'DELETE' }));
    if (r !== undefined) { onChanged(); toast.show(`Üzv çıxarıldı · ${a.name}`); }
  }
  return (
    <div className="tz-members">
      {p.members.map((m) => (
        <div key={m.client_id} className="tz-mrow">
          <Avatar name={m.full_name} />
          <a href={`#/insanlar/${m.client_id}`}>{m.full_name}</a>
          <span className="tz-faint">{m.role === 'owner' ? 'Sahib' : 'Üzv'}</span>
          {m.role !== 'owner' && <Button size="row" variant="text" disabled={!online || act.busy} onClick={() => setAsk({ id: m.client_id, name: m.full_name })}>Çıxar</Button>}
        </div>
      ))}
      <div><Button size="row" icon={<V2Icon name="plus" size={14} />} disabled={!online || act.busy} onClick={() => setAdd(true)}>Üzv əlavə et</Button></div>
      {act.err && <ErrorBox title="Alınmadı" detail={act.err} />}
      <ClientPickDialog open={add} onClose={() => setAdd(false)} onPick={addMember} exclude={p.members.map((m) => m.client_id)} title="Üzv əlavə et" />
      <Dialog open={!!ask} onClose={() => setAsk(null)} title={`${ask?.name ?? ''} paketdən çıxarılsın?`}
        footer={<><Button variant="text" onClick={() => setAsk(null)}>Ləğv et</Button><Button variant="danger" onClick={remove}>Çıxar</Button></>}>
        <ChangeNote changes={['Üzv bu paketin saatından istifadə edə bilməz']} unchanged={['Paketin saatı və bitmə tarixi', 'Üzvün çəkilişləri']} />
      </Dialog>
    </div>
  );
}

const payDayText = (d: number) => (d === 0 ? 'ayın son günü' : `hər ayın ${d}-i`);
const SUB_TITLE = { client: 'Aylıq abunə', rent: 'Sub-icarə' } as const;

/** «+ Abunə»: müştəri abunəsi (çəkilişlər 0 AZN, keşbek yoxdur) və ya sub-icarəçi (çəkiliş müştərisi deyil). */
function SubDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const act = useAction();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'client' | 'rent'>('client');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [payDay, setPayDay] = useState(20);
  const [start, setStart] = useState(bakuToday());
  const { list, err, retry } = useClients(open && !owner);
  useEffect(() => {
    if (!open) return;
    setOwner(null); setQ(''); setKind('client'); setTitle(''); setAmount(''); setPayDay(20); setStart(bakuToday()); act.setErr('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const azn = Number(amount.replace(',', '.'));
  const valid = !!owner && Number.isFinite(azn) && azn > 0;
  async function submit() {
    if (!owner || !valid) return;
    const name = title.trim() || SUB_TITLE[kind];
    const r = await act.run(() => call('/subscriptions', { method: 'POST', body: { client_id: owner.id, title: name, kind, amount: Math.round(azn * 100), pay_day: payDay, starts_on: start } }));
    if (r !== undefined) { onClose(); onDone(); toast.show(`Abunə əlavə edildi · ${owner.full_name}`); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Abunə əlavə et" subtitle="Aylıq ödəniş"
      footer={<><Button variant="text" onClick={onClose}>Ləğv et</Button><Button variant="primary" disabled={!valid || !online || act.busy} onClick={submit}>Əlavə et</Button></>}>
      <Field label="Müştəri">
        {(id) => owner ? (
          <div className="tz-pickbox"><Chosen name={owner.full_name} onRemove={() => setOwner(null)} /></div>
        ) : (
          <div className="tz-pick">
            <div className="tz-pickbox"><V2Icon name="search" /><input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon, şirkət" autoFocus /></div>
            {q.trim() && <ClientResults list={list} err={err} retry={retry} q={q} onPick={(c: ClientRow) => { setOwner({ id: c.id, full_name: c.full_name }); setQ(''); }} />}
          </div>
        )}
      </Field>
      <Fld label="Növ"><Segmented label="Abunə növü" options={[{ value: 'client', label: 'Müştəri' }, { value: 'rent', label: 'İcarəçi' }]} value={kind} onChange={(v) => setKind(v as 'client' | 'rent')} /></Fld>
      <Field label="Ad" hint="Boş qalsa növə görə yazılır">{(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={SUB_TITLE[kind]} />}</Field>
      <div className="tz-row2">
        <Field label="Aylıq məbləğ">{(id) => <UnitInput id={id} unit="AZN" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="200" />}</Field>
        <Field label="Ödəniş günü">
          {(id) => <select id={id} className="input" value={payDay} onChange={(e) => setPayDay(Number(e.target.value))}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            <option value={0}>Ayın son günü</option>
          </select>}
        </Field>
      </div>
      <Field label="Başlama tarixi">{(id) => <TextInput id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
      {kind === 'client' && <p className="tz-muted">Abunəli müştərinin çəkilişləri 0 AZN olur, keşbek yazılmır.</p>}
      {act.err && <ErrorBox title="Alınmadı" detail={act.err} />}
      <ChangeNote changes={['Ödəniş günü Telegram-da xatırlatma gəlir']} unchanged={['Paketlər', 'Çəkilişlər']} />
    </Dialog>
  );
}

/** Abunənin redaktəsi (PATCH /subscriptions/{id}): ad, məbləğ, ödəniş günü, aylıq görüş sayı, qeyd. */
function SubEditDialog({ sub, onClose, onDone }: { sub: Subscription | null; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const act = useAction();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [payDay, setPayDay] = useState(20);
  const [visits, setVisits] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!sub) return;
    setTitle(sub.title); setAmount(String(sub.amount / 100)); setPayDay(sub.pay_day);
    setVisits(sub.visits_per_month == null ? '' : String(sub.visits_per_month)); setNote(sub.note ?? ''); act.setErr('');
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps

  const azn = Number(amount.replace(',', '.'));
  const vis = visits.trim() === '' ? null : Number(visits);
  const valid = title.trim().length > 0 && Number.isFinite(azn) && azn > 0 && (vis === null || (Number.isInteger(vis) && vis >= 0 && vis <= 100));
  async function submit() {
    if (!sub || !valid) return;
    const r = await act.run(() => call(`/subscriptions/${sub.id}`, { method: 'PATCH', body: { title: title.trim(), amount: Math.round(azn * 100), pay_day: payDay, visits_per_month: vis, note: note.trim() || null } }));
    if (r !== undefined) { onClose(); onDone(); toast.show(`Abunə yeniləndi · ${sub.client_name}`); }
  }
  return (
    <Dialog open={!!sub} onClose={onClose} title="Abunəni redaktə et" subtitle={sub?.client_name}
      footer={<><Button variant="text" onClick={onClose}>Ləğv et</Button><Button variant="primary" disabled={!valid || !online || act.busy} onClick={submit}>Saxla</Button></>}>
      <Field label="Ad">{(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />}</Field>
      <div className="tz-row2">
        <Field label="Aylıq məbləğ">{(id) => <UnitInput id={id} unit="AZN" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Ödəniş günü">
          {(id) => <select id={id} className="input" value={payDay} onChange={(e) => setPayDay(Number(e.target.value))}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            <option value={0}>Ayın son günü</option>
          </select>}
        </Field>
      </div>
      <Field label="Aylıq görüş sayı" hint="Boş qalsa limit yoxdur">{(id) => <TextInput id={id} inputMode="numeric" value={visits} onChange={(e) => setVisits(e.target.value)} placeholder="məs. 4" />}</Field>
      <Field label="Qeyd">{(id) => <TextArea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />}</Field>
      {act.err && <ErrorBox title="Alınmadı" detail={act.err} />}
      <ChangeNote changes={['Abunənin özü; yeni aylıq ödənişlər yeni məbləğlə yaranır']} unchanged={['Artıq yaranmış ödənişlər', 'Çəkilişlər']} />
    </Dialog>
  );
}

/** Aylıq abunələr: bu ayın ödənişi (Ödənib / Gözləyir / Bu ay yox). Pul «Ödənildi» basılan ayın Kassa-sına düşür. */
function Subscriptions() {
  const { call } = useAuth();
  const online = useOnline();
  const act = useAction();
  const toast = useToast();
  const list = useLoad<Subscription[]>('/subscriptions');
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<Subscription | null>(null);
  const [toggle, setToggle] = useState<Subscription | null>(null);
  const month = bakuToday().slice(0, 7);
  async function setActive(s: Subscription) {
    const r = await act.run(() => call(`/subscriptions/${s.id}`, { method: 'PATCH', body: { active: !s.active } }));
    if (r !== undefined) { setToggle(null); list.reload(); toast.show(s.active ? `Dayandırıldı · ${s.client_name}` : `Davam etdirildi · ${s.client_name}`); }
  }
  async function pay(id: number, what: 'paid' | 'unpaid', name: string) {
    const r = await act.run(() => call(`/subscriptions/payments/${id}/${what}`, { method: 'POST', body: {} }));
    if (r !== undefined) { list.reload(); toast.show(what === 'paid' ? `Ödənildi · ${name}` : `Geri alındı · ${name}`); }
  }
  const cols = 'minmax(0,1.6fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.2fr)';
  return (
    <Card title={<>Aylıq abunələr{list.data && <span className="tz-count">{list.data.filter((s) => s.active).length}</span>}</>}
      aside={<Button size="row" icon={<V2Icon name="plus" size={14} />} disabled={!online} onClick={() => setAdd(true)}>Abunə</Button>}>
      <Gate q={list} title="Abunələr yüklənmədi">
        {(rows) => rows.length === 0 ? (
          <EmptyState title="Abunə yoxdur" reason="Aylıq ödəyən müştəri və ya sub-icarəçi əlavə edin." action={<Button disabled={!online} onClick={() => setAdd(true)}>Abunə əlavə et</Button>} />
        ) : (
          <>
            <div className="tz-th tz-wide" style={{ '--cols': cols } as React.CSSProperties}><span>Müştəri</span><span>Məbləğ</span><span>Bu ay</span><span style={{ textAlign: 'right' }}>Əməl</span></div>
            {rows.map((s) => {
              const p = s.payments.find((x) => x.period === month);
              return (
                <div key={s.id} className="tz-tr tz-wide" style={{ '--cols': cols, ...(s.active ? {} : { opacity: 0.65 }) } as React.CSSProperties}>
                  <div className="tz-c"><span className="tz-who"><Avatar name={s.client_name} /><span style={{ minWidth: 0 }}><a href={`#/insanlar/${s.client_id}`} style={{ color: 'var(--text)' }}>{s.client_name}</a><span className="tz-sub">{s.title}{s.kind === 'rent' ? ' · icarəçi' : ''}</span></span></span></div>
                  <div className="tz-c mono">{formatMoney(s.amount)} · {payDayText(s.pay_day)}</div>
                  <div className="tz-c">{!s.active ? <Chip tone="neutral">Dayandırılıb</Chip> : p ? <Chip tone={p.status === 'paid' ? 'done' : p.status === 'pending' ? 'deposit' : 'neutral'}>{p.status === 'paid' ? 'Ödənib' : p.status === 'pending' ? 'Gözləyir' : 'Bu ay yox'}</Chip> : <span className="tz-faint">—</span>}</div>
                  <div className="tz-c tz-actions tz-actions--end">
                    <Button size="row" variant="text" disabled={!online || act.busy} onClick={() => { act.setErr(''); setEdit(s); }}>Redaktə et</Button>
                    <Button size="row" variant="text" disabled={!online || act.busy} onClick={() => { act.setErr(''); setToggle(s); }}>{s.active ? 'Dayandır' : 'Davam etdir'}</Button>
                    {s.active && p?.status === 'pending' && <Button size="row" disabled={!online || act.busy} onClick={() => pay(p.id, 'paid', s.client_name)}>Ödənildi</Button>}
                    {s.active && p?.status === 'paid' && <Button size="row" variant="text" disabled={!online || act.busy} onClick={() => pay(p.id, 'unpaid', s.client_name)}>Geri al</Button>}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Gate>
      {act.err && <ErrorBox title="Alınmadı" detail={act.err} />}
      <SubDialog open={add} onClose={() => setAdd(false)} onDone={list.reload} />
      <SubEditDialog sub={edit} onClose={() => setEdit(null)} onDone={list.reload} />
      <Dialog open={!!toggle} onClose={() => setToggle(null)} title={toggle?.active ? 'Abunə dayandırılsın?' : 'Abunə davam etdirilsin?'} subtitle={toggle?.client_name}
        footer={<><Button variant="text" onClick={() => setToggle(null)}>Ləğv et</Button><Button variant="primary" disabled={act.busy || !online} onClick={() => toggle && setActive(toggle)}>{toggle?.active ? 'Bəli, dayandır' : 'Bəli, davam etdir'}</Button></>}>
        <p className="tz-muted">{toggle?.active ? 'Yeni aylıq ödənişlər yaranmayacaq və müştərinin çəkilişləri adi qiymətlə hesablanacaq. Əvvəlki ödənişlər qalır.' : 'Aylıq ödənişlər yenidən yaranacaq, müştərinin çəkilişləri yenə 0 AZN olacaq.'}</p>
        {act.err && <ErrorBox title="Alınmadı" detail={act.err} />}
      </Dialog>
    </Card>
  );
}

/** Paketlər və qiymətlər (30-paketler.md). Routes: /tenzimleme/paketler, /tenzimleme/paketler/yeni, ?paket-sat=1, köhnə /packages. */
type PriceListData = {
  shoot_per_hour: Record<'studio' | 'onsite', Record<number, number>>; studio_rent: Record<number, number>;
  reels_pack: Record<'studio' | 'onsite', number>; single_reel?: number; cover?: number; editing: number; reel: number; extra_camera_per_hour: number;
};

/** Qiymət cədvəli (30): yalnız oxunur, rəqəmlər server/money.py-dən (/price-list). */
function PriceList() {
  const q = useLoad<PriceListData>('/price-list');
  const m = (n: number) => formatMoney(n);
  return (
    <Gate q={q} title="Qiymətlər yüklənmədi" rows={4}>
      {(p) => (
        <>
          <div className="hs-kv"><span><b>Çəkiliş, 1 saat · studiya</b><span className="tz-sub">1 / 2 / 3 kamera</span></span><span className="mono">{CAMS.map((c) => m(p.shoot_per_hour.studio[c]).replace(' AZN', '')).join(' / ')} AZN</span></div>
          <div className="hs-kv"><span><b>Çəkiliş, 1 saat · məkanda</b><span className="tz-sub">1 / 2 / 3 kamera</span></span><span className="mono">{CAMS.map((c) => m(p.shoot_per_hour.onsite[c]).replace(' AZN', '')).join(' / ')} AZN</span></div>
          <div className="hs-kv"><span><b>Müştəri özü çəkir</b><span className="tz-sub">1 / 2 / 3 saat</span></span><span className="mono">{[1, 2, 3].map((h) => m(p.studio_rent[h]).replace(' AZN', '')).join(' / ')} AZN</span></div>
          <div className="hs-kv"><span><b>Reels paketi</b><span className="tz-sub">studiya / məkanda</span></span><span className="mono">{m(p.reels_pack.studio).replace(' AZN', '')} / {m(p.reels_pack.onsite).replace(' AZN', '')} AZN</span></div>
          {p.single_reel !== undefined && <div className="hs-kv"><span><b>Tək Reels</b><span className="tz-sub">studiyada, sabit</span></span><span className="mono">{m(p.single_reel)}</span></div>}
          {p.cover !== undefined && <div className="hs-kv"><span><b>Cover</b><span className="tz-sub">hər video, yalnız studiyada</span></span><span className="mono">{m(p.cover)}</span></div>}
          <div className="hs-kv"><span><b>Montaj</b><span className="tz-sub">hər epizod</span></span><span className="mono">{m(p.editing)}</span></div>
          <div className="hs-kv"><span><b>Cover / Reels videosu</b><span className="tz-sub">hər video</span></span><span className="mono">{m(p.reel)}</span></div>
          <div className="hs-kv"><span><b>Əlavə kamera</b><span className="tz-sub">paket çəkilişində, saatda</span></span><span className="mono">{m(p.extra_camera_per_hour)}</span></div>
        </>
      )}
    </Gate>
  );
}

export function Paketler() {
  const { path, query } = useRoute();
  const online = useOnline();
  const pk = useLoad<Package[]>('/packages');
  const { grid, err: gridErr, retry } = usePriceGrid();
  const [sell, setSell] = useState(false);
  const [owner0, setOwner0] = useState<Owner | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const today = bakuToday();
  const asked = path[0] === 'tenzimleme' && path[2] === 'yeni' || path[0] === 'packages' && path[1] === 'new' || query.get('paket-sat') === '1';
  useEffect(() => { if (asked) { setOwner0(null); setSell(true); } }, [asked]);
  const closeSell = () => { setSell(false); if (asked) go('tenzimleme/paketler'); };

  const { active, ended } = useMemo(() => {
    const rows = (pk.data ?? []).map((p) => {
      const days = daysBetween(today, p.ends_on);
      const left = p.minutes_left / 60;
      const off = days < 0 || p.minutes_left <= 0;
      return { p, days, left, off, queue: !off && (left < 2 || days <= 14) };
    });
    const act = rows.filter((r) => !r.off).sort((a, b) => Number(b.queue) - Number(a.queue) || a.p.ends_on.localeCompare(b.p.ends_on));
    return { active: act, ended: rows.filter((r) => r.off).sort((a, b) => b.p.ends_on.localeCompare(a.p.ends_on)) };
  }, [pk.data, today]);
  const cols = 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1.5fr) minmax(0,1fr) minmax(0,.9fr) minmax(0,1.4fr)';

  const row = (r: (typeof active)[number]) => {
    const { p, days, left, off } = r;
    const used = p.minutes_total - p.minutes_left;
    const value = Math.round(p.price_paid * p.minutes_left / Math.max(1, p.minutes_total));
    return (
      <div key={p.id}>
        <div className="tz-tr tz-wide" style={{ '--cols': cols } as React.CSSProperties}>
          <div className="tz-c"><span className="tz-who"><Avatar name={p.title} /><span style={{ minWidth: 0 }}><a href={`#/insanlar/${p.owner_client_id}`} style={{ color: 'var(--text)' }}>{p.title}</a>{p.owner_name !== p.title && <span className="tz-sub">Sahibi: {p.owner_name}</span>}</span></span></div>
          <div className="tz-c">{p.minutes_total / 60} saat · {p.cameras} kamera</div>
          <div className="tz-c"><div className="tz-prog" role="progressbar" aria-valuemin={0} aria-valuemax={p.minutes_total / 60} aria-valuenow={used / 60} aria-label="İstifadə olunan saat"><i><i style={{ width: `${pct(used, p.minutes_total)}%` }} /></i><span className="mono">{hrs(used)} / {p.minutes_total / 60} saat</span></div></div>
          <div className="tz-c"><span className="mono">{dmy(p.ends_on)}</span>
            {!off && days <= 14 && <span className="tz-sub tz-sub--warn">{days} gün qalıb</span>}
            {!off && days > 14 && left < 2 && <span className="tz-sub tz-sub--warn">qalıq {hrs(p.minutes_left)} saat</span>}
            {off && <span className="tz-sub">{p.minutes_left <= 0 ? 'saat bitib' : 'müddət bitib'}</span>}</div>
          <div className="tz-c tz-c--r mono">{formatMoney(value)}</div>
          <div className="tz-c tz-actions tz-actions--end">
            {/* TODO [API] «Xatırlat» (30 §5): müştəriyə WhatsApp şablonu üçün endpoint yoxdur. */}
            {(r.queue || off) && <Button size="row" disabled={!online} onClick={() => { setOwner0({ id: p.owner_client_id, full_name: p.owner_name }); setSell(true); }}>Yeni paket təklif et</Button>}
            <Button size="row" variant="text" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>Üzvlər {p.members.length}</Button>
          </div>
        </div>
        {open === p.id && <Members p={p} onChanged={pk.reload} />}
      </div>
    );
  };
  const th = (
    <div className="tz-th tz-wide" style={{ '--cols': cols } as React.CSSProperties}>
      <span>Müştəri</span><span>Paket</span><span>İstifadə</span><span>Bitmə tarixi</span><span style={{ textAlign: 'right' }}>Qalıq dəyər</span><span style={{ textAlign: 'right' }}>Növbəti addım</span>
    </div>
  );

  return (
    <>
      <PageHeader title="Paketlər və qiymətlər" sub="Bot və qaralamalar qiyməti buradan götürür" newShoot={false}
        actions={<Button variant="primary" size="lg" icon={<V2Icon name="plus" />} disabled={!online} onClick={() => { setOwner0(null); setSell(true); }}>Paket sat</Button>} />
      <div className="tz">
        <Card title="Saat paketləri" aside={<span className="tz-aside">Yalnız studiya · montaj hər epizod <b className="mono" style={{ color: 'var(--text)', fontWeight: 500 }}>+100 AZN</b></span>}>
          {gridErr && !grid ? <ErrorBox title="Qiymətlər yüklənmədi" detail="Qiymət cədvəli alınmadı." onRetry={retry} /> : !grid ? <LoadingRows rows={4} /> : (
            <>
              <div className="tz-th" style={{ '--cols': 'minmax(0,.8fr) minmax(0,1.2fr) repeat(3, minmax(0,1fr))' } as React.CSSProperties}><span>Paket</span><span>Müddət · endirim</span>{CAMS.map((c) => <span key={c} style={{ textAlign: 'right' }}>{c} kamera</span>)}</div>
              {HOURS.map((h) => (
                <div key={h} className="tz-tr" style={{ '--cols': 'minmax(0,.8fr) minmax(0,1.2fr) repeat(3, minmax(0,1fr))' } as React.CSSProperties}>
                  <div className="tz-c"><span className="mono tz-big">{h}</span><span className="tz-unit">saat</span></div>
                  <div className="tz-c mono">{grid[h].months} ay · −{DISC[h]}%{h === 20 && <span className="tz-best">ən sərfəli</span>}</div>
                  {CAMS.map((c) => <div key={c} className="tz-c tz-c--r mono">{formatMoney(grid[h].prices[c]).replace(' AZN', '')}<span className="tz-unit">AZN</span></div>)}
                </div>
              ))}
            </>
          )}
        </Card>

        <Card title="Qiymət cədvəli" aside={<span className="tz-aside">yalnız oxunur</span>}>
          <PriceList />
        </Card>

        <Card title={<>Aktiv paketlər{pk.data && <span className="tz-count">{active.length}</span>}</>} aside={<span className="tz-aside">bitməsinə az qalan yuxarıda</span>}>
          <Gate q={pk} title="Paketlər yüklənmədi">
            {() => active.length === 0 ? (
              <EmptyState title="Aktiv paket yoxdur" reason="Korporativ müştəriyə paket satanda burada görünəcək." action={<Button disabled={!online} onClick={() => { setOwner0(null); setSell(true); }}>Paket sat</Button>} />
            ) : <>{th}{active.map(row)}</>}
          </Gate>
        </Card>

        {ended.length > 0 && (
          <Card title={<>Bitmiş paketlər<span className="tz-count">{ended.length}</span></>}>
            {th}{ended.map(row)}
          </Card>
        )}

        <Subscriptions />
      </div>
      <SellDialog open={sell} onClose={closeSell} onDone={pk.reload} grid={grid} owner0={owner0} packages={pk.data ?? []} />
    </>
  );
}
