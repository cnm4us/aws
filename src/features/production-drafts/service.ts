import { DomainError, ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from '../../core/errors'
import { getPool } from '../../db'
import * as repo from './repo'
import { validateAndNormalizeDraftConfig } from './validate'
import type { ProductionDraftDto, ProductionDraftRow } from './types'

function mapRow(row: ProductionDraftRow): ProductionDraftDto {
  let config: any = {}
  try {
    config = (row as any).config_json
    if (typeof config === 'string') config = JSON.parse(config)
    if (config == null || typeof config !== 'object') config = {}
  } catch {
    config = {}
  }
  return {
    id: Number(row.id),
    uploadId: Number(row.upload_id),
    status: row.status,
    config,
    renderedProductionId: (row as any).rendered_production_id == null ? null : Number((row as any).rendered_production_id),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

async function ensureUserOwnsUpload(userId: number, uploadId: number): Promise<void> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id
       FROM uploads
      WHERE id = ?
        AND (user_id = ? OR user_id IS NULL)
        AND kind = 'video'
      LIMIT 1`,
    [uploadId, userId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('not_found')
}

function normalizeUploadId(raw: any): number {
  const id = Number(raw)
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('invalid_upload_id')
  return id
}

function normalizeDraftId(raw: any): number {
  const id = Number(raw)
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('invalid_draft_id')
  return id
}

function normalizeConfig(raw: any): any {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('invalid_config')
  return raw
}

function ensureOwned(row: ProductionDraftRow, userId: number) {
  const ownerId = Number(row.user_id)
  if (ownerId !== Number(userId)) throw new ForbiddenError()
}

export async function getActiveForUser(uploadIdRaw: any, userId: number): Promise<ProductionDraftDto> {
  if (!userId) throw new ForbiddenError()
  const uploadId = normalizeUploadId(uploadIdRaw)
  await ensureUserOwnsUpload(userId, uploadId)
  const row = await repo.getActiveByUserUpload(userId, uploadId)
  if (!row) throw new NotFoundError('not_found')
  return mapRow(row)
}

export async function createOrGetActiveForUser(uploadIdRaw: any, userId: number): Promise<{ created: boolean; draft: ProductionDraftDto }> {
  if (!userId) throw new ForbiddenError()
  const uploadId = normalizeUploadId(uploadIdRaw)
  await ensureUserOwnsUpload(userId, uploadId)
  const existing = await repo.getActiveByUserUpload(userId, uploadId)
  if (existing) return { created: false, draft: mapRow(existing) }

  try {
    const created = await repo.create({ userId, uploadId, configJson: JSON.stringify({}) })
    return { created: true, draft: mapRow(created) }
  } catch (err: any) {
    // Likely a race: someone created the active draft between our check and insert.
    const reloaded = await repo.getActiveByUserUpload(userId, uploadId)
    if (reloaded) return { created: false, draft: mapRow(reloaded) }
    throw err
  }
}

export async function updateConfigForUser(draftIdRaw: any, configRaw: any, userId: number): Promise<ProductionDraftDto> {
  if (!userId) throw new ForbiddenError()
  const draftId = normalizeDraftId(draftIdRaw)
  const row = await repo.getById(draftId)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  if (row.archived_at) throw new InvalidStateError('archived')

  const config = normalizeConfig(configRaw)
  const normalized = await validateAndNormalizeDraftConfig(Number(row.upload_id), config, { userId })
  const json = JSON.stringify(normalized)
  // Keep payload bounded to avoid accidentally stuffing huge blobs (e.g. base64) into DB.
  if (json.length > 1024 * 1024) throw new DomainError('config_too_large', 'config_too_large', 413)

  const updated = await repo.updateConfig(draftId, json)
  return mapRow(updated)
}

export async function archiveForUser(draftIdRaw: any, userId: number): Promise<{ ok: true }> {
  if (!userId) throw new ForbiddenError()
  const draftId = normalizeDraftId(draftIdRaw)
  const row = await repo.getById(draftId)
  if (!row) throw new NotFoundError('not_found')
  ensureOwned(row, userId)
  await repo.archive(draftId)
  return { ok: true }
}

export async function listActiveForUser(userId: number): Promise<Array<{ id: number; uploadId: number; updatedAt: string }>> {
  if (!userId) throw new ForbiddenError()
  const rows = await repo.listActiveByUser(Number(userId), { limit: 1000 })
  return rows.map((r) => ({
    id: Number(r.id),
    uploadId: Number(r.upload_id),
    updatedAt: String((r as any).updated_at || ''),
  }))
}
