import { enhanceUploadRow } from '../../utils/enhance'
import { ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import * as pubsSvc from '../publications/service'
import { can, resolveChecker } from '../../security/permissions'

export type ServiceContext = { userId?: number | null }

export async function list(params: { status?: string; userId?: number; spaceId?: number; cursorId?: number; limit?: number; includePublications?: boolean }, ctx: ServiceContext) {
  const rows = await repo.list({
    status: params.status,
    userId: params.userId,
    spaceId: params.spaceId,
    cursorId: params.cursorId,
    limit: Math.min(Math.max(Number(params.limit || 50), 1), 500),
  })
  const includePubs = Boolean(params.includePublications)
  const userId = ctx.userId && Number.isFinite(ctx.userId) ? Number(ctx.userId) : null
  const result = await Promise.all(rows.map(async (row) => {
    const enhanced = enhanceUploadRow(row)
    if (includePubs && userId) {
      try {
        const pubs = await pubsSvc.listByUploadForDto(Number(row.id), { userId })
        ;(enhanced as any).publications = pubs
      } catch (e) {
        // Intentionally swallow permission errors to preserve list behavior
      }
    }
    return enhanced
  }))
  return result
}

export async function get(id: number, params: { includePublications?: boolean }, ctx: ServiceContext) {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  const enhanced = enhanceUploadRow(row)
  const includePubs = Boolean(params.includePublications)
  const userId = ctx.userId && Number.isFinite(ctx.userId) ? Number(ctx.userId) : null
  if (includePubs && userId) {
    try {
      const pubs = await pubsSvc.listByUploadForDto(Number(row.id), { userId })
      ;(enhanced as any).publications = pubs
    } catch (e) {
      // swallow permission errors; keep base upload data
    }
  }
  return enhanced
}

export async function getPublishOptions(uploadId: number, ctx: ServiceContext) {
  if (!ctx.userId) throw new ForbiddenError()
  const basic = await repo.getBasicForPublishOptions(uploadId)
  if (!basic) throw new NotFoundError('not_found')
  const currentUserId = Number(ctx.userId)
  const ownerId = basic.user_id
  const originSpaceId = basic.origin_space_id

  const checker = await resolveChecker(currentUserId)
  const allowedOwner = ownerId != null && (await can(currentUserId, 'video:publish_own', { ownerId, checker }))
  const allowedOrigin = originSpaceId ? await can(currentUserId, 'video:publish_space', { spaceId: originSpaceId, checker }) : false
  const allowedAdmin = await can(currentUserId, 'video:publish_space', { checker })
  if (!allowedOwner && !allowedOrigin && !allowedAdmin) {
    throw new ForbiddenError()
  }

  const spaces: { id: number; name: string; slug: string; type: string }[] = []

  if (ownerId != null) {
    const personal = await repo.findPersonalSpaceForOwner(ownerId)
    if (personal) spaces.push(personal)
  }

  const publishable = await repo.listSpacesUserCanPublish(currentUserId)
  for (const row of publishable) {
    if (!spaces.some((s) => s.id === row.id)) spaces.push(row)
  }

  return {
    uploadId,
    spaces: spaces.map((s) => ({ id: s.id, name: s.name, slug: s.slug, type: s.type })),
  }
}
