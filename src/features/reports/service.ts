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

export async function submitPublicationReport(publicationId: number, userId: number, input: { ruleId: number }) {
  const ruleId = Number(input?.ruleId)
  if (!Number.isFinite(ruleId) || ruleId <= 0) throw new DomainError('bad_rule_id', 'bad_rule_id', 400)

  const pub = await repo.getPublishedPublicationSummary(publicationId)
  if (!pub) throw new DomainError('publication_not_found', 'publication_not_found', 404)

  await spacesSvc.assertCanViewSpaceFeed(pub.space_id, userId)

  const allowed = await repo.getReportableRuleForSpace(pub.space_id, ruleId)
  if (!allowed) throw new DomainError('rule_not_allowed', 'rule_not_allowed', 400)

  try {
    const reportId = await repo.insertSpacePublicationReport({
      spacePublicationId: publicationId,
      spaceId: pub.space_id,
      productionId: pub.production_id,
      reporterUserId: userId,
      ruleId: allowed.rule_id,
      ruleVersionId: allowed.current_version_id,
    })
    return { ok: true, reportId }
  } catch (err: any) {
    if (String(err?.code || '') === 'ER_DUP_ENTRY') {
      throw new DomainError('already_reported', 'already_reported', 409)
    }
    throw err
  }
}
