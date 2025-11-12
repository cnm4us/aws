import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import { clampLimit, parseTsIdCursor } from '../../core/pagination'
import * as repo from './repo'
import { resolveChecker, can } from '../../security/permissions'
import { PERM } from '../../security/perm'

export async function assertCanViewAndPost(pubId: number, userId: number): Promise<{ spaceId: number }> {
  const pub = await repo.ensurePublicationForComments(pubId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (String(pub.status) !== 'published') throw new DomainError('not_published', 'not_published', 403)
  if (pub.comments_enabled != null && Number(pub.comments_enabled) === 0) throw new DomainError('comments_disabled', 'comments_disabled', 403)
  // Require site_member baseline comment create permission
  const checker = await resolveChecker(userId)
  const allowed = await can(userId, PERM.COMMENT_CREATE, { checker })
  if (!allowed) throw new ForbiddenError()
  return { spaceId: pub.space_id }
}

export async function assertCanModerate(pubId: number, userId: number): Promise<{ spaceId: number }> {
  const pub = await repo.ensurePublicationForComments(pubId)
  if (!pub) throw new NotFoundError('publication_not_found')
  const checker = await resolveChecker(userId)
  const canMod = await can(userId, PERM.COMMENT_MODERATE, { spaceId: pub.space_id, checker })
  if (!canMod) throw new ForbiddenError()
  return { spaceId: pub.space_id }
}

export async function create(pubId: number, userId: number, body: string, parentId: number | null) {
  const text = String(body || '').trim()
  if (!text || text.length > 2000) throw new DomainError('bad_body', 'bad_body', 400)
  await assertCanViewAndPost(pubId, userId)
  const id = await repo.createComment(pubId, userId, text, parentId)
  // Increment counter for any visible comment (top-level or reply)
  await repo.incrementCount(pubId, 1)
  return { id }
}

export async function listTop(pubId: number, userId: number, opts: { limit?: number; cursor?: string | null; order?: 'oldest' | 'newest' }) {
  const pub = await repo.ensurePublicationForComments(pubId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (String(pub.status) !== 'published') throw new DomainError('not_published', 'not_published', 403)
  const limit = clampLimit(opts.limit, 50, 1, 200)
  const cursor = parseTsIdCursor(opts.cursor ?? null)
  const oldestFirst = (opts.order || 'oldest') === 'oldest'
  const data = await repo.listTopLevel(pubId, { limit, cursor, oldestFirst })
  return data
}

export async function listReplies(pubId: number, userId: number, parentId: number, opts: { limit?: number; cursor?: string | null; order?: 'oldest' | 'newest' }) {
  const pub = await repo.ensurePublicationForComments(pubId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (String(pub.status) !== 'published') throw new DomainError('not_published', 'not_published', 403)
  const limit = clampLimit(opts.limit, 50, 1, 200)
  const cursor = parseTsIdCursor(opts.cursor ?? null)
  const oldestFirst = (opts.order || 'oldest') === 'oldest'
  const data = await repo.listReplies(pubId, parentId, { limit, cursor, oldestFirst })
  return data
}

export async function deleteComment(pubId: number, commentId: number, actorId: number) {
  const { spaceId } = await assertCanModerate(pubId, actorId)
  await repo.softDeleteComment(commentId)
  await repo.incrementCount(pubId, -1)
  return { ok: true }
}

