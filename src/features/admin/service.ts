import * as repo from './repo'
import { assignDefaultAdminRoles, type SpaceRow } from '../../services/spaceMembership'
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
