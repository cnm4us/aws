import { getPool, type Queryable } from '../../db';
import { ViewerApiError } from '../native-sessions/service';

const columnSpace = `s.type IN ('group','channel') AND LOWER(s.slug) NOT IN ('global','global-feed')
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.global')),'')<>'true'
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.isGlobal')),'')<>'true'
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.feed')),'')<>'global'`;
export async function followingInSpaces(creatorId:number, followerId:number, db:Queryable=getPool()) {
  const [rows]=await db.query(`SELECT EXISTS(SELECT 1 FROM space_user_follows f JOIN spaces s ON s.id=f.space_id
    WHERE f.follower_user_id=? AND f.target_user_id=? AND ${columnSpace}) AS followingInSpaces`,[followerId,creatorId]);
  return !!Number((rows as any[])[0]?.followingInSpaces);
}

export async function getSummary(spaceId: number, creatorId: number, followerId: number, db: Queryable = getPool()) {
  const [rows] = await db.query(`SELECT
    EXISTS(SELECT 1 FROM space_user_follows WHERE space_id=? AND target_user_id=? AND follower_user_id=?) AS following,
    EXISTS(SELECT 1 FROM space_user_follows f JOIN spaces s ON s.id=f.space_id
      WHERE f.follower_user_id=? AND f.target_user_id=? AND f.space_id<>? AND ${columnSpace}) AS followingElsewhere,
    (SELECT COUNT(*) FROM space_user_follows WHERE space_id=? AND target_user_id=?) AS followersCount`,
  [spaceId, creatorId, followerId, followerId, creatorId, spaceId, spaceId, creatorId]);
  const row = (rows as any[])[0], count = Number(row?.followersCount);
  if (!Number.isSafeInteger(count) || count < 0) throw new ViewerApiError(503, 'service_unavailable');
  return { following: !!Number(row.following), followingElsewhere: !!Number(row.followingElsewhere), followersCount: count };
}
export async function setFollowing(spaceId: number, creatorId: number, followerId: number, following: boolean, db: Queryable) {
  if (following) await db.query(`INSERT INTO space_user_follows(follower_user_id,target_user_id,space_id) VALUES(?,?,?)
    ON DUPLICATE KEY UPDATE follower_user_id=VALUES(follower_user_id)`, [followerId, creatorId, spaceId]);
  else await db.query('DELETE FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?', [followerId, creatorId, spaceId]);
}
// Publication lock protects the source; tuple uniqueness also handles concurrent
// desired-state writes reached through different publications by this creator.
export async function transaction<T>(publicationId: number, work: (db: Queryable) => Promise<T>): Promise<T> {
  const db = await getPool().getConnection();
  try {
    await db.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await db.beginTransaction();
    const [rows] = await db.query('SELECT id FROM space_publications WHERE id=? FOR UPDATE', [publicationId]);
    if (!(rows as any[]).length) throw new ViewerApiError(404, 'publication_not_found');
    const result = await work(db); await db.commit(); return result;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
