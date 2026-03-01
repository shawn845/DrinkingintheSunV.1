// service-worker.js
const CACHE_VERSION = 'v17';
const CACHE_NAME = `drinking-in-the-sun-${CACHE_VERSION}`;
const RUNTIME = `drinking-in-the-sun-runtime-${CACHE_VERSION}`;

const CORE = [
  './',
  './index.html',
  './manifest.json',
  './service-worker.js',
  './public/styles.css',
  './public/app.js',
  './public/icons/icon-192.png',
  './public/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME && k !== RUNTIME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network-first for navigations
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(RUNTIME);
        c.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  // Network-first for CSV data
  if (url.origin === self.location.origin && url.pathname.endsWith('/public/data/DrinkingintheSunData.csv')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const c = await caches.open(RUNTIME);
        c.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || new Response('', { status: 503 });
      }
    })());
    return;
  }

  // Cache-first for same-origin assets
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const fresh = await fetch(req);
      const c = await caches.open(RUNTIME);
      c.put(req, fresh.clone());
      return fresh;
    })());
    return;
  }

  // Cross-origin: network best-effort
  event.respondWith(fetch(req));
});
