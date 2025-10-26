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
