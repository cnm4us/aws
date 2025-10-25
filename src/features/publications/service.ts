import { ForbiddenError, InvalidStateError, NotFoundError, DomainError } from '../../core/errors'
import * as repo from './repo'
import { resolveChecker, can } from '../../security/permissions'
import { type CreateFromProductionInput, type CreateFromUploadInput, type Publication, type PublicationEvent, type ServiceContext } from './types'

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
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const canPublishOwn = upload.user_id != null && Number(upload.user_id) === Number(ctx.userId) && (await can(ctx.userId, 'video:publish_own', { ownerId: upload.user_id, checker }))
  const canPublishSpacePerm = await can(ctx.userId, 'video:publish_space', { spaceId, checker })
  const canPostSpace = await can(ctx.userId, 'space:post', { spaceId, checker })
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
  if (space.type === 'personal') visibleInGlobal = true

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
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const canPublishOwn = Number(prod.user_id) === Number(ctx.userId) && (await can(ctx.userId, 'video:publish_own', { ownerId: prod.user_id, checker }))
  const canPublishSpacePerm = await can(ctx.userId, 'video:publish_space', { spaceId, checker })
  const canPostSpace = await can(ctx.userId, 'space:post', { spaceId, checker })
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
  if (space.type === 'personal') visibleInGlobal = true

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
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const canApprove = isAdmin || (await can(ctx.userId, 'video:approve_space', { spaceId: pub.space_id, checker })) || (await can(ctx.userId, 'video:approve', { checker }))
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
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const canReject = isAdmin || (await can(ctx.userId, 'video:approve_space', { spaceId: pub.space_id, checker })) || (await can(ctx.userId, 'video:approve', { checker }))
  if (!canReject) throw new ForbiddenError()
  const updated = await repo.updateStatus(publicationId, { status: 'rejected', unpublishedAt: new Date() })
  await repo.insertEvent(publicationId, ctx.userId, 'reject_publication', undefined)
  return updated
}

export async function unpublish(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const upload = await repo.loadUpload(pub.upload_id)
  if (!upload) throw new NotFoundError('upload_not_found')
  const ownerId = upload.user_id
  const isOwner = ownerId != null && Number(ownerId) === Number(ctx.userId) && (await can(ctx.userId, 'video:unpublish_own', { ownerId, checker }))
  const spacePerm = await can(ctx.userId, 'video:unpublish_space', { spaceId: pub.space_id, checker })
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
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const canPublishSpace = await can(ctx.userId, 'video:publish_space', { spaceId: pub.space_id, checker })

  if (isAdmin || canPublishSpace) {
    const now = new Date()
    const updated = await repo.updateStatus(publicationId, { status: 'published', approvedBy: ctx.userId, publishedAt: now, unpublishedAt: null })
    await repo.insertEvent(publicationId, ctx.userId, 'moderator_republish_published', undefined)
    return updated
  }

  const upload = await repo.loadUpload(pub.upload_id)
  if (!upload) throw new NotFoundError('upload_not_found')
  const ownerId = upload.user_id
  const isOwner = ownerId != null && Number(ownerId) === Number(ctx.userId) && (await can(ctx.userId, 'video:publish_own', { ownerId, checker }))
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

export async function listByProduction(productionId: number, _ctx: ServiceContext): Promise<Publication[]> {
  throw new InvalidStateError('not_implemented: publications.service.listByProduction')
}

export async function get(publicationId: number, _ctx: ServiceContext): Promise<{ publication: Publication; events: PublicationEvent[]; canRepublishOwner: boolean }> {
  // TODO: load pub + events; compute canRepublishOwner
  throw new NotFoundError('not_implemented: publications.service.get')
}

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
export async function listByProductionForDto(productionId: number, ctx: ServiceContext): Promise<Array<{
  id: number
  spaceId: number
  spaceName: string
  spaceType: string
  status: string
  publishedAt: string | null
  unpublishedAt: string | null
}>> {
  const p = await repo.loadProduction(productionId)
  if (!p) throw new NotFoundError('production_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
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
  }))
}

export async function getForDto(publicationId: number, ctx: ServiceContext): Promise<{
  publication: Publication
  events: PublicationEvent[]
  canRepublishOwner: boolean
}> {
  const pub = await repo.getById(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')

  // Permission: admin OR owner(publish_own) OR space moderator/publisher roles
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const upload = await repo.loadUpload(pub.upload_id)
  if (!upload) throw new NotFoundError('upload_not_found')
  const ownerId = upload.user_id
  const isOwner = ownerId != null && Number(ownerId) === Number(ctx.userId) && (await can(ctx.userId, 'video:publish_own', { ownerId, checker }))
  const canModerateSpace =
    (await can(ctx.userId, 'video:publish_space', { spaceId: pub.space_id, checker })) ||
    (await can(ctx.userId, 'video:approve_space', { spaceId: pub.space_id, checker })) ||
    (await can(ctx.userId, 'video:unpublish_space', { spaceId: pub.space_id, checker }))
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

export async function listByUploadForDto(uploadId: number, ctx: ServiceContext): Promise<Array<{
  id: number
  spaceId: number
  spaceName: string
  spaceType: string
  status: string
  publishedAt: string | null
  unpublishedAt: string | null
}>> {
  const up = await repo.loadUpload(uploadId)
  if (!up) throw new NotFoundError('upload_not_found')
  const checker = await resolveChecker(ctx.userId)
  const isAdmin = await can(ctx.userId, 'video:delete_any', { checker })
  const isOwner = up.user_id != null && Number(up.user_id) === Number(ctx.userId) && (await can(ctx.userId, 'video:publish_own', { ownerId: up.user_id, checker }))
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
  }))
}

export type NoteEventAction = 'approve_publication' | 'reject_publication' | 'unpublish_publication'

// Records a free-form note attached to a moderation action event for a publication.
// Keeps event shapes consistent and encapsulated in the publications service.
export async function recordNoteEvent(publicationId: number, userId: number, action: NoteEventAction, note: string): Promise<void> {
  const txt = String(note || '').trim()
  if (!txt) return
  await repo.insertEvent(publicationId, userId, action, { note: txt })
}
