import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { getPool } from '../../db'
import * as repo from './repo'
import type { AudioConfigDto, AudioConfigRow, AudioMode } from './types'

function isEnumValue<T extends string>(value: any, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function mapRow(row: AudioConfigRow): AudioConfigDto {
  const introUploadId = row.intro_sfx_upload_id != null ? Number(row.intro_sfx_upload_id) : null
  const introSeconds = row.intro_sfx_seconds != null ? Number(row.intro_sfx_seconds) : null
  const introGainDb = Number(row.intro_sfx_gain_db ?? 0)
  const introFadeEnabled = Boolean(Number(row.intro_sfx_fade_enabled ?? 1))
  const introDuckEnabled = Boolean(Number(row.intro_sfx_ducking_enabled ?? 0))
  const introDuckAmt = Number(row.intro_sfx_ducking_amount_db ?? 12)

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    mode: (String(row.mode || 'mix') as AudioMode),
    videoGainDb: Number(row.video_gain_db ?? 0),
    musicGainDb: Number(row.music_gain_db ?? -18),
    duckingEnabled: Boolean(Number(row.ducking_enabled || 0)),
    duckingAmountDb: Number(row.ducking_amount_db ?? 12),
    introSfx: introUploadId
      ? {
          uploadId: introUploadId,
          seconds: introSeconds != null && Number.isFinite(introSeconds) ? introSeconds : 3,
          gainDb: Number.isFinite(introGainDb) ? introGainDb : 0,
          fadeEnabled: introFadeEnabled,
          duckingEnabled: introDuckEnabled,
          duckingAmountDb: Number.isFinite(introDuckAmt) ? introDuckAmt : 12,
        }
      : null,
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

function normalizeSeconds2to5(raw: any, fallback: number): number {
  const n = raw === '' || raw == null ? fallback : Number(raw)
  if (!Number.isFinite(n)) throw new DomainError('invalid_seconds', 'invalid_seconds', 400)
  const rounded = Math.round(n)
  if (rounded < 2 || rounded > 5) throw new DomainError('invalid_seconds', 'invalid_seconds', 400)
  return rounded
}

function normalizeBool(raw: any): boolean {
  if (raw === true) return true
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return false
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true
  return false
}

async function validateSystemAudioUploadOrThrow(uploadId: number) {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, kind, is_system, status
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('invalid_intro_sfx_upload', 'invalid_intro_sfx_upload', 400)
  if (String(row.kind || '').toLowerCase() !== 'audio') throw new DomainError('invalid_intro_sfx_upload', 'invalid_intro_sfx_upload', 400)
  if (!Number(row.is_system || 0)) throw new DomainError('invalid_intro_sfx_upload', 'invalid_intro_sfx_upload', 400)
  const st = String(row.status || '').toLowerCase()
  if (st !== 'uploaded' && st !== 'completed') throw new DomainError('invalid_intro_sfx_upload', 'invalid_intro_sfx_upload', 400)
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
  duckingEnabled?: any
  introSfxUploadId?: any
  introSfxSeconds?: any
  introSfxGainDb?: any
  introSfxFadeEnabled?: any
  introSfxDuckingEnabled?: any
}, userId: number): Promise<AudioConfigDto> {
  if (!userId) throw new ForbiddenError()
  const name = normalizeName(input.name)
  if (!isEnumValue(input.mode, MODES)) throw new DomainError('invalid_mode', 'invalid_mode', 400)
  const mode = input.mode
  const videoGainDb = normalizeDb(input.videoGainDb, 0)
  const musicGainDb = normalizeDb(input.musicGainDb, -18)
  let duckingEnabled = normalizeBool(input.duckingEnabled)
  if (mode !== 'mix') duckingEnabled = false

  // Plan 34: optional intro SFX overlay. If set, it must be a system audio upload.
  const introSfxUploadIdRaw = input.introSfxUploadId === '' || input.introSfxUploadId == null ? null : Number(input.introSfxUploadId)
  const introSfxUploadId = introSfxUploadIdRaw != null && Number.isFinite(introSfxUploadIdRaw) && introSfxUploadIdRaw > 0 ? introSfxUploadIdRaw : null
  const introSfxSeconds = introSfxUploadId ? normalizeSeconds2to5(input.introSfxSeconds, 3) : null
  const introSfxGainDb = introSfxUploadId ? normalizeDb(input.introSfxGainDb, 0) : 0
  const introSfxFadeEnabled = introSfxUploadId ? (input.introSfxFadeEnabled === undefined ? true : normalizeBool(input.introSfxFadeEnabled)) : true
  const introSfxDuckingEnabled = introSfxUploadId ? normalizeBool(input.introSfxDuckingEnabled) : false
  if (introSfxUploadId) await validateSystemAudioUploadOrThrow(introSfxUploadId)

  const row = await repo.create({
    ownerUserId: Number(userId),
    name,
    mode,
    videoGainDb,
    musicGainDb,
    duckingEnabled,
    duckingAmountDb: 12,
    introSfxUploadId,
    introSfxSeconds,
    introSfxGainDb,
    introSfxFadeEnabled,
    introSfxDuckingEnabled,
    introSfxDuckingAmountDb: 12,
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
    duckingEnabled?: any
    introSfxUploadId?: any
    introSfxSeconds?: any
    introSfxGainDb?: any
    introSfxFadeEnabled?: any
    introSfxDuckingEnabled?: any
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
    duckingEnabled: patch.duckingEnabled !== undefined ? patch.duckingEnabled : existing.ducking_enabled,
    introSfxUploadId: patch.introSfxUploadId !== undefined ? patch.introSfxUploadId : existing.intro_sfx_upload_id,
    introSfxSeconds: patch.introSfxSeconds !== undefined ? patch.introSfxSeconds : existing.intro_sfx_seconds,
    introSfxGainDb: patch.introSfxGainDb !== undefined ? patch.introSfxGainDb : existing.intro_sfx_gain_db,
    introSfxFadeEnabled: patch.introSfxFadeEnabled !== undefined ? patch.introSfxFadeEnabled : existing.intro_sfx_fade_enabled,
    introSfxDuckingEnabled: patch.introSfxDuckingEnabled !== undefined ? patch.introSfxDuckingEnabled : existing.intro_sfx_ducking_enabled,
  }

  const name = normalizeName(next.name)
  if (!isEnumValue(next.mode, MODES)) throw new DomainError('invalid_mode', 'invalid_mode', 400)
  const mode = next.mode
  const videoGainDb = normalizeDb(next.videoGainDb, 0)
  const musicGainDb = normalizeDb(next.musicGainDb, -18)
  let duckingEnabled = normalizeBool(next.duckingEnabled)
  if (mode !== 'mix') duckingEnabled = false

  const introSfxUploadIdRaw = next.introSfxUploadId === '' || next.introSfxUploadId == null ? null : Number(next.introSfxUploadId)
  const introSfxUploadId = introSfxUploadIdRaw != null && Number.isFinite(introSfxUploadIdRaw) && introSfxUploadIdRaw > 0 ? introSfxUploadIdRaw : null
  const introSfxSeconds = introSfxUploadId ? normalizeSeconds2to5(next.introSfxSeconds, 3) : null
  const introSfxGainDb = introSfxUploadId ? normalizeDb(next.introSfxGainDb, 0) : 0
  const introSfxFadeEnabled = introSfxUploadId ? (next.introSfxFadeEnabled === undefined ? true : normalizeBool(next.introSfxFadeEnabled)) : true
  const introSfxDuckingEnabled = introSfxUploadId ? normalizeBool(next.introSfxDuckingEnabled) : false
  if (introSfxUploadId) await validateSystemAudioUploadOrThrow(introSfxUploadId)

  const row = await repo.update(id, {
    name,
    mode,
    videoGainDb,
    musicGainDb,
    duckingEnabled,
    introSfxUploadId,
    introSfxSeconds,
    introSfxGainDb,
    introSfxFadeEnabled,
    introSfxDuckingEnabled,
    introSfxDuckingAmountDb: 12,
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
