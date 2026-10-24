/**
 * Haru's service worker: what makes the installed app open fast and without a connection.
 * - The page: from the network first (so a deploy shows on the next open), the kept copy when offline.
 * - The build's own files (assets/, names change every build): kept at install, then from the cache.
 * - Data and everything else on this site: network first, the last copy when offline.
 * Other sites (Firebase, fonts) go straight to the network.
 * The build (vite.config.ts) writes its id and its file list in for BUILD and ASSETS; a new build makes a new
 * worker, which waits until the page asks it to take over (the "new version" card) or every Haru window closes,
 * so a page that is open keeps the files it was built with.
 */
const BUILD = 'mvm7bapd';
const ASSETS = ["assets/index-CLl8z6ba.css","assets/index-D9unpr1_.js","assets/index.esm-BqERl4ov.js","assets/index.esm-CSFFbSE9.js","assets/index.esm-DLczCD-c.js","assets/index.esm2017-Bhx3z6WW.js"];
const CACHE = `haru-${BUILD}`;
const DATA = 'haru-data';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(['./', ...ASSETS].map((url) => c.add(url).catch(() => {})))),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('haru-') && k !== CACHE && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'take-over') self.skipWaiting();
  // which build this worker is (the page compares it with its own)
  if (e.data === 'build') e.ports[0]?.postMessage(BUILD);
});

/** The network, but not longer than `ms` when there is a copy to fall back on. */
function fresh(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('slow')), ms);
    fetch(req).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const kept = await caches.match('./');
      try {
        const res = await fresh(req, kept ? 4000 : 30000);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
        }
        return res;
      } catch {
        return kept ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith(new URL('assets/', scope).pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })());
    return;
  }

  // data files carry ?v= or ?t= to get past caches: one copy per file, kept without the query
  const key = url.origin + url.pathname;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(DATA).then((c) => c.put(key, copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(key, { cacheName: DATA });
      if (hit) return hit;
      throw err;
    }
  })());
});
