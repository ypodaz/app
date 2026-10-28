import { Card, Icon, Pill } from '../shared/ui';
import { ErrorState, Loading, OfflineBadge, Screen, TopBar, useApi, XIcon } from './core';
import { timeRange } from './shoots';
import { ADDRESS, MAP_URL, dateLong, dayNum, downloadIcs, editLabel, fmtHours, isFuture, money, monShort, placeLabel, plainDate, relDay, serviceLabel, shootWaText, statusKey, timeOf, waLink, weekday, type Shoot } from './util';

const STEPS = ['Təsdiqləndi', 'Çəkiliş', 'Montajda', 'Hazırdır'];

function Timeline({ s }: { s: Shoot }) {
  if (s.status === 'cancelled' || s.status === 'no_show')
    return <p className="t14 soft lh">{s.status === 'cancelled' ? 'Bu çəkiliş ləğv olunub.' : 'Çəkilişə gəlinməyib.'}</p>;
  const cur = s.status === 'confirmed' ? 0 : s.production === 'ready' ? 3 : s.production === 'editing' ? 2 : 1;
  const sub = (i: number) => (i === 1 ? `${dateLong(s.starts_at)} · ${timeOf(s.starts_at)}` : i === 2 && s.delivery_on ? `Təhvil ${plainDate(s.delivery_on)}` : i === cur && i === 0 ? 'cari addım' : '');
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {STEPS.map((t, i) => (
        <li key={t} className="step" style={{ minHeight: i === 3 ? 30 : 44 }} aria-current={i === cur ? 'step' : undefined}>
          <span className="dotc">
            {i === cur ? <span className="dotnow"><Icon name="check" size={14} strokeWidth={3} /></span>
              : i < cur ? <span className="dotdone"><Icon name="check" size={14} strokeWidth={3} /></span> : <span className="dot0" />}
            {i < 3 && <span className="line" />}
          </span>
          <span className="col" style={{ gap: 2, paddingTop: 3 }}>
            <span className="t14" style={{ fontWeight: i === cur ? 800 : 700, color: i === cur ? '#d8b4fe' : '#d9cde8' }}>{t}</span>
            {sub(i) && <span className="t12 muted">{sub(i)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Payment({ s }: { s: Shoot }) {
  const used = s.cashback_used ?? 0;
  const due = Math.max(0, s.total - used);
  const fromPkg = s.package_id != null;
  const rows: [string, number][] = [];
  if (!fromPkg || s.price_base) rows.push([s.kind === 'reels_pack' ? 'Reels paketi' : s.kind === 'studio_rent' ? 'Studiya icarəsi' : 'Çəkiliş', s.price_base]);
  if (s.price_extra_camera) rows.push(['Əlavə kamera', s.price_extra_camera]);
  if (s.price_editing) rows.push(['Montaj', s.price_editing]);
  if (s.price_reels) rows.push([`Reels · ${s.reels_count} əd.`, s.price_reels]);
  for (const x of s.extras ?? []) rows.push([x.name, x.amount]);
  const earn = s.cashback_earned ?? 0;
  return (
    <Card>
      <span className="h3">Ödəniş</span>
      <div className="sum">
        {fromPkg && <div className="sum-r"><span>Çəkiliş</span><span>Paketdən {fmtHours(s.duration_min)} saat</span></div>}
        {rows.map(([l, v]) => <div key={l} className="sum-r"><span>{l}</span><span>{money(v)}</span></div>)}
        {rows.length > 0 || fromPkg ? <div className="sum-r" style={{ fontWeight: 700 }}><span>{fromPkg ? 'Əlavələr' : 'Cəmi'}</span><span>{money(s.discount > 0 ? rows.reduce((a, r) => a + r[1], 0) : s.total)}</span></div> : null}
        {s.discount > 0 && <div className="sum-r pink"><span>Endirim</span><span>−{money(s.discount)}</span></div>}
        {used > 0 && <div className="sum-r pink"><span>Keşbekdən</span><span>−{money(used)}</span></div>}
        <div className="sum-r sum-tot">
          <span className="t13 muted">Ödəniləcək</span>
          <span className="num-m" style={{ fontSize: 28 }}>{money(due).replace(' AZN', '')}<span className="unit">AZN</span></span>
        </div>
      </div>
      <div className="paybox">
        {s.payment_line && <span className="row" style={{ gap: 8 }}><Icon name="wallet" size={16} />{s.payment_line}</span>}
        {s.status === 'confirmed' && (s.studio_balance ?? 0) > 0 && !s.payment_line?.includes('qalıq studiyada') && (
          <span className="row soft" style={{ gap: 8 }}><Icon name="pin" size={16} />Qalıq studiyada · {money(s.studio_balance!)} · nağd və ya kart</span>
        )}
        {s.status === 'confirmed' && s.payment_line?.startsWith('Beh gözlənilir') && (
          <span className="soft w6">Behi necə göndərəcəyinizi studiya sizə yazacaq.</span>
        )}
      </div>
      {s.status === 'confirmed' && s.cashback_expected && s.cashback_expected.amount > 0 && (
        <span className="row t12 w7 pink" style={{ gap: 6 }}><XIcon name="pct" size={16} />Çəkiliş bağlananda +{money(s.cashback_expected.amount)} keşbek
          {s.cashback_expected.first_shoot ? ' · ilk çəkiliş bonusu (50%)' : ''}</span>
      )}
      {s.status === 'completed' && earn > 0 && (
        <span className="row t12 w7 pink" style={{ gap: 6 }}><XIcon name="pct" size={16} />+{money(earn)} keşbek yazıldı</span>
      )}
    </Card>
  );
}

export function ShootDetail({ id }: { id: string }) {
  const q = useApi<Shoot>(`/me/shoots/${id}`, `ypod.shoot.${id}`);
  const s = q.data;
  return (
    <Screen tab="calendar">
      <TopBar title="Çəkiliş" back="#/calendar" />
      {q.offline && s && <OfflineBadge />}
      {!s ? (q.loading ? <Loading /> : <ErrorState q={q} title={q.err || 'Çəkiliş tapılmadı'} />) : (
        <>
          <section className="tick" aria-label="Çəkiliş bileti">
            <div className="tick-top">
              <div className="tick-date"><small>{weekday(s.starts_at).toUpperCase()}</small><b>{dayNum(s.starts_at)}</b><small>{monShort(s.starts_at)}</small></div>
              <div className="tick-main">
                <Pill status={statusKey(s)} />
                <span className="tick-time">{timeOf(s.starts_at)}</span>
                <span className="t14 w7" style={{ color: '#e9e0f5' }}>{timeRange(s)}</span>
                <span className="t14 w8"><span className="mk">{relDay(s.starts_at)}</span></span>
              </div>
            </div>
            <div className="tick-cut" aria-hidden="true"><i /><i /><u /></div>
            <dl className="dl">
              <div><dt>Xidmət</dt><dd>{serviceLabel(s)}</dd></div>
              <div><dt>Yer</dt><dd>{placeLabel(s)}</dd></div>
              {s.kind !== 'studio_rent' && <div><dt>Kamera</dt><dd>{s.cameras} kamera</dd></div>}
              {s.kind !== 'studio_rent' && <div><dt>Montaj</dt><dd>{editLabel(s)}</dd></div>}
              {!s.mine && <div><dt>Çəkiliş sahibi</dt><dd>{s.who} · paket üzvü</dd></div>}
            </dl>
          </section>

          {s.mine && s.materials.length > 0 && (
            <Card>
              <span className="h3">Material</span>
              {s.materials.map((m) => (
                <a key={m.id} className="btn btn-out btn-sm" href={m.drive_url} target="_blank" rel="noopener noreferrer">{m.title} · Drive-da aç<XIcon name="ext" size={16} /></a>
              ))}
            </Card>
          )}

          {s.mine && s.payment_line != null && <Payment s={s} />}

          <Card>
            <span className="h3">Status</span>
            <Timeline s={s} />
          </Card>

          <div className="col" style={{ gap: 10, marginTop: 2 }}>
            {isFuture(s) && <button type="button" className="btn btn-out" onClick={() => downloadIcs(s)}><Icon name="calendar" size={18} />Telefon təqviminə əlavə et</button>}
            <a className="btn btn-out" href={MAP_URL} target="_blank" rel="noopener"><XIcon name="nav" size={18} />Xəritədə aç</a>
            {s.location === 'studio' && <p className="hint ctr" style={{ textAlign: 'center' }}>{ADDRESS}</p>}
            {isFuture(s) && (
              <a className="btn btn-out" href={waLink(shootWaText(s))} target="_blank" rel="noopener"><XIcon name="wa" size={18} />Sualınız var? Bizə yazın</a>
            )}
            {/* ləğv qaydası gözə girməsin: bağlı, ən altda, kiçik boz yazı */}
            <details className="rules">
              <summary className="t12 muted">Ləğv qaydası</summary>
              <span className="t12 soft lh">24 saatdan çox qalıb: pulsuz ləğv və ya vaxt dəyişikliyi, beh tam qaytarılır.</span>
              <span className="t12 soft lh">24 saatdan az qalıb: beh qaytarılmır, istifadə olunan keşbek balansa qayıdır, ya da bir dəfə başqa vaxta keçmək olar.</span>
            </details>
          </div>
        </>
      )}
    </Screen>
  );
}
