/* Service worker – Visite Chantier : met en cache l'application pour un usage hors ligne. */
const CACHE = 'visite-chantier-v1.1.0';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.json',
  './vendor/jszip.min.js', './apple-touch-icon.png',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/favicon-32.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // API d'adresse : réseau uniquement
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(r => r || fetch(req)).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(resp => {
    if (resp && resp.ok && resp.type === 'basic') { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return resp;
  })));
});
