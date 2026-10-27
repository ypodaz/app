// Tətbiq qabığı keşi: yalnız /app/ altında eyni mənşəli GET. API və başqa mənşələr keşlənmir.
// Cache adını dəyişmək köhnə keşləri silir (activate).
const CACHE = 'ypod-shell-v1';
const SCOPE = new URL(self.registration.scope).pathname; // məs. /app/

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;

  // Səhifə açılışı: əvvəl şəbəkə (yeni deploy görünsün), oflayn olanda keş.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return res; })
        .catch(() => caches.match(req).then((m) => m || caches.match(SCOPE))),
    );
    return;
  }

  // Hash-li build faylları və ikonlar: əvvəl keş.
  if (url.pathname.startsWith(SCOPE + 'assets/') || url.pathname.startsWith(SCOPE + 'icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); }
        return res;
      })),
    );
  }
});
