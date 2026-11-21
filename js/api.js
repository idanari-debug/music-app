// חיבור לשרת: כניסה, טבלאות ואחסון קבצים. בלי ספריות חיצוניות.
import { CONFIG } from './config.js';

const SKEY = 'mg.session';
let session = null;
try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { session = null; }

function saveSession(s) {
  session = s;
  try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) {}
}

export function currentUser() { return session && session.user; }

// רמת האימות של החיבור הנוכחי: aal1 = סיסמה בלבד, aal2 = סיסמה וקוד חד־פעמי
export function currentAal() {
  try { return JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch (e) { return 'aal1'; }
}
export function hasSession() { return !!(session && session.refresh_token); }

class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.msg || body.message || body.error_description || body.error)) || ('שגיאה ' + status));
    this.status = status; this.body = body;
  }
}

async function parse(res) {
  const t = await res.text();
  let b = null;
  try { b = t ? JSON.parse(t) : null; } catch (e) { b = t; }
  if (!res.ok) throw new ApiError(res.status, b);
  return b;
}

function fromAuth(b) {
  if (!b || !b.access_token) return null;
  return { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: Date.now() + (b.expires_in || 3600) * 1000, user: { id: b.user.id, email: b.user.email } };
}

async function authPost(path, body) {
  const res = await fetch(CONFIG.url + '/auth/v1/' + path, {
    method: 'POST', headers: { apikey: CONFIG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return parse(res);
}

export async function signUp(email, password) {
  const b = await authPost('signup', { email, password });
  const s = fromAuth(b);
  if (s) saveSession(s);
  return { confirmed: !!s };
}

export async function signIn(email, password) {
  const b = await authPost('token?grant_type=password', { email, password });
  saveSession(fromAuth(b));
}

let refreshing = null;
async function refresh() {
  if (!refreshing) {
    refreshing = authPost('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then(b => saveSession(fromAuth(b)))
      .catch(e => { if (e.status === 400 || e.status === 401) saveSession(null); throw e; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function signOut() {
  try { if (session) await req('/auth/v1/logout', { method: 'POST' }); } catch (e) {}
  saveSession(null);
}

async function token() {
  if (!session) throw new ApiError(401, { msg: 'לא מחובר' });
  if (Date.now() > session.expires_at - 60000) await refresh();
  return session.access_token;
}

async function req(path, opts = {}) {
  const t = await token();
  const headers = Object.assign({ apikey: CONFIG.key, Authorization: 'Bearer ' + t }, opts.headers || {});
  let res = await fetch(CONFIG.url + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    await refresh();
    headers.Authorization = 'Bearer ' + session.access_token;
    res = await fetch(CONFIG.url + path, Object.assign({}, opts, { headers }));
  }
  return res;
}

const J = { 'Content-Type': 'application/json' };

// טבלאות
export async function getKeys() {
  const b = await parse(await req('/rest/v1/user_keys?select=*'));
  return b && b[0] || null;
}
export async function putKeys(row) {
  return parse(await req('/rest/v1/user_keys', { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, J), body: JSON.stringify(row) }));
}

export async function listSongs() {
  return parse(await req('/rest/v1/songs?select=id,enc,created_at,updated_at,deleted_at&order=updated_at.desc'));
}
export async function upsertSong(row) {
  return parse(await req('/rest/v1/songs', { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, J), body: JSON.stringify(row) }));
}
export async function deleteSong(id) {
  return parse(await req('/rest/v1/songs?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }));
}

export async function addVersion(song_id, enc) {
  return parse(await req('/rest/v1/song_versions', { method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, J), body: JSON.stringify({ song_id, enc }) }));
}
export async function listVersions(song_id) {
  return parse(await req('/rest/v1/song_versions?select=id,enc,created_at&song_id=eq.' + encodeURIComponent(song_id) + '&order=created_at.desc&limit=50'));
}

export async function listRecordings() {
  return parse(await req('/rest/v1/recordings?select=id,song_id,storage_path,enc_meta,created_at,deleted_at&order=created_at.desc'));
}
export async function upsertRecording(row) {
  return parse(await req('/rest/v1/recordings', { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, J), body: JSON.stringify(row) }));
}
export async function deleteRecording(id) {
  return parse(await req('/rest/v1/recordings?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }));
}

// אחסון קבצים (תמיד מוצפנים לפני העלאה)
const enc = p => p.split('/').map(encodeURIComponent).join('/');
// העלאה עם התקדמות אמיתית: הפס זז לפי הבתים שכבר יצאו מהטלפון.
// אם ההעלאה נעצרת דקה שלמה בלי התקדמות, היא מבוטלת ומנוסה שוב.
export async function uploadFile(path, bytes, onProgress) {
  const send = t => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    let last = Date.now();
    const watch = setInterval(() => { if (Date.now() - last > 60000) { x.abort(); } }, 5000);
    x.open('POST', CONFIG.url + '/storage/v1/object/' + CONFIG.bucket + '/' + enc(path));
    x.setRequestHeader('apikey', CONFIG.key);
    x.setRequestHeader('Authorization', 'Bearer ' + t);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.setRequestHeader('x-upsert', 'true');
    x.upload.onprogress = e => { last = Date.now(); if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { clearInterval(watch); resolve({ status: x.status, text: x.responseText }); };
    x.onerror = () => { clearInterval(watch); reject(new ApiError(0, { msg: 'הרשת נפלה באמצע ההעלאה' })); };
    x.onabort = () => { clearInterval(watch); reject(new ApiError(0, { msg: 'ההעלאה נתקעה ובוטלה' })); };
    x.send(bytes);
  });
  let r = await send(await token());
  if (r.status === 401) { await refresh(); r = await send(session.access_token); }
  if (r.status >= 200 && r.status < 300) return r.text ? JSON.parse(r.text) : null;
  let body = {}; try { body = JSON.parse(r.text); } catch (e) {}
  throw new ApiError(r.status, body);
}
export async function downloadFile(path) {
  const res = await req('/storage/v1/object/authenticated/' + CONFIG.bucket + '/' + enc(path));
  if (!res.ok) await parse(res);
  return new Uint8Array(await res.arrayBuffer());
}
export async function removeFile(path) {
  return parse(await req('/storage/v1/object/' + CONFIG.bucket + '/' + enc(path), { method: 'DELETE' }));
}

// ---------- תזכורות ומנויי התראות ----------
// בשרת נשמרים רק מועד השליחה ותוכן מוצפן. הטקסט נפתח רק במכשיר.
export async function listReminders() { return parse(await req('/rest/v1/reminders?select=id,fire_at,sent_at')); }
export async function upsertReminder(row) {
  return parse(await req('/rest/v1/reminders', { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, J), body: JSON.stringify(row) }));
}
export async function deleteReminder(id) { return parse(await req('/rest/v1/reminders?id=eq.' + encodeURIComponent(id), { method: 'DELETE' })); }
export async function upsertSub(row) {
  return parse(await req('/rest/v1/push_subs?on_conflict=endpoint', { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, J), body: JSON.stringify(row) }));
}
export async function deleteSub(endpoint) { return parse(await req('/rest/v1/push_subs?endpoint=eq.' + encodeURIComponent(endpoint), { method: 'DELETE' })); }

// ---------- אימות דו־שלבי ----------
export async function getUser() { return parse(await req('/auth/v1/user')); }
export async function verifiedFactors() {
  const u = await getUser();
  return (u.factors || []).filter(f => f.factor_type === 'totp' && f.status === 'verified');
}
export async function mfaEnroll() {
  // מנקה ניסיונות הרשמה קודמים שלא הושלמו
  const u = await getUser();
  for (const f of (u.factors || []).filter(f => f.status !== 'verified')) { try { await parse(await req('/auth/v1/factors/' + f.id, { method: 'DELETE' })); } catch (e) {} }
  return parse(await req('/auth/v1/factors', { method: 'POST', headers: J, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'המגירה ' + new Date().toISOString().slice(0, 10) }) }));
}
export async function mfaVerify(factorId, code) {
  const ch = await parse(await req('/auth/v1/factors/' + factorId + '/challenge', { method: 'POST', headers: J, body: '{}' }));
  const b = await parse(await req('/auth/v1/factors/' + factorId + '/verify', { method: 'POST', headers: J, body: JSON.stringify({ challenge_id: ch.id, code }) }));
  const s = fromAuth(b); if (s) saveSession(s);
}
export async function mfaUnenroll(factorId) {
  return parse(await req('/auth/v1/factors/' + factorId, { method: 'DELETE' }));
}
