// הקלטה, ניתוח צורת גל ונגן אחד לכל האפליקציה.
let mediaRec = null, chunks = [], stream = null, startedAt = 0;

export const canRecord = () => !!(navigator.mediaDevices && window.MediaRecorder);

function pickMime() {
  const opts = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
  return opts.find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
}

export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const mime = pickMime();
  mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
  chunks = [];
  mediaRec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mediaRec.start(1000);
  startedAt = Date.now();
}

export function recordingElapsed() { return mediaRec ? Math.floor((Date.now() - startedAt) / 1000) : 0; }
export const isRecording = () => !!mediaRec;

export function stopRecording() {
  return new Promise(res => {
    if (!mediaRec) return res(null);
    const r = mediaRec;
    r.onstop = () => {
      const type = r.mimeType || 'audio/mp4';
      const blob = new Blob(chunks, { type });
      const duration = (Date.now() - startedAt) / 1000;
      stream.getTracks().forEach(t => t.stop());
      mediaRec = null; stream = null; chunks = [];
      res({ blob, mime: type.split(';')[0], duration });
    };
    r.stop();
  });
}

export async function cancelRecording() { await stopRecording(); }

export async function analyze(blob) {
  const buf = await blob.arrayBuffer();
  let duration = null, peaks = [];
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf.slice(0), res, rej); if (p && p.then) p.then(res, rej); });
    duration = audio.duration;
    const ch = audio.getChannelData(0);
    const N = 72, step = Math.max(1, Math.floor(ch.length / N));
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let j = i * step, e = Math.min(ch.length, (i + 1) * step); j < e; j += 16) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      peaks.push(m);
    }
    const mx = Math.max(0.01, ...peaks);
    peaks = peaks.map(p => Math.round((p / mx) * 100) / 100);
    ctx.close && ctx.close();
  } catch (e) { peaks = []; }
  return { bytes: new Uint8Array(buf), duration, peaks };
}

// ---------- כיווץ במכשיר (לפני ההצפנה) ----------
// קבצים לא מכווצים (ווייב, איף, פלאק) הופכים לקובץ מכווץ באיכות גבוהה בעזרת המקודד של הדפדפן עצמו.
// שום דבר לא יוצא מהמכשיר לפני ההצפנה. אם משהו לא תקין, חוזרים למקור.
const LOSSLESS = /\.(wav|wave|aif|aiff|aifc|flac)$/i;
export const isLossless = f => LOSSLESS.test(f.name || '') || /wav|aiff|flac/i.test(f.type || '');

export async function canCompress() {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try { return !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 256000 })).supported; }
  catch (e) { return false; }
}

// הערכת משך וגודל לפני הבחירה, בלי לפענח את כל הקובץ
export async function estimate(f) {
  let dur = null;
  try {
    if (/\.(wav|wave)$/i.test(f.name || '') || /wav/i.test(f.type || '')) {
      const v = new DataView(await f.slice(0, 65536).arrayBuffer());
      let o = 12, byteRate = 0, dataLen = 0;
      while (o + 8 <= v.byteLength) {
        const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
        const len = v.getUint32(o + 4, true);
        if (id === 'fmt ') byteRate = v.getUint32(o + 16, true);
        if (id === 'data') { dataLen = Math.min(len, f.size - o - 8); break; }
        o += 8 + len + (len & 1);
      }
      if (byteRate) dur = (dataLen || f.size) / byteRate;
    }
  } catch (e) {}
  const ratio = /\.(flac)$/i.test(f.name || '') ? 0.32 : 0.18;
  const small = dur ? Math.round(dur * 256000 / 8 * 1.02) : Math.round(f.size * ratio);
  return { duration: dur, small };
}

const SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
export function adtsWrap(frames, asc) {
  // frames: מערך של מסגרות גולמיות. asc: שני הבתים של הגדרת המקודד
  const prof = asc[0] >> 3, fi = ((asc[0] & 7) << 1) | (asc[1] >> 7), ch = (asc[1] >> 3) & 15;
  let total = 0; for (const f of frames) total += f.length + 7;
  const out = new Uint8Array(total); let o = 0;
  for (const f of frames) {
    const L = f.length + 7;
    out[o] = 0xFF; out[o + 1] = 0xF1;
    out[o + 2] = ((prof - 1) << 6) | (fi << 2) | (ch >> 2);
    out[o + 3] = ((ch & 3) << 6) | (L >> 11);
    out[o + 4] = (L >> 3) & 0xFF;
    out[o + 5] = ((L & 7) << 5) | 0x1F;
    out[o + 6] = 0xFC;
    out.set(f, o + 7); o += L;
  }
  return out;
}

const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);
async function decode(buf) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try { return await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }); }
  finally { ctx.close && ctx.close(); }
}
function peaksOf(audio) {
  const ch = audio.getChannelData(0); const N = 72, step = Math.max(1, Math.floor(ch.length / N)); let peaks = [];
  for (let i = 0; i < N; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, (i + 1) * step); j < e; j += 16) { const v = Math.abs(ch[j]); if (v > m) m = v; } peaks.push(m); }
  const mx = Math.max(0.01, ...peaks); return peaks.map(p => Math.round((p / mx) * 100) / 100);
}

// ---------- כיווץ בזמן אמת: מנוע ההקלטה של הטלפון עצמו ----------
// עובד בכל דפדפן שיודע להקליט (כמו ההקלטות באפליקציה). השיר מתנגן בשקט לתוך המקליט, ולכן זה לוקח כאורך השיר.
const RT_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
export function rtMime() {
  if (!window.MediaRecorder || !(window.AudioContext || window.webkitAudioContext)) return '';
  for (const t of RT_TYPES) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
  return '';
}
export const canRealtime = () => !!rtMime();
export function makeCtx() { const AC = window.AudioContext || window.webkitAudioContext; try { return new AC(); } catch (e) { return null; } }
export async function compressRealtime(file, onProgress, ctx) {
  const mime = rtMime(); if (!mime) throw new Error('no-recorder');
  const own = !ctx; ctx = ctx || makeCtx(); if (!ctx) throw new Error('no-audiocontext');
  try { if (ctx.state === 'suspended') await ctx.resume(); } catch (e) {}
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const audio = await within(new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }), 120000, 'decode-timeout');
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource(); src.buffer = audio; src.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 192000 });
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { rec.onstop = res; });
  rec.start(1000);
  const t0 = ctx.currentTime;
  src.start();
  const tick = setInterval(() => onProgress && onProgress(Math.min(0.99, (ctx.currentTime - t0) / audio.duration), audio.duration - (ctx.currentTime - t0)), 400);
  await new Promise(res => { src.onended = res; });
  clearInterval(tick);
  await new Promise(r => setTimeout(r, 300));
  rec.stop(); await within(done, 20000, 'recorder-stop');
  if (own) { try { ctx.close(); } catch (e) {} }
  try { src.disconnect(); } catch (e) {}
  const type = mime.split(';')[0];
  const blob = new Blob(chunks, { type });
  if (blob.size < 1000) throw new Error('empty-output');
  const check = await within(decode(await blob.arrayBuffer()), 60000, 'verify-timeout');
  if (!check || check.duration < audio.duration * 0.97) throw new Error('verify-short');
  onProgress && onProgress(1, 0);
  return { blob, mime: type, duration: audio.duration, peaks: peaksOf(audio) };
}

export async function compress(file, onProgress) {
  const audio = await within(decode(await file.arrayBuffer()), 120000, 'decode-timeout');
  const sampleRate = audio.sampleRate, nch = Math.min(2, audio.numberOfChannels), total = audio.length;
  const frames = []; let asc = null, err = null;
  const enc = new AudioEncoder({
    output: (chunk, md) => {
      const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
      frames.push(b);
    },
    error: e => { err = e; }
  });
  enc.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: nch, bitrate: nch > 1 ? 256000 : 160000 });
  const planes = []; for (let c = 0; c < nch; c++) planes.push(audio.getChannelData(c));
  const STEP = 8192;
  for (let s = 0; s < total; s += STEP) {
    if (err) throw err;
    const n = Math.min(STEP, total - s);
    const data = new Float32Array(n * nch);
    for (let c = 0; c < nch; c++) data.set(planes[c].subarray(s, s + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: nch, timestamp: Math.round(s / sampleRate * 1e6), data });
    enc.encode(ad); ad.close();
    { const t0 = Date.now(); while (enc.encodeQueueSize > 24) { if (Date.now() - t0 > 20000) throw new Error('encoder-stuck'); await new Promise(r => setTimeout(r, 4)); } }
    if (onProgress && (s / STEP) % 20 === 0) { onProgress(0.9 * s / total); await new Promise(r => setTimeout(r, 0)); }
  }
  await within(enc.flush(), 60000, 'flush-timeout'); try { enc.close(); } catch (e) {}
  onProgress && onProgress(0.95);
  if (err) throw err;
  if (!frames.length) throw new Error('empty');
  // אם הדפדפן כבר עטף את המסגרות, לא עוטפים שוב
  const already = frames[0][0] === 0xFF && (frames[0][1] & 0xF0) === 0xF0;
  // את הגדרות המקודד בונים כאן לבד: בספארי ידוע באג שבו המקודד מחזיר הגדרות שגויות,
  // ואז הקובץ לא נפתח. הערכים ידועים: פרופיל רגיל, קצב הדגימה ומספר הערוצים שביקשנו.
  if (!already) {
    const fi = SR.indexOf(sampleRate); if (fi < 0) throw new Error('rate');
    asc = new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (nch << 3)]);
  }
  let out;
  if (already) { let t = 0; frames.forEach(f => t += f.length); out = new Uint8Array(t); let o = 0; frames.forEach(f => { out.set(f, o); o += f.length; }); }
  else out = adtsWrap(frames, asc);
  // בדיקה: הקובץ החדש חייב להתפענח ולהיות באורך של המקור
  const check = await within(decode(out.buffer.slice(0)), 60000, 'verify-timeout');
  if (!check || Math.abs(check.duration - audio.duration) > Math.max(0.5, audio.duration * 0.02)) throw new Error('verify');
  onProgress && onProgress(1);
  return { blob: new Blob([out], { type: 'audio/aac' }), duration: audio.duration, peaks: peaksOf(audio) };
}

// נגן יחיד
export const player = new Audio();
player.preload = 'auto';
export const now = { recId: null, title: '', song: '' };
