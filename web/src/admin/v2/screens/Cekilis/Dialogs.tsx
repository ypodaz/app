import { useEffect, useMemo, useState } from 'react';
import { formatHours, formatMoney, formatMoney2 } from '../../../../shared/ui';
import { errMsg, useAction, useAuth, useLoad } from '../../../ctx';
import { addDays, aznInput, bakuNow, bakuParts, bakuToday, dateWd, minutesOf, parseAzn, timeRange, toIso } from '../../../format';
import { extraRows, type ExtraRow } from '../../../components/ExtrasEditor';
import type { Block, CancelOut, ClientDetail, CloseOut, Quote, Shoot, Slot } from '../../../types';
import { minToHhmm } from '../../data/time';
import { Button, ChangeNote, Chip, Dialog, EmptyState, ErrorBox, Field, LoadingRows, Segmented, Switch, TextInput, UnitInput, useOnline, useToast } from '../../ui';
import { Chips, Extras, Stepper, extrasOf } from './parts';
import { busyOfDay, personName, refresh, svcText } from './bits';

// ---------------------------------------------------------------------------------------------
// Vaxtı dəyiş (15 §1)
// ---------------------------------------------------------------------------------------------
/** /free-slots aralıqlarından müddətə sığan başlanğıclar (30 dəq şəbəkəsi + aralığın özünün başlanğıcı). */
function startsFrom(slots: Slot[], dur: number): string[] {
  const set = new Set<number>();
  for (const sl of slots) {
    const a = minutesOf(sl.start), b = minutesOf(sl.end);
    for (let t = a; t + dur <= b; t = t === a && a % 30 ? Math.ceil(a / 30) * 30 : t + 30) set.add(t);
  }
  return [...set].sort((x, y) => x - y).map(minToHhmm);
}

export function RescheduleDialog({ shoot, onClose }: { shoot: Shoot | null; onClose: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const act = useAction();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  useEffect(() => { if (shoot) { const p = bakuParts(shoot.starts_at); setDate(p.date); setTime(p.time); act.setErr(''); } }, [shoot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const slots = useLoad<Slot[]>(shoot && date ? `/free-slots?day=${date}` : null);
  const chips = useMemo(() => (slots.data && shoot ? startsFrom(slots.data, shoot.duration_min) : []), [slots.data, shoot]);
  if (!shoot) return null;
  const p = bakuParts(shoot.starts_at);
  const same = date === p.date && time === p.time;
  const validTime = /^\d{2}:\d{2}$/.test(time);
  async function submit() {
    if (!shoot || !validTime) return;
    const r = await act.run(() => call(`/shoots/${shoot.id}/reschedule`, { body: { starts_at: toIso(date, time) } }));
    if (r !== undefined) { toast.show(`Vaxt dəyişdi · ${personName(shoot)} · ${date.slice(8)}.${date.slice(5, 7)}, ${time}`); refresh(); onClose(); }
  }
  return (
    <Dialog open onClose={onClose} title="Vaxtı dəyiş" subtitle={<>{personName(shoot)} · indi {dateWd(p.date)}, <span className="mono">{timeRange(shoot.starts_at, shoot.duration_min)}</span></>}
      footer={<><Button variant="text" onClick={onClose}>Geri</Button><Button variant="primary" disabled={!online || !validTime || same || act.busy} onClick={submit}>{same ? 'Vaxtı dəyiş' : `Vaxtı dəyiş · ${date.slice(8)}.${date.slice(5, 7)}, ${time}`}</Button></>}>
      <div className="ck-grid2">
        <Field label="Yeni tarix">{(id) => <TextInput id={id} type="date" min={bakuToday()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Başlanğıc">{(id) => <TextInput id={id} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
      </div>
      <div className="field">
        <span className="field__label">Boş vaxtlar · müddət {formatHours(shoot.duration_min)}</span>
        {slots.err ? <ErrorBox title="Boş vaxtlar yüklənmədi" detail={slots.err} onRetry={slots.reload} />
          : !slots.data ? <LoadingRows rows={1} />
          : chips.length ? <Chips label="Boş vaxtlar" value={time} onChange={setTime} options={chips.map((c) => ({ value: c, label: c }))} />
          : <EmptyState title="Bu gündə boş vaxt yoxdur" reason="Başqa gün seçin." />}
      </div>
      <p className="ck-info">Çəkilişə 24 saatdan az qalıbsa, vaxt yalnız bir dəfə dəyişdirilə bilər.</p>
      {/* TODO [API] «Müştəriyə xəbər göndər» (WhatsApp) və təhvil tarixinin yenidən hesablanması: reschedule yalnız starts_at qəbul edir. */}
      <ChangeNote changes={['Çəkilişin tarixi və başlanğıc saatı']} unchanged={['Status, paket və məbləğ', shoot.deposit_received_at ? `Beh ${formatMoney(shoot.deposit_amount)} qüvvədə qalır` : 'Beh (hələ alınmayıb)', 'Qeyd']} />
      {act.err && <span className="field__err" role="alert">{act.err}</span>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Çəkilişi ləğv et (15 §2) + «Qaytarıldı»
// ---------------------------------------------------------------------------------------------
const WINDOW: Record<string, string> = {
  gt24: 'Çəkilişə 24 saatdan çox qalıb, ləğv pulsuzdur.',
  lt24: 'Çəkilişə 24 saatdan az qalıb. Beh tutulur.',
  no_show: 'Gəlmədi. Beh tutulur.',
};
function Calc({ r }: { r: CancelOut }) {
  return (
    <div className="ck-calc">
      <div className="ck-warn">{WINDOW[r.window]}</div>
      <dl className="ck-facts">
        <div><dt>Ödənilib (beh)</dt><dd className="mono">{formatMoney2(r.deposit_received_at ? r.deposit_amount : 0)}</dd></div>
        <div><dt>Tutulur</dt><dd className="mono">{formatMoney2(r.retained)}</dd></div>
        <div><dt>Keşbek balansa qayıdır</dt><dd className="mono">{formatMoney2(r.cashback_return)}</dd></div>
        <div className="ck-facts__sum"><dt>Qaytarılacaq</dt><dd className="mono">{formatMoney2(r.refund)}</dd></div>
      </dl>
    </div>
  );
}

export function CancelDialog({ shoot, onClose }: { shoot: Shoot | null; onClose: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const act = useAction();
  const now = bakuNow();
  const [date, setDate] = useState(now.date);
  const [time, setTime] = useState(now.time);
  const [preview, setPreview] = useState<CancelOut | null>(null);
  const [perr, setPerr] = useState('');
  const [res, setRes] = useState<CancelOut | null>(null);
  const [refunded, setRefunded] = useState(false);
  const id = shoot?.id;
  useEffect(() => { if (id) { const n = bakuNow(); setDate(n.date); setTime(n.time); setRes(null); setRefunded(false); setPreview(null); act.setErr(''); } }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ləğv vaxtı dəyişəndə önbaxış (bazaya yazılmır)
  useEffect(() => {
    if (!id || !date || !time || res) return;
    let live = true;
    setPerr('');
    call<CancelOut>(`/shoots/${id}/cancel/quote`, { body: { requested_at: toIso(date, time) } })
      .then((r) => live && setPreview(r)).catch((e) => { if (live) { setPreview(null); setPerr(errMsg(e)); } });
    return () => { live = false; };
  }, [id, date, time, res, call]);
  if (!shoot) return null;
  const p = bakuParts(shoot.starts_at);
  async function cancel() {
    const r = await act.run(() => call<CancelOut>(`/shoots/${shoot!.id}/cancel`, { body: { requested_at: toIso(date, time) } }));
    if (r) { setRes(r); toast.show(`Çəkiliş ləğv edildi · ${personName(shoot!)}`); refresh(); }
  }
  async function refund() {
    if (await act.run(() => call(`/shoots/${shoot!.id}/refunded`, { body: {} })) !== undefined) { setRefunded(true); toast.show('Qaytarıldı qeyd olundu'); refresh(); }
  }
  const sub = <>{personName(shoot)} · {dateWd(p.date)}, <span className="mono">{timeRange(shoot.starts_at, shoot.duration_min)}</span></>;
  if (res) {
    return (
      <Dialog open onClose={onClose} title="Çəkiliş ləğv edildi" subtitle={sub}
        footer={<>{res.refund > 0 && !refunded && <Button variant="primary" disabled={act.busy || !online} onClick={refund}>Qaytarıldı · {formatMoney2(res.refund)}</Button>}<Button onClick={onClose}>Bağla</Button></>}>
        <Calc r={res} />
        {res.refund > 0 && !refunded && <p className="ck-info">Pulu müştərinin kartına qaytarın, sonra «Qaytarıldı» basın. Müştəriyə bildiriş gedəcək.</p>}
        {refunded && <Chip tone="done">Qaytarıldı</Chip>}
        {act.err && <span className="field__err" role="alert">{act.err}</span>}
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title="Çəkilişi ləğv et" subtitle={sub}
      footer={<><Button variant="text" onClick={onClose}>Geri</Button><Button variant="danger" disabled={!online || !date || !time || act.busy} onClick={cancel}>Çəkilişi ləğv et</Button></>}>
      <p className="ck-info">Müştəri ləğvi nə vaxt istəyib? Hesab (24 saat qaydası) bu vaxta görə aparılır.</p>
      <div className="ck-grid2">
        <Field label="Ləğv tarixi">{(i) => <TextInput id={i} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Saat">{(i) => <TextInput id={i} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
      </div>
      {perr ? <ErrorBox title="Hesab alınmadı" detail={perr} /> : preview ? <Calc r={preview} /> : <LoadingRows rows={1} />}
      <p className="ck-info">Qayda: 24 saatdan az qalanda beh (ödəniləcək məbləğin 50%-i) qaytarılmır, istifadə olunmuş keşbek balansa qayıdır.</p>
      {/* TODO [API] ləğv səbəbi (Müştəri imtina etdi / Vaxt uyğun gəlmədi / …), «Müştəriyə xəbər göndər» və >24 saatda «Qaytar / Balansa keç» seçimi: cancel yalnız requested_at qəbul edir. */}
      <ChangeNote changes={['Çəkiliş təqvimdən çıxır (Siyahı › Ləğv tabında qalır)', 'Boşalan vaxt yenidən boş sayılır']} unchanged={['İnsan kartı və başqa çəkilişlər', 'Söhbət tarixçəsi']} />
      {act.err && <span className="field__err" role="alert">{act.err}</span>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Gəlmədi
// ---------------------------------------------------------------------------------------------
export function NoShowDialog({ shoot, onClose }: { shoot: Shoot | null; onClose: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const act = useAction();
  if (!shoot) return null;
  async function go() {
    if (await act.run(() => call(`/shoots/${shoot!.id}/no-show`, { body: {} })) !== undefined) { toast.show(`Gəlmədi qeyd olundu · ${personName(shoot!)}`); refresh(); onClose(); }
  }
  return (
    <Dialog open onClose={onClose} title="Müştəri gəlmədi?" subtitle={personName(shoot)}
      footer={<><Button variant="text" onClick={onClose}>Geri</Button><Button variant="danger" disabled={act.busy} onClick={go}>Gəlmədi</Button></>}>
      <p className="ck-info">Növbəti dəfə beh mütləq olacaq.</p>
      <ChangeNote changes={['Çəkiliş «Gəlmədi» kimi qeyd olunur']} unchanged={['İnsan kartı və başqa çəkilişlər']} />
      {act.err && <span className="field__err" role="alert">{act.err}</span>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Vaxtı blokla (10 «Dialoqlar»)
// ---------------------------------------------------------------------------------------------
const REASONS = ['Avadanlıq', 'Şəxsi', 'Təmir', 'Digər'];

export function BlockDialog({ open, date, time, block, shoots, onClose }: { open: boolean; date: string; time: string; block: Block | null; shoots: Shoot[]; onClose: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const act = useAction();
  const [d, setD] = useState(date);
  const [from, setFrom] = useState(time);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [weekly, setWeekly] = useState(false);
  useEffect(() => {
    if (!open) return;
    setD(date); setFrom(time); setTo(minToHhmm(Math.min(22 * 60, minutesOf(time) + 90)));
    setReason(REASONS[0]); setNote(''); setWeekly(false); act.setErr('');
  }, [open, date, time]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  if (block) {
    const bp = bakuParts(block.starts_at);
    async function remove() {
      if (await act.run(() => call(`/blocks/${block!.id}`, { method: 'DELETE' })) !== undefined) { toast.show('Blok silindi'); refresh(); onClose(); }
    }
    return (
      <Dialog open onClose={onClose} title="Bloklanmış vaxt" subtitle={dateWd(bp.date)}
        footer={<><Button variant="text" onClick={onClose}>Bağla</Button><Button variant="danger" disabled={!online || act.busy} onClick={remove}>Bloku sil</Button></>}>
        <div className="note"><b>{block.reason || 'Bloklanıb'}</b><span className="mono">{timeRange(block.starts_at, (Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60_000)}</span></div>
        <ChangeNote changes={['Vaxt yenidən boş sayılır']} unchanged={['Çəkilişlər, müştərilər, ödənişlər və keşbek']} />
        {act.err && <span className="field__err" role="alert">{act.err}</span>}
      </Dialog>
    );
  }
  const a = minutesOf(from || '00:00'), b = minutesOf(to || '00:00');
  const nowP = bakuNow();
  const past = d < nowP.date || (d === nowP.date && from < nowP.time);
  const badRange = !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || b <= a || a < 8 * 60 || b > 22 * 60;
  const clash = !badRange ? busyOfDay(d, shoots.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show'), []).find(([x, y]) => x < b && y > a) : undefined;
  const clashShoot = clash ? shoots.find((s) => s.status !== 'cancelled' && s.status !== 'no_show' && bakuParts(s.starts_at).date === d && minutesOf(bakuParts(s.starts_at).time) < b && minutesOf(bakuParts(s.starts_at).time) + s.duration_min > a) : undefined;
  async function save() {
    const reasonText = note.trim() ? `${reason} · ${note.trim()}` : reason;
    const n = weekly ? 12 : 1; // 99 E: «Hər həftə təkrarla» 12 həftə irəli
    const r = await act.run(async () => {
      for (let i = 0; i < n; i++) {
        const day = addDays(d, i * 7);
        await call('/blocks', { body: { starts_at: toIso(day, from), ends_at: toIso(day, to), reason: reasonText } });
      }
      return true;
    });
    if (r) { toast.show(`Vaxt bloklandı · ${d.slice(8)}.${d.slice(5, 7)}, ${from}–${to}${weekly ? ' · hər həftə' : ''}`); refresh(); onClose(); }
  }
  return (
    <Dialog open onClose={onClose} title="Vaxtı blokla"
      footer={<><Button variant="text" onClick={onClose}>Geri</Button><Button variant="primary" disabled={!online || past || badRange || !!clashShoot || act.busy} onClick={save}>Vaxtı blokla</Button></>}>
      <div className="field"><span className="field__label">Səbəb</span><Chips label="Səbəb" value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: r }))} /></div>
      <Field label="Qeyd (istəyə görə)">{(i) => <TextInput id={i} value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="Məsələn, işıqların dəyişdirilməsi" />}</Field>
      <div className="ck-grid3">
        <Field label="Tarix">{(i) => <TextInput id={i} type="date" value={d} onChange={(e) => setD(e.target.value)} />}</Field>
        <Field label="Başlanğıc">{(i) => <TextInput id={i} type="time" step={1800} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Son" error={badRange && from && to ? 'İş saatı 08:00–22:00, son başlanğıcdan sonra olmalıdır' : undefined}>{(i, bad) => <TextInput id={i} type="time" step={1800} value={to} invalid={bad} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      <label className="ck-switch"><Switch checked={weekly} onChange={setWeekly} label="Hər həftə təkrarla" /><span>Hər həftə təkrarla <small>(12 həftə irəli)</small></span></label>
      {past && <div className="ck-warn" role="alert">Keçmiş vaxtı bloklamaq olmur</div>}
      {clashShoot && <div className="ck-warn" role="alert">Bu vaxtda çəkiliş var: {personName(clashShoot)} · {timeRange(clashShoot.starts_at, clashShoot.duration_min)}. Əvvəl onu köçürün və ya ləğv edin.</div>}
      {/* TODO [API] Apple təqvimində blokun yaradılması/silinməsi server tərəfdə təsdiqlənməlidir (99 E: «Bloklar Apple təqviminə yazılır»). */}
      <ChangeNote unchanged={['Bu vaxtda olan çəkilişlər, müştərilər, ödənişlər və keşbek', 'Yalnız bu vaxt boş saat kimi təklif olunmur']} />
      {act.err && <span className="field__err" role="alert">{act.err}</span>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Çəkilişi bağla (köhnə CloseShoot-un v2 versiyası)
// ---------------------------------------------------------------------------------------------
export function CloseDialog({ shoot, onClose }: { shoot: Shoot | null; onClose: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const act = useAction();
  const s = shoot;
  const client = useLoad<ClientDetail>(s ? `/clients/${s.client_id}` : null).data;
  const [dur, setDur] = useState<number | null>(null);
  const [useCb, setUseCb] = useState(false);
  const [discText, setDiscText] = useState<string | null>(null);
  const [exRows, setExRows] = useState<ExtraRow[] | null>(null);
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qerr, setQerr] = useState('');
  const [done, setDone] = useState<CloseOut | null>(null);
  useEffect(() => { setDur(null); setUseCb(false); setDiscText(null); setExRows(null); setMethod('cash'); setQuote(null); setQerr(''); setDone(null); act.setErr(''); }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = dur ?? s?.duration_min ?? 60;
  const discP = discText === null ? (s?.discount ?? 0) : discText.trim() ? parseAzn(discText) : 0;
  const discBad = discP === null, disc = discP ?? 0;
  const rows = exRows ?? extraRows(s?.extras ?? []);
  const { list: extras, bad: extrasBad } = extrasOf(rows);
  const extrasKey = JSON.stringify(extras);

  // Faktiki müddətlə yeni qiymət (keşbek 0: artıq istifadə olunanı server özü nəzərə alır)
  useEffect(() => {
    if (!s || extrasBad || discBad) return;
    let live = true;
    const t = setTimeout(() => {
      call<Quote>('/shoots/quote', { body: {
        client_id: s.client_id, starts_at: s.starts_at, duration_min: minutes, kind: s.kind, tag: s.tag, location: s.location,
        cameras: s.cameras, editing: s.editing, reels_count: s.reels_count, package_id: s.package_id, cashback_use: 0, address: s.address,
        extras, discount: disc, prep_min: s.prep_min, wrap_min: s.wrap_min,
      } }).then((q) => live && (setQuote(q), setQerr(''))).catch((e) => live && (setQuote(null), setQerr(errMsg(e))));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [s, minutes, disc, extrasKey, extrasBad, discBad, call]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null;
  const pkg = client?.packages.find((p) => p.id === s.package_id);
  const deposit = s.deposit_received_at ? s.deposit_amount : 0;
  const payable = quote ? Math.max(0, quote.total - s.cashback_used - deposit) : 0;
  const usable = quote && quote.cashback_shoots_left === 0 && quote.cashback_balance >= quote.cashback_min_use ? Math.min(quote.cashback_balance, payable) : 0;
  const extraCb = useCb ? usable : 0;
  const due = quote ? Math.max(0, quote.total - s.cashback_used - extraCb - deposit) : 0;
  const reels = s.kind === 'reels_pack';

  async function close() {
    const r = await act.run(() => call<CloseOut>(`/shoots/${s!.id}/close`, { body: { duration_min: minutes, cashback_use: extraCb, extras, discount: disc, paid_method: due > 0 ? method : null } }));
    if (r) { setDone(r); toast.show(`Çəkiliş bağlandı · ${formatMoney(r.total)}${r.cashback_earned > 0 ? ` · keşbek +${formatMoney(r.cashback_earned)}` : ''}`); refresh(); }
  }

  const sub = <>{personName(s)} · {dateWd(bakuParts(s.starts_at).date)}, <span className="mono">{timeRange(s.starts_at, s.duration_min)}</span> · {svcText(s)}</>;
  if (done) {
    const dep = done.deposit_received_at ? done.deposit_amount : 0;
    return (
      <Dialog open onClose={onClose} title={`Çəkiliş bağlandı${done.cashback_earned > 0 ? ` · +${formatMoney(done.cashback_earned)} keşbek` : ''}`} subtitle={sub}
        footer={<><a className="btn btn--secondary btn--md" href={`#/insanlar/${done.client_id}`}>Müştəri kartı</a><Button variant="primary" onClick={onClose}>Bağla</Button></>}>
        <dl className="ck-facts">
          <div><dt>Yekun</dt><dd className="mono">{formatMoney(done.total)}</dd></div>
          {(dep > 0 || done.cashback_used > 0) && <div><dt>Beh + keşbek</dt><dd className="mono">{formatMoney(-(dep + done.cashback_used))}</dd></div>}
          {done.paid_at_studio > 0 && <div><dt>Qalığın ödənişi · {done.paid_method === 'card' ? 'Kart' : 'Nağd'}</dt><dd className="mono">{formatMoney(done.paid_at_studio)}</dd></div>}
        </dl>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title="Çəkilişi bağla" subtitle={sub}
      footer={<><Button variant="text" onClick={onClose}>Geri</Button><Button variant="primary" kbd="↵" disabled={!online || !quote || discBad || extrasBad || act.busy} onClick={close}>Çəkilişi bağla</Button></>}>
      <div className="ck-wide" />
      {!reels && (
        <div className="ck-line"><div><b>Faktiki müddət</b><span className="ck-sub">Yarım saat addımla</span></div>
          <Stepper text={formatHours(minutes)} label="Faktiki müddət" onDec={() => setDur(Math.max(30, minutes - 30))} onInc={() => setDur(Math.min(600, minutes + 30))} decDisabled={minutes <= 30} incDisabled={minutes >= 600} /></div>
      )}
      {pkg && (
        <div className="note"><b>Paketdən {formatHours(minutes)} çıxılır · qalan {formatHours(Math.max(0, pkg.minutes_left - minutes))} / {formatHours(pkg.minutes_total)}</b><span>{pkg.title}</span>
          <span>Paketdən çəkilişə keşbek yazılmır (əlavələr daxil).</span></div>
      )}
      <div className="field"><span className="field__label">Əlavə xərclər və endirim</span><Extras rows={rows} onChange={setExRows} /></div>
      <Field label="Endirim (AZN)" hint="Boş qalsa endirim yoxdur." error={discBad ? 'Məbləği düzgün yazın, məs. 50 və ya 12,5' : undefined}>
        {(i, bad) => <UnitInput id={i} unit="AZN" inputMode="decimal" placeholder="0" invalid={bad} value={discText ?? (s.discount ? aznInput(s.discount) : '')} onChange={(e) => setDiscText(e.target.value)} />}
      </Field>
      {quote ? (
        <dl className="ck-facts">
          {extras.map((x, i) => <div key={i}><dt>{x.name}</dt><dd className="mono">{formatMoney(x.amount)}</dd></div>)}
          {quote.discount > 0 && <><div><dt>Cəmi</dt><dd className="mono">{formatMoney(quote.gross)}</dd></div><div><dt>Endirim</dt><dd className="mono">{formatMoney(-quote.discount)}</dd></div></>}
          <div><dt>{pkg ? 'Pullu əlavələr' : 'Yekun'}</dt><dd className="mono">{formatMoney(quote.total)}</dd></div>
          {deposit > 0 && <div><dt>Beh ödənib</dt><dd className="mono">{formatMoney(-deposit)}</dd></div>}
          {s.cashback_used > 0 && <div><dt>Keşbekdən (əvvəl)</dt><dd className="mono">{formatMoney(-s.cashback_used)}</dd></div>}
        </dl>
      ) : qerr ? <ErrorBox title="Hesablana bilmədi" detail={qerr} /> : <LoadingRows rows={1} label="Hesablanır" />}
      {quote && (
        <>
          <label className="ck-switch"><Switch checked={extraCb > 0} disabled={usable === 0} onChange={setUseCb} label="Keşbekdən istifadə" />
            <span>Əlavə keşbek tətbiq et <small>{usable > 0 ? `Tətbiq olunacaq · ${formatMoney(usable)}` : quote.cashback_balance > 0 && quote.cashback_shoots_left > 0 ? `Balans ${formatMoney(quote.cashback_balance)} — 3-cü çəkilişdən istifadə olunur` : quote.cashback_balance > 0 ? `Keşbek balansı ${formatMoney(quote.cashback_balance)} — ${formatMoney(quote.cashback_min_use)}-ə çatanda istifadə olunur` : 'Keşbek balansı yoxdur'}</small></span></label>
          <div className="ck-total"><span>Qalıq{due > 0 ? ' · nağd / kart' : ''}</span><b className="mono">{formatMoney(due)}</b></div>
          {due > 0 && <div className="field"><span className="field__label">Qalığın ödənişi</span><Segmented label="Qalığın ödənişi" value={method} onChange={setMethod} options={[{ value: 'cash', label: 'Nağd' }, { value: 'card', label: 'Kart' }]} /></div>}
          {quote.cashback_earn > 0 && <p className="ck-info">Keşbek: +{formatMoney(quote.cashback_earn)}{quote.first_shoot_bonus ? ' (ilk çəkiliş bonusu)' : ''}</p>}
        </>
      )}
      {/* TODO [API] «Kartdan karta» ödəniş üsulu, «Ödəniş alındı» işarəsi (borc), montaj açarı, bağlama qeydi: CloseIn yalnız cash/card qəbul edir. */}
      <ChangeNote changes={['Çəkiliş «Bağlandı» olur, ödəniş qeydə alınır', 'Keşbek yazılır (paketdən olanda yazılmır)']} unchanged={['Çəkilişin tarixi və müştəri']} />
      {act.err && <span className="field__err" role="alert">{act.err}</span>}
    </Dialog>
  );
}
