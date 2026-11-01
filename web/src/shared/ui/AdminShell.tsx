import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AIcon, type AIconName } from '../../admin/components/AIcon';
import { useAuth } from '../../admin/ctx';

export type AdminTab = 'panel' | 'calendar' | 'clients' | 'packages' | 'materials' | 'campaigns' | 'report';

// Neon: kompüterdə yan panel, planşetdə ikon relsi, telefonda 4 bənd + «Daha çox» vərəqi.
const ITEMS: { key: AdminTab; label: string; icon: AIconName; bar: boolean }[] = [
  { key: 'panel', label: 'Panel', icon: 'dash', bar: true },
  { key: 'calendar', label: 'Təqvim', icon: 'cal', bar: true },
  { key: 'clients', label: 'Müştərilər', icon: 'users', bar: true },
  { key: 'packages', label: 'Paketlər', icon: 'pkg', bar: false },
  { key: 'materials', label: 'Materiallar', icon: 'folder', bar: false },
  { key: 'campaigns', label: 'Kampaniyalar', icon: 'mega', bar: true },
  { key: 'report', label: 'Hesabat', icon: 'chart', bar: false },
];
const MORE = ITEMS.filter((i) => !i.bar);

type Props = {
  active: AdminTab;
  title: string;
  /** Başlığın altındakı kiçik mətn (məs. «Panel»). */
  sub?: string;
  /** Başlıq sırasındakı düymələr (məs. "Çəkiliş əlavə et"). */
  actions?: ReactNode;
  /** ≥640px-də sağ detal paneli (≥1024 sütun, daha dar ekranda üstə çıxan panel). */
  detail?: ReactNode;
  /** Detal panelini bağlayan keçid (#/…). */
  detailClose?: string;
  hrefFor?: (tab: AdminTab) => string;
  /** true: başlıq sırası göstərilmir (skelet vəziyyəti). */
  bare?: boolean;
  /** true: tam ekran forma/detal səhifəsi — telefonda alt naviqasiya gizlənir. */
  full?: boolean;
  children: ReactNode;
};

export function AdminShell({ active, title, sub, actions, detail, detailClose, hrefFor = (t) => `#${t}`, bare, full, children }: Props) {
  const { signOut } = useAuth();
  const [more, setMore] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [more]);
  const moreOn = MORE.some((i) => i.key === active);

  return (
    <div className={`adm a-shell${full ? ' a-full' : ''}`}>
      <aside className="a-side" aria-label="Əsas menyu">
        <div className="a-brand"><i aria-hidden="true" /><span>Y Pod · Admin</span></div>
        <nav aria-label="Admin menyu">
          {ITEMS.map((it) => (
            <a key={it.key} href={hrefFor(it.key)} className={`a-nav${it.key === active ? ' on' : ''}`} aria-current={it.key === active ? 'page' : undefined} aria-label={it.label} title={it.label}>
              <AIcon name={it.icon} size={20} /><span>{it.label}</span>
            </a>
          ))}
        </nav>
        <button type="button" className="a-nav a-out" aria-label="Çıxış" title="Çıxış" onClick={signOut}><AIcon name="out" size={20} /><span>Çıxış</span></button>
      </aside>
      <div className="a-body">
        <main className="a-main">
          <div className="a-inner">
            {!bare && (
              <header className="a-head">
                <div className="a-head-t">
                  <h1 className="a-h1">{title}</h1>
                  {sub && <div className="a-sub">{sub}</div>}
                </div>
                {actions && <div className="a-acts">{actions}</div>}
              </header>
            )}
            {children}
          </div>
        </main>
        {detail && (
          <>
            {detailClose && <a className="a-scrim" href={detailClose} aria-label="Paneli bağla" tabIndex={-1} />}
            <aside className="a-detail" aria-label="Çəkiliş detalı">
              <div className="a-dh">
                <h2>Çəkiliş</h2>
                {detailClose && <a className="a-bg a-bg-i" href={detailClose} aria-label="Paneli bağla"><AIcon name="x" size={18} /></a>}
              </div>
              {detail}
            </aside>
          </>
        )}
      </div>
      <nav className="a-tabbar" aria-label="Admin naviqasiyası">
        {ITEMS.filter((i) => i.bar).map((it) => (
          <a key={it.key} href={hrefFor(it.key)} className={`a-tab${it.key === active ? ' on' : ''}`} aria-current={it.key === active ? 'page' : undefined}>
            <AIcon name={it.icon} size={20} /><span>{it.label}</span><i aria-hidden="true" />
          </a>
        ))}
        <button type="button" className={`a-tab${moreOn || more ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <AIcon name="more" size={20} /><span>Daha çox</span><i aria-hidden="true" />
        </button>
      </nav>
      {more && (
        <>
          <div className="a-more-bg" onClick={() => setMore(false)} />
          <div className="a-more" role="dialog" aria-modal="true" aria-label="Daha çox" tabIndex={-1} ref={sheet}>
            <div className="a-grab" aria-hidden="true" />
            <h2>Daha çox</h2>
            <nav aria-label="Daha çox">
              {MORE.map((it) => (
                <a key={it.key} className="a-mr" href={hrefFor(it.key)} onClick={() => setMore(false)}>
                  <span className="a-ic"><AIcon name={it.icon} size={16} /></span><span>{it.label}</span><AIcon name="chev" size={20} />
                </a>
              ))}
              <div className="a-sep" role="separator" />
              <button type="button" className="a-mr" onClick={() => { setMore(false); signOut(); }}>
                <span className="a-ic"><AIcon name="out" size={16} /></span><span>Çıxış</span>
              </button>
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
