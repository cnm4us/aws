import { getPool } from '../../db'
import { type CommentDTO, type CommentRow } from './types'

export async function ensurePublicationForComments(pubId: number): Promise<{ id: number; space_id: number; status: string; comments_enabled: number | null } | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id, space_id, status, comments_enabled FROM space_publications WHERE id = ? LIMIT 1`, [pubId])
  const r = (rows as any[])[0]
  if (!r) return null
  return { id: Number(r.id), space_id: Number(r.space_id), status: String(r.status), comments_enabled: r.comments_enabled != null ? Number(r.comments_enabled) : null }
}

export async function incrementCount(pubId: number, delta: number): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE space_publications SET comments_count = GREATEST(comments_count + ?, 0) WHERE id = ?`, [delta, pubId])
}

export async function getCounts(pubId: number): Promise<number> {
  const db = getPool()
  const [[row]]: any = await db.query(`SELECT comments_count AS cnt FROM space_publications WHERE id = ? LIMIT 1`, [pubId])
  return row && row.cnt != null ? Number(row.cnt) : 0
}

export async function createComment(pubId: number, userId: number, body: string, parentId: number | null): Promise<number> {
  const db = getPool()
  const [res] = await db.query(
    `INSERT INTO publication_comments (publication_id, user_id, parent_id, body, status)
       VALUES (?, ?, ?, ?, 'visible')`,
    [pubId, userId, parentId ?? null, body]
  )
  return Number((res as any).insertId)
}

export async function softDeleteComment(id: number): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE publication_comments SET deleted_at = NOW(), status = 'hidden' WHERE id = ?`, [id])
}

export function mapRowToDTO(row: any): CommentDTO {
  return {
    id: Number(row.id),
    publicationId: Number(row.publication_id),
    userId: Number(row.user_id),
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    displayName: row.display_name ? String(row.display_name) : (row.email ? String(row.email) : `User ${row.user_id}`),
    email: row.email != null ? String(row.email) : null,
    body: String(row.body || ''),
    status: String(row.status || 'visible') as any,
    editedAt: row.edited_at ? String(row.edited_at) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
  }
}

export async function listTopLevel(pubId: number, opts: { limit: number; cursor?: { ts: string; id: number } | null; oldestFirst: boolean }): Promise<{ items: CommentDTO[]; nextCursor: string | null }> {
  const db = getPool()
  const params: any[] = [pubId]
  let where = `WHERE pc.publication_id = ? AND pc.parent_id IS NULL AND pc.status = 'visible' AND pc.deleted_at IS NULL`
  let order = `ORDER BY pc.created_at ASC, pc.id ASC`
  if (!opts.oldestFirst) order = `ORDER BY pc.created_at DESC, pc.id DESC`
  if (opts.cursor && opts.cursor.ts) {
    if (opts.oldestFirst) {
      where += ` AND (pc.created_at > ? OR (pc.created_at = ? AND pc.id > ?))`
    } else {
      where += ` AND (pc.created_at < ? OR (pc.created_at = ? AND pc.id < ?))`
    }
    params.push(opts.cursor.ts, opts.cursor.ts, opts.cursor.id)
  }
  const [rows] = await db.query(
    `SELECT pc.*, u.display_name, u.email
       FROM publication_comments pc
       JOIN users u ON u.id = pc.user_id
       ${where}
       ${order}
       LIMIT ?`,
    [...params, opts.limit]
  )
  const items = (rows as any[]).map(mapRowToDTO)
  let nextCursor: string | null = null
  if (items.length === opts.limit) {
    const last = items[items.length - 1]
    nextCursor = `${last.createdAt}|${last.id}`
  }
  return { items, nextCursor }
}

export async function listReplies(pubId: number, parentId: number, opts: { limit: number; cursor?: { ts: string; id: number } | null; oldestFirst: boolean }): Promise<{ items: CommentDTO[]; nextCursor: string | null }> {
  const db = getPool()
  const params: any[] = [pubId, parentId]
  let where = `WHERE pc.publication_id = ? AND pc.parent_id = ? AND pc.status = 'visible' AND pc.deleted_at IS NULL`
  let order = `ORDER BY pc.created_at ASC, pc.id ASC`
  if (!opts.oldestFirst) order = `ORDER BY pc.created_at DESC, pc.id DESC`
  if (opts.cursor && opts.cursor.ts) {
    if (opts.oldestFirst) {
      where += ` AND (pc.created_at > ? OR (pc.created_at = ? AND pc.id > ?))`
    } else {
      where += ` AND (pc.created_at < ? OR (pc.created_at = ? AND pc.id < ?))`
    }
    params.push(opts.cursor.ts, opts.cursor.ts, opts.cursor.id)
  }
  const [rows] = await db.query(
    `SELECT pc.*, u.display_name, u.email
       FROM publication_comments pc
       JOIN users u ON u.id = pc.user_id
       ${where}
       ${order}
       LIMIT ?`,
    [...params, opts.limit]
  )
  const items = (rows as any[]).map(mapRowToDTO)
  let nextCursor: string | null = null
  if (items.length === opts.limit) {
    const last = items[items.length - 1]
    nextCursor = `${last.createdAt}|${last.id}`
  }
  return { items, nextCursor }
}

