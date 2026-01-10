import { ForbiddenError, DomainError, NotFoundError } from '../../core/errors'
import { can, resolveChecker } from '../../security/permissions'
import { PERM } from '../../security/perm'
import * as repo from './repo'
import { type LicenseSourceKind } from './types'

export type ServiceContext = { userId: number }

function normalizeKind(kind: unknown): LicenseSourceKind {
  const k = String(kind || '').trim().toLowerCase()
  if (k === 'audio') return 'audio'
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

export async function listActiveSourcesDto(ctx: ServiceContext): Promise<{ audio: Array<{ id: number; name: string; slug: string }> }> {
  if (!ctx.userId) throw new ForbiddenError()
  const audio = await repo.listSummaries('audio')
  return { audio }
}

export async function listAdminSources(kind: unknown, opts: { includeArchived?: boolean } | undefined, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const k = normalizeKind(kind)
  return await repo.listSources(k, { includeArchived: Boolean(opts?.includeArchived) })
}

export async function createAdminSource(input: { kind: unknown; name: unknown }, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const kind = normalizeKind(input.kind)
  const name = normalizeName(input.name)
  return await repo.createSource({ kind, name })
}

export async function renameAdminSource(id: number, name: unknown, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const n = normalizeName(name)
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  await repo.renameSource(id, n)
}

export async function archiveAdminSource(id: number, archived: boolean, ctx: ServiceContext) {
  await requireSiteAdmin(ctx.userId)
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  await repo.setArchived(id, archived)
}

