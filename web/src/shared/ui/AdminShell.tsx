import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';

export type AdminTab = 'panel' | 'calendar' | 'clients' | 'packages' | 'materials' | 'campaigns' | 'report';

const ITEMS: { key: AdminTab; label: string; icon: IconName; mobile: boolean }[] = [
  { key: 'panel', label: 'Panel', icon: 'grid', mobile: true },
  { key: 'calendar', label: 'Təqvim', icon: 'calendar', mobile: true },
  { key: 'clients', label: 'Müştərilər', icon: 'users', mobile: true },
  { key: 'packages', label: 'Paketlər', icon: 'building', mobile: true },
  { key: 'materials', label: 'Materiallar', icon: 'media', mobile: false },
  { key: 'campaigns', label: 'Kampaniyalar', icon: 'send', mobile: false },
  { key: 'report', label: 'Hesabat', icon: 'chart', mobile: true },
];

type Props = {
  active: AdminTab;
  title: string;
  /** Başlıq sırasındakı düymələr (məs. "Çəkiliş əlavə et"). */
  actions?: ReactNode;
  /** ≥1024px-də sağ detal paneli; daha dar ekranda məzmunun altında. */
  detail?: ReactNode;
  hrefFor?: (tab: AdminTab) => string;
  qrHref?: string;
  children: ReactNode;
};

export function AdminShell({ active, title, actions, detail, hrefFor = (t) => `#${t}`, qrHref = '#qr', children }: Props) {
  return (
    <div className="scr rs-shell">
      <aside className="side" aria-label="Əsas menyu">
        <div className="rs-logo"><Logo height={40} /></div>
        {ITEMS.map((it) => (
          <a key={it.key} href={hrefFor(it.key)} className={it.key === active ? 'on' : undefined} aria-current={it.key === active ? 'page' : undefined} aria-label={it.label} title={it.label}>
            <Icon name={it.icon} />
            <span className="rs-lbl">{it.label}</span>
          </a>
        ))}
        <a className="btn btn-cream rs-qr" href={qrHref} aria-label="QR oxut" title="QR oxut">
          <Icon name="qr" />
          <span className="rs-lbl">QR oxut</span>
        </a>
      </aside>
      <div className="rs-body">
        <main className="main rs-main">
          <div className="rs-inner">
            <div className="top rs-head">
              <h1 className="h2 rs-title">{title}</h1>
              <div className="row rs-actions">
                <a className="btn btn-cream btn-sm btn-auto rs-qr-m" href={qrHref} aria-label="QR oxut"><Icon name="qr" size={18} /><span className="rs-txt"> QR oxut</span></a>
                {actions}
              </div>
            </div>
            {children}
          </div>
        </main>
        {detail && <aside className="rs-detail" aria-label="Detal">{detail}</aside>}
      </div>
      <nav className="nav rs-nav" aria-label="Admin naviqasiyası">
        {ITEMS.filter((i) => i.mobile).map((it) => (
          <a key={it.key} href={hrefFor(it.key)} className={it.key === active ? 'on' : undefined} aria-current={it.key === active ? 'page' : undefined}>
            <span><Icon name={it.icon} size={22} /></span>
            {it.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
