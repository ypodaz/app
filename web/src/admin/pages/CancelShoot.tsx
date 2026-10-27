import { useEffect, useState } from 'react';
import { AdminShell, Button, Card, Icon, formatMoney } from '../../shared/ui';
import { BackLink, Err, Field, ShootTicket } from '../components/common';
import { errMsg, useAction, useAuth, useLoad } from '../ctx';
import { bakuNow, toIso } from '../format';
import type { CancelOut, Shoot } from '../types';

const WINDOW: Record<string, string> = {
  gt24: '24 saatdan əvvəl ləğv. Cərimə yoxdur.',
  lt24: '24 saatdan az qalıb. Beh tutulur.',
  no_show: 'Gəlmədi. Beh tutulur.',
};

function Calc({ r }: { r: CancelOut }) {
  return (
    <>
      <div className="banner"><Icon name="clock" size={18} /><span>{WINDOW[r.window]}</span></div>
      <div className="sum">
        <div className="sum-r"><span className="soft">Ödənilib (beh)</span><span>{formatMoney(r.deposit_received_at ? r.deposit_amount : 0)}</span></div>
        <div className="sum-r"><span className="soft">Tutulur</span><span>{formatMoney(r.retained)}</span></div>
        <div className="sum-r"><span className="soft">Keşbek balansa qayıdır</span><span>{formatMoney(r.cashback_return)}</span></div>
        <div className="sum-r sum-tot"><span className="w8">Qaytarılacaq</span><span className="num-m">{formatMoney(r.refund).replace(' AZN', '')}<span className="unit">AZN</span></span></div>
      </div>
    </>
  );
}

// B8: ləğvi qeyd et
export function CancelShoot({ id }: { id: number }) {
  const { call } = useAuth();
  const shoot = useLoad<Shoot>(`/shoots/${id}`);
  const now = bakuNow();
  const [date, setDate] = useState(now.date);
  const [time, setTime] = useState(now.time);
  const [res, setRes] = useState<CancelOut | null>(null);
  const [preview, setPreview] = useState<CancelOut | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [refunded, setRefunded] = useState(false);
  const act = useAction();
  const s = shoot.data;

  // ləğv vaxtı dəyişəndə önbaxış (bazaya yazılmır)
  useEffect(() => {
    if (!date || !time || res) return;
    let live = true;
    setPreviewErr('');
    call<CancelOut>(`/shoots/${id}/cancel/quote`, { body: { requested_at: toIso(date, time) } })
      .then((r) => live && setPreview(r)).catch((e) => { if (live) { setPreview(null); setPreviewErr(errMsg(e)); } });
    return () => { live = false; };
  }, [id, date, time, res, call]);

  if (!s) return <AdminShell active="calendar" title="Ləğvi qeyd et"><Err msg={shoot.err} /></AdminShell>;

  async function cancel() {
    const r = await act.run(() => call<CancelOut>(`/shoots/${id}/cancel`, { body: { requested_at: toIso(date, time) } }));
    if (r) setRes(r);
  }
  async function refund() {
    if (await act.run(() => call(`/shoots/${id}/refunded`, { body: {} })) !== undefined) setRefunded(true);
  }

  return (
    <AdminShell active="calendar" title="Ləğvi qeyd et">
      <BackLink to={`shoots/${id}`} />
      <div className="ax-narrow col" style={{ gap: 14 }}>
        <Card>
          <span className="t15 w8">{s.client_name}</span>
          <ShootTicket s={res ?? s} />
          {!res && (
            <>
              <p className="t13 soft lh">Müştəri ləğvi nə vaxt istəyib? Hesab (24 saat qaydası) bu vaxta görə aparılır.</p>
              <div className="g2">
                <Field label="Ləğv tarixi" id="cn-d"><input id="cn-d" type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Saat" id="cn-t"><input id="cn-t" type="time" className="inp" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              </div>
            </>
          )}
        </Card>
        {!res && (
          <>
            <Card>
              <span className="lbl">Hesab (önbaxış)</span>
              <Err msg={previewErr} />
              {preview && <Calc r={preview} />}
            </Card>
            <span className="hint">Qayda: 24 saatdan az qalanda beh (ödəniləcək məbləğin 50%-i) qaytarılmır, istifadə olunmuş keşbek balansa qayıdır.</span>
            <Err msg={act.err} />
            <Button variant="danger" disabled={!date || !time || act.busy} onClick={cancel}>Ləğvi qeyd et</Button>
          </>
        )}
        {res && (
          <Card>
            <span className="lbl">Hesab</span>
            <Calc r={res} />
            {res.refund > 0 && !refunded && (
              <>
                <span className="hint">Pulu müştərinin kartına qaytarın, sonra "Qaytarıldı" basın. Müştəriyə bildiriş gedəcək.</span>
                <Err msg={act.err} />
                <Button disabled={act.busy} onClick={refund}><Icon name="check" size={20} /> Qaytarıldı · {formatMoney(res.refund)}</Button>
              </>
            )}
            {refunded && <div className="toast" role="status"><Icon name="check" size={20} /><span>Qaytarıldı qeyd olundu</span></div>}
            <a className="btn btn-out" href="#/panel">Panelə qayıt</a>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
