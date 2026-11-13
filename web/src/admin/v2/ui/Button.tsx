import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type BtnVariant = 'primary' | 'secondary' | 'text' | 'danger';
export type BtnSize = 'lg' | 'md' | 'sm' | 'row';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** primary = qara; ekranda yalnız BİR dənə (dev rejimində shell xəbərdarlıq verir). danger heç vaxt qara deyil. */
  variant?: BtnVariant;
  /** lg 40 (başlıq), md 36 (panel), sm 32, row 30 (sətir). Mobildə CSS özü 44px edir. */
  size?: BtnSize;
  icon?: ReactNode;
  /** Klaviş ipucu (yalnız kompüterdə görünür), məs. "↵". */
  kbd?: string;
  block?: boolean;
  className?: string;
};

export function Button({ variant = 'secondary', size = 'md', icon, kbd, block, className = '', type = 'button', children, ...rest }: Props) {
  return (
    <button type={type} className={`btn btn--${variant} btn--${size}${block ? ' btn--block' : ''}${className ? ' ' + className : ''}`} {...rest}>
      {icon}{children}{kbd && <kbd className="mono">{kbd}</kbd>}
    </button>
  );
}

/** Düymə görünüşlü keçid (hash route). */
export function LinkButton({ href, variant = 'secondary', size = 'md', icon, children, className = '' }: { href: string; variant?: BtnVariant; size?: BtnSize; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <a href={href} className={`btn btn--${variant} btn--${size}${className ? ' ' + className : ''}`}>{icon}{children}</a>;
}
