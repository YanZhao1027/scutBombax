/* Cache same-origin PWA shell only. No cross-origin intercept or background requests. */
const CACHE = 'huagongmumian-ios-pwa-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Hashed JS/CSS assets are in the built HTML, not known at source-edit time.
    // Cache them during installation so the FIRST installed visit works offline.
    const shell = await cache.match('/index.html');
    if (!shell) throw new Error('offline shell missing');
    const html = await shell.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)]
      .map(match => match[1]);
    if (!assets.some(path => path.endsWith('.js'))) throw new Error('offline script missing');
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(response => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then(cache => cache.put('/index.html', copy));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match('/index.html');
        return cached ?? Response.error();
      })
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(cached => cached ?? fetch(req).then(response => {
      if (!response.ok) return response;
      const copy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(req, copy));
      return response;
    }))
  );
});
