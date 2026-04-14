import { getPool } from '../../db'

type DbLike = { query: (sql: string, params?: any[]) => Promise<any> }
export type ReportingViewerState = 'anonymous' | 'authenticated'
export type ReportStatus = 'open' | 'in_review' | 'resolved' | 'dismissed'
export type ReportScope = 'global' | 'space_culture' | 'unknown'

function visibilityFilterSql(viewerState: ReportingViewerState): { sql: string; params: string[] } {
  if (viewerState === 'authenticated') return { sql: `IN ('public','authenticated')`, params: [] }
  return { sql: `IN ('public')`, params: [] }
}

export async function getPublishedPublicationSummary(
  publicationId: number,
  db?: DbLike
): Promise<{
  id: number
  space_id: number
  space_slug: string | null
  production_id: number | null
  upload_duration_seconds: number | null
} | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT sp.id, sp.space_id, s.slug AS space_slug, sp.production_id, u.duration_seconds AS upload_duration_seconds
       FROM space_publications sp
       JOIN spaces s ON s.id = sp.space_id
  LEFT JOIN uploads u ON u.id = sp.upload_id
      WHERE sp.id = ?
        AND sp.status = 'published'
        AND sp.published_at IS NOT NULL
      LIMIT 1`,
    [publicationId]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    id: Number(row.id),
    space_id: Number(row.space_id),
    space_slug: row.space_slug != null ? String(row.space_slug) : null,
    production_id: row.production_id != null ? Number(row.production_id) : null,
    upload_duration_seconds:
      row.upload_duration_seconds != null && Number.isFinite(Number(row.upload_duration_seconds))
        ? Number(row.upload_duration_seconds)
        : null,
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
  reported_start_seconds: number | null
  reported_end_seconds: number | null
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
            spr.user_facing_group_label_at_submit,
            spr.reported_start_seconds,
            spr.reported_end_seconds
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
    reported_start_seconds:
      row.reported_start_seconds == null ? null : Number(row.reported_start_seconds),
    reported_end_seconds:
      row.reported_end_seconds == null ? null : Number(row.reported_end_seconds),
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

export async function listInitialUserFacingGroupsForSpace(
  spaceId: number,
  viewerState: ReportingViewerState = 'authenticated',
  db?: DbLike
): Promise<
  Array<{
    user_facing_group_id: number
    label: string
    short_description: string | null
    group_order: number
    display_order: number
    rule_id: number | null
    rule_slug: string | null
    rule_title: string | null
    rule_short_description: string | null
    priority: number | null
    is_default: number | null
  }>
> {
  const q = (db as any) || getPool()
  const visibility = visibilityFilterSql(viewerState)
  const [rows] = await q.query(
    `SELECT DISTINCT
            ufr.id AS user_facing_group_id,
            ufr.label,
            ufr.short_description,
            ufr.group_order,
            ufr.display_order,
            r.id AS rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            rv.short_description AS rule_short_description,
            m.priority,
            m.is_default
       FROM user_facing_rules ufr
       JOIN culture_user_facing_groups cufg
         ON cufg.user_facing_group_id = ufr.id
       JOIN space_cultures sc
         ON sc.culture_id = cufg.culture_id
        AND sc.space_id = ?
  LEFT JOIN user_facing_rule_rule_map m
         ON m.user_facing_rule_id = ufr.id
  LEFT JOIN rules r
         ON r.id = m.rule_id
        AND r.visibility ${visibility.sql}
  LEFT JOIN rule_versions rv
         ON rv.id = r.current_version_id
      WHERE ufr.is_active = 1
      ORDER BY ufr.group_order ASC,
               ufr.display_order ASC,
               ufr.label ASC,
               m.is_default DESC,
               m.priority ASC,
               r.id ASC`,
    [spaceId, ...visibility.params]
  )
  return rows as any[]
}

export async function listAllActiveUserFacingGroups(
  viewerState: ReportingViewerState = 'authenticated',
  db?: DbLike
): Promise<
  Array<{
    user_facing_group_id: number
    label: string
    short_description: string | null
    group_order: number
    display_order: number
    rule_id: number | null
    rule_slug: string | null
    rule_title: string | null
    rule_short_description: string | null
    priority: number | null
    is_default: number | null
  }>
> {
  const q = (db as any) || getPool()
  const visibility = visibilityFilterSql(viewerState)
  const [rows] = await q.query(
    `SELECT
            ufr.id AS user_facing_group_id,
            ufr.label,
            ufr.short_description,
            ufr.group_order,
            ufr.display_order,
            r.id AS rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            rv.short_description AS rule_short_description,
            m.priority,
            m.is_default
       FROM user_facing_rules ufr
  LEFT JOIN user_facing_rule_rule_map m
         ON m.user_facing_rule_id = ufr.id
  LEFT JOIN rules r
         ON r.id = m.rule_id
        AND r.visibility ${visibility.sql}
  LEFT JOIN rule_versions rv
         ON rv.id = r.current_version_id
      WHERE ufr.is_active = 1
      ORDER BY ufr.group_order ASC,
               ufr.display_order ASC,
               ufr.label ASC,
               m.is_default DESC,
               m.priority ASC,
               r.id ASC`,
    [...visibility.params]
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
       JOIN user_facing_rule_rule_map m
         ON m.rule_id = r.id
       JOIN user_facing_rules ufr
         ON ufr.id = m.user_facing_rule_id
      WHERE r.id = ?
        AND ufr.is_active = 1
        AND r.visibility ${visibility.sql}
      LIMIT 1`,
    [ruleId, ...visibility.params]
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
      WHERE ufr.id = ?
        AND ufr.is_active = 1
        AND r.visibility ${visibility.sql}
      ORDER BY m.is_default DESC,
               m.priority ASC,
               r.id ASC
      LIMIT 1`,
    [input.userFacingRuleId, ...visibility.params]
  )
  const row = (rows as any[])[0]
  if (!row) return null
  return {
    rule_id: Number(row.rule_id),
    current_version_id: row.current_version_id != null ? Number(row.current_version_id) : null,
  }
}

export async function resolveMappedRuleForUserFacingReason(input: {
  spaceId: number
  userFacingRuleId: number
  ruleId: number
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
      WHERE ufr.id = ?
        AND r.id = ?
        AND ufr.is_active = 1
        AND r.visibility ${visibility.sql}
      LIMIT 1`,
    [input.userFacingRuleId, input.ruleId, ...visibility.params]
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
      WHERE ufr.is_active = 1
        AND r.id = ?
        AND r.visibility ${visibility.sql}
      ORDER BY ufr.group_order ASC,
               ufr.display_order ASC,
               ufr.id ASC
      LIMIT 1`,
    [input.ruleId, ...visibility.params]
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
  ruleScopeAtSubmit?: ReportScope | null
  userFacingRuleId?: number | null
  userFacingRuleLabelAtSubmit?: string | null
  userFacingGroupKeyAtSubmit?: string | null
  userFacingGroupLabelAtSubmit?: string | null
  reportedStartSeconds?: number | null
  reportedEndSeconds?: number | null
}): Promise<number> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO space_publication_reports
      (space_publication_id, space_id, production_id, reporter_user_id, rule_id, rule_version_id, rule_scope_at_submit, user_facing_rule_id, user_facing_rule_label_at_submit, user_facing_group_key_at_submit, user_facing_group_label_at_submit, reported_start_seconds, reported_end_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.spacePublicationId,
      input.spaceId,
      input.productionId,
      input.reporterUserId,
      input.ruleId,
      input.ruleVersionId,
      input.ruleScopeAtSubmit ?? 'unknown',
      input.userFacingRuleId ?? null,
      input.userFacingRuleLabelAtSubmit ?? null,
      input.userFacingGroupKeyAtSubmit ?? null,
      input.userFacingGroupLabelAtSubmit ?? null,
      input.reportedStartSeconds ?? null,
      input.reportedEndSeconds ?? null,
    ]
  )
  return Number((result as any).insertId)
}

export type ReportListFilters = {
  status?: ReportStatus | null
  scope?: ReportScope | null
  spaceType?: 'personal' | 'group' | 'channel' | null
  spaceId?: number | null
  cultureId?: number | null
  categoryId?: number | null
  ruleId?: number | null
  reporterUserId?: number | null
  assignedToUserId?: number | null
  from?: string | null
  to?: string | null
  limit?: number
  cursorId?: number | null
}

export async function listReportsForAdmin(filters: ReportListFilters, db?: DbLike): Promise<any[]> {
  const q = (db as any) || getPool()
  const where: string[] = []
  const params: any[] = []
  if (filters.status) { where.push(`spr.status = ?`); params.push(filters.status) }
  if (filters.scope) { where.push(`spr.rule_scope_at_submit = ?`); params.push(filters.scope) }
  if (filters.spaceType) { where.push(`s.type = ?`); params.push(filters.spaceType) }
  if (filters.spaceId != null) { where.push(`spr.space_id = ?`); params.push(filters.spaceId) }
  if (filters.cultureId != null) {
    where.push(`EXISTS (SELECT 1 FROM culture_categories cc WHERE cc.culture_id = ? AND cc.category_id = r.category_id)`)
    params.push(filters.cultureId)
  }
  if (filters.categoryId != null) { where.push(`r.category_id = ?`); params.push(filters.categoryId) }
  if (filters.ruleId != null) { where.push(`spr.rule_id = ?`); params.push(filters.ruleId) }
  if (filters.reporterUserId != null) { where.push(`spr.reporter_user_id = ?`); params.push(filters.reporterUserId) }
  if (filters.assignedToUserId != null) { where.push(`spr.assigned_to_user_id = ?`); params.push(filters.assignedToUserId) }
  if (filters.from) { where.push(`spr.created_at >= ?`); params.push(filters.from) }
  if (filters.to) { where.push(`spr.created_at < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(filters.to) }
  if (filters.cursorId != null) { where.push(`spr.id < ?`); params.push(filters.cursorId) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 50)))
  const [rows] = await q.query(
    `SELECT spr.id,
            spr.space_publication_id,
            spr.space_id,
            s.type AS space_type,
            s.slug AS space_slug,
            s.name AS space_name,
            spr.production_id,
            prod.ulid AS production_ulid,
            spr.reporter_user_id,
            ru.email AS reporter_email,
            ru.display_name AS reporter_display_name,
            spr.rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            spr.status,
            spr.rule_scope_at_submit,
            spr.assigned_to_user_id,
            au.email AS assigned_to_email,
            au.display_name AS assigned_to_display_name,
            spr.resolved_by_user_id,
            rvu.email AS resolved_by_email,
            rvu.display_name AS resolved_by_display_name,
            spr.resolution_code,
            spr.resolution_note,
            spr.user_facing_rule_id,
            spr.user_facing_rule_label_at_submit,
            spr.user_facing_group_key_at_submit,
            spr.user_facing_group_label_at_submit,
            spr.reported_start_seconds,
            spr.reported_end_seconds,
            spr.created_at,
            spr.last_action_at,
            spr.resolved_at
       FROM space_publication_reports spr
       JOIN spaces s ON s.id = spr.space_id
       JOIN users ru ON ru.id = spr.reporter_user_id
       JOIN rules r ON r.id = spr.rule_id
  LEFT JOIN productions prod ON prod.id = spr.production_id
  LEFT JOIN users au ON au.id = spr.assigned_to_user_id
  LEFT JOIN users rvu ON rvu.id = spr.resolved_by_user_id
      ${whereSql}
      ORDER BY spr.id DESC
      LIMIT ${limit}`,
    params
  )
  return rows as any[]
}

export async function getReportById(reportId: number, db?: DbLike): Promise<any | null> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT spr.id,
            spr.space_publication_id,
            spr.space_id,
            s.type AS space_type,
            s.slug AS space_slug,
            s.name AS space_name,
            spr.production_id,
            prod.ulid AS production_ulid,
            spr.reporter_user_id,
            ru.email AS reporter_email,
            ru.display_name AS reporter_display_name,
            spr.rule_id,
            r.slug AS rule_slug,
            r.title AS rule_title,
            spr.rule_version_id,
            rv.version AS rule_version,
            spr.status,
            spr.rule_scope_at_submit,
            spr.assigned_to_user_id,
            au.email AS assigned_to_email,
            au.display_name AS assigned_to_display_name,
            spr.resolved_by_user_id,
            rvu.email AS resolved_by_email,
            rvu.display_name AS resolved_by_display_name,
            spr.resolution_code,
            spr.resolution_note,
            spr.user_facing_rule_id,
            spr.user_facing_rule_label_at_submit,
            spr.user_facing_group_key_at_submit,
            spr.user_facing_group_label_at_submit,
            spr.reported_start_seconds,
            spr.reported_end_seconds,
            spr.created_at,
            spr.last_action_at,
            spr.resolved_at
       FROM space_publication_reports spr
       JOIN spaces s ON s.id = spr.space_id
       JOIN users ru ON ru.id = spr.reporter_user_id
       JOIN rules r ON r.id = spr.rule_id
  LEFT JOIN productions prod ON prod.id = spr.production_id
  LEFT JOIN rule_versions rv ON rv.id = spr.rule_version_id
  LEFT JOIN users au ON au.id = spr.assigned_to_user_id
  LEFT JOIN users rvu ON rvu.id = spr.resolved_by_user_id
      WHERE spr.id = ?
      LIMIT 1`,
    [reportId]
  )
  return ((rows as any[])[0] || null) as any
}

export async function getReportByIdForUpdate(reportId: number, db: DbLike): Promise<any | null> {
  const [rows] = await db.query(
    `SELECT id,
            space_id,
            status,
            assigned_to_user_id,
            resolved_by_user_id,
            resolved_at,
            resolution_code,
            resolution_note
       FROM space_publication_reports
      WHERE id = ?
      LIMIT 1
      FOR UPDATE`,
    [reportId]
  )
  return ((rows as any[])[0] || null) as any
}

export async function listReportActions(reportId: number, db?: DbLike): Promise<any[]> {
  const q = (db as any) || getPool()
  const [rows] = await q.query(
    `SELECT a.id,
            a.report_id,
            a.actor_user_id,
            u.email AS actor_email,
            u.display_name AS actor_display_name,
            a.action_type,
            a.from_status,
            a.to_status,
            a.note,
            a.detail_json,
            a.created_at
       FROM space_publication_report_actions a
       JOIN users u ON u.id = a.actor_user_id
      WHERE a.report_id = ?
      ORDER BY a.id DESC`,
    [reportId]
  )
  return rows as any[]
}

export async function insertReportAction(input: {
  reportId: number
  actorUserId: number
  actionType: string
  fromStatus?: string | null
  toStatus?: string | null
  note?: string | null
  detailJson?: any
}, db: DbLike): Promise<number> {
  const [result] = await db.query(
    `INSERT INTO space_publication_report_actions
      (report_id, actor_user_id, action_type, from_status, to_status, note, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.reportId,
      input.actorUserId,
      input.actionType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.note ?? null,
      input.detailJson != null ? JSON.stringify(input.detailJson) : null,
    ]
  )
  return Number((result as any).insertId)
}

export async function updateReportLifecycle(input: {
  reportId: number
  status?: ReportStatus
  assignedToUserId?: number | null
  resolvedByUserId?: number | null
  resolvedAt?: Date | null
  resolutionCode?: string | null
  resolutionNote?: string | null
  touchLastActionAt?: boolean
}, db: DbLike): Promise<void> {
  const sets: string[] = []
  const params: any[] = []
  if (input.status !== undefined) { sets.push(`status = ?`); params.push(input.status) }
  if (input.assignedToUserId !== undefined) { sets.push(`assigned_to_user_id = ?`); params.push(input.assignedToUserId) }
  if (input.resolvedByUserId !== undefined) { sets.push(`resolved_by_user_id = ?`); params.push(input.resolvedByUserId) }
  if (input.resolvedAt !== undefined) { sets.push(`resolved_at = ?`); params.push(input.resolvedAt) }
  if (input.resolutionCode !== undefined) { sets.push(`resolution_code = ?`); params.push(input.resolutionCode) }
  if (input.resolutionNote !== undefined) { sets.push(`resolution_note = ?`); params.push(input.resolutionNote) }
  if (input.touchLastActionAt !== false) sets.push(`last_action_at = UTC_TIMESTAMP()`)
  if (!sets.length) return
  params.push(input.reportId)
  await db.query(
    `UPDATE space_publication_reports
        SET ${sets.join(', ')}
      WHERE id = ?`,
    params
  )
}
