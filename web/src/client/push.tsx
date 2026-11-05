import { useContext, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { NIcon } from '../shared/ui';
import { AuthCtx, dl } from './core';
import { AuthPage, Brand } from './auth';
import { isIOS, standalone, urlBase64ToUint8Array } from './util';

type Info = { public_key: string; subscribed: boolean };
type State = 'loading' | 'hidden' | 'ios' | 'off' | 'on' | 'denied';

const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keysOf = (s: PushSubscription) => {
  const j = s.toJSON();
  return { endpoint: s.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' };
};
const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, rej) => setTimeout(rej, 4000))]);

/** Bildirişlər səhifəsində "Bildirişləri aç / söndür" kartı. public_key boşdursa görünmür. */
export function PushCard() {
  const { token } = useContext(AuthCtx);
  const [state, setState] = useState<State>('loading');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let endpoint = '';
        if (supported) { const sub = await (await ready()).pushManager.getSubscription(); endpoint = sub?.endpoint ?? ''; }
        const info = await api<Info>(`/me/push?endpoint=${encodeURIComponent(endpoint)}`, { token });
        if (!live) return;
        setKey(info.public_key);
        if (!info.public_key) return setState('hidden');
        if (isIOS && !standalone) return setState('ios');
        if (!supported) return setState('hidden');
        if (Notification.permission === 'denied') return setState('denied');
        setState(info.subscribed && endpoint ? 'on' : 'off');
      } catch { if (live) setState('hidden'); }
    })();
    return () => { live = false; };
  }, [token]);

  async function enable() {
    setBusy(true); setErr('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setState('denied'); return; }
      const reg = await ready();
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      await api('/me/push', { token, body: keysOf(sub) });
      setState('on');
    } catch { setErr('Bildirişləri açmaq alınmadı. Yenidən cəhd edin.'); } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setErr('');
    try {
      const sub = await (await ready()).pushManager.getSubscription();
      if (sub) { await api('/me/push/off', { token, body: keysOf(sub) }); await sub.unsubscribe(); }
      setState('off');
    } catch { setErr('Söndürmək alınmadı. Yenidən cəhd edin.'); } finally { setBusy(false); }
  }

  if (state === 'loading' || state === 'hidden') return null;
  if (state === 'denied' || state === 'ios') {
    return (
      <section aria-label={state === 'ios' ? 'Bildiriş icazəsi' : 'Brauzerdə bağlı'} className="g nperm-d rise">
        <span className="nchip"><NIcon name="belloff" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p>{state === 'ios' ? 'iPhone-da bildiriş yalnız ana ekrana əlavə olunmuş app-da işləyir. Əvvəl “Ana ekrana əlavə edin”, sonra app-ı oradan açıb bildirişləri aktivləşdirin.'
            : 'Bildirişlər brauzer ayarlarında bağlanıb. Ayarlardan icazə verib səhifəni yeniləyin.'}</p>
          {state === 'ios' && <a className="nlink-b" href="#/install" style={{ marginLeft: 0, marginTop: 6 }}>Ana ekrana əlavə edin</a>}
        </div>
      </section>
    );
  }
  const on = state === 'on';
  return (
    <section aria-label="Bildiriş icazəsi" className="g nperm rise">
      <div className={`nperm-l${on ? ' hid' : ''}`} aria-hidden={on}>
        <div className="nperm-h"><span className="nchip"><NIcon name="bell" size={16} /></span><h2>Bildirişləri telefonda alın</h2></div>
        <p className="nperm-p">Çəkiliş xatırlatması, materialların hazır olması və paketin bitməsi haqqında xəbər alın.</p>
        <div className="nperm-b"><button type="button" className="nb nb-p nb-auto" disabled={busy || on} tabIndex={on ? -1 : undefined} onClick={enable}>Aç</button></div>
      </div>
      <div className={`nperm-l${on ? '' : ' hid'}`} aria-hidden={!on}>
        <div className="nperm-h"><span className="nchip nchip-cb"><NIcon name="check" size={16} /></span><h2>Bildirişlər açıqdır</h2></div>
        <p className="nperm-p">Çəkiliş, material və paket xəbərləri telefonunuza gələcək.</p>
        <div className="nperm-b"><button type="button" className="nlink-b" disabled={busy || !on} tabIndex={on ? undefined : -1} onClick={disable}>Söndür</button></div>
      </div>
      {err && <p className="n-meta" role="alert" style={{ gridArea: '2/1', margin: '10px 0 0', color: 'var(--yp-danger)' }}>{err}</p>}
    </section>
  );
}

// --- App açılanda bildiriş sorğusu, yumşaq kartlar və gizli "ping" ---

const subscribe = async (token: string, key: string) => {
  const reg = await ready();
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  await api('/me/push', { token, body: keysOf(sub) });
};

type PushInfo = { key: string; subscribed: boolean };
const infoCache = new Map<string, Promise<PushInfo>>();
function pushInfo(token: string): Promise<PushInfo> {
  let p = infoCache.get(token);
  if (!p) {
    p = (async () => {
      let endpoint = '';
      if (supported && !(isIOS && !standalone)) { try { endpoint = (await (await ready()).pushManager.getSubscription())?.endpoint ?? ''; } catch { /* SW hazır deyil */ } }
      const info = await api<Info>(`/me/push?endpoint=${encodeURIComponent(endpoint)}`, { token });
      return { key: info.public_key, subscribed: info.subscribed && !!endpoint };
    })();
    p.catch(() => infoCache.delete(token));
    infoCache.set(token, p);
  }
  return p;
}

const PING_KEY = 'ypod.ping';
const PING_GAP = 10 * 60_000;
const permission = (): 'default' | 'granted' | 'denied' | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported');

/** Gizli: ən çox 10 dəqiqədə bir; xəta səssiz keçir. */
function ping(token: string, force = false) {
  try {
    const last = Number(localStorage.getItem(PING_KEY) || 0);
    if (!force && Date.now() - last < PING_GAP) return;
    localStorage.setItem(PING_KEY, String(Date.now()));
  } catch { /* gizli rejim */ }
  api('/me/ping', { token, body: { standalone, permission: permission() } }).catch(() => {});
}

const DISMISS_KEY = 'ypod.pushAsk';
const DISMISS_MS = 7 * 24 * 3600_000;
let promptShown = false; // eyni səhifə yüklənməsində təkrar açılmasın
/** «Sonra» seçimi: 7 gün təkrar göstərilmir (yaddaş əlçatmazdırsa yalnız bu açılış). */
const dismissedRecently = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS; } catch { return false; }
};
const rememberDismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* gizli rejim */ } };

const PERKS: [string, string, string][] = [
  ['cal', 'cal', 'Çəkilişdən 1 gün əvvəl xatırlatma'],
  ['wallet', 'cb', 'Beh və keşbek xəbərləri'],
  ['folder', 'mat', 'Materiallar hazır olanda bildiriş'],
];

/** Giriş olunmuş müştəri üçün: ping + tam ekran bildiriş sorğusu + səssiz yenidən abunə. */
export function PushGate() {
  const { token } = useContext(AuthCtx);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    ping(token);
    const on = () => { if (document.visibilityState === 'visible') ping(token); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [token]);

  useEffect(() => {
    let live = true;
    pushInfo(token).then((info) => {
      if (!live || !info.key || !supported || (isIOS && !standalone)) return;
      setKey(info.key);
      const perm = Notification.permission;
      if (perm === 'granted' && !info.subscribed) { infoCache.delete(token); subscribe(token, info.key).catch(() => {}); }
      else if (perm === 'default' && !promptShown && !dismissedRecently()) { promptShown = true; setOpen(true); }
    }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  async function enable() {
    setBusy(true); setErr('');
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') { infoCache.delete(token); await subscribe(token, key); }
      else rememberDismiss();
      ping(token, true);
      setOpen(false);
    } catch { setErr('Bildirişləri açmaq alınmadı. Yenidən cəhd edin və ya sonra Bildirişlər səhifəsindən açın.'); } finally { setBusy(false); }
  }

  function later() { rememberDismiss(); setOpen(false); }

  if (!open) return null;
  return (
    <AuthPage className="npp" label="Bildirişləri açın" dialog>
      <Brand />
      <h1 className="nau-h1 b rz" style={dl(60)}>Bildirişləri açın</h1>
      <ul className="nau-ul">
        {PERKS.map(([ic, tone, t], i) => (
          <li key={t} className="g nau-li rz" style={dl(120 + i * 60)}>
            <span className={`nchip nchip-${tone}`}><NIcon name={ic as 'cal'} size={16} /></span>
            <span className="nau-li-t p">{t}</span>
          </li>
        ))}
      </ul>
      <div className="nau-foot rz" style={dl(300)}>
        {err && <div className="nau-err" role="alert"><NIcon name="alert" size={16} />{err}</div>}
        <button type="button" className="nb nb-p nau-big" disabled={busy} onClick={enable}>Bildirişləri aç</button>
        <button type="button" className="nb nb-s nau-sec" disabled={busy} onClick={later}>Sonra</button>
      </div>
    </AuthPage>
  );
}

/** Ana səhifədə yumşaq kart: icazə bağlıdırsa və ya iPhone-da app ana ekranda deyilsə. */
export function PushHint() {
  const { token } = useContext(AuthCtx);
  const [kind, setKind] = useState<'denied' | 'ios' | null>(null);
  useEffect(() => {
    let live = true;
    pushInfo(token).then((info) => {
      if (!live || !info.key) return;
      if (isIOS && !standalone) return setKind('ios');
      if (supported && Notification.permission === 'denied') setKind('denied');
    }).catch(() => {});
    return () => { live = false; };
  }, [token]);
  if (!kind) return null;
  return (
    <section aria-label={kind === 'ios' ? 'Bildiriş icazəsi' : 'Brauzerdə bağlı'} className="g nperm-d rise">
      <span className="nchip"><NIcon name="bell" size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600 }}>{kind === 'ios' ? 'Bildiriş almaq üçün app-ı ana ekrana əlavə edin' : 'Bildirişlər bağlıdır'}</p>
        <p>
          {kind === 'ios' ? 'iPhone-da bildiriş yalnız ana ekrana əlavə olunmuş app-da işləyir.'
            : isIOS ? 'iPhone: Ayarlar → Bildirişlər → Y Pod → Bildirişlərə icazə ver.'
            : 'Brauzer ayarlarından bu sayt üçün bildirişlərə icazə verin, sonra səhifəni yeniləyin. (iPhone: Ayarlar → Bildirişlər → Y Pod → Bildirişlərə icazə ver.)'}
        </p>
        {kind === 'ios' && <a className="nlink-b" href="#/install" style={{ marginLeft: 0, marginTop: 6 }}>Necə əlavə etmək olar</a>}
      </div>
    </section>
  );
}
