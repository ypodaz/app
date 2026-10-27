import { FormEvent, useState } from 'react';
import { api, ApiError } from '../shared/api';
import { Button, Icon, Logo } from '../shared/ui';
import { XIcon } from './core';
import { PHONE_HREF, isIOS, waLink } from './util';

export function Brand() {
  return <div className="logo-wrap"><Logo height={36} /><span className="h2">Y Pod</span></div>;
}

/** A1a: dəvət uğurlu. */
export function Welcome({ name, onNext }: { name: string; onNext: () => void }) {
  const items: [string, string, string][] = [
    ['wallet', 'Keşbek və paket', 'Keşbekinizi və saat paketinizi izləyin'],
    ['calendar', 'Çəkilişlər', 'Cədvəliniz və ödəniş vəziyyəti'],
    ['media', 'Materiallar', 'Hazır videolar bir yerdə'],
  ];
  return (
    <main className="scr"><div className="au">
      <Brand />
      <h1 className="h1 mt2">Xoş gəldiniz, {name.split(' ')[0]}</h1>
      <span className="lbl mt">App-da nə var</span>
      <div className="list">
        {items.map(([ic, t, d]) => (
          <div key={t} className="li">
            <span className="ic"><Icon name={ic as 'wallet'} size={20} /></span>
            <span className="col grow"><span className="t16 w8">{t}</span><span className="t13 soft lh">{d}</span></span>
          </div>
        ))}
      </div>
      <div className="grow" />
      <Button onClick={onNext}>Davam et<Icon name="chevron" size={20} strokeWidth={2.4} /></Button>
      <p className="hint" style={{ textAlign: 'center' }}>Bu link yalnız sizin üçündür, başqası ilə paylaşmayın</p>
    </div></main>
  );
}

/** A1b: link etibarsızdır. */
export function InvalidInvite({ onCode }: { onCode: () => void }) {
  return (
    <main className="scr"><div className="au">
      <Brand />
      <div className="grow col ctr" style={{ gap: 14 }}>
        <span className="ic ic-l"><Icon name="alert" size={26} /></span>
        <h1 className="h2">Link etibarsızdır</h1>
        <p className="t14 soft lh">Bu link köhnədir və ya artıq istifadə olunub. Yeni link üçün Y Pod-a yazın.</p>
      </div>
      <a className="btn btn-primary" href={waLink('Salam, app üçün yeni giriş linki istəyirəm.')} target="_blank" rel="noopener"><XIcon name="wa" size={18} />Y Pod-a WhatsApp-da yazın</a>
      <a className="btn btn-out" href={PHONE_HREF}><XIcon name="phone" size={18} />Zəng edin</a>
      <Button variant="ghost" auto className="mt" onClick={onCode}>Telefonda kodum var</Button>
    </div></main>
  );
}

/** A2: ana ekrana əlavə et + 6 rəqəmli kod (ana ekrandakı app-a daxil olmaq üçün). */
export function Install({ token, pair, setPair, onDone }: { token: string; pair: string | null; setPair: (c: string) => void; onDone: () => void }) {
  const [err, setErr] = useState('');
  async function fresh() {
    setErr('');
    try { setPair((await api<{ pair_code: string }>('/me/pair-code', { token, body: {} })).pair_code); }
    catch (e) { setErr((e as ApiError).message); }
  }
  const steps = isIOS
    ? ['Aşağıda «Paylaş» düyməsinə basın.', 'Açılan menyuda «Ana ekrana əlavə et» seçin.', 'Ana ekrandakı Y Pod-u açın və bu kodu yazın.']
    : ['Brauzerin menyusunu (⋮) açın.', '«Ana ekrana əlavə et» və ya «Quraşdır» seçin.', 'Ana ekrandakı Y Pod-u açın. Kod istəsə, bu kodu yazın.'];
  return (
    <main className="scr"><div className="au">
      <div className="top"><Brand /></div>
      <h1 className="h1">Ana ekrana əlavə edin</h1>
      <p className="t14 soft lh">App kimi bir toxunuşla açılsın, brauzer çubuğu olmadan.</p>
      <div className="list">
        {steps.map((t, i) => (
          <div key={t} className="li"><span className="stepn">{i + 1}</span><span className="t15 w7 lh grow">{t}</span></div>
        ))}
      </div>
      <div className="card">
        {pair ? <div className="code-big" aria-label="Giriş kodu">{pair}</div> : null}
        <p className="hint">Kod 15 dəqiqə etibarlıdır.</p>
        <Button variant="out" small onClick={fresh}>{pair ? 'Yeni kod' : 'Kod al'}</Button>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="grow" />
      <Button onClick={onDone}>Anladım</Button>
    </div></main>
  );
}

/** Kod ilə giriş. */
export function CodeEntry({ onToken }: { onToken: (t: string) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onToken((await api<{ token: string }>('/auth/pair', { body: { code } })).token); }
    catch (e) { setErr((e as ApiError).message); }
    finally { setBusy(false); }
  }
  return (
    <main className="scr"><div className="au">
      <Brand />
      <form className="card mt2" onSubmit={submit}>
        <h1 className="h2">Kodu yazın</h1>
        <p className="t13 muted lh">Studiyanın WhatsApp-da göndərdiyi linki açanda 6 rəqəmli kod görünür.</p>
        <input className="inp codein" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" aria-label="6 rəqəmli kod" />
        <Button disabled={busy || code.length !== 6} type="submit">Daxil ol</Button>
        {err && <p className="err" role="alert">{err}</p>}
      </form>
      <p className="t13 muted lh">Link və ya kod yoxdursa, studiyaya WhatsApp-da yazın, yeni link göndərək.</p>
      <a className="btn btn-out" href={waLink('Salam, app üçün yeni giriş linki istəyirəm.')} target="_blank" rel="noopener"><XIcon name="wa" size={18} />WhatsApp-da yazın</a>
    </div></main>
  );
}
