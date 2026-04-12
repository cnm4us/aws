import { DomainError } from '../../core/errors'
import { getPool } from '../../db'
import { can } from '../../security/permissions'
import { PERM } from '../../security/perm'
import * as moderationV2Repo from '../moderation-v2/repo'
import * as spacesSvc from '../spaces/service'
import * as repo from './repo'
import { isDismissedResolutionCode, isResolvedResolutionCode } from './resolution-codes'

function normalizeReportedSeconds(raw: number | null | undefined, maxSeconds: number | null): number | null {
  if (raw == null) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    throw new DomainError('invalid_reported_time_seconds', 'invalid_reported_time_seconds', 400)
  }
  const whole = Math.floor(n)
  if (maxSeconds == null || !Number.isFinite(maxSeconds) || maxSeconds < 0) return whole
  return Math.max(0, Math.min(whole, Math.floor(maxSeconds)))
}

export async function getReportingOptionsForPublication(publicationId: number, userId: number) {
  const pub = await repo.getPublishedPublicationSummary(publicationId)
  if (!pub) throw new DomainError('publication_not_found', 'publication_not_found', 404)

  await spacesSvc.assertCanViewSpaceFeed(pub.space_id, userId)

  const [existingReport, rows] = await Promise.all([
    repo.getUserPublicationReport(publicationId, userId),
    repo.listReportingRulesForSpace(pub.space_id),
  ])

  const categoriesMap = new Map<number, { id: number; name: string; rules: Array<{ id: number; slug: string; title: string; shortDescription?: string }> }>()
  for (const row of rows as any[]) {
    const categoryId = Number(row.category_id)
    const categoryName = String(row.category_name || '')
    if (!categoriesMap.has(categoryId)) {
      categoriesMap.set(categoryId, { id: categoryId, name: categoryName, rules: [] })
    }
    const ruleId = Number(row.rule_id)
    const slug = String(row.rule_slug || '')
    const title = String(row.rule_title || '')
    const rule: any = { id: ruleId, slug, title }
    if (row.short_description) rule.shortDescription = String(row.short_description)
    categoriesMap.get(categoryId)!.rules.push(rule)
  }

  return {
    spacePublicationId: publicationId,
    spaceId: pub.space_id,
    reportedByMe: Boolean(existingReport),
    myReport: existingReport
      ? {
          ruleId: Number(existingReport.rule_id),
          ruleSlug: existingReport.rule_slug,
          ruleTitle: existingReport.rule_title,
          reportedStartSeconds:
            existingReport.reported_start_seconds == null ? null : Number(existingReport.reported_start_seconds),
          reportedEndSeconds:
            existingReport.reported_end_seconds == null ? null : Number(existingReport.reported_end_seconds),
          createdAt: existingReport.created_at,
        }
      : null,
    categories: Array.from(categoriesMap.values()),
  }
}

export async function getUserFacingReportingOptionsForPublication(publicationId: number, userId: number) {
  const pub = await repo.getPublishedPublicationSummary(publicationId)
  if (!pub) throw new DomainError('publication_not_found', 'publication_not_found', 404)

  await spacesSvc.assertCanViewSpaceFeed(pub.space_id, userId)

  const [existingReport, initialGroupRows, allGroupRows] = await Promise.all([
    repo.getUserPublicationReport(publicationId, userId),
    repo.listInitialUserFacingGroupsForSpace(pub.space_id, 'authenticated'),
    repo.listAllActiveUserFacingGroups('authenticated'),
  ])

  const buildUserFacingGroups = (rows: any[]) => {
    const groupsById = new Map<number, {
      id: number
      label: string
      shortDescription: string | null
      groupOrder: number
      displayOrder: number
      rules: Array<{ id: number; slug: string; title: string; shortDescription: string | null; priority: number; isDefault: boolean }>
    }>()
    for (const row of rows as any[]) {
      const groupId = Number(row.user_facing_group_id)
      if (!groupsById.has(groupId)) {
        groupsById.set(groupId, {
          id: groupId,
          label: String(row.label || ''),
          shortDescription: row.short_description != null ? String(row.short_description) : null,
          groupOrder: Number(row.group_order || 0),
          displayOrder: Number(row.display_order || 0),
          rules: [],
        })
      }
      if (row.rule_id != null && Number.isFinite(Number(row.rule_id)) && Number(row.rule_id) > 0) {
        groupsById.get(groupId)!.rules.push({
          id: Number(row.rule_id),
          slug: String(row.rule_slug || ''),
          title: String(row.rule_title || ''),
          shortDescription: row.rule_short_description != null ? String(row.rule_short_description) : null,
          priority: Number(row.priority || 100),
          isDefault: Number(row.is_default || 0) === 1,
        })
      }
    }
    return Array.from(groupsById.values())
      .sort((a, b) => (a.groupOrder - b.groupOrder) || (a.displayOrder - b.displayOrder) || a.label.localeCompare(b.label))
      .map((group) => ({
        id: group.id,
        label: group.label,
        shortDescription: group.shortDescription,
        displayOrder: group.displayOrder,
        rules: group.rules.sort((a, b) => {
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
          if ((a.priority || 100) !== (b.priority || 100)) return (a.priority || 100) - (b.priority || 100)
          return a.title.localeCompare(b.title)
        }),
      }))
  }

  let initialGroups = buildUserFacingGroups(initialGroupRows as any[])
  const allGroups = buildUserFacingGroups(allGroupRows as any[])
  if (!initialGroups.length) {
    initialGroups = allGroups
  }

  const initialIds = new Set<number>(initialGroups.map((group) => Number(group.id)))
  const hiddenGroupsCount = allGroups.filter((group) => !initialIds.has(Number(group.id))).length

  return {
    spacePublicationId: publicationId,
    spaceId: pub.space_id,
    reportedByMe: Boolean(existingReport),
    myReport: existingReport
      ? {
          ruleId: Number(existingReport.rule_id),
          ruleSlug: existingReport.rule_slug,
          ruleTitle: existingReport.rule_title,
          userFacingRuleId: existingReport.user_facing_rule_id == null ? null : Number(existingReport.user_facing_rule_id),
          userFacingRuleLabel: existingReport.user_facing_rule_label_at_submit,
          userFacingGroupKey: existingReport.user_facing_group_key_at_submit,
          userFacingGroupLabel: existingReport.user_facing_group_label_at_submit,
          reportedStartSeconds:
            existingReport.reported_start_seconds == null ? null : Number(existingReport.reported_start_seconds),
          reportedEndSeconds:
            existingReport.reported_end_seconds == null ? null : Number(existingReport.reported_end_seconds),
          createdAt: existingReport.created_at,
        }
      : null,
    groups: initialGroups,
    initialGroups,
    allGroups,
    showAllAvailable: hiddenGroupsCount > 0,
    hiddenGroupsCount,
  }
}

export async function getUserFacingReportingOptionsForPublicationLegacyShape(publicationId: number, userId: number) {
  const pub = await repo.getPublishedPublicationSummary(publicationId)
  if (!pub) throw new DomainError('publication_not_found', 'publication_not_found', 404)

  await spacesSvc.assertCanViewSpaceFeed(pub.space_id, userId)

  const [existingReport, reasonRows] = await Promise.all([
    repo.getUserPublicationReport(publicationId, userId),
    repo.listUserFacingReportingReasonsForSpace(pub.space_id, 'authenticated'),
  ])

  const reasonsById = new Map<number, {
    id: number
    label: string
    shortDescription: string | null
    groupKey: string | null
    groupLabel: string | null
    groupOrder: number
    displayOrder: number
    rules: Array<{ id: number; slug: string; title: string; shortDescription: string | null; priority: number; isDefault: boolean }>
  }>()
  for (const row of reasonRows as any[]) {
    const reasonId = Number(row.user_facing_rule_id)
    if (!reasonsById.has(reasonId)) {
      reasonsById.set(reasonId, {
        id: reasonId,
        label: String(row.label || ''),
        shortDescription: row.short_description != null ? String(row.short_description) : null,
        groupKey: row.group_key != null ? String(row.group_key) : null,
        groupLabel: row.group_label != null ? String(row.group_label) : null,
        groupOrder: Number(row.group_order || 0),
        displayOrder: Number(row.display_order || 0),
        rules: [],
      })
    }
    reasonsById.get(reasonId)!.rules.push({
      id: Number(row.rule_id),
      slug: String(row.rule_slug || ''),
      title: String(row.rule_title || ''),
      shortDescription: row.rule_short_description != null ? String(row.rule_short_description) : null,
      priority: Number(row.priority || 100),
      isDefault: Number(row.is_default || 0) === 1,
    })
  }

  const grouped = new Map<string, { key: string | null; label: string | null; order: number; reasons: any[] }>()
  for (const reason of reasonsById.values()) {
    const groupKey = reason.groupKey || ''
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        key: reason.groupKey,
        label: reason.groupLabel,
        order: reason.groupOrder,
        reasons: [],
      })
    }
    grouped.get(groupKey)!.reasons.push(reason)
  }

  const groups = Array.from(grouped.values())
    .sort((a, b) => (a.order - b.order) || String(a.label || '').localeCompare(String(b.label || '')))
    .map((group) => ({
      key: group.key,
      label: group.label,
      reasons: group.reasons.sort((a, b) => (a.displayOrder - b.displayOrder) || a.label.localeCompare(b.label)),
    }))

  return {
    spacePublicationId: publicationId,
    spaceId: pub.space_id,
    reportedByMe: Boolean(existingReport),
    myReport: existingReport
      ? {
          ruleId: Number(existingReport.rule_id),
          ruleSlug: existingReport.rule_slug,
          ruleTitle: existingReport.rule_title,
          userFacingRuleId: existingReport.user_facing_rule_id == null ? null : Number(existingReport.user_facing_rule_id),
          userFacingRuleLabel: existingReport.user_facing_rule_label_at_submit,
          userFacingGroupKey: existingReport.user_facing_group_key_at_submit,
          userFacingGroupLabel: existingReport.user_facing_group_label_at_submit,
          reportedStartSeconds:
            existingReport.reported_start_seconds == null ? null : Number(existingReport.reported_start_seconds),
          reportedEndSeconds:
            existingReport.reported_end_seconds == null ? null : Number(existingReport.reported_end_seconds),
          createdAt: existingReport.created_at,
        }
      : null,
    groups,
  }
}

export async function submitPublicationReport(
  publicationId: number,
  userId: number,
  input: {
    ruleId?: number | null
    userFacingRuleId?: number | null
    reportedStartSeconds?: number | null
    reportedEndSeconds?: number | null
  }
) {
  const rawRuleId = input?.ruleId == null ? null : Number(input.ruleId)
  const rawUserFacingRuleId = input?.userFacingRuleId == null ? null : Number(input.userFacingRuleId)
  const ruleId = rawRuleId != null && Number.isFinite(rawRuleId) && rawRuleId > 0 ? Math.round(rawRuleId) : null
  const userFacingRuleId =
    rawUserFacingRuleId != null && Number.isFinite(rawUserFacingRuleId) && rawUserFacingRuleId > 0
      ? Math.round(rawUserFacingRuleId)
      : null
  if (ruleId == null && userFacingRuleId == null) {
    throw new DomainError('missing_rule_reference', 'missing_rule_reference', 400)
  }

  const pub = await repo.getPublishedPublicationSummary(publicationId)
  if (!pub) throw new DomainError('publication_not_found', 'publication_not_found', 404)

  await spacesSvc.assertCanViewSpaceFeed(pub.space_id, userId)
  const reportedStartSeconds = normalizeReportedSeconds(input?.reportedStartSeconds ?? null, pub.upload_duration_seconds ?? null)
  const reportedEndSeconds = normalizeReportedSeconds(input?.reportedEndSeconds ?? null, pub.upload_duration_seconds ?? null)
  if (reportedStartSeconds != null && reportedEndSeconds != null && reportedEndSeconds < reportedStartSeconds) {
    throw new DomainError('invalid_report_time_range', 'invalid_report_time_range', 400)
  }
  let resolvedRule: { rule_id: number; current_version_id: number | null } | null = null
  let resolvedUserFacingSummary:
    | { id: number; label: string; group_key: string | null; group_label: string | null }
    | null = null

  if (ruleId != null && userFacingRuleId != null) {
    const reasonOptions = await repo.listUserFacingReportingReasonsForSpace(pub.space_id, 'authenticated')
    const match = reasonOptions.find(
      (row) => Number(row.user_facing_rule_id) === userFacingRuleId && Number(row.rule_id) === ruleId
    )
    if (!match) throw new DomainError('rule_not_allowed', 'rule_not_allowed', 400)
    resolvedRule = await repo.getReportableRuleForSpace(pub.space_id, ruleId, 'authenticated')
    if (!resolvedRule) throw new DomainError('rule_not_allowed', 'rule_not_allowed', 400)
    resolvedUserFacingSummary = await repo.getUserFacingReasonSummary(userFacingRuleId)
  } else if (ruleId != null) {
    resolvedRule = await repo.getReportableRuleForSpace(pub.space_id, ruleId, 'authenticated')
    if (!resolvedRule) throw new DomainError('rule_not_allowed', 'rule_not_allowed', 400)
    const visibleReason = await repo.getVisibleUserFacingReasonForRule({
      spaceId: pub.space_id,
      ruleId,
      viewerState: 'authenticated',
    })
    if (visibleReason) {
      resolvedUserFacingSummary = {
        id: visibleReason.user_facing_rule_id,
        label: visibleReason.label,
        group_key: visibleReason.group_key,
        group_label: visibleReason.group_label,
      }
    }
  } else {
    resolvedRule = await repo.resolveDefaultMappedRuleForUserFacingReason({
      spaceId: pub.space_id,
      userFacingRuleId: userFacingRuleId as number,
      viewerState: 'authenticated',
    })
    if (!resolvedRule) throw new DomainError('no_resolvable_rule', 'no_resolvable_rule', 400)
    resolvedUserFacingSummary = await repo.getUserFacingReasonSummary(userFacingRuleId as number)
    if (!resolvedUserFacingSummary) throw new DomainError('invalid_user_facing_rule_id', 'invalid_user_facing_rule_id', 400)
  }

  try {
    const ruleScopeAtSubmit: repo.ReportScope =
      pub.space_slug === 'global-feed' ? 'global' : 'space_culture'
    const reportId = await repo.insertSpacePublicationReport({
      spacePublicationId: publicationId,
      spaceId: pub.space_id,
      productionId: pub.production_id,
      reporterUserId: userId,
      ruleId: resolvedRule.rule_id,
      ruleVersionId: resolvedRule.current_version_id,
      ruleScopeAtSubmit,
      userFacingRuleId: resolvedUserFacingSummary?.id ?? null,
      userFacingRuleLabelAtSubmit: resolvedUserFacingSummary?.label ?? null,
      userFacingGroupKeyAtSubmit: resolvedUserFacingSummary?.group_key ?? null,
      userFacingGroupLabelAtSubmit: resolvedUserFacingSummary?.group_label ?? null,
      reportedStartSeconds,
      reportedEndSeconds,
    })
    return { ok: true, reportId }
  } catch (err: any) {
    if (String(err?.code || '') === 'ER_DUP_ENTRY') {
      throw new DomainError('already_reported', 'already_reported', 409)
    }
    throw err
  }
}

const TERMINAL_STATUSES = new Set<repo.ReportStatus>(['resolved', 'dismissed'])

const VALID_TRANSITIONS: Record<repo.ReportStatus, ReadonlySet<repo.ReportStatus>> = {
  open: new Set<repo.ReportStatus>(['in_review', 'resolved', 'dismissed']),
  in_review: new Set<repo.ReportStatus>(['open', 'resolved', 'dismissed']),
  resolved: new Set<repo.ReportStatus>(['open']),
  dismissed: new Set<repo.ReportStatus>(['open']),
}

function assertCanTransition(from: repo.ReportStatus, to: repo.ReportStatus) {
  if (from === to) return
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed || !allowed.has(to)) {
    throw new DomainError('invalid_report_status_transition', 'invalid_report_status_transition', 400)
  }
}

async function assertCanGlobalModerateReports(userId: number) {
  const ok =
    (await can(userId, PERM.VIDEO_DELETE_ANY)) ||
    (await can(userId, PERM.FEED_MODERATE_GLOBAL)) ||
    (await can(userId, PERM.FEED_PUBLISH_GLOBAL))
  if (!ok) throw new DomainError('forbidden', 'forbidden', 403)
}

async function assertCanSpaceModerateReports(userId: number, spaceId: number) {
  if (!Number.isFinite(spaceId) || spaceId <= 0) {
    throw new DomainError('bad_space_id', 'bad_space_id', 400)
  }
  const ok =
    (await can(userId, PERM.VIDEO_APPROVE_SPACE, { spaceId })) ||
    (await can(userId, PERM.VIDEO_PUBLISH_SPACE, { spaceId }))
  if (!ok) throw new DomainError('forbidden', 'forbidden', 403)
}

async function getModerationV2DetailForReport(reportId: number): Promise<any | null> {
  const evaluation = await moderationV2Repo.getLatestEvaluationByReportId(reportId)
  if (!evaluation) return null
  const [latestMeasurement, latestJudgment, reviews] = await Promise.all([
    moderationV2Repo.getLatestMeasurementByEvaluationId(evaluation.evaluation_id),
    moderationV2Repo.getLatestJudgmentByEvaluationId(evaluation.evaluation_id),
    moderationV2Repo.listReviewsByEvaluationId(evaluation.evaluation_id),
  ])
  return {
    evaluation,
    latestMeasurement,
    latestJudgment,
    reviews,
  }
}

export async function listReportsForAdmin(
  currentUserId: number,
  filters: repo.ReportListFilters
): Promise<{ items: any[]; nextCursor: number | null }> {
  await assertCanGlobalModerateReports(currentUserId)
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 50)))
  const items = await repo.listReportsForAdmin({ ...filters, limit })
  const nextCursor = items.length >= limit ? Number(items[items.length - 1]?.id || 0) : 0
  return {
    items,
    nextCursor: nextCursor > 0 ? nextCursor : null,
  }
}

export async function getReportDetailForAdmin(currentUserId: number, reportId: number): Promise<{ report: any; actions: any[]; moderationV2: any | null }> {
  await assertCanGlobalModerateReports(currentUserId)
  const report = await repo.getReportById(reportId)
  if (!report) throw new DomainError('report_not_found', 'report_not_found', 404)
  const [actions, moderationV2] = await Promise.all([
    repo.listReportActions(reportId),
    getModerationV2DetailForReport(reportId),
  ])
  return { report, actions, moderationV2 }
}

export async function listReportsForSpaceModerator(
  currentUserId: number,
  spaceId: number,
  filters: Omit<repo.ReportListFilters, 'spaceId'>
): Promise<{ items: any[]; nextCursor: number | null }> {
  await assertCanSpaceModerateReports(currentUserId, spaceId)
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 50)))
  const items = await repo.listReportsForAdmin({
    ...filters,
    spaceId,
    limit,
  })
  const nextCursor = items.length >= limit ? Number(items[items.length - 1]?.id || 0) : 0
  return {
    items,
    nextCursor: nextCursor > 0 ? nextCursor : null,
  }
}

export async function getReportDetailForSpaceModerator(
  currentUserId: number,
  reportId: number,
  expectedSpaceId?: number | null
): Promise<{ report: any; actions: any[]; moderationV2: any | null }> {
  const report = await repo.getReportById(reportId)
  if (!report) throw new DomainError('report_not_found', 'report_not_found', 404)
  const reportSpaceId = Number(report.space_id || 0)
  if (expectedSpaceId != null && Number(expectedSpaceId) > 0 && Number(expectedSpaceId) !== reportSpaceId) {
    throw new DomainError('forbidden', 'forbidden', 403)
  }
  await assertCanSpaceModerateReports(currentUserId, reportSpaceId)
  const [actions, moderationV2] = await Promise.all([
    repo.listReportActions(reportId),
    getModerationV2DetailForReport(reportId),
  ])
  return { report, actions, moderationV2 }
}

type ReportMutationInput = {
  reportId: number
  actorUserId: number
  actionType: string
  nextStatus?: repo.ReportStatus
  assignToUserId?: number | null
  resolutionCode?: string | null
  resolutionNote?: string | null
  note?: string | null
  detailJson?: any
}

async function mutateReportLifecycle(input: ReportMutationInput): Promise<{ report: any; actionId: number }> {
  await assertCanGlobalModerateReports(input.actorUserId)
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await repo.getReportByIdForUpdate(input.reportId, conn as any)
    if (!row) throw new DomainError('report_not_found', 'report_not_found', 404)
    const currentStatus = String(row.status || 'open') as repo.ReportStatus
    const nextStatus = input.nextStatus ?? currentStatus
    assertCanTransition(currentStatus, nextStatus)
    const statusChanged = nextStatus !== currentStatus
    const willBeTerminal = TERMINAL_STATUSES.has(nextStatus)
    const shouldWriteTerminalMetadata =
      willBeTerminal && (statusChanged || input.actionType === 'resolve' || input.actionType === 'dismiss')
    await repo.updateReportLifecycle(
      {
        reportId: input.reportId,
        status: nextStatus,
        assignedToUserId: input.assignToUserId,
        resolvedByUserId: shouldWriteTerminalMetadata ? input.actorUserId : statusChanged ? null : undefined,
        resolvedAt: shouldWriteTerminalMetadata ? new Date() : statusChanged ? null : undefined,
        resolutionCode: shouldWriteTerminalMetadata ? (input.resolutionCode ?? null) : statusChanged ? null : undefined,
        resolutionNote: shouldWriteTerminalMetadata ? (input.resolutionNote ?? null) : statusChanged ? null : undefined,
        touchLastActionAt: true,
      },
      conn as any
    )

    const actionId = await repo.insertReportAction(
      {
        reportId: input.reportId,
        actorUserId: input.actorUserId,
        actionType: input.actionType,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        note: input.note ?? null,
        detailJson: input.detailJson ?? null,
      },
      conn as any
    )

    await conn.commit()
    const report = await repo.getReportById(input.reportId)
    if (!report) throw new DomainError('report_not_found', 'report_not_found', 404)
    return { report, actionId }
  } catch (err) {
    try { await conn.rollback() } catch {}
    throw err
  } finally {
    try { conn.release() } catch {}
  }
}

export async function assignReportForAdmin(input: {
  reportId: number
  actorUserId: number
  assignedToUserId: number | null
  note?: string | null
}): Promise<{ report: any; actionId: number }> {
  return mutateReportLifecycle({
    reportId: input.reportId,
    actorUserId: input.actorUserId,
    actionType: 'assign',
    assignToUserId: input.assignedToUserId,
    note: input.note ?? null,
    detailJson: { assigned_to_user_id: input.assignedToUserId },
  })
}

export async function setReportStatusForAdmin(input: {
  reportId: number
  actorUserId: number
  status: repo.ReportStatus
  note?: string | null
}): Promise<{ report: any; actionId: number }> {
  return mutateReportLifecycle({
    reportId: input.reportId,
    actorUserId: input.actorUserId,
    actionType: 'status_change',
    nextStatus: input.status,
    note: input.note ?? null,
    detailJson: { status: input.status },
  })
}

export async function resolveReportForAdmin(input: {
  reportId: number
  actorUserId: number
  resolutionCode: string
  resolutionNote?: string | null
}): Promise<{ report: any; actionId: number }> {
  if (!isResolvedResolutionCode(String(input.resolutionCode || ''))) {
    throw new DomainError('invalid_resolution_code', 'invalid_resolution_code', 400)
  }
  return mutateReportLifecycle({
    reportId: input.reportId,
    actorUserId: input.actorUserId,
    actionType: 'resolve',
    nextStatus: 'resolved',
    resolutionCode: String(input.resolutionCode || '').slice(0, 64) || 'resolved',
    resolutionNote: input.resolutionNote ?? null,
    note: input.resolutionNote ?? null,
    detailJson: { resolution_code: input.resolutionCode || 'resolved' },
  })
}

export async function dismissReportForAdmin(input: {
  reportId: number
  actorUserId: number
  resolutionCode?: string | null
  resolutionNote?: string | null
}): Promise<{ report: any; actionId: number }> {
  const provided = input.resolutionCode != null ? String(input.resolutionCode).trim() : ''
  if (provided && !isDismissedResolutionCode(provided)) {
    throw new DomainError('invalid_resolution_code', 'invalid_resolution_code', 400)
  }
  const code = provided || 'no_violation_found'
  return mutateReportLifecycle({
    reportId: input.reportId,
    actorUserId: input.actorUserId,
    actionType: 'dismiss',
    nextStatus: 'dismissed',
    resolutionCode: code,
    resolutionNote: input.resolutionNote ?? null,
    note: input.resolutionNote ?? null,
    detailJson: { resolution_code: code },
  })
}

async function mutateReportLifecycleForSpace(
  input: ReportMutationInput & { expectedSpaceId?: number | null }
): Promise<{ report: any; actionId: number }> {
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await repo.getReportByIdForUpdate(input.reportId, conn as any)
    if (!row) throw new DomainError('report_not_found', 'report_not_found', 404)
    const reportSpaceId = Number(row.space_id || 0)
    if (
      input.expectedSpaceId != null &&
      Number(input.expectedSpaceId) > 0 &&
      Number(input.expectedSpaceId) !== reportSpaceId
    ) {
      throw new DomainError('forbidden', 'forbidden', 403)
    }
    await assertCanSpaceModerateReports(input.actorUserId, reportSpaceId)

    const currentStatus = String(row.status || 'open') as repo.ReportStatus
    const nextStatus = input.nextStatus ?? currentStatus
    assertCanTransition(currentStatus, nextStatus)
    const statusChanged = nextStatus !== currentStatus
    const willBeTerminal = TERMINAL_STATUSES.has(nextStatus)
    const shouldWriteTerminalMetadata =
      willBeTerminal && (statusChanged || input.actionType === 'resolve' || input.actionType === 'dismiss')
    await repo.updateReportLifecycle(
      {
        reportId: input.reportId,
        status: nextStatus,
        assignedToUserId: input.assignToUserId,
        resolvedByUserId: shouldWriteTerminalMetadata ? input.actorUserId : statusChanged ? null : undefined,
        resolvedAt: shouldWriteTerminalMetadata ? new Date() : statusChanged ? null : undefined,
        resolutionCode: shouldWriteTerminalMetadata ? (input.resolutionCode ?? null) : statusChanged ? null : undefined,
        resolutionNote: shouldWriteTerminalMetadata ? (input.resolutionNote ?? null) : statusChanged ? null : undefined,
        touchLastActionAt: true,
      },
      conn as any
    )
    const actionId = await repo.insertReportAction(
      {
        reportId: input.reportId,
        actorUserId: input.actorUserId,
        actionType: input.actionType,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        note: input.note ?? null,
        detailJson: input.detailJson ?? null,
      },
      conn as any
    )
    await conn.commit()
    const report = await repo.getReportById(input.reportId)
    if (!report) throw new DomainError('report_not_found', 'report_not_found', 404)
    return { report, actionId }
  } catch (err) {
    try { await conn.rollback() } catch {}
    throw err
  } finally {
    try { conn.release() } catch {}
  }
}

export async function setReportStatusForSpaceModerator(input: {
  reportId: number
  actorUserId: number
  status: repo.ReportStatus
  note?: string | null
  spaceId?: number | null
}): Promise<{ report: any; actionId: number }> {
  return mutateReportLifecycleForSpace({
    reportId: input.reportId,
    actorUserId: input.actorUserId,
    actionType: 'status_change',
    nextStatus: input.status,
    note: input.note ?? null,
    detailJson: { status: input.status },
    expectedSpaceId: input.spaceId ?? null,
  })
}

export async function resolveReportForSpaceModerator(input: {
  reportId: number
  actorUserId: number
  resolutionCode: string
  resolutionNote?: string | null
  spaceId?: number | null
}): Promise<{ report: any; actionId: number }> {
  if (!isResolvedResolutionCode(String(input.resolutionCode || ''))) {
    throw new DomainError('invalid_resolution_code', 'invalid_resolution_code', 400)
  }
  return mutateReportLifecycleForSpace({
    reportId: input.reportId,
    actorUserId: input.actorUserId,
    actionType: 'resolve',
    nextStatus: 'resolved',
    resolutionCode: String(input.resolutionCode || '').slice(0, 64) || 'resolved',
    resolutionNote: input.resolutionNote ?? null,
    note: input.resolutionNote ?? null,
    detailJson: { resolution_code: input.resolutionCode || 'resolved' },
    expectedSpaceId: input.spaceId ?? null,
  })
}
