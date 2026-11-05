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

// Təzə HTML-i keşləyir; HTML-in göstərmədiyi köhnə /assets/ fayllarını silir.
// Admin və müştəri eyni /assets/ qovluğunu bölüşür, ona görə hər HTML-in siyahısı ayrıca saxlanır
// və yalnız heç bir siyahıda olmayan fayllar silinir.
const REFS = SCOPE + '__refs/';
async function storeShell(req, url, res) {
  const cache = await caches.open(CACHE);
  const html = await res.clone().text();
  await cache.put(url.origin + url.pathname, res); // ?i=token kimi sorğu hissəsi keşə düşmür
  const used = new Set();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    try {
      const u = new URL(m[1], req.url);
      if (u.origin === self.location.origin && u.pathname.startsWith(SCOPE + 'assets/')) used.add(u.pathname);
    } catch { /* yararsız URL */ }
  }
  if (!used.size) return; // HTML build faylı göstərmirsə (gözlənilməz cavab) heç nə silmə
  await cache.put(new Request(self.location.origin + REFS + encodeURIComponent(url.pathname)), new Response(JSON.stringify([...used])));
  const keep = new Set(used);
  for (const r of await cache.keys()) {
    const p = new URL(r.url).pathname;
    if (!p.startsWith(REFS)) continue;
    try { (await (await cache.match(r)).json()).forEach((x) => keep.add(x)); } catch { /* pozulmuş siyahı */ }
  }
  for (const r of await cache.keys()) {
    const p = new URL(r.url).pathname;
    if (p.startsWith(SCOPE + 'assets/') && !keep.has(p)) await cache.delete(r);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;

  // Səhifə açılışı: əvvəl şəbəkə (yeni deploy görünsün), oflayn olanda keş.
  // no-cache: brauzerin HTTP keşini (GitHub Pages max-age=600) yoxlamadan keçmək üçün həmişə revalidate.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) e.waitUntil(storeShell(req, url, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((m) => m || caches.match(SCOPE))),
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

// --- Push bildirişləri: payload {title, body, url, tag}; url hash marşrutdur (#/shoots/12) ---
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Y Pod', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: SCOPE + 'icons/icon-192.png',
    badge: SCOPE + 'icons/icon-192.png',
    data: { url: d.url || '#/notifications' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = SCOPE + ((e.notification.data && e.notification.data.url) || '#/notifications');
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith(SCOPE));
      if (!open) return self.clients.openWindow(target);
      return open.focus().then((c) => (c || open).navigate(target)).catch(() => self.clients.openWindow(target));
    }),
  );
});
