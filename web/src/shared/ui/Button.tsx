import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'cream' | 'dark' | 'out' | 'danger' | 'ghost';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  small?: boolean;
  auto?: boolean;
  children: ReactNode;
};

export function Button({ variant = 'primary', small, auto, className = '', type = 'button', children, ...rest }: Props) {
  const cls = ['btn', `btn-${variant}`, small && 'btn-sm', auto && 'btn-auto', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest}>{children}</button>;
}
