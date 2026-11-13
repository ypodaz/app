import type { ReactNode } from 'react';

/** Ağ bölmə: radius 20 (mobil 16), kölgəsiz. Kart içində kart qoyma. */
export function Card({ title, aside, flush, small, label, children }: { title?: ReactNode; aside?: ReactNode; flush?: boolean; small?: boolean; label?: string; children: ReactNode }) {
  return (
    <section className={`card${flush ? ' card--flush' : ''}${small ? ' card--sm' : ''}`} aria-label={label}>
      {(title || aside) && <div className="card__head" style={flush ? { padding: '0 12px' } : undefined}>{title && <h2 className="card__title">{title}</h2>}{aside}</div>}
      {children}
    </section>
  );
}

export type AvatarTone = 'neutral' | 'brand' | 'deposit' | 'cancel' | 'edit';
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase('az')).join('');

export function Avatar({ name, tone = 'neutral', large }: { name: string; tone?: AvatarTone; large?: boolean }) {
  return <span className={`av${large ? ' av--lg' : ''}${tone !== 'neutral' ? ` av--${tone}` : ''}`} aria-hidden="true">{initialsOf(name)}</span>;
}

type RowProps = {
  /** Sıra nömrəsi (növbə). */
  n?: number;
  avatar?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  metaTone?: 'warn' | 'danger';
  /** Sağdakı vaxt (.mono). */
  time?: string;
  /** Sətir düymələri (30px). Düyməsi olan sətir bütövlükdə klik olunmur. */
  actions?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  leaving?: boolean;
  /** Ətraflı: aria-label seçilmə üçün. */
  rowRef?: (el: HTMLElement | null) => void;
};

/** Siyahı sətri: min 52px, avatar 32, ad 14/600, meta 12 --text-2, sağda vaxt .mono 12. */
export function ListRow({ n, avatar, title, meta, metaTone, time, actions, selected, onSelect, leaving, rowRef }: RowProps) {
  const body = (
    <>
      {n !== undefined && <span className="row__n mono">{n}</span>}
      {avatar}
      <span className="row__main" style={{ display: 'block' }}>
        <span className="row__title" style={{ display: 'block' }}>{title}</span>
        {meta && <span className={`row__meta${metaTone ? ` row__meta--${metaTone}` : ''}`} style={{ display: 'block' }}>{meta}</span>}
      </span>
      {time && <span className="row__time mono">{time}</span>}
    </>
  );
  const cls = `row${selected ? ' row--select' : ''}${leaving ? ' row--leaving' : ''}`;
  // Seçilə bilən sətir: bütün sətir düymədir; əməl düymələri yanında ayrıca qalır (düymə içində düymə olmasın).
  return (
    <div className={cls} ref={rowRef} data-selected={selected ? 'true' : undefined}>
      {onSelect
        ? <button type="button" className="row__hit" aria-pressed={!!selected} onClick={onSelect}>{body}</button>
        : <div className="row__hit">{body}</div>}
      {actions && <div className="row__acts">{actions}</div>}
    </div>
  );
}
