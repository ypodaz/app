import { useEffect, useState } from 'react';
import { Button, Card, Icon, Sheet, formatMoney } from '../../shared/ui';
import { useAction, useAuth, useLoad } from '../ctx';
import { bakuParts, dateShort, parseAzn } from '../format';
import type { ClientDetail, InviteOut, LedgerRow } from '../types';
import { Avatar, Err, Field, ShootRow } from './common';

const KIND: Record<LedgerRow['kind'], string> = {
  earn: 'Çəkiliş keşbeki', earn_first: 'İlk çəkiliş bonusu', spend: 'Keşbekdən istifadə', spend_return: 'Keşbek qaytarıldı', manual: 'Əl ilə düzəliş',
};
const azn = (q: number) => formatMoney(q).replace(' AZN', '');

// B6c: müştəri kartı (mobil tam ekran, desktopda sağ panel).
export function ClientCard({ id, onChanged }: { id: number; onChanged?: () => void }) {
  const { call } = useAuth();
  const { data: c, err, reload } = useLoad<ClientDetail>(`/clients/${id}`);
  const [cb, setCb] = useState(false);
  const [edit, setEdit] = useState(false);
  const [inv, setInv] = useState<InviteOut | null>(null);
  const [copied, setCopied] = useState(false);
  const inviteAct = useAction();

  if (!c) return err ? <Err msg={err} /> : <p className="t13 muted">Yüklənir…</p>;

  async function invite() {
    if (c!.activated && !confirm('Müştərinin köhnə girişləri bağlanacaq. Davam edək?')) return;
    const r = await inviteAct.run(() => call<InviteOut>(`/clients/${id}/invite`, { body: {} }));
    if (r) { setInv(r); setCopied(false); }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 12 }}>
        <Avatar name={c.full_name} />
        <span className="col grow" style={{ gap: 2 }}>
          <span className="h2" style={{ fontSize: 17, overflowWrap: 'anywhere' }}>{c.full_name}</span>
          <span className="t13 soft">{c.phone || 'telefon yoxdur'} · {c.activated ? 'app-a qoşulub' : 'qoşulmayıb'}</span>
        </span>
        <button type="button" className="iconbtn" aria-label="Redaktə et" title="Redaktə et" onClick={() => setEdit(true)}><Icon name="edit" size={20} /></button>
      </div>
      {c.notes && <p className="t13 soft lh" style={{ overflowWrap: 'anywhere' }}>{c.notes}</p>}
      <a className="btn btn-primary btn-sm" href={`#/shoots/new?client=${c.id}`}><Icon name="plus" size={18} /> Çəkiliş əlavə et</a>
      {c.deposit_required && <div className="banner"><Icon name="alert" size={18} /><span><b>Beh mütləqdir</b> — müştəri əvvəl gəlməyib.</span></div>}

      <Card tone="violet">
        <span className="lbl" style={{ color: '#e9d5ff' }}>Keşbek</span>
        <span className="num-l">{azn(c.cashback_balance)}<span className="unit">AZN</span></span>
        <span className="t12 muted">Müddətsizdir</span>
        <Button variant="cream" small onClick={() => setCb(true)}>Başlanğıc keşbek</Button>
      </Card>

      <Card>
        <span className="h3">Keşbek tarixçəsi</span>
        <div className="list">
          {c.cashback_rows.map((r) => (
            <div key={r.id} className="li">
              <span className={r.amount < 0 ? 'amt-minus' : 'amt-plus'} style={{ minWidth: 70 }}>{r.amount > 0 ? '+' : ''}{azn(r.amount)}</span>
              <span className="col grow" style={{ gap: 2 }}><span className="t14 w7">{KIND[r.kind]}</span>{r.note && <span className="t12 muted">{r.note}</span>}</span>
              <span className="t12 muted">{dateShort(bakuParts(r.created_at).date)}</span>
            </div>
          ))}
          {!c.cashback_rows.length && <p className="t13 muted">Hələ keşbek yoxdur.</p>}
        </div>
      </Card>

      <Card>
        <span className="h3">Paketlər</span>
        {c.packages.map((p) => (
          <a key={p.id} className="col" href="#/packages" style={{ gap: 4, color: 'inherit', textDecoration: 'none' }}>
            <span className="t14 w8">{p.title}</span>
            <span className="t12 muted">{p.minutes_left / 60} / {p.minutes_total / 60} saat qalıb · {dateShort(p.ends_on)}-dək · {p.cameras} kamera</span>
            <div className="prog"><span style={{ width: `${(p.minutes_left / p.minutes_total) * 100}%` }} /></div>
          </a>
        ))}
        {!c.packages.length && <p className="t13 muted">Saat paketi yoxdur.</p>}
      </Card>

      <Card>
        <span className="h3">Çəkilişlər</span>
        <div className="list">{c.shoots.map((s) => <ShootRow key={s.id} s={s} withDate />)}</div>
        {!c.shoots.length && <p className="t13 muted">Çəkiliş yoxdur.</p>}
      </Card>

      <Button variant="out" small onClick={invite} disabled={inviteAct.busy}><Icon name="link" size={18} /> {c.activated ? 'Yeni dəvət linki' : 'Dəvət linki'}</Button>
      {c.activated && <p className="hint">Yeni link yaradanda köhnə link etibarsız olur.</p>}
      <Err msg={inviteAct.err} />
      {inv && (
        <div className="btns">
          {inv.whatsapp_url && <a className="btn btn-primary btn-sm" href={inv.whatsapp_url} target="_blank" rel="noopener">WhatsApp-da göndər</a>}
          <Button variant="out" small onClick={() => navigator.clipboard.writeText(inv.url).then(() => setCopied(true))}>{copied ? 'Kopyalandı' : 'Linki kopyala'}</Button>
        </div>
      )}
      <EditSheet open={edit} c={c} onClose={() => setEdit(false)} onDone={() => { reload(); onChanged?.(); }} />
      <CashbackSheet open={cb} id={id} onClose={() => setCb(false)} onDone={reload} />
    </div>
  );
}

function CashbackSheet({ open, id, onClose, onDone }: { open: boolean; id: number; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, run } = useAction();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('Başlanğıc keşbek');
  const q = parseAzn(amount, true);
  async function submit() {
    if (!q) return;
    if (await run(() => call(`/clients/${id}/cashback`, { body: { amount: q, note } })) !== undefined) { setAmount(''); onClose(); onDone(); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Başlanğıc keşbek">
      <p className="t13 soft lh">Müştərinin əvvəlki keşbekini balansa yazın. Düzəliş üçün mənfi məbləğ (məs. −5) də olar.</p>
      <Field label="Məbləğ (AZN)" id="cb-a"><input id="cb-a" className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="məs. 35" /></Field>
      <Field label="Səbəb" id="cb-n"><input id="cb-n" className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Err msg={err} />
      <Button disabled={!q || busy} onClick={submit}>Yaz</Button>
    </Sheet>
  );
}

function EditSheet({ open, c, onClose, onDone }: { open: boolean; c: ClientDetail; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, setErr, run } = useAction();
  const [name, setName] = useState(c.full_name);
  const [phone, setPhone] = useState(c.phone);
  const [notes, setNotes] = useState(c.notes ?? '');
  useEffect(() => { if (open) { setName(c.full_name); setPhone(c.phone); setNotes(c.notes ?? ''); setErr(''); } }, [open]);
  async function submit() {
    if (await run(() => call(`/clients/${c.id}`, { method: 'PATCH', body: { full_name: name.trim(), phone: phone.trim(), notes: notes.trim() } })) !== undefined) { onClose(); onDone(); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Müştərini redaktə et">
      <Field label="Ad Soyad" id="ce-n"><input id="ce-n" className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Telefon" id="ce-p"><input id="ce-p" className="inp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Qeyd" id="ce-q"><textarea id="ce-q" className="inp ta" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Err msg={err} />
      <Button disabled={!name.trim() || busy} onClick={submit}>Yadda saxla</Button>
    </Sheet>
  );
}
