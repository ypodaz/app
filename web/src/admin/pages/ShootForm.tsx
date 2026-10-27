import { useEffect, useMemo, useState } from 'react';
import { AdminShell, Button, Card, Icon, Segmented, Stepper, formatHours, formatMoney } from '../../shared/ui';
import { Avatar, BackLink, CountStepper, Err, Field, TAG } from '../components/common';
import { ClientPickerSheet } from '../components/ClientPicker';
import { errMsg, useAction, useAuth, useLoad } from '../ctx';
import { aznInput, bakuToday, parseAzn, toIso } from '../format';
import { go } from '../router';
import type { ClientDetail, Kind, Location, Quote, Shoot, Tag } from '../types';

// Saatlıq qiymət etiketləri (server/money.py cədvəli ilə eynidir; hesabı server edir).
const PER_HOUR: Record<Location, number[]> = { studio: [70, 120, 170], onsite: [140, 240, 340] };

// B2d/B2e: çəkiliş əlavə et
export function ShootForm({ query }: { query: URLSearchParams }) {
  const { call } = useAuth();
  const [clientId, setClientId] = useState<number | null>(Number(query.get('client')) || null);
  const [pick, setPick] = useState(false);
  const [date, setDate] = useState(query.get('date') || bakuToday());
  const [time, setTime] = useState(query.get('time') || '12:00');
  const [dur, setDur] = useState(60);
  const [kind, setKind] = useState<Kind>('shoot');
  const [tag, setTag] = useState<Tag>('podcast');
  const [loc, setLoc] = useState<Location>('studio');
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
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qerr, setQerr] = useState('');
  const submit = useAction();

  const detail = useLoad<ClientDetail>(clientId ? `/clients/${clientId}` : null).data;
  const reelsPack = kind === 'reels_pack';
  const pkgs = (detail?.packages ?? []).filter((p) => p.minutes_left > 0 && p.ends_on >= date);
  const pay = payWanted === 'package' && pkgs.length && !reelsPack ? 'package' : 'paid';
  const pkgId = pay === 'package' ? (pkgs.find((p) => p.id === pkgSel) ?? pkgs[0]).id : null;
  const reelsN = editing && !reelsPack ? reels : 0;
  const cashback = useCb ? (parseAzn(cbText) ?? 0) : 0;

  const body = useMemo(() => (clientId && date && time ? {
    client_id: clientId, starts_at: toIso(date, time), duration_min: reelsPack ? 60 : dur, kind, tag: reelsPack ? 'reels' : tag,
    location: loc, cameras: reelsPack ? 1 : cameras, editing: reelsPack ? false : editing, reels_count: reelsN,
    package_id: pkgId, cashback_use: cashback, address: loc === 'onsite' ? address.trim() || null : null, note: note.trim() || null,
  } : null), [clientId, date, time, dur, kind, tag, loc, address, cameras, editing, reelsN, reelsPack, pkgId, cashback, note]);

  // Qiymət: 250ms gecikmə ilə serverdən
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!body) { setQuote(null); return; }
    let live = true;
    const t = setTimeout(() => {
      call<Quote>('/shoots/quote', { body })
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

  async function create() {
    if (!body) return;
    const s = await submit.run(() => call<Shoot>('/shoots', { body }));
    if (!s) return;
    if (depositNow && depositExpected > 0) await call(`/shoots/${s.id}/deposit`, { body: { amount: depositExpected } }).catch(() => {});
    go(`shoots/${s.id}`);
  }

  const moneyRow = (label: string, q: number) => <div className="sum-r"><span className="muted">{label}</span><span>{formatMoney(q)}</span></div>;

  return (
    <AdminShell active="calendar" title="Çəkiliş əlavə et">
      <BackLink to="calendar" />
      <div className="ax-form">
        <div className="col ax-fields">
          <div className="field">
            <div className="row sb"><label className="flabel" htmlFor="sf-client">Müştəri</label></div>
            <button id="sf-client" type="button" className="inp" style={{ justifyContent: 'space-between' }} onClick={() => setPick(true)}>
              <span className="row">{detail ? <><Avatar name={detail.full_name} /><span className="t15 w8">{detail.full_name}</span></> : <span className="muted">{clientId ? 'Yüklənir…' : 'Müştəri seçin və ya yenisini yaradın'}</span>}</span>
              <Icon name="chevron" size={18} />
            </button>
          </div>
          <div className="g2">
            <Field label="Tarix" id="sf-d"><input id="sf-d" type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Başlanğıc" id="sf-t"><input id="sf-t" type="time" className="inp" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          </div>
          {!reelsPack && <div className="row sb"><span className="flabel">Müddət</span><Stepper minutes={dur} onChange={setDur} /></div>}

          <span className="flabel mt">Xidmət</span>
          <Segmented label="Xidmət" value={kind} onChange={setKind} options={[{ value: 'shoot', label: 'Çəkiliş' }, { value: 'reels_pack', label: 'Reels Paketi' }]} />
          {!reelsPack && (
            <div className="chips" role="group" aria-label="Nə çəkilir">
              {(['podcast', 'reels', 'other'] as Tag[]).map((t) => <button key={t} type="button" className={`chip${tag === t ? ' chip-on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(t)}>{TAG[t]}</button>)}
            </div>
          )}
          <Segmented label="Məkan" value={loc} onChange={setLoc} options={[{ value: 'studio', label: 'Studiyada' }, { value: 'onsite', label: 'Sizin məkanda' }]} />
          {loc === 'onsite' && <Field label="Ünvan" id="sf-addr"><input id="sf-addr" className="inp" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>}

          {!reelsPack && (
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

          <span className="flabel mt">Ödəniş</span>
          <div className="segw" role="group" aria-label="Ödəniş">
            <button type="button" className={`seg${pay === 'paid' ? ' seg-on' : ''}`} aria-pressed={pay === 'paid'} onClick={() => setPayWanted('paid')}>Pullu</button>
            <button type="button" className={`seg${pay === 'package' ? ' seg-on' : ''}`} aria-pressed={pay === 'package'} disabled={!pkgs.length || reelsPack} style={!pkgs.length || reelsPack ? { opacity: 0.4 } : undefined} onClick={() => setPayWanted('package')}>Paketdən</button>
          </div>
          {pay === 'package' && pkgs.length > 1 && (
            <select className="inp" aria-label="Paket" value={pkgId ?? ''} onChange={(e) => setPkgSel(Number(e.target.value))}>
              {pkgs.map((p) => <option key={p.id} value={p.id}>{p.title} · {formatHours(p.minutes_left)} qalıb</option>)}
            </select>
          )}
          <span className="hint">{pkgs.length ? 'Paketdən seçiləndə əlavə kamera (saatda 50 AZN) avtomatik hesablanır.' : 'Müştərinin aktiv saat paketi yoxdur.'}</span>

          <div className="trow" style={{ minHeight: 48 }}>
            <span className="col grow" style={{ gap: 2 }}><span className="t15 w8">Keşbekdən istifadə</span><span className="t12 soft">Müştərinin keşbeki: {formatMoney(balance)}</span></span>
            <button type="button" className={`tgl${useCb ? ' tgl-on' : ''}`} role="switch" aria-checked={useCb} aria-label="Keşbekdən istifadə" disabled={!balance} onClick={() => toggleCb(!useCb)} />
          </div>
          {useCb && <Field label="Keşbek məbləği (AZN)" id="sf-cb" hint={`Ən çoxu ${formatMoney(balance)}`}><input id="sf-cb" className="inp" inputMode="decimal" value={cbText} onChange={(e) => setCbText(e.target.value)} /></Field>}

          {quote?.deposit_required && <div className="banner"><Icon name="alert" size={18} /><span><b>Beh mütləqdir</b> — müştəri əvvəl gəlməyib. Behi mütləq alın.</span></div>}
          {depositExpected > 0 && (
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
                {moneyRow(pay === 'package' ? `Paketdən · ${formatHours(body.duration_min)}` : reelsPack ? 'Reels Paketi' : `Çəkiliş · ${TAG[tag]} · ${cameras} kamera · ${formatHours(dur)}`, quote.base)}
                {quote.extra_camera > 0 && moneyRow('Əlavə kamera', quote.extra_camera)}
                {editing && !reelsPack && moneyRow('Montaj', quote.editing)}
                {reelsN > 0 && moneyRow(`Podcastdan Reels · ${reelsN} əd.`, quote.reels)}
                <div className="sum-r sum-tot"><span className="w8">Cəmi</span><span className="num-m">{formatMoney(quote.total).replace(' AZN', '')}<span className="unit">AZN</span></span></div>
                {cashback > 0 && moneyRow('Keşbekdən', -cashback)}
                {depositExpected > 0 && (
                  <div className="sum-r"><span className="row" style={{ gap: 6 }}><span className="pill p-beh" style={{ color: '#86198f', borderColor: '#c026d3' }}><Icon name="clock" size={12} />{depositNow ? 'Beh alınacaq' : 'Beh gözlənilir'}</span></span><span>{formatMoney(depositExpected)}</span></div>
                )}
                {moneyRow('Studiyada', Math.max(0, quote.total - cashback - depositExpected))}
              </div>
            ) : <p className="t13 muted">{qerr ? '' : clientId ? 'Hesablanır…' : 'Əvvəl müştərini seçin.'}</p>}
            <Err msg={qerr} />
            {quote && quote.cashback_earn > 0 && (
              <span className="t13 w7" style={{ color: '#6b21a8' }}>Bağlananda keşbek: +{formatMoney(quote.cashback_earn)}{quote.first_shoot_bonus ? ' (ilk çəkiliş bonusu)' : ''}</span>
            )}
          </Card>
          <div className="ax-bar">
            <Err msg={submit.err} />
            <Button disabled={!ready} onClick={create}>{quote ? `Əlavə et · ${formatMoney(quote.total)}` : 'Əlavə et'}</Button>
          </div>
        </aside>
      </div>
      <ClientPickerSheet open={pick} onClose={() => setPick(false)} onPick={(c) => { setClientId(c.id); setPayWanted('paid'); setUseCb(false); }} />
    </AdminShell>
  );
}
