import { getPool } from '../../db'
import { type Publication, type PublicationEvent } from './types'

// NOTE: This module will hold all SQL for publications and related projections.
// Each function should accept an optional connection/transaction handle.

export async function getById(id: number, _conn?: any): Promise<Publication | null> {
  throw new Error('not_implemented: publications.repo.getById')
}

export async function getByProductionSpace(productionId: number, spaceId: number, _conn?: any): Promise<Publication | null> {
  throw new Error('not_implemented: publications.repo.getByProductionSpace')
}

export async function listByUpload(uploadId: number, _conn?: any): Promise<Publication[]> {
  throw new Error('not_implemented: publications.repo.listByUpload')
}

export async function listByProduction(productionId: number, _conn?: any): Promise<Publication[]> {
  throw new Error('not_implemented: publications.repo.listByProduction')
}

export async function insert(data: any, _txn: any): Promise<Publication> {
  // data includes: uploadId, productionId?, spaceId, status, requestedBy, approvedBy, isPrimary, visibility,
  // distributionFlags, ownerUserId, visibleInSpace, visibleInGlobal, publishedAt?, unpublishedAt?
  throw new Error('not_implemented: publications.repo.insert')
}

export async function updateStatus(id: number, data: any, _txn: any): Promise<Publication> {
  // data includes: status, approvedBy?, publishedAt?, unpublishedAt?
  throw new Error('not_implemented: publications.repo.updateStatus')
}

export async function insertEvent(publicationId: number, actorUserId: number | null, action: string, detail: any | undefined, _txn: any): Promise<void> {
  throw new Error('not_implemented: publications.repo.insertEvent')
}

export async function listEvents(publicationId: number, _conn?: any): Promise<PublicationEvent[]> {
  throw new Error('not_implemented: publications.repo.listEvents')
}

// Projections for dependent rows (space/upload/production) kept small and explicit to reduce coupling.
export async function loadUpload(uploadId: number, conn?: any): Promise<{ id: number; user_id: number | null } | null> {
  const db = conn || getPool()
  const [rows] = await db.query(`SELECT id, user_id FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
  const row = (rows as any[])[0]
  if (!row) return null
  return { id: Number(row.id), user_id: row.user_id == null ? null : Number(row.user_id) }
}

export async function loadProduction(productionId: number, conn?: any): Promise<{ id: number; upload_id: number; user_id: number } | null> {
  const db = conn || getPool()
  const [rows] = await db.query(`SELECT id, upload_id, user_id FROM productions WHERE id = ? LIMIT 1`, [productionId])
  const row = (rows as any[])[0]
  if (!row) return null
  return { id: Number(row.id), upload_id: Number(row.upload_id), user_id: Number(row.user_id) }
}

export async function loadSpace(_spaceId: number, _conn?: any): Promise<any | null> { throw new Error('not_implemented: publications.repo.loadSpace') }

// Minimal projection for listing publications of a production
export async function listPublicationsForProduction(productionId: number, conn?: any): Promise<Array<{
  id: number
  space_id: number
  space_name: string
  space_type: string
  status: string
  published_at: string | null
  unpublished_at: string | null
}>> {
  const db = conn || getPool()
  const [rows] = await db.query(
    `SELECT sp.id, sp.space_id, sp.status, sp.published_at, sp.unpublished_at, s.name AS space_name, s.type AS space_type
       FROM space_publications sp
       JOIN spaces s ON s.id = sp.space_id
      WHERE sp.production_id = ?
      ORDER BY sp.published_at DESC, sp.id DESC`,
    [productionId]
  )
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    space_id: Number(r.space_id),
    space_name: String(r.space_name || ''),
    space_type: String(r.space_type || ''),
    status: String(r.status || ''),
    published_at: r.published_at ? String(r.published_at) : null,
    unpublished_at: r.unpublished_at ? String(r.unpublished_at) : null,
  }))
}

export async function listPublicationsForUpload(uploadId: number, conn?: any): Promise<Array<{
  id: number
  space_id: number
  space_name: string
  space_type: string
  status: string
  published_at: string | null
  unpublished_at: string | null
}>> {
  const db = conn || getPool()
  const [rows] = await db.query(
    `SELECT sp.id, sp.space_id, sp.status, sp.published_at, sp.unpublished_at, s.name AS space_name, s.type AS space_type
       FROM space_publications sp
       JOIN spaces s ON s.id = sp.space_id
      WHERE sp.upload_id = ?
      ORDER BY sp.published_at DESC, sp.id DESC`,
    [uploadId]
  )
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    space_id: Number(r.space_id),
    space_name: String(r.space_name || ''),
    space_type: String(r.space_type || ''),
    status: String(r.status || ''),
    published_at: r.published_at ? String(r.published_at) : null,
    unpublished_at: r.unpublished_at ? String(r.unpublished_at) : null,
  }))
}
