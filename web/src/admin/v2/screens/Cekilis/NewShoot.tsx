import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../../shared/api';
import { formatHours, formatMin, formatMoney } from '../../../../shared/ui';
import { DATA_CHANGED, errMsg, useAction, useAuth, useLoad } from '../../../ctx';
import { addMin, aznInput, bakuParts, bakuToday, dateWd, minutesOf, parseAzn, timeRange, toIso } from '../../../format';
import { extraRows, type ExtraRow } from '../../../components/ExtrasEditor';
import { go } from '../../../router';
import type { Client, ClientDetail, Conflict, Kind, Location, Quote, Shoot, Slot, Tag } from '../../../types';
import { minToHhmm } from '../../data/time';
import { Avatar, Button, Chip, Dialog, EmptyState, ErrorBox, Field, LoadingRows, Segmented, Switch, TextArea, TextInput, V2Icon, useOnline, useToast } from '../../ui';
import { Chips, ClientPicker, Extras, Stepper, extrasOf } from './parts';
import { Ic, personName, refresh } from './bits';

// Saatlıq qiymət etiketləri (server/money.py cədvəli ilə eyni; hesabı server edir).
const PER_HOUR: Record<Location, number[]> = { studio: [70, 120, 170], onsite: [140, 240, 340] };
const TAGS: [Tag, string][] = [['podcast', 'Podkast'], ['reels', 'Reels'], ['other', 'Digər']];

/** Boş fasilələrdən müddətə sığan başlanğıclar (30 dəq şəbəkəsi). */
function chipsOf(slots: Slot[], dur: number): string[] {
  const set = new Set<number>();
  for (const sl of slots) {
    const a = minutesOf(sl.start), b = minutesOf(sl.end);
    set.add(a);
    for (let t = Math.ceil(a / 30) * 30; t + dur <= b; t += 30) set.add(t);
  }
  return [...set].filter((t) => slots.some((sl) => t >= minutesOf(sl.start) && t + dur <= minutesOf(sl.end))).sort((x, y) => x - y).map(minToHhmm);
}

/** «Yeni çəkiliş» (14) və düzəliş (editId) dialoqu. Köhnə ShootForm-un bütün sahələri saxlanılıb. */
export function NewShootDialog({ editId, query, onClose, onCreated }: { editId?: number; query: URLSearchParams; onClose: () => void; onCreated?: (s: Shoot) => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const edit = editId !== undefined;
  const orig = useLoad<Shoot>(edit ? `/shoots/${editId}` : null);
  const o = orig.data;
  const [hydrated, setHydrated] = useState(false);
  const [clientId, setClientId] = useState<number | null>(Number(query.get('insan') || query.get('client')) || null);
  const [pick, setPick] = useState(false);
  const [date, setDate] = useState(query.get('tarix') || query.get('date') || bakuToday());
  const [time, setTime] = useState(query.get('saat') || query.get('time') || '12:00');
  const [dur, setDur] = useState(60);
  const [prep, setPrep] = useState(15);
  const [wrap, setWrap] = useState(0);
  const [kind, setKind] = useState<Kind>('shoot');
  const [tag, setTag] = useState<Tag>((['podcast', 'reels', 'other'] as const).find((t) => t === query.get('xidmet')) ?? 'podcast'); // Inbox «Çəkiliş yarat»
  const [locSel, setLoc] = useState<Location>('studio');
  const [address, setAddress] = useState('');
  const [cameras, setCameras] = useState([1, 2, 3].includes(Number(query.get('kamera'))) ? Number(query.get('kamera')) : 2);
  const [editing, setEditing] = useState(false);
  const [reels, setReels] = useState(0);
  const [payWanted, setPayWanted] = useState<'paid' | 'package'>('paid');
  const [pkgSel, setPkgSel] = useState<number | null>(null);
  const [useCb, setUseCb] = useState(false);
  const [depositNow, setDepositNow] = useState(false);
  const [note, setNote] = useState('');
  const [exRows, setExRows] = useState<ExtraRow[]>([]);
  const [discText, setDiscText] = useState('');
  const [discPct, setDiscPct] = useState(false);
  const [discNote, setDiscNote] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qerr, setQerr] = useState('');
  const [studio, setStudio] = useState(false);
  const submit = useAction();
  const [created, setCreated] = useState<Shoot | null>(null); // yaradılıb, lakin beh qeydi alınmayıb: təkrar basanda çəkiliş yenidən yaradılmır

  // Düzəlişdə çəkilişin məlumatı bir dəfə sahələrə yazılır
  useEffect(() => {
    if (!o || hydrated) return;
    const p = bakuParts(o.starts_at);
    setClientId(o.client_id); setDate(p.date); setTime(p.time); setDur(o.duration_min); setPrep(o.prep_min); setWrap(o.wrap_min);
    setKind(o.kind); setTag(o.tag); setLoc(o.location); setAddress(o.address ?? ''); setCameras(o.cameras || 1);
    setEditing(o.editing); setReels(o.reels_count); setNote(o.note ?? '');
    setExRows(extraRows(o.extras ?? []));
    if (o.discount > 0) { setDiscText(aznInput(o.discount)); setDiscNote(o.discount_note ?? ''); }
    setHydrated(true);
  }, [o, hydrated]);

  const { list: extras, bad: extrasBad } = extrasOf(exRows);
  const extrasKey = JSON.stringify(extras);
  const detail = useLoad<ClientDetail>(clientId && !edit ? `/clients/${clientId}` : null).data;
  const clients = useLoad<Client[]>('/clients').data;
  const reelsPack = kind === 'reels_pack', rent = kind === 'studio_rent';
  const loc: Location = rent ? 'studio' : locSel;
  const step = reelsPack ? 15 : 30;
  const end = addMin(time, dur);
  // % rejimində AZN məbləği ümumi məbləğdən hesablanır (server yalnız AZN qəbul edir)
  const pctH = discPct && discText.trim() ? parseAzn(discText) : null;
  const gross = quote?.gross ?? 0;
  const discParsed = !discText.trim() ? 0 : discPct ? (pctH !== null && pctH <= 10000 ? Math.floor((gross * pctH + 5000) / 10000) : null) : parseAzn(discText);
  const discBad = discParsed === null, discount = discParsed ?? 0;
  const pkgs = (detail?.packages ?? []).filter((p) => p.minutes_left > 0 && p.ends_on >= date);
  const pay = edit ? (o?.package_id ? 'package' : 'paid') : payWanted === 'package' && pkgs.length && kind === 'shoot' ? 'package' : 'paid';
  const pkgId = edit ? (o?.package_id ?? null) : pay === 'package' ? (pkgs.find((p) => p.id === pkgSel) ?? pkgs[0]).id : null;
  const reelsN = editing && kind === 'shoot' ? reels : 0;
  const usable = quote?.cashback_usable ?? 0;
  const cashback = edit ? 0 : useCb ? usable : 0;
  const cbShown = edit ? (o?.cashback_used ?? 0) : cashback;
  const depPaid = edit ? (o?.deposit_amount ?? 0) : 0;

  const body = useMemo(() => (clientId && (!edit || hydrated) && date && /^\d{2}:\d{2}$/.test(time) && !discBad && !extrasBad ? {
    client_id: clientId, starts_at: toIso(date, time), duration_min: dur, kind, tag: rent ? 'other' : reelsPack ? 'reels' : tag,
    location: loc, cameras: rent ? 0 : reelsPack ? 1 : cameras, editing: kind === 'shoot' ? editing : false, reels_count: reelsN,
    package_id: pkgId, cashback_use: cashback, address: loc === 'onsite' ? address.trim() || null : null, note: note.trim() || null,
    extras, discount, discount_note: discount > 0 ? discNote.trim() || null : null, prep_min: prep, wrap_min: wrap,
  } : null), [clientId, hydrated, date, time, dur, kind, tag, loc, address, cameras, editing, reelsN, reelsPack, rent, pkgId, cashback, note, discBad, extrasBad, extrasKey, discount, discNote, prep, wrap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Qiymət: 250ms gecikmə ilə serverdən
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!body) { setQuote(null); return; }
    let live = true;
    const t = setTimeout(() => {
      call<Quote>(edit ? `/shoots/quote?exclude_id=${editId}` : '/shoots/quote', { body })
        .then((q) => { if (live) { setQuote(q); setQerr(''); } })
        .catch((e) => { if (live) { setQuote(null); setQerr(errMsg(e)); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots = useLoad<Slot[]>(date ? `/free-slots?day=${date}` : null);
  const chips = useMemo(() => (slots.data ? chipsOf(slots.data, dur) : []), [slots.data, dur]);

  const balance = detail?.cashback_balance ?? 0;
  const depositExpected = quote?.deposit_expected ?? 0;
  const conflicts = quote?.conflicts ?? [];
  const ready = !!quote && !qerr && !submit.busy && conflicts.length === 0 && online;
  const past = !edit && (date < bakuToday());
  const clientName = edit ? o?.client_name : detail?.full_name ?? clients?.find((c) => c.id === clientId)?.full_name;

  async function save() {
    if (!body || !o) return;
    const { client_id: _c, package_id: _p, cashback_use: _u, ...patch } = body;
    const s = await submit.run(() => call<Shoot>(`/shoots/${o.id}`, { method: 'PATCH', body: patch }));
    if (!s) return;
    window.dispatchEvent(new Event(DATA_CHANGED));
    toast.show(`Yadda saxlandı · ${personName(o)}`);
    onClose();
  }
  async function create() {
    if (!body) return;
    // Forma beh sorğusu bitənə qədər məşğul qalır (ikinci kliklə təkrar çəkiliş yaranmasın)
    const s = await submit.run(async () => {
      const sh = created ?? await call<Shoot>('/shoots', { body });
      setCreated(sh);
      if (depositNow && depositExpected > 0) {
        try { await call(`/shoots/${sh.id}/deposit`, { body: { amount: depositExpected } }); }
        catch (e) { throw new ApiError(0, `Çəkiliş yaradıldı, lakin beh qeyd olunmadı: ${errMsg(e)} Yenidən basın — çəkiliş təkrar yaradılmayacaq, yalnız beh qeyd olunacaq.`); }
      }
      return sh;
    });
    if (s) {
      refresh();
      toast.show(`Çəkiliş yazıldı · ${clientName ?? ''}, ${date.slice(8)}.${date.slice(5, 7)} ${time}${depositExpected > 0 && !depositNow ? ` · beh ${formatMoney(depositExpected)} gözlənilir` : ''}`);
      onCreated?.(s);
      go(`cekilisler/teqvim?tarix=${date}&gorunus=gun&secili=${s.id}`);
    }
  }

  function pickKind(k: Kind) {
    setKind(k);
    if (k === 'reels_pack') setDur(60);
    else if (dur % 30) setDur(Math.ceil(dur / 30) * 30);
  }
  function pickEnd(v: string) {
    const d = minutesOf(v) - minutesOf(time);
    if (d > 0) setDur(Math.min(600, Math.max(step, Math.round(d / step) * step)));
  }
  const conflictText = (c: Conflict) => c.type === 'shoot'
    ? `${clients?.find((x) => x.id === c.client_id)?.full_name ?? 'başqa çəkiliş'} ilə (${timeRange(c.starts_at, c.duration_min)})`
    : `“${c.reason || 'Bloklanıb'}” bloku ilə (${bakuParts(c.starts_at).time}–${bakuParts(c.ends_at).time})`;

  const left = quote ? Math.max(0, quote.total - cbShown - (edit ? depPaid : depositNow ? depositExpected : 0)) : 0;
  const totalTxt = quote ? formatMoney(quote.total) : '—';
  const submitLabel = created ? 'Behi qeyd et' : edit ? `Yadda saxla${quote ? ` · ${totalTxt}` : ''}` : `Çəkilişi yaz${quote ? ` · ${totalTxt}` : ''}`;
  const title = edit ? 'Çəkilişi düzəlt' : 'Yeni çəkiliş';
  const money = (label: string, q: number, cls = '') => <div className={cls}><dt>{label}</dt><dd className="mono">{formatMoney(q)}</dd></div>;

  return (
    <Dialog open size="lg" onClose={onClose} title={title} subtitle={edit ? (o ? `${dateWd(date)} · ${time} · ${o.client_name}` : undefined) : undefined}
      footer={<><Button variant="text" onClick={onClose}>Ləğv et</Button><Button variant="primary" kbd="↵" disabled={!ready || discBad || past} onClick={edit ? save : create}>{submitLabel}</Button></>}>
      {edit && orig.err && <ErrorBox title="Çəkiliş yüklənmədi" detail={orig.err} onRetry={orig.reload} />}
      <div className="ck-form">
        <div className="ck-form__main">
          {edit && <p className="ck-info"><Ic name="lock" size={14} /> Müştəri, ödəniş, keşbek və beh çəkiliş yaradılandan sonra dəyişdirilmir.</p>}

          <section className="ck-sec" aria-label="Müştəri">
            <h3 className="ck-sec__h">1 · İnsan</h3>
            {edit || (clientId && !pick) ? (
              <div className="ck-chosen">
                <Avatar name={clientName ?? '?'} />
                <span className="ck-chosen__m"><b>{clientName ?? 'Yüklənir…'}</b>{!edit && balance > 0 && <span className="ck-sub">Keşbek balansı {formatMoney(balance)}</span>}</span>
                {!edit && quote?.deposit_required && <Chip tone="deposit">Beh mütləqdir</Chip>}
                {edit ? <Ic name="lock" size={16} /> : <Button size="sm" variant="text" aria-label="Seçimi sil" onClick={() => { setClientId(null); setPick(true); }}><V2Icon name="x" /></Button>}
              </div>
            ) : (
              <ClientPicker initialQuery={query.get('tel') || query.get('ad') || ''} onPick={(c) => { setClientId(c.id); setPayWanted('paid'); setUseCb(false); setPick(false); }} />
            )}
          </section>

          <section className="ck-sec" aria-label="Xidmət">
            <h3 className="ck-sec__h">2 · Xidmət</h3>
            <Segmented label="Xidmət" value={kind} onChange={pickKind} options={[{ value: 'shoot', label: 'Çəkiliş' }, { value: 'reels_pack', label: 'Reels paketi' }, { value: 'studio_rent', label: 'Müştəri özü çəkir' }]} />
            {kind === 'shoot' && <Chips label="Nə çəkilir" value={tag} onChange={setTag} options={TAGS.map(([v, l]) => ({ value: v, label: l }))} />}
            {!rent && <Segmented label="Məkan" value={loc} onChange={setLoc} options={[{ value: 'studio', label: 'Studiyada' }, { value: 'onsite', label: 'Sizin məkanda' }]} />}
            {loc === 'onsite' && <Field label="Ünvan">{(i) => <TextInput id={i} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Küçə, bina, mənzil" />}</Field>}
            {kind === 'shoot' && (
              <div className="field"><span className="field__label">Kamera · 1 saat (AZN)</span>
                <Chips label="Kamera" value={String(cameras)} onChange={(v) => setCameras(Number(v))} options={[1, 2, 3].map((c) => ({ value: String(c), label: `${c} · ${PER_HOUR[loc][c - 1]} AZN` }))} /></div>
            )}
          </section>

          <section className="ck-sec" aria-label="Nə vaxt">
            <h3 className="ck-sec__h">3 · Nə vaxt</h3>
            <div className="ck-grid3">
              <Field label="Tarix">{(i) => <TextInput id={i} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
              <Field label="Başlanğıc">{(i) => <TextInput id={i} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
              <Field label="Bitmə">{(i) => <TextInput id={i} type="time" value={end} onChange={(e) => pickEnd(e.target.value)} />}</Field>
            </div>
            {!reelsPack && <div className="ck-line"><b>Müddət</b><Stepper text={formatHours(dur)} label="Müddət" onDec={() => setDur(Math.max(step, dur - step))} onInc={() => setDur(Math.min(600, dur + step))} decDisabled={dur <= step} incDisabled={dur >= 600} /></div>}
            <div className="field"><span className="field__label">Boş vaxt</span>
              {slots.err ? <ErrorBox title="Boş vaxtlar yüklənmədi" detail={slots.err} onRetry={slots.reload} />
                : !slots.data ? <LoadingRows rows={1} />
                : chips.length ? <Chips label="Boş vaxt" value={time} onChange={setTime} options={chips.slice(0, 12).map((c) => ({ value: c, label: c }))} />
                : <EmptyState title="Bu gün boş vaxt yoxdur" reason="Başqa gün seçin." />}
            </div>
            {past && <div className="ck-warn" role="alert">Keçmiş tarixə çəkiliş yazmaq olmur</div>}
            {conflicts.length > 0 && (
              <div className="ck-warn" role="alert" data-testid="conflicts">
                <span>{conflicts.map((c) => <span key={`${c.type}${c.id}`} style={{ display: 'block' }}>Bu vaxt <b>{conflictText(c)}</b> üst-üstə düşür (hazırlıq/yığışdırma daxil). Başqa saat seçin.</span>)}</span>
              </div>
            )}
            <button type="button" className="ck-fold" aria-expanded={studio} onClick={() => setStudio(!studio)}>
              <span>Studiya vaxtı</span><span className="mono">Məşğul: {addMin(time || '00:00', -prep)} – {addMin(time || '00:00', dur + wrap)}</span><Ic name={studio ? 'chevu' : 'chevd'} />
            </button>
            {studio && (
              <div className="ck-fold__b">
                <div className="ck-line"><span>Hazırlıq əvvəl</span><Stepper text={formatMin(prep)} label="Hazırlıq" onDec={() => setPrep(Math.max(0, prep - 5))} onInc={() => setPrep(Math.min(240, prep + 5))} decDisabled={prep <= 0} incDisabled={prep >= 240} /></div>
                <div className="ck-line"><span>Yığışdırma sonra</span><Stepper text={formatMin(wrap)} label="Yığışdırma" onDec={() => setWrap(Math.max(0, wrap - 5))} onInc={() => setWrap(Math.min(240, wrap + 5))} decDisabled={wrap <= 0} incDisabled={wrap >= 240} /></div>
                <span className="ck-sub">Müştəri bunları görmür.</span>
              </div>
            )}
          </section>

          <section className="ck-sec" aria-label="Əlavələr">
            <h3 className="ck-sec__h">4 · Əlavələr</h3>
            {kind === 'shoot' && (
              <>
                <label className="ck-switch"><Switch checked={editing} onChange={setEditing} label="Montaj" /><span>Montaj <small>Kəsim, səs təmizləmə, final export · +100 AZN</small></span></label>
                <div className={`ck-reels${editing ? '' : ' is-dim'}`}>
                  <b>Podcastdan Reels</b><span className="ck-sub">Podcastın içindən kəsilən qısa videolar · hər biri 10 AZN</span>
                  <div className="ck-line"><Stepper text={String(reelsN)} label="Podcastdan Reels sayı" onDec={() => setReels(Math.max(0, reelsN - 1))} onInc={() => setReels(Math.min(50, reelsN + 1))} decDisabled={!editing || reelsN <= 0} incDisabled={!editing || reelsN >= 50} />
                    <span className="ck-sub">{!editing ? 'Montaj olmadan seçilmir' : `${reelsN} Reels × 10 = ${reelsN * 10} AZN`}</span></div>
                </div>
              </>
            )}
            <div className="field"><span className="field__label">Əlavə xərclər</span><Extras rows={exRows} onChange={setExRows} /></div>
            <Field label={`Endirim (${discPct ? '%' : 'AZN'})`} hint={discBad ? undefined : discPct && discount > 0 ? `= ${formatMoney(discount)}` : 'Boş qalsa endirim yoxdur.'} error={discBad ? (discPct ? 'Faizi 0–100 arasında yazın' : 'Məbləği düzgün yazın, məs. 50 və ya 12,5') : undefined}>
              {(i, bad) => (
                <div className="ck-disc"><TextInput id={i} inputMode="decimal" placeholder="0" invalid={bad} value={discText} onChange={(e) => setDiscText(e.target.value)} />
                  <Segmented label="Endirim vahidi" value={discPct ? 'pct' : 'azn'} onChange={(v) => setDiscPct(v === 'pct')} options={[{ value: 'azn', label: 'AZN' }, { value: 'pct', label: '%' }]} /></div>
              )}
            </Field>
            {discount > 0 && <Field label="Səbəb" hint="Yalnız admin görür.">{(i) => <TextInput id={i} value={discNote} maxLength={255} onChange={(e) => setDiscNote(e.target.value)} placeholder="məs. daimi müştəri" />}</Field>}
          </section>

          <section className="ck-sec" aria-label="Ödəniş">
            <h3 className="ck-sec__h">5 · Ödəniş və qeyd</h3>
            {edit ? (
              o && (
                <div className="note">
                  <span><Ic name="lock" size={12} /> Ödəniş: {o.package_id ? 'Paketdən' : 'Pullu'}</span>
                  <span>Keşbek: {cbShown > 0 ? `tətbiq olunub · ${formatMoney(-cbShown)}` : 'tətbiq olunmayıb'}</span>
                  {o.deposit_expected > 0 && <span>Beh: {o.deposit_received_at ? 'alındı' : 'gözlənilir'}</span>}
                </div>
              )
            ) : (
              <>
                {!rent && (
                  <div className="field"><span className="field__label">Ödəniş</span>
                    <Segmented label="Ödəniş" value={pay} onChange={setPayWanted} options={[{ value: 'paid', label: 'Pullu' }, { value: 'package', label: 'Paketdən' }]} />
                    {!pkgs.length && <span className="field__hint">Müştərinin aktiv saat paketi yoxdur.</span>}
                  </div>
                )}
                {pay === 'package' && pkgs.length > 1 && (
                  <select className="input" aria-label="Paket" value={pkgId ?? ''} onChange={(e) => setPkgSel(Number(e.target.value))}>
                    {pkgs.map((p) => <option key={p.id} value={p.id}>{p.title} · {formatHours(p.minutes_left)} qalıb</option>)}
                  </select>
                )}
                {pay === 'package' && pkgs.length === 1 && <div className="note"><b>{pkgs[0].title}</b><span>{formatHours(pkgs[0].minutes_left)} qalıb · əlavə kamera (saatda 50 AZN) avtomatik hesablanır.</span></div>}
                <label className="ck-switch"><Switch checked={useCb && usable > 0} disabled={usable === 0} onChange={setUseCb} label="Keşbekdən istifadə" />
                  <span>{usable > 0 ? `Keşbekdən istifadə et · ${formatMoney(usable)}` : 'Keşbekdən istifadə'}
                    {usable === 0 && balance > 0 && <small>{(quote?.cashback_shoots_left ?? 0) > 0 ? `Balans ${formatMoney(balance)} — 3-cü çəkilişdən istifadə olunur` : `Balans ${formatMoney(balance)} — ${formatMoney(quote?.cashback_min_use ?? 7000)}-ə çatanda istifadə olunur`}</small>}</span></label>
                {quote?.deposit_required && <div className="ck-warn"><b>Beh mütləqdir</b> — müştəri əvvəl gəlməyib. Behi mütləq alın.</div>}
                {depositExpected > 0 && (
                  <div className="field"><span className="field__label">Beh</span>
                    <Segmented label="Beh" value={depositNow ? 'got' : 'wait'} onChange={(v) => setDepositNow(v === 'got')} options={[{ value: 'wait', label: 'Gözlənilir' }, { value: 'got', label: 'Alındı' }]} /></div>
                )}
                {/* TODO [API] «Beh məlumatını göndər» (WhatsApp, kart nömrəsi ilə şablon) və «Qaralama saxla»: endpoint yoxdur. */}
              </>
            )}
            <Field label="Qeyd">{(i) => <TextArea id={i} value={note} onChange={(e) => setNote(e.target.value)} placeholder="məs. Qonaqla gələcək" />}</Field>
          </section>
        </div>

        <aside className="ck-form__side" aria-label="Xülasə">
          <h3 className="ck-sec__h">Xülasə</h3>
          {quote && body ? (
            <dl className="ck-facts">
              <div><dt>Tarix</dt><dd className="mono">{date.slice(8)}.{date.slice(5, 7)} · {time}–{end}</dd></div>
              {money(pay === 'package' ? `Paketdən · ${formatHours(body.duration_min)}` : reelsPack ? 'Reels paketi' : rent ? `Müştəri özü çəkir · ${formatHours(dur)}` : `${cameras} kamera · ${loc === 'studio' ? 'studiyada' : 'məkanda'}`, quote.base)}
              {quote.extra_camera > 0 && money('Əlavə kamera', quote.extra_camera)}
              {(reelsN > 0 || (editing && kind === 'shoot')) && money('Montaj', quote.editing)}
              {reelsN > 0 && money(`Reels · ${reelsN} × 10`, quote.reels)}
              {extras.map((x, i) => money(x.name, x.amount, `x${i}`))}
              {quote.discount > 0 && <>{money('Cəmi', quote.gross)}{money('Endirim', -quote.discount)}</>}
              <div className="ck-facts__sum"><dt>{quote.discount > 0 ? 'Yekun' : 'Cəmi'}</dt><dd className="mono">{totalTxt}</dd></div>
              {cbShown > 0 && money('Keşbekdən', -cbShown)}
              {edit && depPaid > 0 && money('Alınmış beh', depPaid)}
              {!edit && depositExpected > 0 && <div><dt>{depositNow ? 'Beh alınacaq' : 'Beh gözlənilir'}</dt><dd><Chip tone="deposit">{formatMoney(depositExpected)}</Chip></dd></div>}
              {money('Studiyada qalıq', left)}
            </dl>
          ) : qerr ? <ErrorBox title="Hesablana bilmədi" detail={qerr} /> : <p className="ck-sub">{clientId || edit ? 'Hesablanır…' : 'Əvvəl insanı seçin.'}</p>}
          {quote && quote.cashback_earn > 0 && <p className="ck-info">Bağlananda keşbek: +{formatMoney(quote.cashback_earn)}{quote.first_shoot_bonus ? ' (ilk çəkiliş bonusu)' : ''}</p>}
          {submit.err && <span className="field__err" role="alert">{submit.err}</span>}
        </aside>
      </div>
    </Dialog>
  );
}
