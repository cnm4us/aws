import { getPool, type DB } from '../../db'

function db(conn?: DB) { return conn || getPool() }

export async function fetchSiteCreationFlags(conn?: DB): Promise<{ allowGroupCreation: boolean; allowChannelCreation: boolean } | null> {
  try {
    const [rows] = await db(conn).query(`SELECT allow_group_creation, allow_channel_creation FROM site_settings WHERE id = 1 LIMIT 1`)
    const row = (rows as any[])[0]
    if (!row) return null
    return { allowGroupCreation: Boolean(Number(row.allow_group_creation)), allowChannelCreation: Boolean(Number(row.allow_channel_creation)) }
  } catch { return null }
}

export async function fetchSiteReviewFlags(conn?: DB): Promise<{ requireGroupReview: boolean; requireChannelReview: boolean } | null> {
  try {
    const [rows] = await db(conn).query(`SELECT require_group_review, require_channel_review FROM site_settings WHERE id = 1 LIMIT 1`)
    const row = (rows as any[])[0]
    if (!row) return null
    return { requireGroupReview: Boolean(Number(row.require_group_review)), requireChannelReview: Boolean(Number(row.require_channel_review)) }
  } catch { return null }
}

export async function personalSpaceByOwner(userId: number, conn?: DB): Promise<any | null> {
  const [rows] = await db(conn).query(`SELECT id, name, slug, type FROM spaces WHERE type = 'personal' AND owner_user_id = ? LIMIT 1`, [userId])
  return (rows as any[])[0] || null
}

export async function listGroupMemberships(userId: number, conn?: DB): Promise<any[]> {
  const [rows] = await db(conn).query(
    `SELECT s.id, s.name, s.slug, s.type,
            MAX(CASE WHEN r.name = 'group_admin' THEN 1 ELSE 0 END) AS is_admin
       FROM user_space_roles usr
       JOIN spaces s ON s.id = usr.space_id
       JOIN roles r ON r.id = usr.role_id
      WHERE usr.user_id = ? AND s.type = 'group'
      GROUP BY s.id, s.name, s.slug, s.type
      ORDER BY s.name`,
    [userId]
  )
  return rows as any[]
}

export async function listChannelMemberships(userId: number, conn?: DB): Promise<any[]> {
  const [rows] = await db(conn).query(
    `SELECT s.id, s.name, s.slug, s.type,
            MAX(CASE WHEN r.name = 'channel_admin' THEN 1 ELSE 0 END) AS is_admin
       FROM user_space_roles usr
       JOIN spaces s ON s.id = usr.space_id
       JOIN roles r ON r.id = usr.role_id
      WHERE usr.user_id = ? AND s.type = 'channel'
      GROUP BY s.id, s.name, s.slug, s.type
      ORDER BY s.name`,
    [userId]
  )
  return rows as any[]
}

export async function listChannelSubscriptions(userId: number, conn?: DB): Promise<any[]> {
  const [rows] = await db(conn).query(
    `SELECT s.id, s.name, s.slug, s.type
       FROM space_subscriptions sub
       JOIN spaces s ON s.id = sub.space_id
      WHERE sub.user_id = ? AND sub.status = 'active'`,
    [userId]
  )
  return (rows as any[]).filter((r) => String(r.type) === 'channel')
}

export async function findGlobalSpaceCandidate(conn?: DB): Promise<any | null> {
  const [globalSlugRows] = await db(conn).query(
    `SELECT id, name, slug, type, settings
       FROM spaces
      WHERE slug IN ('global', 'global-feed')
      ORDER BY slug = 'global' DESC
      LIMIT 1`
  )
  const bySlug = (globalSlugRows as any[])[0] || null
  if (bySlug) return bySlug
  const [channelCandidates] = await db(conn).query(`SELECT id, name, slug, type, settings FROM spaces WHERE type = 'channel' LIMIT 50`)
  return (channelCandidates as any[])[0] || null
}

export async function hasActiveSubscription(spaceId: number, userId: number, conn?: DB): Promise<boolean> {
  const [rows] = await db(conn).query(
    `SELECT 1 FROM space_subscriptions WHERE user_id = ? AND space_id = ? AND status = 'active' AND (ended_at IS NULL OR ended_at > NOW()) LIMIT 1`,
    [userId, spaceId]
  )
  return (rows as any[]).length > 0
}

export async function isBannedFromSpace(spaceId: number, userId: number, conn?: DB): Promise<boolean> {
  try {
    const [rows] = await db(conn).query(
      `SELECT 1 FROM suspensions WHERE user_id = ? AND kind = 'ban' AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) AND (target_type = 'site' OR (target_type = 'space' AND target_id = ?)) LIMIT 1`,
      [userId, spaceId]
    )
    return (rows as any[]).length > 0
  } catch { return false }
}

