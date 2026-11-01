import { AIcon } from './AIcon';
import { aznInput, parseAzn } from '../format';
import type { Extra } from '../types';

// Əlavə xərc sətirləri: ad + AZN məbləği (mətn kimi saxlanır, göndərəndə qəpiyə çevrilir).
export type ExtraRow = { name: string; amount: string };
const MAX = 20;

export const extraRows = (list: Extra[]): ExtraRow[] => list.map((e) => ({ name: e.name, amount: aznInput(e.amount) }));

/** Tam boş sətir atılır; yarımçıq/yanlış sətir bad=true verir. */
export function extrasOf(rows: ExtraRow[]): { list: Extra[]; bad: boolean } {
  const list: Extra[] = [];
  let bad = false;
  for (const r of rows) {
    const name = r.name.trim();
    if (!name && !r.amount.trim()) continue;
    const amount = parseAzn(r.amount);
    if (!name || !amount) bad = true; else list.push({ name, amount });
  }
  return { list, bad };
}

export function ExtrasEditor({ rows, onChange }: { rows: ExtraRow[]; onChange: (r: ExtraRow[]) => void }) {
  const set = (i: number, p: Partial<ExtraRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="a-ex">
      {rows.map((r, i) => {
        const name = r.name.trim(), has = name || r.amount.trim();
        const msg = !has ? '' : !name ? 'Adı yazın' : !parseAzn(r.amount) ? 'Məbləği düzgün yazın, məs. 20 və ya 12,5' : '';
        return (
          <div key={i} className="a-exr">
            <div className="a-exi">
              <input className={`inp${msg && !name ? ' inp-err' : ''}`} aria-label={`Əlavə xərc ${i + 1} adı`} value={r.name} maxLength={80} placeholder="məs. Mikrofon icarəsi" onChange={(e) => set(i, { name: e.target.value })} />
              <div className="a-unit a-unit-s"><input className={`inp${msg && name ? ' inp-err' : ''}`} inputMode="decimal" aria-label={`Əlavə xərc ${i + 1} məbləği (AZN)`} value={r.amount} placeholder="0" onChange={(e) => set(i, { amount: e.target.value })} /><span aria-hidden="true">AZN</span></div>
              <button type="button" className="a-bg a-bg-i" aria-label={`Əlavə xərc ${i + 1} sil`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><AIcon name="x" size={18} /></button>
            </div>
            {msg && <span className="a-ferr2" role="alert">{msg}</span>}
          </div>
        );
      })}
      {rows.length < MAX && <button type="button" className="a-bg a-ex-add" onClick={() => onChange([...rows, { name: '', amount: '' }])}><AIcon name="plus" size={16} />Əlavə xərc</button>}
    </div>
  );
}
