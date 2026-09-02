// Простий offline-кеш для сторінки розкладу.
// Версію CACHE_NAME підняти при зміні складу ASSETS (іконки, manifest, набір
// розкладів). index.html і schedules/*.json і так тягнуться network-first,
// тому заради правки розкладу версію бампати не треба.
const CACHE_NAME = 'rozklad-7b-v20260902-schedules';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './schedules/index.json',
  './schedules/class7B.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isScheduleJson(url) {
  return url.includes('/schedules/') && url.split('?')[0].endsWith('.json');
}

// Network-first для index.html і для JSON розкладів (щоб бачити свіжі дані,
// якщо є мережа), cache-first для решти статики. У обох гілках успішна
// відповідь пишеться в кеш — інакше новий розклад ніколи не став би офлайновим.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate' || req.url.endsWith('index.html') || isScheduleJson(req.url)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((res) =>
            res || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)
          )
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
