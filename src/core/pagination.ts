// Lightweight pagination helpers used across services

export type TsIdCursor = { ts: string; id: number }

export function parseTsIdCursor(cursor: unknown): TsIdCursor | null {
  if (typeof cursor !== 'string' || !cursor.length) return null
  const [tsPart, idPart] = cursor.split('|')
  if (!tsPart || !idPart) return null
  const id = Number(idPart)
  if (!Number.isFinite(id) || id <= 0) return null
  return { ts: tsPart, id }
}

export function buildTsIdCursor(ts: string, id: number): string {
  return `${ts}|${id}`
}

export function parseNumberCursor(cursor: unknown): number | null {
  if (typeof cursor === 'number' && Number.isFinite(cursor)) return cursor
  if (typeof cursor !== 'string') return null
  const n = Number(cursor)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function clampLimit(val: unknown, def = 20, min = 1, max = 100): number {
  const n = Number(val ?? def)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}

