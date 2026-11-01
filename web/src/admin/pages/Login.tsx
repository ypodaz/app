import { FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Logo } from '../../shared/ui';
import { AIcon } from '../components/AIcon';

// B0a: giriş. Səhv parolda kart 300ms titrəyir (n artdıqca A/B animasiyası növbələşir ki, təkrar başlasın).
export function Login({ onToken }: { onToken: (t: string) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { onToken((await api<{ token: string }>('/admin/login', { body: { login, password } })).token); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Xəta baş verdi.'); setShake((n) => n + 1); }
    finally { setBusy(false); }
  }
  const filled = login.trim() !== '' && password !== '';
  return (
    <div className="adm a-login">
      <div className="a-login-glow" aria-hidden="true" />
      <main className="a-login-m">
        <form className={`a-lcard${shake ? (shake % 2 ? ' sA' : ' sB') : ''}`} onSubmit={submit} noValidate>
          <div className="a-lhead">
            <Logo height={36} />
            <h1>Y Pod · Admin</h1>
          </div>
          <div className="a-lform">
            <div>
              <label className="a-lbl" htmlFor="lg">Login</label>
              <input id="lg" className={`a-inp${err ? ' bad' : ''}`} value={login} onChange={(e) => { setLogin(e.target.value); setErr(''); }} autoComplete="username" autoCapitalize="none" />
            </div>
            <div>
              <label className="a-lbl" htmlFor="pw">Parol</label>
              <input id="pw" className={`a-inp${err ? ' bad' : ''}`} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setErr(''); }} autoComplete="current-password" aria-describedby="login-err" />
            </div>
            {err && <div id="login-err" className="a-ferr" role="alert"><AIcon name="alert" size={14} />{err}</div>}
            <button type="submit" className="a-lbtn" disabled={!filled || busy}>Daxil ol</button>
          </div>
        </form>
      </main>
    </div>
  );
}
