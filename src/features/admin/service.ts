import * as repo from './repo'
import { assignDefaultAdminRoles, assignDefaultMemberRoles, assignRoles, getDefaultMemberRoles, listSpaceMembers as listSpaceMembersSM, listSpaceInvitations as listSpaceInvitationsSM, loadSpace, removeAllRoles, type SpaceRow } from '../../services/spaceMembership'
import { getPool } from '../../db'
import { defaultSettings, slugify } from '../spaces/util'
import { DomainError } from '../../core/errors'
import { clampLimit } from '../../core/pagination'
import crypto from 'crypto'

export async function listRoles() {
  const roles = await repo.listRoles()
  return { roles }
}

export async function createSpace(input: { type: 'group' | 'channel'; name: string; slug: string }, actorUserId: number) {
  const kind = String(input.type || '').trim().toLowerCase()
  if (kind !== 'group' && kind !== 'channel') throw Object.assign(new Error('invalid_space_type'), { code: 'invalid_space_type', status: 400 })
  const title = String(input.name || '').trim()
  if (!title) throw Object.assign(new Error('invalid_name'), { code: 'invalid_name', status: 400 })
  const normSlug = slugify(String(input.slug || ''))
  if (!normSlug) throw Object.assign(new Error('invalid_slug'), { code: 'invalid_slug', status: 400 })

  if (await repo.isSlugTaken(normSlug)) {
    throw new DomainError('slug_taken', 'slug_taken', 409)
  }

  const settings = JSON.stringify(defaultSettings(kind as any))
  const id = await repo.insertSpace({ type: kind as any, ownerUserId: actorUserId, name: title, slug: normSlug, settingsJson: settings })
  const space: SpaceRow = { id, type: kind as any, owner_user_id: actorUserId }
  const db = getPool()
  await assignDefaultAdminRoles(db, space, actorUserId)
  return { id, type: kind, name: title, slug: normSlug }
}

export async function listUsers(params: { search?: string; includeDeleted?: boolean; limit?: number; offset?: number }) {
  const limit = clampLimit(params.limit, 50, 1, 200)
  const offset = Math.max(Number(params.offset || 0), 0)
  const rows = await repo.listUsers({ search: (params.search || '').trim() || undefined, includeDeleted: Boolean(params.includeDeleted), limit, offset })
  const users = rows.map((r: any) => ({
    id: Number(r.id),
    email: r.email,
    displayName: r.display_name,
    createdAt: String(r.created_at),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
    deletedAt: r.deleted_at ? String(r.deleted_at) : null,
  }))
  return { users, limit, offset }
}

function scryptHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const N = 16384
  const hash = crypto.scryptSync(password, salt, 64, { N } as any).toString('hex')
  return `s2$${N}$${salt}$${hash}`
}

export async function createUser(input: { email: string; displayName?: string; password: string; phoneNumber?: string | null; verificationLevel?: number | null; kycStatus?: string | null; canCreateGroup?: boolean | null; canCreateChannel?: boolean | null }) {
  const e = String(input.email || '').trim().toLowerCase()
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw Object.assign(new Error('invalid_email'), { code: 'invalid_email', status: 400 })
  const pw = String(input.password || '')
  if (!pw || pw.length < 8) throw Object.assign(new Error('weak_password'), { code: 'weak_password', status: 400, detail: 'min_length_8' })
  const dn = (input.displayName ? String(input.displayName) : '').trim().slice(0, 255)
  const passwordHash = scryptHash(pw)
  const allowedKyc = new Set(['none','pending','verified','rejected'])
  const kyc = input.kycStatus && allowedKyc.has(String(input.kycStatus)) ? String(input.kycStatus) : 'none'
  let cg: number | null = null; let cc: number | null = null
  if (input.canCreateGroup !== undefined) cg = input.canCreateGroup == null ? null : (input.canCreateGroup ? 1 : 0)
  if (input.canCreateChannel !== undefined) cc = input.canCreateChannel == null ? null : (input.canCreateChannel ? 1 : 0)
  const userId = await repo.insertUser({ email: e, passwordHash, displayName: dn || e, phoneNumber: input.phoneNumber ?? null, verificationLevel: input.verificationLevel ?? null, kycStatus: kyc, canCreateGroup: cg, canCreateChannel: cc })
  // Create personal space
  const slug = e.split('@')[0].replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || `user-${userId}`
  try { await repo.insertPersonalSpaceForUser(userId, dn || e, slug) } catch {}
  return { id: userId, email: e, displayName: dn || e }
}

export async function getUserSiteRoles(userId: number) {
  const roles = await repo.listUserSiteRoleNames(userId)
  return { roles }
}

export async function setUserSiteRoles(userId: number, roleNames: string[]) {
  const normalized = (Array.isArray(roleNames) ? roleNames : [])
    .map((r) => String(r || '').trim())
    .filter((r) => r.length > 0)
  const idByName = await repo.getSiteRoleIdsByNames(normalized)
  await repo.deleteAllUserSiteRoles(userId)
  const targetIds = normalized.map((n) => idByName.get(n)).filter((v): v is number => typeof v === 'number')
  if (targetIds.length) await repo.insertUserRoles(userId, targetIds)
  const accepted = normalized.filter((n) => idByName.has(n))
  return { ok: true, roles: accepted }
}

export async function getUserDetail(userId: number) {
  const u = await repo.getUserRow(userId)
  if (!u) throw Object.assign(new Error('not_found'), { code: 'not_found', status: 404 })
  return {
    id: Number(u.id),
    email: u.email,
    displayName: u.display_name,
    orgId: u.org_id != null ? Number(u.org_id) : null,
    emailVerifiedAt: u.email_verified_at ? String(u.email_verified_at) : null,
    phoneNumber: u.phone_number || null,
    phoneVerifiedAt: u.phone_verified_at ? String(u.phone_verified_at) : null,
    verificationLevel: u.verification_level != null ? Number(u.verification_level) : 0,
    kycStatus: u.kyc_status,
    canCreateGroup: u.can_create_group == null ? null : Boolean(Number(u.can_create_group)),
    canCreateChannel: u.can_create_channel == null ? null : Boolean(Number(u.can_create_channel)),
    createdAt: String(u.created_at),
    updatedAt: u.updated_at ? String(u.updated_at) : null,
    deletedAt: u.deleted_at ? String(u.deleted_at) : null,
  }
}

export async function updateUser(userId: number, input: { email?: string; displayName?: string; password?: string; orgId?: number | null; phoneNumber?: string | null; verificationLevel?: number | null; kycStatus?: string | null; canCreateGroup?: boolean | null; canCreateChannel?: boolean | null }) {
  const fields: Record<string, any> = {}
  if (input.email !== undefined) {
    const e = String(input.email || '').trim().toLowerCase()
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw Object.assign(new Error('invalid_email'), { code: 'invalid_email', status: 400 })
    fields.email = e
  }
  if (input.displayName !== undefined) fields.display_name = String(input.displayName || '').slice(0, 255)
  if (input.password !== undefined) {
    const pw = String(input.password || '')
    if (!pw || pw.length < 8) throw Object.assign(new Error('weak_password'), { code: 'weak_password', status: 400, detail: 'min_length_8' })
    fields.password_hash = scryptHash(pw)
  }
  if (input.orgId !== undefined) fields.org_id = input.orgId == null ? null : Number(input.orgId)
  if (input.phoneNumber !== undefined) fields.phone_number = input.phoneNumber == null ? null : String(input.phoneNumber)
  if (input.verificationLevel !== undefined) fields.verification_level = input.verificationLevel == null ? null : Number(input.verificationLevel)
  if (input.kycStatus !== undefined) fields.kyc_status = input.kycStatus == null ? null : String(input.kycStatus)
  if (input.canCreateGroup !== undefined) fields.can_create_group = input.canCreateGroup == null ? null : (input.canCreateGroup ? 1 : 0)
  if (input.canCreateChannel !== undefined) fields.can_create_channel = input.canCreateChannel == null ? null : (input.canCreateChannel ? 1 : 0)
  if (!Object.keys(fields).length) throw Object.assign(new Error('no_fields_to_update'), { code: 'no_fields_to_update', status: 400 })
  const affected = await repo.updateUser(userId, fields)
  if (!affected) throw Object.assign(new Error('not_found'), { code: 'not_found', status: 404 })
  return { ok: true }
}

export async function deleteUser(userId: number) {
  await repo.softDeleteUser(userId)
  return { ok: true }
}

export async function getSiteSettings() {
  const row = await repo.readSiteSettings()
  if (!row) throw Object.assign(new Error('missing_site_settings'), { code: 'missing_site_settings', status: 500 })
  const dbBool = (v: any) => Boolean(Number(v))
  return {
    allowGroupCreation: dbBool(row.allow_group_creation),
    allowChannelCreation: dbBool(row.allow_channel_creation),
    requireGroupReview: dbBool(row.require_group_review),
    requireChannelReview: dbBool(row.require_channel_review),
  }
}

export async function setSiteSettings(input: any) {
  const { allowGroupCreation, allowChannelCreation, requireGroupReview, requireChannelReview } = input || {}
  const allBools = [allowGroupCreation, allowChannelCreation, requireGroupReview, requireChannelReview]
  const valid = allBools.every((v) => typeof v === 'boolean')
  if (!valid) throw Object.assign(new Error('invalid_payload'), { code: 'invalid_payload', status: 400 })
  await repo.updateSiteSettings({ allowGroupCreation, allowChannelCreation, requireGroupReview, requireChannelReview })
  return { ok: true, allowGroupCreation, allowChannelCreation, requireGroupReview, requireChannelReview }
}

function toNullableBool(input: any): boolean | null {
  if (input === null) return null
  if (input === undefined) return null
  if (typeof input === 'boolean') return input
  if (typeof input === 'number') return input === 1
  if (typeof input === 'string') {
    const v = input.trim().toLowerCase()
    if (v === 'true' || v === '1') return true
    if (v === 'false' || v === '0') return false
    if (v === 'null' || v === '') return null
  }
  throw Object.assign(new Error('invalid_boolean'), { code: 'invalid_boolean', status: 400 })
}

function toDbValue(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0
}

export async function getUserCapabilities(userId: number) {
  const u = await repo.getUserRow(userId)
  if (!u) throw Object.assign(new Error('user_not_found'), { code: 'user_not_found', status: 404 })
  const site = await repo.readSiteSettings()
  if (!site) throw Object.assign(new Error('missing_site_settings'), { code: 'missing_site_settings', status: 500 })
  const dbBool = (v: any) => Boolean(Number(v))
  const siteGroup = dbBool(site.allow_group_creation)
  const siteChannel = dbBool(site.allow_channel_creation)
  const overrideGroup = u.can_create_group == null ? null : dbBool(u.can_create_group)
  const overrideChannel = u.can_create_channel == null ? null : dbBool(u.can_create_channel)
  return {
    userId,
    overrides: { canCreateGroup: overrideGroup, canCreateChannel: overrideChannel },
    effective: {
      canCreateGroup: overrideGroup === null ? siteGroup : overrideGroup,
      canCreateChannel: overrideChannel === null ? siteChannel : overrideChannel,
    },
    siteDefaults: { allowGroupCreation: siteGroup, allowChannelCreation: siteChannel },
  }
}

export async function setUserCapabilities(userId: number, input: { canCreateGroup?: any; canCreateChannel?: any }) {
  const fields: Record<string, any> = {}
  if (input.canCreateGroup !== undefined) {
    const v = toNullableBool(input.canCreateGroup)
    fields.can_create_group = toDbValue(v)
  }
  if (input.canCreateChannel !== undefined) {
    const v = toNullableBool(input.canCreateChannel)
    fields.can_create_channel = toDbValue(v)
  }
  if (!Object.keys(fields).length) throw Object.assign(new Error('no_fields_to_update'), { code: 'no_fields_to_update', status: 400 })
  const affected = await repo.updateUser(userId, fields)
  if (!affected) throw Object.assign(new Error('user_not_found'), { code: 'user_not_found', status: 404 })

  // Return refreshed capabilities (without siteDefaults to match prior PUT shape)
  const u = await repo.getUserRow(userId)
  const site = await repo.readSiteSettings()
  if (!u || !site) throw Object.assign(new Error('missing_context'), { code: 'missing_context', status: 500 })
  const dbBool = (v: any) => Boolean(Number(v))
  const siteGroup = dbBool(site.allow_group_creation)
  const siteChannel = dbBool(site.allow_channel_creation)
  const overrideGroup = u.can_create_group == null ? null : dbBool(u.can_create_group)
  const overrideChannel = u.can_create_channel == null ? null : dbBool(u.can_create_channel)
  return {
    userId,
    overrides: { canCreateGroup: overrideGroup, canCreateChannel: overrideChannel },
    effective: {
      canCreateGroup: overrideGroup === null ? siteGroup : overrideGroup,
      canCreateChannel: overrideChannel === null ? siteChannel : overrideChannel,
    },
  }
}

export async function listSpaceMembers(spaceId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
  const members = await listSpaceMembersSM(db, spaceId)
  return { spaceId, members }
}

export async function removeSpaceMember(spaceId: number, userId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
  await removeAllRoles(db, spaceId, userId)
  await db.query(`UPDATE space_invitations SET status = 'revoked', responded_at = NOW() WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`, [spaceId, userId])
  return { ok: true }
}

export async function listSpaceInvitations(spaceId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
  const invitations = await listSpaceInvitationsSM(db, spaceId)
  return { spaceId, invitations }
}

export async function revokeSpaceInvitation(spaceId: number, userId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
  await db.query(`UPDATE space_invitations SET status = 'revoked', responded_at = NOW() WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`, [spaceId, userId])
  return { ok: true }
}

export async function addSpaceMember(spaceId: number, targetUserId: number, rolesInput?: any) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })

  const [userRows] = await db.query(`SELECT id, email, display_name FROM users WHERE id = ? LIMIT 1`, [targetUserId])
  const user = (userRows as any[])[0]
  if (!user) throw Object.assign(new Error('user_not_found'), { code: 'user_not_found', status: 404 })

  let roleNames: string[] | null = null
  if (Array.isArray(rolesInput)) {
    roleNames = rolesInput.map((r: any) => (typeof r === 'string' ? r.trim() : String(r || '')).toLowerCase()).filter((r: string) => r.length > 0)
    if (!roleNames.length) roleNames = null
  }

  if (roleNames && roleNames.length) {
    await assignRoles(db, space, targetUserId, roleNames)
  } else {
    roleNames = getDefaultMemberRoles(space.type)
    if (!roleNames.length) throw Object.assign(new Error('no_default_roles'), { code: 'no_default_roles', status: 400 })
    await assignDefaultMemberRoles(db, space, targetUserId)
  }

  await db.query(`UPDATE space_invitations SET status = 'accepted', responded_at = NOW() WHERE space_id = ? AND invitee_user_id = ? AND status = 'pending'`, [spaceId, targetUserId])

  return {
    ok: true,
    spaceId,
    user: { id: Number(user.id), email: user.email, displayName: user.display_name },
    roles: roleNames,
  }
}

export async function listSpaces(type?: 'group' | 'channel') {
  const rows = await repo.listSpaces(type)
  const spaces = (rows as any[]).map((row) => ({
    id: Number(row.id),
    type: String(row.type),
    name: row.name,
    slug: row.slug,
    ownerUserId: row.owner_user_id ? Number(row.owner_user_id) : null,
    ownerDisplayName: row.owner_display_name || null,
  }))
  return { spaces }
}

export async function listCultures() {
  const rows = await repo.listCultures()
  const cultures = (rows as any[]).map((row) => ({
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description != null ? String(row.description) : null,
    categoryCount: Number(row.category_count || 0),
  }))
  return { cultures }
}

export async function getSpace(spaceId: number) {
  const s = await repo.getSpace(spaceId)
  if (!s) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
  const cultureIds = await repo.getSpaceCultureIds(spaceId)
  return {
    id: Number(s.id),
    type: String(s.type),
    ownerUserId: s.owner_user_id != null ? Number(s.owner_user_id) : null,
    name: s.name,
    slug: s.slug,
    settings: typeof s.settings === 'string' ? JSON.parse(s.settings) : s.settings,
    cultureIds,
  }
}

export async function updateSpace(
  spaceId: number,
  input: { name?: string; commentsPolicy?: string; requireReview?: boolean; cultureIds?: number[] }
) {
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const s = await repo.getSpace(spaceId, conn as any)
    if (!s) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })

    let settings: any = {}
    try { settings = typeof s.settings === 'string' ? JSON.parse(s.settings) : (s.settings || {}) } catch { settings = {} }
    const updates: { name?: string; settingsJson?: string } = {}
    if (input.name) updates.name = String(input.name).trim()

    let settingsChanged = false
    if (input.commentsPolicy !== undefined) {
      const cp = String(input.commentsPolicy || '').toLowerCase()
      if (!['on','off','inherit'].includes(cp)) throw Object.assign(new Error('bad_comments_policy'), { code: 'bad_comments_policy', status: 400 })
      settings = { ...(settings || {}), comments: cp }
      settingsChanged = true
    }
    if (input.requireReview !== undefined) {
      const site = await repo.readSiteSettings()
      if (!site) throw Object.assign(new Error('missing_site_settings'), { code: 'missing_site_settings', status: 500 })
      const dbBool = (v: any) => Boolean(Number(v))
      const isGroup = String(s.type) === 'group'
      const isChannel = String(s.type) === 'channel'
      const siteRequires = isGroup ? dbBool(site.require_group_review) : isChannel ? dbBool(site.require_channel_review) : false
      if (siteRequires && input.requireReview === false) {
        throw Object.assign(new Error('cannot_override_site_policy'), { code: 'cannot_override_site_policy', status: 400 })
      }
      const pub = { ...(settings?.publishing || {}) }
      pub.requireApproval = Boolean(input.requireReview)
      settings = { ...(settings || {}), publishing: pub }
      settingsChanged = true
    }
    if (settingsChanged) updates.settingsJson = JSON.stringify(settings)

    const cultureIdsProvided = input.cultureIds !== undefined
    const cultureIdsUnique = cultureIdsProvided ? Array.from(new Set((input.cultureIds || []).map((id) => Number(id)))) : []

    if (!updates.name && updates.settingsJson === undefined && !cultureIdsProvided) {
      throw Object.assign(new Error('no_fields_to_update'), { code: 'no_fields_to_update', status: 400 })
    }

    if (updates.name || updates.settingsJson !== undefined) {
      const affected = await repo.updateSpace(spaceId, updates, conn as any)
      if (!affected) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
    }

    if (cultureIdsProvided) {
      const existing = await repo.listExistingCultureIds(cultureIdsUnique, conn as any)
      const existingSet = new Set(existing.map((id) => Number(id)))
      const missing = cultureIdsUnique.filter((id) => !existingSet.has(id))
      if (missing.length) {
        throw Object.assign(new Error('unknown_culture_ids'), { code: 'unknown_culture_ids', status: 400, missing })
      }
      await repo.replaceSpaceCultureIds(spaceId, cultureIdsUnique, conn as any)
    }

    await conn.commit()
    return { ok: true }
  } catch (err) {
    try { await conn.rollback() } catch {}
    throw err
  } finally {
    try { conn.release() } catch {}
  }
}

export async function getUserSpaceRoles(spaceId: number, userId: number) {
  const roles = await repo.getSpaceUserRoleNames(spaceId, userId)
  return { roles }
}

export async function setUserSpaceRoles(spaceId: number, userId: number, roles: any[]) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) throw Object.assign(new Error('space_not_found'), { code: 'space_not_found', status: 404 })
  const normalized = (Array.isArray(roles) ? roles : []).map((r: any) => (typeof r === 'string' ? r.trim() : String(r || '')).toLowerCase()).filter((r) => r.length > 0)
  await removeAllRoles(db, spaceId, userId)
  if (normalized.length) await assignRoles(db, space, userId, normalized)
  return { ok: true, roles: normalized }
}

export async function getDevStats() {
  const db = getPool()
  const [u] = await db.query(`SELECT COUNT(*) AS c FROM uploads`)
  const [p] = await db.query(`SELECT COUNT(*) AS c FROM productions`)
  const [sp] = await db.query(`SELECT COUNT(*) AS c FROM space_publications`)
  const [spe] = await db.query(`SELECT COUNT(*) AS c FROM space_publication_events`)
  return {
    uploads: Number((u as any[])[0]?.c || 0),
    productions: Number((p as any[])[0]?.c || 0),
    spacePublications: Number((sp as any[])[0]?.c || 0),
    spacePublicationEvents: Number((spe as any[])[0]?.c || 0),
  }
}

export async function truncateContent() {
  const db = getPool()
  const tables = ['space_publication_events', 'space_publications', 'productions', 'uploads', 'action_log']
  for (const t of tables) {
    try { await db.query(`DELETE FROM ${t}`) } catch {}
  }
  const stats = await getDevStats()
  return { ok: true, remaining: stats }
}
