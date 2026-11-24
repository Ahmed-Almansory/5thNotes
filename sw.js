/* Folio 196 platform service worker.
   Cache-first for the shell + data JSONs + visited images; versioned cache
   name so a fresh deploy (new build version) starts a fresh cache instead of
   serving stale files. The shell itself is fetched network-first on
   navigation so a new deploy shows up on the next visit when online, with
   the cached shell as the offline fallback.
   20261125-0000 is stamped by build_platform.py at build time. */
var CACHE = 'folio196-20261125-0000';
var SHELL = ['index.html', 'app.js', 'engine.js', 'logo.jpg', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'data/index.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  /* The app posts {type:'folio-cache', url} after a bank.json loads, because
     that fetch can fire before this worker takes control of the page (so the
     fetch handler above never sees it). Caching it here makes the visited
     bank load offline even after the browser HTTP cache expires. */
  if (event.data && event.data.type === 'folio-cache' &&
      typeof event.data.url === 'string') {
    event.waitUntil(
      caches.open(CACHE).then(function (cache) {
        return cache.add(event.data.url);
      }).catch(function () {})
    );
  }
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* never cache third parties */

  /* navigation: network-first, cached shell as offline fallback.
     cache:'reload' bypasses the browser HTTP cache, so a deploy is never
     masked by a stale cached copy of index.html. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'reload' }).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put('index.html', copy);
        });
        return res;
      }).catch(function () {
        return caches.match('index.html');
      })
    );
    return;
  }

  /* the code shell (app.js, engine.js): network-first too. These change on
     every deploy, and a cache-first read keeps serving the previous build's
     code after an app.js-only deploy (no sw.js bump) — that is exactly how
     the per-bank counter silently never fired on phones that had the first
     service worker installed: their cached app.js predated the counter.
     Offline fallback is the cached copy. */
  var leaf = url.pathname.split('/').pop();
  if (leaf === 'app.js' || leaf === 'engine.js') {
    event.respondWith(
      fetch(req, { cache: 'reload' }).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true });
      })
    );
    return;
  }

  /* everything else same-origin: cache-first, populate on miss */
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.status === 200 || res.status === 0)) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});
