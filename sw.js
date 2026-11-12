// Bump VERSION on every release that changes a precached file: the new worker installs a full copy of the shell before it takes over.
const VERSION = 'v13';
const SHELL = `orbitshow-shell-${VERSION}`;
const RANKS = 'orbitshow-ranks-v1';
const IMAGES = 'orbitshow-images-v1';
const MAX_IMAGES = 150;
const RANK_TIMEOUT = 6000;
const FILES = [
  './', './index.html', './theme.css', './layout.css', './components.css',
  './app.js', './lib.js', './i18n.js', './ui-strings.js', './data.js', './globe.js', './genres.js', './ranks.js', './updates.js', './pwa.js',
  './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png',
  './assets/countries-110m.json', './vendor/d3.min.js', './vendor/topojson.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES.map(file => new Request(file, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  const keep = [SHELL, RANKS, IMAGES];
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('orbitshow-') && !keep.includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

// Rankings change weekly, so the network wins and the last good copy covers offline and slow links.
async function networkFirst(request) {
  const cache = await caches.open(RANKS);
  try {
    const response = await Promise.race([
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), RANK_TIMEOUT))
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

// Posters never change for a given path, so they are served from the cache and the cache is kept small.
async function cachedImage(request) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMAGES)).map(key => cache.delete(key)));
  }
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === 'https://image.tmdb.org') { event.respondWith(cachedImage(request)); return; }
  if (url.origin !== self.location.origin) return;
  const scope = new URL('./', self.registration.scope).pathname;
  if (url.pathname.startsWith(`${scope}ranks/`)) { event.respondWith(networkFirst(request)); return; }
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(SHELL).then(cache => cache.match(new URL('./index.html', self.registration.scope))).then(hit => hit || fetch(request)));
    return;
  }
  if (!FILES.some(file => new URL(file, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(caches.open(SHELL).then(cache => cache.match(request, { ignoreSearch: true })).then(hit => hit || fetch(request)));
});
