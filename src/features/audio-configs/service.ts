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

  const beforeMs = row.opener_cut_fade_before_ms != null ? Number(row.opener_cut_fade_before_ms) : null
  const afterMs = row.opener_cut_fade_after_ms != null ? Number(row.opener_cut_fade_after_ms) : null
  const openerCutFadeBeforeSeconds = beforeMs != null && Number.isFinite(beforeMs) ? Math.max(0, beforeMs / 1000) : null
  const openerCutFadeAfterSeconds = afterMs != null && Number.isFinite(afterMs) ? Math.max(0, afterMs / 1000) : null

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description != null ? String(row.description) : null,
    mode,
    videoGainDb: Number(row.video_gain_db ?? 0),
    musicGainDb: Number(row.music_gain_db ?? -18),
    duckingMode: mode === 'mix' ? duckingMode : 'none',
    duckingGate,
    duckingEnabled: mode === 'mix' ? duckingMode !== 'none' : false,
    duckingAmountDb: Number(row.ducking_amount_db ?? 12),
    audioDurationSeconds: audioDurationSeconds != null && Number.isFinite(audioDurationSeconds) ? audioDurationSeconds : null,
    audioFadeEnabled,
    openerCutFadeBeforeSeconds: mode === 'mix' && duckingMode === 'abrupt' ? openerCutFadeBeforeSeconds : null,
    openerCutFadeAfterSeconds: mode === 'mix' && duckingMode === 'abrupt' ? openerCutFadeAfterSeconds : null,
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

function normalizeDescription(raw: any): string | null {
  const desc = String(raw ?? '').trim()
  if (!desc) return null
  if (desc.length > 2000) throw new DomainError('invalid_description', 'invalid_description', 400)
  return desc
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

const OPENER_CUTOFF_ALLOWED_SECONDS = new Set(['0.5', '1', '1.0', '1.5', '2', '2.0', '2.5', '3', '3.0'])

function normalizeOpenerFadeSeconds(raw: any): number | null {
  if (raw === '' || raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (!OPENER_CUTOFF_ALLOWED_SECONDS.has(s)) throw new DomainError('invalid_opener_cut_fade', 'invalid_opener_cut_fade', 400)
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) throw new DomainError('invalid_opener_cut_fade', 'invalid_opener_cut_fade', 400)
  return Math.round(n * 10) / 10
}

function secondsToMs(seconds: number | null): number | null {
  if (seconds == null) return null
  const ms = Math.round(Number(seconds) * 1000)
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms
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
  description?: any
  mode: any
  videoGainDb?: any
  musicGainDb?: any
  duckingMode?: any
  duckingGate?: any
  duckingEnabled?: any // legacy
  audioDurationSeconds?: any
  audioFadeEnabled?: any
  openerCutFadeBeforeSeconds?: any
  openerCutFadeAfterSeconds?: any
}, userId: number): Promise<AudioConfigDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  const description = normalizeDescription(input.description)
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

  const openerCutFadeBeforeSecondsRaw = normalizeOpenerFadeSeconds(input.openerCutFadeBeforeSeconds)
  const openerCutFadeAfterSecondsRaw = normalizeOpenerFadeSeconds(input.openerCutFadeAfterSeconds)
  const openerCutFadeBeforeSeconds =
    mode === 'mix' && duckingMode === 'abrupt'
      ? (openerCutFadeBeforeSecondsRaw == null && openerCutFadeAfterSecondsRaw == null ? 0.5 : openerCutFadeBeforeSecondsRaw)
      : null
  const openerCutFadeAfterSeconds =
    mode === 'mix' && duckingMode === 'abrupt'
      ? openerCutFadeAfterSecondsRaw
      : null

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    description,
    mode,
    videoGainDb,
    musicGainDb,
    duckingMode,
    duckingGate,
    duckingAmountDb: 12,
    audioDurationSeconds,
    audioFadeEnabled,
    openerCutFadeBeforeMs: secondsToMs(openerCutFadeBeforeSeconds),
    openerCutFadeAfterMs: secondsToMs(openerCutFadeAfterSeconds),
  })
  return mapRow(row)
}

export async function updateForOwner(
  id: number,
  patch: {
    name?: any
    description?: any
    mode?: any
    videoGainDb?: any
    musicGainDb?: any
    duckingMode?: any
    duckingGate?: any
    duckingEnabled?: any // legacy
    audioDurationSeconds?: any
    audioFadeEnabled?: any
    openerCutFadeBeforeSeconds?: any
    openerCutFadeAfterSeconds?: any
  },
  userId: number
): Promise<AudioConfigDto> {
  if (!userId) throw new ForbiddenError()
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  ensureOwned(existing, userId)

  const next: any = {
    name: patch.name !== undefined ? patch.name : existing.name,
    description: patch.description !== undefined ? patch.description : (existing as any).description,
    mode: patch.mode !== undefined ? patch.mode : existing.mode,
    videoGainDb: patch.videoGainDb !== undefined ? patch.videoGainDb : existing.video_gain_db,
    musicGainDb: patch.musicGainDb !== undefined ? patch.musicGainDb : existing.music_gain_db,
    duckingMode: patch.duckingMode !== undefined ? patch.duckingMode : (existing as any).ducking_mode,
    duckingGate: patch.duckingGate !== undefined ? patch.duckingGate : (existing as any).ducking_gate,
    duckingEnabled: patch.duckingEnabled !== undefined ? patch.duckingEnabled : existing.ducking_enabled, // legacy fallback
    audioDurationSeconds: patch.audioDurationSeconds !== undefined ? patch.audioDurationSeconds : existing.intro_sfx_seconds,
    audioFadeEnabled: patch.audioFadeEnabled !== undefined ? patch.audioFadeEnabled : existing.intro_sfx_fade_enabled,
    openerCutFadeBeforeSeconds:
      patch.openerCutFadeBeforeSeconds !== undefined
        ? patch.openerCutFadeBeforeSeconds
        : ((existing as any).opener_cut_fade_before_ms != null ? Number((existing as any).opener_cut_fade_before_ms) / 1000 : ''),
    openerCutFadeAfterSeconds:
      patch.openerCutFadeAfterSeconds !== undefined
        ? patch.openerCutFadeAfterSeconds
        : ((existing as any).opener_cut_fade_after_ms != null ? Number((existing as any).opener_cut_fade_after_ms) / 1000 : ''),
  }

  const name = normalizeName(next.name)
  const description = normalizeDescription(next.description)
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

  const openerCutFadeBeforeSecondsRaw = normalizeOpenerFadeSeconds(next.openerCutFadeBeforeSeconds)
  const openerCutFadeAfterSecondsRaw = normalizeOpenerFadeSeconds(next.openerCutFadeAfterSeconds)
  const openerCutFadeBeforeSeconds =
    mode === 'mix' && duckingMode === 'abrupt'
      ? (openerCutFadeBeforeSecondsRaw == null && openerCutFadeAfterSecondsRaw == null ? 0.5 : openerCutFadeBeforeSecondsRaw)
      : null
  const openerCutFadeAfterSeconds =
    mode === 'mix' && duckingMode === 'abrupt'
      ? openerCutFadeAfterSecondsRaw
      : null

  const row = await repo.update(id, {
    name,
    description,
    mode,
    videoGainDb,
    musicGainDb,
    duckingMode,
    duckingGate,
    audioDurationSeconds,
    audioFadeEnabled,
    openerCutFadeBeforeMs: secondsToMs(openerCutFadeBeforeSeconds),
    openerCutFadeAfterMs: secondsToMs(openerCutFadeAfterSeconds),
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
