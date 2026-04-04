import { DomainError } from '../../core/errors'
import * as spacesSvc from '../spaces/service'
import * as repo from './repo'

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
    rules: Array<{ id: number; slug: string; title: string; priority: number; isDefault: boolean }>
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
          createdAt: existingReport.created_at,
        }
      : null,
    groups,
  }
}

export async function submitPublicationReport(
  publicationId: number,
  userId: number,
  input: { ruleId?: number | null; userFacingRuleId?: number | null }
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
    const reportId = await repo.insertSpacePublicationReport({
      spacePublicationId: publicationId,
      spaceId: pub.space_id,
      productionId: pub.production_id,
      reporterUserId: userId,
      ruleId: resolvedRule.rule_id,
      ruleVersionId: resolvedRule.current_version_id,
      userFacingRuleId: resolvedUserFacingSummary?.id ?? null,
      userFacingRuleLabelAtSubmit: resolvedUserFacingSummary?.label ?? null,
      userFacingGroupKeyAtSubmit: resolvedUserFacingSummary?.group_key ?? null,
      userFacingGroupLabelAtSubmit: resolvedUserFacingSummary?.group_label ?? null,
    })
    return { ok: true, reportId }
  } catch (err: any) {
    if (String(err?.code || '') === 'ER_DUP_ENTRY') {
      throw new DomainError('already_reported', 'already_reported', 409)
    }
    throw err
  }
}
