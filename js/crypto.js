// הצפנה מקצה לקצה. הכל קורה במכשיר; לשרת מגיע רק מידע מוצפן.
// מפתח ראשי אקראי (AES-GCM 256) נעטף פעמיים: פעם במפתח שנגזר מסיסמת הכספת,
// ופעם במפתח שנגזר ממפתח השחזור.
const te = new TextEncoder();
const td = new TextDecoder();

export const b64 = {
  enc(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str) {
    const s = atob(str);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
};

export function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

export async function deriveKek(secret, saltB64, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64.dec(saltB64), iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']
  );
}

export async function newMasterKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrap(master, kek) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.wrapKey('raw', master, kek, { name: 'AES-GCM', iv });
  return b64.enc(iv) + '.' + b64.enc(ct);
}

export async function unwrap(wrapped, kek, extractable = true) {
  const [ivs, cts] = wrapped.split('.');
  return crypto.subtle.unwrapKey('raw', b64.dec(cts), kek, { name: 'AES-GCM', iv: b64.dec(ivs) },
    { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

export async function nonExtractableCopy(master) {
  const raw = await crypto.subtle.exportKey('raw', master);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encBytes(key, data) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0); out.set(ct, 12);
  return out;
}

export async function decBytes(key, data) {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)));
}

export async function encJSON(key, obj) {
  return 'v1.' + b64.enc(await encBytes(key, te.encode(JSON.stringify(obj))));
}

export async function decJSON(key, str) {
  if (!str || !str.startsWith('v1.')) throw new Error('bad-format');
  return JSON.parse(td.decode(await decBytes(key, b64.dec(str.slice(3)))));
}

// מפתח שחזור: 24 תווים קריאים בקבוצות של 4, בלי אותיות מבלבלות
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRecoveryKey() {
  const r = randomBytes(24);
  let s = '';
  for (let i = 0; i < 24; i++) s += ALPHA[r[i] % ALPHA.length];
  return s.match(/.{4}/g).join('-');
}
export function normRecovery(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
