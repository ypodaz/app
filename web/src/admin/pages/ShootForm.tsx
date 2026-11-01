import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AdminShell, formatHours, formatMin, formatMoney } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { AChip, ASeg, AStep, PageHead } from '../components/neon';
import { CountStepper, Err, Field, TAG } from '../components/common';
import { ClientPickerSheet } from '../components/ClientPicker';
import { ExtrasEditor, extraRows, extrasOf, type ExtraRow } from '../components/ExtrasEditor';
import { DATA_CHANGED, errMsg, useAction, useAuth, useLoad } from '../ctx';
import { addMin, aznInput, bakuParts, bakuToday, dateLong, dateWd, initials, minutesOf, parseAzn, timeRange, toIso } from '../format';
import { go, useWide } from '../router';
import type { ClientDetail, ClientRow, Conflict, Kind, Location, Quote, Shoot, Tag } from '../types';

// Saatlıq qiymət etiketləri (server/money.py cədvəli ilə eynidir; hesabı server edir).
const PER_HOUR: Record<Location, number[]> = { studio: [70, 120, 170], onsite: [140, 240, 340] };

// B2d/B2e: çəkiliş əlavə et. editId verilibsə: təsdiqlənmiş çəkilişin düzəlişi (müştəri, ödəniş və beh dəyişmir).
export function ShootForm({ query, editId }: { query: URLSearchParams; editId?: number }) {
  const { call } = useAuth();
  const edit = editId !== undefined;
  const orig = useLoad<Shoot>(edit ? `/shoots/${editId}` : null);
  const o = orig.data;
  const [hydrated, setHydrated] = useState(false);
  const [clientId, setClientId] = useState<number | null>(Number(query.get('client')) || null);
  const [pick, setPick] = useState(false);
  const [date, setDate] = useState(query.get('date') || bakuToday());
  const [time, setTime] = useState(query.get('time') || '12:00');
  const [dur, setDur] = useState(60);
  const [prep, setPrep] = useState(15);
  const [wrap, setWrap] = useState(0);
  const [kind, setKind] = useState<Kind>('shoot');
  const [tag, setTag] = useState<Tag>('podcast');
  const [locSel, setLoc] = useState<Location>('studio');
  const [address, setAddress] = useState('');
  const [cameras, setCameras] = useState(1);
  const [editing, setEditing] = useState(false);
  const [reels, setReels] = useState(0);
  const [payWanted, setPayWanted] = useState<'paid' | 'package'>('paid');
  const [pkgSel, setPkgSel] = useState<number | null>(null);
  const [useCb, setUseCb] = useState(false);
  const [depositNow, setDepositNow] = useState(false);
  const [note, setNote] = useState('');
  const [extraRowsSt, setExtraRows] = useState<ExtraRow[]>([]);
  const [discText, setDiscText] = useState('');
  const [discPct, setDiscPct] = useState(false);
  const [discNote, setDiscNote] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qerr, setQerr] = useState('');
  const submit = useAction();

  // Düzəlişdə çəkilişin məlumatı bir dəfə sahələrə yazılır
  useEffect(() => {
    if (!o || hydrated) return;
    const p = bakuParts(o.starts_at);
    setClientId(o.client_id); setDate(p.date); setTime(p.time); setDur(o.duration_min); setPrep(o.prep_min); setWrap(o.wrap_min);
    setKind(o.kind); setTag(o.tag); setLoc(o.location); setAddress(o.address ?? ''); setCameras(o.cameras || 1);
    setEditing(o.editing); setReels(o.reels_count); setNote(o.note ?? '');
    setExtraRows(extraRows(o.extras ?? []));
    if (o.discount > 0) { setDiscText(aznInput(o.discount)); setDiscNote(o.discount_note ?? ''); }
    setHydrated(true);
  }, [o, hydrated]);

  const { list: extras, bad: extrasBad } = extrasOf(extraRowsSt);
  const extrasKey = JSON.stringify(extras);
  const detail = useLoad<ClientDetail>(clientId && !edit ? `/clients/${clientId}` : null).data;
  const clients = useLoad<ClientRow[]>('/clients').data;
  const reelsPack = kind === 'reels_pack', rent = kind === 'studio_rent';
  const loc: Location = rent ? 'studio' : locSel;
  const step = reelsPack ? 15 : 30;
  const end = addMin(time, dur);
  // % rejimində AZN məbləği ümumi məbləğdən (gross) hesablanır, qəpiyə yarım-yuxarı yuvarlaqlaşdırma; server yalnız AZN qəbul edir
  const pctH = discPct && discText.trim() ? parseAzn(discText) : null; // faiz yüzdə birlərlə (12,5 → 1250)
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

  const body = useMemo(() => (clientId && (!edit || hydrated) && date && time && !discBad && !extrasBad ? {
    client_id: clientId, starts_at: toIso(date, time), duration_min: dur, kind, tag: rent ? 'other' : reelsPack ? 'reels' : tag,
    location: loc, cameras: rent ? 0 : reelsPack ? 1 : cameras, editing: kind === 'shoot' ? editing : false, reels_count: reelsN,
    package_id: pkgId, cashback_use: cashback, address: loc === 'onsite' ? address.trim() || null : null, note: note.trim() || null,
    extras, discount, discount_note: discount > 0 ? discNote.trim() || null : null, prep_min: prep, wrap_min: wrap,
  } : null), [clientId, hydrated, date, time, dur, kind, tag, loc, address, cameras, editing, reelsN, reelsPack, rent, pkgId, cashback, note, discBad, extrasBad, extrasKey, discount, discNote, prep, wrap]);

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
  }, [key]);

  const balance = detail?.cashback_balance ?? 0;
  const depositExpected = quote?.deposit_expected ?? 0;
  const ready = !!quote && !qerr && !submit.busy;

  async function save() {
    if (!body || !o) return;
    const { client_id: _c, package_id: _p, cashback_use: _u, ...patch } = body;
    const s = await submit.run(() => call<Shoot>(`/shoots/${o.id}`, { method: 'PATCH', body: patch }));
    if (!s) return;
    window.dispatchEvent(new Event(DATA_CHANGED));
    go(`shoots/${o.id}`);
  }

  async function create() {
    if (!body) return;
    const s = await submit.run(() => call<Shoot>('/shoots', { body }));
    if (!s) return;
    if (depositNow && depositExpected > 0) await call(`/shoots/${s.id}/deposit`, { body: { amount: depositExpected } }).catch(() => {});
    go(`shoots/${s.id}`);
  }

  function pickKind(k: Kind) {
    setKind(k);
    if (k !== 'reels_pack' && dur % 30) setDur(Math.ceil(dur / 30) * 30);
  }
  // Bitmə saatı dəyişəndə müddət yenilənir (addıma yuvarlanır)
  function pickEnd(v: string) {
    const d = minutesOf(v) - minutesOf(time);
    if (d > 0) setDur(Math.min(600, Math.max(step, Math.round(d / step) * step)));
  }
  const conflictText = (c: Conflict) => c.type === 'shoot'
    ? `${clients?.find((x) => x.id === c.client_id)?.full_name ?? 'başqa çəkiliş'} ilə (${timeRange(c.starts_at, c.duration_min)})`
    : `“${c.reason || 'Bloklanıb'}” bloku ilə (${bakuParts(c.starts_at).time}–${bakuParts(c.ends_at).time})`;

  const moneyRow = (label: string, q: number, cls = '') => <div className={`a-sr m ${cls}`}><span>{label}</span><b>{formatMoney(q)}</b></div>;
  const wide = useWide();
  const [studio, setStudio] = useState<boolean | null>(null);
  const studioOpen = studio ?? wide;
  const back = edit ? `shoots/${editId}` : 'calendar';
  const left = quote ? Math.max(0, quote.total - cbShown - (edit ? depPaid : depositExpected)) : 0;
  const totalTxt = quote ? formatMoney(quote.total).replace(' AZN', '') : '—';
  const submitLabel = edit ? (quote ? `Yadda saxla · ${formatMoney(quote.total)}` : 'Yadda saxla') : quote ? `Əlavə et · ${formatMoney(quote.total)}` : 'Əlavə et';
  const noteField = <Field label="Qeyd" id="sf-note"><textarea id="sf-note" className="inp ta" value={note} onChange={(e) => setNote(e.target.value)} placeholder="məs. Qonaqla gələcək" /></Field>;
  const cbRow = (on: boolean, dis: boolean, onClick: () => void, title: string, sub?: string, lock?: boolean) => (
    <div className="a-trow">
      <span className="a-trow-m"><b>{title}{lock && <AIcon name="lock" size={14} />}</b>{sub && <span>{sub}</span>}</span>
      <button type="button" className={`tgl${on ? ' tgl-on' : ''}`} role="switch" aria-checked={on} aria-label="Keşbekdən istifadə" disabled={dis} onClick={onClick} />
    </div>
  );
  let n = 0;
  const rs = () => ({ '--i': n++ }) as CSSProperties;

  return (
    <AdminShell active="calendar" title={edit ? 'Çəkilişi düzəlt' : 'Çəkiliş əlavə et'} bare full>
      <PageHead title={edit ? 'Çəkilişi düzəlt' : 'Çəkiliş əlavə et'} back={back}
        sub={edit ? (o ? `${dateWd(date)} · ${time} · ${o.client_name}` : undefined) : `${dateLong(date)} ${date.slice(0, 4)}`}
        actions={<a className="a-bg" href={`#/${back}`}>Ləğv et</a>} />
      {edit && orig.err && <Err msg={orig.err} />}
      <div className="a-form a-nofab">
        <div className="a-fs">
          {edit && <div className="a-info a-rise" style={rs()}><AIcon name="lock" size={16} /><span>Müştəri, ödəniş, keşbek və beh çəkiliş yaradılandan sonra dəyişdirilmir.</span></div>}
          {edit ? (
            <section className="a-g a-lockc a-rise" style={rs()}>
              <span className="a-lb">Müştəri<AIcon name="lock" size={14} /></span>
              <div className="a-pickc on lock"><span className="a-av">{initials(o?.client_name ?? '?').slice(0, 1)}</span><span className="a-pc-m"><b>{o?.client_name ?? 'Yüklənir…'}</b></span><AIcon name="lock" size={18} /></div>
            </section>
          ) : (
            <section className="a-g a-rise" style={rs()}>
              <label className="a-lb" htmlFor="sf-client">Müştəri</label>
              <button id="sf-client" type="button" className={`a-pickc${detail ? ' on' : ''}`} onClick={() => setPick(true)}>
                {detail ? (
                  <>
                    <span className="a-av">{initials(detail.full_name).slice(0, 1)}</span>
                    <span className="a-pc-m"><b>{detail.full_name}</b>{balance > 0 && <span className="g">Keşbek balansı {formatMoney(balance)}</span>}</span>
                    {quote?.deposit_required && <AChip tone="beh">Beh mütləqdir</AChip>}
                  </>
                ) : (
                  <>
                    <span className="a-av"><AIcon name="user" size={20} /></span>
                    <span className="a-pc-m"><b>{clientId ? 'Yüklənir…' : 'Müştəri seçin və ya yenisini yaradın'}</b></span>
                  </>
                )}
                <AIcon name="chev" size={20} />
              </button>
            </section>
          )}

          <section className="a-g a-rise" style={rs()}>
            <div className="a-dt3">
              <Field label="Tarix" id="sf-d"><input id="sf-d" type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Başlanğıc" id="sf-t"><input id="sf-t" type="time" className="inp" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              <Field label="Bitmə" id="sf-e"><input id="sf-e" type="time" className="inp" value={end} onChange={(e) => pickEnd(e.target.value)} /></Field>
            </div>
            <div className="a-mrow"><span className="a-lb">Müddət</span><AStep text={formatHours(dur)} label="Müddət" onDec={() => setDur(Math.max(step, dur - step))} onInc={() => setDur(Math.min(600, dur + step))} decDisabled={dur <= step} incDisabled={dur >= 600} /></div>
          </section>

          <section className="a-g a-rise" style={rs()}>
            <button type="button" className="a-fold" aria-expanded={studioOpen} onClick={() => setStudio(!studioOpen)}>
              <span className="a-cardh">Studiya vaxtı</span>
              <span className="a-fold-r" data-testid="busy"><span><span className="a-ph-hide">Studiya məşğul</span><span className="a-ph-only">Məşğul</span>: {addMin(time, -prep)} – {addMin(time, dur + wrap)}</span><AIcon name={studioOpen ? 'chevu' : 'chevd'} size={18} /></span>
            </button>
            {studioOpen && (
              <div className="a-fold-b">
                <div className="a-prow"><span>Hazırlıq əvvəl</span><AStep text={formatMin(prep)} label="Hazırlıq" onDec={() => setPrep(Math.max(0, prep - 5))} onInc={() => setPrep(Math.min(240, prep + 5))} decDisabled={prep <= 0} incDisabled={prep >= 240} narrow /></div>
                <div className="a-prow"><span>Yığışdırma sonra</span><AStep text={formatMin(wrap)} label="Yığışdırma" onDec={() => setWrap(Math.max(0, wrap - 5))} onInc={() => setWrap(Math.min(240, wrap + 5))} decDisabled={wrap <= 0} incDisabled={wrap >= 240} narrow /></div>
                <span className="a-note">Müştəri bunları görmür.</span>
              </div>
            )}
          </section>
          {quote && quote.conflicts.length > 0 && (
            <div className="a-warn" role="alert" data-testid="conflicts">
              <AIcon name="warn" size={18} />
              <span>{quote.conflicts.map((c) => <span key={`${c.type}${c.id}`}>Bu vaxt <b>{conflictText(c)}</b> üst-üstə düşür (hazırlıq/yığışdırma daxil)</span>)}</span>
            </div>
          )}

          <section className="a-g a-rise a-gs" style={rs()}>
            <div><span className="a-lb">Xidmət</span>
              <ASeg label="Xidmət" value={kind} onChange={pickKind} options={[{ value: 'shoot', label: 'Çəkiliş' }, { value: 'reels_pack', label: 'Reels paketi' }, { value: 'studio_rent', label: 'Studiya icarəsi' }]} /></div>
            {kind === 'shoot' && (
              <div><span className="a-lb">Nə çəkilir</span>
                <div className="chips" role="group" aria-label="Nə çəkilir">
                  {(['podcast', 'reels', 'other'] as Tag[]).map((t) => <button key={t} type="button" className={`chip${tag === t ? ' chip-on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(t)}>{TAG[t]}</button>)}
                </div></div>
            )}
            {!rent && <div><span className="a-lb">Məkan</span><ASeg label="Məkan" value={loc} onChange={setLoc} options={[{ value: 'studio', label: 'Studiyada' }, { value: 'onsite', label: 'Sizin məkanda' }]} /></div>}
            {loc === 'onsite' && <Field label="Ünvan" id="sf-addr"><input id="sf-addr" className="inp" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Küçə, bina, mənzil" /></Field>}
            {kind === 'shoot' && (
              <div><span className="a-lb">Kamera · 1 saat (AZN)</span>
                <div className="a-cams" role="group" aria-label="Kamera">
                  {[1, 2, 3].map((c) => <button key={c} type="button" className="a-cc" aria-pressed={cameras === c} onClick={() => setCameras(c)}><b>{c}</b><span>{PER_HOUR[loc][c - 1]} AZN</span></button>)}
                </div></div>
            )}
          </section>

          {kind === 'shoot' && (
            <section className="a-g a-rise a-gs" style={rs()}>
              <div className="a-trow">
                <span className="a-trow-m"><b>Montaj</b><span>Kəsim, səs təmizləmə, final export · +100 AZN</span></span>
                <button type="button" className={`tgl${editing ? ' tgl-on' : ''}`} role="switch" aria-checked={editing} aria-label="Montaj" onClick={() => setEditing(!editing)} />
              </div>
              <div className={`a-reels${editing ? '' : ' dim'}`}>
                <b>Podcastdan Reels</b><span className="a-note">Podcastın içindən kəsilən qısa videolar · hər biri 10 AZN</span>
                <div className="a-mrow">
                  <CountStepper value={reelsN} onChange={setReels} disabled={!editing} label="Podcastdan Reels sayı" />
                  <span className="a-rl">{!editing ? 'Montaj olmadan seçilmir' : `${reelsN} Reels × 10 = ${reelsN * 10} AZN`}</span>
                </div>
              </div>
            </section>
          )}

          {!rent && !edit && (
            <section className="a-g a-rise a-gs" style={rs()}>
              <div><span className="a-lb">Ödəniş</span>
                <ASeg label="Ödəniş" value={pay} onChange={(v) => setPayWanted(v)} options={[{ value: 'paid', label: 'Pullu' }, { value: 'package', label: 'Paketdən', disabled: !pkgs.length || kind !== 'shoot' }]} /></div>
              {pay === 'package' && pkgs.length > 1 && (
                <select className="inp" aria-label="Paket" value={pkgId ?? ''} onChange={(e) => setPkgSel(Number(e.target.value))}>
                  {pkgs.map((p) => <option key={p.id} value={p.id}>{p.title} · {formatHours(p.minutes_left)} qalıb</option>)}
                </select>
              )}
              {pay === 'package' && pkgs.length === 1 && <div className="a-gold">{pkgs[0].title} · {formatHours(pkgs[0].minutes_left)} qalıb</div>}
              <span className="a-note">{pkgs.length ? 'Paketdən seçiləndə əlavə kamera (saatda 50 AZN) avtomatik hesablanır.' : 'Müştərinin aktiv saat paketi yoxdur.'}</span>
            </section>
          )}

          <section className="a-g a-rise a-gs" style={rs()}>
            <span className="a-lb">Əlavə xərclər</span>
            <ExtrasEditor rows={extraRowsSt} onChange={setExtraRows} />
            <span className="a-note">Ad və məbləği özünüz yazın, məs. «Mikrofon icarəsi · 20 AZN».</span>
          </section>

          <section className="a-g a-rise a-gs" style={rs()}>
            <Field label={`Endirim (${discPct ? '%' : 'AZN'})`} id="sf-disc" hint={discBad ? (discPct ? 'Faizi 0–100 arasında yazın' : 'Məbləği düzgün yazın, məs. 50 və ya 12,5') : discPct && discount > 0 ? `= ${formatMoney(discount)}` : 'Boş qalsa endirim yoxdur.'}>
              <div className="a-disc">
                <input id="sf-disc" className={`inp${discBad ? ' inp-err' : ''}`} inputMode="decimal" value={discText} onChange={(e) => setDiscText(e.target.value)} placeholder="0" />
                <ASeg label="Endirim vahidi" value={discPct ? 'pct' : 'azn'} onChange={(v) => setDiscPct(v === 'pct')} options={[{ value: 'azn', label: 'AZN' }, { value: 'pct', label: '%' }]} />
              </div>
            </Field>
            {discount > 0 && <Field label="Səbəb" id="sf-dn" hint="Yalnız admin görür."><input id="sf-dn" className="inp" value={discNote} onChange={(e) => setDiscNote(e.target.value)} maxLength={255} placeholder="məs. daimi müştəri" /></Field>}
          </section>

          {edit ? (
            <>
              {o && (
                <section className="a-g a-lockc a-rise a-gs" style={rs()}>
                  {!rent && <div><span className="a-lb">Ödəniş<AIcon name="lock" size={14} /></span><ASeg locked label="Ödəniş" value={o.package_id ? 'package' : 'paid'} options={[{ value: 'paid', label: 'Pullu' }, { value: 'package', label: 'Paketdən' }]} disabled /></div>}
                  {cbRow(cbShown > 0, true, () => {}, 'Keşbekdən istifadə', cbShown > 0 ? `Tətbiq olunub · ${formatMoney(-cbShown)}` : 'Tətbiq olunmayıb', true)}
                  {o.deposit_expected > 0 && <div><span className="a-lb">Beh<AIcon name="lock" size={14} /></span><ASeg locked label="Beh" value={o.deposit_received_at ? 'got' : 'wait'} options={[{ value: 'wait', label: 'Gözlənilir' }, { value: 'got', label: 'Alındı' }]} disabled /></div>}
                </section>
              )}
              <section className="a-g a-rise" style={rs()}>{noteField}</section>
            </>
          ) : (
            <section className="a-g a-rise a-gs" style={rs()}>
              {cbRow(useCb && usable > 0, usable === 0, () => setUseCb(!useCb), usable > 0 ? `Keşbekdən istifadə et · ${formatMoney(usable)}` : 'Keşbekdən istifadə', usable === 0 && balance > 0 ? `Balans ${formatMoney(balance)} — ${formatMoney(quote?.cashback_min_use ?? 7000)}-ə çatanda istifadə olunur` : undefined)}
              {quote?.deposit_required && <div className="a-warn"><AIcon name="warn" size={18} /><span><b>Beh mütləqdir</b> — müştəri əvvəl gəlməyib. Behi mütləq alın.</span></div>}
              {depositExpected > 0 && <div><span className="a-lb">Beh</span><ASeg label="Beh" value={depositNow ? 'got' : 'wait'} onChange={(v) => setDepositNow(v === 'got')} options={[{ value: 'wait', label: 'Gözlənilir' }, { value: 'got', label: 'Alındı' }]} /></div>}
              {noteField}
            </section>
          )}
        </div>

        <aside className="a-fside" aria-label="Yekun">
          <section className="a-g a-sumc">
            <h2 className="a-cardh">Yekun</h2>
            {quote && body ? (
              <div className="a-sum">
                {moneyRow(pay === 'package' ? `Paketdən · ${formatHours(body.duration_min)}` : reelsPack ? 'Reels paketi' : rent ? `Studiya icarəsi · ${formatHours(dur)}` : `${cameras} kamera · ${loc === 'studio' ? 'studiyada' : 'məkanda'}`, quote.base)}
                {quote.extra_camera > 0 && moneyRow('Əlavə kamera', quote.extra_camera)}
                {reelsN > 0 || (editing && kind === 'shoot') ? moneyRow('Montaj', quote.editing) : null}
                {reelsN > 0 && moneyRow(`Reels · ${reelsN} × 10`, quote.reels)}
                {extras.map((x, i) => <div key={i} className="a-sr m"><span>{x.name}</span><b>{formatMoney(x.amount)}</b></div>)}
                {quote.discount > 0 && <><div className="a-hr" />{moneyRow('Cəmi', quote.gross)}{moneyRow('Endirim', -quote.discount)}</>}
                <div className="a-sr a-tot"><span>{quote.discount > 0 ? 'Yekun' : 'Cəmi'}</span><b className="a-n"><span key={totalTxt} className="a-odo">{totalTxt}</span><small>AZN</small></b></div>
                {cbShown > 0 && moneyRow('Keşbekdən', -cbShown, 'g')}
                <div className="a-hr" />
                {edit && depPaid > 0 && <div className="a-sr m"><span className="a-lk">Alınmış beh<AIcon name="lock" size={12} /></span><b>{formatMoney(depPaid)}</b></div>}
                {!edit && depositExpected > 0 && <div className="a-sr m"><span>{depositNow ? 'Beh alınacaq' : 'Beh gözlənilir'}</span><AChip tone="beh">{formatMoney(depositExpected)}</AChip></div>}
                {moneyRow(edit ? 'Studiyada qalıq' : 'Studiyada qalıq', left)}
              </div>
            ) : <p className="a-empty">{qerr ? '' : clientId || edit ? 'Hesablanır…' : 'Əvvəl müştərini seçin.'}</p>}
            <Err msg={qerr} />
            {quote && quote.cashback_earn > 0 && (
              <span className="a-earn"><AIcon name="check" size={14} />Bağlananda keşbek: +{formatMoney(quote.cashback_earn)}{quote.first_shoot_bonus ? ' (ilk çəkiliş bonusu)' : ''}</span>
            )}
          </section>
          <div className="a-bar">
            <Err msg={submit.err} />
            <div className="a-bar-r">
              <div className="a-bar-s"><small>Yekun</small><b className="a-n"><span key={totalTxt} className="a-odo">{totalTxt}</span><small>AZN</small></b></div>
              <button type="button" className="a-bp" disabled={!ready} onClick={edit ? save : create}>{submitLabel}</button>
            </div>
          </div>
        </aside>
      </div>
      {!edit && <ClientPickerSheet open={pick} onClose={() => setPick(false)} onPick={(c) => { setClientId(c.id); setPayWanted('paid'); setUseCb(false); }} />}
    </AdminShell>
  );
}
