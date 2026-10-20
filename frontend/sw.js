// Parkistics Service Worker — Heavy Internet, Time, & Offline Optimization
// Features: Stale-While-Revalidate asset caching, OpenStreetMap Tile Cache with LRU bounds,
// and zero-network offline resilience.

const CACHE_STATIC = 'parkistics-static-v1';
const CACHE_TILES = 'parkistics-tiles-v1';
const MAX_TILES_CACHED = 150; // Strict space optimization: keep tile storage < 5MB

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache asset fetch warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_STATIC && key !== CACHE_TILES) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Trim cache to maximum allowed size (LRU eviction)
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map((req) => cache.delete(req)));
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. OpenStreetMap Tile Caching (Cache-First + LRU bound)
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_TILES).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const networkRes = await fetch(event.request, { mode: 'cors' });
          if (networkRes.ok) {
            cache.put(event.request, networkRes.clone());
            trimCache(CACHE_TILES, MAX_TILES_CACHED);
          }
          return networkRes;
        } catch (err) {
          // If offline and tile not cached, return transparent fallback pixel
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f1f5f9"/></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        }
      })
    );
    return;
  }

  // 2. Static Assets (CSS, JS, Fonts, Images) — Stale-While-Revalidate
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('unpkg.com')
  ) {
    event.respondWith(
      caches.open(CACHE_STATIC).then(async (cache) => {
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

  // 3. API Requests — Network First with fallback
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response(
          JSON.stringify({ error: 'offline', message: 'Network offline. Using local client intelligence.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // Default fetch
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
