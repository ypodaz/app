import { useState } from 'react';
import { Button, Icon } from '../../shared/ui';
import { useAction, useAuth, useLoad } from '../ctx';
import type { TagRow } from '../types';
import { Err } from './common';

// Teq seçimi: mövcud teqlər çip kimi + yeni teq yaratma. Seçim id siyahısıdır.
export function TagEditor({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { call } = useAuth();
  const { data, err, reload } = useLoad<TagRow[]>('/tags');
  const add = useAction();
  const [name, setName] = useState('');
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  async function create() {
    const n = name.trim();
    if (!n) return;
    const same = (data ?? []).find((t) => t.name.toLowerCase() === n.toLowerCase());
    if (same) { if (!value.includes(same.id)) onChange([...value, same.id]); setName(''); return; }
    const t = await add.run(() => call<TagRow>('/tags', { body: { name: n } }));
    if (t) { onChange([...value, t.id]); setName(''); reload(); }
  }

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="chips">
        {(data ?? []).map((t) => (
          <button key={t.id} type="button" className={`chip${value.includes(t.id) ? ' chip-on' : ''}`} aria-pressed={value.includes(t.id)} onClick={() => toggle(t.id)}>{t.name}</button>
        ))}
        {data && !data.length && <span className="t13 muted">Hələ teq yoxdur.</span>}
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
        <input className="inp grow" aria-label="Yeni teq" placeholder="Yeni teq, məs. Psixoloq" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
        <Button variant="out" auto small disabled={!name.trim() || add.busy} style={{ flex: 'none' }} onClick={create}><Icon name="plus" size={16} /> Əlavə et</Button>
      </div>
      <Err msg={err || add.err} />
    </div>
  );
}
