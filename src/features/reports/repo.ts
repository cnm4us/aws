import { getPool } from '../../db'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }
export type ReportingViewerState = 'anonymous' | 'authenticated'

function visibilityFilterSql(viewerState: ReportingViewerState): { sql: string; params: string[] } {
  if (viewerState === 'authenticated') return { sql: `IN ('public','authenticated')`, params: [] }
  return { sql: `IN ('public')`, params: [] }
}

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
): Promise<{
  rule_id: number
  rule_slug: string | null
  rule_title: string | null
  created_at: string
  user_facing_rule_id: number | null
  user_facing_rule_label_at_submit: string | null
  user_facing_group_key_at_submit: string | null
  user_facing_group_label_at_submit: string | null
} | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT spr.rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            spr.created_at,
            spr.user_facing_rule_id,
            spr.user_facing_rule_label_at_submit,
            spr.user_facing_group_key_at_submit,
            spr.user_facing_group_label_at_submit
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
    user_facing_rule_id: row.user_facing_rule_id == null ? null : Number(row.user_facing_rule_id),
    user_facing_rule_label_at_submit:
      row.user_facing_rule_label_at_submit == null ? null : String(row.user_facing_rule_label_at_submit),
    user_facing_group_key_at_submit:
      row.user_facing_group_key_at_submit == null ? null : String(row.user_facing_group_key_at_submit),
    user_facing_group_label_at_submit:
      row.user_facing_group_label_at_submit == null ? null : String(row.user_facing_group_label_at_submit),
  }
}

export async function listReportingRulesForSpace(
  spaceId: number,
  viewerState: ReportingViewerState = 'authenticated',
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
  const visibility = visibilityFilterSql(viewerState)
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
        AND r.visibility ${visibility.sql}
      ORDER BY rc.name ASC, r.title ASC`,
    [spaceId, ...visibility.params]
  )
  return rows as any[]
}

export async function listUserFacingReportingReasonsForSpace(
  spaceId: number,
  viewerState: ReportingViewerState = 'authenticated',
  db?: DbLike
): Promise<
  Array<{
    user_facing_rule_id: number
    label: string
    short_description: string | null
    group_key: string | null
    group_label: string | null
    group_order: number
    display_order: number
    rule_id: number
    rule_slug: string
    rule_title: string
    rule_short_description: string | null
    priority: number
    is_default: number
  }>
> {
  const q = (db as any) || getPool()
  const visibility = visibilityFilterSql(viewerState)
  const [rows] = await q.query(
    `SELECT DISTINCT
            ufr.id AS user_facing_rule_id,
            ufr.label,
            ufr.short_description,
            ufr.group_key,
            ufr.group_label,
            ufr.group_order,
            ufr.display_order,
            r.id AS rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            rv.short_description AS rule_short_description,
            m.priority,
            m.is_default
       FROM user_facing_rules ufr
       JOIN user_facing_rule_rule_map m
         ON m.user_facing_rule_id = ufr.id
       JOIN rules r
         ON r.id = m.rule_id
  LEFT JOIN rule_versions rv
         ON rv.id = r.current_version_id
       JOIN space_cultures sc
         ON sc.space_id = ?
       JOIN culture_categories cc
         ON cc.culture_id = sc.culture_id
        AND cc.category_id = r.category_id
      WHERE ufr.is_active = 1
        AND r.visibility ${visibility.sql}
      ORDER BY ufr.group_order ASC,
               ufr.group_label ASC,
               ufr.display_order ASC,
               ufr.label ASC,
               m.is_default DESC,
               m.priority ASC,
               r.id ASC`,
    [spaceId, ...visibility.params]
  )
  return rows as any[]
}

export async function getReportableRuleForSpace(
  spaceId: number,
  ruleId: number,
  viewerState: ReportingViewerState = 'authenticated',
  db?: DbLike
): Promise<{ rule_id: number; current_version_id: number | null } | null> {
  const q = (db as any) || getPool()
  const visibility = visibilityFilterSql(viewerState)
  const [rows] = await q.query(
    `SELECT DISTINCT
            r.id AS rule_id,
            r.current_version_id
       FROM rules r
       JOIN space_cultures sc ON sc.space_id = ?
      JOIN culture_categories cc ON cc.culture_id = sc.culture_id AND cc.category_id = r.category_id
      WHERE r.id = ?
        AND r.visibility ${visibility.sql}
      LIMIT 1`,
    [spaceId, ruleId, ...visibility.params]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    rule_id: Number(row.rule_id),
    current_version_id: row.current_version_id != null ? Number(row.current_version_id) : null,
  }
}

export async function resolveDefaultMappedRuleForUserFacingReason(input: {
  spaceId: number
  userFacingRuleId: number
  viewerState?: ReportingViewerState
  db?: DbLike
}): Promise<{ rule_id: number; current_version_id: number | null } | null> {
  const q = (input.db as any) || getPool()
  const visibility = visibilityFilterSql(input.viewerState || 'authenticated')
  const [rows] = await q.query(
    `SELECT r.id AS rule_id,
            r.current_version_id
       FROM user_facing_rules ufr
       JOIN user_facing_rule_rule_map m
         ON m.user_facing_rule_id = ufr.id
       JOIN rules r
         ON r.id = m.rule_id
       JOIN space_cultures sc
         ON sc.space_id = ?
       JOIN culture_categories cc
         ON cc.culture_id = sc.culture_id
        AND cc.category_id = r.category_id
      WHERE ufr.id = ?
        AND ufr.is_active = 1
        AND r.visibility ${visibility.sql}
      ORDER BY m.is_default DESC,
               m.priority ASC,
               r.id ASC
      LIMIT 1`,
    [input.spaceId, input.userFacingRuleId, ...visibility.params]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    rule_id: Number(row.rule_id),
    current_version_id: row.current_version_id != null ? Number(row.current_version_id) : null,
  }
}

export async function getUserFacingReasonSummary(
  userFacingRuleId: number,
  db?: DbLike
): Promise<{ id: number; label: string; group_key: string | null; group_label: string | null } | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT id, label, group_key, group_label
       FROM user_facing_rules
      WHERE id = ?
        AND is_active = 1
      LIMIT 1`,
    [userFacingRuleId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    id: Number(row.id),
    label: String(row.label || ''),
    group_key: row.group_key != null ? String(row.group_key) : null,
    group_label: row.group_label != null ? String(row.group_label) : null,
  }
}

export async function getVisibleUserFacingReasonForRule(input: {
  spaceId: number
  ruleId: number
  viewerState?: ReportingViewerState
  db?: DbLike
}): Promise<{ user_facing_rule_id: number; label: string; group_key: string | null; group_label: string | null } | null> {
  const q = (input.db as any) || getPool()
  const visibility = visibilityFilterSql(input.viewerState || 'authenticated')
  const [rows] = await q.query(
    `SELECT ufr.id AS user_facing_rule_id,
            ufr.label,
            ufr.group_key,
            ufr.group_label
       FROM user_facing_rules ufr
       JOIN user_facing_rule_rule_map m
         ON m.user_facing_rule_id = ufr.id
       JOIN rules r
         ON r.id = m.rule_id
       JOIN space_cultures sc
         ON sc.space_id = ?
       JOIN culture_categories cc
         ON cc.culture_id = sc.culture_id
        AND cc.category_id = r.category_id
      WHERE ufr.is_active = 1
        AND r.id = ?
        AND r.visibility ${visibility.sql}
      ORDER BY ufr.group_order ASC,
               ufr.display_order ASC,
               ufr.id ASC
      LIMIT 1`,
    [input.spaceId, input.ruleId, ...visibility.params]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    user_facing_rule_id: Number(row.user_facing_rule_id),
    label: String(row.label || ''),
    group_key: row.group_key == null ? null : String(row.group_key),
    group_label: row.group_label == null ? null : String(row.group_label),
  }
}

export async function insertSpacePublicationReport(input: {
  spacePublicationId: number
  spaceId: number
  productionId: number | null
  reporterUserId: number
  ruleId: number
  ruleVersionId: number | null
  userFacingRuleId?: number | null
  userFacingRuleLabelAtSubmit?: string | null
  userFacingGroupKeyAtSubmit?: string | null
  userFacingGroupLabelAtSubmit?: string | null
}): Promise<number> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO space_publication_reports
      (space_publication_id, space_id, production_id, reporter_user_id, rule_id, rule_version_id, user_facing_rule_id, user_facing_rule_label_at_submit, user_facing_group_key_at_submit, user_facing_group_label_at_submit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.spacePublicationId,
      input.spaceId,
      input.productionId,
      input.reporterUserId,
      input.ruleId,
      input.ruleVersionId,
      input.userFacingRuleId ?? null,
      input.userFacingRuleLabelAtSubmit ?? null,
      input.userFacingGroupKeyAtSubmit ?? null,
      input.userFacingGroupLabelAtSubmit ?? null,
    ]
  )
  return Number((result as any).insertId)
}
