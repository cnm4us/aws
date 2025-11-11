import { getPool } from '../../db'

export async function ensurePublicationExists(publicationId: number): Promise<{ id: number; status: string } | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id, status FROM space_publications WHERE id = ? LIMIT 1`, [publicationId])
  const r = (rows as any[])[0]
  return r ? { id: Number(r.id), status: String(r.status) } : null
}

export async function getSummary(publicationId: number, userId: number): Promise<{ count: number; liked: boolean }> {
  const db = getPool()
  const [[countRow]]: any = await db.query(`SELECT likes_count AS cnt FROM space_publications WHERE id = ? LIMIT 1`, [publicationId])
  const count = countRow && countRow.cnt != null ? Number(countRow.cnt) : 0
  const [likedRows] = await db.query(`SELECT 1 FROM publication_likes WHERE publication_id = ? AND user_id = ? LIMIT 1`, [publicationId, userId])
  const liked = (likedRows as any[]).length > 0
  return { count, liked }
}

export async function like(publicationId: number, userId: number): Promise<{ inserted: boolean; count: number }> {
  const db = getPool()
  const [ins] = await db.query(`INSERT IGNORE INTO publication_likes (publication_id, user_id) VALUES (?, ?)`, [publicationId, userId])
  const inserted = (ins as any).affectedRows === 1
  if (inserted) {
    await db.query(`UPDATE space_publications SET likes_count = likes_count + 1 WHERE id = ?`, [publicationId])
  }
  const [[countRow]]: any = await db.query(`SELECT likes_count AS cnt FROM space_publications WHERE id = ? LIMIT 1`, [publicationId])
  const count = countRow && countRow.cnt != null ? Number(countRow.cnt) : 0
  return { inserted, count }
}

export async function unlike(publicationId: number, userId: number): Promise<{ deleted: boolean; count: number }> {
  const db = getPool()
  const [del] = await db.query(`DELETE FROM publication_likes WHERE publication_id = ? AND user_id = ?`, [publicationId, userId])
  const deleted = (del as any).affectedRows === 1
  if (deleted) {
    await db.query(`UPDATE space_publications SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = ?`, [publicationId])
  }
  const [[countRow]]: any = await db.query(`SELECT likes_count AS cnt FROM space_publications WHERE id = ? LIMIT 1`, [publicationId])
  const count = countRow && countRow.cnt != null ? Number(countRow.cnt) : 0
  return { deleted, count }
}

export type Liker = { userId: number; displayName: string | null; email: string | null; createdAt: string }

export async function listLikers(
  publicationId: number,
  opts: { limit: number; cursor?: { ts: string; id: number } | null }
): Promise<{ items: Liker[]; nextCursor: string | null }> {
  const db = getPool()
  const params: any[] = [publicationId]
  let where = `WHERE pl.publication_id = ?`
  if (opts.cursor && opts.cursor.ts) {
    // Keyset: created_at DESC, user_id DESC
    where += ` AND (pl.created_at < ? OR (pl.created_at = ? AND pl.user_id < ?))`
    params.push(opts.cursor.ts, opts.cursor.ts, opts.cursor.id)
  }
  const [rows] = await db.query(
    `SELECT pl.user_id, u.display_name, u.email, pl.created_at
       FROM publication_likes pl
       JOIN users u ON u.id = pl.user_id
       ${where}
       ORDER BY pl.created_at DESC, pl.user_id DESC
       LIMIT ?`,
    [...params, opts.limit]
  )
  const items: Liker[] = (rows as any[]).map((r) => ({
    userId: Number(r.user_id),
    displayName: r.display_name != null ? String(r.display_name) : null,
    email: r.email != null ? String(r.email) : null,
    createdAt: String(r.created_at),
  }))
  let nextCursor: string | null = null
  if (items.length === opts.limit) {
    const last = items[items.length - 1]
    nextCursor = `${last.createdAt}|${last.userId}`
  }
  return { items, nextCursor }
}

