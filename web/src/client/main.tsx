import { FormEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { api, ApiError, storedToken, storeToken } from '../shared/api';
import '../shared/base.css';

const KEY = 'ypod.token';
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

// Dəvət tokeni ünvandan dərhal götürülür ki, tarixçədə və ekran şəklində qalmasın.
const inviteToken = new URLSearchParams(location.search).get('i');
if (inviteToken) history.replaceState(null, '', location.pathname);

type Me = { full_name: string; card_code: string };

function App() {
  const [token, setToken] = useState(storedToken(KEY));
  const [pair, setPair] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(!!inviteToken);
  const redeemed = useRef(false);

  function signIn(t: string) { storeToken(KEY, t); setToken(t); }
  function signOut() { storeToken(KEY, null); setToken(null); setMe(null); }

  useEffect(() => {
    if (!inviteToken || redeemed.current) return;
    redeemed.current = true;
    api<{ token: string; pair_code: string }>('/auth/redeem', { body: { token: inviteToken } })
      .then((r) => { signIn(r.token); setPair(r.pair_code); })
      .catch((e: ApiError) => setErr(e.message))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!token || busy) return;
    api<Me>('/me', { token }).then(setMe).catch((e: ApiError) => (e.status === 401 ? signOut() : setErr(e.message)));
  }, [token, busy]);

  if (busy) return <main><p>Yüklənir…</p></main>;
  if (!token) return <CodeEntry onToken={signIn} initialError={err} />;
  if (!me) return <main>{err ? <p className="err">{err}</p> : <p>Yüklənir…</p>}</main>;

  return (
    <main>
      <h1>Salam, {me.full_name}!</h1>
      {!standalone && <Install token={token} pair={pair} setPair={setPair} />}
      <div className="card">
        <strong>Müştəri kartınız</strong>
        <p className="muted">Studiyada bu QR-ı göstərin.</p>
        <QrImage value={me.card_code} />
      </div>
      <p className="muted">Faza 0 test versiyası · {standalone ? 'ana ekrandan açılıb' : 'brauzerdə açılıb'}</p>
      <button className="ghost" onClick={async () => { await api('/me/logout', { token, body: {} }).catch(() => {}); signOut(); }}>Çıxış</button>
    </main>
  );
}

function Install({ token, pair, setPair }: { token: string; pair: string | null; setPair: (c: string) => void }) {
  const [err, setErr] = useState('');
  async function fresh() {
    setErr('');
    try { setPair((await api<{ pair_code: string }>('/me/pair-code', { token, body: {} })).pair_code); }
    catch (e) { setErr((e as ApiError).message); }
  }
  return (
    <div className="card">
      <strong>App-ı ana ekrana əlavə edin</strong>
      {isIOS ? (
        <ol><li>Aşağıda «Paylaş» düyməsinə basın.</li><li>«Ana ekrana əlavə et» seçin.</li><li>Ana ekrandakı Y Pod-u açın və bu kodu yazın.</li></ol>
      ) : (
        <ol><li>Brauzerin menyusunu (⋮) açın.</li><li>«Ana ekrana əlavə et» və ya «Quraşdır» seçin.</li><li>Ana ekrandakı Y Pod-u açın. Kod istəsə, bu kodu yazın.</li></ol>
      )}
      {pair ? <div className="code">{pair}</div> : null}
      <p className="muted">Kod 15 dəqiqə etibarlıdır.</p>
      <button className="ghost" onClick={fresh}>{pair ? 'Yeni kod' : 'Kod al'}</button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function CodeEntry({ onToken, initialError }: { onToken: (t: string) => void; initialError: string }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onToken((await api<{ token: string }>('/auth/pair', { body: { code } })).token); }
    catch (e) { setErr((e as ApiError).message); }
    finally { setBusy(false); }
  }
  return (
    <main>
      <h1>Y Pod</h1>
      <form className="card" onSubmit={submit}>
        <strong>Kodu yazın</strong>
        <p className="muted">Studiyanın WhatsApp-da göndərdiyi linki açanda 6 rəqəmli kod görünür.</p>
        <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" aria-label="6 rəqəmli kod" />
        <button disabled={busy || code.length !== 6}>Daxil ol</button>
        {err && <p className="err">{err}</p>}
      </form>
      <p className="muted">Link və ya kod yoxdursa, studiyaya WhatsApp-da yazın, yeni link göndərək.</p>
    </main>
  );
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(value, { margin: 1, width: 220 }).then(setSrc); }, [value]);
  return src ? <img className="qr" src={src} width={220} height={220} alt="Müştəri QR kodu" /> : null;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
createRoot(document.getElementById('root')!).render(<App />);
