import { useEffect, useState } from 'react';
import { formatMoney2 } from '../../../../shared/ui';
import { useAction, useAuth } from '../../../ctx';
import { aznInput, parseAzn } from '../../../format';
import type { Shoot } from '../../../types';
import { Button, ChangeNote, Dialog, Field, UnitInput } from '../../ui';

/** «Beh alındı» (15-cekilis-dialoqlari.md bu dialoqu tam təyin edəcək; Faza 0-da yalnız məbləğ). */
export function DepositDialog({ shoot, onClose, onDone }: { shoot: Shoot | null; onClose: () => void; onDone: (amount: number, s: Shoot) => void }) {
  const { call } = useAuth();
  const act = useAction();
  const [text, setText] = useState('');
  useEffect(() => { if (shoot) { setText(aznInput(shoot.deposit_expected)); act.setErr(''); } }, [shoot]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = parseAzn(text);
  async function submit() {
    if (!shoot || !amount) return;
    const r = await act.run(() => call(`/shoots/${shoot.id}/deposit`, { method: 'POST', body: { amount } }));
    if (r !== undefined) { onClose(); onDone(amount, shoot); }
  }
  // TODO [API] ödəniş üsulu (Kartdan karta / nağd): /shoots/{id}/deposit yalnız məbləği qəbul edir.
  return (
    <Dialog open={!!shoot} onClose={onClose} title="Beh alındı" subtitle={shoot?.client_name}
      footer={<><Button variant="text" onClick={onClose}>Ləğv et</Button><Button variant="primary" disabled={!amount || act.busy} onClick={submit}>{amount ? `Behi qeyd et · ${formatMoney2(amount)}` : 'Behi qeyd et'}</Button></>}>
      <Field label="Məbləğ" error={text && !amount ? 'Məbləği rəqəmlə yazın, məs. 75' : act.err || undefined}>
        {(id, bad) => <UnitInput id={id} unit="AZN" inputMode="decimal" value={text} invalid={bad} onChange={(e) => setText(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />}
      </Field>
      {shoot && amount !== null && <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Qalıq studiyada: <b className="mono" style={{ color: 'var(--text)', fontWeight: 600 }}>{formatMoney2(Math.max(0, shoot.total - shoot.cashback_used - amount))}</b></p>}
      <ChangeNote changes={['Çəkiliş «Təsdiqləndi» olur', 'Müştəriyə app bildirişi gedir']} unchanged={['Çəkilişin vaxtı və ümumi məbləği', 'Keşbek balansı']} />
    </Dialog>
  );
}
