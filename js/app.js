import * as api from './api.js';
import * as store from './store.js';
import { STAGES, stageOf, POTS, KINDS, kindName, S } from './store.js';
import * as CH from './chords.js';
import * as AU from './audio.js';
import { readImportFile } from './importer.js';
import { CONFIG } from './config.js';
import * as PK from './passkey.js';
import { kv } from './db.js';

const root = document.getElementById('root');
const $ = s => root.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- מצב ממשק ----------
const ui = {
  screen: 'boot', authMode: 'in', err: '', busy: false, keysRow: null, recoveryKey: '',
  nav: 'home', view: 'dash', drawer: 'ready', songId: null, tab: 'text', sort: 'v',
  editText: false, chordMode: false, showChords: true, q: '', filters: {}, sysView: 'main',
  sheet: null, pkEnrolled: false, autolock: 5, lastBackup: null, hiddenAt: 0, versions: null, openLyrics: '', recTarget: null, recTimer: null, swipeOpen: null
};

// ---------- עזרים ----------
const DAY = 86400000;
function rel(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (d <= 0) return 'היום'; if (d === 1) return 'אתמול'; if (d < 7) return 'לפני ' + d + ' ימים';
  if (d < 30) { const w = Math.round(d / 7); return w === 1 ? 'לפני שבוע' : 'לפני ' + w + ' שבועות'; }
  if (d < 365) { const m = Math.round(d / 30); return m === 1 ? 'לפני חודש' : 'לפני ' + m + ' חודשים'; }
  return 'לפני יותר משנה';
}
const daysAgo = iso => iso ? (Date.now() - new Date(iso).getTime()) / DAY : 999;
const dmy = iso => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getFullYear()).slice(2); };
const hm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const dur = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const rd = v => v == null ? '–' : (Math.round(v * 10) / 10).toString();
const mb = b => (b / 1048576).toFixed(b > 104857600 ? 0 : 1);
const plain = t => (t || '').replace(/\[[^\]]*\]/g, '');
const I = {
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64635E" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  play: c => '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + c + '" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>',
  pause: c => '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + c + '" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  dots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  reel: '<svg class="reel" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="none" stroke="#64635E" stroke-width="2"/><circle cx="14" cy="14" r="4" fill="#FF8A5C"/><path d="M14 4v5M22 18l-4-2M6 18l4-2" stroke="#64635E" stroke-width="2" stroke-linecap="round"/></svg>',
  lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
};

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
function attention() {
  const out = [];
  for (const s of all()) {
    const st = s.data.stage, f = flags(s);
    if (['ready', 'close'].includes(st) && !f.beat) out.push({ s, why: stageOf(st).name + ', ועדיין בלי טייפ ביט', w: 3 });
    else if (['ready', 'close', 'dev'].includes(st) && daysAgo(s.data.editedAt) > 30) out.push({ s, why: 'לא נערך ' + rel(s.data.editedAt).replace('לפני ', ''), w: 2 });
    else if (['ready', 'close', 'dev'].includes(st) && !s.data.next) out.push({ s, why: 'אין צעד הבא', w: 1 });
  }
  return out.sort((a, b) => b.w - a.w || (b.s.data.readiness || 0) - (a.s.data.readiness || 0));
}
const byStage = k => all().filter(s => s.data.stage === k);

// ---------- רינדור ----------
function render() {
  const keep = ui.screen === 'main' ? { k: ui.nav + ui.view + ui.songId + ui.tab + ui.sysView, y: ($('.main') || {}).scrollTop || 0 } : null;
  let h = '';
  if (ui.screen === 'boot') h = '<div class="gate"><div class="logo"><img src="icons/icon-192.png" alt=""><span class="h1">המגירה</span></div><p class="hint">פותח את הכספת…</p></div>';
  else if (ui.screen === 'auth') h = vAuth();
  else if (ui.screen === 'confirm-mail') h = vConfirmMail();
  else if (ui.screen === 'setup') h = vSetup();
  else if (ui.screen === 'showRecovery') h = vShowRecovery();
  else if (ui.screen === 'unlock') h = vUnlock();
  else if (ui.screen === 'mfa') h = vMfa();
  else if (ui.screen === 'recover') h = vRecover();
  else h = vMain();
  root.innerHTML = h;
  if (keep && root.dataset.k === keep.k && $('.main')) $('.main').scrollTop = keep.y;
  root.dataset.k = keep ? keep.k : '';
  afterRender();
}

function gate(inner) { return '<div class="gate"><div class="logo"><img src="icons/icon-192.png" alt=""><div><div class="h1">המגירה</div><div class="sub">כל השירים שלך, נעולים</div></div></div>' + (ui.err ? '<div class="err" role="alert">' + esc(ui.err) + '</div>' : '') + inner + '</div>'; }

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
  return gate(`<div class="card"><b>נשלח אליך מייל לאישור החשבון.</b><p class="hint">לחץ על הקישור שבמייל, חזור לכאן והיכנס עם המייל והסיסמה.</p><button class="btn pri full" data-a="toAuth">לכניסה</button></div>`);
}
function vSetup() {
  return gate(`
  <form class="card" data-form="setup">
    <b>יצירת הכספת</b>
    <p class="hint" style="margin:0">בחר סיסמת כספת. ממנה נגזר המפתח שמצפין כל שיר וכל הקלטה כאן במכשיר, לפני שהם עולים לענן. השרת לא רואה אותה ולא יכול לשחזר אותה.</p>
    <div class="field"><label for="p1">סיסמת כספת (לפחות 10 תווים)</label><input class="inp ltr" id="p1" name="p1" type="password" autocomplete="new-password" minlength="10" required></div>
    <div class="field"><label for="p2">שוב, לאימות</label><input class="inp ltr" id="p2" name="p2" type="password" autocomplete="new-password" minlength="10" required></div>
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'יוצר מפתחות…' : 'יצירת הכספת'}</button>
  </form>`);
}
function vShowRecovery() {
  return gate(`
  <div class="card">
    <b>מפתח השחזור שלך</b>
    <p class="hint" style="margin:0">אם תשכח את סיסמת הכספת, זו הדרך היחידה לפתוח את השירים. הוא מוצג עכשיו פעם אחת בלבד. שמור אותו מחוץ לטלפון: על דף, או במנהל סיסמאות.</p>
    <div class="rk">${esc(ui.recoveryKey)}</div>
    <button class="btn full" data-a="copyRk">העתקה</button>
    <label class="check"><input type="checkbox" id="rkok"> שמרתי את מפתח השחזור במקום בטוח</label>
    <button class="btn pri full" data-a="rkDone">המשך</button>
  </div>`);
}
function vUnlock() {
  return gate(`
  ${ui.pkEnrolled ? `<button class="btn pri full" style="height:56px;font-size:16px" data-a="pkUnlock" ${ui.busy ? 'disabled' : ''}>פתיחה בטביעת פנים</button><p class="hint" style="margin:-10px 0 0;text-align:center">או עם סיסמת הכספת:</p>` : ''}
  <form class="card" data-form="unlock">
    <div class="field"><label for="vp">סיסמת כספת</label><input class="inp ltr" id="vp" name="vp" type="password" autocomplete="current-password" required></div>
    ${ui.pkEnrolled ? '' : '<label class="check"><input type="checkbox" name="remember" checked> להשאיר פתוח במכשיר הזה עד שאנעל ידנית</label>'}
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'פותח…' : 'פתיחה'}</button>
  </form>
  <div class="grid2"><button class="btn" data-a="toRecover">שכחתי את הסיסמה</button><button class="btn" data-a="signOut">התנתקות</button></div>`);
}
function vMfa() {
  return gate(`
  <form class="card" data-form="mfa">
    <b>קוד אימות</b>
    <p class="hint" style="margin:0">הזן את הקוד בן 6 הספרות מאפליקציית האימות. הוא מתחלף כל 30 שניות.</p>
    <div class="field"><label for="otp">קוד</label><input class="inp ltr" id="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required style="font-family:var(--mono);font-size:22px;letter-spacing:6px;text-align:center"></div>
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'בודק…' : 'אישור'}</button>
  </form>
  <button class="btn full" data-a="signOut">התנתקות</button>`);
}
function vRecover() {
  return gate(`
  <form class="card" data-form="recover">
    <b>שחזור עם מפתח השחזור</b>
    <div class="field"><label for="rkin">מפתח השחזור</label><input class="inp ltr" id="rkin" name="rk" autocomplete="off" required></div>
    <div class="field"><label for="n1">סיסמת כספת חדשה</label><input class="inp ltr" id="n1" name="n1" type="password" minlength="10" autocomplete="new-password" required></div>
    <div class="field"><label for="n2">שוב, לאימות</label><input class="inp ltr" id="n2" name="n2" type="password" minlength="10" autocomplete="new-password" required></div>
    <button class="btn pri full" type="submit" ${ui.busy ? 'disabled' : ''}>שחזור</button>
  </form>
  <button class="btn full" data-a="toUnlock">חזרה</button>`);
}

function vMain() {
  let body = '';
  if (ui.nav === 'home') body = ui.view === 'song' && song(ui.songId) ? vSong() : ui.view === 'drawer' ? vDrawer() : vDash();
  else if (ui.nav === 'search') body = vSearch();
  else if (ui.nav === 'next') body = vNext();
  else body = ui.sysView === 'trash' ? vTrash() : vSys();
  return `<div class="app">
    <div class="main">${body}</div>
    ${vRecbar()}${vPlayer()}${vNav()}
    ${ui.sheet ? vSheet() : ''}
  </div>`;
}

function vNav() {
  const it = (k, l) => `<button class="${ui.nav === k ? 'on' : ''}" data-a="nav" data-k="${k}"><i></i>${l}</button>`;
  return `<nav class="nav">${it('home', 'מגירות')}${it('search', 'חיפוש')}
    <button class="recbtn ${AU.isRecording() ? 'live' : ''}" data-a="rec" aria-label="${AU.isRecording() ? 'עצירת הקלטה' : 'הקלטה מהירה'}"><span><b></b></span></button>
    ${it('next', 'הבא בתור')}${it('sys', 'מערכת')}</nav>`;
}
function vRecbar() {
  if (!AU.isRecording()) return '';
  const t = ui.recTarget && song(ui.recTarget) ? 'לתוך ' + song(ui.recTarget).data.title : 'ניצוץ חדש';
  return `<div class="recbar" role="status"><span class="recdot"></span><span style="flex:1;font-size:14px">מקליט · ${esc(t)}</span><span class="num" id="rect" style="font-size:14px">${dur(AU.recordingElapsed())}</span>
  <button class="btn" style="height:36px;background:transparent;color:#FFE2D6;border-color:#6B2A1C" data-a="recCancel">ביטול</button>
  <button class="btn" style="height:36px;background:var(--rec);border-color:var(--rec);color:#fff" data-a="recStop">שמירה</button></div>`;
}
function vPlayer() {
  if (!AU.now.recId || AU.isRecording()) return '';
  const p = !AU.player.paused;
  return `<div class="player ${p ? 'playing' : ''}" style="position:relative"><div class="pbar"><span id="pbar"></span></div>${I.reel}
    <div class="info" data-a="goPlaying"><b>${esc(AU.now.title)}</b><small>${esc(AU.now.song)}</small></div>
    <span class="num" id="plt" style="font-size:12px;color:#FF8A5C">${dur(AU.player.currentTime)}</span>
    <button class="key acc" data-a="playToggle" aria-label="${p ? 'השהיה' : 'השמעה'}">${p ? I.pause('#141414') : I.play('#141414')}</button>
    <button class="more" style="color:#9C9A93" data-a="playStop" aria-label="סגירת הנגן">${I.x}</button></div>`;
}

// ---- בית ----
function vDash() {
  const list = all();
  const recent = list.slice().sort((a, b) => (b.data.pinned - a.data.pinned) || (b.data.editedAt || '').localeCompare(a.data.editedAt || '')).slice(0, 3);
  const att = attention();
  const syncTxt = S.warning ? S.warning : !S.online ? 'לא מחובר · נשמר במכשיר' : S.pending ? 'מסנכרן ' + S.pending + '…' : S.lastSync ? 'מגובה · ' + hm(S.lastSync) : 'מגובה';
  return `
  <div class="hdr"><div><h1 class="h1">המגירה</h1><div class="sub">${list.length} שירים · ${esc(syncTxt)}</div></div>
    <div style="display:flex;gap:8px"><button class="iconbtn" data-a="newSong" aria-label="שיר חדש">${I.plus}</button><button class="pill-dark" data-a="lockNow"><span class="led" style="background:#3DDC84"></span>נעילה</button></div></div>
  <button class="search" data-a="nav" data-k="search">${I.search}<span>חיפוש בשמות, במילים ובהערות</span></button>
  ${list.length === 0 ? `<div class="card"><b>המגירה ריקה</b><p class="hint" style="margin:0">אפשר לייבא את השירים מהפתקים, או להתחיל שיר חדש.</p><div class="grid2"><button class="btn pri" data-a="goImport">ייבוא שירים</button><button class="btn" data-a="newSong">שיר חדש</button></div></div>` : ''}
  ${list.length && (!ui.lastBackup || daysAgo(ui.lastBackup) > 30) ? `<div class="card" style="gap:10px;border-color:var(--acc);background:var(--acc-bg)"><b>${ui.lastBackup ? 'עבר יותר מחודש מהגיבוי האחרון' : 'עוד לא עשית גיבוי'}</b><p class="hint" style="margin:0">גיבוי מוצפן נשמר אצלך, ונפתח רק עם סיסמת הכספת או מפתח השחזור. גם אם יקרה משהו לענן, החומרים לא ילכו לאיבוד.</p><button class="btn dark" data-a="backup" data-k="full">גיבוי מלא עכשיו</button></div>` : ''}
  ${recent.length ? `<section><div class="lbl"><span>בעבודה עכשיו</span></div><div class="box">${recent.map(s => `
    <button class="row" data-a="open" data-id="${s.id}"><span class="led" style="background:${stageOf(s.data.stage).dot}"></span>
    <span class="grow"><span class="t">${s.data.pinned ? '📌 ' : ''}${esc(s.data.title)}</span><span class="m">${stageOf(s.data.stage).name} · ${rel(s.data.editedAt)}</span></span>
    <span class="num" style="font-size:15px">${rd(s.data.readiness)}</span>${I.chev}</button>`).join('')}</div></section>` : ''}
  <section><div class="lbl"><span>מגירות</span></div><div class="box">${STAGES.map(st => {
    const ss = byStage(st.k); const rs = ss.map(s => s.data.readiness).filter(v => v != null);
    const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
    const n = att.filter(a => a.s.data.stage === st.k).length;
    return `<button class="row" style="height:52px;padding:0 14px" data-a="drawer" data-k="${st.k}"><span class="led" style="width:8px;height:8px;background:${st.dot}"></span>
      <span class="grow"><span class="t">${st.name}</span></span>${n ? `<span class="badge">${n} לטיפול</span>` : ''}
      <span class="bar" title="מוכנות ממוצעת"><span style="width:${avg * 10}%;background:${st.dot}"></span></span>
      <span class="num" style="font-size:13px;width:24px;text-align:left">${ss.length}</span></button>`;
  }).join('')}</div></section>
  ${att.length ? `<section><div class="lbl"><span>דורש טיפול</span><span>${att.length}</span></div><div class="box">${att.slice(0, 6).map(a => `
    <button class="row" data-a="open" data-id="${a.s.id}"><span style="width:6px;height:22px;border-radius:3px;background:var(--acc);flex:0 0 auto"></span>
    <span class="grow"><span class="t" style="font-size:14px">${esc(a.s.data.title)}</span><span class="m">${esc(a.why)}</span></span></button>`).join('')}</div></section>` : ''}`;
}

// ---- מגירה ----
function sortSongs(list) {
  const pr = { 'גבוה': 0, 'בינוני': 1, 'נמוך': 2, 'צדדי': 3 };
  return list.sort((a, b) => (b.data.pinned - a.data.pinned) || (ui.sort === 'v' ? (b.data.readiness ?? -1) - (a.data.readiness ?? -1)
    : ui.sort === 'ago' ? (b.data.editedAt || '').localeCompare(a.data.editedAt || '') : ui.sort === 'pot' ? (pr[a.data.potential] ?? 9) - (pr[b.data.potential] ?? 9) : a.data.title.localeCompare(b.data.title, 'he')));
}
function songRow(s, swipe) {
  const f = flags(s); const L = on => `<span class="led" style="width:8px;height:8px;background:${on ? 'var(--ok)' : 'var(--line)'}"></span>`;
  const row = `<button class="row" data-a="open" data-id="${s.id}"><span class="num" style="font-size:18px;width:36px">${rd(s.data.readiness)}</span>
    <span class="grow"><span class="t">${s.data.pinned ? '📌 ' : ''}${esc(s.data.title)}</span><span class="m">פוטנציאל ${esc(s.data.potential || '–')} · ${rel(s.data.editedAt)}</span></span>
    <span style="display:flex;gap:5px" aria-label="סקיצה, טייפ ביט, גיטרה">${L(f.sketch)}${L(f.beat)}${L(f.guitar)}</span></button>`;
  if (!swipe) return row;
  return `<div class="swrap ${ui.swipeOpen === s.id ? 'open' : ''}" data-sw="${s.id}"><div class="sw-act">
    <button data-a="moveSheet" data-id="${s.id}">העברה</button><button data-a="pin" data-id="${s.id}">${s.data.pinned ? 'ביטול הצמדה' : 'הצמדה'}</button><button class="del" data-a="trash" data-id="${s.id}">לסל</button></div>${row}</div>`;
}
function vDrawer() {
  const st = stageOf(ui.drawer); const list = sortSongs(byStage(st.k));
  const sorts = [['v', 'מוכנות'], ['ago', 'עריכה אחרונה'], ['pot', 'פוטנציאל'], ['abc', 'א–ת']];
  return `<div class="hdr" style="align-items:center"><button class="iconbtn" data-a="home" aria-label="חזרה">${I.back}</button><span class="led" style="width:10px;height:10px;background:${st.dot}"></span><span class="h2">${st.name}</span><span class="num" style="font-size:13px;color:var(--mute)">${list.length}</span><button class="iconbtn" data-a="newSong" data-stage="${st.k}" aria-label="שיר חדש במגירה">${I.plus}</button></div>
  <div class="chips">${sorts.map(([k, l]) => `<button class="chip ${ui.sort === k ? 'on' : ''}" data-a="sort" data-k="${k}">${l}</button>`).join('')}</div>
  <div><div class="lbl" style="padding:0 14px"><span>שיר</span><span>סקיצה · ביט · גיטרה</span></div>
  <div class="box">${list.length ? list.map(s => songRow(s, true)).join('') : '<div class="empty">המגירה הזו ריקה</div>'}</div>
  <p class="hint" style="margin:8px 4px 0">החלקה הצידה על שיר: העברה למגירה אחרת, הצמדה או מחיקה.</p></div>`;
}

// ---- שיר ----
function vSong() {
  const s = song(ui.songId), d = s.data, st = stageOf(d.stage), f = flags(s);
  const tabs = [['text', 'טקסט'], ['sound', 'סאונד'], ['state', 'מצב'], ['hist', 'היסטוריה']];
  let body = ui.tab === 'sound' ? tSound(s) : ui.tab === 'state' ? tState(s) : ui.tab === 'hist' ? tHist(s) : tText(s);
  return `<div class="hdr" style="align-items:center"><button class="iconbtn" data-a="songBack" aria-label="חזרה">${I.back}</button><span class="h2">${esc(d.title)}</span>
    <button class="chip" data-a="tab" data-k="state"><span class="led" style="background:${st.dot}"></span>${st.name}</button></div>
  <div class="stats"><div class="stat dark" data-a="tab" data-k="state"><span class="k">מוכנות</span><span class="v">${rd(d.readiness)}</span></div>
    <div class="stat" data-a="tab" data-k="state"><span class="k">פוטנציאל</span><span class="vt">${esc(d.potential || '–')}</span></div>
    <div class="stat" data-a="tab" data-k="sound"><span class="k">הקלטות</span><span class="v">${f.n}</span></div></div>
  <div class="seg" style="grid-template-columns:repeat(4,minmax(0,1fr))">${tabs.map(([k, l]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="tab" data-k="${k}">${l}</button>`).join('')}</div>
  ${body}`;
}

function tText(s) {
  const d = s.data;
  const bar = `<div class="toolbar">
    <button class="tb ${ui.editText ? 'on' : ''}" data-a="editText">${ui.editText ? 'סיום עריכה' : 'עריכת טקסט'}</button>
    ${ui.editText ? `<button class="tb" data-a="insSection">+ קטע</button>` : `<button class="tb ${ui.chordMode ? 'on' : ''}" data-a="chordMode">${ui.chordMode ? 'סיום אקורדים' : 'אקורדים'}</button>
    <button class="tb" data-a="transpose" data-k="-1" aria-label="טון למטה">−½</button><button class="tb" data-a="transpose" data-k="1" aria-label="טון למעלה">+½</button>
    <button class="tb" data-a="toggleChords">${ui.showChords ? 'הסתרת אקורדים' : 'הצגת אקורדים'}</button>`}
    <span class="saved" id="saved">נשמר</span></div>`;
  if (ui.editText) return bar + `<textarea class="lyricsedit" id="lyr" dir="rtl" placeholder="כאן כותבים. שורה כמו פזמון: או בית 2: הופכת לכותרת קטע.">${esc(d.lyrics)}</textarea>
    <p class="hint">אקורד נכתב בסוגריים מרובעים צמוד למילה שמעליה הוא מנוגן, למשל [Am]. אפשר גם להדביק שיר בפורמט של שורת אקורדים מעל שורת מילים, והאקורדים יוצמדו למילים אוטומטית.</p>`;
  if (!d.lyrics.trim()) return bar + `<div class="sheetpaper"><div class="empty">עוד אין כאן מילים.<br><button class="btn pri" style="margin-top:12px" data-a="editText">להתחיל לכתוב</button></div></div>`;
  const bl = CH.blocks(d.lyrics);
  const html = bl.map(b => b.type === 'blank' ? '<div class="ln gap"></div>' : b.type === 'section' ? `<span class="sec">${esc(b.name)}</span>` :
    `<div class="ln">${b.words.map((w, k) => ui.chordMode ? `<button class="w" style="all:unset;display:inline-flex;flex-direction:column;cursor:pointer" data-a="pickChord" data-l="${b.i}" data-w="${k}"><span class="c">${esc(w.chord)}</span><span>${esc(w.word) || '·'}</span></button>`
      : `<span class="w"><span class="c">${esc(w.chord)}</span><span>${esc(w.word)}</span></span>`).join('')}</div>`).join('');
  return bar + (ui.chordMode ? '<p class="hint" style="margin:-8px 0 0">נגיעה במילה מוסיפה או משנה את האקורד שמעליה.</p>' : '') +
    `<div class="sheetpaper ${ui.showChords || ui.chordMode ? '' : 'nochords'} ${ui.chordMode ? 'chordmode' : ''}">${html}</div>`;
}

function waveHtml(r) {
  const p = r.meta.peaks || [];
  if (!p.length) return `<div class="wave flat" data-a="seek" data-id="${r.id}"></div>`;
  return `<div class="wave" data-a="seek" data-id="${r.id}" data-wave="${r.id}">${p.map(v => `<span style="height:${Math.max(8, v * 100)}%"></span>`).join('')}</div>`;
}
function tSound(s) {
  const recs = store.recsOf(s.id); const beats = s.data.beats || [];
  return `<div class="grid3"><button class="btn pri" data-a="recHere">הקלטה</button>
    <label class="btn" style="cursor:pointer">העלאת קובץ<input type="file" accept="audio/*,.m4a,.mp3,.wav,.aac" class="sr" data-change="upload"></label>
    <button class="btn" data-a="beatLink">קישור לביט</button></div>
  <div class="box">${recs.length ? recs.map(r => {
    const cur = AU.now.recId === r.id, on = cur && !AU.player.paused;
    return `<div class="trk ${cur ? 'cur' : ''}"><div class="trk-top"><button class="key" data-a="play" data-id="${r.id}" aria-label="${on ? 'השהיה' : 'השמעה'}">${on ? I.pause('#FF8A5C') : I.play('#ECEBE7')}</button>
      <span class="grow" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:14px;font-weight:500">${esc(r.meta.name || kindName(r.meta.kind))}</span><span style="font-size:12px;color:var(--mute)">${kindName(r.meta.kind)} · ${dmy(r.meta.date)}</span></span>
      <span class="num" style="font-size:12px;color:var(--mute);font-weight:400">${r.meta.duration ? dur(r.meta.duration) : ''}</span>
      <button class="more" data-a="recMenu" data-id="${r.id}" aria-label="אפשרויות">${I.dots}</button></div>${waveHtml(r)}</div>`;
  }).join('') : '<div class="empty">עוד אין הקלטות לשיר הזה. אפשר להקליט ישר מכאן, או להעלות הקלטה מתזכורות קוליות.</div>'}</div>
  ${beats.length ? `<section><div class="lbl"><span>קישורים לטייפ ביט</span></div><div class="box">${beats.map(b => `<div class="row" style="cursor:default"><span class="grow"><a class="t" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.note || 'טייפ ביט')}</a><span class="m" dir="ltr" style="text-align:right">${esc(b.url)}</span></span><button class="more" data-a="beatDel" data-id="${esc(b.id)}" aria-label="הסרת קישור">${I.x}</button></div>`).join('')}</div></section>` : ''}`;
}

function tState(s) {
  const d = s.data;
  return `<div class="card">
    <div class="field"><label for="ti">שם השיר</label><input class="inp" id="ti" value="${esc(d.title)}" data-change="title"></div>
    <div class="field"><label>מגירה</label><div class="chips">${STAGES.map(st => `<button class="chip ${d.stage === st.k ? 'on' : ''}" data-a="setStage" data-k="${st.k}"><span class="led" style="background:${st.dot}"></span>${st.name}</button>`).join('')}</div></div>
    <div class="field"><div style="display:flex;justify-content:space-between;align-items:baseline"><label for="rv">מוכנות</label><span class="num" id="rvv" style="font-size:22px">${rd(d.readiness)}</span></div>
      <input type="range" id="rv" min="0" max="10" step="0.5" value="${d.readiness ?? 0}" data-input="rv" data-change="readiness">
      <div class="hint">1–5 רעיון · 6 מבנה · 7 בסיס · 8 טקסט, אקורדים ולחן · 9 הפקה מוכנה להקלטה · 10 סקיצה מוקלטת להשמעה</div></div>
    <div class="field"><label>פוטנציאל</label><div class="seg" style="grid-template-columns:repeat(4,minmax(0,1fr))">${POTS.map(p => `<button class="${d.potential === p ? 'on' : ''}" data-a="setPot" data-k="${p}">${p}</button>`).join('')}</div></div>
    <div class="field"><label for="nx">הצעד הבא</label><input class="inp" id="nx" value="${esc(d.next)}" placeholder="מה הדבר הבא שהשיר צריך" data-change="next"></div>
    <div class="field"><label for="nt">הערות</label><textarea class="inp" id="nt" data-change="notes" placeholder="מה אתה חושב על השיר, כיוון, השראה">${esc(d.notes)}</textarea></div>
    <div class="grid2"><button class="btn" data-a="pin" data-id="${s.id}">${d.pinned ? 'ביטול הצמדה' : 'הצמדה לראש'}</button><button class="btn danger" data-a="trash" data-id="${s.id}">העברה לסל</button></div>
  </div>`;
}

function tHist(s) {
  const log = s.data.log || [];
  const v = ui.versions && ui.versions.id === s.id ? ui.versions.list : null;
  return `<section><div class="lbl"><span>גרסאות טקסט</span></div><div class="box">${v == null ? `<button class="row" data-a="loadVersions"><span class="grow"><span class="t">הצגת כל גרסאות הטקסט</span><span class="m">נטען מהכספת</span></span>${I.chev}</button>`
    : v.length ? v.map((x, k) => `<button class="row" data-a="viewVersion" data-k="${k}"><span class="num" style="font-size:12px;width:62px;font-weight:400">${dmy(x.created_at)}</span><span class="grow"><span class="t" style="font-size:14px">${esc(plain(x.lyrics).trim().split('\n')[0] || 'ריק')}</span><span class="m">${hm(x.created_at)} · ${plain(x.lyrics).split(/\s+/).filter(Boolean).length} מילים</span></span>${I.chev}</button>`).join('') : '<div class="empty">עוד אין גרסאות שמורות. גרסה נשמרת בכל פעם שיוצאים משיר אחרי שינוי בטקסט.</div>'}</div></section>
  <section><div class="lbl"><span>יומן שינויים</span></div><div class="box" style="padding:4px 14px">${log.map(l => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line2)"><span class="num" style="font-size:11px;color:var(--mute);width:58px;font-weight:400;flex:0 0 auto">${dmy(l.d)}</span><span style="font-size:14px;flex:1">${esc(l.e)}</span></div>`).join('')}</div></section>`;
}

// ---- הבא בתור ----
function vNext() {
  const list = all().filter(s => s.data.next).sort((a, b) => (b.data.readiness ?? -1) - (a.data.readiness ?? -1));
  return `<div><h1 class="h1">הבא בתור</h1><div class="sub">${list.length} צעדים פתוחים, לפי מוכנות</div></div>
  <div class="box">${list.length ? list.map(s => `<div class="row" style="cursor:default"><button style="all:unset;cursor:pointer;width:24px;height:24px;border-radius:6px;border:2px solid var(--ink);box-sizing:border-box;flex:0 0 auto" data-a="doneNext" data-id="${s.id}" aria-label="סימון כבוצע"></button>
    <span class="grow" data-a="open" data-id="${s.id}" style="cursor:pointer"><span class="t" style="font-size:14px;white-space:normal">${esc(s.data.next)}</span><span class="m">${esc(s.data.title)} · ${stageOf(s.data.stage).name}</span></span><span class="num" style="font-size:14px">${rd(s.data.readiness)}</span></div>`).join('') : '<div class="empty">אין צעדים פתוחים. צעד הבא מוסיפים בלשונית "מצב" של כל שיר.</div>'}</div>`;
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
    if ((d.notes || '').includes(q) || (d.next || '').includes(q)) return { s, hit: 'בהערות' };
    return null;
  }).filter(Boolean).sort((a, b) => (b.s.data.readiness ?? -1) - (a.s.data.readiness ?? -1));
}
function vSearch() {
  return `<h1 class="h1">חיפוש</h1>
  <div><label for="q" class="sr">חיפוש</label><input class="inp" id="q" type="search" value="${esc(ui.q)}" placeholder="שורה שאתה זוכר, שם, מילה" data-input="q" autocomplete="off"></div>
  <div class="chips">${FILTERS.map(f => `<button class="chip ${ui.filters[f[0]] ? 'on' : ''}" data-a="filter" data-k="${f[0]}">${f[1]}</button>`).join('')}</div>
  <div class="box" id="results">${resultsHtml()}</div>`;
}
function resultsHtml() {
  const r = searchResults();
  if (!ui.q.trim() && !Object.values(ui.filters).some(Boolean)) return '<div class="empty">מחפשים בכל השמות, המילים, ההערות והצעדים הבאים.</div>';
  return r.length ? r.slice(0, 80).map(({ s, hit }) => `<button class="row" data-a="open" data-id="${s.id}"><span class="led" style="width:8px;height:8px;background:${stageOf(s.data.stage).dot}"></span><span class="grow"><span class="t">${esc(s.data.title)}</span>${hit ? `<span class="m">${esc(hit)}</span>` : ''}</span><span class="num" style="font-size:14px">${rd(s.data.readiness)}</span></button>`).join('') : '<div class="empty">לא נמצא כלום</div>';
}

// ---- מערכת ----
function vSys() {
  const used = store.storageUsed(), pct = Math.min(100, used / CONFIG.storageLimitBytes * 100);
  const tr = store.trashedSongs().length + store.trashedRecs().length;
  return `<h1 class="h1">מערכת</h1>
  <div style="background:var(--ink);color:var(--bg);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;justify-content:space-between"><span style="font-size:13px">אחסון הקלטות</span><span class="num" style="font-size:13px;font-weight:400">${mb(used)} / 1024 מ״ב</span></div>
    <div class="meter"><span style="width:${pct}%;background:${pct >= 80 ? '#FF5A1F' : '#3DDC84'}"></span></div>
    <span style="font-size:12px;color:var(--soft)">${pct >= 80 ? 'מתקרב למגבלה. כדאי להוריד גיבוי ולפנות הקלטות ישנות מהסל.' : 'התראה תופיע כשתגיע ל־80%'}</span></div>
  <div class="box">
    <div class="row" style="cursor:default"><span class="grow"><span class="t">סנכרון</span><span class="m">${!S.online ? 'אין חיבור. כל שינוי נשמר במכשיר ויעלה כשהחיבור יחזור' : S.pending ? S.pending + ' שינויים בדרך לענן' : 'הכל מגובה בענן' + (S.lastSync ? ' · ' + hm(S.lastSync) : '')}</span></span><button class="tb" data-a="syncNow">סנכרון עכשיו</button></div>
    <button class="row" data-a="backup" data-k="text"><span class="grow"><span class="t">גיבוי מוצפן של הטקסטים</span><span class="m">${ui.lastBackup ? 'גיבוי אחרון: ' + rel(ui.lastBackup) : 'עוד לא נעשה גיבוי'}</span></span>${I.lock}</button>
    <button class="row" data-a="backup" data-k="full"><span class="grow"><span class="t">גיבוי מוצפן מלא, כולל הקלטות</span><span class="m">נפתח רק עם סיסמת הכספת או מפתח השחזור</span></span>${I.lock}</button>
    <label class="row"><span class="grow"><span class="t">שחזור מגיבוי</span><span class="m">מחזיר שירים והקלטות שחסרים. לא דורס שום דבר קיים</span></span>${I.chev}<input type="file" accept=".json,application/json" class="sr" data-change="restore"></label>
    <button class="row" data-a="sysView" data-k="trash"><span class="grow"><span class="t">סל מחזור</span><span class="m">${tr} פריטים · נמחקים לצמיתות אחרי ${CONFIG.trashDays} יום</span></span>${I.chev}</button>
    <label class="row"><span class="grow"><span class="t">ייבוא שירים מקובץ</span><span class="m">חבילת ייבוא או ייצוא של הפתקים</span></span>${I.chev}<input type="file" accept=".json,.txt,application/json,text/plain" class="sr" data-change="import"></label>
  </div>
  <div class="box">
    <button class="row" data-a="${ui.mfaOn ? 'mfaOff' : 'mfaSetup'}"><span class="grow"><span class="t">אימות דו־שלבי</span><span class="m">${ui.mfaOn ? 'פעיל · כניסה דורשת גם קוד מאפליקציית אימות' : 'כבוי · מומלץ להפעיל'}</span></span><span class="led" style="width:9px;height:9px;background:${ui.mfaOn ? 'var(--ok)' : 'var(--acc)'}"></span></button>
    <button class="row" data-a="${ui.pkEnrolled ? 'pkOff' : 'pkSetup'}"><span class="grow"><span class="t">פתיחה בטביעת פנים</span><span class="m">${ui.pkEnrolled ? 'פעיל במכשיר הזה' : 'כבוי · במקום להשאיר את הכספת פתוחה'}</span></span><span class="led" style="width:9px;height:9px;background:${ui.pkEnrolled ? 'var(--ok)' : 'var(--acc)'}"></span></button>
    ${ui.pkEnrolled ? `<button class="row" data-a="autolockSheet"><span class="grow"><span class="t">נעילה אוטומטית</span><span class="m">${ui.autolock === 0 ? 'מיד כשיוצאים מהאפליקציה' : 'אחרי ' + ui.autolock + ' דקות ברקע'}</span></span>${I.chev}</button>` : ''}
    <button class="row" data-a="changePass"><span class="grow"><span class="t">שינוי סיסמת כספת</span></span>${I.chev}</button>
    <button class="row" data-a="newRk"><span class="grow"><span class="t">יצירת מפתח שחזור חדש</span><span class="m">המפתח הקודם יפסיק לעבוד</span></span>${I.chev}</button>
    <button class="row" data-a="lockNow"><span class="grow"><span class="t">נעילה עכשיו</span><span class="m">בפתיחה הבאה תידרש סיסמת הכספת</span></span>${I.lock}</button>
    <button class="row" data-a="signOut"><span class="grow"><span class="t">התנתקות מהמכשיר</span><span class="m">מוחק את העותק המקומי. הכל נשאר בענן</span></span></button>
  </div>
  <p class="hint">${esc((api.currentUser() || {}).email || '')}</p>`;
}
function vTrash() {
  const ts = store.trashedSongs(), trs = store.trashedRecs();
  const left = iso => Math.max(0, Math.ceil(CONFIG.trashDays - daysAgo(iso)));
  return `<div class="hdr" style="align-items:center"><button class="iconbtn" data-a="sysView" data-k="main" aria-label="חזרה">${I.back}</button><span class="h2">סל מחזור</span></div>
  <p class="hint" style="margin:0">פריטים כאן נמחקים לצמיתות אוטומטית אחרי ${CONFIG.trashDays} יום. מחיקה מיידית אפשרית רק מכאן.</p>
  <section><div class="lbl"><span>שירים</span><span>${ts.length}</span></div><div class="box">${ts.length ? ts.map(s => `<div class="row" style="cursor:default"><span class="grow"><span class="t">${esc(s.data.title)}</span><span class="m">עוד ${left(s.deleted_at)} ימים</span></span><button class="tb" data-a="restore" data-id="${s.id}">שחזור</button><button class="tb" style="color:#A3261D" data-a="purge" data-id="${s.id}">מחיקה</button></div>`).join('') : '<div class="empty">ריק</div>'}</div></section>
  <section><div class="lbl"><span>הקלטות</span><span>${trs.length}</span></div><div class="box">${trs.length ? trs.map(r => `<div class="row" style="cursor:default"><span class="grow"><span class="t">${esc(r.meta.name || kindName(r.meta.kind))}</span><span class="m">${esc((song(r.song_id) || { data: { title: '' } }).data.title)} · עוד ${left(r.deleted_at)} ימים</span></span><button class="tb" data-a="recRestore" data-id="${r.id}">שחזור</button><button class="tb" style="color:#A3261D" data-a="recPurge" data-id="${r.id}">מחיקה</button></div>`).join('') : '<div class="empty">ריק</div>'}</div></section>`;
}

// ---------- חלונות צפים ----------
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const QUALS = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'dim', 'add9', '6'];
function chordValue(sh) { return sh.root ? sh.root + sh.q + (sh.bass ? '/' + sh.bass : '') : ''; }
function vSheet() {
  const sh = ui.sheet; let h = '';
  if (sh.type === 'chord') {
    const recent = CH.songChords(song(ui.songId).data.lyrics).slice(0, 10);
    h = `<h3>אקורד מעל "${esc(sh.word || '·')}"</h3>
    <div class="preview" id="chp">${esc(chordValue(sh) || sh.cur || '—')}</div>
    ${recent.length ? `<div><div class="lbl"><span>בשיר הזה</span></div><div class="chips" style="direction:ltr;justify-content:flex-end">${recent.map(c => `<button class="chip" style="font-family:var(--mono);font-weight:700" data-a="chordSet" data-k="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}
    <div><div class="lbl"><span>תו</span></div><div class="keys" style="direction:ltr">${ROOTS.map(r => `<button class="${sh.root === r ? 'on' : ''}" data-a="chRoot" data-k="${r}">${r}</button>`).join('')}</div></div>
    <div><div class="lbl"><span>סוג</span></div><div class="qual" style="direction:ltr">${QUALS.map(q => `<button class="${sh.root && sh.q === q ? 'on' : ''}" data-a="chQ" data-k="${q}">${q || 'מז׳'}</button>`).join('')}</div></div>
    <div><div class="lbl"><span>בס (לא חובה)</span></div><div class="keys" style="direction:ltr">${ROOTS.map(r => `<button class="${sh.bass === r ? 'on' : ''}" data-a="chBass" data-k="${r}">/${r}</button>`).join('')}</div></div>
    <div class="field"><label for="chf">או כתיבה חופשית</label><input class="inp ltr" id="chf" value="${esc(chordValue(sh) || sh.cur || '')}" placeholder="Am7" autocomplete="off" autocapitalize="off"></div>
    <div class="grid3"><button class="btn danger" data-a="chordSet" data-k="">הסרה</button><button class="btn" data-a="closeSheet">ביטול</button><button class="btn pri" data-a="chordOk">שמירה</button></div>`;
  } else if (sh.type === 'newSong') {
    h = `<h3>שיר חדש</h3><form data-form="newSong" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="ns">שם</label><input class="inp" id="ns" name="title" required autocomplete="off"></div>
      <div class="field"><label>מגירה</label><div class="chips">${STAGES.map(st => `<label class="chip"><input type="radio" name="stage" value="${st.k}" ${(sh.stage || 'spark') === st.k ? 'checked' : ''} style="accent-color:var(--acc)"><span class="led" style="background:${st.dot}"></span>${st.name}</label>`).join('')}</div></div>
      <button class="btn pri full" type="submit">יצירה ופתיחה</button></form>`;
  } else if (sh.type === 'move') {
    const s = song(sh.id);
    h = `<h3>להעביר את "${esc(s.data.title)}" ל…</h3><div class="box">${STAGES.map(st => `<button class="row" data-a="moveTo" data-k="${st.k}" data-id="${sh.id}"><span class="led" style="width:8px;height:8px;background:${st.dot}"></span><span class="grow"><span class="t">${st.name}</span></span>${s.data.stage === st.k ? I.check : ''}</button>`).join('')}</div>`;
  } else if (sh.type === 'beat') {
    h = `<h3>קישור לטייפ ביט</h3><form data-form="beat" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="bu">כתובת</label><input class="inp ltr" id="bu" name="url" type="url" placeholder="https://" required></div>
      <div class="field"><label for="bn">תיאור</label><input class="inp" id="bn" name="note" placeholder="למשל: גרסה 2, יותר איטית"></div>
      <button class="btn pri full" type="submit">הוספה</button></form>`;
  } else if (sh.type === 'uploadKind' || sh.type === 'recKind') {
    h = `<h3>${sh.type === 'uploadKind' ? 'מה זה הקובץ הזה?' : 'מה הקלטת עכשיו?'}</h3>
    <div class="field"><label for="rn">שם</label><input class="inp" id="rn" value="${esc(sh.name || '')}"></div>
    <div class="box">${KINDS.map(k => `<button class="row" data-a="${sh.type === 'uploadKind' ? 'uploadAs' : 'recAs'}" data-k="${k.k}"><span class="grow"><span class="t">${k.name}</span></span>${I.chev}</button>`).join('')}</div>`;
  } else if (sh.type === 'recMenu') {
    const r = S.recs.get(sh.id);
    h = `<h3>${esc(r.meta.name || kindName(r.meta.kind))}</h3>
    <div class="field"><label for="rn2">שם</label><input class="inp" id="rn2" value="${esc(r.meta.name || '')}" data-change="recName"></div>
    <div class="field"><label>סוג</label><div class="chips">${KINDS.map(k => `<button class="chip ${r.meta.kind === k.k ? 'on' : ''}" data-a="recKindSet" data-k="${k.k}">${k.name}</button>`).join('')}</div></div>
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
    <div style="display:flex;justify-content:center;background:#fff;border-radius:12px;padding:12px"><img src="${esc(sh.qr)}" alt="קוד לסריקה" width="180" height="180"></div>
    <div class="field"><label>או הקלדה ידנית של המפתח</label><div class="rk" style="font-size:15px">${esc(sh.secret)}</div></div>
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
  return `<div class="overlay" data-a="overlay"><div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>${h}</div></div>`;
}

// ---------- פעולות ----------
const openSheet = sh => { ui.sheet = sh; render(); };
const closeSheet = () => { ui.sheet = null; render(); };
const confirmSheet = (title, text, yes, fn, danger = true) => openSheet({ type: 'confirm', title, text, yes, fn, danger });

async function patchSong(id, patch, logEntry) {
  const s = song(id);
  await store.saveSong(id, Object.assign({}, s.data, patch), { logEntry });
}

async function leaveSong() {
  const s = song(ui.songId);
  if (s && s.data.lyrics !== ui.openLyrics) {
    try { await store.addVersion(s.id, s.data.lyrics, s.data.title); } catch (e) { console.warn(e); }
  }
  ui.editText = false; ui.chordMode = false; ui.versions = null;
}

function openSong(id) {
  ui.nav = 'home'; ui.view = 'song'; ui.songId = id; ui.tab = 'text'; ui.editText = false; ui.chordMode = false; ui.versions = null;
  ui.openLyrics = song(id).data.lyrics; ui.swipeOpen = null;
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
async function saveRecording(blob, mime, kind, name, songId, durationHint) {
  toast('מצפין ומעלה…');
  const a = await AU.analyze(blob);
  let sid = songId;
  if (!sid || !song(sid)) sid = await store.createSong({ title: 'ניצוץ ' + dmy(new Date().toISOString()) + ' ' + hm(new Date().toISOString()), stage: 'spark' });
  await store.addRecording(sid, a.bytes, { kind, name, mime: mime || blob.type || 'audio/mp4', duration: a.duration || durationHint || null, peaks: a.peaks });
  await patchSong(sid, {}, 'נוספה הקלטה: ' + (name || kindName(kind)));
  toast('ההקלטה נשמרה בכספת');
  return sid;
}

let pendingUpload = null;
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
    const go = async () => { AU.player.pause(); AU.now.recId = null; ui.sheet = null; await store.signOutAll(); ui.screen = 'auth'; ui.authMode = 'in'; render(); };
    if (ui.screen !== 'main') return go();
    confirmSheet('להתנתק מהמכשיר?', 'העותק המקומי יימחק מהטלפון. כל השירים וההקלטות נשארים מוצפנים בענן.', 'התנתקות', go);
  },
  async lockNow() { AU.player.pause(); AU.now.recId = null; await store.lock(); ui.screen = 'unlock'; ui.keysRow = await store.vaultState().catch(() => ui.keysRow); render(); },

  nav(d) { if (ui.view === 'song') leaveSong(); ui.nav = d.k; if (d.k === 'home') ui.view = 'dash'; if (d.k === 'sys') ui.sysView = 'main'; ui.sheet = null; render(); if (d.k === 'search') setTimeout(() => { const q = $('#q'); q && q.focus(); }, 50); },
  home() { ui.view = 'dash'; render(); },
  drawer(d) { ui.view = 'drawer'; ui.drawer = d.k; ui.swipeOpen = null; render(); },
  sort(d) { ui.sort = d.k; render(); },
  open(d) { if (ui.view === 'song') leaveSong(); openSong(d.id); },
  async songBack() { const st = song(ui.songId).data.stage; await leaveSong(); ui.view = 'drawer'; ui.drawer = st; render(); },
  tab(d) { ui.tab = d.k; ui.editText = false; ui.chordMode = false; render(); },
  newSong(d) { openSheet({ type: 'newSong', stage: d.stage || (ui.view === 'drawer' ? ui.drawer : 'spark') }); },
  goImport() { ui.nav = 'sys'; ui.sysView = 'main'; render(); toast('בחר "ייבוא שירים מקובץ"'); },

  editText() { ui.editText = !ui.editText; ui.chordMode = false; render(); if (ui.editText) setTimeout(() => { const t = $('#lyr'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30); },
  chordMode() { ui.chordMode = !ui.chordMode; render(); },
  toggleChords() { ui.showChords = !ui.showChords; render(); },
  async transpose(d) { const s = song(ui.songId); if (!CH.songChords(s.data.lyrics).length) return toast('אין אקורדים בשיר'); await patchSong(s.id, { lyrics: CH.transpose(s.data.lyrics, +d.k) }, 'טרנספוזיציה ' + (d.k > 0 ? 'חצי טון למעלה' : 'חצי טון למטה')); render(); },
  insSection() { const t = $('#lyr'); if (!t) return; const pos = t.selectionStart; const ins = (pos && t.value[pos - 1] !== '\n' ? '\n' : '') + '\nפזמון:\n'; t.setRangeText(ins, pos, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); },
  pickChord(d) {
    const s = song(ui.songId); const line = s.data.lyrics.split('\n')[+d.l] || ''; const w = CH.words(line)[+d.w] || {};
    const cur = w.chord || ''; const m = cur.match(/^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/);
    openSheet({ type: 'chord', l: +d.l, w: +d.w, word: w.word, cur, root: m ? m[1] : '', q: m ? (QUALS.includes(m[2]) ? m[2] : '') : '', bass: m && m[3] || '' });
  },
  chRoot(d) { ui.sheet.root = d.k; render(); },
  chQ(d) { if (!ui.sheet.root) return toast('קודם בוחרים תו'); ui.sheet.q = d.k; render(); },
  chBass(d) { ui.sheet.bass = ui.sheet.bass === d.k ? '' : d.k; render(); },
  async chordSet(d) { const sh = ui.sheet; const s = song(ui.songId); ui.sheet = null; await patchSong(s.id, { lyrics: CH.setChord(s.data.lyrics, sh.l, sh.w, d.k) }); render(); },
  async chordOk() {
    const free = ($('#chf') || {}).value || ''; const sh = ui.sheet;
    let c = free.trim() && free.trim() !== (sh.cur || '') ? free.trim().replace(/[\[\]\s]/g, '') : chordValue(sh) || sh.cur;
    const s = song(ui.songId); ui.sheet = null; await patchSong(s.id, { lyrics: CH.setChord(s.data.lyrics, sh.l, sh.w, c) }); render();
  },

  async setStage(d) { const s = song(ui.songId); if (s.data.stage === d.k) return; await patchSong(s.id, { stage: d.k }, 'עבר ממגירת ' + stageOf(s.data.stage).name + ' ל' + stageOf(d.k).name); render(); },
  async setPot(d) { const s = song(ui.songId); await patchSong(s.id, { potential: d.k }, 'פוטנציאל: ' + d.k); render(); },
  async pin(d) { const s = song(d.id); await patchSong(s.id, { pinned: !s.data.pinned }); ui.swipeOpen = null; render(); },
  moveSheet(d) { ui.swipeOpen = null; openSheet({ type: 'move', id: d.id }); },
  async moveTo(d) { const s = song(d.id); ui.sheet = null; if (s.data.stage !== d.k) await patchSong(s.id, { stage: d.k }, 'עבר ממגירת ' + stageOf(s.data.stage).name + ' ל' + stageOf(d.k).name); render(); toast('הועבר ל' + stageOf(d.k).name); },
  async trash(d) {
    const s = song(d.id);
    confirmSheet('להעביר לסל?', '"' + s.data.title + '" יעבור לסל המחזור עם כל ההקלטות שלו, ויימחק לצמיתות אחרי ' + CONFIG.trashDays + ' יום. עד אז אפשר לשחזר.', 'העברה לסל', async () => {
      ui.sheet = null; ui.swipeOpen = null; if (ui.view === 'song' && ui.songId === d.id) { ui.view = 'drawer'; ui.drawer = s.data.stage; }
      await store.trashSong(d.id); render(); toast('הועבר לסל', async () => { await store.restoreSong(d.id); render(); });
    });
  },
  async doneNext(d) { const s = song(d.id); const prev = s.data.next; await patchSong(s.id, { next: '' }, 'בוצע: ' + prev); render(); toast('סומן כבוצע', async () => { await patchSong(s.id, { next: prev }, 'בוטל סימון ביצוע'); render(); }); },
  filter(d) { ui.filters[d.k] = !ui.filters[d.k]; render(); },

  async loadVersions() { try { toast('טוען גרסאות…'); ui.versions = { id: ui.songId, list: await store.versions(ui.songId) }; render(); } catch (e) { fail(e); } },
  viewVersion(d) { openSheet({ type: 'version', k: +d.k }); },
  async restoreVersion(d) { const v = ui.versions.list[+d.k]; const s = song(ui.songId); await store.addVersion(s.id, s.data.lyrics, s.data.title); await patchSong(s.id, { lyrics: v.lyrics }, 'שוחזרה גרסת טקסט מ־' + dmy(v.created_at)); ui.openLyrics = v.lyrics; ui.sheet = null; ui.versions = null; ui.tab = 'text'; render(); toast('הגרסה שוחזרה. הנוכחית נשמרה בהיסטוריה'); },

  recHere() { startRec(ui.songId); },
  rec() { if (AU.isRecording()) return stopRec(); startRec(ui.view === 'song' && ui.nav === 'home' ? ui.songId : null); },
  recStop() { stopRec(); },
  recCancel() { confirmSheet('לבטל את ההקלטה?', 'ההקלטה הנוכחית לא תישמר.', 'ביטול הקלטה', async () => { clearInterval(ui.recTimer); await AU.cancelRecording(); ui.sheet = null; render(); }); },
  async recAs(d) {
    const name = ($('#rn') || {}).value || kindName(d.k); const r = pendingRec; pendingRec = null; ui.sheet = null; render();
    try { const sid = await saveRecording(r.blob, r.mime, d.k, name, ui.recTarget, r.duration); ui.recTarget = null; openSong(sid); ui.tab = 'sound'; render(); }
    catch (e) { fail(e); pendingRec = r; download('הקלטה-' + Date.now() + '.m4a', r.blob); toast('ההעלאה נכשלה. ההקלטה נשמרה כקובץ בטלפון'); }
  },
  async uploadAs(d) {
    const name = ($('#rn') || {}).value || kindName(d.k); const f = pendingUpload; pendingUpload = null; ui.sheet = null; render();
    try { if (f.size > 50 * 1048576) throw new Error('הקובץ גדול מ־50 מ״ב'); await saveRecording(f, f.type, d.k, name, ui.songId); render(); } catch (e) { fail(e); }
  },
  beatLink() { openSheet({ type: 'beat' }); },
  async beatDel(d) { const s = song(ui.songId); const beats = (s.data.beats || []).filter(b => b.id !== d.id); await patchSong(s.id, { beats }, 'הוסר קישור לטייפ ביט'); render(); },
  play(d) { playRec(d.id); },
  async playToggle() { if (AU.player.paused) await AU.player.play().catch(fail); else AU.player.pause(); render(); },
  playStop() { AU.player.pause(); AU.now.recId = null; render(); },
  goPlaying() { if (AU.now.songId && song(AU.now.songId)) { if (ui.view === 'song') leaveSong(); openSong(AU.now.songId); ui.tab = 'sound'; render(); } },
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
  overlay(d, el, ev) { if (ev.target === el && ui.sheet && !['import', 'recKind', 'uploadKind'].includes(ui.sheet.type)) closeSheet(); },
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
  async pass(fd) {
    if (fd.get('q1') !== fd.get('q2')) return toast('הסיסמאות לא תואמות');
    try { const row = await store.vaultState(); await store.unlock(fd.get('op'), row, false); await store.changePassphrase(fd.get('q1'), row); ui.sheet = null; render(); toast('סיסמת הכספת הוחלפה'); }
    catch (e) { fail(e); }
  }
};

// שינויים בשדות
const CHG = {
  async title(el) { const v = el.value.trim(); if (v) await patchSong(ui.songId, { title: v }, 'שם שונה ל"' + v + '"'); },
  async readiness(el) { const s = song(ui.songId); const v = parseFloat(el.value); if (s.data.readiness === v) return; await patchSong(s.id, { readiness: v }, 'מוכנות ' + rd(s.data.readiness) + ' ← ' + rd(v)); render(); },
  async next(el) { await patchSong(ui.songId, { next: el.value.trim() }, el.value.trim() ? 'צעד הבא: ' + el.value.trim() : null); },
  async notes(el) { await patchSong(ui.songId, { notes: el.value }); },
  async recName(el) { await store.updateRecording(ui.sheet.id, { name: el.value.trim() }); },
  async restore(el) {
    const f = el.files && el.files[0]; if (!f) return;
    const text = await f.text();
    try { const r = await store.openBackup(text); openSheet({ type: 'restore', meta: r.meta, payload: r.payload }); }
    catch (e) { if (e.needSecret) openSheet({ type: 'restore', text }); else fail(e); }
  },
  upload(el) { const f = el.files && el.files[0]; if (!f) return; pendingUpload = f; openSheet({ type: 'uploadKind', name: f.name.replace(/\.[^.]+$/, '') }); },
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
const INP = {
  rv(el) { const o = document.getElementById('rvv'); if (o) o.textContent = rd(parseFloat(el.value)); },
  q(el) { ui.q = el.value; const r = document.getElementById('results'); if (r) r.innerHTML = resultsHtml(); }
};

// ---------- אירועים ----------
root.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]');
  if (!el || !root.contains(el)) { if (ui.swipeOpen && !ev.target.closest('.swrap')) { ui.swipeOpen = null; render(); } return; }
  if (el.closest('.swrap') && ui.swipeOpen && el.classList.contains('row')) { ev.preventDefault(); ui.swipeOpen = null; render(); return; }
  if (el.dataset.a === 'overlay' && ev.target !== el) return;
  const fn = A[el.dataset.a];
  if (fn) { if (el.tagName === 'A') return; ev.preventDefault(); Promise.resolve(fn(el.dataset, el, ev)).catch(fail); }
});
root.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form]'); if (!f) return;
  ev.preventDefault(); Promise.resolve(F[f.dataset.form](new FormData(f))).catch(fail);
});
root.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]'); if (!el) return;
  Promise.resolve(CHG[el.dataset.change](el)).catch(fail);
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

// החלקה על שורות
let sw = null;
root.addEventListener('touchstart', ev => { const w = ev.target.closest('.swrap'); if (!w) return; sw = { el: w, x: ev.touches[0].clientX, y: ev.touches[0].clientY, dx: 0, lock: null }; }, { passive: true });
root.addEventListener('touchmove', ev => {
  if (!sw) return; const t = ev.touches[0]; const dx = t.clientX - sw.x, dy = t.clientY - sw.y;
  if (sw.lock == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sw.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (sw.lock !== 'x') return;
  sw.dx = dx; const row = sw.el.querySelector('.row'); const base = sw.el.classList.contains('open') ? 198 : 0;
  row.style.transition = 'none'; row.style.transform = 'translateX(' + Math.max(0, Math.min(220, base + dx)) + 'px)';
}, { passive: true });
root.addEventListener('touchend', () => {
  if (!sw) return; const row = sw.el.querySelector('.row'); row.style.transition = ''; row.style.transform = '';
  if (sw.lock === 'x') { const id = sw.el.dataset.sw; const wasOpen = ui.swipeOpen === id; if (!wasOpen && sw.dx > 50) ui.swipeOpen = id; else if (wasOpen && sw.dx < -40) ui.swipeOpen = null; render(); }
  sw = null;
});

// נגן
AU.player.addEventListener('timeupdate', () => {
  const t = document.getElementById('plt'); if (t) t.textContent = dur(AU.player.currentTime);
  const p = AU.player.duration ? AU.player.currentTime / AU.player.duration : 0;
  const b = document.getElementById('pbar'); if (b) b.style.width = (p * 100) + '%';
  const w = root.querySelector('[data-wave="' + AU.now.recId + '"]');
  if (w) { const sp = w.children; const k = Math.floor(p * sp.length); for (let i = 0; i < sp.length; i++) sp[i].style.background = i < k ? 'var(--acc)' : ''; }
});
['play', 'pause', 'ended'].forEach(e => AU.player.addEventListener(e, () => { if (ui.screen === 'main' && !ui.sheet) render(); }));

function afterRender() {
  const sv = document.getElementById('saved'); if (sv && S.pending && !S.online) sv.textContent = 'נשמר במכשיר';
}

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
  ui.screen = 'main'; ui.err = ''; ui.nav = 'home'; ui.view = 'dash';
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await store.loadLocal();
  render();
  store.sync().then(render).catch(e => { if (e.status === 401) { ui.screen = 'auth'; render(); } });
}
store.onChange(() => { if (ui.screen === 'main' && !ui.sheet && document.activeElement && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) render(); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') { ui.hiddenAt = Date.now(); return; }
  if (!store.isUnlocked()) return;
  if (ui.pkEnrolled && !AU.isRecording() && ui.hiddenAt && Date.now() - ui.hiddenAt >= ui.autolock * 60000) {
    AU.player.pause(); AU.now.recId = null; ui.sheet = null;
    await store.lock(); ui.screen = 'unlock'; render(); return;
  }
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
