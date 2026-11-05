import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// <1024px: alt vərəq; ≥1024px: mərkəzdə modal (responsive.css).
// Fokus açılanda vərəqə keçir, Tab vərəqin içində dövr edir, Esc bağlayır, bağlananda fokus əvvəlki elementə qayıdır.
// İstifadəçi sahəyə nəsə yazıbsa, fona toxunmaq bağlamır (yazı itməsin); «Bağla» və Esc hər halda bağlayır.
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirty = useRef(false);
  useEffect(() => {
    if (!open) return;
    dirty.current = false;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      if (prevFocus?.isConnected) prevFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  function trap(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) { e.preventDefault(); ref.current.focus(); return; }
    const first = items[0], last = items[items.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
  return (
    <div className="rs-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !dirty.current) onClose(); }}>
      <div className="rs-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onKeyDown={trap}
        onInput={(e) => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) dirty.current = true; }}>
        <div className="rs-grab" aria-hidden="true" />
        <div className="row sb">
          <h2 className="h2">{title}</h2>
          <button type="button" className="iconbtn" aria-label="Bağla" onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
