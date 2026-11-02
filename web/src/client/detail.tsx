import { useId, useState, type CSSProperties } from 'react';
import { NIcon } from '../shared/ui';
import { ErrorState, InnerHeader, Loading, OfflineBadge, Screen, useApi } from './core';
import { DateBox, StatusChip, kindLabel, timeRange } from './shoots';
import { ADDRESS, MAP_URL, dayLabel, dayMon, downloadIcs, editLabel, fmtHours, isFuture, placeLabel, relDay, shootWaText, timeOf, waLink, type Shoot } from './util';

const rise = (i: number) => ({ '--i': i }) as CSSProperties;
/** Detalda məbləğ həmişə iki onluqla: «200,00». */
const fmt2 = (q: number) => (Math.abs(q) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const azn = (q: number) => `${fmt2(q)} AZN`;
const STEPS = ['Təsdiqləndi', 'Çəkiliş', 'Montajda', 'Hazırdır'];

function Timeline({ s, i }: { s: Shoot; i: number }) {
  const cancelled = s.status === 'cancelled' || s.status === 'no_show';
  const cur = s.status === 'confirmed' ? 0 : s.production === 'ready' ? 3 : s.production === 'editing' ? 2 : 1;
  const ready = cur === 3;
  const sub = (k: number) => k === 0 ? dayMon(s.confirmed_at) : k === 1 ? `${isFuture(s) ? dayLabel(s.starts_at) : dayMon(s.starts_at)} · ${timeOf(s.starts_at)}`
    : k === 3 && s.delivery_on ? `Təhvil ${dayMon(`${s.delivery_on}T00:00:00+04:00`)}` : '';
  return (
    <section aria-label="Status" className="g rise" style={rise(i)}>
      <h2 className="n-h2" style={{ marginBottom: 12 }}>Status</h2>
      {cancelled ? <p className="n-body c2" style={{ margin: 0 }}>{s.status === 'cancelled' ? 'Bu çəkiliş ləğv olunub.' : 'Çəkilişə gəlinməyib.'}</p> : (
        <ol className="nsteps">
          <li aria-hidden="true" className="nsteps-ln" />
          {cur > 0 && <li aria-hidden="true" className={`nsteps-ln nsteps-fill${ready ? ' ok' : ''}`} style={{ '--f': cur / 3 } as CSSProperties} />}
          {STEPS.map((t, k) => (
            <li key={t} aria-current={k === cur ? 'step' : undefined} className={k <= cur ? 'on' : undefined}>
              <span className={`nsteps-dot${k <= cur ? (ready ? ' ok' : ' pu') : ''}${k === cur && !ready ? ' beat' : ''}`}>{k <= cur && <NIcon name="check" size={14} />}</span>
              <span className="n-col" style={{ gap: 0, flex: 'none' }}>
                <span className={k <= cur ? 'n-body6' : 'n-body c2'}>{t}</span>
                {sub(k) && <span className={`n-meta${k <= cur ? '' : ' c3'}`}>{sub(k)}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Payment({ s, i }: { s: Shoot; i: number }) {
  const used = s.cashback_used ?? 0;
  const due = Math.max(0, s.total - used);
  const fromPkg = s.package_id != null;
  const done = s.status === 'completed';
  const waiting = !!s.payment_line?.startsWith('Beh gözlənilir');
  const rows: [string, number][] = [];
  if (!fromPkg || s.price_base) rows.push([s.kind === 'reels_pack' ? 'Reels paketi' : s.kind === 'studio_rent' ? 'Studiya icarəsi' : 'Çəkiliş', s.price_base]);
  if (s.price_extra_camera) rows.push(['Əlavə kamera', s.price_extra_camera]);
  if (s.price_editing) rows.push(['Montaj', s.price_editing]);
  if (s.price_reels) rows.push([`Reels · ${s.reels_count} əd.`, s.price_reels]);
  for (const x of s.extras ?? []) rows.push([x.name, x.amount]);
  const sum = s.discount > 0 ? rows.reduce((a, r) => a + r[1], 0) : s.total;
  const earn = s.cashback_earned ?? 0;
  const balance = s.status === 'confirmed' && (s.studio_balance ?? 0) > 0;
  const full = s.payment_line === 'Tam ödənib';
  const line = full && done ? `Tam ödənib · ${azn(due)}` : fromPkg && balance ? 'Qalıq studiyada · nağd və ya kart' : s.payment_line;
  return (
    <section aria-label="Ödəniş" className="g rise" style={rise(i)}>
      <div className="n-hd"><span><span className="nchip"><NIcon name="coins" size={16} /></span><h2 className="n-h2">Ödəniş</h2></span></div>
      <div className="nsum">
        {fromPkg && <div><span className="c2">Çəkiliş — Paketdən {fmtHours(s.duration_min)} saat</span><span>{fmt2(0)}</span></div>}
        {rows.map(([l, v]) => <div key={l}><span className="c2">{l}</span><span>{fmt2(v)}</span></div>)}
        {(rows.length > 0 || fromPkg) && <><hr /><div style={{ fontWeight: 600 }}><span>Cəmi</span><span>{fmt2(sum)}</span></div></>}
        {s.discount > 0 && <div><span className="c2">Endirim</span><span className="nsum-g">−{fmt2(s.discount)}</span></div>}
        {used > 0 && <div><span className="c2">Keşbekdən</span><span className="nsum-g">−{fmt2(used)}</span></div>}
        <hr />
        <div className="nsum-tot">
          <span className="n-body6">{done ? 'Ödənilib' : 'Ödəniləcək'}</span>
          <span><span className="n-num">{fmt2(due)}</span> <span className="n-unit">AZN</span></span>
        </div>
      </div>
      {line && (
        <div className="inner" style={{ gap: 6 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: '18px', fontWeight: 500 }}>
            <NIcon name={waiting ? 'clock' : fromPkg && balance ? 'coins' : 'check'} size={16} style={{ flex: 'none', marginTop: 1, color: waiting || (fromPkg && balance) ? 'var(--yp-text-2)' : 'var(--yp-cashback)' }} />
            <span style={{ minWidth: 0 }}>{line}</span>
          </div>
          {waiting && s.status === 'confirmed' && <div className="n-meta" style={{ paddingLeft: 24 }}>Behi necə göndərəcəyinizi studiya sizə yazacaq.</div>}
          {balance && !waiting && !fromPkg && <div className="n-meta" style={{ paddingLeft: 24 }}>Qalıq studiyada · nağd və ya kart</div>}
        </div>
      )}
      {s.status === 'confirmed' && s.cashback_expected && s.cashback_expected.amount > 0 && (
        <div className="nsum-cb"><NIcon name="coins" size={14} />Çəkiliş bağlananda +{azn(s.cashback_expected.amount)} keşbek{s.cashback_expected.first_shoot ? ' · ilk çəkiliş bonusu (40%)' : ''}</div>
      )}
      {done && earn > 0 && <div className="nsum-cb"><NIcon name="coins" size={14} />+{azn(earn)} keşbek yazıldı</div>}
    </section>
  );
}

function Refund({ amount, i }: { amount: number; i: number }) {
  return (
    <section aria-label="Ödəniş" className="g rise" style={rise(i)}>
      <div className="n-hd"><span><span className="nchip"><NIcon name="coins" size={16} /></span><h2 className="n-h2">Ödəniş</h2></span></div>
      <div className="inner" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: '18px', fontWeight: 500 }}>
        <NIcon name="undo" size={16} style={{ flex: 'none', marginTop: 1, color: 'var(--yp-text-2)' }} />
        <span>Beh qaytarıldı · {azn(amount)}</span>
      </div>
    </section>
  );
}

function Materials({ s, i }: { s: Shoot; i: number }) {
  return (
    <section aria-label="Materiallar" className="g glow-mat rise" style={rise(i)}>
      <div className="n-hd"><span><span className="nchip nchip-mat"><NIcon name="folder" size={16} /></span><h2 className="n-h2">Materiallar</h2></span></div>
      <div className="nmat">
        {s.materials.map((m) => (
          <a key={m.id} className="nmat-r" href={m.drive_url} target="_blank" rel="noopener noreferrer" aria-label={`${m.title} · Drive-da aç`}>
            <span className="n-body" style={{ minWidth: 0 }}>{m.title}</span>
            <span className="nmat-o">Drive-da aç <span className="nmat-a" aria-hidden="true">↗</span></span>
          </a>
        ))}
      </div>
    </section>
  );
}

function CancelRule() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" className="nrule-b" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        Ləğv qaydası<NIcon name="chev" size={16} className="nrule-c" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
      </button>
      <div id={id} className={`nrule${open ? ' open' : ''}`}>
        <div className="nrule-in">
          <p><strong>24 saatdan çox qalıb:</strong> pulsuz ləğv və ya vaxt dəyişikliyi, beh tam qaytarılır.</p>
          <p><strong>24 saatdan az qalıb:</strong> beh qaytarılmır, istifadə olunan keşbek balansa qayıdır, ya da bir dəfə başqa vaxta keçmək olar.</p>
        </div>
      </div>
    </div>
  );
}

function Body({ s }: { s: Shoot }) {
  const cancelled = s.status === 'cancelled';
  const future = isFuture(s);
  const open = s.status === 'confirmed';
  const wa = (
    <a className="nb nb-s nb-full" href={waLink(shootWaText(s))} target="_blank" rel="noopener"><NIcon name="msg" size={18} />Sualınız var? Bizə yazın</a>
  );
  let i = 0;
  const ticket = (
    <section aria-label="Bilet" className={`g ntk rise${cancelled ? '' : ' glow-tk'}`} style={rise(i++)}>
      <div className="ntk-top">
        <DateBox iso={s.starts_at} />
        <div className="n-col" style={{ gap: 2 }}>
          <div className="ntk-r1"><span className="n-num">{timeOf(s.starts_at)}</span><StatusChip s={s} /></div>
          <span className="ntk-rng">{timeRange(s)}</span>
          {open || s.status === 'completed' ? <span className="ntk-rel" style={future ? undefined : { color: 'var(--yp-text-2)' }}>{future ? relDay(s.starts_at) : 'Keçmiş çəkiliş'}</span> : null}
        </div>
      </div>
      <div className="ntk-cut" aria-hidden="true"><i /><i /><u /></div>
      <dl className="ntk-dl">
        <div><dt>Xidmət</dt><dd>{kindLabel(s)}</dd></div>
        <div><dt>Yer</dt><dd>{placeLabel(s)}</dd></div>
        {s.kind !== 'studio_rent' && <div><dt>Kamera</dt><dd>{s.cameras} kamera</dd></div>}
        {s.kind !== 'studio_rent' && <div><dt>Montaj</dt><dd>{s.editing && !s.reels_count ? 'Montaj ilə' : editLabel(s)}</dd></div>}
      </dl>
      {!s.mine && (
        <div className="inner ntk-own"><NIcon name="user" size={16} style={{ flex: 'none', marginTop: 1, color: 'var(--yp-text-2)' }} /><span>Çəkiliş sahibi: {s.who} · paket üzvü</span></div>
      )}
    </section>
  );
  return (
    <div className="npush">
      {cancelled ? <div style={{ opacity: 0.6 }}>{ticket}</div> : ticket}
      {s.mine && s.materials.length > 0 && <Materials s={s} i={i++} />}
      {s.mine && !cancelled && s.payment_line != null && <Payment s={s} i={i++} />}
      {s.mine && cancelled && s.refund_amount != null && <Refund amount={s.refund_amount} i={i++} />}
      <Timeline s={s} i={i++} />
      <div className="ndbtns rise" style={rise(i++)}>
        {open && future && <button type="button" className="nb nb-s nb-full" onClick={() => downloadIcs(s)}><NIcon name="calplus" size={18} />Telefon təqviminə əlavə et</button>}
        {open && s.location === 'studio' && <a className="nb nb-s nb-full" href={MAP_URL} target="_blank" rel="noopener"><NIcon name="pin" size={18} />Xəritədə aç</a>}
        {open && s.location === 'studio' && <p className="n-meta ndbtns-addr">{ADDRESS}</p>}
        {(open || cancelled) && wa}
      </div>
      {open && future && <CancelRule />}
    </div>
  );
}

export function ShootDetail({ id }: { id: string }) {
  const q = useApi<Shoot>(`/me/shoots/${id}`, `ypod.shoot.${id}`);
  const s = q.data;
  return (
    <Screen tab="calendar">
      <InnerHeader title="Çəkiliş" back="#/calendar" />
      {q.offline && s && <OfflineBadge />}
      {!s ? (q.loading ? <Loading /> : <ErrorState q={q} title={q.err || 'Çəkiliş tapılmadı'} />) : <Body s={s} />}
    </Screen>
  );
}
