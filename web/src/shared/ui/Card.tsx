import type { ReactNode } from 'react';

export type CardTone = 'default' | 'cream' | 'violet' | 'accent' | 'dash';

const TONE: Record<CardTone, string> = {
  default: '',
  cream: ' card-cream',
  violet: ' card-violet',
  accent: ' card-accent',
  dash: ' card-dash',
};

export function Card({ tone = 'default', flat, className = '', children }: { tone?: CardTone; flat?: boolean; className?: string; children: ReactNode }) {
  return <div className={`card${TONE[tone]}${flat ? ' card-flat' : ''}${className ? ' ' + className : ''}`}>{children}</div>;
}
