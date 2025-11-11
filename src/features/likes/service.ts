import { DomainError, NotFoundError } from '../../core/errors'
import { clampLimit, parseTsIdCursor } from '../../core/pagination'
import * as repo from './repo'

export async function getPublicationLikesSummary(publicationId: number, userId: number) {
  const pub = await repo.ensurePublicationExists(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  // Only allow likes summary on published content (tighten later with view checks if needed)
  if (String(pub.status) !== 'published') {
    throw new DomainError('not_published', 'not_published', 403)
  }
  return repo.getSummary(publicationId, userId)
}

export async function likePublication(publicationId: number, userId: number) {
  const pub = await repo.ensurePublicationExists(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (String(pub.status) !== 'published') {
    throw new DomainError('not_published', 'not_published', 403)
  }
  const res = await repo.like(publicationId, userId)
  return { count: res.count, liked: true }
}

export async function unlikePublication(publicationId: number, userId: number) {
  const pub = await repo.ensurePublicationExists(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (String(pub.status) !== 'published') {
    throw new DomainError('not_published', 'not_published', 403)
  }
  const res = await repo.unlike(publicationId, userId)
  return { count: res.count, liked: false }
}

export async function listPublicationLikers(publicationId: number, userId: number, opts: { limit?: number; cursor?: string | null }) {
  const pub = await repo.ensurePublicationExists(publicationId)
  if (!pub) throw new NotFoundError('publication_not_found')
  if (String(pub.status) !== 'published') {
    throw new DomainError('not_published', 'not_published', 403)
  }
  const limit = clampLimit(opts.limit, 50, 1, 200)
  const cursor = parseTsIdCursor(opts.cursor ?? null)
  const { items, nextCursor } = await repo.listLikers(publicationId, { limit, cursor })
  // Map to display_name with email fallback
  const mapped = items.map((it) => ({
    userId: it.userId,
    displayName: it.displayName || it.email || '',
    email: it.email,
    createdAt: it.createdAt,
  }))
  return { items: mapped, nextCursor }
}

