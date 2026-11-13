import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { storedToken, storeToken } from '../shared/api';
import { watchSwUpdates } from '../shared/swUpdate';
import '../shared/ypod.css';
import '../shared/responsive.css';
import './admin.css';
import './neon-admin.css';
import './neon-admin-b3.css';
import './crm.css';
import { AuthProvider, makeCall } from './ctx';
import { Login } from './pages/Login';
import { V2Routes } from './v2/routes';

// DEV: `?mock` ilə saxta məlumat (ekran görüntüləri üçün); build-də çıxarılır
if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) await import('./v2/dev/mock').then((m) => m.installMock());

const KEY = 'ypod.admin';

function App() {
  const [token, setToken] = useState(storedToken(KEY));
  const auth = useMemo(() => {
    const signOut = () => { storeToken(KEY, null); setToken(null); };
    return token ? { call: makeCall(token, signOut), signOut } : null;
  }, [token]);
  if (!auth) return <Login onToken={(t) => { storeToken(KEY, t); setToken(t); }} />;
  return <AuthProvider value={auth}><V2Routes /></AuthProvider>;
}

watchSwUpdates(); // SW-ni müştəri səhifəsi qeydiyyatdan keçirir; burada yalnız yeniləməyə baxılır
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
