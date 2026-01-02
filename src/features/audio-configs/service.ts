import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { AudioConfigDto, AudioConfigRow, AudioMode, DuckingGate, DuckingMode } from './types'

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function mapRow(row: AudioConfigRow): AudioConfigDto {
  const audioDurationSeconds = row.intro_sfx_seconds != null ? Number(row.intro_sfx_seconds) : null
  const audioFadeEnabled = Boolean(Number(row.intro_sfx_fade_enabled ?? 1))
  const mode = (String(row.mode || 'mix') as AudioMode)
  const duckingModeRaw = String((row as any).ducking_mode ?? '').toLowerCase()
  const duckingMode: DuckingMode =
    duckingModeRaw === 'rolling' || duckingModeRaw === 'abrupt' || duckingModeRaw === 'none'
      ? (duckingModeRaw as DuckingMode)
      : (Number(row.ducking_enabled || 0) ? 'rolling' : 'none')
  const duckingGateRaw = String((row as any).ducking_gate ?? '').toLowerCase()
  const duckingGate: DuckingGate =
    duckingGateRaw === 'sensitive' || duckingGateRaw === 'strict' || duckingGateRaw === 'normal'
      ? (duckingGateRaw as DuckingGate)
      : 'normal'

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    mode,
    videoGainDb: Number(row.video_gain_db ?? 0),
    musicGainDb: Number(row.music_gain_db ?? -18),
    duckingMode: mode === 'mix' ? duckingMode : 'none',
    duckingGate,
    duckingEnabled: mode === 'mix' ? duckingMode !== 'none' : false,
    duckingAmountDb: Number(row.ducking_amount_db ?? 12),
    audioDurationSeconds: audioDurationSeconds != null && Number.isFinite(audioDurationSeconds) ? audioDurationSeconds : null,
    audioFadeEnabled,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

export async function listAvailableForUser(userId: number, params?: { limit?: number }): Promise<AudioConfigDto[]> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listAvailable(params)
  return rows.map(mapRow)
}

export async function getDefaultForUser(userId: number): Promise<AudioConfigDto | null> {
  if (!userId) throw new ForbiddenError()
  const items = await listAvailableForUser(userId, { limit: 500 })
  if (!items.length) return null
  const preferred = items.find((c) => String(c.name || '').trim().toLowerCase() === 'mix (medium)')
  return preferred || items[0] || null
}

const MODES: readonly AudioMode[] = ['replace', 'mix']
const DUCKING_MODES: readonly DuckingMode[] = ['none', 'rolling', 'abrupt']
const DUCKING_GATES: readonly DuckingGate[] = ['sensitive', 'normal', 'strict']

function normalizeName(raw: any): string {
  const name = String(raw ?? '').trim()
  if (!name) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (name.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return name
}

function normalizeDb(raw: any, fallback: number): number {
  const n = raw === '' || raw == null ? fallback : Number(raw)
  if (!Number.isFinite(n)) throw new DomainError('invalid_db', 'invalid_db', 400)
  const rounded = Math.round(n)
  if (rounded < -60 || rounded > 6) throw new DomainError('invalid_db', 'invalid_db', 400)
  return rounded
}

function normalizeSeconds2to20(raw: any, fallback: number): number {
  const n = raw === '' || raw == null ? fallback : Number(raw)
  if (!Number.isFinite(n)) throw new DomainError('invalid_seconds', 'invalid_seconds', 400)
  const rounded = Math.round(n)
  if (rounded < 2 || rounded > 20) throw new DomainError('invalid_seconds', 'invalid_seconds', 400)
  return rounded
}

function normalizeBool(raw: any): boolean {
  if (raw === true) return true
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return false
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true
  return false
}

function ensureOwned(row: AudioConfigRow, userId: number) {
  const ownerId = Number(row.owner_user_id)
  if (ownerId !== Number(userId)) throw new ForbiddenError()
}

export async function ensureDefaultsIfNoneActive(ownerUserId: number): Promise<{ created: boolean }> {
  if (!ownerUserId) throw new ForbiddenError()
  return repo.ensureDefaultsIfNoneActive(Number(ownerUserId))
}

export async function listForOwner(userId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<AudioConfigDto[]> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listByOwner(Number(userId), params)
  return rows.map(mapRow)
}

export async function getForOwner(id: number, userId: number): Promise<AudioConfigDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  return mapRow(row)
}

export async function getActiveForUser(id: number, userId: number): Promise<AudioConfigDto> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  if (row.archived_at) throw new DomainError('archived', 'archived', 400)
  return mapRow(row)
}

export async function createForOwner(input: {
  name: any
  mode: any
  videoGainDb?: any
  musicGainDb?: any
  duckingMode?: any
  duckingGate?: any
  duckingEnabled?: any // legacy
  audioDurationSeconds?: any
  audioFadeEnabled?: any
}, userId: number): Promise<AudioConfigDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  if (!isEnumValue(input.mode, MODES)) throw new DomainError('invalid_mode', 'invalid_mode', 400)
  const mode = input.mode
  const videoGainDb = normalizeDb(input.videoGainDb, 0)
  const musicGainDb = normalizeDb(input.musicGainDb, -18)
  let duckingMode: DuckingMode =
    isEnumValue(input.duckingMode, DUCKING_MODES)
      ? input.duckingMode
      : (normalizeBool(input.duckingEnabled) ? 'rolling' : 'none')
  let duckingGate: DuckingGate =
    isEnumValue(input.duckingGate, DUCKING_GATES)
      ? input.duckingGate
      : 'normal'
  if (mode !== 'mix') duckingMode = 'none'

  const audioDurationSeconds =
    input.audioDurationSeconds === '' || input.audioDurationSeconds == null ? null : normalizeSeconds2to20(input.audioDurationSeconds, 3)
  const audioFadeEnabled = input.audioFadeEnabled === undefined ? true : normalizeBool(input.audioFadeEnabled)

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    mode,
    videoGainDb,
    musicGainDb,
    duckingMode,
    duckingGate,
    duckingAmountDb: 12,
    audioDurationSeconds,
    audioFadeEnabled,
  })
  return mapRow(row)
}

export async function updateForOwner(
  id: number,
  patch: {
    name?: any
    mode?: any
    videoGainDb?: any
    musicGainDb?: any
    duckingMode?: any
    duckingGate?: any
    duckingEnabled?: any // legacy
    audioDurationSeconds?: any
    audioFadeEnabled?: any
  },
  userId: number
): Promise<AudioConfigDto> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  ensureOwned(existing, userId)

  const next: any = {
    name: patch.name !== undefined ? patch.name : existing.name,
    mode: patch.mode !== undefined ? patch.mode : existing.mode,
    videoGainDb: patch.videoGainDb !== undefined ? patch.videoGainDb : existing.video_gain_db,
    musicGainDb: patch.musicGainDb !== undefined ? patch.musicGainDb : existing.music_gain_db,
    duckingMode: patch.duckingMode !== undefined ? patch.duckingMode : (existing as any).ducking_mode,
    duckingGate: patch.duckingGate !== undefined ? patch.duckingGate : (existing as any).ducking_gate,
    duckingEnabled: patch.duckingEnabled !== undefined ? patch.duckingEnabled : existing.ducking_enabled, // legacy fallback
    audioDurationSeconds: patch.audioDurationSeconds !== undefined ? patch.audioDurationSeconds : existing.intro_sfx_seconds,
    audioFadeEnabled: patch.audioFadeEnabled !== undefined ? patch.audioFadeEnabled : existing.intro_sfx_fade_enabled,
  }

  const name = normalizeName(next.name)
  if (!isEnumValue(next.mode, MODES)) throw new DomainError('invalid_mode', 'invalid_mode', 400)
  const mode = next.mode
  const videoGainDb = normalizeDb(next.videoGainDb, 0)
  const musicGainDb = normalizeDb(next.musicGainDb, -18)
  let duckingMode: DuckingMode =
    isEnumValue(next.duckingMode, DUCKING_MODES)
      ? next.duckingMode
      : (normalizeBool(next.duckingEnabled) ? 'rolling' : 'none')
  let duckingGate: DuckingGate =
    isEnumValue(next.duckingGate, DUCKING_GATES)
      ? next.duckingGate
      : 'normal'
  if (mode !== 'mix') duckingMode = 'none'

  const audioDurationSeconds =
    next.audioDurationSeconds === '' || next.audioDurationSeconds == null ? null : normalizeSeconds2to20(next.audioDurationSeconds, 3)
  const audioFadeEnabled = next.audioFadeEnabled === undefined ? true : normalizeBool(next.audioFadeEnabled)

  const row = await repo.update(id, {
    name,
    mode,
    videoGainDb,
    musicGainDb,
    duckingMode,
    duckingGate,
    audioDurationSeconds,
    audioFadeEnabled,
  })
  return mapRow(row)
}

export async function archiveForOwner(id: number, userId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  await repo.archive(id)
  return { ok: true }
}
