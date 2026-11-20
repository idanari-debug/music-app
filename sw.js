// שומר את קבצי האפליקציה במכשיר כדי שתיפתח גם בלי קליטה.
// לא שומר שום תוכן: השירים נשמרים מוצפנים בנפרד, וההקלטות לא נשמרות כאן.
const V = 'megira-v9';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'js/app.js', 'js/api.js', 'js/store.js', 'js/db.js', 'js/crypto.js', 'js/chords.js', 'js/audio.js', 'js/importer.js', 'js/config.js', 'js/passkey.js', 'js/theme.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/favicon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // רשת קודם, כדי לקבל עדכונים; מטמון כשאין קליטה
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
  } else if (u.hostname.endsWith('fonts.googleapis.com') || u.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); return res; })));
  }
});
