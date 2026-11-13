import { useEffect, useRef } from 'react';
import type { ConvMode } from '../../../components/crm';
import { useMedia } from '../../../router';
import { Dialog } from '../../ui';
import { IbIcon } from './icons';
import { MODE_META, MODE_ORDER } from './logic';

type Props = {
  current: ConvMode;
  /** Dost: yalnız «Bot susur» seçilə bilər (99 M13). */
  friend: boolean;
  /** Menyudakı rejimlər (Instagram DM-də «Bot susur» yoxdur). */
  modes?: ConvMode[];
  disabled?: boolean;
  onPick: (m: ConvMode) => void;
};

// 4 rejimin hamısı əl ilə seçilir (03 T8): POST /inbox/{id}/mode və /social-inbox/dm/{thread}/mode. Müştəriyə mesaj getmir.
function Items({ current, friend, modes = MODE_ORDER, onPick, close }: Props & { close: () => void }) {
  return (
    <div role="menu" aria-label="Söhbət rejimi" className="ibm__list">
      {modes.map((m) => {
        const off = friend && m !== 'human';
        const hint = off ? 'Dostdur · əvvəl «Bot yazsın»' : MODE_META[m].hint;
        return (
          <button key={m} type="button" role="menuitemradio" aria-checked={m === current} disabled={off && m !== current} className="ibm__item"
            onClick={() => { close(); if (m !== current) onPick(m); }}>
            <span className="ibm__t">{MODE_META[m].label}</span>
            <span className="ibm__h">{hint}</span>
            {m === current && <span className="ibm__ok" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>}
          </button>
        );
      })}
    </div>
  );
}

/** Rejim çipi + menyu (03 E1–E2): kompüterdə popover, telefonda alt vərəq. */
export function ModeChip({ open, setOpen, ...p }: Props & { open: boolean; setOpen: (v: boolean) => void }) {
  const mobile = useMedia('(max-width: 767px)');
  const wrap = useRef<HTMLDivElement>(null);
  const meta = MODE_META[p.current];
  useEffect(() => {
    if (!open || mobile) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, mobile, setOpen]);
  return (
    <div className="ibm" ref={wrap}>
      <button type="button" className={`ibm__chip ibm__chip--${p.current}`} aria-haspopup="menu" aria-expanded={open} disabled={p.disabled}
        aria-label={`Söhbət rejimi: ${meta.label}. Dəyiş`} onClick={() => setOpen(!open)}>
        <span>{meta.label}</span><IbIcon name="chevDown" size={14} />
      </button>
      {open && !mobile && <div className="ibm__pop"><Items {...p} close={() => setOpen(false)} /></div>}
      {mobile && <Dialog open={open} onClose={() => setOpen(false)} title="Söhbət rejimi"><Items {...p} close={() => setOpen(false)} /></Dialog>}
    </div>
  );
}
