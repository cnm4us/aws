// Centralized permission constants to avoid string drift
export const PERM = {
  // Video
  VIDEO_UPLOAD: 'video:upload',
  VIDEO_EDIT_OWN: 'video:edit_own',
  VIDEO_DELETE_OWN: 'video:delete_own',
  VIDEO_PUBLISH_OWN: 'video:publish_own',
  VIDEO_UNPUBLISH_OWN: 'video:unpublish_own',
  VIDEO_PUBLISH_SPACE: 'video:publish_space',
  VIDEO_UNPUBLISH_SPACE: 'video:unpublish_space',
  VIDEO_APPROVE_SPACE: 'video:approve_space',
  VIDEO_MODERATE: 'video:moderate',
  VIDEO_DELETE_ANY: 'video:delete_any',
  VIDEO_APPROVE: 'video:approve',
  VIDEO_POST_SPACE: 'video:post_space',
  VIDEO_REVIEW_SPACE: 'video:review_space',

  // Space
  SPACE_MANAGE: 'space:manage',
  SPACE_INVITE: 'space:invite',
  SPACE_KICK: 'space:kick',
  SPACE_SETTINGS_UPDATE: 'space:settings_update',
  SPACE_ASSIGN_ROLES: 'space:assign_roles',
  SPACE_VIEW_PRIVATE: 'space:view_private',
  SPACE_VIEW_HIDDEN: 'space:view_hidden',
  SPACE_POST: 'space:post',
  SPACE_CREATE_GROUP: 'space:create_group',
  SPACE_CREATE_CHANNEL: 'space:create_channel',
  SPACE_MANAGE_MEMBERS: 'space:manage_members',
  SPACE_INVITE_MEMBERS: 'space:invite_members',

  // Moderation
  MOD_SUSPEND_POSTING: 'moderation:suspend_posting',
  MOD_BAN: 'moderation:ban',
  MOD_COMMENT_CREATOR: 'moderation:comment_creator',

  // Subscription
  SUBS_MANAGE_PLANS: 'subscription:manage_plans',
  SUBS_VIEW_SUBSCRIBERS: 'subscription:view_subscribers',
  SUBS_GRANT_COMP: 'subscription:grant_comp',
  SUBS_GATE_CONTENT: 'subscription:gate_content',

  // Feed (site-wide)
  FEED_MODERATE_GLOBAL: 'feed:moderate_global',
  FEED_PUBLISH_GLOBAL: 'feed:publish_global',

  // Comments
  COMMENT_CREATE: 'comment:create',
  COMMENT_DELETE_ANY: 'comment:delete_any',
  COMMENT_MODERATE: 'comment:moderate',
} as const

export type PermissionName = typeof PERM[keyof typeof PERM]
