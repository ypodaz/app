import { useEffect, useState } from 'react';
import { errMsg, useAuth } from '../../../ctx';
import { addDays, bakuParts, bakuToday, toIso } from '../../../format';
import type { Client } from '../../../types';
import { Button, ChangeNote, Dialog, Field, TextInput, useOnline } from '../../ui';
import { LOST_REASONS, leadName, type Lead, type LostReason } from './data';

/** İtirildi üçün səbəb seçimi (səbəbsiz server 422 verir). */
export function LostDialog({ lead, onConfirm, onClose }: { lead: Lead | null; onConfirm: (reason: LostReason, text: string) => Promise<unknown> | void; onClose: () => void }) {
  const [reason, setReason] = useState<LostReason | ''>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (lead) { setReason(''); setText(''); setBusy(false); } }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try { await onConfirm(reason, text.trim()); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!lead} onClose={onClose} title="İtirilmə səbəbi" subtitle={lead && leadName(lead)}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Ləğv</Button><Button variant="primary" disabled={!reason || busy} onClick={() => void submit()}>İtirildi kimi işarələ</Button></>}>
      <div className="ins-reasons" role="radiogroup" aria-label="İtirilmə səbəbi">
        {LOST_REASONS.map((r) => (
          <button key={r.key} type="button" role="radio" aria-checked={reason === r.key} className="ins-reason" onClick={() => setReason(r.key)}>{r.label}</button>
        ))}
      </div>
      {reason === 'diger' && (
        <Field label="Qısa izah (istəyə görə)">{(id) => <TextInput id={id} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="məs. layihə təxirə düşdü" />}</Field>
      )}
      <p className="ins-hint">«Sonra yazacam», «sabah yazacam», «studiyada ödəyəcəm» deyən müştəri itirilmiş deyil. Onu itirmək əvəzinə xatırlatma qoyun.</p>
      <ChangeNote changes={['Mərhələ «İtirildi» olur, səbəb yadda qalır']} unchanged={['Söhbət, çəkiliş və xatırlatma toxunulmaz qalır']} />
    </Dialog>
  );
}

const PRESETS: [string, number][] = [['Sabah', 1], ['3 gün sonra', 3], ['1 həftə sonra', 7]];

/** Xatırlatma: tarix (09:00) + qısa qeyd. Xatırlatmalı lead itirilmiş sayılmır, gözləyir. */
export function RemindDialog({ lead, onSave, onClose }: { lead: Lead | null; onSave: (at: string | null, note: string) => Promise<string | null>; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const today = bakuToday();
  useEffect(() => {
    if (!lead) return;
    setDate(lead.remind_at ? bakuParts(lead.remind_at).date : addDays(today, 1));
    setNote(lead.remind_note ?? ''); setErr(''); setBusy(false);
  }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (at: string | null) => {
    setBusy(true); setErr('');
    const e = await onSave(at, note);
    setBusy(false);
    if (e) setErr(e); else onClose();
  };
  return (
    <Dialog open={!!lead} onClose={onClose} title="Xatırlatma" subtitle={lead && leadName(lead)}
      footer={<>
        {lead?.remind_at && <Button variant="danger" disabled={busy || !online} onClick={() => void run(null)}>Xatırlatmanı sil</Button>}
        <Button variant="secondary" onClick={onClose} disabled={busy}>Ləğv</Button>
        <Button variant="primary" disabled={!date || date < today || busy || !online} onClick={() => void run(toIso(date, '09:00'))}>Yadda saxla</Button>
      </>}>
      <div className="ins-presets">
        {PRESETS.map(([l, n]) => <Button key={l} size="sm" variant="secondary" onClick={() => setDate(addDays(today, n))}>{l}</Button>)}
      </div>
      <Field label="Nə vaxt xatırladılsın" error={date && date < today ? 'Keçmiş tarix seçmək olmaz' : undefined}>
        {(id, invalid) => <TextInput id={id} type="date" min={today} value={date} invalid={invalid} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <Field label="Qeyd (istəyə görə)">{(id) => <TextInput id={id} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="məs. studiyada ödəyəcəm" />}</Field>
      {err && <p className="field__err" role="alert">Alınmadı: {err}</p>}
    </Dialog>
  );
}

/** «Yeni kontakt»: mövcud API yalnız ad + telefonla müştəri yaradır. */
export function NewContactDialog({ open, initialName, onClose, onCreated }: { open: boolean; initialName?: string; onClose: () => void; onCreated: (c: Client) => void }) {
  const { call } = useAuth();
  const online = useOnline();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(initialName ?? ''); setPhone(''); setErr(''); setBusy(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true); setErr('');
    try { onCreated(await call<Client>('/clients', { body: { full_name: name.trim(), phone } })); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Yeni kontakt"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Ləğv</Button><Button variant="primary" disabled={name.trim().length < 2 || busy || !online} onClick={() => void submit()}>Kontakt əlavə et</Button></>}>
      {/* TODO [API] Kanal, mərhələ, mənbə, etiket və təkrar nömrə yoxlaması: POST /clients yalnız full_name və phone qəbul edir, lead yaratmır (20-insanlar.md «Yeni kontakt»). */}
      <Field label="Ad, soyad">{(id) => <TextInput id={id} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder="məs. Nümunə Müştəri A" />}</Field>
      <Field label="Telefon">{(id) => <TextInput id={id} className="mono" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+994 50 000 00 00" />}</Field>
      {err && <p className="field__err" role="alert">Alınmadı: {err}</p>}
      <ChangeNote unchanged={['Kontakta heç bir mesaj getmir', 'Mövcud kontaktlar, çəkilişlər, keşbek və paketlər toxunulmazdır']} />
    </Dialog>
  );
}
