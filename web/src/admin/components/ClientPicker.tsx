import { useState } from 'react';
import { Sheet } from '../../shared/ui';
import { useAction, useAuth, useLoad } from '../ctx';
import { initials } from '../format';
import type { Client } from '../types';
import { AIcon } from './AIcon';
import { Err, Field } from './common';

export function NewClientForm({ onCreated, submitLabel = 'Yarat' }: { onCreated: (c: Client) => void; submitLabel?: string }) {
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
      <Field label="Ad və soyad" id="nc-n"><input id="nc-n" className="inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="məs. Aysel Məmmədova" /></Field>
      <Field label="Telefon" id="nc-p"><input id="nc-p" className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="055 000 00 00" /></Field>
      <div className="a-info flat"><AIcon name="msg" size={16} /><span>Dəvət linki bu nömrəyə WhatsApp ilə göndəriləcək.</span></div>
      <Err msg={err} />
      <button type="button" className="a-bp a-bw" disabled={name.trim().length < 2 || busy} onClick={submit}>{submitLabel}</button>
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
          <NewClientForm submitLabel="Yarat və seç" onCreated={(c) => { reload(); pick(c); }} />
          <button type="button" className="a-back-l" onClick={() => setAdding(false)}><AIcon name="chevl" size={16} />Siyahıya qayıt</button>
        </>
      ) : (
        <>
          <label className="a-srch"><AIcon name="search" size={18} /><input type="search" placeholder="Ad və ya telefon" aria-label="Müştəri axtar" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
          <button type="button" className="a-newc" onClick={() => setAdding(true)}>
            <span className="a-av acc"><AIcon name="userplus" size={20} /></span><span>+ Yeni müştəri</span><AIcon name="chev" size={20} />
          </button>
          <Err msg={err} />
          <div className="a-pick">
            {list.length > 0 && <div className="a-pl">Bütün müştərilər</div>}
            {list.map((c) => (
              <button key={c.id} type="button" className="a-pr" onClick={() => pick(c)}>
                <span className="a-av">{initials(c.full_name).slice(0, 1)}</span>
                <span className="a-pr-m"><b>{c.full_name}</b><span>{c.phone || 'telefon yoxdur'}</span></span>
              </button>
            ))}
            {data && !list.length && (
              <div className="a-none">
                <span className="a-emp-ic"><AIcon name="search" size={20} /></span>
                <h3>Müştəri tapılmadı.</h3>
                {q.trim() && <p>«{q.trim()}» üzrə nəticə yoxdur. Başqa ad və ya telefon nömrəsi yoxlayın.</p>}
                {q.trim() && <button type="button" className="a-bg" onClick={() => setQ('')}>Axtarışı təmizlə</button>}
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
