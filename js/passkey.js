// פתיחת הכספת בטביעת פנים: מפתח גישה של האייפון מפיק סוד שנשאר במכשיר,
// ומהסוד הזה נגזר מפתח שעוטף את מפתח הכספת. הכל נשמר רק בטלפון הזה.
import * as C from './crypto.js';
import { kv } from './db.js';

const te = new TextEncoder();
export const supported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
export const enrolled = async () => !!(await kv.get('pk'));
export const remove = () => kv.del('pk');

async function wrapKeyFrom(prfOut) {
  const base = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('megira-passkey-v1'), info: te.encode('wrap') },
    base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

async function evalPrf(rawId, salt) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: C.randomBytes(32), rpId: location.hostname, timeout: 60000,
    allowCredentials: [{ type: 'public-key', id: rawId }], userVerification: 'required',
    extensions: { prf: { eval: { first: salt } } }
  } });
  const r = a.getClientExtensionResults();
  if (!r.prf || !r.prf.results || !r.prf.results.first) throw new Error('המכשיר הזה לא תומך בפתיחה בטביעת פנים');
  return new Uint8Array(r.prf.results.first);
}

export async function enroll(master, userId) {
  if (!supported()) throw new Error('המכשיר הזה לא תומך בפתיחה בטביעת פנים');
  const salt = C.randomBytes(32);
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'המגירה', id: location.hostname },
    user: { id: te.encode(userId), name: 'המגירה', displayName: 'המגירה' },
    challenge: C.randomBytes(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: 60000,
    extensions: { prf: { eval: { first: salt } } }
  } });
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || ext.prf.enabled === false) throw new Error('המכשיר הזה לא תומך בפתיחה בטביעת פנים');
  const rawId = new Uint8Array(cred.rawId);
  let out = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
  if (!out) out = await evalPrf(rawId, salt);
  const wrapped = await C.wrap(master, await wrapKeyFrom(out));
  await kv.set('pk', { id: C.b64.enc(rawId), salt: C.b64.enc(salt), wrapped, user: userId, at: new Date().toISOString() });
}

export async function unlock() {
  const pk = await kv.get('pk');
  if (!pk) throw new Error('פתיחה בטביעת פנים לא מוגדרת במכשיר הזה');
  const out = await evalPrf(C.b64.dec(pk.id), C.b64.dec(pk.salt));
  try { return await C.unwrap(pk.wrapped, await wrapKeyFrom(out)); }
  catch (e) { throw new Error('הפתיחה נכשלה. אפשר לפתוח עם סיסמת הכספת'); }
}
