/* Cookmate service worker — deliberately minimal.
 * Network-first for same-origin page loads with an offline fallback;
 * cache-first for our static icons. Nothing else is intercepted:
 * the API lives on another origin (SSE, carts, payments) and must
 * never be served stale. */

const CACHE = 'cookmate-shell-v1';
const PRECACHE = ['/offline.html', '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API + fonts pass through untouched

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  if (url.pathname.endsWith('.png')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
