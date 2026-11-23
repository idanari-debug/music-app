import * as api from './api.js';
import * as store from './store.js';
import { stageOf, POTS, KINDS, kindName, S, GLAZES, glazeVar, TASK_TYPES } from './store.js';
import * as CH from './chords.js';
import * as AU from './audio.js';
import { readImportFile } from './importer.js';
import { CONFIG } from './config.js';
import * as PK from './passkey.js';
import { kv } from './db.js';
import * as TK from './tasks.js';
import * as NT from './notify.js';

const root = document.getElementById('root');
const $ = s => root.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TH = window.MegiraTheme || { pref: () => 'day', set: () => false, isNight: () => false, apply: () => false, motion: () => 'full', setMotion: () => {} };

// ---------- מצב ממשק ----------
const ui = {
  screen: 'boot', authMode: 'in', err: '', busy: false, keysRow: null, recoveryKey: '',
  nav: 'home', view: 'dash', drawer: 'ready', songId: null, tab: 'text', sort: 'man', sortDir: 1, arrange: false, moved: null,
  editText: false, chordMode: false, showChords: true, q: '', filters: {}, sysView: 'main',
  sheet: null, pkEnrolled: false, autolock: 5, lastBackup: null, hiddenAt: 0, versions: null, openLyrics: '', recTarget: null, recTimer: null, swipeOpen: null,
  palFor: null, warnFor: null, tasksView: 'date', orphans: null, notify: null, tkOpen: null, qtDraft: '', qtSong: null, taskType: 'כתיבה', lastDone: null,
  stage: false, stageRun: false, stageSpeed: 3, stageSize: 26
};
const isWide = () => window.innerWidth >= 1000;
const reduceMotion = () => document.documentElement.classList.contains('rm');
// מעבר רך בין דפים: קדימה, אחורה או החלפה רכה
const NAV_DIR = { drawer: 'fwd', open: 'fwd', openState: 'fwd', drawersEdit: 'fwd', goPlaying: 'fwd', songBack: 'back', home: 'back', nav: 'fade', tab: 'fade', sysView: d => d.k === 'trash' ? 'fwd' : 'back' };
function withTransition(dir, fn) {
  if (!document.startViewTransition || reduceMotion() || ui.screen !== 'main') return fn();
  document.documentElement.dataset.vt = isWide() ? 'fade' : dir;
  const t = document.startViewTransition(() => fn());
  t.finished.finally(() => { delete document.documentElement.dataset.vt; });
  return t.updateCallbackDone;
}

// ---------- עזרים ----------
const DAY = 86400000;
function songPickBody(sh) {
  const q = (sh.q || '').trim();
  const row = s => `<button class="row" data-a="spPick" data-id="${s.id}"><span class="glz" style="width:10px;height:10px;background:${gv(stageOf(s.data.stage))}"></span><span class="grow"><span class="t">${esc(s.data.title)}</span></span><span class="m">${q ? esc(stageOf(s.data.stage).name) : 'מוכנות ' + rd(s.data.readiness)}</span></button>`;
  if (q) { const f = all().filter(s => s.data.title.includes(q)).slice(0, 30); return `<div class="box">${f.length ? f.map(row).join('') : '<div class="empty">אין שיר בשם הזה</div>'}</div>`; }
  if (sh.dr) { const f = sortSongs(byStage(sh.dr), sh.dr); return `<div class="box">${f.length ? f.map(row).join('') : '<div class="empty">המגירה הזו ריקה</div>'}</div>`; }
  const recent = deskCards().slice(0, 4);
  return `${recent.length ? `<span class="flabel">פתוחים לאחרונה</span><div class="chips">${recent.map(s => `<button class="chip" data-a="spPick" data-id="${s.id}"><span class="led" style="background:${gv(stageOf(s.data.stage))}"></span>${esc(s.data.title)}</button>`).join('')}</div>` : ''}
    <span class="flabel">או לפי מגירה</span>
    <div class="spdr">${store.drawers().map(st => `<button data-a="spDrawer" data-k="${esc(st.k)}" style="--g:${gv(st)}"><b>${esc(st.name)}</b><span>${byStage(st.k).length} שירים</span></button>`).join('')}</div>
    <button class="spgen" data-a="spPick" data-id="${GEN}">משימה כללית, בלי שיר</button>`;
}
function teKeep() { const sh = ui.sheet; if (!sh || sh.type !== 'taskEdit') return; const t = $('#tet'); if (t) sh.draft.text = t.value; }
const openTxt = n => n === 1 ? 'משימה פתוחה אחת' : n + ' פתוחות';
function rel(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (d <= 0) return 'היום'; if (d === 1) return 'אתמול'; if (d < 7) return 'לפני ' + d + ' ימים';
  if (d < 30) { const w = Math.round(d / 7); return w === 1 ? 'לפני שבוע' : w === 2 ? 'לפני שבועיים' : 'לפני ' + w + ' שבועות'; }
  if (d < 365) { const m = Math.round(d / 30); return m === 1 ? 'לפני חודש' : m === 2 ? 'לפני חודשיים' : 'לפני ' + m + ' חודשים'; }
  return 'לפני יותר משנה';
}
const daysAgo = iso => iso ? (Date.now() - new Date(iso).getTime()) / DAY : 999;
const dmy = iso => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getFullYear()).slice(2); };
const hm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const dur = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const rd = v => v == null ? '–' : (Math.round(v * 10) / 10).toString();
const mb = b => (b / 1048576).toFixed(b > 104857600 ? 0 : 1);
const plain = t => (t || '').replace(/\[[^\]]*\]/g, '');
const gv = st => glazeVar(st.glaze);
function greet() { const h = new Date().getHours(); return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב'; }

const svg = (d, s = 20, w = 1.9, extra = '') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const I = {
  back: svg('<path d="M9 6l6 6-6 6"/>', 18, 2.2),
  chev: svg('<path d="M15 6l-6 6 6 6"/>', 16, 2),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>', 21, 1.8),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 20, 2.2),
  play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>', 15),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>', 15),
  dots: svg('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>', 18),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>', 16, 2.2),
  check: svg('<path d="M5 12l5 5 9-10"/>', 15, 3),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 18, 2),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', 18, 2),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 18, 2),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16, 2),
  drawers: svg('<rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13" width="17" height="7" rx="1.5"/><path d="M10 7.5h4M10 16.5h4"/>', 21, 1.8),
  tasks: svg('<path d="M4 6.5l1.8 1.8L9 5M12 7h8M4 13.5l1.8 1.8L9 12M12 14h8M12 20h8"/><rect x="4.5" y="18" width="4" height="4" rx="1"/>', 21, 1.8),
  sys: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', 21, 1.8),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', 15, 2),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>', 16, 2),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', 16, 2),
  rw10: svg('<path d="M9 5a7 7 0 1 1-6.6 9.3"/><path d="M9 2v6H3"/>', 22, 1.8),
  ff10: svg('<path d="M15 5a7 7 0 1 0 6.6 9.3"/><path d="M15 2v6h6"/>', 22, 1.8),
  pen: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>', 15, 2),
  bell: svg('<path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0"/>', 13, 2),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>', 17),
  tape: svg('<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="8.5" cy="12" r="2"/><circle cx="15.5" cy="12" r="2"/>', 17),
  guitar: svg('<circle cx="8" cy="16" r="5"/><circle cx="8" cy="16" r="1.4"/><path d="M11.5 12.5L19 5M17.5 3.5l3 3"/>', 17),
  pin: svg('<path d="M9 3h6l-1 7 4 3v1H6v-1l4-3z" fill="currentColor" stroke="none"/><path d="M12 14v7"/>', 13, 2),
  grip: '<svg width="12" height="18" viewBox="0 0 14 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1.6"/><circle cx="10" cy="4" r="1.6"/><circle cx="4" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="4" cy="16" r="1.6"/><circle cx="10" cy="16" r="1.6"/></svg>',
  up: svg('<path d="M6 15l6-6 6 6"/>', 16, 2.2),
  down: svg('<path d="M6 9l6 6 6-6"/>', 16, 2.2),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 16, 2),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 17, 2),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 14, 2),
  stage: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 14, 2.2),
  next: svg('<path d="M15 6l-6 6 6 6"/>', 16, 2.4),
  prev: svg('<path d="M9 6l6 6-6 6"/>', 16, 2.4)
};
const LOGO = (sz) => `<svg class="lg" width="${sz}" height="${sz}" viewBox="0 0 512 512" role="img" aria-label="הלוגו של המגירה"><rect width="512" height="512" rx="114" style="fill:var(--lg-bg)"/><g transform="rotate(-8 256 200)"><rect x="132" y="86" width="260" height="170" rx="22" style="fill:var(--lg-sh)"/><rect x="126" y="78" width="260" height="170" rx="22" style="fill:var(--lg-cas)"/><rect x="148" y="96" width="216" height="34" rx="9" style="fill:var(--lg-lab)"/><rect x="166" y="146" width="180" height="62" rx="31" style="fill:var(--lg-win)"/><circle cx="207" cy="177" r="19" style="fill:var(--lg-cas)"/><circle cx="207" cy="177" r="7" style="fill:var(--lg-win)"/><circle cx="305" cy="177" r="19" style="fill:var(--lg-cas)"/><circle cx="305" cy="177" r="7" style="fill:var(--lg-win)"/></g><rect x="76" y="262" width="360" height="170" rx="34" style="fill:var(--lg-dr)"/><rect x="90" y="262" width="332" height="12" rx="6" fill="rgba(0,0,0,.07)"/><path d="M126 350 h36 l13 -28 l18 56 l18 -42 l14 28 l12 -14 h22 l14 -30 l18 52 l16 -38 l12 16 h37" fill="none" style="stroke:var(--lg-wv)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const WAVES = ['M0 12V6C25 2 45 10 70 6S120 1 145 6S185 9 200 5V12Z', 'M0 12V4C30 9 55 2 85 6S135 10 160 5S190 3 200 7V12Z', 'M0 12V7C20 3 50 4 75 8S125 2 150 5S180 9 200 6V12Z'];
const SPECK = '<svg class="speck" aria-hidden="true"><filter id="spk"><feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="1" seed="4"/><feColorMatrix values="0 0 0 0 .32  0 0 0 0 .24  0 0 0 0 .18  14 0 0 0 -9.6"/></filter><rect width="100%" height="100%" filter="url(#spk)"/></svg>';

let toastTimer = null;
function toast(msg, undo) {
  const el = document.getElementById('toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button id="undo">ביטול</button>' : '');
  el.classList.add('show');
  if (undo) document.getElementById('undo').onclick = () => { el.classList.remove('show'); undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 5000 : 2600);
}
function fail(e) { console.error(e); toast(e && e.message ? e.message : 'משהו השתבש'); }

// ---------- נתונים נגזרים ----------
const all = () => store.songs();
const song = id => S.songs.get(id);
function flags(s) {
  const r = store.recsOf(s.id);
  return {
    sketch: r.some(x => ['sketch', 'voice', 'final'].includes(x.meta.kind)),
    beat: r.some(x => x.meta.kind === 'beat') || (s.data.beats || []).length > 0,
    guitar: r.some(x => x.meta.kind === 'guitar'),
    n: r.length
  };
}
const byStage = k => all().filter(s => s.data.stage === k);
const firstChord = t => { const m = (t || '').match(/\[([A-G][^\]]*)\]/); return m ? m[1] : ''; };

// ---------- רינדור ----------
function render() {
  ui.sheetFresh = !root.querySelector('.overlay');
  const keep = ui.screen === 'main' ? { k: ui.nav + ui.view + ui.songId + ui.tab + ui.sysView + ui.drawer, y: ($('.main') || {}).scrollTop || 0, y2: ($('.col.mid') || {}).scrollTop || 0, y3: ($('.col.main2') || {}).scrollTop || 0 } : null;
  let h = '';
  if (ui.screen === 'boot') h = '<div class="gate">' + SPECK + '<div class="logo">' + LOGO(60) + '<span class="h1">המגירה</span></div><p class="hint">פותח את הכספת…</p></div>';
  else if (ui.screen === 'auth') h = vAuth();
  else if (ui.screen === 'confirm-mail') h = vConfirmMail();
  else if (ui.screen === 'setup') h = vSetup();
  else if (ui.screen === 'showRecovery') h = vShowRecovery();
  else if (ui.screen === 'unlock') h = vUnlock();
  else if (ui.screen === 'mfa') h = vMfa();
  else if (ui.screen === 'recover') h = vRecover();
  else h = isWide() ? vWide() : vMain();
  root.innerHTML = h;
  if (ui.screen === 'main') updateBadge();
  if (AU.now.recId) playUi();
  if (keep && root.dataset.k === keep.k) {
    if ($('.main')) $('.main').scrollTop = keep.y;
    if ($('.col.mid')) $('.col.mid').scrollTop = keep.y2;
    if ($('.col.main2')) $('.col.main2').scrollTop = keep.y3;
  }
  root.dataset.k = keep ? keep.k : '';
  afterRender();
}

function gate(inner) { return '<div class="gate">' + SPECK + '<div class="logo">' + LOGO(60) + '<div><div class="h1">המגירה</div><div class="sub" style="margin-top:6px">כל השירים שלך, נעולים</div></div></div>' + (ui.err ? '<div class="err" role="alert">' + esc(ui.err) + '</div>' : '') + inner + '</div>'; }

function vAuth() {
  const up = ui.authMode === 'up';
  return gate(`
  <form class="card" data-form="auth">
    <div class="field"><label for="em">מייל</label><input class="inp ltr" id="em" name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label for="pw">סיסמת חשבון</label><input class="inp ltr" id="pw" name="password" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="8" required></div>
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>${up ? 'יצירת חשבון' : 'כניסה'}</button>
  </form>
  <button class="btn full" data-a="authMode">${up ? 'כבר יש לי חשבון' : 'פעם ראשונה? יצירת חשבון'}</button>
  <p class="hint">סיסמת החשבון משמשת רק לכניסה. את השירים נועלת סיסמה נפרדת, סיסמת הכספת, שלא יוצאת אף פעם מהמכשיר.</p>`);
}
function vConfirmMail() {
  return gate(`<div class="card"><b>נשלח אליך מייל לאישור החשבון.</b><p class="hint" style="margin:0">לחץ על הקישור שבמייל, חזור לכאן והיכנס עם המייל והסיסמה.</p><button class="btn pri full" data-a="toAuth">לכניסה</button></div>`);
}
function vSetup() {
  return gate(`
  <form class="card" data-form="setup">
    <b class="h3">יצירת הכספת</b>
    <p class="hint" style="margin:0">בחר סיסמת כספת. ממנה נגזר המפתח שמצפין כל שיר וכל הקלטה כאן במכשיר, לפני שהם עולים לענן. השרת לא רואה אותה ולא יכול לשחזר אותה.</p>
    <div class="field"><label for="p1">סיסמת כספת (לפחות 10 תווים)</label><input class="inp ltr" id="p1" name="p1" type="password" autocomplete="new-password" minlength="10" required></div>
    <div class="field"><label for="p2">שוב, לאימות</label><input class="inp ltr" id="p2" name="p2" type="password" autocomplete="new-password" minlength="10" required></div>
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'יוצר מפתחות…' : 'יצירת הכספת'}</button>
  </form>`);
}
function vShowRecovery() {
  return gate(`
  <div class="card">
    <b class="h3">מפתח השחזור שלך</b>
    <p class="hint" style="margin:0">אם תשכח את סיסמת הכספת, זו הדרך היחידה לפתוח את השירים. הוא מוצג עכשיו פעם אחת בלבד. שמור אותו מחוץ לטלפון: על דף, או במנהל סיסמאות.</p>
    <div class="rk">${esc(ui.recoveryKey)}</div>
    <button class="btn full" data-a="copyRk">העתקה</button>
    <label class="check"><input type="checkbox" id="rkok"> שמרתי את מפתח השחזור במקום בטוח</label>
    <button class="btn pri full" data-a="rkDone">המשך</button>
  </div>`);
}
function vUnlock() {
  return gate(`
  ${ui.pkEnrolled ? `<button class="btn pri full" style="height:58px;font-size:16px" data-a="pkUnlock" ${ui.busy ? 'disabled' : ''}>פתיחה בטביעת פנים</button><p class="hint" style="margin:-10px 0 0;text-align:center">או עם סיסמת הכספת:</p>` : ''}
  <form class="card" data-form="unlock">
    <div class="field"><label for="vp">סיסמת כספת</label><input class="inp ltr" id="vp" name="vp" type="password" autocomplete="current-password" required></div>
    ${ui.pkEnrolled ? '' : '<label class="check"><input type="checkbox" name="remember" checked> להשאיר פתוח במכשיר הזה עד שאנעל ידנית</label>'}
    <button class="btn ${ui.pkEnrolled ? '' : 'pri'} full" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'פותח…' : 'פתיחה'}</button>
  </form>
  <div class="grid2"><button class="btn" data-a="toRecover">שכחתי את הסיסמה</button><button class="btn" data-a="signOut">התנתקות</button></div>`);
}
function vMfa() {
  return gate(`
  <form class="card" data-form="mfa">
    <b class="h3">קוד אימות</b>
    <p class="hint" style="margin:0">הזן את הקוד בן 6 הספרות מאפליקציית האימות. הוא מתחלף כל 30 שניות.</p>
    <div class="field"><label for="otp">קוד</label><input class="inp ltr" id="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required style="font-family:var(--mono);font-size:22px;letter-spacing:6px;text-align:center"></div>
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'בודק…' : 'אישור'}</button>
  </form>
  <button class="btn full" data-a="signOut">התנתקות</button>`);
}
function vRecover() {
  return gate(`
  <form class="card" data-form="recover">
    <b class="h3">שחזור עם מפתח השחזור</b>
    <div class="field"><label for="rkin">מפתח השחזור</label><input class="inp ltr" id="rkin" name="rk" autocomplete="off" required></div>
    <div class="field"><label for="n1">סיסמת כספת חדשה</label><input class="inp ltr" id="n1" name="n1" type="password" minlength="10" autocomplete="new-password" required></div>
    <div class="field"><label for="n2">שוב, לאימות</label><input class="inp ltr" id="n2" name="n2" type="password" minlength="10" autocomplete="new-password" required></div>
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>שחזור</button>
  </form>
  <button class="btn full" data-a="toUnlock">חזרה</button>`);
}

// ---- מבנה ראשי בטלפון ----
function vMain() {
  let head = '', body = '';
  if (ui.nav === 'home') {
    if (ui.view === 'song' && song(ui.songId)) { head = songHead(); body = songBody(); }
    else if (ui.view === 'drawer') body = vDrawer();
    else if (ui.view === 'drawers') body = vDrawersEdit();
    else body = vDash();
  } else if (ui.nav === 'search') body = vSearch();
  else if (ui.nav === 'tasks') body = vTasks();
  else body = ui.sysView === 'trash' ? vTrash() : vSys();
  return `<div class="app">${SPECK}
    ${head}<div class="main" ${head ? 'style="padding-top:6px"' : ''}>${body}</div>
    ${vQueue()}${vRecbar()}${vPlayer()}${vNav()}
    ${ui.sheet ? vSheet() : ''}${ui.stage ? vStage() : ''}
  </div>`;
}

function vNav() {
  const it = (k, l, ic) => `<button class="${ui.nav === k ? 'on' : ''}" data-a="nav" data-k="${k}" ${ui.nav === k ? 'aria-current="page"' : ''}>${ic}<span>${l}</span></button>`;
  return `<nav class="nav">${it('home', 'מגירות', I.drawers)}${it('search', 'חיפוש', I.search)}${it('tasks', 'משימות', I.tasks)}${it('sys', 'מערכת', I.sys)}</nav>`;
}
function vRecbar() {
  if (!AU.isRecording()) return '';
  const t = ui.recTarget && song(ui.recTarget) ? 'לתוך ' + song(ui.recTarget).data.title : 'ניצוץ חדש';
  return `<div class="recbar" role="status"><span class="recdot"></span><span style="flex:1;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">מקליט · ${esc(t)}</span><span class="num" id="rect" style="font-size:14px">${dur(AU.recordingElapsed())}</span>
  <button class="btn sm" style="background:transparent;color:inherit;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)" data-a="recCancel">ביטול</button>
  <button class="btn sm" style="background:var(--rec);color:#fff;box-shadow:none" data-a="recStop">שמירה</button></div>`;
}
function vPlayer() {
  if (!AU.now.recId || AU.isRecording()) return '';
  const p = !AU.player.paused, d = AU.player.duration || 0;
  const pct = d ? (AU.player.currentTime / d * 100) : 0;
  return `<div class="player ${p ? 'playing' : ''}">
    <div class="prow"><span class="disc" aria-hidden="true"></span>
      <div class="info" data-a="playerFull"><b>${esc(AU.now.title)} <small>· ${esc(AU.now.song)}</small></b></div>
      <span class="ctl3"><button class="skip" data-a="skip" data-k="-10" aria-label="10 שניות אחורה">${I.rw10}</button>
      <button class="key acc" data-a="playToggle" aria-label="${p ? 'השהיה' : 'השמעה'}">${p ? I.pause : I.play}</button>
      <button class="skip" data-a="skip" data-k="10" aria-label="10 שניות קדימה">${I.ff10}</button></span>
      <button class="more" data-a="playStop" aria-label="סגירת הנגן">${I.x}</button></div>
    <div class="srow2"><span class="tm" id="plt">${dur(AU.player.currentTime)}</span>
      <div class="scrub pscrub" data-scrub="bar" role="slider" aria-label="מיקום בהקלטה" aria-valuemin="0" aria-valuemax="${Math.round(d)}" aria-valuenow="${Math.round(AU.player.currentTime)}"><span class="tr"></span><span class="fl" id="pbar" style="width:${pct}%"></span><span class="kn" id="pknob" style="left:${pct}%"></span></div>
      <span class="tm" id="pld">${d ? dur(d) : '–'}</span></div>
  </div>`;
}
function bigWave(r) {
  const peaks = (r && r.meta.peaks && r.meta.peaks.length) ? r.meta.peaks : Array.from({ length: 72 }, () => 0.35);
  return `<div class="scrub bigwave" data-scrub="wave" data-wave="${r ? r.id : ''}">${peaks.map(v => `<span style="height:${Math.max(8, v * 100)}%"></span>`).join('')}<i class="phl" id="pbigline"></i></div>`;
}

// ---- בית ----
function deskCards() {
  return all().slice().sort((a, b) => (b.data.pinned - a.data.pinned) || (b.data.editedAt || '').localeCompare(a.data.editedAt || '')).slice(0, 6);
}
function tileHtml(st, i) {
  const ss = byStage(st.k); const rs = ss.map(s => s.data.readiness).filter(v => v != null);
  const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  return `<button class="tile" data-a="drawer" data-k="${esc(st.k)}"${st.k === 'bottom' ? '' : ` data-dg="tile"`} style="--g:${gv(st)}">
    <span class="dip" aria-hidden="true"></span><svg class="wv" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"><path d="${WAVES[i % 3]}"/></svg>
    <span class="rb" aria-hidden="true"><i style="width:${avg * 10}%"></i></span>
    <span class="nm">${esc(st.name)}</span><span class="cnt"><b>${ss.length}</b><span>שירים</span></span></button>`;
}
function todayCard() {
  const its = []; allHosts().forEach(s => store.openTasks(s).forEach(t => { const g = TK.dueGroup(t); if (g === 'late' || g === 'today') its.push({ s, t, g }); }));
  if (!its.length) return '';
  const late = its.filter(x => x.g === 'late').length, today = its.length - late;
  const sorted = TK.sortTasks(its.map(x => x.t)).map(t => its.find(x => x.t === t)).slice(0, 4);
  return `<section class="today"><div class="sechead"><h2 class="h3">היום</h2><span style="display:flex;gap:6px">${late ? `<span class="pill late">${late === 1 ? 'אחת באיחור' : late + ' באיחור'}</span>` : ''}${today ? `<span class="pill">${today} להיום</span>` : ''}</span></div>
    <div class="tks">${sorted.map(({ s, t }) => taskRow(s, t, { song: true, type: false })).join('')}</div>
    ${its.length > 4 ? `<button class="more" data-a="nav" data-k="tasks">עוד ${its.length - 4} ←</button>` : ''}</section>`;
}
function vDash() {
  const list = all();
  const desk = deskCards();
  const syncTxt = S.warning ? S.warning : !S.online ? 'לא מחובר · נשמר במכשיר' : S.pending ? 'מסנכרן ' + S.pending + '…' : S.lastSync ? 'מגובה · ' + hm(S.lastSync) : 'מגובה';
  const night = TH.isNight();
  return `
  <div class="hdr"><div><div class="greet">${greet()}, דנדול</div><h1 class="h1">המגירה</h1><div class="sub" style="margin-top:8px">${list.length} שירים · ${esc(syncTxt)}</div></div>
    <div style="display:flex;gap:8px">
      <button class="iconbtn" data-a="themeToggle" aria-label="${night ? 'מעבר למצב יום' : 'מעבר למצב לילה'}">${night ? I.sun : I.moon}</button>
      <button class="iconbtn acc" data-a="newSong" aria-label="שיר חדש">${I.plus}</button>
      <button class="iconbtn" data-a="lockNow" aria-label="נעילה">${I.lock}</button></div></div>
  ${list.length === 0 ? `<div class="card"><b class="h3">המגירה ריקה</b><p class="hint" style="margin:0">אפשר לייבא את השירים מהפתקים, או להתחיל שיר חדש.</p><div class="grid2"><button class="btn pri" data-a="goImport">ייבוא שירים</button><button class="btn" data-a="newSong">שיר חדש</button></div></div>` : ''}
  ${list.length && (!ui.lastBackup || daysAgo(ui.lastBackup) > 30) ? `<div class="banner"><span>${ui.lastBackup ? 'עבר יותר מחודש מהגיבוי האחרון.' : 'עוד לא עשית גיבוי מוצפן.'}</span><button class="btn sm pri" data-a="backup" data-k="full">גיבוי עכשיו</button></div>` : ''}
  ${todayCard()}
  ${desk.length ? `<section><div class="sechead"><h2 class="h3">על השולחן</h2><span class="sub">פתוחים לאחרונה</span></div>
    <div class="hscroll">${desk.map(s => { const st = stageOf(s.data.stage); return `<button class="desk" data-a="open" data-id="${s.id}" style="--g:${gv(st)}">
      <span class="top"><span><span class="led" style="background:${gv(st)}"></span>${esc(st.name)}</span><b class="num" style="font-size:13px;color:var(--ink)">${rd(s.data.readiness)}</b></span>
      <span class="tt">${s.data.pinned ? I.pin + ' ' : ''}${esc(s.data.title)}</span>
      <span class="tape" aria-hidden="true"><i></i><b></b><i></i></span></button>`; }).join('')}</div></section>` : ''}
  <section><div class="sechead"><h2 class="h3">המגירות</h2><button class="chip" data-a="drawersEdit">${I.sliders}סידור ועריכה</button></div>
    <div class="drawers" data-dgc="tile">${store.drawers().map(tileHtml).join('')}<button class="tile add" data-a="drawersEdit" data-add="1">${I.plus}מגירה חדשה</button></div>
    <p class="hint" style="margin:10px 4px 0">הפס הלבן בזיגוג: מוכנות ממוצעת של השירים במגירה</p></section>`;
}

// ---- מגירה ----
function sortSongs(list, k) {
  const pr = { 'גבוה': 0, 'בינוני': 1, 'נמוך': 2, 'צדדי': 3 };
  if (ui.sort === 'man') {
    const ord = store.orderOf(k); const pos = new Map(ord.map((id, i) => [id, i]));
    return list.sort((a, b) => {
      const pa = pos.has(a.id) ? pos.get(a.id) : 1e6, pb = pos.has(b.id) ? pos.get(b.id) : 1e6;
      return pa - pb || (b.data.pinned - a.data.pinned) || (b.data.readiness ?? -1) - (a.data.readiness ?? -1);
    });
  }
  const dir = ui.sortDir;
  return list.sort((a, b) => (b.data.pinned - a.data.pinned) || dir * (ui.sort === 'v' ? (b.data.readiness ?? -1) - (a.data.readiness ?? -1)
    : ui.sort === 'ago' ? (b.data.editedAt || '').localeCompare(a.data.editedAt || '') : ui.sort === 'pot' ? (pr[a.data.potential] ?? 9) - (pr[b.data.potential] ?? 9) : a.data.title.localeCompare(b.data.title, 'he')));
}
function songRow(s, opt = {}) {
  const f = flags(s); const st = stageOf(s.data.stage);
  const ic = (on, i, l) => `<span class="${on ? '' : 'off'}" title="${l}">${i.replace('<svg', '<svg class="' + (on ? '' : 'off') + '"')}</span>`;
  const aria = [f.sketch ? 'יש סקיצה' : 'אין סקיצה', f.beat ? 'יש טייפ ביט' : 'אין טייפ ביט', f.guitar ? 'יש גיטרה' : 'אין גיטרה'].join(', ');
  const dg = opt.drag ? ` data-dg="song" data-id="${s.id}"` : '';
  const inner = `${opt.drag ? `<span class="grip" aria-hidden="true">${I.grip}</span>` : ''}<span class="score" style="--g:${gv(st)}"><span>${rd(s.data.readiness)}</span></span>
    <span class="grow"><span class="t">${s.data.pinned ? I.pin : ''}${esc(s.data.title)}</span><span class="m">${opt.meta || ('פוטנציאל ' + esc(s.data.potential || '–') + ' · ' + rel(s.data.editedAt))}</span></span>`;
  if (opt.arrange) return `<div class="srow ${ui.moved === s.id ? 'moved' : ''}"><span class="grip" aria-hidden="true">${I.grip}</span>${inner}
    <span class="arrows"><button data-a="moveSong" data-id="${s.id}" data-k="-1" aria-label="הזזה למעלה" ${opt.first ? 'disabled' : ''}>${I.up}</button><button data-a="moveSong" data-id="${s.id}" data-k="1" aria-label="הזזה למטה" ${opt.last ? 'disabled' : ''}>${I.down}</button></span></div>`;
  const row = `<button class="srow" data-a="open" data-id="${s.id}"${opt.swipe ? '' : dg} ${opt.sel ? 'style="box-shadow:0 0 0 2px var(--acc)"' : ''}>${inner}<span class="ico3" role="img" aria-label="${aria}">${ic(f.sketch, I.mic, 'סקיצה')}${ic(f.beat, I.tape, 'טייפ ביט')}${ic(f.guitar, I.guitar, 'גיטרה')}</span></button>`;
  if (!opt.swipe) return row;
  return `<div class="swrap ${ui.swipeOpen === s.id ? 'open' : ''}" data-sw="${s.id}"${dg}><div class="sw-act">
    <button data-a="moveSheet" data-id="${s.id}">העברה</button><button data-a="pin" data-id="${s.id}">${s.data.pinned ? 'ביטול הצמדה' : 'הצמדה'}</button><button class="del" data-a="trash" data-id="${s.id}">לסל</button></div>${row}</div>`;
}
// ---- קלטות בתוך מגירה ----
const POT_N = { 'גבוה': 3, 'בינוני': 2, 'נמוך': 1, 'צדדי': 0 };
const potDots = s => { const n = POT_N[s.data.potential] ?? 0; return `<span class="pot" aria-label="פוטנציאל ${esc(s.data.potential || 'לא נקבע')}">פוטנציאל<span>${[0, 1, 2].map(k => `<i class="${k < n ? 'on' : ''}"></i>`).join('')}</span></span>`; };
const ring = (v, sz) => { const r = 18, len = 2 * Math.PI * r * Math.max(0, Math.min(10, v || 0)) / 10; return `<svg class="ring" width="${sz}" height="${sz}" viewBox="0 0 44 44" aria-label="מוכנות ${rd(v)}"><circle cx="22" cy="22" r="${r}" class="rt"/><circle cx="22" cy="22" r="${r}" class="rv" stroke-dasharray="${len.toFixed(1)} 200" transform="rotate(-90 22 22)"/><text x="22" y="27" text-anchor="middle">${rd(v)}</text></svg>`; };
function sockets(s) {
  const f = flags(s);
  return [[f.sketch, I.mic, 'סקיצה'], [f.beat, I.tape, 'טייפ ביט'], [f.guitar, I.guitar, 'גיטרה']].map(([on, ic, l]) => `<span class="sock ${on ? 'on' : ''}" title="${l} · ${on ? 'קיים' : 'חסר'}" aria-label="${l} ${on ? 'קיים' : 'חסר'}">${ic}</span>`).join('');
}
function playBtn(s, cls) {
  const r = store.recsOf(s.id)[0];
  const on = r && AU.now.songId === s.id && AU.now.recId === r.id && !AU.player.paused;
  if (!r) return `<button class="cplay ${cls} none" disabled aria-label="אין הקלטה לשיר הזה">${I.play}</button>`;
  return `<button class="cplay ${cls} ${on ? 'on' : ''}" data-a="cardPlay" data-id="${s.id}" aria-label="${on ? 'עצירה' : 'נגינת ההקלטה הראשונה'}">${on ? '<span class="eq"><i></i><i></i><i></i></span>' : I.play}</button>`;
}
function songCard(s, man) {
  const playing = AU.now.songId === s.id && !AU.player.paused;
  return `<div class="cass ${playing ? 'playing' : ''}" data-a="open" data-id="${s.id}"${man ? ` data-dg="song"` : ''} role="button" tabindex="0">
    <div class="ct">${ring(s.data.readiness, 44)}<span class="sp"></span>${playBtn(s, '')}</div>
    <b class="cn">${s.data.pinned ? I.pin : ''}${esc(s.data.title)}</b>
    <div class="socks">${sockets(s)}</div>
    ${potDots(s)}</div>`;
}
function songLine(s, man, swipe) {
  const playing = AU.now.songId === s.id && !AU.player.paused;
  const row = `<div class="srow sline ${playing ? 'playing' : ''}" data-a="open" data-id="${s.id}"${!swipe && man ? ` data-dg="song"` : ''} role="button" tabindex="0">${man ? `<span class="grip" aria-hidden="true">${I.grip}</span>` : ''}${ring(s.data.readiness, 40)}
    <span class="grow"><span class="t">${s.data.pinned ? I.pin : ''}${esc(s.data.title)}</span>${potDots(s)}</span>
    <span class="socks sm">${sockets(s)}</span>${playBtn(s, 'sm')}</div>`;
  if (!swipe) return row;
  return `<div class="swrap ${ui.swipeOpen === s.id ? 'open' : ''}" data-sw="${s.id}"${man ? ` data-dg="song"` : ''}><div class="sw-act">
    <button data-a="moveSheet" data-id="${s.id}">העברה</button><button data-a="pin" data-id="${s.id}">${s.data.pinned ? 'ביטול הצמדה' : 'הצמדה'}</button><button class="del" data-a="trash" data-id="${s.id}">לסל</button></div>${row}</div>`;
}
const dview = k => { try { return (JSON.parse(localStorage.getItem('megira-dview') || '{}'))[k] || 'cards'; } catch (e) { return 'cards'; } };
function setDview(k, v) { try { const m = JSON.parse(localStorage.getItem('megira-dview') || '{}'); m[k] = v; localStorage.setItem('megira-dview', JSON.stringify(m)); } catch (e) {} }
function viewToggle(k) { const v = dview(k); return `<span class="vtog"><button class="${v === 'cards' ? 'on' : ''}" data-a="dview" data-k="${esc(k)}" data-v="cards" aria-label="תצוגת קלטות">${I.grid || '▦'}</button><button class="${v === 'list' ? 'on' : ''}" data-a="dview" data-k="${esc(k)}" data-v="list" aria-label="תצוגת רשימה">${I.list || '≡'}</button></span>`; }
function drawerList(st, wide) {
  const list = sortSongs(byStage(st.k), st.k);
  const sorts = [['man', 'ידני'], ['v', 'מוכנות'], ['ago', 'עריכה אחרונה'], ['pot', 'פוטנציאל'], ['abc', 'א–ת']];
  const man = ui.sort === 'man' && list.length > 1;
  return `<div class="hscroll" style="padding-bottom:4px">${sorts.map(([k, l]) => `<button class="chip ${ui.sort === k ? 'on' : ''}" data-a="sort" data-k="${k}">${l}${ui.sort === k && k !== 'man' ? `<span class="dir">${ui.sortDir === 1 ? '↓' : '↑'}</span>` : ''}</button>`).join('')}</div>
  ${list.length > 1 ? `<p class="hint draghint" style="margin:0 4px">${man ? 'לחיצה ארוכה על שיר, או גרירה מהידית, כדי להזיז. הסדר נשמר מיד.' : 'לסידור ידני בגרירה, בוחרים במיון "ידני".'}</p>` : ''}
  ${list.length ? (dview(st.k) === 'list'
    ? `<div class="songs" data-dgc="song" style="--g:${gv(st)}">${list.map(s => songLine(s, man, !wide)).join('')}</div>`
    : `<div class="cassg" data-dgc="song" data-two="1" style="--g:${gv(st)}">${list.map(s => songCard(s, man)).join('')}</div>`)
    : '<div class="box"><div class="empty">המגירה הזו ריקה</div></div>'}
  ${list.length ? `<div class="legend"><span>${I.mic.replace('17', '13').replace('17', '13')}סקיצה</span><span>${I.tape.replace('17', '13').replace('17', '13')}טייפ ביט</span><span>${I.guitar.replace('17', '13').replace('17', '13')}גיטרה</span><span>מלא = קיים</span></div>${wide || dview(st.k) !== 'list' ? '' : '<p class="hint" style="margin:0 4px">החלקה הצידה על שיר: העברה, הצמדה או סל.</p>'}` : ''}`;
}
function vDrawer() {
  const st = stageOf(ui.drawer);
  return `<div class="hdr" style="align-items:center"><button class="iconbtn" data-a="home" aria-label="חזרה">${I.back}</button><span class="glz" style="width:12px;height:12px;background:${gv(st)}"></span><h1 class="h2">${esc(st.name)}</h1>${viewToggle(st.k)}<button class="iconbtn acc" data-a="newSong" data-stage="${esc(st.k)}" aria-label="שיר חדש במגירה">${I.plus}</button></div>
  ${drawerList(st, false)}`;
}

// ---- עריכת מגירות ----
function vDrawersEdit(wide) {
  const ds = store.drawers(); const last = ds.length - 1;
  return `<div class="hdr" style="align-items:center">${wide ? '' : `<button class="iconbtn" data-a="home" aria-label="חזרה">${I.back}</button>`}<h1 class="h2">סידור המגירות</h1>${wide ? '' : '<button class="btn sm pri" data-a="home">סיום</button>'}</div>
  <p class="hint" style="margin:0 4px">שם, צבע וסדר של כל מגירה. גוררים מהידית כדי לשנות סדר. השירים עוברים יחד עם המגירה, ושינוי שם לא נוגע בהם.</p>
  <div class="box" data-dgc="drawer">${ds.map((d, i) => {
    const n = byStage(d.k).length + store.trashedSongs().filter(s => s.data.stage === d.k).length; const fixed = d.k === 'bottom';
    return `<div class="drow"${fixed ? '' : ` data-dg="drawer" data-k="${esc(d.k)}"`}><div class="in">
      <span class="grip" aria-hidden="true">${fixed ? I.lock || '' : I.grip}</span>
      <button class="sw" data-a="palFor" data-k="${esc(d.k)}" aria-label="צבע הזיגוג של ${esc(d.name)}"><span class="glz" style="width:16px;height:16px;background:${gv(d)}"></span></button>
      <label class="sr" for="dn-${i}">שם המגירה</label><input id="dn-${i}" value="${esc(d.name)}" data-change="drawerName" data-k="${esc(d.k)}" maxlength="30" autocomplete="off">
      <span class="cnt">${n}</span>
      <button class="mini del" data-a="delDrawer" data-k="${esc(d.k)}" aria-label="מחיקת המגירה" ${fixed ? 'disabled' : ''}>${I.trash}</button></div>
      ${ui.palFor === d.k ? `<div class="pal">${GLAZES.map(g => `<button class="${d.glaze === g.k ? 'on' : ''}" style="background:${glazeVar(g.k)}" data-a="setGlaze" data-k="${esc(d.k)}" data-g="${g.k}" aria-label="${g.name}"></button>`).join('')}</div>` : ''}
      ${ui.warnFor === d.k ? `<div class="warn">יש במגירה הזו ${n === 1 ? 'שיר אחד' : n + ' שירים'} (כולל בסל). קודם מעבירים אותם למגירה אחרת, ורק אז אפשר למחוק אותה.</div>` : ''}</div>`;
  }).join('')}</div>
  <button class="tile add" style="min-height:52px;flex-direction:row" data-a="addDrawer">${I.plus}מגירה חדשה</button>
  <div class="card" style="background:var(--ink);color:var(--bg);box-shadow:none;gap:6px"><b style="font-size:14px">המגירה התחתונה</b><span style="font-size:12px;line-height:1.6;opacity:.8">אפשר לשנות לה שם וצבע, אבל היא תמיד נשארת אחרונה, כדי שתמיד יהיה מקום לשירים שנגנזו.</span></div>`;
}

// ---- שיר ----
function songHead(wide) {
  const s = song(ui.songId), d = s.data, st = stageOf(d.stage), f = flags(s);
  const tabs = [['text', 'טקסט'], ['sound', 'סאונד'], ['state', 'מצב'], ['hist', 'היסטוריה']];
  return `<div class="songhead"><div class="top">${wide ? '' : `<button class="iconbtn sm" data-a="songBack" aria-label="חזרה">${I.back}</button>`}
    <div class="ti"><h1 class="h2" style="${wide ? 'font-size:34px' : ''}">${s.data.pinned ? I.pin + ' ' : ''}${esc(d.title)}</h1>
    <span class="meta"><span class="led" style="background:${gv(st)}"></span>${esc(st.name)} · מוכנות <b>${rd(d.readiness)}</b> · פוטנציאל ${esc(d.potential || '–')} · ${f.n} הקלטות</span></div></div>
    <div class="seg" style="grid-template-columns:repeat(4,minmax(0,1fr))" role="tablist">${tabs.map(([k, l]) => `<button class="${ui.tab === k ? 'on' : ''}" role="tab" aria-selected="${ui.tab === k}" data-a="tab" data-k="${k}">${l}</button>`).join('')}</div>
    ${ui.tab === 'text' ? textToolbar(s) : ''}</div>`;
}
function songBody(wide) {
  const s = song(ui.songId);
  return ui.tab === 'sound' ? tSound(s) : ui.tab === 'state' ? tState(s) : ui.tab === 'hist' ? tHist(s) : tText(s, wide);
}
function textToolbar(s) {
  const d = s.data;
  if (ui.editText) return `<div class="toolbar"><button class="tb on" data-a="editText">סיום עריכה</button><button class="tb" data-a="insSection">+ קטע</button><span class="saved" id="saved">נשמר</span></div>`;
  const fc = firstChord(d.lyrics);
  return `<div class="toolbar">
    <button class="tb" data-a="editText">${I.pencil}עריכה</button>
    <button class="tb ${ui.chordMode ? 'on' : ''}" data-a="chordMode">${ui.chordMode ? 'סיום' : 'אקורדים'}</button>
    ${fc ? `<span class="keybox"><button data-a="transpose" data-k="-1" aria-label="חצי טון למטה">−</button><b title="האקורד הראשון בשיר">${esc(fc)}</b><button data-a="transpose" data-k="1" aria-label="חצי טון למעלה">+</button></span>
    <button class="tb icon ${ui.showChords ? '' : 'on'}" data-a="toggleChords" aria-label="${ui.showChords ? 'הסתרת אקורדים' : 'הצגת אקורדים'}">${I.eye}</button>` : ''}
    ${d.lyrics.trim() ? `<button class="tb stage" data-a="stageOpen">${I.stage}במה</button>` : ''}</div>`;
}
function lyricsHtml(lyrics, chordMode, selL, selW) {
  const bl = CH.blocks(lyrics); let secN = 0;
  return bl.map(b => {
    if (b.type === 'blank') return '<div class="ln gap"></div>';
    if (b.type === 'section') { const chorus = /פזמון|קורוס/.test(b.name); secN++; return `<div class="sec" style="--st:color-mix(in srgb, ${chorus ? 'var(--g-rose)' : 'var(--g-celadon)'} 30%, transparent)"><span>${esc(b.name)}</span></div>`; }
    return `<div class="ln">${b.words.map((w, k) => chordMode ? `<button class="w ${b.i === selL && k === selW ? 'sel' : ''}" style="all:unset;display:inline-flex;flex-direction:column;cursor:pointer;border-radius:6px;padding:0 3px;margin:0 -3px;${b.i === selL && k === selW ? 'background:var(--acc-soft);box-shadow:0 0 0 2px var(--acc)' : ''}" data-a="pickChord" data-l="${b.i}" data-w="${k}" ${b.i === selL && k === selW ? 'id="selw"' : ''}><span class="c">${esc(w.chord)}</span><span>${esc(w.word) || '·'}</span></button>`
      : `<span class="w"><span class="c">${esc(w.chord)}</span><span>${esc(w.word)}</span></span>`).join('')}</div>`;
  }).join('');
}
function tText(s, wide) {
  const d = s.data;
  if (ui.editText) return `<textarea class="lyricsedit" id="lyr" dir="rtl" placeholder="כאן כותבים. שורה כמו פזמון: או בית 2: הופכת לכותרת קטע.">${esc(d.lyrics)}</textarea>
    <p class="hint">אקורד נכתב בסוגריים מרובעים צמוד למילה שמעליה הוא מנוגן, למשל [Am]. אפשר גם להדביק שיר בפורמט של שורת אקורדים מעל שורת מילים, והאקורדים יוצמדו למילים אוטומטית.</p>`;
  if (!d.lyrics.trim()) return `<div class="sheetpaper"><div class="empty">עוד אין כאן מילים.<br><button class="btn pri" style="margin-top:12px" data-a="editText">להתחיל לכתוב</button></div></div>`;
  const sh = ui.sheet && ui.sheet.type === 'chord' ? ui.sheet : null;
  return (ui.chordMode ? '<p class="hint" style="margin:0 4px">נגיעה במילה פותחת את בוחר האקורדים. "שמירה והבאה" עוברת למילה הבאה בלי לסגור.</p>' : '') +
    `<div class="sheetpaper ${ui.showChords || ui.chordMode ? '' : 'nochords'} ${ui.chordMode ? 'chordmode' : ''}"><div class="${wide ? 'lyr2' : ''}">${lyricsHtml(d.lyrics, ui.chordMode, sh ? sh.l : -1, sh ? sh.w : -1)}</div></div>
    ${sh ? '<div style="height:430px"></div>' : ''}`;
}

function waveHtml(r) {
  const p = r.meta.peaks || [];
  if (!p.length) return `<div class="wave flat scrub" data-scrub="wave" data-id="${r.id}"></div>`;
  return `<div class="wave scrub" data-scrub="wave" data-id="${r.id}" data-wave="${r.id}">${p.map(v => `<span style="height:${Math.max(8, v * 100)}%"></span>`).join('')}</div>`;
}
function tSound(s) {
  const recs = store.recsOf(s.id); const beats = s.data.beats || [];
  return `<div class="grid3"><button class="btn pri" data-a="recHere">הקלטה</button>
    <label class="btn" style="cursor:pointer">העלאת קובץ<input type="file" accept="audio/*,.m4a,.mp3,.wav,.aac" class="sr" data-change="upload"></label>
    <button class="btn" data-a="beatLink">קישור לביט</button></div>
  <div class="box">${recs.length ? recs.map(r => {
    const cur = AU.now.recId === r.id, on = cur && !AU.player.paused;
    return `<div class="trk ${cur ? 'cur' : ''}"><div class="trk-top"><button class="key ${on ? 'acc' : ''}" data-a="play" data-id="${r.id}" aria-label="${on ? 'השהיה' : 'השמעה'}">${on ? I.pause : I.play}</button>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="font-size:14px;font-weight:500">${esc(r.meta.name || kindName(r.meta.kind))}</span><span style="font-size:12px;color:var(--mute)"><span class="tag">${kindName(r.meta.kind)}</span> ${dmy(r.meta.date)}</span></span>
      <span class="num" style="font-size:12px;color:var(--mute);font-weight:400">${r.meta.duration ? dur(r.meta.duration) : ''}</span>
      <button class="more" data-a="recMenu" data-id="${r.id}" aria-label="אפשרויות">${I.dots}</button></div>${waveHtml(r)}</div>`;
  }).join('') : '<div class="empty">עוד אין הקלטות לשיר הזה. אפשר להקליט ישר מכאן, או להעלות הקלטה מתזכורות קוליות.</div>'}</div>
  ${beats.length ? `<section><div class="lbl"><span>קישורים לטייפ ביט</span></div><div class="box">${beats.map(b => `<div class="row" style="cursor:default"><span class="grow"><a class="t" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.note || 'טייפ ביט')}</a><span class="m" dir="ltr" style="text-align:right">${esc(b.url)}</span></span><button class="more" data-a="beatDel" data-id="${esc(b.id)}" aria-label="הסרת קישור">${I.x}</button></div>`).join('')}</div></section>` : ''}`;
}

function levelText(v) { return v == null ? 'עוד לא דורג' : v >= 10 ? '10 · סקיצה מוקלטת להשמעה' : v >= 9 ? rd(v) + ' · הפקה מוכנה להקלטה' : v >= 8 ? rd(v) + ' · טקסט, אקורדים ולחן' : v >= 7 ? rd(v) + ' · בסיס' : v >= 6 ? rd(v) + ' · מבנה' : rd(v) + ' · רעיון'; }
const TK_ACT = { 'הקלטה': ['להקליט עכשיו', I.mic], 'כתיבה': ['לפתוח את הטקסט', I.pen || ''], 'הפקה': ['לפתוח את הסאונד', I.tape] };
function taskRow(s, t, opt = {}) {
  const g = TK.dueGroup(t); const st = s.general ? null : stageOf(s.data.stage);
  const act = !s.general && TK_ACT[t.type] && (g === 'late' || g === 'today') && t.id !== 'n0';
  return `<div class="tk g-${g}" data-tk="${s.id}|${esc(t.id)}">
    <div class="tk-under"><span class="tk-ok">${I.check}בוצע</span><span class="tk-post"><button data-a="taskPost" data-id="${s.id}" data-t="${esc(t.id)}" data-k="1">מחר</button><button data-a="taskPost" data-id="${s.id}" data-t="${esc(t.id)}" data-k="7">שבוע הבא</button></span></div>
    <div class="tk-face">
      <button class="cb" data-a="taskDone" data-id="${s.id}" data-t="${esc(t.id)}" aria-label="סימון כבוצע">${I.check}</button>
      <div class="tk-main" data-a="taskEdit" data-id="${s.id}" data-t="${esc(t.id)}" role="button" tabindex="0">
        <span class="tk-t">${esc(t.text)}</span>
        <span class="tk-m">${opt.song ? `<span class="tk-song"><i style="background:${st ? gv(st) : 'var(--faint)'}"></i>${esc(s.general ? 'כללי' : s.data.title)}</span>` : ''}${opt.type === false ? '' : `<span class="tag">${esc(t.type || 'אחר')}</span>`}${t.due ? `<span class="tk-due">${I.clock.replace(/16/g, '12')}${esc(TK.dueLabel(t))}</span>` : ''}${t.due && TK.remsOf(t).length ? `<span class="tk-bell" title="תזכורת">${I.bell || ''}${TK.remsOf(t).length > 1 ? TK.remsOf(t).length : ''}</span>` : ''}</span>
        ${act ? `<button class="tk-go" data-a="taskGo" data-id="${s.id}" data-k="${esc(t.type)}">${TK_ACT[t.type][1]}${TK_ACT[t.type][0]}</button>` : ''}
      </div>
    </div></div>`;
}
function qChips(p, noSong) {
  const out = [];
  if (!noSong && p.songId && song(p.songId)) out.push(`<span class="qc">♪ ${esc(song(p.songId).data.title)}</span>`);
  if (p.type) out.push(`<span class="qc">${esc(p.type)}</span>`);
  if (p.due) out.push(`<span class="qc acc">${I.clock.replace(/16/g, '12')}${esc(TK.dueLabel(p))}</span>`);
  if (p.due) out.push(`<span class="qc acc">${I.bell || ''}תזכורת</span>`);
  return out.join('') || (noSong ? '' : '<span class="qhint">מזהה לבד תאריך, שעה, סוג עבודה ושם שיר</span>');
}
function notifyCard() {
  if (ui.notify === 'on' || ui.notify === 'denied' || ui.notify === 'unsupported' || !ui.notify) return '';
  if (!allHosts().some(s => store.openTasks(s).some(t => t.due))) return '';
  if (ui.notify === 'needs-install') return '';
  return `<div class="banner"><span>${I.bell || ''} להפעיל התראות כדי לקבל תזכורת בזמן?</span><button class="btn sm pri" data-a="notifyOn">הפעלה</button></div>`;
}
function tState(s) {
  const d = s.data;
  const open = TK.sortTasks(store.openTasks(s));
  return `<section><div class="lbl"><span>משימות לשיר</span><span>${openTxt(open.length)}</span></div>
    <div class="tks">${open.length ? open.map(t => taskRow(s, t, {})).join('') : '<div class="box"><div class="empty">אין משימות פתוחות. מה הדבר הבא שהשיר צריך?</div></div>'}</div>
    <form data-form="addTask" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
      <div class="addtask"><label class="sr" for="nt">משימה חדשה</label><input class="inp" id="nt" name="text" placeholder="למשל: להקליט גיטרה מחר ב־18" autocomplete="off" maxlength="200" data-input="nt"><button class="iconbtn" style="background:var(--ink);color:var(--bg)" type="submit" aria-label="הוספת משימה">${I.plus}</button></div>
      <div class="qchips" id="ntc"><span class="qhint">אפשר לכתוב גם מתי: "מחר", "ביום שלישי", "ב־18"</span></div>
      <div class="chips">${TASK_TYPES.map(t => `<button type="button" class="chip ${ui.taskType === t ? 'on' : ''}" data-a="taskType" data-k="${t}">${t}</button>`).join('')}</div>
    </form></section>
  <div class="card">
    <h2 class="h3">איפה השיר עומד</h2>
    <div class="field"><span class="flabel">מגירה</span><div class="chips">${store.drawers().map(st => `<button class="chip ${d.stage === st.k ? 'on' : ''}" data-a="setStage" data-k="${esc(st.k)}"><span class="led" style="background:${gv(st)}"></span>${esc(st.name)}</button>`).join('')}</div></div>
    <div class="field"><div style="display:flex;justify-content:space-between;align-items:baseline"><label for="rv">מוכנות</label><span class="num" id="rvv" style="font-family:var(--serif);font-size:24px">${rd(d.readiness)}</span></div>
      <input type="range" id="rv" min="0" max="10" step="0.5" value="${d.readiness ?? 0}" data-input="rv" data-change="readiness">
      <span class="tag" id="rvt" style="align-self:flex-start;font-size:13px;color:var(--ink);background:var(--paper);padding:6px 10px">${levelText(d.readiness)}</span></div>
    <div class="field"><span class="flabel">פוטנציאל</span><div class="seg" style="grid-template-columns:repeat(4,minmax(0,1fr))">${POTS.map(p => `<button class="${d.potential === p ? 'on' : ''}" data-a="setPot" data-k="${p}">${p}</button>`).join('')}</div></div>
  </div>
  <div class="card">
    <h2 class="h3">פרטים</h2>
    <div class="field"><label for="ti">שם השיר</label><input class="inp" id="ti" value="${esc(d.title)}" data-change="title"></div>
    <div class="field"><label for="nn">הערות</label><textarea class="inp" id="nn" data-change="notes" placeholder="מה אתה חושב על השיר, כיוון, השראה">${esc(d.notes)}</textarea></div>
    <div class="grid2"><button class="btn" data-a="pin" data-id="${s.id}">${d.pinned ? 'ביטול הצמדה' : 'הצמדה לראש'}</button><button class="btn danger" data-a="trash" data-id="${s.id}">העברה לסל</button></div>
  </div>`;
}

function tHist(s) {
  const log = s.data.log || [];
  const v = ui.versions && ui.versions.id === s.id ? ui.versions.list : null;
  return `<section><div class="lbl"><span>גרסאות טקסט</span></div><div class="box">${v == null ? `<button class="row" data-a="loadVersions"><span class="grow"><span class="t">הצגת כל גרסאות הטקסט</span><span class="m">נטען מהכספת</span></span>${I.chev}</button>`
    : v.length ? v.map((x, k) => `<button class="row" data-a="viewVersion" data-k="${k}"><span class="num" style="font-size:12px;width:62px;font-weight:400;color:var(--mute)">${dmy(x.created_at)}</span><span class="grow"><span class="t" style="font-size:14px;font-family:var(--serif)">${esc(plain(x.lyrics).trim().split('\n')[0] || 'ריק')}</span><span class="m">${hm(x.created_at)} · ${plain(x.lyrics).split(/\s+/).filter(Boolean).length} מילים</span></span>${I.chev}</button>`).join('') : '<div class="empty">עוד אין גרסאות שמורות. גרסה נשמרת בכל פעם שיוצאים משיר אחרי שינוי בטקסט.</div>'}</div></section>
  <section><div class="lbl"><span>יומן שינויים</span></div><div class="box" style="padding:4px 16px">${log.map(l => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--sep)"><span class="num" style="font-size:11px;color:var(--mute);width:58px;font-weight:400;flex:0 0 auto">${dmy(l.d)}</span><span style="font-size:14px;flex:1">${esc(l.e)}</span></div>`).join('')}</div></section>`;
}

// ---- מצב במה ----
function vStage() {
  const s = song(ui.songId); if (!s) return '';
  const bl = CH.blocks(s.data.lyrics); const secs = bl.filter(b => b.type === 'section');
  return `<div class="stagev" role="dialog" aria-label="מצב במה" style="--fs:${ui.stageSize}px">
    <div class="top"><button class="sbtn" data-a="stageClose" aria-label="יציאה ממצב במה">${I.x}</button>
      <div class="tt"><b>${esc(s.data.title)}</b><small>${firstChord(s.data.lyrics) ? 'פותח ב־' + esc(firstChord(s.data.lyrics)) + ' · ' : ''}המסך לא נכבה</small></div>
      <button class="sbtn" data-a="stageSize" data-k="-2" aria-label="הקטנת טקסט">א−</button><button class="sbtn" data-a="stageSize" data-k="2" aria-label="הגדלת טקסט" style="font-size:18px">א+</button></div>
    <div class="scroll" id="stageScroll">${lyricsHtml(s.data.lyrics, false)}</div>
    <div class="bottom">${secs.length ? `<div class="jumps">${secs.map((b, i) => `<button data-a="stageJump" data-k="${i}">${esc(b.name)}</button>`).join('')}</div>` : ''}
      <div class="ctl"><button class="go" data-a="stageRun" aria-label="${ui.stageRun ? 'עצירת גלילה' : 'הפעלת גלילה'}">${ui.stageRun ? I.pause.replace(/15/g, '22') : I.play.replace(/15/g, '22')}</button>
        <div style="flex:1;display:flex;flex-direction:column;gap:2px"><b style="font-size:13px">גלילה אוטומטית</b><small style="font-size:11px;color:#BDB1A4">${ui.stageRun ? 'גולל עכשיו' : 'עצור · מהירות לפי קצב השיר'}</small></div>
        <div class="spd"><button data-a="stageSpeed" data-k="-1" aria-label="איטי יותר">−</button><b>${ui.stageSpeed}</b><button data-a="stageSpeed" data-k="1" aria-label="מהר יותר">+</button></div></div></div></div>`;
}

// ---- משימות ----
function vTasks(wide) {
  const items = []; allHosts().forEach(s => store.openTasks(s).forEach(t => items.push({ s, t, g: TK.dueGroup(t) })));
  const late = items.filter(x => x.g === 'late').length, today = items.filter(x => x.g === 'today').length;
  let groups = '';
  if (ui.tasksView === 'date') {
    groups = TK.GROUPS.map(([k, name]) => {
      const its = items.filter(x => x.g === k); if (!its.length) return '';
      const sorted = TK.sortTasks(its.map(x => x.t)).map(t => its.find(x => x.t === t));
      return `<section class="tgrp g-${k}"><div class="ghead"><span class="led"></span><span class="gn">${name}</span><small>${its.length}</small></div><div class="tks">${sorted.map(({ s, t }) => taskRow(s, t, { song: true })).join('')}</div></section>`;
    }).join('');
  } else if (ui.tasksView === 'song') {
    const ss = allHosts().filter(s => store.openTasks(s).length).sort((a, b) => (a.general - b.general) || (b.data.readiness ?? -1) - (a.data.readiness ?? -1));
    groups = ss.map(s => { const ts = TK.sortTasks(store.openTasks(s));
      if (s.general) return `<section><div class="ghead"><span class="led" style="background:var(--faint)"></span><span style="flex:1;font-family:var(--serif);font-size:18px;font-weight:600">כללי</span><small>בלי שיר</small></div><div class="tks">${ts.map(t => taskRow(s, t, {})).join('')}</div></section>`;
      const st = stageOf(s.data.stage);
      return `<section><div class="ghead"><span class="led" style="background:${gv(st)}"></span><button data-a="openState" data-id="${s.id}">${esc(s.data.title)}</button><small>${esc(st.name)} · מוכנות ${rd(s.data.readiness)}</small></div><div class="tks">${ts.map(t => taskRow(s, t, {})).join('')}</div></section>`; }).join('');
  } else {
    groups = TASK_TYPES.map(ty => {
      const its = items.filter(x => (x.t.type || 'אחר') === ty); if (!its.length) return '';
      const sorted = TK.sortTasks(its.map(x => x.t)).map(t => its.find(x => x.t === t));
      return `<section><div class="ghead"><span style="flex:1;font-size:15px;font-weight:600">${ty}</span><small>${openTxt(its.length)}</small></div><div class="tks">${sorted.map(({ s, t }) => taskRow(s, t, { song: true, type: false })).join('')}</div></section>`;
    }).join('');
  }
  const qs = ui.qtSong === GEN ? 'משימה כללית' : ui.qtSong && song(ui.qtSong) ? song(ui.qtSong).data.title : '';
  return `<div><h1 class="h1">משימות</h1><div class="sub" style="margin-top:8px">${late ? `<b class="late-t">${late} באיחור</b> · ` : ''}${today} להיום · ${items.length} פתוחות</div></div>
  ${notifyCard()}
  <form class="qadd" data-form="quickTask">
    <div class="addtask"><label class="sr" for="qt">משימה חדשה</label><input class="inp" id="qt" name="text" value="${esc(ui.qtDraft || '')}" placeholder="להקליט גיטרה לשריטה ישנה מחר ב־18" autocomplete="off" maxlength="200" data-input="qt"><button class="iconbtn acc" type="submit" aria-label="הוספה">${I.plus}</button></div>
    <div class="qchips" id="qtc"><button type="button" class="qpick ${qs ? 'on' : ''}" data-a="songPick">♪ ${qs ? esc(qs) : 'בחירת שיר'}</button>${qChips(TK.parseTask(ui.qtDraft || '', songList()), true)}</div>
  </form>
  <div class="seg" style="grid-template-columns:repeat(3,minmax(0,1fr))"><button class="${ui.tasksView === 'date' ? 'on' : ''}" data-a="tasksView" data-k="date">לפי תאריך</button><button class="${ui.tasksView === 'song' ? 'on' : ''}" data-a="tasksView" data-k="song">לפי שיר</button><button class="${ui.tasksView === 'type' ? 'on' : ''}" data-a="tasksView" data-k="type">לפי סוג</button></div>
  ${groups || '<div class="box"><div class="empty">אין משימות פתוחות. כותבים למעלה, או מוסיפים בלשונית "מצב" של שיר.</div></div>'}
  ${items.length ? '<p class="hint" style="margin:0 4px">החלקה ימינה: בוצע. החלקה שמאלה: לדחות. נגיעה במשימה: עריכה, תאריך ותזכורת. משימה שבוצעה נרשמת בהיסטוריה של השיר.</p>' : ''}`;
}

// ---- חיפוש ----
const FILTERS = [
  ['r7', 'מוכנות 7 ומעלה', s => (s.data.readiness || 0) >= 7],
  ['nobeat', 'בלי טייפ ביט', s => !flags(s).beat],
  ['hipot', 'פוטנציאל גבוה', s => s.data.potential === 'גבוה'],
  ['old', 'לא נערך חודש', s => daysAgo(s.data.editedAt) > 30],
  ['norec', 'בלי הקלטה', s => flags(s).n === 0]
];
function searchResults() {
  const q = ui.q.trim();
  const fs = FILTERS.filter(f => ui.filters[f[0]]);
  return all().filter(s => fs.every(f => f[2](s))).map(s => {
    if (!q) return { s, hit: '' };
    const d = s.data; const L = plain(d.lyrics);
    if (d.title.includes(q)) return { s, hit: '' };
    const line = L.split('\n').find(l => l.includes(q));
    if (line) return { s, hit: line.trim() };
    if ((d.notes || '').includes(q) || store.tasksOf(s).some(t => t.text.includes(q))) return { s, hit: 'בהערות או במשימות' };
    return null;
  }).filter(Boolean).sort((a, b) => (b.s.data.readiness ?? -1) - (a.s.data.readiness ?? -1));
}
function vSearch() {
  return `<h1 class="h1">חיפוש</h1>
  <div><label for="q" class="sr">חיפוש</label><input class="inp" id="q" type="search" value="${esc(ui.q)}" placeholder="שורה שאתה זוכר, שם, מילה" data-input="q" autocomplete="off"></div>
  <div class="chips">${FILTERS.map(f => `<button class="chip ${ui.filters[f[0]] ? 'on' : ''}" data-a="filter" data-k="${f[0]}">${f[1]}</button>`).join('')}</div>
  <div class="songs" id="results">${resultsHtml()}</div>`;
}
function resultsHtml() {
  const r = searchResults();
  if (!ui.q.trim() && !Object.values(ui.filters).some(Boolean)) {
    const rec = deskCards();
    return rec.length ? '<div class="lbl"><span>פתוחים לאחרונה</span></div>' + rec.map(s => songRow(s, { meta: esc(stageOf(s.data.stage).name) + ' · ' + rel(s.data.editedAt) })).join('') : '<div class="box"><div class="empty">מחפשים בכל השמות, המילים, ההערות והמשימות.</div></div>';
  }
  const q = ui.q.trim();
  return r.length ? r.slice(0, 80).map(({ s, hit }) => songRow(s, { meta: hit ? (q && hit.includes(q) ? esc(hit).split(esc(q)).join('<b style="color:var(--ink)">' + esc(q) + '</b>') : esc(hit)) : esc(stageOf(s.data.stage).name) })).join('') : '<div class="box"><div class="empty">לא נמצא כלום</div></div>';
}

// ---- מערכת ----
const COMPRESSED = /aac|mp4|m4a|mpeg|mp3|ogg|webm|opus/i;
function bigRecs() {
  return store.recsOf ? [...S.recs.values()].filter(r => !r.deleted_at && ((r.meta.size || 0) > 40 * 1048576 || ((r.meta.size || 0) > 12 * 1048576 && !COMPRESSED.test(r.meta.mime || '')))).sort((a, b) => b.meta.size - a.meta.size) : [];
}
function storageTools() {
  const big = bigRecs();
  const orph = ui.orphans;
  const orphRow = orph == null
    ? `<div class="row" style="cursor:default"><span class="grow"><span class="t">שאריות</span><span class="m">קבצים שנשארו מהעלאות שנכשלו באמצע</span></span><button class="btn sm" data-a="orphCheck">בדיקה</button></div>`
    : orph.length
      ? `<div class="row" style="cursor:default"><span class="grow"><span class="t">נמצאו שאריות</span><span class="m">${orph.length === 1 ? 'קובץ אחד' : orph.length + ' קבצים'} · ${mb(orph.reduce((a, f) => a + f.size, 0))} מ״ב שלא שייכים לשום הקלטה</span></span><button class="btn sm pri" data-a="orphClean">ניקוי</button></div>`
      : `<div class="row" style="cursor:default"><span class="grow"><span class="t">אין שאריות</span><span class="m">כל הקבצים שייכים להקלטות</span></span></div>`;
  return `${orphRow}${big.length ? `<div class="row" style="cursor:default;flex-direction:column;align-items:stretch;gap:6px"><span class="t">הקלטות גדולות</span><span class="m" style="white-space:normal;line-height:1.5">כיווץ מחליף את המקור בגרסה קטנה באיכות גבוהה. אחרי הכיווץ המקור נמחק.</span></div>
    ${big.map(r => { const sg = song(r.song_id); return `<div class="row" style="cursor:default"><span class="grow"><span class="t">${esc(r.meta.name || kindName(r.meta.kind))}</span><span class="m">${esc(sg ? sg.data.title : '')} · ${mb(r.meta.size)} מ״ב${r.meta.duration ? ' · ' + dur(r.meta.duration) : ''}</span></span><button class="btn sm" data-a="recompressAsk" data-id="${r.id}">כיווץ</button></div>`; }).join('')}` : ''}
    ${(() => { let l = []; try { l = JSON.parse(localStorage.getItem('megira-cmp-log') || '[]'); } catch (e) {} return l.length ? `<details class="cmplog"><summary>יומן כיווץ במכשיר הזה</summary>${l.map(x => `<div>${esc(x)}</div>`).join('')}</details>` : ''; })()}`;
}
function vSys() {
  const used = store.storageUsed(), pct = Math.min(100, used / CONFIG.storageLimitBytes * 100);
  const tr = store.trashedSongs().length + store.trashedRecs().length;
  const pref = TH.pref(); const night = TH.isNight();
  const modes = [['day', 'יום', I.sun], ['night', 'לילה', I.moon], ['auto', 'לפי השעה', I.clock]];
  return `<h1 class="h1">מערכת</h1>
  <section><div class="lbl"><span>מראה</span></div><div class="card" style="gap:14px">
    <div class="seg" style="grid-template-columns:repeat(3,minmax(0,1fr))">${modes.map(([k, l, ic]) => `<button class="${pref === k ? 'on' : ''}" data-a="setTheme" data-k="${k}" aria-pressed="${pref === k}">${ic.replace(/width="18" height="18"/, 'width="16" height="16"')}${l}</button>`).join('')}</div>
    <div class="thumbs" aria-hidden="true"><div class="thumb d ${night ? '' : 'sel'}"><i></i><div><span style="--tc:#93A896"></span><span style="--tc:#C48A6C"></span></div></div><div class="thumb n ${night ? 'sel' : ''}"><i></i><div><span style="--tc:#7F9683"></span><span style="--tc:#B57B5E"></span></div></div></div>
    <span class="hint">${pref === 'auto' ? 'בערב, מ־19:00, המגירה מתכהה מעצמה, ובבוקר, מ־06:30, חוזרת לאור. כפתור הירח במסך הבית מחליף ידנית בכל רגע.' : pref === 'night' ? 'המגירה נשארת כהה כל הזמן, גם ביום.' : 'המגירה נשארת בהירה כל הזמן, גם בלילה.'} ההגדרה נשמרת רק במכשיר הזה.</span>
  </div></section>
  <section><div class="lbl"><span>תנועה</span></div><div class="card" style="gap:10px">
    <div class="seg"><button class="${TH.motion() === 'full' ? 'on' : ''}" data-a="setMotion" data-k="full">מלאה</button><button class="${TH.motion() === 'system' ? 'on' : ''}" data-a="setMotion" data-k="system">לפי הטלפון</button></div>
    <span class="hint">${TH.motion() === 'full' ? 'כל האנימציות פועלות, גם אם בטלפון מופעלת "הפחתת תנועה".' : (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'בטלפון שלך מופעלת "הפחתת תנועה", ולכן רוב האנימציות כבויות.' : 'האנימציות פועלות, ויכבו אם תפעיל "הפחתת תנועה" בטלפון.')}</span>
  </div></section>
  <section><div class="lbl"><span>התראות</span></div><div class="box">
    <div class="row" style="cursor:default"><span class="grow"><span class="t">תזכורות למשימות</span><span class="m">${ui.notify === 'on' ? 'פעילות במכשיר הזה. הטקסט נשלח מוצפן ונפתח רק כאן' : ui.notify === 'needs-install' ? 'עובד רק כשהמגירה פתוחה מהאייקון במסך הבית' : ui.notify === 'denied' ? 'חסומות בהגדרות הטלפון. אפשר לאשר שם, תחת המגירה' : ui.notify === 'unsupported' ? 'הדפדפן הזה לא תומך בהתראות' : 'כבויות במכשיר הזה'}</span></span>
    ${ui.notify === 'on' ? '<button class="btn sm" data-a="notifyOff">כיבוי</button>' : ui.notify === 'off' ? '<button class="btn sm pri" data-a="notifyOn">הפעלה</button>' : ''}</div></div></section>
  <section><div class="lbl"><span>גיבוי וסנכרון</span></div><div class="box">
    <div class="row" style="cursor:default"><span class="grow"><span class="t">סנכרון</span><span class="m">${!S.online ? 'אין חיבור. כל שינוי נשמר במכשיר ויעלה כשהחיבור יחזור' : S.pending ? S.pending + ' שינויים בדרך לענן' : 'הכל מגובה בענן' + (S.lastSync ? ' · ' + hm(S.lastSync) : '')}</span></span><button class="btn sm" data-a="syncNow">סנכרון עכשיו</button></div>
    <button class="row" data-a="backup" data-k="text"><span class="grow"><span class="t">גיבוי מוצפן של הטקסטים</span><span class="m">${ui.lastBackup ? 'גיבוי אחרון: ' + rel(ui.lastBackup) : 'עוד לא נעשה גיבוי'}</span></span>${I.lock}</button>
    <button class="row" data-a="backup" data-k="full"><span class="grow"><span class="t">גיבוי מוצפן מלא, כולל הקלטות</span><span class="m">נפתח רק עם סיסמת הכספת או מפתח השחזור</span></span>${I.lock}</button>
    <label class="row"><span class="grow"><span class="t">שחזור מגיבוי</span><span class="m">מחזיר שירים והקלטות שחסרים. לא דורס שום דבר קיים</span></span>${I.chev}<input type="file" accept=".json,application/json" class="sr" data-change="restore"></label>
    <button class="row" data-a="sysView" data-k="trash"><span class="grow"><span class="t">סל מחזור</span><span class="m">${tr} פריטים · נמחקים לצמיתות אחרי ${CONFIG.trashDays} יום</span></span>${I.chev}</button>
    <label class="row"><span class="grow"><span class="t">ייבוא שירים מקובץ</span><span class="m">חבילת ייבוא או ייצוא של הפתקים</span></span>${I.chev}<input type="file" accept=".json,.txt,application/json,text/plain" class="sr" data-change="import"></label>
    <div class="row" style="cursor:default;flex-direction:column;align-items:stretch;gap:8px"><span style="display:flex;justify-content:space-between;font-size:14px"><span>אחסון הקלטות</span><span class="num" style="font-weight:400;color:var(--mute)">${mb(used)} / 1024 מ״ב</span></span><div class="meter"><span style="width:${pct}%;${pct >= 80 ? 'background:var(--acc)' : ''}"></span></div><span class="m">${pct >= 80 ? 'מתקרב למגבלה. אפשר לכווץ הקלטות גדולות כאן למטה.' : 'התראה תופיע כשתגיע ל־80%'}</span></div>
    ${storageTools()}
  </div></section>
  <section><div class="lbl"><span>אבטחה</span></div><div class="box">
    <button class="row" data-a="${ui.mfaOn ? 'mfaOff' : 'mfaSetup'}"><span class="grow"><span class="t">אימות דו־שלבי</span><span class="m">${ui.mfaOn ? 'פעיל · כניסה דורשת גם קוד מאפליקציית אימות' : 'כבוי · מומלץ להפעיל'}</span></span><span class="glz" style="background:${ui.mfaOn ? 'var(--g-celadon)' : 'var(--acc)'}"></span></button>
    <button class="row" data-a="${ui.pkEnrolled ? 'pkOff' : 'pkSetup'}"><span class="grow"><span class="t">פתיחה בטביעת פנים</span><span class="m">${ui.pkEnrolled ? 'פעיל במכשיר הזה' : 'כבוי · במקום להשאיר את הכספת פתוחה'}</span></span><span class="glz" style="background:${ui.pkEnrolled ? 'var(--g-celadon)' : 'var(--acc)'}"></span></button>
    ${ui.pkEnrolled ? `<button class="row" data-a="autolockSheet"><span class="grow"><span class="t">נעילה אוטומטית</span><span class="m">${ui.autolock === 0 ? 'מיד כשיוצאים מהאפליקציה' : 'אחרי ' + ui.autolock + ' דקות ברקע'}</span></span>${I.chev}</button>` : ''}
    <button class="row" data-a="changePass"><span class="grow"><span class="t">שינוי סיסמת כספת</span></span>${I.chev}</button>
    <button class="row" data-a="newRk"><span class="grow"><span class="t">יצירת מפתח שחזור חדש</span><span class="m">המפתח הקודם יפסיק לעבוד</span></span>${I.chev}</button>
    <button class="row" data-a="lockNow"><span class="grow"><span class="t">נעילה עכשיו</span><span class="m">בפתיחה הבאה תידרש סיסמת הכספת</span></span>${I.lock}</button>
  </div></section>
  <section><div class="lbl"><span>חשבון</span></div><div class="box">
    <button class="row" data-a="signOut"><span class="grow"><span class="t" style="color:var(--danger)">התנתקות מהמכשיר</span><span class="m">מוחק את העותק המקומי. הכל נשאר בענן</span></span></button>
  </div><p class="hint" style="margin:8px 4px 0">${esc((api.currentUser() || {}).email || '')}</p></section>`;
}
function vTrash(wide) {
  const ts = store.trashedSongs(), trs = store.trashedRecs();
  const left = iso => Math.max(0, Math.ceil(CONFIG.trashDays - daysAgo(iso)));
  return `<div class="hdr" style="align-items:center"><button class="iconbtn" data-a="sysView" data-k="main" aria-label="חזרה">${I.back}</button><h1 class="h2">סל מחזור</h1></div>
  <p class="hint" style="margin:0 4px">פריטים כאן נמחקים לצמיתות אוטומטית אחרי ${CONFIG.trashDays} יום. מחיקה מיידית אפשרית רק מכאן.</p>
  <section><div class="lbl"><span>שירים</span><span>${ts.length}</span></div><div class="box">${ts.length ? ts.map(s => `<div class="row" style="cursor:default"><span class="grow"><span class="t">${esc(s.data.title)}</span><span class="m">עוד ${left(s.deleted_at)} ימים</span></span><button class="btn sm" data-a="restore" data-id="${s.id}">שחזור</button><button class="btn sm danger" data-a="purge" data-id="${s.id}">מחיקה</button></div>`).join('') : '<div class="empty">ריק</div>'}</div></section>
  <section><div class="lbl"><span>הקלטות</span><span>${trs.length}</span></div><div class="box">${trs.length ? trs.map(r => `<div class="row" style="cursor:default"><span class="grow"><span class="t">${esc(r.meta.name || kindName(r.meta.kind))}</span><span class="m">${esc((song(r.song_id) || { data: { title: '' } }).data.title)} · עוד ${left(r.deleted_at)} ימים</span></span><button class="btn sm" data-a="recRestore" data-id="${r.id}">שחזור</button><button class="btn sm danger" data-a="recPurge" data-id="${r.id}">מחיקה</button></div>`).join('') : '<div class="empty">ריק</div>'}</div></section>`;
}

// ---- מחשב: שלוש עמודות ----
function vWide() {
  const ds = store.drawers(); const openN = all().reduce((a, s) => a + store.tasksOf(s).filter(t => !t.done).length, 0);
  const night = TH.isNight();
  const side = `<aside class="side">
    <div class="brand">${LOGO(34)}<b>המגירה</b><span style="flex:1"></span><button class="iconbtn sm" data-a="themeToggle" aria-label="${night ? 'מעבר למצב יום' : 'מעבר למצב לילה'}">${night ? I.sun : I.moon}</button></div>
    <button class="btn pri sm" data-a="newSong">${I.plus.replace(/20/g, '16')}שיר חדש</button>
    <div style="display:flex;flex-direction:column;gap:2px">
      <div class="sidelbl"><span>מגירות</span><button data-a="drawersEdit">סידור</button></div>
      ${ds.map(st => `<button class="sidebtn ${ui.nav === 'home' && ui.view !== 'drawers' && ui.drawer === st.k ? 'on' : ''}" data-a="drawer" data-k="${esc(st.k)}"><span class="glz" style="background:${gv(st)}"></span><span>${esc(st.name)}</span><small>${byStage(st.k).length}</small></button>`).join('')}
    </div>
    <div style="display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--sep);padding-top:12px">
      <button class="sidebtn ${ui.nav === 'search' ? 'on' : ''}" data-a="nav" data-k="search">${I.search.replace(/21/g, '18')}<span>חיפוש</span><small dir="ltr">⌘K</small></button>
      <button class="sidebtn ${ui.nav === 'tasks' ? 'on' : ''}" data-a="nav" data-k="tasks">${I.tasks.replace(/21/g, '18')}<span>משימות</span><small>${openN}</small></button>
      <button class="sidebtn ${ui.nav === 'sys' ? 'on' : ''}" data-a="nav" data-k="sys">${I.sys.replace(/21/g, '18')}<span>מערכת</span></button>
    </div>
    <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;padding:0 6px"><span class="sub">${S.pending ? 'מסנכרן…' : S.lastSync ? 'מגובה ' + hm(S.lastSync) : ''}</span><button class="btn sm dark" data-a="lockNow">${I.lock.replace(/18/g, '14')}נעילה</button></div>
  </aside>`;
  let mid = '';
  if (ui.nav === 'search') mid = vSearch();
  else if (ui.nav === 'tasks') mid = vTasks(true);
  else if (ui.nav === 'sys') mid = ui.sysView === 'trash' ? vTrash(true) : vSys();
  else if (ui.view === 'drawers') mid = vDrawersEdit(true);
  else { const st = stageOf(ui.drawer); mid = `<div class="hdr" style="align-items:center"><span class="glz" style="width:12px;height:12px;background:${gv(st)}"></span><h1 class="h2">${esc(st.name)}</h1>${viewToggle(st.k)}<button class="iconbtn sm acc" data-a="newSong" data-stage="${esc(st.k)}" aria-label="שיר חדש במגירה">${I.plus}</button></div>${drawerList(st, true)}`; }
  const has = ui.songId && song(ui.songId);
  const main = has ? songHead(true) + `<div class="body">${songBody(true)}</div>` : `<div class="ph"><b>${greet()}, דנדול</b><span>בוחרים שיר מהרשימה, והוא נפתח כאן בגדול.</span><div class="hscroll" style="margin:12px 0 0;padding:4px 0 10px;max-width:100%">${deskCards().slice(0, 4).map(s => { const st = stageOf(s.data.stage); return `<button class="desk" data-a="open" data-id="${s.id}" style="--g:${gv(st)}"><span class="top"><span><span class="led" style="background:${gv(st)}"></span>${esc(st.name)}</span><b class="num" style="font-size:13px;color:var(--ink)">${rd(s.data.readiness)}</b></span><span class="tt">${esc(s.data.title)}</span><span class="tape" aria-hidden="true"><i></i><b></b><i></i></span></button>`; }).join('')}</div></div>`;
  return `<div class="wide">${SPECK}${side}<div class="col mid">${mid}</div><div class="col main2">${main}</div>
    ${vQueue()}${vRecbar()}${vPlayer()}${ui.sheet ? vSheet() : ''}${ui.stage ? vStage() : ''}</div>`;
}

// ---------- חלונות צפים ----------
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const QUALS = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'dim', 'add9', '6'];
function chordValue(sh) { return sh.root ? sh.root + sh.q + (sh.bass ? '/' + sh.bass : '') : ''; }
function vSheet() {
  const sh = ui.sheet; let h = '';
  if (sh.type === 'chord') {
    const recent = CH.songChords(song(ui.songId).data.lyrics).slice(0, 8);
    h = `<div class="chhead"><button class="iconbtn sm" data-a="chordNav" data-k="-1" aria-label="המילה הקודמת">${I.prev}</button>
      <div class="preview"><small>אקורד מעל «${esc(sh.word || '·')}»</small><b id="chp">${esc(chordValue(sh) || sh.cur || '—')}</b></div>
      <button class="iconbtn sm" data-a="chordNav" data-k="1" aria-label="המילה הבאה">${I.next}</button></div>
    ${recent.length ? `<div><div class="lbl" style="margin-bottom:6px"><span>בשיר הזה · נגיעה שומרת ועוברת למילה הבאה</span></div><div class="used">${recent.map(c => `<button data-a="chordQuick" data-k="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}
    <div class="keys">${ROOTS.map(r => `<button class="${sh.root === r ? 'on' : ''}" data-a="chRoot" data-k="${r}">${r}</button>`).join('')}</div>
    <div class="qual">${QUALS.map(q => `<button class="${sh.root && sh.q === q ? 'on' : ''}" data-a="chQ" data-k="${q}">${q || 'מז׳'}</button>`).join('')}</div>
    ${sh.bassOpen ? `<div class="keys">${ROOTS.map(r => `<button class="${sh.bass === r ? 'on' : ''}" style="height:34px;font-size:12px" data-a="chBass" data-k="${r}">/${r}</button>`).join('')}</div>
      <div class="field"><label for="chf">או כתיבה חופשית</label><input class="inp ltr" id="chf" value="${esc(chordValue(sh) || sh.cur || '')}" placeholder="Am7" autocomplete="off" autocapitalize="off"></div>` : ''}
    <div style="display:flex;gap:6px"><button class="btn sm" data-a="bassToggle">${sh.bassOpen ? 'פחות' : '+ בס'}</button><button class="btn sm danger" data-a="chordSet" data-k="">הסרה</button>
      <button class="btn pri" style="flex:1;height:44px" data-a="chordOk">שמירה והבאה ${I.next}</button><button class="btn sm dark" data-a="closeSheet">סיום</button></div>`;
  } else if (sh.type === 'newSong') {
    h = `<h3>שיר חדש</h3><form data-form="newSong" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="ns">שם</label><input class="inp" id="ns" name="title" required autocomplete="off"></div>
      <div class="field"><span class="flabel">מגירה</span><div class="chips">${store.drawers().map(st => `<label class="chip"><input type="radio" name="stage" value="${esc(st.k)}" ${(sh.stage || 'spark') === st.k ? 'checked' : ''} style="accent-color:var(--acc);margin:0"><span class="led" style="background:${gv(st)}"></span>${esc(st.name)}</label>`).join('')}</div></div>
      <button class="btn pri full" type="submit">יצירה ופתיחה</button></form>`;
  } else if (sh.type === 'move') {
    const s = song(sh.id);
    h = `<h3>להעביר את "${esc(s.data.title)}" ל…</h3><div class="box">${store.drawers().map(st => `<button class="row" data-a="moveTo" data-k="${esc(st.k)}" data-id="${sh.id}"><span class="glz" style="background:${gv(st)}"></span><span class="grow"><span class="t">${esc(st.name)}</span></span>${s.data.stage === st.k ? I.check : ''}</button>`).join('')}</div>`;
  } else if (sh.type === 'beat') {
    h = `<h3>קישור לטייפ ביט</h3><form data-form="beat" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="bu">כתובת</label><input class="inp ltr" id="bu" name="url" type="url" placeholder="https://" required></div>
      <div class="field"><label for="bn">תיאור</label><input class="inp" id="bn" name="note" placeholder="למשל: גרסה 2, יותר איטית"></div>
      <button class="btn pri full" type="submit">הוספה</button></form>`;
  } else if (sh.type === 'queue') {
    h = `<h3>העלאות</h3><span class="hint" style="margin-top:-8px">${Q.running ? 'כדאי להשאיר את המגירה פתוחה עד הסוף. ביציאה מהאפליקציה הטלפון עוצר את ההעלאה.' : 'התור הסתיים'}</span>
    <div class="box">${Q.jobs.map(j => `<div class="row qrow" id="qj${j.id}" style="cursor:default;flex-direction:column;align-items:stretch;gap:6px"><span style="display:flex;align-items:center;gap:8px"><span class="grow"><span class="t">${esc(j.name)}</span><span class="m ql">${esc(j.lbl)}</span></span>
      ${j.st === 'err' && j.f ? `<button class="btn sm" data-a="qRetry" data-id="${j.id}">ניסיון חוזר</button>` : ''}${j.st === 'wait' || j.st === 'err' ? `<button class="mini" data-a="qRemove" data-id="${j.id}" aria-label="הסרה מהתור">${I.x}</button>` : ''}${j.st === 'done' ? `<span class="okm">${I.check}</span>` : ''}</span>
      ${j.st === 'cmp' || j.st === 'up' ? `<div class="meter"><span style="width:${Math.round(j.p * 100)}%"></span></div>` : ''}</div>`).join('')}</div>`;
  } else if (sh.type === 'uploadKind' || sh.type === 'recKind') {
    h = `<h3>${sh.type === 'uploadKind' ? 'מה זה הקובץ הזה?' : 'מה הקלטת עכשיו?'}</h3>
    <div class="field"><label for="rn">שם</label><input class="inp" id="rn" value="${esc(sh.name || '')}"></div>
    <div class="box">${KINDS.map(k => `<button class="row" data-a="${sh.type === 'uploadKind' ? 'uploadAs' : 'recAs'}" data-k="${k.k}"><span class="grow"><span class="t">${k.name}</span></span>${I.chev}</button>`).join('')}</div>`;
  } else if (sh.type === 'uploadHow') {
    const used = store.storageUsed(), lim = CONFIG.storageLimitBytes;
    const after = used + (sh.pick === 'small' ? sh.small : sh.size);
    const parts = Math.ceil(sh.size / (45 * 1048576));
    const opt = (k, t, dsc, size, tag) => `<button class="opt ${sh.pick === k ? 'on' : ''}" data-a="upPick" data-k="${k}"><span class="radio"><span></span></span><span class="grow"><span class="ot"><b>${t}</b>${tag ? '<span class="tagx">' + tag + '</span>' : ''}</span><span class="od">${dsc}</span><span class="os">${size}</span></span></button>`;
    h = `${upCard(sh)}<h3>איך לשמור את הקובץ?</h3>
    <p class="hint" style="margin:-6px 0 0;font-size:13px;line-height:1.6">${sh.canC ? 'הקובץ לא מכווץ, ולכן כבד. אפשר לכווץ אותו כאן בטלפון, לפני ההצפנה, או לשמור את המקור כמו שהוא.' : sh.lossless ? 'הדפדפן הזה לא יודע לכווץ קבצים, אז הקובץ יישמר במקור, מחולק לחתיכות.' : 'הקובץ כבר מכווץ, אבל גדול מהמגבלה של השרת. הוא יישמר כמו שהוא, מחולק לחתיכות.'}</p>
    ${sh.canC ? opt('small', 'לכווץ', 'נשמע זהה באוזניות ובהשמעה. מתאים לסקיצות, רעיונות ופגישות השמעה.', mb(sh.size) + ' מ״ב ← כ־' + mb(sh.small) + ' מ״ב', 'לסקיצות') : ''}
    ${opt('orig', 'לשמור מקור', 'הקובץ נשמר בדיוק כמו שהוא. מתאים לקבצים שהולכים להפקה ולמיקס.', mb(sh.size) + ' מ״ב' + (parts > 1 ? ' · ' + (parts === 2 ? 'שתי חתיכות' : parts + ' חתיכות') : ''), '')}
    <div class="upstore"><div class="meter"><span style="width:${Math.min(100, after / lim * 100).toFixed(1)}%;${after / lim >= .8 ? 'background:var(--acc)' : ''}"></span></div><span>אחסון אחרי ההעלאה: ${mb(after)} מ״ב מתוך ג׳יגה</span></div>
    <button class="btn pri full" style="height:54px;font-size:16px" data-a="upGo">${sh.pick === 'small' ? 'לכווץ ולהעלות' : 'להעלות מקור'}</button>`;
  } else if (sh.type === 'uploadWork') {
    const steps = sh.small ? ['מכווץ בטלפון', 'מצפין ומעלה'] : [sh.parts > 1 ? 'מצפין ומעלה · חתיכה 1 מתוך ' + sh.parts : 'מצפין ומעלה'];
    h = `${upCard(sh)}<h3>${sh.small ? 'מכין את הסקיצה' : 'מעלה את המקור'}</h3>
    ${steps.map((t, i) => `<div class="upstep ${i === 0 ? 'on' : ''}"><div class="ul"><span id="upt${i}">${t}</span><span id="upr${i}" class="num">0%</span></div><div class="meter"><span id="upb${i}" style="width:0%"></span></div></div>`).join('')}
    <p class="hint" style="margin:0;font-size:12px;line-height:1.6">כדאי להשאיר את המסך פתוח עד הסוף. אם הרשת נופלת לרגע, כל חתיכה מנסה שוב לבד.</p>`;
  } else if (sh.type === 'uploadDone') {
    h = `<div class="updone"><span class="ok pop">${I.check || '✓'}</span><b>נשמר במגירה</b><span class="hint">${esc(sh.txt)}</span></div>`;
  } else if (sh.type === 'recompress') {
    const r = S.recs.get(sh.id); const sg = r && song(r.song_id);
    const est = r && r.meta.duration ? Math.round(r.meta.duration * 192000 / 8) : (r ? r.meta.size * 0.18 : 0);
    h = `<h3>לכווץ את ההקלטה?</h3>
    <div class="upcard"><span class="grow"><b>${esc(r ? (r.meta.name || kindName(r.meta.kind)) : '')}</b><span class="hint">${esc(sg ? sg.data.title : '')} · ${mb(r ? r.meta.size : 0)} מ״ב ← כ־${mb(est)} מ״ב</span></span></div>
    <p class="hint" style="margin:0;line-height:1.6">הגרסה המכווצת נשמעת זהה באוזניות ובהשמעה. היא עולה קודם, ורק אחרי שהיא שמורה המקור נמחק. <b>את המקור אי אפשר לשחזר אחר כך</b>, אז אם זה קובץ להפקה, כדאי שיהיה לך עותק במחשב.</p>
    <p class="hint" style="margin:0">אם הטלפון יכווץ בזמן אמת, זה ייקח כאורך ההקלטה${r && r.meta.duration ? ' (' + dur(r.meta.duration) + ')' : ''}, והמסך יישאר דלוק.</p>
    <div class="grid2"><button class="btn" data-a="closeSheet">ביטול</button><button class="btn pri" data-a="recompressGo">כיווץ</button></div>`;
  } else if (sh.type === 'player') {
    const r = S.recs.get(AU.now.recId); const p = !AU.player.paused, d = AU.player.duration || 0, rate = AU.player.playbackRate || 1;
    h = `<div class="pfhead"><span class="disc ${p ? 'spin' : ''}" aria-hidden="true"></span><div class="grow"><b>${esc(AU.now.title)}</b><span class="hint">${esc(AU.now.song)}${r ? ' · ' + esc(kindName(r.meta.kind)) : ''}</span></div><button class="linkbtn" data-a="goPlaying">לשיר ←</button></div>
    ${bigWave(r)}
    <div class="pftimes"><span id="pft">${dur(AU.player.currentTime)}</span><span id="pfl">-${dur(Math.max(0, d - AU.player.currentTime))}</span></div>
    <div class="pfctl"><button class="skip big" data-a="skip" data-k="-10" aria-label="10 שניות אחורה">${I.rw10}<small>10</small></button>
      <button class="pfplay" data-a="playToggle" aria-label="${p ? 'השהיה' : 'השמעה'}">${p ? I.pause : I.play}</button>
      <button class="skip big" data-a="skip" data-k="10" aria-label="10 שניות קדימה">${I.ff10}<small>10</small></button></div>
    <div class="chips" style="justify-content:center">${[0.75, 1, 1.25, 1.5].map(v => `<button class="chip ${rate === v ? 'on' : ''}" data-a="pspeed" data-k="${v}" style="direction:ltr">${v}×</button>`).join('')}</div>`;
  } else if (sh.type === 'songPick') {
    h = `<div style="display:flex;align-items:center;gap:10px">${sh.dr && !sh.q ? `<button class="iconbtn" data-a="spBack" aria-label="חזרה">${I.back}</button>` : ''}<h3 style="flex:1">${sh.dr && !sh.q ? esc(stageOf(sh.dr).name) : 'לאיזה שיר?'}</h3></div>
    <label class="sr" for="spq">חיפוש שיר</label><input class="inp" id="spq" value="${esc(sh.q || '')}" placeholder="חיפוש שיר בשם" autocomplete="off" data-input="spq">
    <div id="spl" class="spl">${songPickBody(sh)}</div>`;
  } else if (sh.type === 'taskEdit') {
    const dr = sh.draft; const s = host(sh.sid);
    const qd = TK.quickDates(); const custom = dr.due && !qd.some(([k]) => k === dr.due);
    h = `<h3>עריכת משימה</h3><span class="hint" style="margin-top:-8px">${esc(s ? (s.general ? 'משימה כללית' : s.data.title) : '')}</span>
    <div class="field"><label for="tet">משימה</label><input class="inp" id="tet" value="${esc(dr.text)}" maxlength="200" autocomplete="off"></div>
    <div class="field"><span class="flabel">סוג</span><div class="chips">${TASK_TYPES.map(t => `<button class="chip ${dr.type === t ? 'on' : ''}" data-a="teType" data-k="${t}">${t}</button>`).join('')}</div></div>
    <div class="field"><span class="flabel">מתי</span><div class="chips">${qd.map(([k, l]) => `<button class="chip ${dr.due === k ? 'on' : ''}" data-a="teDue" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="grid2"><label class="dtin ${custom ? 'on' : ''}"><span>תאריך</span><input type="date" id="ted" value="${esc(dr.due)}" data-change="teDate"></label>
      <label class="dtin ${dr.time ? 'on' : ''}"><span>שעה</span><input type="time" id="tetm" value="${esc(dr.time)}" data-change="teTime" ${dr.due ? '' : 'disabled'}></label></div>
      ${dr.time ? '<button class="linkbtn" data-a="teClearTime">בלי שעה</button>' : ''}</div>
    ${dr.due ? (() => { const opts = dr.time ? TK.REMS : TK.REMS_DAY; const on = k => dr.time ? dr.rems.includes(k) : (k === 0 ? dr.rems.some(x => x < 1440) : dr.rems.includes(k)); const sel = opts.filter(([k]) => on(k));
      return `<div class="field"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="flabel">תזכורות · אפשר לבחור כמה</span><span class="hint" style="color:var(--acc-text)">${sel.length ? sel.length + ' נבחרו' : 'בלי תזכורת'}</span></div>
      <div class="chips">${opts.map(([k, l]) => `<button class="chip remc ${on(k) ? 'on' : ''}" data-a="teRem" data-k="${k}"><span class="tick">✓</span>${l}</button>`).join('')}</div>
      <span class="hint">${sel.length ? 'תקפוץ התראה: ' + sel.map(([, l]) => l).join(', ') + '.' : 'לא תקפוץ התראה למשימה הזו.'}</span>
      ${ui.notify !== 'on' ? `<span class="hint">${ui.notify === 'needs-install' ? 'תזכורות מגיעות רק כשהמגירה פתוחה מהאייקון במסך הבית.' : ui.notify === 'denied' ? 'ההתראות חסומות בהגדרות הטלפון.' : 'כדי לקבל תזכורת בטלפון, צריך להפעיל התראות פעם אחת.'}</span>${ui.notify === 'off' ? '<button class="btn sm" data-a="notifyOn" style="align-self:flex-start">הפעלת התראות</button>' : ''}` : ''}</div>`; })() : ''}
    <div class="grid2"><button class="btn danger" data-a="taskDel" data-id="${sh.sid}" data-t="${esc(sh.tid)}">מחיקה</button><button class="btn pri" data-a="teSave">שמירה</button></div>`;
  } else if (sh.type === 'recMenu') {
    const r = S.recs.get(sh.id);
    h = `<h3>${esc(r.meta.name || kindName(r.meta.kind))}</h3>
    <div class="field"><label for="rn2">שם</label><input class="inp" id="rn2" value="${esc(r.meta.name || '')}" data-change="recName"></div>
    <div class="field"><span class="flabel">סוג</span><div class="chips">${KINDS.map(k => `<button class="chip ${r.meta.kind === k.k ? 'on' : ''}" data-a="recKindSet" data-k="${k.k}">${k.name}</button>`).join('')}</div></div>
    <div class="grid2"><button class="btn" data-a="recDownload">הורדה לטלפון</button><button class="btn danger" data-a="recTrash">העברה לסל</button></div>`;
  } else if (sh.type === 'version') {
    const v = ui.versions.list[sh.k];
    h = `<h3>גרסה מ־${dmy(v.created_at)} ${hm(v.created_at)}</h3><div class="vtext">${esc(plain(v.lyrics))}</div>
    <div class="grid2"><button class="btn" data-a="closeSheet">סגירה</button><button class="btn pri" data-a="restoreVersion" data-k="${sh.k}">שחזור הגרסה הזו</button></div>`;
  } else if (sh.type === 'confirm') {
    h = `<h3>${esc(sh.title)}</h3><p class="hint" style="margin:0;font-size:14px">${esc(sh.text)}</p><div class="grid2"><button class="btn" data-a="closeSheet">ביטול</button><button class="btn ${sh.danger ? 'danger' : 'pri'}" data-a="confirmYes">${esc(sh.yes)}</button></div>`;
  } else if (sh.type === 'import') {
    h = `<h3>ייבוא ${sh.items.length} שירים</h3><p class="hint" style="margin:0;font-size:14px">${sh.dupes ? sh.dupes + ' מהם כבר קיימים במגירה בשם זהה, והם יידלגו. ' : ''}כל שיר יוצפן במכשיר ויישמר בכספת עם המגירה, הציון, הפוטנציאל והצעד הבא שלו.</p>
    <div class="grid2"><button class="btn" data-a="closeSheet">ביטול</button><button class="btn pri" data-a="importYes" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'מייבא…' : 'ייבוא'}</button></div>`;
  } else if (sh.type === 'pass') {
    h = `<h3>שינוי סיסמת כספת</h3><form data-form="pass" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="op">הסיסמה הנוכחית</label><input class="inp ltr" id="op" name="op" type="password" required autocomplete="current-password"></div>
      <div class="field"><label for="q1">סיסמה חדשה (לפחות 10 תווים)</label><input class="inp ltr" id="q1" name="q1" type="password" minlength="10" required autocomplete="new-password"></div>
      <div class="field"><label for="q2">שוב, לאימות</label><input class="inp ltr" id="q2" name="q2" type="password" minlength="10" required autocomplete="new-password"></div>
      <button class="btn pri full" type="submit">שינוי</button></form>`;
  } else if (sh.type === 'mfa') {
    h = `<h3>הפעלת אימות דו־שלבי</h3>
    <p class="hint" style="margin:0;font-size:14px">מעכשיו, כדי להיכנס לחשבון יידרש גם קוד מתחלף מאפליקציית אימות. גם מי שישיג את המייל והסיסמה שלך לא יוכל להיכנס בלעדיו.</p>
    <a class="btn pri full" href="${esc(sh.uri)}">הוספה לאפליקציית הסיסמאות</a>
    <div style="display:flex;justify-content:center;background:#fff;border-radius:16px;padding:12px"><img src="${esc(sh.qr)}" alt="קוד לסריקה" width="180" height="180"></div>
    <div class="field"><span class="flabel">או הקלדה ידנית של המפתח</span><div class="rk" style="font-size:15px">${esc(sh.secret)}</div></div>
    <form data-form="mfaEnroll" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label for="otp2">הקוד שמופיע עכשיו באפליקציה</label><input class="inp ltr" id="otp2" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required style="font-family:var(--mono);font-size:22px;letter-spacing:6px;text-align:center"></div>
      <button class="btn dark full" type="submit">אישור והפעלה</button></form>`;
  } else if (sh.type === 'pkSetup') {
    h = `<h3>פתיחה בטביעת פנים</h3>
    <p class="hint" style="margin:0;font-size:14px">אחרי ההפעלה, הכספת תינעל אוטומטית כשתצא מהאפליקציה, ותיפתח רק בטביעת הפנים שלך. המפתח נשמר רק בטלפון הזה, ולא יוצא ממנו.</p>
    <form data-form="pkSetup" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label for="pkp">לאישור, סיסמת הכספת</label><input class="inp ltr" id="pkp" name="pass" type="password" autocomplete="current-password" required></div>
      <button class="btn pri full" type="submit">הפעלה</button></form>`;
  } else if (sh.type === 'autolock') {
    h = `<h3>נעילה אוטומטית</h3><div class="box">${[[0, 'מיד כשיוצאים מהאפליקציה'], [1, 'אחרי דקה'], [5, 'אחרי 5 דקות'], [15, 'אחרי 15 דקות']].map(([m, l]) => `<button class="row" data-a="setAutolock" data-k="${m}"><span class="grow"><span class="t">${l}</span></span>${ui.autolock === m ? I.check : ''}</button>`).join('')}</div>`;
  } else if (sh.type === 'restore') {
    h = sh.payload ? `<h3>שחזור מגיבוי</h3><p class="hint" style="margin:0;font-size:14px">גיבוי מ־${dmy(sh.meta.created)} ${hm(sh.meta.created)}: ${sh.meta.counts.songs} שירים, ${sh.meta.counts.audio} הקלטות. יוחזרו רק שירים והקלטות שחסרים עכשיו במגירה. שום דבר קיים לא יידרס.</p>
      <div class="grid2"><button class="btn" data-a="closeSheet">ביטול</button><button class="btn pri" data-a="restoreYes" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'משחזר…' : 'שחזור'}</button></div>`
    : `<h3>הגיבוי נוצר בכספת אחרת</h3><p class="hint" style="margin:0;font-size:14px">הקלד את סיסמת הכספת שהייתה בזמן הגיבוי, או את מפתח השחזור.</p>
      <form data-form="restoreSecret" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="rs">סיסמה או מפתח שחזור</label><input class="inp ltr" id="rs" name="secret" type="password" required></div><button class="btn pri full" type="submit">פתיחת הגיבוי</button></form>`;
  } else if (sh.type === 'rk') {
    h = `<h3>מפתח שחזור חדש</h3><div class="rk">${esc(sh.rk)}</div><p class="hint" style="margin:0">המפתח הקודם כבר לא עובד. שמור את החדש מחוץ לטלפון.</p><div class="grid2"><button class="btn" data-a="copyRk2">העתקה</button><button class="btn pri" data-a="closeSheet">שמרתי</button></div>`;
  }
  return `<div class="overlay ${sh.type === 'chord' ? 'clear' : ''} ${ui.sheetFresh ? 'enter' : ''}" data-a="overlay"><div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>${h}</div></div>`;
}

// ---------- פעולות ----------
const openSheet = sh => { ui.sheet = sh; render(); };
const closeSheet = () => {
  const o = root.querySelector('.overlay');
  if (!o || reduceMotion()) { ui.sheet = null; return render(); }
  o.classList.add('closing'); setTimeout(() => { ui.sheet = null; render(); }, 210);
};
const confirmSheet = (title, text, yes, fn, danger = true) => openSheet({ type: 'confirm', title, text, yes, fn, danger });

async function patchSong(id, patch, logEntry) {
  const s = song(id);
  await store.saveSong(id, Object.assign({}, s.data, patch), { logEntry });
}
const GEN = '__general';
function generalHost() { return { id: GEN, general: true, data: { title: 'כללי', stage: null, tasks: (store.meta().tasks || []) } }; }
const host = id => id === GEN ? generalHost() : song(id);
const allHosts = () => { const g = generalHost(); return all().concat(g.data.tasks.some(t => !t.done) ? [g] : []); };
async function saveTasks(s, tasks, logEntry) {
  if (s.id === GEN) { tasks = tasks.filter(t => !t.done); await store.saveMeta({ tasks }); remSoon(); return; }
  tasks = tasks.filter(t => !t.done).map(t => t.id === 'n0' ? Object.assign({}, t, { id: store.uid() }) : t);
  const first = TK.sortTasks(tasks)[0];
  await patchSong(s.id, { tasks, next: first ? first.text : '' }, logEntry);
  remSoon();
}
let remT = null;
function remSoon() { clearTimeout(remT); remT = setTimeout(() => store.syncReminders(), 1500); }
let badgeN = -1;
function updateBadge() {
  if (ui.screen !== 'main') return;
  let n = 0; allHosts().forEach(s => store.openTasks(s).forEach(t => { const g = TK.dueGroup(t); if (g === 'late' || g === 'today') n++; }));
  if (n !== badgeN) { badgeN = n; NT.badge(n); }
}
// סימון "בוצע": סימן קופץ, קו על הטקסט, המשימה נסגרת ונעלמת, ורק אז נשמרת
async function completeTask(sid, tid, how) {
  const el = root.querySelector('.tk[data-tk="' + sid + '|' + tid.replace(/"/g, '\\"') + '"]');
  const s = host(sid); if (!s) return;
  const prev = store.tasksOf(s).map(t => Object.assign({}, t)); const t = prev.find(x => x.id === tid); if (!t) return;
  if (el) {
    // התנועה נעשית ישירות על האלמנט, כך שהיא רצה עד הסוף גם כשהטלפון מוגדר להפחתת תנועה
    el.classList.add('doing'); el.style.pointerEvents = 'none';
    const f = el.querySelector('.tk-face');
    const fast = reduceMotion();
    try {
      if (how === 'swipe') {
        const from = getComputedStyle(f).transform; f.style.transition = 'none';
        await f.animate([{ transform: from === 'none' ? 'translateX(0)' : from }, { transform: 'translateX(105%)', opacity: 0.4 }], { duration: fast ? 120 : 260, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished;
      } else {
        await new Promise(r => setTimeout(r, fast ? 150 : 420));
      }
      const h = el.offsetHeight;
      el.style.overflow = 'hidden';
      await el.animate([{ height: h + 'px', opacity: 1, marginBottom: '0px' }, { height: '0px', opacity: 0, marginBottom: '-8px' }], { duration: fast ? 120 : 280, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).finished;
    } catch (e) {}
  }
  await saveTasks(s, prev.filter(x => x.id !== tid), 'בוצע: ' + t.text);
  ui.tkOpen = null; render();
  toast(sid === GEN ? 'בוצע' : 'בוצע ונרשם בהיסטוריה', async () => { const s2 = host(sid); const cur = store.tasksOf(s2).filter(x => !x.done); const back = Object.assign({}, t, { done: false }); await saveTasks(s2, cur.concat([back]), 'הוחזר: ' + t.text); render(); });
}

async function leaveSong() {
  const s = song(ui.songId);
  if (s && s.data.lyrics !== ui.openLyrics) {
    try { await store.addVersion(s.id, s.data.lyrics, s.data.title); } catch (e) { console.warn(e); }
    ui.openLyrics = s.data.lyrics;
  }
  ui.editText = false; ui.chordMode = false; ui.versions = null; stageStop();
}

function openSong(id) {
  if (!isWide()) { ui.nav = 'home'; ui.view = 'song'; } ui.songId = id; ui.tab = 'text'; ui.editText = false; ui.chordMode = false; ui.versions = null;
  ui.openLyrics = song(id).data.lyrics; ui.swipeOpen = null;
  if (isWide()) { const st = song(id).data.stage; if (ui.view !== 'drawers' && ui.drawer !== st && !byStage(ui.drawer).some(s => s.id === id)) ui.drawer = st; }
  render();
  const m = $('.col.main2'); if (m) m.scrollTop = 0;
}

// מצב במה: גלילה אוטומטית ומסך שלא נכבה
let stageTimer = null, wakeLock = null;
function stageTick() {
  clearInterval(stageTimer);
  if (ui.stage && ui.stageRun) stageTimer = setInterval(() => { const el = document.getElementById('stageScroll'); if (el) el.scrollTop += 1; }, Math.round(120 / ui.stageSpeed));
}
function stageStop() { ui.stage = false; ui.stageRun = false; clearInterval(stageTimer); if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
function stageKeepScroll(fn) { const el = document.getElementById('stageScroll'); const y = el ? el.scrollTop : 0; fn(); render(); const n = document.getElementById('stageScroll'); if (n) n.scrollTop = y; stageTick(); }

// הבאה בתור לבוחר האקורדים: המילה הבאה או הקודמת בשיר
function wordStep(lyrics, l, w, dir) {
  const bl = CH.blocks(lyrics).filter(b => b.type === 'line' && b.words.length);
  let i = bl.findIndex(b => b.i === l); if (i < 0) return null;
  let k = w + dir;
  while (i >= 0 && i < bl.length) {
    if (k >= 0 && k < bl[i].words.length) return { l: bl[i].i, w: k, word: bl[i].words[k].word, cur: bl[i].words[k].chord };
    i += dir; if (i < 0 || i >= bl.length) return null; k = dir > 0 ? 0 : bl[i].words.length - 1;
  }
  return null;
}
function chordSheetFor(pos, bassOpen) {
  const m = (pos.cur || '').match(/^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/);
  return { type: 'chord', l: pos.l, w: pos.w, word: pos.word, cur: pos.cur || '', root: m ? m[1] : '', q: m ? (QUALS.includes(m[2]) ? m[2] : '') : '', bass: m && m[3] || '', bassOpen: !!bassOpen };
}
async function putChord(c) {
  const sh = ui.sheet; const s = song(ui.songId);
  const lyrics = CH.setChord(s.data.lyrics, sh.l, sh.w, c);
  await patchSong(s.id, { lyrics });
  const nx = wordStep(lyrics, sh.l, sh.w, 1);
  ui.sheet = nx ? chordSheetFor(nx, sh.bassOpen) : null;
  if (!nx) toast('הגעת לסוף השיר');
  render();
}

function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function playRec(id) {
  try {
    if (AU.now.recId === id) { AU.player.paused ? await AU.player.play() : AU.player.pause(); return render(); }
    const r = S.recs.get(id), s = song(r.song_id);
    AU.now.recId = id; AU.now.title = r.meta.name || kindName(r.meta.kind); AU.now.song = s ? s.data.title : ''; AU.now.songId = r.song_id;
    toast('טוען ומפענח…');
    AU.player.src = await store.recordingUrl(id);
    await AU.player.play();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: AU.now.title, artist: AU.now.song, album: 'המגירה' });
  } catch (e) { fail(e); }
  render();
}

async function startRec(target) {
  if (!AU.canRecord()) return toast('הדפדפן הזה לא תומך בהקלטה');
  try {
    if (!AU.player.paused) AU.player.pause();
    await AU.startRecording();
    ui.recTarget = target || null;
    clearInterval(ui.recTimer);
    ui.recTimer = setInterval(() => { const el = document.getElementById('rect'); if (el) el.textContent = dur(AU.recordingElapsed()); }, 500);
    render();
  } catch (e) { toast('אין גישה למיקרופון. צריך לאשר גישה בהגדרות.'); }
}
let pendingRec = null;
async function stopRec() {
  clearInterval(ui.recTimer);
  const r = await AU.stopRecording();
  if (!r) return render();
  pendingRec = r;
  openSheet({ type: 'recKind', name: 'סקיצה ' + dmy(new Date().toISOString()) });
}
async function saveRecording(blob, mime, kind, name, songId, durationHint, pre, onProgress) {
  if (!onProgress) toast('מצפין ומעלה…');
  const a = pre ? { bytes: new Uint8Array(await blob.arrayBuffer()), duration: pre.duration, peaks: pre.peaks } : await AU.analyze(blob);
  let sid = songId;
  if (!sid || !song(sid)) sid = await store.createSong({ title: 'ניצוץ ' + dmy(new Date().toISOString()) + ' ' + hm(new Date().toISOString()), stage: 'spark' });
  await store.addRecording(sid, a.bytes, { kind, name, mime: mime || blob.type || 'audio/mp4', duration: a.duration || durationHint || null, peaks: a.peaks }, onProgress);
  await patchSong(sid, {}, 'נוספה הקלטה: ' + (name || kindName(kind)));
  if (!onProgress) toast('ההקלטה נשמרה בכספת');
  return sid;
}

// העלאת קובץ כבד: כיווץ במכשיר או מקור בחתיכות
const MAX_UPLOAD = 400 * 1048576;
const upCard = sh => `<div class="upcard"><span class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10"/></svg></span><span class="grow"><b>${esc(sh.name)}</b><span class="hint">${[fmtDur(sh.dur), mb(sh.size) + ' מ״ב'].filter(Boolean).join(' · ')}</span></span></div>`;
const fmtDur = sec => sec ? Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0') + ' דקות' : '';
function upSet(i, frac, label) {
  const b = document.getElementById('upb' + i), r = document.getElementById('upr' + i), t = document.getElementById('upt' + i);
  if (b) b.style.width = Math.round(frac * 100) + '%';
  if (r) r.textContent = Math.round(frac * 100) + '%';
  if (t && label) t.textContent = label;
  document.querySelectorAll('.upstep').forEach((el, j) => el.classList.toggle('on', j === i));
}
async function runUpload(f, sh) {
  const small = sh.pick === 'small';
  ui.sheet = { type: 'uploadWork', small, name: sh.name, size: sh.size, dur: sh.dur, parts: Math.ceil(sh.size / (45 * 1048576)) };
  render();
  // המסך לא נכבה באמצע: כשהטלפון ננעל, הדפדפן עוצר את ההעלאה
  let wl = null; try { if (navigator.wakeLock) wl = await navigator.wakeLock.request('screen'); } catch (e) {}
  try { return await runUpload2(f, sh, small); } finally { try { wl && wl.release(); } catch (e) {} }
}
// כיווץ: קודם המקודד המהיר של הדפדפן. אם אין או שנכשל, מנוע ההקלטה של הטלפון בזמן אמת.
// כל כישלון נרשם, כדי שבמערכת יהיה אפשר לראות למה.
function cmpLog(msg) { try { const l = JSON.parse(localStorage.getItem('megira-cmp-log') || '[]'); l.unshift(new Date().toLocaleString('he-IL') + ' · ' + msg); localStorage.setItem('megira-cmp-log', JSON.stringify(l.slice(0, 6))); } catch (e) {} }
async function compressAny(f, onStep, ctx) {
  if (await AU.canCompress()) {
    try { const c = await AU.compress(f, x => onStep(x, null)); return Object.assign(c, { mime: 'audio/aac', how: 'fast' }); }
    catch (e) { cmpLog('מהיר נכשל: ' + (e && e.message || e)); }
  } else cmpLog('מהיר לא נתמך במכשיר');
  if (!AU.canRealtime()) { cmpLog('זמן אמת לא נתמך במכשיר'); throw new Error('no-compress'); }
  try { const c = await AU.compressRealtime(f, (x, left) => onStep(x, left), ctx); return Object.assign(c, { how: 'realtime' }); }
  catch (e) { cmpLog('זמן אמת נכשל: ' + (e && e.message || e)); throw e; }
}
const leftTxt = sec => sec == null ? null : 'מכווץ בזמן אמת · נשארו ' + dur(Math.max(0, sec));
async function runUpload2(f, sh, small) {
  let blob = f, mime = f.type, pre = null;
  if (small) {
    try {
      const c = await compressAny(f, (x, left) => upSet(0, x, leftTxt(left)), sh.ctx);
      blob = c.blob; mime = c.mime; pre = { duration: c.duration, peaks: c.peaks };
      upSet(0, 1);
    } catch (e) {
      console.error(e);
      if (f.size > MAX_UPLOAD) { closeSheet(); toast('הכיווץ לא הצליח, והמקור גדול מ־400 מ״ב'); return; }
      toast('הכיווץ לא הצליח. מעלה את המקור, באיכות מלאה');
      ui.sheet = Object.assign({}, ui.sheet, { small: false, parts: Math.ceil(f.size / (45 * 1048576)) }); render();
    }
  }
  const si = ui.sheet.small ? 1 : 0;
  const sid = await saveRecording(blob, mime, sh.k, sh.name, ui.songId, sh.dur, pre, (x, i, n) => upSet(si, x, n > 1 ? 'מצפין ומעלה · חתיכה ' + Math.min(n, i + 1) + ' מתוך ' + n : null));
  ui.sheet = { type: 'uploadDone', txt: mb(blob.size) + ' מ״ב · מוצפן' + (ui.sheet.small ? '' : ' · באיכות מלאה') };
  render();
  setTimeout(() => { if (ui.sheet && ui.sheet.type === 'uploadDone') closeSheet(); }, 1400);
  return sid;
}

let pendingUpload = null;

// ---- תור העלאות ברקע ----
// כל קובץ נכנס לתור, והחלון נסגר מיד. התור עובד אחד אחרי השני, ופס קטן מעל הנגן מראה איפה הוא עומד.
// הכיווץ וההצפנה קורים כאן בטלפון. אסור לצאת מהאפליקציה עד שהתור נגמר, כי הטלפון עוצר אותה ברקע.
const Q = { jobs: [], running: false, ctx: null, wl: null };
let qid = 0;
function enqueue(items) {
  if (!Q.ctx && items.some(j => j.small)) { Q.ctx = AU.makeCtx(); try { Q.ctx && Q.ctx.resume(); } catch (e) {} }
  for (const j of items) Q.jobs.push(Object.assign({ id: ++qid, st: 'wait', p: 0, lbl: 'ממתין' }, j));
  render(); runQueue();
}
const qActive = () => Q.jobs.filter(j => j.st !== 'done');
function qPaint() {
  const c = document.getElementById('qchip'); if (c) { const v = qChipVals(); c.querySelector('.qt').textContent = v.t; c.querySelector('.qb span').style.width = v.p + '%'; c.classList.toggle('err', v.err); }
  Q.jobs.forEach(j => { const r = document.getElementById('qj' + j.id); if (!r) return; r.querySelector('.ql').textContent = j.lbl; const b = r.querySelector('.meter span'); if (b) b.style.width = Math.round(j.p * 100) + '%'; });
}
function qChipVals() {
  const act = Q.jobs.filter(j => j.st === 'cmp' || j.st === 'up' || j.st === 'wait'); const err = Q.jobs.filter(j => j.st === 'err').length;
  const total = Q.jobs.length, done = Q.jobs.filter(j => j.st === 'done').length;
  const cur = Q.jobs.find(j => j.st === 'cmp' || j.st === 'up');
  if (!act.length) return { t: err ? (err === 1 ? 'העלאה אחת נכשלה · נגיעה לניסיון חוזר' : err + ' העלאות נכשלו · נגיעה לניסיון חוזר') : (total === 1 ? 'ההקלטה נשמרה במגירה' : total + ' הקלטות נשמרו במגירה'), p: 100, err: !!err };
  const p = Math.round(((done + (cur ? cur.p : 0)) / total) * 100);
  return { t: (total > 1 ? 'מעלה ' + Math.min(total, done + 1) + ' מתוך ' + total + ' · ' : '') + (cur ? esc(cur.name) + ' · ' + (cur.st === 'cmp' ? 'מכווץ' : 'מעלה') : 'מתחיל'), p, err: false };
}
function vQueue() {
  if (!Q.jobs.length) return '';
  const v = qChipVals();
  return `<button class="qchip ${v.err ? 'err' : ''}" id="qchip" data-a="queueOpen"><span class="qi">${v.err ? '!' : I.up || '↑'}</span><span class="qt">${v.t}</span><span class="qb"><span style="width:${v.p}%"></span></span></button>`;
}
async function runQueue() {
  if (Q.running) return; Q.running = true;
  try { if (navigator.wakeLock) Q.wl = await navigator.wakeLock.request('screen'); } catch (e) {}
  try {
    for (;;) {
      const j = Q.jobs.find(x => x.st === 'wait'); if (!j) break;
      try {
        let blob = j.f, mime = j.f.type, pre = null;
        if (j.small && AU.isLossless(j.f)) {
          j.st = 'cmp'; j.lbl = 'מכווץ בטלפון'; qPaint();
          try {
            const c = await compressAny(j.f, (x, left) => { j.p = x * 0.5; j.lbl = leftTxt(left) || 'מכווץ בטלפון'; qPaint(); }, Q.ctx);
            blob = c.blob; mime = c.mime; pre = { duration: c.duration, peaks: c.peaks };
          } catch (e) { if (j.f.size > MAX_UPLOAD) throw new Error('הכיווץ נכשל והקובץ גדול מ־400 מ״ב'); j.lbl = 'הכיווץ לא הצליח, מעלה מקור'; qPaint(); }
        }
        if (blob.size > MAX_UPLOAD) throw new Error('הקובץ גדול מ־400 מ״ב');
        j.st = 'up'; const base = pre ? 0.5 : 0; j.lbl = 'מצפין ומעלה'; qPaint();
        await saveRecording(blob, mime, j.k, j.name, j.songId, null, pre, (x, i, n) => { j.p = base + x * (1 - base); j.lbl = n > 1 ? 'מעלה · חתיכה ' + Math.min(n, i + 1) + ' מתוך ' + n : 'מצפין ומעלה'; qPaint(); });
        j.st = 'done'; j.p = 1; j.lbl = 'נשמר · ' + mb(blob.size) + ' מ״ב'; j.f = j.small ? null : j.f;
      } catch (e) { console.error(e); j.st = 'err'; const m = (e && e.message) || ''; j.lbl = /[\u0590-\u05FF]/.test(m) ? m : 'ההעלאה נכשלה, כנראה בגלל הרשת. אפשר לנסות שוב'; }
      render();
    }
  } finally {
    Q.running = false;
    try { Q.wl && Q.wl.release(); } catch (e) {} Q.wl = null;
    if (Q.ctx) { try { Q.ctx.close(); } catch (e) {} Q.ctx = null; }
    render();
    if (!Q.jobs.some(j => j.st === 'err')) setTimeout(() => { if (!Q.running && !Q.jobs.some(j => j.st !== 'done')) { Q.jobs = []; if (ui.sheet && ui.sheet.type === 'queue') ui.sheet = null; render(); } }, 3500);
  }
}
window.addEventListener('beforeunload', e => { if (Q.running) { e.preventDefault(); e.returnValue = ''; } });

let saveTimer = null;
function markSaving() { const el = document.getElementById('saved'); if (el) { el.textContent = 'שומר…'; el.classList.add('wait'); } }
function markSaved() { const el = document.getElementById('saved'); if (el) { el.textContent = 'נשמר'; el.classList.remove('wait'); } }

const A = {
  authMode() { ui.authMode = ui.authMode === 'in' ? 'up' : 'in'; ui.err = ''; render(); },
  toAuth() { ui.screen = 'auth'; ui.authMode = 'in'; render(); },
  toRecover() { ui.screen = 'recover'; ui.err = ''; render(); },
  toUnlock() { ui.screen = 'unlock'; ui.err = ''; render(); },
  copyRk() { navigator.clipboard && navigator.clipboard.writeText(ui.recoveryKey).then(() => toast('הועתק')); },
  copyRk2() { navigator.clipboard && navigator.clipboard.writeText(ui.sheet.rk).then(() => toast('הועתק')); },
  async rkDone() { if (!$('#rkok').checked) return toast('סמן שהמפתח שמור'); ui.recoveryKey = ''; await store.rememberHere(); await enterMain(); },
  async signOut() {
    const go = async () => { stageStop(); AU.player.pause(); AU.now.recId = null; ui.sheet = null; await store.signOutAll(); ui.screen = 'auth'; ui.authMode = 'in'; render(); };
    if (ui.screen !== 'main') return go();
    confirmSheet('להתנתק מהמכשיר?', 'העותק המקומי יימחק מהטלפון. כל השירים וההקלטות נשארים מוצפנים בענן.', 'התנתקות', go);
  },
  async lockNow() { stageStop(); AU.player.pause(); AU.now.recId = null; ui.sheet = null; await store.lock(); ui.screen = 'unlock'; ui.keysRow = await store.vaultState().catch(() => ui.keysRow); render(); },

  themeToggle() { TH.set(TH.isNight() ? 'day' : 'night'); render(); },
  setTheme(d) { TH.set(d.k); render(); },
  setMotion(d) { TH.setMotion(d.k); render(); toast(d.k === 'full' ? 'כל האנימציות פועלות' : 'לפי ההגדרה של הטלפון'); },

  nav(d) { if (ui.view === 'song' || isWide()) leaveSong(); ui.nav = d.k; if (d.k === 'home') ui.view = 'dash'; if (d.k === 'sys') ui.sysView = 'main'; ui.sheet = null; ui.arrange = false; render(); if (d.k === 'search') setTimeout(() => { const q = $('#q'); q && q.focus(); }, 50); },
  home() { ui.view = 'dash'; ui.palFor = null; ui.warnFor = null; ui.arrange = false; render(); },
  drawer(d) { ui.nav = 'home'; ui.view = 'drawer'; ui.drawer = d.k; ui.swipeOpen = null; ui.arrange = false; ui.moved = null; render(); },
  sort(d) { if (ui.sort === d.k && d.k !== 'man') ui.sortDir = -ui.sortDir; else { ui.sort = d.k; ui.sortDir = 1; } ui.arrange = false; render(); },
  arrange() { ui.arrange = !ui.arrange; ui.moved = null; ui.swipeOpen = null; render(); },
  async moveSong(d) {
    const ids = sortSongs(byStage(ui.drawer), ui.drawer).map(s => s.id);
    const i = ids.indexOf(d.id), j = i + (+d.k); if (i < 0 || j < 0 || j >= ids.length) return;
    ids[i] = ids[j]; ids[j] = d.id; ui.moved = d.id;
    await store.saveOrder(ui.drawer, ids); render();
  },
  open(d) { if (ui.view === 'song' || isWide()) leaveSong(); openSong(d.id); },
  openState(d) { if (ui.view === 'song' || isWide()) leaveSong(); openSong(d.id); ui.tab = 'state'; render(); },
  async songBack() { const st = song(ui.songId).data.stage; await leaveSong(); ui.view = 'drawer'; ui.drawer = st; render(); },
  tab(d) { ui.tab = d.k; ui.editText = false; ui.chordMode = false; render(); },
  newSong(d) { openSheet({ type: 'newSong', stage: d.stage || ((ui.view === 'drawer' || isWide()) && ui.nav === 'home' ? ui.drawer : 'spark') }); },
  goImport() { ui.nav = 'sys'; ui.sysView = 'main'; render(); toast('בחר "ייבוא שירים מקובץ"'); },

  // מגירות
  drawersEdit(d) { ui.nav = 'home'; ui.view = 'drawers'; ui.palFor = null; ui.warnFor = null; render(); if (d && d.add) A.addDrawer(); },
  palFor(d) { ui.palFor = ui.palFor === d.k ? null : d.k; ui.warnFor = null; render(); },
  async setGlaze(d) { const ds = store.drawers().map(x => x.k === d.k ? Object.assign({}, x, { glaze: d.g }) : x); ui.palFor = null; await store.saveDrawers(ds); render(); },
  async moveDrawer(d) {
    const ds = store.drawers().slice(); const i = ds.findIndex(x => x.k === d.k), j = i + (+d.d);
    if (i < 0 || j < 0 || j >= ds.length - 1 || ds[i].k === 'bottom') return;
    const t = ds[i]; ds[i] = ds[j]; ds[j] = t; await store.saveDrawers(ds); render();
  },
  async delDrawer(d) {
    if (d.k === 'bottom') return;
    const n = all().concat(store.trashedSongs()).filter(s => s.data.stage === d.k).length;
    if (n) { ui.warnFor = ui.warnFor === d.k ? null : d.k; ui.palFor = null; return render(); }
    const st = stageOf(d.k);
    confirmSheet('למחוק את המגירה "' + st.name + '"?', 'המגירה ריקה, אז שום שיר לא נפגע.', 'מחיקה', async () => { ui.sheet = null; await store.saveDrawers(store.drawers().filter(x => x.k !== d.k)); if (ui.drawer === d.k) ui.drawer = store.drawers()[0].k; render(); });
  },
  async addDrawer() {
    const ds = store.drawers().slice(); const used = new Set(ds.map(x => x.glaze));
    const g = (GLAZES.find(x => !used.has(x.k)) || GLAZES[7]).k;
    ds.splice(ds.length - 1, 0, { k: 'd' + store.uid().replace(/-/g, '').slice(0, 10), name: 'מגירה חדשה', glaze: g });
    await store.saveDrawers(ds); render();
    setTimeout(() => { const ins = root.querySelectorAll('.drow input'); const el = ins[ins.length - 2]; if (el) { el.focus(); el.select(); } }, 30);
  },

  editText() { ui.editText = !ui.editText; ui.chordMode = false; render(); if (ui.editText) setTimeout(() => { const t = $('#lyr'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30); },
  chordMode() { ui.chordMode = !ui.chordMode; render(); },
  toggleChords() { ui.showChords = !ui.showChords; render(); },
  async transpose(d) { const s = song(ui.songId); if (!CH.songChords(s.data.lyrics).length) return toast('אין אקורדים בשיר'); await patchSong(s.id, { lyrics: CH.transpose(s.data.lyrics, +d.k) }, 'טרנספוזיציה ' + (d.k > 0 ? 'חצי טון למעלה' : 'חצי טון למטה')); render(); },
  insSection() { const t = $('#lyr'); if (!t) return; const pos = t.selectionStart; const ins = (pos && t.value[pos - 1] !== '\n' ? '\n' : '') + '\nפזמון:\n'; t.setRangeText(ins, pos, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); },
  pickChord(d) {
    const s = song(ui.songId); const line = s.data.lyrics.split('\n')[+d.l] || ''; const w = CH.words(line)[+d.w] || {};
    openSheet(chordSheetFor({ l: +d.l, w: +d.w, word: w.word, cur: w.chord || '' }, ui.sheet && ui.sheet.bassOpen));
  },
  chordNav(d) { const sh = ui.sheet; const nx = wordStep(song(ui.songId).data.lyrics, sh.l, sh.w, +d.k); if (!nx) return toast(+d.k > 0 ? 'זו המילה האחרונה' : 'זו המילה הראשונה'); ui.sheet = chordSheetFor(nx, sh.bassOpen); render(); },
  chRoot(d) { ui.sheet.root = d.k; render(); },
  chQ(d) { if (!ui.sheet.root) return toast('קודם בוחרים תו'); ui.sheet.q = d.k; render(); },
  chBass(d) { ui.sheet.bass = ui.sheet.bass === d.k ? '' : d.k; render(); },
  bassToggle() { ui.sheet.bassOpen = !ui.sheet.bassOpen; render(); },
  async chordQuick(d) { await putChord(d.k); },
  async chordSet(d) { await putChord(d.k); },
  async chordOk() {
    const free = ($('#chf') || {}).value || ''; const sh = ui.sheet;
    const c = free.trim() && free.trim() !== (sh.cur || '') ? free.trim().replace(/[\[\]\s]/g, '') : chordValue(sh) || sh.cur;
    await putChord(c);
  },

  stageOpen() {
    ui.stage = true; ui.stageRun = false; render();
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(w => { wakeLock = w; }).catch(() => {});
  },
  stageClose() { stageStop(); render(); },
  stageRun() { stageKeepScroll(() => { ui.stageRun = !ui.stageRun; }); },
  stageSpeed(d) { stageKeepScroll(() => { ui.stageSpeed = Math.max(1, Math.min(9, ui.stageSpeed + (+d.k))); }); },
  stageSize(d) { stageKeepScroll(() => { ui.stageSize = Math.max(20, Math.min(40, ui.stageSize + (+d.k))); }); },
  stageJump(d) { const el = document.getElementById('stageScroll'); if (!el) return; const s = el.querySelectorAll('.sec')[+d.k]; if (s) el.scrollTop = s.offsetTop - 10; },

  async setStage(d) { const s = song(ui.songId); if (s.data.stage === d.k) return; await patchSong(s.id, { stage: d.k }, 'עבר ממגירת ' + stageOf(s.data.stage).name + ' ל' + stageOf(d.k).name); render(); },
  async setPot(d) { const s = song(ui.songId); await patchSong(s.id, { potential: d.k }, 'פוטנציאל: ' + d.k); render(); },
  async pin(d) { const s = song(d.id); await patchSong(s.id, { pinned: !s.data.pinned }); ui.swipeOpen = null; render(); },
  moveSheet(d) { ui.swipeOpen = null; openSheet({ type: 'move', id: d.id }); },
  async moveTo(d) { const s = song(d.id); ui.sheet = null; if (s.data.stage !== d.k) await patchSong(s.id, { stage: d.k }, 'עבר ממגירת ' + stageOf(s.data.stage).name + ' ל' + stageOf(d.k).name); render(); toast('הועבר ל' + stageOf(d.k).name); },
  async trash(d) {
    const s = song(d.id);
    confirmSheet('להעביר לסל?', '"' + s.data.title + '" יעבור לסל המחזור עם כל ההקלטות שלו, ויימחק לצמיתות אחרי ' + CONFIG.trashDays + ' יום. עד אז אפשר לשחזר.', 'העברה לסל', async () => {
      ui.sheet = null; ui.swipeOpen = null; if (ui.songId === d.id) { stageStop(); if (ui.view === 'song') { ui.view = 'drawer'; ui.drawer = s.data.stage; } ui.songId = null; }
      await store.trashSong(d.id); render(); toast('הועבר לסל', async () => { await store.restoreSong(d.id); render(); });
    });
  },
  // משימות
  taskType(d) { ui.taskType = d.k; render(); setTimeout(() => { const i = $('#nt'); i && i.focus(); }, 20); },
  async orphCheck() { try { toast('בודק…'); ui.orphans = await store.findOrphans(); } catch (e) { fail(e); } render(); },
  async orphClean() { const l = ui.orphans || []; try { await store.removeOrphans(l); toast('פונו ' + mb(l.reduce((a, f) => a + f.size, 0)) + ' מ״ב'); ui.orphans = await store.findOrphans(); } catch (e) { fail(e); } render(); },
  recompressAsk(d) { const r = S.recs.get(d.id); if (!r) return; openSheet({ type: 'recompress', id: d.id }); },
  async recompressGo() {
    const id = ui.sheet.id; const r = S.recs.get(id); if (!r) return;
    const ctx = AU.makeCtx(); try { ctx && ctx.resume(); } catch (e) {}
    if (AU.now.recId === id) { AU.player.pause(); AU.now.recId = null; }
    const sg = song(r.song_id);
    ui.sheet = { type: 'uploadWork', small: true, name: r.meta.name || kindName(r.meta.kind), size: r.meta.size, dur: r.meta.duration, parts: 1 };
    render();
    let wl = null; try { if (navigator.wakeLock) wl = await navigator.wakeLock.request('screen'); } catch (e) {}
    try {
      upSet(0, 0, 'מוריד ומפענח את ההקלטה…');
      const bytes = await store.recordingBytes(id);
      const blob = new Blob([bytes], { type: r.meta.mime || 'audio/wav' });
      const c = await compressAny(blob, (x, left) => upSet(0, x, leftTxt(left) || 'מכווץ בטלפון'), ctx);
      if (c.blob.size > bytes.length * 0.8) { closeSheet(); toast('הכיווץ לא חוסך מקום בהקלטה הזו, המקור נשאר'); return; }
      const nb = new Uint8Array(await c.blob.arrayBuffer());
      await store.replaceRecording(id, nb, { mime: c.mime, duration: c.duration, peaks: c.peaks }, x => upSet(1, x));
      ui.sheet = { type: 'uploadDone', txt: 'פונו ' + mb(bytes.length - nb.length) + ' מ״ב · ' + mb(nb.length) + ' מ״ב במקום ' + mb(bytes.length) };
      render(); setTimeout(() => { if (ui.sheet && ui.sheet.type === 'uploadDone') closeSheet(); }, 1800);
      if (sg) patchSong(sg.id, {}, 'הקלטה כווצה: ' + (r.meta.name || kindName(r.meta.kind)));
    } catch (e) { console.error(e); ui.sheet = null; render(); toast('הכיווץ לא הצליח, המקור נשאר כמו שהוא'); }
    finally { try { wl && wl.release(); } catch (e) {} }
  },
  dview(d) { setDview(d.k, d.v); render(); },
  async cardPlay(d) { const r = store.recsOf(d.id)[0]; if (!r) return; if (AU.now.recId === r.id && !AU.player.paused) { AU.player.pause(); return render(); } await playRec(r.id); },
  taskDone(d) { return completeTask(d.id, d.t, 'tap'); },
  songPick() { const i = $('#qt'); if (i) ui.qtDraft = i.value; openSheet({ type: 'songPick', q: '', dr: null }); },
  spDrawer(d) { ui.sheet.dr = d.k; render(); },
  spBack() { ui.sheet.dr = null; render(); },
  async spPick(d) {
    const then = ui.sheet && ui.sheet.then; ui.qtSong = d.id; closeSheet();
    if (then === 'add') { setTimeout(() => { const f = root.querySelector('[data-form=quickTask]'); if (f) f.requestSubmit(); }, 260); }
    else setTimeout(() => { const i = $('#qt'); i && i.focus(); }, 260);
  },
  async taskDel(d) {
    const s = host(d.id); const prev = store.tasksOf(s); const t = prev.find(x => x.id === d.t);
    ui.sheet = null;
    await saveTasks(s, prev.filter(x => x.id !== d.t), t ? 'נמחקה משימה: ' + t.text : null); render();
    toast('המשימה נמחקה', async () => { await saveTasks(host(d.id), prev); render(); });
  },
  async taskPost(d) {
    const s = host(d.id); const n = +d.k; const base = new Date(); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() + n);
    const tasks = store.tasksOf(s).map(t => t.id === d.t ? Object.assign({}, t, { due: TK.ymd(base) }) : t);
    ui.tkOpen = null;
    await saveTasks(s, tasks); render();
    toast(n === 1 ? 'נדחה למחר' : 'נדחה לשבוע הבא');
  },
  taskEdit(d) {
    if (ui.tkOpen) { closeTk(); return; }
    const s = host(d.id); const t = store.tasksOf(s).find(x => x.id === d.t); if (!t) return;
    openSheet({ type: 'taskEdit', sid: d.id, tid: d.t, draft: { text: t.text, type: t.type || 'אחר', due: t.due || '', time: t.time || '', rems: TK.remsOf(t).slice() } });
  },
  teType(d) { ui.sheet.draft.type = d.k; teKeep(); render(); },
  teDue(d) { ui.sheet.draft.due = d.k; if (!d.k) ui.sheet.draft.time = ''; teKeep(); render(); },
  teRem(d) { const k = +d.k, r = ui.sheet.draft.rems; const i = r.indexOf(k); if (i >= 0) r.splice(i, 1); else r.push(k); r.sort((a, b) => a - b); teKeep(); render(); },
  teClearTime() { ui.sheet.draft.time = ''; teKeep(); render(); },
  async teSave() {
    teKeep(); const sh = ui.sheet, dr = sh.draft; const s = host(sh.sid);
    if (!dr.text.trim()) return toast('חסר טקסט למשימה');
    const tasks = store.tasksOf(s).map(t => t.id === sh.tid ? Object.assign({}, t, { text: dr.text.trim(), type: dr.type, due: dr.due || null, time: dr.due && dr.time ? dr.time : null, rems: dr.time ? dr.rems : dr.rems.map(x => x < 1440 ? 0 : x).filter((x, i, a) => a.indexOf(x) === i), rem: undefined }) : t);
    closeSheet(); await saveTasks(s, tasks); render();
  },
  async taskGo(d) {
    if (ui.view === 'song' || isWide()) await leaveSong();
    openSong(d.id);
    if (d.k === 'כתיבה') { ui.tab = 'text'; ui.editText = true; render(); setTimeout(() => { const t = $('#lyr'); t && t.focus(); }, 60); }
    else { ui.tab = 'sound'; render(); if (d.k === 'הקלטה') setTimeout(() => A.recHere(), 120); }
  },
  async notifyOn() {
    try { await NT.enable(); ui.notify = 'on'; toast('ההתראות הופעלו'); await store.ensureNotifyKey(); store.syncReminders(); }
    catch (e) { fail(e); ui.notify = await NT.status(); }
    render();
  },
  async notifyOff() { await NT.disable().catch(fail); ui.notify = await NT.status(); render(); toast('ההתראות כבויות במכשיר הזה'); },
  tasksView(d) { ui.tasksView = d.k; render(); },
  filter(d) { ui.filters[d.k] = !ui.filters[d.k]; render(); },

  async loadVersions() { try { toast('טוען גרסאות…'); ui.versions = { id: ui.songId, list: await store.versions(ui.songId) }; render(); } catch (e) { fail(e); } },
  viewVersion(d) { openSheet({ type: 'version', k: +d.k }); },
  async restoreVersion(d) { const v = ui.versions.list[+d.k]; const s = song(ui.songId); await store.addVersion(s.id, s.data.lyrics, s.data.title); await patchSong(s.id, { lyrics: v.lyrics }, 'שוחזרה גרסת טקסט מ־' + dmy(v.created_at)); ui.openLyrics = v.lyrics; ui.sheet = null; ui.versions = null; ui.tab = 'text'; render(); toast('הגרסה שוחזרה. הנוכחית נשמרה בהיסטוריה'); },

  recHere() { startRec(ui.songId); },
  recStop() { stopRec(); },
  recCancel() { confirmSheet('לבטל את ההקלטה?', 'ההקלטה הנוכחית לא תישמר.', 'ביטול הקלטה', async () => { clearInterval(ui.recTimer); await AU.cancelRecording(); ui.sheet = null; render(); }); },
  async recAs(d) {
    const name = ($('#rn') || {}).value || kindName(d.k); const r = pendingRec; pendingRec = null; ui.sheet = null; render();
    try { const sid = await saveRecording(r.blob, r.mime, d.k, name, ui.recTarget, r.duration); ui.recTarget = null; openSong(sid); ui.tab = 'sound'; render(); }
    catch (e) { fail(e); pendingRec = r; download('הקלטה-' + Date.now() + '.m4a', r.blob); toast('ההעלאה נכשלה. ההקלטה נשמרה כקובץ בטלפון'); }
  },
  async uploadAs(d) {
    const name = ($('#rn') || {}).value || kindName(d.k); const f = pendingUpload;
    if (!f) return;
    const lossless = AU.isLossless(f);
    if (!lossless && f.size <= 50 * 1048576) {
      pendingUpload = null; ui.sheet = null;
      enqueue([{ f, name, k: d.k, songId: ui.songId, small: false }]);
      return;
    }
    const canC = lossless && (AU.canRealtime() || await AU.canCompress());
    if (!canC && f.size > MAX_UPLOAD) { pendingUpload = null; ui.sheet = null; render(); return toast('הקובץ גדול מ־400 מ״ב. כדאי לייצא אותו קצר או מכווץ יותר'); }
    const est = await AU.estimate(f);
    ui.sheet = { type: 'uploadHow', k: d.k, name, size: f.size, dur: est.duration, small: est.small, canC, lossless, pick: canC ? 'small' : 'orig' };
    render();
  },
  upPick(d) { if (ui.sheet && ui.sheet.type === 'uploadHow') { ui.sheet.pick = d.k; render(); } },
  async upGo() {
    const sh = ui.sheet, f = pendingUpload; if (!sh || !f) return;
    if (sh.pick === 'small') { sh.ctx = AU.makeCtx(); try { sh.ctx && sh.ctx.resume(); } catch (e) {} }
    if (sh.pick === 'orig' && f.size > MAX_UPLOAD) return toast('מקור מעל 400 מ״ב לא נכנס. אפשר לבחור כיווץ');
    pendingUpload = null; ui.sheet = null;
    enqueue([{ f, name: sh.name, k: sh.k, songId: ui.songId, small: sh.pick === 'small' }]);
    toast('נכנס לתור. אפשר להמשיך לעבוד');
  },
  queueOpen() { openSheet({ type: 'queue' }); },
  qRetry(d) { const j = Q.jobs.find(x => x.id === +d.id); if (j && j.f) { j.st = 'wait'; j.p = 0; j.lbl = 'ממתין'; runQueue(); render(); } },
  qRemove(d) { Q.jobs = Q.jobs.filter(x => x.id !== +d.id || x.st === 'cmp' || x.st === 'up'); if (!Q.jobs.length) ui.sheet = null; render(); },
  beatLink() { openSheet({ type: 'beat' }); },
  async beatDel(d) { const s = song(ui.songId); const beats = (s.data.beats || []).filter(b => b.id !== d.id); await patchSong(s.id, { beats }, 'הוסר קישור לטייפ ביט'); render(); },
  play(d) { playRec(d.id); },
  async playToggle() { if (AU.player.paused) await AU.player.play().catch(fail); else AU.player.pause(); render(); },
  playStop() { AU.player.pause(); AU.now.recId = null; ui.sheet = null; render(); },
  skip(d) { if (!AU.player.duration) return; AU.player.currentTime = Math.max(0, Math.min(AU.player.duration - 0.1, AU.player.currentTime + +d.k)); playUi(); if (!ui.sheet) toast((+d.k > 0 ? '+' : '−') + Math.abs(+d.k) + ' שניות'); },
  playerFull() { openSheet({ type: 'player' }); },
  pspeed(d) { AU.player.playbackRate = +d.k; try { AU.player.preservesPitch = true; } catch (e) {} render(); },
  goPlaying() { ui.sheet = null; if (AU.now.songId && song(AU.now.songId)) { if (ui.view === 'song' || isWide()) leaveSong(); openSong(AU.now.songId); ui.tab = 'sound'; render(); } },
  seek(d, el, ev) {
    if (AU.now.recId !== d.id) return playRec(d.id);
    const r = el.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width;
    if (AU.player.duration) AU.player.currentTime = Math.max(0, Math.min(1, x)) * AU.player.duration;
  },
  recMenu(d) { openSheet({ type: 'recMenu', id: d.id }); },
  async recKindSet(d) { await store.updateRecording(ui.sheet.id, { kind: d.k }); render(); },
  async recDownload() {
    const r = S.recs.get(ui.sheet.id);
    try { toast('מפענח…'); const b = await store.recordingBytes(r.id); const ext = (r.meta.mime || '').includes('webm') ? 'webm' : (r.meta.mime || '').includes('mpeg') ? 'mp3' : (r.meta.mime || '').includes('wav') ? 'wav' : 'm4a'; download((r.meta.name || 'הקלטה') + '.' + ext, new Blob([b], { type: r.meta.mime })); } catch (e) { fail(e); }
  },
  async recTrash() { const id = ui.sheet.id; ui.sheet = null; if (AU.now.recId === id) { AU.player.pause(); AU.now.recId = null; } await store.updateRecording(id, null, new Date().toISOString()); render(); toast('ההקלטה הועברה לסל', async () => { await store.updateRecording(id, null, null); render(); }); },

  sysView(d) { ui.sysView = d.k; render(); },
  async syncNow() { toast('מסנכרן…'); await store.sync().catch(fail); render(); },
  async restore(d) { await store.restoreSong(d.id); render(); toast('שוחזר'); },
  purge(d) { const s = song(d.id); confirmSheet('למחוק לצמיתות?', '"' + s.data.title + '" וכל ההקלטות שלו יימחקו סופית, מהמכשיר ומהענן. אי אפשר לבטל את זה.', 'מחיקה לצמיתות', async () => { ui.sheet = null; try { await store.purgeSong(d.id); toast('נמחק לצמיתות'); } catch (e) { fail(e); } render(); }); },
  async recRestore(d) { await store.updateRecording(d.id, null, null); render(); toast('שוחזר'); },
  recPurge(d) { confirmSheet('למחוק את ההקלטה לצמיתות?', 'הקובץ יימחק סופית מהענן. אי אפשר לבטל את זה.', 'מחיקה לצמיתות', async () => { ui.sheet = null; try { await store.purgeRecording(d.id); toast('נמחק לצמיתות'); } catch (e) { fail(e); } render(); }); },
  async backup(d) {
    try {
      const full = d.k === 'full';
      toast(full ? 'מכין גיבוי מלא ומצפין…' : 'מכין גיבוי ומצפין…');
      const b = await store.makeBackup(full);
      const name = 'hamegira-backup-' + new Date().toISOString().slice(0, 10) + (full ? '-full' : '') + '.json';
      const file = new File([JSON.stringify(b)], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'גיבוי המגירה' }); }
        catch (e) { if (e.name === 'AbortError') return toast('הגיבוי בוטל'); throw e; }
      } else download(name, file);
      ui.lastBackup = new Date().toISOString(); await kv.set('lastBackup', ui.lastBackup); render();
      toast('הגיבוי המוצפן נשמר');
    } catch (e) { fail(e); }
  },
  async importYes() {
    const items = ui.sheet.items; ui.busy = true; render();
    try {
      let n = 0;
      for (const it of items) { const id = await store.createSong(it); await store.addVersion(id, it.lyrics, it.title); n++; }
      ui.busy = false; ui.sheet = null; ui.nav = 'home'; ui.view = 'dash'; render(); toast(n + ' שירים יובאו לכספת');
    } catch (e) { ui.busy = false; fail(e); render(); }
  },
  changePass() { openSheet({ type: 'pass' }); },
  async pkUnlock() {
    ui.busy = true; ui.err = ''; render();
    try { const k = await PK.unlock(); await store.unlockWithKey(k, ui.keysRow); ui.busy = false; await enterMain(); }
    catch (e) { ui.busy = false; ui.err = e.name === 'NotAllowedError' ? 'הפתיחה בוטלה. אפשר לנסות שוב או להקליד סיסמה' : e.message; render(); }
  },
  pkSetup() { if (!PK.supported()) return toast('המכשיר הזה לא תומך בפתיחה בטביעת פנים'); openSheet({ type: 'pkSetup' }); },
  pkOff() { confirmSheet('לכבות פתיחה בטביעת פנים?', 'בפתיחה הבאה תצטרך להקליד את סיסמת הכספת.', 'כיבוי', async () => { await PK.remove(); ui.pkEnrolled = false; ui.sheet = null; render(); toast('כובה'); }); },
  autolockSheet() { openSheet({ type: 'autolock' }); },
  async setAutolock(d) { ui.autolock = +d.k; await kv.set('autolock', ui.autolock); ui.sheet = null; render(); },
  async restoreYes() {
    ui.busy = true; render();
    try { const r = await store.restoreBackup(ui.sheet.payload); ui.busy = false; ui.sheet = null; render(); toast('שוחזרו ' + (r.songsAdded + r.songsRestored) + ' שירים ו־' + r.audio + ' הקלטות'); }
    catch (e) { ui.busy = false; fail(e); render(); }
  },
  async mfaSetup() {
    try { const f = await api.mfaEnroll(); openSheet({ type: 'mfa', id: f.id, qr: f.totp.qr_code, secret: f.totp.secret, uri: f.totp.uri }); }
    catch (e) { fail(e); }
  },
  mfaOff() {
    confirmSheet('לכבות את האימות הדו־שלבי?', 'הכניסה לחשבון תחזור להיות עם מייל וסיסמה בלבד. השירים נשארים מוצפנים כרגיל.', 'כיבוי', async () => {
      try { const fs = await api.verifiedFactors(); for (const f of fs) await api.mfaUnenroll(f.id); ui.mfaOn = false; ui.sheet = null; render(); toast('האימות הדו־שלבי כובה'); } catch (e) { fail(e); }
    });
  },
  newRk() { confirmSheet('ליצור מפתח שחזור חדש?', 'המפתח הקודם יפסיק לעבוד מיד.', 'יצירה', async () => { try { const row = await store.vaultState(); const rk = await store.newRecovery(row); openSheet({ type: 'rk', rk }); } catch (e) { fail(e); } }, false); },
  closeSheet() { closeSheet(); },
  overlay(d, el, ev) { if (ev.target === el && ui.sheet && !['import', 'recKind', 'uploadKind', 'uploadHow', 'uploadWork', 'uploadDone', 'recompress'].includes(ui.sheet.type)) closeSheet(); },
  async confirmYes() { const fn = ui.sheet.fn; await fn(); }
};

// טפסים
const F = {
  async auth(fd) {
    ui.busy = true; ui.err = ''; render();
    try {
      if (ui.authMode === 'up') { const r = await api.signUp(fd.get('email').trim(), fd.get('password')); if (!r.confirmed) { ui.busy = false; ui.screen = 'confirm-mail'; return render(); } }
      else await api.signIn(fd.get('email').trim(), fd.get('password'));
      ui.busy = false; await afterLogin();
    } catch (e) { ui.busy = false; ui.err = /Invalid login/i.test(e.message) ? 'המייל או הסיסמה שגויים' : /not confirmed/i.test(e.message) ? 'החשבון עוד לא אושר במייל' : /Signups not allowed/i.test(e.message) ? 'ההרשמה סגורה. זו אפליקציה פרטית.' : e.message; render(); }
  },
  async setup(fd) {
    if (fd.get('p1') !== fd.get('p2')) { ui.err = 'הסיסמאות לא תואמות'; return render(); }
    ui.busy = true; ui.err = ''; render();
    try { ui.recoveryKey = await store.createVault(fd.get('p1')); ui.busy = false; ui.screen = 'showRecovery'; render(); }
    catch (e) { ui.busy = false; ui.err = e.message; render(); }
  },
  async unlock(fd) {
    ui.busy = true; ui.err = ''; render();
    try { await store.unlock(fd.get('vp'), ui.keysRow, !!fd.get('remember')); ui.busy = false; await enterMain(); }
    catch (e) { ui.busy = false; ui.err = e.message; render(); }
  },
  async recover(fd) {
    if (fd.get('n1') !== fd.get('n2')) { ui.err = 'הסיסמאות לא תואמות'; return render(); }
    ui.busy = true; ui.err = ''; render();
    try { await store.unlockWithRecovery(fd.get('rk'), fd.get('n1'), ui.keysRow); ui.busy = false; toast('הסיסמה הוחלפה'); await enterMain(); }
    catch (e) { ui.busy = false; ui.err = e.message; render(); }
  },
  async pkSetup(fd) {
    try {
      const row = await store.vaultState();
      const k = await store.masterFromPass(fd.get('pass'), row);
      await PK.enroll(k, (api.currentUser() || {}).id || 'me');
      await kv.del('mk'); ui.pkEnrolled = true; ui.sheet = null; render(); toast('פתיחה בטביעת פנים הופעלה');
    } catch (e) { toast(e.name === 'NotAllowedError' ? 'ההפעלה בוטלה' : e.message); }
  },
  async restoreSecret(fd) {
    try { const r = await store.openBackup(ui.sheet.text, fd.get('secret')); openSheet({ type: 'restore', meta: r.meta, payload: r.payload }); }
    catch (e) { toast(e.message); }
  },
  async mfa(fd) {
    ui.busy = true; ui.err = ''; render();
    try { await api.mfaVerify(ui.mfaFactor, String(fd.get('code')).trim()); ui.busy = false; await afterLogin(); }
    catch (e) { ui.busy = false; ui.err = /invalid|expired/i.test(e.message) ? 'הקוד שגוי או שפג תוקפו. נסה את הקוד הבא.' : e.message; render(); }
  },
  async mfaEnroll(fd) {
    try { await api.mfaVerify(ui.sheet.id, String(fd.get('code')).trim()); ui.mfaOn = true; ui.sheet = null; render(); toast('אימות דו־שלבי הופעל'); }
    catch (e) { toast(/invalid|expired/i.test(e.message) ? 'הקוד שגוי. נסה את הקוד הבא שמופיע' : e.message); }
  },
  async newSong(fd) {
    const id = await store.createSong({ title: fd.get('title').trim() || 'שיר חדש', stage: fd.get('stage') || 'spark' });
    ui.sheet = null; openSong(id); ui.editText = true; render(); setTimeout(() => { const t = $('#lyr'); t && t.focus(); }, 50);
  },
  async beat(fd) {
    const s = song(ui.songId); const url = fd.get('url').trim();
    if (!/^https?:\/\//i.test(url)) return toast('הכתובת צריכה להתחיל ב־https');
    const beats = (s.data.beats || []).concat({ id: store.uid(), url, note: fd.get('note').trim(), date: new Date().toISOString() });
    ui.sheet = null; await patchSong(s.id, { beats }, 'נוסף קישור לטייפ ביט'); render();
  },
  async addTask(fd) {
    const raw = String(fd.get('text') || '').trim(); if (!raw) return;
    const p = TK.parseTask(raw, []);
    const s = song(ui.songId); const tasks = store.tasksOf(s).map(t => Object.assign({}, t));
    const t = { id: store.uid(), text: p.text || raw, type: p.type || ui.taskType, done: false, at: new Date().toISOString(), due: p.due, time: p.time };
    tasks.push(t);
    await saveTasks(s, tasks, 'משימה חדשה: ' + t.text); render();
    if (t.due) toast('נוספה · ' + TK.dueLabel(t));
    setTimeout(() => { const i = $('#nt'); i && i.focus(); }, 20);
  },
  async quickTask(fd) {
    const raw = String(fd.get('text') || '').trim(); if (!raw) return;
    const p = TK.parseTask(raw, songList());
    const sid = p.songId || ui.qtSong;
    if (!sid) { ui.qtDraft = raw; openSheet({ type: 'songPick', q: '', dr: null, then: 'add' }); return; }
    const s = host(sid); if (!s) return toast('בוחרים שיר למשימה');
    const tasks = store.tasksOf(s).map(t => Object.assign({}, t));
    const t = { id: store.uid(), text: p.text || raw, type: p.type || 'אחר', done: false, at: new Date().toISOString(), due: p.due, time: p.time };
    tasks.push(t);
    ui.qtDraft = ''; ui.qtSong = null;
    await saveTasks(s, tasks, 'משימה חדשה: ' + t.text); render();
    toast((s.general ? 'נוספה משימה כללית' : 'נוספה ל"' + s.data.title + '"') + (t.due ? ' · ' + TK.dueLabel(t) : ''));
    setTimeout(() => { const i = $('#qt'); i && i.focus(); }, 20);
  },
  async pass(fd) {
    if (fd.get('q1') !== fd.get('q2')) return toast('הסיסמאות לא תואמות');
    try { const row = await store.vaultState(); await store.unlock(fd.get('op'), row, false); await store.changePassphrase(fd.get('q1'), row); ui.sheet = null; render(); toast('סיסמת הכספת הוחלפה'); }
    catch (e) { fail(e); }
  }
};

// שינויים בשדות
const CHG = {
  teDate(el) { teKeep(); ui.sheet.draft.due = el.value || ''; if (!el.value) ui.sheet.draft.time = ''; render(); },
  teTime(el) { teKeep(); ui.sheet.draft.time = el.value || ''; render(); },
  async title(el) { const v = el.value.trim(); if (v) await patchSong(ui.songId, { title: v }, 'שם שונה ל"' + v + '"'); },
  async readiness(el) { const s = song(ui.songId); const v = parseFloat(el.value); if (s.data.readiness === v) return; await patchSong(s.id, { readiness: v }, 'מוכנות ' + rd(s.data.readiness) + ' ← ' + rd(v)); render(); },
  async notes(el) { await patchSong(ui.songId, { notes: el.value }); },
  async drawerName(el) {
    const v = el.value.trim(); if (!v) { el.value = stageOf(el.dataset.k).name; return; }
    const ds = store.drawers().map(x => x.k === el.dataset.k ? Object.assign({}, x, { name: v }) : x);
    await store.saveDrawers(ds); toast('השם נשמר');
  },
  async recName(el) { await store.updateRecording(ui.sheet.id, { name: el.value.trim() }); },
  async restore(el) {
    const f = el.files && el.files[0]; if (!f) return;
    const text = await f.text();
    try { const r = await store.openBackup(text); openSheet({ type: 'restore', meta: r.meta, payload: r.payload }); }
    catch (e) { if (e.needSecret) openSheet({ type: 'restore', text }); else fail(e); }
  },
  upload(el) { const f = el.files && el.files[0]; el.value = ''; if (!f) return; pendingUpload = f; openSheet({ type: 'uploadKind', name: f.name.replace(/\.[^.]+$/, '') }); },

  async import(el) {
    const f = el.files && el.files[0]; if (!f) return;
    try {
      const items = await readImportFile(f);
      const have = new Set(all().map(s => s.data.title));
      const fresh = items.filter(i => !have.has(i.title));
      if (!fresh.length) return toast('כל השירים בקובץ כבר קיימים');
      openSheet({ type: 'import', items: fresh, dupes: items.length - fresh.length });
    } catch (e) { fail(e); }
  }
};
const songList = () => all().map(s => ({ id: s.id, title: s.data.title }));
const INP = {
  qt(el) {
    ui.qtDraft = el.value; const p = TK.parseTask(el.value, songList()); if (p.songId) ui.qtSong = p.songId;
    const c = $('#qtc'); if (!c) return;
    const qs = ui.qtSong === GEN ? 'משימה כללית' : ui.qtSong && song(ui.qtSong) ? song(ui.qtSong).data.title : '';
    c.innerHTML = `<button type="button" class="qpick ${qs ? 'on' : ''}" data-a="songPick">♪ ${qs ? esc(qs) : 'בחירת שיר'}</button>` + qChips(p, true);
  },
  spq(el) { if (ui.sheet && ui.sheet.type === 'songPick') { ui.sheet.q = el.value; const l = $('#spl'); if (l) l.innerHTML = songPickBody(ui.sheet); } },
  nt(el) { const p = TK.parseTask(el.value, []); const c = $('#ntc'); if (c) c.innerHTML = el.value.trim() ? qChips(p) : '<span class="qhint">אפשר לכתוב גם מתי: "מחר", "ביום שלישי", "ב־18"</span>'; },
  rv(el) { const v = parseFloat(el.value); const o = document.getElementById('rvv'); if (o) o.textContent = rd(v); const t = document.getElementById('rvt'); if (t) t.textContent = levelText(v); },
  q(el) { ui.q = el.value; const r = document.getElementById('results'); if (r) r.innerHTML = resultsHtml(); }
};

// ---------- אירועים ----------
root.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]');
  if (!el || !root.contains(el)) { if (ui.swipeOpen && !ev.target.closest('.swrap')) closeSwipe(); return; }
  if (el.closest('.swrap') && ui.swipeOpen && el.classList.contains('srow')) { ev.preventDefault(); closeSwipe(); return; }
  if (el.dataset.a === 'overlay' && ev.target !== el) return;
  const fn = A[el.dataset.a];
  if (fn) {
    if (el.tagName === 'A') return; ev.preventDefault();
    let dir = NAV_DIR[el.dataset.a]; if (typeof dir === 'function') dir = dir(el.dataset);
    if (dir && !ui.sheet) Promise.resolve(withTransition(dir, () => fn(el.dataset, el, ev))).catch(fail);
    else Promise.resolve(fn(el.dataset, el, ev)).catch(fail);
  }
});
root.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form]'); if (!f) return;
  ev.preventDefault(); Promise.resolve(F[f.dataset.form](new FormData(f))).catch(fail);
});
root.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]'); if (!el) return;
  Promise.resolve(CHG[el.dataset.change](el)).catch(fail);
});
root.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.drow input')) { ev.preventDefault(); ev.target.blur(); }
});
root.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'lyr') {
    markSaving(); clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { await patchSong(ui.songId, { lyrics: el.value }).catch(fail); markSaved(); }, 600);
    return;
  }
  if (el.id === 'chf' && ui.sheet) { const p = document.getElementById('chp'); if (p) p.textContent = el.value || '—'; return; }
  const k = el.dataset && el.dataset.input; if (k && INP[k]) INP[k](el);
});
root.addEventListener('paste', ev => {
  const el = ev.target; if (el.id !== 'lyr') return;
  const t = (ev.clipboardData || window.clipboardData).getData('text');
  if (t && CH.hasLegacyChordLines(t)) {
    ev.preventDefault(); el.setRangeText(CH.convertChordSheet(t), el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true })); toast('האקורדים הוצמדו למילים');
  }
});
// מקלדת במחשב: חיפוש, יציאה מחלון ונגן
document.addEventListener('keydown', ev => {
  if (ui.screen !== 'main') return;
  const typing = ['INPUT', 'TEXTAREA'].includes((document.activeElement || {}).tagName);
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); A.nav({ k: 'search' }); return; }
  if (ev.key === 'Escape') { if (ui.stage) { stageStop(); render(); } else if (ui.sheet) closeSheet(); return; }
  if (ev.key === ' ' && !typing && AU.now.recId && !ui.stage) { ev.preventDefault(); A.playToggle(); }
});

// החלקה על שורות: השורה עוקבת אחרי האצבע, ובשחרור נגררת בתנועה רכה למקומה
const SW_W = 198;
function closeSwipe() { const w = ui.swipeOpen && root.querySelector('.swrap[data-sw="' + ui.swipeOpen + '"]'); if (w) w.classList.remove('open'); ui.swipeOpen = null; }
let sw = null;
root.addEventListener('touchstart', ev => {
  const w = ev.target.closest('.swrap');
  if (ui.swipeOpen && (!w || w.dataset.sw !== ui.swipeOpen)) closeSwipe();
  if (!w) return;
  sw = { el: w, row: w.querySelector('.srow'), act: w.querySelector('.sw-act'), x: ev.touches[0].clientX, y: ev.touches[0].clientY, dx: 0, lock: null, t: Date.now() };
}, { passive: true });
root.addEventListener('touchmove', ev => {
  if (!sw) return; const t = ev.touches[0]; const dx = t.clientX - sw.x, dy = t.clientY - sw.y;
  if (sw.lock == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sw.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (sw.lock !== 'x') return;
  sw.dx = dx;
  let x = (sw.el.classList.contains('open') ? SW_W : 0) + dx;
  if (x > SW_W) x = SW_W + (x - SW_W) * 0.25; if (x < 0) x = x * 0.25;
  sw.row.style.transition = 'none'; sw.row.style.transform = 'translateX(' + x + 'px)';
  sw.act.style.transition = 'none'; sw.act.style.opacity = Math.max(0, Math.min(1, x / SW_W));
}, { passive: true });
function swipeEnd() {
  if (!sw) return; const s = sw; sw = null;
  if (s.lock !== 'x') return;
  const wasOpen = s.el.classList.contains('open');
  const fast = Math.abs(s.dx) / Math.max(1, Date.now() - s.t) > 0.5;
  const open = wasOpen ? !(s.dx < -40 || (fast && s.dx < 0)) : (s.dx > 70 || (fast && s.dx > 20));
  s.row.style.transition = ''; s.act.style.transition = '';
  s.el.classList.toggle('open', open);
  s.row.style.transform = ''; s.act.style.opacity = '';
  ui.swipeOpen = open ? s.el.dataset.sw : null;
}
root.addEventListener('touchend', swipeEnd);
root.addEventListener('touchcancel', swipeEnd);

// החלקה על משימות: ימינה = בוצע, שמאלה = דחייה. המשימה עוקבת אחרי האצבע, והצבע מתגלה מתחתיה בהדרגה
const TK_W = 172, TK_DONE = 104;
let tk = null;
function closeTk() {
  const w = ui.tkOpen && root.querySelector('.tk[data-tk="' + CSS.escape(ui.tkOpen) + '"]');
  if (w) { const f = w.querySelector('.tk-face'); f.style.transform = ''; w.classList.remove('open', 'swl', 'swr'); w.style.removeProperty('--p'); }
  ui.tkOpen = null;
}
root.addEventListener('touchstart', ev => {
  const w = ev.target.closest('.tk');
  if (ui.tkOpen && (!w || w.dataset.tk !== ui.tkOpen) && !ev.target.closest('.tk-post')) closeTk();
  if (!w || ev.target.closest('.tk-post,.cb,.tk-go') || w.classList.contains('doing')) { tk = null; return; }
  const f = w.querySelector('.tk-face');
  tk = { w, f, x: ev.touches[0].clientX, y: ev.touches[0].clientY, dx: 0, lock: null, t: Date.now(), base: w.classList.contains('open') ? -TK_W : 0 };
}, { passive: true });
root.addEventListener('touchmove', ev => {
  if (!tk) return; const t = ev.touches[0]; const dx = t.clientX - tk.x, dy = t.clientY - tk.y;
  if (tk.lock == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) tk.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (tk.lock !== 'x') return;
  tk.dx = dx;
  let x = tk.base + dx;
  if (x < -TK_W) x = -TK_W + (x + TK_W) * 0.25;
  if (x > TK_DONE * 1.6) x = TK_DONE * 1.6 + (x - TK_DONE * 1.6) * 0.3;
  tk.f.style.transition = 'none'; tk.f.style.transform = 'translateX(' + x + 'px)';
  tk.w.classList.toggle('swr', x > 0); tk.w.classList.toggle('swl', x < 0);
  tk.w.classList.toggle('ready', x > TK_DONE);
  tk.w.style.setProperty('--p', Math.min(1, Math.abs(x) / (x > 0 ? TK_DONE : TK_W)).toFixed(3));
}, { passive: true });
function tkEnd() {
  if (!tk) return; const s = tk; tk = null;
  if (s.lock !== 'x') return;
  const x = s.base + s.dx; const fast = Math.abs(s.dx) / Math.max(1, Date.now() - s.t) > 0.6;
  s.f.style.transition = '';
  s.w.classList.remove('ready');
  if (x > TK_DONE || (fast && s.dx > 40 && s.base === 0)) { const [sid, tid] = s.w.dataset.tk.split('|'); return completeTask(sid, tid, 'swipe'); }
  if (x < -70 || (fast && s.dx < -30)) { s.f.style.transform = 'translateX(' + (-TK_W) + 'px)'; s.w.classList.add('open', 'swl'); s.w.classList.remove('swr'); s.w.style.setProperty('--p', 1); ui.tkOpen = s.w.dataset.tk; return; }
  s.f.style.transform = ''; s.w.classList.remove('open'); s.w.style.setProperty('--p', 0);
  setTimeout(() => { if (!s.w.classList.contains('open')) s.w.classList.remove('swl', 'swr'); }, 320);
  if (ui.tkOpen === s.w.dataset.tk) ui.tkOpen = null;
}
root.addEventListener('touchend', tkEnd);
root.addEventListener('touchcancel', tkEnd);

// גרירה לסידור: שירים, מגירות בבית ובמסך הסידור.
// באצבע: לחיצה ארוכה, או נגיעה בידית. בעכבר: לוחצים וגוררים. הסדר נשמר בשחרור.
let dg = null, dgSuppressClick = false;
const LONG = 320;
function dgScroller(el) { return el.closest('.main') || el.closest('.col.mid') || el.closest('.col') || document.scrollingElement; }
root.addEventListener('pointerdown', ev => {
  if (dg || ev.button > 0 || ui.sheet) return;
  const it = ev.target.closest('[data-dg]');
  if (!it || ev.target.closest('input,textarea,.sw,.mini,.sw-act button,.cplay,[data-scrub]')) return;
  const box = it.parentElement; if (!box || !box.dataset.dgc) return;
  const onGrip = !!ev.target.closest('.grip');
  const touch = ev.pointerType !== 'mouse';
  dg = { it, box, kind: box.dataset.dgc, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, lifted: false, pid: ev.pointerId, touch };
  if (onGrip) { ev.preventDefault(); dgLift(); }
  else if (touch) { it.classList.add('dgpress'); dg.timer = setTimeout(() => { if (dg && !dg.lifted) dgLift(); }, LONG); }
}, true);
function dgLift() {
  const d = dg; d.lifted = true; clearTimeout(d.timer);
  sw = null; if (ui.swipeOpen) closeSwipe();
  d.sc = dgScroller(d.box); d.st0 = d.sc.scrollTop;
  d.items = [...d.box.children].filter(x => x.dataset && x.dataset.dg);
  d.from = d.items.indexOf(d.it); d.to = d.from;
  d.rects = d.items.map(x => { const r = x.getBoundingClientRect(); return { x: r.left, y: r.top + d.st0, w: r.width, h: r.height }; });
  d.it.classList.remove('dgpress'); d.box.classList.add('dgbox'); d.it.classList.add('dglift');
  d.items.forEach(x => { if (x !== d.it) x.classList.add('dgmove'); });
  document.documentElement.classList.add('dragging');
  try { navigator.vibrate && navigator.vibrate(8); } catch (e) {}
  dgFrame();
}
function dgPlace() {
  const d = dg; const st = d.sc.scrollTop;
  const two = d.kind === 'tile' || d.box.dataset.two; const dx = two ? d.x - d.x0 : 0, dy = d.y - d.y0 + (st - d.st0);
  d.it.style.transform = `translate(${dx}px,${dy}px) scale(${two ? 1.05 : 1.03}) rotate(${two ? -1.2 : -.5}deg)`;
  const r0 = d.rects[d.from]; const cx = r0.x + r0.w / 2 + dx, cy = r0.y + r0.h / 2 + dy;
  let best = d.to, bd = Infinity;
  d.rects.forEach((r, i) => { const ex = r.x + r.w / 2 - cx, ey = r.y + r.h / 2 - cy; const dd = (two ? ex * ex : 0) + ey * ey; if (dd < bd) { bd = dd; best = i; } });
  if (best !== d.to) {
    d.to = best;
    const order = d.items.map((_, i) => i); order.splice(d.from, 1); order.splice(d.to, 0, d.from);
    order.forEach((orig, slot) => {
      if (orig === d.from) return;
      const a = d.rects[orig], b = d.rects[slot];
      d.items[orig].style.transform = (a.x !== b.x || a.y !== b.y) ? `translate(${b.x - a.x}px,${b.y - a.y}px)` : '';
    });
  }
}
function dgFrame() {
  if (!dg || !dg.lifted) return;
  const d = dg; const sr = d.sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : d.sc.getBoundingClientRect();
  const edge = 70; let v = 0;
  if (d.y < sr.top + edge) v = -Math.ceil((sr.top + edge - d.y) / 6);
  else if (d.y > sr.bottom - edge) v = Math.ceil((d.y - (sr.bottom - edge)) / 6);
  if (v) d.sc.scrollTop += v;
  dgPlace();
  d.raf = requestAnimationFrame(dgFrame);
}
window.addEventListener('pointermove', ev => {
  if (!dg || ev.pointerId !== dg.pid) return;
  dg.x = ev.clientX; dg.y = ev.clientY;
  if (!dg.lifted) {
    const m = Math.hypot(ev.clientX - dg.x0, ev.clientY - dg.y0);
    if (!dg.touch && m > 6) dgLift();
    else if (dg.touch && m > 9) dgCancel();
  }
}, { passive: true });
document.addEventListener('touchmove', ev => { if (dg && dg.lifted) ev.preventDefault(); }, { passive: false });
function dgCancel() { if (!dg) return; clearTimeout(dg.timer); dg.it.classList.remove('dgpress'); dg = null; }
async function dgDrop() {
  const d = dg; if (!d) return;
  if (!d.lifted) return dgCancel();
  cancelAnimationFrame(d.raf); dg = null; dgSuppressClick = true; setTimeout(() => { dgSuppressClick = false; }, 400);
  const a = d.rects[d.from], b = d.rects[d.to], st = d.sc.scrollTop - d.st0;
  d.it.classList.add('dgdrop');
  d.it.style.transform = `translate(${b.x - a.x}px,${b.y - a.y - 0}px)`;
  void st;
  document.documentElement.classList.remove('dragging');
  await new Promise(r => setTimeout(r, 240));
  const ids = d.items.map(x => x.dataset.id || x.dataset.k); const mv = ids.splice(d.from, 1)[0]; ids.splice(d.to, 0, mv);
  try {
    if (d.from !== d.to) {
      if (d.kind === 'song') {
        const rest = sortSongs(byStage(ui.drawer), ui.drawer).map(x => x.id).filter(id => !ids.includes(id));
        await store.saveOrder(ui.drawer, ids.concat(rest));
      } else {
        const ds = store.drawers(); const byK = new Map(ds.map(x => [x.k, x]));
        const moved = ids.map(k => byK.get(k)).filter(Boolean);
        await store.saveDrawers(moved.concat(ds.filter(x => !ids.includes(x.k))));
      }
    }
  } catch (e) { fail(e); }
  render();
}
window.addEventListener('pointerup', ev => { if (dg && ev.pointerId === dg.pid) dgDrop(); });
window.addEventListener('pointercancel', ev => { if (dg && ev.pointerId === dg.pid) { if (dg.lifted) dgDrop(); else dgCancel(); } });
root.addEventListener('click', ev => { if (dgSuppressClick) { ev.stopPropagation(); ev.preventDefault(); dgSuppressClick = false; } }, true);
root.addEventListener('contextmenu', ev => { if (ev.target.closest('[data-dg]')) ev.preventDefault(); });

// נגן
// עדכון חי של הזמן, הפס, הנקודה וגל הקול, בלי לצייר את כל המסך מחדש
function playUi(tOverride) {
  const d = AU.player.duration || 0; const t = tOverride != null ? tOverride : AU.player.currentTime;
  const p = d ? Math.max(0, Math.min(1, t / d)) : 0;
  const set = (id, fn) => { const e = document.getElementById(id); if (e) fn(e); };
  set('plt', e => e.textContent = dur(t)); set('pft', e => e.textContent = dur(t)); set('pfl', e => e.textContent = '-' + dur(Math.max(0, d - t)));
  set('pld', e => e.textContent = d ? dur(d) : '–');
  set('pbar', e => e.style.width = (p * 100) + '%'); set('pknob', e => e.style.left = (p * 100) + '%');
  set('pbigline', e => e.style.left = (p * 100) + '%');
  document.querySelectorAll('[data-wave="' + AU.now.recId + '"]').forEach(w => { const sp = w.querySelectorAll('span'); const k = Math.floor(p * sp.length); sp.forEach((x, i) => { x.style.background = i < k ? 'var(--acc)' : ''; }); });
}
AU.player.addEventListener('timeupdate', () => { if (!scrubbing) playUi(); });
AU.player.addEventListener('loadedmetadata', () => playUi());

// גרירה על פס הנגן ועל גל הקול: קופצים לכל רגע בהקלטה
let scrubbing = null;
root.addEventListener('pointerdown', async ev => {
  const el = ev.target.closest('[data-scrub]'); if (!el || ev.button > 0) return;
  ev.preventDefault();
  const id = el.dataset.id || AU.now.recId; if (!id) return;
  const at = x => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
  const x0 = ev.clientX;
  if (AU.now.recId !== id) { await playRec(id); const go = () => { if (AU.player.duration) AU.player.currentTime = at(x0) * AU.player.duration; }; if (AU.player.duration) go(); else AU.player.addEventListener('loadedmetadata', go, { once: true }); return; }
  scrubbing = { el, pid: ev.pointerId, f: at(x0) };
  el.classList.add('active'); document.documentElement.classList.add('scrubbing');
  try { el.setPointerCapture(ev.pointerId); } catch (e) {}
  playUi(scrubbing.f * (AU.player.duration || 0));
});
root.addEventListener('pointermove', ev => {
  if (!scrubbing || ev.pointerId !== scrubbing.pid) return;
  const r = scrubbing.el.getBoundingClientRect(); scrubbing.f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  playUi(scrubbing.f * (AU.player.duration || 0));
});
const scrubEnd = ev => {
  if (!scrubbing || ev.pointerId !== scrubbing.pid) return;
  const s = scrubbing; scrubbing = null; s.el.classList.remove('active'); document.documentElement.classList.remove('scrubbing');
  if (AU.player.duration) AU.player.currentTime = s.f * AU.player.duration;
  playUi();
};
root.addEventListener('pointerup', scrubEnd); root.addEventListener('pointercancel', scrubEnd);
['play', 'pause', 'ended'].forEach(e => AU.player.addEventListener(e, () => { if (ui.screen === 'main' && (!ui.sheet || ui.sheet.type === 'player') && !ui.stage) render(); }));

function afterRender() {
  const sv = document.getElementById('saved'); if (sv && S.pending && !S.online) sv.textContent = 'נשמר במכשיר';
  // בוחר האקורדים: המילה הנבחרת נשארת גלויה מעל החלון
  const sel = document.getElementById('selw');
  if (sel) { const sc = sel.closest('.main, .col.main2'); if (sc) { const r = sel.getBoundingClientRect(), rs = sc.getBoundingClientRect(); const want = rs.top + 110; if (r.top > rs.top + Math.max(140, rs.height - 470) || r.top < rs.top + 40) sc.scrollTop += r.top - want; } }
}
let wasWide = isWide();
window.addEventListener('resize', () => { const w = isWide(); if (w !== wasWide) { wasWide = w; if (!w && ui.songId && ui.nav === 'home' && song(ui.songId)) ui.view = 'song'; if (ui.screen === 'main') render(); } });

// ---------- זרימת פתיחה ----------
async function afterLogin() {
  const factors = await api.verifiedFactors();
  ui.mfaOn = factors.length > 0;
  if (ui.mfaOn && api.currentAal() !== 'aal2') { ui.mfaFactor = factors[0].id; ui.screen = 'mfa'; return render(); }
  ui.keysRow = await store.vaultState();
  if (!ui.keysRow) { ui.screen = 'setup'; return render(); }
  await loadPrefs();
  if (!ui.pkEnrolled && await store.tryRemembered(ui.keysRow)) return enterMain();
  ui.screen = 'unlock'; render();
}
async function loadPrefs() {
  ui.pkEnrolled = await PK.enrolled();
  const al = await kv.get('autolock'); ui.autolock = al == null ? 5 : al;
  ui.lastBackup = (await kv.get('lastBackup')) || null;
}
async function enterMain() {
  await loadPrefs();
  if (ui.pkEnrolled) await kv.del('mk');
  ui.screen = 'main'; ui.err = ''; ui.nav = 'home'; ui.view = 'dash'; ui.songId = null;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await store.loadLocal();
  ui.drawer = store.drawers()[0].k;
  render();
  NT.status().then(v => { ui.notify = v; });
  store.sync().then(async () => { render(); await store.ensureNotifyKey(); store.syncReminders(); }).catch(e => { if (e.status === 401) { ui.screen = 'auth'; render(); } });
  const q = new URLSearchParams(location.search).get('song');
  if (q) { history.replaceState(null, '', location.pathname); openSongState(q); }
}
function openSongState(id) {
  if (!song(id)) return;
  if (ui.view === 'song' || isWide()) leaveSong();
  ui.sheet = null; ui.nav = 'home'; openSong(id); ui.tab = 'state'; render();
}
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', ev => { if (ev.data && ev.data.type === 'openSong' && ui.screen === 'main') openSongState(ev.data.song); });
store.onChange(() => { if (ui.screen === 'main' && !ui.sheet && !ui.stage && document.activeElement && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) render(); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') { ui.hiddenAt = Date.now(); return; }
  TH.apply();
  if (!store.isUnlocked()) return;
  if (ui.pkEnrolled && !AU.isRecording() && ui.hiddenAt && Date.now() - ui.hiddenAt >= ui.autolock * 60000) {
    stageStop(); AU.player.pause(); AU.now.recId = null; ui.sheet = null;
    await store.lock(); ui.screen = 'unlock'; render(); return;
  }
  if (ui.stage && 'wakeLock' in navigator && !wakeLock) navigator.wakeLock.request('screen').then(w => { wakeLock = w; }).catch(() => {});
  store.sync().then(render).catch(() => {});
});

async function boot() {
  render();
  if (!api.hasSession()) { ui.screen = 'auth'; return render(); }
  try { await afterLogin(); }
  catch (e) { ui.screen = e.status === 401 ? 'auth' : 'unlock'; if (ui.screen === 'unlock' && !ui.keysRow) ui.screen = 'auth'; render(); }
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
