// ייבוא חד־פעמי של השירים מקובץ חבילה (נבנה מייצוא הפתקים) או מקובץ ייצוא גולמי.
import { convertChordSheet } from './chords.js';

const STAGE_MAP = { 'מוכן': 'ready', 'קרוב': 'close', 'בפיתוח': 'dev', 'תרגום': 'trans', 'ניצוץ': 'spark', 'חומר_גלם': 'raw', 'חומר גלם': 'raw', 'מגירה': 'bottom', 'המגירה התחתונה': 'bottom' };
const clean = s => (s || '').replace(/[‏‎⁨⁩]/g, '').trim();

function fromPackageSong(p) {
  const now = new Date().toISOString();
  let notes = p.comment || '';
  if (p.links && p.links.length) notes = notes; // הקישורים נשמרים כטייפ ביטים
  return {
    title: p.title || 'ללא שם',
    stage: STAGE_MAP[p.stage] || p.stage || 'raw',
    readiness: typeof p.readiness === 'number' ? p.readiness : null,
    potential: p.potential || 'בינוני',
    next: p.next || '',
    notes,
    lyrics: convertChordSheet(p.lyrics || ''),
    beats: (p.links || []).map(u => ({ id: Math.random().toString(36).slice(2), url: u, note: 'מהפתקים', date: now })),
    pinned: false,
    created: now,
    editedAt: now,
    sourceDate: p.date || '',
    sourceFolder: p.folder || '',
    log: [{ d: now, e: 'יובא מהפתקים' + (p.date ? ' (נוצר שם ב־' + p.date + ')' : '') }]
  };
}

export function parsePackage(text) {
  const j = JSON.parse(text);
  if (j && j.format === 'megira-import-v1' && Array.isArray(j.songs)) return j.songs.map(fromPackageSong);
  throw new Error('הקובץ הזה אינו חבילת ייבוא של המגירה');
}

export async function readImportFile(file) {
  const text = await file.text();
  if (/^\s*\{/.test(text)) return parsePackage(text);
  // ייצוא גולמי: כל פתק מתחיל ב־=====
  if (text.includes('=====')) return parseRaw(text).map(fromPackageSong);
  throw new Error('לא זיהיתי את סוג הקובץ');
}

export function parseRaw(raw) {
  const L = raw.replace(/\r/g, '').split('\n'); const notes = []; let cur = null, skip = 0;
  for (let i = 0; i < L.length; i++) {
    if (L[i] === '=====') { cur = { t: clean(L[i + 1]), d: clean(L[i + 2]), f: clean(L[i + 3]), b: [] }; notes.push(cur); skip = 3; continue; }
    if (!cur) continue; if (skip) { skip--; continue; }
    cur.b.push(L[i]);
  }
  const songs = notes.filter(n => n.f === 'שירים' || n.f === 'סקיצות ושורות');
  return (songs.length ? songs : notes).map(n => {
    const SK = Object.keys(STAGE_MAP);
    let body = n.b.join('\n'); let tag = null;
    const tm = body.match(/#(מוכן|קרוב|בפיתוח|תרגום|ניצוץ|חומר_גלם|מגירה)/); if (tm) tag = tm[1];
    if (!tag && n.b.length) { const toks = clean(n.b[0]).replace(/#/g, '').split(/[\s,]+/).filter(Boolean); if (toks.length && toks.every(x => SK.includes(x))) { tag = toks[0]; n.b.shift(); body = n.b.join('\n'); } }
    body = body.replace(/#(מוכן|קרוב|בפיתוח|תרגום|ניצוץ|חומר_גלם|מגירה)/g, '');
    const links = [...body.matchAll(/https?:\/\/\S+/g)].map(m => m[0]);
    const noUrl = body.split('\n').filter(l => !/https?:\/\//.test(l)).join('\n');
    const paras = noUrl.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    let ci = -1; for (let i = paras.length - 1; i >= 0; i--) if (/\d+(?:\.\d+)?\s*\/\s*10|מוכנות|מוכנית|בשלות|לא שיר/.test(paras[i])) { ci = i; break; }
    const comment = ci >= 0 ? paras[ci] : '';
    const lyrics = (ci >= 0 ? paras.slice(0, ci).concat(paras.slice(ci + 1)) : paras).join('\n\n');
    const rm = comment.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    const ready = rm ? parseFloat(rm[1]) : null;
    const pm = comment.match(/פוטנציאל\s*[:\-]?\s*(גבוה|בינוני|נמוך|צדדי)/);
    let pot = pm && pm[1];
    if (!pot) pot = /לא אוהב|לא ממש אוהב/.test(comment) ? 'נמוך' : /אוהב|שווה ל|מרגש|מעולה/.test(comment) ? 'גבוה' : /חמוד/.test(comment) ? 'נמוך' : 'בינוני';
    let stage = tag;
    if (!stage) stage = ready == null ? 'חומר_גלם' : ready >= 9 ? 'מוכן' : ready >= 8 ? 'קרוב' : ready >= 6 ? 'בפיתוח' : pot === 'גבוה' ? 'ניצוץ' : 'חומר_גלם';
    return { title: n.t, date: n.d, folder: n.f, lyrics, comment, readiness: ready, potential: pot, stage, links, next: '' };
  });
}
