import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../shared/api';
import { Button, Icon, Logo } from '../shared/ui';
import { Brand } from './auth';
import { env } from './util';

// ---------- brauzerin real ikonları ----------
const svg = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
/** iOS "Paylaş": yuxarıdan açıq kvadrat + yuxarı ox. */
export const ShareIcon = ({ size = 28 }: { size?: number }) => svg(size, <path d="M12 15V3M8 7l4-4 4 4M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />);
/** "Ana ekrana əlavə et": kvadratda +. */
export const AddHomeIcon = ({ size = 28 }: { size?: number }) => svg(size, <path d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8v8M8 12h8" />);
/** Chrome (Android) üç nöqtə ⋮. */
export const DotsVIcon = ({ size = 28 }: { size?: number }) => svg(size, <><circle cx="12" cy="5" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="19" r="1.4" fill="currentColor" /></>);
/** Üfüqi üç nöqtə …. */
export const DotsHIcon = ({ size = 28 }: { size?: number }) => svg(size, <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>);
/** Samsung Internet menyusu ☰. */
export const MenuIcon = ({ size = 28 }: { size?: number }) => svg(size, <path d="M4 7h16M4 12h16M4 17h16" />);
/** Safari kompası. */
export const CompassIcon = ({ size = 28 }: { size?: number }) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>);
const HomeIcon = () => <Logo height={26} />;

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
type Step = { t: ReactNode; sub?: string; ic?: ReactNode };

function StepList({ steps }: { steps: Step[] }) {
  return (
    <div className="ins-list">
      {steps.map((s, i) => (
        <div key={i} className="ins-step">
          <span className="stepn ins-n">{i + 1}</span>
          <span className="col grow ins-t"><span>{s.t}</span>{s.sub && <span className="ins-sub">{s.sub}</span>}</span>
          {s.ic && <span className="ins-ic">{s.ic}</span>}
        </div>
      ))}
    </div>
  );
}

/** Ana səhifənin ünvanı (dəvət tokeni olmadan). */
const appUrl = () => `${location.origin}${location.pathname}`;

function CopyButton({ url, label = 'Linki kopyala' }: { url: string; label?: string }) {
  const [ok, setOk] = useState(false);
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
  }
  return <Button variant="out" onClick={copy}><Icon name="link" size={20} />{ok ? 'Kopyalandı' : label}</Button>;
}

function PairCard({ token, pair, setPair }: { token: string; pair: string | null; setPair: (c: string) => void }) {
  const [err, setErr] = useState('');
  const asked = useRef(false);
  async function fresh() {
    setErr('');
    try { setPair((await api<{ pair_code: string }>('/me/pair-code', { token, body: {} })).pair_code); }
    catch (e) { setErr((e as ApiError).message); }
  }
  useEffect(() => { if (!pair && !asked.current) { asked.current = true; fresh(); } }, []);
  return (
    <div className="card ins-pair">
      <span className="t14 w8 lh">Ana ekrandakı app kod istəsə, bu kodu yazın</span>
      {pair ? <div className="code-big" aria-label="Giriş kodu">{pair}</div> : <div className="code-big ins-wait">······</div>}
      <div className="row sb">
        <span className="hint">15 dəqiqə etibarlıdır</span>
        <Button variant="ghost" small auto onClick={fresh}>Yeni kod</Button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

const OPEN_STEP: Step = { t: <>Ana ekranda <b>Y Pod</b> ikonundan açın</>, ic: <HomeIcon /> };

function stepsFor(): { steps: Step[]; note?: ReactNode; copy?: boolean } {
  switch (env) {
    case 'ios-safari':
      return { steps: [
        { t: <>Aşağıdakı <b>Paylaş</b> düyməsinə basın</>, sub: 'Görünmürsə: «…» menyusu → Paylaş', ic: <ShareIcon /> },
        { t: <>Siyahını aşağı sürüşdürüb <b>«Ana ekrana əlavə et»</b> seçin</>, ic: <AddHomeIcon /> },
        { t: <>Sağ yuxarıda <b>«Əlavə et»</b></> },
        OPEN_STEP,
      ] };
    case 'ios-chrome':
      return { copy: true, steps: [
        { t: <>Ünvan sətrinin yanındakı <b>Paylaş</b> ikonuna basın</>, sub: 'iOS 16.4 və yuxarı', ic: <ShareIcon /> },
        { t: <><b>«Ana ekrana əlavə et»</b> seçin</>, ic: <AddHomeIcon /> },
        { t: <>Sağ yuxarıda <b>«Əlavə et»</b></> },
        OPEN_STEP,
      ] };
    case 'ios-other':
      return { copy: true, note: <><b>Safari-də açmaq tövsiyə olunur.</b> Bu brauzerdə «Ana ekrana əlavə et» olmaya bilər.</>, steps: [
        { t: <>Ünvan sətrindəki və ya menyudakı <b>Paylaş</b> ikonuna basın</>, ic: <ShareIcon /> },
        { t: <><b>«Ana ekrana əlavə et»</b> seçin</>, ic: <AddHomeIcon /> },
        { t: <>Sağ yuxarıda <b>«Əlavə et»</b></> },
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
  return (
    <main className="scr"><div className="au ins" style={env === 'ios-safari' ? { paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' } : undefined}>
      <div className="top"><Brand /></div>
      <h1 className="h1 ins-h">Ana ekrana əlavə edin</h1>
      <p className="t14 soft lh">{required ? 'Əvvəl app-ı telefonunuza quraşdırın.' : 'App kimi bir toxunuşla açılsın, brauzer çubuğu olmadan.'}</p>

      {ip.installed ? (
        <div className="banner ins-ok" role="status"><Icon name="check" size={22} strokeWidth={2.6} /><span><b>Quraşdırıldı!</b> Bu pəncərəni bağlayın və ana ekrandakı <b>Y Pod</b> ikonundan açın.</span></div>
      ) : (
        <>
          {showBtn && <Button className="ins-big" onClick={ip.prompt}><Icon name="plus" size={22} strokeWidth={2.6} />App-ı quraşdır</Button>}
          {note && <div className="banner"><Icon name="alert" size={18} /><span>{note}</span></div>}
          {desktop
            ? <StepList steps={[
                { t: 'Brauzerin menyusunu (⋮) açın.' }, { t: '«Ana ekrana əlavə et» və ya «Quraşdır» seçin.' }, { t: 'Ana ekrandakı Y Pod-u açın. Kod istəsə, bu kodu yazın.' },
              ]} />
            : showBtn ? <StepList steps={[{ t: <><b>«Quraşdır»</b> düyməsinə basıb təsdiqləyin</> }, OPEN_STEP]} /> : <StepList steps={steps} />}
          {copy && <CopyButton url={appUrl()} label="Safari-də açmaq üçün linki kopyala" />}
        </>
      )}

      <PairCard token={token} pair={pair} setPair={setPair} />
      {!required && <><div className="grow" /><Button onClick={onDone}>Anladım</Button></>}
      {env === 'ios-safari' && <div className="ins-arrow" aria-hidden="true"><b>Paylaş düyməsi burada</b><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v15M6 13l6 6 6-6" /></svg></div>}
    </div></main>
  );
}

/** Instagram / WhatsApp / Telegram... daxili brauzeri: ana ekrana əlavə mümkün deyil. */
export function InAppScreen({ url }: { url: string }) {
  const ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const steps: Step[] = [
    { t: <>Sağ yuxarıda (və ya aşağıda) <b>«…»</b> düyməsinə basın</>, ic: <DotsHIcon /> },
    { t: <><b>{ios ? '«Safari-də aç»' : '«Brauzerdə aç»'}</b> seçin</>, ic: ios ? <CompassIcon /> : <DotsVIcon /> },
    { t: <>Açılan {ios ? 'Safari' : 'Chrome'}-da ana ekrana əlavə etmə təlimatını izləyin</>, ic: <AddHomeIcon /> },
  ];
  return (
    <main className="scr"><div className="au ins">
      <div className="top"><Brand /></div>
      <h1 className="h1 ins-h">Linki {ios ? 'Safari-də' : 'Chrome-da'} açın</h1>
      <p className="t14 soft lh">Bu tətbiqin daxili brauzerindən app-ı ana ekrana əlavə etmək mümkün deyil.</p>
      <StepList steps={steps} />
      <div className="card ins-pair">
        <span className="t14 w8 lh">Açılmasa, linki kopyalayıb {ios ? 'Safari-yə' : 'Chrome-a'} yapışdırın</span>
        <CopyButton url={url} />
      </div>
    </div></main>
  );
}
