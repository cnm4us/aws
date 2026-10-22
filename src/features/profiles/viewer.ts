import { getPool } from '../../db';
import { ViewerApiError } from '../native-sessions/service';
import * as spaces from '../spaces/service';
import { personalSpaceByOwner } from '../spaces/repo';

const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) || null : null;
export function projectCreator(row: any) {
  if (!row || row.deleted_at || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0) return null;
  const visible = Number(row.is_public) === 1;
  let avatarUrl: string | null = null;
  if (visible && typeof row.avatar_url === 'string') try {
    const url = new URL(row.avatar_url);
    if (url.protocol === 'https:' && !url.username && !url.password) avatarUrl = url.toString();
  } catch {}
  return { id: Number(row.id), displayName: (visible ? text(row.display_name, 120) : null) ?? text(row.account_name, 120) ?? 'Creator',
    handle: text(row.slug, 64), avatarUrl, bio: visible && Number(row.show_bio) === 1 ? text(row.bio, 2000) : null };
}

export async function loadCreators(ids: number[]) {
  const unique = [...new Set(ids)].filter(id => Number.isSafeInteger(id) && id > 0);
  if (!unique.length) return new Map<number, NonNullable<ReturnType<typeof projectCreator>>>();
  const [rows] = await getPool().query(`SELECT u.id,u.display_name AS account_name,u.slug,u.deleted_at,
    p.display_name,p.avatar_url,p.bio,p.is_public,p.show_bio FROM users u
    LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id IN (${unique.map(() => '?').join(',')}) AND u.deleted_at IS NULL`, unique);
  return new Map((rows as any[]).map(projectCreator).filter((x): x is NonNullable<typeof x> => x !== null).map(x => [x.id, x]));
}

export async function getCreatorView(userId: number, viewerId: number | null) {
  const creator = (await loadCreators([userId])).get(userId);
  if (!creator) throw new ViewerApiError(404, 'creator_not_found');
  if (!viewerId) return { creator, personalEntry: { state: 'sign_in_required' as const } };
  const personal = await personalSpaceByOwner(userId);
  if (!personal || !await spaces.canViewSpaceFeed(await spaces.loadSpaceOrThrow(Number(personal.id)), viewerId)) {
    return { creator, personalEntry: { state: 'unavailable' as const } };
  }
  return { creator, personalEntry: { state: 'allowed' as const, space: {
    id: Number(personal.id), ulid: personal.ulid || null, name: String(personal.name || ''),
    slug: String(personal.slug || ''), type: 'personal' as const,
  } } };
}
