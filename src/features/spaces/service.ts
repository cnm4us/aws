import { getPool } from '../../db'
import * as repo from './repo'
import { can, resolveChecker } from '../../security/permissions'
import { NotFoundError, ForbiddenError, DomainError } from '../../core/errors'
import { isMember, listSpaceInvitations, listSpaceMembers, loadSpace, assignDefaultMemberRoles, type SpaceRow, type SpaceType } from '../../services/spaceMembership'

type SpaceRelationship = 'owner' | 'admin' | 'member' | 'subscriber'

function parseSettings(space: SpaceRow | null): any {
  if (!space || space.settings == null) return {}
  if (typeof space.settings === 'object') return space.settings
  try { return JSON.parse(String(space.settings)) } catch { return {} }
}

function settingsAllowPublicView(settings: any): boolean {
  if (!settings || typeof settings !== 'object') return false
  const visibility = typeof settings.visibility === 'string' ? settings.visibility.toLowerCase() : ''
  if (visibility === 'public' || visibility === 'global') return true
  if (settings.allowAnonymousAccess === true) return true
  if (settings.publicFeed === true) return true
  return false
}

function mapSpaceSummary(row: any, relationship: SpaceRelationship, subscribed: boolean) {
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    type: String(row.type) as SpaceType,
    relationship,
    subscribed,
  }
}

function mergeChannelEntries(memberships: any[], subscriptions: any[]) {
  const map = new Map<number, any>()
  memberships.forEach((entry) => { map.set(entry.id, { ...entry }) })
  subscriptions.forEach((entry) => {
    const existing = map.get(entry.id)
    if (existing) {
      existing.subscribed = existing.subscribed || entry.subscribed
      if (existing.relationship === 'member' && entry.relationship === 'subscriber') return
      if (existing.relationship !== 'owner' && entry.relationship === 'subscriber') return
    } else { map.set(entry.id, { ...entry }) }
  })
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getMySpaces(userId: number) {
  const db = getPool()
  const personalRow = await repo.personalSpaceByOwner(userId, db)
  const personal = personalRow ? mapSpaceSummary(personalRow, 'owner', false) : null
  const groups = (await repo.listGroupMemberships(userId, db)).map((row) => mapSpaceSummary(row, Number(row.is_admin) ? 'admin' : 'member', false))
  const channelMemberships = (await repo.listChannelMemberships(userId, db)).map((row) => mapSpaceSummary(row, Number(row.is_admin) ? 'admin' : 'member', false))
  const channelSubscriptions = (await repo.listChannelSubscriptions(userId, db)).map((row) => mapSpaceSummary(row, 'subscriber', true))
  const channels = mergeChannelEntries(channelMemberships, channelSubscriptions)

  let global: any = null
  const candidate = await repo.findGlobalSpaceCandidate(db)
  if (candidate) {
    const settings = parseSettings({ id: candidate.id, type: candidate.type, owner_user_id: null, settings: candidate.settings })
    if (candidate.slug === 'global' || candidate.slug === 'global-feed' || settings?.global === true || settings?.isGlobal === true || settings?.feed === 'global') {
      global = mapSpaceSummary(candidate, 'member', false)
    }
  }
  return { personal, global, groups, channels }
}

export async function canViewSpaceFeed(space: SpaceRow, userId: number): Promise<boolean> {
  const db = getPool()
  const banned = await repo.isBannedFromSpace(space.id, userId, db)
  if (banned) return false
  const checker = await resolveChecker(userId)
  const siteAdmin = await can(userId, 'video:delete_any', { checker })
  if (siteAdmin) return true
  if (space.owner_user_id != null && space.owner_user_id === userId) return true
  if (await isMember(db, space.id, userId)) return true
  const settings = parseSettings(space)
  if (settingsAllowPublicView(settings)) return true
  if (await repo.hasActiveSubscription(space.id, userId, db)) return true
  return false
}

export async function getSettings(spaceId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new Error('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const siteAdmin = await can(currentUserId, 'video:delete_any', { checker })
  const allowed = siteAdmin || (await can(currentUserId, 'space:manage', { spaceId, checker }))
  if (!allowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  const settings = parseSettings(space)
  const review = (await repo.fetchSiteReviewFlags(db)) || { requireGroupReview: false, requireChannelReview: true }
  const siteEnforced = space.type === 'group' ? review.requireGroupReview : space.type === 'channel' ? review.requireChannelReview : false
  return {
    id: space.id,
    name: space.name ?? null,
    type: space.type,
    settings,
    site: { requireGroupReview: review.requireGroupReview, requireChannelReview: review.requireChannelReview, siteEnforced },
  }
}

export async function updateSettings(spaceId: number, currentUserId: number, input: { commentsPolicy?: string; requireReview?: boolean }) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new Error('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const siteAdmin = await can(currentUserId, 'video:delete_any', { checker })
  const allowed = siteAdmin || (await can(currentUserId, 'space:manage', { spaceId, checker }))
  if (!allowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  const settings = parseSettings(space)
  if (!settings.publishing || typeof settings.publishing !== 'object') settings.publishing = {}
  if (input.commentsPolicy !== undefined) {
    const allowed = new Set(['on', 'off', 'inherit'])
    const val = String(input.commentsPolicy || '').toLowerCase()
    if (!allowed.has(val)) throw Object.assign(new Error('bad_comments_policy'), { code: 'bad_comments_policy', status: 400 })
    settings.comments = val
  }
  const review = (await repo.fetchSiteReviewFlags(db)) || { requireGroupReview: false, requireChannelReview: true }
  const siteEnforced = space.type === 'group' ? review.requireGroupReview : space.type === 'channel' ? review.requireChannelReview : false
  if (!siteEnforced && input.requireReview !== undefined) {
    settings.publishing.requireApproval = !!input.requireReview
  }
  await db.query(`UPDATE spaces SET settings = ? WHERE id = ?`, [JSON.stringify(settings), spaceId])
  return { ok: true, id: spaceId, settings }
}

export async function listMembers(spaceId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new Error('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const siteAdmin = await can(currentUserId, 'video:delete_any', { checker })
  const member = await isMember(db, spaceId, currentUserId)
  const viewAllowed = siteAdmin || member || (await can(currentUserId, 'space:view_private', { spaceId, checker }))
  if (!viewAllowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  const members = await listSpaceMembers(db, spaceId)
  return { members }
}

export async function listInvitations(spaceId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new Error('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const siteAdmin = await can(currentUserId, 'video:delete_any', { checker })
  const member = await isMember(db, spaceId, currentUserId)
  const viewAllowed = siteAdmin || member || (await can(currentUserId, 'space:view_private', { spaceId, checker }))
  if (!viewAllowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  const invitations = await listSpaceInvitations(db, spaceId)
  return { invitations }
}

export async function deleteSpace(spaceId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new Error('space_not_found')
  const checker = await resolveChecker(currentUserId)
  let allowed = false
  if (space.owner_user_id && space.owner_user_id === currentUserId) allowed = true
  if (!allowed && (await can(currentUserId, 'video:delete_any', { checker }))) allowed = true
  if (!allowed && (await can(currentUserId, 'space:manage', { spaceId, checker }))) allowed = true
  if (!allowed && (await can(currentUserId, 'space:manage_members', { spaceId, checker }))) allowed = true
  if (!allowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  if (space.type === 'personal' && !(await can(currentUserId, 'video:delete_any', { checker }))) {
    throw Object.assign(new Error('cannot_delete_personal_space'), { code: 'cannot_delete_personal_space', status: 400 })
  }
  await db.query(`DELETE FROM user_space_roles WHERE space_id = ?`, [spaceId])
  await db.query(`DELETE FROM space_follows WHERE space_id = ?`, [spaceId])
  await db.query(`DELETE FROM space_invitations WHERE space_id = ?`, [spaceId])
  await db.query(`DELETE FROM spaces WHERE id = ?`, [spaceId])
  return { ok: true }
}

export async function inviteMember(spaceId: number, inviteeUserId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new NotFoundError('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const allowed = (await can(currentUserId, 'space:invite_members', { spaceId, checker })) || (await can(currentUserId, 'space:manage_members', { spaceId, checker })) || (await can(currentUserId, 'video:delete_any', { checker }))
  if (!allowed) throw new ForbiddenError()
  if (space.owner_user_id === inviteeUserId) throw new DomainError('cannot_invite_owner', 'cannot_invite_owner', 400)
  if (await isMember(db, spaceId, inviteeUserId)) throw new DomainError('already_member', 'already_member', 409)
  const [userRows] = await db.query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [inviteeUserId])
  if (!(userRows as any[]).length) throw new NotFoundError('user_not_found')
  const [inviteRows] = await db.query(`SELECT id, status FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? LIMIT 1`, [spaceId, inviteeUserId])
  const existing = (inviteRows as any[])[0]
  if (existing) {
    if (String(existing.status) === 'pending') throw new DomainError('invitation_pending', 'invitation_pending', 409)
    await db.query(`UPDATE space_invitations SET status = 'pending', inviter_user_id = ?, responded_at = NULL WHERE id = ?`, [currentUserId, existing.id])
  } else {
    await db.query(`INSERT INTO space_invitations (space_id, inviter_user_id, invitee_user_id, status) VALUES (?, ?, ?, 'pending')`, [spaceId, currentUserId, inviteeUserId])
  }
  return { ok: true }
}

export async function revokeInvitation(spaceId: number, inviteeUserId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new NotFoundError('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const allowed = (await can(currentUserId, 'space:invite_members', { spaceId, checker })) || (await can(currentUserId, 'space:manage_members', { spaceId, checker })) || (await can(currentUserId, 'video:delete_any', { checker }))
  if (!allowed) throw new ForbiddenError()
  const [inviteRows] = await db.query(`SELECT id FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending' LIMIT 1`, [spaceId, inviteeUserId])
  const invitation = (inviteRows as any[])[0]
  if (!invitation) throw new NotFoundError('invitation_not_found')
  await db.query(`UPDATE space_invitations SET status = 'revoked', responded_at = NOW() WHERE id = ?`, [invitation.id])
  return { ok: true }
}

export async function acceptInvitation(spaceId: number, inviteeUserId: number, currentUserId: number) {
  const db = getPool()
  const checker = await resolveChecker(currentUserId)
  if (currentUserId !== inviteeUserId && !(await can(currentUserId, 'video:delete_any', { checker }))) {
    throw new ForbiddenError()
  }
  const space = await loadSpace(spaceId, db)
  if (!space) throw new NotFoundError('space_not_found')
  const [inviteRows] = await db.query(`SELECT id FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending' LIMIT 1`, [spaceId, inviteeUserId])
  const invitation = (inviteRows as any[])[0]
  if (!invitation) throw new NotFoundError('invitation_not_found')
  await db.query(`UPDATE space_invitations SET status = 'accepted', responded_at = NOW() WHERE id = ?`, [invitation.id])
  await assignDefaultMemberRoles(db, space, inviteeUserId)
  return { ok: true }
}

export async function declineInvitation(spaceId: number, inviteeUserId: number, currentUserId: number) {
  const db = getPool()
  const checker = await resolveChecker(currentUserId)
  if (currentUserId !== inviteeUserId && !(await can(currentUserId, 'video:delete_any', { checker }))) {
    throw new ForbiddenError()
  }
  const [inviteRows] = await db.query(`SELECT id FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending' LIMIT 1`, [spaceId, inviteeUserId])
  const invitation = (inviteRows as any[])[0]
  if (!invitation) throw new NotFoundError('invitation_not_found')
  await db.query(`UPDATE space_invitations SET status = 'declined', responded_at = NOW() WHERE id = ?`, [invitation.id])
  return { ok: true }
}
