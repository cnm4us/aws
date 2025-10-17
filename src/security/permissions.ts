import { getPool } from '../db';

export type Permission =
  | 'video:upload'
  | 'video:edit_own'
  | 'video:delete_own'
  | 'video:publish_own'
  | 'video:unpublish_own'
  | 'video:publish_space'
  | 'video:unpublish_space'
  | 'video:approve_space'
  | 'video:approve'
  | 'video:moderate'
  | 'video:delete_any'
  | 'space:manage'
  | 'space:invite'
  | 'space:kick'
  | 'space:assign_roles'
  | 'space:view_private'
  | 'space:post';

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

export async function can(userId: number, permission: Permission, options: CanOptions = {}): Promise<boolean> {
  const { ownerId, spaceId } = options;
  const checker = options.checker ?? (await resolveChecker(userId));

  // Admin shortcut
  if (await checker.hasGlobalPermission('video:delete_any')) {
    return true;
  }

  // Own-type permissions
  if (permission === 'video:publish_own' || permission === 'video:unpublish_own' || permission === 'video:edit_own' || permission === 'video:delete_own') {
    if (ownerId && ownerId === userId) {
      return checker.hasGlobalPermission(permission);
    }
    return false;
  }

  // Space- scoped permissions
  if (spaceId) {
    if (permission === 'video:publish_space') {
      return checker.hasSpacePermission(spaceId, 'video:publish_space');
    }
    if (permission === 'video:unpublish_space') {
      return checker.hasSpacePermission(spaceId, 'video:unpublish_space');
    }
    if (permission === 'video:approve_space') {
      return checker.hasSpacePermission(spaceId, 'video:approve_space');
    }
  }

  // Fallback to global permission check
  return checker.hasGlobalPermission(permission);
}
