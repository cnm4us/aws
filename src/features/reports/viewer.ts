import { Router } from 'express';
import { DOMParser } from '@xmldom/xmldom';
import { getPool, type Queryable } from '../../db';
import { DomainError } from '../../core/errors';
import { renderMarkdown } from '../../utils/markdown';
import { resolveViewer, ViewerApiError } from '../native-sessions/service';
import { sendViewerError } from '../../routes/native-session';
import { positiveId, emptyQuery, noBody } from '../engagement/contract';
import { transaction } from '../engagement/repo';
import * as feeds from '../feeds/repo';
import * as spaces from '../spaces/service';
import * as repo from './repo';
import { getAuthorizedReportingOptions, submitAuthorizedPublicationReport } from './service';

export type ReportContext = { kind: 'global' } | { kind: 'space'; spaceId: number };
export type ReportTarget = { context: ReportContext; publicationId: number; userId: number };
const globalSlug = (slug: unknown) => ['global', 'global-feed'].includes(String(slug).toLowerCase());
const dependencies = {
  global: feeds.listGlobalFeedRows, space: feeds.listSpaceFeedRows,
  loadSpace: spaces.loadSpaceOrThrow, canView: spaces.canViewSpaceFeed,
  publication: repo.getPublishedPublicationSummary, options: getAuthorizedReportingOptions,
  lockConfiguration: async (groupId: number, db: Queryable) => {
    await db.query('SELECT id FROM user_facing_rules WHERE id=? FOR UPDATE', [groupId]);
    await db.query(`SELECT r.id FROM user_facing_rule_rule_map m JOIN rules r ON r.id=m.rule_id
      WHERE m.user_facing_rule_id=? FOR UPDATE`, [groupId]);
  },
  own: repo.getUserPublicationReport, mapped: repo.resolveMappedRuleForUserFacingReason, submit: submitAuthorizedPublicationReport, transaction,
  detail: async (ruleId: number, versionId: number, db: Queryable = getPool()) => {
    const [rows] = await db.query(`SELECT r.title, v.version, v.markdown, v.html,
      v.allowed_examples_markdown, v.allowed_examples_html, v.disallowed_examples_markdown, v.disallowed_examples_html
      FROM rules r JOIN rule_versions v ON v.id=r.current_version_id AND v.rule_id=r.id
      WHERE r.id=? AND v.id=? AND r.visibility IN ('public','authenticated')`, [ruleId, versionId]);
    return (rows as any[])[0] ?? null;
  },
};
export function reportBody(value: unknown) {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['userFacingRuleId', 'ruleId', 'reportedStartSeconds', 'reportedEndSeconds'].includes(k)))
    throw new ViewerApiError(400, 'invalid_report');
  const id = (n: unknown): number => { if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw new ViewerApiError(400, 'invalid_report'); return n; };
  const time = (n: unknown) => { if (n == null) return null; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 2147483647) throw new ViewerApiError(400, 'invalid_report_time_range'); return n; };
  const reportedStartSeconds = time(v.reportedStartSeconds), reportedEndSeconds = time(v.reportedEndSeconds);
  if (reportedStartSeconds !== null && reportedEndSeconds !== null && reportedEndSeconds < reportedStartSeconds) throw new ViewerApiError(400, 'invalid_report_time_range');
  return { userFacingRuleId: id(v.userFacingRuleId), ...(v.ruleId === undefined ? {} : { ruleId: id(v.ruleId) }), reportedStartSeconds, reportedEndSeconds };
}
export type ReportBlock = { kind: 'heading' | 'paragraph' | 'list' | 'quote' | 'code'; text: string; links: { label: string; href: string }[] };
// Text/links only. No guidance, HTML execution, images, credentials or history.
export function reportDocument(markdown: unknown, legacyHtml: unknown): ReportBlock[] {
  const md = String(markdown ?? ''), legacy = String(legacyHtml ?? '');
  if (md.length > 65536 || legacy.length > 131072) throw new ViewerApiError(503, 'reporting_unavailable');
  const html = md.trim() ? renderMarkdown(md).html : legacy;
  if (!html.trim()) return [];
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => { throw new ViewerApiError(503, 'reporting_unavailable'); } } }).parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: ReportBlock[] = [];
  const skip = new Set(['script', 'style', 'iframe', 'object', 'img', 'svg']);
  const text = (n: any): string => skip.has(String(n.nodeName).toLowerCase()) ? '' : n.nodeType === 3 ? String(n.nodeValue ?? '') : Array.from(n.childNodes ?? []).map(text).join('');
  const walk = (node: any, parent?: string) => {
    const tag = String(node.nodeName).toLowerCase(); if (skip.has(tag)) return;
    if (/^(h[1-6]|p|li|pre)$/.test(tag)) {
      const links: ReportBlock['links'] = [];
      for (const a of Array.from(node.getElementsByTagName('a')) as any[]) {
        const href = String(a.getAttribute('href') ?? '');
        try { const u = new URL(href, 'https://report.invalid'); if ((href.startsWith('https://') || href.startsWith('/') && !href.startsWith('//')) && u.protocol === 'https:' && !u.username && !u.password) links.push({ label: text(a), href }); } catch {}
      }
      const content = text(node).trim();
      if (content) blocks.push({ kind: tag[0] === 'h' ? 'heading' : tag === 'li' ? 'list' : tag === 'pre' ? 'code' : parent === 'blockquote' ? 'quote' : 'paragraph', text: content, links });
    } else if (node.nodeType === 3) {
      const content = text(node).trim(); if (content) blocks.push({ kind: 'paragraph', text: content, links: [] });
    } else for (const child of Array.from(node.childNodes ?? [])) walk(child, tag);
  };
  walk(doc.documentElement);
  if (blocks.length > 1000 || blocks.some(b => b.links.length > 100)) throw new ViewerApiError(503, 'reporting_unavailable');
  return blocks;
}
export function createViewerReporting(deps = dependencies) {
  const eligible = async (target: ReportTarget, db?: Queryable) => {
    const { context, publicationId, userId } = target;
    if (!userId) throw new ViewerApiError(401, 'unauthorized');
    const pub = await deps.publication(publicationId, db);
    if (!pub || pub.id !== publicationId || context.kind === 'space' && pub.space_id !== context.spaceId) throw new ViewerApiError(404, 'publication_not_found');
    const destination = await deps.loadSpace(pub.space_id, db);
    if (context.kind === 'global' ? !globalSlug(destination.slug) : globalSlug(destination.slug) || !['personal', 'group', 'channel'].includes(destination.type)) throw new ViewerApiError(404, 'publication_not_found');
    if (context.kind === 'space' && !await deps.canView(destination, userId, db)) throw new ViewerApiError(403, 'forbidden');
    const selection = { publicationId, userId, limit: 1 };
    const row = (context.kind === 'global' ? await deps.global(selection, db) : await deps.space(context.spaceId, selection, db))[0];
    if (!row || Number(row.publication_id) !== publicationId || Number(row.space_id) !== pub.space_id) throw new ViewerApiError(404, 'publication_not_found');
    return pub;
  };
  const identity = (target: ReportTarget, spaceId: number) => ({ context: target.context, publicationId: target.publicationId, spaceId });
  return {
    options: async (target: ReportTarget) => {
      const pub = await eligible(target), data = await deps.options(pub, target.userId);
      await eligible(target);
      if (data.allGroups.length > 100 || data.allGroups.some(g => g.rules.length > 100)) throw new ViewerApiError(503, 'reporting_unavailable');
      return { ...identity(target, pub.space_id), reportedByMe: data.reportedByMe, myReport: data.myReport,
        groups: data.allGroups, initialGroupIds: data.initialGroups.map(g => g.id), durationSeconds: pub.upload_duration_seconds };
    },
    detail: async (target: ReportTarget, groupId: number, ruleId: number) => {
      const pub = await eligible(target);
      const mapping = await deps.mapped({ spaceId: pub.space_id, userFacingRuleId: groupId, ruleId, viewerState: 'authenticated' });
      if (!mapping?.current_version_id) throw new ViewerApiError(404, 'report_rule_unavailable');
      const row = await deps.detail(ruleId, mapping.current_version_id);
      if (!row) throw new ViewerApiError(404, 'report_rule_unavailable');
      const result = { ...identity(target, pub.space_id), groupId, ruleId, version: Number(row.version), title: String(row.title),
        description: reportDocument(row.markdown, row.html), allowed: reportDocument(row.allowed_examples_markdown, row.allowed_examples_html), disallowed: reportDocument(row.disallowed_examples_markdown, row.disallowed_examples_html) };
      await eligible(target);
      const fresh = await deps.mapped({ spaceId: pub.space_id, userFacingRuleId: groupId, ruleId, viewerState: 'authenticated' });
      if (fresh?.current_version_id !== mapping.current_version_id) throw new ViewerApiError(404, 'report_rule_unavailable');
      return result;
    },
    submit: async (target: ReportTarget, input: ReturnType<typeof reportBody>) => {
      await eligible(target);
      return deps.transaction(target.publicationId, async db => {
        const pub = await eligible(target, db);
        await deps.lockConfiguration(input.userFacingRuleId, db);
        const result = await deps.submit(pub, target.userId, input, db);
        await eligible(target, db);
        // Read before commit: an error here rolls back, never mislabels a committed write.
        const own = await deps.own(target.publicationId, target.userId, db);
        if (!own) throw new ViewerApiError(503, 'reporting_unavailable');
        return { ...identity(target, pub.space_id), ...result, reportedByMe: true, myReport: {
          ruleId: own.rule_id, ruleTitle: own.rule_title, ruleSlug: own.rule_slug,
          userFacingRuleId: own.user_facing_rule_id, userFacingRuleLabel: own.user_facing_rule_label_at_submit,
          reportedStartSeconds: own.reported_start_seconds, reportedEndSeconds: own.reported_end_seconds, createdAt: own.created_at,
        } };
      });
    },
  };
}
export const viewerReporting = createViewerReporting();
export function createReportingRouter(deps = { resolveViewer, service: viewerReporting }) {
  const router = Router();
  for (const scope of ['global', 'space'] as const) {
    const prefix = scope === 'global' ? '/feed/global/publications/:publicationId' : '/spaces/:spaceId/publications/:publicationId';
    for (const operation of ['options', 'detail', 'submit'] as const) {
      const path = prefix + (operation === 'options' ? '/reporting/options' : operation === 'detail' ? '/reporting/groups/:groupId/rules/:ruleId' : '/report');
      router[operation === 'submit' ? 'post' : 'get'](path, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
          const principal = (await deps.resolveViewer(req, true))!;
          emptyQuery(req.query);
          const params = req.params as Record<string, string>;
          const target: ReportTarget = { context: scope === 'global' ? { kind: 'global' } : { kind: 'space', spaceId: positiveId(params.spaceId) }, publicationId: positiveId(params.publicationId), userId: principal.viewer.id };
          let result;
          if (operation === 'submit') {
            if (!req.is('application/json')) throw new ViewerApiError(400, 'invalid_report');
            result = await deps.service.submit(target, reportBody(req.body));
          } else { noBody(req.body); result = operation === 'options' ? await deps.service.options(target) : await deps.service.detail(target, positiveId(params.groupId), positiveId(params.ruleId)); }
          if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new ViewerApiError(503, 'reporting_unavailable');
          res.status(operation === 'submit' ? 201 : 200).json(result);
        } catch (error) {
          // Preserve reporting duplicate/validation errors without altering unrelated viewer routes.
          if (error instanceof DomainError && ['already_reported', 'rule_not_allowed', 'no_resolvable_rule', 'invalid_user_facing_rule_id', 'invalid_reported_time_seconds', 'invalid_report_time_range'].includes(error.code))
            sendViewerError(res, new ViewerApiError(error.status ?? 400, error.code));
          else sendViewerError(res, error);
        }
      });
    }
  }
  return router;
}
