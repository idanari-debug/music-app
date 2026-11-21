// שומר את קבצי האפליקציה במכשיר כדי שתיפתח גם בלי קליטה.
// לא שומר שום תוכן: השירים נשמרים מוצפנים בנפרד, וההקלטות לא נשמרות כאן.
const V = 'megira-v12';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'js/app.js', 'js/api.js', 'js/store.js', 'js/db.js', 'js/crypto.js', 'js/chords.js', 'js/audio.js', 'js/importer.js', 'js/config.js', 'js/passkey.js', 'js/theme.js', 'js/tasks.js', 'js/notify.js', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/favicon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // רשת קודם, כדי לקבל עדכונים; מטמון כשאין קליטה
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
  } else if (u.hostname.endsWith('fonts.googleapis.com') || u.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); return res; })));
  }
});

// ---------- התראות על משימות ----------
// השרת שולח רק תוכן מוצפן. כאן הוא נפתח במפתח ההתראות ששמור במכשיר.
// אם אין מפתח (למשל אחרי התנתקות), מוצגת התראה כללית בלי פרטים.
function kvGet(k) {
  return new Promise(res => {
    const r = indexedDB.open('megira');
    r.onsuccess = () => { try { const q = r.result.transaction('kv', 'readonly').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch (e) { res(null); } };
    r.onerror = () => res(null);
  });
}
async function onPush(e) {
  let j = {}; try { j = e.data ? e.data.json() : {}; } catch (x) {}
  let title = 'תזכורת מהמגירה', body = 'יש משימה שמחכה לך', data = {};
  try {
    const k = await kvGet('nk');
    if (k && j.p && j.p.startsWith('v1.')) {
      const raw = Uint8Array.from(atob(j.p.slice(3)), c => c.charCodeAt(0));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, k, raw.subarray(12));
      const o = JSON.parse(new TextDecoder().decode(pt));
      title = o.t; body = o.s + (o.l ? ' · ' + o.l : ''); data = { song: o.id };
    }
  } catch (x) {}
  await self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: j.id || undefined, data, lang: 'he', dir: 'rtl' });
}
self.addEventListener('push', e => e.waitUntil(onPush(e)));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const song = e.notification.data && e.notification.data.song;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) { try { await c.focus(); if (song) c.postMessage({ type: 'openSong', song }); return; } catch (x) {} }
    await self.clients.openWindow('./' + (song ? '?song=' + encodeURIComponent(song) : ''));
  })());
});
