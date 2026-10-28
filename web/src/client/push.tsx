import { useContext, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { Button, Card } from '../shared/ui';
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
