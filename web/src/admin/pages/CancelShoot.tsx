import { useEffect, useState, type CSSProperties } from 'react';
import { AdminShell, formatMoney2 } from '../../shared/ui';
import { AIcon } from '../components/AIcon';
import { PageHead, useToast } from '../components/neon';
import { Err, Field } from '../components/common';
import { errMsg, useAction, useAuth, useLoad } from '../ctx';
import { bakuNow, bakuParts, dateWd, timeRange, toIso } from '../format';
import type { CancelOut, Shoot } from '../types';

const WINDOW: Record<string, string> = {
  gt24: '24 saatdan əvvəl ləğv. Cərimə yoxdur.',
  lt24: '24 saatdan az qalıb. Beh tutulur.',
  no_show: 'Gəlmədi. Beh tutulur.',
};

function Calc({ r }: { r: CancelOut }) {
  return (
    <>
      <div className="a-warn a-grow"><AIcon name="warn" size={18} /><span>{WINDOW[r.window]}</span></div>
      <div className="a-sum">
        <div className="a-sr m"><span>Ödənilib (beh)</span><b>{formatMoney2(r.deposit_received_at ? r.deposit_amount : 0)}</b></div>
        <div className="a-sr m"><span>Tutulur</span><b>{formatMoney2(r.retained)}</b></div>
        <div className="a-sr m g"><span>Keşbek balansa qayıdır</span><b>{formatMoney2(r.cashback_return)}</b></div>
        <div className="a-hr" />
        <div className="a-sr a-tot"><span>Qaytarılacaq</span><b className="a-n">{formatMoney2(r.refund).replace(' AZN', '')}<small>AZN</small></b></div>
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
  const toast = useToast();
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
    if (await act.run(() => call(`/shoots/${id}/refunded`, { body: {} })) !== undefined) { setRefunded(true); toast.show('Qaytarıldı qeyd olundu'); }
  }
  const sp = bakuParts((res ?? s).starts_at);

  return (
    <AdminShell active="calendar" title="Ləğvi qeyd et" bare full>
      {toast.node}
      <div className="a-narrow a-nofab">
        <PageHead title="Ləğvi qeyd et" back={`shoots/${id}`} sub={`${s.client_name} · ${dateWd(sp.date)}, ${timeRange((res ?? s).starts_at, (res ?? s).duration_min)}`} />
        {!res && (
          <>
            <p className="a-lead">Müştəri ləğvi nə vaxt istəyib? Hesab (24 saat qaydası) bu vaxta görə aparılır.</p>
            <section className="a-g a-rise">
              <div className="g2">
                <Field label="Ləğv tarixi" id="cn-d"><input id="cn-d" type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Saat" id="cn-t"><input id="cn-t" type="time" className="inp" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              </div>
            </section>
            <section className="a-g a-rise a-gs" style={{ '--i': 1 } as CSSProperties}>
              <h2 className="a-cardh">Hesab (önbaxış)</h2>
              <Err msg={previewErr} />
              {preview && <Calc r={preview} />}
            </section>
            <span className="a-note a-note-rule">Qayda: 24 saatdan az qalanda beh (ödəniləcək məbləğin 50%-i) qaytarılmır, istifadə olunmuş keşbek balansa qayıdır.</span>
            <Err msg={act.err} />
            <button type="button" className="a-bp a-bw a-bred" disabled={!date || !time || act.busy} onClick={cancel}>Ləğvi qeyd et</button>
          </>
        )}
        {res && (
          <>
            <section className="a-g a-rise a-gs">
              <h2 className="a-cardh">Hesab</h2>
              <Calc r={res} />
            </section>
            {res.refund > 0 && !refunded && (
              <section className="a-g a-rise a-gs" style={{ '--i': 1 } as CSSProperties}>
                <p className="a-p">Pulu müştərinin kartına qaytarın, sonra «Qaytarıldı» basın. Müştəriyə bildiriş gedəcək.</p>
                <Err msg={act.err} />
                <button type="button" className="a-bp a-bw a-bgrn" disabled={act.busy} onClick={refund}><AIcon name="check" size={20} />Qaytarıldı · {formatMoney2(res.refund)}</button>
              </section>
            )}
            <a className="a-bg a-bw" href="#/panel">Panelə qayıt</a>
          </>
        )}
      </div>
    </AdminShell>
  );
}
