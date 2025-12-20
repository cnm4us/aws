import { getPool } from '../../db'

export type ProfileRow = {
  id: number
  user_id: number
  display_name: string
  avatar_url: string | null
  bio: string | null
  is_public: boolean
  show_bio: boolean
  created_at: string
  updated_at: string
}

export async function getByUserId(userId: number): Promise<ProfileRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM profiles WHERE user_id = ? LIMIT 1`, [userId])
  const row = (rows as any[])[0]
  if (!row) return null
  return mapRow(row)
}

export async function insert(userId: number, input: { displayName: string; avatarUrl?: string | null; bio?: string | null; isPublic?: boolean; showBio?: boolean }): Promise<ProfileRow> {
  const db = getPool()
  const displayName = String(input.displayName || '').trim()
  const avatarUrl = input.avatarUrl != null ? String(input.avatarUrl || '').trim() || null : null
  const bio = input.bio != null ? String(input.bio || '').trim() || null : null
  const isPublic = input.isPublic !== undefined ? !!input.isPublic : true
  const showBio = input.showBio !== undefined ? !!input.showBio : true

  await db.query(
    `INSERT INTO profiles (user_id, display_name, avatar_url, bio, is_public, show_bio)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), avatar_url = VALUES(avatar_url), bio = VALUES(bio), is_public = VALUES(is_public), show_bio = VALUES(show_bio)`,
    [userId, displayName, avatarUrl, bio, isPublic ? 1 : 0, showBio ? 1 : 0]
  )

  const [rows] = await db.query(`SELECT * FROM profiles WHERE user_id = ? LIMIT 1`, [userId])
  const row = (rows as any[])[0]
  return mapRow(row)
}

export async function update(userId: number, input: { displayName?: string; avatarUrl?: string | null; bio?: string | null; isPublic?: boolean; showBio?: boolean }): Promise<ProfileRow | null> {
  const existing = await getByUserId(userId)
  if (!existing) return null

  const db = getPool()
  const displayName = input.displayName !== undefined ? String(input.displayName || '').trim() : existing.display_name
  const avatarUrl =
    input.avatarUrl !== undefined
      ? (input.avatarUrl != null ? String(input.avatarUrl || '').trim() || null : null)
      : existing.avatar_url
  const bio = input.bio !== undefined ? (input.bio != null ? String(input.bio || '').trim() || null : null) : existing.bio
  const isPublic = input.isPublic !== undefined ? !!input.isPublic : existing.is_public
  const showBio = input.showBio !== undefined ? !!input.showBio : existing.show_bio

  await db.query(
    `UPDATE profiles
        SET display_name = ?, avatar_url = ?, bio = ?, is_public = ?, show_bio = ?
      WHERE user_id = ?`,
    [displayName, avatarUrl, bio, isPublic ? 1 : 0, showBio ? 1 : 0, userId]
  )

  const [rows] = await db.query(`SELECT * FROM profiles WHERE user_id = ? LIMIT 1`, [userId])
  const row = (rows as any[])[0]
  return mapRow(row)
}

function mapRow(row: any): ProfileRow {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    display_name: String(row.display_name || ''),
    avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
    bio: row.bio != null ? String(row.bio) : null,
    is_public: Boolean(Number(row.is_public)),
    show_bio: Boolean(Number(row.show_bio)),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

