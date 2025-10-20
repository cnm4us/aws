// RBAC seed payloads (idempotent). These reflect docs/RolesPermissions.md and docs/RBAC_Implementation_Plan.md
// Usage: imported by migrate-rbac.ts

export const permissionSeeds: { name: string; scope: 'site' | 'space' }[] = [
  // Site
  { name: 'feed:publish_global', scope: 'site' },
  { name: 'feed:moderate_global', scope: 'site' },
  { name: 'feed:hold_member_global', scope: 'site' },
  { name: 'moderation:credibility_adjust', scope: 'site' },
  { name: 'moderation:suspend_posting', scope: 'site' },
  { name: 'moderation:ban', scope: 'site' },
  { name: 'video:upload', scope: 'site' },
  { name: 'video:produce', scope: 'site' },
  { name: 'video:edit_own', scope: 'site' },
  { name: 'video:delete_own', scope: 'site' },
  { name: 'video:publish_own', scope: 'site' },
  { name: 'video:unpublish_own', scope: 'site' },
  { name: 'video:delete_any', scope: 'site' },
  { name: 'space:create_group', scope: 'site' },
  { name: 'space:create_channel', scope: 'site' },
  // Space
  { name: 'space:manage', scope: 'space' },
  { name: 'space:settings_update', scope: 'space' },
  { name: 'space:assign_roles', scope: 'space' },
  { name: 'space:invite', scope: 'space' },
  { name: 'space:kick', scope: 'space' },
  { name: 'space:view_private', scope: 'space' },
  { name: 'space:view_hidden', scope: 'space' },
  { name: 'space:post', scope: 'space' },
  { name: 'video:review_space', scope: 'space' },
  { name: 'video:approve_space', scope: 'space' },
  { name: 'video:publish_space', scope: 'space' },
  { name: 'video:unpublish_space', scope: 'space' },
  { name: 'moderation:comment_creator', scope: 'space' },
  { name: 'moderation:suspend_posting', scope: 'space' },
  { name: 'moderation:ban', scope: 'space' },
  { name: 'comment:create', scope: 'space' },
  { name: 'comment:delete_any', scope: 'space' },
  { name: 'comment:moderate', scope: 'space' },
  { name: 'subscription:manage_plans', scope: 'space' },
  { name: 'subscription:view_subscribers', scope: 'space' },
  { name: 'subscription:grant_comp', scope: 'space' },
  { name: 'subscription:gate_content', scope: 'space' },
];

export type RoleSeed = {
  name: string;
  scope: 'site' | 'space';
  space_type?: 'any' | 'group' | 'channel' | null;
  grants: string[]; // permission names
};

export const roleSeeds: RoleSeed[] = [
  // Site roles
  { name: 'site_admin', scope: 'site', space_type: null, grants: ['*'] },
  {
    name: 'site_moderator', scope: 'site', space_type: null,
    grants: [
      'feed:publish_global', 'feed:moderate_global', 'feed:hold_member_global',
      'moderation:comment_creator', 'moderation:credibility_adjust', 'moderation:suspend_posting',
      'space:view_hidden', 'comment:moderate', 'comment:delete_any'
    ],
  },
  {
    name: 'site_member', scope: 'site', space_type: null,
    grants: [ 'video:upload', 'video:produce', 'video:edit_own', 'video:delete_own', 'video:publish_own', 'video:unpublish_own', 'comment:create' ],
  },

  // Space roles
  {
    name: 'space_admin', scope: 'space', space_type: 'any',
    grants: [
      'space:manage','space:settings_update','space:assign_roles','space:invite','space:kick',
      'space:view_private','space:view_hidden',
      'video:review_space','video:approve_space','video:publish_space','video:unpublish_space',
      'comment:moderate','comment:delete_any',
      'subscription:manage_plans','subscription:view_subscribers','subscription:grant_comp','subscription:gate_content'
    ],
  },
  {
    name: 'space_moderator', scope: 'space', space_type: 'any',
    grants: [
      'video:review_space','video:approve_space','video:publish_space','video:unpublish_space',
      'moderation:comment_creator','moderation:suspend_posting','comment:moderate','comment:delete_any'
    ],
  },
  { name: 'space_poster', scope: 'space', space_type: 'any', grants: ['space:post','comment:create'] },
  { name: 'space_member', scope: 'space', space_type: 'any', grants: ['space:view_private','comment:create'] },
  { name: 'space_subscriber', scope: 'space', space_type: 'any', grants: [] },
];

