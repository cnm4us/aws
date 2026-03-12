import { getPool } from '../../db'
import type { PromptRow } from './types'

type PromptCreateInput = {
  name: string
  headline: string
  body: string | null
  ctaPrimaryLabel: string
  ctaPrimaryHref: string
  ctaSecondaryLabel: string | null
  ctaSecondaryHref: string | null
  mediaUploadId: number | null
  creativeJson: string | null
  category: string
  priority: number
  status: string
  startsAt: string | null
  endsAt: string | null
  createdBy: number
  updatedBy: number
}

type PromptUpdateInput = Partial<PromptCreateInput>

export async function list(params?: {
  limit?: number
  includeArchived?: boolean
  status?: string | null
  category?: string | null
}): Promise<PromptRow[]> {
  const db = getPool()
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where: string[] = ['1=1']
  const args: any[] = []

  if (!params?.includeArchived) {
    where.push(`status <> 'archived'`)
  }
  if (params?.status) {
    where.push('status = ?')
    args.push(params.status)
  }
  if (params?.category) {
    where.push('category = ?')
    args.push(params.category)
  }

  const [rows] = await db.query(
    `SELECT *
       FROM feed_prompts
      WHERE ${where.join(' AND ')}
      ORDER BY priority ASC, id DESC
      LIMIT ?`,
    [...args, limit]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<PromptRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM feed_prompts WHERE id = ? LIMIT 1`, [id])
  return ((rows as any[])[0] as PromptRow) || null
}

export async function create(input: PromptCreateInput): Promise<PromptRow> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO feed_prompts
      (
        name, headline, body,
        cta_primary_label, cta_primary_href,
        cta_secondary_label, cta_secondary_href,
        media_upload_id, creative_json, category, priority, status,
        starts_at, ends_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.headline,
      input.body,
      input.ctaPrimaryLabel,
      input.ctaPrimaryHref,
      input.ctaSecondaryLabel,
      input.ctaSecondaryHref,
      input.mediaUploadId,
      input.creativeJson,
      input.category,
      input.priority,
      input.status,
      input.startsAt,
      input.endsAt,
      input.createdBy,
      input.updatedBy,
    ]
  )

  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_prompt')
  return row
}

export async function update(id: number, patch: PromptUpdateInput): Promise<PromptRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []

  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.headline !== undefined) { sets.push('headline = ?'); args.push(patch.headline) }
  if (patch.body !== undefined) { sets.push('body = ?'); args.push(patch.body) }
  if (patch.ctaPrimaryLabel !== undefined) { sets.push('cta_primary_label = ?'); args.push(patch.ctaPrimaryLabel) }
  if (patch.ctaPrimaryHref !== undefined) { sets.push('cta_primary_href = ?'); args.push(patch.ctaPrimaryHref) }
  if (patch.ctaSecondaryLabel !== undefined) { sets.push('cta_secondary_label = ?'); args.push(patch.ctaSecondaryLabel) }
  if (patch.ctaSecondaryHref !== undefined) { sets.push('cta_secondary_href = ?'); args.push(patch.ctaSecondaryHref) }
  if (patch.mediaUploadId !== undefined) { sets.push('media_upload_id = ?'); args.push(patch.mediaUploadId) }
  if (patch.creativeJson !== undefined) { sets.push('creative_json = ?'); args.push(patch.creativeJson) }
  if (patch.category !== undefined) { sets.push('category = ?'); args.push(patch.category) }
  if (patch.priority !== undefined) { sets.push('priority = ?'); args.push(patch.priority) }
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status) }
  if (patch.startsAt !== undefined) { sets.push('starts_at = ?'); args.push(patch.startsAt) }
  if (patch.endsAt !== undefined) { sets.push('ends_at = ?'); args.push(patch.endsAt) }
  if (patch.updatedBy !== undefined) { sets.push('updated_by = ?'); args.push(patch.updatedBy) }

  if (!sets.length) {
    const row = await getById(id)
    if (!row) throw new Error('not_found')
    return row
  }

  await db.query(`UPDATE feed_prompts SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function listActiveForFeed(params?: {
  category?: string | null
  limit?: number
}): Promise<PromptRow[]> {
  const db = getPool()
  const limit = Math.min(Math.max(Number(params?.limit ?? 100), 1), 300)
  const where: string[] = [
    `status = 'active'`,
    `(starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())`,
    `(ends_at IS NULL OR ends_at >= UTC_TIMESTAMP())`,
  ]
  const args: any[] = []

  if (params?.category) {
    where.push('category = ?')
    args.push(params.category)
  }
  const [rows] = await db.query(
    `SELECT *
       FROM feed_prompts
      WHERE ${where.join(' AND ')}
      ORDER BY priority ASC, id DESC
      LIMIT ?`,
    [...args, limit]
  )
  return rows as any[]
}
