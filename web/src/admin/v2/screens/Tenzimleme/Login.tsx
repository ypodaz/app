import { FormEvent, useState } from 'react';
import { api, ApiError } from '../../../../shared/api';
import { Logo } from '../../../../shared/ui';
import { Button, ErrorBox, Field, TextInput } from '../../ui';
import '../../tokens.css';
import '../../ui/ui.css';
import './tenzimleme.css';

/** Giriş (35-hesab-giris.md): yeni dizaynda. 5 yanlış cəhddən sonra server 15 dəq kilidləyir və mesajı özü qaytarır. */
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
    <div className="v2 lg-page">
      <main className="lg">
        <form className="lg-card" onSubmit={submit} noValidate>
          <div className="lg-head"><span className="lg-logo"><Logo height={28} /></span><h1>Y Pod · Admin</h1><p>Daxil olmaq üçün login və parolu yazın</p></div>
          <Field label="Login">{(id) => <TextInput id={id} value={login} invalid={!!err} onChange={(e) => { setLogin(e.target.value); setErr(''); }} autoComplete="username" autoCapitalize="none" />}</Field>
          <Field label="Parol">{(id) => <TextInput id={id} type="password" value={password} invalid={!!err} onChange={(e) => { setPassword(e.target.value); setErr(''); }} autoComplete="current-password" />}</Field>
          {err && <ErrorBox title="Giriş alınmadı" detail={err} />}
          {/* TODO [API] «Parolu unutmuşam» və «N cəhd qalıb»: serverdə parol bərpası yoxdur, cəhd sayı qaytarılmır (yalnız kilid mesajı). */}
          <Button variant="primary" size="lg" type="submit" disabled={!login.trim() || !password || busy}>{busy ? '…' : 'Daxil ol'}</Button>
          <p className="lg-note">Sessiya 30 gün davam edir</p>
        </form>
      </main>
    </div>
  );
}
