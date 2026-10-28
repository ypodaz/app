import { useContext, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { Button, Card, Icon } from '../shared/ui';
import { AuthCtx, XIcon } from './core';
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
  return (
    <Card>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="ic"><XIcon name="bell" size={20} /></span>
        <span className="col grow" style={{ gap: 4, minWidth: 0 }}>
          {state === 'on' ? <span className="t14 w8">Bildirişlər açıqdır</span> : <span className="t14 w8">Bildirişləri telefonda alın</span>}
          <span className="t13 soft lh">
            {state === 'ios' ? 'iPhone-da bildiriş yalnız ana ekrana əlavə olunmuş app-da işləyir. Əvvəl “Ana ekrana əlavə edin”, sonra app-ı oradan açıb bildirişləri aktivləşdirin.'
              : state === 'denied' ? 'Bildirişlər brauzer ayarlarında bağlanıb. Ayarlardan icazə verib səhifəni yeniləyin.'
              : state === 'on' ? 'Çəkiliş, material və paket xəbərləri telefonunuza gələcək.'
              : 'Çəkiliş xatırlatması, materialların hazır olması və paketin bitməsi haqqında xəbər alın.'}
          </span>
        </span>
      </div>
      {state === 'ios' && <a className="btn btn-out btn-sm" href="#/install">Ana ekrana əlavə edin</a>}
      {state === 'off' && <Button small disabled={busy} onClick={enable}>Bildirişləri aç</Button>}
      {state === 'on' && <Button variant="out" small disabled={busy} onClick={disable}>Söndür</Button>}
      {err && <p className="err" role="alert">{err}</p>}
    </Card>
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

let promptShown = false; // yalnız bu açılış (səhifə yüklənməsi) üçün

const PERKS: [string, string][] = [
  ['calendar', 'Çəkilişdən 1 gün əvvəl xatırlatma'],
  ['wallet', 'Beh və keşbek xəbərləri'],
  ['media', 'Materiallar hazır olanda bildiriş'],
];

/** Giriş olunmuş müştəri üçün: ping + tam ekran bildiriş sorğusu + səssiz yenidən abunə. */
export function PushGate() {
  const { token } = useContext(AuthCtx);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

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
      else if (perm === 'default' && !promptShown) { promptShown = true; setOpen(true); }
    }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  async function enable() {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) === 'granted') { infoCache.delete(token); await subscribe(token, key); }
      ping(token, true);
    } catch { /* Bildirişlər səhifəsində yenidən cəhd olunur */ } finally { setBusy(false); setOpen(false); }
  }

  if (!open) return null;
  return (
    <main className="scr pp" role="dialog" aria-modal="true" aria-label="Bildirişləri açın"><div className="au">
      <span className="ic ic-l ic-grad mt2"><XIcon name="bell" size={28} /></span>
      <h1 className="h1">Bildirişləri açın</h1>
      <div className="list">
        {PERKS.map(([ic, t]) => (
          <div key={t} className="li">
            <span className="ic"><Icon name={ic as 'wallet'} size={20} /></span>
            <span className="col grow"><span className="t15 w8">{t}</span></span>
          </div>
        ))}
      </div>
      <div className="grow" />
      <Button disabled={busy} onClick={enable}>Bildirişləri aç</Button>
      <Button variant="ghost" small disabled={busy} onClick={() => setOpen(false)}>Sonra</Button>
    </div></main>
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
    <Card>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <span className="ic"><XIcon name="bell" size={20} /></span>
        <span className="col grow" style={{ gap: 4, minWidth: 0 }}>
          <span className="t14 w8">{kind === 'ios' ? 'Bildiriş almaq üçün app-ı ana ekrana əlavə edin' : 'Bildirişlər bağlıdır'}</span>
          <span className="t13 soft lh">
            {kind === 'ios' ? 'iPhone-da bildiriş yalnız ana ekrana əlavə olunmuş app-da işləyir.'
              : isIOS ? 'iPhone: Ayarlar → Bildirişlər → Y Pod → Bildirişlərə icazə ver.'
              : 'Brauzer ayarlarından bu sayt üçün bildirişlərə icazə verin, sonra səhifəni yeniləyin. (iPhone: Ayarlar → Bildirişlər → Y Pod → Bildirişlərə icazə ver.)'}
          </span>
        </span>
      </div>
      {kind === 'ios' && <a className="btn btn-out btn-sm" href="#/install">Necə əlavə etmək olar</a>}
    </Card>
  );
}
