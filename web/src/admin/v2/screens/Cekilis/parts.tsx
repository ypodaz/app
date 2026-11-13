import { useState } from 'react';
import { useAction, useAuth, useLoad } from '../../../ctx';
import { initials, parseAzn } from '../../../format';
import type { Client } from '../../../types';
import { extrasOf, type ExtraRow } from '../../../components/ExtrasEditor';
import { Avatar, Button, EmptyState, ErrorBox, Field, LoadingRows, TextInput, UnitInput, V2Icon } from '../../ui';

/** Ortaq ola bilər: − mətn + stepper (müddət, say). */
export function Stepper({ text, label, onDec, onInc, decDisabled, incDisabled }: { text: string; label: string; onDec: () => void; onInc: () => void; decDisabled?: boolean; incDisabled?: boolean }) {
  return (
    <div className="ck-step" role="group" aria-label={label}>
      <button type="button" aria-label={`${label} azalt`} disabled={decDisabled} onClick={onDec}>−</button>
      <span className="mono" aria-live="polite">{text}</span>
      <button type="button" aria-label={`${label} artır`} disabled={incDisabled} onClick={onInc}>+</button>
    </div>
  );
}

/** Ortaq ola bilər: tək seçimli çip qrupu. */
export function Chips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; disabled?: boolean }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ck-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled} className="ck-pill" onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Əlavə xərc sətirləri (ad + AZN). Məntiq köhnə ExtrasEditor ilə eynidir (extrasOf). */
export function Extras({ rows, onChange }: { rows: ExtraRow[]; onChange: (r: ExtraRow[]) => void }) {
  const set = (i: number, p: Partial<ExtraRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="ck-extras">
      {rows.map((r, i) => {
        const name = r.name.trim(), has = name || r.amount.trim();
        const msg = !has ? '' : !name ? 'Adı yazın' : !parseAzn(r.amount) ? 'Məbləği düzgün yazın, məs. 20 və ya 12,5' : '';
        return (
          <div key={i} className="ck-extras__r">
            <div className="ck-extras__in">
              <TextInput aria-label={`Əlavə xərc ${i + 1} adı`} value={r.name} maxLength={80} placeholder="məs. Mikrofon icarəsi" invalid={!!msg && !name} onChange={(e) => set(i, { name: e.target.value })} />
              <UnitInput unit="AZN" inputMode="decimal" aria-label={`Əlavə xərc ${i + 1} məbləği`} value={r.amount} placeholder="0" invalid={!!msg && !!name} onChange={(e) => set(i, { amount: e.target.value })} />
              <Button variant="text" size="sm" aria-label={`Əlavə xərc ${i + 1} sil`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><V2Icon name="x" /></Button>
            </div>
            {msg && <span className="field__err" role="alert">{msg}</span>}
          </div>
        );
      })}
      {rows.length < 20 && <Button size="sm" icon={<V2Icon name="plus" />} onClick={() => onChange([...rows, { name: '', amount: '' }])}>Əlavə xərc</Button>}
    </div>
  );
}
export { extrasOf };

/** Müştəri seçimi: axtarış + yeni kontakt (köhnə ClientPickerSheet-in v2 versiyası). */
export function ClientPicker({ onPick, onCancel }: { onPick: (c: Client) => void; onCancel?: () => void }) {
  const { call } = useAuth();
  const { data, err, reload } = useLoad<Client[]>('/clients');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const act = useAction();
  const s = q.trim().toLowerCase();
  const digits = s.replace(/\D/g, '');
  const list = (data ?? []).filter((c) => !s || c.full_name.toLowerCase().includes(s) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))).slice(0, 30);
  async function create() {
    const c = await act.run(() => call<Client>('/clients', { body: { full_name: name.trim(), phone } }));
    if (c) { reload(); onPick(c); }
  }
  if (adding) {
    return (
      <div className="ck-pick">
        <Field label="Ad və soyad">{(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="məs. Nümunə Müştəri" autoFocus />}</Field>
        <Field label="Telefon" hint="Dəvət linki bu nömrəyə WhatsApp ilə göndəriləcək.">{(id) => <TextInput id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="055 000 00 00" />}</Field>
        {act.err && <span className="field__err" role="alert">{act.err}</span>}
        <div className="ck-row-end">
          <Button variant="text" onClick={() => setAdding(false)}>Siyahıya qayıt</Button>
          <Button disabled={name.trim().length < 2 || act.busy} onClick={create}>Yarat və seç</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="ck-pick">
      <TextInput type="search" aria-label="Ad və ya telefon" placeholder="Ad və ya telefon" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {err ? <ErrorBox title="Müştərilər yüklənmədi" detail={err} onRetry={reload} /> : !data ? <LoadingRows rows={3} /> : (
        <div className="ck-pick__list">
          {list.map((c) => (
            <button key={c.id} type="button" className="ck-pick__r" onClick={() => onPick(c)}>
              <Avatar name={c.full_name} /><span className="ck-pick__m"><b>{c.full_name}</b><span className="mono">{c.phone || 'telefon yoxdur'}</span></span>
            </button>
          ))}
          {!list.length && <EmptyState title={`«${q.trim()}» tapılmadı`} reason="Yeni kontakt yarada bilərsiniz." />}
        </div>
      )}
      <div className="ck-row-end">
        {onCancel && <Button variant="text" onClick={onCancel}>Bağla</Button>}
        <Button icon={<V2Icon name="plus" />} onClick={() => { setName(q.trim().replace(/\d/g, '').trim()); setAdding(true); }}>Yeni kontakt</Button>
      </div>
    </div>
  );
}
export { initials };
