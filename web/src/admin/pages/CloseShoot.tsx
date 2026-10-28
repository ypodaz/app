import { useEffect, useState } from 'react';
import { AdminShell, Button, Card, Icon, Segmented, Stepper, formatHours, formatMoney } from '../../shared/ui';
import { BackLink, Err, Field, ShootTicket } from '../components/common';
import { ExtrasEditor, extraRows, extrasOf, type ExtraRow } from '../components/ExtrasEditor';
import { errMsg, useAction, useAuth, useLoad } from '../ctx';
import { aznInput, parseAzn } from '../format';
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
  const usable = quote && quote.cashback_balance >= quote.cashback_min_use ? Math.min(quote.cashback_balance, payable) : 0;
  const extra = useCb ? usable : 0;
  const due = quote ? Math.max(0, quote.total - s.cashback_used - extra - deposit) : 0;

  async function close() {
    const r = await act.run(() => call<CloseOut>(`/shoots/${id}/close`, { body: { duration_min: minutes, cashback_use: extra, extras, discount: disc, paid_method: due > 0 ? method : null } }));
    if (r) setDone(r);
  }

  if (done) {
    return (
      <AdminShell active="calendar" title="Çəkiliş bağlandı">
        <div className="toast" role="status"><Icon name="check" size={20} strokeWidth={2.6} /><span>Çəkiliş bağlandı{done.cashback_earned > 0 ? ` · +${formatMoney(done.cashback_earned)} keşbek` : ''}</span></div>
        <ShootTicket s={done} />
        <p className="t14 soft lh">{done.payment_line}</p>
        <a className="btn btn-primary" href="#/panel">Panelə qayıt</a>
        <a className="btn btn-out" href={`#/clients/${done.client_id}`}>Müştəri kartı</a>
      </AdminShell>
    );
  }

  return (
    <AdminShell active="calendar" title="Çəkilişi bağla">
      <BackLink to={`shoots/${id}`} />
      <div className="ax-narrow col" style={{ gap: 14 }}>
        <ShootTicket s={s}><span className="t15 w8">{s.client_name}</span></ShootTicket>
        <Card>
          {!reels && (
            <div className="row sb">
              <div className="col" style={{ gap: 2 }}><span className="lbl">Faktiki müddət</span><span className="hint">Yarım saat addımla</span></div>
              <Stepper minutes={minutes} onChange={setDur} />
            </div>
          )}
        </Card>
        {pkg && (
          <Card>
            <div className="banner"><Icon name="clock" size={18} /><span className="col" style={{ gap: 2 }}><b className="t14">Paketdən {formatHours(minutes)} çıxılır · qalan {formatHours(Math.max(0, pkg.minutes_left - minutes))} / {formatHours(pkg.minutes_total)}</b><span className="t12 muted">{pkg.title}</span></span></div>
            <span className="hint">Paket saatlarına keşbek yazılmır; yalnız pullu əlavələrə (montaj, Reels, əlavə kamera).</span>
          </Card>
        )}
        <Card>
          <span className="lbl">Əlavə xərclər</span>
          <ExtrasEditor rows={rows} onChange={setExRows} />
          <Field label="Endirim (AZN)" id="cl-disc" hint={discBad ? 'Məbləği düzgün yazın, məs. 50 və ya 12,5' : 'Boş qalsa endirim yoxdur.'}>
            <input id="cl-disc" className={`inp${discBad ? ' inp-err' : ''}`} inputMode="decimal" value={discText ?? (s.discount ? aznInput(s.discount) : '')} onChange={(e) => setDiscText(e.target.value)} placeholder="0" />
          </Field>
          {quote ? (
            <div className="sum">
              {extras.map((x, i) => <div key={i} className="sum-r"><span>{x.name}</span><span>{formatMoney(x.amount)}</span></div>)}
              {quote.discount > 0 && <><div className="sum-r"><span>Cəmi</span><span>{formatMoney(quote.gross)}</span></div><div className="sum-r"><span>Endirim</span><span>{formatMoney(-quote.discount)}</span></div></>}
              <div className="sum-r sum-tot" style={{ borderTop: 0, paddingTop: 0 }}><span className="w8">{pkg ? 'Pullu əlavələr' : quote.discount > 0 ? 'Yekun' : 'Cəmi'}</span><span className="num-s">{formatMoney(quote.total)}</span></div>
              {deposit > 0 && <div className="sum-r"><span>Beh ödənib</span><span>{formatMoney(deposit)}</span></div>}
              {s.cashback_used > 0 && <div className="sum-r"><span>Keşbekdən (əvvəl)</span><span>{formatMoney(-s.cashback_used)}</span></div>}
            </div>
          ) : <p className="t13 muted">{qerr || 'Hesablanır…'}</p>}
          <Err msg={qerr && quote ? qerr : ''} />
          {quote && (
            <div className="trow" style={{ minHeight: 48 }}>
              <span className="col grow" style={{ gap: 2 }}>
                <span className="t15 w8">{usable > 0 ? `Keşbekdən istifadə et · ${formatMoney(usable)}` : 'Keşbekdən istifadə'}</span>
                {usable === 0 && quote.cashback_balance > 0 && <span className="t12 soft">Keşbek balansı {formatMoney(quote.cashback_balance)} — {formatMoney(quote.cashback_min_use)}-ə çatanda istifadə olunur</span>}
              </span>
              <button type="button" className={`tgl${extra > 0 ? ' tgl-on' : ''}`} role="switch" aria-checked={extra > 0} aria-label="Keşbekdən istifadə" disabled={usable === 0} onClick={() => setUseCb(!useCb)} />
            </div>
          )}
          {quote && <div className="sum"><div className="sum-r sum-tot"><span><b>Qalıq: {formatMoney(due)}</b>{due > 0 ? ' · nağd / kart' : ''}</span></div></div>}
          {due > 0 && (
            <>
              <span className="lbl">Qalığın ödənişi</span>
              <Segmented label="Qalığın ödənişi" value={method} onChange={setMethod} options={[{ value: 'cash', label: 'Nağd' }, { value: 'card', label: 'Kart' }]} />
            </>
          )}
        </Card>
        {quote && quote.cashback_earn > 0 && (
          <Card tone="violet">
            <div className="row"><span className="ic ic-cream"><Icon name="sparkle" /></span><span className="t15 w8 grow">Keşbek: +{formatMoney(quote.cashback_earn)}{quote.first_shoot_bonus && <span className="t13 muted"> (ilk çəkiliş bonusu)</span>}</span></div>
          </Card>
        )}
        <Err msg={act.err} />
        <Button disabled={!quote || discBad || extrasBad || act.busy} onClick={close}><Icon name="check" size={20} /> Bağla</Button>
      </div>
    </AdminShell>
  );
}
