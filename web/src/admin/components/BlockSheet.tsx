import { useEffect, useState } from 'react';
import { Button, Icon, Sheet, Stepper, formatHours } from '../../shared/ui';
import { useAction, useAuth } from '../ctx';
import { bakuParts, dateLong, timeRange, toIso } from '../format';
import type { Block } from '../types';
import { Err, Field } from './common';

const REASONS = ['Texniki iş', 'Şəxsi', 'Digər'];

// B3b: vaxtı blokla. block verilibsə: mövcud bloka baxış və silmə.
export function BlockSheet({ open, date, block, onClose, onDone }: { open: boolean; date: string; block: Block | null; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, setErr, run } = useAction();
  const [d, setD] = useState(date);
  const [time, setTime] = useState('10:00');
  const [dur, setDur] = useState(60);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setD(date); setErr(''); setNote(''); } }, [open, date]);

  async function save() {
    const start = Date.parse(toIso(d, time));
    const reasonText = note.trim() ? `${reason} · ${note.trim()}` : reason;
    const body = { starts_at: new Date(start).toISOString(), ends_at: new Date(start + dur * 60_000).toISOString(), reason: reasonText };
    if (await run(() => call('/blocks', { body })) !== undefined) { onClose(); onDone(); }
  }
  async function remove() {
    if (block && await run(() => call(`/blocks/${block.id}`, { method: 'DELETE' })) !== undefined) { onClose(); onDone(); }
  }

  if (block) {
    const p = bakuParts(block.starts_at);
    return (
      <Sheet open={open} onClose={onClose} title="Bloklanmış vaxt">
        <p className="t14 soft lh"><b>{block.reason || 'Bloklanıb'}</b><br />{dateLong(p.date)} · {timeRange(block.starts_at, (Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60_000)}</p>
        <Err msg={err} />
        <Button variant="danger" disabled={busy} onClick={remove}>Bloku sil</Button>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title="Vaxtı blokla">
      <div className="g2">
        <Field label="Tarix" id="bl-d"><input id="bl-d" type="date" className="inp" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <Field label="Başlanğıc" id="bl-t"><input id="bl-t" type="time" className="inp" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <div className="field"><span className="flabel">Müddət</span>
        <Stepper minutes={dur} onChange={setDur} min={30} max={720} />
        <span className="hint">Bu aralıqda çəkiliş əlavə etmək olmayacaq ({formatHours(dur)}). Server yeni çəkilişi rədd etmir, yalnız təqvimdə göstərilir.</span>
      </div>
      <div className="col"><span className="flabel">Səbəb</span>
        <div className="chips">{REASONS.map((r) => <button key={r} type="button" className={`chip${r === reason ? ' chip-on' : ''}`} aria-pressed={r === reason} onClick={() => setReason(r)}>{r === reason && <Icon name="check" size={14} strokeWidth={2.6} />}{r}</button>)}</div>
      </div>
      <Field label="Qeyd (istəyə görə)" id="bl-n"><input id="bl-n" className="inp" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="Məsələn, işıqların dəyişdirilməsi" /></Field>
      <Err msg={err} />
      <Button disabled={!d || !time || busy} onClick={save}>Blokla</Button>
    </Sheet>
  );
}
