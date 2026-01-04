import { getPool } from '../../db'

export type UploadRow = any

export async function list(params: { status?: string | string[]; kind?: string; imageRole?: string; isSystem?: boolean | 0 | 1; userId?: number; spaceId?: number; cursorId?: number; limit: number }): Promise<UploadRow[]> {
  const db = getPool()
  const where: string[] = []
  const args: any[] = []
  if (params.status) {
    const statuses = Array.isArray(params.status) ? params.status : [params.status]
    const cleaned = statuses.map((s) => String(s).trim()).filter(Boolean)
    if (cleaned.length === 1) {
      where.push('status = ?')
      args.push(String(cleaned[0]))
    } else if (cleaned.length > 1) {
      where.push(`status IN (${cleaned.map(() => '?').join(', ')})`)
      args.push(...cleaned)
    }
  }
  if (params.kind) { where.push('kind = ?'); args.push(String(params.kind)) }
  if (params.imageRole) { where.push('image_role = ?'); args.push(String(params.imageRole)) }
  if (params.isSystem != null) { where.push('is_system = ?'); args.push(params.isSystem ? 1 : 0) }
  if (params.userId != null) { where.push('user_id = ?'); args.push(Number(params.userId)) }
  if (params.spaceId != null) { where.push('space_id = ?'); args.push(Number(params.spaceId)) }
  if (params.cursorId && Number.isFinite(params.cursorId)) { where.push('id < ?'); args.push(Number(params.cursorId)) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await db.query(`SELECT * FROM uploads ${whereSql} ORDER BY id DESC LIMIT ?`, [...args, Math.min(Math.max(params.limit || 1, 1), 500)])
  return rows as any[]
}

export async function getById(id: number): Promise<UploadRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  return row || null
}

export async function getBasicForPublishOptions(uploadId: number): Promise<{ id: number; user_id: number | null; origin_space_id: number | null } | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id, user_id, origin_space_id FROM uploads WHERE id = ?`, [uploadId])
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    id: Number(row.id),
    user_id: row.user_id == null ? null : Number(row.user_id),
    origin_space_id: row.origin_space_id == null ? null : Number(row.origin_space_id),
  }
}

export async function findPersonalSpaceForOwner(ownerUserId: number): Promise<{ id: number; name: string; slug: string; type: string } | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, name, slug, type FROM spaces WHERE type = 'personal' AND owner_user_id = ? LIMIT 1`,
    [ownerUserId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return { id: Number(row.id), name: String(row.name || ''), slug: String(row.slug || ''), type: String(row.type || '') }
}

export async function listSpacesUserCanPublish(userId: number): Promise<Array<{ id: number; name: string; slug: string; type: string }>> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT s.id, s.name, s.slug, s.type
       FROM spaces s
       JOIN user_space_roles usr ON usr.space_id = s.id
       JOIN roles r ON r.id = usr.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE usr.user_id = ? AND p.name IN ('video:publish_space', 'video:approve_space', 'space:post')
      GROUP BY s.id, s.name, s.slug, s.type
      ORDER BY s.type, s.name`,
    [userId]
  )
  return (rows as any[]).map((row) => ({ id: Number(row.id), name: String(row.name || ''), slug: String(row.slug || ''), type: String(row.type || '') }))
}
