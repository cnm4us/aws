import { getPool } from '../../db'

export async function listRoles(): Promise<Array<{ id: number; name: string; scope: string | null; spaceType: string | null }>> {
  const db = getPool()
  try {
    const [rows] = await db.query(`SELECT id, name, scope, space_type FROM roles ORDER BY name`)
    return (rows as any[]).map((r) => ({ id: Number(r.id), name: String(r.name), scope: r.scope || null, spaceType: r.space_type || null }))
  } catch {
    const [rows] = await db.query(`SELECT id, name FROM roles ORDER BY name`)
    return (rows as any[]).map((r) => ({ id: Number(r.id), name: String(r.name), scope: null, spaceType: null }))
  }
}

export async function isSlugTaken(slug: string): Promise<boolean> {
  const db = getPool()
  const [exists] = await db.query(`SELECT id FROM spaces WHERE slug = ? LIMIT 1`, [slug])
  return (exists as any[]).length > 0
}

export async function insertSpace(input: { type: 'group' | 'channel'; ownerUserId: number; name: string; slug: string; settingsJson: string }): Promise<number> {
  const db = getPool()
  const [ins] = await db.query(
    `INSERT INTO spaces (type, owner_user_id, name, slug, settings) VALUES (?, ?, ?, ?, ?)` ,
    [input.type, input.ownerUserId, input.name, input.slug, input.settingsJson]
  )
  return Number((ins as any).insertId)
}

export async function listUsers(params: { search?: string; includeDeleted?: boolean; limit: number; offset: number }): Promise<Array<{ id: number; email: string; display_name: string; created_at: string; updated_at: string | null; deleted_at: string | null }>> {
  const db = getPool()
  const where: string[] = []
  const q: any[] = []
  if (!params.includeDeleted) where.push('deleted_at IS NULL')
  if (params.search) { where.push('(email LIKE ? OR display_name LIKE ?)'); q.push(`%${params.search}%`, `%${params.search}%`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await db.query(
    `SELECT id, email, display_name, created_at, updated_at, deleted_at FROM users ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...q, params.limit, params.offset]
  )
  return rows as any[]
}

export async function insertUser(data: { email: string; passwordHash: string; displayName: string; phoneNumber?: string | null; verificationLevel?: number | null; kycStatus?: string | null; canCreateGroup?: number | null; canCreateChannel?: number | null }): Promise<number> {
  const db = getPool()
  const [ins] = await db.query(
    `INSERT INTO users (email, password_hash, display_name, phone_number, verification_level, kyc_status, can_create_group, can_create_channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.email, data.passwordHash, data.displayName, data.phoneNumber ?? null, data.verificationLevel ?? null, data.kycStatus ?? 'none', data.canCreateGroup ?? null, data.canCreateChannel ?? null]
  )
  return Number((ins as any).insertId)
}

export async function insertPersonalSpaceForUser(userId: number, name: string, slug: string): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO spaces (type, owner_user_id, name, slug, settings) VALUES ('personal', ?, ?, ?, ?)` ,
    [userId, name, slug, JSON.stringify({ visibility: 'public', membership: 'none', publishing: 'owner_only', moderation: 'none', follow_enabled: true })]
  )
}

export async function listUserSiteRoleNames(userId: number): Promise<string[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND (r.scope = 'site' OR r.name LIKE 'site\\_%')
      ORDER BY r.name`,
    [userId]
  )
  return (rows as any[]).map((r) => String(r.name))
}

export async function deleteAllUserSiteRoles(userId: number): Promise<void> {
  const db = getPool()
  await db.query(`DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND (r.scope = 'site' OR r.name LIKE 'site\\_%')`, [userId])
}

export async function getSiteRoleIdsByNames(names: string[]): Promise<Map<string, number>> {
  const db = getPool()
  if (!names.length) return new Map()
  const placeholders = names.map(() => '?').join(',')
  const [rows] = await db.query(`SELECT id, name FROM roles WHERE (scope = 'site' OR name LIKE 'site\\_%') AND name IN (${placeholders})`, names)
  const map = new Map<string, number>()
  for (const r of rows as any[]) map.set(String(r.name), Number(r.id))
  return map
}

export async function insertUserRoles(userId: number, roleIds: number[]): Promise<void> {
  const db = getPool()
  for (const rid of roleIds) {
    await db.query(`INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [userId, rid])
  }
}

export async function getUserRow(userId: number): Promise<any | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, email, display_name, org_id, email_verified_at, phone_number, phone_verified_at,
            verification_level, kyc_status, can_create_group, can_create_channel, created_at, updated_at, deleted_at
       FROM users WHERE id = ? LIMIT 1`,
    [userId]
  )
  return (rows as any[])[0] || null
}

export async function updateUser(userId: number, fields: Record<string, any>): Promise<number> {
  const db = getPool()
  const entries = Object.entries(fields)
  if (!entries.length) return 0
  const sets: string[] = []
  const params: any[] = []
  for (const [k, v] of entries) { sets.push(`${k} = ?`); params.push(v) }
  const [result] = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, userId])
  return Number((result as any).affectedRows || 0)
}

export async function softDeleteUser(userId: number): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE users SET deleted_at = NOW() WHERE id = ?`, [userId])
}

export async function readSiteSettings(): Promise<{
  allow_group_creation: any
  allow_channel_creation: any
  require_group_review: any
  require_channel_review: any
} | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT allow_group_creation, allow_channel_creation, require_group_review, require_channel_review FROM site_settings WHERE id = 1 LIMIT 1`)
  const row = (rows as any[])[0]
  return row || null
}

export async function updateSiteSettings(flags: { allowGroupCreation: boolean; allowChannelCreation: boolean; requireGroupReview: boolean; requireChannelReview: boolean }): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE site_settings SET allow_group_creation = ?, allow_channel_creation = ?, require_group_review = ?, require_channel_review = ? WHERE id = 1`,
    [flags.allowGroupCreation ? 1 : 0, flags.allowChannelCreation ? 1 : 0, flags.requireGroupReview ? 1 : 0, flags.requireChannelReview ? 1 : 0]
  )
}

export async function listSpaces(type?: 'group' | 'channel'): Promise<Array<{ id: number; type: string; name: string; slug: string; owner_user_id: number | null; owner_display_name: string | null }>> {
  const db = getPool()
  let sql = `SELECT s.id, s.type, s.name, s.slug, s.owner_user_id, u.display_name AS owner_display_name FROM spaces s LEFT JOIN users u ON u.id = s.owner_user_id WHERE s.type IN ('group','channel')`
  const params: any[] = []
  if (type && (type === 'group' || type === 'channel')) { sql += ` AND s.type = ?`; params.push(type) }
  sql += ` ORDER BY s.type, s.name`
  const [rows] = await db.query(sql, params)
  return rows as any[]
}

export async function getSpace(spaceId: number): Promise<{ id: number; type: string; owner_user_id: number | null; name: string; slug: string; settings: any } | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT id, type, owner_user_id, name, slug, settings FROM spaces WHERE id = ? LIMIT 1`, [spaceId])
  const s = (rows as any[])[0]
  if (!s) return null
  return { id: Number(s.id), type: String(s.type), owner_user_id: s.owner_user_id != null ? Number(s.owner_user_id) : null, name: s.name, slug: s.slug, settings: s.settings }
}

export async function updateSpace(spaceId: number, fields: { name?: string; settingsJson?: string }): Promise<number> {
  const db = getPool()
  const sets: string[] = []
  const params: any[] = []
  if (fields.name) { sets.push('name = ?'); params.push(fields.name) }
  if (fields.settingsJson !== undefined) { sets.push('settings = ?'); params.push(fields.settingsJson) }
  if (!sets.length) return 0
  params.push(spaceId)
  const [result] = await db.query(`UPDATE spaces SET ${sets.join(', ')} WHERE id = ?`, params)
  return Number((result as any).affectedRows || 0)
}

export async function getSpaceUserRoleNames(spaceId: number, userId: number): Promise<string[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT r.name FROM user_space_roles usr JOIN roles r ON r.id = usr.role_id WHERE usr.space_id = ? AND usr.user_id = ? ORDER BY r.name`,
    [spaceId, userId]
  )
  return (rows as any[]).map((r) => String(r.name))
}
