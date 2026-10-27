import { FormEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QrScanner from 'qr-scanner';
import { api, ApiError, storedToken, storeToken } from '../shared/api';
import '../shared/base.css';

const KEY = 'ypod.admin';

type Client = { id: number; full_name: string; phone: string; activated: boolean };
type InviteOut = { url: string; whatsapp_url: string | null };

function App() {
  const [token, setToken] = useState(storedToken(KEY));
  function signOut() { storeToken(KEY, null); setToken(null); }
  if (!token) return <Login onToken={(t) => { storeToken(KEY, t); setToken(t); }} />;
  return <Panel token={token} onAuthError={signOut} />;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { onToken((await api<{ token: string }>('/admin/login', { body: { login, password } })).token); }
    catch (e) { setErr((e as ApiError).message); }
  }
  return (
    <main>
      <h1>Y Pod · Admin</h1>
      <form className="card" onSubmit={submit}>
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Login" autoComplete="username" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Parol" autoComplete="current-password" />
        <button disabled={!login || !password}>Daxil ol</button>
        {err && <p className="err">{err}</p>}
      </form>
    </main>
  );
}

function Panel({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [err, setErr] = useState('');
  const [scan, setScan] = useState(false);

  function fail(e: unknown) {
    const ae = e as ApiError;
    ae.status === 401 ? onAuthError() : setErr(ae.message);
  }
  const load = () => api<Client[]>('/admin/clients', { token }).then(setClients).catch(fail);
  useEffect(() => { load(); }, []);

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Müştərilər</h1>
        <button onClick={() => setScan(!scan)}>{scan ? 'Bağla' : 'QR oxut'}</button>
      </div>
      {scan && <Scanner token={token} onError={fail} />}
      <AddClient token={token} onAdded={load} onError={fail} />
      {err && <p className="err">{err}</p>}
      {clients.map((c) => <ClientRow key={c.id} c={c} token={token} onError={fail} />)}
      <button className="ghost" onClick={onAuthError}>Çıxış</button>
    </main>
  );
}

function AddClient({ token, onAdded, onError }: { token: string; onAdded: () => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await api('/admin/clients', { token, body: { full_name: name, phone } }); setName(''); setPhone(''); onAdded(); }
    catch (e) { onError(e); }
  }
  return (
    <form className="card" onSubmit={submit}>
      <strong>+ Yeni müştəri</strong>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad Soyad" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefon, məs. 055 530 35 32" inputMode="tel" />
      <button disabled={name.trim().length < 2}>Əlavə et</button>
    </form>
  );
}

function ClientRow({ c, token, onError }: { c: Client; token: string; onError: (e: unknown) => void }) {
  const [inv, setInv] = useState<InviteOut | null>(null);
  const [copied, setCopied] = useState(false);
  async function invite() {
    if (c.activated && !confirm('Müştərinin köhnə girişləri bağlanacaq. Davam edək?')) return;
    try { setInv(await api<InviteOut>(`/admin/clients/${c.id}/invite`, { token, body: {} })); setCopied(false); }
    catch (e) { onError(e); }
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><strong>{c.full_name}</strong><p className="muted">{c.phone || 'telefon yoxdur'} · {c.activated ? 'app-a qoşulub' : 'qoşulmayıb'}</p></div>
        <button className="ghost" onClick={invite}>{c.activated ? 'Yeni dəvət linki' : 'Dəvət linki'}</button>
      </div>
      {inv && (
        <div className="row">
          {inv.whatsapp_url && <a className="btn" href={inv.whatsapp_url} target="_blank" rel="noopener">WhatsApp-da göndər</a>}
          <button className="ghost" onClick={() => navigator.clipboard.writeText(inv.url).then(() => setCopied(true))}>{copied ? 'Kopyalandı' : 'Linki kopyala'}</button>
        </div>
      )}
    </div>
  );
}

function Scanner({ token, onError }: { token: string; onError: (e: unknown) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [found, setFound] = useState<Client | null>(null);
  const [msg, setMsg] = useState('Kameranı müştərinin QR kartına tutun.');
  const [manual, setManual] = useState('');

  async function lookup(code: string) {
    try { setFound(await api<Client>(`/admin/cards/${encodeURIComponent(code.trim())}`, { token })); setMsg(''); }
    catch (e) { (e as ApiError).status === 404 ? setMsg('Bu QR Y Pod kartı deyil.') : onError(e); }
  }

  useEffect(() => {
    if (!video.current) return;
    const s = new QrScanner(video.current, (r) => { s.stop(); lookup(r.data); }, { highlightScanRegion: true, returnDetailedScanResult: true });
    s.start().catch(() => setMsg('Kamera açılmadı. Kodu əl ilə yazın.'));
    return () => s.destroy();
  }, []);

  return (
    <div className="card">
      {!found && <video ref={video} playsInline muted />}
      {msg && <p className="muted">{msg}</p>}
      {found && <p><strong>{found.full_name}</strong> · {found.phone} · {found.activated ? 'app-a qoşulub' : 'qoşulmayıb'}</p>}
      {!found && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); lookup(manual); }}>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Kodu əl ilə yaz" style={{ flex: 1 }} />
          <button disabled={!manual.trim()}>Tap</button>
        </form>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
