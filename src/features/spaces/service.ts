import { getPool } from '../../db'
import * as repo from './repo'
import { can, resolveChecker } from '../../security/permissions'
import { PERM } from '../../security/perm'
import { NotFoundError, ForbiddenError, DomainError } from '../../core/errors'
import { isMember, listSpaceInvitations, listSpaceMembers, loadSpace, assignDefaultMemberRoles, removeAllRoles, type SpaceRow, type SpaceType } from '../../services/spaceMembership'
import { enhanceUploadRow } from '../../utils/enhance'
import { slugify, defaultSettings } from './util'
import { ulidMonotonic as genSpaceUlid } from '../../utils/ulid'

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
    ulid: row.ulid ? String(row.ulid) : null,
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
  const siteAdmin = await can(userId, PERM.VIDEO_DELETE_ANY, { checker })
  if (siteAdmin) return true
  if (space.owner_user_id != null && space.owner_user_id === userId) return true
  if (await isMember(db, space.id, userId)) return true
  const settings = parseSettings(space)
  if (settingsAllowPublicView(settings)) return true
  if (await repo.hasActiveSubscription(space.id, userId, db)) return true
  return false
}

// Helper: load a space or throw a domain error with legacy code for route shape compatibility
export async function loadSpaceOrThrow(spaceId: number): Promise<SpaceRow> {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) {
    // Preserve legacy error code used by routes
    throw new DomainError('space_not_found', 'space_not_found', 404)
  }
  return space
}

// Helper: assert that a user can view a space feed; throws DomainError with preserved codes
export async function assertCanViewSpaceFeed(spaceId: number, userId: number): Promise<void> {
  const space = await loadSpaceOrThrow(spaceId)
  const allowed = await canViewSpaceFeed(space, userId)
  if (!allowed) throw new ForbiddenError('forbidden')
}

export async function getSettings(spaceId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new Error('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const siteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  const allowed = siteAdmin || (await can(currentUserId, PERM.SPACE_MANAGE, { spaceId, checker }))
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
  const siteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  const allowed = siteAdmin || (await can(currentUserId, PERM.SPACE_MANAGE, { spaceId, checker }))
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
  const siteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  const member = await isMember(db, spaceId, currentUserId)
  const viewAllowed = siteAdmin || member || (await can(currentUserId, PERM.SPACE_VIEW_PRIVATE, { spaceId, checker }))
  if (!viewAllowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  const members = await listSpaceMembers(db, spaceId)
  return { members }
}

export async function listInvitations(spaceId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new Error('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const siteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  const member = await isMember(db, spaceId, currentUserId)
  const viewAllowed = siteAdmin || member || (await can(currentUserId, PERM.SPACE_VIEW_PRIVATE, { spaceId, checker }))
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
  if (!allowed && (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))) allowed = true
  if (!allowed && (await can(currentUserId, PERM.SPACE_MANAGE, { spaceId, checker }))) allowed = true
  if (!allowed && (await can(currentUserId, PERM.SPACE_MANAGE_MEMBERS, { spaceId, checker }))) allowed = true
  if (!allowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  if (space.type === 'personal' && !(await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))) {
    throw Object.assign(new Error('cannot_delete_personal_space'), { code: 'cannot_delete_personal_space', status: 400 })
  }
  await db.query(`DELETE FROM user_space_roles WHERE space_id = ?`, [spaceId])
  await db.query(`DELETE FROM space_follows WHERE space_id = ?`, [spaceId])
  await db.query(`DELETE FROM space_invitations WHERE space_id = ?`, [spaceId])
  await db.query(`DELETE FROM spaces WHERE id = ?`, [spaceId])
  return { ok: true }
}

export async function removeMember(spaceId: number, targetUserId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
  if (currentUserId !== targetUserId) {
    const checker = await resolveChecker(currentUserId)
    const allowed = (await can(currentUserId, PERM.SPACE_MANAGE_MEMBERS, { spaceId, checker })) || (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))
    if (!allowed) throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 })
  }
  const checker = await resolveChecker(currentUserId)
  const isSiteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  if (space.owner_user_id === targetUserId && !isSiteAdmin) {
    throw Object.assign(new Error('cannot_remove_owner'), { code: 'cannot_remove_owner', status: 400 })
  }
  await removeAllRoles(db, spaceId, targetUserId)
  await db.query(`UPDATE space_invitations SET status = 'revoked', responded_at = NOW() WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`, [spaceId, targetUserId])
  return { ok: true }
}

export async function createSpace(input: { type: 'group' | 'channel'; name: string }, currentUserId: number) {
  const db = getPool()
  const t = String(input.type || '').toLowerCase()
  if (t !== 'group' && t !== 'channel') throw Object.assign(new Error('invalid_space_type'), { code: 'invalid_space_type', status: 400 })
  const title = typeof input.name === 'string' && input.name.trim().length ? input.name.trim().slice(0, 120) : null
  if (!title) throw Object.assign(new Error('invalid_name'), { code: 'invalid_name', status: 400 })

  const flags = (await repo.fetchSiteCreationFlags(db)) || { allowGroupCreation: true, allowChannelCreation: true }
  const [userRows] = await db.query(`SELECT can_create_group, can_create_channel FROM users WHERE id = ? LIMIT 1`, [currentUserId])
  const user = (userRows as any[])[0]
  if (!user) throw Object.assign(new Error('user_not_found'), { code: 'user_not_found', status: 401 })
  const overrideGroup = user.can_create_group == null ? null : Boolean(Number(user.can_create_group))
  const overrideChannel = user.can_create_channel == null ? null : Boolean(Number(user.can_create_channel))

  const checker = await resolveChecker(currentUserId)
  let allowed = false
  if (t === 'group') {
    const baseline = overrideGroup === null ? flags.allowGroupCreation : overrideGroup
    allowed = baseline && (await can(currentUserId, PERM.SPACE_CREATE_GROUP, { checker }))
  } else {
    const baseline = overrideChannel === null ? flags.allowChannelCreation : overrideChannel
    allowed = baseline && (await can(currentUserId, PERM.SPACE_CREATE_CHANNEL, { checker }))
  }
  if (!allowed) throw new ForbiddenError()

  const baseSlug = slugify(title)
  let slug = baseSlug
  let attempt = 1
  while (true) {
    const [exists] = await db.query(`SELECT id FROM spaces WHERE type = ? AND slug = ? LIMIT 1`, [t, slug])
    if (!(exists as any[]).length) break
    attempt += 1
    slug = `${baseSlug}-${attempt}`
  }

  const settingsJson = JSON.stringify(defaultSettings(t))
  const spaceUlid = genSpaceUlid()
  const [ins] = await db.query(
    `INSERT INTO spaces (type, owner_user_id, ulid, name, slug, settings) VALUES (?, ?, ?, ?, ?, ?)` ,
    [t, currentUserId, spaceUlid, title, slug, settingsJson]
  )
  const space: SpaceRow = { id: (ins as any).insertId as number, type: t as any, owner_user_id: currentUserId }
  await assignDefaultMemberRoles(db, space, currentUserId)
  return {
    space: {
      id: space.id,
      type: t,
      name: title,
      slug,
      settings: JSON.parse(settingsJson),
    }
  }
}

export async function listSubscribers(spaceId: number, currentUserId: number) {
  const db = getPool()
  const checker = await resolveChecker(currentUserId)
  const isSiteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  const canView = isSiteAdmin || (await can(currentUserId, PERM.SUBS_VIEW_SUBSCRIBERS, { spaceId, checker }))
  if (!canView) throw new ForbiddenError()
  const [rows] = await db.query(
    `SELECT sub.user_id, sub.tier, sub.status, sub.started_at, sub.ended_at, u.email, u.display_name
       FROM space_subscriptions sub
       JOIN users u ON u.id = sub.user_id
      WHERE sub.space_id = ?
      ORDER BY sub.status = 'active' DESC, sub.started_at DESC`,
    [spaceId]
  )
  const subscribers = (rows as any[]).map((r) => ({
    userId: Number(r.user_id),
    email: r.email || null,
    displayName: r.display_name || null,
    tier: r.tier || null,
    status: String(r.status),
    startedAt: r.started_at ? String(r.started_at) : null,
    endedAt: r.ended_at ? String(r.ended_at) : null,
  }))
  return { subscribers }
}

export async function listSuspensions(spaceId: number, currentUserId: number, activeOnly: boolean) {
  const db = getPool()
  const checker = await resolveChecker(currentUserId)
  const isSiteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  const canView = isSiteAdmin || (await can(currentUserId, PERM.MOD_SUSPEND_POSTING, { spaceId, checker })) || (await can(currentUserId, PERM.MOD_BAN, { spaceId, checker }))
  if (!canView) throw new ForbiddenError()
  const where: string[] = [`target_type = 'space'`, `target_id = ?`]
  const params: any[] = [spaceId]
  if (activeOnly) {
    where.push(`(starts_at IS NULL OR starts_at <= NOW())`)
    where.push(`(ends_at IS NULL OR ends_at >= NOW())`)
  }
  const sql = `SELECT id, user_id, kind, degree, starts_at, ends_at, reason, created_by, created_at
                 FROM suspensions
                WHERE ${where.join(' AND ')}
                ORDER BY created_at DESC, id DESC
                LIMIT 1000`
  const [rows] = await db.query(sql, params)
  const items = (rows as any[]).map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    kind: String(r.kind),
    degree: r.degree != null ? Number(r.degree) : null,
    startsAt: r.starts_at ? String(r.starts_at) : null,
    endsAt: r.ends_at ? String(r.ends_at) : null,
    reason: r.reason || null,
    createdBy: r.created_by != null ? Number(r.created_by) : null,
    createdAt: String(r.created_at),
  }))
  return { suspensions: items }
}

export async function createSuspension(spaceId: number, currentUserId: number, input: { userId: number; kind: 'posting' | 'ban'; degree?: number; reason?: string; days?: number }) {
  const db = getPool()
  const { userId, kind, degree, reason, days } = input
  const k = String(kind || '').toLowerCase()
  if (k !== 'posting' && k !== 'ban') throw new DomainError('bad_kind', 'bad_kind', 400)
  const checker = await resolveChecker(currentUserId)
  const isSiteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  if (!isSiteAdmin) {
    if (k === 'posting') {
      const ok = await can(currentUserId, PERM.MOD_SUSPEND_POSTING, { spaceId, checker })
      if (!ok) throw new ForbiddenError()
    } else {
      const ok = await can(currentUserId, PERM.MOD_BAN, { spaceId, checker })
      if (!ok) throw new ForbiddenError()
    }
  }
  let endsAt: Date | null = null
  if (k === 'posting') {
    const d = Number(degree || 1)
    const daysMap = d === 1 ? 1 : d === 2 ? 7 : 30
    endsAt = new Date(Date.now() + daysMap * 24 * 60 * 60 * 1000)
  } else if (k === 'ban') {
    const d = days != null ? Number(days) : NaN
    if (Number.isFinite(d) && d > 0) {
      endsAt = new Date(Date.now() + d * 24 * 60 * 60 * 1000)
    }
  }
  await db.query(
    `INSERT INTO suspensions (user_id, target_type, target_id, kind, degree, starts_at, ends_at, reason, created_by)
       VALUES (?, 'space', ?, ?, ?, NOW(), ?, ?, ?)`,
    [userId, spaceId, k, Number(degree || (k === 'posting' ? 1 : 1)), endsAt, reason ? String(reason).slice(0, 255) : null, currentUserId]
  )
  return { ok: true }
}

export async function revokeSuspension(spaceId: number, suspensionId: number, currentUserId: number) {
  const db = getPool()
  const [rows] = await db.query(`SELECT id, user_id, kind FROM suspensions WHERE id = ? AND target_type = 'space' AND target_id = ? LIMIT 1`, [suspensionId, spaceId])
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('suspension_not_found')
  const checker = await resolveChecker(currentUserId)
  const isSiteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  if (!isSiteAdmin) {
    if (String(row.kind) === 'posting') {
      const ok = await can(currentUserId, PERM.MOD_SUSPEND_POSTING, { spaceId, checker })
      if (!ok) throw new ForbiddenError()
    } else {
      const ok = await can(currentUserId, PERM.MOD_BAN, { spaceId, checker })
      if (!ok) throw new ForbiddenError()
    }
  }
  await db.query(`UPDATE suspensions SET ends_at = NOW() WHERE id = ?`, [suspensionId])
  return { ok: true }
}

export async function moderationQueue(spaceId: number, currentUserId: number) {
  const db = getPool()
  const checker = await resolveChecker(currentUserId)
  const isSiteAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker })
  const canModerate = isSiteAdmin || (await can(currentUserId, PERM.VIDEO_APPROVE_SPACE, { spaceId, checker })) || (await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { spaceId, checker }))
  if (!canModerate) throw new ForbiddenError()

  const params: any[] = [spaceId]
  const where: string[] = [ 'sp.space_id = ?', "sp.status = 'pending'" ]
  const sql = `
    SELECT
      sp.id AS publication_id,
      sp.upload_id,
      sp.production_id,
      sp.space_id,
      sp.status AS publication_status,
      sp.requested_by,
      sp.approved_by,
      sp.visibility AS publication_visibility,
      sp.distribution_flags,
      sp.published_at,
      sp.unpublished_at,
      sp.created_at AS publication_created_at,
      sp.updated_at AS publication_updated_at,
      u.id AS upload_id,
      u.s3_bucket,
      u.s3_key,
      u.original_filename,
      u.modified_filename,
      u.description AS upload_description,
      u.content_type,
      u.size_bytes,
      u.width,
      u.height,
      u.duration_seconds,
      u.status AS upload_status,
      u.etag,
      u.mediaconvert_job_id,
      COALESCE(p.output_prefix, u.output_prefix) AS output_prefix,
      u.asset_uuid,
      u.date_ymd,
      u.profile,
      u.orientation,
      u.created_at AS upload_created_at,
      u.uploaded_at,
      u.user_id AS upload_user_id,
      req.display_name AS requester_display_name,
      req.email AS requester_email
    FROM space_publications sp
    JOIN uploads u ON u.id = sp.upload_id
    LEFT JOIN productions p ON p.id = sp.production_id
    LEFT JOIN users req ON req.id = sp.requested_by
    WHERE ${where.join(' AND ')}
    ORDER BY sp.created_at DESC, sp.id DESC
    LIMIT 200`
  const [rows] = await db.query(sql, params)
  const items = (rows as any[]).map((row) => {
    let distribution: any = null
    if (row.distribution_flags) { try { distribution = JSON.parse(row.distribution_flags) } catch { distribution = null } }
    const publication = {
      id: Number(row.publication_id),
      upload_id: Number(row.upload_id),
      production_id: row.production_id == null ? null : Number(row.production_id),
      space_id: Number(row.space_id),
      status: String(row.publication_status),
      requested_by: row.requested_by == null ? null : Number(row.requested_by),
      approved_by: row.approved_by == null ? null : Number(row.approved_by),
      visibility: (row.publication_visibility || 'inherit') as any,
      distribution_flags: distribution,
      published_at: row.published_at ? String(row.published_at) : null,
      unpublished_at: row.unpublished_at ? String(row.unpublished_at) : null,
      created_at: String(row.publication_created_at),
      updated_at: String(row.publication_updated_at),
    }
    const uploadRaw: any = {
      id: Number(row.upload_id), s3_bucket: row.s3_bucket, s3_key: row.s3_key,
      original_filename: row.original_filename,
      modified_filename: row.modified_filename ? String(row.modified_filename) : row.original_filename,
      description: row.upload_description != null ? String(row.upload_description) : null,
      content_type: row.content_type,
      size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
      width: row.width != null ? Number(row.width) : null,
      height: row.height != null ? Number(row.height) : null,
      duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
      status: row.upload_status,
      etag: row.etag,
      mediaconvert_job_id: row.mediaconvert_job_id,
      output_prefix: row.output_prefix,
      asset_uuid: row.asset_uuid,
      date_ymd: row.date_ymd,
      profile: row.profile,
      orientation: row.orientation,
      created_at: String(row.upload_created_at),
      uploaded_at: row.uploaded_at ? String(row.uploaded_at) : null,
      user_id: row.upload_user_id != null ? Number(row.upload_user_id) : null,
      space_id: spaceId,
      origin_space_id: null,
    }
    const upload = enhanceUploadRow(uploadRaw)
    const requester = row.requester_email || row.requester_display_name ? { displayName: row.requester_display_name || null, email: row.requester_email || null } : null
    return { publication, upload, requester }
  })
  return { items }
}
export async function inviteMember(spaceId: number, inviteeUserId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw new NotFoundError('space_not_found')
  const checker = await resolveChecker(currentUserId)
  const allowed = (await can(currentUserId, PERM.SPACE_INVITE_MEMBERS, { spaceId, checker })) || (await can(currentUserId, PERM.SPACE_MANAGE_MEMBERS, { spaceId, checker })) || (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))
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
  const allowed = (await can(currentUserId, PERM.SPACE_INVITE_MEMBERS, { spaceId, checker })) || (await can(currentUserId, PERM.SPACE_MANAGE_MEMBERS, { spaceId, checker })) || (await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))
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
  if (currentUserId !== inviteeUserId && !(await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))) {
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
  if (currentUserId !== inviteeUserId && !(await can(currentUserId, PERM.VIDEO_DELETE_ANY, { checker }))) {
    throw new ForbiddenError()
  }
  const [inviteRows] = await db.query(`SELECT id FROM space_invitations WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending' LIMIT 1`, [spaceId, inviteeUserId])
  const invitation = (inviteRows as any[])[0]
  if (!invitation) throw new NotFoundError('invitation_not_found')
  await db.query(`UPDATE space_invitations SET status = 'declined', responded_at = NOW() WHERE id = ?`, [invitation.id])
  return { ok: true }
}
