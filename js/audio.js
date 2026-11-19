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

// נגן יחיד
export const player = new Audio();
player.preload = 'auto';
export const now = { recId: null, title: '', song: '' };
