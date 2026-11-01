import { useEffect, useState } from 'react';
import { Sheet, formatMoney2 } from '../../shared/ui';
import { useAuth, useAction } from '../ctx';
import { aznInput, bakuParts, dateShort, parseAzn } from '../format';
import type { Shoot } from '../types';
import { Err, Field } from './common';

// "Beh alındı": məbləği təsdiqləyir (ilkin dəyər deposit_expected, dəyişdirilə bilər).
export function DepositSheet({ shoot, onClose, onDone }: { shoot: Shoot | null; onClose: () => void; onDone: (amount: number) => void }) {
  const { call } = useAuth();
  const { busy, err, setErr, run } = useAction();
  const [text, setText] = useState('');
  useEffect(() => { if (shoot) { setText(aznInput(shoot.deposit_expected)); setErr(''); } }, [shoot]);
  const amount = parseAzn(text);
  async function submit() {
    if (!shoot || !amount) return;
    if (await run(() => call(`/shoots/${shoot.id}/deposit`, { body: { amount } })) !== undefined) { onClose(); onDone(amount); }
  }
  return (
    <Sheet open={!!shoot} onClose={onClose} title="Beh alındı">
      {shoot && <p className="a-ssub">{shoot.client_name} · {dateShort(bakuParts(shoot.starts_at).date)}, {bakuParts(shoot.starts_at).time}</p>}
      <Field label="Məbləğ" id="dep">
        <div className="a-unit"><input id="dep" className={`inp${text && !amount ? ' inp-err' : ''}`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} /><span aria-hidden="true">AZN</span></div>
      </Field>
      {shoot && amount !== null && <div className="a-box"><span>Qalıq studiyada</span><b>{formatMoney2(Math.max(0, shoot.total - shoot.cashback_used - amount))}</b></div>}
      <Err msg={err} />
      <button type="button" className="a-bp a-bw" disabled={!amount || busy} onClick={submit}>Təsdiqlə</button>
    </Sheet>
  );
}
