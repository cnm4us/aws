import { ForbiddenError, InvalidStateError, NotFoundError, DomainError } from '../../core/errors'
import * as repo from './repo'
import * as spacesRepo from '../spaces/repo'
import * as spacesSvc from '../spaces/service'
import { resolveChecker, can } from '../../security/permissions'
import { PERM } from '../../security/perm'
import { type CreateFromProductionInput, type CreateFromUploadInput, type Publication, type PublicationEvent, type ServiceContext } from './types'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3 } from '../../services/s3'

// NOTE: Service methods coordinate permissions, transactions, and events.
// Keep response objects domain-oriented; routes will map to API DTO shapes.

export async function createFromUpload(input: CreateFromUploadInput, ctx: ServiceContext): Promise<Publication> {
  const { uploadId, spaceId, visibility, distributionFlags } = input
  const upload = await repo.loadUpload(uploadId)
  if (!upload) throw new NotFoundError('upload_not_found')
  const space = await repo.loadSpace(spaceId)
  if (!space) throw new NotFoundError('space_not_found')

  // Bind to latest completed production if present
  const boundProductionId = await repo.findLatestCompletedProductionForUpload(uploadId)
  if (boundProductionId != null) {
    const existing = await repo.getByProductionSpace(boundProductionId, spaceId)
    if (existing) {
      return republish(existing.id, ctx)
    }
  }

  // Permissions
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const canPublishOwn = upload.user_id != null && Number(upload.user_id) === Number(ctx.userId) && (await can(ctx.userId, PERM.VIDEO_PUBLISH_OWN, { ownerId: upload.user_id, checker }))
  const canPublishSpacePerm = await can(ctx.userId, PERM.VIDEO_PUBLISH_SPACE, { spaceId, checker })
  const canPostSpace = await can(ctx.userId, PERM.SPACE_POST, { spaceId, checker })
  if (!isAdmin && !canPublishOwn && !canPublishSpacePerm && !canPostSpace) {
    throw new ForbiddenError()
  }

  const requireApproval = await effectiveRequiresApproval(space)
  const now = new Date()
  const status = requireApproval ? 'pending' : 'published'
  const approvedBy = requireApproval ? null : ctx.userId
  const publishedAt = requireApproval ? null : now

  let visibleInSpace = true
  let visibleInGlobal = false
  const slug = String((space as any).slug || '')
  if (slug === 'global' || slug === 'global-feed') visibleInGlobal = true

  const isPrimary = upload.origin_space_id != null && Number(upload.origin_space_id) === Number(spaceId)

  const publication = await repo.insert({
    uploadId: uploadId,
    productionId: boundProductionId ?? null,
    spaceId,
    status,
    requestedBy: ctx.userId,
    approvedBy,
    isPrimary,
    visibility: (visibility ?? 'inherit') as any,
    distributionFlags: distributionFlags ?? null,
    ownerUserId: upload.user_id ?? null,
    visibleInSpace,
    visibleInGlobal,
    publishedAt,
  })
  await repo.insertEvent(publication.id, ctx.userId, requireApproval ? 'create_pending' : 'auto_published', {
    visibility: publication.visibility,
    distribution: distributionFlags ?? null,
  })
  return publication
}

export async function createFromProduction(input: CreateFromProductionInput, ctx: ServiceContext): Promise<Publication> {
  const { productionId, spaceId, visibility, distributionFlags } = input
  const prod = await repo.loadProduction(productionId)
  if (!prod) throw new NotFoundError('production_not_found')
  const space = await repo.loadSpace(spaceId)
  if (!space) throw new NotFoundError('space_not_found')

  // If an entry already exists for (production, space), reuse republish semantics
  const existing = await repo.getByProductionSpace(productionId, spaceId)
  if (existing) {
    // Delegate to republish for consistent behavior and events
    return republish(existing.id, ctx)
  }

  // Permission checks
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const canPublishOwn = Number(prod.user_id) === Number(ctx.userId) && (await can(ctx.userId, PERM.VIDEO_PUBLISH_OWN, { ownerId: prod.user_id, checker }))
  const canPublishSpacePerm = await can(ctx.userId, PERM.VIDEO_PUBLISH_SPACE, { spaceId, checker })
  const canPostSpace = await can(ctx.userId, PERM.SPACE_POST, { spaceId, checker })
  if (!isAdmin && !canPublishOwn && !canPublishSpacePerm && !canPostSpace) {
    throw new ForbiddenError()
  }

  const requireApproval = await effectiveRequiresApproval(space)
  const now = new Date()
  const status = requireApproval ? 'pending' : 'published'
  const approvedBy = requireApproval ? null : ctx.userId
  const publishedAt = requireApproval ? null : now

  // Visibility defaults
  let visibleInSpace = true
  let visibleInGlobal = false
  const slug = String((space as any).slug || '')
  if (slug === 'global' || slug === 'global-feed') visibleInGlobal = true

  const publication = await repo.insert({
    uploadId: prod.upload_id,
    productionId,
    spaceId,
    status,
    requestedBy: ctx.userId,
    approvedBy,
    isPrimary: false,
    visibility: (visibility ?? 'inherit') as any,
    distributionFlags: distributionFlags ?? null,
    ownerUserId: prod.user_id,
    visibleInSpace,
    visibleInGlobal,
    publishedAt,
  })
  await repo.insertEvent(publication.id, ctx.userId, requireApproval ? 'create_pending' : 'auto_published', {
    visibility: publication.visibility,
    distribution: distributionFlags ?? null,
    productionId,
  })
  return publication
}

export async function approve(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const canApprove = isAdmin || (await can(ctx.userId, PERM.VIDEO_APPROVE_SPACE, { spaceId: pub.space_id, checker })) || (await can(ctx.userId, PERM.VIDEO_APPROVE, { checker }))
  if (!canApprove) throw new ForbiddenError()
  const now = new Date()
  const updated = await repo.updateStatus(publicationId, { status: 'published', approvedBy: ctx.userId, publishedAt: now, unpublishedAt: null })
  await repo.insertEvent(publicationId, ctx.userId, 'approve_publication', undefined)
  return updated
}

export async function reject(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const canReject = isAdmin || (await can(ctx.userId, PERM.VIDEO_APPROVE_SPACE, { spaceId: pub.space_id, checker })) || (await can(ctx.userId, PERM.VIDEO_APPROVE, { checker }))
  if (!canReject) throw new ForbiddenError()
  const updated = await repo.updateStatus(publicationId, { status: 'rejected', unpublishedAt: new Date() })
  await repo.insertEvent(publicationId, ctx.userId, 'reject_publication', undefined)
  return updated
}

export async function unpublish(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const upload = await repo.loadUpload(pub.upload_id)
  if (!upload) throw new NotFoundError('upload_not_found')
  const ownerId = upload.user_id
  const isOwner = ownerId != null && Number(ownerId) === Number(ctx.userId) && (await can(ctx.userId, PERM.VIDEO_UNPUBLISH_OWN, { ownerId, checker }))
  const spacePerm = await can(ctx.userId, PERM.VIDEO_UNPUBLISH_SPACE, { spaceId: pub.space_id, checker })
  if (!(isAdmin || isOwner || spacePerm)) throw new ForbiddenError()

  const now = new Date()
  const updated = await repo.updateStatus(publicationId, { status: 'unpublished', unpublishedAt: now })
  await repo.insertEvent(publicationId, ctx.userId, 'unpublish_publication', undefined)
  return updated
}

export async function republish(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  const status = String(pub.status || '')
  if (status === 'published' || status === 'pending' || status === 'approved') {
    throw new DomainError('invalid_status', 'invalid_status', 400)
  }
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const canPublishSpace = await can(ctx.userId, PERM.VIDEO_PUBLISH_SPACE, { spaceId: pub.space_id, checker })

  if (isAdmin || canPublishSpace) {
    const now = new Date()
    const updated = await repo.updateStatus(publicationId, { status: 'published', approvedBy: ctx.userId, publishedAt: now, unpublishedAt: null })
    await repo.insertEvent(publicationId, ctx.userId, 'moderator_republish_published', undefined)
    return updated
  }

  const upload = await repo.loadUpload(pub.upload_id)
  if (!upload) throw new NotFoundError('upload_not_found')
  const ownerId = upload.user_id
  const isOwner = ownerId != null && Number(ownerId) === Number(ctx.userId) && (await can(ctx.userId, PERM.VIDEO_PUBLISH_OWN, { ownerId, checker }))
  if (!isOwner) throw new ForbiddenError()
  if (status === 'rejected') throw new ForbiddenError()

  const events = await repo.listEvents(publicationId)
  const lastUnpub = [...events].reverse().find((e) => e.action === 'unpublish_publication')
  if (!lastUnpub || lastUnpub.actor_user_id !== ctx.userId) throw new ForbiddenError()

  const space = await repo.loadSpace(pub.space_id)
  const requiresApproval = await effectiveRequiresApproval(space)
  if (requiresApproval) {
    const updated = await repo.updateStatus(publicationId, { status: 'pending', approvedBy: null, publishedAt: null, unpublishedAt: null })
    await repo.insertEvent(publicationId, ctx.userId, 'owner_republish_requested', undefined)
    return updated
  } else {
    const now = new Date()
    const updated = await repo.updateStatus(publicationId, { status: 'published', approvedBy: ctx.userId, publishedAt: now, unpublishedAt: null })
    await repo.insertEvent(publicationId, ctx.userId, 'owner_republish_published', undefined)
    return updated
  }
}

export async function listByProduction(productionId: number, ctx: ServiceContext): Promise<Publication[]> {
  // Permission: admin or production owner
  const p = await repo.loadProduction(productionId)
  if (!p) throw new NotFoundError('production_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const isOwner = Number(p.user_id) === Number(ctx.userId)
  if (!isAdmin && !isOwner) throw new ForbiddenError()

  // Load publications tied to the production and expand to full records
  const rows = await repo.listPublicationsForProduction(productionId)
  const results: Publication[] = []
  for (const r of rows) {
    const pub = await repo.getById(r.id)
    if (pub) results.push(pub)
  }
  return results
}

// Domain get is defined below; keep a single implementation

export async function effectiveRequiresApproval(space: any): Promise<boolean> {
  const site = await repo.loadSiteSettings()
  if (!space) return false
  if (space.type === 'group' && site?.require_group_review) return true
  if (space.type === 'channel' && site?.require_channel_review) return true
  let settings: any = {}
  try { settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : (space.settings || {}) } catch { settings = {} }
  const publishing = settings && typeof settings === 'object' ? settings.publishing : undefined
  if (publishing && typeof publishing === 'object' && typeof publishing.requireApproval === 'boolean') {
    return publishing.requireApproval
  }
  if (space.type === 'channel') return true
  return false
}

// A minimal read-only helper specific to the current API response shape.
// Returns the existing DTO list for /api/productions/:productionId/publications.
export async function listByProductionDto(productionId: number, ctx: ServiceContext): Promise<Array<{
  id: number
  spaceId: number
  spaceName: string
  spaceType: string
  status: string
  publishedAt: string | null
  unpublishedAt: string | null
  hasStory: boolean
  storyPreview: string | null
}>> {
  const p = await repo.loadProduction(productionId)
  if (!p) throw new NotFoundError('production_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const isOwner = Number(p.user_id) === Number(ctx.userId)
  if (!isAdmin && !isOwner) throw new ForbiddenError()

  const rows = await repo.listPublicationsForProduction(productionId)
  return rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    spaceType: r.space_type,
    status: r.status,
    publishedAt: r.published_at,
    unpublishedAt: r.unpublished_at,
    hasStory: Boolean(r.has_story),
    storyPreview: r.story_preview,
  }))
}

export async function get(publicationId: number, ctx: ServiceContext): Promise<{
  publication: Publication
  events: PublicationEvent[]
  canRepublishOwner: boolean
}> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')

  // Permission: admin OR owner(publish_own) OR space moderator/publisher roles
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const upload = await repo.loadUpload(pub.upload_id)
  if (!upload) throw new NotFoundError('upload_not_found')
  const ownerId = upload.user_id
  const isOwner = ownerId != null && Number(ownerId) === Number(ctx.userId) && (await can(ctx.userId, PERM.VIDEO_PUBLISH_OWN, { ownerId, checker }))
  const canModerateSpace =
    (await can(ctx.userId, PERM.VIDEO_PUBLISH_SPACE, { spaceId: pub.space_id, checker })) ||
    (await can(ctx.userId, PERM.VIDEO_APPROVE_SPACE, { spaceId: pub.space_id, checker })) ||
    (await can(ctx.userId, PERM.VIDEO_UNPUBLISH_SPACE, { spaceId: pub.space_id, checker }))
  if (!isAdmin && !isOwner && !canModerateSpace) {
    throw new ForbiddenError()
  }

  const events = await repo.listEvents(publicationId)
  let canRepublishOwner = false
  if (pub.status === 'unpublished' && isOwner) {
    const lastUnpub = [...events].reverse().find((e) => e.action === 'unpublish_publication')
    if (lastUnpub && lastUnpub.actor_user_id === ctx.userId) canRepublishOwner = true
  }
  return { publication: pub, events, canRepublishOwner }
}

export async function listByUploadDto(uploadId: number, ctx: ServiceContext): Promise<Array<{
  id: number
  spaceId: number
  spaceName: string
  spaceType: string
  status: string
  publishedAt: string | null
  unpublishedAt: string | null
  hasStory: boolean
  storyPreview: string | null
}>> {
  const up = await repo.loadUpload(uploadId)
  if (!up) throw new NotFoundError('upload_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const isOwner = up.user_id != null && Number(up.user_id) === Number(ctx.userId) && (await can(ctx.userId, PERM.VIDEO_PUBLISH_OWN, { ownerId: up.user_id, checker }))
  if (!isAdmin && !isOwner) throw new ForbiddenError()

  const rows = await repo.listPublicationsForUpload(uploadId)
  return rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    spaceType: r.space_type,
    status: r.status,
    publishedAt: r.published_at,
    unpublishedAt: r.unpublished_at,
    hasStory: Boolean(r.has_story),
    storyPreview: r.story_preview,
  }))
}

export async function listJumpSpacesDto(publicationId: number, ctx: ServiceContext): Promise<{
  items: Array<{
    spaceId: number
    spaceUlid: string | null
    spaceName: string
    spaceSlug: string
    spaceType: string
    spaceDescription: string | null
  }>
}> {
  // Auth is enforced at the route layer; keep this method read-only and safe.
  if (!ctx.userId) throw new ForbiddenError()
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (pub.production_id == null) return { items: [] }

  const globalCandidate = await spacesRepo.findGlobalSpaceCandidate()
  const globalSpaceId = globalCandidate?.id != null ? Number(globalCandidate.id) : null

  const excludeSpaceIds: number[] = [Number(pub.space_id)]
  if (globalSpaceId != null && Number.isFinite(globalSpaceId) && globalSpaceId > 0) excludeSpaceIds.push(globalSpaceId)

  const rows = await repo.listJumpSpacesForProduction(pub.production_id, { excludeSpaceIds })
  return {
    items: rows.map((r) => ({
      spaceDescription: (() => {
        try {
          const raw = r.space_settings
          const settings = typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
          const desc = settings?.profile?.description
          const trimmed = typeof desc === 'string' ? desc.trim() : ''
          if (!trimmed) return null
          return trimmed.length > 280 ? trimmed.slice(0, 280) : trimmed
        } catch {
          return null
        }
      })(),
      spaceId: r.space_id,
      spaceUlid: r.space_ulid,
      spaceName: r.space_name,
      spaceSlug: r.space_slug,
      spaceType: r.space_type,
    })),
  }
}

export type NoteEventAction = 'approve_publication' | 'reject_publication' | 'unpublish_publication'

// Records a free-form note attached to a moderation action event for a publication.
// Keeps event shapes consistent and encapsulated in the publications service.
export async function recordNoteEvent(publicationId: number, userId: number, action: NoteEventAction, note: string): Promise<void> {
  const txt = String(note || '').trim()
  if (!txt) return
  await repo.insertEvent(publicationId, userId, action, { note: txt })
}

// Helper: compute default comments_enabled for a new publication in a space
async function computeDefaultCommentsEnabled(space: any, userId: number): Promise<number | null> {
  try {
    let settings: any = {}
    try { settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : (space.settings || {}) } catch { settings = {} }
    const cp = settings && settings.comments ? String(settings.comments).toLowerCase() : 'on'
    if (cp === 'off') return 0
    const def = await repo.getUserDefaultCommentsEnabled(userId)
    return def != null ? Number(def) : 1
  } catch { return 1 }
}

// Publish an upload to a list of spaces, returning created vs activated sets (compat with legacy route)
export async function publishUploadToSpaces(uploadId: number, spaces: number[], ctx: ServiceContext): Promise<{ ok: true; uploadId: number; created: number[]; activated: number[] }> {
  if (!Array.isArray(spaces) || !spaces.length) throw new DomainError('no_spaces', 'no_spaces', 400)
  const created: number[] = []
  const activated: number[] = []

  // Pick latest completed production if available for republish checks
  const prodId = await repo.findLatestCompletedProductionForUpload(uploadId)

  for (const spaceId of spaces) {
    // If a publication exists for (production, space), use republish path
    if (prodId != null) {
      const existing = await repo.getByProductionSpace(prodId, spaceId)
      if (existing) {
        const st = String(existing.status)
        if (st === 'published' || st === 'approved' || st === 'pending') {
          activated.push(spaceId)
          continue
        }
        await republish(existing.id, ctx)
        activated.push(spaceId)
        continue
      }
    }

    // Create a fresh publication via service
    const pub = await createFromUpload({ uploadId, spaceId, visibility: 'inherit' }, ctx)
    try {
      const space = await repo.loadSpace(spaceId)
      if (space) {
        const ce = await computeDefaultCommentsEnabled(space, ctx.userId)
        await repo.setCommentsEnabled(pub.id, ce)
      }
    } catch {}
    created.push(spaceId)
  }

  return { ok: true, uploadId, created, activated }
}

// Unpublish an upload from a list of spaces (compat with legacy route)
export async function unpublishUploadFromSpaces(uploadId: number, spaces: number[], ctx: ServiceContext): Promise<{ ok: true; uploadId: number; spaces: number[] }> {
  if (!Array.isArray(spaces) || !spaces.length) throw new DomainError('no_spaces', 'no_spaces', 400)
  const ids = await repo.listPublicationIdsForUploadSpaces(uploadId, spaces)
  for (const row of ids) {
    await unpublish(row.id, ctx)
  }
  return { ok: true, uploadId, spaces }
}

function normalizeStoryInput(input: unknown): string | null {
  const s = typeof input === 'string' ? input : String(input ?? '')
  const normalized = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.trim()
  if (!trimmed) return null
  if (normalized.length > 2000) throw new DomainError('story_too_long', 'story_too_long', 400)
  return normalized
}

export async function getStory(publicationId: number, ctx: ServiceContext): Promise<{ storyText: string | null }> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  await spacesSvc.assertCanViewSpaceFeed(pub.space_id, ctx.userId)
  const txt = pub.story_text == null ? null : String(pub.story_text)
  const trimmed = txt != null ? txt.trim() : ''
  return { storyText: trimmed ? txt : null }
}

export async function setStory(publicationId: number, storyText: unknown, ctx: ServiceContext): Promise<{ ok: true; publicationId: number }> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, PERM.VIDEO_DELETE_ANY, { checker })
  const upload = await repo.loadUpload(pub.upload_id)
  if (!upload) throw new NotFoundError('upload_not_found')
  const isOwner = upload.user_id != null && Number(upload.user_id) === Number(ctx.userId)
  if (!isAdmin && !isOwner) throw new ForbiddenError()

  const txt = normalizeStoryInput(storyText)
  await repo.updateStory(publicationId, txt)
  return { ok: true, publicationId }
}

export async function getCaptionsVtt(publicationId: number, ctx: ServiceContext): Promise<{ contentType: string; body: any }> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (pub.production_id == null) throw new NotFoundError('captions_not_found')

  await spacesSvc.assertCanViewSpaceFeed(pub.space_id, ctx.userId)

  const ptr = await repo.getCaptionsPointerByProductionId(Number(pub.production_id))
  if (!ptr) throw new NotFoundError('captions_not_found')

  const resp = await s3.send(new GetObjectCommand({ Bucket: ptr.bucket, Key: ptr.key }))
  return {
    contentType: resp.ContentType ? String(resp.ContentType) : 'text/vtt; charset=utf-8',
    body: resp.Body,
  }
}
