import { getPool } from '../db';
import { PERM } from './perm'

// Widen to string so we can evolve permissions without chasing union types everywhere
export type Permission = string;

export type PermissionContext = {
  ownerId?: number | null;
  spaceId?: number | null;
};

export type PermissionChecker = {
  hasGlobalPermission(permission: Permission): Promise<boolean>;
  hasSpacePermission(spaceId: number, permission: Permission): Promise<boolean>;
};

export type CanOptions = PermissionContext & {
  checker?: PermissionChecker;
};

export async function resolveChecker(userId: number): Promise<PermissionChecker> {
  const db = getPool();
  const [globalRows] = await db.query(
    `SELECT p.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?`,
    [userId]
  );
  const globalPerms = new Set<string>((globalRows as any[]).map((r) => String(r.name)));

  const [spaceRows] = await db.query(
    `SELECT usr.space_id, p.name
       FROM user_space_roles usr
       JOIN roles r ON r.id = usr.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE usr.user_id = ?`,
    [userId]
  );

  const spacePerms = new Map<number, Set<string>>();
  for (const row of spaceRows as any[]) {
    const spaceId = Number(row.space_id);
    if (!spacePerms.has(spaceId)) spacePerms.set(spaceId, new Set<string>());
    spacePerms.get(spaceId)!.add(String(row.name));
  }

  return {
    async hasGlobalPermission(permission: Permission) {
      return globalPerms.has(permission);
    },
    async hasSpacePermission(spaceId: number, permission: Permission) {
      const set = spacePerms.get(spaceId);
      return Boolean(set && (set.has(permission) || set.has('admin')));
    },
  };
}

// Helper: does the user have site-level any-space moderation authority?
async function hasAnySpaceModeration(checker: PermissionChecker): Promise<boolean> {
  return (
    (await checker.hasGlobalPermission(PERM.FEED_MODERATE_GLOBAL)) ||
    (await checker.hasGlobalPermission(PERM.FEED_PUBLISH_GLOBAL)) ||
    (await checker.hasGlobalPermission(PERM.VIDEO_DELETE_ANY))
  );
}

// Helper: check if user is currently suspended from posting (global or specific space)
async function isPostingSuspended(userId: number, spaceId?: number | null): Promise<boolean> {
  try {
    const db = getPool();
    const params: any[] = [userId];
    let sql = `SELECT 1 FROM suspensions WHERE user_id = ? AND kind = 'posting' AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())`;
    if (spaceId) {
      sql += ` AND (target_type = 'site' OR (target_type = 'space' AND target_id = ?))`;
      params.push(spaceId);
    } else {
      sql += ` AND target_type = 'site'`;
    }
    sql += ` LIMIT 1`;
    const [rows] = await db.query(sql, params);
    return (rows as any[]).length > 0;
  } catch {
    // Table may not exist yet; treat as not suspended
    return false;
  }
}

export async function can(userId: number, permission: Permission, options: CanOptions = {}): Promise<boolean> {
  const { ownerId, spaceId } = options;
  const checker = options.checker ?? (await resolveChecker(userId));

  // Admin shortcut
  if (await checker.hasGlobalPermission(PERM.VIDEO_DELETE_ANY)) {
    return true;
  }

  // Posting suspension check (affects posting to spaces only)
  if (permission === PERM.SPACE_POST || permission === PERM.VIDEO_POST_SPACE) {
    if (await isPostingSuspended(userId, spaceId ?? null)) return false;
  }

  // Own-type permissions
  if (
    permission === PERM.VIDEO_PUBLISH_OWN ||
    permission === PERM.VIDEO_UNPUBLISH_OWN ||
    permission === PERM.VIDEO_EDIT_OWN ||
    permission === PERM.VIDEO_DELETE_OWN
  ) {
    if (ownerId && ownerId === userId) {
      return checker.hasGlobalPermission(permission);
    }
    return false;
  }

  // Space-scoped permissions
  const spaceScoped = new Set([
    PERM.SPACE_MANAGE, 'space:settings_update', PERM.SPACE_ASSIGN_ROLES, PERM.SPACE_INVITE, PERM.SPACE_KICK, PERM.SPACE_VIEW_PRIVATE, PERM.SPACE_VIEW_HIDDEN, PERM.SPACE_POST,
    PERM.VIDEO_REVIEW_SPACE, PERM.VIDEO_APPROVE_SPACE, PERM.VIDEO_PUBLISH_SPACE, PERM.VIDEO_UNPUBLISH_SPACE,
    PERM.COMMENT_CREATE, PERM.COMMENT_DELETE_ANY, PERM.COMMENT_MODERATE,
    'moderation:comment_creator', PERM.MOD_SUSPEND_POSTING, PERM.MOD_BAN,
    PERM.SUBS_MANAGE_PLANS, PERM.SUBS_VIEW_SUBSCRIBERS, PERM.SUBS_GRANT_COMP, PERM.SUBS_GATE_CONTENT
  ]);

  if (spaceScoped.has(permission)) {
    if (!spaceId) {
      // No spaceId provided; only allow if user has any-space moderation and the action is a moderation action
      return hasAnySpaceModeration(checker);
    }
    // Any-space authority for moderation/publishing actions
    if (
      permission === 'video:review_space' ||
      permission === 'video:approve_space' ||
      permission === 'video:publish_space' ||
      permission === 'video:unpublish_space'
    ) {
      if (await hasAnySpaceModeration(checker)) return true;
    }
    return checker.hasSpacePermission(spaceId, permission);
  }

  // Fallback to global permission check
  return checker.hasGlobalPermission(permission);
}
