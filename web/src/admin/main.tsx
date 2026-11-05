import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { storedToken, storeToken } from '../shared/api';
import { watchSwUpdates } from '../shared/swUpdate';
import '../shared/ypod.css';
import '../shared/responsive.css';
import './admin.css';
import './neon-admin.css';
import './neon-admin-b3.css';
import { AdminShell } from '../shared/ui';
import { AssistantButton } from './components/Assistant';
import { PageHead } from './components/neon';
import { ShootDetail } from './components/ShootDetail';
import { AuthProvider, makeCall, useLoad } from './ctx';
import { bakuParts } from './format';
import { Calendar } from './pages/Calendar';
import { Campaigns } from './pages/Campaigns';
import { CancelShoot } from './pages/CancelShoot';
import { Clients } from './pages/Clients';
import { CloseShoot } from './pages/CloseShoot';
import { Login } from './pages/Login';
import { Materials } from './pages/Materials';
import { PackageForm, Packages } from './pages/Packages';
import { Panel } from './pages/Panel';
import { Report } from './pages/Report';
import { ShootForm } from './pages/ShootForm';
import { useRoute, useWide } from './router';
import type { Shoot } from './types';

const KEY = 'ypod.admin';

// B9: mobil tam ekran; planşet/desktopda təqvim + sağ detal paneli
function ShootPage({ id }: { id: number }) {
  const wide = useWide();
  const s = useLoad<Shoot>(wide ? `/shoots/${id}` : null).data;
  if (wide) {
    const q = new URLSearchParams({ v: 'week', d: s ? bakuParts(s.starts_at).date : '' });
    if (!s) q.delete('d');
    return <Calendar query={q} selectedId={id} detail={<ShootDetail id={id} />} />;
  }
  return <AdminShell active="calendar" title="Çəkiliş" bare full><PageHead title="Çəkiliş" back="calendar" /><ShootDetail id={id} /></AdminShell>;
}

function Routes() {
  const { path, query } = useRoute();
  const [a, b, c] = path;
  const num = Number(b);
  switch (a) {
    case 'calendar': return <Calendar query={query} />;
    case 'clients': return <Clients id={num || undefined} />;
    case 'shoots':
      if (b === 'new') return <ShootForm key={location.hash} query={query} />;
      if (!num) break;
      if (c === 'edit') return <ShootForm key={num} query={query} editId={num} />;
      if (c === 'close') return <CloseShoot id={num} />;
      if (c === 'cancel') return <CancelShoot id={num} />;
      return <ShootPage key={num} id={num} />;
    case 'packages': return b === 'new' ? <PackageForm /> : <Packages />;
    case 'materials': return <Materials />;
    case 'campaigns': return <Campaigns />;
    case 'automations': return <Campaigns tab="auto" />;
    case 'report': return <Report />;
  }
  return <Panel />;
}

function App() {
  const [token, setToken] = useState(storedToken(KEY));
  const auth = useMemo(() => {
    const signOut = () => { storeToken(KEY, null); setToken(null); };
    return token ? { call: makeCall(token, signOut), signOut } : null;
  }, [token]);
  if (!auth) return <Login onToken={(t) => { storeToken(KEY, t); setToken(t); }} />;
  return <AuthProvider value={auth}><Routes /><AssistantButton /></AuthProvider>;
}

watchSwUpdates(); // SW-ni müştəri səhifəsi qeydiyyatdan keçirir; burada yalnız yeniləməyə baxılır
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
