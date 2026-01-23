import { getPool } from '../../db'

export async function listFavoriteUploadIdsForUser(userId: number, uploadIds: number[]): Promise<Set<number>> {
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return new Set()
  const ids = Array.isArray(uploadIds) ? uploadIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : []
  const uniq = Array.from(new Set(ids))
  if (!uniq.length) return new Set()
  const db = getPool()
  const placeholders = uniq.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT upload_id
       FROM user_audio_favorites
      WHERE user_id = ?
        AND upload_id IN (${placeholders})`,
    [uid, ...uniq]
  )
  const out = new Set<number>()
  for (const r of rows as any[]) {
    const id = Number(r.upload_id)
    if (Number.isFinite(id) && id > 0) out.add(id)
  }
  return out
}

export async function isFavorite(userId: number, uploadId: number): Promise<boolean> {
  const uid = Number(userId)
  const id = Number(uploadId)
  if (!Number.isFinite(uid) || uid <= 0) return false
  if (!Number.isFinite(id) || id <= 0) return false
  const db = getPool()
  const [rows] = await db.query(
    `SELECT 1 AS ok
       FROM user_audio_favorites
      WHERE user_id = ?
        AND upload_id = ?
      LIMIT 1`,
    [uid, id]
  )
  return (rows as any[]).length > 0
}

export async function setFavorite(userId: number, uploadId: number, favorite: boolean): Promise<void> {
  const uid = Number(userId)
  const id = Number(uploadId)
  if (!Number.isFinite(uid) || uid <= 0) throw new Error('bad_user')
  if (!Number.isFinite(id) || id <= 0) throw new Error('bad_upload')
  const db = getPool()
  if (favorite) {
    await db.query(
      `INSERT IGNORE INTO user_audio_favorites (user_id, upload_id) VALUES (?, ?)`,
      [uid, id]
    )
  } else {
    await db.query(
      `DELETE FROM user_audio_favorites WHERE user_id = ? AND upload_id = ?`,
      [uid, id]
    )
  }
}

