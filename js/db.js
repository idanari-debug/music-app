// מטמון מקומי במכשיר (מוצפן) ותור שינויים שמחכים לשרת, כדי ששום עריכה לא תלך לאיבוד גם בלי קליטה.
const DB = 'megira';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('songs', { keyPath: 'id' });
      d.createObjectStore('recs', { keyPath: 'id' });
      d.createObjectStore('outbox', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kv = {
  get: k => tx('kv', 'readonly', s => reqP(s.get(k))),
  set: (k, v) => tx('kv', 'readwrite', s => { s.put(v, k); }),
  del: k => tx('kv', 'readwrite', s => { s.delete(k); })
};

export const table = name => ({
  all: () => tx(name, 'readonly', s => reqP(s.getAll())),
  put: row => tx(name, 'readwrite', s => { s.put(row); }),
  putMany: rows => tx(name, 'readwrite', s => { rows.forEach(r => s.put(r)); }),
  del: id => tx(name, 'readwrite', s => { s.delete(id); }),
  clear: () => tx(name, 'readwrite', s => { s.clear(); })
});

export const songsCache = table('songs');
export const recsCache = table('recs');
export const outbox = table('outbox');

export async function wipeLocal() {
  await Promise.all([songsCache.clear(), recsCache.clear(), outbox.clear(), kv.del('mk'), kv.del('keys'), kv.del('pk')]);
}
