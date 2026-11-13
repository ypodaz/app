import { useEffect, useState } from 'react';
import { errMsg, useAuth } from '../../../ctx';
import { aznInput, parseAzn } from '../../../format';
import type { ClientDetail, InviteOut, LedgerRow } from '../../../types';
import { Button, ChangeNote, Dialog, Field, TextArea, TextInput, useOnline, useToast } from '../../ui';

/** Ortaq: əməl + xəta. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setErr('');
    try { return await fn(); } catch (e) { setErr(errMsg(e)); return undefined; } finally { setBusy(false); }
  }
  return { busy, err, setErr, run };
}

/** Başlanğıc keşbek (POST /clients/:id/cashback). Düzəliş üçün mənfi məbləğ də olar. */
export function CashbackDialog({ open, id, onClose, onDone }: { open: boolean; id: number; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const { busy, err, setErr, run } = useRun();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('Başlanğıc keşbek');
  useEffect(() => { if (open) { setAmount(''); setNote('Başlanğıc keşbek'); setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = parseAzn(amount, true);
  const save = async () => {
    if (!q) return;
    if (await run(() => call(`/clients/${id}/cashback`, { body: { amount: q, note } })) !== undefined) { toast.show('Yadda saxlandı'); onClose(); onDone(); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Başlanğıc keşbek" subtitle="Müştərinin əvvəlki keşbekini balansa yazın. Düzəliş üçün mənfi məbləğ (məs. −5) də olar."
      footer={<><Button onClick={onClose} disabled={busy}>Ləğv</Button><Button variant="primary" disabled={!q || busy || !online} onClick={() => void save()}>Yaz</Button></>}>
      <Field label="Məbləğ (AZN)" error={amount && !q ? 'Məbləği rəqəmlə yazın, məs. 35' : undefined}>{(fid, invalid) => <TextInput id={fid} className="mono" inputMode="decimal" value={amount} invalid={invalid} onChange={(e) => setAmount(e.target.value)} placeholder="məs. 35" />}</Field>
      <Field label="Səbəb">{(fid) => <TextInput id={fid} value={note} onChange={(e) => setNote(e.target.value)} placeholder="məs. Köhnə sistemdən keçid" />}</Field>
      {err && <p className="field__err" role="alert">Alınmadı: {err}</p>}
    </Dialog>
  );
}

/** Əl ilə yazılmış keşbek sətrinin redaktəsi / silinməsi (PATCH, DELETE /cashback/:id). */
export function CashbackRowDialog({ row, onClose, onDone }: { row: LedgerRow | null; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const { busy, err, setErr, run } = useRun();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (row) { setAmount(`${row.amount < 0 ? '-' : ''}${aznInput(row.amount)}`); setNote(row.note ?? ''); setAsk(false); setErr(''); } }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = parseAzn(amount, true);
  const done = (msg: string) => { toast.show(msg); onClose(); onDone(); };
  return (
    <Dialog open={!!row} onClose={onClose} title={ask ? 'Bu sətir silinsin?' : 'Əl ilə düzəliş'}
      footer={ask
        ? <><Button onClick={() => setAsk(false)} disabled={busy}>Ləğv</Button><Button variant="danger" disabled={busy || !online} onClick={async () => { if (row && await run(() => call(`/cashback/${row.id}`, { method: 'DELETE' })) !== undefined) done('Sətir silindi'); }}>Sil</Button></>
        : <><Button variant="danger" disabled={busy || !online} onClick={() => setAsk(true)}>Sil</Button><Button variant="primary" disabled={!q || busy || !online} onClick={async () => { if (row && q && await run(() => call(`/cashback/${row.id}`, { method: 'PATCH', body: { amount: q, note: note.trim() } })) !== undefined) done('Yadda saxlandı'); }}>Yadda saxla</Button></>}>
      {ask ? <ChangeNote changes={['Müştərinin keşbek balansı bu sətrin məbləği qədər dəyişir']} unchanged={['Çəkilişlər və digər keşbek sətirləri']} /> : (
        <>
          <Field label="Məbləğ (AZN)" error={amount && !q ? 'Məbləği rəqəmlə yazın' : undefined}>{(fid, invalid) => <TextInput id={fid} className="mono" inputMode="decimal" value={amount} invalid={invalid} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Səbəb" hint="Mənfi məbləğ də ola bilər, məs. −5">{(fid) => <TextInput id={fid} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </>
      )}
      {err && <p className="field__err" role="alert">Alınmadı: {err}</p>}
    </Dialog>
  );
}

/** Ad, telefon, qeyd (PATCH /clients/:id) və müştərinin silinməsi (yalnız qeydsiz müştəri, server 409 verir). */
export function EditClientDialog({ open, c, onClose, onDone, onDeleted }: { open: boolean; c: ClientDetail; onClose: () => void; onDone: () => void; onDeleted: () => void }) {
  const { call } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const { busy, err, setErr, run } = useRun();
  const [name, setName] = useState(c.full_name);
  const [phone, setPhone] = useState(c.phone);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (open) { setName(c.full_name); setPhone(c.phone); setNotes(c.notes ?? ''); setAsk(false); setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onClose={onClose} title={ask ? 'Müştəri silinsin?' : 'Müştərini redaktə et'}
      footer={ask
        ? <><Button onClick={() => setAsk(false)} disabled={busy}>Ləğv</Button><Button variant="danger" disabled={busy || !online} onClick={async () => { if (await run(() => call(`/clients/${c.id}`, { method: 'DELETE' })) !== undefined) { toast.show(`Müştəri silindi · ${c.full_name}`); onClose(); onDeleted(); } }}>Müştərini sil</Button></>
        : <><Button variant="danger" disabled={busy || !online} onClick={() => setAsk(true)}>Müştərini sil</Button><Button variant="primary" disabled={name.trim().length < 2 || busy || !online} onClick={async () => { if (await run(() => call(`/clients/${c.id}`, { method: 'PATCH', body: { full_name: name.trim(), phone: phone.trim(), notes: notes.trim() } })) !== undefined) { toast.show('Yadda saxlandı'); onClose(); onDone(); } }}>Yadda saxla</Button></>}>
      {ask ? <ChangeNote changes={['Müştəri bazadan silinir (geri qaytarmaq olmur)']} unchanged={['Yalnız çəkilişi, ödənişi və paketi olmayan müştəri silinir; başqa halda server rədd edir']} /> : (
        <>
          <Field label="Ad, soyad">{(fid) => <TextInput id={fid} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Telefon">{(fid) => <TextInput id={fid} className="mono" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
          <Field label="Qeyd" hint="Daxili qeyd, müştəri görmür">{(fid) => <TextArea id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </>
      )}
      {err && <p className="field__err" role="alert">Alınmadı: {err}</p>}
    </Dialog>
  );
}

/** Dəvət linki (POST /clients/:id/invite). App-a qoşulmuş müştəridə yeni link köhnəni etibarsız edir, əvvəl təsdiq. */
export function InviteDialog({ open, c, onClose }: { open: boolean; c: ClientDetail; onClose: () => void }) {
  const { call } = useAuth();
  const online = useOnline();
  const { busy, err, setErr, run } = useRun();
  const [inv, setInv] = useState<InviteOut | null>(null);
  const [copied, setCopied] = useState(false);
  const [sure, setSure] = useState(true);
  useEffect(() => { if (open) { setInv(null); setCopied(false); setErr(''); setSure(!c.activated); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const make = async () => { const r = await run(() => call<InviteOut>(`/clients/${c.id}/invite`, { body: {} })); if (r) setInv(r); };
  useEffect(() => { if (open && sure && !inv && online) void make(); }, [open, sure]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onClose={onClose} title={c.activated ? 'Yeni dəvət linki' : 'Dəvət linki'} subtitle={c.full_name}
      footer={!sure
        ? <><Button onClick={onClose}>Ləğv</Button><Button variant="primary" disabled={!online} onClick={() => setSure(true)}>Davam et</Button></>
        : <Button onClick={onClose}>Bağla</Button>}>
      {!sure && <ChangeNote changes={['Müştərinin köhnə girişləri və köhnə link bağlanır']} unchanged={['Keşbek, paketlər və çəkilişlər']} />}
      {sure && busy && !inv && <p className="ins-hint">Link hazırlanır…</p>}
      {inv && (
        <>
          <p className="ins-link mono">{inv.url.replace(/^https?:\/\//, '')}</p>
          <div className="ins-invact">
            {inv.whatsapp_url && <a className="btn btn--secondary btn--md" href={inv.whatsapp_url} target="_blank" rel="noopener noreferrer">WhatsApp-da göndər</a>}
            <Button onClick={() => navigator.clipboard.writeText(inv.url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => setErr('Kopyalanmadı'))}>{copied ? 'Kopyalandı' : 'Linki kopyala'}</Button>
          </div>
          <p className="ins-hint">Link 7 gün etibarlıdır.</p>
        </>
      )}
      {err && <p className="field__err" role="alert">Alınmadı: {err} {sure && !inv && <button type="button" className="ins-lnk" onClick={() => void make()}>Yenidən cəhd et</button>}</p>}
    </Dialog>
  );
}
