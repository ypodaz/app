import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, storedToken, storeToken } from '../shared/api';
import '../shared/ypod.css';
import '../shared/responsive.css';
import './client.css';
import { CodeEntry, InvalidInvite, Welcome } from './auth';
import { InAppScreen, Install } from './install';
import { AiChat } from './ai';
import { Calendar } from './calendar';
import { AuthCtx, Loading, TOKEN_KEY, useRoute } from './core';
import { ShootDetail } from './detail';
import { Home } from './home';
import { PushGate } from './push';
import { OfferPage, ProfilePage } from './profile';
import { Cashback, Materials, Notifications, PackagePage } from './pages';
import { env, needInstall, standalone } from './util';

// Dəvət tokeni ünvandan dərhal götürülür ki, tarixçədə və ekran şəklində qalmasın.
// Instagram/WhatsApp kimi daxili brauzerdə link sərf olunmur: istifadəçi onu real brauzerdə açacaq.
const inviteToken = new URLSearchParams(location.search).get('i');
const inviteUrl = location.href;
const inApp = env === 'inapp' && !standalone;
if (inviteToken && !inApp) history.replaceState(null, '', location.pathname);

type Stage = 'app' | 'welcome' | 'install';

function Routes({ onLogout, pair, setPair, token }: { onLogout: () => void; pair: string | null; setPair: (c: string) => void; token: string }) {
  const [r0, r1] = useRoute();
  switch (r0) {
    case 'ai': return <AiChat />;
    case 'calendar': return <Calendar />;
    case 'shoots': return r1 ? <ShootDetail id={r1} key={r1} /> : <Calendar />;
    case 'cashback': return <Cashback />;
    case 'package': return <PackagePage />;
    case 'materials': return <Materials />;
    case 'notifications': return <Notifications />;
    case 'profile': return <ProfilePage />;
    case 'offer': return <OfferPage id={r1} key={r1} />;
    case 'install': return <Install token={token} pair={pair} setPair={setPair} required={needInstall} onDone={() => { location.hash = '#/'; }} />;
    default: return <Home onLogout={onLogout} />;
  }
}

function App() {
  const [token, setToken] = useState(storedToken(TOKEN_KEY));
  const [pair, setPair] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [stage, setStage] = useState<Stage>('app');
  const [busy, setBusy] = useState(!!inviteToken && !inApp);
  const [badInvite, setBadInvite] = useState(false);
  const redeemed = useRef(false);

  function signIn(t: string) { storeToken(TOKEN_KEY, t); setToken(t); }
  function signOut() {
    storeToken(TOKEN_KEY, null); setToken(null); setPair(null); setStage('app');
    try { Object.keys(localStorage).filter((k) => k.startsWith('ypod.')).forEach((k) => localStorage.removeItem(k)); } catch { /* gizli rejim */ }
  }

  useEffect(() => {
    if (!inviteToken || inApp || redeemed.current) return;
    redeemed.current = true;
    api<{ token: string; pair_code: string; full_name?: string }>('/auth/redeem', { body: { token: inviteToken } })
      .then((r) => { signIn(r.token); setPair(r.pair_code); setName(r.full_name ?? ''); setStage('welcome'); })
      .catch(() => setBadInvite(true))
      .finally(() => setBusy(false));
  }, []);

  if (busy) return <main className="scr"><div className="au"><Loading /></div></main>;
  if (inApp) return <InAppScreen url={inviteToken ? inviteUrl : `${location.origin}${location.pathname}`} />;
  if (!token) return badInvite ? <InvalidInvite onCode={() => setBadInvite(false)} /> : <CodeEntry onToken={signIn} />;

  const logout = async () => { await api('/me/logout', { token, body: {} }).catch(() => {}); signOut(); };
  const toApp = () => { setStage('app'); location.hash = '#/'; };

  return (
    <AuthCtx.Provider value={{ token, signOut }}>
      {stage === 'welcome' ? <Welcome name={name} onNext={() => (standalone ? toApp() : setStage('install'))} />
        : stage === 'install' || needInstall ? <Install token={token} pair={pair} setPair={setPair} required={needInstall} onDone={toApp} />
        : <><Routes onLogout={logout} pair={pair} setPair={setPair} token={token} /><PushGate /></>}
    </AuthCtx.Provider>
  );
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
