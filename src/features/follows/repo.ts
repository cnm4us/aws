import { getPool } from '../../db'
import { clampLimit } from '../../core/pagination'

export type SpaceUserFollowSummary = {
  following: boolean
  followersCount: number
}

export async function getSummary(spaceId: number, targetUserId: number, followerUserId: number): Promise<SpaceUserFollowSummary> {
  const db = getPool()
  const [rows] = await db.query(
    `
      SELECT
        EXISTS (
          SELECT 1 FROM space_user_follows
          WHERE space_id = ? AND target_user_id = ? AND follower_user_id = ?
        ) AS following,
        (
          SELECT COUNT(*) FROM space_user_follows
          WHERE space_id = ? AND target_user_id = ?
        ) AS followersCount
    `,
    [spaceId, targetUserId, followerUserId, spaceId, targetUserId],
  )
  const row = (rows as any[])[0] || { following: 0, followersCount: 0 }
  return {
    following: Boolean(row.following),
    followersCount: Number(row.followersCount ?? 0),
  }
}

export async function follow(spaceId: number, targetUserId: number, followerUserId: number): Promise<SpaceUserFollowSummary> {
  const db = getPool()
  await db.query(
    `
      INSERT IGNORE INTO space_user_follows (follower_user_id, target_user_id, space_id)
      VALUES (?, ?, ?)
    `,
    [followerUserId, targetUserId, spaceId],
  )
  return getSummary(spaceId, targetUserId, followerUserId)
}

export async function unfollow(spaceId: number, targetUserId: number, followerUserId: number): Promise<SpaceUserFollowSummary> {
  const db = getPool()
  await db.query(
    `
      DELETE FROM space_user_follows
      WHERE follower_user_id = ? AND target_user_id = ? AND space_id = ?
    `,
    [followerUserId, targetUserId, spaceId],
  )
  return getSummary(spaceId, targetUserId, followerUserId)
}

export async function listFollowers(
  spaceId: number,
  targetUserId: number,
  opts: { limit?: number; cursor?: number | null },
) {
  const db = getPool()
  const limit = clampLimit(opts.limit, 50, 1, 200)
  const cursor = opts.cursor ?? null
  const params: any[] = [spaceId, targetUserId]
  const where: string[] = ['space_id = ?', 'target_user_id = ?']
  if (cursor != null) {
    where.push('follower_user_id < ?')
    params.push(cursor)
  }
  const sql = `
    SELECT follower_user_id, created_at
    FROM space_user_follows
    WHERE ${where.join(' AND ')}
    ORDER BY follower_user_id DESC
    LIMIT ?
  `
  params.push(limit + 1)
  const [rows] = await db.query(sql, params)
  const all = rows as any[]
  const items = all.slice(0, limit).map((row) => ({
    userId: Number(row.follower_user_id),
    createdAt: String(row.created_at),
  }))
  const nextCursor = all.length > limit ? Number(all[limit].follower_user_id) : null
  return { items, nextCursor }
}

