import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../shared/api';
import { NIcon } from '../shared/ui';
import { AuthPage, Brand } from './auth';
import { dl, NLogo } from './core';
import { env } from './util';

// ---------- brauzerin real ikonları (NIcon-da olmayanlar) ----------
const svg = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
/** Chrome (Android) üç nöqtə ⋮. */
const DotsVIcon = () => svg(20, <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>);
/** Samsung Internet menyusu ☰. */
const MenuIcon = () => svg(20, <path d="M4 7h16M4 12h16M4 17h16" />);
const ShareIcon = () => <NIcon name="share" />;
const AddHomeIcon = () => <NIcon name="sqplus" />;

// ---------- Android: beforeinstallprompt ----------
type BipEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: BipEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BipEvent; notify(); });
window.addEventListener('appinstalled', () => { installed = true; deferred = null; notify(); });

function useInstallPrompt() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  async function prompt() {
    const e = deferred;
    if (!e) return;
    await e.prompt();
    const c = await e.userChoice.catch(() => null);
    deferred = null;
    if (c?.outcome === 'accepted') installed = true;
    notify();
  }
  return { can: !!deferred, installed, prompt };
}

// ---------- ümumi hissələr ----------
type Step = { t: ReactNode; sub?: string; ic?: ReactNode; app?: boolean; pill?: string };

function StepList({ steps, base }: { steps: Step[]; base: number }) {
  return (
    <ol className="nins-ol">
      {steps.map((s, i) => (
        <li key={i} className="g nau-li rz" style={dl(base + i * 80)}>
          <span className="nins-n" aria-hidden="true">{i + 1}</span>
          <span className="nins-t"><span>{s.t}</span>{s.sub && <span className="nins-sub">{s.sub}</span>}</span>
          {s.pill && <span className="nins-pill" aria-hidden="true">{s.pill}</span>}
          {s.ic && <span className="nins-ic" aria-hidden="true">{s.ic}</span>}
          {s.app && <span className="nins-ic app" aria-hidden="true"><NLogo width={19.1} height={24} /></span>}
        </li>
      ))}
    </ol>
  );
}

/** Ana səhifənin ünvanı (dəvət tokeni olmadan). */
const appUrl = () => `${location.origin}${location.pathname}`;

function CopyButton({ url, label = 'Linki kopyala' }: { url: string; label?: string }) {
  const [ok, setOk] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    try { await navigator.clipboard.writeText(url); }
    catch {
      const t = document.createElement('textarea');
      t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* kopyalanmadı */ }
      t.remove();
    }
    setOk(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOk(false), 2000);
  }
  return (
    <button type="button" className="nb nb-s nau-sec nins-cpy" onClick={copy}>
      {ok
        ? <span className="ok" role="status"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" pathLength={1} /></svg>Kopyalandı</span>
        : <span><NIcon name="copy" size={18} />{label}</span>}
    </button>
  );
}

function PairCard({ token, pair, setPair, delay }: { token: string; pair: string | null; setPair: (c: string) => void; delay: number }) {
  const [err, setErr] = useState('');
  const asked = useRef(false);
  async function fresh() {
    setErr('');
    try { setPair((await api<{ pair_code: string }>('/me/pair-code', { token, body: {} })).pair_code); }
    catch (e) { setErr((e as ApiError).message); }
  }
  useEffect(() => { if (!pair && !asked.current) { asked.current = true; fresh(); } }, []);
  return (
    <section className="g nins-pair rz" aria-label="Giriş kodu" style={dl(delay)}>
      <div>Ana ekrandakı app kod istəsə, bu kodu yazın</div>
      {pair
        ? <div className="nins-code" aria-label={`Giriş kodu ${pair}`}><span>{pair.length === 6 ? `${pair.slice(0, 3)} ${pair.slice(3)}` : pair}</span></div>
        : <div className="nins-code w"><span>······</span></div>}
      <div className="nins-foot">
        <span className="n-meta">15 dəqiqə etibarlıdır</span>
        <button type="button" className="nins-new" onClick={fresh}>Yeni kod</button>
      </div>
      {err && <p className="nau-err" role="alert" style={{ marginTop: 4 }}>{err}</p>}
    </section>
  );
}

const OPEN_STEP: Step = { t: <>Ana ekranda <b>Y Pod</b> ikonundan açın</>, app: true };

function stepsFor(): { steps: Step[]; note?: ReactNode; copy?: boolean } {
  switch (env) {
    case 'ios-safari':
      return { steps: [
        { t: <>Aşağıdakı <b>Paylaş</b> düyməsinə basın</>, sub: 'Görünmürsə: «…» menyusu → Paylaş', ic: <ShareIcon /> },
        { t: <>Siyahını aşağı sürüşdürüb <b>«Ana ekrana əlavə et»</b> seçin</>, ic: <AddHomeIcon /> },
        { t: <>Sağ yuxarıda <b>«Əlavə et»</b></>, pill: 'Əlavə et' },
        OPEN_STEP,
      ] };
    case 'ios-chrome':
      return { copy: true, steps: [
        { t: <>Ünvan sətrinin yanındakı <b>Paylaş</b> ikonuna basın</>, sub: 'iOS 16.4 və yuxarı', ic: <ShareIcon /> },
        { t: <><b>«Ana ekrana əlavə et»</b> seçin</>, ic: <AddHomeIcon /> },
        { t: <>Sağ yuxarıda <b>«Əlavə et»</b></>, pill: 'Əlavə et' },
        OPEN_STEP,
      ] };
    case 'ios-other':
      return { copy: true, note: <><b>Safari-də açmaq tövsiyə olunur.</b> Bu brauzerdə «Ana ekrana əlavə et» olmaya bilər.</>, steps: [
        { t: <>Ünvan sətrindəki və ya menyudakı <b>Paylaş</b> ikonuna basın</>, ic: <ShareIcon /> },
        { t: <><b>«Ana ekrana əlavə et»</b> seçin</>, ic: <AddHomeIcon /> },
        { t: <>Sağ yuxarıda <b>«Əlavə et»</b></>, pill: 'Əlavə et' },
        OPEN_STEP,
      ] };
    case 'android-samsung':
      return { steps: [
        { t: <>Aşağıda menyu <b>☰</b> düyməsinə basın</>, ic: <MenuIcon /> },
        { t: <><b>«Səhifəni əlavə et»</b> → <b>«Ana ekran»</b></>, ic: <AddHomeIcon /> },
        { t: <><b>«Əlavə et»</b> ilə təsdiqləyin</> },
        OPEN_STEP,
      ] };
    case 'android-other':
      return { copy: true, note: <><b>Chrome-da açmaq tövsiyə olunur.</b></>, steps: [
        { t: <>Brauzerin menyusunu <b>⋮</b> açın</>, ic: <DotsVIcon /> },
        { t: <><b>«Ana ekrana əlavə et»</b> və ya <b>«Tətbiqi quraşdır»</b></>, ic: <AddHomeIcon /> },
        { t: <>Təsdiqləyin</> },
        OPEN_STEP,
      ] };
    default: // android-chrome (düymə yoxdursa əl ilə)
      return { steps: [
        { t: <>Sağ yuxarıda üç nöqtəyə <b>⋮</b> basın</>, ic: <DotsVIcon /> },
        { t: <><b>«Ana ekrana əlavə et»</b> və ya <b>«Tətbiqi quraşdır»</b></>, ic: <AddHomeIcon /> },
        { t: <><b>«Quraşdır»</b> ilə təsdiqləyin</> },
        OPEN_STEP,
      ] };
  }
}

/** A2: ana ekrana əlavə et + 6 rəqəmli kod. required=true (mobil, standalone deyil): keçid düyməsi yoxdur. */
export function Install({ token, pair, setPair, required, onDone }: { token: string; pair: string | null; setPair: (c: string) => void; required: boolean; onDone: () => void }) {
  const ip = useInstallPrompt();
  const android = env.startsWith('android');
  const desktop = env === 'desktop';
  const { steps, note, copy } = stepsFor();
  const showBtn = android && ip.can && !ip.installed;
  const short = showBtn || ip.installed;
  const list: Step[] = desktop
    ? [{ t: 'Brauzerin menyusunu (⋮) açın.' }, { t: '«Ana ekrana əlavə et» və ya «Quraşdır» seçin.' }, { t: 'Ana ekrandakı Y Pod-u açın. Kod istəsə, bu kodu yazın.' }]
    : short ? [{ t: <><b>«Quraşdır»</b> düyməsinə basıb təsdiqləyin</> }, OPEN_STEP] : steps;
  const base = showBtn ? 260 : 200;
  return (
    <AuthPage innerStyle={env === 'ios-safari' ? { paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' } : undefined}>
      <Brand />
      {ip.installed && (
        <div className="nins-ok rz" role="status" style={dl(60)}>
          <span className="nchip nchip-cb"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path className="nins-draw" d="M20 6 9 17l-5-5" pathLength={1} /></svg></span>
          <span><b>Quraşdırıldı!</b> Bu pəncərəni bağlayın və ana ekrandakı <b>Y Pod</b> ikonundan açın.</span>
        </div>
      )}
      <h1 className="nau-h1 s rz" style={dl(ip.installed ? 120 : 60)}>Ana ekrana əlavə edin</h1>
      <p className="nau-p rz" style={dl(ip.installed ? 180 : 120)}>{required ? 'Əvvəl app-ı telefonunuza quraşdırın.' : 'App kimi bir toxunuşla açılsın, brauzer çubuğu olmadan.'}</p>

      {showBtn && <button type="button" className="nb nb-p nins-big rz" style={dl(180)} onClick={ip.prompt}><NIcon name="plus" size={20} sw={2} />App-ı quraşdır</button>}
      {note && !ip.installed && <div className="g nins-note rz" style={dl(180)}><NIcon name="alert" size={18} /><span>{note}</span></div>}
      <StepList steps={list} base={ip.installed ? 260 : base} />
      {copy && !ip.installed && !desktop && <CopyButton url={appUrl()} label="Safari-də açmaq üçün linki kopyala" />}

      <PairCard token={token} pair={pair} setPair={setPair} delay={(ip.installed ? 260 : base) + list.length * 80} />
      {!required && <div className="nau-foot"><button type="button" className="nb nb-p nau-big" onClick={onDone}>Anladım</button></div>}
      {env === 'ios-safari' && <div className="nins-arrow rz" style={dl(600)} aria-hidden="true"><div><span>Paylaş düyməsi burada</span><NIcon name="down" size={22} sw={2} /></div></div>}
    </AuthPage>
  );
}

/** Instagram / WhatsApp / Telegram... daxili brauzeri: ana ekrana əlavə mümkün deyil. */
export function InAppScreen({ url }: { url: string }) {
  const ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const steps: Step[] = [
    { t: <>Sağ yuxarıda (və ya aşağıda) <b>«…»</b> düyməsinə basın</>, ic: <NIcon name="ellipsis" /> },
    { t: <><b>{ios ? '«Safari-də aç»' : '«Brauzerdə aç»'}</b> seçin</>, ic: ios ? <NIcon name="compass" /> : <DotsVIcon /> },
    { t: <>Açılan {ios ? 'Safari' : 'Chrome'}-da ana ekrana əlavə etmə təlimatını izləyin</>, ic: <NIcon name="mobile" /> },
  ];
  return (
    <AuthPage>
      <div className="nins-top" aria-hidden="true"><div><NIcon name="ext" size={24} sw={2} /></div></div>
      <Brand />
      <h1 className="nau-h1 s rz" style={dl(60)}>Linki {ios ? 'Safari-də' : 'Chrome-da'} açın</h1>
      <p className="nau-p rz" style={dl(120)}>Bu tətbiqin daxili brauzerindən app-ı ana ekrana əlavə etmək mümkün deyil.</p>
      <StepList steps={steps} base={200} />
      <div className="nins-cp rz" style={dl(440)}>
        <p>Açılmasa, linki kopyalayıb {ios ? 'Safari-yə' : 'Chrome-a'} yapışdırın</p>
        <CopyButton url={url} />
      </div>
    </AuthPage>
  );
}
