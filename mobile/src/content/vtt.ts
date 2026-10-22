export type Cue = { startMs: number; endMs: number; text: string };
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
function timestamp(raw: string): number | null {
  const m = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(raw);
  if (!m) return null;
  const n = ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
  return Number.isSafeInteger(n) ? n : null;
}
function plain(raw: string) {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '\u200e', rlm: '\u200f', quot: '"', apos: "'" };
  return raw.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|nbsp|lrm|rlm|quot|apos);/gi, (all, value: string) => {
    if (!value.startsWith('#')) return entities[value.toLowerCase()] ?? all;
    const n = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  }).trim();
}
export function parseVtt(source: string, durationSeconds?: number | null): Cue[] {
  if (bytes(source) > 1024 * 1024) throw Error('Captions are too large.');
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t][^\n]*)?\n/.test(normalized + '\n')) throw Error('Captions could not be read.');
  const cues: Cue[] = [];
  for (const block of normalized.split(/\n[ \t]*\n/).slice(1)) {
    const lines = block.trim().split('\n');
    if (/^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(lines[0])) continue;
    const at = lines[0]?.includes('-->') ? 0 : 1;
    const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t].*)?$/.exec(lines[at] || '');
    if (!match) continue;
    const startMs = timestamp(match[1]), endMs = timestamp(match[2]);
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    const text = plain(lines.slice(at + 1).join('\n'));
    if (!text) continue;
    if (bytes(text) > 8192 || cues.length >= 10_000) throw Error('Captions are too large.');
    cues.push({ startMs, endMs, text });
  }
  if (!cues.length) {
    if (normalized.split(/\n[ \t]*\n/).slice(1).some(b => b.trim() && !/^(NOTE|STYLE|REGION)(\s|$)/.test(b.trim())))
      throw Error('Captions could not be read.');
    return [];
  }
  cues.sort((a, b) => a.startMs - b.startMs);
  // One text block: duplicate starts choose the last cue, overlaps stop at the next start.
  const distinct = cues.filter((cue, i) => cue.startMs !== cues[i + 1]?.startMs);
  const duration = durationSeconds && durationSeconds > 0 ? durationSeconds * 1000 : Infinity;
  const output: Cue[] = [];
  distinct.forEach((cue, i) => {
    const last = i === distinct.length - 1;
    const end = Math.min(duration, distinct[i + 1]?.startMs ?? Infinity, Math.max(cue.endMs, cue.startMs + (last ? 1600 : 900)));
    if (end <= cue.startMs) return;
    const previous = output[output.length - 1];
    const micro = cue.text.split(/\s+/).length <= 2 || cue.text.length <= 8;
    if (micro && previous && (cue.startMs - previous.endMs <= 800 || last) && bytes(previous.text + ' ' + cue.text) <= 8192) {
      previous.text += ` ${cue.text}`; previous.endMs = end;
    } else output.push({ ...cue, endMs: end });
  });
  return output;
}
export function cueAt(cues: readonly Cue[], seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = seconds * 1000;
  let low = 0, high = cues.length - 1, selected = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (cues[mid].startMs <= ms) { selected = mid; low = mid + 1; } else high = mid - 1;
  }
  return selected >= 0 && ms < cues[selected].endMs ? cues[selected].text : null;
}
