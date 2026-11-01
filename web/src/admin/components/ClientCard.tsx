import { useEffect, useState, type ReactNode } from 'react';
import { Button, Sheet, formatMoney } from '../../shared/ui';
import { useAction, useAuth, useLoad } from '../ctx';
import { appLine, aznInput, bakuParts, dateFull, dateShort, parseAzn } from '../format';
import type { ClientDetail, InviteOut, LedgerRow } from '../types';
import { AIcon } from './AIcon';
import { Av, stag } from './a3';
import { Err, Field, shootDesc, sourceName } from './common';
import { ConfirmDialog, ShootChip, useCountUp } from './neon';
import { ProfileSheet } from './ProfileSheet';
import { go } from '../router';

const KIND: Record<LedgerRow['kind'], string> = {
  earn: 'Çəkiliş keşbeki', earn_first: 'İlk çəkiliş bonusu', spend: 'Keşbekdən istifadə', spend_return: 'Keşbek qaytarıldı', manual: 'Əl ilə düzəliş',
  profile_bonus: 'Profil bonusu', referral: 'Dost dəvəti bonusu', birthday: 'Ad günü hədiyyəsi',
};
const azn = (q: number) => formatMoney(q).replace(' AZN', '');
// Neon cədvəldə mənfi işarə «−» (U+2212)
const signed = (q: number) => `${q > 0 ? '+' : q < 0 ? '−' : ''}${azn(Math.abs(q))}`;

// B6c: müştəri kartı (mobil tam ekran, desktopda sağ panel).
export function ClientCard({ id, onChanged }: { id: number; onChanged?: () => void }) {
  const { call } = useAuth();
  const detail = useLoad<ClientDetail>(`/clients/${id}`);
  const c = detail.data;
  const err = detail.err;
  const reload = () => detail.reload();
  const [cb, setCb] = useState(false);
  const [row, setRow] = useState<LedgerRow | null>(null);
  const [edit, setEdit] = useState(false);
  const [prof, setProf] = useState(false);
  const [inv, setInv] = useState<InviteOut | null>(null);
  const [copied, setCopied] = useState(false);
  const [askInv, setAskInv] = useState(false);
  const inviteAct = useAction();
  const bal = useCountUp(c?.cashback_balance, 700);

  if (!c) return err ? <Err msg={err} /> : <p className="a-empty">Yüklənir…</p>;

  async function invite() {
    const r = await inviteAct.run(() => call<InviteOut>(`/clients/${id}/invite`, { body: {} }));
    if (r) { setInv(r); setCopied(false); }
  }

  return (
    <div className="a3-cc" key={c.id}>
      <div className="a3-ch a-rise" style={stag(0)}>
        <Av name={c.full_name} size={48} />
        <span className="a3-chm">
          <b>{c.full_name}</b>
          <span>{c.phone || 'telefon yoxdur'} · {c.activated ? 'app-a qoşulub' : 'qoşulmayıb'}</span>
        </span>
        <button type="button" className="a-bg a-bg-i" aria-label="Redaktə et" title="Redaktə et" onClick={() => setEdit(true)}><AIcon name="pencil" size={20} /></button>
      </div>
      <span className="a3-app a-rise" style={stag(1)} data-testid="app-line"><i className={c.activated ? 'on' : ''} aria-hidden="true" /><span>{appLine(c)}</span></span>
      {c.notes && <p className="a3-notes a-rise" style={stag(1)}>Qeyd: {c.notes.charAt(0).toLowerCase() + c.notes.slice(1)}</p>}
      <a className="a-bp a3-wide a-rise" style={stag(2)} href={`#/shoots/new?client=${c.id}`}><AIcon name="plus" size={18} /> Çəkiliş əlavə et</a>
      {c.deposit_required && <div className="a3-ban a-rise" style={stag(3)}><AIcon name="alert" size={18} /><span><b>Beh mütləqdir</b> — müştəri əvvəl gəlməyib.</span></div>}

      <section className="a-g a-rise" style={stag(4)} aria-label="Profil">
        <div className="a3-sh"><h2>Profil</h2>
          <button type="button" className="a3-ib" aria-label="Profili redaktə et" title="Profili redaktə et" onClick={() => setProf(true)}><AIcon name="pencil" size={18} /></button>
        </div>
        <div className="a3-rows" data-testid="profile">
          <PRow label="İxtisas" value={c.profession} />
          <PRow label="İş yeri" value={c.workplace} />
          <PRow label="Instagram" value={c.instagram && <a className="a3-pv" href={`https://instagram.com/${c.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">@{c.instagram.replace(/^@/, '')}</a>} />
          <PRow label="Kontent mövzusu" value={c.niche} />
          <PRow label="Doğum günü" value={c.birthday && dateFull(c.birthday)} />
          <PRow label="Haradan tapıb" value={sourceName(c.source)} />
          <PRow label="Təkliflər" value={c.marketing_opt_in === false ? 'Bağlıdır' : 'Açıqdır'} />
          <PRow label="Dəvət edən" value={c.referred_by && <a className="a3-pl" href={`#/clients/${c.referred_by.id}`}>{c.referred_by.full_name}</a>} />
          {c.referral_code && <PRow label="Dəvət kodu" value={c.referral_code} />}
        </div>
        {!!c.tags?.length && <div className="a3-tags a3-tags-p">{c.tags.map((t) => <span key={t.id} className="a3-tag">{t.name}</span>)}</div>}
        {c.profile_complete === false && <p className="a-note">Profil tam doldurulmayıb.</p>}
      </section>

      <section className="a-g a-g-kb a-rise" style={stag(5)} aria-label="Keşbek">
        <span className="a-hot-glow a3-glow-g" aria-hidden="true" />
        <div className="a3-kh"><span className="a-ic a-ic-cb"><AIcon name="coins" size={16} /></span><span>Keşbek</span></div>
        <div className="a3-kn">{azn(bal ?? c.cashback_balance)}<small>AZN</small></div>
        <span className="a3-kt">Müddətsizdir</span>
        <button type="button" className="a-bg a3-wide" onClick={() => setCb(true)}>Başlanğıc keşbek</button>
      </section>

      <section className="a-g a-rise" style={stag(6)} aria-label="Keşbek tarixçəsi">
        <h2 className="a-cardh">Keşbek tarixçəsi</h2>
        <div>
          {c.cashback_rows.map((r) => {
            const body = (
              <>
                <span className={`a3-amt${r.amount > 0 ? ' pos' : ''}`}>{signed(r.amount)}</span>
                <span className="a3-hm"><b>{KIND[r.kind]}</b>{r.note && <span>{r.note}</span>}</span>
                <span className="a3-hd">{dateShort(bakuParts(r.created_at).date)}</span>
              </>
            );
            return r.kind === 'manual'
              ? <button key={r.id} type="button" className="a3-hr" aria-label={`${KIND[r.kind]} — redaktə et`} onClick={() => setRow(r)}>{body}<AIcon name="pencil" size={16} /></button>
              : <div key={r.id} className="a3-hr">{body}</div>;
          })}
          {!c.cashback_rows.length && <p className="a-empty">Hələ keşbek yoxdur.</p>}
        </div>
      </section>

      <section className="a-g a-rise" style={stag(7)} aria-label="Paketlər">
        <h2 className="a-cardh">Paketlər</h2>
        {c.packages.map((p) => (
          <a key={p.id} className="a3-pk" href="#/packages">
            <b>{p.title}</b>
            <span>{p.minutes_left / 60} / {p.minutes_total / 60} saat qalıb · {dateShort(p.ends_on)}-dək · {p.cameras} kamera</span>
            <div className="a3-prog"><span style={{ width: `${(p.minutes_left / p.minutes_total) * 100}%` }} /></div>
          </a>
        ))}
        {!c.packages.length && <p className="a-empty">Saat paketi yoxdur.</p>}
      </section>

      <section className="a-g a-rise" style={stag(8)} aria-label="Çəkilişlər">
        <h2 className="a-cardh">Çəkilişlər</h2>
        <div>
          {c.shoots.map((s) => {
            const p = bakuParts(s.starts_at);
            return (
              <a key={s.id} className="a3-sr" href={`#/shoots/${s.id}`}>
                <span className="a3-hm"><b>{dateShort(p.date)} · {p.time}</b><span>{shootDesc(s)}</span></span>
                <ShootChip s={s} />
              </a>
            );
          })}
        </div>
        {!c.shoots.length && <p className="a-empty">Çəkiliş yoxdur.</p>}
      </section>

      <section className="a3-inv a-rise" style={stag(9)} aria-label="Dəvət linki">
        <button type="button" className="a-bg a3-wide" onClick={() => (c.activated ? setAskInv(true) : invite())} disabled={inviteAct.busy}><AIcon name="link" size={18} /> {c.activated ? 'Yeni dəvət linki' : 'Dəvət linki'}</button>
        {c.activated && <p className="a-note">Yeni link yaradanda köhnə link etibarsız olur.</p>}
        <Err msg={inviteAct.err} />
        {inv && (
          <div className="a-g a3-il">
            <span className="a3-iu">{inv.url.replace(/^https?:\/\//, '')}</span>
            <div className="a3-ib2">
              {inv.whatsapp_url && <a className="a-bp" href={inv.whatsapp_url} target="_blank" rel="noopener">WhatsApp-da göndər</a>}
              <button type="button" className={`a-bg${copied ? ' a3-ok' : ''}`} onClick={() => navigator.clipboard.writeText(inv.url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); })}>
                {copied && <AIcon name="check" size={16} className="a3-draw" />}{copied ? 'Kopyalandı' : 'Linki kopyala'}
              </button>
            </div>
          </div>
        )}
      </section>
      <ConfirmDialog open={askInv} confirmLabel="Davam et" text="Müştərinin köhnə girişləri bağlanacaq. Davam edək?" onCancel={() => setAskInv(false)} onConfirm={() => { setAskInv(false); invite(); }} />
      <EditSheet open={edit} c={c} onClose={() => setEdit(false)} onDone={() => { reload(); onChanged?.(); }} />
      <ProfileSheet open={prof} c={c} onClose={() => setProf(false)} onDone={() => { reload(); onChanged?.(); }} />
      <CashbackSheet open={cb} id={id} onClose={() => setCb(false)} onDone={reload} />
      <RowSheet row={row} onClose={() => setRow(null)} onDone={() => { reload(); onChanged?.(); }} />
    </div>
  );
}

function PRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="a3-pr"><span>{label}</span><span>{value || '—'}</span></div>;
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
      <p className="a3-sp">Müştərinin əvvəlki keşbekini balansa yazın. Düzəliş üçün mənfi məbləğ (məs. −5) də olar.</p>
      <Field label="Məbləğ (AZN)" id="cb-a"><input id="cb-a" className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="məs. 35" /></Field>
      <Field label="Səbəb" id="cb-n"><input id="cb-n" className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="məs. Köhnə sistemdən keçid" /></Field>
      <Err msg={err} />
      <Button disabled={!q || busy} onClick={submit}>Yaz</Button>
    </Sheet>
  );
}

function RowSheet({ row, onClose, onDone }: { row: LedgerRow | null; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, setErr, run } = useAction();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (row) { setAmount(`${row.amount < 0 ? '-' : ''}${aznInput(row.amount)}`); setNote(row.note ?? ''); setErr(''); } }, [row]);
  const q = parseAzn(amount, true);
  async function save() {
    if (!row || !q) return;
    if (await run(() => call(`/cashback/${row.id}`, { method: 'PATCH', body: { amount: q, note: note.trim() } })) !== undefined) { onClose(); onDone(); }
  }
  async function remove() {
    setAsk(false);
    if (!row) return;
    if (await run(() => call(`/cashback/${row.id}`, { method: 'DELETE' })) !== undefined) { onClose(); onDone(); }
  }
  return (
    <Sheet open={!!row} onClose={onClose} title="Əl ilə düzəliş">
      <Field label="Məbləğ (AZN)" id="cr-a" hint="Mənfi də ola bilər, məs. −5"><input id="cr-a" className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Səbəb" id="cr-n"><input id="cr-n" className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Err msg={err} />
      <div className="a3-brow">
        <button type="button" className="a3-dng" disabled={busy} onClick={() => setAsk(true)}>Sil</button>
        <Button disabled={!q || busy} onClick={save}>Yadda saxla</Button>
      </div>
      <ConfirmDialog open={ask} confirmLabel="Sil" text="Bu sətir silinsin? Balans dəyişəcək." onCancel={() => setAsk(false)} onConfirm={remove} />
    </Sheet>
  );
}

function EditSheet({ open, c, onClose, onDone }: { open: boolean; c: ClientDetail; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { busy, err, setErr, run } = useAction();
  const [name, setName] = useState(c.full_name);
  const [phone, setPhone] = useState(c.phone);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (open) { setName(c.full_name); setPhone(c.phone); setNotes(c.notes ?? ''); setErr(''); } }, [open]);
  async function submit() {
    if (await run(() => call(`/clients/${c.id}`, { method: 'PATCH', body: { full_name: name.trim(), phone: phone.trim(), notes: notes.trim() } })) !== undefined) { onClose(); onDone(); }
  }
  async function remove() {
    setAsk(false);
    if (await run(() => call(`/clients/${c.id}`, { method: 'DELETE' })) !== undefined) { onClose(); go('clients'); onDone(); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Müştərini redaktə et">
      <Field label="Ad Soyad" id="ce-n"><input id="ce-n" className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Telefon" id="ce-p"><input id="ce-p" className="inp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Qeyd" id="ce-q"><textarea id="ce-q" className="inp ta" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Err msg={err} />
      <div className="a3-brow">
        <button type="button" className="a3-dng" disabled={busy} onClick={() => setAsk(true)}>Müştərini sil</button>
        <Button disabled={!name.trim() || busy} onClick={submit}>Yadda saxla</Button>
      </div>
      <ConfirmDialog open={ask} confirmLabel="Sil" text="Müştəri silinsin? Yalnız çəkilişi, ödənişi və paketi olmayan müştəri silinir." onCancel={() => setAsk(false)} onConfirm={remove} />
    </Sheet>
  );
}
