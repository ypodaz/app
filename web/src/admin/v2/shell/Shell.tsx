import { useEffect, type ReactNode } from 'react';
import { formatMoney } from '../../../shared/ui';
import { useAuth } from '../../ctx';
import { useRoute } from '../../router';
import { ShellDataProvider, useShellData } from '../data/ShellData';
import { ToastProvider, V2Icon, useOnline, OfflineBar } from '../ui';
import { MAIN_NAV, SETTINGS_NAV, sectionOf, type NavKey } from './nav';
import './shell.css';
import '../tokens.css';

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];

function Sidebar({ active }: { active: NavKey }) {
  const { queueCount, inboxCount, leadCount, revenue, now } = useShellData();
  const { signOut } = useAuth();
  const badge = (k: NavKey) => {
    // 0 olanda gizlədilir (01 A, D1).
    if (k === 'bu-gun' && queueCount > 0) return <span className="mono snav__n">{queueCount}</span>;
    if (k === 'inbox' && inboxCount > 0) return <span className="mono snav__n">{inboxCount}</span>;
    if (k === 'insanlar' && leadCount) return <span className="mono snav__n snav__n--soft">{leadCount} lead</span>;
    return null;
  };
  return (
    <nav className="sidebar" aria-label="Əsas menyu">
      <div className="sidebar__brand"><span className="sidebar__logo">Y</span><span>Y Pod</span></div>
      {MAIN_NAV.map((n) => (
        <a key={n.key} href={n.href} className="snav" aria-current={active === n.key ? 'page' : undefined}>
          <V2Icon name={n.icon} /><span className="snav__l">{n.label}</span>{badge(n.key)}
        </a>
      ))}
      <span className="sidebar__group">Tənzimləmə</span>
      {SETTINGS_NAV.map((n) => (
        <a key={n.key} href={n.href} className="snav snav--sm" aria-current={active === n.key ? 'page' : undefined}><span className="snav__l">{n.label}</span></a>
      ))}
      <div className="sidebar__foot">
        {revenue !== null && (
          <div className="rev">
            <div className="rev__l">{MONTHS[new Date(now + 4 * 3600_000).getUTCMonth()]} gəliri</div>
            {/* TODO [API] «↑ 12%» (keçən ayın eyni günləri ilə) və son 12 günün gündəlik gəliri: /report yalnız ayın cəmini verir. */}
            <div className="mono rev__v">{formatMoney(revenue).replace(' AZN', '')} <small>AZN</small></div>
          </div>
        )}
        <button type="button" className="snav snav--sm" onClick={signOut}><V2Icon name="out" /><span className="snav__l">Çıxış</span></button>
      </div>
    </nav>
  );
}

function TabBar({ active }: { active: NavKey }) {
  const { inboxCount } = useShellData();
  const tab = (key: Exclude<NavKey, null>, label: string, icon: Parameters<typeof V2Icon>[0]['name'], href: string, badge?: number) => (
    <a key={key} href={href} className="tab" aria-current={active === key ? 'page' : undefined}>
      <V2Icon name={icon} size={22} sw={active === key ? 1.75 : 1.5} />{label}
      {badge ? <span className="mono tab__n">{badge}</span> : null}
    </a>
  );
  return (
    <nav className="tabbar" aria-label="Əsas menyu">
      {tab('bu-gun', 'Bu gün', 'today', '#/bu-gun')}
      {tab('inbox', 'Inbox', 'inbox', '#/inbox', inboxCount)}
      <a href="#/shoots/new" className="tab tab--plus" aria-label="Yeni çəkiliş"><V2Icon name="plus" size={22} sw={2} /></a>
      {tab('cekilisler', 'Çəkiliş', 'cal', '#/cekilisler')}
      {tab('insanlar', 'İnsanlar', 'users', '#/insanlar')}
    </nav>
  );
}

/** Dev: ekranda birdən çox qara əsas düymə olmasın (system.md qayda 4). */
function usePrimaryGuard() {
  const { path } = useRoute();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const t = window.setTimeout(() => {
      const vis = [...document.querySelectorAll<HTMLElement>('.v2 .btn--primary:not(:disabled)')].filter((b) => b.offsetParent !== null);
      if (vis.length > 1) console.warn('[v2] Ekranda %d qara əsas düymə var (qayda: 1):', vis.length, vis.map((b) => b.textContent));
    }, 800);
    return () => window.clearTimeout(t);
  }, [path.join('/')]);
}

function Frame({ active, children }: { active: NavKey; children: ReactNode }) {
  const online = useOnline();
  usePrimaryGuard();
  useEffect(() => {
    document.documentElement.classList.add('v2-html');
    document.body.classList.add('v2-body');
    return () => { document.documentElement.classList.remove('v2-html'); document.body.classList.remove('v2-body'); };
  }, []);
  return (
    <div className="v2">
      <div className="shell">
        <Sidebar active={active} />
        <main className="shell__main">
          {!online && <div className="shell__offline"><OfflineBar /></div>}
          {children}
        </main>
        <TabBar active={active} />
      </div>
    </div>
  );
}

/** Yeni admin qabığı: sol nav (≥768px), mobil alt tab, toast, ortaq məlumat (növbə sayı, Inbox sayı …). */
export function V2Shell({ children }: { children: ReactNode }) {
  const { path } = useRoute();
  return (
    <ToastProvider>
      <ShellDataProvider>
        <Frame active={sectionOf(path)}>{children}</Frame>
      </ShellDataProvider>
    </ToastProvider>
  );
}
