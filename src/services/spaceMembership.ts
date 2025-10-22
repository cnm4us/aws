import { type DB, getPool } from '../db';

export type SpaceType = 'personal' | 'group' | 'channel';

export type SpaceRow = {
  id: number;
  type: SpaceType;
  owner_user_id: number | null;
  name?: string;
  slug?: string;
  settings?: any;
};

// Canonical role names use the space_* prefix
export const MEMBER_ROLES: Record<SpaceType, string[]> = {
  personal: ['space_member', 'space_poster'],
  group: ['space_member'],
  channel: ['space_member'],
};

export const ADMIN_ROLES: Record<SpaceType, string[]> = {
  personal: ['space_member', 'space_poster'],
  group: ['space_admin', 'space_member'],
  channel: ['space_admin', 'space_member'],
};

export function getDefaultMemberRoles(type: SpaceType): string[] {
  return MEMBER_ROLES[type] ? [...MEMBER_ROLES[type]] : [];
}

export function getDefaultAdminRoles(type: SpaceType): string[] {
  return ADMIN_ROLES[type] ? [...ADMIN_ROLES[type]] : [];
}

function ensureDb(db?: DB): DB {
  return db ?? getPool();
}

export async function loadSpace(spaceId: number, db?: DB): Promise<SpaceRow | null> {
  const conn = ensureDb(db);
  const [rows] = await conn.query(
    `SELECT id, type, owner_user_id, name, slug, settings FROM spaces WHERE id = ? LIMIT 1`,
    [spaceId]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    type: String(row.type) as SpaceType,
    owner_user_id: row.owner_user_id != null ? Number(row.owner_user_id) : null,
    name: row.name,
    slug: row.slug,
    settings: row.settings,
  };
}

export async function assignRoles(db: DB, space: SpaceRow, userId: number, roles: string[]): Promise<void> {
  if (!roles.length) return;
  const rolePlaceholders = roles.map(() => '?').join(',');
  await db.query(
    `INSERT IGNORE INTO user_space_roles (user_id, space_id, role_id)
       SELECT ?, ?, r.id FROM roles r WHERE r.name IN (${rolePlaceholders})`,
    [userId, space.id, ...roles]
  );
}

export async function assignDefaultMemberRoles(db: DB, space: SpaceRow, userId: number): Promise<void> {
  const roles = MEMBER_ROLES[space.type] || [];
  await assignRoles(db, space, userId, roles);
}

export async function assignDefaultAdminRoles(db: DB, space: SpaceRow, userId: number): Promise<void> {
  const roles = ADMIN_ROLES[space.type] || [];
  await assignRoles(db, space, userId, roles);
}

export async function isMember(db: DB, spaceId: number, userId: number): Promise<boolean> {
  const [rows] = await db.query(
    `SELECT 1 FROM user_space_roles WHERE space_id = ? AND user_id = ? LIMIT 1`,
    [spaceId, userId]
  );
  return (rows as any[]).length > 0;
}

export async function removeAllRoles(db: DB, spaceId: number, userId: number): Promise<void> {
  await db.query(`DELETE FROM user_space_roles WHERE space_id = ? AND user_id = ?`, [spaceId, userId]);
}

export type SpaceMemberRow = {
  userId: number;
  email: string | null;
  displayName: string | null;
  roles: string[];
};

export async function listSpaceMembers(db: DB, spaceId: number): Promise<SpaceMemberRow[]> {
  const [rows] = await db.query(
    `SELECT u.id, u.email, u.display_name, GROUP_CONCAT(r.name ORDER BY r.name) AS roles
       FROM user_space_roles usr
       JOIN users u ON u.id = usr.user_id
       JOIN roles r ON r.id = usr.role_id
      WHERE usr.space_id = ?
      GROUP BY u.id, u.email, u.display_name
      ORDER BY u.display_name IS NULL, u.display_name`,
    [spaceId]
  );
  // Normalize legacy role names to canonical space_* names for display
  const normalizeRole = (name: string): string | null => {
    const n = String(name || '').toLowerCase();
    if (n === 'group_admin' || n === 'channel_admin' || n === 'space_admin') return 'space_admin';
    if (n === 'group_member' || n === 'channel_member' || n === 'member' || n === 'viewer' || n === 'subscriber' || n === 'uploader' || n === 'space_member') return 'space_member';
    if (n === 'publisher' || n === 'contributor' || n === 'space_poster') return 'space_poster';
    if (n === 'space_moderator' || n === 'moderator') return 'space_moderator';
    if (n === 'space_subscriber') return 'space_subscriber';
    return null;
  };
  const order = ['space_admin','space_moderator','space_member','space_poster','space_subscriber'];
  return (rows as any[]).map((row) => {
    const raw = typeof row.roles === 'string' ? row.roles.split(',') : [];
    const set = new Set<string>();
    raw.forEach((r: string) => { const norm = normalizeRole(r); if (norm) set.add(norm); });
    const roles = order.filter((r) => set.has(r));
    return {
      userId: Number(row.id),
      email: row.email ? String(row.email) : null,
      displayName: row.display_name ? String(row.display_name) : null,
      roles,
    };
  });
}

export type SpaceInvitationRow = {
  userId: number;
  status: string;
  createdAt: string | null;
};

export async function listSpaceInvitations(db: DB, spaceId: number): Promise<SpaceInvitationRow[]> {
  const [rows] = await db.query(
    `SELECT invitee_user_id, status, created_at
       FROM space_invitations
      WHERE space_id = ?
      ORDER BY created_at DESC`,
    [spaceId]
  );
  return (rows as any[]).map((row) => ({
    userId: Number(row.invitee_user_id),
    status: String(row.status),
    createdAt: row.created_at ? String(row.created_at) : null,
  }));
}
