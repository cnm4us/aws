import { getPool } from '../../db';
import type { SpaceRow } from '../../services/spaceMembership';

export type LaunchCandidate = { publicationId: number; productionId: number; space: SpaceRow };
// Candidate enumeration is deliberately narrower than legacy Jump. Final authority
// and publication visibility come from the ordinary space/feed selectors.
export async function listLaunchCandidates(productionId: number, afterSpaceId: number, limit: number, spaceId?: number, creatorId?: number): Promise<LaunchCandidate[]> {
  const [rows] = await getPool().query(`SELECT sp.id AS publication_id,sp.production_id,
    s.id,s.type,s.owner_user_id,s.name,s.slug,s.settings
    FROM space_publications sp JOIN spaces s ON s.id=sp.space_id JOIN uploads u ON u.id=sp.upload_id
    WHERE sp.production_id=? AND s.id>? AND s.type IN ('group','channel')
      AND sp.status='published' AND sp.visible_in_space=1 AND sp.published_at IS NOT NULL AND u.status='completed'
      ${spaceId === undefined ? '' : 'AND s.id=?'} ${creatorId === undefined ? '' : 'AND u.user_id=?'}
      ORDER BY s.id ASC LIMIT ?`,
    [productionId,afterSpaceId,...(spaceId===undefined?[]:[spaceId]),...(creatorId===undefined?[]:[creatorId]),limit]);
  return (rows as any[]).map(r => ({ publicationId:Number(r.publication_id),productionId:Number(r.production_id),
    space:{id:Number(r.id),type:r.type,owner_user_id:r.owner_user_id === null ? null : Number(r.owner_user_id),name:r.name,slug:r.slug,settings:r.settings} }));
}
