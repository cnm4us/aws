import { getPool } from '../../db'
import { type AudioTag, type AudioTagKind, type AudioTagSummary } from './types'

function slugifyName(input: string): string {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return ''
  const cleaned = s
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 140)
}

function mapTag(r: any): AudioTag {
  return {
    id: Number(r.id),
    kind: String(r.kind) as any,
    name: String(r.name || ''),
    slug: String(r.slug || ''),
    sort_order: Number(r.sort_order || 0),
    archived_at: r.archived_at == null ? null : String(r.archived_at),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at || r.created_at),
  }
}

export async function listTags(kind: AudioTagKind, opts?: { includeArchived?: boolean }): Promise<AudioTag[]> {
  const db = getPool()
  const includeArchived = Boolean(opts?.includeArchived)
  const [rows] = await db.query(
    `SELECT id, kind, name, slug, sort_order, archived_at, created_at, updated_at
       FROM audio_tags
      WHERE kind = ?
        ${includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY sort_order ASC, name ASC, id ASC`,
    [kind]
  )
  return (rows as any[]).map(mapTag)
}

export async function getTagById(id: number): Promise<AudioTag | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, kind, name, slug, sort_order, archived_at, created_at, updated_at
       FROM audio_tags
      WHERE id = ?
      LIMIT 1`,
    [id]
  )
  const r = (rows as any[])[0]
  return r ? mapTag(r) : null
}

export async function createTag(input: { kind: AudioTagKind; name: string; sortOrder?: number | null }): Promise<AudioTag> {
  const db = getPool()
  const name = String(input.name || '').trim()
  const kind = input.kind
  const slug = slugifyName(name)
  const sortOrder = input.sortOrder != null && Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0
  const [result] = await db.query(
    `INSERT INTO audio_tags (kind, name, slug, sort_order) VALUES (?, ?, ?, ?)`,
    [kind, name, slug, Math.round(sortOrder)]
  )
  const id = Number((result as any).insertId)
  const created = await getTagById(id)
  if (!created) throw new Error('failed_to_create_audio_tag')
  return created
}

export async function renameTag(id: number, name: string): Promise<void> {
  const db = getPool()
  const nm = String(name || '').trim()
  await db.query(
    `UPDATE audio_tags
        SET name = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [nm, id]
  )
}

export async function setArchived(id: number, archived: boolean): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE audio_tags
        SET archived_at = ${archived ? 'COALESCE(archived_at, CURRENT_TIMESTAMP)' : 'NULL'},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [id]
  )
}

export async function listTagSummariesByKind(kind: AudioTagKind): Promise<AudioTagSummary[]> {
  const tags = await listTags(kind, { includeArchived: false })
  return tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))
}

export async function listTagAssignmentsForUploadIds(uploadIds: number[]): Promise<
  Map<number, { genreTagIds: number[]; moodTagIds: number[]; themeTagIds: number[]; instrumentTagIds: number[] }>
> {
  const ids = Array.isArray(uploadIds) ? uploadIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : []
  const out = new Map<number, { genreTagIds: number[]; moodTagIds: number[]; themeTagIds: number[]; instrumentTagIds: number[] }>()
  if (!ids.length) return out
  const db = getPool()
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await db.query(
    `SELECT uat.upload_id, t.id AS tag_id, t.kind
       FROM upload_audio_tags uat
       JOIN audio_tags t ON t.id = uat.tag_id
      WHERE uat.upload_id IN (${placeholders})
        AND t.archived_at IS NULL
      ORDER BY uat.upload_id ASC, t.kind ASC, t.sort_order ASC, t.name ASC, t.id ASC`,
    ids
  )
  for (const r of rows as any[]) {
    const uploadId = Number(r.upload_id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) continue
    const tagId = Number(r.tag_id)
    const kind = String(r.kind || '').toLowerCase()
    const current = out.get(uploadId) || { genreTagIds: [], moodTagIds: [], themeTagIds: [], instrumentTagIds: [] }
    if (kind === 'genre') current.genreTagIds.push(tagId)
    else if (kind === 'mood') current.moodTagIds.push(tagId)
    else if (kind === 'theme') current.themeTagIds.push(tagId)
    else if (kind === 'instrument') current.instrumentTagIds.push(tagId)
    out.set(uploadId, current)
  }
  return out
}

export async function listTagIdsForUpload(uploadId: number): Promise<number[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT tag_id FROM upload_audio_tags WHERE upload_id = ? ORDER BY tag_id ASC`,
    [uploadId]
  )
  return (rows as any[]).map((r) => Number(r.tag_id)).filter((n) => Number.isFinite(n) && n > 0)
}

export async function replaceUploadTags(uploadId: number, tagIds: number[]): Promise<void> {
  const ids = Array.isArray(tagIds) ? tagIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : []
  const unique = Array.from(new Set(ids))
  const db = getPool()
  await db.query(`DELETE FROM upload_audio_tags WHERE upload_id = ?`, [uploadId])
  if (!unique.length) return
  const values = unique.map(() => '(?, ?)').join(',')
  const args: any[] = []
  for (const tid of unique) {
    args.push(uploadId, tid)
  }
  await db.query(`INSERT IGNORE INTO upload_audio_tags (upload_id, tag_id) VALUES ${values}`, args)
}
