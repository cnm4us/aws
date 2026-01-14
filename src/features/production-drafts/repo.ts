import { getPool } from '../../db'
import type { ProductionDraftRow, ProductionDraftStatus } from './types'

export async function listActiveByUser(userId: number, params?: { limit?: number }): Promise<ProductionDraftRow[]> {
  const db = getPool()
  const limit = Math.min(Math.max(Number(params?.limit ?? 500), 1), 1000)
  const [rows] = await db.query(
    `SELECT *
       FROM production_drafts
      WHERE user_id = ?
        AND archived_at IS NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT ?`,
    [userId, limit]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<ProductionDraftRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM production_drafts WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  return row || null
}

export async function getActiveByUserUpload(userId: number, uploadId: number): Promise<ProductionDraftRow | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT *
       FROM production_drafts
      WHERE user_id = ?
        AND upload_id = ?
        AND archived_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [userId, uploadId]
  )
  const row = (rows as any[])[0]
  return row || null
}

export async function create(input: { userId: number; uploadId: number; configJson: string }): Promise<ProductionDraftRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO production_drafts (user_id, upload_id, status, config_json)
     VALUES (?, ?, 'active', ?)`,
    [input.userId, input.uploadId, input.configJson]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_production_draft')
  return row
}

export async function updateConfig(id: number, configJson: string): Promise<ProductionDraftRow> {
  const db = getPool()
  await db.query(`UPDATE production_drafts SET config_json = ? WHERE id = ?`, [configJson, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function archive(id: number): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE production_drafts
        SET status = 'archived',
            archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
      WHERE id = ?`,
    [id]
  )
}

export async function setStatus(id: number, status: ProductionDraftStatus): Promise<void> {
  const db = getPool()
  if (status === 'archived') return archive(id)
  await db.query(`UPDATE production_drafts SET status = ?, archived_at = NULL WHERE id = ?`, [status, id])
}
