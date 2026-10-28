import { Button, Icon } from '../../shared/ui';
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
    <div className="col" style={{ gap: 8 }}>
      {rows.map((r, i) => {
        const name = r.name.trim(), has = name || r.amount.trim();
        const msg = !has ? '' : !name ? 'Adı yazın' : !parseAzn(r.amount) ? 'Məbləği düzgün yazın, məs. 20 və ya 12,5' : '';
        return (
          <div key={i} className="col" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
              <input className={`inp grow${msg && !name ? ' inp-err' : ''}`} style={{ minWidth: 0 }} aria-label={`Əlavə xərc ${i + 1} adı`} value={r.name} maxLength={80} placeholder="məs. Mikrofon icarəsi" onChange={(e) => set(i, { name: e.target.value })} />
              <input className={`inp${msg && name ? ' inp-err' : ''}`} style={{ width: 96, flex: 'none' }} inputMode="decimal" aria-label={`Əlavə xərc ${i + 1} məbləği (AZN)`} value={r.amount} placeholder="AZN" onChange={(e) => set(i, { amount: e.target.value })} />
              <Button variant="ghost" auto aria-label={`Əlavə xərc ${i + 1} sil`} style={{ flex: 'none', padding: '8px 10px' }} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="close" size={18} /></Button>
            </div>
            {msg && <span className="hint" role="alert" style={{ color: '#fda4af' }}>{msg}</span>}
          </div>
        );
      })}
      {rows.length < MAX && <Button variant="out" small auto onClick={() => onChange([...rows, { name: '', amount: '' }])}><Icon name="plus" size={16} /> Əlavə xərc</Button>}
    </div>
  );
}
