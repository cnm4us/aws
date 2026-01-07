import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors'
import * as repo from './repo'
import type { InsetPreset, LowerThirdConfigurationDto, LowerThirdConfigurationRow, LowerThirdFade, LowerThirdPosition, LowerThirdTimingRule } from './types'

function normalizeName(raw: any): string {
  const name = String(raw ?? '').trim()
  if (!name) throw new DomainError('invalid_name', 'invalid_name', 400)
  if (name.length > 120) throw new DomainError('invalid_name', 'invalid_name', 400)
  return name
}

function normalizePosition(_raw: any): LowerThirdPosition {
  // MVP restriction: bottom_center only.
  return 'bottom_center'
}

function normalizeInsetPreset(raw: any): InsetPreset | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (s === 'small' || s === 'medium' || s === 'large') return s as InsetPreset
  throw new DomainError('invalid_inset', 'invalid_inset', 400)
}

function normalizeTimingRule(raw: any): LowerThirdTimingRule {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'first_only'
  if (s === 'first_n' || s === 'first' || s === 'first_only') return 'first_only'
  if (s === 'entire' || s === 'till_end' || s === 'end') return 'entire'
  throw new DomainError('invalid_timing_rule', 'invalid_timing_rule', 400)
}

const DURATION_OPTIONS = [5, 10, 15, 20] as const

function normalizeTimingSeconds(rule: LowerThirdTimingRule, raw: any): number | null {
  if (rule === 'entire') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return 10
  const s = Math.round(n)
  if (!DURATION_OPTIONS.includes(s as any)) throw new DomainError('invalid_timing_seconds', 'invalid_timing_seconds', 400)
  return s
}

function normalizeFade(raw: any): LowerThirdFade {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'none'
  if (s === 'none' || s === 'in' || s === 'out' || s === 'in_out') return s as LowerThirdFade
  throw new DomainError('invalid_fade', 'invalid_fade', 400)
}

function clampInt(raw: any, min: number, max: number): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

function mapRow(row: LowerThirdConfigurationRow): LowerThirdConfigurationDto {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    position: 'bottom_center',
    sizePctWidth: clampInt(row.size_pct_width, 1, 100),
    opacityPct: clampInt(row.opacity_pct, 0, 100),
    timingRule: (String(row.timing_rule || '').toLowerCase() === 'entire' ? 'entire' : 'first_only') as LowerThirdTimingRule,
    timingSeconds: row.timing_seconds == null ? null : Number(row.timing_seconds),
    fade: (['none', 'in', 'out', 'in_out'].includes(String(row.fade || '').toLowerCase()) ? String(row.fade).toLowerCase() : 'none') as LowerThirdFade,
    insetXPreset: row.inset_x_preset == null ? null : (String(row.inset_x_preset).toLowerCase() as any),
    insetYPreset: row.inset_y_preset == null ? null : (String(row.inset_y_preset).toLowerCase() as any),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
  }
}

export async function listForUser(userId: number, opts: { includeArchived?: boolean; limit?: number } = {}) {
  const rows = await repo.listForUser(userId, opts)
  return rows.map(mapRow)
}

export async function getForUser(id: number, userId: number): Promise<LowerThirdConfigurationDto> {
  const row = await repo.getById(id)
  if (!row) throw new NotFoundError('not_found')
  if (Number(row.owner_user_id) !== Number(userId)) throw new ForbiddenError()
  return mapRow(row)
}

export async function getActiveForUser(id: number, userId: number): Promise<LowerThirdConfigurationDto> {
  const cfg = await getForUser(id, userId)
  if (cfg.archivedAt) throw new DomainError('archived', 'archived', 400)
  return cfg
}

export async function createForUser(
  input: {
    name: any
    sizePctWidth: any
    opacityPct: any
    timingRule: any
    timingSeconds: any
    fade: any
    insetYPreset?: any
  },
  userId: number
) {
  const name = normalizeName(input.name)
  const position = normalizePosition(null)
  const sizePctWidth = clampInt(input.sizePctWidth ?? 82, 1, 100)
  const opacityPct = clampInt(input.opacityPct ?? 100, 0, 100)
  const timingRule = normalizeTimingRule(input.timingRule)
  const timingSeconds = normalizeTimingSeconds(timingRule, input.timingSeconds)
  const fade = normalizeFade(input.fade)
  const insetYPreset = normalizeInsetPreset(input.insetYPreset)

  const id = await repo.insert({
    ownerUserId: userId,
    name,
    position,
    sizePctWidth,
    opacityPct,
    timingRule,
    timingSeconds,
    fade,
    insetXPreset: null,
    insetYPreset,
  })
  return await getForUser(id, userId)
}

export async function updateForUser(
  id: number,
  input: {
    name: any
    sizePctWidth: any
    opacityPct: any
    timingRule: any
    timingSeconds: any
    fade: any
    insetYPreset?: any
  },
  userId: number
) {
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  if (Number(existing.owner_user_id) !== Number(userId)) throw new ForbiddenError()

  const name = normalizeName(input.name)
  const position = normalizePosition(null)
  const sizePctWidth = clampInt(input.sizePctWidth ?? existing.size_pct_width, 1, 100)
  const opacityPct = clampInt(input.opacityPct ?? existing.opacity_pct, 0, 100)
  const timingRule = normalizeTimingRule(input.timingRule ?? existing.timing_rule)
  const timingSeconds = normalizeTimingSeconds(timingRule, input.timingSeconds ?? existing.timing_seconds)
  const fade = normalizeFade(input.fade ?? existing.fade)
  const insetYPreset = normalizeInsetPreset(input.insetYPreset ?? existing.inset_y_preset)

  await repo.update(id, {
    name,
    position,
    sizePctWidth,
    opacityPct,
    timingRule,
    timingSeconds,
    fade,
    insetXPreset: null,
    insetYPreset,
  })
  return await getForUser(id, userId)
}

export async function archiveForUser(id: number, userId: number) {
  const existing = await repo.getById(id)
  if (!existing) throw new NotFoundError('not_found')
  if (Number(existing.owner_user_id) !== Number(userId)) throw new ForbiddenError()
  await repo.archive(id)
  return { ok: true }
}

