import type { ReactNode } from 'react';
import { NIcon, type NIconName } from './NIcon';

export type ClientTab = 'home' | 'calendar' | 'ai' | 'materials';

const ITEMS: { key: ClientTab; label: string; icon: NIconName }[] = [
  { key: 'home', label: 'Ana', icon: 'home' },
  { key: 'calendar', label: 'Təqvim', icon: 'cal' },
  { key: 'ai', label: 'Köməkçi', icon: 'spark' },
  { key: 'materials', label: 'Materiallar', icon: 'folder' },
];

type Props = {
  active: ClientTab;
  /** MVP-də AI tabı gizlidir. */
  showAi?: boolean;
  hrefFor?: (tab: ClientTab) => string;
  children: ReactNode;
};

/** Neon: aşağıda üzən qara şüşə kapsul; aktiv tab bənövşəyi ikon + 4px nöqtə. */
export function ClientShell({ active, showAi = false, hrefFor = (t) => `#${t}`, children }: Props) {
  const items = ITEMS.filter((i) => showAi || i.key !== 'ai');
  return (
    <div className="scr rs-client">
      <div className="pg rs-page">{children}</div>
      <nav className="ntab" aria-label="Əsas menyu" style={{ gridTemplateColumns: `repeat(${items.length},minmax(0,1fr))` }}>
        {items.map((it) => (
          <a key={it.key} href={hrefFor(it.key)} className={it.key === active ? 'on' : undefined} aria-current={it.key === active ? 'page' : undefined}>
            <NIcon name={it.icon} />
            <span>{it.label}</span>
            <i aria-hidden="true" />
          </a>
        ))}
      </nav>
    </div>
  );
}
