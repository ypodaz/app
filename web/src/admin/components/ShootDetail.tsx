import { useState, type CSSProperties } from 'react';
import { Sheet, formatHours, formatMoney2 } from '../../shared/ui';
import { useAction, useAuth, useLoad } from '../ctx';
import { bakuParts, busyRange, dateShort, dayNum, initials, monthShortUp, timeRange, toIso, weekday } from '../format';
import type { Shoot } from '../types';
import { AIcon } from './AIcon';
import { AChip, ConfirmDialog, ShootChip } from './neon';
import { Err, Field, depositPending, shootDesc } from './common';
import { DepositSheet } from './DepositSheet';
import { MaterialCard } from '../pages/Materials';

const WD = ['B.E.', 'Ç.A.', 'ÇƏR.', 'C.A.', 'CÜM.', 'ŞƏN.', 'BAZ.'];

const WINDOW: Record<string, string> = {
  gt24: '24 saatdan əvvəl ləğv: cərimə yoxdur, beh tam qaytarılır.',
  lt24: '24 saatdan az qalıb: beh tutulur.',
  no_show: 'Gəlmədi: beh tutulur.',
};

// B9: çəkiliş detalı (mobil tam ekran, desktopda sağ panel).
export function ShootDetail({ id }: { id: number }) {
  const { call } = useAuth();
  const { data: s, err, reload } = useLoad<Shoot>(`/shoots/${id}`);
  const act = useAction();
  const [dep, setDep] = useState(false);
  const [resched, setResched] = useState(false);
  const [ask, setAsk] = useState(false);

  if (!s) return err ? <Err msg={err} /> : <p className="a-empty">Yüklənir…</p>;

  const post = (path: string) => act.run(() => call(`/shoots/${id}/${path}`, { body: {} })).then((r) => r !== undefined && reload());
  async function noShow() {
    setAsk(false);
    post('no-show');
  }

  const open = s.status === 'confirmed';
  const off = s.status === 'cancelled';
  const lines: [string, number][] = s.kind === 'reels_pack'
    ? [['Reels paketi', s.price_base]]
    : s.kind === 'studio_rent' ? [[`Studiya icarəsi · ${formatHours(s.duration_min)}`, s.price_base]]
    : [[s.package_id ? 'Paketdən saatlar' : `${s.cameras} kameralı ${formatHours(s.duration_min)} çəkiliş`, s.price_base], ['Əlavə kamera', s.price_extra_camera], ['Montaj', s.price_editing], [`Podcastdan Reels · ${s.reels_count} əd.`, s.price_reels]];
  const d = bakuParts(s.starts_at).date;

  return (
    <div className="a-dt a-nofab">
      <a className="a-g a-rise a-cl" style={{ '--i': 0 } as CSSProperties} href={`#/clients/${s.client_id}`}>
        <span className="a-av">{initials(s.client_name ?? '?')}</span>
        <span className="a-cl-m"><b>{s.client_name}</b><span>Müştəri kartına keç</span></span>
        <AIcon name="chev" size={20} />
      </a>
      <section className="a-g a-rise a-tk" style={{ '--i': 1 } as CSSProperties}>
        <div className="a-tk-top">
          <div className="a-tk-d"><small>{WD[weekday(d)]}</small><b>{dayNum(d)}</b><small>{monthShortUp(d)}</small></div>
          <div className="a-tk-m">
            <b className={off ? 'off' : ''}>{timeRange(s.starts_at, s.duration_min)}</b>
            <ShootChip s={s} />
          </div>
        </div>
        <div className="a-tk-desc">{shootDesc(s)}</div>
        {s.address && <div className="a-tk-sub">{s.address}</div>}
        <div className="a-tk-cut" aria-hidden="true" />
        <div className="a-tk-sub"><AIcon name="clock" size={14} /><span>{off ? 'Vaxt təqvimdə boşaldıldı.' : `Studiya məşğul: ${busyRange(bakuParts(s.starts_at).time, s.duration_min, s.prep_min, s.wrap_min)} (hazırlıq ${s.prep_min} dəq, yığışdırma ${s.wrap_min} dəq)`}</span></div>
      </section>

      {off && (
        <section className="a-g a-g-hot a-rise" style={{ '--i': 2 } as CSSProperties}>
          <div className="a-gh"><span className="a-ic"><AIcon name="ban" size={16} /></span><span>Ləğv</span></div>
          {s.cancel_window && <p className="a-p">{WINDOW[s.cancel_window]}</p>}
          <div className="a-sum">
            {s.deposit_received_at && <div className="a-sr m"><span>Beh alınıb · {dateShort(bakuParts(s.deposit_received_at).date)}</span><b>{formatMoney2(s.deposit_amount)}</b></div>}
            <div className="a-sr m"><span>Tutulur</span><b>{formatMoney2(s.retained_amount)}</b></div>
          </div>
          <div className="a-box"><span>Qaytarılacaq</span><b className="a-n">{formatMoney2(s.refund_amount)}</b></div>
          {s.refund_amount > 0 && (s.refunded_at
            ? <AChip tone="cb">Qaytarıldı</AChip>
            : <><button type="button" className="a-bp a-bw" onClick={() => post('refunded')} disabled={act.busy}>Qaytarıldı · {formatMoney2(s.refund_amount)}</button><span className="a-note">Pulu müştəriyə qaytardıqdan sonra basın.</span></>)}
        </section>
      )}

      <section className="a-g a-rise" style={{ '--i': off ? 3 : 2 } as CSSProperties}>
        <div className="a-gh"><span className="a-ic"><AIcon name="cash" size={16} /></span><span>Ödəniş</span></div>
        <div className="a-sum">
          {lines.filter(([, v]) => v > 0).map(([l, v]) => <div key={l} className="a-sr"><span>{l}</span><b>{formatMoney2(v)}</b></div>)}
          {(s.extras ?? []).map((x, i) => <div key={i} className="a-sr"><span>{x.name}</span><b>{formatMoney2(x.amount)}</b></div>)}
          {s.discount > 0 && <>
            <div className="a-hr" />
            <div className="a-sr m"><span>Cəmi</span><b>{formatMoney2(s.total + s.discount)}</b></div>
            <div className="a-sr m"><span>Endirim{s.discount_note ? ` · ${s.discount_note}` : ''}</span><b>{formatMoney2(-s.discount)}</b></div>
          </>}
          <div className="a-sr a-tot"><span>{s.discount > 0 ? 'Yekun' : 'Cəmi'}</span><b className="a-n">{formatMoney2(s.total).replace(' AZN', '')}<small>AZN</small></b></div>
          {s.cashback_used > 0 && <div className="a-sr g"><span>Keşbekdən</span><b>{formatMoney2(-s.cashback_used)}</b></div>}
        </div>
        {s.deposit_received_at && <div><AChip tone="off">Beh alındı · {dateShort(bakuParts(s.deposit_received_at).date)} · {formatMoney2(s.deposit_amount)}</AChip></div>}
        {depositPending(s) && <div><AChip tone="beh">Beh gözlənilir · {formatMoney2(s.deposit_expected)}</AChip></div>}
        {s.deposit_waived && <div className="a-sr m"><span>Beh</span><b>0 AZN (behsiz təsdiq)</b></div>}
        {open && <div className="a-box"><span>Qalıq studiyada</span><b>{formatMoney2(s.studio_balance)}</b></div>}
        {s.status === 'completed' && s.paid_at_studio > 0 && <div className="a-sr m"><span>Studiyada ödənib ({s.paid_method === 'card' ? 'kart' : 'nağd'})</span><b>{formatMoney2(s.paid_at_studio)}</b></div>}
        <span className="a-pay" data-testid="payment-line">{s.payment_line}</span>
      </section>

      {s.status === 'completed' && <MaterialCard s={s} onChange={reload} />}
      {s.note && (
        <section className="a-g a-rise" style={{ '--i': 4 } as CSSProperties}>
          <div className="a-gh"><span className="a-ic"><AIcon name="pencil" size={16} /></span><span>Qeyd</span></div>
          <p className="a-p">{s.note}</p>
        </section>
      )}
      <Err msg={act.err} />

      {open && (
        <div className="a-acts-col a-rise" style={{ '--i': 5 } as CSSProperties}>
          {depositPending(s) && (
            <div className="a-r2">
              <button type="button" className="a-bp" onClick={() => setDep(true)}>Beh alındı</button>
              <button type="button" className="a-bg" onClick={() => post('deposit/waive')} disabled={act.busy}>Behsiz təsdiq</button>
            </div>
          )}
          <a className="a-bp a-bw" href={`#/shoots/${s.id}/close`}>Çəkilişi bağla</a>
          <div className="a-r3">
            <button type="button" className="a-bg" onClick={() => setResched(true)}>Vaxtı dəyiş</button>
            <a className="a-bg" href={`#/shoots/${s.id}/edit`}>Düzəlt</a>
            <a className="a-bg a-bg-red" href={`#/shoots/${s.id}/cancel`}>Ləğv et</a>
          </div>
          <button type="button" className="a-bg a-bg-dash" onClick={() => setAsk(true)} disabled={act.busy}>Gəlmədi</button>
        </div>
      )}
      <DepositSheet shoot={dep ? s : null} onClose={() => setDep(false)} onDone={reload} />
      <RescheduleSheet shoot={resched ? s : null} onClose={() => setResched(false)} onDone={reload} />
      <ConfirmDialog open={ask} title="Müştəri gəlmədi?" text="Növbəti dəfə beh mütləq olacaq." confirmLabel="Gəlmədi" onCancel={() => setAsk(false)} onConfirm={noShow} />
    </div>
  );
}

function RescheduleSheet({ shoot, onClose, onDone }: { shoot: Shoot | null; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, run } = useAction();
  const p = shoot ? bakuParts(shoot.starts_at) : { date: '', time: '' };
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  async function submit() {
    if (!shoot) return;
    const r = await run(() => call(`/shoots/${shoot.id}/reschedule`, { body: { starts_at: toIso(date ?? p.date, time ?? p.time) } }));
    if (r !== undefined) { setDate(null); setTime(null); onClose(); onDone(); }
  }
  return (
    <Sheet open={!!shoot} onClose={onClose} title="Vaxtı dəyiş">
      {shoot && <p className="a-ssub">{shoot.client_name} · indi {dateShort(p.date)}, {timeRange(shoot.starts_at, shoot.duration_min)}</p>}
      <div className="g2">
        <Field label="Yeni tarix" id="rs-d"><input id="rs-d" type="date" className="inp" value={date ?? p.date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Başlanğıc" id="rs-t"><input id="rs-t" type="time" className="inp" value={time ?? p.time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <div className="a-info"><AIcon name="info" size={16} /><span>Çəkilişə 24 saatdan az qalıbsa, vaxt yalnız bir dəfə dəyişdirilə bilər.</span></div>
      <Err msg={err} />
      <button type="button" className="a-bp a-bw" disabled={busy} onClick={submit}>Vaxtı dəyiş</button>
    </Sheet>
  );
}
