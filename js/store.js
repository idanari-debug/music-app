// מצב האפליקציה: שירים והקלטות מפוענחים בזיכרון בלבד, סנכרון מול השרת ותור שינויים.
import * as api from './api.js';
import * as C from './crypto.js';
import { CONFIG } from './config.js';
import * as TK from './tasks.js';
import { kv, songsCache, recsCache, outbox, wipeLocal } from './db.js';

// זיגוגים: הצבע עצמו מוגדר בקובץ העיצוב, פעם ליום ופעם ללילה
export const GLAZES = [
  { k: 'celadon', name: 'סלדון' }, { k: 'lilac', name: 'לילך' }, { k: 'terra', name: 'טרקוטה' },
  { k: 'ash', name: 'תכלת אפר' }, { k: 'ochre', name: 'אוקר' }, { k: 'rose', name: 'ורוד עפר' },
  { k: 'stone', name: 'אבן' }, { k: 'moss', name: 'טחב' }, { k: 'plum', name: 'שזיף' }, { k: 'slate', name: 'צפחה' }
];
export const glazeVar = g => 'var(--g-' + (GLAZES.some(x => x.k === g) ? g : 'stone') + ')';

// המגירות הקבועות של גרסה 1. המפתחות נשמרים כמו שהם, כדי שכל שיר קיים יישאר במגירה שלו.
const DEFAULT_DRAWERS = [
  { k: 'ready', name: 'מוכן', glaze: 'celadon' },
  { k: 'close', name: 'קרוב', glaze: 'lilac' },
  { k: 'dev', name: 'בפיתוח', glaze: 'terra' },
  { k: 'trans', name: 'תרגום', glaze: 'ash' },
  { k: 'spark', name: 'ניצוץ', glaze: 'ochre' },
  { k: 'raw', name: 'חומר גלם', glaze: 'rose' },
  { k: 'bottom', name: 'המגירה התחתונה', glaze: 'stone' }
];

// ההגדרות האישיות (מגירות וסדר ידני) נשמרות כרשומה מוצפנת אחת בתוך טבלת השירים,
// באותה הצפנה בדיוק. כך לא צריך שום שינוי בשרת, והן נכנסות גם לגיבוי.
const isMeta = s => !!(s && s.data && s.data.__meta);
export function metaRec() {
  let best = null;
  for (const s of S.songs.values()) if (isMeta(s) && !s.deleted_at && (!best || (s.data.editedAt || '') > (best.data.editedAt || ''))) best = s;
  return best;
}
export const meta = () => (metaRec() || { data: {} }).data;
export async function saveMeta(patch) {
  const m = metaRec();
  const data = Object.assign({ __meta: true, title: '__meta', drawers: null, order: {} }, m ? m.data : {}, patch);
  await saveSong(m ? m.id : uid(), data);
}
export function drawers() {
  const d = meta().drawers;
  if (!Array.isArray(d) || !d.length) return DEFAULT_DRAWERS;
  const list = d.filter(x => x.k !== 'bottom');
  return list.concat(d.find(x => x.k === 'bottom') || DEFAULT_DRAWERS[6]);
}
export async function saveDrawers(list) {
  const rest = list.filter(x => x.k !== 'bottom');
  const bottom = list.find(x => x.k === 'bottom') || DEFAULT_DRAWERS[6];
  await saveMeta({ drawers: rest.concat(bottom).map(x => ({ k: x.k, name: String(x.name || '').trim() || 'מגירה', glaze: x.glaze || 'stone' })) });
}
export function stageOf(k) {
  const ds = drawers();
  return ds.find(s => s.k === k) || ds.find(s => s.k === 'raw') || ds[ds.length - 1];
}
export const orderOf = k => ((meta().order || {})[k]) || [];
export async function saveOrder(k, ids) { const o = Object.assign({}, meta().order || {}); o[k] = ids; await saveMeta({ order: o }); }

// משימות לשיר. שיר ישן שיש לו רק "צעד הבא" מקבל אותו כמשימה ראשונה.
export const TASK_TYPES = ['כתיבה', 'הקלטה', 'הפקה', 'אחר'];
export const openTasks = s => tasksOf(s).filter(t => !t.done);
export function tasksOf(s) {
  if (Array.isArray(s.data.tasks)) return s.data.tasks;
  return s.data.next ? [{ id: 'n0', text: s.data.next, type: 'אחר', done: false }] : [];
}
export const nextOf = s => { const t = TK.sortTasks(openTasks(s))[0]; return t ? t.text : ''; };
export const POTS = ['גבוה', 'בינוני', 'נמוך', 'צדדי'];
export const KINDS = [
  { k: 'sketch', name: 'סקיצה' },
  { k: 'voice', name: 'הקלטה קולית' },
  { k: 'guitar', name: 'ליין גיטרה' },
  { k: 'beat', name: 'טייפ ביט' },
  { k: 'final', name: 'הקלטה סופית' }
];
export const kindName = k => (KINDS.find(x => x.k === k) || KINDS[1]).name;

let key = null;
export const S = { songs: new Map(), recs: new Map(), online: navigator.onLine, pending: 0, lastSync: null };
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
export const isUnlocked = () => !!key;
export const getKey = () => key;

// ---------- כספת ----------
export async function vaultState() {
  let row = null;
  try { row = await api.getKeys(); if (row) await kv.set('keys', row); }
  catch (e) { if (e.status === 401) throw e; row = await kv.get('keys'); }
  return row;
}

export async function createVault(passphrase) {
  const master = await C.newMasterKey();
  const salt = C.b64.enc(C.randomBytes(16));
  const rsalt = C.b64.enc(C.randomBytes(16));
  const rk = C.newRecoveryKey();
  const it = CONFIG.kdfIterations;
  const row = {
    kdf_salt: salt, kdf_iterations: it,
    wrapped_key_password: await C.wrap(master, await C.deriveKek(passphrase, salt, it)),
    recovery_salt: rsalt,
    wrapped_key_recovery: await C.wrap(master, await C.deriveKek(C.normRecovery(rk), rsalt, it)),
    key_check: await C.encJSON(master, { check: 'megira' })
  };
  await api.putKeys(row);
  await kv.set('keys', row);
  key = master;
  return rk;
}

async function checkKey(k, row) {
  const v = await C.decJSON(k, row.key_check);
  if (!v || v.check !== 'megira') throw new Error('bad-key');
}

export async function unlock(passphrase, row, remember) {
  let k;
  try { k = await C.unwrap(row.wrapped_key_password, await C.deriveKek(passphrase, row.kdf_salt, row.kdf_iterations)); }
  catch (e) { throw new Error('סיסמת הכספת שגויה'); }
  await checkKey(k, row);
  key = k;
  if (remember) await kv.set('mk', await C.nonExtractableCopy(k)); else await kv.del('mk');
}

export async function unlockWithRecovery(recovery, newPass, row) {
  let k;
  try { k = await C.unwrap(row.wrapped_key_recovery, await C.deriveKek(C.normRecovery(recovery), row.recovery_salt, row.kdf_iterations)); }
  catch (e) { throw new Error('מפתח השחזור שגוי'); }
  await checkKey(k, row);
  key = k;
  await changePassphrase(newPass, row);
}

export async function changePassphrase(newPass, row) {
  const salt = C.b64.enc(C.randomBytes(16));
  const next = Object.assign({}, row, { kdf_salt: salt, wrapped_key_password: await C.wrap(key, await C.deriveKek(newPass, salt, row.kdf_iterations)) });
  delete next.created_at; delete next.updated_at;
  await api.putKeys(next);
  await kv.set('keys', next);
  await kv.del('mk');
}

export async function newRecovery(row) {
  const rsalt = C.b64.enc(C.randomBytes(16));
  const rk = C.newRecoveryKey();
  const next = Object.assign({}, row, { recovery_salt: rsalt, wrapped_key_recovery: await C.wrap(key, await C.deriveKek(C.normRecovery(rk), rsalt, row.kdf_iterations)) });
  delete next.created_at; delete next.updated_at;
  await api.putKeys(next);
  await kv.set('keys', next);
  return rk;
}

export async function rememberHere() { if (key) await kv.set('mk', await C.nonExtractableCopy(key)); }

export async function masterFromPass(passphrase, row) {
  let k;
  try { k = await C.unwrap(row.wrapped_key_password, await C.deriveKek(passphrase, row.kdf_salt, row.kdf_iterations)); }
  catch (e) { throw new Error('סיסמת הכספת שגויה'); }
  await checkKey(k, row);
  return k;
}
export async function unlockWithKey(k, row) { await checkKey(k, row); key = k; }

export async function tryRemembered(row) {
  const k = await kv.get('mk');
  if (!k || !row) return false;
  try { await checkKey(k, row); key = k; return true; } catch (e) { await kv.del('mk'); return false; }
}

export async function lock() { key = null; S.songs.clear(); S.recs.clear(); await kv.del('mk'); }
export async function signOutAll() { await lock(); await wipeLocal(); await api.signOut(); }

// ---------- טעינה וסנכרון ----------
async function decodeSong(row) {
  return { id: row.id, data: await C.decJSON(key, row.enc), created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at || null };
}
async function decodeRec(row) {
  return { id: row.id, song_id: row.song_id, path: row.storage_path, meta: await C.decJSON(key, row.enc_meta), created_at: row.created_at, deleted_at: row.deleted_at || null };
}

export async function loadLocal() {
  const [rows, recs] = await Promise.all([songsCache.all(), recsCache.all()]);
  for (const r of rows) { try { S.songs.set(r.id, await decodeSong(r)); } catch (e) {} }
  for (const r of recs) { try { S.recs.set(r.id, await decodeRec(r)); } catch (e) {} }
  S.pending = (await outbox.all()).length;
  emit();
}

let syncing = false;
export async function sync() {
  if (syncing || !key) return;
  syncing = true;
  try {
    await flush();
    const pendOps = await outbox.all();
    const pend = new Set(pendOps.map(o => o.id));
    const [rows, recs] = await Promise.all([api.listSongs(), api.listRecordings()]);
    // הגנה: אם השרת פתאום מחזיר מגירה ריקה בזמן שבמכשיר יש שירים, לא מוחקים את העותק המקומי
    if (rows.length === 0 && S.songs.size > 0) { const e = new Error('השרת החזיר מגירה ריקה. העותק במכשיר נשמר בלי שינוי'); e.suspicious = true; throw e; }
    const seen = new Set();
    for (const r of rows) {
      seen.add(r.id);
      if (pend.has(r.id)) continue;
      try { S.songs.set(r.id, await decodeSong(r)); } catch (e) { console.warn('decode', r.id); }
    }
    for (const id of [...S.songs.keys()]) if (!seen.has(id) && !pend.has(id)) S.songs.delete(id);
    await songsCache.clear(); await songsCache.putMany(rows);
    await songsCache.putMany(pendOps.filter(o => o.kind === 'song').map(o => Object.assign({ created_at: null, updated_at: null }, o.row)));
    const rseen = new Set();
    for (const r of recs) { rseen.add(r.id); if (pend.has(r.id)) continue; try { S.recs.set(r.id, await decodeRec(r)); } catch (e) {} }
    for (const id of [...S.recs.keys()]) if (!rseen.has(id) && !pend.has(id)) S.recs.delete(id);
    await recsCache.clear(); await recsCache.putMany(recs);
    await recsCache.putMany(pendOps.filter(o => o.kind === 'rec').map(o => Object.assign({ created_at: null }, o.row)));
    S.lastSync = new Date(); S.online = true;
  } catch (e) {
    if (e.status === 401) throw e;
    if (e.suspicious) S.warning = e.message;
    S.online = false;
  } finally { syncing = false; emit(); }
}

let flushP = null, flushAgain = false;
function flush() {
  if (flushP) { flushAgain = true; return flushP; }
  flushP = (async () => { do { flushAgain = false; await flushOnce(); } while (flushAgain); })().finally(() => { flushP = null; });
  return flushP;
}

async function flushOnce() {
  const ops = (await outbox.all()).sort((a, b) => a.ts - b.ts);
  for (const op of ops) {
    try {
      if (op.kind === 'song') await api.upsertSong(op.row);
      else if (op.kind === 'rec') await api.upsertRecording(op.row);
      else if (op.kind === 'version') await api.addVersion(op.row.song_id, op.row.enc);
      await outbox.del(op.key);
    } catch (e) {
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429) { console.error('נדחה', op, e); await outbox.put(Object.assign({}, op, { failed: String(e.message || e.status) })); continue; }
      S.online = false; break;
    }
  }
  S.pending = (await outbox.all()).length;
}

async function queue(kind, id, row) {
  await outbox.put({ key: kind + ':' + id + (kind === 'version' ? ':' + Date.now() : ''), kind, id, row, ts: Date.now() });
  S.pending++;
  flush().then(emit, emit);
}

// ---------- שירים ----------
export const songs = () => [...S.songs.values()].filter(s => !s.deleted_at && !isMeta(s));
export const trashedSongs = () => [...S.songs.values()].filter(s => s.deleted_at && !isMeta(s));
export const recsOf = id => [...S.recs.values()].filter(r => r.song_id === id && !r.deleted_at).sort((a, b) => (b.meta.date || '').localeCompare(a.meta.date || ''));
export const trashedRecs = () => [...S.recs.values()].filter(r => r.deleted_at && !(S.songs.get(r.song_id) || {}).deleted_at);

export function blankSong(over = {}) {
  const now = new Date().toISOString();
  return Object.assign({ title: 'שיר חדש', stage: 'spark', readiness: null, potential: 'בינוני', next: '', notes: '', lyrics: '', beats: [], pinned: false, created: now, editedAt: now, sourceDate: '', log: [{ d: now, e: 'נוצר' }] }, over);
}

export async function saveSong(id, data, { logEntry, deleted_at } = {}) {
  const prev = S.songs.get(id);
  const now = new Date().toISOString();
  data = Object.assign({}, data, { editedAt: now });
  if (logEntry) data.log = [{ d: now, e: logEntry }].concat(data.log || []).slice(0, 200);
  const del = deleted_at !== undefined ? deleted_at : (prev ? prev.deleted_at : null);
  const encd = await C.encJSON(key, data);
  const row = { id, enc: encd, deleted_at: del };
  S.songs.set(id, { id, data, created_at: prev ? prev.created_at : now, updated_at: now, deleted_at: del });
  await songsCache.put(Object.assign({ created_at: prev ? prev.created_at : now, updated_at: now }, row));
  emit();
  await queue('song', id, row);
  return id;
}

export async function createSong(over) {
  const id = uid();
  await saveSong(id, blankSong(over));
  return id;
}

export async function addVersion(id, lyrics, title) {
  const encd = await C.encJSON(key, { lyrics, title, at: new Date().toISOString() });
  await queue('version', id, { song_id: id, enc: encd });
}

export async function versions(id) {
  const rows = await api.listVersions(id);
  const out = [];
  for (const r of rows) { try { out.push(Object.assign({ id: r.id, created_at: r.created_at }, await C.decJSON(key, r.enc))); } catch (e) {} }
  return out;
}

export async function trashSong(id) {
  const s = S.songs.get(id);
  await saveSong(id, s.data, { logEntry: 'הועבר לסל המחזור', deleted_at: new Date().toISOString() });
}
export async function restoreSong(id) {
  const s = S.songs.get(id);
  await saveSong(id, s.data, { logEntry: 'שוחזר מסל המחזור', deleted_at: null });
}

export async function purgeSong(id) {
  await flush();
  for (const r of [...S.recs.values()].filter(r => r.song_id === id)) {
    for (const p of partPaths(r)) { try { await api.removeFile(p); } catch (e) {} }
  }
  await api.deleteSong(id);
  S.songs.delete(id);
  for (const r of [...S.recs.values()]) if (r.song_id === id) { S.recs.delete(r.id); await recsCache.del(r.id); }
  await songsCache.del(id);
  emit();
}

// ---------- הקלטות ----------
// קובץ כבד מתפצל לחתיכות מוצפנות, כל אחת מתחת למגבלת השרת. חתיכה ראשונה בנתיב הרגיל, השאר עם סיומת מספר.
const PART = 45 * 1048576;
export const partPaths = r => { const n = (r.meta && r.meta.parts) || 1; const out = [r.path]; for (let i = 1; i < n; i++) out.push(r.path + '.' + i); return out; };
async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries - 1) throw e; await new Promise(r => setTimeout(r, 1200 * (i + 1))); }
  }
}
export async function addRecording(songId, bytes, meta, onProgress) {
  const id = uid();
  const u = api.currentUser();
  const path = u.id + '/' + id + '.bin';
  const n = Math.max(1, Math.ceil(bytes.length / PART));
  const done = [];
  let size = 0;
  try {
    for (let i = 0; i < n; i++) {
      const p = i ? path + '.' + i : path;
      const encd = await C.encBytes(key, bytes.subarray(i * PART, Math.min(bytes.length, (i + 1) * PART)));
      await retry(() => api.uploadFile(p, encd, f => onProgress && onProgress((i + f) / n, i, n)));
      done.push(p); size += encd.length;
      onProgress && onProgress((i + 1) / n, i + 1, n);
    }
  } catch (e) {
    for (const p of done) { try { await api.removeFile(p); } catch (x) {} }
    throw e;
  }
  meta = Object.assign({ size, date: new Date().toISOString() }, meta);
  if (n > 1) meta.parts = n; else delete meta.parts;
  const row = { id, song_id: songId, storage_path: path, enc_meta: await C.encJSON(key, meta), deleted_at: null };
  await api.upsertRecording(row);
  const rec = { id, song_id: songId, path, meta, created_at: meta.date, deleted_at: null };
  S.recs.set(id, rec);
  await recsCache.put(Object.assign({ created_at: meta.date }, row));
  emit();
  return rec;
}

export async function updateRecording(id, metaPatch, deleted_at) {
  const r = S.recs.get(id);
  const meta = Object.assign({}, r.meta, metaPatch || {});
  const del = deleted_at !== undefined ? deleted_at : r.deleted_at;
  const row = { id, song_id: r.song_id, storage_path: r.path, enc_meta: await C.encJSON(key, meta), deleted_at: del };
  S.recs.set(id, Object.assign({}, r, { meta, deleted_at: del }));
  await recsCache.put(Object.assign({ created_at: r.created_at }, row));
  emit();
  await queue('rec', id, row);
}

export async function purgeRecording(id) {
  await flush();
  const r = S.recs.get(id);
  const ps = partPaths(r);
  await api.removeFile(ps[0]);
  for (const p of ps.slice(1)) { try { await api.removeFile(p); } catch (e) {} }
  await api.deleteRecording(id);
  S.recs.delete(id); await recsCache.del(id);
  emit();
}

const audioCache = new Map();
export async function recordingUrl(id) {
  if (audioCache.has(id)) return audioCache.get(id);
  const r = S.recs.get(id);
  const bytes = await recordingBytes(id);
  const url = URL.createObjectURL(new Blob([bytes], { type: r.meta.mime || 'audio/mp4' }));
  audioCache.set(id, url);
  return url;
}
export async function recordingBytes(id) {
  const r = S.recs.get(id);
  const ps = partPaths(r);
  if (ps.length === 1) return C.decBytes(key, await api.downloadFile(r.path));
  const parts = [];
  for (const p of ps) parts.push(await C.decBytes(key, await retry(() => api.downloadFile(p))));
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

export const storageUsed = () => [...S.recs.values()].reduce((a, r) => a + (r.meta.size || 0), 0);

window.addEventListener('online', () => { S.online = true; sync(); });
window.addEventListener('offline', () => { S.online = false; emit(); });

// ---------- גיבוי מוצפן ----------
// הקובץ מכיל את התוכן מוצפן במפתח הכספת, ואת המפתח עצמו עטוף בסיסמת הכספת ובמפתח השחזור.
// כך הגיבוי נפתח גם אם הענן ייעלם לגמרי, אבל רק למי שיודע את הסיסמה או מחזיק את מפתח השחזור.
export async function makeBackup(full) {
  const row = await kv.get('keys');
  const songsOut = [...S.songs.values()].map(s => ({ id: s.id, deleted_at: s.deleted_at, data: s.data }));
  const recs = [...S.recs.values()].filter(r => !r.deleted_at);
  const recsOut = [];
  for (const r of recs) {
    const o = { id: r.id, song_id: r.song_id, meta: r.meta };
    if (full) o.data = C.b64.enc(await recordingBytes(r.id));
    recsOut.push(o);
  }
  const payload = { songs: songsOut, recordings: recsOut, full: !!full };
  return {
    format: 'megira-backup-enc-v1', created: new Date().toISOString(),
    counts: { songs: songsOut.filter(x => !(x.data && x.data.__meta)).length, recordings: recsOut.length, audio: full ? recsOut.length : 0 },
    keys: { kdf_salt: row.kdf_salt, kdf_iterations: row.kdf_iterations, wrapped_key_password: row.wrapped_key_password, recovery_salt: row.recovery_salt, wrapped_key_recovery: row.wrapped_key_recovery, key_check: row.key_check },
    data: await C.encJSON(key, payload)
  };
}

export async function openBackup(text, secret) {
  let j; try { j = JSON.parse(text); } catch (e) { throw new Error('זה לא קובץ גיבוי של המגירה'); }
  if (!j || j.format !== 'megira-backup-enc-v1') throw new Error('זה לא קובץ גיבוי מוצפן של המגירה');
  try { return { meta: j, payload: await C.decJSON(key, j.data) }; } catch (e) {}
  if (!secret) { const e = new Error('need-secret'); e.needSecret = true; throw e; }
  let k = null;
  try { k = await C.unwrap(j.keys.wrapped_key_password, await C.deriveKek(secret, j.keys.kdf_salt, j.keys.kdf_iterations)); } catch (e) {}
  if (!k) { try { k = await C.unwrap(j.keys.wrapped_key_recovery, await C.deriveKek(C.normRecovery(secret), j.keys.recovery_salt, j.keys.kdf_iterations)); } catch (e) {} }
  if (!k) throw new Error('הסיסמה או מפתח השחזור לא מתאימים לגיבוי הזה');
  return { meta: j, payload: await C.decJSON(k, j.data) };
}

export async function restoreBackup(payload, onProgress) {
  let songsAdded = 0, songsRestored = 0, audio = 0, skipped = 0;
  for (const s of payload.songs) {
    const cur = S.songs.get(s.id);
    if (!cur) { await saveSong(s.id, s.data, { logEntry: s.data && s.data.__meta ? null : 'שוחזר מגיבוי', deleted_at: null }); if (!(s.data && s.data.__meta)) songsAdded++; }
    else if (cur.deleted_at && !s.deleted_at) { await saveSong(s.id, cur.data, { logEntry: 'שוחזר מסל המחזור בעזרת גיבוי', deleted_at: null }); songsRestored++; }
    onProgress && onProgress();
  }
  const have = new Set([...S.recs.values()].map(r => r.meta.date + '|' + r.song_id + '|' + (r.meta.size || '')));
  for (const r of payload.recordings) {
    if (!r.data) continue;
    if (have.has(r.meta.date + '|' + r.song_id + '|' + (r.meta.size || '')) || [...S.recs.values()].some(x => x.id === r.id)) { skipped++; continue; }
    if (!S.songs.get(r.song_id)) continue;
    const m = Object.assign({}, r.meta); delete m.size; delete m.parts;
    await addRecording(r.song_id, C.b64.dec(r.data), m);
    audio++; onProgress && onProgress();
  }
  return { songsAdded, songsRestored, audio, skipped };
}

// ---------- מפתח התראות ותזכורות ----------
// מפתח נפרד, שמור בתוך הכספת (מוצפן), ועותק לא ניתן לייצוא נשמר במכשיר.
// הוא פותח רק את טקסט התזכורות, כדי שהתראה תוצג גם כשהכספת נעולה. השירים עצמם לא נפתחים בו.
let nkey = null;
export async function ensureNotifyKey() {
  try {
    let raw = meta().nk;
    if (!raw) {
      const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      raw = C.b64.enc(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
      await saveMeta({ nk: raw });
    }
    nkey = await crypto.subtle.importKey('raw', C.b64.dec(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    await kv.set('nk', nkey);
  } catch (e) { console.error(e); }
}
let remBusy = false, remAgain = false;
export async function syncReminders() {
  if (!nkey || !key || !S.online) return;
  if (remBusy) { remAgain = true; return; }
  remBusy = true;
  try {
    const want = new Map(); const now = Date.now();
    const hosts = songs().map(s => ({ id: s.id, title: s.data.title, tasks: openTasks(s) }));
    hosts.push({ id: '', title: 'משימה כללית', tasks: (meta().tasks || []).filter(t => !t.done) });
    for (const h of hosts) for (const t of h.tasks) {
      if (t.id === 'n0') continue;
      for (const { rem, at } of TK.remindAts(t)) {
        if (at.getTime() < now - 60000) continue;
        const id = t.id + '@' + rem;
        want.set(id, { at: at.toISOString(), sig: at.toISOString() + '|' + t.text + '|' + h.title + '|' + (t.time || ''), h, t });
      }
    }
    const server = await api.listReminders();
    const sent = (await kv.get('remsig')) || {};
    const have = new Set(server.map(r => r.id));
    for (const r of server) if (!want.has(r.id)) { await api.deleteReminder(r.id); delete sent[r.id]; }
    for (const [id, w] of want) {
      if (have.has(id) && sent[id] === w.sig) continue;
      const payload = await C.encJSON(nkey, { t: w.t.text, s: w.h.title, id: w.h.id, l: TK.dueLabel(w.t) });
      await api.upsertReminder({ id, fire_at: w.at, payload, sent_at: null });
      sent[id] = w.sig;
    }
    await kv.set('remsig', sent);
  } catch (e) { console.error('reminders', e); }
  finally { remBusy = false; if (remAgain) { remAgain = false; syncReminders(); } }
}

// ---------- תחזוקת אחסון ----------
// שאריות: קבצים בתיקייה שלך שלא שייכים לשום הקלטה (למשל העלאה שנכשלה באמצע)
export async function findOrphans() {
  const u = api.currentUser();
  const files = await api.listFiles(u.id + '/');
  const used = new Set(); for (const r of S.recs.values()) for (const p of partPaths(r)) used.add(p);
  return files.filter(f => f.name && f.id !== null && !used.has(u.id + '/' + f.name)).map(f => ({ path: u.id + '/' + f.name, size: (f.metadata && f.metadata.size) || 0 }));
}
export async function removeOrphans(list) { for (const f of list) { try { await api.removeFile(f.path); } catch (e) {} } }
// החלפת הקלטה בגרסה מכווצת: הגרסה החדשה עולה קודם, ורק אחרי שהיא שמורה המקור נמחק
export async function replaceRecording(oldId, bytes, patch, onProgress) {
  const old = S.recs.get(oldId); if (!old) throw new Error('missing');
  const meta = Object.assign({}, old.meta); delete meta.size; delete meta.parts;
  Object.assign(meta, patch, { date: old.meta.date });
  const rec = await addRecording(old.song_id, bytes, meta, onProgress);
  await updateRecording(oldId, null, new Date().toISOString());
  await purgeRecording(oldId);
  return rec;
}
