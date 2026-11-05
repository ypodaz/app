// Service worker yeniləməsi: arxa fondan qayıdanda yeni versiyanı yoxlayır,
// yeni SW nəzarəti ələ alanda səhifəni bir dəfə yeniləyir (ilk quraşdırmada yox).
const GUARD = 'ypod.swReload';
const GUARD_MS = 60_000;

/** Son dəqiqədə artıq yenilənibsə false (reload dövrəsinin qarşısı). Storage əlçatmazdırsa da false. */
function mayReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(GUARD) || 0);
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(GUARD, String(Date.now()));
    return true;
  } catch { return false; }
}

export function watchSwUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; } // ilk quraşdırma: yeniləmə lazım deyil
    if (mayReload()) location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    sw.getRegistration().then((r) => r?.update()).catch(() => {});
    checkNewBuild();
  });
}

// sw.js hər deploydə dəyişmir, ona görə yeni build-i HTML-dəki hash-li skript adından tanıyırıq.
let lastCheck = 0;
function checkNewBuild() {
  if (Date.now() - lastCheck < GUARD_MS) return;
  lastCheck = Date.now();
  const cur = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  if (!cur || !cur.includes('/assets/')) return; // dev rejimi
  fetch(location.pathname, { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : ''))
    .then((html) => {
      const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
      if (!m || new URL(m[1], location.href).href === cur) return;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // yazarkən yeniləmə
      if (mayReload()) location.reload();
    })
    .catch(() => {});
}

// Yeni deploydan sonra köhnə səhifə silinmiş chunk-ı yükləyə bilmirsə: yeni versiyaya keç.
window.addEventListener('vite:preloadError', (e) => {
  if (mayReload()) { e.preventDefault(); location.reload(); }
});
