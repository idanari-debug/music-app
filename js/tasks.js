// משימות: תאריכים, קבוצות, תזכורות וזיהוי של תאריך, שעה, סוג ושיר מתוך טקסט חופשי.
// אין כאן גישה לשרת או להצפנה, רק חישובים.

const pad = n => String(n).padStart(2, '0');
export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export function dueDate(t) {
  if (!t || !t.due) return null;
  const d = fromYmd(t.due);
  if (t.time) { const [h, m] = t.time.split(':').map(Number); d.setHours(h, m); } else d.setHours(23, 59);
  return d;
}

// late · today · week · later · none
export function dueGroup(t, now = new Date()) {
  if (!t.due) return 'none';
  const today = ymd(now);
  if (t.due < today) return 'late';
  if (t.due === today) return t.time && dueDate(t) < now ? 'late' : 'today';
  const diff = Math.round((fromYmd(t.due) - day0(now)) / 864e5);
  return diff <= 7 ? 'week' : 'later';
}
export const GROUPS = [['late', 'באיחור'], ['today', 'היום'], ['week', 'השבוע'], ['later', 'בהמשך'], ['none', 'בלי תאריך']];

export function sortTasks(list) {
  return list.slice().sort((a, b) => {
    const da = dueDate(a), db = dueDate(b);
    if (da && db) return da - db; if (da) return -1; if (db) return 1;
    return (a.at || '').localeCompare(b.at || '');
  });
}

// מתי לשלוח תזכורת. rem: דקות לפני (ברירת מחדל רבע שעה), 1440 = יום לפני, ‎-1 = בלי
export const REMS = [[0, 'בזמן'], [15, 'רבע שעה לפני'], [60, 'שעה לפני'], [1440, 'יום לפני'], [-1, 'בלי תזכורת']];
export function remindAt(t) {
  if (!t.due || t.rem === -1) return null;
  const rem = t.rem ?? 15;
  if (t.time) return new Date(dueDate(t).getTime() - rem * 60000);
  const base = fromYmd(t.due); base.setHours(9, 0);
  return rem >= 1440 ? addDays(base, -1) : base;
}

export function dueLabel(t, now = new Date()) {
  if (!t.due) return '';
  const d = fromYmd(t.due), diff = Math.round((d - day0(now)) / 864e5);
  let s = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : diff === -1 ? 'אתמול' : diff > 1 && diff < 7 ? 'יום ' + DAYS[d.getDay()] : d.getDate() + '.' + (d.getMonth() + 1);
  if (t.time) s += ' ' + t.time;
  return s;
}

export function quickDates(now = new Date()) {
  const t = day0(now); const fri = (5 - t.getDay() + 7) % 7;
  return [['', 'בלי'], [ymd(t), 'היום'], [ymd(addDays(t, 1)), 'מחר'], [ymd(addDays(t, fri === 0 ? 7 : fri)), 'סוף השבוע'], [ymd(addDays(t, 7)), 'שבוע הבא']];
}

// ---------- זיהוי מטקסט חופשי ----------
const TYPE_RULES = [
  ['הקלטה', /להקליט|הקלטה|לצלם|צילום/],
  ['כתיבה', /לכתוב|כתיבה|לסיים (?:את )?ה?(?:בית|פזמון|גשר)|בית |פזמון|גשר|מילים|לחן|להלחין/],
  ['הפקה', /ביט|מיקס|הפקה|להפיק|עיבוד|מאסטר|לערוך/]
];
export function parseTask(input, songs = [], now = new Date()) {
  const out = { text: '', due: null, time: null, type: null, songId: null };
  if (!input || !input.trim()) return out;
  let x = ' ' + input.replace(/\s+/g, ' ').trim() + ' ';
  const today = day0(now);
  const take = re => { const m = x.match(re); if (m) x = x.replace(m[0], ' '); return m; };
  let m;
  if ((m = take(/ (?:עד |ל)?היום /))) out.due = ymd(today);
  else if ((m = take(/ (?:עד |ל)?מחרתיים /))) out.due = ymd(addDays(today, 2));
  else if ((m = take(/ (?:עד |ל)?מחר /))) out.due = ymd(addDays(today, 1));
  else if ((m = take(/ (?:עד |ב|ל)?סוף ה?שבוע /))) { const f = (5 - today.getDay() + 7) % 7; out.due = ymd(addDays(today, f === 0 ? 7 : f)); }
  else if ((m = take(/ (?:עד |ב|ל)?שבוע הבא /))) out.due = ymd(addDays(today, 7));
  else if ((m = take(/ (?:עד |ב|ל)?יום (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת) /))) { const w = DAYS.indexOf(m[1]); let n = (w - today.getDay() + 7) % 7; if (n === 0) n = 7; out.due = ymd(addDays(today, n)); }
  else if ((m = take(/ (?:עד |ב|ל)?(\d{1,2})[./](\d{1,2}) /))) { let d = new Date(today.getFullYear(), +m[2] - 1, +m[1]); if (d < today) d = new Date(today.getFullYear() + 1, +m[2] - 1, +m[1]); out.due = ymd(d); }
  if ((m = take(/ (?:בשעה |ב[־ -]?)(\d{1,2})(?::(\d{2}))? /)) && +m[1] < 24 && (!m[2] || +m[2] < 60)) {
    let h = +m[1];
    if ((/ (?:בערב|בלילה|אחה"צ|אחר הצהריים) /.test(x)) && h < 12) h += 12;
    out.time = pad(h) + ':' + (m[2] || '00');
  } else if ((m = take(/ (בבוקר|בצהריים|אחר הצהריים|בערב|בלילה) /))) out.time = { 'בבוקר': '09:00', 'בצהריים': '13:00', 'אחר הצהריים': '16:00', 'בערב': '19:00', 'בלילה': '22:00' }[m[1]];
  x = x.replace(/ (?:בערב|בלילה) /, ' ');
  if (out.time && !out.due) { out.due = ymd(today); const [h, mi] = out.time.split(':').map(Number); const at = new Date(today); at.setHours(h, mi); if (at < now) out.due = ymd(addDays(today, 1)); }
  const tr = TYPE_RULES.find(([, re]) => re.test(input)); if (tr) out.type = tr[0];
  const cands = songs.filter(s => s.title && s.title.length > 1).sort((a, b) => b.title.length - a.title.length);
  for (const s of cands) {
    const esc = s.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(' (?:של |ב|ל|עבור )?"?' + esc + '"? ');
    if (re.test(x)) { out.songId = s.id; x = x.replace(re, ' '); break; }
  }
  out.text = x.replace(/\s+/g, ' ').trim().replace(/ (?:ל|ב|של|עד|את|עבור)$/, '');
  return out;
}
