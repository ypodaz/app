import { useEffect, useRef, useState } from 'react';
import { useAction, useAuth, useLoad } from '../ctx';
import type { TagRow } from '../types';
import { AIcon } from './AIcon';
import { ConfirmDialog } from './neon';
import { Err } from './common';

// Teq seçimi: mövcud teqlər çip kimi (⋯ menyusu: adını dəyiş / sil) + yeni teq yaratma. Seçim id siyahısıdır.
export function TagEditor({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { call } = useAuth();
  const { data, err, reload } = useLoad<TagRow[]>('/tags');
  const add = useAction();
  const mut = useAction();
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<number | null>(null);
  const [ren, setRen] = useState<{ id: number; name: string } | null>(null);
  const [del, setDel] = useState<TagRow | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  useEffect(() => {
    if (menu === null) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [menu]);

  async function create() {
    const n = name.trim();
    if (!n) return;
    const same = (data ?? []).find((t) => t.name.toLowerCase() === n.toLowerCase());
    if (same) { if (!value.includes(same.id)) onChange([...value, same.id]); setName(''); return; }
    const t = await add.run(() => call<TagRow>('/tags', { body: { name: n } }));
    if (t) { onChange([...value, t.id]); setName(''); reload(); }
  }

  async function rename() {
    if (!ren) return;
    const n = ren.name.trim();
    const cur = (data ?? []).find((t) => t.id === ren.id);
    if (!n || n === cur?.name) { setRen(null); return; }
    if (await mut.run(() => call(`/tags/${ren.id}`, { method: 'PATCH', body: { name: n } })) !== undefined) { setRen(null); reload(); }
  }

  async function remove() {
    const t = del;
    setDel(null);
    if (!t) return;
    if (await mut.run(() => call(`/tags/${t.id}`, { method: 'DELETE' })) !== undefined) { onChange(value.filter((x) => x !== t.id)); reload(); }
  }

  return (
    <div className="a3-te" ref={wrap}>
      <div className="a3-tchips">
        {(data ?? []).map((t) => {
          const on = value.includes(t.id);
          if (ren?.id === t.id) {
            return (
              <input key={t.id} className="inp a3-tren" aria-label="Teqin yeni adı" autoFocus maxLength={40} value={ren.name}
                onChange={(e) => setRen({ id: t.id, name: e.target.value })} onBlur={rename}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } if (e.key === 'Escape') setRen(null); }} />
            );
          }
          return (
            <span key={t.id} className={`a3-tc${on ? ' on' : ''}`}>
              <button type="button" className="a3-tcb" aria-pressed={on} onClick={() => toggle(t.id)}>{t.name}</button>
              <button type="button" className="a3-tcm" aria-label={`${t.name} — əməliyyatlar`} aria-haspopup="menu" aria-expanded={menu === t.id} onClick={() => setMenu(menu === t.id ? null : t.id)}><AIcon name="more" size={16} /></button>
              {menu === t.id && (
                <div className="a3-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); setRen({ id: t.id, name: t.name }); }}><AIcon name="pencil" size={16} /> Adını dəyiş</button>
                  <button type="button" role="menuitem" className="dng" onClick={() => { setMenu(null); setDel(t); }}><AIcon name="trash" size={16} /> Sil</button>
                </div>
              )}
            </span>
          );
        })}
        {data && !data.length && <span className="a-note" style={{ margin: 0 }}>Hələ teq yoxdur.</span>}
      </div>
      <div className="a3-trow">
        <input className="inp" aria-label="Yeni teq" placeholder="Yeni teq, məs. Psixoloq" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
        <button type="button" className="a-bt" disabled={!name.trim() || add.busy} onClick={create}><AIcon name="plus" size={16} /> Əlavə et</button>
      </div>
      <Err msg={err || add.err || mut.err} />
      <ConfirmDialog open={!!del} confirmLabel="Sil" text={<>«{del?.name}» teqi silinsin? Müştərilərdən də götürüləcək.</>} onCancel={() => setDel(null)} onConfirm={remove} />
    </div>
  );
}
