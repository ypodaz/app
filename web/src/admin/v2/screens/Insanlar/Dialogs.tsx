import { useEffect, useState } from 'react';
import { errMsg, useAuth } from '../../../ctx';
import { ApiError } from '../../../../shared/api';
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

/** Telefon yoxlaması (server `clean_phone` + `crm.contacts.normalize` formatları): +994 50 111 22 33, 050 111 22 33, 501112233, xarici 7–15 rəqəm. */
export function phoneError(v: string): string {
  const t = v.replace(/[\s\-()]/g, '');
  if (!t) return 'Telefon yazın';
  if (!/^\+?\d{7,15}$/.test(t)) return 'Telefon nömrəsi düzgün deyil';
  const d = t.replace(/\D/g, '');
  if (d.startsWith('0') && d.length !== 10) return 'Telefon 0XX XXX XX XX formatında olmalıdır';
  if (d.startsWith('994') && d.length !== 12) return 'Telefon +994 XX XXX XX XX formatında olmalıdır';
  return '';
}

/** «Yeni kontakt» (99 G8; İnsanlar, Inbox axtarışı, ümumi axtarış): ad, telefon, istəyə görə qeyd. Eyni nömrə varsa 409 → mövcud insanı açmağı təklif edir. */
export function NewContactDialog({ open, initialName, initialPhone, onClose, onCreated }: { open: boolean; initialName?: string; initialPhone?: string; onClose: () => void; onCreated: (c: Client) => void }) {
  const { call } = useAuth();
  const online = useOnline();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [dup, setDup] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(initialName ?? ''); setPhone(initialPhone ?? ''); setNote(''); setErr(''); setDup(null); setBusy(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pErr = phone.trim() ? phoneError(phone) : '';
  const submit = async () => {
    setBusy(true); setErr(''); setDup(null);
    try { onCreated(await call<Client>('/contacts', { body: { full_name: name.trim(), phone, note: note.trim() } })); }
    catch (e) {
      setErr(errMsg(e));
      const d = e instanceof ApiError && e.status === 409 ? (e.data as { client_id?: number } | undefined) : undefined;
      if (d?.client_id) setDup(d.client_id);
    }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Yeni kontakt"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Ləğv</Button><Button variant="primary" disabled={name.trim().length < 2 || !!phoneError(phone) || busy || !online} onClick={() => void submit()}>Kontakt əlavə et</Button></>}>
      {/* TODO [API] Kanal, mərhələ, mənbə və etiket seçimi (20-insanlar.md «Yeni kontakt»): POST /contacts müştəri kartı yaradır, lead yaratmır. */}
      <Field label="Ad, soyad">{(id) => <TextInput id={id} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder="məs. Nümunə Müştəri A" />}</Field>
      <Field label="Telefon" error={pErr || undefined}>{(id, invalid) => <TextInput id={id} className="mono" inputMode="tel" value={phone} invalid={invalid} onChange={(e) => setPhone(e.target.value)} placeholder="+994 50 000 00 00" />}</Field>
      <Field label="Qeyd (istəyə görə)">{(id) => <TextInput id={id} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="məs. Reklamdan yazıb" />}</Field>
      {err && <p className="field__err" role="alert">{dup ? err : `Alınmadı: ${err}`}</p>}
      {dup && <div><Button size="sm" variant="secondary" onClick={() => { onClose(); location.hash = `#/insanlar/${dup}`; }}>Mövcud insanı aç</Button></div>}
      <ChangeNote unchanged={['Kontakta heç bir mesaj getmir', 'Mövcud kontaktlar, çəkilişlər, keşbek və paketlər toxunulmazdır']} />
    </Dialog>
  );
}
