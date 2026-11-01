import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { api, ApiError } from '../shared/api';
import { ClientShell, NIcon, type ClientTab, type NIconName } from '../shared/ui';

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

// --- ümumi parçalar ---
export const TAB_HREF: Record<ClientTab, string> = { home: '#/', calendar: '#/calendar', ai: '#/ai', materials: '#/materials' };

export function Screen({ tab, children }: { tab: ClientTab; children: ReactNode }) {
  return <ClientShell active={tab} showAi hrefFor={(t) => TAB_HREF[t]}>{children}</ClientShell>;
}

export function OfflineBadge() {
  return <span className="noff"><i aria-hidden="true" />Oflayn · son məlumat</span>;
}

export function Loading() {
  return <div className="col" aria-busy="true" aria-label="Yüklənir">{[96, 140, 96].map((h, i) => <div key={i} className="skel" style={{ height: h, borderRadius: 22 }} />)}</div>;
}

/** Animasiya gecikməsi (.rz sinfi üçün). */
export const dl = (ms: number) => ({ '--dl': `${ms}ms` } as CSSProperties);

// --- Neon loqo (bənövşəyi işarə) və açılış ekranı ---
const NLOGO = 'M753 28 727 16 702 8 677 3 653 1 652 0 587 0 586 1 574 1 573 2 564 2 563 3 532 6 525 8 521 11 518 18 518 325 514 327 484 257 480 244 476 236 469 215 465 207 464 202 417 79 401 33 396 21 388 12 380 9 0 9 3 20 7 28 8 33 34 99 49 141 53 149 68 191 72 199 79 220 91 249 98 270 110 299 117 320 121 328 122 333 137 370 152 412 156 420 171 462 175 470 182 491 194 520 201 541 213 570 220 591 232 620 239 641 251 670 258 691 270 720 277 741 297 791 296 793 76 793 73 794 69 798 67 802 66 818 65 819 62 847 61 848 60 885 61 886 61 897 62 898 62 905 65 921 73 948 85 974 104 1002 130 1028 154 1045 187 1061 201 1066 224 1072 247 1075 248 1076 256 1076 257 1077 308 1077 309 1076 317 1076 318 1075 324 1075 345 1071 382 1060 404 1051 432 1037 464 1017 485 1001 512 977 532 956 561 920 644 796 732 656 762 603 787 553 787 551 802 519 826 453 826 450 833 429 839 402 823 414 793 433 773 444 743 458 725 464 699 469 670 469 669 468 657 467 636 461 618 453 597 440 583 429 563 409 549 391 534 367 524 348 524 346 525 345 526 346 542 347 543 348 550 348 559 350 568 350 569 351 579 351 580 352 627 352 628 351 638 351 639 350 660 348 705 337 752 319 788 299 808 286 832 268 854 246 856 242 855 240 855 224 854 223 854 214 853 213 850 186 839 140 829 113 817 90 796 62 778 45Z';
export function NLogo({ width = 22.3, height = 28 }: { width?: number; height?: number }) {
  return <svg viewBox="0 0 857 1078" width={width} height={height} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}><path fill="#A78BFA" d={NLOGO} /></svg>;
}

/** Açılış ekranı: ikon, ad və sürüşən yüklənmə zolağı. */
export function Splash() {
  return (
    <main className="scr nsplash" aria-busy="true">
      <div className="nsplash-mid">
        <div className="nsplash-ic"><div className="nsplash-glow" aria-hidden="true" /><div className="nsplash-tile" role="img" aria-label="Y Pod"><NLogo width={45.8} height={57.6} /></div></div>
        <div className="nsplash-t">
          <div className="nsplash-n">Y Pod</div>
          <div className="n-meta c3">Podcast və video studiyası</div>
        </div>
      </div>
      <div className="nsplash-bar" role="progressbar" aria-label="Yüklənir"><i /></div>
    </main>
  );
}

export function ErrorState({ q, title = 'Məlumat yüklənmədi' }: { q: Q<unknown>; title?: string }) {
  return (
    <div className="nempty nempty-dash rise" role="alert">
      <span className="nchip nempty-ic"><NIcon name={q.offline ? 'belloff' : 'alert'} size={20} /></span>
      <h2 className="n-h2">{q.offline ? 'İnternet yoxdur' : title}</h2>
      <p className="nempty-t">{q.err || 'İnternet bağlantısını yoxlayın.'}</p>
      <button type="button" className="nb nb-s nb-auto nempty-b" onClick={q.reload}>Yenidən cəhd et</button>
    </div>
  );
}

/** Boş vəziyyət: ikon çipi + başlıq + mətn + (WhatsApp) düymələr. fill: ekranın ortasında. */
export function NEmpty({ icon, tone, title, text, fill, children }: { icon: NIconName; tone: string; title: string; text: string; fill?: boolean; children?: ReactNode }) {
  return (
    <section aria-label={title} className={`nempty rise${fill ? ' nempty-fill' : ' nempty-dash'}`} style={fill ? { '--i': 1 } as CSSProperties : undefined}>
      <span className={`nchip nempty-ic nchip-${tone}`}><NIcon name={icon} size={20} /></span>
      <h2 className="n-h2">{title}</h2>
      <p className="nempty-t">{text}</p>
      {children && <div className="nempty-btns">{children}</div>}
    </section>
  );
}

/** Neon daxili səhifə başlığı: geri düyməsi + ad; sürüşəndə blur fon və 1px xətt. */
export function InnerHeader({ title, back = '#/calendar' }: { title: string; back?: string }) {
  const [sc, setSc] = useState(false);
  useEffect(() => {
    const on = () => setSc(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`nhead${sc ? ' nhead-sc' : ''}`}>
      <a className="nhead-back" href={back} aria-label="Geri"><NIcon name="back" /></a>
      <h1 className="n-h2">{title}</h1>
    </header>
  );
}
