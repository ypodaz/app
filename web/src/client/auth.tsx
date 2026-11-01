import { FormEvent, useState, type CSSProperties, type ReactNode } from 'react';
import { api, ApiError } from '../shared/api';
import { NIcon } from '../shared/ui';
import { dl, NLogo } from './core';
import { PHONE_HREF, waLink } from './util';

export function Brand() {
  return <div className="nau-brand rz" style={dl(0)}><span aria-hidden="true"><NLogo /></span><b>Y Pod</b></div>;
}

/** Giriş / quraşdırma ekranlarının ortaq çərçivəsi: Neon fon, yuxarıda zəif bənövşəyi işıq. */
export function AuthPage({ children, glowAnim, onSubmit, className = '', innerStyle, label, dialog }: { children: ReactNode; glowAnim?: boolean; onSubmit?: (e: FormEvent) => void; className?: string; innerStyle?: CSSProperties; label?: string; dialog?: boolean }) {
  const inner = onSubmit
    ? <form className="nau-in" onSubmit={onSubmit} style={innerStyle}>{children}</form>
    : <div className="nau-in" style={innerStyle}>{children}</div>;
  return (
    <main className={`scr nau ${className}`} aria-label={label} {...(dialog ? { role: 'dialog', 'aria-modal': true } : {})}>
      <div className={`nau-glow${glowAnim ? ' anim' : ''}`} aria-hidden="true" />
      {inner}
    </main>
  );
}

/** A1a: dəvət uğurlu. */
export function Welcome({ name, onNext }: { name: string; onNext: () => void }) {
  const items: [string, string, string, string, string][] = [
    ['coins', 'cb', 'Keşbek və paket', 'Keşbekinizi və saat paketinizi izləyin', '180'],
    ['cal', 'cal', 'Çəkilişlər', 'Cədvəliniz və ödəniş vəziyyəti', '240'],
    ['folder', 'mat', 'Materiallar', 'Hazır videolar bir yerdə', '300'],
  ];
  const first = name.split(' ')[0];
  return (
    <AuthPage glowAnim>
      <Brand />
      <h1 className="nau-h1 rz" style={dl(60)}>{first ? `Xoş gəldiniz, ${first}` : 'Xoş gəldiniz'}</h1>
      <div className="n-lbl c3 nau-lbl rz" style={dl(120)}>App-da nə var</div>
      <ul className="nau-ul">
        {items.map(([ic, tone, t, d, ms]) => (
          <li key={t} className="g nau-li t rz" style={dl(Number(ms))}>
            <span className={`nchip nchip-${tone}`}><NIcon name={ic as 'coins'} size={16} /></span>
            <span className="nau-li-t">{t}<span>{d}</span></span>
          </li>
        ))}
      </ul>
      <div className="nau-foot c rz" style={dl(360)}>
        <button type="button" className="nb nb-p nau-big" onClick={onNext}>Davam et<NIcon name="chev" size={18} /></button>
        <div className="n-meta c3" style={{ textAlign: 'center' }}>Bu link yalnız sizin üçündür, başqası ilə paylaşmayın</div>
      </div>
    </AuthPage>
  );
}

/** A1b: link etibarsızdır. */
export function InvalidInvite({ onCode }: { onCode: () => void }) {
  return (
    <AuthPage>
      <Brand />
      <div className="nau-center">
        <span className="nchip nchip-40 rz" style={dl(60)}><NIcon name="linkoff" size={20} /></span>
        <h1 className="n-h2 rz" style={dl(120)}>Link etibarsızdır</h1>
        <p className="nau-p rz" style={dl(180)}>Bu link köhnədir və ya artıq istifadə olunub. Yeni link üçün Y Pod-a yazın.</p>
      </div>
      <div className="nau-foot rz" style={dl(240)}>
        <a className="nb nb-p nau-big" href={waLink('Salam, app üçün yeni giriş linki istəyirəm.')} target="_blank" rel="noopener"><NIcon name="msg" size={18} />Y Pod-a WhatsApp-da yazın</a>
        <a className="nb nb-s nau-sec" href={PHONE_HREF}><NIcon name="phone" size={18} />Zəng edin</a>
        <button type="button" className="nau-link" onClick={onCode}>Telefonda kodum var</button>
      </div>
    </AuthPage>
  );
}

/** Kod ilə giriş. */
export function CodeEntry({ onToken }: { onToken: (t: string) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true); setErr('');
    try { onToken((await api<{ token: string }>('/auth/pair', { body: { code } })).token); }
    catch (e) { setErr((e as ApiError).message.replace(/\.$/, '')); setShake((n) => n + 1); }
    finally { setBusy(false); }
  }
  return (
    <AuthPage onSubmit={submit}>
      <Brand />
      <h1 className="nau-h1 rz" style={dl(60)}>Kodu yazın</h1>
      <p className="nau-p rz" style={dl(120)}>Studiyanın WhatsApp-da göndərdiyi linki açanda 6 rəqəmli kod görünür.</p>
      <div className="rz" style={dl(180)}>
        <div className="nau-code">
          <div key={shake} className={`nau-cells${err ? ' shake' : ''}`} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => {
              const filled = i < code.length;
              const active = !err && i === code.length;
              return <div key={i} className={`nau-cell${err ? ' bad' : active ? ' on' : ''}${filled && !err ? ' f' : ''}`}><span>{code[i] ?? ''}</span>{active && <i />}</div>;
            })}
          </div>
          <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setErr(''); }} aria-label="6 rəqəmli kod" />
        </div>
        {err && <div className="nau-err" role="alert"><NIcon name="alert" size={16} />{err}</div>}
      </div>
      <div className={`nau-help rz${err ? '' : ' n'}`} style={dl(240)}>
        <p>Link və ya kod yoxdursa, studiyaya WhatsApp-da yazın, yeni link göndərək.</p>
        <a className="nb nb-s nau-sec" href={waLink('Salam, app üçün yeni giriş linki istəyirəm.')} target="_blank" rel="noopener"><NIcon name="msg" size={18} />WhatsApp-da yazın</a>
      </div>
      <div className="nau-foot rz" style={dl(300)}>
        <button type="submit" className="nb nb-p nau-big" disabled={busy || code.length !== 6}>Daxil ol</button>
      </div>
    </AuthPage>
  );
}
