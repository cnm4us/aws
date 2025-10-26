import * as repo from './repo'
import { assignDefaultAdminRoles, type SpaceRow } from '../../services/spaceMembership'
import { getPool } from '../../db'
import { defaultSettings, slugify } from '../spaces/util'
import { DomainError } from '../../core/errors'

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

