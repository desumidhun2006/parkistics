// Parkistics Service Worker v4 — Reliable PWA Cache
// Caches core static assets and APIs safely without interfering with map tiles or CORS.

const CACHE_NAME = 'parkistics-static-v6';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache warning:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. NEVER intercept map tiles or external tile providers — allow browser & CDN to handle them natively
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('cartocdn.com') ||
    url.hostname.includes('openstreetmap.org')
  ) {
    return; // Pass through to browser default network stack
  }

  // 2. Navigations & HTML — Network First (fresh deploys show immediately), cache fallback for offline
  if (
    url.origin === self.location.origin &&
    (url.pathname === '/' || url.pathname.endsWith('.html'))
  ) {
    event.respondWith(
      fetch(event.request).then((networkRes) => {
        if (networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkRes;
      }).catch(() =>
        caches.open(CACHE_NAME).then(cache =>
          cache.match(event.request).then(cached =>
            cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } })
          )
        )
      )
    );
    return;
  }

  // 3. Static first-party assets (JS, CSS, manifest) — Stale-While-Revalidate
  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.json'))
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request).then((networkRes) => {
          if (networkRes.ok) {
            cache.put(event.request, networkRes.clone());
          }
          return networkRes;
        }).catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  // 4. API Requests — Network First with fallback
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response(
          JSON.stringify({ error: 'offline', message: 'Offline mode active.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // Default fetch
  event.respondWith(
    caches.match(event.request).then((res) => res || fetch(event.request))
  );
});
