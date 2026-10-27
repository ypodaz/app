import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ClientTab = 'home' | 'calendar' | 'ai' | 'materials';

const ITEMS: { key: ClientTab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Ana səhifə', icon: 'home' },
  { key: 'calendar', label: 'Təqvim', icon: 'calendar' },
  { key: 'ai', label: 'AI dəstəkçi', icon: 'sparkle' },
  { key: 'materials', label: 'Materiallar', icon: 'media' },
];

type Props = {
  active: ClientTab;
  /** MVP-də AI tabı gizlidir. */
  showAi?: boolean;
  hrefFor?: (tab: ClientTab) => string;
  children: ReactNode;
};

export function ClientShell({ active, showAi = false, hrefFor = (t) => `#${t}`, children }: Props) {
  return (
    <div className="scr rs-client">
      <div className="pg rs-page">{children}</div>
      <nav className="nav rs-nav" aria-label="Əsas naviqasiya">
        {ITEMS.filter((i) => showAi || i.key !== 'ai').map((it) => (
          <a key={it.key} href={hrefFor(it.key)} className={it.key === active ? 'on' : undefined} aria-current={it.key === active ? 'page' : undefined}>
            <span><Icon name={it.icon} size={22} /></span>
            {it.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
