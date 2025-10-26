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

