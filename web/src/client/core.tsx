import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../shared/api';
import { Button, ClientShell, Icon, type ClientTab } from '../shared/ui';
import { BOOK_TEXT, PHONE_HREF, waLink } from './util';

export const TOKEN_KEY = 'ypod.token';
export const HOME_CACHE = 'ypod.home';

// --- sessiya konteksti ---
type Auth = { token: string; signOut: () => void };
export const AuthCtx = createContext<Auth>({ token: '', signOut: () => {} });

// --- hash router ---
export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => { setR(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

// --- sorğu hook-u: 401 → çıxış, şəbəkə xətası → offline ---
export type Q<T> = { data: T | null; err: string; offline: boolean; loading: boolean; reload: () => void };

export function useApi<T>(path: string | null, cacheKey?: string): Q<T> {
  const { token, signOut } = useContext(AuthCtx);
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let live = true;
    setLoading(true); setErr('');
    api<T>(path, { token })
      .then((d) => {
        if (!live) return;
        setData(d); setOffline(false);
        if (cacheKey) try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch { /* keş yazılmadı */ }
      })
      .catch((e: ApiError) => {
        if (!live) return;
        if (e.status === 401) return signOut();
        if (e.status === 0 && cacheKey) {
          try { const c = localStorage.getItem(cacheKey); if (c) { setData(JSON.parse(c) as T); setOffline(true); return; } } catch { /* keş oxunmadı */ }
        }
        setErr(e.status === 0 ? '' : e.message);
        setOffline(e.status === 0);
      })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [path, token, n]);

  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, err, offline, loading, reload };
}

// --- kiçik ikonlar (ortaq dəstdə yoxdur; dizayndan) ---
const X = {
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8zM10 20a2 2 0 0 0 4 0',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  wa: 'M4 20l1.3-3.9A8 8 0 1 1 8 19z',
  nav: 'M3 11l18-8-8 18-2-8z',
  out: 'M7 17 17 7M8 7h9v9',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  back: 'M15 6l-6 6 6 6',
  tag: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  pct: 'M19 5 5 19M7.5 8.5a1.5 1.5 0 1 0 0-.01zM16.5 17.5a1.5 1.5 0 1 0 0-.01z',
  dl: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01',
  mic: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
} as const;
export type XName = keyof typeof X;
export function XIcon({ name, size = 20, sw }: { name: XName; size?: number; sw?: number }) {
  return <svg className="i" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw ? { strokeWidth: sw } : undefined}><path d={X[name]} /></svg>;
}

// --- ümumi parçalar ---
export const TAB_HREF: Record<ClientTab, string> = { home: '#/', calendar: '#/calendar', ai: '#/', materials: '#/materials' };

export function Screen({ tab, children }: { tab: ClientTab; children: ReactNode }) {
  return <ClientShell active={tab} hrefFor={(t) => TAB_HREF[t]}>{children}</ClientShell>;
}

export function TopBar({ title, back = '#/' }: { title: string; back?: string }) {
  return (
    <div className="top">
      <a className="iconbtn" href={back} aria-label="Geri"><XIcon name="back" size={22} /></a>
      <span className="t15 w8">{title}</span>
      <span style={{ width: 46 }} />
    </div>
  );
}

export function OfflineBadge() {
  return <span className="offline"><XIcon name="wifi" size={14} sw={2.2} />oflayn · son məlumatlar</span>;
}

export function Loading() {
  return <div className="col" aria-busy="true" aria-label="Yüklənir">{[96, 140, 96].map((h, i) => <div key={i} className="sk" style={{ height: h, borderRadius: 24 }} />)}</div>;
}

export function ErrorState({ q, title = 'Məlumat yüklənmədi' }: { q: Q<unknown>; title?: string }) {
  return (
    <div className="card card-dash ctr" style={{ padding: 28 }}>
      <span className="ic ic-l"><XIcon name={q.offline ? 'wifi' : 'out'} size={26} /></span>
      <h3 className="h3">{q.offline ? 'İnternet yoxdur' : title}</h3>
      <p className="t13 muted lh">{q.err || 'İnternet bağlantısını yoxlayın və yenidən cəhd edin.'}</p>
      <Button variant="out" small auto onClick={q.reload}>Yenidən cəhd et</Button>
    </div>
  );
}

/** Əməliyyat müştəridə yoxdur: yalnız WhatsApp və zəng. */
export function BookButtons({ text = BOOK_TEXT, label = 'Çəkilişə yazılın' }: { text?: string; label?: string }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <a className="btn btn-primary" href={waLink(text)} target="_blank" rel="noopener">
        <span className="pl"><Icon name="plus" size={18} strokeWidth={2.6} /></span>{label} · WhatsApp-da yazın
      </a>
      <a className="btn btn-out" href={PHONE_HREF}><XIcon name="phone" size={18} />Zəng edin</a>
    </div>
  );
}
