// התראות למשימות: הרשמה בטלפון ושמירת המנוי בשרת.
import * as api from './api.js';
import { CONFIG } from './config.js';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const key = b => { const p = '='.repeat((4 - b.length % 4) % 4); const s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };

// on · off · denied · unsupported · needs-install
export async function status() {
  if (!supported()) return standalone() ? 'unsupported' : 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch (e) { return 'off'; }
}

export async function enable() {
  // הבקשה חייבת לצאת ישר מלחיצה, ולכן היא הפעולה הראשונה כאן
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'ההתראות חסומות. אפשר לאשר אותן בהגדרות הטלפון, תחת המגירה' : 'לא אושרו התראות');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(CONFIG.vapid) });
  const j = sub.toJSON();
  await api.upsertSub({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
}

export async function disable() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await api.deleteSub(sub.endpoint); } catch (e) {}
  await sub.unsubscribe();
}

// מספר על האייקון: באיחור ולהיום
export function badge(n) {
  try { if (!navigator.setAppBadge) return; if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge(); } catch (e) {}
}
