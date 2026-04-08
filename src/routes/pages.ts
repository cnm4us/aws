import { Router } from 'express';
import path from 'path';
import { BUILD_TAG } from '../utils/version';
import { requireSiteAdminPage, requireSpaceAdminPage, requireSpaceModeratorPage } from '../middleware/auth';
import { getPool } from '../db'
import { renderMarkdown } from '../utils/markdown'
import { parseCookies } from '../utils/cookies'
import { can } from '../security/permissions'
import { PERM } from '../security/perm'
import * as adminSvc from '../features/admin/service'
import * as spacesSvc from '../features/spaces/service'
import * as pubsSvc from '../features/publications/service'
import * as uploadsSvc from '../features/uploads/service'
import * as audioConfigsSvc from '../features/audio-configs/service'
import * as audioTagsSvc from '../features/audio-tags/service'
import * as audioTagsRepo from '../features/audio-tags/repo'
import * as licenseSourcesSvc from '../features/license-sources/service'
import * as licenseSourcesRepo from '../features/license-sources/repo'
import * as lowerThirdsSvc from '../features/lower-thirds/service'
import * as messagesSvc from '../features/messages/service'
import * as messageCtasSvc from '../features/message-cta-definitions/service'
import * as messageRulesetsSvc from '../features/message-eligibility-rulesets/service'
import * as messageJourneysSvc from '../features/message-journeys/service'
import * as messageAnalyticsSvc from '../features/message-analytics/service'
import * as userFacingRulesSvc from '../features/user-facing-rules/service'
import * as reportsSvc from '../features/reports/service'
import * as culturesRepo from '../features/cultures/repo'
import {
  CULTURE_AI_HINTS,
  CULTURE_DISRUPTION_SIGNALS,
  CULTURE_INTERACTION_STYLES,
  CULTURE_TOLERANCE_LEVELS,
  CULTURE_TONE_EXPECTATIONS,
  deriveCultureDefinitionIdFromKey,
  normalizeCultureDefinitionForValidation,
  type CultureDefinitionValidationError,
  type CultureDefinitionV1,
  validateCultureDefinitionV1,
} from '../features/cultures'
import {
  ALL_RESOLUTION_CODES,
  getResolutionTerminalStatus,
  getResolutionCodeLabel,
} from '../features/reports/resolution-codes'
import * as feedActivitySvc from '../features/feed-activity/service'
import * as paymentsSvc from '../features/payments/service'
import { getAnalyticsSinkHealth } from '../features/analytics-sink/service'
import { GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { s3 } from '../services/s3'
import { pipeline } from 'stream/promises'
import { TERMS_UPLOAD_VERSION } from '../config'
import { librarySourceOptions, getLibrarySourceLabel } from '../config/librarySources'
import { getLogger, logError } from '../lib/logger'

const publicDir = path.join(process.cwd(), 'public');
const pagesLogger = getLogger({ component: 'routes.pages' })

function serveHtml(res: any, relativePath: string) {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, relativePath));
}

function serveAppSpa(res: any) {
  serveHtml(res, path.join('app', 'index.html'));
}

function serveSpaceSpa(res: any) {
  serveHtml(res, path.join('space-app', 'index.html'));
}

export const pagesRouter = Router();

// Public terms page (Plan 52): simple placeholder content for now.
pagesRouter.get('/terms/upload', (_req: any, res: any) => {
  const body = `<main>
    <h1>Upload Terms</h1>
    <p><strong>Version:</strong> ${escapeHtml(TERMS_UPLOAD_VERSION)}</p>
    <p>TBD</p>
  </main>`
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(renderPageDocument('Upload Terms', body))
})

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPageDocument(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title || 'Page');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#000000" />
    <title>${safeTitle}</title>
    <style>
      html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #05070a; color: #f5f5f5; }
      main { max-width: 720px; margin: 0 auto; padding: 24px 16px 40px; line-height: 1.6; }
      a { color: #9cf; }
      h1, h2, h3 { font-weight: 600; }
      h1 { font-size: 1.9rem; margin: 0 0 0.75rem; }
      h2 { font-size: 1.4rem; margin-top: 1.5rem; }
      h3 { font-size: 1.15rem; margin-top: 1rem; }
      p { margin: 0 0 0.85rem; }
      ul, ol { padding-left: 1.25rem; margin: 0.1rem 0 0.85rem; }
      blockquote { border-left: 3px solid rgba(255,255,255,0.25); margin: 0.8rem 0; padding: 0.1rem 0 0.1rem 0.75rem; color: rgba(255,255,255,0.85); }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.9em; }
      pre { background: rgba(0,0,0,0.75); border-radius: 6px; padding: 10px 12px; overflow-x: auto; font-size: 0.9em; }
      hr { border: 0; border-top: 1px solid rgba(255,255,255,0.15); margin: 1.5rem 0; }
      .rule-meta { margin: 0 0 0.55rem; opacity: 0.85; font-size: 0.92rem; }
      .section { border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; padding: 14px 14px 12px; margin: 14px 0; background: rgba(0,0,0,0.35); }
      .section-title { font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.78; margin: 0 0 10px; }
    </style>
  </head>
  <body>
    <main>
${bodyHtml}
    </main>
  </body>
</html>`;
}

async function hasAnySpaceAdmin(userId: number): Promise<boolean> {
  const db = getPool();
  const [rows] = await db.query(
    `SELECT r.name
       FROM user_space_roles usr
       JOIN roles r ON r.id = usr.role_id
      WHERE usr.user_id = ?`,
    [userId]
  );
  for (const row of rows as any[]) {
    const n = String(row.name || '').toLowerCase();
    if (n === 'space_admin' || n === 'group_admin' || n === 'channel_admin') return true;
  }
  return false;
}

async function hasAnySpaceModerator(userId: number): Promise<boolean> {
  const db = getPool();
  const [rows] = await db.query(
    `SELECT r.name
       FROM user_space_roles usr
       JOIN roles r ON r.id = usr.role_id
      WHERE usr.user_id = ?`,
    [userId]
  );
  for (const row of rows as any[]) {
    const n = String(row.name || '').toLowerCase();
    if (n === 'space_moderator' || n === 'moderator') return true;
    if (n === 'space_admin' || n === 'group_admin' || n === 'channel_admin') return true;
  }
  return false;
}

type PageVisibility = 'public' | 'authenticated' | 'space_moderator' | 'space_admin';

async function requireAnySpaceAdminPage(req: any, res: any, next: any) {
  try {
    const from = encodeURIComponent(req.originalUrl || '/');
    if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`);
    // Site admin always allowed
    if (await can(req.user.id, PERM.VIDEO_DELETE_ANY)) return next();
    if (await hasAnySpaceAdmin(req.user.id)) return next();
    return res.redirect(`/forbidden?from=${from}`);
  } catch {
    const from = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/forbidden?from=${from}`);
  }
}

async function requireAnySpaceModeratorPage(req: any, res: any, next: any) {
  try {
    const from = encodeURIComponent(req.originalUrl || '/');
    if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`);
    // Site admin always allowed
    if (await can(req.user.id, PERM.VIDEO_DELETE_ANY)) return next();
    if (await hasAnySpaceModerator(req.user.id)) return next();
    return res.redirect(`/forbidden?from=${from}`);
  } catch {
    const from = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/forbidden?from=${from}`);
  }
}

async function requireGlobalModerationPage(req: any, res: any, next: any) {
  try {
    const from = encodeURIComponent(req.originalUrl || '/')
    if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`)
    const userId = Number(req.user.id)
    const ok =
      (await can(userId, PERM.VIDEO_DELETE_ANY)) ||
      (await can(userId, PERM.FEED_MODERATE_GLOBAL)) ||
      (await can(userId, PERM.FEED_PUBLISH_GLOBAL))
    if (!ok) return res.redirect(`/forbidden?from=${from}`)
    return next()
  } catch {
    const from = encodeURIComponent(req.originalUrl || '/')
    return res.redirect(`/forbidden?from=${from}`)
  }
}

async function ensurePageVisibility(req: any, res: any, visibility: PageVisibility): Promise<boolean> {
  if (visibility === 'public') return true;

  const from = encodeURIComponent(req.originalUrl || '/');
  const user = req.user;
  const session = req.session;

  if (!user || !session) {
    if (visibility === 'authenticated') {
      res.redirect(`/login?from=${from}`);
    } else {
      res.redirect(`/forbidden?from=${from}`);
    }
    return false;
  }

  if (visibility === 'authenticated') return true;
  if (visibility === 'space_moderator') {
    if (await hasAnySpaceModerator(user.id)) return true;
    res.redirect(`/forbidden?from=${from}`);
    return false;
  }
  if (visibility === 'space_admin') {
    if (await hasAnySpaceAdmin(user.id)) return true;
    res.redirect(`/forbidden?from=${from}`);
    return false;
  }

  return true;
}

function normalizePageSlug(raw: string): string | null {
  const trimmed = String(raw || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  const segments = trimmed.split('/');
  if (segments.length === 0 || segments.length > 4) return null;
  for (const segment of segments) {
    if (!/^[a-z][a-z0-9-]*$/.test(segment)) return null;
  }
  return segments.join('/');
}

function normalizePagePath(raw: string): string | null {
  const trimmed = String(raw || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return null
  const segments = trimmed.split('/')
  if (segments.length === 0 || segments.length > 8) return null
  for (const segment of segments) {
    if (!/^[a-z][a-z0-9-]*$/.test(segment)) return null
  }
  return segments.join('/')
}

function normalizePageNodeSlug(raw: string): string | null {
  const trimmed = String(raw || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return null
  if (!/^[a-z][a-z0-9-]*$/.test(trimmed)) return null
  return trimmed
}

function jsonNoStore(res: any) {
  res.set('Cache-Control', 'no-store');
}

function jsonError(res: any, status: number, code: string) {
  jsonNoStore(res);
  res.status(status).json({ error: code });
}

function parsePositiveIntOrNull(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

function normalizeReturnPathForSupport(raw: any, fallback = '/'): string {
  const value = String(raw || '').trim()
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  return value
}

async function ensurePageVisibilityJson(req: any, res: any, visibility: PageVisibility): Promise<boolean> {
  if (visibility === 'public') return true;

  const user = req.user;
  const session = req.session;
  if (!user || !session) {
    return jsonError(res, 401, 'unauthorized'), false;
  }

  if (visibility === 'authenticated') return true;

  if (visibility === 'space_moderator') {
    if (await hasAnySpaceModerator(user.id)) return true;
    return jsonError(res, 403, 'forbidden'), false;
  }

  if (visibility === 'space_admin') {
    if (await hasAnySpaceAdmin(user.id)) return true;
    return jsonError(res, 403, 'forbidden'), false;
  }

  return true;
}

async function allowedPageVisibilitiesForRequest(req: any): Promise<PageVisibility[]> {
  const user = req.user
  const session = req.session
  const allowed: PageVisibility[] = ['public']
  if (user && session) {
    allowed.push('authenticated')
    if (await hasAnySpaceModerator(user.id)) allowed.push('space_moderator')
    if (await hasAnySpaceAdmin(user.id)) allowed.push('space_admin')
  }
  return allowed
}

async function canViewGuidance(req: any): Promise<boolean> {
  const user = req.user;
  const session = req.session;
  if (!user || !session) return false;
  try {
    return (
      (await can(user.id, PERM.VIDEO_DELETE_ANY)) ||
      (await can(user.id, PERM.FEED_MODERATE_GLOBAL)) ||
      (await can(user.id, PERM.FEED_PUBLISH_GLOBAL))
    );
  } catch {
    return false;
  }
}

async function resolvePageByPath(pathValue: string): Promise<any | null> {
  const normalized = normalizePagePath(pathValue)
  if (!normalized) return null
  const segments = normalized.split('/')
  const db = getPool()
  let parentId: number | null = null
  let current: any = null
  for (const segment of segments) {
    const query = parentId == null
      ? `SELECT id, type, parent_id, slug, title, html, visibility, layout, updated_at
           FROM pages
          WHERE slug = ? AND parent_id IS NULL
          LIMIT 1`
      : `SELECT id, type, parent_id, slug, title, html, visibility, layout, updated_at
           FROM pages
          WHERE slug = ? AND parent_id = ?
          LIMIT 1`
    const params = parentId == null ? [segment] : [segment, parentId]
    const [rows] = await db.query(query, params)
    current = (rows as any[])[0] || null
    if (!current) return null
    parentId = Number(current.id)
  }
  return current
}

async function listChildPagesByParent(
  parentId: number | null,
  allowedVisibilities: PageVisibility[]
): Promise<Array<{ id: number; type: 'section' | 'document'; slug: string; title: string; visibility: string }>> {
  const db = getPool()
  const parentWhere = parentId == null ? 'p.parent_id IS NULL' : 'p.parent_id = ?'
  const [rows] = await db.query(
    `SELECT p.id, p.type, p.slug, p.title, p.visibility
       FROM pages p
      WHERE ${parentWhere}
        AND p.visibility IN (${allowedVisibilities.map(() => '?').join(',')})
      ORDER BY p.sort_order ASC, p.title ASC, p.id ASC
      LIMIT 300`,
    parentId == null ? [...allowedVisibilities] : [parentId, ...allowedVisibilities]
  )
  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    type: String(r.type || 'document') === 'section' ? 'section' : 'document',
    slug: String(r.slug || ''),
    title: String(r.title || ''),
    visibility: String(r.visibility || 'public'),
  }))
}

// -------- JSON APIs: Pages & Rules (latest only; SPA embed) --------

pagesRouter.get('/api/pages', async (req: any, res: any) => {
  try {
    const allowed = await allowedPageVisibilitiesForRequest(req)
    const children = await listChildPagesByParent(null, allowed)
    jsonNoStore(res)
    res.json({
      slug: '',
      type: 'section',
      title: 'Pages',
      html: '',
      visibility: 'public',
      layout: 'default',
      updatedAt: null,
      children: children.map((c) => ({
        id: c.id,
        slug: c.slug,
        type: c.type,
        title: c.title || c.slug,
        url: `/pages/${c.slug}`,
      })),
    })
  } catch (err) {
    logError(req.log || pagesLogger, err, 'api pages root failed', { path: req.path })
    jsonError(res, 500, 'internal_error')
  }
})

pagesRouter.get(/^\/api\/pages\/(.+)$/, async (req: any, res: any) => {
  try {
    const rawSlug = String((req.params as any)[0] || '');
    let decoded = rawSlug;
    try { decoded = decodeURIComponent(rawSlug) } catch {}
    const slugPath = normalizePagePath(decoded)
    if (!slugPath) return jsonError(res, 400, 'bad_slug');
    const page = await resolvePageByPath(slugPath)
    if (!page) return jsonError(res, 404, 'page_not_found');

    const ok = await ensurePageVisibilityJson(req, res, page.visibility as PageVisibility);
    if (!ok) return;

    const allowed = await allowedPageVisibilitiesForRequest(req)
    const segments = slugPath.split('/')
    const children = await listChildPagesByParent(Number(page.id), allowed)
    const updatedAt = page.updated_at ? new Date(page.updated_at) : null;
    const includeChildren = String(page.type || 'document') === 'section' || children.length > 0
    jsonNoStore(res);
    res.json({
      id: Number(page.id),
      slug: slugPath,
      type: String(page.type || 'document') === 'section' ? 'section' : 'document',
      title: page.title != null ? String(page.title) : '',
      html: String(page.html || ''),
      visibility: String(page.visibility || 'public'),
      layout: page.layout != null ? String(page.layout) : 'default',
      updatedAt: updatedAt && !isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null,
      ...(includeChildren
        ? {
            children: children.map((c) => ({
              id: c.id,
              slug: c.slug,
              type: c.type,
              title: c.title || c.slug,
              url: `/pages/${[...segments, c.slug].join('/')}`,
            })),
          }
        : {}),
    });
  } catch (err) {
    logError(req.log || pagesLogger, err, 'api pages failed', { path: req.path })
    jsonError(res, 500, 'internal_error');
  }
});

pagesRouter.get(/^\/api\/rules\/(.+)$/, async (req: any, res: any) => {
  try {
    const rawSlug = String((req.params as any)[0] || '');
    let decoded = rawSlug;
    try { decoded = decodeURIComponent(rawSlug) } catch {}
    const slug = normalizePageSlug(decoded);
    if (!slug) return jsonError(res, 400, 'bad_slug');

    const db = getPool();
    const [ruleRows] = await db.query(
      `SELECT id, slug, title, visibility, current_version_id
         FROM rules
        WHERE slug = ?
        LIMIT 1`,
      [slug]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule || !rule.current_version_id) return jsonError(res, 404, 'rule_not_found');

    const ok = await ensurePageVisibilityJson(req, res, rule.visibility as PageVisibility);
    if (!ok) return;

    const [currentRows] = await db.query(
      `SELECT version, html, created_at, change_summary,
              short_description,
              allowed_examples_html,
              disallowed_examples_html,
              guidance_html,
              guidance_moderators_html,
              guidance_agents_html
         FROM rule_versions
        WHERE id = ? AND rule_id = ?
        LIMIT 1`,
      [rule.current_version_id, rule.id]
    );
    const current = (currentRows as any[])[0];
    if (!current) return jsonError(res, 404, 'rule_not_found');

    const [versionRows] = await db.query(
      `SELECT version, created_at, change_summary
         FROM rule_versions
        WHERE rule_id = ?
        ORDER BY version DESC
        LIMIT 200`,
      [rule.id]
    );
    const versions = (versionRows as any[]).map((r) => {
      const createdAt = r.created_at ? new Date(r.created_at) : null;
      return {
        version: Number(r.version),
        url: `/rules/${slug}/v:${Number(r.version)}`,
        createdAt: createdAt && !isNaN(createdAt.getTime()) ? createdAt.toISOString() : null,
        ...(r.change_summary ? { changeSummary: String(r.change_summary) } : {}),
      };
    });

    const createdAt = current.created_at ? new Date(current.created_at) : null;
    const includeGuidance = await canViewGuidance(req);
    const moderatorsGuidanceHtml =
      current.guidance_moderators_html != null ? String(current.guidance_moderators_html) :
      (current.guidance_html != null ? String(current.guidance_html) : '');
    const agentsGuidanceHtml = current.guidance_agents_html != null ? String(current.guidance_agents_html) : '';
    jsonNoStore(res);
    res.json({
      slug,
      title: rule.title != null ? String(rule.title) : '',
      html: String(current.html || ''),
      ...(current.short_description ? { shortDescription: String(current.short_description) } : {}),
      ...(current.allowed_examples_html ? { allowedExamplesHtml: String(current.allowed_examples_html) } : {}),
      ...(current.disallowed_examples_html ? { disallowedExamplesHtml: String(current.disallowed_examples_html) } : {}),
      ...(includeGuidance && moderatorsGuidanceHtml ? { guidanceModeratorsHtml: moderatorsGuidanceHtml } : {}),
      ...(includeGuidance && agentsGuidanceHtml ? { guidanceAgentsHtml: agentsGuidanceHtml } : {}),
      visibility: String(rule.visibility || 'public'),
      currentVersion: {
        version: Number(current.version),
        url: `/rules/${slug}/v:${Number(current.version)}`,
        createdAt: createdAt && !isNaN(createdAt.getTime()) ? createdAt.toISOString() : null,
        ...(current.change_summary ? { changeSummary: String(current.change_summary) } : {}),
      },
      versions,
    });
  } catch (err) {
    logError(req.log || pagesLogger, err, 'api rules failed', { path: req.path })
    jsonError(res, 500, 'internal_error');
  }
});

pagesRouter.get('/api/rules', async (req: any, res: any) => {
  try {
    const user = req.user;
    const session = req.session;

    const allowed: PageVisibility[] = ['public'];
    if (user && session) {
      allowed.push('authenticated');
      if (await hasAnySpaceModerator(user.id)) allowed.push('space_moderator');
      if (await hasAnySpaceAdmin(user.id)) allowed.push('space_admin');
    }

    const db = getPool();
    const [rows] = await db.query(
      `SELECT r.slug, r.title, r.visibility, rv.version, rv.created_at, rv.change_summary
         FROM rules r
         JOIN rule_versions rv ON rv.id = r.current_version_id
        WHERE r.visibility IN (${allowed.map(() => '?').join(',')})
        ORDER BY r.slug
        LIMIT 200`,
      allowed
    );

    jsonNoStore(res);
    res.json({
      items: (rows as any[]).map((r) => {
        const slug = String(r.slug || '');
        const createdAt = r.created_at ? new Date(r.created_at) : null;
        return {
          slug,
          title: r.title != null ? String(r.title) : '',
          visibility: String(r.visibility || 'public'),
          url: `/rules/${slug}`,
          currentVersion: {
            version: Number(r.version),
            url: `/rules/${slug}/v:${Number(r.version)}`,
            createdAt: createdAt && !isNaN(createdAt.getTime()) ? createdAt.toISOString() : null,
            ...(r.change_summary ? { changeSummary: String(r.change_summary) } : {}),
          },
        };
      }),
    });
  } catch (err) {
    logError(req.log || pagesLogger, err, 'api rules index failed', { path: req.path })
    jsonError(res, 500, 'internal_error');
  }
});

pagesRouter.get('/', async (req: any, res: any) => {
  // Phase 2: SPA owns '/', and fetches CMS home content via /api/pages/home.
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/pages', (_req: any, res: any) => {
  serveHtml(res, path.join('app', 'index.html'))
})

pagesRouter.get('/pages/', (_req: any, res: any) => {
  serveHtml(res, path.join('app', 'index.html'))
})

pagesRouter.get(/^\/pages\/(.+)$/, (req: any, res: any) => {
  // SPA owns latest /pages/* views and fetches content via /api/pages/:path.
  // Keep /pages/home non-canonical.
  const rawSlug = String((req.params as any)[0] || '');
  let decoded = rawSlug;
  try { decoded = decodeURIComponent(rawSlug) } catch {}
  const slug = normalizePagePath(decoded);
  if (slug === 'home') return res.redirect('/');
  serveHtml(res, path.join('app', 'index.html'));
});

// -------- Public Rules (latest + specific versions) --------

pagesRouter.get(/^\/rules\/(.+?)\/v:(\d+)\/?$/, async (req: any, res: any) => {
  try {
    const rawSlug = String((req.params as any)[0] || '');
    const slug = normalizePageSlug(decodeURIComponent(rawSlug));
    const versionNum = Number((req.params as any)[1]);
    if (!slug || !Number.isFinite(versionNum) || versionNum <= 0) {
      return res.status(404).send('Rule not found');
    }

    const db = getPool();
    const [ruleRows] = await db.query(
      `SELECT id, slug, title, visibility
         FROM rules
        WHERE slug = ?
        LIMIT 1`,
      [slug]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule) {
      return res.status(404).send('Rule not found');
    }

    const [versionRows] = await db.query(
      `SELECT id, version, html, created_at, change_summary,
              short_description,
              allowed_examples_html,
              disallowed_examples_html,
              guidance_html,
              guidance_moderators_html,
              guidance_agents_html
         FROM rule_versions
        WHERE rule_id = ? AND version = ?
        LIMIT 1`,
      [rule.id, versionNum]
    );
    const version = (versionRows as any[])[0];
    if (!version) {
      return res.status(404).send('Rule version not found');
    }

    const ok = await ensurePageVisibility(req, res, rule.visibility as PageVisibility);
    if (!ok) return;

    const titleText = rule.title || rule.slug;
    const created = version.created_at ? new Date(version.created_at) : null;
    const createdLabel = created && !isNaN(created.getTime()) ? created.toLocaleDateString() : '';
    let body = '';
    body += `<h1>${escapeHtml(String(titleText))}</h1>\n`;
    body += `<div class="section">\n`;
    body += `<div class="section-title">Version Summary</div>\n`;
    body += `<p class="rule-meta">Version v${escapeHtml(String(version.version))}`;
    if (createdLabel) body += ` — published ${escapeHtml(createdLabel)}`;
    body += `</p>\n`;
    if (version.change_summary) {
      body += `<p class="rule-meta">${escapeHtml(String(version.change_summary))}</p>\n`;
    }
    body += `</div>\n`;

    if (version.short_description) {
      body += `<div class="section">\n`;
      body += `<div class="section-title">Short Description</div>\n`;
      body += `<div>${escapeHtml(String(version.short_description))}</div>\n`;
      body += `</div>\n`;
    }

    body += `<div class="section">\n`;
    body += `<div class="section-title">Long Description</div>\n`;
    body += String(version.html || '');
    body += `</div>\n`;

    if (version.allowed_examples_html) {
      body += `<div class="section">\n`;
      body += `<div class="section-title">Allowed Examples</div>\n`;
      body += String(version.allowed_examples_html || '');
      body += `</div>\n`;
    }
    if (version.disallowed_examples_html) {
      body += `<div class="section">\n`;
      body += `<div class="section-title">Disallowed Examples</div>\n`;
      body += String(version.disallowed_examples_html || '');
      body += `</div>\n`;
    }
    const showGuidance = await canViewGuidance(req);
    if (showGuidance) {
      const moderatorsGuidanceHtml =
        version.guidance_moderators_html != null ? String(version.guidance_moderators_html) :
        (version.guidance_html != null ? String(version.guidance_html) : '');
      const agentsGuidanceHtml = version.guidance_agents_html != null ? String(version.guidance_agents_html) : '';

      if (moderatorsGuidanceHtml) {
        body += `<div class="section">\n`;
        body += `<div class="section-title">Guidance for Moderators</div>\n`;
        body += moderatorsGuidanceHtml;
        body += `</div>\n`;
      }
      if (agentsGuidanceHtml) {
        body += `<div class="section">\n`;
        body += `<div class="section-title">Guidance for AI Agents</div>\n`;
        body += agentsGuidanceHtml;
        body += `</div>\n`;
      }
    }

    const doc = renderPageDocument(titleText, body);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'rule version render failed', { path: req.path })
    res.status(500).send('Failed to load rule version');
  }
});

pagesRouter.get(/^\/rules\/(.+)\/?$/, (_req: any, res: any) => {
  // Phase 2: SPA owns latest /rules/:slug views (slug is path-like) and fetches content via /api/rules/:slug.
  // Historical permalinks remain server-rendered at /rules/:slug/v:version.
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/rules', (_req: any, res: any) => {
  // Phase 2: SPA owns /rules index view.
  serveAppSpa(res);
});
pagesRouter.get('/rules/', (_req: any, res: any) => {
  serveAppSpa(res);
});

// -------- Admin: Pages (server-rendered, minimal JS) --------

// Guard all /admin/* UI routes for site admin only
pagesRouter.use('/admin', requireSiteAdminPage);
pagesRouter.use('/adminx', requireSiteAdminPage);

const RESERVED_PAGE_ROOT_SLUGS = new Set([
  'global-feed',
  'channels',
  'groups',
  'users',
  'admin',
  'api',
  'auth',
  'login',
  'logout',
  'support',
  'assets',
  'static',
]);

function isReservedPageSlug(slug: string): boolean {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return false;
  const root = s.split('/')[0];
  return RESERVED_PAGE_ROOT_SLUGS.has(root);
}

type AdminNavKey =
  | 'review'
  | 'users'
  | 'groups'
  | 'channels'
  | 'rules'
  | 'categories'
  | 'cultures'
  | 'pages'
	| 'audio'
	| 'video_library'
	| 'audio_tags'
	| 'license_sources'
	| 'lower_thirds'
	| 'audio_configs'
  | 'media_jobs'
  | 'messages'
  | 'message_ctas'
  | 'message_rulesets'
  | 'user_facing_rules'
  | 'reports'
  | 'message_journeys'
  | 'journey_inspector'
  | 'payment_providers'
  | 'payment_catalog'
  | 'analytics'
  | 'message_analytics'
  | 'analytics_sink'
  | 'debug'
  | 'dev_tools'
	| 'settings'
	| 'dev';

const ADMIN_NAV_ITEMS: Array<{ key: AdminNavKey; label: string; href: string }> = [
  { key: 'review', label: 'Review', href: '/admin/review' },
  { key: 'users', label: 'Users', href: '/admin/users' },
  { key: 'groups', label: 'Groups', href: '/admin/groups' },
  { key: 'channels', label: 'Channels', href: '/admin/channels' },
  { key: 'rules', label: 'Rules', href: '/admin/rules' },
  { key: 'categories', label: 'Categories', href: '/admin/categories' },
  { key: 'cultures', label: 'Cultures', href: '/admin/cultures' },
  { key: 'pages', label: 'Pages', href: '/admin/pages' },
	{ key: 'audio', label: 'Audio', href: '/admin/audio' },
	{ key: 'video_library', label: 'Video Library', href: '/admin/video-library' },
	{ key: 'audio_tags', label: 'Audio Tags', href: '/admin/audio-tags' },
	{ key: 'license_sources', label: 'License Sources', href: '/admin/license-sources' },
	{ key: 'lower_thirds', label: 'Lower Thirds', href: '/admin/lower-thirds' },
	{ key: 'audio_configs', label: 'Audio Configs', href: '/admin/audio-configs' },
	{ key: 'media_jobs', label: 'Media Jobs', href: '/admin/media-jobs' },
  { key: 'messages', label: 'Messages', href: '/admin/messages' },
  { key: 'message_ctas', label: 'Message CTAs', href: '/admin/message-ctas' },
  { key: 'message_rulesets', label: 'Message Rulesets', href: '/admin/message-rulesets' },
  { key: 'user_facing_rules', label: 'User-Facing Rules', href: '/admin/user-facing-rules' },
  { key: 'reports', label: 'Reports', href: '/admin/reports' },
  { key: 'message_journeys', label: 'Message Journeys', href: '/admin/message-journeys' },
  { key: 'journey_inspector', label: 'Journey Inspector', href: '/admin/journey-inspector' },
  { key: 'payment_providers', label: 'Payment Providers', href: '/admin/payments/providers' },
  { key: 'payment_catalog', label: 'Payment Catalog', href: '/admin/payments/catalog' },
  { key: 'analytics', label: 'Analytics', href: '/admin/analytics' },
  { key: 'message_analytics', label: 'Message Analytics', href: '/admin/message-analytics' },
  { key: 'analytics_sink', label: 'Analytics Sink', href: '/admin/analytics-sink' },
  { key: 'debug', label: 'Debug', href: '/admin/debug' },
  { key: 'dev_tools', label: 'Dev Tools', href: '/admin/dev-tools' },
  { key: 'settings', label: 'Settings', href: '/admin/settings' },
  { key: 'dev', label: 'Dev', href: '/admin/dev' },
];

function isAdminDevToolsEnabled(): boolean {
  const env = String(process.env.NODE_ENV || '').trim().toLowerCase()
  if (env !== 'production') return true
  return String(process.env.ENABLE_ADMIN_DEV_TOOLS || '').trim() === '1'
}

function renderAdminPage(opts: { title: string; bodyHtml: string; active?: AdminNavKey }): string {
  const safeTitle = escapeHtml(opts.title || 'Admin');
  const active = opts.active;

  const nav = ADMIN_NAV_ITEMS
    .map((it) => {
      const cls = it.key === active ? 'active' : '';
      return `<a href="${escapeHtml(it.href)}" class="${cls}">${escapeHtml(it.label)}</a>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="/admin-nav.css" />
  </head>
  <body class="admin-shell">
    <input id="adminNavToggle" class="admin-nav-toggle" type="checkbox" aria-hidden="true" />
    <aside class="sidebar" aria-label="Admin navigation">
      <div class="sidebar-header">
        <div class="sidebar-title">Site Admin</div>
        <label for="adminNavToggle" class="sidebar-close">Close</label>
      </div>
      <nav class="sidebar-nav">
        ${nav}
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">${safeTitle}</div>
      </div>
      <main class="content">
${opts.bodyHtml}
      </main>
    </div>
  </body>
</html>`;
}

pagesRouter.get('/admin/pages', async (req: any, res: any) => {
  try {
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''
    const db = getPool();
    const [rows] = await db.query(
      `SELECT id, type, parent_id, sort_order, slug, title, visibility, updated_at
         FROM pages
        ORDER BY parent_id, sort_order, title, id`
    );
    const items = rows as any[];
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const byId = new Map<number, any>()
    for (const it of items) byId.set(Number(it.id), it)
    const pathCache = new Map<number, string>()
    const buildPath = (id: number): string => {
      const cached = pathCache.get(id)
      if (cached) return cached
      const segments: string[] = []
      const visited = new Set<number>()
      let cur: any = byId.get(id) || null
      while (cur) {
        const cid = Number(cur.id)
        if (visited.has(cid)) break
        visited.add(cid)
        segments.push(String(cur.slug || ''))
        cur = cur.parent_id == null ? null : byId.get(Number(cur.parent_id)) || null
      }
      const pathValue = segments.reverse().join('/')
      pathCache.set(id, pathValue)
      return pathValue
    }
    const childrenByParent = new Map<string, any[]>()
    for (const row of items) {
      const key = row.parent_id == null ? 'root' : String(Number(row.parent_id))
      if (!childrenByParent.has(key)) childrenByParent.set(key, [])
      childrenByParent.get(key)!.push(row)
    }
    let body = '<h1>Pages</h1>';
    body += `<style>
      .page-node-head{ display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
      .page-node-meta{ display:flex; align-items:flex-start; gap:8px; }
      .page-move-stack{ display:inline-flex; flex-direction:column; gap:4px; }
      .page-move-btn{
        width: 28px;
        height: 24px;
        line-height: 1;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:0;
        border-radius:8px;
        border:1px solid rgba(255,255,255,0.35);
        background: rgba(255,255,255,0.10);
        color:#fff;
        cursor:pointer;
      }
      .page-move-btn:hover{ background: rgba(255,255,255,0.16); }
    </style>`;
    body += '<div class="toolbar"><div><span class="pill">Pages</span></div><div style="display:flex; gap:8px"><a href="/admin/pages/new?type=section" class="btn">New section</a><a href="/admin/pages/new?type=document" class="btn">New document</a></div></div>';
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    if (!items.length) {
      body += '<p>No pages have been created yet.</p>';
    } else {
      const renderTree = (parentKey: string, depth: number) => {
        const nodes = childrenByParent.get(parentKey) || []
        for (const row of nodes) {
          const id = Number(row.id)
          const type = String(row.type || 'document') === 'section' ? 'section' : 'document'
          const title = escapeHtml(String(row.title || ''))
          const slug = escapeHtml(String(row.slug || ''))
          const vis = escapeHtml(String(row.visibility || 'public'))
          const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : ''
          const sortOrder = Number(row.sort_order || 0)
          const pathValue = buildPath(id)
          const pathEsc = escapeHtml(pathValue)
          const indent = Math.min(42, depth * 14)
          body += `<div class="section" style="margin-top:10px; margin-left:${indent}px">`
          body += `<div class="page-node-head">`
          body += `<div><div style="font-size:1.05rem; font-weight:700"><a href="/admin/pages/${id}">${title || '(untitled)'}</a></div><div class="field-hint"><code>/pages/${pathEsc}</code></div></div>`
          body += `<div class="page-node-meta">`
          body += `<div class="pill">${escapeHtml(type)}</div>`
          body += `<div class="page-move-stack">`
          body += `<form method="post" action="/admin/pages/${id}/move-up" style="margin:0; display:inline-flex">`
          if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
          body += `<button type="submit" class="page-move-btn" title="Move Up" aria-label="Move Up">↑</button>`
          body += `</form>`
          body += `<form method="post" action="/admin/pages/${id}/move-down" style="margin:0; display:inline-flex">`
          if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
          body += `<button type="submit" class="page-move-btn" title="Move Down" aria-label="Move Down">↓</button>`
          body += `</form>`
          body += `</div>`
          body += `</div>`
          body += `</div>`
          body += `<div style="display:grid; gap:6px; margin-top:10px">`
          body += `<div><strong>Slug:</strong> ${slug}</div>`
          body += `<div><strong>Visibility:</strong> ${vis}</div>`
          body += `<div><strong>Sort:</strong> ${escapeHtml(String(sortOrder))}</div>`
          body += `<div><strong>Updated:</strong> ${updated || '-'}</div>`
          body += `</div>`
          body += `<div class="actions" style="margin-top:10px">`
          body += `<a href="/pages/${pathEsc}" class="btn">Open</a>`
          body += `<a href="/admin/pages/${id}" class="btn">Edit</a>`
          if (type === 'section') {
            body += `<a href="/admin/pages/new?type=section&parentId=${id}" class="btn">Child section</a>`
            body += `<a href="/admin/pages/new?type=document&parentId=${id}" class="btn">Child document</a>`
          }
          body += `<form method="post" action="/admin/pages/${id}/delete" style="margin:0; display:inline-flex" onsubmit="return confirm('Delete this ${escapeHtml(type)}?');">`
          if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
          body += `<button type="submit" class="btn danger">Delete</button>`
          body += `</form>`
          body += `</div>`
          body += `</div>`
          renderTree(String(id), depth + 1)
        }
      }
      renderTree('root', 0)
    }
    const doc = renderAdminPage({ title: 'Pages', bodyHtml: body, active: 'pages' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin pages list failed', { path: req.path })
    res.status(500).send('Failed to load pages');
  }
});

// -------- Admin: Categories (server-rendered, minimal JS) --------

function renderCategoryForm(opts: { error?: string | null; csrfToken?: string | null; name?: string; description?: string }): string {
  const error = opts.error ? String(opts.error) : '';
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const name = opts.name ? String(opts.name) : '';
  const description = opts.description ? String(opts.description) : '';

  let body = `<h1>New Category</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/categories">\u2190 Back to categories</a></div></div>';
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`;
  body += `<form method="post" action="/admin/categories">`;
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;
  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(name)}" />
    <div class="field-hint">Unique label for this category (used by cultures and rules).</div>
  </label>`;
  body += `<label>Description
    <textarea name="description" style="min-height: 120px">${escapeHtml(description)}</textarea>
  </label>`;
  body += `<div class="actions">
    <button type="submit">Create category</button>
  </div>`;
  body += `</form>`;
  return renderAdminPage({ title: 'New Category', bodyHtml: body, active: 'categories' });
}

function renderCategoryDetailPage(opts: {
  category: any;
  cultureCount: number;
  ruleCount: number;
  linkedCultures?: Array<{ id: number; name: string }>;
  linkedRules?: Array<{ id: number; title: string }>;
  csrfToken?: string | null;
  notice?: string | null;
  error?: string | null;
}): string {
  const category = opts.category ?? {};
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const notice = opts.notice ? String(opts.notice) : '';
  const error = opts.error ? String(opts.error) : '';
  const cultureCount = Number.isFinite(opts.cultureCount) ? Number(opts.cultureCount) : 0;
  const ruleCount = Number.isFinite(opts.ruleCount) ? Number(opts.ruleCount) : 0;
  const linkedCultures = Array.isArray(opts.linkedCultures) ? opts.linkedCultures : [];
  const linkedRules = Array.isArray(opts.linkedRules) ? opts.linkedRules : [];

  const id = category.id != null ? String(category.id) : '';
  const nameValue = category.name ? String(category.name) : '';
  const descriptionValue = category.description ? String(category.description) : '';

  let body = `<h1>Category: ${escapeHtml(nameValue || '(unnamed)')}</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/categories">\u2190 Back to categories</a></div></div>';
  if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`;
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`;

  body += `<div class="section">`;
  body += `<div class="section-title">Usage</div>`;
  body += `<div class="field-hint">Cultures using this category: <strong>${escapeHtml(String(cultureCount))}</strong> &nbsp;•&nbsp; Rules in this category: <strong>${escapeHtml(String(ruleCount))}</strong></div>`;
  body += `</div>`;

  body += `<form method="post" action="/admin/categories/${escapeHtml(id)}">`;
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;

  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(nameValue)}" />
  </label>`;
  body += `<label>Description
    <textarea name="description" style="min-height: 120px">${escapeHtml(descriptionValue)}</textarea>
  </label>`;

  body += `<div class="actions">
    <button type="submit">Save</button>
  </div>`;
  body += `</form>`;

  body += `<div class="section" style="margin-top: 18px">`;
  body += `<div class="section-title">Danger Zone</div>`;
  if (cultureCount > 0 || ruleCount > 0) {
    body += `<div class="field-hint">To delete this category, remove it from all cultures and rules first.</div>`;
  } else {
    body += `<form method="post" action="/admin/categories/${escapeHtml(id)}/delete" style="margin-top: 10px" onsubmit="return confirm('Delete category \\'${escapeHtml(nameValue || 'this category')}\\'? This cannot be undone.');">`;
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;
    body += `<button type="submit" class="danger">Delete category</button>`;
    body += `</form>`;
  }
  body += `</div>`;

  body += `<div class="section" style="margin-top: 18px">`;
  body += `<div class="section-title">Cultures</div>`;
  if (!linkedCultures.length) {
    body += `<div class="field-hint">No cultures currently use this category.</div>`;
  } else {
    body += `<ul style="margin: 0; padding-left: 18px">`;
    for (const c of linkedCultures) {
      body += `<li><a href="/admin/cultures/${encodeURIComponent(String(c.id))}">${escapeHtml(String(c.name || `Culture #${c.id}`))}</a></li>`;
    }
    body += `</ul>`;
  }
  body += `</div>`;

  body += `<div class="section" style="margin-top: 12px">`;
  body += `<div class="section-title">Rules</div>`;
  if (!linkedRules.length) {
    body += `<div class="field-hint">No rules currently use this category.</div>`;
  } else {
    body += `<ul style="margin: 0; padding-left: 18px">`;
    for (const r of linkedRules) {
      body += `<li><a href="/admin/rules/${encodeURIComponent(String(r.id))}">${escapeHtml(String(r.title || `Rule #${r.id}`))}</a></li>`;
    }
    body += `</ul>`;
  }
  body += `</div>`;

  return renderAdminPage({ title: 'Category', bodyHtml: body, active: 'categories' });
}

async function loadCategoryUsageLinks(
  db: any,
  categoryId: number
): Promise<{
  linkedCultures: Array<{ id: number; name: string }>;
  linkedRules: Array<{ id: number; title: string }>;
}> {
  const [cultureRows] = await db.query(
    `SELECT c.id, c.name
       FROM cultures c
       INNER JOIN culture_categories cc ON cc.culture_id = c.id
      WHERE cc.category_id = ?
      ORDER BY c.name`,
    [categoryId]
  );
  const [ruleRows] = await db.query(
    `SELECT r.id, r.title
       FROM rules r
      WHERE r.category_id = ?
      ORDER BY r.title`,
    [categoryId]
  );
  return {
    linkedCultures: (cultureRows as any[])
      .map((r) => ({ id: Number(r.id), name: String(r.name || '') }))
      .filter((r) => Number.isFinite(r.id) && r.id > 0),
    linkedRules: (ruleRows as any[])
      .map((r) => ({ id: Number(r.id), title: String(r.title || '') }))
      .filter((r) => Number.isFinite(r.id) && r.id > 0),
  };
}

pagesRouter.get('/admin/categories', async (req: any, res: any) => {
  try {
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : '';
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : '';

    const db = getPool();
    const [rows] = await db.query(
      `SELECT rc.id, rc.name, rc.description, rc.updated_at,
              COUNT(DISTINCT cc.culture_id) AS culture_count,
              COUNT(DISTINCT r.id) AS rule_count
         FROM rule_categories rc
         LEFT JOIN culture_categories cc ON cc.category_id = rc.id
         LEFT JOIN rules r ON r.category_id = rc.id
        GROUP BY rc.id
        ORDER BY rc.name`
    );
    const items = rows as any[];

    let body = `<style>
    .categories-nebula{ min-height: 100vh; color:#fff; font-family:system-ui,sans-serif; position:relative; background:#050508; }
    .categories-nebula-bg{ position:fixed; inset:0; background-image:url('/nebula_bg.jpg'); background-position:center; background-repeat:no-repeat; background-size:cover; z-index:0; pointer-events:none; }
    .categories-nebula-content{ position:relative; z-index:1; }
    .categories-nebula h1{ color:#ffd60a; }
    .categories-nebula .section{
      background: rgba(6,8,12,0.5);
      border: 1px solid rgba(255,255,255,0.20);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 10px 28px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06);
    }
    .categories-nebula .category-title{ color:#ffd60a; text-decoration:none; font-size:1.1rem; font-weight:700; line-height:1.25; }
    .categories-nebula .card-btn{
      display:inline-flex; align-items:center; justify-content:center; gap:8px;
      padding:7px 12px; border-radius:999px; border:1px solid rgba(255,255,255,0.32);
      text-decoration:none; cursor:pointer; font-size:0.95rem; color:#fff;
      background:rgba(25,118,210,0.92);
    }
    .categories-nebula .card-btn:hover{ filter:brightness(1.05); }
    </style>`;
    body += `<div class="categories-nebula"><div class="categories-nebula-bg"></div><div class="categories-nebula-content">`;
    body += '<h1>Categories</h1>';
    body += '<div class="toolbar"><div><span class="pill">Categories</span></div><div><a href="/admin/categories/new" class="card-btn">New category</a></div></div>';
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`;
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`;

    if (!items.length) {
      body += '<p>No categories have been created yet.</p>';
    } else {
      for (const row of items) {
        const id = Number(row.id);
        const name = escapeHtml(String(row.name || ''));
        const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : '';
        const cultures = row.culture_count != null ? escapeHtml(String(row.culture_count)) : '0';
        const rules = row.rule_count != null ? escapeHtml(String(row.rule_count)) : '0';
        const href = `/admin/categories/${encodeURIComponent(String(id))}`;
        body += `<div class="section" style="margin-top:12px">`;
        body += `<a href="${href}" class="category-title">${name}</a>`;
        body += `<div style="display:grid; gap:7px; margin-top:10px">`;
        body += `<div><strong>Name:</strong> ${name || '-'}</div>`;
        body += `<div><strong>Cultures:</strong> ${cultures}</div>`;
        body += `<div><strong>Rules:</strong> ${rules}</div>`;
        body += `<div><strong>Updated:</strong> ${updated || '-'}</div>`;
        body += `</div>`;
        body += `</div>`;
      }
    }
    body += `</div></div>`;

    const doc = renderAdminPage({ title: 'Categories', bodyHtml: body, active: 'categories' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin categories list failed', { path: req.path })
    res.status(500).send('Failed to load categories');
  }
});

pagesRouter.get('/admin/categories/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie);
  const csrfToken = cookies['csrf'] || '';
  const doc = renderCategoryForm({ csrfToken });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(doc);
});

pagesRouter.post('/admin/categories', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any;
    const rawName = body.name != null ? String(body.name) : '';
    const rawDescription = body.description != null ? String(body.description) : '';
    const name = rawName.trim();
    const description = rawDescription.trim();

    if (!name) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCategoryForm({ csrfToken, error: 'Name is required.', name: rawName, description: rawDescription });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (name.length > 255) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCategoryForm({ csrfToken, error: 'Name is too long (max 255 characters).', name: rawName, description: rawDescription });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }

    const db = getPool();
    try {
      await db.query(`INSERT INTO rule_categories (name, description) VALUES (?, ?)`, [name, description || null]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_rule_categories_name')) {
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderCategoryForm({ csrfToken, error: 'A category with that name already exists.', name: rawName, description: rawDescription });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect(`/admin/categories?notice=${encodeURIComponent('Category created.')}`);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin create category failed', { path: req.path })
    res.status(500).send('Failed to create category');
  }
});

pagesRouter.get('/admin/categories/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Category not found');

    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : '';
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : '';

    const db = getPool();
    const [catRows] = await db.query(`SELECT id, name, description, updated_at FROM rule_categories WHERE id = ? LIMIT 1`, [id]);
    const category = (catRows as any[])[0];
    if (!category) return res.status(404).send('Category not found');

    const [[cCount]]: any = await db.query(`SELECT COUNT(*) AS c FROM culture_categories WHERE category_id = ?`, [id]);
    const [[rCount]]: any = await db.query(`SELECT COUNT(*) AS c FROM rules WHERE category_id = ?`, [id]);
    const { linkedCultures, linkedRules } = await loadCategoryUsageLinks(db, id);

    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';

    const doc = renderCategoryDetailPage({
      category,
      cultureCount: Number(cCount?.c || 0),
      ruleCount: Number(rCount?.c || 0),
      linkedCultures,
      linkedRules,
      csrfToken,
      notice,
      error,
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin category detail failed', { path: req.path })
    res.status(500).send('Failed to load category');
  }
});

pagesRouter.post('/admin/categories/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Category not found');

    const body = (req.body || {}) as any;
    const rawName = body.name != null ? String(body.name) : '';
    const rawDescription = body.description != null ? String(body.description) : '';
    const name = rawName.trim();
    const description = rawDescription.trim();

    const db = getPool();
    const [catRows] = await db.query(`SELECT id, name, description FROM rule_categories WHERE id = ? LIMIT 1`, [id]);
    const category = (catRows as any[])[0];
    if (!category) return res.status(404).send('Category not found');

    const [[cCount]]: any = await db.query(`SELECT COUNT(*) AS c FROM culture_categories WHERE category_id = ?`, [id]);
    const [[rCount]]: any = await db.query(`SELECT COUNT(*) AS c FROM rules WHERE category_id = ?`, [id]);
    const cultureCount = Number(cCount?.c || 0);
    const ruleCount = Number(rCount?.c || 0);
    const { linkedCultures, linkedRules } = await loadCategoryUsageLinks(db, id);

    if (!name) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCategoryDetailPage({
        category: { ...category, name: rawName, description: rawDescription },
        cultureCount,
        ruleCount,
        linkedCultures,
        linkedRules,
        csrfToken,
        error: 'Name is required.',
      });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (name.length > 255) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCategoryDetailPage({
        category: { ...category, name: rawName, description: rawDescription },
        cultureCount,
        ruleCount,
        linkedCultures,
        linkedRules,
        csrfToken,
        error: 'Name is too long (max 255 characters).',
      });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }

    try {
      await db.query(`UPDATE rule_categories SET name = ?, description = ? WHERE id = ?`, [name, description || null, id]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_rule_categories_name')) {
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderCategoryDetailPage({
          category: { ...category, name: rawName, description: rawDescription },
          cultureCount,
          ruleCount,
          linkedCultures,
          linkedRules,
          csrfToken,
          error: 'A category with that name already exists.',
        });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect(`/admin/categories/${encodeURIComponent(String(id))}?notice=${encodeURIComponent('Saved.')}`);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin update category failed', { path: req.path })
    res.status(500).send('Failed to save category');
  }
});

pagesRouter.post('/admin/categories/:id/delete', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Category not found');

    const db = getPool();
    const [catRows] = await db.query(`SELECT id, name FROM rule_categories WHERE id = ? LIMIT 1`, [id]);
    const category = (catRows as any[])[0];
    if (!category) return res.status(404).send('Category not found');

    const [[cCount]]: any = await db.query(`SELECT COUNT(*) AS c FROM culture_categories WHERE category_id = ?`, [id]);
    const [[rCount]]: any = await db.query(`SELECT COUNT(*) AS c FROM rules WHERE category_id = ?`, [id]);
    const cultureCount = Number(cCount?.c || 0);
    const ruleCount = Number(rCount?.c || 0);

    if (cultureCount > 0 || ruleCount > 0) {
      const msg = 'Category is used by cultures and/or rules.';
      return res.redirect(`/admin/categories/${encodeURIComponent(String(id))}?error=${encodeURIComponent(msg)}`);
    }

    try {
      await db.query(`DELETE FROM rule_categories WHERE id = ?`, [id]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      const safe = msg.includes('a foreign key constraint fails')
        ? 'Category is used by cultures and/or rules.'
        : 'Failed to delete category.';
      return res.redirect(`/admin/categories/${encodeURIComponent(String(id))}?error=${encodeURIComponent(safe)}`);
    }

    res.redirect(`/admin/categories?notice=${encodeURIComponent('Category deleted.')}`);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin delete category failed', { path: req.path })
    res.status(500).send('Failed to delete category');
  }
});

// -------- Admin: Cultures (server-rendered, minimal JS) --------

function renderCultureForm(opts: { error?: string | null; csrfToken?: string | null; name?: string }): string {
  const error = opts.error ? String(opts.error) : '';
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const name = opts.name ? String(opts.name) : '';

  let body = `<h1>New Culture</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/cultures">\u2190 Back to cultures</a></div></div>';
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`;
  body += `<form method="post" action="/admin/cultures">`;
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;
  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(name)}" />
    <div class="field-hint">Unique label for this culture (used by admins; not currently shown to end users).</div>
  </label>`;
  body += `<div class="field-hint">Culture Definition JSON v1 will be auto-initialized using defaults, then editable in the culture detail page.</div>`;
  body += `<div class="actions">
    <button type="submit">Create culture</button>
  </div>`;
  body += `</form>`;
  return renderAdminPage({ title: 'New Culture', bodyHtml: body, active: 'cultures' });
}

pagesRouter.get('/admin/cultures', async (req: any, res: any) => {
  try {
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : '';
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : '';

    const db = getPool();
    const [rows] = await db.query(
      `SELECT c.id, c.name, c.updated_at, COUNT(cc.category_id) AS category_count
         FROM cultures c
         LEFT JOIN culture_categories cc ON cc.culture_id = c.id
        GROUP BY c.id
        ORDER BY c.name`
    );
    const items = rows as any[];

    let body = '<h1>Cultures</h1>';
    body += '<div class="toolbar"><div><span class="pill">Cultures</span></div><div><a href="/admin/cultures/new">New culture</a></div></div>';
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`;
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`;

    if (!items.length) {
      body += '<p>No cultures have been created yet.</p>';
    } else {
      body += '<table><thead><tr><th>Name</th><th>Categories</th><th>Updated</th></tr></thead><tbody>';
      for (const row of items) {
        const id = Number(row.id);
        const name = escapeHtml(String(row.name || ''));
        const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : '';
        const categoryCount = row.category_count != null ? escapeHtml(String(row.category_count)) : '0';
        const href = `/admin/cultures/${encodeURIComponent(String(id))}`;
        body += `<tr><td><a href="${href}">${name}</a></td><td>${categoryCount}</td><td>${updated}</td></tr>`;
      }
      body += '</tbody></table>';
      body += `<div class="field-hint" style="margin-top: 10px">Category assignment is configured in the culture detail page.</div>`;
    }

    const doc = renderAdminPage({ title: 'Cultures', bodyHtml: body, active: 'cultures' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin cultures list failed', { path: req.path })
    res.status(500).send('Failed to load cultures');
  }
});

pagesRouter.get('/admin/cultures/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie);
  const csrfToken = cookies['csrf'] || '';
  const doc = renderCultureForm({ csrfToken });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(doc);
});

pagesRouter.post('/admin/cultures', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any;
    const rawName = body.name != null ? String(body.name) : '';
    const name = rawName.trim();

    if (!name) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCultureForm({ csrfToken, error: 'Name is required.', name: rawName });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (name.length > 255) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCultureForm({ csrfToken, error: 'Name is too long (max 255 characters).', name: rawName });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }

    const db = getPool();
    try {
      await culturesRepo.createCulture({ name }, db as any);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_cultures_name')) {
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderCultureForm({ csrfToken, error: 'A culture with that name already exists.', name: rawName });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect(`/admin/cultures?notice=${encodeURIComponent('Culture created.')}`);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin create culture failed', { path: req.path })
    res.status(500).send('Failed to create culture');
  }
});

async function listRuleCategoriesForCultures(): Promise<Array<{ id: number; name: string; description: string }>> {
  try {
    const db = getPool();
    const [rows] = await db.query(`SELECT id, name, description FROM rule_categories ORDER BY name`);
    return (rows as any[])
      .map((r) => ({
        id: Number(r.id),
        name: String(r.name || ''),
        description: r.description != null ? String(r.description) : '',
      }))
      .filter((c) => Number.isFinite(c.id) && c.id > 0 && c.name);
  } catch {
    return [];
  }
}

function toStringArrayInput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter((entry) => entry.length > 0)
  }
  if (value == null) return []
  const single = String(value || '').trim()
  return single ? [single] : []
}

function parseCultureDefinitionDraftFromBody(
  body: any,
  fallback: CultureDefinitionV1
): Record<string, unknown> {
  const toleranceRaw = body?.tolerance ?? {}
  const toleranceSource =
    toleranceRaw && typeof toleranceRaw === 'object' && !Array.isArray(toleranceRaw)
      ? toleranceRaw
      : body
  const toleranceValue = (key: string): string | null => {
    const direct = toleranceSource?.[key]
    if (direct != null) return String(direct || '').trim()
    const dot = body?.[`tolerance.${key}`]
    if (dot != null) return String(dot || '').trim()
    const bracket = body?.[`tolerance[${key}]`]
    if (bracket != null) return String(bracket || '').trim()
    return null
  }

  const draft: Record<string, unknown> = {
    id: fallback.id,
    name: fallback.name,
    version: body?.definition_version != null ? String(body.definition_version || '').trim() : fallback.version,
    summary: body?.summary != null ? String(body.summary || '') : fallback.summary || '',
    interaction_style:
      body?.interaction_style != null ? String(body.interaction_style || '').trim() : fallback.interaction_style,
    tone_expectations:
      body?.tone_expectations != null
        ? toStringArrayInput(body.tone_expectations)
        : Array.from(fallback.tone_expectations || []),
    disruption_signals:
      body?.disruption_signals != null
        ? toStringArrayInput(body.disruption_signals)
        : Array.from(fallback.disruption_signals || []),
    tolerance: {
      hostility:
        toleranceValue('hostility') != null
          ? String(toleranceValue('hostility') || '').trim()
          : fallback.tolerance.hostility,
      confrontation:
        toleranceValue('confrontation') != null
          ? String(toleranceValue('confrontation') || '').trim()
          : fallback.tolerance.confrontation,
      person_directed_profanity:
        toleranceValue('person_directed_profanity') != null
          ? String(toleranceValue('person_directed_profanity') || '').trim()
          : fallback.tolerance.person_directed_profanity,
      mockery:
        toleranceValue('mockery') != null
          ? String(toleranceValue('mockery') || '').trim()
          : fallback.tolerance.mockery || '',
      personal_attacks:
        toleranceValue('personal_attacks') != null
          ? String(toleranceValue('personal_attacks') || '').trim()
          : fallback.tolerance.personal_attacks || '',
    },
    ai_hint: body?.ai_hint != null ? String(body.ai_hint || '').trim() : fallback.ai_hint || '',
    internal_notes:
      body?.internal_notes != null ? String(body.internal_notes || '') : fallback.internal_notes || '',
  }
  return draft
}

function mergeCultureDefinitionDraft(
  fallback: CultureDefinitionV1,
  draft: Record<string, unknown>
): CultureDefinitionV1 {
  const tone = Array.isArray(draft.tone_expectations)
    ? draft.tone_expectations.map((v) => String(v || '').trim()).filter((v) => v.length > 0)
    : Array.from(fallback.tone_expectations || [])
  const disruption = Array.isArray(draft.disruption_signals)
    ? draft.disruption_signals.map((v) => String(v || '').trim()).filter((v) => v.length > 0)
    : Array.from(fallback.disruption_signals || [])
  const toleranceDraft =
    draft.tolerance && typeof draft.tolerance === 'object' && !Array.isArray(draft.tolerance)
      ? (draft.tolerance as Record<string, unknown>)
      : {}
  return {
    ...fallback,
    id: draft.id != null ? String(draft.id || '').trim() || fallback.id : fallback.id,
    name: draft.name != null ? String(draft.name || '').trim() || fallback.name : fallback.name,
    version:
      draft.version != null
        ? (String(draft.version || '').trim() || fallback.version) as any
        : fallback.version,
    summary: draft.summary != null ? String(draft.summary || '') : fallback.summary,
    interaction_style:
      draft.interaction_style != null
        ? (String(draft.interaction_style || '').trim() || fallback.interaction_style) as any
        : fallback.interaction_style,
    tone_expectations: tone as any,
    disruption_signals: disruption as any,
    tolerance: {
      hostility:
        toleranceDraft.hostility != null
          ? (String(toleranceDraft.hostility || '').trim() || fallback.tolerance.hostility) as any
          : fallback.tolerance.hostility,
      confrontation:
        toleranceDraft.confrontation != null
          ? (String(toleranceDraft.confrontation || '').trim() || fallback.tolerance.confrontation) as any
          : fallback.tolerance.confrontation,
      person_directed_profanity:
        toleranceDraft.person_directed_profanity != null
          ? (String(toleranceDraft.person_directed_profanity || '').trim() || fallback.tolerance.person_directed_profanity) as any
          : fallback.tolerance.person_directed_profanity,
      mockery:
        toleranceDraft.mockery != null
          ? (String(toleranceDraft.mockery || '').trim() || fallback.tolerance.mockery || '') as any
          : fallback.tolerance.mockery,
      personal_attacks:
        toleranceDraft.personal_attacks != null
          ? (String(toleranceDraft.personal_attacks || '').trim() || fallback.tolerance.personal_attacks || '') as any
          : fallback.tolerance.personal_attacks,
    },
    ai_hint: draft.ai_hint != null ? (String(draft.ai_hint || '').trim() as any) : fallback.ai_hint,
    internal_notes: draft.internal_notes != null ? String(draft.internal_notes || '') : fallback.internal_notes,
  }
}

function mapCultureDefinitionPath(path: string): string {
  if (!path) return '_form'
  if (path === 'id') return 'id'
  if (path === 'name') return 'name'
  if (path === 'version') return 'version'
  if (path === 'summary') return 'summary'
  if (path === 'interaction_style') return 'interaction_style'
  if (path === 'tone_expectations' || path.startsWith('tone_expectations.')) return 'tone_expectations'
  if (path === 'disruption_signals' || path.startsWith('disruption_signals.')) return 'disruption_signals'
  if (path === 'ai_hint') return 'ai_hint'
  if (path === 'internal_notes') return 'internal_notes'
  if (path === 'tolerance' || path.startsWith('tolerance.')) return path.split('.')[1] || 'tolerance'
  return '_form'
}

function groupCultureDefinitionErrors(
  errors: CultureDefinitionValidationError[]
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const err of errors || []) {
    const key = mapCultureDefinitionPath(String(err.path || ''))
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(String(err.message || 'Invalid value'))
  }
  return grouped
}

function renderCultureFieldErrors(errorsByField: Record<string, string[]>, field: string): string {
  const items = errorsByField[field] || []
  if (!items.length) return ''
  return `<div class="field-hint" style="color:#fda4af">${escapeHtml(items.join(' • '))}</div>`
}

function renderCultureDetailPage(opts: {
  culture: any;
  definition: CultureDefinitionV1;
  definitionSource?: string;
  definitionValidationErrors?: CultureDefinitionValidationError[];
  definitionFieldErrors?: Record<string, string[]>;
  advancedJsonCanEdit?: boolean;
  advancedJsonText?: string;
  advancedJsonError?: string | null;
  advancedOpen?: boolean;
  categories: Array<{ id: number; name: string; description: string }>;
  assignedCategoryIds: Set<number>;
  csrfToken?: string | null;
  notice?: string | null;
  error?: string | null;
}): string {
  const culture = opts.culture ?? {};
  const categories = Array.isArray(opts.categories) ? opts.categories : [];
  const assigned = opts.assignedCategoryIds ?? new Set<number>();
  const definition = opts.definition;
  const definitionSource = String(opts.definitionSource || 'stored');
  const definitionValidationErrors = Array.isArray(opts.definitionValidationErrors)
    ? opts.definitionValidationErrors
    : [];
  const definitionFieldErrors = opts.definitionFieldErrors || {};
  const advancedJsonCanEdit = !!opts.advancedJsonCanEdit;
  const advancedJsonError = opts.advancedJsonError ? String(opts.advancedJsonError) : '';
  const advancedOpen = !!opts.advancedOpen || !!advancedJsonError;
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const notice = opts.notice ? String(opts.notice) : '';
  const error = opts.error ? String(opts.error) : '';

  const id = culture.id != null ? String(culture.id) : '';
  const nameValue = culture.name ? String(culture.name) : '';
  const computedDefinitionId = deriveCultureDefinitionIdFromKey(nameValue || definition.name || 'culture');
  const prettyDefinitionJson = JSON.stringify(definition, null, 2);
  const advancedJsonText = opts.advancedJsonText != null ? String(opts.advancedJsonText) : prettyDefinitionJson;
  const toneSet = new Set<string>((definition.tone_expectations || []).map((v) => String(v)))
  const disruptionSet = new Set<string>((definition.disruption_signals || []).map((v) => String(v)))
  const tolerance = definition.tolerance || {
    hostility: 'medium',
    confrontation: 'medium',
    person_directed_profanity: 'medium',
  }

  let body = `<h1>Culture: ${escapeHtml(nameValue || '(unnamed)')}</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/cultures">\u2190 Back to cultures</a></div></div>';
  if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`;
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`;
  if (definitionSource === 'default_missing') {
    body += `<div class="field-hint">No saved culture definition JSON found. This page is showing schema defaults; click Save to persist.</div>`;
  } else if (definitionSource === 'default_invalid') {
    body += `<div class="error">Stored culture definition JSON is invalid. Showing defaults until saved.</div>`;
  }
  if (definitionValidationErrors.length) {
    body += `<div class="field-hint" style="color:#fda4af">Definition issues: ${escapeHtml(definitionValidationErrors.map((e) => `${e.path || '(root)'}: ${e.message}`).join(' • '))}</div>`;
  }

  body += `<form method="post" action="/admin/cultures/${escapeHtml(id)}">`;
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;

  body += `<div class="section" style="margin-top: 14px">`;
  body += `<div class="section-title">Metadata</div>`;
  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(nameValue)}" />
    <div class="field-hint">Stable culture label used for admin operations.</div>
    ${renderCultureFieldErrors(definitionFieldErrors, 'name')}
  </label>`;
  body += `<label>Culture ID
    <input type="text" value="${escapeHtml(computedDefinitionId)}" readonly />
    <div class="field-hint">Computed from Name and enforced by schema policy.</div>
    ${renderCultureFieldErrors(definitionFieldErrors, 'id')}
  </label>`;
  body += `<label>Definition Version
    <input type="text" name="definition_version" value="${escapeHtml(String(definition.version || 'v1'))}" />
    <div class="field-hint">Schema instance version (e.g. v1).</div>
    ${renderCultureFieldErrors(definitionFieldErrors, 'version')}
  </label>`;
  body += `<label>Summary
    <textarea name="summary" style="min-height: 84px">${escapeHtml(String(definition.summary || ''))}</textarea>
    <div class="field-hint">Optional human-readable summary for admins/docs.</div>
    ${renderCultureFieldErrors(definitionFieldErrors, 'summary')}
  </label>`;
  body += `</div>`;

  body += `<div class="section" style="margin-top: 14px">`;
  body += `<div class="section-title">Interaction</div>`;
  body += `<label>Interaction Style
    <select name="interaction_style">`;
  for (const value of CULTURE_INTERACTION_STYLES) {
    const selected = String(definition.interaction_style || '') === value ? ' selected' : '';
    body += `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
  }
  body += `</select>
    <div class="field-hint">High-level interaction baseline for the culture.</div>
    ${renderCultureFieldErrors(definitionFieldErrors, 'interaction_style')}
  </label>`;
  body += `<div class="section" style="margin-top: 10px">`;
  body += `<div class="section-title">Tone Expectations</div>`;
  body += `<input type="hidden" name="tone_expectations" value="" />`;
  for (const value of CULTURE_TONE_EXPECTATIONS) {
    const checked = toneSet.has(value) ? ' checked' : '';
    body += `<label style="display:flex; gap:10px; align-items:flex-start; margin-top: 6px">`;
    body += `<input type="checkbox" name="tone_expectations" value="${escapeHtml(value)}"${checked} style="margin-top: 3px" />`;
    body += `<div>${escapeHtml(value)}</div></label>`;
  }
  body += `${renderCultureFieldErrors(definitionFieldErrors, 'tone_expectations')}`;
  body += `</div>`;

  body += `<div class="section" style="margin-top: 10px">`;
  body += `<div class="section-title">Disruption Signals</div>`;
  body += `<input type="hidden" name="disruption_signals" value="" />`;
  for (const value of CULTURE_DISRUPTION_SIGNALS) {
    const checked = disruptionSet.has(value) ? ' checked' : '';
    body += `<label style="display:flex; gap:10px; align-items:flex-start; margin-top: 6px">`;
    body += `<input type="checkbox" name="disruption_signals" value="${escapeHtml(value)}"${checked} style="margin-top: 3px" />`;
    body += `<div>${escapeHtml(value)}</div></label>`;
  }
  body += `${renderCultureFieldErrors(definitionFieldErrors, 'disruption_signals')}`;
  body += `</div>`;
  body += `</div>`;

  const renderToleranceSelect = (fieldName: string, value: string) => {
    let html = `<label>${escapeHtml(fieldName.replace(/_/g, ' '))}
      <select name="tolerance.${escapeHtml(fieldName)}">`
    for (const opt of CULTURE_TOLERANCE_LEVELS) {
      const selected = value === opt ? ' selected' : ''
      html += `<option value="${escapeHtml(opt)}"${selected}>${escapeHtml(opt)}</option>`
    }
    html += `</select>${renderCultureFieldErrors(definitionFieldErrors, fieldName)}</label>`
    return html
  }

  body += `<div class="section" style="margin-top: 14px">`;
  body += `<div class="section-title">Tolerance</div>`;
  body += renderToleranceSelect('hostility', String(tolerance.hostility || 'medium'));
  body += renderToleranceSelect('confrontation', String(tolerance.confrontation || 'medium'));
  body += renderToleranceSelect('person_directed_profanity', String(tolerance.person_directed_profanity || 'medium'));
  body += renderToleranceSelect('mockery', String(tolerance.mockery || ''));
  body += renderToleranceSelect('personal_attacks', String(tolerance.personal_attacks || ''));
  body += `</div>`;

  body += `<div class="section" style="margin-top: 14px">`;
  body += `<div class="section-title">AI</div>`;
  body += `<label>AI Hint
    <select name="ai_hint">
      <option value="">(none)</option>`;
  for (const value of CULTURE_AI_HINTS) {
    const selected = String(definition.ai_hint || '') === value ? ' selected' : '';
    body += `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
  }
  body += `</select>
    ${renderCultureFieldErrors(definitionFieldErrors, 'ai_hint')}
  </label>`;
  body += `<label>Internal Notes
    <textarea name="internal_notes" style="min-height: 120px">${escapeHtml(String(definition.internal_notes || ''))}</textarea>
    <div class="field-hint">Internal moderation guidance only; excluded from AI payload.</div>
    ${renderCultureFieldErrors(definitionFieldErrors, 'internal_notes')}
  </label>`;
  body += `</div>`;

  body += `<details class="section" style="margin-top: 14px"${advancedOpen ? ' open' : ''}>`;
  body += `<summary class="section-title" style="cursor:pointer">Advanced JSON</summary>`;
  body += `<div class="field-hint" style="margin-bottom:8px">Canonical culture JSON. Use structured fields above for normal editing.</div>`;
  body += `<pre style="margin:0 0 10px 0; max-height: 260px; overflow:auto">${escapeHtml(prettyDefinitionJson)}</pre>`;
  if (advancedJsonCanEdit) {
    body += `<label>Raw JSON
      <textarea name="advanced_definition_json" style="min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${escapeHtml(advancedJsonText)}</textarea>
      <div class="field-hint">Validate checks schema only. Apply validates and uses this JSON for Save.</div>
    </label>`;
    if (advancedJsonError) body += `<div class="error">${escapeHtml(advancedJsonError)}</div>`;
    body += `<div class="actions" style="margin-top: 8px">
      <button type="submit" name="advanced_action" value="validate_json">Validate JSON</button>
      <button type="submit" name="advanced_action" value="apply_json">Apply JSON</button>
    </div>`;
  } else {
    body += `<div class="field-hint">Read-only. Raw JSON editing requires site admin permission.</div>`;
  }
  body += `</details>`;

  body += `<div class="section" style="margin-top: 14px">`;
  body += `<div class="section-title">Categories</div>`;
  body += `<div class="field-hint">Select which rule categories are included in this culture. Users will only see rules from these categories once cultures are attached to spaces.</div>`;

  if (!categories.length) {
    body += `<p>No categories exist yet.</p>`;
  } else {
    body += `<div style="margin-top: 10px">`;
    for (const c of categories) {
      const cid = Number(c.id);
      const checked = assigned.has(cid) ? ' checked' : '';
      body += `<label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px">`;
      body += `<input type="checkbox" name="categoryIds" value="${escapeHtml(String(cid))}"${checked} style="margin-top: 3px" />`;
      body += `<div><div><a href="/admin/categories/${encodeURIComponent(String(cid))}">${escapeHtml(c.name)}</a></div>`;
      if (c.description) {
        body += `<div class="field-hint">${escapeHtml(c.description)}</div>`;
      }
      body += `</div></label>`;
    }
    body += `</div>`;
  }
  body += `</div>`;

  body += `<div class="actions">
    <button type="submit">Save</button>
  </div>`;
  body += `</form>`;

  const assignedCount = assigned.size;
  body += `<div class="section" style="margin-top: 18px">`;
  body += `<div class="section-title">Danger Zone</div>`;
  if (assignedCount > 0) {
    body += `<div class="field-hint">To delete this culture, remove all category associations first.</div>`;
  } else {
    body += `<form method="post" action="/admin/cultures/${escapeHtml(id)}/delete" style="margin-top: 10px" onsubmit="return confirm('Delete culture \\'${escapeHtml(nameValue || 'this culture')}\\'? This cannot be undone.');">`;
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;
    body += `<button type="submit" class="danger">Delete culture</button>`;
    body += `</form>`;
  }
  body += `</div>`;

  return renderAdminPage({ title: 'Culture', bodyHtml: body, active: 'cultures' });
}

pagesRouter.get('/admin/cultures/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Culture not found');

    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : '';
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : '';

    const db = getPool();
    const culture = await culturesRepo.getCultureWithDefinition(id, db as any);
    if (!culture) return res.status(404).send('Culture not found');

    const categories = await listRuleCategoriesForCultures();
    const [assignedRows] = await db.query(`SELECT category_id FROM culture_categories WHERE culture_id = ?`, [id]);
    const assignedCategoryIds = new Set<number>((assignedRows as any[]).map((r) => Number(r.category_id)).filter((n) => Number.isFinite(n) && n > 0));

    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    let advancedJsonCanEdit = false;
    try {
      const userId = Number(req?.user?.id || 0);
      if (Number.isFinite(userId) && userId > 0) {
        advancedJsonCanEdit = await can(userId, PERM.VIDEO_DELETE_ANY);
      }
    } catch {}

    const doc = renderCultureDetailPage({
      culture,
      definition: culture.definition,
      definitionSource: culture.definition_source,
      definitionValidationErrors: culture.definition_validation_errors || [],
      definitionFieldErrors: {},
      advancedJsonCanEdit,
      categories,
      assignedCategoryIds,
      csrfToken,
      notice,
      error,
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin culture detail failed', { path: req.path })
    res.status(500).send('Failed to load culture');
  }
});

pagesRouter.post('/admin/cultures/:id', async (req: any, res: any) => {
  let conn: any = null;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Culture not found');

    const body = (req.body || {}) as any;
    const rawName = body.name != null ? String(body.name) : '';
    const name = rawName.trim();

    const rawCategoryIds = (body as any).categoryIds;
    const submittedIds: number[] = Array.isArray(rawCategoryIds)
      ? rawCategoryIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
      : (rawCategoryIds != null && String(rawCategoryIds).trim() !== '')
        ? [Number(rawCategoryIds)].filter((n) => Number.isFinite(n) && n > 0)
        : [];

    const db = getPool() as any;
    const current = await culturesRepo.getCultureWithDefinition(id, db);
    if (!current) return res.status(404).send('Culture not found');

    const categories = await listRuleCategoriesForCultures();
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const userId = Number(req?.user?.id || 0);
    let advancedJsonCanEdit = false;
    try {
      if (Number.isFinite(userId) && userId > 0) {
        advancedJsonCanEdit = await can(userId, PERM.VIDEO_DELETE_ANY);
      }
    } catch {}
    const advancedAction = String(body.advanced_action || '').trim().toLowerCase();
    const isAdvancedValidate = advancedJsonCanEdit && advancedAction === 'validate_json';
    const isAdvancedApply = advancedJsonCanEdit && advancedAction === 'apply_json';
    const advancedJsonTextInput =
      body.advanced_definition_json != null ? String(body.advanced_definition_json) : '';

    const renderDraftPage = (opts: {
      status?: number;
      definition?: CultureDefinitionV1;
      fieldErrors?: Record<string, string[]>;
      assignedIds?: Set<number>;
      error?: string;
      notice?: string;
      advancedJsonError?: string;
      advancedOpen?: boolean;
    }) => {
      const definition = opts.definition || current.definition;
      const doc = renderCultureDetailPage({
        culture: { ...current, name: rawName },
        definition,
        definitionSource: current.definition_source,
        definitionValidationErrors: current.definition_validation_errors || [],
        definitionFieldErrors: opts.fieldErrors || {},
        advancedJsonCanEdit,
        advancedJsonText:
          body.advanced_definition_json != null
            ? advancedJsonTextInput
            : JSON.stringify(definition, null, 2),
        advancedJsonError: opts.advancedJsonError || '',
        advancedOpen: !!opts.advancedOpen || !!opts.advancedJsonError || isAdvancedValidate || isAdvancedApply,
        categories,
        assignedCategoryIds: opts.assignedIds || new Set<number>(submittedIds),
        csrfToken,
        notice: opts.notice,
        error: opts.error,
      });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(Number(opts.status || 400)).send(doc);
    };

    let definitionToPersist: CultureDefinitionV1 | null = null;
    let structuredDraft: Record<string, unknown> | null = null;

    if (isAdvancedValidate || isAdvancedApply) {
      const raw = advancedJsonTextInput.trim();
      if (!raw) {
        return renderDraftPage({
          error: 'Advanced JSON is required.',
          advancedJsonError: 'Raw JSON is empty.',
          advancedOpen: true,
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err: any) {
        return renderDraftPage({
          error: 'Advanced JSON is invalid.',
          advancedJsonError: `JSON parse error: ${String(err?.message || err)}`,
          advancedOpen: true,
        });
      }
      const advancedValidation = validateCultureDefinitionV1(parsed, {
        cultureName: name || current.name,
        cultureKey: name || current.name,
      });
      if (!advancedValidation.ok) {
        const normalizedDraft = normalizeCultureDefinitionForValidation(parsed, {
          cultureName: name || current.name,
          cultureKey: name || current.name,
        }) as Record<string, unknown>;
        return renderDraftPage({
          definition: mergeCultureDefinitionDraft(current.definition, normalizedDraft),
          fieldErrors: groupCultureDefinitionErrors(advancedValidation.errors),
          error: 'Advanced JSON failed schema validation.',
          advancedJsonError: advancedValidation.errors
            .map((e) => `${e.path || '(root)'}: ${e.message}`)
            .join(' • '),
          advancedOpen: true,
        });
      }
      if (isAdvancedValidate) {
        return renderDraftPage({
          status: 200,
          definition: advancedValidation.value,
          notice: 'Advanced JSON is valid. No changes were saved.',
          advancedOpen: true,
        });
      }
      definitionToPersist = advancedValidation.value;
    }

    if (!name) {
      structuredDraft = parseCultureDefinitionDraftFromBody(body, current.definition);
      return renderDraftPage({
        definition: mergeCultureDefinitionDraft(current.definition, structuredDraft),
        fieldErrors: { name: ['Name is required.'] },
        error: 'Name is required.',
      });
    }
    if (name.length > 255) {
      structuredDraft = parseCultureDefinitionDraftFromBody(body, current.definition);
      return renderDraftPage({
        definition: mergeCultureDefinitionDraft(current.definition, structuredDraft),
        fieldErrors: { name: ['Name is too long (max 255 characters).'] },
        error: 'Name is too long (max 255 characters).',
      });
    }

    if (!definitionToPersist) {
      structuredDraft = parseCultureDefinitionDraftFromBody(body, current.definition);
      const validation = validateCultureDefinitionV1(structuredDraft, {
        cultureName: name,
        cultureKey: name,
      });
      if (!validation.ok) {
        const normalizedDraft = normalizeCultureDefinitionForValidation(structuredDraft, {
          cultureName: name,
          cultureKey: name,
        }) as Record<string, unknown>;
        return renderDraftPage({
          definition: mergeCultureDefinitionDraft(current.definition, normalizedDraft),
          fieldErrors: groupCultureDefinitionErrors(validation.errors),
          error: 'Culture definition is invalid. Fix the highlighted fields.',
        });
      }
      definitionToPersist = validation.value;
    }

    const uniqueSubmittedIds = Array.from(new Set(submittedIds));
    conn = await db.getConnection();
    await conn.beginTransaction();

    let validIds: number[] = [];
    if (uniqueSubmittedIds.length) {
      const [catRows] = await conn.query(
        `SELECT id FROM rule_categories WHERE id IN (${uniqueSubmittedIds.map(() => '?').join(',')})`,
        uniqueSubmittedIds
      );
      validIds = (catRows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    }

    try {
      await culturesRepo.saveCulture(
        id,
        {
          name,
          definition_json: definitionToPersist,
        },
        conn
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_cultures_name')) {
        await conn.rollback();
        const definitionPreview =
          definitionToPersist ||
          mergeCultureDefinitionDraft(current.definition, structuredDraft || {});
        return renderDraftPage({
          definition: definitionPreview,
          assignedIds: new Set<number>(validIds.length ? validIds : submittedIds),
          error: 'A culture with that name already exists.',
        });
      }
      if (String(err?.code || '') === 'culture_not_found') {
        await conn.rollback();
        return res.status(404).send('Culture not found');
      }
      throw err;
    }

    const [existingRows] = await conn.query(`SELECT category_id FROM culture_categories WHERE culture_id = ? FOR UPDATE`, [id]);
    const existingIds = new Set<number>((existingRows as any[]).map((r) => Number(r.category_id)).filter((n) => Number.isFinite(n) && n > 0));
    const nextIds = new Set<number>(validIds);

    const toAdd: number[] = [];
    const toRemove: number[] = [];
    for (const cid of nextIds) {
      if (!existingIds.has(cid)) toAdd.push(cid);
    }
    for (const cid of existingIds) {
      if (!nextIds.has(cid)) toRemove.push(cid);
    }

    if (toRemove.length) {
      await conn.query(
        `DELETE FROM culture_categories
          WHERE culture_id = ?
            AND category_id IN (${toRemove.map(() => '?').join(',')})`,
        [id, ...toRemove]
      );
    }
    if (toAdd.length) {
      await conn.query(
        `INSERT IGNORE INTO culture_categories (culture_id, category_id) VALUES ${toAdd.map(() => '(?, ?)').join(',')}`,
        toAdd.flatMap((cid) => [id, cid])
      );
    }

    await conn.commit();
    res.redirect(`/admin/cultures/${encodeURIComponent(String(id))}?notice=${encodeURIComponent('Saved.')}`);
  } catch (err) {
    try { if (conn) await conn.rollback(); } catch {}
    logError(req.log || pagesLogger, err, 'admin update culture failed', { path: req.path })
    res.status(500).send('Failed to save culture');
  } finally {
    try { if (conn) conn.release(); } catch {}
  }
});

pagesRouter.post('/admin/cultures/:id/delete', async (req: any, res: any) => {
  let conn: any = null;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Culture not found');

    const db = getPool() as any;
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [cultureRows] = await conn.query(`SELECT id, name FROM cultures WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
    const culture = (cultureRows as any[])[0];
    if (!culture) {
      await conn.rollback();
      return res.status(404).send('Culture not found');
    }

    const [assocRows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM culture_categories WHERE culture_id = ? FOR UPDATE`,
      [id]
    );
    const cnt = Number((assocRows as any[])[0]?.cnt ?? 0);
    if (Number.isFinite(cnt) && cnt > 0) {
      await conn.rollback();
      const msg = 'Cannot delete: this culture is still associated with one or more categories.';
      return res.redirect(`/admin/cultures/${encodeURIComponent(String(id))}?error=${encodeURIComponent(msg)}`);
    }

    await conn.query(`DELETE FROM cultures WHERE id = ?`, [id]);
    await conn.commit();

    res.redirect(`/admin/cultures?notice=${encodeURIComponent('Culture deleted.')}`);
  } catch (err) {
    try { if (conn) await conn.rollback(); } catch {}
    logError(req.log || pagesLogger, err, 'admin delete culture failed', { path: req.path })
    res.status(500).send('Failed to delete culture');
  } finally {
    try { if (conn) conn.release(); } catch {}
  }
});

// -------- Admin: Rules (server-rendered, minimal JS) --------

async function listRuleCategories(): Promise<Array<{ id: number; name: string }>> {
  try {
    const db = getPool();
    const [rows] = await db.query(`SELECT id, name FROM rule_categories ORDER BY name`);
    return (rows as any[]).map((r) => ({ id: Number(r.id), name: String(r.name || '') })).filter((c) => Number.isFinite(c.id) && c.id > 0 && c.name);
  } catch {
    return [];
  }
}

async function getOrCreateRuleDraft(ruleId: number): Promise<any | null> {
  const db = getPool();
  const [draftRows] = await db.query(`SELECT * FROM rule_drafts WHERE rule_id = ? LIMIT 1`, [ruleId]);
  const existing = (draftRows as any[])[0];
  if (existing) return existing;

  const [baseRows] = await db.query(
    `SELECT r.id AS rule_id, rv.markdown, rv.html,
            rv.short_description,
            rv.allowed_examples_markdown, rv.allowed_examples_html,
            rv.disallowed_examples_markdown, rv.disallowed_examples_html,
            rv.guidance_markdown, rv.guidance_html,
            rv.guidance_moderators_markdown, rv.guidance_moderators_html,
            rv.guidance_agents_markdown, rv.guidance_agents_html
       FROM rules r
       JOIN rule_versions rv ON rv.id = r.current_version_id
      WHERE r.id = ?
      LIMIT 1`,
    [ruleId]
  );
  const base = (baseRows as any[])[0];
  if (!base) return null;

  const moderatorsGuidanceMarkdown =
    base.guidance_moderators_markdown != null ? String(base.guidance_moderators_markdown) :
    (base.guidance_markdown != null ? String(base.guidance_markdown) : null);
  const moderatorsGuidanceHtml =
    base.guidance_moderators_html != null ? String(base.guidance_moderators_html) :
    (base.guidance_html != null ? String(base.guidance_html) : null);

  const agentsGuidanceMarkdown = base.guidance_agents_markdown != null ? String(base.guidance_agents_markdown) : null;
  const agentsGuidanceHtml = base.guidance_agents_html != null ? String(base.guidance_agents_html) : null;

  const legacyGuidanceMarkdown = base.guidance_markdown != null ? String(base.guidance_markdown) : moderatorsGuidanceMarkdown;
  const legacyGuidanceHtml = base.guidance_html != null ? String(base.guidance_html) : moderatorsGuidanceHtml;

  await db.query(
    `INSERT IGNORE INTO rule_drafts (
       rule_id, markdown, html,
       short_description,
       allowed_examples_markdown, allowed_examples_html,
       disallowed_examples_markdown, disallowed_examples_html,
       guidance_markdown, guidance_html,
       guidance_moderators_markdown, guidance_moderators_html,
       guidance_agents_markdown, guidance_agents_html,
       updated_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      ruleId,
      String(base.markdown || ''),
      String(base.html || ''),
      base.short_description != null ? String(base.short_description) : null,
      base.allowed_examples_markdown != null ? String(base.allowed_examples_markdown) : null,
      base.allowed_examples_html != null ? String(base.allowed_examples_html) : null,
      base.disallowed_examples_markdown != null ? String(base.disallowed_examples_markdown) : null,
      base.disallowed_examples_html != null ? String(base.disallowed_examples_html) : null,
      legacyGuidanceMarkdown,
      legacyGuidanceHtml,
      moderatorsGuidanceMarkdown,
      moderatorsGuidanceHtml,
      agentsGuidanceMarkdown,
      agentsGuidanceHtml,
    ]
  );

  const [createdRows] = await db.query(`SELECT * FROM rule_drafts WHERE rule_id = ? LIMIT 1`, [ruleId]);
  return (createdRows as any[])[0] ?? null;
}

function renderRuleDraftEditPage(opts: {
  rule: any;
  draft: any;
  categories: Array<{ id: number; name: string }>;
  csrfToken?: string | null;
  notice?: string | null;
}): string {
  const { rule, draft, categories } = opts;
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const notice = opts.notice ? String(opts.notice) : '';

  const titleValue = rule.title ? String(rule.title) : '';
  const categoryIdValue = rule.category_id != null ? String(rule.category_id) : '';

  const shortDescriptionValue = draft.short_description ? String(draft.short_description) : '';
  const markdownValue = draft.markdown ? String(draft.markdown) : '';
  const htmlValue = draft.html ? String(draft.html) : '';

  const allowedExamplesValue = draft.allowed_examples_markdown ? String(draft.allowed_examples_markdown) : '';
  const allowedExamplesHtmlValue = draft.allowed_examples_html ? String(draft.allowed_examples_html) : '';

  const disallowedExamplesValue = draft.disallowed_examples_markdown ? String(draft.disallowed_examples_markdown) : '';
  const disallowedExamplesHtmlValue = draft.disallowed_examples_html ? String(draft.disallowed_examples_html) : '';

  const guidanceModeratorsValue = draft.guidance_moderators_markdown
    ? String(draft.guidance_moderators_markdown)
    : (draft.guidance_markdown ? String(draft.guidance_markdown) : '');
  const guidanceModeratorsHtmlValue = draft.guidance_moderators_html
    ? String(draft.guidance_moderators_html)
    : (draft.guidance_html ? String(draft.guidance_html) : '');
  const guidanceAgentsValue = draft.guidance_agents_markdown ? String(draft.guidance_agents_markdown) : '';
  const guidanceAgentsHtmlValue = draft.guidance_agents_html ? String(draft.guidance_agents_html) : '';

  const changeSummaryId = `rule_draft_change_summary_${String(rule.id)}`;

  const mdId = `rule_draft_markdown_${String(rule.id)}`;
  const allowedId = `rule_draft_allowed_${String(rule.id)}`;
  const disallowedId = `rule_draft_disallowed_${String(rule.id)}`;
  const guidanceModeratorsId = `rule_draft_guidance_moderators_${String(rule.id)}`;
  const guidanceAgentsId = `rule_draft_guidance_agents_${String(rule.id)}`;

  let body = `<h1>Edit Draft: ${escapeHtml(String(rule.slug || rule.title || 'Rule'))}</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/rules">\u2190 Back to rules</a></div></div>';
  if (notice) {
    body += `<div class="success">${escapeHtml(notice)}</div>`;
  }

  body += `<form method="post" action="/admin/rules/${escapeHtml(String(rule.id))}/edit">`;
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;

  body += `<label>Title
    <input type="text" name="title" value="${escapeHtml(titleValue)}" />
  </label>`;

  body += `<label>Category
    <select name="categoryId">
      <option value=""${categoryIdValue === '' ? ' selected' : ''}>—</option>
      ${categories
        .map((c) => {
          const id = String(c.id);
          const sel = id === categoryIdValue ? ' selected' : '';
          return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(c.name)}</option>`;
        })
        .join('')}
    </select>
  </label>`;

  body += `<label>Short Description
    <textarea name="shortDescription" style="min-height: 90px">${escapeHtml(shortDescriptionValue)}</textarea>
  </label>`;

  body += `<label for="${escapeHtml(mdId)}">Long Description</label>`;
  body += `<textarea id="${escapeHtml(mdId)}" name="markdown" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(htmlValue)}">${escapeHtml(markdownValue)}</textarea>`;

  body += `<label for="${escapeHtml(allowedId)}">Allowed Examples</label>`;
  body += `<textarea id="${escapeHtml(allowedId)}" name="allowedExamples" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(allowedExamplesHtmlValue)}">${escapeHtml(allowedExamplesValue)}</textarea>`;

  body += `<label for="${escapeHtml(disallowedId)}">Disallowed Examples</label>`;
  body += `<textarea id="${escapeHtml(disallowedId)}" name="disallowedExamples" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(disallowedExamplesHtmlValue)}">${escapeHtml(disallowedExamplesValue)}</textarea>`;

  body += `<label for="${escapeHtml(guidanceModeratorsId)}">Guidance for Moderators</label>`;
  body += `<textarea id="${escapeHtml(guidanceModeratorsId)}" name="guidanceModerators" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(guidanceModeratorsHtmlValue)}">${escapeHtml(guidanceModeratorsValue)}</textarea>`;

  body += `<label for="${escapeHtml(guidanceAgentsId)}">Guidance for AI Agents</label>`;
  body += `<textarea id="${escapeHtml(guidanceAgentsId)}" name="guidanceAgents" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(guidanceAgentsHtmlValue)}">${escapeHtml(guidanceAgentsValue)}</textarea>`;
  body += `<div class="field-hint">These fields are intended for moderators/admin and automated agents; do not expose them to regular users.</div>`;

  body += `<label for="${escapeHtml(changeSummaryId)}">Change summary (optional; used on Publish)</label>`;
  body += `<input id="${escapeHtml(changeSummaryId)}" type="text" name="changeSummary" value="" />`;
  body += `<div class="field-hint">Short description of what changed in this published version (e.g., “Clarify harassment examples”).</div>`;

  body += `<div class="actions">`;
  body += `<button type="submit" name="action" value="save">Save</button>`;
  body += `<button type="submit" name="action" value="publish">Publish Version</button>`;
  body += `</div>`;
  body += `</form>`;

  body += `<div class="field-hint" style="margin-top: 10px">Save updates the draft only. Publish creates a new immutable version and updates the current published version.</div>`;

  body += `
<style>
  .md-wysiwyg { margin-top: 6px; }
  .ck.ck-editor__main>.ck-editor__editable { background: rgba(0,0,0,0.35); color: #f5f5f5; min-height: 220px; }
  .ck.ck-toolbar { background: rgba(0,0,0,0.55); border-color: rgba(255,255,255,0.2); }
  .ck.ck-button, .ck.ck-toolbar__separator { color: #f5f5f5; }
  .ck.ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-editor__editable.ck-focused { border-color: rgba(153,204,255,0.8) !important; box-shadow: none !important; }
  .ck.ck-dropdown__panel { background: rgba(0,0,0,0.92); border-color: rgba(255,255,255,0.2); }
  .ck.ck-list { background: transparent; }
  .ck.ck-list__item .ck-button { color: #f5f5f5; }
  .ck.ck-list__item .ck-button .ck-button__label { color: #f5f5f5; }
  .ck.ck-list__item .ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-list__item .ck-button.ck-on { background: #1976d2; color: #fff; }
  .ck.ck-list__item .ck-button.ck-on .ck-button__label { color: #fff; }
</style>
<script src="/vendor/ckeditor5/ckeditor.js"></script>
<script src="/vendor/turndown/turndown.js"></script>
<script src="/admin/ckeditor_markdown.js"></script>
`;

  return renderAdminPage({ title: 'Edit Rule Draft', bodyHtml: body, active: 'rules' });
}

function renderRuleListPage(
  rules: any[],
  opts: {
    csrfToken?: string | null;
    categories: Array<{ id: number; name: string }>;
    selectedCategoryId: string;
    sort: string;
    dir: 'asc' | 'desc';
  }
): string {
  const csrf = opts.csrfToken ? String(opts.csrfToken) : '';
  const categories = Array.isArray(opts.categories) ? opts.categories : [];
  const selectedCategoryId = String(opts.selectedCategoryId || '');
  const sort = String(opts.sort || '');
  const dir: 'asc' | 'desc' = opts.dir === 'desc' ? 'desc' : 'asc';

  const headerLink = (label: string, key: string) => {
    const isActive = sort === key;
    const nextDir: 'asc' | 'desc' = isActive && dir === 'asc' ? 'desc' : 'asc';
    const qs = new URLSearchParams();
    if (selectedCategoryId) qs.set('categoryId', selectedCategoryId);
    qs.set('sort', key);
    qs.set('dir', nextDir);
    const arrow = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<a href="/admin/rules?${escapeHtml(qs.toString())}">${escapeHtml(label)}${arrow}</a>`;
  };

  let body = `<style>
  .rules-nebula{ min-height: 100vh; color:#fff; font-family:system-ui,sans-serif; position:relative; background:#050508; }
  .rules-nebula-bg{ position:fixed; inset:0; background-image:url('/nebula_bg.jpg'); background-position:center; background-repeat:no-repeat; background-size:cover; z-index:0; pointer-events:none; }
  .rules-nebula-content{ position:relative; z-index:1; }
  .rules-nebula h1{ color:#ffd60a; }
  .rules-nebula .section{
    background: rgba(6,8,12,0.5);
    border: 1px solid rgba(255,255,255,0.20);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 10px 28px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .rules-nebula .section a[href^="/admin/rules/"]:not(.card-btn){ color:#ffd60a; }
  .rules-nebula .card-btn{
    display:inline-flex; align-items:center; justify-content:center; gap:8px;
    padding:7px 12px; border-radius:999px; border:1px solid rgba(255,255,255,0.32);
    text-decoration:none; cursor:pointer; font-size:0.95rem; color:#fff;
  }
  .rules-nebula .card-btn-open{ background:rgba(25,118,210,0.92); }
  .rules-nebula .card-btn-edit{ background:rgba(90,102,120,0.7); }
  .rules-nebula .card-btn-delete{ background:rgba(198,40,40,0.92); }
  .rules-nebula .card-btn:hover{ filter:brightness(1.05); }
  .rules-nebula .sort-links a{ color:#cfe8ff; }
  </style>`;
  body += `<div class="rules-nebula"><div class="rules-nebula-bg"></div><div class="rules-nebula-content">`;
  body += '<h1>Rules</h1>';
  body += '<div class="toolbar"><div><span class="pill">Rules</span></div><div><a href="/admin/rules/new" class="card-btn card-btn-open">New rule</a></div></div>';
  body += `<div class="toolbar" style="margin-top: 10px"><div><label style="display:flex; gap:10px; align-items:center; margin:0"><span style="opacity:0.85">Category</span><select name="categoryId" onchange="(function(sel){const qs=new URLSearchParams(window.location.search); if(sel.value){qs.set('categoryId', sel.value)} else {qs.delete('categoryId')} window.location.search=qs.toString()})(this)"><option value=""${selectedCategoryId === '' ? ' selected' : ''}>All</option>${categories
    .map((c) => {
      const id = String(c.id);
      const sel = id === selectedCategoryId ? ' selected' : '';
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(c.name)}</option>`;
    })
    .join('')}</select></label></div></div>`;
  body += `<div class="toolbar sort-links" style="margin-top: 8px; align-items:flex-start; flex-wrap:wrap">
    <div style="opacity:0.85; font-size: 0.92rem">Sort</div>
    <div style="display:flex; gap:12px; flex-wrap:wrap">
      ${headerLink('Category', 'category')}
      ${headerLink('Title', 'title')}
      ${headerLink('Visibility', 'visibility')}
      ${headerLink('Current Version', 'version')}
      ${headerLink('Draft', 'draft')}
      ${headerLink('Updated', 'updated')}
    </div>
  </div>`;
  if (!rules.length) {
    body += '<p>No rules have been created yet.</p>';
  } else {
    for (const row of rules) {
      const id = Number(row.id);
      const titleRaw = String(row.title || '').trim();
      const title = escapeHtml(titleRaw || '(untitled)');
      const category = escapeHtml(String(row.category_name || ''));
      const vis = escapeHtml(String(row.visibility || 'public'));
      const ver = row.current_version ?? row.current_version_id ?? null;
      const versionLabel = ver != null ? escapeHtml(String(ver)) : '';
      const draftPending = row.draft_pending != null ? Number(row.draft_pending) === 1 : false;
      const draftLabel = draftPending ? 'Draft pending' : 'No draft';
      const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : '';
      const confirmName = escapeHtml(titleRaw || `Rule #${id}`);
      body += `<div class="section" style="margin-top: 12px">`;
      body += `<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px">`;
      body += `<a href="/admin/rules/${id}" style="font-size: 1.15rem; font-weight: 700; line-height: 1.25; text-decoration: none">${title}</a>`;
      body += `<a href="/admin/rules/${id}/edit" class="card-btn card-btn-open" style="white-space:nowrap">Edit Draft</a>`;
      body += `</div>`;
      body += `<div style="display:grid; gap:7px; margin-top: 10px">`;
      body += `<div><strong>Category:</strong> ${category || '-'}</div>`;
      body += `<div><strong>Updated:</strong> ${updated || '-'}</div>`;
      body += `<div><strong>Visibility:</strong> ${vis || '-'}</div>`;
      body += `<div><strong>Current Version:</strong> ${versionLabel || '-'}</div>`;
      body += `<div><strong>Draft:</strong> ${draftPending ? '<span class="pill">Draft pending</span>' : escapeHtml(draftLabel)}</div>`;
      body += `</div>`;
      body += `<div style="display:flex; justify-content:flex-end; margin-top: 12px">`;
      body += `<form method="post" action="/admin/rules/${id}/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \\'${confirmName}\\'? This cannot be undone.');">`;
      if (csrf) {
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />`;
      }
      body += `<button type="submit" class="card-btn card-btn-delete">Delete</button>`;
      body += `</form>`;
      body += `</div>`;
      body += `</div>`;
    }
  }
  body += `</div></div>`;
  return renderAdminPage({ title: 'Rules', bodyHtml: body, active: 'rules' });
}

function renderRuleForm(opts: {
  rule?: any;
  categories?: Array<{ id: number; name: string }>;
  error?: string | null;
  success?: string | null;
  csrfToken?: string | null;
  isNewVersion?: boolean;
}): string {
  const rule = opts.rule ?? {};
  const categories = Array.isArray(opts.categories) ? opts.categories : [];
  const error = opts.error;
  const success = opts.success;
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const isEdit = !!rule.id && !opts.isNewVersion;
  const isNewVersion = !!opts.isNewVersion;
  const title = isNewVersion ? 'New Rule Version' : (isEdit ? 'Edit Rule' : 'New Rule');
  const slugValue = rule.slug ? String(rule.slug) : '';
  const titleValue = rule.title ? String(rule.title) : '';
  const categoryIdValue = rule.category_id != null ? String(rule.category_id) : (rule.categoryId != null ? String(rule.categoryId) : '');
  const visibilityValue = rule.visibility ? String(rule.visibility) : 'public';
  const markdownValue = rule.markdown ? String(rule.markdown) : '';
  const htmlValue = rule.html ? String(rule.html) : '';
  const shortDescriptionValue = rule.short_description ? String(rule.short_description) : (rule.shortDescription ? String(rule.shortDescription) : '');
  const allowedExamplesValue = rule.allowed_examples_markdown ? String(rule.allowed_examples_markdown) : (rule.allowedExamples ? String(rule.allowedExamples) : '');
  const allowedExamplesHtmlValue = rule.allowed_examples_html ? String(rule.allowed_examples_html) : '';
  const disallowedExamplesValue = rule.disallowed_examples_markdown ? String(rule.disallowed_examples_markdown) : (rule.disallowedExamples ? String(rule.disallowedExamples) : '');
  const disallowedExamplesHtmlValue = rule.disallowed_examples_html ? String(rule.disallowed_examples_html) : '';
  const guidanceModeratorsValue = rule.guidance_moderators_markdown
    ? String(rule.guidance_moderators_markdown)
    : (rule.guidanceModerators
      ? String(rule.guidanceModerators)
      : (rule.guidance_markdown
        ? String(rule.guidance_markdown)
        : (rule.guidance ? String(rule.guidance) : '')));
  const guidanceModeratorsHtmlValue = rule.guidance_moderators_html
    ? String(rule.guidance_moderators_html)
    : (rule.guidance_html ? String(rule.guidance_html) : '');
  const guidanceAgentsValue = rule.guidance_agents_markdown
    ? String(rule.guidance_agents_markdown)
    : (rule.guidanceAgents ? String(rule.guidanceAgents) : '');
  const guidanceAgentsHtmlValue = rule.guidance_agents_html
    ? String(rule.guidance_agents_html)
    : '';
  const changeSummaryValue = rule.change_summary ? String(rule.change_summary) : '';
  const baseAction = isEdit ? `/admin/rules/${rule.id}` : '/admin/rules';
  const action = isNewVersion ? `/admin/rules/${rule.id}/versions/new` : baseAction;

  let body = `<h1>${escapeHtml(title)}</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/rules">\u2190 Back to rules</a></div></div>';
  if (error) {
    body += `<div class="error">${escapeHtml(error)}</div>`;
  } else if (success) {
    body += `<div class="success">${escapeHtml(success)}</div>`;
  }
  body += `<form method="post" action="${action}">`;
  if (csrfToken) {
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;
  }
  if (!isNewVersion) {
    body += `<label>Slug
      <input type="text" name="slug" value="${escapeHtml(slugValue)}" />
      <div class="field-hint">Lowercase; a–z, 0–9, '-' only; up to 4 segments separated by '/'. Used under <code>/rules/&lt;slug&gt;</code>.</div>
    </label>`;
    body += `<label>Category
      <select name="categoryId">
        <option value=""${categoryIdValue === '' ? ' selected' : ''}>—</option>
        ${categories
          .map((c) => {
            const id = String(c.id);
            const sel = id === categoryIdValue ? ' selected' : '';
            return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(c.name)}</option>`;
          })
          .join('')}
      </select>
      <div class="field-hint">Categories come from the <code>rule_categories</code> table.</div>
    </label>`;
    body += `<label>Title
      <input type="text" name="title" value="${escapeHtml(titleValue)}" />
    </label>`;
    body += `<label>Visibility
      <select name="visibility">
        <option value="public"${visibilityValue === 'public' ? ' selected' : ''}>Public</option>
        <option value="authenticated"${visibilityValue === 'authenticated' ? ' selected' : ''}>Authenticated users</option>
        <option value="space_moderator"${visibilityValue === 'space_moderator' ? ' selected' : ''}>Any space moderator</option>
        <option value="space_admin"${visibilityValue === 'space_admin' ? ' selected' : ''}>Any space admin</option>
      </select>
    </label>`;
  } else {
    body += `<p><strong>Rule:</strong> ${escapeHtml(slugValue || titleValue || '(untitled)')}</p>`;
    if (rule.category_name) {
      body += `<p><strong>Category:</strong> ${escapeHtml(String(rule.category_name))}</p>`;
    }
  }
  body += `<label>Short Description
    <textarea name="shortDescription" style="min-height: 90px">${escapeHtml(shortDescriptionValue)}</textarea>
  </label>`;
  const mdId = `rule_markdown_${isNewVersion ? 'v' : 'r'}_${rule.id ? String(rule.id) : 'new'}`;
  const allowedId = `rule_allowed_${isNewVersion ? 'v' : 'r'}_${rule.id ? String(rule.id) : 'new'}`;
  const disallowedId = `rule_disallowed_${isNewVersion ? 'v' : 'r'}_${rule.id ? String(rule.id) : 'new'}`;
  const guidanceModeratorsId = `rule_guidance_moderators_${isNewVersion ? 'v' : 'r'}_${rule.id ? String(rule.id) : 'new'}`;
  const guidanceAgentsId = `rule_guidance_agents_${isNewVersion ? 'v' : 'r'}_${rule.id ? String(rule.id) : 'new'}`;
  body += `<label for="${escapeHtml(mdId)}">Long Description</label>`;
  body += `<textarea id="${escapeHtml(mdId)}" name="markdown" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(htmlValue)}">${escapeHtml(markdownValue)}</textarea>`;
  body += `<div class="field-hint">Markdown is rendered server-side using the restricted contract in <code>agents/requirements/markdown.md</code>.</div>`;

  body += `<label for="${escapeHtml(allowedId)}">Allowed Examples</label>`;
  body += `<textarea id="${escapeHtml(allowedId)}" name="allowedExamples" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(allowedExamplesHtmlValue)}">${escapeHtml(allowedExamplesValue)}</textarea>`;

  body += `<label for="${escapeHtml(disallowedId)}">Disallowed Examples</label>`;
  body += `<textarea id="${escapeHtml(disallowedId)}" name="disallowedExamples" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(disallowedExamplesHtmlValue)}">${escapeHtml(disallowedExamplesValue)}</textarea>`;

  body += `<label for="${escapeHtml(guidanceModeratorsId)}">Guidance for Moderators</label>`;
  body += `<textarea id="${escapeHtml(guidanceModeratorsId)}" name="guidanceModerators" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(guidanceModeratorsHtmlValue)}">${escapeHtml(guidanceModeratorsValue)}</textarea>`;

  body += `<label for="${escapeHtml(guidanceAgentsId)}">Guidance for AI Agents</label>`;
  body += `<textarea id="${escapeHtml(guidanceAgentsId)}" name="guidanceAgents" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(guidanceAgentsHtmlValue)}">${escapeHtml(guidanceAgentsValue)}</textarea>`;
  body += `<div class="field-hint">These fields are intended for moderators/admin and automated agents; do not expose them to regular users.</div>`;
  body += `<label>Change summary (optional)
    <input type="text" name="changeSummary" value="${escapeHtml(changeSummaryValue)}" />
    <div class="field-hint">Short description of what changed for this version (e.g., “Clarify harassment examples”).</div>
  </label>`;
  body += `<div class="actions">
    <button type="submit">${isNewVersion ? 'Create version' : (isEdit ? 'Save changes' : 'Create rule')}</button>
  </div>`;
  body += `</form>`;

  body += `
<style>
  .md-wysiwyg { margin-top: 6px; }
  .ck.ck-editor__main>.ck-editor__editable { background: rgba(0,0,0,0.35); color: #f5f5f5; min-height: 220px; }
  .ck.ck-toolbar { background: rgba(0,0,0,0.55); border-color: rgba(255,255,255,0.2); }
  .ck.ck-button, .ck.ck-toolbar__separator { color: #f5f5f5; }
  .ck.ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-editor__editable.ck-focused { border-color: rgba(153,204,255,0.8) !important; box-shadow: none !important; }
  .ck.ck-dropdown__panel { background: rgba(0,0,0,0.92); border-color: rgba(255,255,255,0.2); }
  .ck.ck-list { background: transparent; }
  .ck.ck-list__item .ck-button { color: #f5f5f5; }
  .ck.ck-list__item .ck-button .ck-button__label { color: #f5f5f5; }
  .ck.ck-list__item .ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-list__item .ck-button.ck-on { background: #1976d2; color: #fff; }
  .ck.ck-list__item .ck-button.ck-on .ck-button__label { color: #fff; }
</style>
<script src="/vendor/ckeditor5/ckeditor.js"></script>
<script src="/vendor/turndown/turndown.js"></script>
<script src="/admin/ckeditor_markdown.js"></script>
`;

  return renderAdminPage({ title, bodyHtml: body, active: 'rules' });
}

pagesRouter.get('/admin/rules', async (req: any, res: any) => {
  try {
    const db = getPool();
    const categories = await listRuleCategories();
    const rawCategoryId = req.query && (req.query as any).categoryId != null ? String((req.query as any).categoryId) : '';
    const selectedCategoryId = rawCategoryId && /^\d+$/.test(rawCategoryId) ? rawCategoryId : '';

    const rawSort = req.query && (req.query as any).sort != null ? String((req.query as any).sort) : '';
    const rawDir = req.query && (req.query as any).dir != null ? String((req.query as any).dir) : '';
    const dir: 'asc' | 'desc' = rawDir.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const sortKey = rawSort || 'slug';
    const sortExprByKey: Record<string, string> = {
      slug: 'r.slug',
      category: "COALESCE(c.name, '')",
      title: 'r.title',
      visibility: 'r.visibility',
      version: 'rv.version',
      draft: 'draft_pending',
      updated: 'r.updated_at',
    };
    const sortExpr = sortExprByKey[sortKey] || sortExprByKey.slug;

    const where: string[] = [];
    const params: any[] = [];
    if (selectedCategoryId) {
      where.push('r.category_id = ?');
      params.push(Number(selectedCategoryId));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderSql =
      sortKey === 'draft'
        ? `ORDER BY ${sortExpr} ${dir}, d.updated_at ${dir}, r.slug ASC`
        : `ORDER BY ${sortExpr} ${dir}, r.slug ASC`;

    const [rows] = await db.query(
      `SELECT r.id, r.slug, r.title, r.visibility, r.updated_at,
              rv.version AS current_version, rv.created_at AS current_published_at,
              c.name AS category_name,
              d.updated_at AS draft_updated_at,
              CASE
                WHEN d.updated_at IS NOT NULL AND (rv.created_at IS NULL OR d.updated_at > rv.created_at) THEN 1
                ELSE 0
              END AS draft_pending
         FROM rules r
         LEFT JOIN rule_versions rv ON rv.id = r.current_version_id
         LEFT JOIN rule_categories c ON c.id = r.category_id
         LEFT JOIN rule_drafts d ON d.rule_id = r.id
         ${whereSql}
         ${orderSql}`,
      params
    );
    const rules = rows as any[];
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const doc = renderRuleListPage(rules, { csrfToken, categories, selectedCategoryId, sort: sortKey, dir });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin rules list failed', { path: req.path })
    res.status(500).send('Failed to load rules');
  }
});

pagesRouter.get('/admin/rules/:id/edit', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Rule not found');
    const db = getPool();
    const [ruleRows] = await db.query(
      `SELECT r.id, r.slug, r.title, r.category_id, r.visibility, r.current_version_id, c.name AS category_name
         FROM rules r
         LEFT JOIN rule_categories c ON c.id = r.category_id
        WHERE r.id = ?
        LIMIT 1`,
      [id]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule) return res.status(404).send('Rule not found');

    const draft = await getOrCreateRuleDraft(id);
    if (!draft) return res.status(404).send('Rule not found');

    const categories = await listRuleCategories();
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const notice = req.query && (req.query as any).notice ? String((req.query as any).notice) : '';
    const doc = renderRuleDraftEditPage({ rule, draft, categories, csrfToken, notice });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin rule draft load failed', { path: req.path })
    res.status(500).send('Failed to load rule draft');
  }
});

pagesRouter.post('/admin/rules/:id/edit', async (req: any, res: any) => {
  let conn: any = null;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Rule not found');

    const action = req.body && (req.body as any).action ? String((req.body as any).action) : '';
    if (action !== 'save' && action !== 'publish') {
      const notice = 'Unknown action.';
      return res.redirect(`/admin/rules/${encodeURIComponent(String(id))}/edit?notice=${encodeURIComponent(notice)}`);
    }

    const body = (req.body || {}) as any;
    const rawTitle = String(body.title || '');
    const rawCategoryId = body.categoryId != null ? String(body.categoryId) : '';
    const shortDescription = body.shortDescription ? String(body.shortDescription) : '';

    const markdown = String(body.markdown || '');
    const allowedExamplesMarkdown = body.allowedExamples ? String(body.allowedExamples) : '';
    const disallowedExamplesMarkdown = body.disallowedExamples ? String(body.disallowedExamples) : '';
    const guidanceModeratorsMarkdown = body.guidanceModerators ? String(body.guidanceModerators) : '';
    const guidanceAgentsMarkdown = body.guidanceAgents ? String(body.guidanceAgents) : '';
    const changeSummary = body.changeSummary ? String(body.changeSummary) : '';

    const db = getPool() as any;
    const userId = req.user && req.user.id ? Number(req.user.id) : null;

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [ruleRows] = await conn.query(
      `SELECT id, slug, title, category_id, current_version_id
         FROM rules
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule) {
      await conn.rollback();
      return res.status(404).send('Rule not found');
    }

    let categoryId: number | null = rawCategoryId && /^\d+$/.test(rawCategoryId) ? Number(rawCategoryId) : null;
    if (categoryId != null) {
      const [catRows] = await conn.query(`SELECT id FROM rule_categories WHERE id = ? LIMIT 1`, [categoryId]);
      if (!(catRows as any[])?.length) categoryId = null;
    }

    const title = rawTitle.trim() || String(rule.title || '');

    // Ensure draft exists inside the transaction.
    const [draftRows] = await conn.query(`SELECT rule_id FROM rule_drafts WHERE rule_id = ? LIMIT 1`, [id]);
    if (!(draftRows as any[])?.length) {
      const [baseRows] = await conn.query(
        `SELECT markdown, html,
                short_description,
                allowed_examples_markdown, allowed_examples_html,
                disallowed_examples_markdown, disallowed_examples_html,
                guidance_markdown, guidance_html,
                guidance_moderators_markdown, guidance_moderators_html,
                guidance_agents_markdown, guidance_agents_html
           FROM rule_versions
          WHERE id = ? AND rule_id = ?
          LIMIT 1`,
        [rule.current_version_id, id]
      );
      const base = (baseRows as any[])[0];
      if (!base) {
        await conn.rollback();
        return res.status(404).send('Rule version not found');
      }

      const moderatorsGuidanceMarkdown =
        base.guidance_moderators_markdown != null ? String(base.guidance_moderators_markdown) :
        (base.guidance_markdown != null ? String(base.guidance_markdown) : null);
      const moderatorsGuidanceHtml =
        base.guidance_moderators_html != null ? String(base.guidance_moderators_html) :
        (base.guidance_html != null ? String(base.guidance_html) : null);
      const agentsGuidanceMarkdown = base.guidance_agents_markdown != null ? String(base.guidance_agents_markdown) : null;
      const agentsGuidanceHtml = base.guidance_agents_html != null ? String(base.guidance_agents_html) : null;

      const legacyGuidanceMarkdown = base.guidance_markdown != null ? String(base.guidance_markdown) : moderatorsGuidanceMarkdown;
      const legacyGuidanceHtml = base.guidance_html != null ? String(base.guidance_html) : moderatorsGuidanceHtml;

      await conn.query(
        `INSERT INTO rule_drafts (
           rule_id, markdown, html,
           short_description,
           allowed_examples_markdown, allowed_examples_html,
           disallowed_examples_markdown, disallowed_examples_html,
           guidance_markdown, guidance_html,
           guidance_moderators_markdown, guidance_moderators_html,
           guidance_agents_markdown, guidance_agents_html,
           updated_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          String(base.markdown || ''),
          String(base.html || ''),
          base.short_description != null ? String(base.short_description) : null,
          base.allowed_examples_markdown != null ? String(base.allowed_examples_markdown) : null,
          base.allowed_examples_html != null ? String(base.allowed_examples_html) : null,
          base.disallowed_examples_markdown != null ? String(base.disallowed_examples_markdown) : null,
          base.disallowed_examples_html != null ? String(base.disallowed_examples_html) : null,
          legacyGuidanceMarkdown,
          legacyGuidanceHtml,
          moderatorsGuidanceMarkdown,
          moderatorsGuidanceHtml,
          agentsGuidanceMarkdown,
          agentsGuidanceHtml,
          userId,
        ]
      );
    }

    const html = renderMarkdown(markdown).html;
    const allowedExamplesHtml = allowedExamplesMarkdown ? renderMarkdown(allowedExamplesMarkdown).html : '';
    const disallowedExamplesHtml = disallowedExamplesMarkdown ? renderMarkdown(disallowedExamplesMarkdown).html : '';
    const guidanceModeratorsHtml = guidanceModeratorsMarkdown ? renderMarkdown(guidanceModeratorsMarkdown).html : '';
    const guidanceAgentsHtml = guidanceAgentsMarkdown ? renderMarkdown(guidanceAgentsMarkdown).html : '';

    // Keep legacy guidance columns in sync (legacy guidance == moderators guidance) until the explicit drop step lands.
    const legacyGuidanceMarkdown = guidanceModeratorsMarkdown;
    const legacyGuidanceHtml = guidanceModeratorsMarkdown ? guidanceModeratorsHtml : '';

    await conn.query(
      `UPDATE rules
          SET title = ?, category_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [title, categoryId, userId, id]
    );

    await conn.query(
      `UPDATE rule_drafts
          SET markdown = ?, html = ?,
              short_description = ?,
              allowed_examples_markdown = ?, allowed_examples_html = ?,
              disallowed_examples_markdown = ?, disallowed_examples_html = ?,
              guidance_markdown = ?, guidance_html = ?,
              guidance_moderators_markdown = ?, guidance_moderators_html = ?,
              guidance_agents_markdown = ?, guidance_agents_html = ?,
              updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE rule_id = ?`,
      [
        markdown,
        html,
        shortDescription || null,
        allowedExamplesMarkdown || null,
        allowedExamplesMarkdown ? allowedExamplesHtml : null,
        disallowedExamplesMarkdown || null,
        disallowedExamplesMarkdown ? disallowedExamplesHtml : null,
        legacyGuidanceMarkdown || null,
        legacyGuidanceMarkdown ? legacyGuidanceHtml : null,
        guidanceModeratorsMarkdown || null,
        guidanceModeratorsMarkdown ? guidanceModeratorsHtml : null,
        guidanceAgentsMarkdown || null,
        guidanceAgentsMarkdown ? guidanceAgentsHtml : null,
        userId,
        id,
      ]
    );

    if (action === 'publish') {
      const [maxRows] = await conn.query(
        `SELECT COALESCE(MAX(version), 0) AS max_version
           FROM rule_versions
          WHERE rule_id = ?
          FOR UPDATE`,
        [id]
      );
      const maxVersion = Number((maxRows as any[])[0]?.max_version ?? 0);
      const nextVersion = Number.isFinite(maxVersion) && maxVersion >= 0 ? maxVersion + 1 : 1;

      const insertRes = await conn.query(
        `INSERT INTO rule_versions (
           rule_id, version,
           markdown, html,
           short_description,
           allowed_examples_markdown, allowed_examples_html,
           disallowed_examples_markdown, disallowed_examples_html,
           guidance_markdown, guidance_html,
           guidance_moderators_markdown, guidance_moderators_html,
           guidance_agents_markdown, guidance_agents_html,
           change_summary,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          nextVersion,
          markdown,
          html,
          shortDescription || null,
          allowedExamplesMarkdown || null,
          allowedExamplesMarkdown ? allowedExamplesHtml : null,
          disallowedExamplesMarkdown || null,
          disallowedExamplesMarkdown ? disallowedExamplesHtml : null,
          legacyGuidanceMarkdown || null,
          legacyGuidanceMarkdown ? legacyGuidanceHtml : null,
          guidanceModeratorsMarkdown || null,
          guidanceModeratorsMarkdown ? guidanceModeratorsHtml : null,
          guidanceAgentsMarkdown || null,
          guidanceAgentsMarkdown ? guidanceAgentsHtml : null,
          changeSummary.trim() ? changeSummary.trim().slice(0, 512) : null,
          userId,
        ]
      );
      const newVersionId = (insertRes as any)?.[0]?.insertId ? Number((insertRes as any)[0].insertId) : null;
      if (!newVersionId || !Number.isFinite(newVersionId)) {
        await conn.rollback();
        return res.status(500).send('Failed to publish version');
      }

      await conn.query(
        `UPDATE rules
            SET current_version_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [newVersionId, userId, id]
      );

      await conn.commit();
      return res.redirect(
        `/admin/rules/${encodeURIComponent(String(id))}/edit?notice=${encodeURIComponent(`Published v${nextVersion}.`)}`
      );
    }

    await conn.commit();
    res.redirect(`/admin/rules/${encodeURIComponent(String(id))}/edit?notice=${encodeURIComponent('Draft saved.')}`);
  } catch (err) {
    try { if (conn) await conn.rollback(); } catch {}
    logError(req.log || pagesLogger, err, 'admin save rule draft failed', { path: req.path })
    res.status(500).send('Failed to save draft');
  } finally {
    try { if (conn) conn.release(); } catch {}
  }
});

pagesRouter.post('/admin/rules/:id/delete', async (req: any, res: any) => {
  let conn: any = null;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Rule not found');

    const db = getPool() as any;
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [ruleRows] = await conn.query(`SELECT id, slug FROM rules WHERE id = ? LIMIT 1`, [id]);
    const rule = (ruleRows as any[])[0];
    if (!rule) {
      await conn.rollback();
      return res.status(404).send('Rule not found');
    }

    // Preserve moderation records but detach from rule versions (FK-safe).
    await conn.query(
      `UPDATE moderation_actions ma
          JOIN rule_versions rv ON rv.id = ma.rule_version_id
         SET ma.rule_version_id = NULL
       WHERE rv.rule_id = ?`,
      [id]
    );

    await conn.query(`DELETE FROM rule_drafts WHERE rule_id = ?`, [id]);
    await conn.query(`DELETE FROM rule_versions WHERE rule_id = ?`, [id]);
    await conn.query(`DELETE FROM rules WHERE id = ?`, [id]);
    await conn.commit();

    res.redirect('/admin/rules');
  } catch (err) {
    try { if (conn) await conn.rollback(); } catch {}
    logError(req.log || pagesLogger, err, 'admin delete rule failed', { path: req.path })
    res.status(500).send('Failed to delete rule');
  } finally {
    try { if (conn) conn.release(); } catch {}
  }
});

pagesRouter.get('/admin/rules/new', async (req: any, res: any) => {
  const categories = await listRuleCategories();
  const cookies = parseCookies(req.headers.cookie);
  const csrfToken = cookies['csrf'] || '';
  const doc = renderRuleForm({ rule: {}, categories, error: null, success: null, csrfToken });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(doc);
});

pagesRouter.post('/admin/rules', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any;
    const rawSlug = String(body.slug || '');
    const rawTitle = String(body.title || '');
    const rawMarkdown = String(body.markdown || '');
    const rawVisibility = String(body.visibility || 'public');
    const changeSummary = body.changeSummary ? String(body.changeSummary) : '';
    const shortDescription = body.shortDescription ? String(body.shortDescription) : '';
    const allowedExamplesMarkdown = body.allowedExamples ? String(body.allowedExamples) : '';
    const disallowedExamplesMarkdown = body.disallowedExamples ? String(body.disallowedExamples) : '';
    const guidanceModeratorsMarkdown = body.guidanceModerators ? String(body.guidanceModerators) : '';
    const guidanceAgentsMarkdown = body.guidanceAgents ? String(body.guidanceAgents) : '';
    const rawCategoryId = body.categoryId != null ? String(body.categoryId) : '';

    const slug = normalizePageSlug(rawSlug);
    if (!slug) {
      const categories = await listRuleCategories();
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderRuleForm({ rule: body, categories, error: 'Slug is required and must use only a–z, 0–9, \'-\' and \'/\' (max 4 segments).', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    const title = rawTitle.trim() || slug;
    const visibility: PageVisibility = (['public', 'authenticated', 'space_moderator', 'space_admin'] as PageVisibility[]).includes(rawVisibility as PageVisibility)
      ? (rawVisibility as PageVisibility)
      : 'public';

    const { html } = renderMarkdown(rawMarkdown);
    const allowedExamplesHtml = allowedExamplesMarkdown ? renderMarkdown(allowedExamplesMarkdown).html : '';
    const disallowedExamplesHtml = disallowedExamplesMarkdown ? renderMarkdown(disallowedExamplesMarkdown).html : '';
    const guidanceModeratorsHtml = guidanceModeratorsMarkdown ? renderMarkdown(guidanceModeratorsMarkdown).html : '';
    const guidanceAgentsHtml = guidanceAgentsMarkdown ? renderMarkdown(guidanceAgentsMarkdown).html : '';

    // Keep legacy guidance columns in sync (legacy guidance == moderators guidance) until the explicit drop step lands.
    const legacyGuidanceMarkdown = guidanceModeratorsMarkdown;
    const legacyGuidanceHtml = guidanceModeratorsMarkdown ? guidanceModeratorsHtml : '';
    const db = getPool();
    const userId = req.user && req.user.id ? Number(req.user.id) : null;
    let categoryId: number | null = rawCategoryId && /^\d+$/.test(rawCategoryId) ? Number(rawCategoryId) : null;
    if (categoryId != null) {
      try {
        const [catRows] = await db.query(`SELECT id FROM rule_categories WHERE id = ? LIMIT 1`, [categoryId]);
        if (!(catRows as any[])?.length) categoryId = null;
      } catch {
        categoryId = null;
      }
    }

    let ruleId: number;
    let versionId: number;
    try {
      const [insRule] = await db.query(
        `INSERT INTO rules (slug, title, category_id, visibility, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [slug, title, categoryId, visibility, userId, userId]
      );
      ruleId = Number((insRule as any).insertId);
      const [insVersion] = await db.query(
        `INSERT INTO rule_versions (
           rule_id, version, markdown, html,
           short_description,
           allowed_examples_markdown, allowed_examples_html,
           disallowed_examples_markdown, disallowed_examples_html,
           guidance_markdown, guidance_html,
           guidance_moderators_markdown, guidance_moderators_html,
           guidance_agents_markdown, guidance_agents_html,
           change_summary, created_by
         )
         VALUES (
           ?, 1, ?, ?,
           ?,
           ?, ?,
           ?, ?,
           ?, ?,
           ?, ?,
           ?, ?,
           ?, ?
         )`,
        [
          ruleId,
          rawMarkdown,
          html,
          shortDescription || null,
          allowedExamplesMarkdown || null,
          allowedExamplesMarkdown ? allowedExamplesHtml : null,
          disallowedExamplesMarkdown || null,
          disallowedExamplesMarkdown ? disallowedExamplesHtml : null,
          legacyGuidanceMarkdown || null,
          legacyGuidanceMarkdown ? legacyGuidanceHtml : null,
          guidanceModeratorsMarkdown || null,
          guidanceModeratorsMarkdown ? guidanceModeratorsHtml : null,
          guidanceAgentsMarkdown || null,
          guidanceAgentsMarkdown ? guidanceAgentsHtml : null,
          changeSummary || null,
          userId,
        ]
      );
      versionId = Number((insVersion as any).insertId);
      await db.query(
        `UPDATE rules SET current_version_id = ? WHERE id = ?`,
        [versionId, ruleId]
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_rules_slug')) {
        const categories = await listRuleCategories();
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderRuleForm({ rule: body, categories, error: 'Slug already exists. Please choose a different slug.', success: null, csrfToken });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect('/admin/rules');
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin create rule failed', { path: req.path })
    res.status(500).send('Failed to create rule');
  }
});

pagesRouter.get('/admin/rules/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Rule not found');
    const db = getPool();
    const [ruleRows] = await db.query(
      `SELECT id, slug, title, visibility, current_version_id
         FROM rules
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule) return res.status(404).send('Rule not found');
    const [versionRows] = await db.query(
      `SELECT id, version, created_at, created_by, change_summary
         FROM rule_versions
        WHERE rule_id = ?
        ORDER BY version DESC`,
      [rule.id]
    );
    const versions = versionRows as any[];
    const [draftRows] = await db.query(`SELECT updated_at FROM rule_drafts WHERE rule_id = ? LIMIT 1`, [rule.id]);
    const draftUpdatedAt = (draftRows as any[])?.[0]?.updated_at ? String((draftRows as any[])[0].updated_at) : '';
    const currentVersionRow = versions.find((v) => v && v.id === rule.current_version_id);
    const currentPublishedAt = currentVersionRow && currentVersionRow.created_at ? String(currentVersionRow.created_at) : '';
    const hasUnpublishedDraft = !!draftUpdatedAt && (currentPublishedAt ? draftUpdatedAt > currentPublishedAt : true);

    let body = `<h1>Rule: ${escapeHtml(rule.slug || rule.title || '')}</h1>`;
    body += '<div class="toolbar"><div><a href="/admin/rules">\u2190 Back to rules</a></div><div><a href="/admin/rules/' + escapeHtml(String(rule.id)) + '/edit">Edit Draft</a> &nbsp; <a href="/admin/rules/' + escapeHtml(String(rule.id)) + '/versions/new">New version</a></div></div>';
    body += `<p><span class="pill">Visibility: ${escapeHtml(String(rule.visibility || 'public'))}</span></p>`;
    if (draftUpdatedAt) {
      body += `<p><strong>Draft last saved:</strong> ${escapeHtml(draftUpdatedAt)} ${hasUnpublishedDraft ? '<span class="pill">Draft pending</span>' : ''}</p>`;
    }
    if (!versions.length) {
      body += '<p>No versions exist yet.</p>';
    } else {
      body += '<table><thead><tr><th>Version</th><th>Created</th><th>Summary</th><th>View</th></tr></thead><tbody>';
      for (const v of versions) {
        const ver = escapeHtml(String(v.version));
        const created = v.created_at ? escapeHtml(String(v.created_at)) : '';
        const summary = v.change_summary ? escapeHtml(String(v.change_summary)) : '';
        const viewUrl = `/rules/${encodeURIComponent(rule.slug)}/v:${encodeURIComponent(String(v.version))}`;
        body += `<tr><td>${ver}${v.id === rule.current_version_id ? ' (current)' : ''}</td><td>${created}</td><td>${summary}</td><td><a href="${viewUrl}">View</a></td></tr>`;
      }
      body += '</tbody></table>';
    }

    const doc = renderAdminPage({ title: 'Rule detail', bodyHtml: body, active: 'rules' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin rule detail failed', { path: req.path })
    res.status(500).send('Failed to load rule');
  }
});

pagesRouter.get('/admin/rules/:id/versions/new', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Rule not found');
    const db = getPool();
    const [ruleRows] = await db.query(
      `SELECT r.id, r.slug, r.title, r.current_version_id, c.name AS category_name
         FROM rules r
         LEFT JOIN rule_categories c ON c.id = r.category_id
        WHERE r.id = ?
        LIMIT 1`,
      [id]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule) return res.status(404).send('Rule not found');

    let draft: any = { id: rule.id, slug: rule.slug, title: rule.title, category_name: rule.category_name };
    if (rule.current_version_id) {
      const [verRows] = await db.query(
        `SELECT markdown, html, change_summary, short_description,
                allowed_examples_markdown, allowed_examples_html,
                disallowed_examples_markdown, disallowed_examples_html,
                guidance_markdown, guidance_html,
                guidance_moderators_markdown, guidance_moderators_html,
                guidance_agents_markdown, guidance_agents_html
           FROM rule_versions
          WHERE id = ?
          LIMIT 1`,
        [rule.current_version_id]
      );
      const v = (verRows as any[])[0];
      if (v) {
        const moderatorsGuidanceMarkdown =
          v.guidance_moderators_markdown != null ? String(v.guidance_moderators_markdown) :
          (v.guidance_markdown != null ? String(v.guidance_markdown) : null);
        const moderatorsGuidanceHtml =
          v.guidance_moderators_html != null ? String(v.guidance_moderators_html) :
          (v.guidance_html != null ? String(v.guidance_html) : null);

        draft = {
          ...draft,
          markdown: v.markdown,
          html: v.html,
          change_summary: '',
          short_description: v.short_description,
          allowed_examples_markdown: v.allowed_examples_markdown,
          allowed_examples_html: v.allowed_examples_html,
          disallowed_examples_markdown: v.disallowed_examples_markdown,
          disallowed_examples_html: v.disallowed_examples_html,
          guidance_moderators_markdown: moderatorsGuidanceMarkdown,
          guidance_moderators_html: moderatorsGuidanceHtml,
          guidance_agents_markdown: v.guidance_agents_markdown,
          guidance_agents_html: v.guidance_agents_html,
        };
      }
    }
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const doc = renderRuleForm({ rule: draft, error: null, success: null, csrfToken, isNewVersion: true });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin new rule version form failed', { path: req.path })
    res.status(500).send('Failed to load version form');
  }
});

pagesRouter.post('/admin/rules/:id/versions/new', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Rule not found');
    const body = (req.body || {}) as any;
    const rawMarkdown = String(body.markdown || '');
    const changeSummary = body.changeSummary ? String(body.changeSummary) : '';
    const shortDescription = body.shortDescription ? String(body.shortDescription) : '';
    const allowedExamplesMarkdown = body.allowedExamples ? String(body.allowedExamples) : '';
    const disallowedExamplesMarkdown = body.disallowedExamples ? String(body.disallowedExamples) : '';
    const guidanceModeratorsMarkdown = body.guidanceModerators ? String(body.guidanceModerators) : '';
    const guidanceAgentsMarkdown = body.guidanceAgents ? String(body.guidanceAgents) : '';

    const db = getPool();
    const [ruleRows] = await db.query(
      `SELECT id, slug, title
         FROM rules
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule) return res.status(404).send('Rule not found');

    const [maxRows] = await db.query(
      `SELECT MAX(version) AS max_version FROM rule_versions WHERE rule_id = ?`,
      [rule.id]
    );
    const maxVersion = (maxRows as any[])[0]?.max_version != null ? Number((maxRows as any[])[0].max_version) : 0;
    const nextVersion = maxVersion + 1;

    const { html } = renderMarkdown(rawMarkdown);
    const allowedExamplesHtml = allowedExamplesMarkdown ? renderMarkdown(allowedExamplesMarkdown).html : '';
    const disallowedExamplesHtml = disallowedExamplesMarkdown ? renderMarkdown(disallowedExamplesMarkdown).html : '';
    const guidanceModeratorsHtml = guidanceModeratorsMarkdown ? renderMarkdown(guidanceModeratorsMarkdown).html : '';
    const guidanceAgentsHtml = guidanceAgentsMarkdown ? renderMarkdown(guidanceAgentsMarkdown).html : '';
    const userId = req.user && req.user.id ? Number(req.user.id) : null;

    // Keep legacy guidance columns in sync (legacy guidance == moderators guidance) until the explicit drop step lands.
    const legacyGuidanceMarkdown = guidanceModeratorsMarkdown;
    const legacyGuidanceHtml = guidanceModeratorsMarkdown ? guidanceModeratorsHtml : '';

    const [insVersion] = await db.query(
      `INSERT INTO rule_versions (
         rule_id, version, markdown, html,
         short_description,
         allowed_examples_markdown, allowed_examples_html,
         disallowed_examples_markdown, disallowed_examples_html,
         guidance_markdown, guidance_html,
         guidance_moderators_markdown, guidance_moderators_html,
         guidance_agents_markdown, guidance_agents_html,
         change_summary, created_by
       )
       VALUES (
         ?, ?, ?, ?,
         ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?
       )`,
      [
        rule.id,
        nextVersion,
        rawMarkdown,
        html,
        shortDescription || null,
        allowedExamplesMarkdown || null,
        allowedExamplesMarkdown ? allowedExamplesHtml : null,
        disallowedExamplesMarkdown || null,
        disallowedExamplesMarkdown ? disallowedExamplesHtml : null,
        legacyGuidanceMarkdown || null,
        legacyGuidanceMarkdown ? legacyGuidanceHtml : null,
        guidanceModeratorsMarkdown || null,
        guidanceModeratorsMarkdown ? guidanceModeratorsHtml : null,
        guidanceAgentsMarkdown || null,
        guidanceAgentsMarkdown ? guidanceAgentsHtml : null,
        changeSummary || null,
        userId,
      ]
    );
    const versionId = Number((insVersion as any).insertId);
    await db.query(
      `UPDATE rules SET current_version_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [versionId, userId, rule.id]
    );

    res.redirect(`/admin/rules/${rule.id}`);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin create rule version failed', { path: req.path })
    res.status(500).send('Failed to create rule version');
  }
});

async function loadPageParentOptions(): Promise<Array<{ id: number; title: string; path: string }>> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, parent_id, slug, title
       FROM pages
      WHERE type = 'section'
      ORDER BY title, id`
  )
  const items = (rows as any[]).map((r) => ({
    id: Number(r.id),
    parentId: r.parent_id == null ? null : Number(r.parent_id),
    slug: String(r.slug || ''),
    title: String(r.title || ''),
  }))
  const byId = new Map<number, { id: number; parentId: number | null; slug: string; title: string }>()
  for (const it of items) byId.set(it.id, it)
  const cache = new Map<number, string>()
  const buildPath = (id: number): string => {
    const cached = cache.get(id)
    if (cached) return cached
    const node = byId.get(id)
    if (!node) return ''
    const visited = new Set<number>()
    let cur: typeof node | undefined = node
    const segments: string[] = []
    while (cur) {
      if (visited.has(cur.id)) break
      visited.add(cur.id)
      segments.push(cur.slug)
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
    }
    const path = segments.reverse().join('/')
    cache.set(id, path)
    return path
  }
  return items.map((it) => ({
    id: it.id,
    title: it.title || it.slug,
    path: buildPath(it.id),
  }))
}

async function loadPageByIdForAdmin(id: number): Promise<any | null> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, type, parent_id, sort_order, slug, title, markdown, html, visibility
       FROM pages
      WHERE id = ?
      LIMIT 1`,
    [id]
  )
  return (rows as any[])[0] || null
}

async function validatePageParentCandidate(opts: {
  pageId?: number | null
  parentId: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const { pageId = null, parentId } = opts
  if (parentId == null) return { ok: true }
  const parent = await loadPageByIdForAdmin(parentId)
  if (!parent) return { ok: false, error: 'Parent section not found.' }
  if (String(parent.type || 'document') !== 'section') return { ok: false, error: 'Parent must be a section.' }
  if (pageId != null && Number(pageId) === Number(parentId)) return { ok: false, error: 'A page cannot be its own parent.' }
  if (pageId != null) {
    const db = getPool()
    const visited = new Set<number>()
    let cur: any = parent
    while (cur) {
      const cid = Number(cur.id)
      if (visited.has(cid)) break
      visited.add(cid)
      if (cid === Number(pageId)) return { ok: false, error: 'Invalid parent: cycle detected.' }
      if (cur.parent_id == null) break
      const [rows] = await db.query(`SELECT id, parent_id FROM pages WHERE id = ? LIMIT 1`, [Number(cur.parent_id)])
      cur = (rows as any[])[0] || null
    }
  }
  return { ok: true }
}

async function movePageWithinSiblings(pageId: number, direction: 'up' | 'down'): Promise<boolean> {
  const db = getPool()
  const [rowRes] = await db.query(
    `SELECT id, parent_id, sort_order
       FROM pages
      WHERE id = ?
      LIMIT 1`,
    [pageId]
  )
  const row = (rowRes as any[])[0]
  if (!row) return false
  const parentId = row.parent_id == null ? null : Number(row.parent_id)
  const sortOrder = Number(row.sort_order || 0)
  const parentWhere = parentId == null ? 'parent_id IS NULL' : 'parent_id = ?'
  const cmp = direction === 'up' ? '<' : '>'
  const ord = direction === 'up' ? 'DESC' : 'ASC'
  const [sibRes] = await db.query(
    `SELECT id, sort_order
       FROM pages
      WHERE ${parentWhere}
        AND (
          sort_order ${cmp} ?
          OR (sort_order = ? AND id ${cmp} ?)
        )
      ORDER BY sort_order ${ord}, id ${ord}
      LIMIT 1`,
    direction === 'up'
      ? (parentId == null ? [sortOrder, sortOrder, pageId] : [parentId, sortOrder, sortOrder, pageId])
      : (parentId == null ? [sortOrder, sortOrder, pageId] : [parentId, sortOrder, sortOrder, pageId])
  )
  const sibling = (sibRes as any[])[0]
  if (!sibling) return false
  const siblingId = Number(sibling.id)
  const siblingOrder = Number(sibling.sort_order || 0)
  await db.query(`UPDATE pages SET sort_order = ? WHERE id = ?`, [siblingOrder, pageId])
  await db.query(`UPDATE pages SET sort_order = ? WHERE id = ?`, [sortOrder, siblingId])
  return true
}

async function countDocumentDescendants(sectionId: number): Promise<number> {
  const db = getPool()
  const [rows] = await db.query(
    `WITH RECURSIVE subtree AS (
       SELECT id, type
         FROM pages
        WHERE id = ?
       UNION ALL
       SELECT p.id, p.type
         FROM pages p
         INNER JOIN subtree s ON p.parent_id = s.id
     )
     SELECT COUNT(*) AS c
       FROM subtree
      WHERE id <> ?
        AND type = 'document'`,
    [sectionId, sectionId]
  )
  return Number((rows as any[])[0]?.c || 0)
}
function renderPageForm(opts: {
  page?: any;
  parentOptions?: Array<{ id: number; title: string; path: string }>;
  error?: string | null;
  success?: string | null;
  csrfToken?: string | null;
}): string {
  const page = opts.page ?? {};
  const parentOptions = Array.isArray(opts.parentOptions) ? opts.parentOptions : [];
  const error = opts.error;
  const success = opts.success;
  const isEdit = !!page.id;
  const title = isEdit ? 'Edit Page' : 'New Page';
  const typeValue = page.type === 'section' ? 'section' : 'document';
  const parentIdValue = page.parent_id != null ? String(page.parent_id) : (page.parentId != null ? String(page.parentId) : '');
  const sortOrderValue = page.sort_order != null ? String(page.sort_order) : (page.sortOrder != null ? String(page.sortOrder) : '0');
  const slugValue = page.slug ? String(page.slug) : '';
  const titleValue = page.title ? String(page.title) : '';
  const visibilityValue = page.visibility ? String(page.visibility) : 'public';
  const markdownValue = page.markdown ? String(page.markdown) : '';
  const htmlValue = page.html ? String(page.html) : '';
  const action = isEdit ? `/admin/pages/${page.id}` : '/admin/pages';
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';

  let body = `<h1>${escapeHtml(title)}</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/pages">\u2190 Back to pages</a></div></div>';
  if (error) {
    body += `<div class="error">${escapeHtml(error)}</div>`;
  } else if (success) {
    body += `<div class="success">${escapeHtml(success)}</div>`;
  }
  body += `<form method="post" action="${action}">`;
  if (csrfToken) {
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;
  }
  body += `<label>Type
    <select name="type" id="page-type" ${isEdit ? 'disabled' : ''}>
      <option value="document"${typeValue === 'document' ? ' selected' : ''}>Document</option>
      <option value="section"${typeValue === 'section' ? ' selected' : ''}>Section</option>
    </select>
    ${isEdit ? '<input type="hidden" name="type" value="' + escapeHtml(typeValue) + '" /><div class="field-hint">Type is fixed after creation.</div>' : ''}
  </label>`;
  body += `<label>Parent section
    <select name="parentId">
      <option value="">(root)</option>
      ${parentOptions
        .filter((opt) => Number(opt.id) !== Number(page.id || 0))
        .map((opt) => {
          const selected = String(opt.id) === parentIdValue ? ' selected' : ''
          const label = `${opt.title} (${opt.path})`
          return `<option value="${escapeHtml(String(opt.id))}"${selected}>${escapeHtml(label)}</option>`
        })
        .join('')}
    </select>
  </label>`;
  body += `<label>Sort order
    <input type="text" name="sortOrder" value="${escapeHtml(sortOrderValue)}" />
  </label>`;
  body += `<label>Slug (URL segment)
    <input type="text" name="slug" value="${escapeHtml(slugValue)}" />
    <div class="field-hint">Lowercase segment only (a–z, 0–9, '-'). Full URL is assembled from parent sections.</div>
  </label>`;
  body += `<label>Title
    <input type="text" name="title" value="${escapeHtml(titleValue)}" />
  </label>`;
  body += `<label>Visibility
    <select name="visibility">
      <option value="public"${visibilityValue === 'public' ? ' selected' : ''}>Public</option>
      <option value="authenticated"${visibilityValue === 'authenticated' ? ' selected' : ''}>Authenticated users</option>
      <option value="space_moderator"${visibilityValue === 'space_moderator' ? ' selected' : ''}>Any space moderator</option>
      <option value="space_admin"${visibilityValue === 'space_admin' ? ' selected' : ''}>Any space admin</option>
    </select>
  </label>`;
  const pageMdId = `page_markdown_${page.id ? String(page.id) : 'new'}`;
  body += `<div id="page-document-fields" style="${typeValue === 'section' ? 'display:none;' : ''}">`;
  body += `<label for="${escapeHtml(pageMdId)}">Markdown</label>`;
  body += `<textarea id="${escapeHtml(pageMdId)}" name="markdown" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(htmlValue)}">${escapeHtml(markdownValue)}</textarea>`;
  body += `<div class="field-hint">Markdown is rendered server-side using the restricted contract in <code>agents/requirements/markdown.md</code>.</div>`;
  body += `</div>`;
  body += `<div class="actions">
    <button type="submit">${isEdit ? 'Save changes' : 'Create page'}</button>
  </div>`;
  body += `</form>`;

  body += `
<style>
  .md-wysiwyg { margin-top: 6px; }
  .ck.ck-editor__main>.ck-editor__editable { background: rgba(0,0,0,0.35); color: #f5f5f5; min-height: 320px; }
  .ck.ck-toolbar { background: rgba(0,0,0,0.55); border-color: rgba(255,255,255,0.2); }
  .ck.ck-button, .ck.ck-toolbar__separator { color: #f5f5f5; }
  .ck.ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-editor__editable.ck-focused { border-color: rgba(153,204,255,0.8) !important; box-shadow: none !important; }
  .ck.ck-dropdown__panel { background: rgba(0,0,0,0.92); border-color: rgba(255,255,255,0.2); }
  .ck.ck-list { background: transparent; }
  .ck.ck-list__item .ck-button { color: #f5f5f5; }
  .ck.ck-list__item .ck-button .ck-button__label { color: #f5f5f5; }
  .ck.ck-list__item .ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-list__item .ck-button.ck-on { background: #1976d2; color: #fff; }
  .ck.ck-list__item .ck-button.ck-on .ck-button__label { color: #fff; }
</style>
<script src="/vendor/ckeditor5/ckeditor.js"></script>
<script src="/vendor/turndown/turndown.js"></script>
<script src="/admin/ckeditor_markdown.js"></script>
<script>
  (function(){
    var typeSelect = document.getElementById('page-type');
    var docFields = document.getElementById('page-document-fields');
    if (!typeSelect || !docFields) return;
    var sync = function(){
      var v = String(typeSelect.value || '');
      docFields.style.display = v === 'section' ? 'none' : '';
    };
    typeSelect.addEventListener('change', sync);
    sync();
  })();
</script>
`;

  return renderAdminPage({ title, bodyHtml: body, active: 'pages' });
}

pagesRouter.get('/admin/pages/new', async (req: any, res: any) => {
  try {
    const parentOptions = await loadPageParentOptions()
    const initialType = String(req.query?.type || '').trim().toLowerCase() === 'section' ? 'section' : 'document'
    const initialParentId = parsePositiveIntOrNull(req.query?.parentId)
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const doc = renderPageForm({
      page: {
        type: initialType,
        parent_id: initialParentId != null ? initialParentId : null,
        sort_order: 0,
      },
      parentOptions,
      error: null,
      success: null,
      csrfToken,
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin new page form failed', { path: req.path })
    res.status(500).send('Failed to load page form');
  }
});

pagesRouter.post('/admin/pages', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any;
    const rawType = String(body.type || 'document').trim().toLowerCase()
    const pageType: 'section' | 'document' = rawType === 'section' ? 'section' : 'document'
    const parentId = parsePositiveIntOrNull(body.parentId)
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0
    const rawSlug = String(body.slug || '');
    const rawTitle = String(body.title || '');
    const rawMarkdown = String(body.markdown || '');
    const rawVisibility = String(body.visibility || 'public');

    const slug = normalizePageNodeSlug(rawSlug);
    if (!slug) {
      const parentOptions = await loadPageParentOptions()
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: body, parentOptions, error: 'Slug is required and must use only a–z, 0–9, \'-\'.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (parentId == null && isReservedPageSlug(slug)) {
      const parentOptions = await loadPageParentOptions()
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: body, parentOptions, error: 'Root slug collides with a reserved route. Please choose a different slug.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    const parentValidation = await validatePageParentCandidate({ parentId })
    if (!parentValidation.ok) {
      const parentOptions = await loadPageParentOptions()
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: body, parentOptions, error: parentValidation.error || 'Invalid parent selection.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    const title = rawTitle.trim() || slug;
    const visibility: PageVisibility = (['public', 'authenticated', 'space_moderator', 'space_admin'] as PageVisibility[]).includes(rawVisibility as PageVisibility)
      ? (rawVisibility as PageVisibility)
      : 'public';

    const markdown = pageType === 'document' ? rawMarkdown : ''
    const { html } = pageType === 'document' ? renderMarkdown(rawMarkdown) : { html: '' }

    const db = getPool();
    const userId = req.user && req.user.id ? Number(req.user.id) : null;
    try {
      await db.query(
        `INSERT INTO pages (type, parent_id, sort_order, slug, title, markdown, html, visibility, layout, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'default', ?, ?)`,
        [pageType, parentId, sortOrder, slug, title, markdown, html, visibility, userId, userId]
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_pages_parent_slug')) {
        const parentOptions = await loadPageParentOptions()
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderPageForm({ page: body, parentOptions, error: 'Slug already exists under this parent. Please choose a different slug.', success: null, csrfToken });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect('/admin/pages');
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin create page failed', { path: req.path })
    res.status(500).send('Failed to create page');
  }
});

pagesRouter.get('/admin/pages/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Page not found');
    const page = await loadPageByIdForAdmin(id)
    if (!page) return res.status(404).send('Page not found');
    const parentOptions = await loadPageParentOptions()
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const doc = renderPageForm({ page, parentOptions, error: null, success: null, csrfToken });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin edit page load failed', { path: req.path })
    res.status(500).send('Failed to load page for editing');
  }
});

pagesRouter.post('/admin/pages/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Page not found');

    const body = (req.body || {}) as any;
    const rawType = String(body.type || 'document').trim().toLowerCase()
    const requestedType: 'section' | 'document' = rawType === 'section' ? 'section' : 'document'
    const parentId = parsePositiveIntOrNull(body.parentId)
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0
    const rawSlug = String(body.slug || '');
    const rawTitle = String(body.title || '');
    const rawMarkdown = String(body.markdown || '');
    const rawVisibility = String(body.visibility || 'public');

    const existing = await loadPageByIdForAdmin(id)
    if (!existing) return res.status(404).send('Page not found');
    const pageType: 'section' | 'document' = String(existing.type || 'document') === 'section' ? 'section' : 'document'

    if (requestedType !== pageType) {
      const parentOptions = await loadPageParentOptions()
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: { ...body, id, type: pageType }, parentOptions, error: 'Type cannot be changed after creation.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }

    const slug = normalizePageNodeSlug(rawSlug);
    if (!slug) {
      const parentOptions = await loadPageParentOptions()
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: { ...body, id, type: pageType }, parentOptions, error: 'Slug is required and must use only a–z, 0–9, \'-\'.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (parentId == null && isReservedPageSlug(slug)) {
      const parentOptions = await loadPageParentOptions()
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: { ...body, id, type: pageType }, parentOptions, error: 'Root slug collides with a reserved route. Please choose a different slug.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    const parentValidation = await validatePageParentCandidate({ pageId: id, parentId })
    if (!parentValidation.ok) {
      const parentOptions = await loadPageParentOptions()
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: { ...body, id, type: pageType }, parentOptions, error: parentValidation.error || 'Invalid parent selection.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    const title = rawTitle.trim() || slug;
    const visibility: PageVisibility = (['public', 'authenticated', 'space_moderator', 'space_admin'] as PageVisibility[]).includes(rawVisibility as PageVisibility)
      ? (rawVisibility as PageVisibility)
      : 'public';

    const markdown = pageType === 'document' ? rawMarkdown : ''
    const { html } = pageType === 'document' ? renderMarkdown(rawMarkdown) : { html: '' }
    const db = getPool();
    const userId = req.user && req.user.id ? Number(req.user.id) : null;

    try {
      await db.query(
        `UPDATE pages
            SET parent_id = ?, sort_order = ?, slug = ?, title = ?, markdown = ?, html = ?, visibility = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [parentId, sortOrder, slug, title, markdown, html, visibility, userId, id]
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_pages_parent_slug')) {
        const parentOptions = await loadPageParentOptions()
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderPageForm({ page: { ...body, id, type: pageType }, parentOptions, error: 'Slug already exists under this parent. Please choose a different slug.', success: null, csrfToken });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect('/admin/pages');
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin update page failed', { path: req.path })
    res.status(500).send('Failed to update page');
  }
});

pagesRouter.post('/admin/pages/:id/move-up', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/pages')
    await movePageWithinSiblings(id, 'up')
    res.redirect('/admin/pages')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin move page up failed', { path: req.path })
    res.redirect('/admin/pages')
  }
})

pagesRouter.post('/admin/pages/:id/move-down', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/pages')
    await movePageWithinSiblings(id, 'down')
    res.redirect('/admin/pages')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin move page down failed', { path: req.path })
    res.redirect('/admin/pages')
  }
})

pagesRouter.post('/admin/pages/:id/delete', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/pages')
    const db = getPool()
    const [rows] = await db.query(`SELECT id, type FROM pages WHERE id = ? LIMIT 1`, [id])
    const page = (rows as any[])[0]
    if (!page) return res.redirect('/admin/pages?error=' + encodeURIComponent('Page not found.'))
    const type = String(page.type || 'document') === 'section' ? 'section' : 'document'
    if (type === 'section') {
      const docsCount = await countDocumentDescendants(id)
      if (docsCount > 0) {
        return res.redirect('/admin/pages?error=' + encodeURIComponent('Cannot delete section until all documents in that section are removed.'))
      }
      const [childRows] = await db.query(`SELECT COUNT(*) AS c FROM pages WHERE parent_id = ?`, [id])
      const childCount = Number((childRows as any[])[0]?.c || 0)
      if (childCount > 0) {
        return res.redirect('/admin/pages?error=' + encodeURIComponent('Cannot delete section until child sections are removed or moved.'))
      }
    }
    await db.query(`DELETE FROM pages WHERE id = ?`, [id])
    return res.redirect('/admin/pages?notice=' + encodeURIComponent('Page deleted.'))
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin delete page failed', { path: req.path })
    return res.redirect('/admin/pages?error=' + encodeURIComponent('Failed to delete page.'))
  }
})

pagesRouter.get('/uploads', async (req: any, res: any) => {
  try {
    const kind = String(req.query?.kind || '').trim().toLowerCase()
    if (kind === 'audio') {
      const from = encodeURIComponent(req.originalUrl || '/uploads')
      if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`)
      const ok = await can(req.user.id, PERM.VIDEO_DELETE_ANY).catch(() => false)
      if (!ok) return res.redirect(`/forbidden?from=${from}`)
      return res.redirect('/admin/audio')
    }
  } catch {}
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/profile', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/profile/avatar', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

// Public user profile pages (slug or legacy numeric id)
pagesRouter.get(/^\/users\/([^/]+)\/?$/, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

// Help UI (SPA shell)
pagesRouter.get('/help', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
// SPA shell for help topics by slug (e.g., /help/groups), but do not match .html files
pagesRouter.get(/^\/help\/([^/.]+)\/?$/, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

// Space console (separate bundle; not shipped in the main feed SPA)
pagesRouter.get('/space/admin', requireAnySpaceAdminPage, (_req, res) => {
  serveSpaceSpa(res);
});
pagesRouter.get('/space/admin/groups', requireAnySpaceAdminPage, (_req, res) => {
  serveSpaceSpa(res);
});
pagesRouter.get('/space/admin/channels', requireAnySpaceAdminPage, (_req, res) => {
  serveSpaceSpa(res);
});

pagesRouter.get('/space/review/groups', requireAnySpaceModeratorPage, (_req, res) => {
  serveSpaceSpa(res);
});
pagesRouter.get('/space/review/channels', requireAnySpaceModeratorPage, (_req, res) => {
  serveSpaceSpa(res);
});

pagesRouter.get('/space/moderation', requireAnySpaceModeratorPage, (_req, res) => {
  serveSpaceSpa(res);
});
pagesRouter.get('/space/moderation/groups', requireAnySpaceModeratorPage, (_req, res) => {
  serveSpaceSpa(res);
});
pagesRouter.get('/space/moderation/channels', requireAnySpaceModeratorPage, (_req, res) => {
  serveSpaceSpa(res);
});

// Forbidden page (shows message and requested URL via querystring)
pagesRouter.get('/forbidden', (_req, res) => {
  serveHtml(res, 'forbidden.html');
});

// Split admin pages
pagesRouter.get('/admin', async (_req: any, res: any) => {
  const tiles: Array<{ title: string; href: string; desc: string }> = [
    { title: 'Review', href: '/admin/review', desc: 'Queues: Global Feed, Personal Spaces, Groups, Channels' },
    { title: 'Users', href: '/admin/users', desc: 'Manage user roles, suspensions, and space roles' },
    { title: 'Groups', href: '/admin/groups', desc: 'Manage group spaces (settings, cultures, review)' },
    { title: 'Channels', href: '/admin/channels', desc: 'Manage channel spaces (settings, cultures, review)' },
    { title: 'Rules', href: '/admin/rules', desc: 'Edit rules and drafts; view versions' },
    { title: 'Categories', href: '/admin/categories', desc: 'Create/update/delete categories (safe delete)' },
    { title: 'Cultures', href: '/admin/cultures', desc: 'Create/update cultures and assign categories' },
    { title: 'Pages', href: '/admin/pages', desc: 'Edit CMS pages (Markdown)' },
    { title: 'Audio', href: '/admin/audio', desc: 'System audio library (curated, selectable by users)' },
    { title: 'Video Library', href: '/admin/video-library', desc: 'System video library (source videos for clipping)' },
    { title: 'Lower Thirds', href: '/admin/lower-thirds', desc: 'Manage system lower third templates (SVG + descriptor)' },
    { title: 'Audio Configs', href: '/admin/audio-configs', desc: 'Presets for Mix/Replace + ducking (creators pick when producing)' },
    { title: 'Media Jobs', href: '/admin/media-jobs', desc: 'Debug ffmpeg mastering jobs (logs, retries, purge)' },
    { title: 'Messages', href: '/admin/messages', desc: 'Manage in-feed message units, targeting, and lifecycle controls' },
    { title: 'Message CTAs', href: '/admin/message-ctas', desc: 'Reusable CTA definitions (intent + executor + config) for in-feed messages' },
    { title: 'Message Rulesets', href: '/admin/message-rulesets', desc: 'Reusable inclusion/exclusion eligibility rulesets for message targeting' },
    { title: 'User-Facing Rules', href: '/admin/user-facing-rules', desc: 'Manage simplified reporting reasons and map them to canonical moderation rules' },
    { title: 'Reports', href: '/admin/reports', desc: 'Site-wide report inbox with status, assignment, and resolution workflow' },
    { title: 'Message Journeys', href: '/admin/message-journeys', desc: 'Ordered multi-step message journeys that sequence messages per user progression' },
    { title: 'Payment Providers', href: '/admin/payments/providers', desc: 'Configure PSP credentials and sandbox/live mode toggles' },
    { title: 'Payment Catalog', href: '/admin/payments/catalog', desc: 'Manage donation campaigns and subscription plans mapped to PSP products' },
    { title: 'Analytics', href: '/admin/analytics', desc: 'Cross-metric baseline feed + message conversion view with daily trend' },
    { title: 'Message Analytics', href: '/admin/message-analytics', desc: 'Funnel metrics, conversion rates, and overexposure detection for in-feed messages' },
    { title: 'Analytics Sink', href: '/admin/analytics-sink', desc: 'Optional external sink health and counters (secondary analytics path)' },
    { title: 'Settings', href: '/admin/settings', desc: 'Coming soon' },
    { title: 'Dev', href: '/admin/dev', desc: 'Dev stats and guarded tools' },
  ]

  let body = '<h1>Site Admin</h1>'
  body += '<div class="toolbar"><div><span class="pill">Admin</span></div><div></div></div>'
  body += '<div class="section">'
  body += '<div class="section-title">Sections</div>'
  body += '<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px">'
  for (const t of tiles) {
    body += `<div class="section" style="margin:0">`
    body += `<div class="section-title">${escapeHtml(t.title)}</div>`
    body += `<div style="opacity:.85; margin-bottom:10px">${escapeHtml(t.desc)}</div>`
    body += `<a class="btn" href="${escapeHtml(t.href)}">Open</a>`
    body += `</div>`
  }
  body += '</div></div>'

  const doc = renderAdminPage({ title: 'Admin', bodyHtml: body })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
})

pagesRouter.get('/admin/reports', requireGlobalModerationPage, async (req: any, res: any) => {
  try {
    const userId = Number(req.user?.id)
    const userDisplayName =
      String(req.user?.display_name || '').trim() ||
      String(req.user?.displayName || '').trim() ||
      String(req.user?.email || '').trim() ||
      `User #${Number.isFinite(userId) && userId > 0 ? userId : ''}`
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const q = req.query || {}
    const status = String(q.status || '').trim()
    const spaceTypeRaw = String(q.space_type || '').trim().toLowerCase()
    const spaceType: 'group' | 'channel' | 'personal' | '' =
      spaceTypeRaw === 'group' || spaceTypeRaw === 'channel' || spaceTypeRaw === 'personal'
        ? (spaceTypeRaw as any)
        : ''
    const notice = String(q.notice || '').trim()
    const errorText = String(q.error || '').trim()
    const spaceId = Number(q.space_id || 0)
    const cultureId = Number(q.culture_id || 0)
    const categoryId = Number(q.category_id || 0)
    const ruleId = Number(q.rule_id || 0)
    const reporterUserId = Number(q.reporter_user_id || 0)
    const assignedToUserId = Number(q.assigned_to_user_id || 0)
    const from = String(q.from || '').trim()
    const to = String(q.to || '').trim()
    const reportId = Number(q.report_id || 0)
    const view = String(q.view || '').trim().toLowerCase()
    const limit = Math.max(1, Math.min(200, Number(q.limit || 50)))
    const db = getPool()
    const [spaceRows] = await db.query(
      `SELECT id, type, name, slug
         FROM spaces
        WHERE type IN ('group','channel','personal')
        ORDER BY type, name, id`
    )
    const spacesByType: Record<'group' | 'channel' | 'personal', Array<{ id: number; name: string; slug: string }>> = {
      group: [],
      channel: [],
      personal: [],
    }
    for (const row of (spaceRows as any[])) {
      const t = String(row.type || '').trim().toLowerCase()
      if (t !== 'group' && t !== 'channel' && t !== 'personal') continue
      const id = Number(row.id)
      if (!Number.isFinite(id) || id <= 0) continue
      spacesByType[t].push({
        id,
        name: String(row.name || '').trim() || String(row.slug || '').trim() || `Space #${id}`,
        slug: String(row.slug || '').trim(),
      })
    }
    const selectedSpaceList = spaceType ? spacesByType[spaceType] : []
    const selectedSpaceId =
      spaceType && Number.isFinite(spaceId) && spaceId > 0 && selectedSpaceList.some((row) => row.id === spaceId)
        ? spaceId
        : 0
    const [cultureRows] = selectedSpaceId > 0
      ? await db.query(
          `SELECT DISTINCT c.id, c.name
             FROM cultures c
             JOIN space_cultures sc ON sc.culture_id = c.id
            WHERE sc.space_id = ?
            ORDER BY c.name, c.id`,
          [selectedSpaceId]
        )
      : spaceType
        ? await db.query(
            `SELECT DISTINCT c.id, c.name
               FROM cultures c
               JOIN space_cultures sc ON sc.culture_id = c.id
               JOIN spaces sx ON sx.id = sc.space_id
              WHERE sx.type = ?
              ORDER BY c.name, c.id`,
            [spaceType]
          )
        : await db.query(`SELECT id, name FROM cultures ORDER BY name, id`)
    const availableCultures = (cultureRows as any[])
      .map((row) => ({ id: Number(row.id), name: String(row.name || '').trim() }))
      .filter((row) => Number.isFinite(row.id) && row.id > 0)
    const selectedCultureId =
      Number.isFinite(cultureId) && cultureId > 0 && availableCultures.some((row) => row.id === cultureId)
        ? cultureId
        : 0

    const [categoryRows] = selectedCultureId > 0
      ? await db.query(
          `SELECT rc.id, rc.name
             FROM rule_categories rc
             JOIN culture_categories cc ON cc.category_id = rc.id
            WHERE cc.culture_id = ?
            ORDER BY rc.name, rc.id`,
          [selectedCultureId]
        )
      : await db.query(`SELECT id, name FROM rule_categories ORDER BY name, id`)
    const availableCategories = (categoryRows as any[])
      .map((row) => ({ id: Number(row.id), name: String(row.name || '').trim() }))
      .filter((row) => Number.isFinite(row.id) && row.id > 0)
    const selectedCategoryId =
      Number.isFinite(categoryId) && categoryId > 0 && availableCategories.some((row) => row.id === categoryId)
        ? categoryId
        : 0

    const ruleWhere: string[] = []
    const ruleParams: any[] = []
    if (['open', 'in_review', 'resolved', 'dismissed'].includes(status)) {
      ruleWhere.push(`spr.status = ?`)
      ruleParams.push(status)
    }
    if (spaceType) {
      ruleWhere.push(`s.type = ?`)
      ruleParams.push(spaceType)
    }
    if (selectedSpaceId > 0) {
      ruleWhere.push(`spr.space_id = ?`)
      ruleParams.push(selectedSpaceId)
    }
    if (from) {
      ruleWhere.push(`spr.created_at >= ?`)
      ruleParams.push(from)
    }
    if (to) {
      ruleWhere.push(`spr.created_at < DATE_ADD(?, INTERVAL 1 DAY)`)
      ruleParams.push(to)
    }
    if (Number.isFinite(reporterUserId) && reporterUserId > 0) {
      ruleWhere.push(`spr.reporter_user_id = ?`)
      ruleParams.push(reporterUserId)
    }
    if (Number.isFinite(assignedToUserId) && assignedToUserId > 0) {
      ruleWhere.push(`spr.assigned_to_user_id = ?`)
      ruleParams.push(assignedToUserId)
    }
    if (selectedCultureId > 0) {
      ruleWhere.push(`EXISTS (SELECT 1 FROM culture_categories cc WHERE cc.culture_id = ? AND cc.category_id = r.category_id)`)
      ruleParams.push(selectedCultureId)
    }
    if (selectedCategoryId > 0) {
      ruleWhere.push(`r.category_id = ?`)
      ruleParams.push(selectedCategoryId)
    }
    const ruleWhereSql = ruleWhere.length ? `WHERE ${ruleWhere.join(' AND ')}` : ''
    const [ruleRows] = await db.query(
      `SELECT DISTINCT r.id, r.title, r.slug
         FROM space_publication_reports spr
         JOIN rules r ON r.id = spr.rule_id
         JOIN spaces s ON s.id = spr.space_id
       ${ruleWhereSql}
        ORDER BY r.title, r.id
        LIMIT 2000`,
      ruleParams
    )
    const availableRules = (ruleRows as any[])
      .map((row) => ({ id: Number(row.id), title: String(row.title || '').trim(), slug: String(row.slug || '').trim() }))
      .filter((row) => Number.isFinite(row.id) && row.id > 0)
    if (Number.isFinite(ruleId) && ruleId > 0 && !availableRules.some((row) => row.id === ruleId)) {
      const [selectedRuleRows] = await db.query(
        `SELECT id, title, slug FROM rules WHERE id = ? LIMIT 1`,
        [ruleId]
      )
      const selectedRule = (selectedRuleRows as any[])[0]
      if (selectedRule) {
        availableRules.push({
          id: Number(selectedRule.id),
          title: String(selectedRule.title || '').trim() || `Rule #${ruleId}`,
          slug: String(selectedRule.slug || '').trim(),
        })
      } else {
        availableRules.push({ id: ruleId, title: `Rule #${ruleId}`, slug: '' })
      }
    }
    const selectedRuleId =
      Number.isFinite(ruleId) && ruleId > 0 && availableRules.some((row) => row.id === ruleId)
        ? ruleId
        : 0
    const [assigneeRows] = await db.query(
      `SELECT DISTINCT u.id, u.display_name, u.email
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
        WHERE r.name = 'site_admin'
        ORDER BY COALESCE(NULLIF(TRIM(u.display_name), ''), u.email), u.id`
    )
    const assigneeById = new Map<number, { id: number; label: string }>()
    for (const row of assigneeRows as any[]) {
      const id = Number(row.id)
      if (!Number.isFinite(id) || id <= 0) continue
      const label = String(row.display_name || '').trim() || String(row.email || '').trim() || `User #${id}`
      assigneeById.set(id, { id, label })
    }
    if (Number.isFinite(userId) && userId > 0 && !assigneeById.has(userId)) {
      assigneeById.set(userId, { id: userId, label: userDisplayName })
    }
    if (Number.isFinite(assignedToUserId) && assignedToUserId > 0 && !assigneeById.has(assignedToUserId)) {
      assigneeById.set(assignedToUserId, { id: assignedToUserId, label: `User #${assignedToUserId}` })
    }
    const reporterWhere: string[] = []
    const reporterParams: any[] = []
    if (['open', 'in_review', 'resolved', 'dismissed'].includes(status)) {
      reporterWhere.push(`spr.status = ?`)
      reporterParams.push(status)
    }
    if (spaceType) {
      reporterWhere.push(`s.type = ?`)
      reporterParams.push(spaceType)
    }
    if (selectedSpaceId > 0) {
      reporterWhere.push(`spr.space_id = ?`)
      reporterParams.push(selectedSpaceId)
    }
    if (from) {
      reporterWhere.push(`spr.created_at >= ?`)
      reporterParams.push(from)
    }
    if (to) {
      reporterWhere.push(`spr.created_at < DATE_ADD(?, INTERVAL 1 DAY)`)
      reporterParams.push(to)
    }
    const reporterWhereSql = reporterWhere.length ? `WHERE ${reporterWhere.join(' AND ')}` : ''
    const [reporterRows] = await db.query(
      `SELECT DISTINCT u.id, u.display_name, u.email
         FROM space_publication_reports spr
         JOIN users u ON u.id = spr.reporter_user_id
         JOIN spaces s ON s.id = spr.space_id
       ${reporterWhereSql}
        ORDER BY COALESCE(NULLIF(TRIM(u.display_name), ''), u.email), u.id
        LIMIT 1000`,
      reporterParams
    )
    const reporterById = new Map<number, { id: number; label: string }>()
    for (const row of (reporterRows as any[])) {
      const id = Number(row.id)
      if (!Number.isFinite(id) || id <= 0) continue
      const label = String(row.display_name || '').trim() || String(row.email || '').trim() || `User #${id}`
      reporterById.set(id, { id, label })
    }
    if (Number.isFinite(reporterUserId) && reporterUserId > 0 && !reporterById.has(reporterUserId)) {
      reporterById.set(reporterUserId, { id: reporterUserId, label: `User #${reporterUserId}` })
    }
    const listHrefBase = `/admin/reports?status=${encodeURIComponent(status)}&space_type=${encodeURIComponent(spaceType)}&space_id=${encodeURIComponent(selectedSpaceId > 0 ? String(selectedSpaceId) : '')}&culture_id=${encodeURIComponent(selectedCultureId > 0 ? String(selectedCultureId) : '')}&category_id=${encodeURIComponent(selectedCategoryId > 0 ? String(selectedCategoryId) : '')}&rule_id=${encodeURIComponent(selectedRuleId > 0 ? String(selectedRuleId) : '')}&reporter_user_id=${encodeURIComponent(reporterUserId > 0 ? String(reporterUserId) : '')}&assigned_to_user_id=${encodeURIComponent(assignedToUserId > 0 ? String(assignedToUserId) : '')}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${encodeURIComponent(String(limit))}`

    const list = await reportsSvc.listReportsForAdmin(userId, {
      status: ['open', 'in_review', 'resolved', 'dismissed'].includes(status) ? (status as any) : null,
      scope: null,
      spaceType: spaceType || null,
      spaceId: Number.isFinite(selectedSpaceId) && selectedSpaceId > 0 ? selectedSpaceId : null,
      cultureId: Number.isFinite(selectedCultureId) && selectedCultureId > 0 && selectedCategoryId <= 0 && selectedRuleId <= 0 ? selectedCultureId : null,
      categoryId: Number.isFinite(selectedCategoryId) && selectedCategoryId > 0 && selectedRuleId <= 0 ? selectedCategoryId : null,
      ruleId: Number.isFinite(selectedRuleId) && selectedRuleId > 0 ? selectedRuleId : null,
      reporterUserId: Number.isFinite(reporterUserId) && reporterUserId > 0 ? reporterUserId : null,
      assignedToUserId: Number.isFinite(assignedToUserId) && assignedToUserId > 0 ? assignedToUserId : null,
      from: from || null,
      to: to || null,
      limit,
      cursorId: null,
    })

    const spaceCulturesBySpaceId = new Map<number, Array<{ id: number; name: string }>>()
    try {
      const spaceIds = Array.from(
        new Set(
          (list.items || [])
            .map((row: any) => Number(row?.space_id || 0))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
      if (spaceIds.length) {
        const placeholders = spaceIds.map(() => '?').join(',')
        const [spaceCultureRows] = await db.query(
          `SELECT sc.space_id, c.id AS culture_id, c.name
             FROM space_cultures sc
             JOIN cultures c ON c.id = sc.culture_id
            WHERE sc.space_id IN (${placeholders})
            ORDER BY c.name, c.id`,
          spaceIds
        )
        for (const row of (spaceCultureRows as any[])) {
          const sid = Number(row.space_id || 0)
          if (!Number.isFinite(sid) || sid <= 0) continue
          const cultureId = Number(row.culture_id || 0)
          if (!Number.isFinite(cultureId) || cultureId <= 0) continue
          const name = String(row.name || '').trim()
          if (!name) continue
          const arr = spaceCulturesBySpaceId.get(sid) || []
          if (!arr.some((it) => it.id === cultureId)) {
            arr.push({ id: cultureId, name })
            spaceCulturesBySpaceId.set(sid, arr)
          }
        }
      }
    } catch {}

    const formatReportSeconds = (value: any): string | null => {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) return null
      const total = Math.floor(n)
      const mm = Math.floor(total / 60)
      const ss = total % 60
      return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    }
    const formatReportedRange = (startRaw: any, endRaw: any): string => {
      const start = formatReportSeconds(startRaw)
      const end = formatReportSeconds(endRaw)
      if (start && end) return `${start} → ${end}`
      if (start) return `${start} →`
      if (end) return `→ ${end}`
      return '-'
    }
    const buildReportPreviewHref = (row: any): string => {
      const spaceType = String(row?.space_type || '').trim().toLowerCase()
      const spaceSlug = String(row?.space_slug || '').trim()
      const isGlobalChannel = spaceType === 'channel' && (spaceSlug === 'global' || spaceSlug === 'global-feed')
      let basePath = '/'
      if (spaceType === 'group' && spaceSlug) basePath = `/groups/${encodeURIComponent(spaceSlug)}`
      else if (spaceType === 'channel' && spaceSlug && !isGlobalChannel) basePath = `/channels/${encodeURIComponent(spaceSlug)}`
      const params = new URLSearchParams()
      const pin = String(row?.production_ulid || '').trim()
      if (pin) params.set('pin', pin)
      const publicationId = Number(row?.space_publication_id || 0)
      if (Number.isFinite(publicationId) && publicationId > 0) params.set('publication_id', String(Math.floor(publicationId)))
      const startSecondsRaw = Number(row?.reported_start_seconds)
      if (Number.isFinite(startSecondsRaw) && startSecondsRaw >= 0) params.set('t', String(Math.floor(startSecondsRaw)))
      const endSecondsRaw = Number(row?.reported_end_seconds)
      if (Number.isFinite(endSecondsRaw) && endSecondsRaw >= 0) params.set('t_end', String(Math.floor(endSecondsRaw)))
      const qs = params.toString()
      return qs ? `${basePath}?${qs}` : basePath
    }

    let selected: { report: any; actions: any[] } | null = null
    if (Number.isFinite(reportId) && reportId > 0) {
      try {
        selected = await reportsSvc.getReportDetailForAdmin(userId, reportId)
      } catch {}
    }

    let body = `<h1>Reports</h1>`
    body += `<div class="toolbar"><div><span class="pill">Inbox</span></div><div></div></div>`
    if (notice) body += `<div class="section" style="margin:10px 0; border-color:rgba(98,198,140,0.45)"><div class="field-hint">${escapeHtml(notice)}</div></div>`
    if (errorText) body += `<div class="section" style="margin:10px 0; border-color:rgba(220,92,92,0.5)"><div class="field-hint">${escapeHtml(errorText)}</div></div>`
    body += `<form method="get" action="/admin/reports" class="section" style="margin:12px 0">`
    body += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:10px; align-items:end">`
    body += `<label>Status<select name="status" onchange="this.form.submit()"><option value=""${!status ? ' selected' : ''}>All</option><option value="open"${status === 'open' ? ' selected' : ''}>Open</option><option value="in_review"${status === 'in_review' ? ' selected' : ''}>In Review</option><option value="resolved"${status === 'resolved' ? ' selected' : ''}>Resolved</option><option value="dismissed"${status === 'dismissed' ? ' selected' : ''}>Dismissed</option></select></label>`
    body += `<label>Space Type<select name="space_type" onchange="this.form.submit()"><option value=""${!spaceType ? ' selected' : ''}>All</option><option value="group"${spaceType === 'group' ? ' selected' : ''}>Groups</option><option value="channel"${spaceType === 'channel' ? ' selected' : ''}>Channels</option><option value="personal"${spaceType === 'personal' ? ' selected' : ''}>Personal</option></select></label>`
    const spaceSelectLabel =
      spaceType === 'group'
        ? 'Select Group'
        : spaceType === 'channel'
          ? 'Select Channel'
          : spaceType === 'personal'
            ? 'Select Personal'
            : 'Select Space'
    let spaceSelectOptions = `<option value=""${selectedSpaceId <= 0 ? ' selected' : ''}>${escapeHtml(spaceType ? `All ${spaceType === 'group' ? 'Groups' : spaceType === 'channel' ? 'Channels' : 'Personal'}` : 'Choose Space Type')}</option>`
    for (const sp of selectedSpaceList) {
      const selectedAttr = selectedSpaceId === sp.id ? ' selected' : ''
      const label = `${sp.name}${sp.slug ? ` (${sp.slug})` : ''} (#${sp.id})`
      spaceSelectOptions += `<option value="${sp.id}"${selectedAttr}>${escapeHtml(label)}</option>`
    }
    body += `<label>${escapeHtml(spaceSelectLabel)}<select name="space_id"${spaceType ? ' onchange="this.form.submit()"' : ' disabled'}>${spaceSelectOptions}</select></label>`
    let cultureSelectOptions = `<option value=""${selectedCultureId <= 0 ? ' selected' : ''}>All Cultures</option>`
    for (const c of availableCultures) {
      const selectedAttr = selectedCultureId === c.id ? ' selected' : ''
      cultureSelectOptions += `<option value="${c.id}"${selectedAttr}>${escapeHtml(c.name)}</option>`
    }
    body += `<label>Culture<select name="culture_id" onchange="this.form.submit()">${cultureSelectOptions}</select></label>`
    let categorySelectOptions = `<option value=""${selectedCategoryId <= 0 ? ' selected' : ''}>All Categories</option>`
    for (const c of availableCategories) {
      const selectedAttr = selectedCategoryId === c.id ? ' selected' : ''
      categorySelectOptions += `<option value="${c.id}"${selectedAttr}>${escapeHtml(c.name)}</option>`
    }
    body += `<label>Category<select name="category_id" onchange="this.form.submit()">${categorySelectOptions}</select></label>`
    let ruleSelectOptions = `<option value=""${selectedRuleId <= 0 ? ' selected' : ''}>All Rules</option>`
    for (const r of availableRules) {
      const selectedAttr = selectedRuleId === r.id ? ' selected' : ''
      const ruleLabel = `${r.title}${r.slug ? ` (${r.slug})` : ''}`
      ruleSelectOptions += `<option value="${r.id}"${selectedAttr}>${escapeHtml(ruleLabel)}</option>`
    }
    body += `<label>Rule<select name="rule_id" onchange="this.form.submit()">${ruleSelectOptions}</select></label>`
    const reporterFilterOptions = (() => {
      const rows = Array.from(reporterById.values()).sort((a, b) => a.label.localeCompare(b.label))
      let html = `<option value=""${reporterUserId > 0 ? '' : ' selected'}>All</option>`
      for (const item of rows) {
        const selected = reporterUserId === item.id ? ' selected' : ''
        html += `<option value="${item.id}"${selected}>${escapeHtml(item.label)}</option>`
      }
      return html
    })()
    body += `<label>Reporter<select name="reporter_user_id" onchange="this.form.submit()">${reporterFilterOptions}</select></label>`
    const assigneeFilterOptions = (() => {
      const rows = Array.from(assigneeById.values()).sort((a, b) => a.label.localeCompare(b.label))
      let html = `<option value=""${assignedToUserId > 0 ? '' : ' selected'}>All</option>`
      for (const item of rows) {
        const selected = assignedToUserId === item.id ? ' selected' : ''
        html += `<option value="${item.id}"${selected}>${escapeHtml(item.label)}</option>`
      }
      return html
    })()
    body += `<label>Assignee<select name="assigned_to_user_id" onchange="this.form.submit()">${assigneeFilterOptions}</select></label>`
    body += `<label>From<input type="date" name="from" value="${escapeHtml(from)}" onchange="this.form.submit()" /></label>`
    body += `<label>To<input type="date" name="to" value="${escapeHtml(to)}" onchange="this.form.submit()" /></label>`
    body += `<label>Limit<input type="number" name="limit" min="1" max="200" value="${escapeHtml(String(limit))}" /></label>`
    body += `<div style="display:flex; gap:8px"><button class="btn" type="submit">Filter</button><a class="btn" href="/admin/reports">Reset</a></div>`
    body += `</div></form>`

    body += `<div class="section"><div class="section-title">Report Rows</div>`
    if (!list.items.length) {
      body += `<div class="section" style="margin:0"><div class="field-hint">No reports found for current filters.</div></div>`
    } else {
      body += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:10px">`
      for (const row of list.items) {
        const baseHref = `${listHrefBase}&report_id=${encodeURIComponent(String(row.id))}`
        const inspectHref = `${baseHref}&view=inspect`
        const timelineHref = `${baseHref}&view=timeline`
        const previewModalHref = `${baseHref}&view=preview`
        const reasonText = row.user_facing_rule_label_at_submit
          ? `${String(row.user_facing_group_label_at_submit || 'Reason')} / ${String(row.user_facing_rule_label_at_submit)}`
          : '-'
        const reportedRangeText = formatReportedRange(row.reported_start_seconds, row.reported_end_seconds)
        const previewHref = buildReportPreviewHref(row)
        const spaceText = `${String(row.space_name || row.space_slug || '-')}${row.space_id ? ` (#${row.space_id})` : ''}`
        const spaceCultures = spaceCulturesBySpaceId.get(Number(row.space_id || 0)) || []
        const spaceCultureHtml = spaceCultures.length
          ? spaceCultures
              .map((c) => `<a href="/admin/cultures/${encodeURIComponent(String(c.id))}">${escapeHtml(c.name)}</a>`)
              .join(' • ')
          : 'None'
        const reporterText = `${String(row.reporter_display_name || row.reporter_email || '-')}${row.reporter_user_id ? ` (#${row.reporter_user_id})` : ''}`
        const assigneeText = row.assigned_to_user_id
          ? `${String(row.assigned_to_display_name || row.assigned_to_email || '-')}${` (#${row.assigned_to_user_id})`}`
          : '-'
        const isSelected = Number(row.id) === reportId
        body += `<div class="section" style="margin:0;${isSelected ? ' border-color:rgba(138,180,248,0.65); box-shadow:0 0 0 1px rgba(138,180,248,0.25) inset;' : ''}">`
        body += `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px">`
        body += `<div class="section-title" style="margin:0">Report #${Number(row.id)}</div>`
        body += `<span class="pill">${escapeHtml(String(row.rule_scope_at_submit || 'unknown'))}</span>`
        body += `</div>`
        body += `<div style="display:grid; grid-template-columns: 1fr; gap:6px">`
        body += `<div><div class="field-hint">Space</div><div>${escapeHtml(spaceText)}</div></div>`
        body += `<div><div class="field-hint">Cultures</div><div>${spaceCultureHtml}</div></div>`
        body += `<div><div class="field-hint">Created</div><div>${escapeHtml(String(row.created_at || ''))}</div></div>`
        body += `<div><div class="field-hint">Reason</div><div>${escapeHtml(reasonText)}</div></div>`
        body += `<div><div class="field-hint">Rule</div><div>${escapeHtml(`${String(row.rule_title || '-')}${row.rule_id ? ` (#${row.rule_id})` : ''}`)}</div></div>`
        body += `<div><div class="field-hint">Reported Range</div><div>${escapeHtml(reportedRangeText)}</div></div>`
        body += `<div><div class="field-hint">Assignee</div><div>${escapeHtml(assigneeText)}</div></div>`
        body += `<div><div class="field-hint">Reporter</div><div>${escapeHtml(reporterText)}</div></div>`
        body += `<div><div class="field-hint">Status</div><div>${escapeHtml(String(row.status || 'open'))}</div></div>`
        body += `</div>`
        body += `<div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">`
        body += `<a class="btn" href="${previewModalHref}">Preview</a>`
        body += `<a class="btn" href="${inspectHref}">Inspect</a>`
        body += `<a class="btn" href="${timelineHref}">Action Timeline</a>`
        body += `</div>`
        body += `</div>`
      }
      body += `</div>`
    }
    body += `</div>`

    const modalView = view === 'timeline' ? 'timeline' : view === 'inspect' ? 'inspect' : view === 'preview' ? 'preview' : ''
    if (selected?.report && modalView) {
      const rpt = selected.report
      const previewHref = buildReportPreviewHref(rpt)
      const previewModalHref = `${listHrefBase}&report_id=${encodeURIComponent(String(rpt.id))}&view=preview`
      const closeHref = listHrefBase
      const returnTo = `${listHrefBase}&report_id=${encodeURIComponent(String(rpt.id))}&view=inspect`
      const resolutionLabel = getResolutionCodeLabel(String(rpt.resolution_code || '').trim() || null)
      const resolutionDisplay = rpt.resolution_code
        ? `${resolutionLabel || String(rpt.resolution_code)} (${String(rpt.resolution_code)})`
        : '-'

      body += `<style>
        .reports-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.62); z-index: 999; }
        .reports-modal-shell { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 14px; overflow: auto; }
        .reports-modal { width: min(980px, 100%); margin: 10px 0 18px; border: 1px solid rgba(255,255,255,0.18); border-radius: 12px; background: #0b0f16; box-shadow: 0 16px 44px rgba(0,0,0,0.55); }
        .reports-modal-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.12); position: sticky; top: 0; background: #0b0f16; z-index: 2; }
        .reports-modal-body { padding: 12px 14px 14px; }
      </style>`
      body += `<div class="reports-modal-backdrop"></div>`
      body += `<div class="reports-modal-shell" role="dialog" aria-modal="true" aria-label="${modalView === 'inspect' ? 'Selected Report' : modalView === 'timeline' ? 'Action Timeline' : 'Preview'}">`
      body += `<div class="reports-modal">`
      body += `<div class="reports-modal-head">`
      body += `<div class="section-title" style="margin:0">${modalView === 'inspect' ? `Selected Report #${Number(rpt.id)}` : modalView === 'timeline' ? `Action Timeline #${Number(rpt.id)}` : `Preview #${Number(rpt.id)}`}</div>`
      body += `<div style="display:flex; align-items:center; gap:8px">`
      if (modalView !== 'preview') body += `<a class="btn" href="${previewModalHref}">Preview</a>`
      if (modalView === 'preview') body += `<a class="btn" href="${escapeHtml(previewHref)}" target="_blank" rel="noopener">Open New Tab</a>`
      body += `<a class="btn" href="${closeHref}">Close</a>`
      body += `</div>`
      body += `</div>`
      body += `<div class="reports-modal-body">`

      if (modalView === 'inspect') {
        const currentStatus = String(rpt.status || 'open')
        const currentAssigneeId = Number(rpt.assigned_to_user_id || 0) > 0 ? Number(rpt.assigned_to_user_id) : null
        if (currentAssigneeId != null && !assigneeById.has(currentAssigneeId)) {
          const fallbackLabel =
            String(rpt.assigned_to_display_name || '').trim() ||
            String(rpt.assigned_to_email || '').trim() ||
            `User #${currentAssigneeId}`
          assigneeById.set(currentAssigneeId, { id: currentAssigneeId, label: fallbackLabel })
        }
        const assigneeOptionsHtml = (() => {
          const rows = Array.from(assigneeById.values()).sort((a, b) => a.label.localeCompare(b.label))
          const selected = currentAssigneeId != null ? currentAssigneeId : (Number.isFinite(userId) && userId > 0 ? userId : null)
          let html = `<option value="">Auto (${escapeHtml(userDisplayName)})</option>`
          for (const item of rows) {
            const suffix = item.id === userId ? ' (You)' : ''
            html += `<option value="${item.id}"${selected === item.id ? ' selected' : ''}>${escapeHtml(item.label + suffix)}</option>`
          }
          return html
        })()
        const isAssignedToOtherModerator = Number.isFinite(userId) && currentAssigneeId != null && currentAssigneeId !== userId
        const selectedDecisionCode = ALL_RESOLUTION_CODES.some((it) => it.code === String(rpt.resolution_code || ''))
          ? String(rpt.resolution_code || '')
          : ''
        const decisionNoteValue = String(rpt.resolution_note || '')
        let decisionOptions = `<option value=""${!selectedDecisionCode ? ' selected' : ''}>No decision</option>`
        for (const opt of ALL_RESOLUTION_CODES) {
          decisionOptions += `<option value="${escapeHtml(opt.code)}"${selectedDecisionCode === opt.code ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
        }
        body += `<form method="post" action="/admin/reports/${Number(rpt.id)}/decision" class="section" style="margin-top:12px">`
        body += `<div class="section-title">Decision Workflow</div>`
        body += `<div class="field-hint" style="margin-bottom:8px">Report #${Number(rpt.id)}</div>`
        body += `<div class="field-hint" style="margin-bottom:8px">Preview: <a href="${previewModalHref}">Open</a></div>`
        body += `<div class="field-hint" style="margin-bottom:8px">Reported Range: ${escapeHtml(formatReportedRange(rpt.reported_start_seconds, rpt.reported_end_seconds))}</div>`
        if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}" />`
        if (isAssignedToOtherModerator) {
          body += `<div class="field-hint" style="margin-bottom:10px">Assigned to another moderator. To continue, assign this report to your user ID (#${escapeHtml(String(userId))}) and submit.</div>`
        }
        let statusOptionsHtml = ''
        if (currentStatus === 'open' || currentStatus === 'in_review') {
          statusOptionsHtml += `<option value="open"${currentStatus === 'open' ? ' selected' : ''}>open</option>`
          statusOptionsHtml += `<option value="in_review"${currentStatus === 'in_review' ? ' selected' : ''}>in_review</option>`
        } else {
          statusOptionsHtml += `<option value="" selected>no change (${escapeHtml(currentStatus)})</option>`
          statusOptionsHtml += `<option value="open">open</option>`
          statusOptionsHtml += `<option value="in_review">in_review</option>`
        }
        body += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px,1fr)); gap:10px">`
        body += `<label>Status<select name="status"${isAssignedToOtherModerator ? ' disabled' : ''}>${statusOptionsHtml}</select></label>`
        body += `<label>Assignee<select name="assigned_to_user_id">${assigneeOptionsHtml}</select></label>`
        body += `<label>Decision<select name="resolution_code"${isAssignedToOtherModerator ? ' disabled' : ''}>${decisionOptions}</select></label>`
        body += `<label style="grid-column:1 / -1">Decision Note<textarea name="decision_note" rows="4" maxlength="500"${isAssignedToOtherModerator ? ' disabled' : ''}>${escapeHtml(decisionNoteValue)}</textarea></label>`
        body += `</div>`
        body += `<div class="field-hint" style="margin-top:8px">Choose status for active review flow. Choose a decision code to finalize as resolved/dismissed.</div>`
        body += `<div style="display:flex; gap:8px; margin-top:10px"><button class="btn" type="submit">${isAssignedToOtherModerator ? 'Assign to Me' : 'Apply'}</button></div>`
        body += `</form>`
      }

      if (modalView === 'timeline') {
        body += `<div class="section" style="margin:0"><div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap:10px">`
        body += `<div><div class="field-hint">Status</div><div>${escapeHtml(String(rpt.status || '-'))}</div></div>`
        body += `<div><div class="field-hint">Resolution</div><div>${escapeHtml(resolutionDisplay)}</div></div>`
        body += `<div><div class="field-hint">Space</div><div>${escapeHtml(String(rpt.space_name || rpt.space_slug || '-'))} (#${Number(rpt.space_id || 0)})</div></div>`
        body += `<div><div class="field-hint">Rule</div><div>${escapeHtml(String(rpt.rule_title || '-'))} (#${Number(rpt.rule_id || 0)})</div></div>`
        body += `<div><div class="field-hint">Reported Range</div><div>${escapeHtml(formatReportedRange(rpt.reported_start_seconds, rpt.reported_end_seconds))}</div></div>`
        body += `<div><div class="field-hint">Preview</div><div><a href="${previewModalHref}">Open</a></div></div>`
        body += `</div></div>`
        body += `<div class="section" style="margin-top:12px"><div class="section-title">Action Timeline</div>`
        if (!selected.actions.length) {
          body += `<div class="field-hint">No actions yet.</div>`
        } else {
          body += `<div style="overflow:auto"><table><thead><tr><th>ID</th><th>Action</th><th>From</th><th>To</th><th>Actor</th><th>Note</th><th>Created</th></tr></thead><tbody>`
          for (const a of selected.actions) {
            const actor = `${String(a.actor_display_name || a.actor_email || '-')}${a.actor_user_id ? ` (#${Number(a.actor_user_id)})` : ''}`
            body += `<tr>`
            body += `<td>#${Number(a.id)}</td>`
            body += `<td>${escapeHtml(String(a.action_type || '-'))}</td>`
            body += `<td>${escapeHtml(String(a.from_status || '-'))}</td>`
            body += `<td>${escapeHtml(String(a.to_status || '-'))}</td>`
            body += `<td>${escapeHtml(actor)}</td>`
            body += `<td>${escapeHtml(String(a.note || '-'))}</td>`
            body += `<td>${escapeHtml(String(a.created_at || ''))}</td>`
            body += `</tr>`
          }
          body += `</tbody></table></div>`
        }
        body += `</div>`
      }

      if (modalView === 'preview') {
        body += `<div class="section" style="margin:0; padding:0; border:none; background:transparent">`
        body += `<iframe src="${escapeHtml(previewHref)}" title="Report Preview #${Number(rpt.id)}" style="width:100%; height:min(78vh, 900px); border:1px solid rgba(255,255,255,0.18); border-radius:10px; background:#000" allow="autoplay; fullscreen; encrypted-media" referrerpolicy="same-origin"></iframe>`
        body += `</div>`
      }

      body += `</div></div></div>`
    }

    const doc = renderAdminPage({ title: 'Reports', bodyHtml: body, active: 'reports' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin reports page failed', { path: req.path })
    const doc = renderAdminPage({ title: 'Reports', bodyHtml: `<h1>Reports</h1><div class="section"><div class="field-hint">${escapeHtml(String(err?.message || 'Failed to load reports'))}</div></div>`, active: 'reports' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.status(err?.status || 500).send(doc)
  }
})

pagesRouter.post('/admin/reports/:id/decision', requireGlobalModerationPage, async (req: any, res: any) => {
  const reportId = Number(req.params.id)
  if (!Number.isFinite(reportId) || reportId <= 0) return res.redirect('/admin/reports?error=bad_report_id')
  try {
    const actorUserId = Number(req.user.id)
    const fallbackReturnTo = `/admin/reports?report_id=${reportId}&view=inspect`
    const rawReturnTo = String(req.body?.return_to || '').trim()
    const returnTo = rawReturnTo.startsWith('/admin/reports') ? rawReturnTo : fallbackReturnTo
    const withMessage = (key: 'notice' | 'error', value: string) => {
      const sep = returnTo.includes('?') ? '&' : '?'
      return `${returnTo}${sep}${key}=${encodeURIComponent(value)}`
    }
    const selected = await reportsSvc.getReportDetailForAdmin(actorUserId, reportId)
    const report = selected.report
    if (!report) return res.redirect(withMessage('error', 'report_not_found'))

    const currentStatus = String(report.status || 'open')
    const currentAssignedTo = Number(report.assigned_to_user_id || 0) > 0 ? Number(report.assigned_to_user_id) : null

    const rawAssigned = String(req.body?.assigned_to_user_id || '').trim()
    const requestedAssignedTo = rawAssigned ? Number(rawAssigned) : null
    if (rawAssigned && (!Number.isFinite(requestedAssignedTo as number) || Number(requestedAssignedTo) <= 0)) {
      return res.redirect(withMessage('error', 'bad_assigned_to_user_id'))
    }

    const statusRaw = String(req.body?.status || '').trim()
    const requestedStatus = statusRaw ? statusRaw : null
    if (requestedStatus && !['open', 'in_review'].includes(requestedStatus)) {
      return res.redirect(withMessage('error', 'bad_status'))
    }

    const resolutionCode = String(req.body?.resolution_code || '').trim()
    const terminalStatus = getResolutionTerminalStatus(resolutionCode || null)
    if (resolutionCode && !terminalStatus) {
      return res.redirect(withMessage('error', 'invalid_resolution_code'))
    }

    const decisionNote = String(req.body?.decision_note || '').trim() || null

    if (currentAssignedTo != null && currentAssignedTo !== actorUserId) {
      if (requestedAssignedTo !== actorUserId) {
        return res.redirect(withMessage('error', 'report_assigned_to_other_user'))
      }
      await reportsSvc.assignReportForAdmin({
        reportId,
        actorUserId,
        assignedToUserId: actorUserId,
        note: decisionNote,
      })
      return res.redirect(withMessage('notice', 'Report assigned to you.'))
    }

    const effectiveAssignedTo = requestedAssignedTo == null ? actorUserId : requestedAssignedTo
    let changed = false

    if (effectiveAssignedTo !== currentAssignedTo) {
      await reportsSvc.assignReportForAdmin({
        reportId,
        actorUserId,
        assignedToUserId: effectiveAssignedTo,
        note: decisionNote,
      })
      changed = true
    }

    if (terminalStatus === 'resolved') {
      await reportsSvc.resolveReportForAdmin({
        reportId,
        actorUserId,
        resolutionCode,
        resolutionNote: decisionNote,
      })
      changed = true
    } else if (terminalStatus === 'dismissed') {
      await reportsSvc.dismissReportForAdmin({
        reportId,
        actorUserId,
        resolutionCode,
        resolutionNote: decisionNote,
      })
      changed = true
    } else {
      const nextStatus = requestedStatus || currentStatus
      if (nextStatus !== currentStatus) {
        await reportsSvc.setReportStatusForAdmin({
          reportId,
          actorUserId,
          status: nextStatus as any,
          note: decisionNote,
        })
        changed = true
      }
    }

    if (!changed) {
      return res.redirect(withMessage('notice', 'No changes submitted.'))
    }

    return res.redirect(withMessage('notice', 'Report updated.'))
  } catch (err: any) {
    const fallbackReturnTo = `/admin/reports?report_id=${reportId}&view=inspect`
    const rawReturnTo = String(req.body?.return_to || '').trim()
    const returnTo = rawReturnTo.startsWith('/admin/reports') ? rawReturnTo : fallbackReturnTo
    const sep = returnTo.includes('?') ? '&' : '?'
    return res.redirect(`${returnTo}${sep}error=${encodeURIComponent(String(err?.message || 'Failed to update report'))}`)
  }
})

function toDateTimeLocalValue(raw: any): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  const parts = value.replace('T', ' ').split(' ')
  const datePart = parts[0] || ''
  const timePart = parts[1] || ''
  const hhmm = timePart.slice(0, 5)
  if (!datePart || !hhmm) return ''
  return `${datePart}T${hhmm}`
}

function toDateOnlyValue(raw: any): string {
  const dt = toDateTimeLocalValue(raw)
  return dt ? dt.slice(0, 10) : ''
}

function toTimeOnlyValue(raw: any): string {
  const dt = toDateTimeLocalValue(raw)
  return dt ? dt.slice(11, 16) : ''
}

const MESSAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'register_login', label: 'Register / Login' },
  { value: 'fund_drive', label: 'Fund Drive' },
  { value: 'subscription_upgrade', label: 'Subscription Upgrade' },
  { value: 'sponsor_message', label: 'Sponsor Message' },
  { value: 'feature_announcement', label: 'Feature Announcement' },
]

const MESSAGE_SURFACE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'global_feed', label: 'Global Feed' },
]

const MESSAGE_DELIVERY_SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'both', label: 'Both (Standalone + Journey)' },
  { value: 'journey_only', label: 'Journey Only' },
  { value: 'standalone_only', label: 'Standalone Only' },
]

const MESSAGE_CTA_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

const MESSAGE_CTA_SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'space', label: 'Space' },
]

const MESSAGE_CTA_INTENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'support', label: 'Support Us' },
  { value: 'defer', label: 'Defer / Not Now' },
  { value: 'visit_link', label: 'Visit Link' },
  { value: 'visit_sponsor', label: 'Visit Sponsor' },
  { value: 'login', label: 'Login' },
  { value: 'register', label: 'Register' },
  { value: 'donate', label: 'Donate' },
  { value: 'subscribe', label: 'Subscribe' },
  { value: 'upgrade', label: 'Upgrade' },
  { value: 'verify_email', label: 'Verify Email' },
  { value: 'verify_phone', label: 'Verify Phone' },
]

const MESSAGE_CTA_EXECUTOR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'internal_link', label: 'Internal Link' },
  { value: 'api_action', label: 'API Action' },
  { value: 'advance_slide', label: 'Advance Slide (No Navigation)' },
]

const MESSAGE_CTA_COMPLETION_CONTRACT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'on_click', label: 'On Click' },
  { value: 'on_return', label: 'On Return' },
  { value: 'on_verified', label: 'On Verified' },
  { value: 'none', label: 'None (never complete)' },
]

const MESSAGE_RULESET_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

const MESSAGE_JOURNEY_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
]

const MESSAGE_JOURNEY_STEP_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

const MESSAGE_JOURNEY_STEP_PROGRESSION_POLICY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'on_any_completion', label: 'Any CTA Completion' },
  { value: 'on_any_click', label: 'Any CTA Click' },
  { value: 'on_cta_slot_completion', label: 'Specific CTA Slot Completion' },
  { value: 'on_intent_completion', label: 'Specific Intent Completion' },
]

const PAYMENT_PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'paypal', label: 'PayPal' },
]

const PAYMENT_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'sandbox', label: 'Sandbox' },
  { value: 'live', label: 'Live' },
]

const PAYMENT_PROVIDER_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'enabled', label: 'Enabled' },
]

const PAYMENT_CATALOG_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'donate_campaign', label: 'Donate Campaign' },
  { value: 'subscribe_plan', label: 'Subscribe Plan' },
]

const PAYMENT_CATALOG_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

function parseBoolLoose(raw: any, fallback = false): boolean {
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  const v = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return fallback
}

function parseNumLoose(raw: any, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function parseColorLoose(raw: any, fallback: string): string {
  const value = String(raw || '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return fallback
  return value.toUpperCase()
}

function parseJsonObjectLoose(raw: any): Record<string, any> {
  if (raw == null || raw === '') return {}
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, any>
  } catch {}
  return {}
}

function maskToken(value: string): string {
  const v = String(value || '')
  if (!v) return 'not set'
  if (v.length <= 8) return '***'
  return `${v.slice(0, 4)}…${v.slice(-4)}`
}

function hexToRgba(hex: string, opacity: number): string {
  const color = parseColorLoose(hex, '#000000').replace('#', '')
  const r = Number.parseInt(color.slice(0, 2), 16)
  const g = Number.parseInt(color.slice(2, 4), 16)
  const b = Number.parseInt(color.slice(4, 6), 16)
  const a = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function extractMessageCreativeForm(values: any): {
  backgroundMode: 'none' | 'image' | 'video'
  backgroundVideoPlayback: 'muted_autoplay' | 'tap_to_play_sound'
  backgroundUploadId: string
  backgroundOverlayColor: string
  backgroundOverlayOpacity: number
  messageEnabled: boolean
  messagePosition: 'top' | 'middle' | 'bottom'
  messageOffsetPct: number
  messageLabel: string
  messageBgColor: string
  messageBgOpacity: number
  messageTextColor: string
  ctaEnabled: boolean
  ctaType: 'auth' | 'donate' | 'subscribe' | 'upgrade'
  ctaLayout: 'inline' | 'stacked'
  ctaPosition: 'top' | 'middle' | 'bottom'
  ctaOffsetPct: number
  ctaBgColor: string
  ctaBgOpacity: number
  ctaTextColor: string
  ctaPrimaryLabel: string
  ctaSecondaryLabel: string
  ctaAuthPrimaryHref: string
  ctaAuthSecondaryHref: string
  ctaDonateProvider: 'mock' | 'paypal'
  ctaDonateCampaignKey: string
  ctaDonateSuccessReturn: string
  ctaSubscribeProvider: 'mock' | 'paypal'
  ctaSubscribePlanKey: string
  ctaSubscribeSuccessReturn: string
  ctaUpgradeTargetTier: string
  ctaUpgradeSuccessReturn: string
} {
  const creative = values?.creative && typeof values.creative === 'object'
    ? values.creative
    : (() => {
      const raw = values?.creative_json
      if (!raw) return null
      try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
    })()

  const defaultMessageLabel = 'Join the Community'
  const defaultUploadId = values?.mediaUploadId ?? values?.media_upload_id ?? ''

  const base = {
    backgroundMode: String(creative?.background?.mode || (defaultUploadId ? 'image' : 'none')).toLowerCase() as 'none' | 'image' | 'video',
    backgroundVideoPlayback:
      String(creative?.background?.videoPlaybackMode || 'muted_autoplay').toLowerCase() === 'tap_to_play_sound'
        ? 'tap_to_play_sound'
        : 'muted_autoplay',
    backgroundUploadId: String(creative?.background?.uploadId ?? defaultUploadId ?? ''),
    backgroundOverlayColor: String(creative?.background?.overlayColor || '#000000'),
    backgroundOverlayOpacity: parseNumLoose(creative?.background?.overlayOpacity, 0.35),
    messageEnabled: parseBoolLoose(creative?.widgets?.message?.enabled, true),
    messagePosition: String(creative?.widgets?.message?.position || 'middle').toLowerCase() as 'top' | 'middle' | 'bottom',
    messageOffsetPct: parseNumLoose(creative?.widgets?.message?.yOffsetPct, 0),
    messageLabel: String(creative?.widgets?.message?.label || defaultMessageLabel),
    messageBgColor: String(creative?.widgets?.message?.bgColor || '#0B1320'),
    messageBgOpacity: parseNumLoose(creative?.widgets?.message?.bgOpacity, 0.55),
    messageTextColor: String(creative?.widgets?.message?.textColor || '#FFFFFF'),
    ctaEnabled: parseBoolLoose(creative?.widgets?.cta?.enabled, parseBoolLoose(creative?.widgets?.auth?.enabled, true)),
    ctaType: String(creative?.widgets?.cta?.type || 'auth').toLowerCase() as 'auth' | 'donate' | 'subscribe' | 'upgrade',
    ctaLayout: String(creative?.widgets?.cta?.layout || 'inline').toLowerCase() as 'inline' | 'stacked',
    ctaPosition: String(creative?.widgets?.cta?.position || creative?.widgets?.auth?.position || 'bottom').toLowerCase() as 'top' | 'middle' | 'bottom',
    ctaOffsetPct: parseNumLoose(creative?.widgets?.cta?.yOffsetPct ?? creative?.widgets?.auth?.yOffsetPct, 0),
    ctaBgColor: String(creative?.widgets?.cta?.bgColor || creative?.widgets?.auth?.bgColor || '#0B1320'),
    ctaBgOpacity: parseNumLoose(creative?.widgets?.cta?.bgOpacity ?? creative?.widgets?.auth?.bgOpacity, 0.55),
    ctaTextColor: String(creative?.widgets?.cta?.textColor || creative?.widgets?.auth?.textColor || '#FFFFFF'),
    ctaPrimaryLabel: String(
      creative?.widgets?.cta?.primaryLabel
      || creative?.widgets?.message?.primaryLabel
      || values?.ctaPrimaryLabel
      || values?.cta_primary_label
      || 'Register'
    ),
    ctaSecondaryLabel: String(
      creative?.widgets?.cta?.secondaryLabel
      || creative?.widgets?.message?.secondaryLabel
      || values?.ctaSecondaryLabel
      || values?.cta_secondary_label
      || ''
    ),
    ctaAuthPrimaryHref: String(
      creative?.widgets?.cta?.config?.auth?.primaryHref
      || creative?.widgets?.message?.primaryHref
      || values?.ctaPrimaryHref
      || values?.cta_primary_href
      || '/register?return=/'
    ),
    ctaAuthSecondaryHref: String(
      creative?.widgets?.cta?.config?.auth?.secondaryHref
      || creative?.widgets?.message?.secondaryHref
      || values?.ctaSecondaryHref
      || values?.cta_secondary_href
      || '/login?return=/'
    ),
    ctaDonateProvider: String(creative?.widgets?.cta?.config?.donate?.provider || 'mock').toLowerCase() as 'mock' | 'paypal',
    ctaDonateCampaignKey: String(creative?.widgets?.cta?.config?.donate?.campaignKey || ''),
    ctaDonateSuccessReturn: String(creative?.widgets?.cta?.config?.donate?.successReturn || '/channels/global-feed'),
    ctaSubscribeProvider: String(creative?.widgets?.cta?.config?.subscribe?.provider || 'mock').toLowerCase() as 'mock' | 'paypal',
    ctaSubscribePlanKey: String(creative?.widgets?.cta?.config?.subscribe?.planKey || ''),
    ctaSubscribeSuccessReturn: String(creative?.widgets?.cta?.config?.subscribe?.successReturn || '/channels/global-feed'),
    ctaUpgradeTargetTier: String(creative?.widgets?.cta?.config?.upgrade?.targetTier || ''),
    ctaUpgradeSuccessReturn: String(creative?.widgets?.cta?.config?.upgrade?.successReturn || '/channels/global-feed'),
  }

  const hasMessageEnabledInput = Object.prototype.hasOwnProperty.call(values || {}, 'creativeMessageEnabled')
  const hasCtaEnabledInput = Object.prototype.hasOwnProperty.call(values || {}, 'creativeCtaEnabled')

  return {
    backgroundMode: (String(values?.creativeBgMode || base.backgroundMode).toLowerCase() === 'video'
      ? 'video'
      : (String(values?.creativeBgMode || base.backgroundMode).toLowerCase() === 'image' ? 'image' : 'none')),
    backgroundVideoPlayback: (String(values?.creativeBgVideoPlayback || base.backgroundVideoPlayback).toLowerCase() === 'tap_to_play_sound'
      ? 'tap_to_play_sound'
      : 'muted_autoplay'),
    backgroundUploadId: String(values?.creativeBgUploadId ?? base.backgroundUploadId ?? ''),
    backgroundOverlayColor: parseColorLoose(values?.creativeBgOverlayColor ?? base.backgroundOverlayColor, '#000000'),
    backgroundOverlayOpacity: Math.min(1, Math.max(0, parseNumLoose(values?.creativeBgOverlayOpacity ?? base.backgroundOverlayOpacity, 0.35))),
    messageEnabled: hasMessageEnabledInput ? parseBoolLoose(values?.creativeMessageEnabled, false) : base.messageEnabled,
    messagePosition: (String(values?.creativeMessagePosition || base.messagePosition).toLowerCase() === 'top'
      ? 'top'
      : (String(values?.creativeMessagePosition || base.messagePosition).toLowerCase() === 'bottom' ? 'bottom' : 'middle')),
    messageOffsetPct: Math.round(Math.min(80, Math.max(0, parseNumLoose(values?.creativeMessageOffsetPct ?? base.messageOffsetPct, 0)))),
    messageLabel: String(values?.creativeMessageLabel ?? base.messageLabel ?? defaultMessageLabel),
    messageBgColor: parseColorLoose(values?.creativeMessageBgColor ?? base.messageBgColor, '#0B1320'),
    messageBgOpacity: Math.min(1, Math.max(0, parseNumLoose(values?.creativeMessageBgOpacity ?? base.messageBgOpacity, 0.55))),
    messageTextColor: parseColorLoose(values?.creativeMessageTextColor ?? base.messageTextColor, '#FFFFFF'),
    ctaEnabled: hasCtaEnabledInput ? parseBoolLoose(values?.creativeCtaEnabled, false) : base.ctaEnabled,
    ctaType: (['auth', 'donate', 'subscribe', 'upgrade'].includes(String(values?.creativeCtaType || base.ctaType).toLowerCase())
      ? String(values?.creativeCtaType || base.ctaType).toLowerCase()
      : 'auth') as 'auth' | 'donate' | 'subscribe' | 'upgrade',
    ctaLayout: (String(values?.creativeCtaLayout || base.ctaLayout).toLowerCase() === 'stacked' ? 'stacked' : 'inline'),
    ctaPosition: (String(values?.creativeCtaPosition || base.ctaPosition).toLowerCase() === 'top'
      ? 'top'
      : (String(values?.creativeCtaPosition || base.ctaPosition).toLowerCase() === 'bottom' ? 'bottom' : 'middle')),
    ctaOffsetPct: Math.round(Math.min(80, Math.max(0, parseNumLoose(values?.creativeCtaOffsetPct ?? base.ctaOffsetPct, 0)))),
    ctaBgColor: parseColorLoose(values?.creativeCtaBgColor ?? base.ctaBgColor, '#0B1320'),
    ctaBgOpacity: Math.min(1, Math.max(0, parseNumLoose(values?.creativeCtaBgOpacity ?? base.ctaBgOpacity, 0.55))),
    ctaTextColor: parseColorLoose(values?.creativeCtaTextColor ?? base.ctaTextColor, '#FFFFFF'),
    ctaPrimaryLabel: String(values?.creativeCtaPrimaryLabel ?? values?.ctaPrimaryLabel ?? base.ctaPrimaryLabel ?? 'Register').trim() || 'Register',
    ctaSecondaryLabel: String(values?.creativeCtaSecondaryLabel ?? values?.ctaSecondaryLabel ?? base.ctaSecondaryLabel ?? '').trim(),
    ctaAuthPrimaryHref: String(values?.creativeCtaAuthPrimaryHref ?? values?.ctaPrimaryHref ?? base.ctaAuthPrimaryHref ?? '/register?return=/').trim() || '/register?return=/',
    ctaAuthSecondaryHref: String(values?.creativeCtaAuthSecondaryHref ?? values?.ctaSecondaryHref ?? base.ctaAuthSecondaryHref ?? '/login?return=/').trim(),
    ctaDonateProvider: (String(values?.creativeCtaDonateProvider ?? base.ctaDonateProvider).toLowerCase() === 'paypal' ? 'paypal' : 'mock'),
    ctaDonateCampaignKey: String(values?.creativeCtaDonateCampaignKey ?? base.ctaDonateCampaignKey ?? '').trim(),
    ctaDonateSuccessReturn: String(values?.creativeCtaDonateSuccessReturn ?? base.ctaDonateSuccessReturn ?? '/channels/global-feed').trim() || '/channels/global-feed',
    ctaSubscribeProvider: (String(values?.creativeCtaSubscribeProvider ?? base.ctaSubscribeProvider).toLowerCase() === 'paypal' ? 'paypal' : 'mock'),
    ctaSubscribePlanKey: String(values?.creativeCtaSubscribePlanKey ?? base.ctaSubscribePlanKey ?? '').trim(),
    ctaSubscribeSuccessReturn: String(values?.creativeCtaSubscribeSuccessReturn ?? base.ctaSubscribeSuccessReturn ?? '/channels/global-feed').trim() || '/channels/global-feed',
    ctaUpgradeTargetTier: String(values?.creativeCtaUpgradeTargetTier ?? base.ctaUpgradeTargetTier ?? '').trim(),
    ctaUpgradeSuccessReturn: String(values?.creativeCtaUpgradeSuccessReturn ?? base.ctaUpgradeSuccessReturn ?? '/channels/global-feed').trim() || '/channels/global-feed',
  }
}

function buildMessageCreateOrUpdatePayload(body: any): any {
  const creativeForm = extractMessageCreativeForm(body || {})
  const messageEnabled = creativeForm.messageEnabled
  const ctaEnabled = creativeForm.ctaEnabled
  const primaryLabel = String(creativeForm.ctaPrimaryLabel || 'Register')
  const primaryHref = String(creativeForm.ctaAuthPrimaryHref || '/register?return=/')
  const secondaryLabelRaw = String(creativeForm.ctaSecondaryLabel || '').trim()
  const secondaryHrefRaw = String(creativeForm.ctaAuthSecondaryHref || '').trim()
  const secondaryLabel = secondaryLabelRaw || null
  const secondaryHref = secondaryHrefRaw || null
  const mediaUploadId = String(creativeForm.backgroundUploadId || '').trim()
  const messageType = String(body?.type ?? body?.messageType ?? 'register_login').trim().toLowerCase() || 'register_login'
  const appliesToSurfaceRaw = String(body?.appliesToSurface ?? body?.applies_to_surface ?? 'global_feed').trim().toLowerCase() || 'global_feed'
  const surfaceTargetingParsed = parseSurfaceTargetingFromBody(body, appliesToSurfaceRaw)
  const appliesToSurfaceFromTargeting = surfaceTargetingParsed.find((item) => item.surface === 'global_feed')
    ? 'global_feed'
    : (surfaceTargetingParsed[0]?.surface || appliesToSurfaceRaw)
  const tieBreakStrategy = String(body?.tieBreakStrategy ?? body?.tie_break_strategy ?? 'round_robin').trim().toLowerCase() || 'round_robin'
  const deliveryScope = String(body?.deliveryScope ?? body?.delivery_scope ?? 'both').trim().toLowerCase() || 'both'
  const campaignKey = String(body?.campaignKey ?? body?.campaign_key ?? '').trim().toLowerCase()
  const campaignCategory = String(body?.campaignCategory ?? body?.campaign_category ?? '').trim().toLowerCase()
  const eligibilityRulesetIdRaw = String(body?.eligibilityRulesetId ?? body?.eligibility_ruleset_id ?? '').trim()
  const eligibilityRulesetIdParsed = /^\d+$/.test(eligibilityRulesetIdRaw) ? Number(eligibilityRulesetIdRaw) : null
  const eligibilityRulesetId = deliveryScope === 'journey_only' ? null : eligibilityRulesetIdParsed
  const appliesToSurface = deliveryScope === 'journey_only' ? 'global_feed' : appliesToSurfaceFromTargeting
  const surfaceTargeting = deliveryScope === 'journey_only'
    ? [{ surface: 'global_feed' as const, targetingMode: 'all' as const, targetIds: [] }]
    : surfaceTargetingParsed
  const startsAtDate = String(body?.startsAtDate || '').trim()
  const startsAtTime = String(body?.startsAtTime || '').trim()
  const endsAtDate = String(body?.endsAtDate || '').trim()
  const endsAtTime = String(body?.endsAtTime || '').trim()
  const normalizedStartsAt = startsAtDate ? `${startsAtDate}T${startsAtTime || '00:00'}` : ''
  const normalizedEndsAt = endsAtDate ? `${endsAtDate}T${endsAtTime || '23:59'}` : ''
  const ctaSlotCountRaw = Number(body?.creativeCtaSlotCount)
  const ctaSlotCount = Number.isFinite(ctaSlotCountRaw) ? Math.max(1, Math.min(3, Math.round(ctaSlotCountRaw))) : null
  const ctaSlots: Array<{ slot: 1 | 2 | 3; ctaDefinitionId: number; labelOverride?: string | null; styleOverride?: { bgColor?: string; bgOpacity?: number; textColor?: string } | null }> = []
  for (const slot of [1, 2, 3] as const) {
    if (ctaSlotCount != null && slot > ctaSlotCount) continue
    const idRaw = String((body as any)?.[`creativeCtaSlot${slot}DefinitionId`] || '').trim()
    if (!/^\d+$/.test(idRaw)) continue
    const ctaDefinitionId = Number(idRaw)
    const labelOverrideRaw = String((body as any)?.[`creativeCtaSlot${slot}LabelOverride`] || '').trim()
    const bgColorRaw = String((body as any)?.[`creativeCtaSlot${slot}BgColor`] || '').trim()
    const bgOpacityRaw = Number((body as any)?.[`creativeCtaSlot${slot}BgOpacity`])
    const textColorRaw = String((body as any)?.[`creativeCtaSlot${slot}TextColor`] || '').trim()
    const styleOverride = {
      ...( /^#[0-9a-fA-F]{6}$/.test(bgColorRaw) ? { bgColor: bgColorRaw.toUpperCase() } : {}),
      ...( Number.isFinite(bgOpacityRaw) ? { bgOpacity: Math.max(0, Math.min(1, bgOpacityRaw)) } : {}),
      ...( /^#[0-9a-fA-F]{6}$/.test(textColorRaw) ? { textColor: textColorRaw.toUpperCase() } : {}),
    }
    ctaSlots.push({
      slot,
      ctaDefinitionId,
      ...(labelOverrideRaw ? { labelOverride: labelOverrideRaw } : {}),
      ...(Object.keys(styleOverride).length ? { styleOverride } : {}),
    })
  }

  return {
    ...(body || {}),
    type: messageType,
    appliesToSurface,
    tieBreakStrategy,
    surfaceTargeting,
    deliveryScope,
    campaignKey: campaignKey || null,
    campaignCategory: campaignCategory || null,
    eligibilityRulesetId,
    mediaUploadId: mediaUploadId || null,
    startsAt: normalizedStartsAt,
    endsAt: normalizedEndsAt,
    ctaPrimaryLabel: primaryLabel,
    ctaPrimaryHref: primaryHref,
    ctaSecondaryLabel: secondaryLabel,
    ctaSecondaryHref: secondaryHref,
    creative: {
      version: 1,
      background: {
        mode: creativeForm.backgroundMode,
        videoPlaybackMode: creativeForm.backgroundVideoPlayback,
        uploadId: mediaUploadId ? Number(mediaUploadId) : null,
        overlayColor: creativeForm.backgroundOverlayColor,
        overlayOpacity: creativeForm.backgroundOverlayOpacity,
      },
      widgets: {
        message: {
          enabled: messageEnabled,
          position: creativeForm.messagePosition,
          yOffsetPct: creativeForm.messageOffsetPct,
          bgColor: creativeForm.messageBgColor,
          bgOpacity: creativeForm.messageBgOpacity,
          textColor: creativeForm.messageTextColor,
          label: creativeForm.messageLabel,
          headline: String(body?.headline || ''),
          body: String(body?.body || '').trim() || null,
        },
        cta: {
          enabled: ctaEnabled,
          position: creativeForm.ctaPosition,
          yOffsetPct: creativeForm.ctaOffsetPct,
          bgColor: creativeForm.ctaBgColor,
          bgOpacity: creativeForm.ctaBgOpacity,
          textColor: creativeForm.ctaTextColor,
          layout: creativeForm.ctaLayout,
          ...(ctaSlotCount != null ? { count: ctaSlotCount } : {}),
          ...(ctaSlots.length ? { slots: ctaSlots } : {}),
          type: creativeForm.ctaType,
          primaryLabel,
          secondaryLabel,
          config: {
            auth: {
              primaryHref,
              secondaryHref,
            },
            donate: {
              provider: creativeForm.ctaDonateProvider,
              campaignKey: creativeForm.ctaDonateCampaignKey || null,
              successReturn: creativeForm.ctaDonateSuccessReturn,
            },
            subscribe: {
              provider: creativeForm.ctaSubscribeProvider,
              planKey: creativeForm.ctaSubscribePlanKey || null,
              successReturn: creativeForm.ctaSubscribeSuccessReturn,
            },
            upgrade: {
              targetTier: creativeForm.ctaUpgradeTargetTier || null,
              successReturn: creativeForm.ctaUpgradeSuccessReturn,
            },
          },
        },
        auth: {
          enabled: ctaEnabled,
          position: creativeForm.ctaPosition,
          yOffsetPct: creativeForm.ctaOffsetPct,
          bgColor: creativeForm.ctaBgColor,
          bgOpacity: creativeForm.ctaBgOpacity,
          textColor: creativeForm.ctaTextColor,
        },
      },
    },
  }
}

function renderAdminMessageForm(opts: {
  title: string
  action: string
  csrfToken?: string | null
  backHref: string
  values: any
  ctaDefinitionOptions?: Array<{
    id: number
    name: string
    labelDefault: string
    intentKey: string
    executorType: string
    status: string
  }>
  eligibilityRulesetOptions?: Array<{
    id: number
    name: string
    status: string
    criteria: Record<string, any>
  }>
  campaignCategoryOptions?: string[]
  journeyStepRefs?: Array<{
    journeyId: number
    journeyKey: string
    journeyStatus: string
    stepId: number
    stepKey: string
    stepOrder: number
  }>
  surfaceTargetOptions?: {
    groups: Array<{ id: number; name: string; slug: string }>
    channels: Array<{ id: number; name: string; slug: string }>
  }
  error?: string | null
  notice?: string | null
  showClone?: boolean
}): string {
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const values = opts.values || {}
  const ctaDefinitionOptions = Array.isArray(opts.ctaDefinitionOptions) ? opts.ctaDefinitionOptions : []
  const eligibilityRulesetOptions = Array.isArray(opts.eligibilityRulesetOptions) ? opts.eligibilityRulesetOptions : []
  const campaignCategoryOptions = Array.isArray(opts.campaignCategoryOptions) ? opts.campaignCategoryOptions : []
  const journeyStepRefs = Array.isArray(opts.journeyStepRefs) ? opts.journeyStepRefs : []
  const surfaceTargetOptions = opts.surfaceTargetOptions || { groups: [], channels: [] }
  const id = values.id ? Number(values.id) : null
  const draftKey = id ? `admin_message_editor_draft_${id}` : 'admin_message_editor_draft_new'
  const creativeForm = extractMessageCreativeForm(values)
  const creativeCtaSrc = values?.creative?.widgets?.cta && typeof values.creative.widgets.cta === 'object'
    ? values.creative.widgets.cta
    : {}
  const slotCount = Math.max(
    1,
    Math.min(
      3,
      Number(
        creativeCtaSrc.count ??
        creativeCtaSrc.slotCount ??
        (Array.isArray(creativeCtaSrc.slots) && creativeCtaSrc.slots.length > 0 ? creativeCtaSrc.slots.length : 2)
      ) || 2
    )
  )
  const slotsByIndex = new Map<number, any>()
  if (Array.isArray(creativeCtaSrc.slots)) {
    for (const slot of creativeCtaSrc.slots) {
      const slotIndex = Number((slot as any)?.slot || 0)
      if (slotIndex >= 1 && slotIndex <= 3 && !slotsByIndex.has(slotIndex)) slotsByIndex.set(slotIndex, slot)
    }
  }
  const ctaDefinitionById = new Map<number, { labelDefault: string }>()
  for (const item of ctaDefinitionOptions) {
    const defId = Number(item.id)
    if (!Number.isFinite(defId) || defId <= 0) continue
    ctaDefinitionById.set(defId, { labelDefault: String(item.labelDefault || '') })
  }
  const slotLabel = (slot: 1 | 2 | 3, fallback: string): string => {
    const slotValue = slotsByIndex.get(slot)
    if (slotValue && (slotValue.labelOverride || slotValue.label_override)) {
      return String(slotValue.labelOverride || slotValue.label_override)
    }
    const defId = Number(slotValue?.ctaDefinitionId || slotValue?.cta_definition_id || 0)
    const def = ctaDefinitionById.get(defId)
    if (def && def.labelDefault) return def.labelDefault
    return fallback
  }
  const creativeWarnings: string[] = []
  if (creativeForm.messageEnabled && creativeForm.ctaEnabled) {
    const samePos = creativeForm.messagePosition === creativeForm.ctaPosition
    const closeOffset = Math.abs(creativeForm.messageOffsetPct - creativeForm.ctaOffsetPct) < 10
    if (samePos && closeOffset) creativeWarnings.push('Message and CTA widgets are very close and may overlap.')
  }
  if (creativeForm.messageEnabled && creativeForm.messageBgOpacity < 0.2) {
    creativeWarnings.push('Message widget background opacity is very low; contrast may be poor on bright media.')
  }
  if (creativeForm.ctaEnabled && creativeForm.ctaBgOpacity < 0.2) {
    creativeWarnings.push('CTA widget background opacity is very low; contrast may be poor on bright media.')
  }
  const previewUploadIdRaw = String(creativeForm.backgroundUploadId || '').trim()
  const previewUploadId = /^\d+$/.test(previewUploadIdRaw) ? previewUploadIdRaw : ''
  const previewBaseStyle =
    previewUploadId && creativeForm.backgroundMode !== 'none'
      ? (creativeForm.backgroundMode === 'image'
        ? `background-image:url('/api/uploads/${encodeURIComponent(previewUploadId)}/image?mode=image&usage=message_bg&orientation=portrait&dpr=1'); background-size:cover; background-position:center; background-repeat:no-repeat; background-color:#0B1320;`
        : `background-image:url('/api/uploads/${encodeURIComponent(previewUploadId)}/thumb'); background-size:cover; background-position:center; background-repeat:no-repeat; background-color:#0B1320;`)
      : (creativeForm.backgroundMode === 'video'
        ? 'background:linear-gradient(135deg,#0a1930,#1e3a8a);'
        : (creativeForm.backgroundMode === 'image'
          ? 'background:linear-gradient(135deg,#1f2937,#4b5563);'
          : 'background:linear-gradient(130deg,#101828,#1f2937);'))

  let body = `<h1>${escapeHtml(opts.title)}</h1>`
  body += `<div class="toolbar"><div><a href="${escapeHtml(opts.backHref)}">← Back to messages</a></div><div></div></div>`
  if (opts.error) body += `<div class="error">${escapeHtml(String(opts.error))}</div>`
  if (opts.notice) body += `<div class="notice">${escapeHtml(String(opts.notice))}</div>`
  body += `<style>
    #message-editor-form {
      max-width: 560px;
      margin: 0 auto;
      box-sizing: border-box;
    }
    #message-editor-form .section {
      border: 1px solid rgba(96,165,250,0.4);
      background: linear-gradient(180deg, rgba(28,45,58,0.72) 0%, rgba(12,16,20,0.72) 100%);
      border-radius: 12px;
      padding: 12px;
      margin: 10px 0;
    }
    #message-editor-form .section-title {
      color: #fff;
      font-size: 18px;
      font-weight: 900;
      margin-bottom: 10px;
    }
    #message-editor-form .section-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 0;
      background: transparent;
      color: #fff;
      font-size: 18px;
      font-weight: 900;
      text-align: left;
      padding: 0;
      margin: 10px 0 6px;
      cursor: pointer;
    }
    #message-editor-form .section-toggle-chevron {
      font-size: 16px;
      line-height: 1;
      opacity: 0.85;
      width: 14px;
      display: inline-flex;
      justify-content: center;
      flex: 0 0 14px;
    }
    #message-editor-form .section-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 10px 0 6px;
    }
    #message-editor-form .section-enable-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 800;
      font-size: 12px;
      color: #dbe7f3;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
      min-width: auto;
    }
    #message-editor-form .section-disabled {
      opacity: 0.6;
    }
    #message-editor-form .field-hint {
      color: #bbb;
      font-size: 12px;
      font-weight: 800;
    }
    #message-editor-form label {
      display: grid;
      gap: 6px;
      min-width: 0;
      color: #e9eef5;
      font-weight: 800;
      font-size: 13px;
    }
    #message-editor-form input,
    #message-editor-form select,
    #message-editor-form textarea {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      background: #0b0b0b;
      color: #fff;
      padding: 10px 12px;
      font-size: 14px;
      font-weight: 900;
    }
    #message-editor-form input[type="checkbox"] {
      width: auto;
      max-width: none;
      padding: 0;
      border: 0;
      background: transparent;
    }
    #message-editor-form input.color-swatch-input {
      width: 48px;
      min-width: 48px;
      height: 36px;
      padding: 2px;
      border-radius: 8px;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.3);
    }
    #message-editor-form .mini-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      align-items: flex-start;
    }
    #message-editor-form #message-section-surface {
      align-items: stretch;
    }
    #message-editor-form .mini-field-label {
      color: #e9eef5;
      font-weight: 800;
      font-size: 13px;
      line-height: 1.2;
      margin: 0;
    }
    #message-editor-form .picker-row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
    }
    #message-editor-form .picker-row > input {
      flex: 1 1 auto;
      min-width: 0;
    }
    #message-editor-form .picker-btn {
      width: 40px;
      min-width: 40px;
      height: 40px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(255,255,255,0.06);
      color: #fff;
      cursor: pointer;
    }
    #message-editor-form #message-campaign-key-suffix {
      border-radius: 999px;
      border: 1px solid rgba(96,165,250,0.95);
      background: rgba(37,99,235,0.95);
      color: #fff;
    }
    #message-editor-form .btn {
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.06);
      color: #fff;
      font-weight: 800;
    }
    #message-editor-form .btn.btn-primary-accent {
      border: 1px solid rgba(96,165,250,0.95);
      background: rgba(96,165,250,0.14);
      color: #fff;
      font-weight: 900;
    }
  </style>`

  const skipDraftRestore = opts.notice ? '1' : '0'
  body += `<form id="message-editor-form" data-draft-key="${escapeHtml(draftKey)}" data-skip-draft-restore="${skipDraftRestore}" method="post" action="${escapeHtml(opts.action)}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
  const messageTypeValue = String(values.type || values.messageType || 'register_login').trim().toLowerCase() || 'register_login'
  const messageTypeOptions = MESSAGE_TYPE_OPTIONS.slice()
  if (!messageTypeOptions.some((opt) => opt.value === messageTypeValue)) {
    messageTypeOptions.unshift({ value: messageTypeValue, label: `Custom (${messageTypeValue})` })
  }
  const surfaceValue = String(values.appliesToSurface || values.applies_to_surface || 'global_feed').trim().toLowerCase() || 'global_feed'
  const surfaceOptions = MESSAGE_SURFACE_OPTIONS.slice()
  if (!surfaceOptions.some((opt) => opt.value === surfaceValue)) {
    surfaceOptions.unshift({ value: surfaceValue, label: `Custom (${surfaceValue})` })
  }
  const deliveryScopeValue = String(values.deliveryScope || values.delivery_scope || 'both').trim().toLowerCase() || 'both'
  const deliveryScopeOptions = MESSAGE_DELIVERY_SCOPE_OPTIONS.slice()
  if (!deliveryScopeOptions.some((opt) => opt.value === deliveryScopeValue)) {
    deliveryScopeOptions.unshift({ value: deliveryScopeValue, label: `Custom (${deliveryScopeValue})` })
  }
  const campaignKeyValue = String(values.campaignKey || values.campaign_key || '').trim().toLowerCase()
  const campaignCategoryValue = String(values.campaignCategory || values.campaign_category || '').trim().toLowerCase()
  const duplicateCampaignKeyError = String(opts.error || '').trim().toLowerCase() === 'duplicate_campaign_key'
  const eligibilityRulesetIdValue = String(values.eligibilityRulesetId ?? values.eligibility_ruleset_id ?? '').trim()
  const rawSurfaceTargeting = Array.isArray(values.surfaceTargeting)
    ? values.surfaceTargeting
    : (Array.isArray(values.surface_targeting) ? values.surface_targeting : [])
  const messageSurfaceTargeting = rawSurfaceTargeting.length
    ? rawSurfaceTargeting
    : [{ surface: surfaceValue, targetingMode: 'all', targetIds: [] }]
  const targetBySurface = new Map<string, { targetingMode: 'all' | 'selected'; targetIds: number[] }>()
  for (const item of messageSurfaceTargeting as any[]) {
    const surface = String(item?.surface || '').trim().toLowerCase()
    if (surface !== 'global_feed' && surface !== 'group_feed' && surface !== 'channel_feed') continue
    const mode = String(item?.targetingMode || item?.targeting_mode || '').trim().toLowerCase() === 'selected' ? 'selected' : 'all'
    const targetIds = Array.isArray(item?.targetIds)
      ? item.targetIds
      : (Array.isArray(item?.target_ids) ? item.target_ids : [])
    const normalizedTargetIds: number[] = Array.from(new Set(targetIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0).map((n: number) => Math.round(n)))) as number[]
    targetBySurface.set(surface, { targetingMode: mode, targetIds: normalizedTargetIds })
  }
  const globalChecked = targetBySurface.has('global_feed')
  const groupsTargeting = targetBySurface.get('group_feed') || { targetingMode: 'all' as const, targetIds: [] }
  const channelsTargeting = targetBySurface.get('channel_feed') || { targetingMode: 'all' as const, targetIds: [] }

  body += `<button type="button" class="section-toggle" data-target="message-section-identity" aria-expanded="false"><span class="section-toggle-chevron">▸</span><span style="opacity:0.5">IDENTITY</span></button>`
  body += `<div id="message-section-identity" class="section" style="display:none">`
  body += `<label>Name<input type="text" name="name" value="${escapeHtml(String(values.name || ''))}" required maxlength="120" /></label>`
  body += `<div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; margin-top:10px">`
  body += `<div class="mini-field" style="grid-column:1 / -1"><div class="mini-field-label">Type</div><select name="type">`
  for (const opt of messageTypeOptions) {
    body += `<option value="${escapeHtml(opt.value)}"${opt.value === messageTypeValue ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></div>`
  body += `<div class="mini-field" style="grid-column:1 / -1"><div class="mini-field-label">Campaign Key</div><div class="picker-row"><input type="text" name="campaignKey" value="${escapeHtml(campaignKeyValue)}" maxlength="64" placeholder="spring_2026_drive" /><button type="button" id="message-campaign-key-suffix" class="btn" title="Append -yyyy-mm-dd" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center;">+D</button></div>${duplicateCampaignKeyError ? `<div class="field-hint" style="color:#fda4af">Campaign key is already in use. Choose a unique key.</div>` : ''}</div>`
  body += `<div class="mini-field" style="grid-column:1 / -1"><div class="mini-field-label">Campaign Category</div><input type="text" name="campaignCategory" list="message-campaign-category-options" value="${escapeHtml(campaignCategoryValue)}" maxlength="64" placeholder="donation_drive" /><datalist id="message-campaign-category-options">`
  for (const category of campaignCategoryOptions) {
    body += `<option value="${escapeHtml(String(category || '').trim().toLowerCase())}"></option>`
  }
  body += `</datalist></div>`
  body += `<div class="mini-field" style="grid-column:1 / -1"><div class="mini-field-label">Delivery Scope</div><select name="deliveryScope" id="message-delivery-scope">`
  for (const opt of deliveryScopeOptions) {
    body += `<option value="${escapeHtml(opt.value)}"${opt.value === deliveryScopeValue ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Priority</div><input type="number" name="priority" value="${escapeHtml(String(values.priority ?? 100))}" /></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Status</div><select name="status">
    <option value="draft"${String(values.status || '') === 'draft' ? ' selected' : ''}>Draft</option>
    <option value="active"${String(values.status || '') === 'active' ? ' selected' : ''}>Active</option>
    <option value="paused"${String(values.status || '') === 'paused' ? ' selected' : ''}>Paused</option>
    <option value="archived"${String(values.status || '') === 'archived' ? ' selected' : ''}>Archived</option>
  </select></div>`
  body += `</div>`
  body += `</div>`
  body += `<div id="message-surface-targeting-section">`
  body += `<button type="button" class="section-toggle" data-target="message-section-surface" aria-expanded="false"><span class="section-toggle-chevron">▸</span><span style="opacity:0.5">SURFACE TARGETING</span></button>`
  body += `<div id="message-section-surface" class="section" style="display:none">`
  body += `<input type="hidden" name="appliesToSurface" value="${escapeHtml(surfaceValue)}" />`
  body += `<div style="display:grid; gap:10px">`
  body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0; white-space:nowrap"><input type="checkbox" name="surfaceGlobalFeed" value="1"${globalChecked ? ' checked' : ''} /> Global Feed</label>`
  body += `<div style="border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:10px; box-sizing:border-box">`
  body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0 0 8px 0; white-space:nowrap"><input type="checkbox" name="surfaceGroupFeed" value="1"${targetBySurface.has('group_feed') ? ' checked' : ''} /> Groups</label>`
  body += `<label style="margin:0 0 8px 0">Targeting<select name="surfaceGroupFeedMode"><option value="all"${groupsTargeting.targetingMode === 'all' ? ' selected' : ''}>All</option><option value="selected"${groupsTargeting.targetingMode === 'selected' ? ' selected' : ''}>Selected only</option></select></label>`
  body += `<label style="margin:0">Selected Groups<select name="surfaceGroupTargetIds" multiple size="6">`
  for (const group of surfaceTargetOptions.groups) {
    const selected = groupsTargeting.targetIds.includes(Number(group.id))
    const label = `${group.name}${group.slug ? ` (${group.slug})` : ''} [#${group.id}]`
    body += `<option value="${group.id}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
  }
  body += `</select></label>`
  body += `</div>`
  body += `<div style="border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:10px; box-sizing:border-box">`
  body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0 0 8px 0; white-space:nowrap"><input type="checkbox" name="surfaceChannelFeed" value="1"${targetBySurface.has('channel_feed') ? ' checked' : ''} /> Channels</label>`
  body += `<label style="margin:0 0 8px 0">Targeting<select name="surfaceChannelFeedMode"><option value="all"${channelsTargeting.targetingMode === 'all' ? ' selected' : ''}>All</option><option value="selected"${channelsTargeting.targetingMode === 'selected' ? ' selected' : ''}>Selected only</option></select></label>`
  body += `<label style="margin:0">Selected Channels<select name="surfaceChannelTargetIds" multiple size="6">`
  for (const channel of surfaceTargetOptions.channels) {
    const selected = channelsTargeting.targetIds.includes(Number(channel.id))
    const label = `${channel.name}${channel.slug ? ` (${channel.slug})` : ''} [#${channel.id}]`
    body += `<option value="${channel.id}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
  }
  body += `</select></label>`
  body += `</div>`
  body += `</div>`
  body += `</div>`
  body += `</div>`
  body += `<div id="message-eligibility-section">`
  body += `<button type="button" class="section-toggle" data-target="message-section-eligibility" aria-expanded="false"><span class="section-toggle-chevron">▸</span><span style="opacity:0.5">ELIGIBILITY</span></button>`
  body += `<div id="message-section-eligibility" class="section" style="display:none">`
  body += `<div class="mini-field" id="message-eligibility-row"><div class="mini-field-label">Eligibility Ruleset</div><div class="picker-row"><select id="message-eligibility-select" name="eligibilityRulesetId">`
  body += `<option value="">(none)</option>`
  for (const opt of eligibilityRulesetOptions) {
    const idValue = String(Number(opt.id))
    const label = `${opt.name} [${opt.status}] #${opt.id}`
    body += `<option value="${escapeHtml(idValue)}"${eligibilityRulesetIdValue === idValue ? ' selected' : ''}>${escapeHtml(label)}</option>`
  }
  body += `</select><button type="button" id="message-eligibility-view" class="picker-btn" title="View ruleset criteria">{}`
  body += `</button></div></div>`
  body += `<div class="field-hint" id="message-eligibility-hint">For journey delivery, set eligibility on the journey (not the step). Message-level rulesets apply to standalone delivery only.</div>`
  body += `</div>`
  body += `</div>`
  body += `<dialog id="message-eligibility-dialog" style="max-width:860px; width:min(92vw, 860px); border:1px solid #444; border-radius:10px; padding:14px;">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
      <strong id="message-eligibility-dialog-title">Eligibility Criteria</strong>
      <button type="button" id="message-eligibility-dialog-close" class="btn" aria-label="Close dialog" style="width:30px; min-width:30px; height:30px; padding:0; border-radius:999px; border:1px solid #000; background:#000; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:900; line-height:1;">×</button>
    </div>
    <pre id="message-eligibility-dialog-json" style="margin:0; max-height:60vh; overflow:auto; border:1px solid rgba(255,255,255,0.18); border-radius:8px; padding:10px; background:#0b0b0b; color:#fff; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;"></pre>
  </dialog>`
  body += `<script>
    ${sharedMessagePreviewRendererScript()}
    (function () {
      const form = document.getElementById('message-editor-form');
      if (!form) return;
      const scope = form.querySelector('#message-delivery-scope');
      const eligibilitySection = form.querySelector('#message-eligibility-section');
      const eligibilityToggle = form.querySelector('.section-toggle[data-target="message-section-eligibility"]');
      const rulesetRow = form.querySelector('#message-eligibility-row');
      const surfaceSection = form.querySelector('#message-surface-targeting-section');
      const surfaceToggle = form.querySelector('.section-toggle[data-target="message-section-surface"]');
      const surfaceRow = form.querySelector('#message-section-surface');
      const hint = form.querySelector('#message-eligibility-hint');
      const rulesetSelect = form.querySelector('#message-eligibility-select');
      const rulesetViewBtn = form.querySelector('#message-eligibility-view');
      const rulesetDialog = document.getElementById('message-eligibility-dialog');
      const rulesetDialogClose = document.getElementById('message-eligibility-dialog-close');
      const rulesetDialogTitle = document.getElementById('message-eligibility-dialog-title');
      const rulesetDialogJson = document.getElementById('message-eligibility-dialog-json');
      const rulesetCriteriaById = ${JSON.stringify(
        Object.fromEntries(
          eligibilityRulesetOptions.map((opt) => [String(Number(opt.id)), opt.criteria || { version: 1, inclusion: [], exclusion: [] }])
        )
      )};
      const sync = () => {
        const isJourneyOnly = scope && String(scope.value || '').toLowerCase() === 'journey_only';
        const eligibilityExpanded = eligibilityToggle && eligibilityToggle.getAttribute('aria-expanded') === 'true';
        if (eligibilitySection) eligibilitySection.style.display = '';
        const eligibilityBody = form.querySelector('#message-section-eligibility');
        if (eligibilityBody) eligibilityBody.style.display = eligibilityExpanded ? '' : 'none';
        if (rulesetRow) {
          rulesetRow.style.display = '';
          rulesetRow.style.opacity = isJourneyOnly ? '0.55' : '1';
          rulesetRow.style.pointerEvents = isJourneyOnly ? 'none' : 'auto';
        }
        if (eligibilityToggle) eligibilityToggle.style.display = '';
        const surfaceExpanded = surfaceToggle && surfaceToggle.getAttribute('aria-expanded') === 'true';
        if (surfaceSection) surfaceSection.style.display = '';
        const surfaceBody = form.querySelector('#message-section-surface');
        if (surfaceBody) surfaceBody.style.display = surfaceExpanded ? '' : 'none';
        if (surfaceRow) {
          surfaceRow.style.display = '';
          surfaceRow.style.opacity = isJourneyOnly ? '0.55' : '1';
          surfaceRow.style.pointerEvents = isJourneyOnly ? 'none' : 'auto';
        }
        if (surfaceToggle) surfaceToggle.style.display = '';
        if (hint) hint.style.display = '';
        if (rulesetViewBtn && rulesetSelect) {
          const id = String(rulesetSelect.value || '').trim();
          rulesetViewBtn.disabled = !id || !rulesetCriteriaById[id];
          rulesetViewBtn.style.opacity = rulesetViewBtn.disabled ? '0.4' : '1';
          rulesetViewBtn.style.cursor = rulesetViewBtn.disabled ? 'not-allowed' : 'pointer';
        }
      };
      if (rulesetViewBtn && rulesetSelect && rulesetDialog && rulesetDialogJson) {
        rulesetViewBtn.addEventListener('click', () => {
          const id = String(rulesetSelect.value || '').trim();
          if (!id || !rulesetCriteriaById[id]) return;
          const selectedOpt = rulesetSelect.options[rulesetSelect.selectedIndex];
          if (rulesetDialogTitle) rulesetDialogTitle.textContent = 'Eligibility Criteria — ' + String((selectedOpt && selectedOpt.text) || ('#' + id));
          rulesetDialogJson.textContent = JSON.stringify(rulesetCriteriaById[id], null, 2);
          if (typeof rulesetDialog.showModal === 'function') rulesetDialog.showModal();
        });
        if (rulesetDialogClose) {
          rulesetDialogClose.addEventListener('click', () => {
            if (typeof rulesetDialog.close === 'function') rulesetDialog.close();
          });
        }
        rulesetDialog.addEventListener('click', (ev) => {
          const rect = rulesetDialog.getBoundingClientRect();
          const x = ev.clientX;
          const y = ev.clientY;
          const outside = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
          if (outside && typeof rulesetDialog.close === 'function') rulesetDialog.close();
        });
      }
      if (rulesetSelect) rulesetSelect.addEventListener('change', sync);
      if (scope) scope.addEventListener('change', sync);
      sync();
    })();
  </script>`
  if (journeyStepRefs.length > 0) {
    body += `<button type="button" class="section-toggle" data-target="message-section-journey-usage" aria-expanded="false"><span class="section-toggle-chevron">▸</span><span>Journey Usage</span></button>`
    body += `<div id="message-section-journey-usage" class="section" style="display:none">`
    body += `<div class="field-hint">This message is currently referenced by the following journey steps.</div>`
    body += `<ul style="margin:10px 0 0 18px; padding:0">`
    for (const ref of journeyStepRefs) {
      body += `<li><a href="/admin/message-journeys/${ref.journeyId}">${escapeHtml(ref.journeyKey)}</a> [${escapeHtml(ref.journeyStatus)}] — step ${ref.stepOrder} (${escapeHtml(ref.stepKey)})</li>`
    }
    body += `</ul>`
    body += `</div>`
  }

  body += `<button type="button" class="section-toggle" data-target="message-section-background" aria-expanded="false"><span class="section-toggle-chevron">▸</span><span style="opacity:0.5">BACKGROUND MEDIA</span></button>`
  body += `<div id="message-section-background" class="section" style="display:none">`
  body += `<input type="hidden" name="creativeBgUploadId" value="${escapeHtml(String(creativeForm.backgroundUploadId || ''))}" />`
  body += `<div style="display:grid; grid-template-columns:1fr; gap:10px">`
  body += `<label>Mode<select name="creativeBgMode">
    <option value="none"${creativeForm.backgroundMode === 'none' ? ' selected' : ''}>None</option>
    <option value="image"${creativeForm.backgroundMode === 'image' ? ' selected' : ''}>Image</option>
    <option value="video"${creativeForm.backgroundMode === 'video' ? ' selected' : ''}>Video</option>
  </select></label>`
  body += `<label id="message-video-playback-row"${creativeForm.backgroundMode === 'video' ? '' : ' style="display:none"'}>Video Playback<select name="creativeBgVideoPlayback">
    <option value="muted_autoplay"${creativeForm.backgroundVideoPlayback === 'muted_autoplay' ? ' selected' : ''}>Muted Autoplay</option>
    <option value="tap_to_play_sound"${creativeForm.backgroundVideoPlayback === 'tap_to_play_sound' ? ' selected' : ''}>Tap to Play (Sound)</option>
  </select></label>`
  body += `</div>`
  body += `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; align-items:start">`
  body += `<div class="mini-field"><div class="mini-field-label">Overlay Color</div><input class="color-swatch-input" type="color" name="creativeBgOverlayColor" value="${escapeHtml(String(creativeForm.backgroundOverlayColor || '#000000'))}" /></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Overlay Opacity</div><input type="number" name="creativeBgOverlayOpacity" min="0" max="1" step="0.05" value="${escapeHtml(String(creativeForm.backgroundOverlayOpacity))}" /></div>`
  body += `</div>`
  body += `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px">`
  body += `<button class="btn" type="button" id="message-pick-bg-image">Select Image</button>`
  body += `<button class="btn" type="button" id="message-pick-bg-video">Select Video</button>`
  body += `</div>`
  body += `</div>`

  body += `<div class="section-header-row">`
  body += `<button type="button" class="section-toggle" data-target="message-widget-content-section" aria-expanded="false" style="margin:0"><span class="section-toggle-chevron">▸</span><span style="opacity:0.5">MESSAGE WIDGET</span></button>`
  body += `<label class="section-enable-toggle"><input type="checkbox" name="creativeMessageEnabled" value="1"${creativeForm.messageEnabled ? ' checked' : ''} /> Enabled</label>`
  body += `</div>`
  body += `<div id="message-widget-content-section" class="section" style="display:none">`
  body += `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px">`
  body += `<label>Message Label<input type="text" name="creativeMessageLabel" value="${escapeHtml(String(creativeForm.messageLabel || 'Join the Community'))}" required maxlength="100" /></label>`
  body += `<label>Headline<input type="text" name="headline" value="${escapeHtml(String(values.headline || ''))}" required maxlength="280" /></label>`
  body += `</div>`
  body += `<label>Body<textarea name="body" rows="4">${escapeHtml(String(values.body || ''))}</textarea></label>`
  body += `<label>Position<select name="creativeMessagePosition">
    <option value="top"${creativeForm.messagePosition === 'top' ? ' selected' : ''}>Top</option>
    <option value="middle"${creativeForm.messagePosition === 'middle' ? ' selected' : ''}>Middle</option>
    <option value="bottom"${creativeForm.messagePosition === 'bottom' ? ' selected' : ''}>Bottom</option>
  </select></label>`
  body += `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; align-items:start">`
  body += `<div class="mini-field"><div class="mini-field-label">Y Inset (%)</div><input type="number" name="creativeMessageOffsetPct" min="0" max="80" value="${escapeHtml(String(creativeForm.messageOffsetPct))}" /></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Text Color</div><input class="color-swatch-input" type="color" name="creativeMessageTextColor" value="${escapeHtml(String(creativeForm.messageTextColor || '#FFFFFF'))}" /></div>`
  body += `</div>`
  body += `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; align-items:start">`
  body += `<div class="mini-field"><div class="mini-field-label">Background Color</div><input class="color-swatch-input" type="color" name="creativeMessageBgColor" value="${escapeHtml(String(creativeForm.messageBgColor || '#0B1320'))}" /></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Background Opacity</div><input type="number" name="creativeMessageBgOpacity" min="0" max="1" step="0.05" value="${escapeHtml(String(creativeForm.messageBgOpacity))}" /></div>`
  body += `</div>`
  body += `</div>`

  body += `<div class="section-header-row">`
  body += `<button type="button" class="section-toggle" data-target="cta-widget-style-section" aria-expanded="false" style="margin:0"><span class="section-toggle-chevron">▸</span><span style="opacity:0.5">CTA WIDGET</span></button>`
  body += `<label class="section-enable-toggle"><input type="checkbox" name="creativeCtaEnabled" value="1"${creativeForm.ctaEnabled ? ' checked' : ''} /> Enabled</label>`
  body += `</div>`
  body += `<div id="cta-widget-style-section" class="section" style="display:none">`
  body += `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; align-items:start">`
  body += `<label>CTA Count<select name="creativeCtaSlotCount" id="creativeCtaSlotCount">`
  for (const count of [1, 2, 3]) {
    body += `<option value="${count}"${slotCount === count ? ' selected' : ''}>${count}</option>`
  }
  body += `</select></label>`
  body += `<label style="margin-top:0">Layout<select name="creativeCtaLayout">
    <option value="inline"${creativeForm.ctaLayout === 'inline' ? ' selected' : ''}>Inline</option>
    <option value="stacked"${creativeForm.ctaLayout === 'stacked' ? ' selected' : ''}>Stacked</option>
  </select></label>`
  body += `</div>`
  body += `<label style="margin-top:10px">Position<select name="creativeCtaPosition">
    <option value="top"${creativeForm.ctaPosition === 'top' ? ' selected' : ''}>Top</option>
    <option value="middle"${creativeForm.ctaPosition === 'middle' ? ' selected' : ''}>Middle</option>
    <option value="bottom"${creativeForm.ctaPosition === 'bottom' ? ' selected' : ''}>Bottom</option>
  </select></label>`
  body += `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; align-items:start">`
  body += `<div class="mini-field"><div class="mini-field-label">Y Inset (%)</div><input type="number" name="creativeCtaOffsetPct" min="0" max="80" value="${escapeHtml(String(creativeForm.ctaOffsetPct))}" /></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Text Color</div><input class="color-swatch-input" type="color" name="creativeCtaTextColor" value="${escapeHtml(String(creativeForm.ctaTextColor || '#FFFFFF'))}" /></div>`
  body += `</div>`
  body += `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; align-items:start">`
  body += `<div class="mini-field"><div class="mini-field-label">Background Color</div><input class="color-swatch-input" type="color" name="creativeCtaBgColor" value="${escapeHtml(String(creativeForm.ctaBgColor || '#0B1320'))}" /></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Background Opacity</div><input type="number" name="creativeCtaBgOpacity" min="0" max="1" step="0.05" value="${escapeHtml(String(creativeForm.ctaBgOpacity))}" /></div>`
  body += `</div>`
  body += `<div class="section-title" style="margin:10px 0 6px">CTA SLOTS</div>`
  for (const slot of [1, 2, 3] as const) {
    const slotValue = slotsByIndex.get(slot) || {}
    const selectedDefinitionId = Number(slotValue.ctaDefinitionId || slotValue.cta_definition_id || 0) || 0
    const styleOverride = slotValue.styleOverride && typeof slotValue.styleOverride === 'object'
      ? slotValue.styleOverride
      : (slotValue.style_override && typeof slotValue.style_override === 'object' ? slotValue.style_override : {})
    const slotBgColor = String(styleOverride.bgColor || styleOverride.bg_color || '')
    const slotBgOpacityRaw = Number(styleOverride.bgOpacity ?? styleOverride.bg_opacity)
    const slotBgOpacity = Number.isFinite(slotBgOpacityRaw) ? Math.max(0, Math.min(1, slotBgOpacityRaw)) : 1
    const slotTextColor = String(styleOverride.textColor || styleOverride.text_color || '')
    body += `<div class="section cta-slot-row" data-slot-row="${slot}" style="display:${slot <= slotCount ? 'grid' : 'none'}; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; margin-top:10px">`
    body += `<label>Slot ${slot}: CTA Definition<select name="creativeCtaSlot${slot}DefinitionId">`
    body += `<option value="">(none)</option>`
    for (const def of ctaDefinitionOptions) {
      const isSelected = selectedDefinitionId === Number(def.id)
      const label = `${def.name} [${def.intentKey}/${def.executorType}]`
      body += `<option value="${def.id}"${isSelected ? ' selected' : ''}>${escapeHtml(label)}</option>`
    }
    body += `</select></label>`
    body += `<label>Label Override<input type="text" name="creativeCtaSlot${slot}LabelOverride" value="${escapeHtml(String(slotValue.labelOverride || slotValue.label_override || ''))}" maxlength="100" /></label>`
    body += `<div style="grid-column:1 / -1; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px">`
    body += `<div class="mini-field"><div class="mini-field-label">Background</div><input class="color-swatch-input" type="color" name="creativeCtaSlot${slot}BgColor" value="${escapeHtml(/^#[0-9a-fA-F]{6}$/.test(slotBgColor) ? slotBgColor : '#0B1320')}" /></div>`
    body += `<div class="mini-field"><div class="mini-field-label">Opacity</div><input type="number" name="creativeCtaSlot${slot}BgOpacity" min="0" max="1" step="0.05" value="${escapeHtml(String(slotBgOpacity))}" /></div>`
    body += `<div class="mini-field"><div class="mini-field-label">Text</div><input class="color-swatch-input" type="color" name="creativeCtaSlot${slot}TextColor" value="${escapeHtml(/^#[0-9a-fA-F]{6}$/.test(slotTextColor) ? slotTextColor : '#FFFFFF')}" /></div>`
    body += `</div>`
    body += `</div>`
  }
  body += `</div>`

  body += `<button type="button" class="section-toggle" data-target="message-section-scheduling" aria-expanded="false"><span class="section-toggle-chevron">▸</span><span style="opacity:0.5">SCHEDULING</span></button>`
  body += `<div id="message-section-scheduling" class="section" style="display:none">`
  const startsAtBase = values.startsAtDate || values.startsAtTime ? '' : toDateTimeLocalValue(values.startsAt || values.starts_at)
  const endsAtBase = values.endsAtDate || values.endsAtTime ? '' : toDateTimeLocalValue(values.endsAt || values.ends_at)
  const startsAtDateValue = String(values.startsAtDate || toDateOnlyValue(startsAtBase))
  const startsAtTimeValue = String(values.startsAtTime || toTimeOnlyValue(startsAtBase))
  const endsAtDateValue = String(values.endsAtDate || toDateOnlyValue(endsAtBase))
  const endsAtTimeValue = String(values.endsAtTime || toTimeOnlyValue(endsAtBase))
  body += `<input type="hidden" name="startsAt" value="${escapeHtml(startsAtDateValue && startsAtTimeValue ? `${startsAtDateValue}T${startsAtTimeValue}` : '')}" />`
  body += `<input type="hidden" name="endsAt" value="${escapeHtml(endsAtDateValue && endsAtTimeValue ? `${endsAtDateValue}T${endsAtTimeValue}` : '')}" />`
  body += `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px">`
  body += `<div class="mini-field"><div class="mini-field-label">Starts Date (UTC)</div><div class="picker-row"><input id="startsAtDate" type="date" name="startsAtDate" value="${escapeHtml(startsAtDateValue)}" /><button type="button" class="picker-btn" data-picker-target="startsAtDate" aria-label="Open starts date picker">📅</button></div></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Starts Time (UTC)</div><div class="picker-row"><input id="startsAtTime" type="time" name="startsAtTime" step="60" value="${escapeHtml(startsAtTimeValue)}" /><button type="button" class="picker-btn" data-picker-target="startsAtTime" aria-label="Open starts time picker">🕒</button></div></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Ends Date (UTC)</div><div class="picker-row"><input id="endsAtDate" type="date" name="endsAtDate" value="${escapeHtml(endsAtDateValue)}" /><button type="button" class="picker-btn" data-picker-target="endsAtDate" aria-label="Open ends date picker">📅</button></div></div>`
  body += `<div class="mini-field"><div class="mini-field-label">Ends Time (UTC)</div><div class="picker-row"><input id="endsAtTime" type="time" name="endsAtTime" step="60" value="${escapeHtml(endsAtTimeValue)}" /><button type="button" class="picker-btn" data-picker-target="endsAtTime" aria-label="Open ends time picker">🕒</button></div></div>`
  body += `</div>`
  body += `</div>`

  body += `<button type="button" class="section-toggle" data-target="message-section-preview" aria-expanded="true"><span class="section-toggle-chevron">▾</span><span style="opacity:0.5">PREVIEW</span></button>`
  body += `<div id="message-section-preview" style="border:1px solid rgba(96,165,250,0.6); border-radius:12px; background:linear-gradient(180deg, rgba(28,45,58,0.72) 0%, rgba(12,16,20,0.72) 100%); overflow:hidden">`
  body += `<div id="message-preview-device" style="width:100%; max-width:100%; aspect-ratio:9/16; margin:0; ${previewBaseStyle} position:relative">`
  body += `<div id="message-preview-overlay" style="position:absolute; inset:0; background:${hexToRgba(creativeForm.backgroundOverlayColor, creativeForm.backgroundOverlayOpacity)}"></div>`
  body += `<div id="message-preview-mode-badge" style="position:absolute; top:10px; right:10px; z-index:2; border:1px solid rgba(255,255,255,0.25); border-radius:999px; padding:3px 8px; font-size:11px; background:rgba(0,0,0,0.45)">Mode: ${escapeHtml(String(creativeForm.backgroundMode))}${creativeForm.backgroundMode === 'video' ? ` (${escapeHtml(creativeForm.backgroundVideoPlayback === 'tap_to_play_sound' ? 'tap-to-play' : 'muted-autoplay')})` : ''}</div>`
  const msgInset = Math.max(0, Math.min(80, Number(creativeForm.messageOffsetPct || 0)))
  const msgTopPct = Math.max(2, Math.min(92, (creativeForm.messagePosition === 'top' ? 2 : 42) + msgInset))
  const msgPosStyle = creativeForm.messagePosition === 'bottom'
    ? `bottom:${Math.max(2, Math.min(92, 2 + msgInset))}%`
    : `top:${msgTopPct}%`
  body += `<div id="message-preview-message" style="display:${creativeForm.messageEnabled ? 'block' : 'none'}; position:absolute; left:14px; right:14px; ${msgPosStyle}; z-index:2; border:1px solid rgba(255,255,255,0.24); border-radius:10px; background:${hexToRgba(creativeForm.messageBgColor, creativeForm.messageBgOpacity)}; color:${escapeHtml(creativeForm.messageTextColor)}; padding:10px">`
  body += `<div id="message-preview-message-label" style="font-size:12px; opacity:0.9; margin-bottom:4px">${escapeHtml(String(creativeForm.messageLabel || 'Message'))}</div>`
  body += `<div id="message-preview-message-headline" style="font-size:24px; line-height:1.18; font-weight:800; margin-bottom:8px">${escapeHtml(String(values.headline || 'Message headline'))}</div>`
  body += `<div id="message-preview-message-body"${values.body ? '' : ' hidden'} style="opacity:0.9; margin-bottom:8px">${escapeHtml(String(values.body || ''))}</div>`
  body += `</div>`
  const ctaInset = Math.max(0, Math.min(80, Number(creativeForm.ctaOffsetPct || 0)))
  const ctaTopPct = Math.max(2, Math.min(94, (creativeForm.ctaPosition === 'top' ? 2 : 56) + ctaInset))
  const ctaPosStyle = creativeForm.ctaPosition === 'bottom'
    ? `bottom:${Math.max(2, Math.min(94, 2 + ctaInset))}%`
    : `top:${ctaTopPct}%`
  const previewSlot1Label = slotLabel(1, String(creativeForm.ctaPrimaryLabel || 'Primary'))
  const previewSlot2Label = slotLabel(2, String(creativeForm.ctaSecondaryLabel || 'Secondary'))
  const previewSlot3Label = slotLabel(3, 'Tertiary')
  body += `<div id="message-preview-cta" style="display:${creativeForm.ctaEnabled ? 'block' : 'none'}; position:absolute; left:14px; right:14px; ${ctaPosStyle}; z-index:2; border:1px solid rgba(255,255,255,0.24); border-radius:10px; background:${hexToRgba(creativeForm.ctaBgColor, creativeForm.ctaBgOpacity)}; color:${escapeHtml(creativeForm.ctaTextColor)}; padding:8px">`
  body += `<div id="message-preview-cta-buttons" style="display:${creativeForm.ctaLayout === 'stacked' ? 'grid' : 'flex'}; grid-template-columns:${creativeForm.ctaLayout === 'stacked' ? '1fr' : 'none'}; justify-content:space-between; align-items:center; gap:8px">`
  body += `<span id="message-preview-slot-1-btn" class="btn" style="justify-self:start; border:1px solid rgba(255,255,255,0.45); border-radius:11px; background:rgba(0,0,0,0.5); padding:8px 12px; display:${slotCount >= 1 ? 'inline-flex' : 'none'}; text-align:center; white-space:nowrap; box-sizing:border-box">${escapeHtml(previewSlot1Label)}</span>`
  body += `<span id="message-preview-slot-2-btn" class="btn" style="justify-self:center; border:1px solid rgba(255,255,255,0.45); border-radius:11px; background:rgba(0,0,0,0.5); padding:8px 12px; display:${slotCount >= 2 ? 'inline-flex' : 'none'}; text-align:center; white-space:nowrap; box-sizing:border-box">${escapeHtml(previewSlot2Label)}</span>`
  body += `<span id="message-preview-slot-3-btn" class="btn" style="justify-self:end; border:1px solid rgba(255,255,255,0.45); border-radius:11px; background:rgba(0,0,0,0.5); padding:8px 12px; display:${slotCount >= 3 ? 'inline-flex' : 'none'}; text-align:center; white-space:nowrap; box-sizing:border-box">${escapeHtml(previewSlot3Label)}</span>`
  body += `</div>`
  body += `</div>`
  body += `</div>`
  if (creativeWarnings.length) {
    body += `<div style="margin-top:10px; display:grid; gap:6px">`
    for (const warning of creativeWarnings) body += `<div class="field-hint" style="color:#facc15">${escapeHtml(warning)}</div>`
    body += `</div>`
  }
  body += `</div>`
  body += `<script>
    (function () {
      const form = document.getElementById('message-editor-form');
      if (!form) return;
      const draftKey = form.getAttribute('data-draft-key') || 'admin_message_editor_draft_new';
      const skipDraftRestore = form.getAttribute('data-skip-draft-restore') === '1';
      const q = (name) => form.querySelector('[name="' + name + '"]');
      const v = (name, fallback = '') => {
        const el = q(name);
        if (!el) return fallback;
        const value = el.value == null ? '' : String(el.value);
        return value === '' ? fallback : value;
      };
      const vb = (name, fallback = false) => {
        const el = q(name);
        if (!el) return fallback;
        return Boolean(el.checked);
      };
      const vn = (name, fallback = 0) => {
        const n = Number(v(name, ''));
        return Number.isFinite(n) ? n : fallback;
      };
      const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
      const hex = (s, fallback) => /^#[0-9a-fA-F]{6}$/.test(String(s || '')) ? String(s).toUpperCase() : fallback;
      const hexToRgba = (h, a) => {
        const c = hex(h, '#000000').slice(1);
        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clamp(a, 0, 1) + ')';
      };
      const preview = {
        messageSection: document.getElementById('message-widget-content-section'),
        ctaSection: document.getElementById('cta-widget-style-section'),
        videoPlaybackRow: document.getElementById('message-video-playback-row'),
        device: document.getElementById('message-preview-device'),
        overlay: document.getElementById('message-preview-overlay'),
        modeBadge: document.getElementById('message-preview-mode-badge'),
        message: document.getElementById('message-preview-message'),
        cta: document.getElementById('message-preview-cta'),
        ctaButtons: document.getElementById('message-preview-cta-buttons'),
        messageLabel: document.getElementById('message-preview-message-label'),
        messageHeadline: document.getElementById('message-preview-message-headline'),
        messageBody: document.getElementById('message-preview-message-body'),
        slot1Btn: document.getElementById('message-preview-slot-1-btn'),
        slot2Btn: document.getElementById('message-preview-slot-2-btn'),
        slot3Btn: document.getElementById('message-preview-slot-3-btn'),
      };
      const sectionToggles = form.querySelectorAll('.section-toggle[data-target]');
      const pickImageBtn = document.getElementById('message-pick-bg-image');
      const pickVideoBtn = document.getElementById('message-pick-bg-video');
      const campaignKeySuffixBtn = document.getElementById('message-campaign-key-suffix');
      if (!preview.device || !preview.message || !preview.cta) return;
      let lastBgMode = String(v('creativeBgMode', 'none')).toLowerCase();

      function setToggleExpanded(btn, expanded) {
        if (!btn) return;
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const chev = btn.querySelector('.section-toggle-chevron');
        if (chev) chev.textContent = expanded ? '▾' : '▸';
      }

      function syncCollapsibleSections() {
        sectionToggles.forEach(function (btn) {
          const targetId = btn.getAttribute('data-target');
          if (!targetId) return;
          const target = document.getElementById(targetId);
          if (!target) return;
          const expanded = btn.getAttribute('aria-expanded') === 'true';
          target.style.display = expanded ? '' : 'none';
          setToggleExpanded(btn, expanded);
        });
      }

      function bindCollapsibleSections() {
        sectionToggles.forEach(function (btn) {
          btn.addEventListener('click', function () {
            const targetId = btn.getAttribute('data-target');
            if (!targetId) return;
            const target = document.getElementById(targetId);
            if (!target) return;
            const nextExpanded = btn.getAttribute('aria-expanded') !== 'true';
            setToggleExpanded(btn, nextExpanded);
            target.style.display = nextExpanded ? '' : 'none';
          });
        });
        syncCollapsibleSections();
      }

      function appendDateSuffixToCampaignKey() {
        const keyInput = q('campaignKey');
        if (!keyInput) return;
        const now = new Date();
        const yyyy = String(now.getUTCFullYear());
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        const suffix = '-' + yyyy + '-' + mm + '-' + dd;
        const base = String(keyInput.value || '').trim();
        keyInput.value = (base ? base : 'campaign') + suffix;
        try { keyInput.focus(); } catch {}
      }

      function syncWidgetEditorState() {
        const msgEnabled = vb('creativeMessageEnabled', false);
        const ctaEnabled = vb('creativeCtaEnabled', false);
        if (preview.messageSection) {
          preview.messageSection.classList.toggle('section-disabled', !msgEnabled);
          preview.messageSection.querySelectorAll('input, select, textarea, button').forEach(function (el) {
            el.disabled = !msgEnabled;
          });
        }
        if (preview.ctaSection) {
          preview.ctaSection.classList.toggle('section-disabled', !ctaEnabled);
          preview.ctaSection.querySelectorAll('input, select, textarea, button').forEach(function (el) {
            el.disabled = !ctaEnabled;
          });
        }
      }

      function serializeForm() {
        const out = {};
        const fields = form.querySelectorAll('input[name], select[name], textarea[name]');
        fields.forEach(function (el) {
          const name = el.name;
          if (!name || name === 'csrf') return;
          if (el.type === 'checkbox') out[name] = el.checked ? '1' : '0';
          else out[name] = el.value == null ? '' : String(el.value);
        });
        return out;
      }

      function applyDraft(data) {
        if (!data || typeof data !== 'object') return;
        Object.keys(data).forEach(function (name) {
          const el = q(name);
          if (!el) return;
          if (el.type === 'checkbox') el.checked = String(data[name] || '') === '1';
          else el.value = String(data[name] == null ? '' : data[name]);
        });
      }

      function saveDraft() {
        try {
          sessionStorage.setItem(draftKey, JSON.stringify(serializeForm()));
        } catch {}
      }

      function restoreDraftIfAny() {
        if (skipDraftRestore) {
          try { sessionStorage.removeItem(draftKey); } catch {}
          return;
        }
        try {
          const raw = sessionStorage.getItem(draftKey);
          if (!raw) return;
          const parsed = JSON.parse(raw);
          applyDraft(parsed);
        } catch {}
      }

      function handlePickedAssetFromQuery() {
        try {
          const url = new URL(window.location.href);
          const pickedUploadId = String(url.searchParams.get('cvPickUploadId') || '').trim();
          const pickedType = String(url.searchParams.get('cvPickType') || '').trim().toLowerCase();
          if (!pickedUploadId) return;
          const uploadInput = q('creativeBgUploadId');
          if (uploadInput) uploadInput.value = pickedUploadId;
          const modeInput = q('creativeBgMode');
          if (modeInput) {
            if (pickedType === 'video' || pickedType === 'videooverlay') modeInput.value = 'video';
            else modeInput.value = 'image';
          }
          url.searchParams.delete('cvPickUploadId');
          url.searchParams.delete('cvPickType');
          const next = url.pathname + (url.search || '') + (url.hash || '');
          window.history.replaceState(window.history.state, '', next);
        } catch {}
      }

      function openAssetPicker(kind) {
        saveDraft();
        try {
          const here = new URL(window.location.href);
          here.searchParams.delete('cvPickUploadId');
          here.searchParams.delete('cvPickType');
          const returnHref = here.pathname + (here.search || '');
          const target = kind === 'video'
            ? ('/assets/video?mode=pick&pickType=video&return=' + encodeURIComponent(returnHref))
            : ('/assets/graphic?mode=pick&pickType=graphic&return=' + encodeURIComponent(returnHref));
          window.location.href = target;
        } catch {}
      }

      function syncScheduleDateTimeFields() {
        const pairs = [
          { hidden: 'startsAt', date: 'startsAtDate', time: 'startsAtTime' },
          { hidden: 'endsAt', date: 'endsAtDate', time: 'endsAtTime' },
        ];
        for (const p of pairs) {
          const hidden = q(p.hidden);
          if (!hidden) continue;
          const d = String(v(p.date, '') || '').trim();
          const t = String(v(p.time, '') || '').trim();
          const fallbackTime = p.hidden === 'startsAt' ? '00:00' : '23:59';
          hidden.value = d ? (d + 'T' + (t || fallbackTime)) : '';
        }
      }

      function updatePreview() {
        const bgMode = String(v('creativeBgMode', 'none')).toLowerCase();
        const bgVideoPlayback = String(v('creativeBgVideoPlayback', 'muted_autoplay')).toLowerCase() === 'tap_to_play_sound' ? 'tap_to_play_sound' : 'muted_autoplay';
        const bgUploadId = String(v('creativeBgUploadId', '')).trim();
        const bgOverlayColor = hex(v('creativeBgOverlayColor', '#000000'), '#000000');
        const bgOverlayOpacity = clamp(vn('creativeBgOverlayOpacity', 0.35), 0, 1);

        const msgEnabled = vb('creativeMessageEnabled', false);
        const msgPos = String(v('creativeMessagePosition', 'middle')).toLowerCase();
        const msgOffset = clamp(vn('creativeMessageOffsetPct', 0), 0, 80);
        const msgBg = hex(v('creativeMessageBgColor', '#0B1320'), '#0B1320');
        const msgBgOpacity = clamp(vn('creativeMessageBgOpacity', 0.55), 0, 1);
        const msgText = hex(v('creativeMessageTextColor', '#FFFFFF'), '#FFFFFF');

        const ctaEnabled = vb('creativeCtaEnabled', false);
        const ctaLayout = String(v('creativeCtaLayout', 'inline')).toLowerCase();
        const ctaSlotCount = clamp(vn('creativeCtaSlotCount', 2), 1, 3);
        const ctaPos = String(v('creativeCtaPosition', 'bottom')).toLowerCase();
        const ctaOffset = clamp(vn('creativeCtaOffsetPct', 0), 0, 80);
        const ctaBg = hex(v('creativeCtaBgColor', '#0B1320'), '#0B1320');
        const ctaBgOpacity = clamp(vn('creativeCtaBgOpacity', 0.55), 0, 1);
        const ctaText = hex(v('creativeCtaTextColor', '#FFFFFF'), '#FFFFFF');

        syncWidgetEditorState();

        const label = v('creativeMessageLabel', 'Message');
        const headline = v('headline', 'Message headline');
        const body = String(v('body', '') || '').trim();
        const primary = v('creativeCtaPrimaryLabel', 'Primary');
        const secondary = String(v('creativeCtaSecondaryLabel', '') || '').trim();
        const slotLabel = (slotIndex, fallback) => {
          const override = String(v('creativeCtaSlot' + slotIndex + 'LabelOverride', '') || '').trim();
          if (override) return override;
          const select = q('creativeCtaSlot' + slotIndex + 'DefinitionId');
          if (select && select.selectedIndex >= 0) {
            const selected = select.options[select.selectedIndex];
            if (selected && selected.textContent) {
              const raw = String(selected.textContent || '').trim();
              if (raw && raw !== '(none)') {
                const cut = raw.indexOf(' [');
                return (cut >= 0 ? raw.slice(0, cut) : raw).trim() || fallback;
              }
            }
          }
          return fallback;
        };
        const slot1 = slotLabel(1, primary || 'Primary');
        const slot2 = slotLabel(2, secondary || 'Secondary');
        const slot3 = slotLabel(3, 'Tertiary');
        const slotStyle = (slotIndex) => {
          return {
            bg: hex(v('creativeCtaSlot' + slotIndex + 'BgColor', ''), ''),
            bgOpacity: clamp(vn('creativeCtaSlot' + slotIndex + 'BgOpacity', 1), 0, 1),
            text: hex(v('creativeCtaSlot' + slotIndex + 'TextColor', ''), ''),
          };
        };
        const slot1Style = slotStyle(1);
        const slot2Style = slotStyle(2);
        const slot3Style = slotStyle(3);

        form.querySelectorAll('[data-slot-row]').forEach((row) => {
          const slot = Number(row.getAttribute('data-slot-row') || '0');
          row.style.display = slot >= 1 && slot <= ctaSlotCount ? 'grid' : 'none';
        });
        if (preview.videoPlaybackRow) preview.videoPlaybackRow.style.display = bgMode === 'video' ? '' : 'none';
        if (pickImageBtn) pickImageBtn.style.display = bgMode === 'image' ? '' : 'none';
        if (pickVideoBtn) pickVideoBtn.style.display = bgMode === 'video' ? '' : 'none';
        let mediaUrl = '';
        if (preview.device) {
          const dprRaw = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) ? Number(window.devicePixelRatio) : 1;
          const dpr = Math.max(1, Math.min(3, Math.round(dprRaw * 100) / 100));
          const orientation = preview.device.clientWidth > preview.device.clientHeight ? 'landscape' : 'portrait';
          mediaUrl = bgUploadId
            ? (bgMode === 'image'
              ? ('/api/uploads/' + encodeURIComponent(String(bgUploadId)) + '/image?mode=image&usage=message_bg&orientation=' + encodeURIComponent(orientation) + '&dpr=' + encodeURIComponent(String(dpr)))
              : ('/api/uploads/' + encodeURIComponent(String(bgUploadId)) + '/thumb'))
            : '';
        }
        if (window.__renderMessagePreview) {
          window.__renderMessagePreview(preview, {
            bgMode,
            bgVideoPlayback,
            bgUploadId,
            bgOverlayColor,
            bgOverlayOpacity,
            mediaUrl,
            message: {
              enabled: msgEnabled,
              position: msgPos,
              offsetPct: msgOffset,
              bgColor: msgBg,
              bgOpacity: msgBgOpacity,
              textColor: msgText,
              label,
              headline,
              body,
            },
            cta: {
              enabled: ctaEnabled,
              layout: ctaLayout,
              slotCount: ctaSlotCount,
              position: ctaPos,
              offsetPct: ctaOffset,
              bgColor: ctaBg,
              bgOpacity: ctaBgOpacity,
              textColor: ctaText,
              slots: [
                { label: slot1, bgColor: slot1Style.bg, bgOpacity: slot1Style.bgOpacity, textColor: slot1Style.text },
                { label: slot2, bgColor: slot2Style.bg, bgOpacity: slot2Style.bgOpacity, textColor: slot2Style.text },
                { label: slot3, bgColor: slot3Style.bg, bgOpacity: slot3Style.bgOpacity, textColor: slot3Style.text },
              ],
            },
          });
        }
      }

      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('notice')) sessionStorage.removeItem(draftKey);
      } catch {}

      bindCollapsibleSections();
      restoreDraftIfAny();
      handlePickedAssetFromQuery();
      syncScheduleDateTimeFields();
      lastBgMode = String(v('creativeBgMode', 'none')).toLowerCase();

      form.addEventListener('input', function () { syncScheduleDateTimeFields(); updatePreview(); saveDraft(); });
      form.addEventListener('change', function (event) {
        const target = event && event.target ? event.target : null;
        if (target && target.name === 'creativeBgMode') {
          const nextBgMode = String(v('creativeBgMode', 'none')).toLowerCase();
          if (nextBgMode !== lastBgMode) {
            const bgUploadInput = q('creativeBgUploadId');
            if (bgUploadInput) bgUploadInput.value = '';
            lastBgMode = nextBgMode;
          }
        }
        syncScheduleDateTimeFields();
        updatePreview();
        saveDraft();
      });
      form.addEventListener('click', function (event) {
        const source = event && event.target && event.target.closest ? event.target.closest('[data-picker-target]') : null;
        if (!source) return;
        const targetName = source.getAttribute('data-picker-target');
        if (!targetName) return;
        const input = q(targetName);
        if (!input) return;
        try {
          if (typeof input.showPicker === 'function') input.showPicker();
          else input.focus();
        } catch {
          try { input.focus(); } catch {}
        }
      });
      form.addEventListener('submit', function () { syncScheduleDateTimeFields(); try { sessionStorage.removeItem(draftKey); } catch {} });

      if (pickImageBtn) pickImageBtn.addEventListener('click', function () { openAssetPicker('image'); });
      if (pickVideoBtn) pickVideoBtn.addEventListener('click', function () { openAssetPicker('video'); });
      if (campaignKeySuffixBtn) campaignKeySuffixBtn.addEventListener('click', appendDateSuffixToCampaignKey);
      updatePreview();
    })();
  </script>`

  body += `</form>`

  body += `<div class="section">`
  body += `<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:space-between">`
  if (opts.showClone && id) {
    body += `<form method="post" action="/admin/messages/${id}/delete" style="margin:0" onsubmit="return confirm('Delete this message? This cannot be undone.');">`
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<button class="btn danger" type="submit">Delete</button></form>`
  } else {
    body += `<div></div>`
  }
  body += `<div style="display:flex; gap:8px; align-items:center; margin-left:auto">`
  if (opts.showClone && id) {
    body += `<form method="post" action="/admin/messages/${id}/clone" style="margin:0">`
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<button class="btn" type="submit">Clone</button></form>`
  }
  body += `<button class="btn btn-primary-accent" type="submit" form="message-editor-form">Save</button>`
  body += `</div>`
  body += `</div>`
  body += `</div>`

  return renderAdminPage({ title: opts.title, bodyHtml: body, active: 'messages' })
}

function withSupportIntentHref(baseHref: string, intentKey: string): string {
  const href = String(baseHref || '').trim()
  const intent = String(intentKey || '').trim().toLowerCase()
  if (!href) return href
  if (intent !== 'donate' && intent !== 'subscribe' && intent !== 'upgrade') return href
  try {
    const u = new URL(href, 'http://local.invalid')
    if (u.pathname !== '/support') return href
    u.searchParams.set('intent', intent)
    return `${u.pathname}${u.search}${u.hash || ''}`
  } catch {
    if (!href.startsWith('/support')) return href
    const hasQuery = href.includes('?')
    const hasIntent = /([?&])intent=/.test(href)
    if (hasIntent) return href.replace(/([?&])intent=[^&]*/i, `$1intent=${intent}`)
    return `${href}${hasQuery ? '&' : '?'}intent=${intent}`
  }
}

function withoutSupportIntentQuery(rawHref: string): string {
  const href = String(rawHref || '').trim()
  if (!href) return href
  try {
    const u = new URL(href, 'http://local.invalid')
    if (u.pathname !== '/support') return href
    u.searchParams.delete('intent')
    return `${u.pathname}${u.search}${u.hash || ''}`
  } catch {
    if (!href.startsWith('/support')) return href
    return href
      .replace(/([?&])intent=[^&]*(&?)/gi, (_m, p1, p2) => (p1 === '?' ? '?' : (p2 ? '&' : '')))
      .replace(/\?&/, '?')
      .replace(/[?&]$/, '')
  }
}

function buildMessageCtaCreateOrUpdatePayload(body: any): any {
  const executorType = String(body?.executorType || 'internal_link').trim().toLowerCase()
  const intentKey = String(body?.intentKey || 'visit_link').trim().toLowerCase()
  const completionContract = String(body?.completionContract || 'on_click').trim().toLowerCase()
  const status = String(body?.status || 'draft').trim().toLowerCase()

  let config: any = {}
  if (executorType === 'internal_link') {
    const baseHref = String(body?.configInternalHref || '').trim()
    config = {
      href: withSupportIntentHref(baseHref, intentKey),
      successReturn: String(body?.configInternalSuccessReturn || '').trim() || null,
      openInNewTab: parseBoolLoose(body?.configInternalOpenInNewTab, false),
    }
  } else if (executorType === 'api_action') {
    config = {
      endpointPath: String(body?.configApiEndpointPath || '').trim(),
      httpMethod: String(body?.configApiHttpMethod || 'POST').trim().toUpperCase(),
      successReturn: String(body?.configApiSuccessReturn || '').trim() || null,
    }
  } else if (executorType === 'advance_slide') {
    config = { mode: 'next_slide' }
  }

  return {
    name: String(body?.name || '').trim(),
    labelDefault: String(body?.labelDefault || '').trim(),
    status,
    intentKey,
    executorType,
    completionContract,
    config,
  }
}

function renderAdminMessageCtaForm(opts: {
  title: string
  action: string
  csrfToken?: string | null
  backHref: string
  values: any
  error?: string | null
  notice?: string | null
  showActions?: boolean
}): string {
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const values = opts.values || {}
  const id = Number(values?.id || 0) || null
  const executorType = String(values?.executorType || 'internal_link')
  const config = values?.config && typeof values.config === 'object' ? values.config : {}

  let body = `<h1>${escapeHtml(opts.title)}</h1>`
  body += `<div class="toolbar"><div><a href="${escapeHtml(opts.backHref)}">← Back to message CTAs</a></div><div></div></div>`
  if (opts.error) body += `<div class="error">${escapeHtml(String(opts.error))}</div>`
  if (opts.notice) body += `<div class="notice">${escapeHtml(String(opts.notice))}</div>`

  body += `<form method="post" action="${escapeHtml(opts.action)}" id="message-cta-editor-form">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`

  body += `<div class="section"><div class="section-title">Definition</div>`
  body += `<label>Name<input type="text" name="name" maxlength="120" value="${escapeHtml(String(values?.name || ''))}" required /></label>`
  body += `<label>Default Button Label<input type="text" name="labelDefault" maxlength="100" value="${escapeHtml(String(values?.labelDefault || ''))}" required /></label>`
  body += `<div style="display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">`
  body += `<label>Status<select name="status">`
  for (const opt of MESSAGE_CTA_STATUS_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${String(values?.status || 'draft') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `</div></div>`

  body += `<div class="section"><div class="section-title">Intent + Executor</div>`
  body += `<div style="display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">`
  body += `<label>Intent<select name="intentKey">`
  for (const opt of MESSAGE_CTA_INTENT_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${String(values?.intentKey || 'visit_link') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `<label>Executor<select name="executorType" id="executorType">`
  for (const opt of MESSAGE_CTA_EXECUTOR_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${executorType === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `<label>Completion Contract<select name="completionContract" id="completionContract">`
  for (const opt of MESSAGE_CTA_COMPLETION_CONTRACT_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${String(values?.completionContract || 'on_click') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `</div></div>`
  body += `<div class="field-hint" id="completionContractHint" style="margin-top:-2px"></div>`

  body += `<div class="section executor-config" data-executor="internal_link"><div class="section-title">Internal Link Config</div>`
  body += `<label>Base Href<input type="text" id="configInternalHref" name="configInternalHref" value="${escapeHtml(withoutSupportIntentQuery(String(config?.href || config?.returnUrl || config?.startPath || '')))}" placeholder="/channels/global-feed" /></label>`
  body += `<label>Resolved Href<input type="text" id="configInternalResolvedHref" value="${escapeHtml(String(config?.href || config?.returnUrl || config?.startPath || ''))}" readonly /></label>`
  body += `<div class="field-hint">For donate/subscribe/upgrade intents, <code>?intent=...</code> is applied automatically when needed.</div>`
  body += `<label>Success Return (optional)<input type="text" name="configInternalSuccessReturn" value="${escapeHtml(String(config?.successReturn || ''))}" placeholder="/" /></label>`
  body += `<label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" name="configInternalOpenInNewTab" value="1"${parseBoolLoose(config?.openInNewTab, false) ? ' checked' : ''}/> Open in new tab</label>`
  body += `</div>`

  body += `<div class="section executor-config" data-executor="api_action"><div class="section-title">API Action Config</div>`
  body += `<label>Endpoint Path<input type="text" name="configApiEndpointPath" value="${escapeHtml(String(config?.endpointPath || ''))}" placeholder="/api/cta/mock/complete" /></label>`
  body += `<div style="display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">`
  body += `<label>HTTP Method<select name="configApiHttpMethod">`
  for (const opt of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    body += `<option value="${opt}"${String(config?.httpMethod || 'POST').toUpperCase() === opt ? ' selected' : ''}>${opt}</option>`
  }
  body += `</select></label>`
  body += `<label>Success Return (optional)<input type="text" name="configApiSuccessReturn" value="${escapeHtml(String(config?.successReturn || ''))}" placeholder="/" /></label>`
  body += `</div></div>`

  body += `<div class="section executor-config" data-executor="advance_slide"><div class="section-title">Advance Slide Config</div>`
  body += `<div class="field-hint">This CTA records click/outcome analytics and advances to the next slide without navigation.</div>`
  body += `</div>`

  body += `<div class="toolbar"><div></div><div style="display:flex; gap:8px"><button class="btn btn-primary-accent" type="submit">Save</button></div></div>`
  body += `</form>`

  if (opts.showActions && id) {
    body += `<div class="section"><div class="section-title">Actions</div>`
    body += `<div style="display:flex; gap:8px; align-items:center; justify-content:space-between">`
    body += `<form method="post" action="/admin/message-ctas/${id}/archive" style="margin:0" onsubmit="return confirm('Archive this CTA definition?');">`
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<button class="btn danger" type="submit">Archive</button></form>`
    body += `<form method="post" action="/admin/message-ctas/${id}/clone" style="margin:0 0 0 auto">`
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<button class="btn" type="submit">Clone</button></form>`
    body += `</div></div>`
  }

  body += `<script>
    (function () {
      const executorSel = document.getElementById('executorType');
      const intentSel = document.querySelector('select[name="intentKey"]');
      const completionSel = document.getElementById('completionContract');
      const hrefInput = document.getElementById('configInternalHref');
      const resolvedHrefInput = document.getElementById('configInternalResolvedHref');
      const completionHint = document.getElementById('completionContractHint');
      function withIntentQuery(baseHref, intent) {
        const href = String(baseHref || '').trim();
        const flow = String(intent || '').trim().toLowerCase();
        if (!href) return '';
        if (flow !== 'donate' && flow !== 'subscribe' && flow !== 'upgrade') return href;
        try {
          const u = new URL(href, window.location.origin);
          if (u.pathname === '/support') u.searchParams.set('intent', flow);
          return (u.origin === window.location.origin) ? (u.pathname + u.search + (u.hash || '')) : u.toString();
        } catch {
          if (!href.startsWith('/support')) return href;
          const hasQuery = href.includes('?');
          const hasIntent = /([?&])intent=/.test(href);
          if (hasIntent) return href.replace(/([?&])intent=[^&]*/i, '$1intent=' + flow);
          return href + (hasQuery ? '&' : '?') + 'intent=' + flow;
        }
      }
      function syncResolvedHref() {
        if (!resolvedHrefInput) return;
        const baseHref = hrefInput && 'value' in hrefInput ? hrefInput.value : '';
        const intent = intentSel && 'value' in intentSel ? intentSel.value : '';
        resolvedHrefInput.value = withIntentQuery(baseHref, intent);
      }
      function syncExecutor() {
        const current = String(executorSel && executorSel.value || 'internal_link');
        document.querySelectorAll('.executor-config').forEach((el) => {
          const show = el.getAttribute('data-executor') === current;
          el.style.display = show ? '' : 'none';
        });
      }
      function syncCompletionHint() {
        if (!completionHint) return;
        const intent = String(intentSel && intentSel.value || '');
        const executor = String(executorSel && executorSel.value || '');
        const contract = String(completionSel && completionSel.value || 'on_click');
        let text = '';
        let level = '';
        if ((intent === 'donate' || intent === 'subscribe' || intent === 'upgrade') && contract === 'on_click') {
          text = 'Warning: support intents usually require conversion completion. Consider On Return or On Verified.';
          level = 'warn';
        } else if ((intent === 'verify_email' || intent === 'verify_phone') && contract !== 'on_verified') {
          text = 'Warning: verification intents usually use On Verified to avoid premature completion.';
          level = 'warn';
        } else if (executor === 'api_action' && contract === 'on_verified') {
          text = 'Warning: API Action does not imply verified state unless your endpoint emits verified completion explicitly.';
          level = 'warn';
        } else if (executor === 'advance_slide' && contract === 'on_verified') {
          text = 'Warning: Advance Slide does not emit verified completion. Use On Click, On Return, or None.';
          level = 'warn';
        } else {
          text = 'Completion contract controls when this CTA emits canonical completion (used by suppression and journey progression).';
        }
        completionHint.textContent = text;
        completionHint.style.color = level === 'warn' ? '#f59e0b' : '';
      }
      if (executorSel) executorSel.addEventListener('change', syncExecutor);
      if (intentSel) intentSel.addEventListener('change', syncResolvedHref);
      if (intentSel) intentSel.addEventListener('change', syncCompletionHint);
      if (executorSel) executorSel.addEventListener('change', syncCompletionHint);
      if (completionSel) completionSel.addEventListener('change', syncCompletionHint);
      if (hrefInput) hrefInput.addEventListener('input', syncResolvedHref);
      syncExecutor();
      syncResolvedHref();
      syncCompletionHint();
    })();
  </script>`

  return renderAdminPage({ title: opts.title, bodyHtml: body, active: 'message_ctas' })
}

async function loadMessageCtaOptionsForEditor(actorUserId: number): Promise<Array<{
  id: number
  name: string
  labelDefault: string
  intentKey: string
  executorType: string
  status: string
}>> {
  const defs = await messageCtasSvc.listMessageCtaDefinitionsForAdmin({
    actorUserId,
    includeArchived: true,
    limit: 500,
  })
  return defs
    .map((item) => ({
      id: Number(item.id),
      name: String(item.name || ''),
      labelDefault: String(item.labelDefault || ''),
      intentKey: String(item.intentKey || ''),
      executorType: String(item.executorType || ''),
      status: String(item.status || ''),
    }))
    .sort((a, b) => a.id - b.id)
}

async function loadMessageEligibilityRulesetOptionsForEditor(): Promise<Array<{
  id: number
  name: string
  status: string
  criteria: Record<string, any>
}>> {
  const items = await messageRulesetsSvc.listRulesetsForAdmin({
    includeArchived: true,
    limit: 500,
  })
  return items
    .map((item) => ({
      id: Number(item.id),
      name: String(item.name || ''),
      status: String(item.status || 'draft'),
      criteria: item.criteria && typeof item.criteria === 'object' ? (item.criteria as Record<string, any>) : { version: 1, inclusion: [], exclusion: [] },
    }))
    .sort((a, b) => a.id - b.id)
}

async function loadJourneyStepRefsForMessageEditor(messageId: number): Promise<Array<{
  journeyId: number
  journeyKey: string
  journeyStatus: string
  stepId: number
  stepKey: string
  stepOrder: number
}>> {
  const refs = await messageJourneysSvc.listJourneyStepRefsForMessage(messageId)
  return refs.map((ref) => ({
    journeyId: Number(ref.journeyId),
    journeyKey: String(ref.journeyKey || ''),
    journeyStatus: String(ref.journeyStatus || ''),
    stepId: Number(ref.stepId),
    stepKey: String(ref.stepKey || ''),
    stepOrder: Number(ref.stepOrder || 0),
  }))
}

async function loadSurfaceTargetOptionsForEditor(): Promise<{
  groups: Array<{ id: number; name: string; slug: string }>
  channels: Array<{ id: number; name: string; slug: string }>
}> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, name, slug, type
       FROM spaces
      WHERE type IN ('group','channel')
        AND NOT (type = 'channel' AND slug IN ('global', 'global-feed'))
      ORDER BY name ASC, id ASC
      LIMIT 2000`
  )
  const groups: Array<{ id: number; name: string; slug: string }> = []
  const channels: Array<{ id: number; name: string; slug: string }> = []
  for (const row of rows as any[]) {
    const id = Number(row.id || 0)
    if (!Number.isFinite(id) || id <= 0) continue
    const name = String(row.name || '').trim() || `Space #${id}`
    const slug = String(row.slug || '').trim()
    const type = String(row.type || '').trim().toLowerCase()
    if (type === 'group') groups.push({ id, name, slug })
    if (type === 'channel') channels.push({ id, name, slug })
  }
  return { groups, channels }
}

async function loadCampaignCategoryOptionsForEditor(): Promise<string[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT category
       FROM (
         SELECT DISTINCT LOWER(TRIM(campaign_category)) AS category
           FROM feed_messages
          WHERE campaign_category IS NOT NULL
            AND TRIM(campaign_category) <> ''
         UNION
         SELECT DISTINCT LOWER(TRIM(campaign_category)) AS category
           FROM feed_message_journeys
          WHERE campaign_category IS NOT NULL
            AND TRIM(campaign_category) <> ''
       ) t
      WHERE category IS NOT NULL
        AND category <> ''
      ORDER BY category ASC
      LIMIT 500`
  )
  return (rows as any[])
    .map((r) => String(r.category || '').trim().toLowerCase())
    .filter((v) => !!v)
}

async function loadMessageCampaignKeyOptionsForAnalytics(): Promise<string[]> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT DISTINCT LOWER(TRIM(campaign_key)) AS campaign_key
       FROM feed_messages
      WHERE campaign_key IS NOT NULL
        AND TRIM(campaign_key) <> ''
      ORDER BY campaign_key ASC
      LIMIT 1000`
  )
  return (rows as any[])
    .map((r) => String(r.campaign_key || '').trim().toLowerCase())
    .filter((v) => !!v)
}

function parseStringListField(raw: any): string[] {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) return raw.map((v) => String(v || '').trim()).filter(Boolean)
  return [String(raw).trim()].filter(Boolean)
}

function parseSurfaceTargetingFromBody(body: any, fallbackSurface: string = 'global_feed'): Array<{
  surface: 'global_feed' | 'group_feed' | 'channel_feed'
  targetingMode: 'all' | 'selected'
  targetIds: number[]
}> {
  const hasGlobal = String(body?.surfaceGlobalFeed || '').trim() === '1'
  const hasGroups = String(body?.surfaceGroupFeed || '').trim() === '1'
  const hasChannels = String(body?.surfaceChannelFeed || '').trim() === '1'
  const groupMode = String(body?.surfaceGroupFeedMode || 'all').trim().toLowerCase() === 'selected' ? 'selected' : 'all'
  const channelMode = String(body?.surfaceChannelFeedMode || 'all').trim().toLowerCase() === 'selected' ? 'selected' : 'all'
  const groupTargetIds = Array.from(new Set(parseStringListField(body?.surfaceGroupTargetIds)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n))))
  const channelTargetIds = Array.from(new Set(parseStringListField(body?.surfaceChannelTargetIds)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n))))

  const out: Array<{ surface: 'global_feed' | 'group_feed' | 'channel_feed'; targetingMode: 'all' | 'selected'; targetIds: number[] }> = []
  const normalizedGroupMode: 'all' | 'selected' = groupTargetIds.length > 0 ? 'selected' : groupMode
  const normalizedChannelMode: 'all' | 'selected' = channelTargetIds.length > 0 ? 'selected' : channelMode

  if (hasGlobal) out.push({ surface: 'global_feed', targetingMode: 'all', targetIds: [] })
  if (hasGroups) out.push({ surface: 'group_feed', targetingMode: normalizedGroupMode, targetIds: normalizedGroupMode === 'selected' ? groupTargetIds : [] })
  if (hasChannels) out.push({ surface: 'channel_feed', targetingMode: normalizedChannelMode, targetIds: normalizedChannelMode === 'selected' ? channelTargetIds : [] })
  if (!out.length) {
    const normalizedFallback = String(fallbackSurface || 'global_feed').trim().toLowerCase()
    const surface = normalizedFallback === 'group_feed' || normalizedFallback === 'channel_feed' ? normalizedFallback : 'global_feed'
    out.push({ surface: surface as any, targetingMode: 'all', targetIds: [] })
  }
  return out
}

pagesRouter.get('/admin/messages', async (req: any, res: any) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const status = req.query?.status ? String(req.query.status) : ''
    const messageType = req.query?.message_type ? String(req.query.message_type) : ''
    const appliesToSurface = req.query?.applies_to_surface ? String(req.query.applies_to_surface) : ''
    const deliveryScope = req.query?.delivery_scope ? String(req.query.delivery_scope) : ''
    const campaignKey = req.query?.campaign_key ? String(req.query.campaign_key) : ''
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''
    const items = await messagesSvc.listMessagesForAdmin({
      includeArchived,
      limit: 500,
      status,
      messageType,
      appliesToSurface,
      deliveryScope,
      campaignKey,
    })
    const rulesets = await messageRulesetsSvc.listRulesetsForAdmin({ includeArchived: false, limit: 500 })
    const rulesetNameById = new Map<number, string>()
    for (const r of rulesets) {
      const id = Number((r as any).id)
      if (!Number.isFinite(id) || id <= 0) continue
      rulesetNameById.set(id, String((r as any).name || `Ruleset #${id}`))
    }

    let body = `<style>
      .messages-nebula { min-height: 100vh; position: relative; color: #fff; font-family: system-ui, sans-serif; background: #050508; margin: -16px; padding: 16px; }
      .messages-nebula-bg { position: fixed; inset: 0; background-image: url('/nebula_bg.jpg'); background-position: center; background-repeat: no-repeat; background-size: cover; z-index: 0; pointer-events: none; }
      .messages-nebula-content { position: relative; z-index: 1; }
      .messages-nebula h1 { color: #ffd60a; margin: 0 0 10px 0; }
      .messages-nebula .toolbar { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
      .messages-nebula .pill { background: rgba(6,8,12,0.6); border: 1px solid rgba(255,255,255,0.2); border-radius: 999px; padding: 6px 10px; }
      .messages-nebula .msg-btn { display: inline-block; padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(120,180,255,0.45); text-decoration: none; color: #fff; background: linear-gradient(180deg, rgba(52,123,255,0.35), rgba(23,66,160,0.3)); }
      .messages-nebula .section { background: rgba(6,8,12,0.5); border: 1px solid rgba(255,255,255,0.18); border-radius: 14px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 12px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08); }
      .messages-nebula label { color: #f0f2f5; }
      .messages-nebula input, .messages-nebula select { background: rgba(0,0,0,0.35); color: #fff; border: 1px solid rgba(255,255,255,0.25); }
      .messages-nebula .btn { background: linear-gradient(180deg, rgba(52,123,255,0.35), rgba(23,66,160,0.3)); border: 1px solid rgba(120,180,255,0.45); color: #fff; }
      .messages-nebula .message-list { display: grid; gap: 12px; }
      .messages-nebula .message-card { position: relative; padding-top: 30px; }
      .messages-nebula .message-card-id { position: absolute; top: 10px; right: 12px; opacity: 0.85; font-size: 13px; }
      .messages-nebula .message-card-name { font-size: 18px; font-weight: 700; line-height: 1.2; margin-bottom: 2px; }
      @media (max-width: 640px) {
        .messages-nebula { margin: -12px; padding: 12px; }
      }
    </style>`
    body += '<div class="messages-nebula"><div class="messages-nebula-bg"></div><div class="messages-nebula-content">'
    body += '<h1>Messages</h1>'
    body += '<div class="toolbar"><div><span class="pill">Message Registry</span></div><div><a class="msg-btn" href="/admin/messages/new">New message</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<form id="messagesFilterForm" method="get" action="/admin/messages" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end">`
    body += `<label style="min-width:160px">Status<select name="status">
      <option value="">All</option>
      <option value="draft"${status === 'draft' ? ' selected' : ''}>Draft</option>
      <option value="active"${status === 'active' ? ' selected' : ''}>Active</option>
      <option value="paused"${status === 'paused' ? ' selected' : ''}>Paused</option>
      <option value="archived"${status === 'archived' ? ' selected' : ''}>Archived</option>
    </select></label>`
    body += `<label style="min-width:210px">Type<select name="message_type"><option value="">All</option>`
    for (const opt of MESSAGE_TYPE_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${messageType === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label style="min-width:170px">Surface<select name="applies_to_surface"><option value="">All</option>`
    for (const opt of MESSAGE_SURFACE_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${appliesToSurface === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label style="min-width:170px">Scope<select name="delivery_scope">
      <option value=""${deliveryScope === '' ? ' selected' : ''}>All</option>
      <option value="both"${deliveryScope === 'both' ? ' selected' : ''}>Both</option>
      <option value="journey_only"${deliveryScope === 'journey_only' ? ' selected' : ''}>Journey</option>
      <option value="standalone_only"${deliveryScope === 'standalone_only' ? ' selected' : ''}>Standalone</option>
    </select></label>`
    body += `<label style="min-width:180px">Campaign Key<input type="text" name="campaign_key" value="${escapeHtml(campaignKey)}" /></label>`
    body += `<label><input type="checkbox" name="include_archived" value="1"${includeArchived ? ' checked' : ''} /> Include archived</label>`
    body += `</div></form>`
    body += `<script>
      (function(){
        var form = document.getElementById('messagesFilterForm');
        if (!form) return;
        var debounceTimer = null;
        var submitNow = function(){ form.submit(); };
        var applyCampaignClientFilter = function() {
          var campaignInput = form.querySelector('input[name="campaign_key"]');
          var q = campaignInput ? String(campaignInput.value || '').toLowerCase().trim() : '';
          var cards = document.querySelectorAll('.message-card');
          for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var key = String(card.getAttribute('data-campaign-key') || '');
            card.style.display = q === '' || key.indexOf(q) !== -1 ? '' : 'none';
          }
        };
        var applyCampaignClientFilterDebounced = function(){
          if (debounceTimer) window.clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(applyCampaignClientFilter, 100);
        };
        var controls = form.querySelectorAll('select,input[type="checkbox"]');
        for (var i = 0; i < controls.length; i++) {
          controls[i].addEventListener('change', submitNow);
        }
        var campaignInput = form.querySelector('input[name="campaign_key"]');
        if (campaignInput) {
          campaignInput.addEventListener('input', applyCampaignClientFilterDebounced);
        }
        applyCampaignClientFilter();
      })();
    </script>`

    if (!items.length) {
      body += '<p>No messages found for current filters.</p>'
    } else {
      body += '<div class="message-list">'
      for (const item of items) {
        const windowLabel = item.startsAt || item.endsAt ? `${item.startsAt || '—'} → ${item.endsAt || '—'}` : 'Always'
        const rulesetLabel =
          item.eligibilityRulesetId == null
            ? '—'
            : escapeHtml(rulesetNameById.get(Number(item.eligibilityRulesetId)) || `Ruleset #${Number(item.eligibilityRulesetId)}`)
        body += `<div class="section message-card" data-campaign-key="${escapeHtml(String(item.campaignKey || '').toLowerCase())}" style="margin:0">
          <div class="message-card-id">${item.id}</div>
          <div style="font-size:14px; display:grid; gap:6px">
            <div class="message-card-name"><a href="/admin/messages/${item.id}">${escapeHtml(item.name)}</a></div>
            <div><strong>Type:</strong> ${escapeHtml(item.type)}</div>
            <div><strong>Surface:</strong> ${escapeHtml(item.appliesToSurface)}</div>
            <div><strong>Scope:</strong> ${escapeHtml(String((item as any).deliveryScope || 'both'))}</div>
            <div><strong>Campaign Key:</strong> ${escapeHtml(item.campaignKey || '—')}</div>
            <div><strong>Ruleset:</strong> ${rulesetLabel}</div>
            <div><strong>Priority:</strong> ${item.priority}</div>
            <div><strong>Status:</strong> ${escapeHtml(item.status)}</div>
            <div><strong>Window:</strong> ${escapeHtml(windowLabel)}</div>
            <div><strong>Updated:</strong> ${escapeHtml(item.updatedAt || '')}</div>
          </div>
        </div>`
      }
      body += '</div>'
    }

    body += '</div></div>'

    const doc = renderAdminPage({ title: 'Messages', bodyHtml: body, active: 'messages' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin messages list failed', { path: req.path })
    res.status(500).send('Failed to load messages')
  }
})

pagesRouter.get('/admin/messages/new', async (req: any, res: any) => {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const ctaDefinitionOptions = await loadMessageCtaOptionsForEditor(Number(req.user?.id || 0))
    const eligibilityRulesetOptions = await loadMessageEligibilityRulesetOptionsForEditor()
    const campaignCategoryOptions = await loadCampaignCategoryOptionsForEditor()
    const surfaceTargetOptions = await loadSurfaceTargetOptionsForEditor()
    const doc = renderAdminMessageForm({
      title: 'New Message',
      action: '/admin/messages',
      csrfToken,
      backHref: '/admin/messages',
      ctaDefinitionOptions,
      eligibilityRulesetOptions,
      campaignCategoryOptions,
      surfaceTargetOptions,
      values: {
        name: '',
        headline: '',
        body: '',
        creativeCtaPrimaryLabel: 'Register',
        creativeCtaSecondaryLabel: 'Log In',
        creativeCtaAuthPrimaryHref: '/register?return=/',
        creativeCtaAuthSecondaryHref: '/login?return=/',
        creativeCtaType: 'auth',
        creativeCtaLayout: 'inline',
        creativeCtaEnabled: '1',
        creativeCtaPosition: 'bottom',
        creativeCtaOffsetPct: 0,
        creativeCtaBgColor: '#0B1320',
        creativeCtaBgOpacity: 0.55,
        creativeCtaTextColor: '#FFFFFF',
        creativeCtaDonateProvider: 'mock',
        creativeCtaDonateCampaignKey: '',
        creativeCtaDonateSuccessReturn: '/channels/global-feed',
        creativeCtaSubscribeProvider: 'mock',
        creativeCtaSubscribePlanKey: '',
        creativeCtaSubscribeSuccessReturn: '/channels/global-feed',
        creativeCtaUpgradeTargetTier: '',
        creativeCtaUpgradeSuccessReturn: '/channels/global-feed',
        type: 'register_login',
        appliesToSurface: 'global_feed',
        surfaceTargeting: [{ surface: 'global_feed', targetingMode: 'all', targetIds: [] }],
        tieBreakStrategy: 'round_robin',
        deliveryScope: 'both',
        campaignKey: '',
        eligibilityRulesetId: '',
        priority: 100,
        status: 'draft',
        startsAt: '',
        endsAt: '',
        mediaUploadId: '',
      },
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message new page failed', { path: req.path })
    res.status(500).send('Failed to load message editor')
  }
})

pagesRouter.post('/admin/messages', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildMessageCreateOrUpdatePayload(req.body || {})
  let ctaDefinitionOptions: Awaited<ReturnType<typeof loadMessageCtaOptionsForEditor>> = []
  let eligibilityRulesetOptions: Awaited<ReturnType<typeof loadMessageEligibilityRulesetOptionsForEditor>> = []
  let campaignCategoryOptions: Awaited<ReturnType<typeof loadCampaignCategoryOptionsForEditor>> = []
  let surfaceTargetOptions: Awaited<ReturnType<typeof loadSurfaceTargetOptionsForEditor>> = { groups: [], channels: [] }
  try {
    ctaDefinitionOptions = await loadMessageCtaOptionsForEditor(Number(req.user?.id || 0))
    eligibilityRulesetOptions = await loadMessageEligibilityRulesetOptionsForEditor()
    campaignCategoryOptions = await loadCampaignCategoryOptionsForEditor()
    surfaceTargetOptions = await loadSurfaceTargetOptionsForEditor()
    const created = await messagesSvc.createMessageForAdmin(payload, Number(req.user?.id || 0))
    res.redirect(`/admin/messages/${created.id}?notice=${encodeURIComponent('Message created.')}`)
  } catch (err: any) {
    const doc = renderAdminMessageForm({
      title: 'New Message',
      action: '/admin/messages',
      csrfToken,
      backHref: '/admin/messages',
      ctaDefinitionOptions,
      eligibilityRulesetOptions,
      campaignCategoryOptions,
      surfaceTargetOptions,
      values: payload,
      error: String(err?.message || 'Failed to create message'),
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.get('/admin/messages/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad message id')
  try {
    const [message, journeyStepRefs] = await Promise.all([
      messagesSvc.getMessageForAdmin(id),
      loadJourneyStepRefsForMessageEditor(id),
    ])
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const ctaDefinitionOptions = await loadMessageCtaOptionsForEditor(Number(req.user?.id || 0))
    const eligibilityRulesetOptions = await loadMessageEligibilityRulesetOptionsForEditor()
    const campaignCategoryOptions = await loadCampaignCategoryOptionsForEditor()
    const surfaceTargetOptions = await loadSurfaceTargetOptionsForEditor()
    const doc = renderAdminMessageForm({
      title: `Edit Message #${id}`,
      action: `/admin/messages/${id}`,
      csrfToken,
      backHref: '/admin/messages',
      ctaDefinitionOptions,
      eligibilityRulesetOptions,
      campaignCategoryOptions,
      surfaceTargetOptions,
      journeyStepRefs,
      values: message,
      notice: req.query?.notice ? String(req.query.notice) : '',
      error: req.query?.error ? String(req.query.error) : '',
      showClone: true,
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message detail failed', { path: req.path, message_id: id })
    res.status(404).send('Message not found')
  }
})

pagesRouter.post('/admin/messages/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad message id')
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildMessageCreateOrUpdatePayload(req.body || {})
  let ctaDefinitionOptions: Awaited<ReturnType<typeof loadMessageCtaOptionsForEditor>> = []
  let eligibilityRulesetOptions: Awaited<ReturnType<typeof loadMessageEligibilityRulesetOptionsForEditor>> = []
  let campaignCategoryOptions: Awaited<ReturnType<typeof loadCampaignCategoryOptionsForEditor>> = []
  let surfaceTargetOptions: Awaited<ReturnType<typeof loadSurfaceTargetOptionsForEditor>> = { groups: [], channels: [] }
  try {
    ctaDefinitionOptions = await loadMessageCtaOptionsForEditor(Number(req.user?.id || 0))
    eligibilityRulesetOptions = await loadMessageEligibilityRulesetOptionsForEditor()
    campaignCategoryOptions = await loadCampaignCategoryOptionsForEditor()
    surfaceTargetOptions = await loadSurfaceTargetOptionsForEditor()
    await messagesSvc.updateMessageForAdmin(id, payload, Number(req.user?.id || 0))
    res.redirect(`/admin/messages/${id}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    const doc = renderAdminMessageForm({
      title: `Edit Message #${id}`,
      action: `/admin/messages/${id}`,
      csrfToken,
      backHref: '/admin/messages',
      ctaDefinitionOptions,
      eligibilityRulesetOptions,
      campaignCategoryOptions,
      surfaceTargetOptions,
      values: { ...payload, id },
      error: String(err?.message || 'Failed to save message'),
      showClone: true,
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.post('/admin/messages/:id/clone', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/messages?error=bad_id')
  try {
    const cloned = await messagesSvc.cloneMessageForAdmin(id, Number(req.user?.id || 0))
    res.redirect(`/admin/messages/${cloned.id}?notice=${encodeURIComponent(`Cloned from #${id}.`)}`)
  } catch (err: any) {
    res.redirect(`/admin/messages/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to clone message'))}`)
  }
})

pagesRouter.post('/admin/messages/:id/status', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/messages?error=bad_id')
  try {
    await messagesSvc.updateMessageStatusForAdmin(id, req.body?.status, Number(req.user?.id || 0))
    res.redirect(`/admin/messages/${id}?notice=${encodeURIComponent('Status updated.')}`)
  } catch (err: any) {
    res.redirect(`/admin/messages/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to update status'))}`)
  }
})

pagesRouter.post('/admin/messages/:id/delete', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/messages?error=bad_id')
  try {
    await messagesSvc.deleteMessageForAdmin(id, Number(req.user?.id || 0))
    res.redirect(`/admin/messages?notice=${encodeURIComponent(`Deleted message #${id}.`)}`)
  } catch (err: any) {
    res.redirect(`/admin/messages/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to delete message'))}`)
  }
})

pagesRouter.get('/admin/message-ctas', async (req: any, res: any) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const status = req.query?.status ? String(req.query.status) : ''
    const intentKey = req.query?.intent_key ? String(req.query.intent_key) : ''
    const executorType = req.query?.executor_type ? String(req.query.executor_type) : ''
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''

    const items = await messageCtasSvc.listMessageCtaDefinitionsForAdmin({
      actorUserId: Number(req.user?.id || 0),
      includeArchived,
      limit: 500,
      status: status || null as any,
      intentKey: intentKey || null as any,
      executorType: executorType || null as any,
    })

    let body = '<h1>Message CTAs</h1>'
    body += '<div class="toolbar"><div><span class="pill">CTA Library</span></div><div><a href="/admin/message-ctas/new">New CTA</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<form method="get" action="/admin/message-ctas" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end">`
    body += `<label style="min-width:150px">Status<select name="status"><option value="">All</option>`
    for (const opt of MESSAGE_CTA_STATUS_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${status === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label style="min-width:190px">Intent<select name="intent_key"><option value="">All</option>`
    for (const opt of MESSAGE_CTA_INTENT_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${intentKey === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label style="min-width:190px">Executor<select name="executor_type"><option value="">All</option>`
    for (const opt of MESSAGE_CTA_EXECUTOR_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${executorType === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label><input type="checkbox" name="include_archived" value="1"${includeArchived ? ' checked' : ''} /> Include archived</label>`
    body += `<button class="btn" type="submit">Apply</button>`
    body += `</div></form>`

    if (!items.length) {
      body += '<p>No CTA definitions found for current filters.</p>'
    } else {
      body += '<table><thead><tr><th>ID</th><th>Name</th><th>Intent</th><th>Executor</th><th>Completion</th><th>Label</th><th>Status</th><th>Updated</th></tr></thead><tbody>'
      for (const item of items) {
        body += `<tr>
          <td>${item.id}</td>
          <td><a href="/admin/message-ctas/${item.id}">${escapeHtml(item.name)}</a></td>
          <td>${escapeHtml(item.intentKey)}</td>
          <td>${escapeHtml(item.executorType)}</td>
          <td>${escapeHtml(item.completionContract)}</td>
          <td>${escapeHtml(item.labelDefault)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.updatedAt || '')}</td>
        </tr>`
      }
      body += '</tbody></table>'
    }

    const doc = renderAdminPage({ title: 'Message CTAs', bodyHtml: body, active: 'message_ctas' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message ctas list failed', { path: req.path })
    res.status(500).send('Failed to load message ctas')
  }
})

pagesRouter.get('/admin/message-ctas/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const doc = renderAdminMessageCtaForm({
    title: 'New Message CTA',
    action: '/admin/message-ctas',
    csrfToken,
    backHref: '/admin/message-ctas',
      values: {
        name: '',
        labelDefault: '',
        status: 'draft',
        intentKey: 'visit_link',
        executorType: 'internal_link',
        completionContract: 'on_click',
      config: {
        href: '/',
        successReturn: '/',
        openInNewTab: false,
      },
    },
  })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
})

pagesRouter.post('/admin/message-ctas', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildMessageCtaCreateOrUpdatePayload(req.body || {})
  try {
    const created = await messageCtasSvc.createMessageCtaDefinitionForAdmin(payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-ctas/${created.id}?notice=${encodeURIComponent('Message CTA created.')}`)
  } catch (err: any) {
    const doc = renderAdminMessageCtaForm({
      title: 'New Message CTA',
      action: '/admin/message-ctas',
      csrfToken,
      backHref: '/admin/message-ctas',
      values: payload,
      error: String(err?.message || 'Failed to create CTA definition'),
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.get('/admin/message-ctas/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad message CTA id')
  try {
    const item = await messageCtasSvc.getMessageCtaDefinitionForAdmin(id, Number(req.user?.id || 0))
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminMessageCtaForm({
      title: `Edit Message CTA #${id}`,
      action: `/admin/message-ctas/${id}`,
      csrfToken,
      backHref: '/admin/message-ctas',
      values: item,
      notice: req.query?.notice ? String(req.query.notice) : '',
      error: req.query?.error ? String(req.query.error) : '',
      showActions: true,
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message cta detail failed', { path: req.path, message_cta_id: id })
    res.status(404).send('Message CTA not found')
  }
})

pagesRouter.post('/admin/message-ctas/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad message CTA id')
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildMessageCtaCreateOrUpdatePayload(req.body || {})
  try {
    await messageCtasSvc.updateMessageCtaDefinitionForAdmin(id, payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-ctas/${id}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    const doc = renderAdminMessageCtaForm({
      title: `Edit Message CTA #${id}`,
      action: `/admin/message-ctas/${id}`,
      csrfToken,
      backHref: '/admin/message-ctas',
      values: { ...payload, id },
      error: String(err?.message || 'Failed to save CTA definition'),
      showActions: true,
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.post('/admin/message-ctas/:id/clone', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/message-ctas?error=bad_id')
  try {
    const cloned = await messageCtasSvc.cloneMessageCtaDefinitionForAdmin(id, Number(req.user?.id || 0))
    res.redirect(`/admin/message-ctas/${cloned.id}?notice=${encodeURIComponent(`Cloned from #${id}.`)}`)
  } catch (err: any) {
    res.redirect(`/admin/message-ctas/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to clone CTA definition'))}`)
  }
})

pagesRouter.post('/admin/message-ctas/:id/archive', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/message-ctas?error=bad_id')
  try {
    await messageCtasSvc.archiveMessageCtaDefinitionForAdmin(id, Number(req.user?.id || 0))
    res.redirect(`/admin/message-ctas/${id}?notice=${encodeURIComponent('Archived.')}`)
  } catch (err: any) {
    res.redirect(`/admin/message-ctas/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to archive CTA definition'))}`)
  }
})

function buildMessageRulesetCreateOrUpdatePayload(body: any): any {
  return {
    name: String(body?.name || '').trim(),
    status: String(body?.status || 'draft').trim().toLowerCase(),
    description: String(body?.description || '').trim() || null,
    criteria: String(body?.criteriaJson || body?.criteria_json || '').trim(),
  }
}

function renderAdminMessageRulesetForm(opts: {
  title: string
  action: string
  csrfToken?: string | null
  backHref: string
  values: any
  error?: string | null
  notice?: string | null
}): string {
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const values = opts.values || {}
  const criteriaValue = String(values?.criteriaJson || values?.criteria || '').trim()

  let body = `<h1>${escapeHtml(opts.title)}</h1>`
  body += `<div class="toolbar"><div><a href="${escapeHtml(opts.backHref)}">← Back to message rulesets</a></div><div></div></div>`
  if (opts.error) body += `<div class="error">${escapeHtml(String(opts.error))}</div>`
  if (opts.notice) body += `<div class="notice">${escapeHtml(String(opts.notice))}</div>`
  body += `<form method="post" action="${escapeHtml(opts.action)}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`

  body += `<div class="section"><div class="section-title">Ruleset</div>`
  body += `<label>Name<input type="text" name="name" maxlength="120" value="${escapeHtml(String(values?.name || ''))}" required /></label>`
  body += `<label>Status<select name="status">`
  for (const opt of MESSAGE_RULESET_STATUS_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${String(values?.status || 'draft') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `<label>Description (optional)<input type="text" name="description" maxlength="500" value="${escapeHtml(String(values?.description || ''))}" /></label>`
  body += `<label>Criteria JSON<textarea name="criteriaJson" rows="14" style="font-family: ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(criteriaValue || `{
  "version": 1,
  "inclusion": [],
  "exclusion": []
}`)}</textarea></label>`
  body += `<div class="field-hint">Allowed ops: user.is_authenticated, support.is_subscriber, support.subscription_tier_in, support.donated_within_days, support.donated_amount_last_days_gte, support.completed_intent_in</div>`
  body += `</div>`

  body += `<div class="toolbar"><div></div><div style="display:flex; gap:8px"><button class="btn btn-primary-accent" type="submit">Save</button></div></div>`
  body += `</form>`
  return renderAdminPage({ title: opts.title, bodyHtml: body, active: 'message_rulesets' })
}

pagesRouter.get('/admin/message-rulesets', async (req: any, res: any) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const status = req.query?.status ? String(req.query.status) : ''
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''
    const items = await messageRulesetsSvc.listRulesetsForAdmin({
      includeArchived,
      limit: 500,
      status,
    })

    let body = '<h1>Message Rulesets</h1>'
    body += '<div class="toolbar"><div><span class="pill">Eligibility Rulesets</span></div><div><a href="/admin/message-rulesets/new">New ruleset</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<form method="get" action="/admin/message-rulesets" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end">`
    body += `<label style="min-width:160px">Status<select name="status"><option value="">All</option>`
    for (const opt of MESSAGE_RULESET_STATUS_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${status === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label><input type="checkbox" name="include_archived" value="1"${includeArchived ? ' checked' : ''} /> Include archived</label>`
    body += `<button class="btn" type="submit">Apply</button>`
    body += `</div></form>`

    if (!items.length) {
      body += '<p>No rulesets found for current filters.</p>'
    } else {
      body += '<table><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Inclusion</th><th>Exclusion</th><th>Updated</th></tr></thead><tbody>'
      for (const item of items) {
        const inclusion = Array.isArray(item.criteria?.inclusion) ? item.criteria.inclusion.length : 0
        const exclusion = Array.isArray(item.criteria?.exclusion) ? item.criteria.exclusion.length : 0
        body += `<tr>
          <td>${item.id}</td>
          <td><a href="/admin/message-rulesets/${item.id}">${escapeHtml(item.name)}</a></td>
          <td>${escapeHtml(item.status)}</td>
          <td>${inclusion}</td>
          <td>${exclusion}</td>
          <td>${escapeHtml(item.updatedAt || '')}</td>
        </tr>`
      }
      body += '</tbody></table>'
    }
    const doc = renderAdminPage({ title: 'Message Rulesets', bodyHtml: body, active: 'message_rulesets' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message rulesets list failed', { path: req.path })
    res.status(500).send('Failed to load message rulesets')
  }
})

pagesRouter.get('/admin/message-rulesets/new', async (req: any, res: any) => {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminMessageRulesetForm({
      title: 'New Message Ruleset',
      action: '/admin/message-rulesets',
      csrfToken,
      backHref: '/admin/message-rulesets',
      values: { name: '', status: 'draft', description: '', criteriaJson: '' },
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message ruleset new page failed', { path: req.path })
    res.status(500).send('Failed to load ruleset editor')
  }
})

pagesRouter.post('/admin/message-rulesets', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildMessageRulesetCreateOrUpdatePayload(req.body || {})
  try {
    const created = await messageRulesetsSvc.createRulesetForAdmin(payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-rulesets/${created.id}?notice=${encodeURIComponent('Message ruleset created.')}`)
  } catch (err: any) {
    const doc = renderAdminMessageRulesetForm({
      title: 'New Message Ruleset',
      action: '/admin/message-rulesets',
      csrfToken,
      backHref: '/admin/message-rulesets',
      values: payload,
      error: String(err?.message || 'Failed to create message ruleset'),
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.get('/admin/message-rulesets/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad ruleset id')
  try {
    const item = await messageRulesetsSvc.getRulesetForAdmin(id)
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminMessageRulesetForm({
      title: `Edit Message Ruleset #${id}`,
      action: `/admin/message-rulesets/${id}`,
      csrfToken,
      backHref: '/admin/message-rulesets',
      values: {
        id: item.id,
        name: item.name,
        status: item.status,
        description: item.description || '',
        criteriaJson: JSON.stringify(item.criteria, null, 2),
      },
      notice: req.query?.notice ? String(req.query.notice) : '',
      error: req.query?.error ? String(req.query.error) : '',
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message ruleset detail failed', { path: req.path, ruleset_id: id })
    res.status(404).send('Message ruleset not found')
  }
})

pagesRouter.post('/admin/message-rulesets/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad ruleset id')
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildMessageRulesetCreateOrUpdatePayload(req.body || {})
  try {
    await messageRulesetsSvc.updateRulesetForAdmin(id, payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-rulesets/${id}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    const doc = renderAdminMessageRulesetForm({
      title: `Edit Message Ruleset #${id}`,
      action: `/admin/message-rulesets/${id}`,
      csrfToken,
      backHref: '/admin/message-rulesets',
      values: { ...payload, id },
      error: String(err?.message || 'Failed to save message ruleset'),
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

function buildUserFacingRuleCreateOrUpdatePayload(body: any): any {
  return {
    label: String(body?.label || '').trim(),
    shortDescription: String(body?.shortDescription ?? body?.short_description ?? '').trim() || null,
    groupKey: String(body?.groupKey ?? body?.group_key ?? '').trim() || null,
    groupLabel: String(body?.groupLabel ?? body?.group_label ?? '').trim() || null,
    groupOrder: String(body?.groupOrder ?? body?.group_order ?? '').trim(),
    displayOrder: String(body?.displayOrder ?? body?.display_order ?? '').trim(),
    isActive: String(body?.isActive ?? body?.is_active ?? '').trim(),
  }
}

function buildUserFacingRuleMappingPayload(body: any): any {
  return {
    id: String(body?.mappingId ?? body?.id ?? '').trim(),
    ruleId: String(body?.ruleId ?? body?.rule_id ?? '').trim(),
    priority: String(body?.priority ?? '').trim(),
    isDefault: String(body?.isDefault ?? body?.is_default ?? '').trim(),
  }
}

function renderAdminUserFacingRuleForm(opts: {
  title: string
  action: string
  csrfToken?: string | null
  backHref: string
  values: any
  mappings?: any[]
  ruleOptions?: Array<{ id: number; title: string; slug: string; categoryName: string | null; visibility: string }>
  error?: string | null
  notice?: string | null
}): string {
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const values = opts.values || {}
  const mappings = Array.isArray(opts.mappings) ? opts.mappings : []
  const ruleOptions = Array.isArray(opts.ruleOptions) ? opts.ruleOptions : []
  const selectedRuleIds = new Set<number>(mappings.map((m) => Number((m as any).ruleId || 0)).filter((n) => Number.isFinite(n) && n > 0))

  let body = `<h1>${escapeHtml(opts.title)}</h1>`
  body += `<div class="toolbar"><div><a href="${escapeHtml(opts.backHref)}">← Back to user-facing rules</a></div><div></div></div>`
  if (opts.error) body += `<div class="error">${escapeHtml(String(opts.error))}</div>`
  if (opts.notice) body += `<div class="notice">${escapeHtml(String(opts.notice))}</div>`
  body += `<form method="post" action="${escapeHtml(opts.action)}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`

  body += `<div class="section"><div class="section-title">Rule</div>`
  body += `<label>Label<input type="text" name="label" maxlength="255" value="${escapeHtml(String(values?.label || ''))}" required /></label>`
  body += `<label>Short Description (optional)<input type="text" name="shortDescription" maxlength="500" value="${escapeHtml(String(values?.shortDescription || values?.short_description || ''))}" /></label>`
  body += `<div style="display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">`
  body += `<label>Group Key<input type="text" name="groupKey" maxlength="64" value="${escapeHtml(String(values?.groupKey || values?.group_key || ''))}" /></label>`
  body += `<label>Group Label<input type="text" name="groupLabel" maxlength="128" value="${escapeHtml(String(values?.groupLabel || values?.group_label || ''))}" /></label>`
  body += `<label>Group Order<input type="number" name="groupOrder" value="${escapeHtml(String(values?.groupOrder || values?.group_order || '0'))}" /></label>`
  body += `<label>Display Order<input type="number" name="displayOrder" value="${escapeHtml(String(values?.displayOrder || values?.display_order || '0'))}" /></label>`
  body += `</div>`
  const isActiveValue = String(values?.isActive ?? values?.is_active ?? '1')
  body += `<label><input type="checkbox" name="isActive" value="1"${isActiveValue === '1' || isActiveValue.toLowerCase?.() === 'true' || isActiveValue.toLowerCase?.() === 'on' ? ' checked' : ''} /> Active</label>`
  body += `</div>`

  body += `<div class="toolbar"><div></div><div><button class="btn btn-primary-accent" type="submit">Save</button></div></div>`
  body += `</form>`

  if (values?.id) {
    body += `<div class="section"><div class="section-title">Mappings</div>`
    if (!mappings.length) {
      body += `<p class="field-hint">No mappings yet. Add at least one canonical rule.</p>`
    } else {
      body += `<table><thead><tr><th>Rule</th><th>Priority</th><th>Default</th><th>Actions</th></tr></thead><tbody>`
      for (const mapping of mappings) {
        const mid = Number((mapping as any).id || 0)
        const rid = Number((mapping as any).ruleId || 0)
        const ropt = ruleOptions.find((r) => Number(r.id) === rid)
        const ruleLabel = ropt ? `${ropt.title} [#${ropt.id}]` : `#${rid}`
        body += `<tr><td>${escapeHtml(ruleLabel)}</td><td>${escapeHtml(String((mapping as any).priority ?? 100))}</td><td>${(mapping as any).isDefault ? 'Yes' : 'No'}</td><td>`
        body += `<div style="display:flex; gap:6px; flex-wrap:wrap">`
        body += `<form method="post" action="/admin/user-facing-rules/${Number(values.id)}/mappings" style="margin:0; display:flex; gap:6px; align-items:center">`
        if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<input type="hidden" name="mappingId" value="${mid}" />`
        body += `<input type="hidden" name="ruleId" value="${rid}" />`
        body += `<input type="number" name="priority" value="${escapeHtml(String((mapping as any).priority ?? 100))}" style="width:80px" />`
        body += `<label style="margin:0"><input type="checkbox" name="isDefault" value="1"${(mapping as any).isDefault ? ' checked' : ''} /> Default</label>`
        body += `<button class="btn" type="submit">Update</button></form>`
        body += `<form method="post" action="/admin/user-facing-rules/${Number(values.id)}/mappings/${mid}/delete" style="margin:0" onsubmit="return confirm('Delete mapping?')">`
        if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<button class="btn btn-danger" type="submit">Delete</button></form>`
        body += `</div></td></tr>`
      }
      body += `</tbody></table>`
    }
    body += `<hr style="border-color: rgba(255,255,255,0.15); margin: 14px 0" />`
    body += `<form method="post" action="/admin/user-facing-rules/${Number(values.id)}/mappings">`
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<div style="display:grid; gap:10px; grid-template-columns: minmax(260px,1fr) 120px 120px auto; align-items:end">`
    body += `<label>Rule<select name="ruleId" required><option value="">Select rule</option>`
    for (const opt of ruleOptions) {
      if (selectedRuleIds.has(Number(opt.id))) continue
      const label = `${opt.title} [#${opt.id}]`
      body += `<option value="${opt.id}">${escapeHtml(label)}</option>`
    }
    body += `</select></label>`
    body += `<label>Priority<input type="number" name="priority" value="100" /></label>`
    body += `<label><input type="checkbox" name="isDefault" value="1" /> Default</label>`
    body += `<button class="btn" type="submit">Add Mapping</button>`
    body += `</div>`
    body += `<div class="field-hint">Only one default mapping is allowed per user-facing rule.</div>`
    body += `</form>`
    body += `</div>`

    body += `<div class="section"><div class="section-title">Danger Zone</div>`
    body += `<form method="post" action="/admin/user-facing-rules/${Number(values.id)}/delete" onsubmit="return confirm('Delete this user-facing rule?')">`
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<button class="btn btn-danger" type="submit">Delete Rule</button></form></div>`
  }

  return renderAdminPage({ title: opts.title, bodyHtml: body, active: 'user_facing_rules' })
}

pagesRouter.get('/admin/user-facing-rules', async (req: any, res: any) => {
  try {
    const includeInactive = String(req.query?.include_inactive || '0') === '1'
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''
    const items = await userFacingRulesSvc.listUserFacingRulesForAdmin({
      includeInactive,
      limit: 500,
    })
    let body = '<h1>User-Facing Rules</h1>'
    body += '<div class="toolbar"><div><span class="pill">Reporting Reasons</span></div><div><a href="/admin/user-facing-rules/new">New reason</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<form method="get" action="/admin/user-facing-rules" class="section" style="margin:12px 0">`
    body += `<label><input type="checkbox" name="include_inactive" value="1"${includeInactive ? ' checked' : ''} /> Include inactive</label> <button class="btn" type="submit">Apply</button>`
    body += `</form>`
    if (!items.length) {
      body += '<p>No user-facing rules found.</p>'
    } else {
      body += '<table><thead><tr><th>ID</th><th>Label</th><th>Group</th><th>Order</th><th>Mappings</th><th>Default</th><th>Status</th><th>Updated</th></tr></thead><tbody>'
      for (const item of items) {
        body += `<tr>
          <td>${item.id}</td>
          <td><a href="/admin/user-facing-rules/${item.id}">${escapeHtml(item.label)}</a></td>
          <td>${escapeHtml(item.groupLabel || item.groupKey || '-')}</td>
          <td>${item.groupOrder} / ${item.displayOrder}</td>
          <td>${item.mappingCount}</td>
          <td>${item.defaultMappingCount}</td>
          <td>${item.isActive ? 'active' : 'inactive'}</td>
          <td>${escapeHtml(item.updatedAt || '')}</td>
        </tr>`
      }
      body += '</tbody></table>'
    }
    const doc = renderAdminPage({ title: 'User-Facing Rules', bodyHtml: body, active: 'user_facing_rules' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin user-facing-rules list failed', { path: req.path })
    res.status(500).send('Failed to load user-facing rules')
  }
})

pagesRouter.get('/admin/user-facing-rules/new', async (req: any, res: any) => {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminUserFacingRuleForm({
      title: 'New User-Facing Rule',
      action: '/admin/user-facing-rules',
      csrfToken,
      backHref: '/admin/user-facing-rules',
      values: { label: '', shortDescription: '', groupKey: '', groupLabel: '', groupOrder: 0, displayOrder: 0, isActive: '1' },
      mappings: [],
      ruleOptions: await userFacingRulesSvc.listCanonicalRuleOptionsForAdmin(),
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin user-facing-rules new page failed', { path: req.path })
    res.status(500).send('Failed to load user-facing rule editor')
  }
})

pagesRouter.post('/admin/user-facing-rules', async (req: any, res: any) => {
  const payload = buildUserFacingRuleCreateOrUpdatePayload(req.body || {})
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  try {
    const created = await userFacingRulesSvc.createUserFacingRuleForAdmin(payload, Number(req.user?.id || 0))
    return res.redirect(`/admin/user-facing-rules/${created.id}?notice=${encodeURIComponent('User-facing rule created.')}`)
  } catch (err: any) {
    const doc = renderAdminUserFacingRuleForm({
      title: 'New User-Facing Rule',
      action: '/admin/user-facing-rules',
      csrfToken,
      backHref: '/admin/user-facing-rules',
      values: payload,
      ruleOptions: await userFacingRulesSvc.listCanonicalRuleOptionsForAdmin(),
      error: String(err?.message || 'Failed to create user-facing rule'),
    })
    return res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.get('/admin/user-facing-rules/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad rule id')
  try {
    const item = await userFacingRulesSvc.getUserFacingRuleForAdmin(id)
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminUserFacingRuleForm({
      title: `Edit User-Facing Rule #${id}`,
      action: `/admin/user-facing-rules/${id}`,
      csrfToken,
      backHref: '/admin/user-facing-rules',
      values: item,
      mappings: item.mappings,
      ruleOptions: await userFacingRulesSvc.listCanonicalRuleOptionsForAdmin(),
      notice: req.query?.notice ? String(req.query.notice) : '',
      error: req.query?.error ? String(req.query.error) : '',
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin user-facing-rules detail failed', { path: req.path, rule_id: id })
    res.status(404).send('User-facing rule not found')
  }
})

pagesRouter.post('/admin/user-facing-rules/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad rule id')
  const payload = buildUserFacingRuleCreateOrUpdatePayload(req.body || {})
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  try {
    await userFacingRulesSvc.updateUserFacingRuleForAdmin(id, payload, Number(req.user?.id || 0))
    return res.redirect(`/admin/user-facing-rules/${id}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    const existing = await userFacingRulesSvc.getUserFacingRuleForAdmin(id).catch(() => null)
    const doc = renderAdminUserFacingRuleForm({
      title: `Edit User-Facing Rule #${id}`,
      action: `/admin/user-facing-rules/${id}`,
      csrfToken,
      backHref: '/admin/user-facing-rules',
      values: { ...(existing || {}), ...payload, id },
      mappings: existing?.mappings || [],
      ruleOptions: await userFacingRulesSvc.listCanonicalRuleOptionsForAdmin(),
      error: String(err?.message || 'Failed to save user-facing rule'),
    })
    return res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.post('/admin/user-facing-rules/:id/delete', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/user-facing-rules?error=bad_id')
  try {
    await userFacingRulesSvc.deleteUserFacingRuleForAdmin(id, Number(req.user?.id || 0))
    return res.redirect('/admin/user-facing-rules?notice=' + encodeURIComponent('Deleted.'))
  } catch (err: any) {
    return res.redirect(`/admin/user-facing-rules/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to delete user-facing rule'))}`)
  }
})

pagesRouter.post('/admin/user-facing-rules/:id/mappings', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/user-facing-rules?error=bad_id')
  const payload = buildUserFacingRuleMappingPayload(req.body || {})
  try {
    await userFacingRulesSvc.upsertMappingForAdmin(id, payload, Number(req.user?.id || 0))
    return res.redirect(`/admin/user-facing-rules/${id}?notice=${encodeURIComponent('Mapping saved.')}`)
  } catch (err: any) {
    return res.redirect(`/admin/user-facing-rules/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to save mapping'))}`)
  }
})

pagesRouter.post('/admin/user-facing-rules/:id/mappings/:mappingId/delete', async (req: any, res: any) => {
  const id = Number(req.params.id)
  const mappingId = Number(req.params.mappingId)
  if (!Number.isFinite(id) || id <= 0) return res.redirect('/admin/user-facing-rules?error=bad_id')
  if (!Number.isFinite(mappingId) || mappingId <= 0) return res.redirect(`/admin/user-facing-rules/${id}?error=bad_mapping_id`)
  try {
    await userFacingRulesSvc.deleteMappingForAdmin(id, mappingId, Number(req.user?.id || 0))
    return res.redirect(`/admin/user-facing-rules/${id}?notice=${encodeURIComponent('Mapping deleted.')}`)
  } catch (err: any) {
    return res.redirect(`/admin/user-facing-rules/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to delete mapping'))}`)
  }
})

function buildMessageJourneyCreateOrUpdatePayload(body: any): any {
  const rulesetIdRaw = String(body?.eligibilityRulesetId ?? body?.eligibility_ruleset_id ?? '').trim()
  const appliesToSurfaceRaw = String(body?.appliesToSurface ?? body?.applies_to_surface ?? 'global_feed').trim().toLowerCase() || 'global_feed'
  const surfaceTargeting = parseSurfaceTargetingFromBody(body, appliesToSurfaceRaw)
  const appliesToSurface = surfaceTargeting.find((item) => item.surface === 'global_feed')
    ? 'global_feed'
    : (surfaceTargeting[0]?.surface || appliesToSurfaceRaw)
  const configRaw = String(body?.configJson ?? body?.config_json ?? '').trim()
  const parsedConfig = parseConfigJsonObjectLoose(configRaw)
  const config = parsedConfig.ok ? JSON.stringify(parsedConfig.value) : configRaw
  return {
    journeyKey: String(body?.journeyKey || body?.journey_key || '').trim().toLowerCase(),
    campaignCategory: String(body?.campaignCategory || body?.campaign_category || '').trim().toLowerCase() || null,
    name: String(body?.name || '').trim(),
    appliesToSurface,
    applies_to_surface: appliesToSurface,
    surfaceTargeting,
    status: String(body?.status || 'draft').trim().toLowerCase(),
    description: String(body?.description || '').trim() || null,
    config,
    config_json: config,
    eligibilityRulesetId: /^\d+$/.test(rulesetIdRaw) ? Number(rulesetIdRaw) : null,
  }
}

function parseConfigJsonObjectLoose(raw: any): { ok: boolean; value: Record<string, any> } {
  if (raw == null || raw === '') return { ok: true, value: {} }
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, value: { ...raw } }
  const value = String(raw).trim()
  if (!value) return { ok: true, value: {} }
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, any> }
    }
  } catch {}
  return { ok: false, value: {} }
}

function withJourneyProgressionPolicyConfig(config: Record<string, any>, body: any): Record<string, any> {
  const out = { ...config }
  const policy = String(body?.progressionPolicy || body?.createProgressionPolicy || '').trim().toLowerCase()
  const slotRaw = body?.progressionSlot ?? body?.createProgressionSlot
  const intentRaw = String(body?.progressionIntentKey || body?.createProgressionIntentKey || '').trim().toLowerCase()
  const pickerRaw = String(body?.progressionCtaPicker || body?.createProgressionCtaPicker || '').trim()
  let pickerSlot: number | null = null
  let pickerIntent: string | null = null
  if (pickerRaw) {
    const [slotPart, intentPart] = pickerRaw.split('|')
    const slotNum = Number(slotPart || 0)
    if (Number.isFinite(slotNum) && slotNum > 0) pickerSlot = Math.round(slotNum)
    if (intentPart) pickerIntent = String(intentPart).trim().toLowerCase() || null
  }

  delete out.progression_policy
  delete out.progressionPolicy
  delete out.progression_slot
  delete out.progressionSlot
  delete out.progression_intent_key
  delete out.progressionIntentKey

  if (!policy) return out
  out.progression_policy = policy

  if (policy === 'on_cta_slot_completion') {
    const slot = pickerSlot ?? Number(slotRaw)
    if (Number.isFinite(slot) && slot > 0) out.progression_slot = Math.round(slot)
    if (pickerIntent) out.progression_intent_key = pickerIntent
  } else if (policy === 'on_intent_completion' && intentRaw) {
    out.progression_intent_key = pickerIntent || intentRaw
    if (pickerSlot != null) out.progression_slot = pickerSlot
  } else if (policy === 'on_intent_completion' && pickerIntent) {
    out.progression_intent_key = pickerIntent
    if (pickerSlot != null) out.progression_slot = pickerSlot
  }
  return out
}

function getJourneyProgressionPolicyConfig(config: Record<string, any>): {
  policy: string
  slot: string
  intentKey: string
} {
  const policy = String(config.progression_policy || config.progressionPolicy || '').trim().toLowerCase() || 'on_any_completion'
  const slotNum = Number(config.progression_slot ?? config.progressionSlot ?? 0)
  const slot = Number.isFinite(slotNum) && slotNum > 0 ? String(Math.round(slotNum)) : ''
  const intentKey = String(config.progression_intent_key ?? config.progressionIntentKey ?? '').trim().toLowerCase()
  return { policy, slot, intentKey }
}

function buildMessageJourneyStepPayload(body: any): any {
  const messageIdRaw = body?.messageId ?? body?.message_id ?? body?.createMessageId ?? body?.create_message_id
  const statusRaw = body?.status ?? body?.createStatus
  const progressionPolicyRaw = body?.progressionPolicy ?? body?.createProgressionPolicy
  const progressionSlotRaw = body?.progressionSlot ?? body?.createProgressionSlot
  const progressionIntentKeyRaw = body?.progressionIntentKey ?? body?.createProgressionIntentKey
  const configRaw = String(body?.configJson || body?.config_json || body?.createConfigJson || body?.create_config_json || '').trim()
  const parsed = parseConfigJsonObjectLoose(configRaw)
  const config = parsed.ok
    ? JSON.stringify(withJourneyProgressionPolicyConfig(parsed.value, body))
    : configRaw

  return {
    messageId: messageIdRaw,
    status: String(statusRaw || 'draft').trim().toLowerCase(),
    progressionPolicy: String(progressionPolicyRaw || '').trim().toLowerCase(),
    progressionSlot: String(progressionSlotRaw || '').trim(),
    progressionIntentKey: String(progressionIntentKeyRaw || '').trim().toLowerCase(),
    progressionCtaPicker: String(body?.progressionCtaPicker || body?.createProgressionCtaPicker || '').trim(),
    config,
  }
}

function sharedMessagePreviewRendererScript(): string {
  return `
    (function () {
      if (typeof window === 'undefined' || window.__renderMessagePreview) return;
      const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
      const hex = (s, fallback) => /^#[0-9a-fA-F]{6}$/.test(String(s || '')) ? String(s).toUpperCase() : fallback;
      const hexToRgba = (h, a) => {
        const c = hex(h, '#000000').slice(1);
        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clamp(Number(a || 0), 0, 1) + ')';
      };
      window.__renderMessagePreview = function (preview, state) {
        if (!preview || !preview.device) return;
        const message = state && state.message ? state.message : {};
        const cta = state && state.cta ? state.cta : {};
        const bgMode = String(state && state.bgMode || 'none').toLowerCase();
        const bgVideoPlayback = String(state && state.bgVideoPlayback || 'muted_autoplay').toLowerCase();
        const bgOverlayColor = hex(state && state.bgOverlayColor, '#000000');
        const bgOverlayOpacity = clamp(Number(state && state.bgOverlayOpacity || 0), 0, 1);
        const bgUploadId = String(state && state.bgUploadId || '').trim();

        const msgEnabled = !!message.enabled;
        const msgPos = String(message.position || 'middle').toLowerCase();
        const msgOffset = clamp(Number(message.offsetPct || 0), 0, 80);
        const msgTop = (msgPos === 'top' ? 2 : 42) + msgOffset;
        const msgBottom = 2 + msgOffset;
        if (preview.message) {
          if (msgPos === 'bottom') {
            preview.message.style.top = '';
            preview.message.style.bottom = clamp(msgBottom, 2, 92) + '%';
          } else {
            preview.message.style.bottom = '';
            preview.message.style.top = clamp(msgTop, 2, 92) + '%';
          }
          preview.message.style.display = msgEnabled ? 'block' : 'none';
          preview.message.style.background = hexToRgba(message.bgColor, message.bgOpacity);
          preview.message.style.color = hex(message.textColor, '#FFFFFF');
        }
        if (preview.messageLabel) preview.messageLabel.textContent = String(message.label || 'Message');
        if (preview.messageHeadline) preview.messageHeadline.textContent = String(message.headline || 'Message headline');
        if (preview.messageBody) {
          const bodyText = String(message.body || '').trim();
          preview.messageBody.textContent = bodyText;
          preview.messageBody.hidden = !bodyText;
        }

        const ctaEnabled = !!cta.enabled;
        const ctaPos = String(cta.position || 'middle').toLowerCase();
        const ctaOffset = clamp(Number(cta.offsetPct || 0), 0, 80);
        const ctaTop = (ctaPos === 'top' ? 2 : 56) + ctaOffset;
        const ctaBottom = 2 + ctaOffset;
        if (preview.cta) {
          if (ctaPos === 'bottom') {
            preview.cta.style.top = '';
            preview.cta.style.bottom = clamp(ctaBottom, 2, 94) + '%';
          } else {
            preview.cta.style.bottom = '';
            preview.cta.style.top = clamp(ctaTop, 2, 94) + '%';
          }
          preview.cta.style.display = ctaEnabled ? 'block' : 'none';
          preview.cta.style.background = hexToRgba(cta.bgColor, cta.bgOpacity);
          preview.cta.style.color = hex(cta.textColor, '#FFFFFF');
        }
        const slotCount = clamp(Number(cta.slotCount || 1), 1, 3);
        const layout = String(cta.layout || 'inline').toLowerCase();
        if (preview.ctaButtons) {
          const stacked = layout === 'stacked';
          preview.ctaButtons.style.display = stacked ? 'grid' : 'flex';
          preview.ctaButtons.style.gridTemplateColumns = stacked ? '1fr' : '';
        }
        const slots = Array.isArray(cta.slots) ? cta.slots : [];
        const applySlot = (btn, idx, fallbackLabel) => {
          if (!btn) return;
          const slot = slots[idx - 1] || {};
          btn.textContent = String(slot.label || fallbackLabel);
          btn.style.display = slotCount >= idx ? 'inline-flex' : 'none';
          btn.style.justifySelf = layout === 'stacked' ? 'stretch' : (idx === 1 ? 'start' : (idx === 2 ? (slotCount >= 3 ? 'center' : 'end') : 'end'));
          btn.style.width = layout === 'stacked' ? '100%' : '';
          btn.style.boxSizing = 'border-box';
          btn.style.whiteSpace = layout === 'stacked' ? 'normal' : 'nowrap';
          btn.style.wordBreak = layout === 'stacked' ? 'break-word' : '';
          btn.style.lineHeight = layout === 'stacked' ? '1.25' : '';
          btn.style.background = slot.bgColor ? hexToRgba(slot.bgColor, slot.bgOpacity == null ? 1 : slot.bgOpacity) : 'rgba(0,0,0,0.5)';
          btn.style.color = slot.textColor ? hex(slot.textColor, '#FFFFFF') : '#fff';
        };
        applySlot(preview.slot1Btn, 1, 'Primary');
        applySlot(preview.slot2Btn, 2, 'Secondary');
        applySlot(preview.slot3Btn, 3, 'Tertiary');

        if (preview.overlay) preview.overlay.style.background = hexToRgba(bgOverlayColor, bgOverlayOpacity);
        if (preview.modeBadge) {
          const playbackLabel = bgMode === 'video' ? (' (' + (bgVideoPlayback === 'tap_to_play_sound' ? 'tap-to-play' : 'muted-autoplay') + ')') : '';
          preview.modeBadge.textContent = 'Mode: ' + (bgMode || 'none') + playbackLabel + (bgUploadId ? (' #' + bgUploadId) : '');
        }
        const mediaUrl = String(state && state.mediaUrl || '').trim();
        if ((bgMode === 'image' || bgMode === 'video') && mediaUrl) {
          preview.device.style.backgroundImage = 'url("' + mediaUrl + '")';
          preview.device.style.backgroundSize = 'cover';
          preview.device.style.backgroundPosition = 'center';
          preview.device.style.backgroundRepeat = 'no-repeat';
          preview.device.style.backgroundColor = '#0B1320';
        } else if (bgMode === 'video') {
          preview.device.style.backgroundImage = '';
          preview.device.style.backgroundSize = '';
          preview.device.style.backgroundPosition = '';
          preview.device.style.backgroundRepeat = '';
          preview.device.style.background = 'linear-gradient(135deg,#0a1930,#1e3a8a)';
        } else if (bgMode === 'image') {
          preview.device.style.backgroundImage = '';
          preview.device.style.backgroundSize = '';
          preview.device.style.backgroundPosition = '';
          preview.device.style.backgroundRepeat = '';
          preview.device.style.background = 'linear-gradient(135deg,#1f2937,#4b5563)';
        } else {
          preview.device.style.backgroundImage = '';
          preview.device.style.backgroundSize = '';
          preview.device.style.backgroundPosition = '';
          preview.device.style.backgroundRepeat = '';
          preview.device.style.background = 'linear-gradient(130deg,#101828,#1f2937)';
        }
      };
    })();
  `
}

function renderAdminMessageJourneyForm(opts: {
  title: string
  action: string
  csrfToken?: string | null
  backHref: string
  values: any
  rulesetOptions?: Array<{ id: number; name: string; status?: string; criteria?: Record<string, any> }>
  campaignCategoryOptions?: string[]
  surfaceTargetOptions?: {
    groups: Array<{ id: number; name: string; slug: string }>
    channels: Array<{ id: number; name: string; slug: string }>
  }
  error?: string | null
  notice?: string | null
}): string {
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const values = opts.values || {}
  const rulesetOptions = Array.isArray(opts.rulesetOptions) ? opts.rulesetOptions : []
  const campaignCategoryOptions = Array.isArray(opts.campaignCategoryOptions) ? opts.campaignCategoryOptions : []
  const rulesetCriteriaById = Object.fromEntries(
    rulesetOptions.map((r) => [String(Number((r as any).id || 0)), (r as any).criteria || { version: 1, inclusion: [], exclusion: [] }])
  )
  const surfaceTargetOptions = opts.surfaceTargetOptions || { groups: [], channels: [] }
  const rawJourneySurfaceTargeting = Array.isArray(values.surfaceTargeting)
    ? values.surfaceTargeting
    : (Array.isArray(values.surface_targeting) ? values.surface_targeting : [])
  const journeySurfaceValue = String(values?.appliesToSurface || values?.applies_to_surface || 'global_feed')
  const journeySurfaceTargeting = rawJourneySurfaceTargeting.length
    ? rawJourneySurfaceTargeting
    : [{ surface: journeySurfaceValue, targetingMode: 'all', targetIds: [] }]
  const journeyTargetBySurface = new Map<string, { targetingMode: 'all' | 'selected'; targetIds: number[] }>()
  for (const item of journeySurfaceTargeting as any[]) {
    const surface = String(item?.surface || '').trim().toLowerCase()
    if (surface !== 'global_feed' && surface !== 'group_feed' && surface !== 'channel_feed') continue
    const mode = String(item?.targetingMode || item?.targeting_mode || '').trim().toLowerCase() === 'selected' ? 'selected' : 'all'
    const targetIds = Array.isArray(item?.targetIds)
      ? item.targetIds
      : (Array.isArray(item?.target_ids) ? item.target_ids : [])
    const normalizedTargetIds: number[] = Array.from(new Set(targetIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0).map((n: number) => Math.round(n)))) as number[]
    journeyTargetBySurface.set(surface, { targetingMode: mode, targetIds: normalizedTargetIds })
  }
  const journeyGlobalChecked = journeyTargetBySurface.has('global_feed')
  const journeyGroupsTargeting = journeyTargetBySurface.get('group_feed') || { targetingMode: 'all' as const, targetIds: [] }
  const journeyChannelsTargeting = journeyTargetBySurface.get('channel_feed') || { targetingMode: 'all' as const, targetIds: [] }
  const journeyCampaignCategoryValue = String(values?.campaignCategory || values?.campaign_category || '').trim().toLowerCase()
  const duplicateJourneyKeyError = String(opts.error || '').trim().toLowerCase() === 'duplicate_journey_key'

  let body = `<h1>${escapeHtml(opts.title)}</h1>`
  body += `<div class="toolbar"><div><a href="${escapeHtml(opts.backHref)}">← Back to message journeys</a></div><div></div></div>`
  if (opts.error) body += `<div class="error">${escapeHtml(String(opts.error))}</div>`
  if (opts.notice) body += `<div class="notice">${escapeHtml(String(opts.notice))}</div>`
  body += `<form method="post" action="${escapeHtml(opts.action)}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
  body += `<button type="button" class="journey-section-toggle" data-target="journey-new-section-identity" aria-expanded="false" style="width:100%; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:#fff; font-size:18px; font-weight:900; text-align:left; padding:0; margin:10px 0 6px; cursor:pointer;"><span class="journey-section-chevron">▸</span><span style="opacity:0.5">IDENTITY</span></button>`
  body += `<div id="journey-new-section-identity" class="section" style="display:none">`
  body += `<label>Journey Key<div style="display:flex; align-items:center; gap:8px; width:100%"><input type="text" name="journeyKey" maxlength="64" value="${escapeHtml(String(values?.journeyKey || ''))}" required style="flex:1 1 auto; min-width:0" /><button type="button" id="journey-key-suffix" class="btn" title="Append -yyyy-mm-dd" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center;">+D</button></div>${duplicateJourneyKeyError ? `<div class="field-hint" style="color:#fda4af">Journey key is already in use. Choose a unique key.</div>` : ''}</label>`
  body += `<label>Campaign Category<input type="text" name="campaignCategory" list="journey-campaign-category-options" maxlength="64" value="${escapeHtml(journeyCampaignCategoryValue)}" placeholder="donation_drive" /><datalist id="journey-campaign-category-options">`
  for (const category of campaignCategoryOptions) {
    body += `<option value="${escapeHtml(String(category || '').trim().toLowerCase())}"></option>`
  }
  body += `</datalist></label>`
  body += `<label>Name<input type="text" name="name" maxlength="120" value="${escapeHtml(String(values?.name || ''))}" required /></label>`
  body += `<label>Description (optional)<input type="text" name="description" maxlength="500" value="${escapeHtml(String(values?.description || ''))}" /></label>`
  body += `<details style="margin-top:6px"><summary style="cursor:pointer; user-select:none">JSON Config</summary>`
  body += `<label style="margin-top:8px">Config JSON<textarea name="configJson" rows="6" style="font-family: ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(
    typeof values?.config === 'string'
      ? String(values.config)
      : JSON.stringify((values?.config && typeof values.config === 'object') ? values.config : {}, null, 2)
  )}</textarea></label>`
  body += `</details>`
  body += `<label>Status<select name="status">`
  for (const opt of MESSAGE_JOURNEY_STATUS_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${String(values?.status || 'draft') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `</div>`
  body += `<button type="button" class="journey-section-toggle" data-target="journey-new-section-surface" aria-expanded="false" style="width:100%; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:#fff; font-size:18px; font-weight:900; text-align:left; padding:0; margin:10px 0 6px; cursor:pointer;"><span class="journey-section-chevron">▸</span><span style="opacity:0.5">SURFACE TARGETING</span></button>`
  body += `<div id="journey-new-section-surface" class="section" style="display:none">`
  body += `<input type="hidden" name="appliesToSurface" value="${escapeHtml(journeySurfaceValue)}" />`
  body += `<div style="display:grid; gap:10px; margin-top:6px">`
  body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0; white-space:nowrap"><input type="checkbox" name="surfaceGlobalFeed" value="1"${journeyGlobalChecked ? ' checked' : ''} /> Global Feed</label>`
  body += `<div style="border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:10px; box-sizing:border-box">`
  body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0 0 8px 0; white-space:nowrap"><input type="checkbox" name="surfaceGroupFeed" value="1"${journeyTargetBySurface.has('group_feed') ? ' checked' : ''} /> Groups</label>`
  body += `<label style="margin:0 0 8px 0">Targeting<select name="surfaceGroupFeedMode"><option value="all"${journeyGroupsTargeting.targetingMode === 'all' ? ' selected' : ''}>All</option><option value="selected"${journeyGroupsTargeting.targetingMode === 'selected' ? ' selected' : ''}>Selected only</option></select></label>`
  body += `<label style="margin:0">Selected Groups<select name="surfaceGroupTargetIds" multiple size="6">`
  for (const group of surfaceTargetOptions.groups) {
    const selected = journeyGroupsTargeting.targetIds.includes(Number(group.id))
    const label = `${group.name}${group.slug ? ` (${group.slug})` : ''} [#${group.id}]`
    body += `<option value="${group.id}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
  }
  body += `</select></label>`
  body += `</div>`
  body += `<div style="border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:10px; box-sizing:border-box">`
  body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0 0 8px 0; white-space:nowrap"><input type="checkbox" name="surfaceChannelFeed" value="1"${journeyTargetBySurface.has('channel_feed') ? ' checked' : ''} /> Channels</label>`
  body += `<label style="margin:0 0 8px 0">Targeting<select name="surfaceChannelFeedMode"><option value="all"${journeyChannelsTargeting.targetingMode === 'all' ? ' selected' : ''}>All</option><option value="selected"${journeyChannelsTargeting.targetingMode === 'selected' ? ' selected' : ''}>Selected only</option></select></label>`
  body += `<label style="margin:0">Selected Channels<select name="surfaceChannelTargetIds" multiple size="6">`
  for (const channel of surfaceTargetOptions.channels) {
    const selected = journeyChannelsTargeting.targetIds.includes(Number(channel.id))
    const label = `${channel.name}${channel.slug ? ` (${channel.slug})` : ''} [#${channel.id}]`
    body += `<option value="${channel.id}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
  }
  body += `</select></label>`
  body += `</div>`
  body += `</div>`
  body += `</div>`
  body += `<button type="button" class="journey-section-toggle" data-target="journey-new-section-eligibility" aria-expanded="false" style="width:100%; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:#fff; font-size:18px; font-weight:900; text-align:left; padding:0; margin:10px 0 6px; cursor:pointer;"><span class="journey-section-chevron">▸</span><span style="opacity:0.5">ELIGIBILITY</span></button>`
  body += `<div id="journey-new-section-eligibility" class="section" style="display:none">`
  body += `<label>Eligibility Ruleset (optional)</label>`
  body += `<div class="picker-row" style="display:flex; align-items:center; gap:8px">`
  body += `<select id="journey-eligibility-select" name="eligibilityRulesetId"><option value="">None</option>`
  for (const r of rulesetOptions) {
    const rid = Number((r as any).id || 0)
    if (!Number.isFinite(rid) || rid <= 0) continue
    const rname = String((r as any).name || `Ruleset #${rid}`)
    const rstatus = String((r as any).status || '').trim().toLowerCase()
    const suffix = rstatus ? ` [${rstatus}]` : ''
    body += `<option value="${rid}"${String(values?.eligibilityRulesetId || '') === String(rid) ? ' selected' : ''}>${escapeHtml(`${rname}${suffix} #${rid}`)}</option>`
  }
  body += `</select>`
  body += `<button type="button" id="journey-eligibility-view" class="btn" title="View ruleset criteria" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:16px; line-height:1;">{}</button>`
  body += `</div>`
  body += `<div class="field-hint">Journey ruleset gates all steps in this journey. Step progression is controlled only by progression policy.</div>`
  body += `</div>`
  body += `<div class="toolbar"><div></div><div style="display:flex; gap:8px"><button class="btn btn-primary-accent" type="submit">Save</button></div></div>`
  body += `</form>`
  body += `<dialog id="journey-eligibility-dialog" style="max-width:860px; width:min(92vw, 860px); border:1px solid #444; border-radius:10px; padding:14px;">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
      <strong id="journey-eligibility-dialog-title">Eligibility Criteria</strong>
      <button type="button" id="journey-eligibility-dialog-close" class="btn" aria-label="Close dialog" style="width:30px; min-width:30px; height:30px; padding:0; border-radius:999px; border:1px solid #000; background:#000; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:900; line-height:1;">×</button>
    </div>
    <pre id="journey-eligibility-dialog-json" style="margin:0; max-height:60vh; overflow:auto; border:1px solid rgba(255,255,255,0.18); border-radius:8px; padding:10px; background:#0b0b0b; color:#fff; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;"></pre>
  </dialog>`
  body += `<script>
    (function () {
      const toggles = document.querySelectorAll('.journey-section-toggle[data-target]');
      const journeyKeySuffixBtn = document.getElementById('journey-key-suffix');
      const journeyKeyInput = document.querySelector('input[name="journeyKey"]');
      const appendJourneyDateSuffix = () => {
        if (!journeyKeyInput) return;
        const now = new Date();
        const yyyy = String(now.getUTCFullYear());
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        const suffix = '-' + yyyy + '-' + mm + '-' + dd;
        const base = String(journeyKeyInput.value || '').trim();
        journeyKeyInput.value = (base ? base : 'journey') + suffix;
        try { journeyKeyInput.focus(); } catch {}
      };
      if (journeyKeySuffixBtn) journeyKeySuffixBtn.addEventListener('click', appendJourneyDateSuffix);
      const setExpanded = (btn, expanded) => {
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const chev = btn.querySelector('.journey-section-chevron');
        if (chev) chev.textContent = expanded ? '▾' : '▸';
      };
      toggles.forEach((btn) => {
        const targetId = btn.getAttribute('data-target');
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (!target) return;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        setExpanded(btn, expanded);
        target.style.display = expanded ? '' : 'none';
        btn.addEventListener('click', () => {
          const next = btn.getAttribute('aria-expanded') !== 'true';
          setExpanded(btn, next);
          target.style.display = next ? '' : 'none';
        });
      });

      const rulesetCriteriaById = ${JSON.stringify(rulesetCriteriaById)};
      const rulesetSelect = document.getElementById('journey-eligibility-select');
      const rulesetViewBtn = document.getElementById('journey-eligibility-view');
      const rulesetDialog = document.getElementById('journey-eligibility-dialog');
      const rulesetDialogClose = document.getElementById('journey-eligibility-dialog-close');
      const rulesetDialogTitle = document.getElementById('journey-eligibility-dialog-title');
      const rulesetDialogJson = document.getElementById('journey-eligibility-dialog-json');
      const syncRulesetButton = () => {
        if (!rulesetViewBtn || !rulesetSelect) return;
        const id = String(rulesetSelect.value || '').trim();
        const enabled = !!id && !!rulesetCriteriaById[id];
        rulesetViewBtn.disabled = !enabled;
        rulesetViewBtn.style.opacity = enabled ? '1' : '0.4';
        rulesetViewBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
      };
      if (rulesetSelect) rulesetSelect.addEventListener('change', syncRulesetButton);
      syncRulesetButton();
      if (rulesetViewBtn && rulesetSelect && rulesetDialog && rulesetDialogJson) {
        rulesetViewBtn.addEventListener('click', () => {
          const id = String(rulesetSelect.value || '').trim();
          if (!id || !rulesetCriteriaById[id]) return;
          const selectedOpt = rulesetSelect.options[rulesetSelect.selectedIndex];
          if (rulesetDialogTitle) rulesetDialogTitle.textContent = 'Eligibility Criteria — ' + String((selectedOpt && selectedOpt.text) || ('#' + id));
          rulesetDialogJson.textContent = JSON.stringify(rulesetCriteriaById[id], null, 2);
          if (typeof rulesetDialog.showModal === 'function') rulesetDialog.showModal();
        });
        if (rulesetDialogClose) {
          rulesetDialogClose.addEventListener('click', () => {
            if (typeof rulesetDialog.close === 'function') rulesetDialog.close();
          });
        }
        rulesetDialog.addEventListener('click', (ev) => {
          const rect = rulesetDialog.getBoundingClientRect();
          const x = ev.clientX;
          const y = ev.clientY;
          const outside = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
          if (outside && typeof rulesetDialog.close === 'function') rulesetDialog.close();
        });
      }
    })();
  </script>`
  return renderAdminPage({ title: opts.title, bodyHtml: body, active: 'message_journeys' })
}

pagesRouter.get('/admin/message-journeys', async (req: any, res: any) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const status = req.query?.status ? String(req.query.status) : ''
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''
    const items = await messageJourneysSvc.listJourneysForAdmin({
      includeArchived,
      limit: 500,
      status,
    })

    let body = '<h1>Message Journeys</h1>'
    body += '<div class="toolbar"><div><span class="pill">Journey Sequencing</span></div><div><a href="/admin/message-journeys/new">New journey</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<form method="get" action="/admin/message-journeys" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end">`
    body += `<label style="min-width:160px">Status<select name="status"><option value="">All</option>`
    for (const opt of MESSAGE_JOURNEY_STATUS_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${status === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label><input type="checkbox" name="include_archived" value="1"${includeArchived ? ' checked' : ''} /> Include archived</label>`
    body += `<button class="btn" type="submit">Apply</button>`
    body += `</div></form>`

    if (!items.length) {
      body += '<p>No journeys found for current filters.</p>'
    } else {
      body += '<table><thead><tr><th>ID</th><th>Journey Key</th><th>Name</th><th>Status</th><th>Updated</th></tr></thead><tbody>'
      for (const item of items) {
        body += `<tr>
          <td>${item.id}</td>
          <td><a href="/admin/message-journeys/${item.id}">${escapeHtml(item.journeyKey)}</a></td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.updatedAt || '')}</td>
        </tr>`
      }
      body += '</tbody></table>'
    }
    const doc = renderAdminPage({ title: 'Message Journeys', bodyHtml: body, active: 'message_journeys' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message journeys list failed', { path: req.path })
    res.status(500).send('Failed to load message journeys')
  }
})

pagesRouter.get('/admin/message-journeys/new', async (req: any, res: any) => {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const rulesets = await messageRulesetsSvc.listRulesetsForAdmin({ includeArchived: false, limit: 500 })
    const campaignCategoryOptions = await loadCampaignCategoryOptionsForEditor()
    const surfaceTargetOptions = await loadSurfaceTargetOptionsForEditor()
    const doc = renderAdminMessageJourneyForm({
      title: 'New Message Journey',
      action: '/admin/message-journeys',
      csrfToken,
      backHref: '/admin/message-journeys',
      rulesetOptions: rulesets.map((r) => ({
        id: Number(r.id),
        name: String((r as any).name || `Ruleset #${r.id}`),
        status: String((r as any).status || ''),
        criteria: ((r as any).criteria && typeof (r as any).criteria === 'object') ? (r as any).criteria : undefined,
      })),
      campaignCategoryOptions,
      surfaceTargetOptions,
      values: {
        journeyKey: '',
        name: '',
        description: '',
        config: {},
        appliesToSurface: 'global_feed',
        surfaceTargeting: [{ surface: 'global_feed', targetingMode: 'all', targetIds: [] }],
        status: 'draft',
      },
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message journey new page failed', { path: req.path })
    res.status(500).send('Failed to load journey editor')
  }
})

pagesRouter.post('/admin/message-journeys', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildMessageJourneyCreateOrUpdatePayload(req.body || {})
  try {
    const created = await messageJourneysSvc.createJourneyForAdmin(payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-journeys/${created.id}?notice=${encodeURIComponent('Message journey created.')}`)
  } catch (err: any) {
    const rulesets = await messageRulesetsSvc.listRulesetsForAdmin({ includeArchived: false, limit: 500 })
    const campaignCategoryOptions = await loadCampaignCategoryOptionsForEditor()
    const surfaceTargetOptions = await loadSurfaceTargetOptionsForEditor()
    const doc = renderAdminMessageJourneyForm({
      title: 'New Message Journey',
      action: '/admin/message-journeys',
      csrfToken,
      backHref: '/admin/message-journeys',
      rulesetOptions: rulesets.map((r) => ({
        id: Number(r.id),
        name: String((r as any).name || `Ruleset #${r.id}`),
        status: String((r as any).status || ''),
        criteria: ((r as any).criteria && typeof (r as any).criteria === 'object') ? (r as any).criteria : undefined,
      })),
      campaignCategoryOptions,
      surfaceTargetOptions,
      values: payload,
      error: String(err?.message || 'Failed to create message journey'),
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.get('/admin/message-journeys/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad journey id')
  try {
    const [journey, steps, messages, rulesets, ctaDefinitions, surfaceTargetOptions, campaignCategoryOptions] = await Promise.all([
      messageJourneysSvc.getJourneyForAdmin(id),
      messageJourneysSvc.listJourneyStepsForAdmin(id, { includeArchived: true }),
      messagesSvc.listForAdmin({ includeArchived: false, limit: 500 }),
      messageRulesetsSvc.listRulesetsForAdmin({ includeArchived: false, limit: 500 }),
      messageCtasSvc.listMessageCtaDefinitionsForAdmin({
        actorUserId: Number(req.user?.id || 0),
        includeArchived: false,
        limit: 500,
      }),
      loadSurfaceTargetOptionsForEditor(),
      loadCampaignCategoryOptionsForEditor(),
    ])
    const messageNameById = new Map<number, string>()
    for (const m of messages) {
      messageNameById.set(Number(m.id), String(m.name || `Message #${m.id}`))
    }
    const rulesetNameById = new Map<number, string>()
    for (const r of rulesets) {
      rulesetNameById.set(Number(r.id), String(r.name || `Ruleset #${r.id}`))
    }
    const ctaDefsById = new Map<number, { intentKey: string; labelDefault: string }>()
    for (const def of ctaDefinitions) {
      const did = Number((def as any).id || 0)
      if (!Number.isFinite(did) || did <= 0) continue
      ctaDefsById.set(did, {
        intentKey: String((def as any).intentKey || '').trim().toLowerCase(),
        labelDefault: String((def as any).labelDefault || ''),
      })
    }
    const messageCtaPickerOptionsByMessageId: Record<string, Array<{ value: string; label: string; slot: number; intentKey: string }>> = {}
    const messagePreviewById: Record<string, any> = {}
    for (const m of messages) {
      const mid = Number((m as any).id || 0)
      if (!Number.isFinite(mid) || mid <= 0) continue
      const options: Array<{ value: string; label: string; slot: number; intentKey: string }> = []
      const creative: any = (m as any).creative && typeof (m as any).creative === 'object' ? (m as any).creative : {}
      const slots = Array.isArray(creative?.widgets?.cta?.slots) ? creative.widgets.cta.slots : []
      for (const rawSlot of slots) {
        const slot = Number((rawSlot as any)?.slot || 0)
        if (!Number.isFinite(slot) || slot <= 0) continue
        const ctaDefinitionId = Number((rawSlot as any)?.ctaDefinitionId || 0)
        const labelOverride = String((rawSlot as any)?.labelOverride || '').trim()
        const def = ctaDefsById.get(ctaDefinitionId)
        const intentKey = String(def?.intentKey || '').trim().toLowerCase()
        if (!intentKey) continue
        const label = labelOverride || String(def?.labelDefault || '') || `Slot ${slot}`
        options.push({
          value: `${slot}|${intentKey}`,
          label: `Slot ${slot}: ${label} (${intentKey})`,
          slot,
          intentKey,
        })
      }
      options.sort((a, b) => a.slot - b.slot)
      messageCtaPickerOptionsByMessageId[String(mid)] = options
      const bg = creative?.background && typeof creative.background === 'object' ? creative.background : {}
      const msgWidget = creative?.widgets?.message && typeof creative.widgets.message === 'object' ? creative.widgets.message : {}
      const ctaWidget = creative?.widgets?.cta && typeof creative.widgets.cta === 'object' ? creative.widgets.cta : {}
      const uploadId = String(bg.uploadId || '').trim()
      const previewSlots = options.slice(0, 3).map((o) => {
        const slotDef = slots.find((s: any) => Number((s as any)?.slot || 0) === Number(o.slot))
        const styleOverride = slotDef && typeof slotDef.styleOverride === 'object' ? slotDef.styleOverride : {}
        const slotLabelOverride = String((slotDef as any)?.labelOverride || '').trim()
        const ctaDefinitionId = Number((slotDef as any)?.ctaDefinitionId || 0)
        const def = ctaDefsById.get(ctaDefinitionId)
        return {
          label: slotLabelOverride || String(def?.labelDefault || `Slot ${o.slot}`),
          bgColor: String((styleOverride as any).bgColor || ''),
          bgOpacity: Number((styleOverride as any).bgOpacity),
          textColor: String((styleOverride as any).textColor || ''),
        }
      })
      messagePreviewById[String(mid)] = {
        id: mid,
        name: String((m as any).name || `Message #${mid}`),
        mediaUrl: uploadId
          ? (String(bg.mode || '').toLowerCase() === 'image'
            ? `/api/uploads/${encodeURIComponent(uploadId)}/image?mode=image&usage=message_bg&orientation=portrait&dpr=1`
            : `/api/uploads/${encodeURIComponent(uploadId)}/thumb`)
          : '',
        bgMode: String(bg.mode || 'none').toLowerCase(),
        bgVideoPlayback: String(bg.videoPlaybackMode || 'muted_autoplay').toLowerCase(),
        bgUploadId: uploadId,
        bgOverlayColor: String(bg.overlayColor || '#000000'),
        bgOverlayOpacity: Number(bg.overlayOpacity),
        message: {
          enabled: !!msgWidget.enabled,
          position: String(msgWidget.position || 'middle').toLowerCase(),
          offsetPct: Number(msgWidget.yOffsetPct),
          bgColor: String(msgWidget.bgColor || '#0B1320'),
          bgOpacity: Number(msgWidget.bgOpacity),
          textColor: String(msgWidget.textColor || '#FFFFFF'),
          label: String(msgWidget.label || 'Message'),
          headline: String((m as any).headline || msgWidget.headline || ''),
          body: String((m as any).body || msgWidget.body || ''),
        },
        cta: {
          enabled: !!ctaWidget.enabled,
          layout: String(ctaWidget.layout || 'inline').toLowerCase(),
          slotCount: Number(ctaWidget.count || (previewSlots.length || 1)),
          position: String(ctaWidget.position || 'bottom').toLowerCase(),
          offsetPct: Number(ctaWidget.yOffsetPct),
          bgColor: String(ctaWidget.bgColor || '#0B1320'),
          bgOpacity: Number(ctaWidget.bgOpacity),
          textColor: String(ctaWidget.textColor || '#FFFFFF'),
          slots: previewSlots,
        },
      }
    }

    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''
    const showCreateStep = String(req.query?.add_step || '0') === '1'
    const newStepValues = {
      messageId: String(req.query?.messageId || ''),
      status: String(req.query?.stepStatus || 'draft'),
      progressionPolicy: String(req.query?.progressionPolicy || ''),
      progressionSlot: String(req.query?.progressionSlot || ''),
      progressionIntentKey: String(req.query?.progressionIntentKey || ''),
      progressionCtaPicker: String(req.query?.progressionCtaPicker || ''),
      configJson: String(req.query?.configJson || ''),
    }
    const newStepConfigParsed = parseConfigJsonObjectLoose(newStepValues.configJson || '{}')
    const newStepPolicyFromConfig = getJourneyProgressionPolicyConfig(newStepConfigParsed.ok ? newStepConfigParsed.value : {})
    if (!newStepValues.progressionPolicy) newStepValues.progressionPolicy = newStepPolicyFromConfig.policy
    if (!newStepValues.progressionSlot) newStepValues.progressionSlot = newStepPolicyFromConfig.slot
    if (!newStepValues.progressionIntentKey) newStepValues.progressionIntentKey = newStepPolicyFromConfig.intentKey
    if (!newStepValues.progressionCtaPicker && (newStepValues.progressionSlot || newStepValues.progressionIntentKey)) {
      newStepValues.progressionCtaPicker = `${newStepValues.progressionSlot || ''}|${newStepValues.progressionIntentKey || ''}`
    }

    let body = `<div class="journey-ui">`
    body += `<style>
      .journey-ui .journey-block-title {
        font-size: 18px;
        font-weight: 900;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        opacity: 0.5;
        margin: 0;
      }
      .journey-ui .journey-card {
        background: linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%);
        border: 1px solid rgba(96,165,250,0.6);
        border-radius: 14px;
        padding: 16px;
      }
      .journey-ui .journey-grid {
        display: grid;
        grid-template-columns: minmax(0,1fr) minmax(0,1fr);
        gap: 10px;
        align-items: start;
      }
      .journey-ui .journey-grid > label { min-width: 0; }
      .journey-ui input,
      .journey-ui select,
      .journey-ui textarea {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        background: #0b0b0b;
        border: 1px solid rgba(255,255,255,0.18);
        color: #fff;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 14px;
        font-weight: 700;
      }
      .journey-ui input[type="checkbox"] {
        width: auto;
        max-width: none;
        padding: 0;
        border: 0;
        background: transparent;
      }
      .journey-ui .journey-actions {
        display:flex;
        justify-content:flex-end;
        gap:10px;
      }
    </style>`
    body += `<h1>Edit Message Journey #${id}</h1>`
    body += `<div class="toolbar"><div><a href="/admin/message-journeys">← Back to message journeys</a></div><div></div></div>`
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`

    body += `<button type="button" class="journey-section-toggle" data-target="journey-section-identity" aria-expanded="false" style="width:100%; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:#fff; text-align:left; padding:0; margin:10px 0 6px; cursor:pointer;"><span class="journey-section-chevron">▸</span><span class="journey-block-title">IDENTITY</span></button>`
    body += `<form method="post" action="/admin/message-journeys/${id}">`
    if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<div id="journey-section-identity" class="section journey-card" style="display:none">`
    body += `<label>Journey Key<input type="text" name="journeyKey" maxlength="64" value="${escapeHtml(String(journey.journeyKey || ''))}" required /></label>`
    body += `<label>Campaign Category<input type="text" name="campaignCategory" list="journey-campaign-category-options" maxlength="64" value="${escapeHtml(String((journey as any).campaignCategory || ''))}" placeholder="donation_drive" /><datalist id="journey-campaign-category-options">`
    for (const category of campaignCategoryOptions) {
      body += `<option value="${escapeHtml(String(category || '').trim().toLowerCase())}"></option>`
    }
    body += `</datalist></label>`
    body += `<label>Name<input type="text" name="name" maxlength="120" value="${escapeHtml(String(journey.name || ''))}" required /></label>`
    const journeySurfaceValue = String((journey as any).appliesToSurface || 'global_feed')
    const rawJourneySurfaceTargeting = Array.isArray((journey as any).surfaceTargeting) ? (journey as any).surfaceTargeting : []
    const journeySurfaceTargeting = rawJourneySurfaceTargeting.length
      ? rawJourneySurfaceTargeting
      : [{ surface: journeySurfaceValue, targetingMode: 'all', targetIds: [] }]
    const journeyTargetBySurface = new Map<string, { targetingMode: 'all' | 'selected'; targetIds: number[] }>()
    for (const item of journeySurfaceTargeting) {
      const surface = String((item as any)?.surface || '').trim().toLowerCase()
      if (surface !== 'global_feed' && surface !== 'group_feed' && surface !== 'channel_feed') continue
      const mode = String((item as any)?.targetingMode || (item as any)?.targeting_mode || '').trim().toLowerCase() === 'selected' ? 'selected' : 'all'
      const targetIds = Array.isArray((item as any)?.targetIds)
        ? (item as any).targetIds
        : (Array.isArray((item as any)?.target_ids) ? (item as any).target_ids : [])
      const normalizedTargetIds: number[] = Array.from(new Set(targetIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0).map((n: number) => Math.round(n)))) as number[]
      journeyTargetBySurface.set(surface, { targetingMode: mode, targetIds: normalizedTargetIds })
    }
    const journeyGlobalChecked = journeyTargetBySurface.has('global_feed')
    const journeyGroupsTargeting = journeyTargetBySurface.get('group_feed') || { targetingMode: 'all' as const, targetIds: [] }
    const journeyChannelsTargeting = journeyTargetBySurface.get('channel_feed') || { targetingMode: 'all' as const, targetIds: [] }
    body += `<label>Description (optional)<input type="text" name="description" maxlength="500" value="${escapeHtml(String(journey.description || ''))}" /></label>`
    body += `<details style="margin-top:6px"><summary style="cursor:pointer; user-select:none">JSON Config</summary>`
    body += `<label style="margin-top:8px">Config JSON<textarea name="configJson" rows="6" style="font-family: ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(JSON.stringify((journey as any).config || {}, null, 2))}</textarea></label>`
    body += `</details>`
    body += `<label>Status<select name="status">`
    for (const opt of MESSAGE_JOURNEY_STATUS_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${String(journey.status || 'draft') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `</div>`

    body += `<button type="button" class="journey-section-toggle" data-target="journey-section-surface" aria-expanded="false" style="width:100%; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:#fff; text-align:left; padding:0; margin:10px 0 6px; cursor:pointer;"><span class="journey-section-chevron">▸</span><span class="journey-block-title">SURFACE TARGETING</span></button>`
    body += `<div id="journey-section-surface" class="section journey-card" style="display:none">`
    body += `<input type="hidden" name="appliesToSurface" value="${escapeHtml(journeySurfaceValue)}" />`
    body += `<div style="display:grid; gap:10px; margin-top:6px">`
    body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0; white-space:nowrap"><input type="checkbox" name="surfaceGlobalFeed" value="1"${journeyGlobalChecked ? ' checked' : ''} /> Global Feed</label>`
    body += `<div style="border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:10px; box-sizing:border-box">`
    body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0 0 8px 0; white-space:nowrap"><input type="checkbox" name="surfaceGroupFeed" value="1"${journeyTargetBySurface.has('group_feed') ? ' checked' : ''} /> Groups</label>`
    body += `<label style="margin:0 0 8px 0">Targeting<select name="surfaceGroupFeedMode"><option value="all"${journeyGroupsTargeting.targetingMode === 'all' ? ' selected' : ''}>All</option><option value="selected"${journeyGroupsTargeting.targetingMode === 'selected' ? ' selected' : ''}>Selected only</option></select></label>`
    body += `<label style="margin:0">Selected Groups<select name="surfaceGroupTargetIds" multiple size="6">`
    for (const group of surfaceTargetOptions.groups) {
      const selected = journeyGroupsTargeting.targetIds.includes(Number(group.id))
      const label = `${group.name}${group.slug ? ` (${group.slug})` : ''} [#${group.id}]`
      body += `<option value="${group.id}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
    }
    body += `</select></label>`
    body += `</div>`
    body += `<div style="border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:10px; box-sizing:border-box">`
    body += `<label style="display:flex; align-items:center; justify-content:flex-start; gap:8px; font-weight:700; margin:0 0 8px 0; white-space:nowrap"><input type="checkbox" name="surfaceChannelFeed" value="1"${journeyTargetBySurface.has('channel_feed') ? ' checked' : ''} /> Channels</label>`
    body += `<label style="margin:0 0 8px 0">Targeting<select name="surfaceChannelFeedMode"><option value="all"${journeyChannelsTargeting.targetingMode === 'all' ? ' selected' : ''}>All</option><option value="selected"${journeyChannelsTargeting.targetingMode === 'selected' ? ' selected' : ''}>Selected only</option></select></label>`
    body += `<label style="margin:0">Selected Channels<select name="surfaceChannelTargetIds" multiple size="6">`
    for (const channel of surfaceTargetOptions.channels) {
      const selected = journeyChannelsTargeting.targetIds.includes(Number(channel.id))
      const label = `${channel.name}${channel.slug ? ` (${channel.slug})` : ''} [#${channel.id}]`
      body += `<option value="${channel.id}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
    }
    body += `</select></label>`
    body += `</div>`
    body += `</div>`
    body += `</div>`

    body += `<button type="button" class="journey-section-toggle" data-target="journey-section-eligibility" aria-expanded="false" style="width:100%; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:#fff; text-align:left; padding:0; margin:10px 0 6px; cursor:pointer;"><span class="journey-section-chevron">▸</span><span class="journey-block-title">ELIGIBILITY</span></button>`
    body += `<div id="journey-section-eligibility" class="section journey-card" style="display:none">`
    body += `<label>Eligibility Ruleset (optional)</label>`
    body += `<div class="picker-row" style="display:flex; align-items:center; gap:8px">`
    body += `<select id="journey-eligibility-select" name="eligibilityRulesetId"><option value="">None</option>`
    for (const r of rulesets) {
      const rid = Number(r.id || 0)
      const rname = rulesetNameById.get(rid) || `Ruleset #${rid}`
      const rstatus = String((r as any).status || '').trim().toLowerCase()
      const suffix = rstatus ? ` [${rstatus}]` : ''
      body += `<option value="${rid}"${String(journey.eligibilityRulesetId || '') === String(rid) ? ' selected' : ''}>${escapeHtml(`${rname}${suffix} #${rid}`)}</option>`
    }
    body += `</select>`
    body += `<button type="button" id="journey-eligibility-view" class="btn" title="View ruleset criteria" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:16px; line-height:1;">{}</button>`
    body += `</div>`
    body += `<div class="field-hint">Journey ruleset gates all steps in this journey. Step progression is controlled only by progression policy.</div>`
    body += `</div>`

    body += `<div class="toolbar" style="display:flex; justify-content:space-between; gap:10px; margin-top:12px">`
    body += `<button class="btn danger" type="submit" formaction="/admin/message-journeys/${id}/delete" formmethod="post" formnovalidate onclick="return confirm('Delete this journey?')">Delete</button>`
    body += `<button class="btn btn-primary-accent" type="submit">Save</button>`
    body += `</div>`
    body += `</form>`

    body += `<button type="button" class="journey-section-toggle" data-target="journey-section-steps" aria-expanded="false" style="width:100%; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:#fff; text-align:left; padding:0; margin:10px 0 6px; cursor:pointer;"><span class="journey-section-chevron">▸</span><span class="journey-block-title">STEPS</span></button>`
    body += `<div id="journey-section-steps" style="display:none">`
    if (!steps.length) {
      body += `<p>No steps yet.</p>`
    } else {
      for (const [idx, step] of steps.entries()) {
        const stepConfig = step.config && typeof step.config === 'object' ? step.config as Record<string, any> : {}
        const stepPolicy = getJourneyProgressionPolicyConfig(stepConfig)
        const stepPickerSelected = `${stepPolicy.slot || ''}|${stepPolicy.intentKey || ''}`
        body += `<form method="post" action="/admin/message-journeys/${id}/steps/${step.id}" autocomplete="off" class="journey-card" style="margin:10px 0">`
        if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<div style="font-weight:800; letter-spacing:0.02em; margin:0 0 8px 0">STEP ${idx + 1}</div>`
        body += `<div class="field-hint" style="margin:0 0 8px 0; display:none" data-internal-step-meta="1">Internal key: ${escapeHtml(String(step.stepKey || ''))} | Order: ${Number(step.stepOrder || 0)}</div>`
        body += `<div style="display:grid; grid-template-columns:minmax(0,1fr); gap:10px">`
        body += `<label>Message</label>`
        body += `<select name="messageId" required style="width:100%">`
        body += `<option value="">Select message</option>`
        for (const m of messages) {
          const mid = Number(m.id || 0)
          const mname = messageNameById.get(mid) || `Message #${mid}`
          body += `<option value="${mid}"${mid === Number(step.messageId) ? ' selected' : ''}>${escapeHtml(`${mname} [#${mid}]`)}</option>`
        }
        body += `</select>`
        body += `<div style="display:flex; justify-content:flex-end; gap:8px">`
        body += `<a class="btn js-message-edit-link" href="${Number(step.messageId) > 0 ? `/admin/messages/${Number(step.messageId)}` : '#'}" title="Open selected message" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:16px; line-height:1;">🔗</a>`
        body += `<button type="button" class="btn js-message-preview-open" title="Preview selected message" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:16px; line-height:1;">👁</button>`
        body += `</div>`
        body += `<label>Progression Policy<select name="progressionPolicy" class="js-progression-policy">`
        for (const opt of MESSAGE_JOURNEY_STEP_PROGRESSION_POLICY_OPTIONS) {
          body += `<option value="${escapeHtml(opt.value)}"${stepPolicy.policy === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
        }
        body += `</select></label>`
        body += `<label class="js-cta-picker-row">CTA Picker<select name="progressionCtaPicker" class="js-cta-picker" data-selected="${escapeHtml(stepPickerSelected)}"><option value="">Select CTA from message</option></select></label>`
        body += `<div class="field-hint js-cta-slot-indicator" style="display:none"><strong>CTA Slot:</strong> <span class="js-cta-slot-text">—</span></div>`
        body += `<div class="field-hint js-cta-intent-indicator" style="display:none"><strong>Intent Key:</strong> <span class="js-cta-intent-text">—</span></div>`
        body += `<input type="hidden" name="progressionSlot" value="${escapeHtml(stepPolicy.slot)}" />`
        body += `<input type="hidden" name="progressionIntentKey" value="${escapeHtml(stepPolicy.intentKey)}" />`
        body += `<label>Status<select name="status">`
        for (const opt of MESSAGE_JOURNEY_STEP_STATUS_OPTIONS) {
          body += `<option value="${escapeHtml(opt.value)}"${String(step.status || 'draft') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
        }
        body += `</select></label>`
        body += `</div>`
        body += `<div class="field-hint">Progression policy controls when this journey step is marked complete based on canonical CTA outcomes.</div>`
        body += `<details style="margin-top:8px"><summary style="cursor:pointer; user-select:none">JSON Config</summary>`
        body += `<label style="margin-top:8px">Config JSON<textarea name="configJson" rows="6" style="font-family: ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(JSON.stringify(step.config || {}, null, 2))}</textarea></label>`
        body += `</details>`
        body += `<div class="toolbar" style="display:flex; justify-content:space-between; gap:10px">`
        body += `<button class="btn danger" type="submit" formaction="/admin/message-journeys/${id}/steps/${step.id}/delete" formmethod="post" formnovalidate onclick="return confirm('Delete this step?')">Delete</button>`
        body += `<div style="display:flex; gap:8px; margin-left:auto">`
        body += `<button class="btn" type="submit" formaction="/admin/message-journeys/${id}/steps/${step.id}/clone" formmethod="post" formnovalidate>Clone</button>`
        body += `<button class="btn" type="submit">Save</button>`
        body += `</div>`
        body += `</div>`
        body += `</form>`
      }
    }

    body += `<div class="toolbar"><div></div><div style="display:flex; gap:8px"><a class="btn btn-primary-accent" href="/admin/message-journeys/${id}?add_step=1">Add Step</a></div></div>`

    if (showCreateStep) {
      body += `<form id="create-step-form" method="post" action="/admin/message-journeys/${id}/steps" autocomplete="off">`
      if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
      body += `<div class="section journey-card"><div class="section-title">New Step</div>`
      body += `<div style="display:grid; grid-template-columns:minmax(0,1fr); gap:10px">`
      body += `<label>Message</label>`
      body += `<select name="createMessageId" required style="width:100%"><option value="">Select message</option>`
      for (const m of messages) {
        const mid = Number(m.id || 0)
        const mname = messageNameById.get(mid) || `Message #${mid}`
        body += `<option value="${mid}"${newStepValues.messageId === String(mid) ? ' selected' : ''}>${escapeHtml(`${mname} [#${mid}]`)}</option>`
      }
      body += `</select>`
      body += `<div style="display:flex; justify-content:flex-end; gap:8px">`
      body += `<a class="btn js-message-edit-link" href="${newStepValues.messageId ? `/admin/messages/${encodeURIComponent(String(newStepValues.messageId))}` : '#'}" title="Open selected message" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:16px; line-height:1;">🔗</a>`
      body += `<button type="button" class="btn js-message-preview-open" title="Preview selected message" style="width:40px; min-width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:16px; line-height:1;">👁</button>`
      body += `</div>`
      body += `<label>Progression Policy<select name="createProgressionPolicy" class="js-progression-policy">`
      for (const opt of MESSAGE_JOURNEY_STEP_PROGRESSION_POLICY_OPTIONS) {
        body += `<option value="${escapeHtml(opt.value)}"${(newStepValues.progressionPolicy || 'on_any_completion') === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
      }
      body += `</select></label>`
      body += `<label class="js-cta-picker-row">CTA Picker<select name="createProgressionCtaPicker" class="js-cta-picker" data-selected="${escapeHtml(newStepValues.progressionCtaPicker || '')}"><option value="">Select CTA from message</option></select></label>`
      body += `<div class="field-hint js-cta-slot-indicator" style="display:none"><strong>CTA Slot:</strong> <span class="js-cta-slot-text">—</span></div>`
      body += `<div class="field-hint js-cta-intent-indicator" style="display:none"><strong>Intent Key:</strong> <span class="js-cta-intent-text">—</span></div>`
      body += `<input type="hidden" name="createProgressionSlot" value="${escapeHtml(newStepValues.progressionSlot)}" />`
      body += `<input type="hidden" name="createProgressionIntentKey" value="${escapeHtml(newStepValues.progressionIntentKey)}" />`
      body += `<label>Status<select name="createStatus">`
      for (const opt of MESSAGE_JOURNEY_STEP_STATUS_OPTIONS) {
        body += `<option value="${escapeHtml(opt.value)}"${newStepValues.status === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
      }
      body += `</select></label>`
      body += `</div>`
      body += `<div class="field-hint">Step key and order are auto-assigned when you save.</div>`
      body += `<div class="field-hint">Default policy is <code>on_any_completion</code>. Use slot/intent policy for multi-CTA steps.</div>`
      body += `<details style="margin-top:8px"><summary style="cursor:pointer; user-select:none">JSON Config</summary>`
      body += `<label style="margin-top:8px">Config JSON<textarea name="createConfigJson" rows="6" style="font-family: ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(newStepValues.configJson || '{}')}</textarea></label>`
      body += `</details>`
      body += `<div class="toolbar" style="display:flex; justify-content:space-between; gap:10px"><a class="btn danger" href="/admin/message-journeys/${id}">Delete</a><button class="btn btn-primary-accent" type="submit">Save</button></div>`
      body += `</div></form>`
    }
    body += `</div>`
    body += `<dialog id="journey-eligibility-dialog" style="max-width:860px; width:min(92vw, 860px); border:1px solid #444; border-radius:10px; padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
        <strong id="journey-eligibility-dialog-title">Eligibility Criteria</strong>
        <button type="button" id="journey-eligibility-dialog-close" class="btn" aria-label="Close dialog" style="width:30px; min-width:30px; height:30px; padding:0; border-radius:999px; border:1px solid #000; background:#000; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:900; line-height:1;">×</button>
      </div>
      <pre id="journey-eligibility-dialog-json" style="margin:0; max-height:60vh; overflow:auto; border:1px solid rgba(255,255,255,0.18); border-radius:8px; padding:10px; background:#0b0b0b; color:#fff; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;"></pre>
    </dialog>`
    body += `<dialog id="journey-message-preview-dialog" style="max-width:560px; width:min(92vw, 560px); border:1px solid #444; border-radius:10px; padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
        <strong id="journey-message-preview-title">Message Preview</strong>
        <button type="button" id="journey-message-preview-close" class="btn" aria-label="Close dialog" style="width:30px; min-width:30px; height:30px; padding:0; border-radius:999px; border:1px solid #000; background:#000; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:900; line-height:1;">×</button>
      </div>
      <div id="journey-message-preview-shell" style="border:1px solid rgba(96,165,250,0.6); border-radius:12px; background:linear-gradient(180deg, rgba(28,45,58,0.72) 0%, rgba(12,16,20,0.72) 100%); overflow:hidden">
        <div id="journey-message-preview-device" style="width:100%; max-width:100%; aspect-ratio:9/16; margin:0; background:linear-gradient(130deg,#101828,#1f2937); position:relative">
          <div id="journey-message-preview-overlay" style="position:absolute; inset:0;"></div>
          <div id="journey-message-preview-mode-badge" style="position:absolute; top:10px; right:10px; z-index:2; border:1px solid rgba(255,255,255,0.25); border-radius:999px; padding:3px 8px; font-size:11px; background:rgba(0,0,0,0.45)">Mode: none</div>
          <div id="journey-message-preview-message" style="display:none; position:absolute; left:14px; right:14px; z-index:2; border:1px solid rgba(255,255,255,0.24); border-radius:10px; padding:10px">
            <div id="journey-message-preview-message-label" style="font-size:12px; opacity:0.9; margin-bottom:4px">Message</div>
            <div id="journey-message-preview-message-headline" style="font-size:24px; line-height:1.18; font-weight:800; margin-bottom:8px">Message headline</div>
            <div id="journey-message-preview-message-body" hidden style="opacity:0.9; margin-bottom:8px"></div>
          </div>
          <div id="journey-message-preview-cta" style="display:none; position:absolute; left:14px; right:14px; z-index:2; border:1px solid rgba(255,255,255,0.24); border-radius:10px; padding:8px">
            <div id="journey-message-preview-cta-buttons" style="display:flex; justify-content:space-between; align-items:center; gap:8px">
              <span id="journey-message-preview-slot-1-btn" class="btn" style="justify-self:start; border:1px solid rgba(255,255,255,0.45); border-radius:11px; background:rgba(0,0,0,0.5); padding:8px 12px; display:none; text-align:center; white-space:nowrap; box-sizing:border-box">Primary</span>
              <span id="journey-message-preview-slot-2-btn" class="btn" style="justify-self:center; border:1px solid rgba(255,255,255,0.45); border-radius:11px; background:rgba(0,0,0,0.5); padding:8px 12px; display:none; text-align:center; white-space:nowrap; box-sizing:border-box">Secondary</span>
              <span id="journey-message-preview-slot-3-btn" class="btn" style="justify-self:end; border:1px solid rgba(255,255,255,0.45); border-radius:11px; background:rgba(0,0,0,0.5); padding:8px 12px; display:none; text-align:center; white-space:nowrap; box-sizing:border-box">Tertiary</span>
            </div>
          </div>
        </div>
      </div>
    </dialog>`
    body += `<script>
      ${sharedMessagePreviewRendererScript()}
      (function () {
        const sectionToggles = document.querySelectorAll('.journey-section-toggle[data-target]');
        const journeyKeySuffixBtn = document.getElementById('journey-key-suffix');
        const journeyKeyInput = document.querySelector('input[name="journeyKey"]');
        const appendJourneyDateSuffix = () => {
          if (!journeyKeyInput) return;
          const now = new Date();
          const yyyy = String(now.getUTCFullYear());
          const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(now.getUTCDate()).padStart(2, '0');
          const suffix = '-' + yyyy + '-' + mm + '-' + dd;
          const base = String(journeyKeyInput.value || '').trim();
          journeyKeyInput.value = (base ? base : 'journey') + suffix;
          try { journeyKeyInput.focus(); } catch {}
        };
        if (journeyKeySuffixBtn) journeyKeySuffixBtn.addEventListener('click', appendJourneyDateSuffix);
        const setExpanded = (btn, expanded) => {
          btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          const chev = btn.querySelector('.journey-section-chevron');
          if (chev) chev.textContent = expanded ? '▾' : '▸';
        };
        sectionToggles.forEach((btn) => {
          const targetId = btn.getAttribute('data-target');
          if (!targetId) return;
          const target = document.getElementById(targetId);
          if (!target) return;
          const expanded = btn.getAttribute('aria-expanded') === 'true';
          setExpanded(btn, expanded);
          target.style.display = expanded ? '' : 'none';
          btn.addEventListener('click', () => {
            const next = btn.getAttribute('aria-expanded') !== 'true';
            setExpanded(btn, next);
            target.style.display = next ? '' : 'none';
          });
        });
        const rulesetCriteriaById = ${JSON.stringify(
          Object.fromEntries(
            rulesets.map((r) => [String(Number((r as any).id || 0)), ((r as any).criteria && typeof (r as any).criteria === 'object') ? (r as any).criteria : { version: 1, inclusion: [], exclusion: [] }])
          )
        )};
        const rulesetSelect = document.getElementById('journey-eligibility-select');
        const rulesetViewBtn = document.getElementById('journey-eligibility-view');
        const rulesetDialog = document.getElementById('journey-eligibility-dialog');
        const rulesetDialogClose = document.getElementById('journey-eligibility-dialog-close');
        const rulesetDialogTitle = document.getElementById('journey-eligibility-dialog-title');
        const rulesetDialogJson = document.getElementById('journey-eligibility-dialog-json');
        const syncRulesetButton = () => {
          if (!rulesetViewBtn || !rulesetSelect) return;
          const id = String(rulesetSelect.value || '').trim();
          const enabled = !!id && !!rulesetCriteriaById[id];
          rulesetViewBtn.disabled = !enabled;
          rulesetViewBtn.style.opacity = enabled ? '1' : '0.4';
          rulesetViewBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        };
        if (rulesetSelect) rulesetSelect.addEventListener('change', syncRulesetButton);
        syncRulesetButton();
        if (rulesetViewBtn && rulesetSelect && rulesetDialog && rulesetDialogJson) {
          rulesetViewBtn.addEventListener('click', () => {
            const id = String(rulesetSelect.value || '').trim();
            if (!id || !rulesetCriteriaById[id]) return;
            const selectedOpt = rulesetSelect.options[rulesetSelect.selectedIndex];
            if (rulesetDialogTitle) rulesetDialogTitle.textContent = 'Eligibility Criteria — ' + String((selectedOpt && selectedOpt.text) || ('#' + id));
            rulesetDialogJson.textContent = JSON.stringify(rulesetCriteriaById[id], null, 2);
            if (typeof rulesetDialog.showModal === 'function') rulesetDialog.showModal();
          });
          if (rulesetDialogClose) {
            rulesetDialogClose.addEventListener('click', () => {
              if (typeof rulesetDialog.close === 'function') rulesetDialog.close();
            });
          }
          rulesetDialog.addEventListener('click', (ev) => {
            const rect = rulesetDialog.getBoundingClientRect();
            const x = ev.clientX;
            const y = ev.clientY;
            const outside = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
            if (outside && typeof rulesetDialog.close === 'function') rulesetDialog.close();
          });
        }
        const messagePreviewById = ${JSON.stringify(messagePreviewById)};
        const messagePreviewDialog = document.getElementById('journey-message-preview-dialog');
        const messagePreviewClose = document.getElementById('journey-message-preview-close');
        const messagePreviewTitle = document.getElementById('journey-message-preview-title');
        const messagePreview = {
          device: document.getElementById('journey-message-preview-device'),
          overlay: document.getElementById('journey-message-preview-overlay'),
          modeBadge: document.getElementById('journey-message-preview-mode-badge'),
          message: document.getElementById('journey-message-preview-message'),
          cta: document.getElementById('journey-message-preview-cta'),
          ctaButtons: document.getElementById('journey-message-preview-cta-buttons'),
          messageLabel: document.getElementById('journey-message-preview-message-label'),
          messageHeadline: document.getElementById('journey-message-preview-message-headline'),
          messageBody: document.getElementById('journey-message-preview-message-body'),
          slot1Btn: document.getElementById('journey-message-preview-slot-1-btn'),
          slot2Btn: document.getElementById('journey-message-preview-slot-2-btn'),
          slot3Btn: document.getElementById('journey-message-preview-slot-3-btn'),
        };
        if (messagePreviewClose && messagePreviewDialog) {
          messagePreviewClose.addEventListener('click', () => {
            if (typeof messagePreviewDialog.close === 'function') messagePreviewDialog.close();
          });
          messagePreviewDialog.addEventListener('click', (ev) => {
            const rect = messagePreviewDialog.getBoundingClientRect();
            const x = ev.clientX;
            const y = ev.clientY;
            const outside = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
            if (outside && typeof messagePreviewDialog.close === 'function') messagePreviewDialog.close();
          });
        }
        const ctaOptionsByMessageId = ${JSON.stringify(messageCtaPickerOptionsByMessageId)};
        const query = new URLSearchParams(window.location.search || '');
        const hasCreateDraft =
          query.has('messageId') ||
          query.has('stepStatus') ||
          query.has('progressionPolicy') ||
          query.has('progressionSlot') ||
          query.has('progressionIntentKey') ||
          query.has('progressionCtaPicker') ||
          query.has('configJson');

        function sync(form) {
          const policySel = form.querySelector('.js-progression-policy');
          if (!policySel) return;
          const messageSel = form.querySelector('select[name="messageId"], select[name="createMessageId"]');
          const ctaPickerRow = form.querySelector('.js-cta-picker-row');
          const ctaPickerSel = form.querySelector('.js-cta-picker');
          const ctaSlotIndicator = form.querySelector('.js-cta-slot-indicator');
          const ctaIntentIndicator = form.querySelector('.js-cta-intent-indicator');
          const ctaSlotText = form.querySelector('.js-cta-slot-text');
          const ctaIntentText = form.querySelector('.js-cta-intent-text');
          const policy = String(policySel.value || '');
          const showPicker = (policy === 'on_cta_slot_completion' || policy === 'on_intent_completion') && messageSel && String(messageSel.value || '') !== '';

          if (ctaPickerRow) ctaPickerRow.style.display = showPicker ? '' : 'none';
          if (ctaPickerSel && messageSel) {
            const messageId = String(messageSel.value || '');
            const selected = String(ctaPickerSel.getAttribute('data-selected') || ctaPickerSel.value || '');
            const opts = Array.isArray(ctaOptionsByMessageId[messageId]) ? ctaOptionsByMessageId[messageId] : [];
            ctaPickerSel.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = opts.length ? 'Select CTA from message' : 'No CTAs configured on message';
            ctaPickerSel.appendChild(placeholder);
            opts.forEach((item) => {
              const option = document.createElement('option');
              option.value = String(item.value || '');
              option.textContent = String(item.label || option.value);
              ctaPickerSel.appendChild(option);
            });
            if (selected) ctaPickerSel.value = selected;
            if (!ctaPickerSel.value && opts.length === 1) ctaPickerSel.value = String(opts[0].value || '');
          }

          const ctaPickerValue = ctaPickerSel ? String(ctaPickerSel.value || '') : '';
          let slotFromPicker = '';
          let intentFromPicker = '';
          if (ctaPickerValue) {
            const parts = ctaPickerValue.split('|');
            slotFromPicker = String(parts[0] || '').trim();
            intentFromPicker = String(parts[1] || '').trim().toLowerCase();
          }
          const slotInput = form.querySelector('input[name="progressionSlot"], input[name="createProgressionSlot"]');
          const intentInput = form.querySelector('input[name="progressionIntentKey"], input[name="createProgressionIntentKey"]');
          if (slotInput && slotFromPicker) slotInput.value = slotFromPicker;
          if (intentInput && intentFromPicker) intentInput.value = intentFromPicker;

          const slotValue = slotInput && 'value' in slotInput ? String(slotInput.value || '') : '';
          const intentValue = intentInput && 'value' in intentInput ? String(intentInput.value || '') : '';
          if (ctaSlotText) ctaSlotText.textContent = slotValue || '—';
          if (ctaIntentText) ctaIntentText.textContent = intentValue || '—';
          if (ctaSlotIndicator) ctaSlotIndicator.style.display = policy === 'on_cta_slot_completion' ? '' : 'none';
          if (ctaIntentIndicator) ctaIntentIndicator.style.display = policy === 'on_intent_completion' ? '' : 'none';
        }
        document.querySelectorAll('form[action*="/admin/message-journeys/"][action*="/steps"]').forEach((form) => {
          const policySel = form.querySelector('.js-progression-policy');
          const messageSel = form.querySelector('select[name="messageId"], select[name="createMessageId"]');
          const ctaPickerSel = form.querySelector('.js-cta-picker');
          const editLink = form.querySelector('.js-message-edit-link');
          const syncMessageLink = () => {
            if (!editLink || !messageSel) return;
            const messageId = String(messageSel.value || '').trim();
            const enabled = /^\\d+$/.test(messageId);
            editLink.setAttribute('href', enabled ? ('/admin/messages/' + messageId) : '#');
            editLink.style.opacity = enabled ? '1' : '0.4';
            editLink.style.pointerEvents = enabled ? 'auto' : 'none';
          };
          if (policySel) policySel.addEventListener('change', function () { sync(form); });
          if (messageSel) messageSel.addEventListener('change', function () {
            const picker = form.querySelector('.js-cta-picker');
            if (picker) picker.setAttribute('data-selected', '');
            sync(form);
            syncMessageLink();
          });
          if (ctaPickerSel) ctaPickerSel.addEventListener('change', function () {
            ctaPickerSel.setAttribute('data-selected', String(ctaPickerSel.value || ''));
            sync(form);
          });
          const previewBtn = form.querySelector('.js-message-preview-open');
          if (previewBtn) {
            previewBtn.addEventListener('click', function () {
              const selected = form.querySelector('select[name="messageId"], select[name="createMessageId"]');
              const messageId = selected ? String(selected.value || '') : '';
              const payload = messagePreviewById[messageId];
              if (!payload || !window.__renderMessagePreview || !messagePreviewDialog) return;
              if (messagePreviewTitle) {
                const name = String(payload.name || ('Message #' + messageId));
                messagePreviewTitle.textContent = 'Message Preview — ' + name + ' [#' + messageId + ']';
              }
              window.__renderMessagePreview(messagePreview, payload);
              if (typeof messagePreviewDialog.showModal === 'function') messagePreviewDialog.showModal();
            });
          }
          syncMessageLink();
          sync(form);
        });

        const createForm = document.getElementById('create-step-form');
        if (createForm && !hasCreateDraft) {
          const setValue = (sel, val) => {
            const el = createForm.querySelector(sel);
            if (el && 'value' in el) el.value = val;
          };
          setValue('select[name="createStatus"]', 'draft');
          setValue('select[name="createMessageId"]', '');
          setValue('select[name="createProgressionPolicy"]', 'on_any_completion');
          setValue('input[name="createProgressionSlot"]', '');
          setValue('input[name="createProgressionIntentKey"]', '');
          setValue('textarea[name="createConfigJson"]', '{}');
          sync(createForm);
        }
      })();
    </script>`

    body += `</div>`
    const doc = renderAdminPage({ title: `Edit Message Journey #${id}`, bodyHtml: body, active: 'message_journeys' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message journey detail failed', { path: req.path, journey_id: id })
    res.status(404).send('Message journey not found')
  }
})

pagesRouter.post('/admin/message-journeys/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad journey id')
  const payload = buildMessageJourneyCreateOrUpdatePayload(req.body || {})
  try {
    await messageJourneysSvc.updateJourneyForAdmin(id, payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-journeys/${id}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    res.redirect(`/admin/message-journeys/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to save message journey'))}`)
  }
})

pagesRouter.post('/admin/message-journeys/:id/delete', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad journey id')
  try {
    await messageJourneysSvc.deleteJourneyForAdmin(id, Number(req.user?.id || 0))
    res.redirect('/admin/message-journeys?notice=' + encodeURIComponent('Message journey deleted.'))
  } catch (err: any) {
    res.redirect(`/admin/message-journeys/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to delete message journey'))}`)
  }
})

pagesRouter.post('/admin/message-journeys/:id/steps', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad journey id')
  const payload = buildMessageJourneyStepPayload(req.body || {})
  try {
    await messageJourneysSvc.createJourneyStepForAdmin(id, payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-journeys/${id}?notice=${encodeURIComponent('Step added.')}`)
  } catch (err: any) {
    const q = new URLSearchParams({
      add_step: '1',
      error: String(err?.message || 'Failed to add step'),
      messageId: String(payload.messageId ?? ''),
      stepStatus: String(payload.status || 'draft'),
      progressionPolicy: String(payload.progressionPolicy || ''),
      progressionSlot: String(payload.progressionSlot || ''),
      progressionIntentKey: String(payload.progressionIntentKey || ''),
      progressionCtaPicker: String(payload.progressionCtaPicker || ''),
      configJson: String(payload.config || ''),
    })
    res.redirect(`/admin/message-journeys/${id}?${q.toString()}`)
  }
})

pagesRouter.post('/admin/message-journeys/:id/steps/:stepId', async (req: any, res: any) => {
  const id = Number(req.params.id)
  const stepId = Number(req.params.stepId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad journey id')
  if (!Number.isFinite(stepId) || stepId <= 0) return res.status(400).send('Bad step id')
  const payload = buildMessageJourneyStepPayload(req.body || {})
  try {
    await messageJourneysSvc.updateJourneyStepForAdmin(id, stepId, payload, Number(req.user?.id || 0))
    res.redirect(`/admin/message-journeys/${id}?notice=${encodeURIComponent('Step saved.')}`)
  } catch (err: any) {
    res.redirect(`/admin/message-journeys/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to save step'))}`)
  }
})

pagesRouter.post('/admin/message-journeys/:id/steps/:stepId/delete', async (req: any, res: any) => {
  const id = Number(req.params.id)
  const stepId = Number(req.params.stepId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad journey id')
  if (!Number.isFinite(stepId) || stepId <= 0) return res.status(400).send('Bad step id')
  try {
    await messageJourneysSvc.deleteJourneyStepForAdmin(id, stepId, Number(req.user?.id || 0))
    res.redirect(`/admin/message-journeys/${id}?notice=${encodeURIComponent('Step deleted.')}`)
  } catch (err: any) {
    res.redirect(`/admin/message-journeys/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to delete step'))}`)
  }
})

pagesRouter.post('/admin/message-journeys/:id/steps/:stepId/clone', async (req: any, res: any) => {
  const id = Number(req.params.id)
  const stepId = Number(req.params.stepId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad journey id')
  if (!Number.isFinite(stepId) || stepId <= 0) return res.status(400).send('Bad step id')
  try {
    const cloned = await messageJourneysSvc.cloneJourneyStepForAdmin(id, stepId, Number(req.user?.id || 0))
    res.redirect(`/admin/message-journeys/${id}?notice=${encodeURIComponent(`Step cloned to position ${Number(cloned.stepOrder)}.`)}`)
  } catch (err: any) {
    res.redirect(`/admin/message-journeys/${id}?error=${encodeURIComponent(String(err?.message || 'Failed to clone step'))}`)
  }
})

pagesRouter.get('/admin/journey-inspector', async (req: any, res: any) => {
  const db = getPool()
  const q = req.query || {}
  const userEmail = String(q.user_email || '').trim()
  const anonKey = String(q.anon_key || '').trim()
  const journeySubjectId = String(q.journey_subject_id || '').trim()
  const journeyKey = String(q.journey_key || '').trim()
  const journeyIdRaw = Number(q.journey_id || 0)
  const userIdRaw = Number(q.user_id || 0)
  const selectedInstanceIdRaw = Number(q.instance_id || 0)
  const limitRaw = Number(q.limit || 50)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(Math.round(limitRaw), 1), 200) : 50

  let resolvedUserId = Number.isFinite(userIdRaw) && userIdRaw > 0 ? Math.round(userIdRaw) : 0
  let resolvedUserEmail = userEmail
  let resolvedJourneyId = Number.isFinite(journeyIdRaw) && journeyIdRaw > 0 ? Math.round(journeyIdRaw) : 0
  let resolvedJourneyKey = journeyKey
  let journeyName = ''
  let resolvedJourneySubjectId = ''
  let resolvedJourneySubjectSource = 'none'
  let linkedSubjects: Array<{ source_subject_id: string; canonical_subject_id: string; link_reason: string; updated_at: string }> = []
  const errors: string[] = []
  const explainError = (code: string): string => {
    const key = String(code || '').trim().toLowerCase()
    if (key === 'user_email_not_found') return 'User email was not found.'
    if (key === 'journey_key_not_found') return 'Journey key was not found.'
    if (key === 'journey_id_key_mismatch') return 'Journey ID and Journey Key do not match.'
    if (key === 'journey_id_not_found') return 'Journey ID was not found.'
    return code
  }

  try {
    if (userEmail) {
      const [userRows]: any = await db.query(
        `SELECT id, email FROM users WHERE LOWER(email) = LOWER(?) ORDER BY id ASC LIMIT 1`,
        [userEmail]
      )
      if ((userRows || []).length === 0) {
        errors.push('user_email_not_found')
      } else {
        resolvedUserId = Number(userRows[0].id || 0)
        resolvedUserEmail = String(userRows[0].email || userEmail)
      }
    }

    if (journeyKey && !resolvedJourneyId) {
      const [jRows]: any = await db.query(
        `SELECT id, journey_key, name FROM feed_message_journeys WHERE journey_key = ? ORDER BY id DESC LIMIT 1`,
        [journeyKey]
      )
      if ((jRows || []).length === 0) {
        errors.push('journey_key_not_found')
      } else {
        resolvedJourneyId = Number(jRows[0].id || 0)
        resolvedJourneyKey = String(jRows[0].journey_key || journeyKey)
        journeyName = String(jRows[0].name || '')
      }
    } else if (resolvedJourneyId) {
      const [jRows]: any = await db.query(
        `SELECT id, journey_key, name FROM feed_message_journeys WHERE id = ? LIMIT 1`,
        [resolvedJourneyId]
      )
      if ((jRows || []).length > 0) {
        const foundKey = String(jRows[0].journey_key || '')
        if (journeyKey && foundKey && foundKey !== journeyKey) errors.push('journey_id_key_mismatch')
        resolvedJourneyKey = foundKey || journeyKey
        journeyName = String(jRows[0].name || '')
      } else {
        errors.push('journey_id_not_found')
      }
    }

    if (journeySubjectId) {
      resolvedJourneySubjectId = journeySubjectId
      resolvedJourneySubjectSource = 'explicit'
    } else if (resolvedUserId > 0) {
      resolvedJourneySubjectId = `user:${resolvedUserId}`
      resolvedJourneySubjectSource = 'auth'
    } else if (anonKey) {
      const sourceSubjectId = `anon:${anonKey}`
      const [linkRows]: any = await db.query(
        `SELECT source_subject_id, canonical_subject_id, link_reason, updated_at
           FROM feed_journey_subject_links
          WHERE source_subject_id = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT 1`,
        [sourceSubjectId]
      )
      if ((linkRows || []).length > 0) {
        resolvedJourneySubjectId = String(linkRows[0].canonical_subject_id || sourceSubjectId)
        resolvedJourneySubjectSource = 'linked_anon'
      } else {
        resolvedJourneySubjectId = sourceSubjectId
        resolvedJourneySubjectSource = 'anon'
      }
    }

    if (resolvedJourneySubjectId) {
      const [subjectRows]: any = await db.query(
        `SELECT source_subject_id, canonical_subject_id, link_reason, updated_at
           FROM feed_journey_subject_links
          WHERE source_subject_id = ?
             OR canonical_subject_id = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT 50`,
        [resolvedJourneySubjectId, resolvedJourneySubjectId]
      )
      linkedSubjects = (subjectRows || []).map((r: any) => ({
        source_subject_id: String(r.source_subject_id || ''),
        canonical_subject_id: String(r.canonical_subject_id || ''),
        link_reason: String(r.link_reason || ''),
        updated_at: String(r.updated_at || ''),
      }))
    }

    let instances: any[] = []
    if (resolvedJourneySubjectId) {
      const where: string[] = []
      const params: any[] = []
      where.push(`i.journey_subject_id = ?`)
      params.push(resolvedJourneySubjectId)
      if (resolvedJourneyId > 0) {
        where.push(`i.journey_id = ?`)
        params.push(resolvedJourneyId)
      }
      params.push(limit)
      const [rows]: any = await db.query(
        `SELECT i.id, i.journey_id, i.identity_type, i.identity_key, i.journey_subject_id, i.state, i.current_step_id,
                i.completed_reason, i.completed_event_key, i.first_seen_at, i.last_seen_at, i.completed_at,
                i.metadata_json, i.created_at, i.updated_at,
                j.journey_key, j.name AS journey_name, j.status AS journey_status,
                st.step_order AS current_step_order, st.step_key AS current_step_key
           FROM feed_message_journey_instances i
           LEFT JOIN feed_message_journeys j ON j.id = i.journey_id
           LEFT JOIN feed_message_journey_steps st ON st.id = i.current_step_id
          WHERE ${where.join(' AND ')}
          ORDER BY i.updated_at DESC, i.id DESC
          LIMIT ?`,
        params
      )
      instances = rows || []
    }

    let selectedInstanceId = Number.isFinite(selectedInstanceIdRaw) && selectedInstanceIdRaw > 0 ? Math.round(selectedInstanceIdRaw) : 0
    if (!selectedInstanceId && instances.length > 0) selectedInstanceId = Number(instances[0].id || 0)
    const selectedInstance = instances.find((r) => Number(r.id || 0) === selectedInstanceId) || null

    let stepProgressRows: any[] = []
    let selectedJourneyActiveSteps: any[] = []
    if (selectedInstanceId > 0) {
      const [canonicalRows]: any = await db.query(
        `SELECT p.id, p.journey_instance_id, p.state, p.completed_at, p.updated_at,
                st.id AS step_id, st.step_key, st.step_order, st.message_id,
                m.name AS message_name, 'canonical' AS progress_source
           FROM feed_message_journey_progress p
           LEFT JOIN feed_message_journey_steps st ON st.id = p.step_id
           LEFT JOIN feed_messages m ON m.id = st.message_id
          WHERE p.journey_instance_id = ?
          ORDER BY step_order ASC, id ASC`,
        [selectedInstanceId]
      )
      stepProgressRows = canonicalRows || []
      if (stepProgressRows.length === 0) {
        const [legacyRows]: any = await db.query(
          `SELECT p.id, p.journey_instance_id, p.state, p.completed_at, p.updated_at,
                  st.id AS step_id, st.step_key, st.step_order, st.message_id,
                  m.name AS message_name, 'legacy_user' AS progress_source
             FROM feed_user_message_journey_progress p
             LEFT JOIN feed_message_journey_steps st ON st.id = p.step_id
             LEFT JOIN feed_messages m ON m.id = st.message_id
            WHERE p.journey_instance_id = ?
            UNION ALL
           SELECT p.id, p.journey_instance_id, p.state, p.completed_at, p.updated_at,
                  st.id AS step_id, st.step_key, st.step_order, st.message_id,
                  m.name AS message_name, 'legacy_anon' AS progress_source
             FROM feed_anon_message_journey_progress p
             LEFT JOIN feed_message_journey_steps st ON st.id = p.step_id
             LEFT JOIN feed_messages m ON m.id = st.message_id
            WHERE p.journey_instance_id = ?
            ORDER BY step_order ASC, id ASC`,
          [selectedInstanceId, selectedInstanceId]
        )
        stepProgressRows = legacyRows || []
      }
      if (selectedInstance && Number(selectedInstance.journey_id || 0) > 0) {
        const [activeStepRows]: any = await db.query(
          `SELECT id, step_key, step_order
             FROM feed_message_journey_steps
            WHERE journey_id = ?
              AND status = 'active'
            ORDER BY step_order ASC, id ASC`,
          [Number(selectedInstance.journey_id)]
        )
        selectedJourneyActiveSteps = activeStepRows || []
      }
    }

    const hasQuery = Boolean(userEmail || resolvedUserId > 0 || anonKey || journeySubjectId || journeyKey || resolvedJourneyId > 0)
    let body = '<h1>Journey Inspector</h1><div class="ji-wrap">'
    body += `<style>
      .ji-wrap .section {
        border: 1px solid rgba(96,165,250,0.95);
        border-radius: 14px;
        background: linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%);
        padding: 16px;
        box-sizing: border-box;
        position: relative;
      }
      .ji-wrap .section-title { font-size: 0.9rem; font-weight: 900; letter-spacing: 0.08em; opacity: 0.92; margin: 0 0 10px; }
      .ji-wrap .ji-section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 10px; }
      .ji-wrap .ji-section-head .section-title { margin:0; }
      .ji-wrap .ji-copy-btn {
        border:1px solid rgba(96,165,250,0.95);
        background:rgba(96,165,250,0.14);
        color:#fff;
        font-weight:900;
        border-radius:10px;
        padding:6px 10px;
        line-height:1;
        cursor:pointer;
      }
      .ji-wrap .ji-copy-btn:disabled { opacity:0.6; cursor:default; }
      .ji-wrap label { display:grid; gap:6px; min-width:0; font-weight:800; color:#fff; }
      .ji-wrap input, .ji-wrap select, .ji-wrap textarea {
        width:100%; max-width:100%; box-sizing:border-box;
        background:#0b0b0b; color:#fff; border:1px solid rgba(255,255,255,0.18);
        border-radius:10px; padding:10px 12px; font-size:14px; font-weight:900;
      }
      .ji-wrap .btn {
        border:1px solid rgba(96,165,250,0.95);
        background:rgba(96,165,250,0.14);
        color:#fff; font-weight:900;
      }
      .ji-grid-3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; align-items:start; }
      .ji-table-wrap { overflow-x:auto; }
      .ji-table-wrap table { min-width: 980px; }
      .ji-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
      .ji-summary-item { border:1px solid rgba(255,255,255,0.14); border-radius:12px; background:rgba(255,255,255,0.03); padding:10px; }
      .ji-summary-label { color:#bbb; font-size:12px; font-weight:800; margin-bottom:4px; }
      .ji-summary-value { color:#fff; font-size:18px; font-weight:900; line-height:1.2; word-break:break-word; }
      .ji-metadata details { border:1px solid rgba(255,255,255,0.14); border-radius:10px; background:rgba(255,255,255,0.03); padding:8px 10px; }
      .ji-metadata summary { cursor:pointer; font-weight:800; color:#fff; }
      .ji-metadata pre { margin:8px 0 0 0; max-height:180px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
      @media (max-width: 900px) { .ji-grid-3 { grid-template-columns:minmax(0,1fr); } }
      @media (max-width: 1000px) { .ji-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width: 640px) { .ji-summary-grid { grid-template-columns:minmax(0,1fr); } }
    </style>`
    body += '<div class="toolbar"><div><span class="pill">Run-Level Journey Diagnostics</span></div><div></div></div>'
    body += `<form method="get" action="/admin/journey-inspector" class="section" style="margin:12px 0">
      <div class="section-title">Lookup</div>
      <div class="ji-grid-3">
        <label>User Email<input type="text" name="user_email" value="${escapeHtml(userEmail)}" placeholder="user@example.com" /></label>
        <label>User ID<input type="number" name="user_id" min="1" value="${resolvedUserId > 0 ? escapeHtml(String(resolvedUserId)) : ''}" /></label>
        <label>Anon Key<input type="text" name="anon_key" value="${escapeHtml(anonKey)}" placeholder="anon uuid/key" /></label>
      </div>
      <div class="ji-grid-3" style="margin-top:10px">
        <label>Journey Subject ID<input type="text" name="journey_subject_id" value="${escapeHtml(journeySubjectId)}" placeholder="user:8 or anon:uuid" /></label>
        <div></div>
        <div></div>
      </div>
      <div class="ji-grid-3" style="margin-top:10px">
        <label>Journey Key<input type="text" name="journey_key" value="${escapeHtml(journeyKey)}" /></label>
        <label>Journey ID<input type="number" name="journey_id" min="1" value="${resolvedJourneyId > 0 ? escapeHtml(String(resolvedJourneyId)) : ''}" /></label>
        <label>Limit<input type="number" name="limit" min="1" max="200" value="${escapeHtml(String(limit))}" /></label>
      </div>
      <div style="display:flex; gap:8px; margin-top:10px">
        <button class="btn" type="submit">Apply</button>
        <a class="btn" href="/admin/journey-inspector">Reset</a>
      </div>
      <div class="field-hint" style="margin-top:6px">Inspector resolves to canonical <code>journey_subject_id</code> and uses canonical progress first.</div>
    </form>`

    if (errors.length > 0) {
      body += `<div class="error">${escapeHtml(errors.map(explainError).join(' '))}</div>`
    }

    if (hasQuery && errors.length === 0) {
      body += `<div class="section" id="ji-section-resolved"><div class="ji-section-head"><div class="section-title">Resolved</div><button type="button" class="ji-copy-btn" data-copy-section="resolved" title="Copy section">⧉</button></div>`
      body += `<div class="field-hint">user_id=${resolvedUserId > 0 ? escapeHtml(String(resolvedUserId)) : 'none'}`
      if (resolvedUserEmail) body += ` (${escapeHtml(resolvedUserEmail)})`
      body += ` • anon_key=${anonKey ? escapeHtml(anonKey) : 'none'}`
      body += ` • journey_subject_id=${resolvedJourneySubjectId ? escapeHtml(resolvedJourneySubjectId) : 'none'}`
      body += ` • resolution_source=${escapeHtml(resolvedJourneySubjectSource)}`
      body += ` • journey_id=${resolvedJourneyId > 0 ? escapeHtml(String(resolvedJourneyId)) : 'any'}`
      body += ` • journey_key=${resolvedJourneyKey ? escapeHtml(resolvedJourneyKey) : 'any'}`
      if (journeyName) body += ` (${escapeHtml(journeyName)})`
      body += `</div></div>`

      body += `<div class="section" id="ji-section-subject-links"><div class="ji-section-head"><div class="section-title">Subject Links</div><button type="button" class="ji-copy-btn" data-copy-section="subject_links" title="Copy section">⧉</button></div>`
      if (linkedSubjects.length === 0) {
        body += `<div class="field-hint">No subject links found for resolved subject.</div>`
      } else {
        body += `<div class="ji-table-wrap"><table><thead><tr><th>Source Subject</th><th>Canonical Subject</th><th>Reason</th><th>Updated</th></tr></thead><tbody>`
        for (const row of linkedSubjects) {
          body += `<tr>
            <td>${escapeHtml(row.source_subject_id || '-')}</td>
            <td>${escapeHtml(row.canonical_subject_id || '-')}</td>
            <td>${escapeHtml(row.link_reason || '-')}</td>
            <td>${escapeHtml(row.updated_at || '-')}</td>
          </tr>`
        }
        body += `</tbody></table></div>`
      }
      body += `</div>`

      body += `<div class="section" id="ji-section-summary"><div class="ji-section-head"><div class="section-title">Selected Run Summary</div><button type="button" class="ji-copy-btn" data-copy-section="summary" title="Copy section">⧉</button></div>`
      if (!selectedInstanceId || !selectedInstance) {
        body += `<div class="field-hint">No run selected.</div>`
      } else {
        const terminal = ['completed', 'abandoned', 'expired'].includes(String(selectedInstance.state || '').toLowerCase())
        const summaryReason = String(selectedInstance.completed_reason || '')
        const summaryEvent = String(selectedInstance.completed_event_key || '')
        body += `<div class="ji-summary-grid">`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Run ID</div><div class="ji-summary-value">${escapeHtml(String(selectedInstance.id || ''))}</div></div>`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Journey</div><div class="ji-summary-value">#${escapeHtml(String(selectedInstance.journey_id || ''))} ${escapeHtml(String(selectedInstance.journey_key || ''))}</div></div>`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">State</div><div class="ji-summary-value">${escapeHtml(String(selectedInstance.state || ''))}</div></div>`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Subject</div><div class="ji-summary-value">${escapeHtml(String(selectedInstance.journey_subject_id || '-'))}</div></div>`
        const selectedCurrentStepOrder = Number(selectedInstance.current_step_order || 0)
        let selectedCurrentStepLabel = selectedCurrentStepOrder > 0 ? `STEP ${selectedCurrentStepOrder}` : '-'
        if (selectedCurrentStepOrder <= 0 && selectedJourneyActiveSteps.length > 0) {
          const byStepId = new Map<number, string>()
          for (const row of stepProgressRows) {
            const sid = Number((row as any).step_id || 0)
            if (!Number.isFinite(sid) || sid <= 0) continue
            byStepId.set(sid, String((row as any).state || '').toLowerCase())
          }
          const doneStates = new Set(['completed', 'skipped', 'expired', 'suppressed'])
          const inFlightStates = new Set(['eligible', 'shown', 'clicked'])
          let derivedOrder = 0
          for (const st of selectedJourneyActiveSteps as any[]) {
            const sid = Number(st.id || 0)
            const s = byStepId.get(sid) || ''
            if (inFlightStates.has(s)) { derivedOrder = Number(st.step_order || 0); break }
            if (!s || !doneStates.has(s)) { derivedOrder = Number(st.step_order || 0); break }
          }
          if (derivedOrder > 0) selectedCurrentStepLabel = `STEP ${derivedOrder} (derived)`
        }
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Current Step</div><div class="ji-summary-value">${escapeHtml(selectedCurrentStepLabel)}</div></div>`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Terminal</div><div class="ji-summary-value">${terminal ? 'yes' : 'no'}</div></div>`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Completion Reason</div><div class="ji-summary-value">${escapeHtml(summaryReason || '-')}</div></div>`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Completion Event</div><div class="ji-summary-value">${escapeHtml(summaryEvent || '-')}</div></div>`
        body += `<div class="ji-summary-item"><div class="ji-summary-label">Completed At</div><div class="ji-summary-value">${escapeHtml(String(selectedInstance.completed_at || '-'))}</div></div>`
        body += `</div>`
      }
      body += `</div>`

      body += `<div class="section" id="ji-section-instances"><div class="ji-section-head"><div class="section-title">Journey Instances</div><button type="button" class="ji-copy-btn" data-copy-section="instances" title="Copy section">⧉</button></div><div class="ji-table-wrap">`
      body += `<table><thead><tr>
        <th>ID</th><th>Journey</th><th>Identity</th><th>Subject</th><th>State</th><th>Current Step</th><th>Completed</th><th>Metadata</th><th>Updated</th><th></th>
      </tr></thead><tbody>`
      if (instances.length === 0) {
        body += `<tr><td colspan="10" class="field-hint">No instances found.</td></tr>`
      } else {
        for (const row of instances) {
          const query = new URLSearchParams()
          if (userEmail) query.set('user_email', userEmail)
          if (resolvedUserId > 0) query.set('user_id', String(resolvedUserId))
          if (anonKey) query.set('anon_key', anonKey)
          if (journeySubjectId) query.set('journey_subject_id', journeySubjectId)
          if (resolvedJourneyId > 0) query.set('journey_id', String(resolvedJourneyId))
          if (resolvedJourneyKey) query.set('journey_key', resolvedJourneyKey)
          query.set('limit', String(limit))
          query.set('instance_id', String(row.id))
          const completedLabel = [String(row.completed_reason || ''), String(row.completed_event_key || ''), String(row.completed_at || '')].filter(Boolean).join(' / ')
          let metadataStr = '{}'
          try { metadataStr = JSON.stringify((row as any).metadata_json || {}, null, 2) } catch {}
          body += `<tr>
            <td>${escapeHtml(String(row.id))}</td>
            <td>#${escapeHtml(String(row.journey_id || ''))} ${escapeHtml(String(row.journey_key || ''))}</td>
            <td>${escapeHtml(String(row.identity_type || ''))}:${escapeHtml(String(row.identity_key || ''))}</td>
            <td>${escapeHtml(String(row.journey_subject_id || '-'))}</td>
            <td>${escapeHtml(String(row.state || ''))}</td>
            <td>${Number(row.current_step_order || 0) > 0 ? `STEP ${escapeHtml(String(row.current_step_order))}` : '-'}</td>
            <td>${escapeHtml(completedLabel || '-')}</td>
            <td class="ji-metadata"><details><summary>View JSON</summary><pre>${escapeHtml(metadataStr)}</pre></details></td>
            <td>${escapeHtml(String(row.updated_at || ''))}</td>
            <td><a href="/admin/journey-inspector?${escapeHtml(query.toString())}">Inspect</a></td>
          </tr>`
        }
      }
      body += `</tbody></table></div></div>`

      body += `<div class="section" id="ji-section-progress"><div class="ji-section-head"><div class="section-title">Step Progress (Selected Run)</div><button type="button" class="ji-copy-btn" data-copy-section="progress" title="Copy section">⧉</button></div>`
      if (!selectedInstanceId) {
        body += `<div class="field-hint">No run selected.</div>`
      } else {
        body += `<div class="field-hint">run_id=${escapeHtml(String(selectedInstanceId))}`
        if (selectedInstance) body += ` • state=${escapeHtml(String(selectedInstance.state || ''))}`
        body += `</div>`
        body += `<div class="ji-table-wrap"><table><thead><tr>
          <th>Step</th><th>Message</th><th>State</th><th>Completed At</th><th>Updated At</th><th>Source</th>
        </tr></thead><tbody>`
        if (stepProgressRows.length === 0) {
          body += `<tr><td colspan="6" class="field-hint">No run-scoped step progress rows found for this run.</td></tr>`
        } else {
          for (const p of stepProgressRows) {
            body += `<tr>
              <td>#${escapeHtml(String(p.step_id || ''))} ${escapeHtml(String(p.step_key || ''))} (order ${escapeHtml(String(p.step_order || ''))})</td>
              <td>#${escapeHtml(String(p.message_id || ''))} ${escapeHtml(String(p.message_name || ''))}</td>
              <td>${escapeHtml(String(p.state || ''))}</td>
              <td>${escapeHtml(String(p.completed_at || ''))}</td>
              <td>${escapeHtml(String(p.updated_at || ''))}</td>
              <td>${escapeHtml(String(p.progress_source || ''))}</td>
            </tr>`
          }
        }
        body += `</tbody></table></div>`
      }
      body += `</div>`
    } else if (!hasQuery) {
      body += `<div class="section"><div class="field-hint">Enter user email/user id, anon key, or journey subject id, then apply filters.</div></div>`
    }

    body += `<script>
      (function () {
        function t(el) { return String((el && el.textContent) || '').trim(); }
        function sectionByKey(key) {
          var map = { resolved: 'ji-section-resolved', subject_links: 'ji-section-subject-links', summary: 'ji-section-summary', instances: 'ji-section-instances', progress: 'ji-section-progress' };
          return document.getElementById(map[key] || '');
        }
        function linesFromSection(section) {
          var lines = [];
          var titleEl = section.querySelector('.section-title');
          if (titleEl) lines.push(t(titleEl));
          var summaryItems = section.querySelectorAll('.ji-summary-item');
          summaryItems.forEach(function (item) {
            var label = t(item.querySelector('.ji-summary-label'));
            var value = t(item.querySelector('.ji-summary-value'));
            if (label) lines.push(label + ': ' + (value || '-'));
          });
          var hints = section.querySelectorAll('.field-hint');
          hints.forEach(function (h) {
            var text = t(h);
            if (text) lines.push(text);
          });
          var tables = section.querySelectorAll('table');
          tables.forEach(function (table) {
            var headers = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return t(th); });
            var rows = table.querySelectorAll('tbody tr');
            rows.forEach(function (row) {
              var cells = row.querySelectorAll('td');
              if (!cells.length) return;
              var pairs = [];
              for (var i = 0; i < cells.length; i += 1) {
                var h = headers[i] || ('col_' + (i + 1));
                var v = t(cells[i]);
                if (h) pairs.push(h + ': ' + (v || '-'));
              }
              if (pairs.length) lines.push(pairs.join(' | '));
            });
          });
          return lines.filter(Boolean).join('\\n');
        }
        async function copySection(key, btn) {
          var section = sectionByKey(key);
          if (!section) return;
          var payload = linesFromSection(section);
          if (!payload) return;
          var prev = btn ? btn.textContent : '';
          try {
            await navigator.clipboard.writeText(payload);
            if (btn) { btn.textContent = '✓'; setTimeout(function () { btn.textContent = prev; }, 900); }
          } catch (_) {
            var ta = document.createElement('textarea');
            ta.value = payload;
            ta.style.position = 'fixed';
            ta.style.left = '-10000px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            document.body.removeChild(ta);
            if (btn) { btn.textContent = '✓'; setTimeout(function () { btn.textContent = prev; }, 900); }
          }
        }
        document.querySelectorAll('.ji-copy-btn[data-copy-section]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var key = btn.getAttribute('data-copy-section') || '';
            copySection(key, btn);
          });
        });
      })();
    </script></div>`
    const doc = renderAdminPage({ title: 'Journey Inspector', bodyHtml: body, active: 'journey_inspector' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(doc)
  } catch (err: any) {
    return res.status(500).send(`Failed to load journey inspector: ${escapeHtml(String(err?.message || err))}`)
  }
})

function buildPaymentCatalogPayload(body: any): {
  kind: string
  itemKey: string
  label: string
  status: string
  amountCents: string
  currency: string
  provider: string
  providerRef: string
  configJson: string
} {
  return {
    kind: String(body?.kind || '').trim(),
    itemKey: String(body?.item_key || '').trim(),
    label: String(body?.label || '').trim(),
    status: String(body?.status || '').trim(),
    amountCents: String(body?.amount_cents || '').trim(),
    currency: String(body?.currency || '').trim().toUpperCase(),
    provider: String(body?.provider || '').trim(),
    providerRef: String(body?.provider_ref || '').trim(),
    configJson: String(body?.config_json || '').trim(),
  }
}

function parseOptionalInteger(raw: string): number | null {
  const v = String(raw || '').trim()
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function renderAdminPaymentCatalogForm(opts: {
  title: string
  action: string
  csrfToken: string
  backHref: string
  values: ReturnType<typeof buildPaymentCatalogPayload>
  notice?: string
  error?: string
}): string {
  const v = opts.values
  let body = `<h1>${escapeHtml(opts.title)}</h1>`
  body += `<div class="toolbar"><div><span class="pill">Payment Catalog Item</span></div><div><a href="${escapeHtml(opts.backHref)}">Back to Catalog</a></div></div>`
  if (opts.notice) body += `<div class="notice">${escapeHtml(opts.notice)}</div>`
  if (opts.error) body += `<div class="error">${escapeHtml(opts.error)}</div>`
  body += `<form method="post" action="${escapeHtml(opts.action)}" class="section">`
  body += `<input type="hidden" name="csrf" value="${escapeHtml(opts.csrfToken)}" />`
  body += `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px">`
  body += `<label>Kind<select name="kind">`
  for (const opt of PAYMENT_CATALOG_KIND_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${v.kind === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `<label>Item Key<input type="text" name="item_key" value="${escapeHtml(v.itemKey)}" required placeholder="monthly_support" /></label>`
  body += `<label>Label<input type="text" name="label" value="${escapeHtml(v.label)}" required placeholder="Monthly Support" /></label>`
  body += `<label>Status<select name="status">`
  for (const opt of PAYMENT_CATALOG_STATUS_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${v.status === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `<label>Amount (cents)<input type="number" min="0" step="1" name="amount_cents" value="${escapeHtml(v.amountCents)}" placeholder="500" /></label>`
  body += `<label>Currency<input type="text" maxlength="3" name="currency" value="${escapeHtml(v.currency || 'USD')}" required /></label>`
  body += `<label>Provider<select name="provider">`
  for (const opt of PAYMENT_PROVIDER_OPTIONS) {
    body += `<option value="${escapeHtml(opt.value)}"${v.provider === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  }
  body += `</select></label>`
  body += `<label>Provider Ref<input type="text" name="provider_ref" value="${escapeHtml(v.providerRef)}" placeholder="paypal_plan_or_product_id" /></label>`
  body += `</div>`
  body += `<label style="display:block; margin-top:12px">Config JSON<textarea name="config_json" rows="6" placeholder='{\"notes\":\"optional\"}'>${escapeHtml(v.configJson || '{}')}</textarea></label>`
  body += `<div class="field-hint">Config JSON is optional and reserved for provider-specific metadata.</div>`
  body += `<div style="display:flex; gap:10px; margin-top:14px"><button class="btn" type="submit">Save</button><a class="btn" href="${escapeHtml(opts.backHref)}">Cancel</a></div>`
  body += `</form>`
  return renderAdminPage({ title: opts.title, bodyHtml: body, active: 'payment_catalog' })
}

pagesRouter.get('/admin/payments/providers', async (req: any, res: any) => {
  try {
    const provider = String(req.query?.provider || 'paypal').trim().toLowerCase()
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''
    const configs = await paymentsSvc.listProviderConfigsForAdmin(provider)
    const byMode = new Map<string, any>()
    for (const row of configs.rows || []) byMode.set(String(row.mode), row)

    let body = '<h1>Payment Providers</h1>'
    body += '<div class="toolbar"><div><span class="pill">Provider Config</span></div><div><a href="/admin/payments/catalog">Payment Catalog</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<form method="get" action="/admin/payments/providers" class="section" style="margin:12px 0">`
    body += `<label>Provider<select name="provider">`
    for (const opt of PAYMENT_PROVIDER_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${provider === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label> <button class="btn" type="submit">Load</button>`
    body += `</form>`

    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    for (const modeOpt of PAYMENT_MODE_OPTIONS) {
      const cfg = byMode.get(modeOpt.value)
      const credentials = parseJsonObjectLoose(cfg?.credentials_json)
      const currentClientId = String(credentials?.clientId || credentials?.client_id || '')
      const statusValue = String(cfg?.status || 'disabled')
      body += `<form method="post" action="/admin/payments/providers" class="section" style="margin:12px 0">`
      body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
      body += `<input type="hidden" name="provider" value="${escapeHtml(provider)}" />`
      body += `<input type="hidden" name="mode" value="${escapeHtml(modeOpt.value)}" />`
      body += `<div class="section-title">${escapeHtml(modeOpt.label)} Mode</div>`
      body += `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; align-items:end">`
      body += `<label>Status<select name="status">`
      for (const opt of PAYMENT_PROVIDER_STATUS_OPTIONS) {
        body += `<option value="${escapeHtml(opt.value)}"${statusValue === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
      }
      body += `</select></label>`
      const donateChecked = Number(cfg?.donate_enabled || 0) > 0 ? ' checked' : ''
      const subscribeChecked = Number(cfg?.subscribe_enabled || 0) > 0 ? ' checked' : ''
      body += `<label><input type="checkbox" name="donate_enabled" value="1"${donateChecked} /> Donate enabled</label>`
      body += `<label><input type="checkbox" name="subscribe_enabled" value="1"${subscribeChecked} /> Subscribe enabled</label>`
      body += `<label>Client ID<input type="text" name="client_id" value="" placeholder="Leave blank to keep current" /></label>`
      body += `<label>Client Secret<input type="password" name="client_secret" value="" placeholder="Leave blank to keep current" /></label>`
      body += `<label>Webhook ID<input type="text" name="webhook_id" value="${escapeHtml(String(cfg?.webhook_id || ''))}" /></label>`
      body += `<label>Webhook Secret<input type="password" name="webhook_secret" value="" placeholder="Leave blank to keep current" /></label>`
      body += `</div>`
      body += `<label style="display:block; margin-top:10px">Notes<textarea name="notes" rows="3" placeholder="optional">${escapeHtml(String(cfg?.notes || ''))}</textarea></label>`
      body += `<div class="field-hint">Current client id: ${escapeHtml(maskToken(currentClientId))}. Secrets are never rendered back to the page.</div>`
      body += `<div style="display:flex; gap:10px; margin-top:12px"><button class="btn" type="submit">Save ${escapeHtml(modeOpt.label)} Config</button></div>`
      body += `</form>`
    }

    const doc = renderAdminPage({ title: 'Payment Providers', bodyHtml: body, active: 'payment_providers' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin payments providers failed', { path: req.path })
    res.status(500).send('Failed to load payment providers')
  }
})

pagesRouter.post('/admin/payments/providers', async (req: any, res: any) => {
  const provider = String(req.body?.provider || 'paypal').trim().toLowerCase()
  const mode = String(req.body?.mode || 'sandbox').trim().toLowerCase()
  try {
    const existing = await paymentsSvc.getProviderConfigForAdmin({ provider, mode })
    const prevCredentials = parseJsonObjectLoose(existing?.credentials_json)
    const clientId = String(req.body?.client_id || '').trim()
    const clientSecret = String(req.body?.client_secret || '').trim()
    const webhookSecretInput = String(req.body?.webhook_secret || '').trim()

    const credentials = {
      ...prevCredentials,
      ...(clientId ? { clientId } : {}),
      ...(clientSecret ? { clientSecret } : {}),
    }

    await paymentsSvc.configureProvider({
      provider,
      mode,
      status: String(req.body?.status || 'disabled'),
      donateEnabled: parseBoolLoose(req.body?.donate_enabled, false),
      subscribeEnabled: parseBoolLoose(req.body?.subscribe_enabled, false),
      credentials,
      webhookId: String(req.body?.webhook_id || '').trim() || String(existing?.webhook_id || '').trim() || null,
      webhookSecret: webhookSecretInput || String(existing?.webhook_secret || '').trim() || null,
      notes: String(req.body?.notes || '').trim() || null,
      actorUserId: Number(req.user?.id || 0),
    })

    pagesLogger.info({
      app_operation: 'admin.payments.providers.write',
      app_operation_detail: 'admin.payments.providers.update',
      app_outcome: 'redirect',
      payment_provider: provider,
      payment_mode: mode,
      actor_user_id: Number(req.user?.id || 0),
    }, 'admin.payments.providers.write')

    res.redirect(`/admin/payments/providers?provider=${encodeURIComponent(provider)}&notice=${encodeURIComponent('Saved provider config.')}`)
  } catch (err: any) {
    res.redirect(`/admin/payments/providers?provider=${encodeURIComponent(provider)}&error=${encodeURIComponent(String(err?.message || 'Failed to save provider config'))}`)
  }
})

pagesRouter.get('/admin/payments/catalog', async (req: any, res: any) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const kind = req.query?.kind ? String(req.query.kind) : ''
    const status = req.query?.status ? String(req.query.status) : ''
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''

    const items = await paymentsSvc.listCatalogItemsForAdmin({
      kind: kind || null,
      status: status || null,
      includeArchived,
      limit: 500,
    })

    let body = '<h1>Payment Catalog</h1>'
    body += '<div class="toolbar"><div><span class="pill">Catalog</span></div><div><a href="/admin/payments/catalog/new">New Catalog Item</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<form method="get" action="/admin/payments/catalog" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end">`
    body += `<label>Kind<select name="kind"><option value="">All</option>`
    for (const opt of PAYMENT_CATALOG_KIND_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${kind === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label>Status<select name="status"><option value="">All</option>`
    for (const opt of PAYMENT_CATALOG_STATUS_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${status === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label><input type="checkbox" name="include_archived" value="1"${includeArchived ? ' checked' : ''} /> Include archived</label>`
    body += `<button class="btn" type="submit">Apply</button>`
    body += `</div></form>`

    if (!items.length) {
      body += '<p>No payment catalog items found.</p>'
    } else {
      body += '<table><thead><tr><th>ID</th><th>Kind</th><th>Item Key</th><th>Label</th><th>Status</th><th>Amount</th><th>Provider</th><th>Provider Ref</th><th>Updated</th></tr></thead><tbody>'
      for (const item of items) {
        const amountText = item.amount_cents == null ? '—' : `${Number(item.amount_cents)} ${escapeHtml(String(item.currency || 'USD'))}`
        body += `<tr>
          <td>${item.id}</td>
          <td>${escapeHtml(item.kind)}</td>
          <td><a href="/admin/payments/catalog/${item.id}">${escapeHtml(item.item_key)}</a></td>
          <td>${escapeHtml(item.label)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${amountText}</td>
          <td>${escapeHtml(item.provider)}</td>
          <td>${escapeHtml(String(item.provider_ref || ''))}</td>
          <td>${escapeHtml(String(item.updated_at || ''))}</td>
        </tr>`
      }
      body += '</tbody></table>'
    }

    const doc = renderAdminPage({ title: 'Payment Catalog', bodyHtml: body, active: 'payment_catalog' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin payments catalog failed', { path: req.path })
    res.status(500).send('Failed to load payment catalog')
  }
})

pagesRouter.get('/admin/payments/catalog/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const doc = renderAdminPaymentCatalogForm({
    title: 'New Payment Catalog Item',
    action: '/admin/payments/catalog',
    csrfToken,
    backHref: '/admin/payments/catalog',
    values: {
      kind: 'donate_campaign',
      itemKey: '',
      label: '',
      status: 'draft',
      amountCents: '',
      currency: 'USD',
      provider: 'paypal',
      providerRef: '',
      configJson: '{}',
    },
  })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
})

pagesRouter.post('/admin/payments/catalog', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildPaymentCatalogPayload(req.body || {})
  try {
    const created = await paymentsSvc.createCatalogItemForAdmin({
      kind: payload.kind,
      itemKey: payload.itemKey,
      label: payload.label,
      status: payload.status,
      amountCents: parseOptionalInteger(payload.amountCents),
      currency: payload.currency || 'USD',
      provider: payload.provider || 'paypal',
      providerRef: payload.providerRef || null,
      configJson: payload.configJson || '{}',
      actorUserId: Number(req.user?.id || 0),
    })
    res.redirect(`/admin/payments/catalog/${created.id}?notice=${encodeURIComponent('Catalog item created.')}`)
  } catch (err: any) {
    const doc = renderAdminPaymentCatalogForm({
      title: 'New Payment Catalog Item',
      action: '/admin/payments/catalog',
      csrfToken,
      backHref: '/admin/payments/catalog',
      values: payload,
      error: String(err?.message || 'Failed to create payment catalog item'),
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

pagesRouter.get('/admin/payments/catalog/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad payment catalog id')
  try {
    const row = await paymentsSvc.getCatalogItemForAdmin(id)
    if (!row) return res.status(404).send('Payment catalog item not found')
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminPaymentCatalogForm({
      title: `Edit Payment Catalog Item #${id}`,
      action: `/admin/payments/catalog/${id}`,
      csrfToken,
      backHref: '/admin/payments/catalog',
      values: {
        kind: String(row.kind || ''),
        itemKey: String(row.item_key || ''),
        label: String(row.label || ''),
        status: String(row.status || ''),
        amountCents: row.amount_cents == null ? '' : String(row.amount_cents),
        currency: String(row.currency || 'USD'),
        provider: String(row.provider || 'paypal'),
        providerRef: String(row.provider_ref || ''),
        configJson: String(row.config_json || '{}'),
      },
      notice: req.query?.notice ? String(req.query.notice) : '',
      error: req.query?.error ? String(req.query.error) : '',
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin payment catalog detail failed', { path: req.path, payment_catalog_id: id })
    res.status(500).send('Failed to load payment catalog item')
  }
})

pagesRouter.post('/admin/payments/catalog/:id', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad payment catalog id')
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const payload = buildPaymentCatalogPayload(req.body || {})
  try {
    await paymentsSvc.updateCatalogItemForAdmin({
      id,
      kind: payload.kind,
      itemKey: payload.itemKey,
      label: payload.label,
      status: payload.status,
      amountCents: parseOptionalInteger(payload.amountCents),
      currency: payload.currency || 'USD',
      provider: payload.provider || 'paypal',
      providerRef: payload.providerRef || null,
      configJson: payload.configJson || '{}',
      actorUserId: Number(req.user?.id || 0),
    })
    res.redirect(`/admin/payments/catalog/${id}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    const doc = renderAdminPaymentCatalogForm({
      title: `Edit Payment Catalog Item #${id}`,
      action: `/admin/payments/catalog/${id}`,
      csrfToken,
      backHref: '/admin/payments/catalog',
      values: payload,
      error: String(err?.message || 'Failed to save payment catalog item'),
    })
    res.status(400).set('Content-Type', 'text/html; charset=utf-8').send(doc)
  }
})

function pctText(rate: number): string {
  const n = Number(rate || 0)
  if (!Number.isFinite(n)) return '0.00%'
  return `${(Math.max(0, n) * 100).toFixed(2)}%`
}

function csvCell(value: any): string {
  const raw = value == null ? '' : String(value)
  return `"${raw.replace(/"/g, '""')}"`
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

pagesRouter.get('/admin/analytics', async (req: any, res: any) => {
  try {
    const feedReport = await feedActivitySvc.getFeedActivityReportForAdmin({
      fromDate: req.query?.from,
      toDate: req.query?.to,
      surface: req.query?.surface,
      spaceId: req.query?.space_id,
      viewerState: req.query?.viewer_state,
    })
    const selectedSurface = feedReport.range.surface
    const messageSurfaceEligible = (selectedSurface == null || selectedSurface === 'global_feed') && feedReport.range.spaceId == null
    const emptyMessageReport = {
      range: {
        fromDate: feedReport.range.fromDate,
        toDate: feedReport.range.toDate,
        surface: messageSurfaceEligible ? selectedSurface : null,
        messageId: null,
        messageType: null,
        messageCampaignKey: null,
        viewerState: feedReport.range.viewerState,
      },
      kpis: {
        totals: {
          impressions: 0,
          clicksPrimary: 0,
          clicksSecondary: 0,
          clicksTotal: 0,
          dismiss: 0,
          authStart: 0,
          authComplete: 0,
        },
        uniqueSessions: {
          impressions: 0,
          clicksTotal: 0,
          dismiss: 0,
          authStart: 0,
          authComplete: 0,
        },
        rates: {
          ctr: 0,
          dismissRate: 0,
          authStartRate: 0,
          authCompletionRate: 0,
          completionPerStart: 0,
        },
      },
      byMessage: [],
      byDay: [],
    }
    const messageReport = messageSurfaceEligible
        ? await messageAnalyticsSvc.getMessageAnalyticsReportForAdmin({
          fromDate: feedReport.range.fromDate,
          toDate: feedReport.range.toDate,
          surface: selectedSurface,
          viewerState: feedReport.range.viewerState,
        })
      : emptyMessageReport

    const splitBase = {
      fromDate: feedReport.range.fromDate,
      toDate: feedReport.range.toDate,
      surface: feedReport.range.surface,
      spaceId: feedReport.range.spaceId,
    }
    const [feedAnonymous, feedAuthenticated, messageAnonymous, messageAuthenticated] = await Promise.all([
      feedActivitySvc.getFeedActivityReportForAdmin({ ...splitBase, viewerState: 'anonymous' }),
      feedActivitySvc.getFeedActivityReportForAdmin({ ...splitBase, viewerState: 'authenticated' }),
      messageSurfaceEligible
        ? messageAnalyticsSvc.getMessageAnalyticsReportForAdmin({
            fromDate: splitBase.fromDate,
            toDate: splitBase.toDate,
            surface: splitBase.surface,
            viewerState: 'anonymous',
          })
        : Promise.resolve({ ...emptyMessageReport, range: { ...emptyMessageReport.range, viewerState: 'anonymous' as const } }),
      messageSurfaceEligible
        ? messageAnalyticsSvc.getMessageAnalyticsReportForAdmin({
            fromDate: splitBase.fromDate,
            toDate: splitBase.toDate,
            surface: splitBase.surface,
            viewerState: 'authenticated',
          })
        : Promise.resolve({ ...emptyMessageReport, range: { ...emptyMessageReport.range, viewerState: 'authenticated' as const } }),
    ])
    const selectedSpaceOptions = (selectedSurface === 'group_feed' || selectedSurface === 'channel_feed')
      ? await feedActivitySvc.listSurfaceSpacesForAdmin({
          fromDate: feedReport.range.fromDate,
          toDate: feedReport.range.toDate,
          surface: selectedSurface,
        })
      : []

    const mergedByDate = new Map<string, {
      dateUtc: string
      feedSessionsStarted: number
      feedSessionsEnded: number
      feedSlideImpressions: number
      feedSlideCompletes: number
      feedWatchSeconds: number
      messageImpressions: number
      messageClicks: number
      messageAuthStart: number
      messageAuthComplete: number
    }>()

    for (const row of feedReport.byDay || []) {
      mergedByDate.set(row.dateUtc, {
        dateUtc: row.dateUtc,
        feedSessionsStarted: Number(row.totals.sessionsStarted || 0),
        feedSessionsEnded: Number(row.totals.sessionsEnded || 0),
        feedSlideImpressions: Number(row.totals.slideImpressions || 0),
        feedSlideCompletes: Number(row.totals.slideCompletes || 0),
        feedWatchSeconds: Number(row.totals.totalWatchSeconds || 0),
        messageImpressions: 0,
        messageClicks: 0,
        messageAuthStart: 0,
        messageAuthComplete: 0,
      })
    }
    for (const row of messageReport.byDay || []) {
      const current = mergedByDate.get(row.dateUtc) || {
        dateUtc: row.dateUtc,
        feedSessionsStarted: 0,
        feedSessionsEnded: 0,
        feedSlideImpressions: 0,
        feedSlideCompletes: 0,
        feedWatchSeconds: 0,
        messageImpressions: 0,
        messageClicks: 0,
        messageAuthStart: 0,
        messageAuthComplete: 0,
      }
      current.messageImpressions = Number(row.totals.impressions || 0)
      current.messageClicks = Number(row.totals.clicksTotal || 0)
      current.messageAuthStart = Number(row.totals.authStart || 0)
      current.messageAuthComplete = Number(row.totals.authComplete || 0)
      mergedByDate.set(row.dateUtc, current)
    }
    const dailyRows = Array.from(mergedByDate.values()).sort((a, b) => a.dateUtc.localeCompare(b.dateUtc))

    if (String(req.query?.format || '').toLowerCase() === 'csv') {
      const header = [
        'date_utc',
        'feed_sessions_started',
        'feed_sessions_ended',
        'feed_slide_impressions',
        'feed_slide_completes',
        'feed_completion_rate',
        'feed_total_watch_seconds',
        'feed_avg_watch_seconds_per_session',
        'message_impressions',
        'message_clicks',
        'message_ctr',
        'message_auth_start',
        'message_auth_complete',
        'message_auth_completion_rate',
        'message_coverage_per_slide_impression',
      ]
      const lines = [header.map(csvCell).join(',')]
      for (const row of dailyRows) {
        const feedCompletionRate = row.feedSlideImpressions > 0 ? row.feedSlideCompletes / row.feedSlideImpressions : 0
        const denom = row.feedSessionsEnded > 0 ? row.feedSessionsEnded : row.feedSessionsStarted
        const feedAvgWatch = denom > 0 ? row.feedWatchSeconds / denom : 0
        const messageCtr = row.messageImpressions > 0 ? row.messageClicks / row.messageImpressions : 0
        const messageAuthCompletionRate = row.messageImpressions > 0 ? row.messageAuthComplete / row.messageImpressions : 0
        const messageCoverage = row.feedSlideImpressions > 0 ? row.messageImpressions / row.feedSlideImpressions : 0
        lines.push([
          row.dateUtc,
          row.feedSessionsStarted,
          row.feedSessionsEnded,
          row.feedSlideImpressions,
          row.feedSlideCompletes,
          round2(feedCompletionRate),
          row.feedWatchSeconds,
          round2(feedAvgWatch),
          row.messageImpressions,
          row.messageClicks,
          round2(messageCtr),
          row.messageAuthStart,
          row.messageAuthComplete,
          round2(messageAuthCompletionRate),
          round2(messageCoverage),
        ].map(csvCell).join(','))
      }
      const filename = `analytics-${feedReport.range.fromDate}_to_${feedReport.range.toDate}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.send(lines.join('\n'))
    }

    const q = new URLSearchParams()
    q.set('from', feedReport.range.fromDate)
    q.set('to', feedReport.range.toDate)
    if (feedReport.range.surface) q.set('surface', feedReport.range.surface)
    if (feedReport.range.spaceId != null) q.set('space_id', String(feedReport.range.spaceId))
    if (feedReport.range.viewerState) q.set('viewer_state', feedReport.range.viewerState)

    const feedCoverage = feedReport.kpis.totals.slideImpressions > 0
      ? messageReport.kpis.totals.impressions / feedReport.kpis.totals.slideImpressions
      : 0

    let body = '<h1>Analytics</h1>'
    body += '<div class="toolbar"><div><span class="pill">Cross Metric View</span></div><div></div></div>'
    body += `<form id="analyticsFilters" method="get" action="/admin/analytics" class="section" style="margin:12px 0">`
    body += `<div style="display:grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap:10px; align-items:end">`
    body += `<label>From (UTC)<input type="date" name="from" value="${escapeHtml(feedReport.range.fromDate)}" /></label>`
    body += `<label>To (UTC)<input type="date" name="to" value="${escapeHtml(feedReport.range.toDate)}" /></label>`
    body += `<label>Surface<select name="surface">
      <option value=""${feedReport.range.surface == null ? ' selected' : ''}>All</option>
      <option value="global_feed"${feedReport.range.surface === 'global_feed' ? ' selected' : ''}>Global Feed</option>
      <option value="group_feed"${feedReport.range.surface === 'group_feed' ? ' selected' : ''}>Groups</option>
      <option value="channel_feed"${feedReport.range.surface === 'channel_feed' ? ' selected' : ''}>Channels</option>
      <option value="my_feed"${feedReport.range.surface === 'my_feed' ? ' selected' : ''}>My Feed</option>
    </select></label>`
    if (feedReport.range.surface === 'group_feed' || feedReport.range.surface === 'channel_feed') {
      const label = feedReport.range.surface === 'group_feed' ? 'Group' : 'Channel'
      body += `<label>${label}<select name="space_id">`
      body += `<option value=""${feedReport.range.spaceId == null ? ' selected' : ''}>All ${label}s</option>`
      for (const item of selectedSpaceOptions) {
        const selected = feedReport.range.spaceId === item.id ? ' selected' : ''
        const title = item.slug ? `${item.name} (${item.slug})` : item.name
        body += `<option value="${item.id}"${selected}>${escapeHtml(title)}</option>`
      }
      body += `</select></label>`
    }
    body += `<label>Viewer State<select name="viewer_state">
      <option value=""${feedReport.range.viewerState == null ? ' selected' : ''}>All</option>
      <option value="anonymous"${feedReport.range.viewerState === 'anonymous' ? ' selected' : ''}>Anonymous</option>
      <option value="authenticated"${feedReport.range.viewerState === 'authenticated' ? ' selected' : ''}>Authenticated</option>
    </select></label>`
    body += `</div>`
    body += `<div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap">`
    body += `<a class="btn" href="/admin/analytics?${escapeHtml(`${q.toString()}&format=csv`)}">Export CSV</a>`
    body += `</div>`
    body += `</form>`
    body += `<script>
      (() => {
        const form = document.getElementById('analyticsFilters');
        if (!form) return;
        const selects = form.querySelectorAll('select');
        for (const el of selects) {
          el.addEventListener('change', () => {
            try { form.requestSubmit(); } catch { form.submit(); }
          });
        }
      })();
    </script>`

    body += `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-bottom:12px">`
    body += `<div class="section" style="margin:0"><div class="section-title">Sessions Started</div><div style="font-size:24px; font-weight:800">${feedReport.kpis.totals.sessionsStarted}</div><div class="field-hint">Ended: ${feedReport.kpis.totals.sessionsEnded}</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Slide Impressions</div><div style="font-size:24px; font-weight:800">${feedReport.kpis.totals.slideImpressions}</div><div class="field-hint">Completes: ${feedReport.kpis.totals.slideCompletes}</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Feed Completion Rate</div><div style="font-size:24px; font-weight:800">${pctText(feedReport.kpis.rates.completionRate)}</div><div class="field-hint">Watch sec: ${feedReport.kpis.totals.totalWatchSeconds}</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Message Impressions</div><div style="font-size:24px; font-weight:800">${messageReport.kpis.totals.impressions}</div><div class="field-hint">Message Clicks: ${messageReport.kpis.totals.clicksTotal}</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Message Auth Completions</div><div style="font-size:24px; font-weight:800">${messageReport.kpis.totals.authComplete}</div><div class="field-hint">Auth Starts: ${messageReport.kpis.totals.authStart}</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Message Coverage</div><div style="font-size:24px; font-weight:800">${pctText(feedCoverage)}</div><div class="field-hint">Message impressions / slide impressions</div></div>`
    body += `</div>`

    const splitRows = [
      { label: 'Anonymous', feed: feedAnonymous, message: messageAnonymous },
      { label: 'Authenticated', feed: feedAuthenticated, message: messageAuthenticated },
    ]
    body += '<div class="section">'
    body += '<div class="section-title">Viewer State Split</div>'
    body += '<div class="field-hint" style="margin-bottom:8px">Always computed for both states within current date/surface scope.</div>'
    body += '<table><thead><tr><th>Viewer State</th><th>Sessions</th><th>Slide Impressions</th><th>Slide Completes</th><th>Feed Completion</th><th>Message Impressions</th><th>Message CTR</th><th>Message Auth Complete</th><th>Message Coverage</th></tr></thead><tbody>'
    for (const row of splitRows) {
      const rowCoverage = row.feed.kpis.totals.slideImpressions > 0
        ? row.message.kpis.totals.impressions / row.feed.kpis.totals.slideImpressions
        : 0
      body += `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${row.feed.kpis.totals.sessionsStarted} <span class="field-hint">(ended: ${row.feed.kpis.totals.sessionsEnded})</span></td>
        <td>${row.feed.kpis.totals.slideImpressions}</td>
        <td>${row.feed.kpis.totals.slideCompletes}</td>
        <td>${pctText(row.feed.kpis.rates.completionRate)}</td>
        <td>${row.message.kpis.totals.impressions}</td>
        <td>${pctText(row.message.kpis.rates.ctr)}</td>
        <td>${row.message.kpis.totals.authComplete}</td>
        <td>${pctText(rowCoverage)}</td>
      </tr>`
    }
    body += '</tbody></table></div>'

    if (!dailyRows.length) {
      body += '<p>No analytics rows found in this range.</p>'
    } else {
      body += '<table><thead><tr><th>Date</th><th>Sessions</th><th>Slide Impressions</th><th>Slide Completes</th><th>Feed Completion</th><th>Watch Sec</th><th>Message Impressions</th><th>Message CTR</th><th>Message Auth Complete</th><th>Message Coverage</th></tr></thead><tbody>'
      for (const row of dailyRows) {
        const feedCompletionRate = row.feedSlideImpressions > 0 ? row.feedSlideCompletes / row.feedSlideImpressions : 0
        const messageCtr = row.messageImpressions > 0 ? row.messageClicks / row.messageImpressions : 0
        const messageCoverage = row.feedSlideImpressions > 0 ? row.messageImpressions / row.feedSlideImpressions : 0
        body += `<tr>
          <td>${escapeHtml(row.dateUtc)}</td>
          <td>${row.feedSessionsStarted} <span class="field-hint">(ended: ${row.feedSessionsEnded})</span></td>
          <td>${row.feedSlideImpressions}</td>
          <td>${row.feedSlideCompletes}</td>
          <td>${pctText(feedCompletionRate)}</td>
          <td>${row.feedWatchSeconds}</td>
          <td>${row.messageImpressions}</td>
          <td>${pctText(messageCtr)}</td>
          <td>${row.messageAuthComplete}</td>
          <td>${pctText(messageCoverage)}</td>
        </tr>`
      }
      body += '</tbody></table>'
    }

    const doc = renderAdminPage({ title: 'Analytics', bodyHtml: body, active: 'analytics' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin analytics failed', { path: req.path })
    return res.status(500).send('Failed to load analytics')
  }
})

pagesRouter.get('/admin/message-analytics', async (req: any, res: any) => {
  try {
    const [report, campaignCategoryOptions, campaignKeyOptions] = await Promise.all([
      messageAnalyticsSvc.getMessageAnalyticsReportForAdmin({
        fromDate: req.query?.from,
        toDate: req.query?.to,
        surface: req.query?.surface,
        messageId: req.query?.message_id,
        messageType: req.query?.message_type,
        messageCampaignKey: req.query?.message_campaign_key,
        messageCampaignCategory: req.query?.message_campaign_category,
        viewerState: req.query?.viewer_state,
      }),
      loadCampaignCategoryOptionsForEditor(),
      loadMessageCampaignKeyOptionsForAnalytics(),
    ])

    if (String(req.query?.format || '').toLowerCase() === 'csv') {
      const csv = messageAnalyticsSvc.buildMessageAnalyticsCsv(report)
      const filename = `message-analytics-${report.range.fromDate}_to_${report.range.toDate}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename=\"${filename}\"`)
      return res.send(csv)
    }

    const q = new URLSearchParams()
    q.set('from', report.range.fromDate)
    q.set('to', report.range.toDate)
    if (report.range.surface) q.set('surface', report.range.surface)
    if (report.range.messageId != null) q.set('message_id', String(report.range.messageId))
    if (report.range.messageType) q.set('message_type', report.range.messageType)
    if (report.range.messageCampaignKey) q.set('message_campaign_key', report.range.messageCampaignKey)
    if (report.range.messageCampaignCategory) q.set('message_campaign_category', report.range.messageCampaignCategory)
    if (report.range.viewerState) q.set('viewer_state', report.range.viewerState)

    let body = '<h1>Message Analytics</h1>'
    body += '<div class="toolbar"><div><span class="pill">Message Funnel</span></div><div></div></div>'
    body += `<form method="get" action="/admin/message-analytics" class="section" style="margin:12px 0">`
    body += `<div style="display:grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap:10px; align-items:end">`
    body += `<label>From (UTC)<input type="date" name="from" value="${escapeHtml(report.range.fromDate)}" /></label>`
    body += `<label>To (UTC)<input type="date" name="to" value="${escapeHtml(report.range.toDate)}" /></label>`
    body += `<label>Surface<select name="surface">
      <option value=""${report.range.surface == null ? ' selected' : ''}>All</option>
      <option value="global_feed"${report.range.surface === 'global_feed' ? ' selected' : ''}>Global Feed</option>
    </select></label>`
    body += `<label>Viewer State<select name="viewer_state">
      <option value=""${report.range.viewerState == null ? ' selected' : ''}>All</option>
      <option value="anonymous"${report.range.viewerState === 'anonymous' ? ' selected' : ''}>Anonymous</option>
      <option value="authenticated"${report.range.viewerState === 'authenticated' ? ' selected' : ''}>Authenticated</option>
    </select></label>`
    body += `<label>Message ID<input type="number" name="message_id" min="1" value="${escapeHtml(report.range.messageId == null ? '' : String(report.range.messageId))}" /></label>`
    body += `<label>Type<select name="message_type"><option value="">All</option>`
    for (const opt of MESSAGE_TYPE_OPTIONS) {
      body += `<option value="${escapeHtml(opt.value)}"${report.range.messageType === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select></label>`
    body += `<label>Campaign Key<input type="text" name="message_campaign_key" list="message-analytics-campaign-key-options" value="${escapeHtml(report.range.messageCampaignKey || '')}" /></label>`
    body += `<datalist id="message-analytics-campaign-key-options">`
    for (const key of campaignKeyOptions) {
      body += `<option value="${escapeHtml(key)}"></option>`
    }
    body += `</datalist>`
    body += `<label>Campaign Category<input type="text" name="message_campaign_category" list="message-analytics-campaign-category-options" value="${escapeHtml(report.range.messageCampaignCategory || '')}" /></label>`
    body += `<datalist id="message-analytics-campaign-category-options">`
    for (const category of campaignCategoryOptions) {
      body += `<option value="${escapeHtml(category)}"></option>`
    }
    body += `</datalist>`
    body += `</div>`
    body += `<div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap">`
    body += `<button class="btn" type="submit">Apply</button>`
    body += `<a class="btn" href="/admin/message-analytics?${escapeHtml(`${q.toString()}&format=csv`)}">Export CSV</a>`
    body += `</div>`
    body += `</form>`

    body += `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-bottom:12px">`
    body += `<div class="section" style="margin:0"><div class="section-title">Impressions</div><div style="font-size:24px; font-weight:800">${report.kpis.totals.impressions}</div><div class="field-hint">Unique sessions: ${report.kpis.uniqueSessions.impressions}</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">CTR</div><div style="font-size:24px; font-weight:800">${pctText(report.kpis.rates.ctr)}</div><div class="field-hint">${report.kpis.totals.clicksTotal} clicks</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Pass-through Rate</div><div style="font-size:24px; font-weight:800">${pctText(report.kpis.rates.dismissRate)}</div><div class="field-hint">${report.kpis.totals.dismiss} pass-through</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Auth Start Rate</div><div style="font-size:24px; font-weight:800">${pctText(report.kpis.rates.authStartRate)}</div><div class="field-hint">${report.kpis.totals.authStart} starts</div></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Auth Completion Rate</div><div style="font-size:24px; font-weight:800">${pctText(report.kpis.rates.authCompletionRate)}</div><div class="field-hint">${report.kpis.totals.authComplete} completions</div></div>`
    body += `</div>`

    if (!report.byMessage.length) {
      body += '<p>No message analytics events found in this range.</p>'
    } else {
      body += '<table><thead><tr><th>Message</th><th>Type</th><th>Campaign Key</th><th>Category</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Pass-through</th><th>Pass-through Rate</th><th>Auth Start</th><th>Auth Complete</th><th>Auth Completion Rate</th><th>Status</th></tr></thead><tbody>'
      for (const row of report.byMessage) {
        const status = row.rates.dismissRate >= 0.5 && row.rates.authCompletionRate < 0.01 ? 'Overexposed' : 'Healthy'
        const label = row.messageName ? `${row.messageName} (#${row.messageId})` : `#${row.messageId}`
        body += `<tr>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(row.messageType || '—')}</td>
          <td>${escapeHtml(row.messageCampaignKey || '—')}</td>
          <td>${escapeHtml(row.messageCampaignCategory || '—')}</td>
          <td>${row.totals.impressions} <span class="field-hint">(u:${row.uniqueSessions.impressions})</span></td>
          <td>${row.totals.clicksTotal} <span class="field-hint">(u:${row.uniqueSessions.clicksTotal})</span></td>
          <td>${pctText(row.rates.ctr)}</td>
          <td>${row.totals.dismiss} <span class="field-hint">(u:${row.uniqueSessions.dismiss})</span></td>
          <td>${pctText(row.rates.dismissRate)}</td>
          <td>${row.totals.authStart} <span class="field-hint">(u:${row.uniqueSessions.authStart})</span></td>
          <td>${row.totals.authComplete} <span class="field-hint">(u:${row.uniqueSessions.authComplete})</span></td>
          <td>${pctText(row.rates.authCompletionRate)}</td>
          <td>${escapeHtml(status)}</td>
        </tr>`
      }
      body += '</tbody></table>'

      const byCategory = new Map<string, { impressions: number; clicks: number; authComplete: number }>()
      for (const row of report.byMessage) {
        const key = row.messageCampaignCategory || '(uncategorized)'
        const current = byCategory.get(key) || { impressions: 0, clicks: 0, authComplete: 0 }
        current.impressions += Number(row.totals.impressions || 0)
        current.clicks += Number(row.totals.clicksTotal || 0)
        current.authComplete += Number(row.totals.authComplete || 0)
        byCategory.set(key, current)
      }
      if (byCategory.size) {
        body += '<div class="section" style="margin-top:12px"><div class="section-title">By Campaign Category</div>'
        body += '<table><thead><tr><th>Category</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Auth Complete</th><th>Auth Completion Rate</th></tr></thead><tbody>'
        const rows = Array.from(byCategory.entries()).sort((a, b) => b[1].impressions - a[1].impressions || a[0].localeCompare(b[0]))
        for (const [category, totals] of rows) {
          const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0
          const completionRate = totals.impressions > 0 ? totals.authComplete / totals.impressions : 0
          body += `<tr>
            <td>${escapeHtml(category)}</td>
            <td>${totals.impressions}</td>
            <td>${totals.clicks}</td>
            <td>${pctText(ctr)}</td>
            <td>${totals.authComplete}</td>
            <td>${pctText(completionRate)}</td>
          </tr>`
        }
        body += '</tbody></table></div>'
      }
    }

    if (report.byDay.length) {
      body += '<div class="section" style="margin-top:12px"><div class="section-title">Daily Trend (UTC)</div>'
      body += '<table><thead><tr><th>Date</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Pass-through Rate</th><th>Auth Start Rate</th><th>Auth Completion Rate</th></tr></thead><tbody>'
      for (const row of report.byDay) {
        body += `<tr>
          <td>${escapeHtml(row.dateUtc)}</td>
          <td>${row.totals.impressions}</td>
          <td>${row.totals.clicksTotal}</td>
          <td>${pctText(row.rates.ctr)}</td>
          <td>${pctText(row.rates.dismissRate)}</td>
          <td>${pctText(row.rates.authStartRate)}</td>
          <td>${pctText(row.rates.authCompletionRate)}</td>
        </tr>`
      }
      body += '</tbody></table></div>'
    }

    if ((report as any).journeyRuns) {
      const jr = (report as any).journeyRuns
      body += '<div class="section" style="margin-top:12px"><div class="section-title">Journey Runs</div>'
      body += `<div style="display:flex; flex-wrap:wrap; gap:12px">
        <div class="pill">Starts: ${Number(jr?.totals?.starts || 0)}</div>
        <div class="pill">Completed: ${Number(jr?.totals?.completed || 0)}</div>
        <div class="pill">Abandoned: ${Number(jr?.totals?.abandoned || 0)}</div>
        <div class="pill">Expired: ${Number(jr?.totals?.expired || 0)}</div>
      </div>`
      body += '</div>'
      if (Array.isArray(jr.byJourney) && jr.byJourney.length) {
        body += '<div class="section" style="margin-top:12px"><div class="section-title">Journey Runs By Journey</div>'
        body += '<table><thead><tr><th>Journey</th><th>Starts</th><th>Completed</th><th>Abandoned</th><th>Expired</th></tr></thead><tbody>'
        for (const row of jr.byJourney) {
          body += `<tr>
            <td>${escapeHtml(`${String(row.journeyKey || '')} [#${Number(row.journeyId || 0)}]`)}</td>
            <td>${Number(row.starts || 0)}</td>
            <td>${Number(row.completed || 0)}</td>
            <td>${Number(row.abandoned || 0)}</td>
            <td>${Number(row.expired || 0)}</td>
          </tr>`
        }
        body += '</tbody></table></div>'
      }
      if (Array.isArray(jr.stepFunnel) && jr.stepFunnel.length) {
        body += '<div class="section" style="margin-top:12px"><div class="section-title">Journey Step Funnel (Completed Runs)</div>'
        body += '<table><thead><tr><th>Journey</th><th>Step</th><th>Completed Runs</th></tr></thead><tbody>'
        for (const row of jr.stepFunnel) {
          body += `<tr>
            <td>${escapeHtml(`${String(row.journeyKey || '')} [#${Number(row.journeyId || 0)}]`)}</td>
            <td>${escapeHtml(`${Number(row.stepOrder || 0)} — ${String(row.stepKey || '')}`)}</td>
            <td>${Number(row.completedRuns || 0)}</td>
          </tr>`
        }
        body += '</tbody></table></div>'
      }
    }

    const doc = renderAdminPage({ title: 'Message Analytics', bodyHtml: body, active: 'message_analytics' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin message analytics failed', { path: req.path })
    return res.status(500).send('Failed to load message analytics')
  }
})

pagesRouter.get('/admin/debug', async (_req: any, res: any) => {
  try {
    const unifiedKeys = [
      'CLIENT_DEBUG',
      'CLIENT_DEBUG_EMIT',
      'CLIENT_DEBUG_NS',
      'CLIENT_DEBUG_EVENTS',
      'CLIENT_DEBUG_EXCLUDE',
      'CLIENT_DEBUG_LEVEL',
      'CLIENT_DEBUG_SAMPLE',
      'CLIENT_DEBUG_ID',
      'CLIENT_DEBUG_SESSION',
    ]
    const legacyKeys = [
      'DEBUG',
      'DEBUG_ALLOW_PROD',
      'DEBUG_FEED',
      'DEBUG_SLIDES',
      'DEBUG_AUTH',
      'DEBUG_VIDEO',
      'DEBUG_NETWORK',
      'DEBUG_RENDER',
      'DEBUG_PERF',
      'DEBUG_PERM',
      'DEBUG_ERRORS',
      'DEBUG_FEED_ID',
      'DEBUG_SLIDE_ID',
      'DEBUG_SLIDES_ID',
      'DEBUG_VIDEO_ID',
      'browser:debug',
      'message:debug',
      'message:debug:events',
      'message:debug:sample',
      'message:debug:level',
    ]
    const allKeys = Array.from(new Set(unifiedKeys.concat(legacyKeys)))
    const namespaces = ['feed', 'slides', 'message', 'index', 'sequence', 'video', 'network', 'render', 'auth', 'perf', 'perm', 'errors']
    const eventOptions = [
      'decision:*',
      'decision:request',
      'decision:response',
      'decision:no_insert',
      'decision:error',
      'decision:insert:*',
      'decision:skip:*',
      'impression:recorded',
      'pass_through:*',
      'index:active_changed',
      'reanchor:start',
      'reanchor:end',
      'message_anchor:*',
      'sequence_*',
      'render slide',
      'index -> *',
      'hook:*',
    ]

    let body = '<h1>Debug Controls</h1>'
    body += '<div class="toolbar"><div><span class="pill">Admin Only</span></div><div></div></div>'
    body += '<p class="field-hint">Unified keys are primary. Legacy keys remain compatibility-only during migration.</p>'
    body += '<div style="display:flex; gap:8px; flex-wrap:wrap; margin:10px 0 12px 0">'
    body += '<button id="debugApplyReload" class="btn" type="button">Apply + Reload</button>'
    body += '<button id="debugCopyFlags" class="btn" type="button">Copy Current Flags</button>'
    body += '<button id="debugClearUnified" class="btn" type="button">Clear Unified</button>'
    body += '<button id="debugMigrateLegacy" class="btn" type="button">Migrate Legacy -> Unified</button>'
    body += '<button id="debugClearAll" class="btn" type="button" style="background:#5a1d1d;border-color:#8a2d2d">Clear All Debug Keys</button>'
    body += '</div>'

    body += '<div class="section"><div class="section-title">Outputs</div>'
    body += `<label style="display:flex; align-items:center; gap:8px; margin:6px 0;">
      <input type="checkbox" id="clientDebugEnabled" />
      <span><strong>Console Output</strong><span class="field-hint"> — maps to CLIENT_DEBUG</span></span>
    </label>`
    body += `<label style="display:flex; align-items:center; gap:8px; margin:6px 0;">
      <input type="checkbox" id="clientDebugEmit" />
      <span><strong>Emitter Output</strong><span class="field-hint"> — maps to CLIENT_DEBUG_EMIT</span></span>
    </label>`
    body += '</div>'

    body += '<div class="section"><div class="section-title">Namespaces (CLIENT_DEBUG_NS)</div>'
    body += '<div id="clientDebugNamespaceList" style="display:flex; flex-wrap:wrap; gap:10px;"></div>'
    body += '</div>'

    body += '<div class="section"><div class="section-title">Event Filters</div>'
    body += `<label style="display:block; margin:8px 0;">
      <div style="font-weight:700; margin-bottom:4px">CLIENT_DEBUG_EVENTS (allowlist)</div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input type="text" id="clientDebugEvents" placeholder="decision:*,reanchor:*" style="flex:1 1 360px;" />
        <button type="button" class="btn" id="debugEventsPickerOpen">Select Events</button>
      </div>
      <div class="field-hint">Comma list. Supports * suffix. Blank means allow all.</div>
    </label>`
    body += `<label style="display:block; margin:8px 0;">
      <div style="font-weight:700; margin-bottom:4px">CLIENT_DEBUG_EXCLUDE (denylist)</div>
      <input type="text" id="clientDebugExclude" placeholder="render slide" />
      <div class="field-hint">Comma list. Applied after allowlist.</div>
    </label>`
    body += '</div>'

    body += '<div class="section"><div class="section-title">Level + Sampling</div>'
    body += `<label style="display:block; margin:8px 0;">
      <div style="font-weight:700; margin-bottom:4px">CLIENT_DEBUG_LEVEL</div>
      <select id="clientDebugLevel">
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
    </label>`
    body += `<label style="display:block; margin:8px 0;">
      <div style="font-weight:700; margin-bottom:4px">CLIENT_DEBUG_SAMPLE</div>
      <select id="clientDebugSample">
        <option value="">Default (no sampling)</option>
        <option value="0.1">0.1 (10%)</option>
        <option value="0.25">0.25 (25%)</option>
        <option value="0.5">0.5 (50%)</option>
        <option value="0.75">0.75 (75%)</option>
        <option value="1">1 (100%)</option>
      </select>
    </label>`
    body += '</div>'

    body += '<div class="section"><div class="section-title">ID + Session Filters</div>'
    body += `<label style="display:block; margin:8px 0;">
      <div style="font-weight:700; margin-bottom:4px">CLIENT_DEBUG_ID</div>
      <input type="text" id="clientDebugId" placeholder="v-01KH*" />
    </label>`
    body += `<label style="display:block; margin:8px 0;">
      <div style="font-weight:700; margin-bottom:4px">CLIENT_DEBUG_SESSION</div>
      <input type="text" id="clientDebugSession" placeholder="fas_*" />
    </label>`
    body += '</div>'

    body += '<div class="section"><div class="section-title">Legacy Compatibility</div>'
    body += '<div class="field-hint">Legacy keys are still read by runtime. Saving from this page writes unified keys only.</div>'
    body += '<pre id="legacySnapshot" style="white-space:pre-wrap; word-break:break-word; max-height:180px; overflow:auto; margin:8px 0 0 0;"></pre>'
    body += '</div>'

    body += '<div class="section"><div class="section-title">Current Snapshot</div>'
    body += '<pre id="debugSnapshot" style="white-space:pre-wrap; word-break:break-word; max-height:260px; overflow:auto; margin:0;"></pre>'
    body += '</div>'

    body += '<dialog id="debugEventsDialog" style="max-width:860px; width:min(92vw, 860px); border:1px solid #444; border-radius:10px; padding:14px;">'
    body += '<form method="dialog" style="margin:0;"><div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;"><strong>Client Debug Event Picker</strong><button type="submit" class="btn">Close</button></div></form>'
    body += '<div class="field-hint" style="margin-bottom:10px;">Click badges to toggle allowlist entries.</div>'
    body += '<div id="debugEventsBadgeList" style="display:flex; gap:6px; flex-wrap:wrap;"></div>'
    body += '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;"><button type="button" class="btn" id="debugEventsSelectAll">Select All</button><button type="button" class="btn" id="debugEventsSelectNone">Clear</button><button type="button" class="btn" id="debugEventsApply">Apply To Field</button></div>'
    body += '</dialog>'

    body += `<script>
(() => {
  const UNIFIED_KEYS = ${JSON.stringify(unifiedKeys)};
  const LEGACY_KEYS = ${JSON.stringify(legacyKeys)};
  const ALL_KEYS = ${JSON.stringify(allKeys)};
  const NAMESPACES = ${JSON.stringify(namespaces)};
  const EVENT_OPTIONS = ${JSON.stringify(eventOptions)};
  const q = (s) => document.querySelector(s);
  const selectedEvents = new Set();
  const selectedNs = new Set();
  function getv(k){ return String(localStorage.getItem(k) || '').trim(); }
  function setv(k,v){ if(String(v||'').trim()) localStorage.setItem(k, String(v).trim()); else localStorage.removeItem(k); }
  function csvToSet(v){ return new Set(String(v||'').split(',').map(x=>x.trim()).filter(Boolean)); }
  function setToCsv(s){ return Array.from(s.values()).join(','); }
  function drawNamespaces() {
    const wrap = q('#clientDebugNamespaceList'); if (!wrap) return;
    wrap.innerHTML = '';
    for (const ns of NAMESPACES) {
      const lbl = document.createElement('label');
      lbl.style.display = 'inline-flex'; lbl.style.alignItems = 'center'; lbl.style.gap = '6px';
      lbl.innerHTML = '<input type="checkbox" data-ns="'+ns+'"/> <span>'+ns+'</span>';
      const cb = lbl.querySelector('input');
      cb.checked = selectedNs.has(ns);
      cb.addEventListener('change', () => { if (cb.checked) selectedNs.add(ns); else selectedNs.delete(ns); syncUnifiedFields(); });
      wrap.appendChild(lbl);
    }
  }
  function drawEventBadges() {
    const list = q('#debugEventsBadgeList'); if (!list) return;
    list.innerHTML = '';
    for (const entry of EVENT_OPTIONS) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = entry;
      const on = selectedEvents.has(entry);
      b.style.border = '1px solid ' + (on ? '#4a9cff' : '#555');
      b.style.background = on ? '#193557' : '#242424';
      b.style.color = '#fff'; b.style.padding = '4px 8px'; b.style.borderRadius = '999px'; b.style.cursor = 'pointer';
      b.addEventListener('click', () => { if (selectedEvents.has(entry)) selectedEvents.delete(entry); else selectedEvents.add(entry); drawEventBadges(); });
      list.appendChild(b);
    }
  }
  function syncUnifiedFields() {
    q('#clientDebugEvents').value = setToCsv(selectedEvents);
    q('#clientDebugNs').value = setToCsv(selectedNs);
    writeSnapshot();
  }
  function readLegacyActive() {
    const out = {};
    for (const k of LEGACY_KEYS) { const v = getv(k); if (v) out[k] = v; }
    return out;
  }
  function readUnifiedActive() {
    const out = {};
    for (const k of UNIFIED_KEYS) { const v = getv(k); if (v) out[k] = v; }
    return out;
  }
  function writeSnapshot() {
    const activeUnified = readUnifiedActive();
    const activeLegacy = readLegacyActive();
    q('#debugSnapshot').textContent = JSON.stringify({ unified: activeUnified, legacy_keys_present: Object.keys(activeLegacy) }, null, 2);
    q('#legacySnapshot').textContent = JSON.stringify(activeLegacy, null, 2);
  }
  function loadControls() {
    q('#clientDebugEnabled').checked = getv('CLIENT_DEBUG') === '1';
    q('#clientDebugEmit').checked = getv('CLIENT_DEBUG_EMIT') === '1';
    q('#clientDebugNs').value = getv('CLIENT_DEBUG_NS');
    q('#clientDebugEvents').value = getv('CLIENT_DEBUG_EVENTS');
    q('#clientDebugExclude').value = getv('CLIENT_DEBUG_EXCLUDE');
    q('#clientDebugLevel').value = getv('CLIENT_DEBUG_LEVEL') || 'debug';
    q('#clientDebugSample').value = getv('CLIENT_DEBUG_SAMPLE');
    q('#clientDebugId').value = getv('CLIENT_DEBUG_ID');
    q('#clientDebugSession').value = getv('CLIENT_DEBUG_SESSION');
    selectedNs.clear(); for (const v of csvToSet(q('#clientDebugNs').value)) selectedNs.add(v);
    selectedEvents.clear(); for (const v of csvToSet(q('#clientDebugEvents').value)) selectedEvents.add(v);
    drawNamespaces(); drawEventBadges(); writeSnapshot();
  }
  function applyUnified() {
    setv('CLIENT_DEBUG', q('#clientDebugEnabled').checked ? '1' : '');
    setv('CLIENT_DEBUG_EMIT', q('#clientDebugEmit').checked ? '1' : '');
    setv('CLIENT_DEBUG_NS', q('#clientDebugNs').value);
    setv('CLIENT_DEBUG_EVENTS', q('#clientDebugEvents').value);
    setv('CLIENT_DEBUG_EXCLUDE', q('#clientDebugExclude').value);
    setv('CLIENT_DEBUG_LEVEL', q('#clientDebugLevel').value || 'debug');
    setv('CLIENT_DEBUG_SAMPLE', q('#clientDebugSample').value);
    setv('CLIENT_DEBUG_ID', q('#clientDebugId').value);
    setv('CLIENT_DEBUG_SESSION', q('#clientDebugSession').value);
  }
  function clearUnified(){ for (const k of UNIFIED_KEYS) localStorage.removeItem(k); loadControls(); }
  function clearAll(){ for (const k of ALL_KEYS) localStorage.removeItem(k); loadControls(); }
  function migrateLegacyToUnified() {
    const legacy = readLegacyActive();
    const ns = new Set();
    if (legacy.DEBUG_FEED === '1') ns.add('feed');
    if (legacy.DEBUG_SLIDES === '1') ns.add('slides');
    if (legacy.DEBUG_AUTH === '1') ns.add('auth');
    if (legacy.DEBUG_VIDEO === '1') ns.add('video');
    if (legacy.DEBUG_NETWORK === '1') ns.add('network');
    if (legacy.DEBUG_RENDER === '1') ns.add('render');
    if (legacy.DEBUG_PERF === '1') ns.add('perf');
    if (legacy.DEBUG_PERM === '1') ns.add('perm');
    if (legacy.DEBUG_ERRORS === '1') ns.add('errors');
    if (legacy['message:debug'] === '1') ns.add('message');
    if (legacy['browser:debug'] === '1') { ns.add('index'); ns.add('sequence'); }
    q('#clientDebugEnabled').checked = (legacy.DEBUG === '1') || (legacy['browser:debug'] === '1') || (legacy['message:debug'] === '1');
    q('#clientDebugEmit').checked = (legacy['browser:debug'] === '1') || (legacy['message:debug'] === '1');
    selectedNs.clear(); for (const x of ns) selectedNs.add(x); drawNamespaces();
    const events = legacy['message:debug:events'] || '';
    q('#clientDebugEvents').value = events;
    selectedEvents.clear(); for (const x of csvToSet(events)) selectedEvents.add(x); drawEventBadges();
    q('#clientDebugLevel').value = legacy['message:debug:level'] || 'debug';
    q('#clientDebugSample').value = legacy['message:debug:sample'] || '';
    q('#clientDebugId').value = legacy.DEBUG_FEED_ID || legacy.DEBUG_SLIDE_ID || legacy.DEBUG_VIDEO_ID || '';
    q('#clientDebugSession').value = '';
    q('#clientDebugNs').value = setToCsv(selectedNs);
    applyUnified(); writeSnapshot();
  }
  function copyFlags() {
    const lines = [];
    for (const k of UNIFIED_KEYS.concat(LEGACY_KEYS)) { const v = getv(k); if (!v) continue; lines.push('localStorage.setItem('+JSON.stringify(k)+', '+JSON.stringify(v)+');'); }
    const txt = lines.length ? lines.join('\\n') + '\\nlocation.reload();' : '// no active debug flags';
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(()=>{});
  }
  q('#debugApplyReload').addEventListener('click', () => { applyUnified(); location.reload(); });
  q('#debugCopyFlags').addEventListener('click', () => { applyUnified(); copyFlags(); writeSnapshot(); });
  q('#debugClearUnified').addEventListener('click', () => clearUnified());
  q('#debugClearAll').addEventListener('click', () => clearAll());
  q('#debugMigrateLegacy').addEventListener('click', () => migrateLegacyToUnified());
  q('#debugEventsPickerOpen').addEventListener('click', () => { selectedEvents.clear(); for (const x of csvToSet(q('#clientDebugEvents').value)) selectedEvents.add(x); drawEventBadges(); const d=q('#debugEventsDialog'); if (d && d.showModal) d.showModal(); });
  q('#debugEventsSelectAll').addEventListener('click', () => { selectedEvents.clear(); for (const x of EVENT_OPTIONS) selectedEvents.add(x); drawEventBadges(); });
  q('#debugEventsSelectNone').addEventListener('click', () => { selectedEvents.clear(); drawEventBadges(); });
  q('#debugEventsApply').addEventListener('click', () => { q('#clientDebugEvents').value = setToCsv(selectedEvents); const d=q('#debugEventsDialog'); if (d && d.close) d.close(); writeSnapshot(); });
  q('#clientDebugEvents').addEventListener('input', writeSnapshot);
  q('#clientDebugExclude').addEventListener('input', writeSnapshot);
  q('#clientDebugId').addEventListener('input', writeSnapshot);
  q('#clientDebugSession').addEventListener('input', writeSnapshot);
  q('#clientDebugLevel').addEventListener('change', writeSnapshot);
  q('#clientDebugSample').addEventListener('change', writeSnapshot);
  q('#clientDebugEnabled').addEventListener('change', writeSnapshot);
  q('#clientDebugEmit').addEventListener('change', writeSnapshot);
  // hidden field holder for namespace csv
  const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.id = 'clientDebugNs'; document.body.appendChild(hidden);
  loadControls();
})();
</script>`

    const doc = renderAdminPage({ title: 'Debug', bodyHtml: body, active: 'debug' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(doc)
  } catch (err) {
    return res.status(500).send('Failed to load debug controls')
  }
})

pagesRouter.get('/admin/dev-tools', async (req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const cookies = parseCookies(req.headers?.cookie || '')
  const csrfToken = cookies['csrf'] || ''
  const notice = req.query?.notice ? String(req.query.notice) : ''
  const error = req.query?.error ? String(req.query.error) : ''

  let body = '<h1>Dev Tools</h1>'
  body += `<style>
    .dev-tools-wrap .dt-card {
      border: 1px solid rgba(96,165,250,0.95);
      border-radius: 14px;
      padding: 16px;
      margin: 10px 0;
      background: linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%);
      box-sizing: border-box;
    }
    .dev-tools-wrap .dt-title {
      font-size: 0.95rem;
      font-weight: 900;
      margin: 0 0 10px;
      color: #fff;
    }
    .dev-tools-wrap label { display: grid; gap: 6px; min-width: 0; color: #fff; font-weight: 800; }
    .dev-tools-wrap input,
    .dev-tools-wrap select,
    .dev-tools-wrap textarea {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      background: #0b0b0b;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 14px;
      font-weight: 900;
    }
    .dev-tools-wrap .dt-btn-primary {
      border: 1px solid rgba(96,165,250,0.95);
      background: rgba(96,165,250,0.14);
      color: #fff;
      font-weight: 900;
    }
    .dev-tools-wrap .dt-btn-danger {
      border: 1px solid #8a2d2d;
      background: #5a1d1d;
      color: #fff;
      font-weight: 900;
    }
    .dev-tools-wrap .dt-grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 10px;
      margin-bottom: 8px;
      align-items: start;
    }
    .dev-tools-wrap .dt-grid-3 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
      gap: 10px;
      margin-bottom: 8px;
      align-items: start;
    }
    @media (max-width: 860px) {
      .dev-tools-wrap .dt-grid-2,
      .dev-tools-wrap .dt-grid-3 { grid-template-columns: minmax(0, 1fr); }
    }
  </style>`
  body += `<div class="dev-tools-wrap">`
  body += '<div class="toolbar"><div><span class="pill">Development Reset Actions</span></div><div></div></div>'
  body += '<p class="field-hint">Use these while testing. These actions are destructive and intended for development only.</p>'
  if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`

  const addCsrf = csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''

  const toolCard = (title: string, inner: string) => {
    body += `<div class="dt-card"><div class="dt-title">${escapeHtml(title)}</div>${inner}</div>`
  }
  body += `<div class="section-title" style="margin:14px 0 8px 0">Safe Reset</div>`
  toolCard(
    'Clear My Journey Progress',
    `<form method="post" action="/admin/dev-tools/clear-my-journey-progress" style="margin:0">
      ${addCsrf}
      <button class="btn dt-btn-primary" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Resets only the logged-in admin user journey progress.</div>
    </form>`
  )
  toolCard(
    'Clear Decision Sessions',
    `<form method="post" action="/admin/dev-tools/clear-decision-sessions" style="margin:0">
      ${addCsrf}
      <button class="btn dt-btn-primary" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Resets cadence/session state used by the decision engine.</div>
    </form>`
  )

  body += `<div class="section-title" style="margin:14px 0 8px 0">Destructive Reset</div>`
  toolCard(
    'Clear Suppressions',
    `<form method="post" action="/admin/dev-tools/clear-suppressions" style="margin:0" onsubmit="return confirm('Clear all suppressions and decision sessions?')">
      ${addCsrf}
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Clears <code>feed_message_user_suppressions</code> and <code>message_decision_sessions</code>.</div>
    </form>`
  )
  toolCard(
    'Clear Journey Progress (All)',
    `<form method="post" action="/admin/dev-tools/clear-journey-progress" style="margin:0" onsubmit="return confirm('Clear all user and anonymous journey progress?')">
      ${addCsrf}
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Clears legacy progress tables and canonical <code>feed_message_journey_progress</code>.</div>
    </form>`
  )
  toolCard(
    'Clear Journey State (All)',
    `<form method="post" action="/admin/dev-tools/clear-journey-state" style="margin:0" onsubmit="return confirm('Clear full journey state (instances, progress, suppressions, decision sessions)?')">
      ${addCsrf}
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Clears instances, canonical+legacy progress, subject links, suppressions, and decision sessions.</div>
    </form>`
  )
  toolCard(
    'Clear Journey State (Journey + User)',
    `<form method="post" action="/admin/dev-tools/clear-journey-state-user" style="margin:0" onsubmit="return confirm('Clear journey state for one journey + user?')">
      ${addCsrf}
      <div class="dt-grid-2">
        <label>Journey ID<input type="number" name="journey_id" min="1" required /></label>
        <label>User ID<input type="number" name="user_id" min="1" required /></label>
      </div>
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Clears instances/progress for the selected journey+user and clears suppressions for messages used by that journey.</div>
    </form>`
  )
  toolCard(
    'Clear Journey State (Journey + Subject)',
    `<form method="post" action="/admin/dev-tools/clear-journey-state-subject" style="margin:0" onsubmit="return confirm('Clear journey state for one journey + journey_subject_id?')">
      ${addCsrf}
      <div class="dt-grid-2">
        <label>Journey ID<input type="number" name="journey_id" min="1" required /></label>
        <label>Journey Subject ID<input type="text" name="journey_subject_id" maxlength="160" required placeholder="user:8 or anon:uuid" /></label>
      </div>
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Clears instances/progress by normalized subject id. For user subjects, also clears suppressions for messages used by that journey.</div>
    </form>`
  )
  toolCard(
    'Cooldown Journey State (By Canonical Subject)',
    `<form method="post" action="/admin/dev-tools/cooldown-journey-subject" style="margin:0" onsubmit="return confirm('Apply journey cooldown for this canonical subject (and linked sources)?')">
      ${addCsrf}
      <div class="dt-grid-3">
        <label>Journey Subject ID<input type="text" name="journey_subject_id" required maxlength="160" placeholder="user:8 or anon:uuid" /></label>
        <label>Journey ID (optional)<input type="number" name="journey_id" min="1" placeholder="all journeys" /></label>
        <label>Cooldown Days<input type="number" name="cooldown_days" min="1" max="365" value="2" required /></label>
      </div>
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Primary cooldown tool. For canonical user subjects, linked anon subjects are included automatically.</div>
    </form>`
  )
  toolCard(
    'Cooldown Journey State (User + Merged Anon)',
    `<form method="post" action="/admin/dev-tools/cooldown-journey-user" style="margin:0" onsubmit="return confirm('Apply journey cooldown for this user (and merged anon runs)?')">
      ${addCsrf}
      <div class="dt-grid-3">
        <label>User ID<input type="number" name="user_id" min="1" required /></label>
        <label>Journey ID (optional)<input type="number" name="journey_id" min="1" placeholder="all journeys" /></label>
        <label>Cooldown Days<input type="number" name="cooldown_days" min="1" max="365" value="2" required /></label>
      </div>
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Moves terminal runs (<code>completed</code>/<code>abandoned</code>/<code>expired</code>) back in time for <code>user:&lt;id&gt;</code> and merged anon runs (<code>metadata_json.merged_to_user_id</code>).</div>
    </form>`
  )
  toolCard(
    'Force Re-entry (Create Active Run)',
    `<form method="post" action="/admin/dev-tools/force-journey-reentry" style="margin:0" onsubmit="return confirm('Force a new active journey run for this identity?')">
      ${addCsrf}
      <div class="dt-grid-3">
        <label>Journey ID<input type="number" name="journey_id" min="1" required /></label>
        <label>Identity Type<select name="identity_type"><option value="user">user</option><option value="anon">anon</option></select></label>
        <label>Identity Key<input type="text" name="identity_key" maxlength="120" required placeholder="user id or anon key" /></label>
      </div>
      <button class="btn dt-btn-danger" type="submit">Run</button>
      <div class="field-hint" style="margin-top:6px">Marks any current active run as abandoned, then creates a new active run.</div>
    </form>`
  )
  body += `</div>`

  const doc = renderAdminPage({ title: 'Dev Tools', bodyHtml: body, active: 'dev_tools' })
  res.set('Content-Type', 'text/html; charset=utf-8')
  return res.send(doc)
})

pagesRouter.post('/admin/dev-tools/clear-suppressions', async (_req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  try {
    const [suppressionResult] = await db.query(`DELETE FROM feed_message_user_suppressions`)
    const [sessionResult] = await db.query(`DELETE FROM message_decision_sessions`)
    const suppressions = Number((suppressionResult as any)?.affectedRows || 0)
    const sessions = Number((sessionResult as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cleared suppressions=${suppressions}, decision_sessions=${sessions}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'clear_suppressions_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/clear-journey-progress', async (_req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  try {
    const [canonicalResult] = await db.query(`DELETE FROM feed_message_journey_progress`)
    const [userResult] = await db.query(`DELETE FROM feed_user_message_journey_progress`)
    const [anonResult] = await db.query(`DELETE FROM feed_anon_message_journey_progress`)
    const canonical = Number((canonicalResult as any)?.affectedRows || 0)
    const users = Number((userResult as any)?.affectedRows || 0)
    const anonymous = Number((anonResult as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cleared journey_progress canonical=${canonical}, users=${users}, anonymous=${anonymous}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'clear_journey_progress_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/clear-journey-state', async (_req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  try {
    const [instancesResult] = await db.query(`DELETE FROM feed_message_journey_instances`)
    const [canonicalProgressResult] = await db.query(`DELETE FROM feed_message_journey_progress`)
    const [userProgressResult] = await db.query(`DELETE FROM feed_user_message_journey_progress`)
    const [anonProgressResult] = await db.query(`DELETE FROM feed_anon_message_journey_progress`)
    const [subjectLinksResult] = await db.query(`DELETE FROM feed_journey_subject_links`)
    const [suppressionResult] = await db.query(`DELETE FROM feed_message_user_suppressions`)
    const [sessionsResult] = await db.query(`DELETE FROM message_decision_sessions`)
    const instances = Number((instancesResult as any)?.affectedRows || 0)
    const canonicalProgress = Number((canonicalProgressResult as any)?.affectedRows || 0)
    const userProgress = Number((userProgressResult as any)?.affectedRows || 0)
    const anonProgress = Number((anonProgressResult as any)?.affectedRows || 0)
    const subjectLinks = Number((subjectLinksResult as any)?.affectedRows || 0)
    const suppressions = Number((suppressionResult as any)?.affectedRows || 0)
    const sessions = Number((sessionsResult as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cleared journey_state instances=${instances}, canonical_progress=${canonicalProgress}, user_progress=${userProgress}, anon_progress=${anonProgress}, subject_links=${subjectLinks}, suppressions=${suppressions}, decision_sessions=${sessions}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'clear_journey_state_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/clear-journey-state-user', async (req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  const journeyId = Number(req.body?.journey_id || 0)
  const userId = Number(req.body?.user_id || 0)
  if (!Number.isFinite(journeyId) || journeyId <= 0) return res.redirect('/admin/dev-tools?error=invalid_journey_id')
  if (!Number.isFinite(userId) || userId <= 0) return res.redirect('/admin/dev-tools?error=invalid_user_id')
  try {
    const [instanceResult] = await db.query(
      `DELETE FROM feed_message_journey_instances WHERE journey_id = ? AND identity_type = 'user' AND identity_key = ?`,
      [Math.round(journeyId), String(Math.round(userId))]
    )
    const [userProgressResult] = await db.query(
      `DELETE FROM feed_user_message_journey_progress WHERE journey_id = ? AND user_id = ?`,
      [Math.round(journeyId), Math.round(userId)]
    )
    const [canonicalProgressResult] = await db.query(
      `DELETE FROM feed_message_journey_progress WHERE journey_id = ? AND journey_subject_id = ?`,
      [Math.round(journeyId), `user:${Math.round(userId)}`]
    )
    const [suppressionsResult] = await db.query(
      `DELETE s
         FROM feed_message_user_suppressions s
         WHERE s.user_id = ?
           AND s.campaign_key IN (
             SELECT DISTINCT m.campaign_key
               FROM feed_message_journey_steps st
               JOIN feed_messages m ON m.id = st.message_id
              WHERE st.journey_id = ?
                AND m.campaign_key IS NOT NULL
                AND m.campaign_key <> ''
           )`,
      [Math.round(userId), Math.round(journeyId)]
    )
    const instances = Number((instanceResult as any)?.affectedRows || 0)
    const progress = Number((userProgressResult as any)?.affectedRows || 0)
    const canonicalProgress = Number((canonicalProgressResult as any)?.affectedRows || 0)
    const suppressions = Number((suppressionsResult as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cleared journey+user state instances=${instances}, progress=${progress}, canonical_progress=${canonicalProgress}, suppressions=${suppressions}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'clear_journey_state_user_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/clear-journey-state-subject', async (req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  const journeyId = Number(req.body?.journey_id || 0)
  const journeySubjectId = String(req.body?.journey_subject_id || '').trim()
  if (!Number.isFinite(journeyId) || journeyId <= 0) return res.redirect('/admin/dev-tools?error=invalid_journey_id')
  if (!journeySubjectId) return res.redirect('/admin/dev-tools?error=invalid_journey_subject_id')
  try {
    const [instanceResult] = await db.query(
      `DELETE FROM feed_message_journey_instances WHERE journey_id = ? AND journey_subject_id = ?`,
      [Math.round(journeyId), journeySubjectId]
    )
    const [userProgressResult] = await db.query(
      `DELETE FROM feed_user_message_journey_progress WHERE journey_id = ? AND journey_subject_id = ?`,
      [Math.round(journeyId), journeySubjectId]
    )
    const [anonProgressResult] = await db.query(
      `DELETE FROM feed_anon_message_journey_progress WHERE journey_id = ? AND journey_subject_id = ?`,
      [Math.round(journeyId), journeySubjectId]
    )
    const [canonicalProgressResult] = await db.query(
      `DELETE FROM feed_message_journey_progress WHERE journey_id = ? AND journey_subject_id = ?`,
      [Math.round(journeyId), journeySubjectId]
    )
    let suppressions = 0
    const m = /^user:(\d+)$/i.exec(journeySubjectId)
    if (m) {
      const userId = Number(m[1] || 0)
      if (Number.isFinite(userId) && userId > 0) {
        const [suppressionsResult] = await db.query(
          `DELETE s
             FROM feed_message_user_suppressions s
            WHERE s.user_id = ?
              AND s.campaign_key IN (
                SELECT DISTINCT m.campaign_key
                  FROM feed_message_journey_steps st
                  JOIN feed_messages m ON m.id = st.message_id
                 WHERE st.journey_id = ?
                   AND m.campaign_key IS NOT NULL
                   AND m.campaign_key <> ''
              )`,
          [Math.round(userId), Math.round(journeyId)]
        )
        suppressions = Number((suppressionsResult as any)?.affectedRows || 0)
      }
    }
    const instances = Number((instanceResult as any)?.affectedRows || 0)
    const userProgress = Number((userProgressResult as any)?.affectedRows || 0)
    const anonProgress = Number((anonProgressResult as any)?.affectedRows || 0)
    const canonicalProgress = Number((canonicalProgressResult as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cleared journey+subject state instances=${instances}, canonical_progress=${canonicalProgress}, user_progress=${userProgress}, anon_progress=${anonProgress}, suppressions=${suppressions}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'clear_journey_state_subject_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/cooldown-journey-subject', async (req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  const journeySubjectIdRaw = String(req.body?.journey_subject_id || '').trim()
  const journeyIdRaw = Number(req.body?.journey_id || 0)
  const cooldownDaysRaw = Number(req.body?.cooldown_days || 0)
  if (!journeySubjectIdRaw) return res.redirect('/admin/dev-tools?error=invalid_journey_subject_id')
  const journeyId = Number.isFinite(journeyIdRaw) && journeyIdRaw > 0 ? Math.round(journeyIdRaw) : 0
  const cooldownDays = Number.isFinite(cooldownDaysRaw) && cooldownDaysRaw > 0 ? Math.min(Math.max(Math.round(cooldownDaysRaw), 1), 365) : 2
  try {
    const subjectIds = [journeySubjectIdRaw]
    const canonicalUserMatch = /^user:\d+$/i.test(journeySubjectIdRaw)
    if (canonicalUserMatch) {
      const [linkRows]: any = await db.query(
        `SELECT source_subject_id
           FROM feed_journey_subject_links
          WHERE canonical_subject_id = ?`,
        [journeySubjectIdRaw]
      )
      for (const row of (linkRows || [])) {
        const source = String(row?.source_subject_id || '').trim()
        if (source && !subjectIds.includes(source)) subjectIds.push(source)
      }
    }
    const placeholders = subjectIds.map(() => '?').join(', ')
    const whereJourney = journeyId > 0 ? 'AND journey_id = ?' : ''
    const params: any[] = [cooldownDays, cooldownDays, ...subjectIds]
    if (journeyId > 0) params.push(journeyId)
    const [result] = await db.query(
      `UPDATE feed_message_journey_instances
          SET completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY),
              last_seen_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY),
              updated_at = CURRENT_TIMESTAMP
        WHERE state IN ('completed','abandoned','expired')
          AND journey_subject_id IN (${placeholders})
          ${whereJourney}`,
      params
    )
    const rows = Number((result as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cooldown applied rows=${rows}, journey_subject_id=${journeySubjectIdRaw}, journey_id=${journeyId > 0 ? journeyId : 'all'}, days=${cooldownDays}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'cooldown_journey_subject_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/cooldown-journey-user', async (req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  const userId = Number(req.body?.user_id || 0)
  const journeyIdRaw = Number(req.body?.journey_id || 0)
  const cooldownDaysRaw = Number(req.body?.cooldown_days || 0)
  if (!Number.isFinite(userId) || userId <= 0) return res.redirect('/admin/dev-tools?error=invalid_user_id')
  const journeyId = Number.isFinite(journeyIdRaw) && journeyIdRaw > 0 ? Math.round(journeyIdRaw) : 0
  const cooldownDays = Number.isFinite(cooldownDaysRaw) && cooldownDaysRaw > 0 ? Math.min(Math.max(Math.round(cooldownDaysRaw), 1), 365) : 2
  try {
    const canonicalSubjectId = `user:${Math.round(userId)}`
    const [linkRows]: any = await db.query(
      `SELECT source_subject_id
         FROM feed_journey_subject_links
        WHERE canonical_subject_id = ?`,
      [canonicalSubjectId]
    )
    const subjectIds = Array.from(new Set([
      canonicalSubjectId,
      ...((linkRows || []).map((r: any) => String(r.source_subject_id || '').trim()).filter(Boolean)),
    ]))
    const subjectPlaceholders = subjectIds.map(() => '?').join(', ')
    const whereJourney = journeyId > 0 ? 'AND journey_id = ?' : ''
    const params: any[] = [cooldownDays, cooldownDays, ...subjectIds]
    if (journeyId > 0) params.push(journeyId)
    const [result] = await db.query(
      `UPDATE feed_message_journey_instances
          SET completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY),
              last_seen_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY),
              updated_at = CURRENT_TIMESTAMP
        WHERE state IN ('completed','abandoned','expired')
          AND journey_subject_id IN (${subjectPlaceholders})
          ${whereJourney}`,
      params
    )
    const rows = Number((result as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cooldown applied rows=${rows}, user_id=${Math.round(userId)}, journey_id=${journeyId > 0 ? journeyId : 'all'}, days=${cooldownDays}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'cooldown_journey_user_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/force-journey-reentry', async (req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  const journeyId = Number(req.body?.journey_id || 0)
  const identityTypeRaw = String(req.body?.identity_type || '').trim().toLowerCase()
  const identityType = identityTypeRaw === 'user' ? 'user' : (identityTypeRaw === 'anon' ? 'anon' : '')
  const identityKey = String(req.body?.identity_key || '').trim()
  if (!Number.isFinite(journeyId) || journeyId <= 0) return res.redirect('/admin/dev-tools?error=invalid_journey_id')
  if (!identityType) return res.redirect('/admin/dev-tools?error=invalid_identity_type')
  if (!identityKey) return res.redirect('/admin/dev-tools?error=invalid_identity_key')
  const journeySubjectId = `${identityType}:${identityKey}`
  try {
    const [abandonResult] = await db.query(
      `UPDATE feed_message_journey_instances
          SET state = 'abandoned',
              completed_reason = COALESCE(completed_reason, 'force_reentry'),
              completed_at = COALESCE(completed_at, UTC_TIMESTAMP()),
              last_seen_at = UTC_TIMESTAMP(),
              updated_at = CURRENT_TIMESTAMP
        WHERE journey_id = ?
          AND identity_type = ?
          AND identity_key = ?
          AND state = 'active'`,
      [Math.round(journeyId), identityType, identityKey]
    )
    const [insertResult]: any = await db.query(
      `INSERT INTO feed_message_journey_instances
        (journey_id, identity_type, identity_key, journey_subject_id, state, current_step_id, completed_reason, completed_event_key, first_seen_at, last_seen_at, completed_at, metadata_json)
       VALUES (?, ?, ?, ?, 'active', NULL, NULL, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP(), NULL, JSON_OBJECT('source','dev_tool_force_reentry','journey_subject_id',?, 'created_at',UTC_TIMESTAMP()))`,
      [Math.round(journeyId), identityType, identityKey, journeySubjectId, journeySubjectId]
    )
    const abandoned = Number((abandonResult as any)?.affectedRows || 0)
    const newId = Number(insertResult?.insertId || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Forced re-entry abandoned_active=${abandoned}, new_instance_id=${newId}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'force_journey_reentry_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/clear-my-journey-progress', async (req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const userId = Number(req.user?.id || 0)
  if (!Number.isFinite(userId) || userId <= 0) return res.redirect('/admin/dev-tools?error=invalid_user')
  const db = getPool()
  try {
    const [result] = await db.query(`DELETE FROM feed_user_message_journey_progress WHERE user_id = ?`, [userId])
    const count = Number((result as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cleared my journey progress rows=${count}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'clear_my_journey_progress_failed'))}`)
  }
})

pagesRouter.post('/admin/dev-tools/clear-decision-sessions', async (_req: any, res: any) => {
  if (!isAdminDevToolsEnabled()) return res.status(404).send('Not found')
  const db = getPool()
  try {
    const [result] = await db.query(`DELETE FROM message_decision_sessions`)
    const count = Number((result as any)?.affectedRows || 0)
    return res.redirect(`/admin/dev-tools?notice=${encodeURIComponent(`Cleared decision sessions rows=${count}`)}`)
  } catch (err: any) {
    return res.redirect(`/admin/dev-tools?error=${encodeURIComponent(String(err?.message || 'clear_decision_sessions_failed'))}`)
  }
})

pagesRouter.get('/admin/analytics-sink', async (req: any, res: any) => {
  try {
    const health = getAnalyticsSinkHealth()
    const cfg = health.config
    const stats = health.stats

    let body = '<h1>Analytics Sink</h1>'
    body += '<div class="toolbar"><div><span class="pill">Optional External Sink</span></div><div></div></div>'
    body += '<div class="section">'
    body += '<div class="section-title">Configuration</div>'
    body += '<table><tbody>'
    body += `<tr><th>Enabled</th><td>${cfg.enabled ? 'Yes' : 'No'}</td></tr>`
    body += `<tr><th>Provider</th><td>${escapeHtml(String(cfg.provider))}</td></tr>`
    body += `<tr><th>Sample Rate</th><td>${escapeHtml(String(cfg.sampleRate))}</td></tr>`
    body += `<tr><th>Timeout (ms)</th><td>${escapeHtml(String(cfg.timeoutMs))}</td></tr>`
    body += `<tr><th>PostHog Host</th><td>${escapeHtml(String(cfg.posthogHost))}</td></tr>`
    body += `<tr><th>PostHog API Key</th><td>${cfg.posthogConfigured ? 'Configured' : 'Not configured'}</td></tr>`
    body += '</tbody></table>'
    body += '</div>'

    body += '<div class="section">'
    body += '<div class="section-title">Dispatch Stats (process lifetime)</div>'
    body += '<table><tbody>'
    body += `<tr><th>Attempted</th><td>${escapeHtml(String(stats.attempted))}</td></tr>`
    body += `<tr><th>Success</th><td>${escapeHtml(String(stats.success))}</td></tr>`
    body += `<tr><th>Failure</th><td>${escapeHtml(String(stats.failure))}</td></tr>`
    body += `<tr><th>Dropped: disabled</th><td>${escapeHtml(String(stats.droppedDisabled))}</td></tr>`
    body += `<tr><th>Dropped: sampled</th><td>${escapeHtml(String(stats.droppedSampled))}</td></tr>`
    body += `<tr><th>Dropped: provider</th><td>${escapeHtml(String(stats.droppedProvider))}</td></tr>`
    body += `<tr><th>Dropped: misconfigured</th><td>${escapeHtml(String(stats.droppedMisconfigured))}</td></tr>`
    body += `<tr><th>Dropped: invalid event</th><td>${escapeHtml(String(stats.droppedInvalidEvent))}</td></tr>`
    body += '</tbody></table>'
    body += `<div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap">`
    body += `<a class="btn" href="/admin/analytics-sink">Refresh</a>`
    body += `<a class="btn" href="/api/admin/analytics-sink/health" target="_blank" rel="noopener">Open JSON</a>`
    body += `</div>`
    body += '</div>'

    const doc = renderAdminPage({ title: 'Analytics Sink', bodyHtml: body, active: 'analytics_sink' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin analytics sink page failed', { path: req.path })
    return res.status(500).send('Failed to load analytics sink health')
  }
})

function parseJsonOrNull(raw: any): any | null {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw)) } catch { return null }
}

function renderLowerThirdTemplateForm(opts: {
  csrfToken?: string | null
  error?: string | null
  notice?: string | null
  values: {
    templateKey: string
    version: string
    label: string
    category: string
    svgMarkup: string
    descriptorJson: string
  }
}): string {
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const error = opts.error ? String(opts.error) : ''
  const notice = opts.notice ? String(opts.notice) : ''
  const v = opts.values

  let body = `<h1>New Lower Third Template</h1>`
  body += '<div class="toolbar"><div><a href="/admin/lower-thirds">\u2190 Back to lower thirds</a></div><div></div></div>'
  body += '<p class="field-hint">Templates are immutable once created. To change an existing template, create a new version.</p>'
  if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`
  body += `<form method="post" action="/admin/lower-thirds">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
  body += `<label>Template Key
    <input type="text" name="template_key" value="${escapeHtml(v.templateKey)}" placeholder="lt_modern_gradient_01" />
    <div class="field-hint">Stable identifier (letters/numbers/_/-). Each change requires a new version.</div>
  </label>`
  body += `<label>Version
    <input type="number" name="version" value="${escapeHtml(v.version)}" min="1" step="1" />
    <div class="field-hint">Recommended: use the next version for this key.</div>
  </label>`
  body += `<label>Label
    <input type="text" name="label" value="${escapeHtml(v.label)}" />
  </label>`
  body += `<label>Category
    <input type="text" name="category" value="${escapeHtml(v.category)}" placeholder="clean" />
    <div class="field-hint">Optional grouping for later.</div>
  </label>`
  body += `<label>SVG Markup
    <textarea name="svg_markup" style="min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(v.svgMarkup)}</textarea>
    <div class="field-hint">Must be renderer-safe: no scripts/foreignObject/images/hrefs; editable elements must have stable IDs.</div>
  </label>`
  body += `<label>Descriptor JSON
    <textarea name="descriptor_json" style="min-height: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(v.descriptorJson)}</textarea>
    <div class="field-hint">Defines editable fields/colors and defaults (drives UI + validation).</div>
  </label>`
  body += `<div class="actions">
    <button type="submit">Create template</button>
  </div>`
  body += `</form>`
  return renderAdminPage({ title: 'New Lower Third', bodyHtml: body, active: 'lower_thirds' })
}

pagesRouter.get('/admin/lower-thirds', async (req: any, res: any) => {
  try {
    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, template_key, version, label, category, archived_at, created_at
         FROM lower_third_templates
        ORDER BY template_key ASC, version DESC`
    )
    const items = rows as any[]
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    let body = '<h1>Lower Thirds</h1>'
    body += '<div class="toolbar"><div><span class="pill">System Templates</span></div><div><a href="/admin/lower-thirds/new">New template</a></div></div>'
    body += '<div class="section">'
    body += '<div class="section-title">Templates</div>'
    body += '<p class="field-hint">System-managed SVG templates. Versioned and immutable once created.</p>'
    if (!items.length) {
      body += '<p>No lower third templates yet.</p>'
    } else {
      body += '<table><thead><tr><th>Key</th><th>Version</th><th>Label</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead><tbody>'
      for (const row of items) {
        const key = String(row.template_key || '')
        const ver = Number(row.version || 0)
        const label = escapeHtml(String(row.label || ''))
        const category = escapeHtml(String(row.category || ''))
        const archived = row.archived_at != null
        body += '<tr>'
        body += `<td style="white-space:nowrap">${escapeHtml(key)}</td>`
        body += `<td>${ver}</td>`
        body += `<td>${label}</td>`
        body += `<td>${category}</td>`
        body += `<td>${archived ? '<span class="pill" style="background:rgba(255,180,180,0.12); border:1px solid rgba(255,180,180,0.25)">Archived</span>' : '<span class="pill">Active</span>'}</td>`
        body += `<td style="white-space:nowrap; display:flex; gap:8px; align-items:center">`
        body += `<a class="btn" href="/admin/lower-thirds/new?template_key=${encodeURIComponent(key)}" style="padding:6px 10px; font-size:12px">New version</a>`
        if (archived) {
          body += `<form method="post" action="/admin/lower-thirds/${encodeURIComponent(key)}/${ver}/unarchive" style="display:inline" onsubmit="return confirm('Unarchive ${escapeHtml(key)} v${ver}?');">
            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
            <button type="submit" class="btn" style="padding:6px 10px; font-size:12px">Unarchive</button>
          </form>`
        } else {
          body += `<form method="post" action="/admin/lower-thirds/${encodeURIComponent(key)}/${ver}/archive" style="display:inline" onsubmit="return confirm('Archive ${escapeHtml(key)} v${ver}?');">
            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
            <button type="submit" class="btn danger" style="padding:6px 10px; font-size:12px">Archive</button>
          </form>`
        }
        body += `</td>`
        body += '</tr>'
      }
      body += '</tbody></table>'
    }
    body += '</div>'

    const doc = renderAdminPage({ title: 'Lower Thirds', bodyHtml: body, active: 'lower_thirds' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin lower thirds list failed', { path: req.path })
    res.status(500).send('Failed to load lower thirds')
  }
})

pagesRouter.get('/admin/lower-thirds/new', async (req: any, res: any) => {
  try {
    const db = getPool()
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const templateKey = String(req.query?.template_key || '').trim()

    let prefill = {
      templateKey: templateKey || '',
      version: '1',
      label: '',
      category: '',
      svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 200">\n  <defs>\n    <linearGradient id="fadeGrad" x1="0" y1="0" x2="1" y2="0">\n      <stop id="accentColor" offset="0" stop-color="#D4AF37" stop-opacity="0.85"/>\n      <stop offset="1" stop-color="#D4AF37" stop-opacity="0"/>\n    </linearGradient>\n  </defs>\n  <rect id="baseBg" x="0" y="0" width="1920" height="200" fill=\"#111111\"/>\n  <rect id="gradientOverlay" x="0" y="0" width="1920" height="200" fill=\"url(#fadeGrad)\"/>\n  <text id="primaryText" x="90" y="110" fill=\"#ffffff\" font-family=\"system-ui, -apple-system, Segoe UI, sans-serif\" font-size=\"72\" font-weight=\"700\">Primary</text>\n  <text id="secondaryText" x="90" y="165" fill=\"#C7CBD6\" font-family=\"system-ui, -apple-system, Segoe UI, sans-serif\" font-size=\"44\" font-weight=\"500\">Secondary</text>\n</svg>\n`,
      descriptorJson: JSON.stringify({
        fields: [
          { id: 'primaryText', label: 'Name', type: 'text', maxLength: 40 },
          { id: 'secondaryText', label: 'Title', type: 'text', maxLength: 60 },
        ],
        colors: [
          { id: 'baseBg', label: 'Background Color' },
          { id: 'accentColor', label: 'Fade Color' },
        ],
        defaults: {
          primaryText: 'Jane Doe',
          secondaryText: 'Senior Correspondent',
          baseBg: '#111111',
          accentColor: '#D4AF37',
        },
      }, null, 2),
    }

    if (templateKey) {
      const [rows] = await db.query(
        `SELECT template_key, version, label, category, svg_markup, descriptor_json
           FROM lower_third_templates
          WHERE template_key = ?
          ORDER BY version DESC
          LIMIT 1`,
        [templateKey]
      )
      const row = (rows as any[])[0]
      if (row) {
        const latestVersion = Number(row.version || 0)
        const descriptor = parseJsonOrNull(row.descriptor_json) ?? {}
        prefill = {
          templateKey: String(row.template_key || templateKey),
          version: String(latestVersion + 1),
          label: String(row.label || ''),
          category: String(row.category || ''),
          svgMarkup: String(row.svg_markup || ''),
          descriptorJson: JSON.stringify(descriptor, null, 2),
        }
      }
    }

    const doc = renderLowerThirdTemplateForm({ csrfToken, values: prefill })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin lower thirds new failed', { path: req.path })
    res.status(500).send('Failed to load form')
  }
})

pagesRouter.post('/admin/lower-thirds', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const body = req.body || {}
  const templateKey = String(body.template_key || '').trim()
  const versionRaw = String(body.version || '').trim()
  const label = String(body.label || '').trim()
  const category = String(body.category || '').trim()
  const svgMarkup = String(body.svg_markup || '')
  const descriptorText = String(body.descriptor_json || '')
  try {
    const db = getPool()
    const version = Number(versionRaw)
    const descriptorJson = parseJsonOrNull(descriptorText)
    if (!descriptorJson) throw new Error('Descriptor JSON is invalid.')

    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(templateKey) || templateKey.length > 80) throw new Error('Invalid template key.')
    if (!label || label.length > 120) throw new Error('Invalid label.')
    if (!Number.isFinite(version) || version <= 0) throw new Error('Invalid version.')
    if (category && category.length > 64) throw new Error('Invalid category.')

    const validated = lowerThirdsSvc.validateLowerThirdTemplateDraft({ svgMarkup, descriptorJson })

    try {
      await db.query(
        `INSERT INTO lower_third_templates (template_key, version, label, category, svg_markup, descriptor_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [templateKey, Math.round(version), label, category || null, validated.svgMarkup, JSON.stringify(validated.descriptor)]
      )
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.toLowerCase().includes('duplicate')) throw new Error('That template key + version already exists.')
      throw e
    }

    return res.redirect('/admin/lower-thirds')
  } catch (err: any) {
    const doc = renderLowerThirdTemplateForm({
      csrfToken,
      error: String(err?.message || 'Failed to create template'),
      values: { templateKey, version: versionRaw, label, category, svgMarkup, descriptorJson: descriptorText },
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.status(400).send(doc)
  }
})

pagesRouter.post('/admin/lower-thirds/:templateKey/:version/archive', async (req: any, res: any) => {
  try {
    const db = getPool()
    const templateKey = String(req.params.templateKey || '').trim()
    const version = Number(req.params.version || '')
    if (!templateKey || !Number.isFinite(version) || version <= 0) return res.redirect('/admin/lower-thirds')
    await db.query(
      `UPDATE lower_third_templates
          SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
        WHERE template_key = ? AND version = ?`,
      [templateKey, Math.round(version)]
    )
    res.redirect('/admin/lower-thirds')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'archive lower third failed', { path: req.path })
    res.status(500).send('Failed to archive')
  }
})

pagesRouter.post('/admin/lower-thirds/:templateKey/:version/unarchive', async (req: any, res: any) => {
  try {
    const db = getPool()
    const templateKey = String(req.params.templateKey || '').trim()
    const version = Number(req.params.version || '')
    if (!templateKey || !Number.isFinite(version) || version <= 0) return res.redirect('/admin/lower-thirds')
    await db.query(
      `UPDATE lower_third_templates
          SET archived_at = NULL
        WHERE template_key = ? AND version = ?`,
      [templateKey, Math.round(version)]
    )
    res.redirect('/admin/lower-thirds')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'unarchive lower third failed', { path: req.path })
    res.status(500).send('Failed to unarchive')
  }
})

pagesRouter.get('/admin/audio', async (req: any, res: any) => {
  try {
    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, original_filename, modified_filename, description, artist, size_bytes
         FROM uploads
        WHERE kind = 'audio' AND is_system = 1
        ORDER BY id DESC
        LIMIT 500`
    )
    const items = rows as any[]
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const formatMb = (bytes: any): string => {
      const n = Number(bytes)
      if (!Number.isFinite(n) || n <= 0) return ''
      const mb = n / (1024 * 1024)
      if (mb < 10) return `${mb.toFixed(2)} MB`
      if (mb < 100) return `${mb.toFixed(1)} MB`
      return `${Math.round(mb)} MB`
    }

    const playerCss = `
<style>
  .adm-audio-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .adm-audio-card { border-radius: 16px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.03); padding: 12px; }
  .adm-audio-title { font-weight: 850; color: #fff; line-height: 1.2; }
  .adm-audio-size { margin-top: 2px; color: rgba(255,255,255,0.72); font-size: 12px; }
  .adm-audio-player { display:flex; align-items:flex-start; gap:10px; margin-top: 10px; }
  .adm-audio-btn { appearance:none; border:0; background:transparent; color:#d4af37; font-weight:900; font-size:16px; line-height:1; padding:6px 8px; cursor:pointer; }
  .adm-audio-btn:disabled { opacity:.55; cursor:default; }
  .adm-audio-track { display:grid; gap: 4px; flex: 1; min-width: 0; }
  .adm-audio-range { width:100%; -webkit-appearance:none; appearance:none; background:transparent; height:18px; cursor:pointer; }
  .adm-audio-range:disabled { opacity:.6; cursor:default; }
  .adm-audio-range::-webkit-slider-runnable-track { height:2px; background: rgba(212,175,55,0.35); border-radius:999px; }
  .adm-audio-range::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:10px; height:10px; border-radius:999px; background:#d4af37; border:0; margin-top:-4px; }
  .adm-audio-range::-moz-range-track { height:2px; background: rgba(212,175,55,0.35); border-radius:999px; }
  .adm-audio-range::-moz-range-progress { height:2px; background: rgba(10,132,255,0.95); border-radius:999px; }
  .adm-audio-range::-moz-range-thumb { width:10px; height:10px; border-radius:999px; background:#d4af37; border:0; }
  .adm-audio-time { font-size:12px; color: rgba(255,255,255,0.72); font-variant-numeric: tabular-nums; line-height: 1.1; }
  .adm-audio-actions { display:flex; justify-content:flex-end; gap: 8px; margin-top: 12px; }
  .adm-audio-actions .btn { padding: 6px 10px; font-size: 12px; font-weight: 800; }
</style>`

    const playerJs = `
<script>
  (function(){
    function pad2(n){ return String(n).padStart(2,'0'); }
    function fmt(t){
      if(!isFinite(t) || t < 0) t = 0;
      var m = Math.floor(t/60);
      var s = Math.floor(t%60);
      return m + ':' + pad2(s);
    }
    var active = null;
    function stopActive(){
      if(!active) return;
      try { active.audio.pause(); } catch {}
      try { active.btn.textContent = '▶'; } catch {}
      active = null;
    }
    document.querySelectorAll('.adm-audio-player').forEach(function(root){
      var src = root.getAttribute('data-src') || '';
      var audio = root.querySelector('audio');
      var btn = root.querySelector('.adm-audio-btn');
      var range = root.querySelector('.adm-audio-range');
      var time = root.querySelector('.adm-audio-time');
      if(!audio || !btn || !range || !time || !src) return;

      audio.preload = 'metadata';
      audio.src = src;

      function sync(){
        var dur = isFinite(audio.duration) ? audio.duration : 0;
        var cur = isFinite(audio.currentTime) ? audio.currentTime : 0;
        range.max = String(Math.max(0, Math.floor(dur * 1000)));
        range.value = String(Math.max(0, Math.floor(cur * 1000)));
        time.textContent = fmt(cur) + ' / ' + fmt(dur);
      }

      audio.addEventListener('loadedmetadata', sync);
      audio.addEventListener('timeupdate', sync);
      audio.addEventListener('ended', function(){ btn.textContent = '▶'; });
      audio.addEventListener('pause', function(){ btn.textContent = '▶'; });
      audio.addEventListener('play', function(){ btn.textContent = '❚❚'; });

      btn.addEventListener('click', function(){
        if(audio.paused){
          if(active && active.audio !== audio) stopActive();
          active = { audio: audio, btn: btn };
          audio.play().catch(function(){});
        } else {
          audio.pause();
        }
      });

      range.addEventListener('input', function(){
        var ms = Number(range.value || '0');
        var dur = isFinite(audio.duration) ? audio.duration : 0;
        if(!dur) return;
        audio.currentTime = Math.max(0, Math.min(dur, ms / 1000));
        sync();
      });

      sync();
    });

    window.addEventListener('pagehide', stopActive);
  })();
</script>`

    let body = '<h1>Audio</h1>'
	    body += '<div class="toolbar"><div><span class="pill">System Audio</span></div><div><a href="/uploads/new?kind=audio">Upload</a></div></div>'
    body += '<div class="section">'
    body += '<div class="section-title">Library</div>'
    body += '<p class="field-hint">These audio files are curated by site_admin and are selectable by any logged-in user when producing videos.</p>'
    if (!items.length) {
      body += '<p>No system audio uploaded yet.</p>'
    } else {
      body += playerCss
      body += '<div class="adm-audio-grid">'
      for (const row of items) {
        const id = Number(row.id)
        const name = escapeHtml(String(row.modified_filename || row.original_filename || `Audio ${id}`))
        const size = formatMb(row.size_bytes)
        const artist = row.artist != null ? String(row.artist).trim() : ''
        body += '<div class="adm-audio-card">'
        body += `<div class="adm-audio-title">${name}</div>`
        if (artist) body += `<div class="adm-audio-size">${escapeHtml(artist)}</div>`
        if (size) body += `<div class="adm-audio-size">${escapeHtml(size)}</div>`
        body += `<div class="adm-audio-player" data-src="/api/uploads/${id}/file">
          <button type="button" class="adm-audio-btn" aria-label="Play">▶</button>
          <div class="adm-audio-track">
            <input class="adm-audio-range" type="range" min="0" max="0" value="0" />
            <div class="adm-audio-time">0:00 / 0:00</div>
          </div>
          <audio></audio>
        </div>`
        body += `<div class="adm-audio-actions">
          <a class="btn" href="/admin/audio/${id}" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18)">Edit</a>
          <form method="post" action="/admin/audio/${id}/delete" onsubmit="return confirm('Delete this system audio? Existing productions keep working, but users will not be able to select this audio for new productions.')">
            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
            <button type="submit" class="btn" style="background:#300; border:1px solid rgba(255,120,120,0.5)">Delete</button>
          </form>
        </div>`
        body += '</div>'
      }
      body += '</div>'
      body += playerJs
    }
    body += '</div>'

    const doc = renderAdminPage({ title: 'Audio', bodyHtml: body, active: 'audio' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio list failed', { path: req.path })
    res.status(500).send('Failed to load audio')
  }
})

			function renderAdminAudioEditPage(opts: { audio: any; csrfToken?: string; error?: string | null; notice?: string | null; sources?: any[]; genres?: any[]; moods?: any[]; themes?: any[]; instruments?: any[]; selectedTagIds?: number[] }): string {
  const audio = opts.audio || {}
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const error = opts.error ? String(opts.error) : ''
  const notice = opts.notice ? String(opts.notice) : ''
  const id = Number(audio.id)
  const nameValue = String(audio.modified_filename || audio.original_filename || '').trim()
  const descValue = audio.description != null ? String(audio.description) : ''
  const artistValue = audio.artist != null ? String(audio.artist) : ''
  const licenseSourceId = audio.license_source_id != null ? Number(audio.license_source_id) : null
  const selected = new Set((opts.selectedTagIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))
  const sources = Array.isArray(opts.sources) ? opts.sources : []
  const genres = Array.isArray(opts.genres) ? opts.genres : []
  const moods = Array.isArray(opts.moods) ? opts.moods : []
  const themes = Array.isArray(opts.themes) ? opts.themes : []
  const instruments = Array.isArray(opts.instruments) ? opts.instruments : []

  let body = `<h1>Edit Audio</h1>`
  body += '<div class="toolbar"><div><a href="/admin/audio">\u2190 Back to audio</a></div><div></div></div>'
  if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`
  body += `<form method="post" action="/admin/audio/${id}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(nameValue)}" />
    <div class="field-hint">Displayed to users when choosing audio for productions.</div>
  </label>`
  body += `<label>Artist
    <input type="text" name="artist" value="${escapeHtml(artistValue)}" />
    <div class="field-hint">Optional. Used for filtering in the audio picker.</div>
  </label>`
  body += `<label>License Source
    <select name="licenseSourceId" required>
      <option value="">Select a source…</option>
      ${sources
        .filter((s: any) => !(s as any).archived_at)
        .map((s: any) => {
          const sid = Number((s as any).id)
          const selectedAttr = licenseSourceId != null && sid === licenseSourceId ? 'selected' : ''
          return `<option value="${escapeHtml(String(sid))}" ${selectedAttr}>${escapeHtml(String((s as any).name || ''))}</option>`
        })
        .join('')}
    </select>
    <div class="field-hint">Required. Create new sources in <a href="/admin/license-sources">License Sources</a>.</div>
  </label>`
  body += `<label>Description
    <textarea name="description" style="min-height: 120px">${escapeHtml(descValue)}</textarea>
    <div class="field-hint">Optional.</div>
  </label>`

  const renderTagCheckboxes = (items: any[], fieldName: string) => {
    if (!items.length) return '<div class="field-hint">No tags yet. Create some in <a href="/admin/audio-tags">Audio Tags</a>.</div>'
    let html = '<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 6px;">'
    for (const t of items) {
      const tid = Number(t.id)
      const checked = selected.has(tid)
      html += `<label style="display:flex; align-items:center; gap:8px; border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:8px 10px; background: rgba(0,0,0,0.25);">
        <input type="checkbox" name="${escapeHtml(fieldName)}" value="${escapeHtml(String(tid))}" ${checked ? 'checked' : ''} />
        <span>${escapeHtml(String(t.name || ''))}</span>
      </label>`
    }
    html += '</div>'
    return html
  }

  body += `<div class="section">
    <div class="section-title">Genres</div>
    ${renderTagCheckboxes(genres, 'genreTagIds')}
  </div>`
  body += `<div class="section">
    <div class="section-title">Moods</div>
    ${renderTagCheckboxes(moods, 'moodTagIds')}
  </div>`
  body += `<div class="section">
    <div class="section-title">Video Themes</div>
    ${renderTagCheckboxes(themes, 'themeTagIds')}
  </div>`
  body += `<div class="section">
    <div class="section-title">Instruments</div>
    ${renderTagCheckboxes(instruments, 'instrumentTagIds')}
  </div>`

  body += `<div class="actions">
    <button type="submit">Save</button>
  </div>`
  body += `</form>`

		  return renderAdminPage({ title: 'Edit Audio', bodyHtml: body, active: 'audio' })
		}

		// IMPORTANT: define /admin/audio/new before /admin/audio/:id so "new" doesn't match the :id param route.
		pagesRouter.get('/admin/audio/new', (_req: any, res: any) => {
		  res.redirect('/uploads/new?kind=audio')
		})

pagesRouter.get('/admin/audio/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    const db = getPool()
	    const [rows] = await db.query(
	      `SELECT id, original_filename, modified_filename, description, artist, license_source_id
	         FROM uploads
	        WHERE id = ? AND kind = 'audio' AND is_system = 1
	        LIMIT 1`,
	      [id]
	    )
	    const audio = (rows as any[])[0]
	    if (!audio) return res.status(404).send('Not found')
	    const [sources, genres, moods, themes, instruments, selectedTagIds] = await Promise.all([
	      licenseSourcesRepo.listSources('audio', { includeArchived: false }),
	      audioTagsRepo.listTags('genre', { includeArchived: false }),
	      audioTagsRepo.listTags('mood', { includeArchived: false }),
	      audioTagsRepo.listTags('theme', { includeArchived: false }),
	      audioTagsRepo.listTags('instrument', { includeArchived: false }),
	      audioTagsRepo.listTagIdsForUpload(id),
	    ])
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
	    const doc = renderAdminAudioEditPage({ audio, csrfToken, sources, genres, moods, themes, instruments, selectedTagIds })
	    res.set('Content-Type', 'text/html; charset=utf-8')
	    res.send(doc)
	  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio edit page failed', { path: req.path })
    res.status(500).send('Failed to load audio')
  }
})

pagesRouter.post('/admin/audio/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')

    const rawName = String(req.body?.name || '').trim()
    const rawDesc = String(req.body?.description || '')
    const rawArtist = String(req.body?.artist || '')
    const desc = rawDesc.trim().length ? rawDesc.trim() : null
    const artist = rawArtist.trim().length ? rawArtist.trim() : null

    const db = getPool()
	    const [rows] = await db.query(
	      `SELECT id, original_filename, modified_filename, description, artist, license_source_id
	         FROM uploads
	        WHERE id = ? AND kind = 'audio' AND is_system = 1
	        LIMIT 1`,
	      [id]
	    )
	    const audio = (rows as any[])[0]
	    if (!audio) return res.status(404).send('Not found')

	    const cookies = parseCookies(req.headers.cookie)
	    const csrfToken = cookies['csrf'] || ''
	    const [sources, genres, moods, themes, instruments] = await Promise.all([
	      licenseSourcesRepo.listSources('audio', { includeArchived: false }),
	      audioTagsRepo.listTags('genre', { includeArchived: false }),
	      audioTagsRepo.listTags('mood', { includeArchived: false }),
	      audioTagsRepo.listTags('theme', { includeArchived: false }),
	      audioTagsRepo.listTags('instrument', { includeArchived: false }),
	    ])

	    if (!rawName) {
	      const selectedTagIds = await audioTagsRepo.listTagIdsForUpload(id)
	      const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: rawDesc, artist: rawArtist }, csrfToken, sources, genres, moods, themes, instruments, selectedTagIds, error: 'Name is required.' })
	      res.set('Content-Type', 'text/html; charset=utf-8')
	      return res.status(400).send(doc)
	    }
	    if (rawName.length > 512) {
	      const selectedTagIds = await audioTagsRepo.listTagIdsForUpload(id)
	      const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: rawDesc, artist: rawArtist }, csrfToken, sources, genres, moods, themes, instruments, selectedTagIds, error: 'Name is too long (max 512 characters).' })
	      res.set('Content-Type', 'text/html; charset=utf-8')
	      return res.status(400).send(doc)
	    }
	    const rawLicenseSourceId = req.body?.licenseSourceId
	    const licenseSourceId = rawLicenseSourceId != null && String(rawLicenseSourceId).trim() !== '' ? Number(rawLicenseSourceId) : null
	    if (!licenseSourceId || !Number.isFinite(licenseSourceId) || licenseSourceId <= 0) {
	      const selectedTagIds = await audioTagsRepo.listTagIdsForUpload(id)
	      const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: rawDesc, artist: rawArtist, license_source_id: licenseSourceId }, csrfToken, sources, genres, moods, themes, instruments, selectedTagIds, error: 'License Source is required.' })
	      res.set('Content-Type', 'text/html; charset=utf-8')
	      return res.status(400).send(doc)
	    }
	    if (!sources.some((s: any) => Number((s as any).id) === licenseSourceId && !(s as any).archived_at)) {
	      const selectedTagIds = await audioTagsRepo.listTagIdsForUpload(id)
	      const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: rawDesc, artist: rawArtist, license_source_id: licenseSourceId }, csrfToken, sources, genres, moods, themes, instruments, selectedTagIds, error: 'Invalid License Source.' })
	      res.set('Content-Type', 'text/html; charset=utf-8')
	      return res.status(400).send(doc)
	    }

	    await db.query(
	      `UPDATE uploads
	          SET modified_filename = ?,
	              description = ?,
	              artist = ?,
	              license_source_id = ?
	        WHERE id = ? AND kind = 'audio' AND is_system = 1`,
	      [rawName, desc, artist, licenseSourceId, id]
	    )

	    const parseIdList = (v: any): number[] => {
	      if (v == null) return []
	      const arr = Array.isArray(v) ? v : [v]
	      return arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
	    }
	    const tagIds = [
	      ...parseIdList(req.body?.genreTagIds),
	      ...parseIdList(req.body?.moodTagIds),
	      ...parseIdList(req.body?.themeTagIds),
	      ...parseIdList(req.body?.instrumentTagIds),
	    ]
	    await audioTagsRepo.replaceUploadTags(id, tagIds)
	    const selectedTagIds = await audioTagsRepo.listTagIdsForUpload(id)

	    const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: desc, artist, license_source_id: licenseSourceId }, csrfToken, sources, genres, moods, themes, instruments, selectedTagIds, notice: 'Saved.' })
	    res.set('Content-Type', 'text/html; charset=utf-8')
	    res.send(doc)
	  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio update failed', { path: req.path })
		    res.status(500).send('Failed to save audio')
		  }
		})

// --- Admin audio tags (Plan 51) ---
pagesRouter.get('/admin/audio-tags', async (req: any, res: any) => {
  try {
    const rawKind = String(req.query?.kind || 'genre').toLowerCase()
    const kind = rawKind === 'mood' || rawKind === 'theme' || rawKind === 'instrument' ? rawKind : 'genre'
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-tags')}`)
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const items = await audioTagsSvc.listAdminTags(kind, { includeArchived }, { userId: currentUserId } as any)

    const kindLabel = kind === 'mood' ? 'Moods' : kind === 'theme' ? 'Video Themes' : kind === 'instrument' ? 'Instruments' : 'Genres'
    let body = `<h1>Audio Tags</h1>`
    body += `<div class="toolbar"><div><span class="pill">${escapeHtml(kindLabel)}</span></div><div></div></div>`
    body += `<div class="section"><div class="section-title">Kinds</div>
      <div class="toolbar" style="margin:0">
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <a href="/admin/audio-tags?kind=genre" class="btn" style="background:${kind === 'genre' ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.06)'}; border:1px solid rgba(255,255,255,0.18)">Genres</a>
          <a href="/admin/audio-tags?kind=mood" class="btn" style="background:${kind === 'mood' ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.06)'}; border:1px solid rgba(255,255,255,0.18)">Moods</a>
          <a href="/admin/audio-tags?kind=theme" class="btn" style="background:${kind === 'theme' ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.06)'}; border:1px solid rgba(255,255,255,0.18)">Video Themes</a>
          <a href="/admin/audio-tags?kind=instrument" class="btn" style="background:${kind === 'instrument' ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.06)'}; border:1px solid rgba(255,255,255,0.18)">Instruments</a>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <a href="/admin/audio-tags?kind=${escapeHtml(kind)}&include_archived=${includeArchived ? '0' : '1'}" class="btn" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18)">${includeArchived ? 'Hide archived' : 'Show archived'}</a>
        </div>
      </div>
    </div>`

    body += `<div class="section"><div class="section-title">Create</div>
      <form method="post" action="/admin/audio-tags">
        ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
        <input type="hidden" name="kind" value="${escapeHtml(kind)}" />
        <label>Name
          <input type="text" name="name" value="" placeholder="${kind === 'mood' ? 'e.g. Uplifting' : kind === 'theme' ? 'e.g. Intro' : kind === 'instrument' ? 'e.g. Piano' : 'e.g. Ambient'}" />
        </label>
        <div class="actions"><button type="submit">Create</button></div>
      </form>
    </div>`

    body += `<div class="section"><div class="section-title">List</div>`
    if (!items.length) {
      body += `<p>No tags yet.</p>`
	    } else {
	      body += `<div style="display:grid; gap:10px">`
		      for (const t of items as any[]) {
		        const id = Number((t as any).id)
		        const name = String((t as any).name || '')
		        const archivedAt = (t as any).archived_at
		        body += `<div style="border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:12px; background: rgba(255,255,255,0.03); display:grid; gap:8px">`
			        body += `<form id="audio-tag-rename-${id}" method="post" action="/admin/audio-tags/${id}" style="margin:0; display:flex; gap:10px; align-items:baseline">
			          ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
			          <input type="text" name="name" value="${escapeHtml(name)}" style="flex:1; min-width: 240px" />
			        </form>`
			        body += `<div style="display:flex; justify-content:flex-end; gap:10px; align-items:center; flex-wrap:wrap">`
			        if (archivedAt) {
			          body += `<form method="post" action="/admin/audio-tags/${id}/unarchive" onsubmit="return confirm('Unarchive this tag?')" style="margin:0">
			            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
			            <button type="submit" class="btn" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18)">Unarchive</button>
			          </form>`
			        } else {
			          body += `<form method="post" action="/admin/audio-tags/${id}/archive" onsubmit="return confirm('Archive this tag? It will stop appearing in pickers.')" style="margin:0">
			            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
			            <button type="submit" class="btn" style="background:#300; border:1px solid rgba(255,120,120,0.5)">Archive</button>
			          </form>`
			        }
			        body += `<button type="submit" form="audio-tag-rename-${id}" class="btn" style="background:#0a84ff; border:1px solid rgba(255,255,255,0.18); color:#fff">Save</button>`
			        body += `</div>`
		        body += `</div>`
		      }
	      body += `</div>`
	    }
    body += `</div>`

    const doc = renderAdminPage({ title: 'Audio Tags', bodyHtml: body, active: 'audio_tags' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio-tags page failed', { path: req.path })
    res.status(500).send('Failed to load audio tags')
  }
})

// --- Admin license sources (Plan 52) ---
pagesRouter.get('/admin/license-sources', async (req: any, res: any) => {
  try {
    const includeArchived = String(req.query?.include_archived || '0') === '1'
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/license-sources')}`)
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const items = await licenseSourcesSvc.listAdminSources('audio', { includeArchived }, { userId: currentUserId } as any)

    let body = `<h1>License Sources</h1>`
    body += `<div class="toolbar"><div><span class="pill">Audio</span></div><div></div></div>`
    body += `<div class="section"><div class="section-title">Create</div>
      <form method="post" action="/admin/license-sources">
        ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
        <label>Name
          <input type="text" name="name" value="" placeholder="e.g. Artlist" />
        </label>
        <div class="actions"><button type="submit">Create</button></div>
      </form>
      <div class="field-hint">These are required when uploading system audio, to track licensing/vendor source.</div>
    </div>`

    body += `<div class="section"><div class="section-title">List</div>
      <div class="toolbar" style="margin:0">
        <div></div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <a href="/admin/license-sources?include_archived=${includeArchived ? '0' : '1'}" class="btn" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18)">${includeArchived ? 'Hide archived' : 'Show archived'}</a>
        </div>
      </div>
    `
    if (!items.length) {
      body += `<p>No license sources yet.</p>`
    } else {
      body += `<div style="display:grid; gap:10px">`
      for (const t of items as any[]) {
        const id = Number((t as any).id)
        const name = String((t as any).name || '')
        const slug = String((t as any).slug || '')
        const archivedAt = (t as any).archived_at
        body += `<div style="border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:12px; background: rgba(255,255,255,0.03); display:grid; gap:8px">`
        body += `<div style="display:flex; justify-content:space-between; gap:10px; align-items:baseline">
          <div style="font-weight:800">${escapeHtml(name)}</div>
          <div style="font-size:12px; color:#888">${archivedAt ? 'Archived' : escapeHtml(slug)}</div>
        </div>`
        body += `<form method="post" action="/admin/license-sources/${id}">
          ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
          <label>Rename
            <input type="text" name="name" value="${escapeHtml(name)}" />
          </label>
          <div class="actions"><button type="submit">Save</button></div>
        </form>`
        if (archivedAt) {
          body += `<form method="post" action="/admin/license-sources/${id}/unarchive" onsubmit="return confirm('Unarchive this source?')">
            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
            <button type="submit" class="btn" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18)">Unarchive</button>
          </form>`
        } else {
          body += `<form method="post" action="/admin/license-sources/${id}/archive" onsubmit="return confirm('Archive this source? It will stop appearing in pickers.')">
            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
            <button type="submit" class="btn" style="background:#300; border:1px solid rgba(255,120,120,0.5)">Archive</button>
          </form>`
        }
        body += `</div>`
      }
      body += `</div>`
    }
    body += `</div>`

    const doc = renderAdminPage({ title: 'License Sources', bodyHtml: body, active: 'license_sources' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin license sources page failed', { path: req.path })
    res.status(500).send('Failed to load license sources')
  }
})

pagesRouter.post('/admin/license-sources', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/license-sources')}`)
    const name = String(req.body?.name || '')
    await licenseSourcesSvc.createAdminSource({ kind: 'audio', name }, { userId: currentUserId } as any)
    res.redirect(`/admin/license-sources`)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin license sources create failed', { path: req.path })
    res.status(500).send('Failed to create license source')
  }
})

pagesRouter.post('/admin/license-sources/:id', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/license-sources')}`)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    const name = req.body?.name
    await licenseSourcesSvc.renameAdminSource(id, name, { userId: currentUserId } as any)
    res.redirect('/admin/license-sources')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin license sources rename failed', { path: req.path })
    res.status(500).send('Failed to rename license source')
  }
})

pagesRouter.post('/admin/license-sources/:id/archive', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/license-sources')}`)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    await licenseSourcesSvc.archiveAdminSource(id, true, { userId: currentUserId } as any)
    res.redirect('/admin/license-sources')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin license sources archive failed', { path: req.path })
    res.status(500).send('Failed to archive license source')
  }
})

pagesRouter.post('/admin/license-sources/:id/unarchive', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/license-sources')}`)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    await licenseSourcesSvc.archiveAdminSource(id, false, { userId: currentUserId } as any)
    res.redirect('/admin/license-sources')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin license sources unarchive failed', { path: req.path })
    res.status(500).send('Failed to unarchive license source')
  }
})

pagesRouter.post('/admin/audio-tags', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-tags')}`)
    const rawKind = String(req.body?.kind || 'genre').toLowerCase()
    const kind = rawKind === 'mood' || rawKind === 'theme' || rawKind === 'instrument' ? rawKind : 'genre'
    const name = String(req.body?.name || '')
    await audioTagsSvc.createAdminTag({ kind, name }, { userId: currentUserId } as any)
    res.redirect(`/admin/audio-tags?kind=${encodeURIComponent(kind)}`)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio-tags create failed', { path: req.path })
    res.status(500).send('Failed to create tag')
  }
})

pagesRouter.post('/admin/audio-tags/:id', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-tags')}`)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    const name = req.body?.name
    await audioTagsSvc.renameAdminTag(id, name, { userId: currentUserId } as any)
    res.redirect('/admin/audio-tags')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio-tags rename failed', { path: req.path })
    res.status(500).send('Failed to rename tag')
  }
})

pagesRouter.post('/admin/audio-tags/:id/archive', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-tags')}`)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    await audioTagsSvc.archiveAdminTag(id, true, { userId: currentUserId } as any)
    res.redirect('/admin/audio-tags')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio-tags archive failed', { path: req.path })
    res.status(500).send('Failed to archive tag')
  }
})

pagesRouter.post('/admin/audio-tags/:id/unarchive', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-tags')}`)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    await audioTagsSvc.archiveAdminTag(id, false, { userId: currentUserId } as any)
    res.redirect('/admin/audio-tags')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio-tags unarchive failed', { path: req.path })
    res.status(500).send('Failed to unarchive tag')
  }
})

	pagesRouter.post('/admin/audio/:id/delete', async (req: any, res: any) => {
	  try {
	    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad id')
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio')}`)
    await uploadsSvc.remove(id, currentUserId)
    res.redirect('/admin/audio')
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin audio delete failed', { path: req.path })
    res.status(500).send('Failed to delete audio')
  }
})

function renderAdminAudioConfigForm(opts: {
  title: string
  action: string
  backHref: string
  csrfToken?: string
  error?: string | null
  notice?: string | null
  config?: any
}): string {
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const error = opts.error ? String(opts.error) : ''
  const notice = opts.notice ? String(opts.notice) : ''
  const cfg = opts.config || {}
  const nameValue = String(cfg.name || '').trim()
  const descValue = String(cfg.description || '').trim()
  const modeValue = String(cfg.mode || 'mix')
  const musicGainDb = cfg.musicGainDb != null ? Number(cfg.musicGainDb) : (cfg.music_gain_db != null ? Number(cfg.music_gain_db) : -18)
  const duckingModeValue = String(cfg.duckingMode ?? cfg.ducking_mode ?? (Number(cfg.ducking_enabled || 0) ? 'rolling' : 'none'))
  const duckingGateValue = String(cfg.duckingGate ?? cfg.ducking_gate ?? 'normal')
  const audioDurationSeconds =
    cfg.audioDurationSeconds != null ? Number(cfg.audioDurationSeconds)
      : (cfg.intro_sfx_seconds != null ? Number(cfg.intro_sfx_seconds) : null)
  const audioFadeEnabled =
    cfg.audioFadeEnabled != null ? Boolean(cfg.audioFadeEnabled)
      : Boolean(cfg.intro_sfx_fade_enabled ?? true)
  const openerCutFadeBeforeSeconds =
    cfg.openerCutFadeBeforeSeconds != null ? Number(cfg.openerCutFadeBeforeSeconds)
      : (cfg.opener_cut_fade_before_ms != null ? Number(cfg.opener_cut_fade_before_ms) / 1000 : null)
  const openerCutFadeAfterSeconds =
    cfg.openerCutFadeAfterSeconds != null ? Number(cfg.openerCutFadeAfterSeconds)
      : (cfg.opener_cut_fade_after_ms != null ? Number(cfg.opener_cut_fade_after_ms) / 1000 : null)

  let body = `<h1>${escapeHtml(opts.title)}</h1>`
  body += `<div class="toolbar"><div><a href="${escapeHtml(opts.backHref)}">\u2190 Back to audio configs</a></div><div></div></div>`
  if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`
  body += `<form method="post" action="${escapeHtml(opts.action)}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(nameValue)}" />
    <div class="field-hint">Creators pick this preset when producing.</div>
  </label>`
  body += `<label style="margin-top:10px">Description
    <textarea name="description" rows="4" maxlength="2000" placeholder="Describe this preset for creators...">${escapeHtml(descValue)}</textarea>
    <div class="field-hint">Shown to creators via the About button.</div>
  </label>`
  body += `<label>Mode
    <select name="mode">
      <option value="mix"${modeValue === 'mix' ? ' selected' : ''}>Mix (recommended)</option>
      <option value="replace"${modeValue === 'replace' ? ' selected' : ''}>Replace</option>
    </select>
    <div class="field-hint">Mix overlays music under the original audio. Replace swaps the original audio out.</div>
  </label>`
	  body += `<label>Music Level
	    <select name="musicGainDb">
	      <option value="-24"${musicGainDb === -24 ? ' selected' : ''}>Quiet (-24 dB)</option>
	      <option value="-22"${musicGainDb === -22 ? ' selected' : ''}>Quiet+ (-22 dB)</option>
	      <option value="-20"${musicGainDb === -20 ? ' selected' : ''}>Quiet++ (-20 dB)</option>
	      <option value="-18"${musicGainDb === -18 ? ' selected' : ''}>Medium (-18 dB)</option>
	      <option value="-16"${musicGainDb === -16 ? ' selected' : ''}>Medium+ (-16 dB)</option>
	      <option value="-14"${musicGainDb === -14 ? ' selected' : ''}>Medium++ (-14 dB)</option>
	      <option value="-12"${musicGainDb === -12 ? ' selected' : ''}>Loud (-12 dB)</option>
	    </select>
	  </label>`
  body += `<input type="hidden" name="videoGainDb" value="0" />`
  body += `<div class="section" style="margin-top: 14px">
    <div class="section-title">Audio Timing</div>`
	  body += `<label>Audio Duration
	    <select name="audioDurationSeconds">
	      <option value=""${audioDurationSeconds == null ? ' selected' : ''}>Full (loop)</option>
	      <option value="2"${audioDurationSeconds === 2 ? ' selected' : ''}>First 2 seconds</option>
	      <option value="3"${audioDurationSeconds === 3 ? ' selected' : ''}>First 3 seconds</option>
	      <option value="4"${audioDurationSeconds === 4 ? ' selected' : ''}>First 4 seconds</option>
	      <option value="5"${audioDurationSeconds === 5 ? ' selected' : ''}>First 5 seconds</option>
	      <option value="10"${audioDurationSeconds === 10 ? ' selected' : ''}>First 10 seconds</option>
	      <option value="15"${audioDurationSeconds === 15 ? ' selected' : ''}>First 15 seconds</option>
	      <option value="20"${audioDurationSeconds === 20 ? ' selected' : ''}>First 20 seconds</option>
	    </select>
	    <div class="field-hint">Use this for intro stings (e.g. newsroom SFX). Full (loop) keeps playing under the video.</div>
	  </label>`
  body += `<label style="margin-top:10px">
    <input type="checkbox" name="audioFadeEnabled" value="1"${audioFadeEnabled ? ' checked' : ''} />
    Fade in/out (0.35s) when duration is set
  </label>`
  body += `</div>`
	  body += `<label style="margin-top:10px">
	    Ducking
	    <select name="duckingMode">
	      <option value="none"${duckingModeValue === 'none' ? ' selected' : ''}>None</option>
	      <option value="rolling"${duckingModeValue === 'rolling' ? ' selected' : ''}>Rolling Ducking</option>
	      <option value="abrupt"${duckingModeValue === 'abrupt' ? ' selected' : ''}>Opener Cutoff</option>
	    </select>
	    <div class="field-hint">Applies only in Mix mode. Rolling reduces music under video audio. Opener Cutoff plays music until speech/ambient starts, then cuts it.</div>
	  </label>`
	  body += `<label style="margin-top:10px">
	    Ducking Sensitivity
	    <select name="duckingGate">
	      <option value="sensitive"${duckingGateValue === 'sensitive' ? ' selected' : ''}>Sensitive</option>
	      <option value="normal"${duckingGateValue === 'normal' ? ' selected' : ''}>Normal</option>
	      <option value="strict"${duckingGateValue === 'strict' ? ' selected' : ''}>Strict</option>
	    </select>
	    <div class="field-hint">Sensitive triggers sooner; Strict triggers later.</div>
	  </label>`
	  body += `<div class="section" style="margin-top: 14px">
	    <div class="section-title">Opener Cutoff Fade</div>
	    <div class="field-hint">Only used when Ducking is set to Opener Cutoff.</div>
	  `
	  const fadeOpt = (label: string, value: number | null, selected: number | null) =>
	    `<option value="${value == null ? '' : value}"${(value == null ? selected == null : selected === value) ? ' selected' : ''}>${label}</option>`
	  body += `<label>Fade Out Before t
	    <select name="openerCutFadeBeforeSeconds">
	      ${fadeOpt('None', null, openerCutFadeBeforeSeconds)}
	      ${fadeOpt('0.5 seconds', 0.5, openerCutFadeBeforeSeconds)}
	      ${fadeOpt('1.0 seconds', 1.0, openerCutFadeBeforeSeconds)}
	      ${fadeOpt('1.5 seconds', 1.5, openerCutFadeBeforeSeconds)}
	      ${fadeOpt('2.0 seconds', 2.0, openerCutFadeBeforeSeconds)}
	      ${fadeOpt('2.5 seconds', 2.5, openerCutFadeBeforeSeconds)}
	      ${fadeOpt('3.0 seconds', 3.0, openerCutFadeBeforeSeconds)}
	    </select>
	  </label>`
	  body += `<label style="margin-top:10px">Fade Out After t
	    <select name="openerCutFadeAfterSeconds">
	      ${fadeOpt('None', null, openerCutFadeAfterSeconds)}
	      ${fadeOpt('0.5 seconds', 0.5, openerCutFadeAfterSeconds)}
	      ${fadeOpt('1.0 seconds', 1.0, openerCutFadeAfterSeconds)}
	      ${fadeOpt('1.5 seconds', 1.5, openerCutFadeAfterSeconds)}
	      ${fadeOpt('2.0 seconds', 2.0, openerCutFadeAfterSeconds)}
	      ${fadeOpt('2.5 seconds', 2.5, openerCutFadeAfterSeconds)}
	      ${fadeOpt('3.0 seconds', 3.0, openerCutFadeAfterSeconds)}
	    </select>
	    <div class="field-hint">t = first moment the video audio crosses the sensitivity threshold.</div>
	  </label>`
	  body += `</div>`
	  body += `<div class="actions">
	    <button type="submit">Save</button>
	  </div>`
	  body += `</form>`
  return renderAdminPage({ title: opts.title, bodyHtml: body, active: 'audio_configs' })
}

pagesRouter.get('/admin/audio-configs', async (req: any, res: any) => {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const includeArchived = req.query?.include_archived === '1' || req.query?.include_archived === 'true'
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-configs')}`)

    let notice: string | null = null
    try {
      const seeded = await audioConfigsSvc.ensureDefaultsIfNoneActive(currentUserId)
      if (seeded.created) notice = 'Default presets created.'
    } catch {}

    const items = await audioConfigsSvc.listForOwner(currentUserId, { includeArchived: Boolean(includeArchived), limit: 500 })

    let body = '<h1>Audio Configs</h1>'
    body += `
<style>
  .adm-ac-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .adm-ac-card { border-radius: 16px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.03); padding: 12px; }
  .adm-ac-title { font-weight: 850; color: #fff; line-height: 1.2; }
  .adm-ac-line { margin-top: 4px; color: rgba(255,255,255,0.72); font-size: 12px; }
  .adm-ac-actions { display:flex; justify-content:flex-end; gap: 8px; margin-top: 12px; }
  .adm-ac-actions .btn { padding: 6px 10px; font-size: 12px; font-weight: 800; }
</style>`
    body += '<div class="toolbar">'
    body += '<div><span class="pill">Audio Configs</span></div>'
    body += '<div style="display:flex; gap:12px; align-items:center">'
    body += `<a href="/admin/audio-configs/new">New</a>`
    body += `<a href="/admin/audio-configs?include_archived=${includeArchived ? '0' : '1'}">${includeArchived ? 'Hide archived' : 'Show archived'}</a>`
    body += '</div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`

    if (!items.length) {
      body += '<p>No audio configs yet.</p>'
    } else {
      body += '<div class="adm-ac-grid">'
      for (const it of items as any[]) {
        const id = Number(it.id)
        const name = escapeHtml(String(it.name || ''))
        const mode = escapeHtml(String(it.mode || 'mix'))
        const musicDb = it.musicGainDb != null ? Number(it.musicGainDb) : Number(it.music_gain_db ?? -18)
        const duck = Boolean(it.duckingEnabled ?? it.ducking_enabled)
        const archivedAt = it.archivedAt != null ? String(it.archivedAt) : (it.archived_at != null ? String(it.archived_at) : '')
        body += `<div class="adm-ac-card">`
        body += `<div class="adm-ac-title">${name || '(unnamed)'}</div>`
        body += `<div class="adm-ac-line">Mode: <strong>${mode}</strong> &nbsp;•&nbsp; Music: <strong>${escapeHtml(String(musicDb))} dB</strong></div>`
        body += `<div class="adm-ac-line">Ducking: <strong>${duck ? 'on' : 'off'}</strong>${archivedAt ? ` &nbsp;•&nbsp; Archived: <strong>${escapeHtml(archivedAt)}</strong>` : ''}</div>`
        body += `<div class="adm-ac-actions">`
        body += `<a class="btn" href="/admin/audio-configs/${id}">Edit</a>`
        if (!archivedAt) {
          body += `<form method="post" action="/admin/audio-configs/${id}/archive" style="display:inline" onsubmit="return confirm('Archive audio config \\'${name || 'this preset'}\\'?');">`
          if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
          body += `<button type="submit" class="btn danger">Archive</button>`
          body += `</form>`
        }
        body += `</div>`
        body += `</div>`
      }
      body += '</div>'
    }

    const doc = renderAdminPage({ title: 'Audio Configs', bodyHtml: body, active: 'audio_configs' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin audio-configs list failed', { path: req.path })
    res.status(500).send('Failed to load audio configs')
  }
})

pagesRouter.get('/admin/audio-configs/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const doc = renderAdminAudioConfigForm({
    title: 'New Audio Config',
    action: '/admin/audio-configs',
    backHref: '/admin/audio-configs',
    csrfToken,
		    config: {
		      name: '',
		      mode: 'mix',
		      musicGainDb: -18,
		      duckingMode: 'none',
		      duckingGate: 'normal',
		      audioDurationSeconds: null,
		      audioFadeEnabled: true,
		      openerCutFadeBeforeSeconds: null,
		      openerCutFadeAfterSeconds: null,
		    },
		  })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
})

pagesRouter.post('/admin/audio-configs', async (req: any, res: any) => {
  try {
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-configs')}`)
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

		    const body = req.body || {}
			    const input = {
			      name: body.name,
			      description: body.description,
			      mode: body.mode,
			      videoGainDb: body.videoGainDb,
			      musicGainDb: body.musicGainDb,
		      duckingMode: body.duckingMode,
		      duckingGate: body.duckingGate,
		      audioDurationSeconds: body.audioDurationSeconds,
		      audioFadeEnabled: Boolean(body.audioFadeEnabled),
		      openerCutFadeBeforeSeconds: body.openerCutFadeBeforeSeconds,
		      openerCutFadeAfterSeconds: body.openerCutFadeAfterSeconds,
		    }
    const created = await audioConfigsSvc.createForOwner(input as any, currentUserId)
    res.redirect(`/admin/audio-configs/${created.id}`)
  } catch (err: any) {
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const msg = String(err?.code || err?.message || err)
    const doc = renderAdminAudioConfigForm({
      title: 'New Audio Config',
      action: '/admin/audio-configs',
      backHref: '/admin/audio-configs',
      csrfToken,
      error: msg,
				      config: {
				        name: req.body?.name,
				        description: req.body?.description,
				        mode: req.body?.mode,
				        musicGainDb: req.body?.musicGainDb,
				        duckingMode: req.body?.duckingMode,
			        duckingGate: req.body?.duckingGate,
			        audioDurationSeconds: req.body?.audioDurationSeconds,
			        audioFadeEnabled: Boolean(req.body?.audioFadeEnabled),
			        openerCutFadeBeforeSeconds: req.body?.openerCutFadeBeforeSeconds,
			        openerCutFadeAfterSeconds: req.body?.openerCutFadeAfterSeconds,
			      },
			    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.status(400).send(doc)
  }
})

pagesRouter.get('/admin/audio-configs/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-configs')}`)

    const config = await audioConfigsSvc.getForOwner(id, currentUserId)
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminAudioConfigForm({
      title: 'Edit Audio Config',
      action: `/admin/audio-configs/${id}`,
      backHref: '/admin/audio-configs',
      csrfToken,
      config,
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin audio-config edit page failed', { path: req.path })
    res.status(500).send('Failed to load audio config')
  }
})

pagesRouter.post('/admin/audio-configs/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-configs')}`)

			    const body = req.body || {}
					    const config = await audioConfigsSvc.updateForOwner(id, {
					      name: body.name,
					      description: body.description,
					      mode: body.mode,
					      videoGainDb: body.videoGainDb,
					      musicGainDb: body.musicGainDb,
				      duckingMode: body.duckingMode,
				      duckingGate: body.duckingGate,
				      audioDurationSeconds: body.audioDurationSeconds,
				      audioFadeEnabled: Boolean(body.audioFadeEnabled),
				      openerCutFadeBeforeSeconds: body.openerCutFadeBeforeSeconds,
				      openerCutFadeAfterSeconds: body.openerCutFadeAfterSeconds,
				    }, currentUserId)

	    const cookies = parseCookies(req.headers.cookie)
	    const csrfToken = cookies['csrf'] || ''
	    const doc = renderAdminAudioConfigForm({
	      title: 'Edit Audio Config',
	      action: `/admin/audio-configs/${id}`,
	      backHref: '/admin/audio-configs',
	      csrfToken,
	      notice: 'Saved.',
	      config,
	    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err: any) {
	    const id = Number(req.params.id)
	    const cookies = parseCookies(req.headers.cookie)
	    const csrfToken = cookies['csrf'] || ''
	    const msg = String(err?.code || err?.message || err)
	    const doc = renderAdminAudioConfigForm({
	      title: 'Edit Audio Config',
	      action: `/admin/audio-configs/${id}`,
	      backHref: '/admin/audio-configs',
	      csrfToken,
	      error: msg,
					      config: {
					        id,
					        name: req.body?.name,
					        description: req.body?.description,
					        mode: req.body?.mode,
					        musicGainDb: req.body?.musicGainDb,
					        duckingMode: req.body?.duckingMode,
				        duckingGate: req.body?.duckingGate,
				        audioDurationSeconds: req.body?.audioDurationSeconds,
				        audioFadeEnabled: Boolean(req.body?.audioFadeEnabled),
				        openerCutFadeBeforeSeconds: req.body?.openerCutFadeBeforeSeconds,
				        openerCutFadeAfterSeconds: req.body?.openerCutFadeAfterSeconds,
				      },
				    })
	    res.set('Content-Type', 'text/html; charset=utf-8')
	    res.status(400).send(doc)
	  }
	})

pagesRouter.post('/admin/audio-configs/:id/archive', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad id')
    const currentUserId = req.user?.id ? Number(req.user.id) : null
    if (!currentUserId) return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '/admin/audio-configs')}`)
    await audioConfigsSvc.archiveForOwner(id, currentUserId)
    res.redirect('/admin/audio-configs')
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin audio-config archive failed', { path: req.path })
    res.status(500).send('Failed to archive audio config')
  }
})

async function deleteS3Prefix(bucket: string, prefix: string): Promise<{ deleted: number; errors: string[] }> {
  let token: string | undefined = undefined
  let totalDeleted = 0
  const errors: string[] = []
  do {
    const list: any = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    const contents = list.Contents ?? []
    if (contents.length) {
      const Objects = contents.map((o: any) => ({ Key: o.Key }))
      try {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }))
      } catch (e: any) {
        errors.push(`delete:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
        break
      }
      totalDeleted += Objects.length
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)
  return { deleted: totalDeleted, errors }
}

async function deleteS3Objects(bucket: string, keys: string[]): Promise<{ deleted: number; errors: string[] }> {
  const unique = Array.from(new Set(keys.filter(Boolean).map((k) => String(k))))
  const errors: string[] = []
  let deleted = 0
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000)
    try {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }))
      deleted += batch.length
    } catch (e: any) {
      errors.push(`delete:${bucket}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
    }
  }
  return { deleted, errors }
}

async function purgeAndDeleteMediaJob(db: any, jobId: number): Promise<void> {
  const [rows] = await db.query(`SELECT * FROM media_job_attempts WHERE job_id = ?`, [jobId])
  const attempts = rows as any[]

  const toDelete: Array<{ bucket: string; key: string }> = []
  for (const a of attempts) {
    if (a.stdout_s3_bucket && a.stdout_s3_key) toDelete.push({ bucket: String(a.stdout_s3_bucket), key: String(a.stdout_s3_key) })
    if (a.stderr_s3_bucket && a.stderr_s3_key) toDelete.push({ bucket: String(a.stderr_s3_bucket), key: String(a.stderr_s3_key) })
  }

  const grouped = new Map<string, string[]>()
  for (const obj of toDelete) {
    const arr = grouped.get(obj.bucket) || []
    arr.push(obj.key)
    grouped.set(obj.bucket, arr)
  }
  for (const [bucket, keys] of grouped.entries()) {
    await deleteS3Objects(bucket, keys)
  }

  for (const a of attempts) {
    if (a.artifacts_s3_bucket && a.artifacts_s3_prefix) {
      await deleteS3Prefix(String(a.artifacts_s3_bucket), String(a.artifacts_s3_prefix))
    }
  }

  // Detach any soft references (best-effort).
  try {
    await db.query(`UPDATE create_video_projects SET last_export_job_id = NULL WHERE last_export_job_id = ?`, [jobId])
  } catch {}

  await db.query(`DELETE FROM media_job_attempts WHERE job_id = ?`, [jobId])
  await db.query(`DELETE FROM media_jobs WHERE id = ?`, [jobId])
}

pagesRouter.get('/admin/media-jobs', async (req: any, res: any) => {
  try {
    const db = getPool()
    const qStatus = String(req.query?.status || '').trim().toLowerCase()
    const qType = String(req.query?.type || '').trim()
    const qFrom = String(req.query?.from || '').trim()
    const qTo = String(req.query?.to || '').trim()

    const where: string[] = []
    const params: any[] = []
    if (qStatus) {
      where.push('status = ?')
      params.push(qStatus)
    }
    if (qType) {
      where.push('type = ?')
      params.push(qType)
    }
    if (qFrom) {
      where.push('created_at >= ?')
      params.push(`${qFrom} 00:00:00`)
    }
    if (qTo) {
      where.push('created_at <= ?')
      params.push(`${qTo} 23:59:59`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [rows] = await db.query(
      `SELECT id, type, status, priority, attempts, max_attempts, error_code, error_message, created_at, updated_at, completed_at
         FROM media_jobs
        ${whereSql}
        ORDER BY id DESC
        LIMIT 250`,
      params
    )
    const items = rows as any[]
    const jobIds = items.map((r) => Number(r.id)).filter((v) => Number.isFinite(v) && v > 0)
    const manifestByJobId = new Map<number, any>()
    const attemptStatsByJobId = new Map<
      number,
      { durationMs: number | null; queueWaitMs: number | null; inputBytes: number | null; outputBytes: number | null; errorClass: string | null }
    >()
    if (jobIds.length) {
      try {
        const [attRows] = await db.query(
          `SELECT a.job_id, a.scratch_manifest_json, a.duration_ms, a.queue_wait_ms, a.input_bytes, a.output_bytes, a.error_class
             FROM media_job_attempts a
             JOIN (
               SELECT job_id, MAX(attempt_no) AS max_no
                 FROM media_job_attempts
                WHERE job_id IN (?)
                GROUP BY job_id
             ) m ON a.job_id = m.job_id AND a.attempt_no = m.max_no`,
          [jobIds]
        )
        for (const r of attRows as any[]) {
          let manifest: any = r.scratch_manifest_json
          try { if (typeof manifest === 'string') manifest = JSON.parse(manifest) } catch {}
          if (manifest) manifestByJobId.set(Number(r.job_id), manifest)
          attemptStatsByJobId.set(Number(r.job_id), {
            durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
            queueWaitMs: r.queue_wait_ms == null ? null : Number(r.queue_wait_ms),
            inputBytes: r.input_bytes == null ? null : Number(r.input_bytes),
            outputBytes: r.output_bytes == null ? null : Number(r.output_bytes),
            errorClass: r.error_class == null ? null : String(r.error_class),
          })
        }
      } catch {}
    }
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const statusPill = (st: string) => {
      const s = String(st || '').toLowerCase()
      const bg =
        s === 'completed' ? 'rgba(0,150,90,0.28)' :
        s === 'processing' ? 'rgba(10,132,255,0.22)' :
        s === 'pending' ? 'rgba(255,255,255,0.08)' :
        s === 'failed' ? 'rgba(255,120,120,0.25)' :
        s === 'dead' ? 'rgba(255,120,120,0.25)' :
        'rgba(255,255,255,0.08)'
      return `<span class="pill" style="background:${bg}">${escapeHtml(s)}</span>`
    }

    let body = '<h1>Media Jobs</h1>'
    body += '<div class="toolbar">'
    body += '<div><span class="pill">FFmpeg Queue</span></div>'
    body += `<div style="display:flex; gap:12px; align-items:center">
      <form method="get" action="/admin/media-jobs" style="display:flex; gap:8px; align-items:center">
        <select name="status" style="padding:6px 8px; font-size:12px">
          <option value="">All Status</option>
          ${['pending','processing','completed','failed','dead'].map((s) => `<option value="${escapeHtml(s)}"${qStatus===s?' selected':''}>${escapeHtml(s)}</option>`).join('')}
        </select>
        <input type="text" name="type" placeholder="Type" value="${escapeHtml(qType)}" style="width: 180px" />
        <input type="date" name="from" value="${escapeHtml(qFrom)}" />
        <input type="date" name="to" value="${escapeHtml(qTo)}" />
        <button type="submit" class="btn" style="padding:6px 10px; font-size:12px">Filter</button>
      </form>
      <form method="post" action="/admin/media-jobs/purge" style="display:flex; gap:8px; align-items:center">
        ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
        <input type="text" name="older_than_days" placeholder="Purge logs older than days" style="width: 220px" />
        <button type="submit" class="btn danger" style="padding:6px 10px; font-size:12px">Purge</button>
      </form>
    </div>`
    body += '</div>'

    body += '<div class="section">'
    body += '<div class="section-title">Latest</div>'
    if (!items.length) {
      body += '<p>No media jobs yet.</p>'
    } else {
      body += '<table><thead><tr><th>ID</th><th>Status</th><th>Type</th><th>Attempts</th><th>Created</th><th>Updated</th><th>Duration</th><th>Metrics</th><th>Actions</th></tr></thead><tbody>'
      for (const r of items) {
        const id = Number(r.id)
        const st = String(r.status || '')
        const type = String(r.type || '')
        const attempts = `${Number(r.attempts || 0)}/${Number(r.max_attempts || 0)}`
        const created = String(r.created_at || '')
        const updated = String(r.updated_at || '')
        const completed = r.completed_at ? new Date(String(r.completed_at)) : null
        const createdAt = created ? new Date(created) : null
        const attemptStats = attemptStatsByJobId.get(id) || null
        const durMs =
          attemptStats?.durationMs != null
            ? Number(attemptStats.durationMs)
            : completed && createdAt
              ? Math.max(0, completed.getTime() - createdAt.getTime())
              : null
        const durLabel = durMs != null ? `${(durMs / 1000).toFixed(1)}s` : ''
        const manifest = manifestByJobId.get(id) || null
        const metrics = manifest?.metrics || {}
        const input = metrics?.input || {}
        const inputDuration = Number(input?.durationSeconds ?? manifest?.inputSummary?.duration)
        const inputDurLabel = Number.isFinite(inputDuration) ? `${inputDuration.toFixed(1)}s` : ''
        const rtf = Number(metrics?.rtf)
        const rtfLabel = Number.isFinite(rtf) ? `RTF ${rtf.toFixed(2)}x` : ''
        const resLabel =
          Number.isFinite(Number(input?.width)) && Number.isFinite(Number(input?.height))
            ? `${Number(input.width)}x${Number(input.height)}`
            : ''
        const ioIn = Number(metrics?.ioInBytesPerSec)
        const ioOut = Number(metrics?.ioOutBytesPerSec)
        const ioLabel =
          Number.isFinite(ioIn) || Number.isFinite(ioOut)
            ? `IO ${Number.isFinite(ioIn) ? (ioIn / 1e6).toFixed(1) : '-'} / ${Number.isFinite(ioOut) ? (ioOut / 1e6).toFixed(1) : '-'} MB/s`
            : ''
        const ioDbLabel =
          attemptStats && (Number.isFinite(Number(attemptStats.inputBytes)) || Number.isFinite(Number(attemptStats.outputBytes)))
            ? `I/O ${(Number(attemptStats.inputBytes || 0) / 1e6).toFixed(1)} / ${(Number(attemptStats.outputBytes || 0) / 1e6).toFixed(1)} MB`
            : ''
        const queueWaitLabel =
          attemptStats && Number.isFinite(Number(attemptStats.queueWaitMs))
            ? `Queue ${(Number(attemptStats.queueWaitMs) / 1000).toFixed(1)}s`
            : ''
        const errorClassLabel = attemptStats?.errorClass ? `ErrClass ${attemptStats.errorClass}` : ''
        const overheadMs = Number(metrics?.overheadMs)
        const overheadLabel = Number.isFinite(overheadMs) ? `OH ${(overheadMs / 1000).toFixed(1)}s` : ''
        const metricsLabel = [resLabel, inputDurLabel, rtfLabel, ioDbLabel || ioLabel, queueWaitLabel, errorClassLabel, overheadLabel].filter(Boolean).join(' • ') || '-'
        const typePill = `<span class="pill" style="background:rgba(255,255,255,0.08); font-size:10px; padding:2px 6px">${escapeHtml(type)}</span>`
        body += `<tr>`
        body += `<td><a href="/admin/media-jobs/${id}">#${id}</a></td>`
        body += `<td>${statusPill(st)}</td>`
        body += `<td>${escapeHtml(type)}</td>`
        body += `<td>${escapeHtml(attempts)}</td>`
        body += `<td>${escapeHtml(created)}</td>`
        body += `<td>${escapeHtml(updated)}</td>`
        body += `<td>${escapeHtml(durLabel)}</td>`
        body += `<td><div style="display:flex; flex-direction:column; gap:4px">${typePill}<div>${escapeHtml(metricsLabel)}</div></div></td>`
	        body += `<td style="white-space:nowrap">
	          <a class="btn" href="/admin/media-jobs/${id}" style="padding:6px 10px; font-size:12px">View</a>
	          <form method="post" action="/admin/media-jobs/${id}/retry" style="display:inline" onsubmit="return confirm('Retry media job #${id}?');">
	            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
	            <button type="submit" class="btn" style="padding:6px 10px; font-size:12px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18)">Retry</button>
	          </form>
	          <form method="post" action="/admin/media-jobs/${id}/purge" style="display:inline">
	            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
	            <button type="submit" class="btn danger" style="padding:6px 10px; font-size:12px">Purge logs</button>
	          </form>
	        </td>`
	        body += `</tr>`
	      }
      body += '</tbody></table>'
    }
    body += '</div>'

    const doc = renderAdminPage({ title: 'Media Jobs', bodyHtml: body, active: 'media_jobs' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin media-jobs list failed', { path: req.path })
    res.status(500).send('Failed to load media jobs')
  }
})

pagesRouter.post('/admin/media-jobs/:id/retry', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad id')
    const db = getPool()
    await db.query(
      `UPDATE media_jobs
          SET status = 'pending',
              run_after = NULL,
              locked_at = NULL,
              locked_by = NULL,
              error_code = NULL,
              error_message = NULL,
              attempts = 0,
              updated_at = NOW()
        WHERE id = ?`,
      [id]
    )
    res.redirect(`/admin/media-jobs/${id}`)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin media-jobs retry failed', { path: req.path })
    res.status(500).send('Failed to retry media job')
  }
})

pagesRouter.get('/admin/media-jobs/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')
    const db = getPool()
    const [jobRows] = await db.query(`SELECT * FROM media_jobs WHERE id = ? LIMIT 1`, [id])
    const job = (jobRows as any[])[0]
    if (!job) return res.status(404).send('Not found')
    const [attemptRows] = await db.query(
      `SELECT *
         FROM media_job_attempts
        WHERE job_id = ?
        ORDER BY attempt_no ASC, id ASC`,
      [id]
    )
    const attempts = attemptRows as any[]
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    let inputJson: any = job.input_json
    let resultJson: any = job.result_json
    try { if (typeof inputJson === 'string') inputJson = JSON.parse(inputJson) } catch {}
    try { if (typeof resultJson === 'string') resultJson = JSON.parse(resultJson) } catch {}

    let body = `<h1>Media Job #${escapeHtml(String(id))}</h1>`
    body += `<div class="toolbar"><div><a href="/admin/media-jobs">\u2190 Back</a></div><div style="display:flex; gap:10px; align-items:center">
      <form method="post" action="/admin/media-jobs/${id}/retry" onsubmit="return confirm('Retry media job #${id}?');">
        ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
        <button type="submit" class="btn">Retry</button>
      </form>
      <form method="post" action="/admin/media-jobs/${id}/purge" onsubmit="return confirm('Purge logs/artifacts for media job #${id}?');">
        ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
        <button type="submit" class="btn danger">Purge logs</button>
      </form>
    </div></div>`

    body += '<div class="section">'
    body += '<div class="section-title">Summary</div>'
    body += `<p>Status: <strong>${escapeHtml(String(job.status || ''))}</strong></p>`
    body += `<p>Type: <strong>${escapeHtml(String(job.type || ''))}</strong></p>`
    body += `<p>Attempts: <strong>${escapeHtml(String(job.attempts || '0'))}/${escapeHtml(String(job.max_attempts || '0'))}</strong></p>`
    body += job.error_message ? `<p>Error: <strong>${escapeHtml(String(job.error_code || 'failed'))}</strong> &nbsp;${escapeHtml(String(job.error_message || ''))}</p>` : ''
    body += '</div>'

    body += '<div class="section">'
    body += '<div class="section-title">Attempts</div>'
    if (!attempts.length) {
      body += '<p>No attempts yet.</p>'
    } else {
      body += '<table><thead><tr><th>#</th><th>Started</th><th>Finished</th><th>Exit</th><th>Queue</th><th>Duration</th><th>I/O</th><th>Error Class</th><th>Logs</th></tr></thead><tbody>'
      for (const a of attempts) {
        const aid = Number(a.id)
        const no = Number(a.attempt_no)
        const started = String(a.started_at || '')
        const finished = a.finished_at ? String(a.finished_at) : ''
        const exit = a.exit_code != null ? String(a.exit_code) : ''
        const queueWaitMs = a.queue_wait_ms == null ? null : Number(a.queue_wait_ms)
        const durationMs = a.duration_ms == null ? null : Number(a.duration_ms)
        const inputBytes = a.input_bytes == null ? null : Number(a.input_bytes)
        const outputBytes = a.output_bytes == null ? null : Number(a.output_bytes)
        const errorClass = a.error_class == null ? '' : String(a.error_class)
        const hasStdout = a.stdout_s3_bucket && a.stdout_s3_key
        const hasStderr = a.stderr_s3_bucket && a.stderr_s3_key
        body += `<tr>`
        body += `<td>${escapeHtml(String(no))}</td>`
        body += `<td>${escapeHtml(started)}</td>`
        body += `<td>${escapeHtml(finished)}</td>`
        body += `<td>${escapeHtml(exit)}</td>`
        body += `<td>${queueWaitMs != null ? escapeHtml(`${(queueWaitMs / 1000).toFixed(2)}s`) : ''}</td>`
        body += `<td>${durationMs != null ? escapeHtml(`${(durationMs / 1000).toFixed(2)}s`) : ''}</td>`
        body += `<td>${(inputBytes != null || outputBytes != null) ? escapeHtml(`${((inputBytes || 0) / 1e6).toFixed(2)} / ${((outputBytes || 0) / 1e6).toFixed(2)} MB`) : ''}</td>`
        body += `<td>${escapeHtml(errorClass)}</td>`
        body += `<td>`
        body += hasStdout ? `<a href="/admin/media-jobs/${id}/attempts/${aid}/stdout">stdout</a>` : 'stdout: -'
        body += ' &nbsp; '
        body += hasStderr ? `<a href="/admin/media-jobs/${id}/attempts/${aid}/stderr">stderr</a>` : 'stderr: -'
        body += `</td>`
        body += `</tr>`
      }
      body += '</tbody></table>'
    }
    body += '</div>'

    const manifestBlocks: string[] = []
    for (const a of attempts) {
      let manifest: any = a.scratch_manifest_json
      try { if (typeof manifest === 'string') manifest = JSON.parse(manifest) } catch {}
      if (!manifest || (typeof manifest === 'object' && Object.keys(manifest).length === 0)) continue
      const no = Number(a.attempt_no)
      const summary = manifest || {}
      const ffmpegCommands = Array.isArray(summary.ffmpegCommands) ? summary.ffmpegCommands : []
      const s3Ops = Array.isArray(summary.s3Ops) ? summary.s3Ops : []
      const errors = Array.isArray(summary.errors) ? summary.errors : []
      const metrics = summary.metrics || {}
      const metricsInput = metrics?.input || {}
      const metricsHost = metrics?.host || {}
      const durationMs = summary.durationMs != null ? Number(summary.durationMs) : null
      const durationLabel = durationMs != null ? `${(durationMs / 1000).toFixed(2)}s` : ''
      const ffmpegMs = Number(metrics?.ffmpegMs)
      const ffmpegLabel = Number.isFinite(ffmpegMs) ? `${(ffmpegMs / 1000).toFixed(2)}s` : ''
      const overheadMs = Number(metrics?.overheadMs)
      const overheadLabel = Number.isFinite(overheadMs) ? `${(overheadMs / 1000).toFixed(2)}s` : ''
      const inputDuration = Number(metricsInput?.durationSeconds)
      const inputDurationLabel = Number.isFinite(inputDuration) ? `${inputDuration.toFixed(2)}s` : ''
      const inputRes =
        Number.isFinite(Number(metricsInput?.width)) && Number.isFinite(Number(metricsInput?.height))
          ? `${Number(metricsInput.width)}x${Number(metricsInput.height)}`
          : ''
      const inputCodec =
        metricsInput?.videoCodec || metricsInput?.audioCodec
          ? [metricsInput?.videoCodec, metricsInput?.audioCodec].filter(Boolean).join(', ')
          : ''
      const inputBitrate = Number(metricsInput?.bitrateKbps)
      const inputBitrateLabel = Number.isFinite(inputBitrate) ? `${inputBitrate} kbps` : ''
      const rtfVal = Number(metrics?.rtf)
      const rtfLabel = Number.isFinite(rtfVal) ? `${rtfVal.toFixed(3)}x` : ''
      const ioIn = Number(metrics?.ioInBytesPerSec)
      const ioOut = Number(metrics?.ioOutBytesPerSec)
      const ioLabel =
        Number.isFinite(ioIn) || Number.isFinite(ioOut)
          ? `${Number.isFinite(ioIn) ? (ioIn / 1e6).toFixed(2) : '-'} / ${Number.isFinite(ioOut) ? (ioOut / 1e6).toFixed(2) : '-'} MB/s`
          : ''
      const hostLabel = metricsHost?.instanceType
        ? `${metricsHost.instanceType} • ${metricsHost.cpuCores || '?'} cores • ${metricsHost.memGb || '?'}GB`
        : ''
      manifestBlocks.push(
        `<details style="margin-top:10px"><summary>Attempt #${escapeHtml(String(no))} manifest</summary>` +
          `<div style="margin-top:8px; display:grid; gap:10px">
             <div><strong>Summary</strong><br/>
              Started: ${escapeHtml(String(summary.startedAt || ''))}<br/>
              Finished: ${escapeHtml(String(summary.finishedAt || ''))}<br/>
              Duration: ${escapeHtml(durationLabel)}<br/>
              ${rtfLabel ? `RTF: ${escapeHtml(rtfLabel)}<br/>` : ''}
              ${ffmpegLabel ? `ffmpeg: ${escapeHtml(ffmpegLabel)}<br/>` : ''}
              ${overheadLabel ? `Overhead: ${escapeHtml(overheadLabel)}<br/>` : ''}
              ${ioLabel ? `IO: ${escapeHtml(ioLabel)}<br/>` : ''}
              ${inputDurationLabel || inputRes || inputCodec || inputBitrateLabel ? `Input: ${escapeHtml([inputRes, inputDurationLabel, inputCodec, inputBitrateLabel].filter(Boolean).join(' • '))}<br/>` : ''}
              ${hostLabel ? `Host: ${escapeHtml(hostLabel)}<br/>` : ''}
            </div>
            ${ffmpegCommands.length ? `<div><strong>ffmpegCommands</strong><pre style="white-space:pre-wrap; word-break:break-word">${escapeHtml(ffmpegCommands.join('\n'))}</pre></div>` : ''}
            ${s3Ops.length ? `<div><strong>S3 Ops</strong><table><thead><tr><th>Op</th><th>Bucket</th><th>Key</th><th>Bytes</th><th>Duration</th><th>Status</th></tr></thead><tbody>${s3Ops
              .map((o: any) => `<tr><td>${escapeHtml(String(o.op || ''))}</td><td>${escapeHtml(String(o.bucket || ''))}</td><td>${escapeHtml(String(o.key || ''))}</td><td>${escapeHtml(String(o.bytes ?? ''))}</td><td>${escapeHtml(String(o.durationMs ?? ''))}</td><td>${escapeHtml(String(o.status || ''))}</td></tr>`)
              .join('')}</tbody></table></div>` : ''}
            ${errors.length ? `<div><strong>Errors</strong><pre style="white-space:pre-wrap; word-break:break-word">${escapeHtml(JSON.stringify(errors, null, 2))}</pre></div>` : ''}
            <details><summary>Raw Manifest</summary><pre style="white-space:pre-wrap; word-break:break-word; margin-top:8px">${escapeHtml(JSON.stringify(manifest, null, 2))}</pre></details>
          </div>` +
        `</details>`
      )
    }
    if (manifestBlocks.length) {
      body += '<div class="section">'
      body += '<div class="section-title">Attempt Manifests</div>'
      body += manifestBlocks.join('')
      body += '</div>'
    }

    body += '<div class="section">'
    body += '<div class="section-title">Input JSON</div>'
    body += `<pre style="white-space:pre-wrap; word-break:break-word">${escapeHtml(JSON.stringify(inputJson ?? null, null, 2))}</pre>`
    body += '</div>'

    body += '<div class="section">'
    body += '<div class="section-title">Result JSON</div>'
    body += `<pre style="white-space:pre-wrap; word-break:break-word">${escapeHtml(JSON.stringify(resultJson ?? null, null, 2))}</pre>`
    body += '</div>'

    const doc = renderAdminPage({ title: `Media Job #${id}`, bodyHtml: body, active: 'media_jobs' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin media-job detail failed', { path: req.path })
    res.status(500).send('Failed to load media job')
  }
})

pagesRouter.get('/admin/media-jobs/:jobId/attempts/:attemptId/:stream', async (req: any, res: any) => {
  try {
    const jobId = Number(req.params.jobId)
    const attemptId = Number(req.params.attemptId)
    const stream = String(req.params.stream || '').toLowerCase()
    if (!Number.isFinite(jobId) || jobId <= 0) return res.status(404).send('Not found')
    if (!Number.isFinite(attemptId) || attemptId <= 0) return res.status(404).send('Not found')
    if (stream !== 'stdout' && stream !== 'stderr') return res.status(404).send('Not found')
    const db = getPool()
    const [rows] = await db.query(`SELECT * FROM media_job_attempts WHERE id = ? AND job_id = ? LIMIT 1`, [attemptId, jobId])
    const a = (rows as any[])[0]
    if (!a) return res.status(404).send('Not found')
    const bucket = stream === 'stdout' ? String(a.stdout_s3_bucket || '') : String(a.stderr_s3_bucket || '')
    const key = stream === 'stdout' ? String(a.stdout_s3_key || '') : String(a.stderr_s3_key || '')
    if (!bucket || !key) return res.status(404).send('Not found')
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const body = resp.Body as any
    if (!body) return res.status(404).send('Not found')
    res.set('Content-Type', 'text/plain; charset=utf-8')
    res.set('Cache-Control', 'no-store')
    await pipeline(body, res)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin media-job log stream failed', { path: req.path })
    res.status(500).send('Failed to load log')
  }
})

pagesRouter.post('/admin/media-jobs/:id/purge', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad id')
    const db = getPool()
    await purgeAndDeleteMediaJob(db, id)
    res.redirect('/admin/media-jobs')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin media-job purge failed', { path: req.path })
    res.status(500).send('Failed to purge media job logs')
  }
})

pagesRouter.post('/admin/media-jobs/purge', async (req: any, res: any) => {
  try {
    const days = Math.max(0, Math.min(36500, Math.round(Number(req.body?.older_than_days || 0) || 0)))
    if (!days) return res.redirect('/admin/media-jobs')
    const db = getPool()
    const [jobRows] = await db.query(
      `SELECT id
         FROM media_jobs
        WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY id ASC
        LIMIT 200`,
      [days]
    )
    const ids = (jobRows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)
    for (const id of ids) {
      await purgeAndDeleteMediaJob(db, id)
    }
    res.redirect('/admin/media-jobs')
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin media-jobs bulk purge failed', { path: req.path })
    res.status(500).send('Failed to purge media jobs logs')
  }
})

pagesRouter.get('/admin/settings', async (_req: any, res: any) => {
  const body = [
    '<h1>Settings</h1>',
    '<div class="section">',
    '<div class="section-title">Coming Soon</div>',
    '<p>This admin page is not implemented yet.</p>',
    '<p class="field-hint">We are keeping site_admin tooling out of the user SPA bundle; settings will return here when we decide what is still used and what should be editable.</p>',
    '</div>',
  ].join('')
  const doc = renderAdminPage({ title: 'Settings', bodyHtml: body, active: 'settings' })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
});

pagesRouter.get('/admin/video-library', async (req: any, res: any) => {
  try {
    const db = getPool()
    const q = String(req.query?.q || '').trim()
    const sourceOrg = String(req.query?.source_org || '').trim().toLowerCase()
    const where: string[] = []
    const args: any[] = []
    where.push(`u.kind = 'video'`)
    where.push(`u.is_system_library = 1`)
    where.push(`u.status IN ('uploaded','completed')`)
    where.push(`u.source_deleted_at IS NULL`)
    if (q) {
      where.push(`(COALESCE(u.modified_filename, u.original_filename) LIKE ? OR u.description LIKE ? OR u.original_filename LIKE ?)`)
      const like = `%${q}%`
      args.push(like, like, like)
    }
    if (sourceOrg && sourceOrg !== 'all') {
      where.push(`LOWER(COALESCE(u.source_org,'')) = ?`)
      args.push(sourceOrg)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await db.query(
      `SELECT u.id, u.modified_filename, u.original_filename, u.description, u.source_org, u.duration_seconds, u.size_bytes, u.width, u.height, u.created_at
         FROM uploads u
         ${whereSql}
        ORDER BY u.id DESC
        LIMIT 200`,
      args
    )
    const items = rows as any[]
    let body = '<h1>Video Library</h1>'
    body += '<div class="toolbar"><div><span class="pill">System Library</span></div>'
    body += `<div><a href="/uploads/new?kind=video&library=1&return=${encodeURIComponent('/admin/video-library')}" class="btn">Upload</a></div></div>`

    body += `<form method="get" action="/admin/video-library" style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:16px">`
    body += `<input type="text" name="q" placeholder="Search name/description" value="${escapeHtml(q)}" style="flex:1; min-width:200px" />`
    body += `<select name="source_org" style="min-width:160px">`
    const sourceOptions = [
      { value: 'all', label: 'All sources' },
      ...librarySourceOptions,
    ]
    for (const opt of sourceOptions) {
      const selected = (sourceOrg || 'all') === opt.value ? 'selected' : ''
      body += `<option value="${escapeHtml(opt.value)}" ${selected}>${escapeHtml(opt.label)}</option>`
    }
    body += `</select>`
    body += `<button class="btn" type="submit">Filter</button>`
    body += `</form>`

    if (!items.length) {
      body += '<p>No system library videos yet.</p>'
    } else {
      body += '<div style="display:grid; gap:16px">'
      for (const row of items) {
        const id = Number(row.id)
        const name = String(row.modified_filename || row.original_filename || `Video ${row.id}`)
        const desc = String(row.description || '')
        const descTrim = desc.trim()
        const descWords = descTrim ? descTrim.split(/\s+/) : []
        const descTruncated = descWords.length > 20
        const descShort = descTruncated ? `${descWords.slice(0, 20).join(' ')}…` : descTrim
        const srcValue = String(row.source_org || 'other').trim().toLowerCase()
        const srcLabel = getLibrarySourceLabel(srcValue) || srcValue.toUpperCase()
        const dims = row.width && row.height ? `${row.width}×${row.height}` : ''
        const duration = row.duration_seconds ? `${row.duration_seconds}s` : ''
        const size = row.size_bytes ? `${Math.round(Number(row.size_bytes) / 1024 / 1024)} MB` : ''
        const meta = [srcLabel, duration, dims].filter(Boolean).join(' · ')
        body += `<div class="card" data-upload-id="${escapeHtml(String(id))}" style="border:1px solid rgba(255,255,255,0.14); border-radius:14px; padding:14px; background:rgba(18,18,18,0.92);">`
        body += `<button type="button" class="js-video-title" data-title="${escapeHtml(name)}" data-desc="${escapeHtml(descTrim)}" style="padding:0; border:none; background:transparent; color:#fff; text-align:left; font-weight:900; font-size:16px; cursor:pointer;">${escapeHtml(name)}</button>`
        if (meta) body += `<div class="field-hint">${escapeHtml(meta)}</div>`
        if (descTrim) {
          body += `<div class="js-video-desc" data-expanded="0" style="opacity:.85; margin-top:6px; line-height:1.4;">`
          body += `<span class="js-video-desc-short">${escapeHtml(descShort)}</span>`
          body += `<span class="js-video-desc-full" style="display:none">${escapeHtml(descTrim)}</span>`
          if (descTruncated) {
            body += ` <button type="button" class="js-video-desc-toggle" style="padding:0; border:none; background:transparent; color:#9bbcff; font-weight:700; cursor:pointer;">more</button>`
          }
          body += `</div>`
        }
        body += `<div style="margin-top:10px">`
        const thumbBase = `/api/uploads/${encodeURIComponent(String(id))}/thumb`
        body += `<video controls playsinline preload="none" src="/api/uploads/${encodeURIComponent(String(id))}/edit-proxy#t=0.1" poster="${thumbBase}?ts=${Date.now()}" data-thumb-base="${escapeHtml(thumbBase)}" style="width:100%; max-height:360px; background:#000; border-radius:12px;"></video>`
        body += `</div>`
        body += `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap">`
        body += `<button type="button" class="btn js-video-delete" data-id="${escapeHtml(String(id))}" style="background:#c62828; border-color:#c62828; color:#fff;">Delete</button>`
        body += `<div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap">`
        body += `<button type="button" class="btn js-video-preview" data-id="${escapeHtml(String(id))}">New Preview</button>`
        body += `<button type="button" class="btn js-video-edit" data-id="${escapeHtml(String(id))}" data-title="${escapeHtml(name)}" data-desc="${escapeHtml(descTrim)}">Edit</button>`
        body += `</div>`
        body += `</div>`
        body += `</div>`
      }
      body += '</div>'

      body += `
        <div id="video-desc-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.6); display:none; align-items:center; justify-content:center; padding:20px; z-index:9999;">
          <div style="width:min(720px, 100%); max-height:80vh; background:#0b0b0b; border-radius:12px; padding:16px; border:1px solid rgba(255,255,255,0.12); color:#fff; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
              <div id="video-desc-modal-title" style="font-weight:900;"></div>
              <button type="button" id="video-desc-modal-close" style="border:1px solid rgba(255,255,255,0.18); background:#1a1a1a; color:#fff; border-radius:8px; padding:4px 10px; font-size:18px; font-weight:700; cursor:pointer;">×</button>
            </div>
            <div id="video-desc-modal-body" style="margin-top:10px; color:#c8c8c8; line-height:1.5; overflow:auto;"></div>
          </div>
        </div>
        <div id="video-edit-modal" role="dialog" aria-modal="true" style="position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.86); display:none; overflow-y:auto; -webkit-overflow-scrolling:touch; align-items:flex-start; justify-content:center; padding:64px 16px 80px; box-sizing:border-box;">
          <div style="width:100%; max-width:560px; margin:0 auto; border-radius:14px; padding:16px; box-sizing:border-box; border:1px solid rgba(96,165,250,0.95); background:linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%); color:#fff; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px;">
              <div style="font-size:18px; font-weight:900;">Edit Video Properties</div>
              <button type="button" id="video-edit-modal-close" style="border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06); color:#fff; border-radius:10px; padding:6px 10px; font-size:14px; font-weight:800; cursor:pointer;">Close</button>
            </div>
            <div style="margin-top:12px; display:grid; gap:10px;">
              <div>
                <div style="font-size:13px; color:#bbb; margin-bottom:6px;">Title</div>
                <input id="video-edit-title" type="text" style="width:100%; max-width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.18); background:#0b0b0b; color:#fff; font-size:14px; font-weight:900;" />
              </div>
              <div>
                <div style="font-size:13px; color:#bbb; margin-bottom:6px;">Description</div>
                <textarea id="video-edit-desc" rows="6" style="width:100%; max-width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.18); background:#0b0b0b; color:#fff; resize:vertical; font-size:14px; font-weight:900;"></textarea>
              </div>
              <div id="video-edit-error" style="display:none; color:#ff9b9b; font-size:13px;"></div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px;">
              <button type="button" id="video-edit-cancel" style="padding:10px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06); color:#fff; font-weight:800; cursor:pointer;">Cancel</button>
              <button type="button" id="video-edit-save" style="padding:10px 14px; border-radius:10px; border:1px solid rgba(96,165,250,0.95); background:rgba(96,165,250,0.14); color:#fff; font-weight:900; cursor:pointer;">Save</button>
            </div>
          </div>
        </div>
        <script>
          (function() {
            function getCsrf() {
              try {
                var m = document.cookie.match(/(?:^|;)\\s*csrf=([^;]+)/);
                return m ? decodeURIComponent(m[1]) : '';
              } catch (e) { return ''; }
            }
            function truncateWords(text, limit) {
              var trimmed = String(text || '').trim();
              if (!trimmed) return { text: '', truncated: false };
              var words = trimmed.split(/\\s+/);
              if (words.length <= limit) return { text: trimmed, truncated: false };
              return { text: words.slice(0, limit).join(' ') + '…', truncated: true };
            }
            var modal = document.getElementById('video-desc-modal');
            var modalTitle = document.getElementById('video-desc-modal-title');
            var modalBody = document.getElementById('video-desc-modal-body');
            var modalClose = document.getElementById('video-desc-modal-close');
            function closeModal() { if (modal) modal.style.display = 'none'; }
            if (modalClose) modalClose.addEventListener('click', closeModal);
            if (modal) modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

            document.querySelectorAll('.js-video-title').forEach(function(el) {
              el.addEventListener('click', function() {
                var title = el.getAttribute('data-title') || '';
                var desc = el.getAttribute('data-desc') || '';
                if (modalTitle) modalTitle.textContent = title;
                if (modalBody) modalBody.textContent = desc || 'No description';
                if (modal) modal.style.display = 'flex';
              });
            });

            var editModal = document.getElementById('video-edit-modal');
            var editTitleInput = document.getElementById('video-edit-title');
            var editDescInput = document.getElementById('video-edit-desc');
            var editError = document.getElementById('video-edit-error');
            var editSaveBtn = document.getElementById('video-edit-save');
            var editCancelBtn = document.getElementById('video-edit-cancel');
            var editCloseBtn = document.getElementById('video-edit-modal-close');
            var editState = { id: '', btn: null, card: null };

            function setEditError(msg) {
              if (!editError) return;
              var text = String(msg || '').trim();
              editError.textContent = text;
              editError.style.display = text ? 'block' : 'none';
            }

            function setEditBusy(isBusy) {
              if (editSaveBtn) editSaveBtn.disabled = !!isBusy;
              if (editCancelBtn) editCancelBtn.disabled = !!isBusy;
              if (editCloseBtn) editCloseBtn.disabled = !!isBusy;
            }

            function closeEditModal() {
              if (editModal) editModal.style.display = 'none';
              setEditBusy(false);
              setEditError('');
              editState = { id: '', btn: null, card: null };
            }

            function openEditModal(btn) {
              var id = btn.getAttribute('data-id') || '';
              if (!id) return;
              var currentTitle = btn.getAttribute('data-title') || '';
              var currentDesc = btn.getAttribute('data-desc') || '';
              editState = { id: id, btn: btn, card: btn.closest('.card') };
              if (editTitleInput) editTitleInput.value = currentTitle;
              if (editDescInput) editDescInput.value = currentDesc;
              setEditError('');
              setEditBusy(false);
              if (editModal) editModal.style.display = 'flex';
              if (editTitleInput && typeof editTitleInput.focus === 'function') {
                editTitleInput.focus();
                try {
                  var len = String(editTitleInput.value || '').length;
                  editTitleInput.setSelectionRange(len, len);
                } catch (e) {}
              }
            }

            async function saveEditModal() {
              if (!editState.id) return;
              var nextTitle = editTitleInput ? String(editTitleInput.value || '').trim() : '';
              var nextDesc = editDescInput ? String(editDescInput.value || '') : '';
              if (!nextTitle) {
                setEditError('Title is required.');
                return;
              }
              setEditBusy(true);
              setEditError('');
              try {
                var headers = { 'Content-Type': 'application/json' };
                var csrf = getCsrf();
                if (csrf) headers['x-csrf-token'] = csrf;
                var res = await fetch('/api/uploads/' + encodeURIComponent(editState.id), {
                  method: 'PATCH',
                  credentials: 'same-origin',
                  headers: headers,
                  body: JSON.stringify({ modified_filename: nextTitle, description: nextDesc })
                });
                var json = await res.json().catch(function() { return null; });
                if (!res.ok) throw new Error(String((json && (json.detail || json.error)) || 'Failed to update'));
                var card = editState.card;
                var btn = editState.btn;
                if (card) {
                  var titleBtn = card.querySelector('.js-video-title');
                  if (titleBtn) {
                    titleBtn.textContent = nextTitle;
                    titleBtn.setAttribute('data-title', nextTitle);
                    titleBtn.setAttribute('data-desc', nextDesc);
                  }
                  if (btn) {
                    btn.setAttribute('data-title', nextTitle);
                    btn.setAttribute('data-desc', nextDesc);
                  }
                  var descWrapper = card.querySelector('.js-video-desc');
                  if (descWrapper) {
                    var truncated = truncateWords(nextDesc, 20);
                    var shortEl = descWrapper.querySelector('.js-video-desc-short');
                    var fullEl = descWrapper.querySelector('.js-video-desc-full');
                    var toggleBtn = descWrapper.querySelector('.js-video-desc-toggle');
                    if (shortEl) shortEl.textContent = truncated.text;
                    if (fullEl) fullEl.textContent = nextDesc;
                    if (toggleBtn) {
                      if (truncated.truncated) {
                        toggleBtn.style.display = '';
                        toggleBtn.textContent = 'more';
                      } else {
                        toggleBtn.style.display = 'none';
                      }
                    }
                    descWrapper.setAttribute('data-expanded', '0');
                    if (shortEl) shortEl.style.display = '';
                    if (fullEl) fullEl.style.display = 'none';
                  }
                }
                closeEditModal();
              } catch (err) {
                setEditError(err && err.message ? err.message : 'Failed to update');
                setEditBusy(false);
              }
            }

            if (editSaveBtn) editSaveBtn.addEventListener('click', function() { void saveEditModal(); });
            if (editCancelBtn) editCancelBtn.addEventListener('click', closeEditModal);
            if (editCloseBtn) editCloseBtn.addEventListener('click', closeEditModal);
            if (editModal) editModal.addEventListener('click', function(e) { if (e.target === editModal) closeEditModal(); });
            document.addEventListener('keydown', function(e) {
              if (e.key === 'Escape' && editModal && editModal.style.display === 'flex') closeEditModal();
            });

            document.querySelectorAll('.js-video-desc-toggle').forEach(function(btn) {
              btn.addEventListener('click', function() {
                var wrapper = btn.closest('.js-video-desc');
                if (!wrapper) return;
                var expanded = wrapper.getAttribute('data-expanded') === '1';
                var shortEl = wrapper.querySelector('.js-video-desc-short');
                var fullEl = wrapper.querySelector('.js-video-desc-full');
                if (shortEl) shortEl.style.display = expanded ? '' : 'none';
                if (fullEl) fullEl.style.display = expanded ? 'none' : '';
                wrapper.setAttribute('data-expanded', expanded ? '0' : '1');
                btn.textContent = expanded ? 'more' : 'less';
              });
            });

            document.querySelectorAll('.js-video-edit').forEach(function(btn) {
              btn.addEventListener('click', function() {
                openEditModal(btn);
              });
            });

            document.querySelectorAll('.js-video-delete').forEach(function(btn) {
              btn.addEventListener('click', async function() {
                var id = btn.getAttribute('data-id') || '';
                if (!id) return;
                if (!window.confirm('Delete this video? This cannot be undone.')) return;
                try {
                  var headers = {};
                  var csrf = getCsrf();
                  if (csrf) headers['x-csrf-token'] = csrf;
                  var res = await fetch('/api/uploads/' + encodeURIComponent(id), {
                    method: 'DELETE',
                    credentials: 'same-origin',
                    headers: headers
                  });
                  var json = await res.json().catch(function() { return null; });
                  if (!res.ok) throw new Error(String((json && (json.detail || json.error)) || 'Failed to delete'));
                  var card = btn.closest('.card');
                  if (card && card.parentNode) card.parentNode.removeChild(card);
                } catch (err) {
                  window.alert(err && err.message ? err.message : 'Failed to delete');
                }
              });
            });

            document.querySelectorAll('.js-video-preview').forEach(function(btn) {
              btn.addEventListener('click', async function() {
                var id = btn.getAttribute('data-id') || '';
                if (!id) return;
                var card = btn.closest('.card');
                var video = card ? card.querySelector('video') : null;
                if (!video) {
                  window.alert('Video player not found.');
                  return;
                }
                if (video.readyState < 1) {
                  window.alert('Play the video briefly to load it, then pause on the frame you want.');
                  return;
                }
                var t = Number(video.currentTime || 0);
                if (!Number.isFinite(t) || t < 0) {
                  window.alert('Pick a frame in the video first.');
                  return;
                }
                var original = btn.textContent;
                btn.textContent = 'Saving…';
                btn.setAttribute('disabled', 'true');
                try {
                  var headers = { 'Content-Type': 'application/json' };
                  var csrf = getCsrf();
                  if (csrf) headers['x-csrf-token'] = csrf;
                  var res = await fetch('/api/uploads/' + encodeURIComponent(id) + '/thumb', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: headers,
                    body: JSON.stringify({ timeSeconds: Number(t.toFixed(2)) })
                  });
                  var json = await res.json().catch(function() { return null; });
                  if (!res.ok) throw new Error(String((json && (json.detail || json.error)) || 'Failed to update preview'));
                  if (video) {
                    var base = video.getAttribute('data-thumb-base') || '';
                    if (base) {
                      video.setAttribute('poster', base + '?ts=' + Date.now());
                    }
                  }
                  window.alert('Preview update queued.');
                } catch (err) {
                  window.alert(err && err.message ? err.message : 'Failed to update preview');
                } finally {
                  btn.textContent = original || 'New Preview';
                  btn.removeAttribute('disabled');
                }
              });
            });
          })();
        </script>
      `
    }

    const doc = renderAdminPage({ title: 'Video Library', bodyHtml: body, active: 'video_library' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin video library error', { path: req.path })
    res.status(500).send(renderAdminPage({ title: 'Video Library', bodyHtml: `<div class=\"error\">${escapeHtml(String(err?.message || err))}</div>`, active: 'video_library' }))
  }
})

pagesRouter.get('/admin/review', async (req: any, res: any) => {
  try {
    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, name, slug
         FROM spaces
        WHERE slug IN ('global', 'global-feed')
        ORDER BY slug = 'global' DESC
        LIMIT 1`
    )
    const global = (rows as any[])[0] || null

    let body = '<h1>Review</h1>'
    body += '<div class="toolbar"><div><span class="pill">Review</span></div><div></div></div>'
    body += '<div class="section">'
    body += '<div class="section-title">Queues</div>'
    body += '<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px">'
    body += `<div class="section" style="margin:0"><div class="section-title">Global Feed</div>`
    if (global) {
      body += `<div style="opacity:.85; margin-bottom:10px">${escapeHtml(String(global.name || 'Global Feed'))}</div>`
      body += `<a class="btn" href="/admin/review/global">Open Queue</a>`
    } else {
      body += `<div class="error">No global feed space found (slug global/global-feed).</div>`
    }
    body += `</div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Personal Spaces</div><div style="opacity:.85; margin-bottom:10px">Coming next (Plan 16 Step 7)</div><a class="btn" href="/admin/review/personal">Open List</a></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Groups</div><div style="opacity:.85; margin-bottom:10px">Coming next (Plan 16 Step 8)</div><a class="btn" href="/admin/review/groups">Open List</a></div>`
    body += `<div class="section" style="margin:0"><div class="section-title">Channels</div><div style="opacity:.85; margin-bottom:10px">Coming next (Plan 16 Step 8)</div><a class="btn" href="/admin/review/channels">Open List</a></div>`
    body += '</div></div>'

    const doc = renderAdminPage({ title: 'Review', bodyHtml: body, active: 'review' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin review landing failed', { path: req.path })
    res.status(500).send('Failed to load review')
  }
})

pagesRouter.get('/admin/review/global', async (req: any, res: any) => {
  try {
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, name, slug
         FROM spaces
        WHERE slug IN ('global', 'global-feed')
        ORDER BY slug = 'global' DESC
        LIMIT 1`
    )
    const global = (rows as any[])[0] || null
    if (!global) {
      const doc = renderAdminPage({
        title: 'Review • Global Feed',
        bodyHtml: '<h1>Global Feed</h1><div class="error">No global feed space found (slug global/global-feed).</div>',
      })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(404).send(doc)
    }

    const userId = Number(req.user!.id)
    const data = await spacesSvc.moderationQueue(Number(global.id), userId)
    const items = Array.isArray((data as any)?.items) ? (data as any).items : []

    let body = '<h1>Global Feed</h1>'
    body += '<div class="toolbar"><div><span class="pill">Review Queue</span></div><div><a href="/admin/review">All queues</a></div></div>'
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`

    body += `<div class="section"><div class="section-title">Space</div><div>${escapeHtml(String(global.name || global.slug || 'Global Feed'))} <span style="opacity:.7">#${escapeHtml(String(global.id))}</span></div></div>`

    if (!items.length) {
      body += '<p>No pending videos.</p>'
    } else {
      body += `<div class="section"><div class="section-title">Pending</div>`
      body += `<div style="display:grid; gap: 12px">`
      for (const row of items as any[]) {
        const pub = row.publication || {}
        const upload = row.upload || {}
        const owner = row.owner || null
        const requester = row.requester || null
        const production = row.production || {}

        const pubId = Number(pub.id)
        const uploadId = Number(upload.id)
        const title = production && production.name ? String(production.name) : upload && upload.modified_filename ? String(upload.modified_filename) : upload && upload.original_filename ? String(upload.original_filename) : `Upload #${uploadId}`
        const createdAt = pub.created_at ? String(pub.created_at) : ''

        body += `<div class="section" style="margin:0">`
        body += `<div style="display:flex; justify-content:space-between; gap: 10px; flex-wrap:wrap">`
        body += `<div><div style="font-weight:650">${escapeHtml(title)}</div><div style="opacity:.8; font-size:.92rem">Publication #${escapeHtml(String(pubId))}${createdAt ? ` • ${escapeHtml(createdAt)}` : ''}</div></div>`
        body += `<div style="display:flex; gap: 10px; align-items:center; flex-wrap:wrap">`
        if (Number.isFinite(uploadId) && uploadId > 0) {
          body += `<a class="btn" href="/videos?id=${encodeURIComponent(String(uploadId))}">Preview</a>`
          body += `<a class="btn" href="/mobile?id=${encodeURIComponent(String(uploadId))}">Mobile</a>`
        }
        body += `</div></div>`

        const ownerTxt = owner && (owner.email || owner.displayName) ? `${owner.displayName ? escapeHtml(String(owner.displayName)) : ''}${owner.email ? ` <span style="opacity:.8">(${escapeHtml(String(owner.email))})</span>` : ''}` : '<span style="opacity:.7">Unknown</span>'
        const reqTxt = requester && (requester.email || requester.displayName) ? `${requester.displayName ? escapeHtml(String(requester.displayName)) : ''}${requester.email ? ` <span style="opacity:.8">(${escapeHtml(String(requester.email))})</span>` : ''}` : '<span style="opacity:.7">—</span>'
        body += `<div style="margin-top:10px; display:grid; gap:6px">`
        body += `<div><span style="opacity:.8">Owner:</span> ${ownerTxt}</div>`
        body += `<div><span style="opacity:.8">Requested by:</span> ${reqTxt}</div>`
        body += `</div>`

        body += `<form method="POST" action="/admin/review/publications/${encodeURIComponent(String(pubId))}/approve" style="margin-top:12px">`
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<input type="hidden" name="returnTo" value="${escapeHtml('/admin/review/global')}" />`
        body += `<label>Note (optional)<textarea name="note" rows="2" placeholder="Optional note for the action"></textarea></label>`
        body += `<div class="actions"><button type="submit">Approve</button></div>`
        body += `</form>`

        body += `<form method="POST" action="/admin/review/publications/${encodeURIComponent(String(pubId))}/reject" style="margin-top:10px">`
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<input type="hidden" name="returnTo" value="${escapeHtml('/admin/review/global')}" />`
        body += `<label>Note (optional)<textarea name="note" rows="2" placeholder="Optional note for the action"></textarea></label>`
        body += `<div class="actions"><button class="danger" type="submit">Reject</button></div>`
        body += `</form>`

        body += `</div>`
      }
      body += `</div></div>`
    }

    const doc = renderAdminPage({ title: 'Review • Global Feed', bodyHtml: body, active: 'review' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin review global failed', { path: req.path })
    const status = err?.status || 500
    if (status === 403) return res.status(403).send('Forbidden')
    res.status(500).send('Failed to load global review queue')
  }
})

function getAdminReviewReturnTo(raw: any): string {
  const val = raw != null ? String(raw) : ''
  if (!val) return '/admin/review'
  if (!val.startsWith('/admin/review')) return '/admin/review'
  return val
}

pagesRouter.get('/admin/review/personal', async (req: any, res: any) => {
  try {
    const q = req.query && (req.query as any).q != null ? String((req.query as any).q).trim() : ''
    const limitRaw = req.query && (req.query as any).limit != null ? Number((req.query as any).limit) : 50
    const offsetRaw = req.query && (req.query as any).offset != null ? Number((req.query as any).offset) : 0
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0

    const db = getPool()
    const where: string[] = [`s.type = 'personal'`]
    const params: any[] = []
    if (q) {
      where.push(`(s.name LIKE ? OR s.slug LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?)`)
      const like = `%${q}%`
      params.push(like, like, like, like)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await db.query(
      `SELECT s.id, s.name, s.slug, s.owner_user_id,
              u.email AS owner_email, u.display_name AS owner_display_name,
              COALESCE(cnt.pending, 0) AS pending
         FROM spaces s
         LEFT JOIN users u ON u.id = s.owner_user_id
         LEFT JOIN (
           SELECT space_id, COUNT(*) AS pending
             FROM space_publications
            WHERE status = 'pending'
            GROUP BY space_id
         ) cnt ON cnt.space_id = s.id
        ${whereSql}
        ORDER BY pending DESC, s.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )

    const baseQuery = (next: { q?: string; limit?: number; offset?: number }) => {
      const qq = next.q != null ? String(next.q) : q
      const lim = next.limit != null ? Number(next.limit) : limit
      const off = next.offset != null ? Number(next.offset) : offset
      const parts: string[] = []
      if (qq) parts.push(`q=${encodeURIComponent(qq)}`)
      if (lim !== 50) parts.push(`limit=${encodeURIComponent(String(lim))}`)
      if (off) parts.push(`offset=${encodeURIComponent(String(off))}`)
      return parts.length ? `?${parts.join('&')}` : ''
    }

    let body = '<h1>Personal Spaces</h1>'
    body += '<div class="toolbar"><div><span class="pill">Review List</span></div><div><a href="/admin/review">All queues</a></div></div>'
    body += `<form method="GET" action="/admin/review/personal" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end">`
    body += `<label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px">`
    body += `<span style="font-size:12px; opacity:.85">Search</span>`
    body += `<input name="q" value="${escapeHtml(q)}" placeholder="Space name, slug, or owner email" />`
    body += `</label>`
    body += `<input type="hidden" name="limit" value="${escapeHtml(String(limit))}" />`
    body += `<button type="submit">Search</button>`
    body += `</div>`
    body += `</form>`

    const items = rows as any[]
    if (!items.length) {
      body += '<p>No personal spaces found.</p>'
    } else {
      body += '<table><thead><tr><th>Space</th><th>Owner</th><th>Pending</th></tr></thead><tbody>'
      for (const row of items) {
        const id = Number(row.id)
        const href = `/admin/review/personal/${encodeURIComponent(String(id))}`
        const name = escapeHtml(String(row.name || row.slug || 'Personal'))
        const slug = escapeHtml(String(row.slug || ''))
        const pending = escapeHtml(String(Number(row.pending || 0)))
        const ownerName = row.owner_display_name ? escapeHtml(String(row.owner_display_name)) : ''
        const ownerEmail = row.owner_email ? escapeHtml(String(row.owner_email)) : ''
        const ownerTxt = ownerEmail ? `${ownerName ? ownerName + ' ' : ''}<span style="opacity:.8">(${ownerEmail})</span>` : (ownerName || '<span style="opacity:.7">Unknown</span>')
        body += `<tr><td><a href="${href}">${name}</a><div style="opacity:.7; font-size:.9rem">${slug} <span style="opacity:.7">#${escapeHtml(String(id))}</span></div></td><td>${ownerTxt}</td><td>${pending}</td></tr>`
      }
      body += '</tbody></table>'
    }

    const prevOffset = Math.max(0, offset - limit)
    const nextOffset = offset + limit
    const hasPrev = offset > 0
    const hasNext = items.length === limit
    if (hasPrev || hasNext) {
      body += '<div class="pager">'
      if (hasPrev) body += `<a href="/admin/review/personal${baseQuery({ offset: prevOffset })}">← Prev</a>`
      if (hasNext) body += `<a href="/admin/review/personal${baseQuery({ offset: nextOffset })}">Next →</a>`
      body += '</div>'
    }

    const doc = renderAdminPage({ title: 'Review • Personal', bodyHtml: body, active: 'review' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin review personal list failed', { path: req.path })
    res.status(500).send('Failed to load personal spaces')
  }
})

pagesRouter.get('/admin/review/personal/:spaceId', async (req: any, res: any) => {
  try {
    const spaceId = Number(req.params.spaceId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(404).send('Space not found')
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const db = getPool()
    const [rows] = await db.query(
      `SELECT s.id, s.name, s.slug, s.type, s.owner_user_id,
              u.email AS owner_email, u.display_name AS owner_display_name
         FROM spaces s
         LEFT JOIN users u ON u.id = s.owner_user_id
        WHERE s.id = ? AND s.type = 'personal'
        LIMIT 1`,
      [spaceId]
    )
    const sp = (rows as any[])[0] || null
    if (!sp) return res.status(404).send('Space not found')

    const userId = Number(req.user!.id)
    const data = await spacesSvc.moderationQueue(spaceId, userId)
    const items = Array.isArray((data as any)?.items) ? (data as any).items : []

    const ownerEmail = sp.owner_email ? String(sp.owner_email) : ''
    const ownerName = sp.owner_display_name ? String(sp.owner_display_name) : ''
    const ownerTxt = ownerEmail ? `${ownerName ? escapeHtml(ownerName) + ' ' : ''}<span style="opacity:.8">(${escapeHtml(ownerEmail)})</span>` : (ownerName ? escapeHtml(ownerName) : '<span style="opacity:.7">Unknown</span>')

    let body = `<h1>${escapeHtml(String(sp.name || sp.slug || 'Personal Space'))}</h1>`
    body += '<div class="toolbar"><div><span class="pill">Review Queue</span></div><div><a href="/admin/review/personal">Back to personal spaces</a></div></div>'
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += `<div class="section"><div class="section-title">Space</div><div>${escapeHtml(String(sp.name || sp.slug || 'Personal'))} <span style="opacity:.7">#${escapeHtml(String(sp.id))}</span></div><div style="margin-top:6px"><span style="opacity:.8">Owner:</span> ${ownerTxt}</div></div>`

    if (!items.length) {
      body += '<p>No pending videos.</p>'
    } else {
      body += `<div class="section"><div class="section-title">Pending</div>`
      body += `<div style="display:grid; gap: 12px">`
      for (const row of items as any[]) {
        const pub = row.publication || {}
        const upload = row.upload || {}
        const owner = row.owner || null
        const requester = row.requester || null
        const production = row.production || {}

        const pubId = Number(pub.id)
        const uploadId = Number(upload.id)
        const title = production && production.name ? String(production.name) : upload && upload.modified_filename ? String(upload.modified_filename) : upload && upload.original_filename ? String(upload.original_filename) : `Upload #${uploadId}`
        const createdAt = pub.created_at ? String(pub.created_at) : ''

        body += `<div class="section" style="margin:0">`
        body += `<div style="display:flex; justify-content:space-between; gap: 10px; flex-wrap:wrap">`
        body += `<div><div style="font-weight:650">${escapeHtml(title)}</div><div style="opacity:.8; font-size:.92rem">Publication #${escapeHtml(String(pubId))}${createdAt ? ` • ${escapeHtml(createdAt)}` : ''}</div></div>`
        body += `<div style="display:flex; gap: 10px; align-items:center; flex-wrap:wrap">`
        if (Number.isFinite(uploadId) && uploadId > 0) {
          body += `<a class="btn" href="/videos?id=${encodeURIComponent(String(uploadId))}">Preview</a>`
          body += `<a class="btn" href="/mobile?id=${encodeURIComponent(String(uploadId))}">Mobile</a>`
        }
        body += `</div></div>`

        const ownerTxt2 = owner && (owner.email || owner.displayName) ? `${owner.displayName ? escapeHtml(String(owner.displayName)) : ''}${owner.email ? ` <span style="opacity:.8">(${escapeHtml(String(owner.email))})</span>` : ''}` : '<span style="opacity:.7">Unknown</span>'
        const reqTxt = requester && (requester.email || requester.displayName) ? `${requester.displayName ? escapeHtml(String(requester.displayName)) : ''}${requester.email ? ` <span style="opacity:.8">(${escapeHtml(String(requester.email))})</span>` : ''}` : '<span style="opacity:.7">—</span>'
        body += `<div style="margin-top:10px; display:grid; gap:6px">`
        body += `<div><span style="opacity:.8">Owner:</span> ${ownerTxt2}</div>`
        body += `<div><span style="opacity:.8">Requested by:</span> ${reqTxt}</div>`
        body += `</div>`

        const returnTo = `/admin/review/personal/${encodeURIComponent(String(spaceId))}`
        body += `<form method="POST" action="/admin/review/publications/${encodeURIComponent(String(pubId))}/approve" style="margin-top:12px">`
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />`
        body += `<label>Note (optional)<textarea name="note" rows="2" placeholder="Optional note for the action"></textarea></label>`
        body += `<div class="actions"><button type="submit">Approve</button></div>`
        body += `</form>`

        body += `<form method="POST" action="/admin/review/publications/${encodeURIComponent(String(pubId))}/reject" style="margin-top:10px">`
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />`
        body += `<label>Note (optional)<textarea name="note" rows="2" placeholder="Optional note for the action"></textarea></label>`
        body += `<div class="actions"><button class="danger" type="submit">Reject</button></div>`
        body += `</form>`

        body += `</div>`
      }
      body += `</div></div>`
    }

    const doc = renderAdminPage({ title: 'Review • Personal Space', bodyHtml: body, active: 'review' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin review personal queue failed', { path: req.path })
    const status = err?.status || 500
    if (status === 403) return res.status(403).send('Forbidden')
    res.status(500).send('Failed to load personal review queue')
  }
})

function getReviewSpaceLabel(space: any): string {
  if (!space) return 'Space'
  const type = String(space.type || '').toLowerCase()
  if (type === 'group') return 'Group'
  if (type === 'channel') return 'Channel'
  if (type === 'personal') return 'Personal Space'
  return 'Space'
}

async function renderAdminReviewSpaceQueuePage(opts: {
  req: any;
  res: any;
  spaceId: number;
  titlePrefix: string;
  backHref: string;
  returnTo: string;
}): Promise<void> {
  const { req, res, spaceId, titlePrefix, backHref, returnTo } = opts
  const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
  const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''

  const db = getPool()
  const [rows] = await db.query(`SELECT id, name, slug, type FROM spaces WHERE id = ? LIMIT 1`, [spaceId])
  const sp = (rows as any[])[0] || null
  if (!sp) return res.status(404).send('Space not found')

  const userId = Number(req.user!.id)
  const data = await spacesSvc.moderationQueue(spaceId, userId)
  const items = Array.isArray((data as any)?.items) ? (data as any).items : []

  const label = getReviewSpaceLabel(sp)
  const display = escapeHtml(String(sp.name || sp.slug || label))

  let body = `<h1>${display}</h1>`
  body += `<div class="toolbar"><div><span class="pill">Review Queue</span></div><div><a href="${escapeHtml(backHref)}">Back</a></div></div>`
  if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`
  body += `<div class="section"><div class="section-title">${escapeHtml(label)}</div><div>${display} <span style="opacity:.7">#${escapeHtml(String(sp.id))}</span></div></div>`

  if (!items.length) {
    body += '<p>No pending videos.</p>'
  } else {
    body += `<div class="section"><div class="section-title">Pending</div>`
    body += `<div style="display:grid; gap: 12px">`
    for (const row of items as any[]) {
      const pub = row.publication || {}
      const upload = row.upload || {}
      const owner = row.owner || null
      const requester = row.requester || null
      const production = row.production || {}

      const pubId = Number(pub.id)
      const uploadId = Number(upload.id)
      const title = production && production.name ? String(production.name) : upload && upload.modified_filename ? String(upload.modified_filename) : upload && upload.original_filename ? String(upload.original_filename) : `Upload #${uploadId}`
      const createdAt = pub.created_at ? String(pub.created_at) : ''

      body += `<div class="section" style="margin:0">`
      body += `<div style="display:flex; justify-content:space-between; gap: 10px; flex-wrap:wrap">`
      body += `<div><div style="font-weight:650">${escapeHtml(title)}</div><div style="opacity:.8; font-size:.92rem">Publication #${escapeHtml(String(pubId))}${createdAt ? ` • ${escapeHtml(createdAt)}` : ''}</div></div>`
      body += `<div style="display:flex; gap: 10px; align-items:center; flex-wrap:wrap">`
      if (Number.isFinite(uploadId) && uploadId > 0) {
        body += `<a class="btn" href="/videos?id=${encodeURIComponent(String(uploadId))}">Preview</a>`
        body += `<a class="btn" href="/mobile?id=${encodeURIComponent(String(uploadId))}">Mobile</a>`
      }
      body += `</div></div>`

      const ownerTxt = owner && (owner.email || owner.displayName) ? `${owner.displayName ? escapeHtml(String(owner.displayName)) : ''}${owner.email ? ` <span style="opacity:.8">(${escapeHtml(String(owner.email))})</span>` : ''}` : '<span style="opacity:.7">Unknown</span>'
      const reqTxt = requester && (requester.email || requester.displayName) ? `${requester.displayName ? escapeHtml(String(requester.displayName)) : ''}${requester.email ? ` <span style="opacity:.8">(${escapeHtml(String(requester.email))})</span>` : ''}` : '<span style="opacity:.7">—</span>'
      body += `<div style="margin-top:10px; display:grid; gap:6px">`
      body += `<div><span style="opacity:.8">Owner:</span> ${ownerTxt}</div>`
      body += `<div><span style="opacity:.8">Requested by:</span> ${reqTxt}</div>`
      body += `</div>`

      body += `<form method="POST" action="/admin/review/publications/${encodeURIComponent(String(pubId))}/approve" style="margin-top:12px">`
      body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
      body += `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />`
      body += `<label>Note (optional)<textarea name="note" rows="2" placeholder="Optional note for the action"></textarea></label>`
      body += `<div class="actions"><button type="submit">Approve</button></div>`
      body += `</form>`

      body += `<form method="POST" action="/admin/review/publications/${encodeURIComponent(String(pubId))}/reject" style="margin-top:10px">`
      body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
      body += `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />`
      body += `<label>Note (optional)<textarea name="note" rows="2" placeholder="Optional note for the action"></textarea></label>`
      body += `<div class="actions"><button class="danger" type="submit">Reject</button></div>`
      body += `</form>`

      body += `</div>`
    }
    body += `</div></div>`
  }

  const doc = renderAdminPage({ title: `${titlePrefix}: ${sp.name || sp.slug || label}`, bodyHtml: body, active: 'review' })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
}

pagesRouter.get('/admin/review/groups', async (req: any, res: any) => {
  try {
    const q = req.query && (req.query as any).q != null ? String((req.query as any).q).trim() : ''
    const limitRaw = req.query && (req.query as any).limit != null ? Number((req.query as any).limit) : 50
    const offsetRaw = req.query && (req.query as any).offset != null ? Number((req.query as any).offset) : 0
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0

    const db = getPool()
    const where: string[] = [`s.type = 'group'`]
    const params: any[] = []
    if (q) {
      where.push(`(s.name LIKE ? OR s.slug LIKE ?)`)
      const like = `%${q}%`
      params.push(like, like)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await db.query(
      `SELECT s.id, s.name, s.slug, COALESCE(cnt.pending, 0) AS pending
         FROM spaces s
         LEFT JOIN (
           SELECT space_id, COUNT(*) AS pending
             FROM space_publications
            WHERE status = 'pending'
            GROUP BY space_id
         ) cnt ON cnt.space_id = s.id
        ${whereSql}
        ORDER BY pending DESC, s.name ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )

    const baseQuery = (next: { q?: string; limit?: number; offset?: number }) => {
      const qq = next.q != null ? String(next.q) : q
      const lim = next.limit != null ? Number(next.limit) : limit
      const off = next.offset != null ? Number(next.offset) : offset
      const parts: string[] = []
      if (qq) parts.push(`q=${encodeURIComponent(qq)}`)
      if (lim !== 50) parts.push(`limit=${encodeURIComponent(String(lim))}`)
      if (off) parts.push(`offset=${encodeURIComponent(String(off))}`)
      return parts.length ? `?${parts.join('&')}` : ''
    }

    let body = '<h1>Groups</h1>'
    body += '<div class="toolbar"><div><span class="pill">Review List</span></div><div><a href="/admin/review">All queues</a></div></div>'
    body += `<form method="GET" action="/admin/review/groups" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end">`
    body += `<label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px">`
    body += `<span style="font-size:12px; opacity:.85">Search</span>`
    body += `<input name="q" value="${escapeHtml(q)}" placeholder="Group name or slug" />`
    body += `</label>`
    body += `<input type="hidden" name="limit" value="${escapeHtml(String(limit))}" />`
    body += `<button type="submit">Search</button>`
    body += `</div>`
    body += `</form>`

    const items = rows as any[]
    if (!items.length) {
      body += '<p>No groups found.</p>'
    } else {
      body += '<table><thead><tr><th>Group</th><th>Pending</th></tr></thead><tbody>'
      for (const row of items) {
        const id = Number(row.id)
        const href = `/admin/review/groups/${encodeURIComponent(String(id))}`
        const name = escapeHtml(String(row.name || row.slug || 'Group'))
        const slug = escapeHtml(String(row.slug || ''))
        const pending = escapeHtml(String(Number(row.pending || 0)))
        body += `<tr><td><a href="${href}">${name}</a><div style="opacity:.7; font-size:.9rem">${slug} <span style="opacity:.7">#${escapeHtml(String(id))}</span></div></td><td>${pending}</td></tr>`
      }
      body += '</tbody></table>'
    }

    const prevOffset = Math.max(0, offset - limit)
    const nextOffset = offset + limit
    const hasPrev = offset > 0
    const hasNext = items.length === limit
    if (hasPrev || hasNext) {
      body += '<div class="pager">'
      if (hasPrev) body += `<a href="/admin/review/groups${baseQuery({ offset: prevOffset })}">← Prev</a>`
      if (hasNext) body += `<a href="/admin/review/groups${baseQuery({ offset: nextOffset })}">Next →</a>`
      body += '</div>'
    }

    const doc = renderAdminPage({ title: 'Review • Groups', bodyHtml: body, active: 'review' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin review groups list failed', { path: req.path })
    res.status(500).send('Failed to load groups')
  }
})

pagesRouter.get('/admin/review/channels', async (req: any, res: any) => {
  try {
    const q = req.query && (req.query as any).q != null ? String((req.query as any).q).trim() : ''
    const limitRaw = req.query && (req.query as any).limit != null ? Number((req.query as any).limit) : 50
    const offsetRaw = req.query && (req.query as any).offset != null ? Number((req.query as any).offset) : 0
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0

    const db = getPool()
    const where: string[] = [`s.type = 'channel'`, `s.slug NOT IN ('global', 'global-feed')`]
    const params: any[] = []
    if (q) {
      where.push(`(s.name LIKE ? OR s.slug LIKE ?)`)
      const like = `%${q}%`
      params.push(like, like)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await db.query(
      `SELECT s.id, s.name, s.slug, COALESCE(cnt.pending, 0) AS pending
         FROM spaces s
         LEFT JOIN (
           SELECT space_id, COUNT(*) AS pending
             FROM space_publications
            WHERE status = 'pending'
            GROUP BY space_id
         ) cnt ON cnt.space_id = s.id
        ${whereSql}
        ORDER BY pending DESC, s.name ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )

    const baseQuery = (next: { q?: string; limit?: number; offset?: number }) => {
      const qq = next.q != null ? String(next.q) : q
      const lim = next.limit != null ? Number(next.limit) : limit
      const off = next.offset != null ? Number(next.offset) : offset
      const parts: string[] = []
      if (qq) parts.push(`q=${encodeURIComponent(qq)}`)
      if (lim !== 50) parts.push(`limit=${encodeURIComponent(String(lim))}`)
      if (off) parts.push(`offset=${encodeURIComponent(String(off))}`)
      return parts.length ? `?${parts.join('&')}` : ''
    }

    let body = '<h1>Channels</h1>'
    body += '<div class="toolbar"><div><span class="pill">Review List</span></div><div><a href="/admin/review">All queues</a></div></div>'
    body += `<form method="GET" action="/admin/review/channels" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end">`
    body += `<label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px">`
    body += `<span style="font-size:12px; opacity:.85">Search</span>`
    body += `<input name="q" value="${escapeHtml(q)}" placeholder="Channel name or slug" />`
    body += `</label>`
    body += `<input type="hidden" name="limit" value="${escapeHtml(String(limit))}" />`
    body += `<button type="submit">Search</button>`
    body += `</div>`
    body += `</form>`

    const items = rows as any[]
    if (!items.length) {
      body += '<p>No channels found.</p>'
    } else {
      body += '<table><thead><tr><th>Channel</th><th>Pending</th></tr></thead><tbody>'
      for (const row of items) {
        const id = Number(row.id)
        const href = `/admin/review/channels/${encodeURIComponent(String(id))}`
        const name = escapeHtml(String(row.name || row.slug || 'Channel'))
        const slug = escapeHtml(String(row.slug || ''))
        const pending = escapeHtml(String(Number(row.pending || 0)))
        body += `<tr><td><a href="${href}">${name}</a><div style="opacity:.7; font-size:.9rem">${slug} <span style="opacity:.7">#${escapeHtml(String(id))}</span></div></td><td>${pending}</td></tr>`
      }
      body += '</tbody></table>'
    }

    const prevOffset = Math.max(0, offset - limit)
    const nextOffset = offset + limit
    const hasPrev = offset > 0
    const hasNext = items.length === limit
    if (hasPrev || hasNext) {
      body += '<div class="pager">'
      if (hasPrev) body += `<a href="/admin/review/channels${baseQuery({ offset: prevOffset })}">← Prev</a>`
      if (hasNext) body += `<a href="/admin/review/channels${baseQuery({ offset: nextOffset })}">Next →</a>`
      body += '</div>'
    }

    const doc = renderAdminPage({ title: 'Review • Channels', bodyHtml: body, active: 'review' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin review channels list failed', { path: req.path })
    res.status(500).send('Failed to load channels')
  }
})

pagesRouter.get('/admin/review/groups/:spaceId', async (req: any, res: any) => {
  try {
    const spaceId = Number(req.params.spaceId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(404).send('Space not found')
    await renderAdminReviewSpaceQueuePage({
      req,
      res,
      spaceId,
      titlePrefix: 'Review • Group',
      backHref: '/admin/review/groups',
      returnTo: `/admin/review/groups/${encodeURIComponent(String(spaceId))}`,
    })
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin review group queue failed', { path: req.path })
    const status = err?.status || 500
    if (status === 403) return res.status(403).send('Forbidden')
    res.status(500).send('Failed to load group review queue')
  }
})

pagesRouter.get('/admin/review/channels/:spaceId', async (req: any, res: any) => {
  try {
    const spaceId = Number(req.params.spaceId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(404).send('Space not found')
    await renderAdminReviewSpaceQueuePage({
      req,
      res,
      spaceId,
      titlePrefix: 'Review • Channel',
      backHref: '/admin/review/channels',
      returnTo: `/admin/review/channels/${encodeURIComponent(String(spaceId))}`,
    })
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin review channel queue failed', { path: req.path })
    const status = err?.status || 500
    if (status === 403) return res.status(403).send('Forbidden')
    res.status(500).send('Failed to load channel review queue')
  }
})

pagesRouter.post('/admin/review/publications/:id/approve', async (req: any, res: any) => {
  const publicationId = Number(req.params.id)
  if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).send('Bad publication id')
  try {
    const userId = Number(req.user!.id)
    const note = (req.body && (req.body as any).note != null) ? String((req.body as any).note) : ''
    const updated = await pubsSvc.approve(publicationId, { userId })
    if (note && note.trim()) {
      try { await pubsSvc.recordNoteEvent(publicationId, userId, 'approve_publication', note) } catch {}
    }
    const to = getAdminReviewReturnTo(req.body && (req.body as any).returnTo)
    res.redirect(`${to}?notice=${encodeURIComponent(`Approved #${updated.id}.`)}`)
  } catch (err: any) {
    const to = getAdminReviewReturnTo(req.body && (req.body as any).returnTo)
    const status = err?.status || 500
    const msg = status === 403 ? 'Forbidden.' : 'Failed to approve.'
    res.redirect(`${to}?error=${encodeURIComponent(msg)}`)
  }
})

pagesRouter.post('/admin/review/publications/:id/reject', async (req: any, res: any) => {
  const publicationId = Number(req.params.id)
  if (!Number.isFinite(publicationId) || publicationId <= 0) return res.status(400).send('Bad publication id')
  try {
    const userId = Number(req.user!.id)
    const note = (req.body && (req.body as any).note != null) ? String((req.body as any).note) : ''
    const updated = await pubsSvc.reject(publicationId, { userId })
    if (note && note.trim()) {
      try { await pubsSvc.recordNoteEvent(publicationId, userId, 'reject_publication', note) } catch {}
    }
    const to = getAdminReviewReturnTo(req.body && (req.body as any).returnTo)
    res.redirect(`${to}?notice=${encodeURIComponent(`Rejected #${updated.id}.`)}`)
  } catch (err: any) {
    const to = getAdminReviewReturnTo(req.body && (req.body as any).returnTo)
    const status = err?.status || 500
    const msg = status === 403 ? 'Forbidden.' : 'Failed to reject.'
    res.redirect(`${to}?error=${encodeURIComponent(msg)}`)
  }
})

pagesRouter.get('/admin/users', async (req: any, res: any) => {
  try {
    const q = req.query && ((req.query as any).q != null ? String((req.query as any).q) : (req.query as any).search != null ? String((req.query as any).search) : '').trim()
    const includeDeleted = req.query && (String((req.query as any).includeDeleted || '') === '1' || String((req.query as any).includeDeleted || '') === 'true')
    const limitRaw = req.query && (req.query as any).limit != null ? Number((req.query as any).limit) : 50
    const offsetRaw = req.query && (req.query as any).offset != null ? Number((req.query as any).offset) : 0
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0

    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''

    const result = await adminSvc.listUsers({ search: q || undefined, includeDeleted, limit, offset })

    const ids = result.users.map((u: any) => Number(u.id)).filter((n: number) => Number.isFinite(n) && n > 0)
    const rolesByUser = new Map<number, string[]>()
    if (ids.length) {
      const db = getPool()
      const placeholders = ids.map(() => '?').join(',')
      const [rows] = await db.query(
        `SELECT ur.user_id, r.name
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id IN (${placeholders})
            AND (r.scope = 'site' OR r.name LIKE 'site\\_%')
          ORDER BY ur.user_id, r.name`,
        ids
      )
      for (const row of rows as any[]) {
        const uid = Number(row.user_id)
        if (!Number.isFinite(uid) || uid <= 0) continue
        const name = String(row.name || '')
        if (!rolesByUser.has(uid)) rolesByUser.set(uid, [])
        rolesByUser.get(uid)!.push(name)
      }
    }

    const baseQuery = (next: { q?: string; includeDeleted?: boolean; limit?: number; offset?: number }) => {
      const params: string[] = []
      const qq = next.q != null ? String(next.q) : q
      const inc = next.includeDeleted != null ? Boolean(next.includeDeleted) : includeDeleted
      const lim = next.limit != null ? Number(next.limit) : limit
      const off = next.offset != null ? Number(next.offset) : offset
      if (qq) params.push(`q=${encodeURIComponent(qq)}`)
      if (inc) params.push(`includeDeleted=1`)
      if (lim !== 50) params.push(`limit=${encodeURIComponent(String(lim))}`)
      if (off) params.push(`offset=${encodeURIComponent(String(off))}`)
      return params.length ? `?${params.join('&')}` : ''
    }

    let body = '<h1>Users</h1>'
    body += '<div class="toolbar">'
    body += '<div><span class="pill">Users</span></div>'
    body += '<div><a href="/admin/users/new">New user</a></div>'
    body += '</div>'

    body += `<form method="GET" action="/admin/users" class="section" style="margin:12px 0">`
    body += `<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end">`
    body += `<label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px">`
      body += `<span style="font-size:12px; opacity:.85">Search</span>`
    body += `<input name="q" value="${escapeHtml(q)}" placeholder="Email or display name" />`
    body += `</label>`
    body += `<label style="display:flex; gap:8px; align-items:center; padding:6px 0">`
    body += `<input type="checkbox" name="includeDeleted" value="1" ${includeDeleted ? 'checked' : ''} />`
    body += `<span>Include deleted</span>`
    body += `</label>`
    body += `<input type="hidden" name="limit" value="${escapeHtml(String(limit))}" />`
    body += `<button type="submit">Search</button>`
    body += `</div>`
    body += `</form>`

    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`

    if (!result.users.length) {
      body += '<p>No users found.</p>'
    } else {
      body += '<table><thead><tr><th>ID</th><th>Email</th><th>Display Name</th><th>Site Roles</th><th>Created</th><th>Deleted</th></tr></thead><tbody>'
      for (const u of result.users as any[]) {
        const id = Number(u.id)
        const href = `/admin/users/${encodeURIComponent(String(id))}`
        const email = escapeHtml(String(u.email || ''))
        const name = escapeHtml(String(u.displayName || ''))
        const created = u.createdAt ? escapeHtml(String(u.createdAt)) : ''
        const deleted = u.deletedAt ? escapeHtml(String(u.deletedAt)) : ''

        const roles = rolesByUser.get(id) || []
        const shown = roles.filter((r) => r && r !== 'site_member')
        const rolesText = shown.length ? escapeHtml(shown.join(', ')) : ''
        body += `<tr><td>${escapeHtml(String(id))}</td><td><a href="${href}">${email}</a></td><td>${name}</td><td>${rolesText}</td><td>${created}</td><td>${deleted}</td></tr>`
      }
      body += '</tbody></table>'
    }

    const prevOffset = Math.max(0, offset - limit)
    const nextOffset = offset + limit
    const hasPrev = offset > 0
    const hasNext = result.users.length === limit
    if (hasPrev || hasNext) {
      body += '<div class="pager">'
      if (hasPrev) body += `<a href="/admin/users${baseQuery({ offset: prevOffset })}">← Prev</a>`
      if (hasNext) body += `<a href="/admin/users${baseQuery({ offset: nextOffset })}">Next →</a>`
      body += '</div>'
    }

    const doc = renderAdminPage({ title: 'Users', bodyHtml: body, active: 'users' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin users list failed', { path: req.path })
    res.status(500).send('Failed to load users')
  }
});
// SPA Admin (beta) — users list and (later) detail
pagesRouter.get('/adminx/users', (_req, res) => {
  res.redirect('/admin/users')
});
pagesRouter.get('/adminx/users/:id', (_req, res) => {
  res.redirect(`/admin/users/${encodeURIComponent(String(_req.params.id || ''))}`)
});
pagesRouter.get('/adminx/settings', (_req, res) => {
  res.redirect('/admin/settings')
});
pagesRouter.get('/admin/users/new', (_req, res) => {
  const body = [
    '<h1>New User</h1>',
    '<div class="section">',
    '<div class="section-title">Coming Soon</div>',
    '<p>User creation will move here once we migrate the admin UI fully off the SPA bundle.</p>',
    '<div class="actions"><a class="btn" href="/admin/users">Back to Users</a></div>',
    '</div>',
  ].join('')
  const doc = renderAdminPage({ title: 'New User', bodyHtml: body, active: 'users' })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
});
pagesRouter.get('/admin/users/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('User not found')

    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''

    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const user = await adminSvc.getUserDetail(id)
    const siteRolesResp = await adminSvc.getUserSiteRoles(id).catch(() => ({ roles: [] as string[] }))
    const rolesCatalogResp = await adminSvc.listRoles().catch(() => ({ roles: [] as any[] }))

    const roleCatalog = Array.isArray((rolesCatalogResp as any)?.roles) ? (rolesCatalogResp as any).roles as Array<{ name: string; scope: string | null }> : []
    const siteRoleNames = Array.from(
      new Set(
        roleCatalog
          .filter((r) => {
            const name = String((r as any).name || '')
            const scope = String((r as any).scope || '').toLowerCase()
            return scope === 'site' || /^site_/i.test(name)
          })
          .map((r) => String((r as any).name || '').trim())
          .filter((n) => n.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b))

    const currentSiteRoles: string[] = Array.isArray((siteRolesResp as any)?.roles) ? (siteRolesResp as any).roles.map((r: any) => String(r)) : []
    const currentSiteRoleSet = new Set(currentSiteRoles)
    const baselineSiteRole = 'site_member'

    const db = getPool()
    const [modRows] = await db.query(`SELECT require_review_global, credibility_score FROM users WHERE id = ? LIMIT 1`, [id])
    const mod = (modRows as any[])[0]
    if (!mod) return res.status(404).send('User not found')
    const [sRows] = await db.query(
      `SELECT id, target_type, target_id, kind, degree, starts_at, ends_at, reason, created_by, created_at
         FROM suspensions
        WHERE user_id = ? AND (ends_at IS NULL OR ends_at >= NOW())
        ORDER BY created_at DESC`,
      [id]
    )
    const activeSuspensions = (sRows as any[]).map((r) => ({
      id: Number(r.id),
      targetType: String(r.target_type || ''),
      targetId: r.target_id != null ? Number(r.target_id) : null,
      kind: String(r.kind || ''),
      degree: Number(r.degree || 1),
      endsAt: r.ends_at ? String(r.ends_at) : null,
      reason: r.reason ? String(r.reason) : null,
    }))

    const [spaceRoleRows] = await db.query(
      `SELECT s.id AS space_id, s.type, s.name, s.slug, r.name AS role_name
         FROM user_space_roles usr
         JOIN roles r ON r.id = usr.role_id
         JOIN spaces s ON s.id = usr.space_id
        WHERE usr.user_id = ?
        ORDER BY s.type, s.name, r.name`,
      [id]
    )
    const spaceMap: Record<number, { id: number; type: string; name: string; slug: string; roles: string[] }> = {}
    const normalizeSpaceRole = (n: string): string | null => {
      const name = String(n || '').toLowerCase()
      if (name === 'group_admin' || name === 'channel_admin' || name === 'space_admin') return 'space_admin'
      if (name === 'group_member' || name === 'channel_member' || name === 'member' || name === 'viewer' || name === 'subscriber' || name === 'uploader' || name === 'space_member') return 'space_member'
      if (name === 'publisher' || name === 'contributor' || name === 'space_poster') return 'space_poster'
      if (name === 'space_moderator' || name === 'moderator') return 'space_moderator'
      if (name === 'space_subscriber') return 'space_subscriber'
      return null
    }
    for (const row of spaceRoleRows as any[]) {
      const sid = Number(row.space_id)
      if (!Number.isFinite(sid) || sid <= 0) continue
      if (!spaceMap[sid]) spaceMap[sid] = { id: sid, type: String(row.type || ''), name: String(row.name || ''), slug: String(row.slug || ''), roles: [] }
      const norm = normalizeSpaceRole(String(row.role_name || ''))
      if (norm) spaceMap[sid].roles.push(norm)
    }
    const spaceRoleOrder = ['space_admin', 'space_moderator', 'space_member', 'space_poster', 'space_subscriber']
    for (const sid of Object.keys(spaceMap)) {
      const set = new Set(spaceMap[Number(sid)].roles)
      spaceMap[Number(sid)].roles = spaceRoleOrder.filter((r) => set.has(r))
    }
    const userSpaces = Object.values(spaceMap).sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name))

    const isChecked = (set: Set<string>, name: string) => (set.has(name) ? 'checked' : '')

    let body = `<h1>User #${escapeHtml(String(user.id))}</h1>`
    body += '<div class="toolbar"><div><span class="pill">User</span></div><div><a href="/admin/users">Back to users</a></div></div>'
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`

    body += `<div class="section"><div class="section-title">Profile</div>`
    body += `<form method="POST" action="/admin/users/${encodeURIComponent(String(id))}/profile">`
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<label>Email<input type="text" name="email" value="${escapeHtml(String(user.email || ''))}" /></label>`
    body += `<label>Display Name<input type="text" name="displayName" value="${escapeHtml(String(user.displayName || ''))}" /></label>`
    body += `<label>Password (optional)<input type="password" name="password" value="" placeholder="Leave blank to keep" /></label>`
    body += `<div class="actions"><button type="submit">Save Profile</button></div>`
    body += `</form></div>`

    body += `<div class="section"><div class="section-title">Site Roles</div>`
    body += `<form method="POST" action="/admin/users/${encodeURIComponent(String(id))}/site-roles">`
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<div style="margin: 6px 0 10px"><label style="display:flex; gap:10px; align-items:center; margin: 0"><input type="checkbox" checked disabled /><span>${escapeHtml(baselineSiteRole)} (baseline)</span></label></div>`
    body += `<input type="hidden" name="roles" value="${escapeHtml(baselineSiteRole)}" />`
    const siteRoleChoices = siteRoleNames.filter((r) => r !== baselineSiteRole)
    if (!siteRoleChoices.length) {
      body += `<p>No site roles configured.</p>`
    } else {
      body += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 14px">`
      for (const r of siteRoleChoices) {
        body += `<label style="display:flex; gap:10px; align-items:center; margin: 0"><input type="checkbox" name="roles" value="${escapeHtml(r)}" ${isChecked(currentSiteRoleSet, r)} /><span>${escapeHtml(r)}</span></label>`
      }
      body += `</div>`
    }
    body += `<div class="actions"><button type="submit">Save Roles</button></div>`
    body += `</form></div>`

    const requireReviewGlobal = Boolean(Number(mod.require_review_global))
    body += `<div class="section"><div class="section-title">Review Holds</div>`
    body += `<form method="POST" action="/admin/users/${encodeURIComponent(String(id))}/moderation">`
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<label style="display:flex; gap:10px; align-items:center; margin: 0"><input type="checkbox" name="requireReviewGlobal" value="1" ${requireReviewGlobal ? 'checked' : ''} /><span>Require review globally (user’s publications require approval)</span></label>`
    body += `<div class="actions"><button type="submit">Save Holds</button></div>`
    body += `</form>`
    body += `<div style="margin-top:10px; opacity:.85; font-size: 0.92rem">Credibility score: ${escapeHtml(String(mod.credibility_score != null ? Number(mod.credibility_score) : 0))}</div>`
    body += `</div>`

    body += `<div class="section"><div class="section-title">Suspensions</div>`
    if (!activeSuspensions.length) {
      body += `<p>No active suspensions.</p>`
    } else {
      body += `<table><thead><tr><th>ID</th><th>Kind</th><th>Scope</th><th>Degree</th><th>Ends</th><th>Reason</th><th></th></tr></thead><tbody>`
      for (const s of activeSuspensions) {
        const endTxt = s.endsAt ? escapeHtml(s.endsAt) : '<em>never</em>'
        const scopeTxt = s.targetType === 'space' && s.targetId ? `space:${escapeHtml(String(s.targetId))}` : escapeHtml(s.targetType || 'site')
        body += `<tr><td>${escapeHtml(String(s.id))}</td><td>${escapeHtml(String(s.kind))}</td><td>${scopeTxt}</td><td>${escapeHtml(String(s.degree))}</td><td>${endTxt}</td><td>${escapeHtml(String(s.reason || ''))}</td><td>`
        body += `<form method="POST" action="/admin/users/${encodeURIComponent(String(id))}/suspensions/${encodeURIComponent(String(s.id))}/end" style="margin:0">`
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<button class="danger" type="submit">End</button>`
        body += `</form>`
        body += `</td></tr>`
      }
      body += `</tbody></table>`
    }
    body += `<div class="section" style="margin-top:14px"><div class="section-title">Add Suspension / Ban</div>`
    body += `<form method="POST" action="/admin/users/${encodeURIComponent(String(id))}/suspensions">`
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<label>Kind<select name="kind"><option value="posting">posting_suspension</option><option value="ban">ban</option></select></label>`
    body += `<label>Scope<select name="scope"><option value="site">site</option><option value="space">space</option></select></label>`
    body += `<label>Space ID (when scope=space)<input type="text" name="spaceId" value="" placeholder="e.g. 21" /></label>`
    body += `<label>Degree<select name="degree"><option value="1">1 (1 day)</option><option value="2">2 (7 days)</option><option value="3">3 (30 days)</option></select></label>`
    body += `<label style="display:flex; gap:10px; align-items:center"><input type="checkbox" name="indefinite" value="1" /> Indefinite (ban only)</label>`
    body += `<label>Reason<input type="text" name="reason" value="" placeholder="(optional)" /></label>`
    body += `<div class="actions"><button class="danger" type="submit">Apply</button></div>`
    body += `</form></div>`
    body += `</div>`

    body += `<div class="section"><div class="section-title">Space Roles</div>`
    body += `<div class="field-hint">Set roles for specific spaces (adds membership if needed). Roles are normalized to the app’s space roles.</div>`
    body += `<div class="section" style="margin-top:10px"><div class="section-title">Set roles for a space ID</div>`
    body += `<form method="POST" action="/admin/users/${encodeURIComponent(String(id))}/spaces/roles">`
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<label>Space ID<input type="text" name="spaceId" value="" placeholder="e.g. 21" /></label>`
    body += `<div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:10px">`
    for (const r of spaceRoleOrder) {
      body += `<label style="display:flex; gap:10px; align-items:center; margin: 0"><input type="checkbox" name="roles" value="${escapeHtml(r)}" /><span>${escapeHtml(r)}</span></label>`
    }
    body += `</div>`
    body += `<div class="actions"><button type="submit">Save Space Roles</button></div>`
    body += `</form></div>`

    if (userSpaces.length) {
      body += `<div class="section" style="margin-top:14px"><div class="section-title">Existing Space Memberships</div>`
      body += `<table><thead><tr><th>Space</th><th>Type</th><th>Roles</th></tr></thead><tbody>`
      for (const sp of userSpaces) {
        body += `<tr>`
        body += `<td>${escapeHtml(sp.name || sp.slug)} <span style="opacity:.7">#${escapeHtml(String(sp.id))}</span></td>`
        body += `<td>${escapeHtml(String(sp.type || ''))}</td>`
        body += `<td><form method="POST" action="/admin/users/${encodeURIComponent(String(id))}/spaces/${encodeURIComponent(String(sp.id))}/roles" style="margin:0">`
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
        body += `<div style="display:flex; gap:12px; flex-wrap:wrap">`
        const set = new Set(sp.roles || [])
        for (const r of spaceRoleOrder) {
          body += `<label style="display:flex; gap:10px; align-items:center; margin: 0"><input type="checkbox" name="roles" value="${escapeHtml(r)}" ${set.has(r) ? 'checked' : ''} /><span>${escapeHtml(r)}</span></label>`
        }
        body += `</div>`
        body += `<div class="actions" style="margin-top:10px"><button type="submit">Save</button></div>`
        body += `</form></td></tr>`
      }
      body += `</tbody></table></div>`
    } else {
      body += `<p>No space roles assigned yet.</p>`
    }
    body += `</div>`

    const doc = renderAdminPage({ title: `User #${user.id}`, bodyHtml: body, active: 'users' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err: any) {
    logError(req.log || pagesLogger, err, 'admin user detail failed', { path: req.path })
    const status = err?.status || 500
    if (status === 404) return res.status(404).send('User not found')
    res.status(500).send('Failed to load user')
  }
});

pagesRouter.post('/admin/users/:id/profile', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(404).send('User not found')
  try {
    const body = (req.body || {}) as any
    const email = body.email != null ? String(body.email).trim() : undefined
    const displayName = body.displayName != null ? String(body.displayName).trim() : undefined
    const password = body.password != null ? String(body.password) : undefined

    const input: any = {}
    if (email !== undefined) input.email = email
    if (displayName !== undefined) input.displayName = displayName
    if (password && password.trim()) input.password = password

    await adminSvc.updateUser(id, input)
    res.redirect(`/admin/users/${encodeURIComponent(String(id))}?notice=${encodeURIComponent('Profile saved.')}`)
  } catch (err: any) {
    const code = String(err?.code || '')
    const msg =
      code === 'invalid_email' ? 'Invalid email.' :
      code === 'weak_password' ? 'Weak password (min 8 chars).' :
      'Failed to save profile.'
    res.redirect(`/admin/users/${encodeURIComponent(String(id))}?error=${encodeURIComponent(msg)}`)
  }
})

pagesRouter.post('/admin/users/:id/site-roles', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(404).send('User not found')
  try {
    const roles = toStringList((req.body || {}).roles)
    if (!roles.includes('site_member')) roles.push('site_member')
    await adminSvc.setUserSiteRoles(id, roles)
    res.redirect(`/admin/users/${encodeURIComponent(String(id))}?notice=${encodeURIComponent('Roles saved.')}`)
  } catch (err) {
    res.redirect(`/admin/users/${encodeURIComponent(String(id))}?error=${encodeURIComponent('Failed to save roles.')}`)
  }
})

pagesRouter.post('/admin/users/:id/moderation', async (req: any, res: any) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(404).send('User not found')
  try {
    const raw = (req.body || {}) as any
    const flag = toFormBool(raw.requireReviewGlobal) ? 1 : 0
    const db = getPool()
    await db.query(`UPDATE users SET require_review_global = ? WHERE id = ?`, [flag, id])
    res.redirect(`/admin/users/${encodeURIComponent(String(id))}?notice=${encodeURIComponent('Holds saved.')}`)
  } catch {
    res.redirect(`/admin/users/${encodeURIComponent(String(id))}?error=${encodeURIComponent('Failed to save holds.')}`)
  }
})

pagesRouter.post('/admin/users/:id/suspensions', async (req: any, res: any) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId) || userId <= 0) return res.status(404).send('User not found')
  try {
    const raw = (req.body || {}) as any
    const kind = String(raw.kind || 'posting').trim().toLowerCase()
    const scope = String(raw.scope || 'site').trim().toLowerCase()
    const deg = Number(raw.degree || 1)
    const reason = raw.reason != null ? String(raw.reason).slice(0, 255) : null
    const indefinite = toFormBool(raw.indefinite)

    if (!['posting', 'ban'].includes(kind)) {
      return res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Invalid kind.')}`)
    }
    if (!['site', 'space'].includes(scope)) {
      return res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Invalid scope.')}`)
    }
    if (![1, 2, 3].includes(deg)) {
      return res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Invalid degree.')}`)
    }

    let targetId: number | null = null
    if (scope === 'space') {
      const sid = Number(raw.spaceId)
      if (!Number.isFinite(sid) || sid <= 0) {
        return res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Space ID required for space scope.')}`)
      }
      targetId = sid
    }

    const days = deg === 1 ? 1 : deg === 2 ? 7 : 30
    const ends = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const endsAt = kind === 'ban' && indefinite ? null : ends

    const db = getPool()
    const [ins] = await db.query(
      `INSERT INTO suspensions (user_id, target_type, target_id, kind, degree, starts_at, ends_at, reason, created_by)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
      [userId, scope, targetId, kind, deg, endsAt, reason, req.user ? Number(req.user.id) : null]
    )
    const suspensionId = Number((ins as any).insertId || 0)
    try {
      const actionType = kind === 'ban' ? 'suspension_ban' : 'suspension_posting'
      await db.query(
        `INSERT INTO moderation_actions (actor_user_id, target_type, target_id, action_type, reason, rule_version_id, detail)
         VALUES (?, ?, ?, ?, ?, NULL, JSON_OBJECT('suspension_id', ?, 'scope', ?, 'degree', ?, 'ends_at', ?))`,
        [
          req.user ? Number(req.user.id) : null,
          scope,
          targetId,
          actionType,
          reason,
          suspensionId || null,
          scope,
          deg,
          endsAt ? endsAt.toISOString() : null,
        ]
      )
    } catch {}
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?notice=${encodeURIComponent('Suspension saved.')}`)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin create suspension failed', { path: req.path })
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Failed to create suspension.')}`)
  }
})

pagesRouter.post('/admin/users/:id/suspensions/:sid/end', async (req: any, res: any) => {
  const userId = Number(req.params.id)
  const sid = Number(req.params.sid)
  if (!Number.isFinite(userId) || userId <= 0) return res.status(404).send('User not found')
  if (!Number.isFinite(sid) || sid <= 0) return res.status(400).send('Bad suspension id')
  try {
    const db = getPool()
    await db.query(`UPDATE suspensions SET ends_at = NOW() WHERE id = ? AND user_id = ?`, [sid, userId])
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?notice=${encodeURIComponent('Suspension ended.')}`)
  } catch {
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Failed to end suspension.')}`)
  }
})

pagesRouter.post('/admin/users/:id/spaces/roles', async (req: any, res: any) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId) || userId <= 0) return res.status(404).send('User not found')
  try {
    const body = (req.body || {}) as any
    const spaceId = Number(body.spaceId)
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      return res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Bad space id.')}`)
    }
    const roles = toStringList(body.roles).map((r) => r.toLowerCase())
    await adminSvc.setUserSpaceRoles(spaceId, userId, roles)
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?notice=${encodeURIComponent('Space roles saved.')}`)
  } catch (err: any) {
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Failed to save space roles.')}`)
  }
})

pagesRouter.post('/admin/users/:id/spaces/:spaceId/roles', async (req: any, res: any) => {
  const userId = Number(req.params.id)
  const spaceId = Number(req.params.spaceId)
  if (!Number.isFinite(userId) || userId <= 0) return res.status(404).send('User not found')
  if (!Number.isFinite(spaceId) || spaceId <= 0) return res.status(400).send('Bad space id')
  try {
    const roles = toStringList((req.body || {}).roles).map((r) => r.toLowerCase())
    await adminSvc.setUserSpaceRoles(spaceId, userId, roles)
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?notice=${encodeURIComponent('Space roles saved.')}`)
  } catch {
    res.redirect(`/admin/users/${encodeURIComponent(String(userId))}?error=${encodeURIComponent('Failed to save space roles.')}`)
  }
})

function parseJsonSettings(raw: any): any {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  const text = String(raw || '');
  if (!text.trim()) return {};
  try { return JSON.parse(text) } catch { return {} }
}

function getRequireApproval(settings: any): boolean {
  try { return Boolean(settings?.publishing?.requireApproval) } catch { return false }
}

function getCommentsPolicy(settings: any): 'on' | 'off' | 'inherit' {
  const v = String(settings?.comments || '').toLowerCase()
  if (v === 'on' || v === 'off' || v === 'inherit') return v as any
  return 'inherit'
}

function toFormBool(raw: any): boolean {
  const last = Array.isArray(raw) ? raw[raw.length - 1] : raw
  const v = String(last ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

function toIdList(raw: any): number[] {
  const items = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  const ids = items
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0)
  return Array.from(new Set(ids))
}

function toStringList(raw: any): string[] {
  const items = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  const out = items
    .map((v) => (typeof v === 'string' ? v : String(v ?? '')).trim())
    .filter((v) => v.length > 0)
  return Array.from(new Set(out))
}

function renderAdminSpaceListPage(opts: {
  kind: 'group' | 'channel';
  items: Array<{ id: number; name: string; slug: string; requireReview: boolean; cultureCount: number; owner: string | null }>;
  notice?: string | null;
  error?: string | null;
}): string {
  const kindLabel = opts.kind === 'group' ? 'Groups' : 'Channels'
  const notice = opts.notice ? String(opts.notice) : ''
  const error = opts.error ? String(opts.error) : ''

  let body = `<h1>${escapeHtml(kindLabel)}</h1>`
  body += `<div class="toolbar"><div><span class="pill">${escapeHtml(kindLabel)}</span></div><div><a href="/admin/${escapeHtml(kindLabel.toLowerCase())}/new">New ${escapeHtml(opts.kind)}</a></div></div>`
  if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`

  if (!opts.items.length) {
    body += `<p>No ${escapeHtml(opts.kind)}s exist yet.</p>`
  } else {
    body += '<table><thead><tr><th>Name</th><th>Slug</th><th>Review</th><th>Cultures</th><th>Owner</th></tr></thead><tbody>'
    for (const it of opts.items) {
      const href = `/admin/${opts.kind === 'group' ? 'groups' : 'channels'}/${encodeURIComponent(String(it.id))}`
      body += `<tr>`
      body += `<td><a href="${escapeHtml(href)}">${escapeHtml(it.name || '')}</a></td>`
      body += `<td>${escapeHtml(it.slug || '')}</td>`
      body += `<td>${it.requireReview ? 'Yes' : 'No'}</td>`
      body += `<td>${escapeHtml(String(it.cultureCount || 0))}</td>`
      body += `<td>${escapeHtml(it.owner || '—')}</td>`
      body += `</tr>`
    }
    body += '</tbody></table>'
  }

  return renderAdminPage({ title: kindLabel, bodyHtml: body, active: opts.kind === 'group' ? 'groups' : 'channels' })
}

function renderAdminSpaceCreatePage(opts: { kind: 'group' | 'channel'; csrfToken?: string | null; error?: string | null; name?: string; slug?: string }): string {
  const kindLabel = opts.kind === 'group' ? 'Group' : 'Channel'
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const error = opts.error ? String(opts.error) : ''
  const name = opts.name ? String(opts.name) : ''
  const slug = opts.slug ? String(opts.slug) : ''

  let body = `<h1>New ${escapeHtml(kindLabel)}</h1>`
  body += `<div class="toolbar"><div><a href="/admin/${opts.kind === 'group' ? 'groups' : 'channels'}">\u2190 Back to ${escapeHtml(kindLabel.toLowerCase())}s</a></div></div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`

  body += `<form method="post" action="/admin/${opts.kind === 'group' ? 'groups' : 'channels'}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(name)}" />
  </label>`
  body += `<label>Slug
    <input type="text" name="slug" value="${escapeHtml(slug)}" />
    <div class="field-hint">Lowercase, letters/numbers/dashes. Used in URLs.</div>
  </label>`
  body += `<div class="actions">
    <button type="submit">Create ${escapeHtml(kindLabel.toLowerCase())}</button>
  </div>`
  body += `</form>`

  return renderAdminPage({ title: `New ${kindLabel}`, bodyHtml: body, active: opts.kind === 'group' ? 'groups' : 'channels' })
}

function renderAdminSpaceDetailPage(opts: {
  kind: 'group' | 'channel';
  space: { id: number; name: string; slug: string; settings: any; cultureIds: number[] };
  cultures: Array<{ id: number; name: string; description: string | null; categoryCount: number }>;
  csrfToken?: string | null;
  notice?: string | null;
  error?: string | null;
  draft?: { name?: string; description?: string; commentsPolicy?: 'on' | 'off' | 'inherit'; requireReview?: boolean; cultureIds?: number[] };
}): string {
  const kindLabel = opts.kind === 'group' ? 'Group' : 'Channel'
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const notice = opts.notice ? String(opts.notice) : ''
  const error = opts.error ? String(opts.error) : ''

  const space = opts.space
  const settings = space.settings || {}

  const nameValue = opts.draft?.name != null ? String(opts.draft.name) : String(space.name || '')
  const descriptionValue =
    opts.kind === 'channel'
      ? opts.draft?.description != null
        ? String(opts.draft.description)
        : String(settings?.profile?.description || '')
      : ''
  const commentsPolicy = opts.draft?.commentsPolicy ?? getCommentsPolicy(settings)
  const requireReview = opts.draft?.requireReview ?? getRequireApproval(settings)
  const selectedCultureIds = new Set<number>((opts.draft?.cultureIds ?? space.cultureIds ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))

  let body = `<h1>${escapeHtml(kindLabel)}: ${escapeHtml(space.name || '(unnamed)')}</h1>`
  body += `<div class="toolbar"><div><a href="/admin/${opts.kind === 'group' ? 'groups' : 'channels'}">\u2190 Back to ${escapeHtml(kindLabel.toLowerCase())}s</a></div></div>`
  if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`

  body += `<div class="section">`
  body += `<div class="section-title">Identity</div>`
  body += `<div class="field-hint">ID: <strong>${escapeHtml(String(space.id))}</strong> &nbsp;•&nbsp; Slug: <strong>${escapeHtml(space.slug || '')}</strong></div>`
  body += `</div>`

  body += `<form method="post" action="/admin/${opts.kind === 'group' ? 'groups' : 'channels'}/${escapeHtml(String(space.id))}">`
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`

  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(nameValue)}" />
  </label>`

  if (opts.kind === 'channel') {
    body += `<label>Description
      <textarea name="description" rows="3" maxlength="280">${escapeHtml(descriptionValue)}</textarea>
      <div class="field-hint">Shown in the Global Feed “Jump” modal. Max 280 characters.</div>
    </label>`
  }

  body += `<div class="section" style="margin-top: 14px">`
  body += `<div class="section-title">Publishing</div>`
  body += `<input type="hidden" name="requireReview" value="0" />`
  body += `<label style="display:flex; gap:10px; align-items:center; margin-top: 6px">`
  body += `<input type="checkbox" name="requireReview" value="1"${requireReview ? ' checked' : ''} />`
  body += `<div>Require approval before appearing in this ${escapeHtml(kindLabel.toLowerCase())}'s feed</div>`
  body += `</label>`
  body += `</div>`

  body += `<div class="section" style="margin-top: 14px">`
  body += `<div class="section-title">Comments</div>`
  body += `<label>Policy
    <select name="commentsPolicy">
      <option value="inherit"${commentsPolicy === 'inherit' ? ' selected' : ''}>Inherit (default)</option>
      <option value="on"${commentsPolicy === 'on' ? ' selected' : ''}>On</option>
      <option value="off"${commentsPolicy === 'off' ? ' selected' : ''}>Off</option>
    </select>
  </label>`
  body += `</div>`

  body += `<div class="section" style="margin-top: 14px">`
  body += `<div class="section-title">Cultures</div>`
  body += `<div class="field-hint">Controls which reporting categories/rules are available for content in this space.</div>`
  if (!opts.cultures.length) {
    body += `<p>No cultures exist yet.</p>`
  } else {
    body += `<div style="margin-top: 10px">`
    for (const c of opts.cultures) {
      const cid = Number(c.id)
      const checked = selectedCultureIds.has(cid) ? ' checked' : ''
      body += `<label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px">`
      body += `<input type="checkbox" name="cultureIds" value="${escapeHtml(String(cid))}"${checked} style="margin-top: 3px" />`
      body += `<div><div>${escapeHtml(c.name)}</div>`
      if (c.description) body += `<div class="field-hint">${escapeHtml(c.description)}</div>`
      body += `</div></label>`
    }
    body += `</div>`
  }
  body += `</div>`

  body += `<div class="actions">
    <button type="submit">Save</button>
  </div>`
  body += `</form>`

  return renderAdminPage({ title: `${kindLabel}: ${space.name || 'Space'}`, bodyHtml: body, active: opts.kind === 'group' ? 'groups' : 'channels' })
}

async function listSpacesForAdmin(kind: 'group' | 'channel'): Promise<Array<{ id: number; name: string; slug: string; requireReview: boolean; cultureCount: number; owner: string | null }>> {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT s.id,
            s.name,
            s.slug,
            s.settings,
            COALESCE(u.display_name, '') AS owner_display_name,
            COUNT(DISTINCT sc.culture_id) AS culture_count
       FROM spaces s
       LEFT JOIN users u ON u.id = s.owner_user_id
       LEFT JOIN space_cultures sc ON sc.space_id = s.id
      WHERE s.type = ?
      GROUP BY s.id
      ORDER BY s.name`,
    [kind]
  )
  return (rows as any[]).map((r) => {
    const settings = parseJsonSettings(r.settings)
    return {
      id: Number(r.id),
      name: String(r.name || ''),
      slug: String(r.slug || ''),
      requireReview: getRequireApproval(settings),
      cultureCount: Number(r.culture_count || 0),
      owner: String(r.owner_display_name || '') || null,
    }
  })
}

pagesRouter.get('/admin/groups', async (req: any, res: any) => {
  try {
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''
    const items = await listSpacesForAdmin('group')
    const doc = renderAdminSpaceListPage({ kind: 'group', items, notice, error })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin groups list failed', { path: req.path })
    res.status(500).send('Failed to load groups')
  }
});

// Singular fallbacks for convenience
pagesRouter.get('/admin/group', (_req, res) => {
  res.redirect('/admin/groups')
});

pagesRouter.get('/admin/groups/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const doc = renderAdminSpaceCreatePage({ kind: 'group', csrfToken })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
});

pagesRouter.post('/admin/groups', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any
    const rawName = body.name != null ? String(body.name) : ''
    const rawSlug = body.slug != null ? String(body.slug) : ''
    const name = rawName.trim()
    const slug = rawSlug.trim()

    if (!name) {
      const cookies = parseCookies(req.headers.cookie)
      const csrfToken = cookies['csrf'] || ''
      const doc = renderAdminSpaceCreatePage({ kind: 'group', csrfToken, error: 'Name is required.', name: rawName, slug: rawSlug })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }
    if (!slug) {
      const cookies = parseCookies(req.headers.cookie)
      const csrfToken = cookies['csrf'] || ''
      const doc = renderAdminSpaceCreatePage({ kind: 'group', csrfToken, error: 'Slug is required.', name: rawName, slug: rawSlug })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }

    const actorUserId = Number(req.user?.id)
    const result = await adminSvc.createSpace({ type: 'group', name, slug }, actorUserId)
    res.redirect(`/admin/groups/${encodeURIComponent(String(result.id))}?notice=${encodeURIComponent('Group created.')}`)
  } catch (err: any) {
    const msg = String(err?.code || err?.message || err)
    const friendly =
      msg.includes('slug_taken') ? 'Slug is already taken.' :
      msg.includes('invalid_slug') ? 'Invalid slug.' :
      'Failed to create group.'
    const body = (req.body || {}) as any
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminSpaceCreatePage({ kind: 'group', csrfToken, error: friendly, name: body.name, slug: body.slug })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.status(400).send(doc)
  }
});

pagesRouter.get('/admin/groups/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Group not found')

    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''

    const space = await adminSvc.getSpace(id)
    if (space.type !== 'group') return res.status(404).send('Group not found')

    const { cultures } = await adminSvc.listCultures()
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const doc = renderAdminSpaceDetailPage({
      kind: 'group',
      space: { id: space.id, name: space.name, slug: space.slug, settings: space.settings, cultureIds: space.cultureIds },
      cultures,
      csrfToken,
      notice,
      error,
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin group detail failed', { path: req.path })
    res.status(500).send('Failed to load group')
  }
});

pagesRouter.post('/admin/groups/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Group not found')
    const space = await adminSvc.getSpace(id)
    if (space.type !== 'group') return res.status(404).send('Group not found')

    const body = (req.body || {}) as any
    const rawName = body.name != null ? String(body.name) : ''
    const name = rawName.trim()
    const commentsPolicy = String(body.commentsPolicy || 'inherit').toLowerCase() as any
    const requireReview = toFormBool(body.requireReview)
    const cultureIds = toIdList(body.cultureIds)

    if (!name) {
      const { cultures } = await adminSvc.listCultures()
      const cookies = parseCookies(req.headers.cookie)
      const csrfToken = cookies['csrf'] || ''
      const doc = renderAdminSpaceDetailPage({
        kind: 'group',
        space: { id: space.id, name: space.name, slug: space.slug, settings: space.settings, cultureIds: space.cultureIds },
        cultures,
        csrfToken,
        error: 'Name is required.',
        draft: { name: rawName, commentsPolicy, requireReview, cultureIds },
      })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }

    await adminSvc.updateSpace(id, { name, commentsPolicy, requireReview, cultureIds })
    res.redirect(`/admin/groups/${encodeURIComponent(String(id))}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    const id = Number(req.params.id)
    const fallback = Number.isFinite(id) && id > 0 ? id : null
    const detail = fallback != null ? await adminSvc.getSpace(fallback).catch(() => null) : null
    const { cultures } = await adminSvc.listCultures().catch(() => ({ cultures: [] as any[] }))
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const body = (req.body || {}) as any

    const code = String(err?.code || '')
    const msg =
      code === 'cannot_override_site_policy' ? 'Cannot disable review due to site policy.' :
      code === 'bad_comments_policy' ? 'Invalid comments policy.' :
      code === 'unknown_culture_ids' ? 'Unknown culture selected.' :
      'Failed to save.'

    if (!detail || detail.type !== 'group') return res.status(500).send('Failed to save group')
    const draftName = body.name != null ? String(body.name) : ''
    const commentsPolicy = String(body.commentsPolicy || 'inherit').toLowerCase() as any
    const requireReview = toFormBool(body.requireReview)
    const cultureIds = toIdList(body.cultureIds)
    const doc = renderAdminSpaceDetailPage({
      kind: 'group',
      space: { id: detail.id, name: detail.name, slug: detail.slug, settings: detail.settings, cultureIds: detail.cultureIds },
      cultures,
      csrfToken,
      error: msg,
      draft: { name: draftName, commentsPolicy, requireReview, cultureIds },
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.status(400).send(doc)
  }
});

pagesRouter.get('/admin/group/:id', (req, res) => {
  res.redirect(`/admin/groups/${encodeURIComponent(String(req.params.id || ''))}`)
});
pagesRouter.get('/admin/groups/:id/user/:userId', (req, res) => {
  res.redirect(`/admin/groups/${encodeURIComponent(String(req.params.id || ''))}`)
});

pagesRouter.get('/admin/channels', async (req: any, res: any) => {
  try {
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''
    const items = await listSpacesForAdmin('channel')
    const doc = renderAdminSpaceListPage({ kind: 'channel', items, notice, error })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin channels list failed', { path: req.path })
    res.status(500).send('Failed to load channels')
  }
});

pagesRouter.get('/admin/channel', (_req, res) => {
  res.redirect('/admin/channels')
});

pagesRouter.get('/admin/channels/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie)
  const csrfToken = cookies['csrf'] || ''
  const doc = renderAdminSpaceCreatePage({ kind: 'channel', csrfToken })
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(doc)
});

pagesRouter.post('/admin/channels', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any
    const rawName = body.name != null ? String(body.name) : ''
    const rawSlug = body.slug != null ? String(body.slug) : ''
    const name = rawName.trim()
    const slug = rawSlug.trim()

    if (!name) {
      const cookies = parseCookies(req.headers.cookie)
      const csrfToken = cookies['csrf'] || ''
      const doc = renderAdminSpaceCreatePage({ kind: 'channel', csrfToken, error: 'Name is required.', name: rawName, slug: rawSlug })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }
    if (!slug) {
      const cookies = parseCookies(req.headers.cookie)
      const csrfToken = cookies['csrf'] || ''
      const doc = renderAdminSpaceCreatePage({ kind: 'channel', csrfToken, error: 'Slug is required.', name: rawName, slug: rawSlug })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }

    const actorUserId = Number(req.user?.id)
    const result = await adminSvc.createSpace({ type: 'channel', name, slug }, actorUserId)
    res.redirect(`/admin/channels/${encodeURIComponent(String(result.id))}?notice=${encodeURIComponent('Channel created.')}`)
  } catch (err: any) {
    const msg = String(err?.code || err?.message || err)
    const friendly =
      msg.includes('slug_taken') ? 'Slug is already taken.' :
      msg.includes('invalid_slug') ? 'Invalid slug.' :
      'Failed to create channel.'
    const body = (req.body || {}) as any
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminSpaceCreatePage({ kind: 'channel', csrfToken, error: friendly, name: body.name, slug: body.slug })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.status(400).send(doc)
  }
});

pagesRouter.get('/admin/channels/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Channel not found')

    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''

    const space = await adminSvc.getSpace(id)
    if (space.type !== 'channel') return res.status(404).send('Channel not found')

    const { cultures } = await adminSvc.listCultures()
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const doc = renderAdminSpaceDetailPage({
      kind: 'channel',
      space: { id: space.id, name: space.name, slug: space.slug, settings: space.settings, cultureIds: space.cultureIds },
      cultures,
      csrfToken,
      notice,
      error,
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin channel detail failed', { path: req.path })
    res.status(500).send('Failed to load channel')
  }
});

pagesRouter.post('/admin/channels/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Channel not found')
    const space = await adminSvc.getSpace(id)
    if (space.type !== 'channel') return res.status(404).send('Channel not found')

    const body = (req.body || {}) as any
    const rawName = body.name != null ? String(body.name) : ''
    const name = rawName.trim()
    const rawDescription = body.description != null ? String(body.description) : ''
    const commentsPolicy = String(body.commentsPolicy || 'inherit').toLowerCase() as any
    const requireReview = toFormBool(body.requireReview)
    const cultureIds = toIdList(body.cultureIds)

    if (!name) {
      const { cultures } = await adminSvc.listCultures()
      const cookies = parseCookies(req.headers.cookie)
      const csrfToken = cookies['csrf'] || ''
      const doc = renderAdminSpaceDetailPage({
        kind: 'channel',
        space: { id: space.id, name: space.name, slug: space.slug, settings: space.settings, cultureIds: space.cultureIds },
        cultures,
        csrfToken,
        error: 'Name is required.',
        draft: { name: rawName, description: rawDescription, commentsPolicy, requireReview, cultureIds },
      })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }

    await adminSvc.updateSpace(id, { name, description: rawDescription, commentsPolicy, requireReview, cultureIds })
    res.redirect(`/admin/channels/${encodeURIComponent(String(id))}?notice=${encodeURIComponent('Saved.')}`)
  } catch (err: any) {
    const id = Number(req.params.id)
    const fallback = Number.isFinite(id) && id > 0 ? id : null
    const detail = fallback != null ? await adminSvc.getSpace(fallback).catch(() => null) : null
    const { cultures } = await adminSvc.listCultures().catch(() => ({ cultures: [] as any[] }))
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const body = (req.body || {}) as any

    const code = String(err?.code || '')
    const msg =
      code === 'cannot_override_site_policy' ? 'Cannot disable review due to site policy.' :
      code === 'bad_comments_policy' ? 'Invalid comments policy.' :
      code === 'unknown_culture_ids' ? 'Unknown culture selected.' :
      code === 'description_too_long' ? 'Description is too long (max 280 characters).' :
      'Failed to save.'

    if (!detail || detail.type !== 'channel') return res.status(500).send('Failed to save channel')
    const draftName = body.name != null ? String(body.name) : ''
    const draftDescription = body.description != null ? String(body.description) : ''
    const commentsPolicy = String(body.commentsPolicy || 'inherit').toLowerCase() as any
    const requireReview = toFormBool(body.requireReview)
    const cultureIds = toIdList(body.cultureIds)
    const doc = renderAdminSpaceDetailPage({
      kind: 'channel',
      space: { id: detail.id, name: detail.name, slug: detail.slug, settings: detail.settings, cultureIds: detail.cultureIds },
      cultures,
      csrfToken,
      error: msg,
      draft: { name: draftName, description: draftDescription, commentsPolicy, requireReview, cultureIds },
    })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.status(400).send(doc)
  }
});

pagesRouter.get('/admin/channel/:id', (req, res) => {
  res.redirect(`/admin/channels/${encodeURIComponent(String(req.params.id || ''))}`)
});
pagesRouter.get('/admin/channels/:id/user/:userId', (req, res) => {
  res.redirect(`/admin/channels/${encodeURIComponent(String(req.params.id || ''))}`)
});

// Dev utilities page
pagesRouter.get('/admin/dev', async (req: any, res: any) => {
  try {
    const notice = req.query && (req.query as any).notice != null ? String((req.query as any).notice) : ''
    const error = req.query && (req.query as any).error != null ? String((req.query as any).error) : ''
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    const stats = await adminSvc.getDevStats()
    const rows = [
      ['Uploads', stats.uploads],
      ['Productions', stats.productions],
      ['Space Publications', stats.spacePublications],
      ['Publication Events', stats.spacePublicationEvents],
    ]

    let body = '<h1>Dev</h1>'
    body += '<div class="toolbar"><div><span class="pill">Dev</span></div><div></div></div>'
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`

    body += '<div class="section"><div class="section-title">Stats</div>'
    body += '<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>'
    for (const [label, value] of rows) {
      body += `<tr><td>${escapeHtml(String(label))}</td><td>${escapeHtml(String(value))}</td></tr>`
    }
    body += '</tbody></table></div>'

    body += '<div class="section">'
    body += '<div class="section-title">Danger Zone</div>'
    body += '<p class="field-hint">Truncate deletes content tables (uploads, productions, publications). Use only in local/dev.</p>'
    body += `<form method="POST" action="/admin/dev/truncate">`
    body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`
    body += `<label>Confirmation<input type="text" name="confirm" value="" placeholder="Type TRUNCATE to confirm" /></label>`
    body += `<div class="actions"><button class="danger" type="submit">Truncate Content</button></div>`
    body += `</form>`
    body += '</div>'

    const doc = renderAdminPage({ title: 'Dev', bodyHtml: body, active: 'dev' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin dev page failed', { path: req.path })
    res.status(500).send('Failed to load dev page')
  }
});

pagesRouter.post('/admin/dev/truncate', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any
    const confirm = String(body.confirm || '').trim().toUpperCase()
    if (confirm !== 'TRUNCATE') {
      return res.redirect(`/admin/dev?error=${encodeURIComponent('Confirmation required: type TRUNCATE.')}`)
    }
    await adminSvc.truncateContent()
    res.redirect(`/admin/dev?notice=${encodeURIComponent('Content truncated.')}`)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'admin dev truncate failed', { path: req.path })
    res.redirect(`/admin/dev?error=${encodeURIComponent('Failed to truncate content.')}`)
  }
});

// Admin moderation overviews (SPA)
pagesRouter.get('/admin/moderation/groups', (_req, res) => {
  res.redirect('/admin/review/groups')
});
pagesRouter.get('/admin/moderation/channels', (_req, res) => {
  res.redirect('/admin/review/channels')
});

// -------- Space-level Admin & Moderation UI --------
// Helper: resolve space id from (type, slug) and attach to req.params.id
function resolveIdFromSlug(type: 'group' | 'channel') {
  return async (req: any, res: any, next: any) => {
    try {
      const from = encodeURIComponent(req.originalUrl || '/');
      const slug = String(req.params.slug || '').trim().toLowerCase();
      if (!slug) return res.redirect(`/forbidden?from=${from}`);
      const db = getPool();
      const [rows] = await db.query(`SELECT id FROM spaces WHERE type = ? AND slug = ? LIMIT 1`, [type, slug]);
      const row = (rows as any[])[0];
      if (!row) return res.redirect(`/forbidden?from=${from}`);
      req.params.id = String(row.id);
      return next();
    } catch {
      const from = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/forbidden?from=${from}`);
    }
  };
}
// Redirect space root to per-member admin page for current user
pagesRouter.get('/spaces/:id', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const currentUserId = req.user && req.user.id ? String(req.user.id) : '';
  if (!currentUserId) {
    return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '')}`);
  }
  res.redirect(`/spaces/${id}/admin/users/${currentUserId}`);
});

// Canonical feed routes for groups/channels by slug (SPA shell, no redirect)
pagesRouter.get('/groups', (_req, res) => {
  serveAppSpa(res);
});
pagesRouter.get('/channels', (_req, res) => {
  serveAppSpa(res);
});
// Exact one-segment slug (avoid matching admin/moderation subpaths)
pagesRouter.get(/^\/groups\/([^\/]+)\/?$/, (_req, res) => {
  serveAppSpa(res);
});
pagesRouter.get(/^\/channels\/([^\/]+)\/?$/, (_req, res) => {
  serveAppSpa(res);
});

// Members default and explicit route
pagesRouter.get('/spaces/:id/admin', requireSpaceAdminPage, (_req, res) => {
  serveSpaceSpa(res);
});
pagesRouter.get('/spaces/:id/admin/members', requireSpaceAdminPage, (_req, res) => {
  serveSpaceSpa(res);
});
// Per-member admin page
pagesRouter.get('/spaces/:id/admin/users/:userId', requireSpaceAdminPage, (_req, res) => {
  serveSpaceSpa(res);
});
// Space settings
pagesRouter.get('/spaces/:id/admin/settings', requireSpaceAdminPage, (_req, res) => {
  serveSpaceSpa(res);
});
pagesRouter.get('/spaces/:id/review', requireSpaceModeratorPage, (_req, res) => {
  serveSpaceSpa(res);
});

// Slug-based admin pages (groups)
pagesRouter.get('/groups/:slug/admin', resolveIdFromSlug('group'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin`);
});
pagesRouter.get('/groups/:slug/admin/members', resolveIdFromSlug('group'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/members`);
});
pagesRouter.get('/groups/:slug/admin/users/:userId', resolveIdFromSlug('group'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const uid = req.params.userId;
  res.redirect(`/spaces/${id}/admin/users/${uid}`);
});
pagesRouter.get('/groups/:slug/admin/settings', resolveIdFromSlug('group'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/settings`);
});

// Slug-based admin pages (channels)
pagesRouter.get('/channels/:slug/admin', resolveIdFromSlug('channel'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin`);
});
pagesRouter.get('/channels/:slug/admin/members', resolveIdFromSlug('channel'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/members`);
});
pagesRouter.get('/channels/:slug/admin/users/:userId', resolveIdFromSlug('channel'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const uid = req.params.userId;
  res.redirect(`/spaces/${id}/admin/users/${uid}`);
});
pagesRouter.get('/channels/:slug/admin/settings', resolveIdFromSlug('channel'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/settings`);
});
// Aliases for readability (same underlying pages)
pagesRouter.get('/groups/:id', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const currentUserId = req.user && req.user.id ? String(req.user.id) : '';
  if (!currentUserId) {
    return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '')}`);
  }
  res.redirect(`/groups/${id}/admin/users/${currentUserId}`);
});
pagesRouter.get('/channels/:id', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const currentUserId = req.user && req.user.id ? String(req.user.id) : '';
  if (!currentUserId) {
    return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '')}`);
  }
  res.redirect(`/channels/${id}/admin/users/${currentUserId}`);
});
pagesRouter.get('/groups/:id/admin', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin`);
});
pagesRouter.get('/groups/:id/admin/members', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/members`);
});
pagesRouter.get('/groups/:id/admin/users/:userId', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id; const uid = req.params.userId;
  res.redirect(`/spaces/${id}/admin/users/${uid}`);
});
pagesRouter.get('/groups/:id/admin/settings', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/settings`);
});
pagesRouter.get('/channels/:id/admin', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin`);
});
pagesRouter.get('/channels/:id/admin/members', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/members`);
});
pagesRouter.get('/channels/:id/admin/users/:userId', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id; const uid = req.params.userId;
  res.redirect(`/spaces/${id}/admin/users/${uid}`);
});
pagesRouter.get('/channels/:id/admin/settings', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/admin/settings`);
});

pagesRouter.get('/uploads/new', async (req: any, res) => {
  try {
    const kind = String(req.query?.kind || '').trim().toLowerCase()
    if (kind === 'audio') {
      const from = encodeURIComponent(req.originalUrl || '/uploads/new')
      if (!req.user || !req.session) return res.redirect(`/forbidden?from=${from}`)
      const ok = await can(req.user.id, PERM.VIDEO_DELETE_ANY).catch(() => false)
      if (!ok) return res.redirect(`/forbidden?from=${from}`)
    }
  } catch {}
  serveAppSpa(res);
});

pagesRouter.get('/publish', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

const SUPPORT_MIN_DONATION_CENTS = 100
const SUPPORT_MAX_DONATION_CENTS = 50000
const SUPPORT_DONATION_STEP_CENTS = 100

type SupportIntent = 'donate' | 'subscribe'

function normalizeSupportIntent(raw: any): SupportIntent | null {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'donate' || v === 'subscribe') return v
  return null
}

function parseDonationCents(raw: any): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < SUPPORT_MIN_DONATION_CENTS || rounded > SUPPORT_MAX_DONATION_CENTS) return null
  if (rounded % SUPPORT_DONATION_STEP_CENTS !== 0) return null
  return rounded
}

function parseModeOption(raw: any): { provider: 'paypal'; mode: 'sandbox' | 'live' } {
  const parts = String(raw || '').trim().toLowerCase().split(':')
  const provider = parts[0] === 'paypal' ? 'paypal' : 'paypal'
  const mode: 'sandbox' | 'live' = parts[1] === 'live' ? 'live' : 'sandbox'
  return { provider, mode }
}

async function listEnabledSupportModes(intent: SupportIntent): Promise<Array<{ value: string; label: string }>> {
  const cfg = await paymentsSvc.listProviderConfigsForAdmin('paypal')
  const rows = cfg.rows || []
  const out: Array<{ value: string; label: string }> = []
  for (const row of rows) {
    if (String(row.status || '').toLowerCase() !== 'enabled') continue
    if (intent === 'donate' && !Number(row.donate_enabled || 0)) continue
    if (intent === 'subscribe' && !Number(row.subscribe_enabled || 0)) continue
    const mode = String(row.mode || '').toLowerCase() === 'live' ? 'live' : 'sandbox'
    out.push({ value: `paypal:${mode}`, label: `PayPal ${mode === 'live' ? 'Live' : 'Sandbox'}` })
  }
  return out
}

function readSupportMessageContext(input: any): {
  messageId: number | null
  campaignKey: string | null
  sessionId: string | null
  intentId: string | null
  sequenceKey: string | null
  ctaKind: string | null
  ctaSlot: number | null
  ctaDefinitionId: number | null
  ctaIntentKey: string | null
  ctaExecutorType: string | null
} {
  const source = input || {}
  return {
    messageId: parsePositiveIntOrNull(source.message_id),
    campaignKey: source.message_campaign_key ? String(source.message_campaign_key).trim().toLowerCase() : null,
    sessionId: source.message_session_id ? String(source.message_session_id).trim() : null,
    intentId: source.message_intent_id ? String(source.message_intent_id).trim().toLowerCase() : null,
    sequenceKey: source.message_sequence_key ? String(source.message_sequence_key).trim() : null,
    ctaKind: source.message_cta_kind ? String(source.message_cta_kind).trim().toLowerCase() : null,
    ctaSlot: parsePositiveIntOrNull(source.message_cta_slot),
    ctaDefinitionId: parsePositiveIntOrNull(source.message_cta_definition_id),
    ctaIntentKey: source.message_cta_intent_key ? String(source.message_cta_intent_key).trim().toLowerCase() : null,
    ctaExecutorType: source.message_cta_executor_type ? String(source.message_cta_executor_type).trim().toLowerCase() : null,
  }
}

function appendSupportContext(query: URLSearchParams, ctx: ReturnType<typeof readSupportMessageContext>): void {
  if (ctx.messageId != null) query.set('message_id', String(ctx.messageId))
  if (ctx.campaignKey) query.set('message_campaign_key', ctx.campaignKey)
  if (ctx.sessionId) query.set('message_session_id', ctx.sessionId)
  if (ctx.intentId) query.set('message_intent_id', ctx.intentId)
  if (ctx.sequenceKey) query.set('message_sequence_key', ctx.sequenceKey)
  if (ctx.ctaKind) query.set('message_cta_kind', ctx.ctaKind)
  if (ctx.ctaSlot != null) query.set('message_cta_slot', String(ctx.ctaSlot))
  if (ctx.ctaDefinitionId != null) query.set('message_cta_definition_id', String(ctx.ctaDefinitionId))
  if (ctx.ctaIntentKey) query.set('message_cta_intent_key', ctx.ctaIntentKey)
  if (ctx.ctaExecutorType) query.set('message_cta_executor_type', ctx.ctaExecutorType)
}

function renderSupportPage(opts: {
  csrfToken: string
  returnPath: string
  cancelPath: string
  donateItems: Array<{ id: number; label: string; amountCents: number | null; currency: string }>
  subscribeItems: Array<{ id: number; label: string; amountCents: number | null; currency: string }>
  selectedDonateItemId: number | null
  selectedSubscribeItemId: number | null
  selectedDonateAmountCents: number | null
  donateModes: Array<{ value: string; label: string }>
  subscribeModes: Array<{ value: string; label: string }>
  currentSubscriptionId: number | null
  currentSubscribeCatalogItemId: number | null
  error?: string | null
  context: ReturnType<typeof readSupportMessageContext>
}): string {
  const fmt = (cents: number | null, currency: string): string => {
    if (cents == null || !Number.isFinite(Number(cents))) return 'Flexible amount'
    return `${(Number(cents) / 100).toFixed(2)} ${String(currency || 'USD').toUpperCase()}`
  }
  const hasDonateProvider = opts.donateModes.length > 0
  const hasSubscribeProvider = opts.subscribeModes.length > 0
  const renderSharedInputs = (intent: SupportIntent, catalogItemId: number, amountCents?: number | null): string => {
    let out = ''
    out += `<input type="hidden" name="csrf" value="${escapeHtml(opts.csrfToken)}" />`
    out += `<input type="hidden" name="intent" value="${intent}" />`
    out += `<input type="hidden" name="return" value="${escapeHtml(opts.returnPath)}" />`
    out += `<input type="hidden" name="cancel" value="${escapeHtml(opts.cancelPath)}" />`
    out += `<input type="hidden" name="catalog_item_id" value="${catalogItemId}" />`
    if (amountCents != null) out += `<input type="hidden" name="amount_cents" value="${Math.round(Number(amountCents) || 0)}" />`
    if (opts.context.messageId != null) out += `<input type="hidden" name="message_id" value="${opts.context.messageId}" />`
    if (opts.context.campaignKey) out += `<input type="hidden" name="message_campaign_key" value="${escapeHtml(opts.context.campaignKey)}" />`
    if (opts.context.sessionId) out += `<input type="hidden" name="message_session_id" value="${escapeHtml(opts.context.sessionId)}" />`
    if (opts.context.intentId) out += `<input type="hidden" name="message_intent_id" value="${escapeHtml(opts.context.intentId)}" />`
    if (opts.context.sequenceKey) out += `<input type="hidden" name="message_sequence_key" value="${escapeHtml(opts.context.sequenceKey)}" />`
    if (opts.context.ctaKind) out += `<input type="hidden" name="message_cta_kind" value="${escapeHtml(opts.context.ctaKind)}" />`
    if (opts.context.ctaSlot != null) out += `<input type="hidden" name="message_cta_slot" value="${opts.context.ctaSlot}" />`
    if (opts.context.ctaDefinitionId != null) out += `<input type="hidden" name="message_cta_definition_id" value="${opts.context.ctaDefinitionId}" />`
    if (opts.context.ctaIntentKey) out += `<input type="hidden" name="message_cta_intent_key" value="${escapeHtml(opts.context.ctaIntentKey)}" />`
    if (opts.context.ctaExecutorType) out += `<input type="hidden" name="message_cta_executor_type" value="${escapeHtml(opts.context.ctaExecutorType)}" />`
    if (opts.currentSubscriptionId != null) out += `<input type="hidden" name="current_subscription_id" value="${opts.currentSubscriptionId}" />`
    if (opts.currentSubscribeCatalogItemId != null) out += `<input type="hidden" name="current_subscription_catalog_item_id" value="${opts.currentSubscribeCatalogItemId}" />`
    return out
  }

  let body = '<h1>Support Us</h1>'
  body += '<p>Choose one-time donation or a subscription tier.</p>'
  if (opts.error) body += `<div class="error">${escapeHtml(opts.error)}</div>`
  if (!hasDonateProvider && !hasSubscribeProvider) {
    body += '<div class="error">No payment providers are enabled right now.</div>'
  }
  body += '<div class="section"><div class="section-title">One-Time Donation</div>'
  if (!opts.donateItems.length) {
    body += '<p>No active donation options.</p>'
  } else {
    for (const item of opts.donateItems) {
      const amountText = item.amountCents == null ? 'Donate' : `$${(Number(item.amountCents) / 100).toFixed(2)}`
      body += '<div class="row" style="display:flex; align-items:center; gap:10px; margin:8px 0">'
      body += `<form method="post" action="/support" style="margin:0">`
      body += renderSharedInputs('donate', Number(item.id), item.amountCents)
      body += `<button type="submit"${hasDonateProvider ? '' : ' disabled'}>${escapeHtml(amountText)}</button>`
      body += '</form>'
      body += `<div style="opacity:.9">${escapeHtml(item.label)}${item.amountCents == null ? '' : ` (${escapeHtml(fmt(item.amountCents, item.currency))})`}</div>`
      body += '</div>'
    }
  }
  body += '</div>'

  body += '<div class="section"><div class="section-title">Subscription</div>'
  if (opts.currentSubscribeCatalogItemId != null) {
    body += '<div class="hint" style="margin:6px 0 10px 0">Current membership is highlighted below.</div>'
  }
  if (!opts.subscribeItems.length) {
    body += '<p>No active subscription plans.</p>'
  } else {
    for (const item of opts.subscribeItems) {
      const amountText = item.amountCents == null ? item.label : `${item.label} — $${(Number(item.amountCents) / 100).toFixed(2)}/mo`
      const isCurrent = opts.currentSubscribeCatalogItemId != null && Number(opts.currentSubscribeCatalogItemId) === Number(item.id)
      body += '<div class="row" style="display:flex; align-items:center; gap:10px; margin:8px 0">'
      body += `<form method="post" action="/support" style="margin:0">`
      body += renderSharedInputs('subscribe', Number(item.id), item.amountCents)
      body += `<button type="submit"${hasSubscribeProvider ? '' : ' disabled'}>${escapeHtml(item.label)}${isCurrent ? ' (Current)' : ''}</button>`
      body += '</form>'
      body += `<div style="opacity:.9">${escapeHtml(amountText)}</div>`
      body += '</div>'
    }
  }
  body += '</div>'

  body += `<div class="row"><a class="btn" href="${escapeHtml(opts.cancelPath)}">Cancel</a></div>`
  return renderPageDocument('Support Us', body)
}

pagesRouter.get('/support', async (req: any, res: any) => {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const returnPath = normalizeReturnPathForSupport(req.query?.return, '/')
    const cancelPath = normalizeReturnPathForSupport(req.query?.cancel, returnPath)
    const context = readSupportMessageContext(req.query || {})
    const selectedDonateItemId = parsePositiveIntOrNull(req.query?.donate_catalog_item_id) ?? parsePositiveIntOrNull(req.query?.catalog_item_id)
    const selectedSubscribeItemId = parsePositiveIntOrNull(req.query?.subscribe_catalog_item_id)
    const selectedDonateAmountCents = parseDonationCents(req.query?.amount_cents)
    const currentSubscriptionId = parsePositiveIntOrNull(req.query?.current_subscription_id)
    const currentSubscribeCatalogItemIdFromQuery = parsePositiveIntOrNull(req.query?.current_subscription_catalog_item_id)
    const error = req.query?.error ? String(req.query.error) : null

    const items = await paymentsSvc.listCatalogItemsForAdmin({ status: 'active', includeArchived: false, limit: 500 })
    const donateItems = items
      .filter((item) => String(item.kind) === 'donate_campaign')
      .map((item) => ({ id: Number(item.id), label: String(item.label || item.item_key || `Donation ${item.id}`), amountCents: item.amount_cents == null ? null : Number(item.amount_cents), currency: String(item.currency || 'USD') }))
    const subscribeItems = items
      .filter((item) => String(item.kind) === 'subscribe_plan')
      .map((item) => ({ id: Number(item.id), label: String(item.label || item.item_key || `Plan ${item.id}`), amountCents: item.amount_cents == null ? null : Number(item.amount_cents), currency: String(item.currency || 'USD') }))
    const donateModes = await listEnabledSupportModes('donate')
    const subscribeModes = await listEnabledSupportModes('subscribe')

    let currentSubscribeCatalogItemId = currentSubscribeCatalogItemIdFromQuery
    if (currentSubscribeCatalogItemId == null && req.user?.id) {
      try {
        const snapshot = await paymentsSvc.getMySupportSnapshot({ userId: Number(req.user.id), recentLimit: 5 })
        const activeSub = (snapshot.subscriptions || []).find((row) => String(row.status || '').toLowerCase() === 'active')
        if (activeSub?.catalog_item_id != null) {
          const n = Number(activeSub.catalog_item_id)
          if (Number.isFinite(n) && n > 0) currentSubscribeCatalogItemId = Math.round(n)
        }
      } catch {}
    }

    const doc = renderSupportPage({
      csrfToken,
      returnPath,
      cancelPath,
      donateItems,
      subscribeItems,
      donateModes,
      subscribeModes,
      selectedDonateItemId,
      selectedSubscribeItemId,
      selectedDonateAmountCents,
      currentSubscriptionId,
      currentSubscribeCatalogItemId,
      error,
      context,
    })
    ;(req.log || pagesLogger).info({
      app_operation: 'support.page.view',
      app_outcome: 'success',
      support_return: returnPath,
      support_cancel: cancelPath,
      support_donate_items: donateItems.length,
      support_subscribe_items: subscribeItems.length,
      support_donate_modes: donateModes.length,
      support_subscribe_modes: subscribeModes.length,
      message_id: context.messageId,
      message_campaign_key: context.campaignKey,
    }, 'support.page.view')
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'support page load failed', { path: req.path })
    return res.status(500).send('Failed to load support page')
  }
})

pagesRouter.post('/support', async (req: any, res: any) => {
  try {
    const intent = normalizeSupportIntent(req.body?.intent)
    if (!intent) return res.redirect('/support?error=invalid_support_intent')

    const context = readSupportMessageContext(req.body || {})
    const returnPath = normalizeReturnPathForSupport(req.body?.return, '/')
    const cancelPath = normalizeReturnPathForSupport(req.body?.cancel, returnPath)
    const providerModeRaw = req.body?.provider_mode ? String(req.body.provider_mode).trim().toLowerCase() : ''
    const modeParsed = providerModeRaw ? parseModeOption(providerModeRaw) : null
    const catalogItemId = parsePositiveIntOrNull(req.body?.catalog_item_id)
    const currentSubscriptionId = parsePositiveIntOrNull(req.body?.current_subscription_id)
    const currentSubscriptionCatalogItemId = parsePositiveIntOrNull(req.body?.current_subscription_catalog_item_id)
    const selectedItems = await paymentsSvc.listCatalogItemsForAdmin({ status: 'active', includeArchived: false, limit: 500 })
    const selectedItem = catalogItemId == null
      ? null
      : selectedItems.find((item) => Number(item.id) === Number(catalogItemId)) || null
    if (!selectedItem) {
      const q = new URLSearchParams()
      q.set('error', 'catalog_item_required')
      q.set('return', returnPath)
      q.set('cancel', cancelPath)
      appendSupportContext(q, context)
      return res.redirect(`/support?${q.toString()}`)
    }
    if ((intent === 'donate' && String(selectedItem.kind) !== 'donate_campaign') || (intent === 'subscribe' && String(selectedItem.kind) !== 'subscribe_plan')) {
      const q = new URLSearchParams()
      q.set('error', 'catalog_item_kind_mismatch')
      q.set('return', returnPath)
      q.set('cancel', cancelPath)
      appendSupportContext(q, context)
      return res.redirect(`/support?${q.toString()}`)
    }

    const customDonateAmount = parseDonationCents(req.body?.amount_cents)
    const itemAmount = Number.isFinite(Number(selectedItem.amount_cents)) && Number(selectedItem.amount_cents) > 0
      ? Math.round(Number(selectedItem.amount_cents))
      : null
    const amountCents = intent === 'donate'
      ? (customDonateAmount ?? itemAmount)
      : itemAmount

    if (intent === 'donate' && amountCents == null) {
      const q = new URLSearchParams()
      q.set('error', 'invalid_donation_amount')
      q.set('return', returnPath)
      q.set('cancel', cancelPath)
      if (catalogItemId != null) q.set('donate_catalog_item_id', String(catalogItemId))
      q.set('amount_cents', String(req.body?.amount_cents || ''))
      appendSupportContext(q, context)
      return res.redirect(`/support?${q.toString()}`)
    }
    if (intent === 'subscribe' && amountCents == null) {
      const q = new URLSearchParams()
      q.set('error', 'subscription_plan_amount_missing')
      q.set('return', returnPath)
      q.set('cancel', cancelPath)
      if (catalogItemId != null) q.set('subscribe_catalog_item_id', String(catalogItemId))
      appendSupportContext(q, context)
      return res.redirect(`/support?${q.toString()}`)
    }

    if (
      intent === 'subscribe' &&
      req.user?.id &&
      currentSubscriptionId != null &&
      currentSubscriptionCatalogItemId != null &&
      catalogItemId != null &&
      Number(currentSubscriptionCatalogItemId) !== Number(catalogItemId)
    ) {
      try {
        await paymentsSvc.requestSubscriptionAction({
          userId: Number(req.user.id),
          subscriptionId: Number(currentSubscriptionId),
          action: 'cancel',
        })
      } catch (err: any) {
        const q = new URLSearchParams()
        q.set('error', String(err?.message || 'subscription_cancel_failed'))
        q.set('return', returnPath)
        q.set('cancel', cancelPath)
        q.set('current_subscription_id', String(currentSubscriptionId))
        q.set('current_subscription_catalog_item_id', String(currentSubscriptionCatalogItemId))
        appendSupportContext(q, context)
        return res.redirect(`/support?${q.toString()}`)
      }
    }

    const query = new URLSearchParams()
    query.set('return', returnPath)
    query.set('cancel', cancelPath)
    if (modeParsed) query.set('provider_mode', `${modeParsed.provider}:${modeParsed.mode}`)
    query.set('support_source', 'support_page')
    if (catalogItemId != null) query.set('catalog_item_id', String(catalogItemId))
    if (amountCents != null) query.set('amount_cents', String(amountCents))
    appendSupportContext(query, context)
    ;(req.log || pagesLogger).info({
      app_operation: 'support.page.start',
      app_outcome: 'redirect',
      support_intent: intent,
      support_catalog_item_id: catalogItemId,
      support_amount_cents: amountCents,
      support_provider_mode: modeParsed ? `${modeParsed.provider}:${modeParsed.mode}` : null,
      message_id: context.messageId,
      message_campaign_key: context.campaignKey,
    }, 'support.page.start')
    return res.redirect(`/checkout/${intent}?${query.toString()}`)
  } catch (err: any) {
    const query = new URLSearchParams()
    query.set('error', String(err?.message || 'support_start_failed'))
    return res.redirect(`/support?${query.toString()}`)
  }
})

pagesRouter.get('/my/support', async (req: any, res: any) => {
  try {
    const from = encodeURIComponent(req.originalUrl || '/my/support')
    if (!req.user || !req.session) return res.redirect(`/login?from=${from}`)
    const userId = Number(req.user?.id || 0)
    if (!Number.isFinite(userId) || userId <= 0) return res.redirect(`/login?from=${from}`)
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const notice = req.query?.notice ? String(req.query.notice) : ''
    const error = req.query?.error ? String(req.query.error) : ''
    const pollRaw = Number.parseInt(String(req.query?.poll ?? ''), 10)
    const pollBudget = Number.isFinite(pollRaw) ? Math.max(0, Math.min(60, pollRaw)) : 0

    const snapshot = await paymentsSvc.getMySupportSnapshot({ userId, recentLimit: 30 })
    let catalogNameById = new Map<number, string>()
    try {
      const catalog = await paymentsSvc.listCatalogItemsForAdmin({ includeArchived: true, limit: 1000 })
      for (const item of catalog) {
        const id = Number(item.id || 0)
        if (!Number.isFinite(id) || id <= 0) continue
        const name = String(item.label || item.item_key || '').trim()
        if (name) catalogNameById.set(id, name)
      }
    } catch {}
    const dollars = (cents: number | null | undefined): string => {
      const n = Number(cents || 0)
      if (!Number.isFinite(n)) return '$0.00'
      return `$${(n / 100).toFixed(2)}`
    }
    const dateOnly = (v: any): string => {
      const s = String(v == null ? '' : v).trim()
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
      return m ? m[1] : s
    }
    const asText = (v: any): string => escapeHtml(String(v == null ? '' : v))

    let body = '<h1>My Support</h1>'
    body += '<div class="toolbar"><div><span class="pill">Support</span></div><div><a href="/support?return=%2Fmy%2Fsupport&cancel=%2Fmy%2Fsupport">Support Again</a></div></div>'
    if (notice) body += `<div class="notice">${escapeHtml(notice)}</div>`
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`
    body += '<div class="section">'
    body += '<div class="section-title" style="font-size:1.22rem; font-weight:800">Totals</div>'
    body += `<p><strong>Lifetime Donations:</strong> ${dollars(snapshot.lifetimeDonatedCents)}</p>`
    body += `<p><strong>Lifetime Subscriptions:</strong> ${dollars(snapshot.lifetimeSubscribedCents)}</p>`
    body += `<p><strong>Total:</strong> ${dollars(snapshot.lifetimeTotalCents)}</p>`
    body += `<p><strong>Last 30 Days:</strong> ${dollars(snapshot.last30DaysTotalCents)}</p>`
    body += '</div>'

    body += '<div class="section"><div class="section-title" style="font-size:1.22rem; font-weight:800">Recent Transactions</div>'
    if (!snapshot.recentTransactions.length) {
      body += '<p>No transactions yet.</p>'
    } else {
      body += '<table style="border-collapse:separate; border-spacing:0; width:100%"><thead><tr><th style="text-align:left; padding:0 20px 8px 0">Date</th><th style="text-align:left; padding:0 20px 8px 0">Type</th><th style="text-align:left; padding:0 20px 8px 0">Amount</th><th style="text-align:left; padding:0 0 8px 0">Provider</th></tr></thead><tbody>'
      for (const row of snapshot.recentTransactions) {
        const typeLabel = String(row.intent || '').toLowerCase() === 'subscribe' ? 'Subscription' : 'Donation'
        const providerLabel = String(row.provider || '').toLowerCase() === 'paypal' ? 'Paypal' : asText(row.provider || '')
        body += `<tr>
          <td style="text-align:left; padding:2px 20px 2px 0">${asText(dateOnly(row.occurred_at || row.created_at || ''))}</td>
          <td style="text-align:left; padding:2px 20px 2px 0">${typeLabel}</td>
          <td style="text-align:left; padding:2px 20px 2px 0">${asText(dollars(row.amount_cents))}</td>
          <td style="text-align:left; padding:2px 0 2px 0">${providerLabel}</td>
        </tr>`
      }
      body += '</tbody></table>'
    }
    body += '</div>'

    const hasPendingSubscriptions = snapshot.subscriptions.some((row: any) => {
      const status = String(row?.status || '').trim().toLowerCase()
      return !!row?.pending_action || status === 'pending' || status === 'pending_approval'
    })
    const shouldAutoRefresh = hasPendingSubscriptions || pollBudget > 0
    let nextPollBudget = 0
    if (hasPendingSubscriptions) {
      const currentBudget = pollBudget > 0 ? pollBudget : 12
      nextPollBudget = Math.max(0, currentBudget - 1)
    } else if (pollBudget > 0) {
      nextPollBudget = pollBudget - 1
    }
    body += '<div class="section">'
    body += '<div class="section-title" style="font-size:1.22rem; font-weight:800; margin:0 0 10px">Subscriptions</div>'
    if (!snapshot.subscriptions.length) {
      body += '<p>No subscription records yet.</p>'
    } else {
      for (const [idx, row] of snapshot.subscriptions.entries()) {
        const supportsActions = String(row.provider || '').toLowerCase() === 'paypal' && String(row.provider_subscription_id || '').trim().length > 0
        const status = String(row.status || '').trim().toLowerCase()
        const hasPending = !!row.pending_action
        const isRowPending = hasPending || status === 'pending' || status === 'pending_approval'
        const canCancel = supportsActions && status === 'active' && !hasPending
        const planName = row.catalog_item_id != null
          ? (catalogNameById.get(Number(row.catalog_item_id)) || '')
          : ''
        const pendingText = hasPending
          ? `Pending ${asText(row.pending_action)}${row.pending_plan_key ? ` (${asText(row.pending_plan_key)})` : ''} requested ${asText(row.pending_requested_at || '')}. Waiting for provider confirmation.`
          : ''
        body += '<div style="display:grid; grid-template-columns:minmax(120px,180px) 1fr; gap:8px 20px; align-items:start; margin-top:10px">'
        body += `<div style="opacity:.85">Name</div><div>${asText(planName || 'Subscription')}</div>`
        body += `<div style="opacity:.85">Started</div><div>${asText(dateOnly(row.created_at || ''))}</div>`
        if (status === 'canceled') {
          body += `<div style="opacity:.85">Canceled</div><div>${asText(dateOnly(row.updated_at || ''))}</div>`
        }
        body += `<div style="opacity:.85">Cost</div><div>${asText(dollars(row.amount_cents))} ${asText(String(row.currency || 'USD').toUpperCase())}/month</div>`
        body += `<div style="opacity:.85">Status</div><div>${isRowPending ? '<span class="support-pending-indicator" style="letter-spacing:.04em; text-transform:lowercase; opacity:.85">pending ...</span>' : asText(row.status)}</div>`
        if (pendingText) {
          body += `<div style="opacity:.85">Pending</div><div style="font-size:.92em; opacity:.9">${pendingText}</div>`
        }
        if (supportsActions && status !== 'canceled') {
          body += `<div style="opacity:.85">Cancel</div><div><form method="post" action="/api/payments/subscriptions/${Number(row.id)}/cancel" style="display:inline-flex; gap:6px; align-items:center"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" /><input type="hidden" name="return" value="/my/support" /><button type="submit"${canCancel ? '' : ' disabled'}>Cancel</button></form></div>`
          body += `<div style="opacity:.85">Change Plan</div><div><form method="get" action="/support" style="display:inline-flex; gap:6px; align-items:center"><input type="hidden" name="intent" value="subscribe" /><input type="hidden" name="return" value="/my/support" /><input type="hidden" name="cancel" value="/my/support" /><input type="hidden" name="current_subscription_id" value="${Number(row.id)}" /><input type="hidden" name="current_subscription_catalog_item_id" value="${row.catalog_item_id != null ? Number(row.catalog_item_id) : ''}" /><button type="submit">Change Plan</button></form></div>`
        }
        body += '</div>'
        if (idx < snapshot.subscriptions.length - 1) {
          body += '<hr style="border:none; border-top:1px solid rgba(255,255,255,0.14); margin:14px 0" />'
        }
      }
    }
    body += '</div>'

    if (shouldAutoRefresh) {
      body += `<script>(function(){
        var timerMs = 5000;
        var els = document.querySelectorAll('.support-pending-indicator');
        if (els && els.length) {
          var on = true;
          window.setInterval(function(){
            on = !on;
            for (var i = 0; i < els.length; i++) {
              var el = els[i];
              if (el && el.style) el.style.opacity = on ? '0.85' : '0.25';
            }
          }, 500);
        }
        window.setTimeout(function(){
          var u = new URL(window.location.href);
          ${nextPollBudget > 0 ? `u.searchParams.set('poll', '${nextPollBudget}');` : `u.searchParams.delete('poll');`}
          window.location.replace(u.toString());
        }, timerMs);
      })();</script>`
    }

    const doc = renderPageDocument('My Support', body)
    ;(req.log || pagesLogger).info({
      app_operation: 'my.support.view',
      app_outcome: 'success',
      user_id: userId,
      payment_tx_count: snapshot.recentTransactions.length,
      payment_sub_count: snapshot.subscriptions.length,
      payment_lifetime_donated_cents: snapshot.lifetimeDonatedCents,
      payment_lifetime_subscribed_cents: snapshot.lifetimeSubscribedCents,
      payment_lifetime_total_cents: snapshot.lifetimeTotalCents,
      payment_last_30d_total_cents: snapshot.last30DaysTotalCents,
    }, 'my.support.view')
    res.set('Content-Type', 'text/html; charset=utf-8')
    return res.send(doc)
  } catch (err) {
    logError(req.log || pagesLogger, err, 'my support page failed', { path: req.path })
    return res.status(500).send('Failed to load support account page')
  }
})

pagesRouter.get('/publish/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/produce', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/edit-video', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/create-video', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/create-video/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/exports', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/exports/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/assets', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/assets/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/assets/:type/*', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/assets/:type', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/library', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/library/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/library/create-clip/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/library/create-clip/:id/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/timelines', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/timelines/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/logo-configs', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/screen-title-presets', (req: any, res) => {
  try {
    const uid = req?.user?.id ? Number(req.user.id) : null;
    (req.log || pagesLogger).warn({ userId: uid, ip: req?.ip, ua: String(req?.headers?.['user-agent'] || '') }, 'legacy_route_screen_title_presets')
  } catch {}
  res.status(404).type('text/plain').send('Not found')
});
pagesRouter.get('/screen-title-presets/', (req: any, res) => {
  try {
    const uid = req?.user?.id ? Number(req.user.id) : null;
    (req.log || pagesLogger).warn({ userId: uid, ip: req?.ip, ua: String(req?.headers?.['user-agent'] || '') }, 'legacy_route_screen_title_presets')
  } catch {}
  res.status(404).type('text/plain').send('Not found')
});

pagesRouter.get('/lower-thirds', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/lower-thirds/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/productions', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/register', (_req, res) => {
  serveHtml(res, 'register.html');
});

pagesRouter.get('/login', (_req, res) => {
  serveHtml(res, 'login.html');
});

pagesRouter.get('/videos', (_req, res) => {
  serveHtml(res, 'videos.html');
});

pagesRouter.get('/mobile', (_req, res) => {
  serveHtml(res, 'mobile.html');
});

pagesRouter.get('/pwa-swipe', (_req, res) => {
  serveHtml(res, 'pwa-swipe.html');
});

pagesRouter.get('/debug/logs', (_req, res) => {
  serveHtml(res, 'debug-logs.html');
});
