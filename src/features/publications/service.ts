import { ForbiddenError, InvalidStateError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import { resolveChecker, can } from '../../security/permissions'
import { type CreateFromProductionInput, type CreateFromUploadInput, type Publication, type PublicationEvent, type ServiceContext } from './types'

// NOTE: Service methods coordinate permissions, transactions, and events.
// Keep response objects domain-oriented; routes will map to API DTO shapes.

export async function createFromUpload(input: CreateFromUploadInput, ctx: ServiceContext): Promise<Publication> {
  // TODO: begin txn
  // 1) Load upload + space
  // 2) Permission checks using ctx.userId / ctx.checker
  // 3) Resolve latest completed production for upload (if present)
  // 4) Upsert/idempotency on (productionId, spaceId); apply review policy (pending vs published)
  // 5) Insert event (create_pending | auto_published)
  // 6) commit and return
  throw new InvalidStateError('not_implemented: publications.service.createFromUpload')
}

export async function createFromProduction(input: CreateFromProductionInput, ctx: ServiceContext): Promise<Publication> {
  // Similar to createFromUpload, but explicit productionId
  throw new InvalidStateError('not_implemented: publications.service.createFromProduction')
}

export async function approve(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  // TODO: permission checks, transition to published, event
  throw new InvalidStateError('not_implemented: publications.service.approve')
}

export async function reject(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  // TODO: permission checks, transition to rejected, event
  throw new InvalidStateError('not_implemented: publications.service.reject')
}

export async function unpublish(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  // TODO: permission checks, transition to unpublished, event
  throw new InvalidStateError('not_implemented: publications.service.unpublish')
}

export async function republish(publicationId: number, ctx: ServiceContext): Promise<Publication> {
  // TODO: owner vs moderator paths; idempotency
  throw new InvalidStateError('not_implemented: publications.service.republish')
}

export async function listByProduction(productionId: number, _ctx: ServiceContext): Promise<Publication[]> {
  throw new InvalidStateError('not_implemented: publications.service.listByProduction')
}

export async function get(publicationId: number, _ctx: ServiceContext): Promise<{ publication: Publication; events: PublicationEvent[]; canRepublishOwner: boolean }> {
  // TODO: load pub + events; compute canRepublishOwner
  throw new NotFoundError('not_implemented: publications.service.get')
}

export async function effectiveRequiresApproval(_space: any): Promise<boolean> {
  // TODO: site/space precedence with channel default true
  return true
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
