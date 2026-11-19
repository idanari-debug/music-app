// אקורדים: שמורים בתוך הטקסט בצורה [Am] לפני המילה שמעליה הם מופיעים.
// כך הם זזים יחד עם המילה כשעורכים, ולא מתפזרים.
export const CHORD_RE = /^[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add|M)?\d*(?:(?:sus|add|maj|b|#)\d+)*(?:\/[A-G](?:#|b)?)?$/;
const SECTION_RE = /^(?:בית|פזמון|גשר|פתיחה|סיום|פרה[ -]?פזמון|פרי[ -]?קורוס|מעבר|אינטרו|אאוטרו|קודה|סולו)(?:\s*[0-9א-ת׳'"]{0,3})?\s*:?$/;

export const isSection = line => {
  const t = line.trim();
  return !!t && (SECTION_RE.test(t) || (/^\[[^\]A-G][^\]]*\]$/.test(t)));
};
export const sectionName = line => line.trim().replace(/^\[|\]$/g, '').replace(/:$/, '');

const isChordToken = t => CHORD_RE.test(t.replace(/[()|]/g, ''));
export function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every(t => isChordToken(t) || t === '-' || t === '|');
}

// מפרק שורה למילים, כל מילה עם האקורד שמעליה (אם יש)
export function words(line) {
  const out = [];
  const parts = line.split(/(\s+)/);
  for (const p of parts) {
    if (!p || /^\s+$/.test(p)) continue;
    const m = p.match(/^((?:\[[^\]]*\])*)(.*)$/);
    const ch = m[1] ? m[1].match(/\[([^\]]*)\]/g).map(x => x.slice(1, -1)).filter(Boolean) : [];
    const rest = m[2].replace(/\[[^\]]*\]/g, '');
    out.push({ chord: ch.join(' '), word: rest });
  }
  return out;
}

export const joinWords = ws => ws.map(w => (w.chord ? w.chord.split(' ').map(c => '[' + c + ']').join('') : '') + w.word).join(' ');

export function setChord(text, lineIdx, wordIdx, chord) {
  const lines = text.split('\n');
  const ws = words(lines[lineIdx] || '');
  if (!ws[wordIdx]) return text;
  ws[wordIdx].chord = chord || '';
  lines[lineIdx] = joinWords(ws);
  return lines.join('\n');
}

// מבנה לתצוגה
export function blocks(text) {
  return (text || '').split('\n').map((line, i) => {
    if (!line.trim()) return { type: 'blank', i };
    if (isSection(line)) return { type: 'section', name: sectionName(line), i };
    return { type: 'line', i, words: words(line) };
  });
}

export function songChords(text) {
  const seen = new Map();
  for (const m of (text || '').matchAll(/\[([^\]]+)\]/g)) if (CHORD_RE.test(m[1])) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

// טרנספוזיציה
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function shiftNote(n, by, useFlat) {
  let i = SHARP.indexOf(n); if (i < 0) i = FLAT.indexOf(n);
  if (i < 0) return n;
  return (useFlat ? FLAT : SHARP)[((i + by) % 12 + 12) % 12];
}
export function transposeChord(c, by) {
  const useFlat = /^[A-G]b/.test(c);
  return c.replace(/^([A-G](?:#|b)?)/, m => shiftNote(m, by, useFlat)).replace(/\/([A-G](?:#|b)?)/, (_, m) => '/' + shiftNote(m, by, useFlat));
}
export function transpose(text, by) {
  return text.replace(/\[([^\]]+)\]/g, (all, c) => CHORD_RE.test(c) ? '[' + transposeChord(c, by) + ']' : all);
}

// המרה מהפורמט הנפוץ: שורת אקורדים מעל שורת מילים.
// כל אקורד מוצמד למילה שנמצאת באותו מיקום בשורה שמתחתיו.
export function convertChordSheet(text) {
  const L = text.replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    if (isChordLine(line) && !/\[/.test(line)) {
      const next = L[i + 1];
      const chords = [];
      const re = /\S+/g; let m;
      while ((m = re.exec(line))) chords.push({ at: m.index, c: m[0].replace(/[()|]/g, '') });
      if (next !== undefined && next.trim() && !isChordLine(next) && !isSection(next)) {
        const spans = []; const wr = /\S+/g; let w;
        while ((w = wr.exec(next))) spans.push({ s: w.index, e: w.index + w[0].length, t: w[0], ch: [] });
        for (const c of chords) {
          if (!isChordToken(c.c)) continue;
          let best = 0, bd = Infinity;
          spans.forEach((sp, k) => { const d = c.at < sp.s ? sp.s - c.at : c.at > sp.e ? c.at - sp.e : 0; if (d < bd) { bd = d; best = k; } });
          if (spans[best]) spans[best].ch.push(c.c);
        }
        out.push(spans.map(sp => sp.ch.map(c => '[' + c + ']').join('') + sp.t).join(' '));
        i++;
      } else {
        out.push(chords.filter(c => isChordToken(c.c)).map(c => '[' + c.c + ']').join(' '));
      }
    } else out.push(line);
  }
  return out.join('\n');
}

export const hasLegacyChordLines = text => (text || '').split('\n').some(l => isChordLine(l) && !/\[/.test(l));
