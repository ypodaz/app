import { useEffect, useState, type CSSProperties } from 'react';
import { AdminShell, formatHours, formatMoney } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { ASeg, AStep, PageHead, reducedMotion } from '../components/neon';
import { Err, Field, shootDesc } from '../components/common';
import { ExtrasEditor, extraRows, extrasOf, type ExtraRow } from '../components/ExtrasEditor';
import { errMsg, useAction, useAuth, useLoad } from '../ctx';
import { aznInput, bakuParts, dateWd, parseAzn } from '../format';
import type { ClientDetail, CloseOut, Quote, Shoot } from '../types';

// B4a/B4b: çəkilişi bağla
export function CloseShoot({ id }: { id: number }) {
  const { call } = useAuth();
  const shoot = useLoad<Shoot>(`/shoots/${id}`);
  const s = shoot.data;
  const client = useLoad<ClientDetail>(s ? `/clients/${s.client_id}` : null).data;
  const [dur, setDur] = useState<number | null>(null);
  const [useCb, setUseCb] = useState(false);
  const [discText, setDiscText] = useState<string | null>(null);
  const [exRows, setExRows] = useState<ExtraRow[] | null>(null);
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qerr, setQerr] = useState('');
  const act = useAction();
  const [done, setDone] = useState<CloseOut | null>(null);
  const [cl, setCl] = useState(false);

  const minutes = dur ?? s?.duration_min ?? 60;
  const reels = s?.kind === 'reels_pack';
  const discP = discText === null ? (s?.discount ?? 0) : discText.trim() ? parseAzn(discText) : 0;
  const discBad = discP === null, disc = discP ?? 0;

  const rows = exRows ?? extraRows(s?.extras ?? []);
  const { list: extras, bad: extrasBad } = extrasOf(rows);
  const extrasKey = JSON.stringify(extras);

  // Faktiki müddətlə yeni qiymət (keşbek 0: artıq istifadə olunanı server özü nəzərə alır)
  useEffect(() => {
    if (!s || extrasBad) return;
    let live = true;
    const t = setTimeout(() => {
      call<Quote>('/shoots/quote', { body: {
        client_id: s.client_id, starts_at: s.starts_at, duration_min: minutes, kind: s.kind, tag: s.tag, location: s.location,
        cameras: s.cameras, editing: s.editing, reels_count: s.reels_count, package_id: s.package_id, cashback_use: 0, address: s.address,
        extras, discount: disc, prep_min: s.prep_min, wrap_min: s.wrap_min,
      } }).then((q) => live && (setQuote(q), setQerr(''))).catch((e) => live && (setQuote(null), setQerr(errMsg(e))));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [s, minutes, disc, extrasKey, extrasBad]);

  if (!s) return <AdminShell active="calendar" title="Çəkilişi bağla"><Err msg={shoot.err} /></AdminShell>;

  const pkg = client?.packages.find((p) => p.id === s.package_id);
  const deposit = s.deposit_received_at ? s.deposit_amount : 0;
  const payable = quote ? Math.max(0, quote.total - s.cashback_used - deposit) : 0;
  const usable = quote && quote.cashback_shoots_left === 0 && quote.cashback_balance >= quote.cashback_min_use ? Math.min(quote.cashback_balance, payable) : 0;
  const extra = useCb ? usable : 0;
  const due = quote ? Math.max(0, quote.total - s.cashback_used - extra - deposit) : 0;

  async function close() {
    const r = await act.run(() => call<CloseOut>(`/shoots/${id}/close`, { body: { duration_min: minutes, cashback_use: extra, extras, discount: disc, paid_method: due > 0 ? method : null } }));
    if (r) {
      setCl(true);
      await new Promise((ok) => setTimeout(ok, reducedMotion() ? 0 : 420));
      setDone(r);
    }
  }

  const head = (sh: Shoot) => {
    const d = bakuParts(sh.starts_at).date;
    return (
      <div className="a-tl">
        <span className="a-ic a-ic-cal a-ic-l"><AIcon name="cal" size={20} /></span>
        <span className="a-tl-m"><b>{dateWd(d)} · {bakuParts(sh.starts_at).time}</b><span>{sh.client_name} · {shootDesc(sh)}</span></span>
      </div>
    );
  };

  if (done) {
    const dep = done.deposit_received_at ? done.deposit_amount : 0;
    return (
      <AdminShell active="calendar" title="Çəkiliş bağlandı" bare full>
        <div className="a-done a-nofab">
          <div className="a-done-c">
            <div className="a-ok" aria-hidden="true"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path pathLength="1" d="M20 6 9 17l-5-5" /></svg></div>
            <h1 className="a-done-h" role="status">Çəkiliş bağlandı{done.cashback_earned > 0 && <> · <span>+{formatMoney(done.cashback_earned)}</span> keşbek</>}</h1>
            <section className="a-g a-rise a-donec" style={{ '--i': 1 } as CSSProperties}>
              {head(done)}
              <div className="a-hr" />
              <div className="a-sum">
                <div className="a-sr m"><span>Yekun</span><b>{formatMoney(done.total)}</b></div>
                {(dep > 0 || done.cashback_used > 0) && <div className="a-sr m"><span>Beh + keşbek</span><b>{formatMoney(-(dep + done.cashback_used))}</b></div>}
                {done.paid_at_studio > 0 && <div className="a-sr m g"><span>Qalığın ödənişi · {done.paid_method === 'card' ? 'Kart' : 'Nağd'}</span><b>{formatMoney(done.paid_at_studio)}</b></div>}
              </div>
            </section>
          </div>
          <div className="a-done-b">
            <a className="a-bp" href="#/panel">Panelə qayıt</a>
            <a className="a-bg" href={`#/clients/${done.client_id}`}>Müştəri kartı</a>
          </div>
        </div>
      </AdminShell>
    );
  }

  let n = 0;
  const rs = () => ({ '--i': n++ }) as CSSProperties;
  return (
    <AdminShell active="calendar" title="Çəkilişi bağla" bare full>
      <div className="a-narrow a-nofab">
        <PageHead title="Çəkilişi bağla" back={`shoots/${id}`} />
        <section className="a-g a-rise" style={rs()}>{head(s)}</section>
        {!reels && (
          <section className="a-g a-rise a-gs" style={rs()}>
            <div className="a-mrow">
              <div><span className="a-lb a-lb0">Faktiki müddət</span><span className="a-note a-note0">Yarım saat addımla</span></div>
              <AStep text={formatHours(minutes)} label="Faktiki müddət" onDec={() => setDur(Math.max(30, minutes - 30))} onInc={() => setDur(Math.min(600, minutes + 30))} decDisabled={minutes <= 30} incDisabled={minutes >= 600} />
            </div>
            {pkg && (
              <div className="a-gold"><b>Paketdən {formatHours(minutes)} çıxılır · qalan {formatHours(Math.max(0, pkg.minutes_left - minutes))} / {formatHours(pkg.minutes_total)}</b><span>{pkg.title}</span><span>Paketdən çəkilişə keşbek yazılmır (əlavələr daxil).</span></div>
            )}
          </section>
        )}
        {reels && pkg && (
          <section className="a-g a-rise a-gs" style={rs()}>
            <div className="a-gold"><b>Paketdən {formatHours(minutes)} çıxılır · qalan {formatHours(Math.max(0, pkg.minutes_left - minutes))} / {formatHours(pkg.minutes_total)}</b><span>{pkg.title}</span><span>Paketdən çəkilişə keşbek yazılmır (əlavələr daxil).</span></div>
          </section>
        )}
        <section className="a-g a-rise a-gs" style={rs()}>
          <span className="a-lb a-lb0">Əlavə xərclər və endirim</span>
          <ExtrasEditor rows={rows} onChange={setExRows} />
          <Field label="Endirim (AZN)" id="cl-disc" hint={discBad ? 'Məbləği düzgün yazın, məs. 50 və ya 12,5' : 'Boş qalsa endirim yoxdur.'}>
            <div className="a-unit"><input id="cl-disc" className={`inp${discBad ? ' inp-err' : ''}`} inputMode="decimal" value={discText ?? (s.discount ? aznInput(s.discount) : '')} onChange={(e) => setDiscText(e.target.value)} placeholder="0" /><span aria-hidden="true">AZN</span></div>
          </Field>
        </section>
        <section className="a-g a-rise a-gs" style={rs()}>
          {quote ? (
            <div className="a-sum">
              {extras.map((x, i) => <div key={i} className="a-sr m"><span>{x.name}</span><b>{formatMoney(x.amount)}</b></div>)}
              {quote.discount > 0 && <><div className="a-sr m"><span>Cəmi</span><b>{formatMoney(quote.gross)}</b></div><div className="a-sr m"><span>Endirim</span><b>{formatMoney(-quote.discount)}</b></div></>}
              <div className="a-sr m"><span>{pkg ? 'Pullu əlavələr' : quote.discount > 0 ? 'Yekun' : 'Yekun'}</span><b>{formatMoney(quote.total)}</b></div>
              {deposit > 0 && <div className="a-sr m"><span>Beh ödənib</span><b>{formatMoney(-deposit)}</b></div>}
              {s.cashback_used > 0 && <div className="a-sr m g"><span>Keşbekdən (əvvəl)</span><b>{formatMoney(-s.cashback_used)}</b></div>}
            </div>
          ) : <p className="a-empty">{qerr || 'Hesablanır…'}</p>}
          <Err msg={qerr && quote ? qerr : ''} />
          {quote && (
            <>
              <div className="a-hr" />
              <div className="a-trow">
                <span className="a-trow-m"><b>Əlavə keşbek tətbiq et</b><span>{usable > 0 ? `Tətbiq olunacaq · ${formatMoney(usable)}` : quote.cashback_balance > 0 && quote.cashback_shoots_left > 0 ? `Balans ${formatMoney(quote.cashback_balance)} — 3-cü çəkilişdən istifadə olunur` : quote.cashback_balance > 0 ? `Keşbek balansı ${formatMoney(quote.cashback_balance)} — ${formatMoney(quote.cashback_min_use)}-ə çatanda istifadə olunur` : 'Keşbek balansı yoxdur'}</span></span>
                <button type="button" className={`tgl${extra > 0 ? ' tgl-on' : ''}`} role="switch" aria-checked={extra > 0} aria-label="Keşbekdən istifadə" disabled={usable === 0} onClick={() => setUseCb(!useCb)} />
              </div>
              <div className="a-hr" />
              <div className="a-sr a-tot"><span>Qalıq:{due > 0 ? ' nağd / kart' : ''}</span><b className="a-n"><span key={due} className="a-odo">{formatMoney(due).replace(' AZN', '')}</span><small>AZN</small></b></div>
            </>
          )}
        </section>
        {due > 0 && (
          <section className="a-g a-rise" style={rs()}>
            <span className="a-lb">Qalığın ödənişi</span>
            <ASeg label="Qalığın ödənişi" value={method} onChange={setMethod} options={[{ value: 'cash', label: 'Nağd' }, { value: 'card', label: 'Kart' }]} />
          </section>
        )}
        {quote && quote.cashback_earn > 0 && (
          <span className="a-earn"><AIcon name="check" size={14} />Keşbek: +{formatMoney(quote.cashback_earn)}{quote.first_shoot_bonus ? ' (ilk çəkiliş bonusu)' : ''}</span>
        )}
        <Err msg={act.err} />
        <button type="button" className={`a-bp a-bw a-big-b${cl ? ' ok' : ''}`} disabled={!quote || discBad || extrasBad || act.busy || cl} onClick={close} aria-label="Bağla">
          {cl ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path className="a-draw" pathLength="1" d="M20 6 9 17l-5-5" /></svg> : <><AIcon name="check" size={20} />Bağla</>}
        </button>
      </div>
    </AdminShell>
  );
}
