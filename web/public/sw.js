// Faza 0: yalnız quraşdırma üçün. Oflayn keş Faza 1-də əlavə olunur.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
