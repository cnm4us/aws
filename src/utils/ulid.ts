// ULID generator with crypto entropy and a monotonic variant
// 26-char Crockford Base32: 48-bit time (ms) + 80-bit randomness
import crypto from 'crypto'

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const MASK_5 = 31 // 0b11111

function encodeTime(time: number, len: number): string {
  let t = BigInt(time)
  let out = ''
  for (let i = 0; i < len; i++) {
    const mod = Number(t % 32n)
    out = CROCK[mod] + out
    t = t / 32n
  }
  return out
}

function getRandomBytes(n: number): Uint8Array {
  // Node
  try { return crypto.randomBytes(n) } catch {}
  // Browser
  try {
    const arr = new Uint8Array(n)
    ;(globalThis as any).crypto?.getRandomValues?.(arr)
    if (arr[0] || arr.some((v) => v !== 0)) return arr
  } catch {}
  // Fallback (non-crypto) — dev only
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256)
  return out
}

function encodeRandom(len: number): string {
  // Produce len 5-bit values using 80 random bits
  // We map each char from a fresh random 8-bit and mask to 5 bits. Bias is negligible here.
  const bytes = getRandomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) {
    const v = bytes[i] & MASK_5
    out += CROCK[v]
  }
  return out
}

// Public: ULID with optional timestamp
export function ulid(tsMs?: number): string {
  const time = Number.isFinite(tsMs as number) ? (tsMs as number) : Date.now()
  const timePart = encodeTime(time, 10)
  const randPart = encodeRandom(16)
  return timePart + randPart
}

// Monotonic variant (per-process, per-instance)
let lastTimeMs: number | null = null
let lastRand: number[] | null = null // 16 values in 0..31

function freshRand(): number[] {
  const bytes = getRandomBytes(16)
  const arr: number[] = new Array(16)
  for (let i = 0; i < 16; i++) arr[i] = bytes[i] & MASK_5
  return arr
}

function randToString(rand: number[]): string {
  let out = ''
  for (let i = 0; i < rand.length; i++) out += CROCK[rand[i]]
  return out
}

function bumpRand(rand: number[]): boolean {
  // Increment base32 array with carry; returns true if overflowed past highest
  for (let i = rand.length - 1; i >= 0; i--) {
    if (rand[i] < 31) { rand[i] += 1; return false }
    rand[i] = 0
  }
  return true
}

export function ulidMonotonic(tsMs?: number): string {
  const now = Number.isFinite(tsMs as number) ? (tsMs as number) : Date.now()
  if (lastTimeMs == null || now > lastTimeMs) {
    lastTimeMs = now
    lastRand = freshRand()
  } else if (now === lastTimeMs) {
    if (!lastRand) lastRand = freshRand()
    const overflow = bumpRand(lastRand)
    if (overflow) {
      // Advance time by 1 ms to maintain strict monotonicity
      lastTimeMs = now + 1
      lastRand = freshRand()
    }
  } else {
    // Clock went backwards; reset at current time with fresh randomness
    lastTimeMs = now
    lastRand = freshRand()
  }
  const timePart = encodeTime(lastTimeMs, 10)
  const randPart = randToString(lastRand!)
  return timePart + randPart
}

// Utilities
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/ // Crockford Base32 uppercase; excludes I,L,O,U

export function isUlid(id: string): boolean {
  return typeof id === 'string' && ULID_RE.test(id)
}

export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new Error('invalid_ulid')
  // Decode first 10 chars from base32 to a 48-bit integer (ms)
  let t = 0n
  for (let i = 0; i < 10; i++) {
    const ch = id.charAt(i)
    const idx = CROCK.indexOf(ch)
    if (idx < 0) throw new Error('invalid_ulid')
    t = (t << 5n) + BigInt(idx)
  }
  return Number(t)
}

