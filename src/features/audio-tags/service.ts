import { ForbiddenError, DomainError, NotFoundError } from '../../core/errors'
import { can, resolveChecker } from '../../security/permissions'
import { PERM } from '../../security/perm'
import * as repo from './repo'
import { type AudioTagKind } from './types'

export type ServiceContext = { userId: number }

function normalizeKind(kind: unknown): AudioTagKind {
  const k = String(kind || '').trim().toLowerCase()
  if (k === 'genre' || k === 'mood' || k === 'theme' || k === 'instrument') return k
  throw new DomainError('invalid_kind', 'invalid_kind', 400)
}

function normalizeName(name: unknown): string {
  const n = String(name || '').trim()
  if (!n) throw new DomainError('name_required', 'name_required', 400)
  if (n.length > 120) throw new DomainError('name_too_long', 'name_too_long', 400)
  return n
}

async function requireSiteAdmin(userId: number) {
  const checker = await resolveChecker(userId)
  const ok = await can(userId, PERM.VIDEO_DELETE_ANY, { checker })
  if (!ok) throw new ForbiddenError()
}

export async function listActiveTagsDto(ctx: ServiceContext): Promise<{
  genres: Array<{ id: number; name: string; slug: string }>
  moods: Array<{ id: number; name: string; slug: string }>
  themes: Array<{ id: number; name: string; slug: string }>
  instruments: Array<{ id: number; name: string; slug: string }>
}> {
  if (!ctx.userId) throw new ForbiddenError()
  const [genres, moods, themes, instruments] = await Promise.all([
    repo.listTagSummariesByKind('genre'),
    repo.listTagSummariesByKind('mood'),
    repo.listTagSummariesByKind('theme'),
    repo.listTagSummariesByKind('instrument'),
  ])
  return { genres, moods, themes, instruments }
}

export async function listAdminTags(kind: unknown, opts: { includeArchived?: boolean } | undefined, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const k = normalizeKind(kind)
  return await repo.listTags(k, { includeArchived: Boolean(opts?.includeArchived) })
}

export async function createAdminTag(input: { kind: unknown; name: unknown }, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const kind = normalizeKind(input.kind)
  const name = normalizeName(input.name)
  return await repo.createTag({ kind, name })
}

export async function renameAdminTag(id: number, name: unknown, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const n = normalizeName(name)
  const existing = await repo.getTagById(id)
  if (!existing) throw new NotFoundError('not_found')
  await repo.renameTag(id, n)
}

export async function archiveAdminTag(id: number, archived: boolean, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const existing = await repo.getTagById(id)
  if (!existing) throw new NotFoundError('not_found')
  await repo.setArchived(id, archived)
}
