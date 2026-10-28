import { useState } from 'react';
import { Button, Card, Icon, Pill, Sheet, formatHours, formatMoney } from '../../shared/ui';
import { useAction, useAuth, useLoad } from '../ctx';
import { bakuParts, busyRange, dateShort, toIso } from '../format';
import type { Shoot } from '../types';
import { Avatar, Err, Field, ShootTicket, depositPending } from './common';
import { DepositSheet } from './DepositSheet';
import { MaterialCard } from '../pages/Materials';

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

  if (!s) return err ? <Err msg={err} /> : <p className="t13 muted">Yüklənir…</p>;

  const post = (path: string) => act.run(() => call(`/shoots/${id}/${path}`, { body: {} })).then((r) => r !== undefined && reload());
  async function noShow() {
    if (confirm('Müştəri gəlmədi? Növbəti dəfə beh mütləq olacaq.')) post('no-show');
  }

  const open = s.status === 'confirmed';
  const lines: [string, number][] = s.kind === 'reels_pack'
    ? [['Reels paketi', s.price_base]]
    : s.kind === 'studio_rent' ? [[`Studiya icarəsi · ${formatHours(s.duration_min)}`, s.price_base]]
    : [[s.package_id ? 'Paketdən saatlar' : `${s.cameras} kameralı ${formatHours(s.duration_min)} çəkiliş`, s.price_base], ['Əlavə kamera', s.price_extra_camera], ['Montaj', s.price_editing], [`Podcastdan Reels · ${s.reels_count} əd.`, s.price_reels]];

  return (
    <div className="col" style={{ gap: 14 }}>
      <a className="card" href={`#/clients/${s.client_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={s.client_name ?? '?'} />
        <span className="col grow" style={{ gap: 2 }}><span className="t15 w8">{s.client_name}</span><span className="t12 muted">Müştəri kartına keç</span></span>
        <Icon name="chevron" size={20} />
      </a>
      <ShootTicket s={s}>
        {s.address && <span className="t12 muted">{s.address}</span>}
        <span className="t12 muted">Studiya məşğul: {busyRange(bakuParts(s.starts_at).time, s.duration_min, s.prep_min, s.wrap_min)} (hazırlıq {s.prep_min} dəq, yığışdırma {s.wrap_min} dəq)</span>
      </ShootTicket>

      <Card>
        <span className="lbl">Ödəniş</span>
        <div className="sum">
          {lines.filter(([, v]) => v > 0).map(([l, v]) => <div key={l} className="sum-r"><span className="soft">{l}</span><span>{formatMoney(v)}</span></div>)}
          {(s.extras ?? []).map((x, i) => <div key={i} className="sum-r"><span className="soft">{x.name}</span><span>{formatMoney(x.amount)}</span></div>)}
          {s.discount > 0 && <>
            <div className="sum-r"><span className="soft">Cəmi</span><span>{formatMoney(s.total + s.discount)}</span></div>
            <div className="sum-r"><span className="soft">Endirim{s.discount_note ? ` · ${s.discount_note}` : ''}</span><span>{formatMoney(-s.discount)}</span></div>
          </>}
          <div className="sum-r sum-tot"><span className="w8">{s.discount > 0 ? 'Yekun' : 'Cəmi'}</span><span className="num-s">{formatMoney(s.total)}</span></div>
          {s.cashback_used > 0 && <div className="sum-r"><span className="soft">Keşbekdən</span><span>{formatMoney(-s.cashback_used)}</span></div>}
          {s.deposit_received_at && <div className="sum-r"><span className="row" style={{ gap: 6 }}><Pill status="confirmed">Beh alındı</Pill><span className="t12 muted">{dateShort(bakuParts(s.deposit_received_at).date)}</span></span><span>{formatMoney(s.deposit_amount)}</span></div>}
          {depositPending(s) && <div className="sum-r"><Pill status="deposit">Beh gözlənilir</Pill><span>{formatMoney(s.deposit_expected)}</span></div>}
          {s.deposit_waived && <div className="sum-r"><span className="soft">Beh</span><span>0 AZN (behsiz təsdiq)</span></div>}
          {open && <div className="sum-r"><span className="soft">Qalıq studiyada</span><span>{formatMoney(s.studio_balance)}</span></div>}
          {s.status === 'completed' && s.paid_at_studio > 0 && <div className="sum-r"><span className="soft">Studiyada ödənib ({s.paid_method === 'card' ? 'kart' : 'nağd'})</span><span>{formatMoney(s.paid_at_studio)}</span></div>}
        </div>
        <span className="t13 w7 pink" data-testid="payment-line">{s.payment_line}</span>
      </Card>

      {s.status === 'cancelled' && (
        <Card>
          <span className="lbl">Ləğv</span>
          {s.cancel_window && <p className="t13 soft lh">{WINDOW[s.cancel_window]}</p>}
          <div className="sum">
            <div className="sum-r"><span className="soft">Tutulur</span><span>{formatMoney(s.retained_amount)}</span></div>
            <div className="sum-r"><span className="soft">Qaytarılacaq</span><span>{formatMoney(s.refund_amount)}</span></div>
          </div>
          {s.refund_amount > 0 && (s.refunded_at ? <Pill status="done">Qaytarıldı</Pill> : <Button onClick={() => post('refunded')} disabled={act.busy}>Qaytarıldı · {formatMoney(s.refund_amount)}</Button>)}
        </Card>
      )}

      {s.status === 'completed' && <MaterialCard s={s} onChange={reload} />}
      {s.note && <Card><span className="lbl">Qeyd</span><p className="t14 soft lh">{s.note}</p></Card>}
      <Err msg={act.err} />

      {open && (
        <>
          {depositPending(s) && (
            <div className="btns">
              <Button onClick={() => setDep(true)}>Beh alındı</Button>
              <Button variant="cream" onClick={() => post('deposit/waive')} disabled={act.busy}>Behsiz təsdiq</Button>
            </div>
          )}
          <a className="btn btn-primary" href={`#/shoots/${s.id}/close`}>Çəkilişi bağla</a>
          <div className="btns">
            <Button variant="cream" onClick={() => setResched(true)}>Vaxtı dəyiş</Button>
            <a className="btn btn-danger" href={`#/shoots/${s.id}/cancel`}>Ləğv et</a>
          </div>
          <a className="btn btn-out" href={`#/shoots/${s.id}/edit`}><Icon name="edit" size={18} /> Düzəlt</a>
          <Button variant="ghost" onClick={noShow} disabled={act.busy}>Gəlmədi</Button>
        </>
      )}
      <DepositSheet shoot={dep ? s : null} onClose={() => setDep(false)} onDone={reload} />
      <RescheduleSheet shoot={resched ? s : null} onClose={() => setResched(false)} onDone={reload} />
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
      <div className="g2">
        <Field label="Yeni tarix" id="rs-d"><input id="rs-d" type="date" className="inp" value={date ?? p.date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Başlanğıc" id="rs-t"><input id="rs-t" type="time" className="inp" value={time ?? p.time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <p className="hint">Çəkilişə 24 saatdan az qalıbsa, vaxt yalnız bir dəfə dəyişdirilə bilər.</p>
      <Err msg={err} />
      <Button disabled={busy} onClick={submit}>Vaxtı dəyiş</Button>
    </Sheet>
  );
}

