import { getPool } from '../../db'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }

export async function getPublishedPublicationSummary(publicationId: number, db?: DbLike): Promise<{ id: number; space_id: number; production_id: number | null } | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT id, space_id, production_id
       FROM space_publications
      WHERE id = ?
        AND status = 'published'
        AND published_at IS NOT NULL
      LIMIT 1`,
    [publicationId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    id: Number(row.id),
    space_id: Number(row.space_id),
    production_id: row.production_id != null ? Number(row.production_id) : null,
  }
}

export async function hasUserReportedPublication(publicationId: number, userId: number, db?: DbLike): Promise<boolean> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT 1
       FROM space_publication_reports
      WHERE space_publication_id = ?
        AND reporter_user_id = ?
      LIMIT 1`,
    [publicationId, userId]
  )
  return (rows as any[]).length > 0
}

export async function getUserPublicationReport(
  publicationId: number,
  userId: number,
  db?: DbLike
): Promise<{ rule_id: number; rule_slug: string | null; rule_title: string | null; created_at: string } | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT spr.rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            spr.created_at
       FROM space_publication_reports spr
       JOIN rules r ON r.id = spr.rule_id
      WHERE spr.space_publication_id = ?
        AND spr.reporter_user_id = ?
      ORDER BY spr.id DESC
      LIMIT 1`,
    [publicationId, userId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    rule_id: Number(row.rule_id),
    rule_slug: row.rule_slug != null ? String(row.rule_slug) : null,
    rule_title: row.rule_title != null ? String(row.rule_title) : null,
    created_at: String(row.created_at),
  }
}

export async function listReportingRulesForSpace(
  spaceId: number,
  db?: DbLike
): Promise<
  Array<{
    category_id: number
    category_name: string
    rule_id: number
    rule_slug: string
    rule_title: string
    short_description: string | null
  }>
> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT DISTINCT
            rc.id AS category_id,
            rc.name AS category_name,
            r.id AS rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            rv.short_description AS short_description
       FROM space_cultures sc
       JOIN culture_categories cc ON cc.culture_id = sc.culture_id
       JOIN rule_categories rc ON rc.id = cc.category_id
       JOIN rules r ON r.category_id = rc.id
       JOIN rule_versions rv ON rv.id = r.current_version_id
      WHERE sc.space_id = ?
        AND r.visibility IN ('public','authenticated')
      ORDER BY rc.name ASC, r.title ASC`,
    [spaceId]
  )
  return rows as any[]
}

export async function getReportableRuleForSpace(
  spaceId: number,
  ruleId: number,
  db?: DbLike
): Promise<{ rule_id: number; current_version_id: number | null } | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT DISTINCT
            r.id AS rule_id,
            r.current_version_id
       FROM rules r
       JOIN space_cultures sc ON sc.space_id = ?
       JOIN culture_categories cc ON cc.culture_id = sc.culture_id AND cc.category_id = r.category_id
      WHERE r.id = ?
        AND r.visibility IN ('public','authenticated')
      LIMIT 1`,
    [spaceId, ruleId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    rule_id: Number(row.rule_id),
    current_version_id: row.current_version_id != null ? Number(row.current_version_id) : null,
  }
}

export async function insertSpacePublicationReport(input: {
  spacePublicationId: number
  spaceId: number
  productionId: number | null
  reporterUserId: number
  ruleId: number
  ruleVersionId: number | null
}): Promise<number> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO space_publication_reports
      (space_publication_id, space_id, production_id, reporter_user_id, rule_id, rule_version_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.spacePublicationId,
      input.spaceId,
      input.productionId,
      input.reporterUserId,
      input.ruleId,
      input.ruleVersionId,
    ]
  )
  return Number((result as any).insertId)
}
