import { useEffect, useMemo, useState } from 'react';
import { AdminShell, Button, Card, Icon, Segmented, Stepper, formatHours, formatMin, formatMoney } from '../../shared/ui';
import { Avatar, BackLink, CountStepper, Err, Field, TAG } from '../components/common';
import { ClientPickerSheet } from '../components/ClientPicker';
import { ExtrasEditor, extraRows, extrasOf, type ExtraRow } from '../components/ExtrasEditor';
import { DATA_CHANGED, errMsg, useAction, useAuth, useLoad } from '../ctx';
import { addMin, aznInput, bakuParts, bakuToday, minutesOf, parseAzn, timeRange, toIso } from '../format';
import { go } from '../router';
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
  const [cbText, setCbText] = useState('');
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
  const cashback = edit ? 0 : useCb ? (parseAzn(cbText) ?? 0) : 0;
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
  function toggleCb(on: boolean) {
    setUseCb(on);
    if (on) setCbText(aznInput(Math.min(balance, quote?.total ?? balance)));
  }
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

  const moneyRow = (label: string, q: number) => <div className="sum-r"><span className="muted">{label}</span><span>{formatMoney(q)}</span></div>;

  return (
    <AdminShell active="calendar" title={edit ? 'Çəkilişi düzəlt' : 'Çəkiliş əlavə et'}>
      <BackLink to={edit ? `shoots/${editId}` : 'calendar'} />
      {edit && orig.err && <Err msg={orig.err} />}
      <div className="ax-form">
        <div className="col ax-fields">
          {edit ? (
            <div className="field">
              <span className="flabel">Müştəri</span>
              <span className="t15 w8">{o?.client_name ?? 'Yüklənir…'}</span>
            </div>
          ) : <div className="field">
            <div className="row sb"><label className="flabel" htmlFor="sf-client">Müştəri</label></div>
            <button id="sf-client" type="button" className="inp" style={{ justifyContent: 'space-between' }} onClick={() => setPick(true)}>
              <span className="row">{detail ? <><Avatar name={detail.full_name} /><span className="t15 w8">{detail.full_name}</span></> : <span className="muted">{clientId ? 'Yüklənir…' : 'Müştəri seçin və ya yenisini yaradın'}</span>}</span>
              <Icon name="chevron" size={18} />
            </button>
          </div>}
          <Field label="Tarix" id="sf-d"><input id="sf-d" type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="g2">
            <Field label="Başlanğıc" id="sf-t"><input id="sf-t" type="time" className="inp" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label="Bitmə" id="sf-e"><input id="sf-e" type="time" className="inp" value={end} onChange={(e) => pickEnd(e.target.value)} /></Field>
          </div>
          <div className="row sb wrap"><span className="flabel">Müddət</span><Stepper minutes={dur} onChange={setDur} min={step} step={step} label="Müddət" /></div>

          <Card>
            <span className="lbl">Studiya vaxtı</span>
            <span className="t15 w8" data-testid="busy">Studiya məşğul: {addMin(time, -prep)} – {addMin(time, dur + wrap)}</span>
            <div className="row sb wrap"><span className="t14 w7">Hazırlıq əvvəl</span><Stepper minutes={prep} onChange={setPrep} min={0} max={240} step={5} fmt={formatMin} label="Hazırlıq" /></div>
            <div className="row sb wrap"><span className="t14 w7">Yığışdırma sonra</span><Stepper minutes={wrap} onChange={setWrap} min={0} max={240} step={5} fmt={formatMin} label="Yığışdırma" /></div>
            <span className="hint">Müştəri bunları görmür.</span>
          </Card>
          {quote && quote.conflicts.length > 0 && (
            <div className="banner" role="alert" data-testid="conflicts" style={{ borderColor: '#f9a8d4', background: 'rgba(244,114,182,.14)' }}>
              <Icon name="alert" size={18} />
              <span className="col grow" style={{ gap: 4 }}>{quote.conflicts.map((c) => <span key={`${c.type}${c.id}`}>Bu vaxt <b>{conflictText(c)}</b> üst-üstə düşür (hazırlıq/yığışdırma daxil)</span>)}</span>
            </div>
          )}

          <span className="flabel mt">Xidmət</span>
          <Segmented label="Xidmət" value={kind} onChange={pickKind} options={[{ value: 'shoot', label: 'Çəkiliş' }, { value: 'reels_pack', label: 'Reels paketi' }, { value: 'studio_rent', label: 'Studiya icarəsi' }]} />
          {kind === 'shoot' && (
            <div className="chips" role="group" aria-label="Nə çəkilir">
              {(['podcast', 'reels', 'other'] as Tag[]).map((t) => <button key={t} type="button" className={`chip${tag === t ? ' chip-on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(t)}>{TAG[t]}</button>)}
            </div>
          )}
          {!rent && <Segmented label="Məkan" value={loc} onChange={setLoc} options={[{ value: 'studio', label: 'Studiyada' }, { value: 'onsite', label: 'Sizin məkanda' }]} />}
          {loc === 'onsite' && <Field label="Ünvan" id="sf-addr"><input id="sf-addr" className="inp" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>}

          {kind === 'shoot' && (
            <>
              <span className="flabel mt">Kamera · 1 saat (AZN)</span>
              <Segmented label="Kamera" value={cameras} onChange={setCameras} options={[1, 2, 3].map((n) => ({ value: n, label: `${n} · ${PER_HOUR[loc][n - 1]}` }))} />
              <Card>
                <div className="trow" style={{ minHeight: 44 }}>
                  <span className="col grow" style={{ gap: 2 }}><span className="t15 w8">Montaj</span><span className="t12 soft">kəsim, səs təmizləmə, final export · +100 AZN</span></span>
                  <button type="button" className={`tgl${editing ? ' tgl-on' : ''}`} role="switch" aria-checked={editing} aria-label="Montaj" onClick={() => setEditing(!editing)} />
                </div>
                <hr className="hr" />
                <div className="col" style={{ gap: 2 }}><span className="t15 w8">Podcastdan Reels</span><span className="t12 soft lh">Podcastın içindən kəsilən qısa videolar · hər biri 10 AZN</span></div>
                <div className="row sb wrap">
                  <CountStepper value={reelsN} onChange={setReels} disabled={!editing} label="Podcastdan Reels sayı" />
                  <span className="t14 w8">{!editing ? 'Montaj olmadan seçilmir' : `${reelsN} Reels × 10 = ${reelsN * 10} AZN`}</span>
                </div>
              </Card>
            </>
          )}

          {!rent && !edit && <>
          <span className="flabel mt">Ödəniş</span>
          <div className="segw" role="group" aria-label="Ödəniş">
            <button type="button" className={`seg${pay === 'paid' ? ' seg-on' : ''}`} aria-pressed={pay === 'paid'} onClick={() => setPayWanted('paid')}>Pullu</button>
            <button type="button" className={`seg${pay === 'package' ? ' seg-on' : ''}`} aria-pressed={pay === 'package'} disabled={!pkgs.length || kind !== 'shoot'} style={!pkgs.length || kind !== 'shoot' ? { opacity: 0.4 } : undefined} onClick={() => setPayWanted('package')}>Paketdən</button>
          </div>
          {pay === 'package' && pkgs.length > 1 && (
            <select className="inp" aria-label="Paket" value={pkgId ?? ''} onChange={(e) => setPkgSel(Number(e.target.value))}>
              {pkgs.map((p) => <option key={p.id} value={p.id}>{p.title} · {formatHours(p.minutes_left)} qalıb</option>)}
            </select>
          )}
          <span className="hint">{pkgs.length ? 'Paketdən seçiləndə əlavə kamera (saatda 50 AZN) avtomatik hesablanır.' : 'Müştərinin aktiv saat paketi yoxdur.'}</span>
          </>}

          <span className="flabel mt">Əlavə xərclər</span>
          <ExtrasEditor rows={extraRowsSt} onChange={setExtraRows} />
          <span className="hint">Ad və məbləği özünüz yazın, məs. «Mikrofon icarəsi · 20 AZN».</span>

          <span className="flabel mt">Endirim</span>
          <Field label={`Endirim (${discPct ? '%' : 'AZN'})`} id="sf-disc" hint={discBad ? (discPct ? 'Faizi 0–100 arasında yazın' : 'Məbləği düzgün yazın, məs. 50 və ya 12,5') : discPct && discount > 0 ? `= ${formatMoney(discount)}` : 'Boş qalsa endirim yoxdur.'}>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <input id="sf-disc" className={`inp grow${discBad ? ' inp-err' : ''}`} inputMode="decimal" value={discText} onChange={(e) => setDiscText(e.target.value)} placeholder="0" />
              <div style={{ width: 130, flex: 'none' }}><Segmented label="Endirim vahidi" value={discPct ? 'pct' : 'azn'} onChange={(v) => setDiscPct(v === 'pct')} options={[{ value: 'azn', label: 'AZN' }, { value: 'pct', label: '%' }]} /></div>
            </div>
          </Field>
          {discount > 0 && <Field label="Səbəb" id="sf-dn" hint="Yalnız admin görür."><input id="sf-dn" className="inp" value={discNote} onChange={(e) => setDiscNote(e.target.value)} maxLength={255} placeholder="məs. daimi müştəri" /></Field>}

          {!edit && <div className="trow" style={{ minHeight: 48 }}>
            <span className="col grow" style={{ gap: 2 }}><span className="t15 w8">Keşbekdən istifadə</span><span className="t12 soft">Müştərinin keşbeki: {formatMoney(balance)}</span></span>
            <button type="button" className={`tgl${useCb ? ' tgl-on' : ''}`} role="switch" aria-checked={useCb} aria-label="Keşbekdən istifadə" disabled={!balance} onClick={() => toggleCb(!useCb)} />
          </div>}
          {useCb && !edit && <Field label="Keşbek məbləği (AZN)" id="sf-cb" hint={`Ən çoxu ${formatMoney(balance)}`}><input id="sf-cb" className="inp" inputMode="decimal" value={cbText} onChange={(e) => setCbText(e.target.value)} /></Field>}

          {!edit && quote?.deposit_required && <div className="banner"><Icon name="alert" size={18} /><span><b>Beh mütləqdir</b> — müştəri əvvəl gəlməyib. Behi mütləq alın.</span></div>}
          {!edit && depositExpected > 0 && (
            <>
              <span className="flabel">Beh</span>
              <Segmented label="Beh" value={depositNow ? 'got' : 'wait'} onChange={(v) => setDepositNow(v === 'got')} options={[{ value: 'wait', label: 'Gözlənilir' }, { value: 'got', label: 'Alındı' }]} />
            </>
          )}
          <Field label="Qeyd" id="sf-note"><textarea id="sf-note" className="inp ta" value={note} onChange={(e) => setNote(e.target.value)} placeholder="məs. Qonaqla gələcək" /></Field>
        </div>

        <aside className="ax-side" aria-label="Yekun">
          <Card tone="cream">
            <span className="lbl">Yekun</span>
            {quote && body ? (
              <div className="sum">
                {moneyRow(pay === 'package' ? `Paketdən · ${formatHours(body.duration_min)}` : reelsPack ? 'Reels paketi' : rent ? `Studiya icarəsi · ${formatHours(dur)}` : `Çəkiliş · ${TAG[tag]} · ${cameras} kamera · ${formatHours(dur)}`, quote.base)}
                {quote.extra_camera > 0 && moneyRow('Əlavə kamera', quote.extra_camera)}
                {reelsN > 0 || (editing && kind === 'shoot') ? moneyRow('Montaj', quote.editing) : null}
                {reelsN > 0 && moneyRow(`Podcastdan Reels · ${reelsN} əd.`, quote.reels)}
                {extras.map((x, i) => <div key={i} className="sum-r"><span className="muted">{x.name}</span><span>{formatMoney(x.amount)}</span></div>)}
                {quote.discount > 0 && <>{moneyRow('Cəmi', quote.gross)}{moneyRow('Endirim', -quote.discount)}</>}
                <div className="sum-r sum-tot"><span className="w8">{quote.discount > 0 ? 'Yekun' : 'Cəmi'}</span><span className="num-m">{formatMoney(quote.total).replace(' AZN', '')}<span className="unit">AZN</span></span></div>
                {cbShown > 0 && moneyRow('Keşbekdən', -cbShown)}
                {edit && depPaid > 0 && moneyRow('Alınmış beh', depPaid)}
                {!edit && depositExpected > 0 && (
                  <div className="sum-r"><span className="row" style={{ gap: 6 }}><span className="pill p-beh" style={{ color: '#86198f', borderColor: '#c026d3' }}><Icon name="clock" size={12} />{depositNow ? 'Beh alınacaq' : 'Beh gözlənilir'}</span></span><span>{formatMoney(depositExpected)}</span></div>
                )}
                {moneyRow(edit ? 'Studiyada qalıq' : 'Studiyada', Math.max(0, quote.total - cbShown - (edit ? depPaid : depositExpected)))}
              </div>
            ) : <p className="t13 muted">{qerr ? '' : clientId || edit ? 'Hesablanır…' : 'Əvvəl müştərini seçin.'}</p>}
            <Err msg={qerr} />
            {quote && quote.cashback_earn > 0 && (
              <span className="t13 w7" style={{ color: '#6b21a8' }}>Bağlananda keşbek: +{formatMoney(quote.cashback_earn)}{quote.first_shoot_bonus ? ' (ilk çəkiliş bonusu)' : ''}</span>
            )}
          </Card>
          <div className="ax-bar">
            <Err msg={submit.err} />
            <Button disabled={!ready} onClick={edit ? save : create}>{edit ? (quote ? `Yadda saxla · ${formatMoney(quote.total)}` : 'Yadda saxla') : quote ? `Əlavə et · ${formatMoney(quote.total)}` : 'Əlavə et'}</Button>
          </div>
        </aside>
      </div>
      {!edit && <ClientPickerSheet open={pick} onClose={() => setPick(false)} onPick={(c) => { setClientId(c.id); setPayWanted('paid'); setUseCb(false); }} />}
    </AdminShell>
  );
}
