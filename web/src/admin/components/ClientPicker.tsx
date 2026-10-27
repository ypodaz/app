import { useState } from 'react';
import { Button, Icon, Sheet } from '../../shared/ui';
import { useAction, useAuth, useLoad } from '../ctx';
import type { Client } from '../types';
import { Avatar, Err, Field } from './common';

export function NewClientForm({ onCreated }: { onCreated: (c: Client) => void }) {
  const { call } = useAuth();
  const { busy, err, run } = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  async function submit() {
    const c = await run(() => call<Client>('/clients', { body: { full_name: name.trim(), phone } }));
    if (c) onCreated(c);
  }
  return (
    <>
      <Field label="Ad və soyad" id="nc-n"><input id="nc-n" className="inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
      <Field label="Telefon" id="nc-p" hint="Dəvət linki bu nömrəyə WhatsApp ilə göndəriləcək."><input id="nc-p" className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="055 530 35 32" /></Field>
      <Err msg={err} />
      <Button variant="cream" disabled={name.trim().length < 2 || busy} onClick={submit}>Yarat</Button>
    </>
  );
}

// Müştəri seçimi: axtarış + inline "Yeni müştəri".
export function ClientPickerSheet({ open, onClose, onPick, title = 'Müştəri seç', exclude = [] }: { open: boolean; onClose: () => void; onPick: (c: Client) => void; title?: string; exclude?: number[] }) {
  const { data, err, reload } = useLoad<Client[]>(open ? '/clients' : null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = (data ?? []).filter((c) => !exclude.includes(c.id) && (c.full_name + ' ' + c.phone).toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (c: Client) => { setQ(''); setAdding(false); onPick(c); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title={adding ? 'Yeni müştəri' : title}>
      {adding ? (
        <>
          <NewClientForm onCreated={(c) => { reload(); pick(c); }} />
          <Button variant="ghost" onClick={() => setAdding(false)}>Siyahıya qayıt</Button>
        </>
      ) : (
        <>
          <label className="inp"><Icon name="users" size={18} /><input type="search" className="ax-bare" placeholder="Ad və ya telefon üzrə axtar" aria-label="Müştəri axtar" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
          <Button variant="cream" small onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Yeni müştəri</Button>
          <Err msg={err} />
          <div className="list ax-pick">
            {list.map((c) => (
              <button key={c.id} type="button" className="li ax-li-btn" onClick={() => pick(c)}>
                <Avatar name={c.full_name} />
                <span className="col grow" style={{ gap: 2 }}><span className="t15 w8">{c.full_name}</span><span className="t12 muted">{c.phone || 'telefon yoxdur'}</span></span>
              </button>
            ))}
            {data && !list.length && <p className="t13 muted">Müştəri tapılmadı.</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}
