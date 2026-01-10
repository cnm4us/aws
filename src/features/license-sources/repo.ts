import { getPool } from '../../db'
import { type LicenseSource, type LicenseSourceKind, type LicenseSourceSummary } from './types'

function slugifyName(input: string): string {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return ''
  const cleaned = s
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 140)
}

function mapRow(r: any): LicenseSource {
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

export async function listSources(kind: LicenseSourceKind, opts?: { includeArchived?: boolean }): Promise<LicenseSource[]> {
  const db = getPool()
  const includeArchived = Boolean(opts?.includeArchived)
  const [rows] = await db.query(
    `SELECT id, kind, name, slug, sort_order, archived_at, created_at, updated_at
       FROM license_sources
      WHERE kind = ?
        ${includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY sort_order ASC, name ASC, id ASC`,
    [kind]
  )
  return (rows as any[]).map(mapRow)
}

export async function listSummaries(kind: LicenseSourceKind): Promise<LicenseSourceSummary[]> {
  const rows = await listSources(kind, { includeArchived: false })
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug }))
}

export async function getById(id: number): Promise<LicenseSource | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, kind, name, slug, sort_order, archived_at, created_at, updated_at
       FROM license_sources
      WHERE id = ?
      LIMIT 1`,
    [id]
  )
  const r = (rows as any[])[0]
  return r ? mapRow(r) : null
}

export async function createSource(input: { kind: LicenseSourceKind; name: string; sortOrder?: number | null }): Promise<LicenseSource> {
  const db = getPool()
  const kind = input.kind
  const name = String(input.name || '').trim()
  const slug = slugifyName(name)
  const sortOrder = input.sortOrder != null && Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0
  const [result] = await db.query(
    `INSERT INTO license_sources (kind, name, slug, sort_order) VALUES (?, ?, ?, ?)`,
    [kind, name, slug, Math.round(sortOrder)]
  )
  const id = Number((result as any).insertId)
  const created = await getById(id)
  if (!created) throw new Error('failed_to_create_license_source')
  return created
}

export async function renameSource(id: number, name: string): Promise<void> {
  const db = getPool()
  const nm = String(name || '').trim()
  await db.query(
    `UPDATE license_sources
        SET name = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [nm, id]
  )
}

export async function setArchived(id: number, archived: boolean): Promise<void> {
  const db = getPool()
  await db.query(
    `UPDATE license_sources
        SET archived_at = ${archived ? 'COALESCE(archived_at, CURRENT_TIMESTAMP)' : 'NULL'},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [id]
  )
}

