import { FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { Button, Logo } from '../../shared/ui';
import { Err, Field } from '../components/common';

// B0a: giriş
export function Login({ onToken }: { onToken: (t: string) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { onToken((await api<{ token: string }>('/admin/login', { body: { login, password } })).token); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Xəta baş verdi.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="scr ax-login">
      <form className="card ax-login-card" onSubmit={submit}>
        <Logo height={48} />
        <h1 className="h2">Y Pod · Admin</h1>
        <Field label="Login" id="lg"><input id="lg" className="inp" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" /></Field>
        <Field label="Parol" id="pw"><input id="pw" className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <Err msg={err} />
        <Button type="submit" disabled={!login || !password || busy}>Daxil ol</Button>
      </form>
    </div>
  );
}
