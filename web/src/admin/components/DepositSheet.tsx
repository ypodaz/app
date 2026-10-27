import { useEffect, useState } from 'react';
import { Button, Sheet } from '../../shared/ui';
import { useAuth, useAction } from '../ctx';
import { aznInput, parseAzn } from '../format';
import type { Shoot } from '../types';
import { Err, Field } from './common';

// "Beh alındı": məbləği təsdiqləyir (ilkin dəyər deposit_expected, dəyişdirilə bilər).
export function DepositSheet({ shoot, onClose, onDone }: { shoot: Shoot | null; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, setErr, run } = useAction();
  const [text, setText] = useState('');
  useEffect(() => { if (shoot) { setText(aznInput(shoot.deposit_expected)); setErr(''); } }, [shoot]);
  const amount = parseAzn(text);
  async function submit() {
    if (!shoot || !amount) return;
    if (await run(() => call(`/shoots/${shoot.id}/deposit`, { body: { amount } })) !== undefined) { onClose(); onDone(); }
  }
  return (
    <Sheet open={!!shoot} onClose={onClose} title="Beh alındı">
      {shoot && <p className="t14 soft lh"><b>{shoot.client_name}</b> · alınan məbləği təsdiqləyin.</p>}
      <Field label="Alınan məbləğ (AZN)" id="dep">
        <input id="dep" className={`inp${text && !amount ? ' inp-err' : ''}`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Err msg={err} />
      <Button disabled={!amount || busy} onClick={submit}>Təsdiqlə</Button>
    </Sheet>
  );
}
