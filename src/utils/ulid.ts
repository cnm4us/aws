// Minimal ULID generator (non-monotonic)
// 26-char Crockford Base32: 48-bit time (ms) + 80-bit randomness
const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(time: number, len: number): string {
  let t = BigInt(time);
  let out = '';
  for (let i = 0; i < len; i++) {
    const mod = Number(t % 32n);
    out = CROCK[mod] + out;
    t = t / 32n;
  }
  return out;
}

function encodeRandom(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    const v = Math.floor(Math.random() * 32);
    out += CROCK[v];
  }
  return out;
}

export function ulid(): string {
  const time = Date.now();
  const timePart = encodeTime(time, 10);
  const randPart = encodeRandom(16);
  return timePart + randPart;
}

