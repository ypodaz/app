import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** Düymələr (sağda; mobildə tam enli). Dağıdıcı əməl: <Button variant="danger">. */
  footer?: ReactNode;
  children?: ReactNode;
};

/** Kompüterdə mərkəzdə dialoq (radius 20, --shadow-dialog, arxa --scrim), telefonda (<768px) alt vərəq: tutacaq,
 *  yuxarı radius 20, alt boşluq 28px, alt menyunu örtür. Esc və arxa fonda klik bağlayır. */
export function Dialog({ open, onClose, title, subtitle, footer, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = prevOverflow; prevFocus?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-v2-dialog>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div className="dialog__grab" aria-hidden="true" />
        <div><h2 className="dialog__title">{title}</h2>{subtitle && <div className="dialog__sub">{subtitle}</div>}</div>
        {children}
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

/** «Nə dəyişir / nə dəyişmir» bloku (dağıdıcı dialoqlarda məcburi, 00 §8). */
export function ChangeNote({ changes, unchanged }: { changes?: string[]; unchanged?: string[] }) {
  return (
    <div className="note">
      {changes && changes.length > 0 && <div className="note--changes"><b>Nə dəyişir</b><ul>{changes.map((c) => <li key={c}>{c}</li>)}</ul></div>}
      {unchanged && unchanged.length > 0 && <div><b>Nə dəyişmir</b><ul>{unchanged.map((c) => <li key={c}>{c}</li>)}</ul></div>}
    </div>
  );
}
