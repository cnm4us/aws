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
import * as lowerThirdsSvc from '../features/lower-thirds/service'
import { GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { s3 } from '../services/s3'
import { pipeline } from 'stream/promises'

const publicDir = path.join(process.cwd(), 'public');

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

function jsonNoStore(res: any) {
  res.set('Cache-Control', 'no-store');
}

function jsonError(res: any, status: number, code: string) {
  jsonNoStore(res);
  res.status(status).json({ error: code });
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

async function listDirectChildPages(parentSlug: string): Promise<Array<{ slug: string; title: string | null }>> {
  const slug = String(parentSlug || '').trim().toLowerCase();
  if (!slug) return [];
  const segments = slug.split('/');
  if (segments.length >= 4) return [];

  const prefix = `${slug}/`;
  const db = getPool();
  const [rows] = await db.query(
    `SELECT slug, title
       FROM pages
      WHERE slug LIKE ?
        AND slug NOT LIKE ?
      ORDER BY slug
      LIMIT 200`,
    [`${prefix}%`, `${prefix}%/%`]
  );
  return (rows as any[]).map((r) => ({ slug: String(r.slug), title: r.title != null ? String(r.title) : null }));
}

// -------- JSON APIs: Pages & Rules (latest only; SPA embed) --------

const TOC_PAGE_SLUGS = new Set(['docs']);

pagesRouter.get(/^\/api\/pages\/(.+)$/, async (req: any, res: any) => {
  try {
    const rawSlug = String((req.params as any)[0] || '');
    let decoded = rawSlug;
    try { decoded = decodeURIComponent(rawSlug) } catch {}
    const slug = normalizePageSlug(decoded);
    if (!slug) return jsonError(res, 400, 'bad_slug');

    const db = getPool();
    const [rows] = await db.query(
      `SELECT slug, title, html, visibility, layout, updated_at
         FROM pages
        WHERE slug = ?
        LIMIT 1`,
      [slug]
    );
    const page = (rows as any[])[0];
    if (!page) return jsonError(res, 404, 'page_not_found');

    const ok = await ensurePageVisibilityJson(req, res, page.visibility as PageVisibility);
    if (!ok) return;

    const updatedAt = page.updated_at ? new Date(page.updated_at) : null;
    const children = slug === 'home' ? [] : await listDirectChildPages(slug);
    const includeChildren = TOC_PAGE_SLUGS.has(slug) || children.length > 0;
    jsonNoStore(res);
    res.json({
      slug,
      title: page.title != null ? String(page.title) : '',
      html: String(page.html || ''),
      visibility: String(page.visibility || 'public'),
      layout: page.layout != null ? String(page.layout) : 'default',
      updatedAt: updatedAt && !isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : null,
      ...(includeChildren
        ? { children: children.map((c) => ({ slug: c.slug, title: c.title || '', url: `/pages/${c.slug}` })) }
        : {}),
    });
  } catch (err) {
    console.error('api pages failed', err);
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
    console.error('api rules failed', err);
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
    console.error('api rules index failed', err);
    jsonError(res, 500, 'internal_error');
  }
});

pagesRouter.get('/', async (req: any, res: any) => {
  // Phase 2: SPA owns '/', and fetches CMS home content via /api/pages/home.
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get(/^\/pages\/(.+)$/, (req: any, res: any) => {
  // Phase 2: SPA owns latest /pages/* views and fetches content via /api/pages/:slugPath.
  // Keep /pages/home non-canonical.
  const rawSlug = String((req.params as any)[0] || '');
  let decoded = rawSlug;
  try { decoded = decodeURIComponent(rawSlug) } catch {}
  const slug = normalizePageSlug(decoded);
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
    console.error('rule version render failed', err);
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
  | 'lower_thirds'
  | 'audio_configs'
  | 'media_jobs'
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
  { key: 'lower_thirds', label: 'Lower Thirds', href: '/admin/lower-thirds' },
  { key: 'audio_configs', label: 'Audio Configs', href: '/admin/audio-configs' },
  { key: 'media_jobs', label: 'Media Jobs', href: '/admin/media-jobs' },
  { key: 'settings', label: 'Settings', href: '/admin/settings' },
  { key: 'dev', label: 'Dev', href: '/admin/dev' },
];

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
    const db = getPool();
    const [rows] = await db.query(
      `SELECT id, slug, title, visibility, updated_at
         FROM pages
        ORDER BY slug`
    );
    const items = rows as any[];
    let body = '<h1>Pages</h1>';
    body += '<div class="toolbar"><div><span class="pill">Pages</span></div><div><a href="/admin/pages/new">New page</a></div></div>';
    if (!items.length) {
      body += '<p>No pages have been created yet.</p>';
    } else {
      body += '<table><thead><tr><th>Slug</th><th>Title</th><th>Visibility</th><th>Updated</th></tr></thead><tbody>';
      for (const row of items) {
        const slug = escapeHtml(String(row.slug || ''));
        const title = escapeHtml(String(row.title || ''));
        const vis = escapeHtml(String(row.visibility || 'public'));
        const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : '';
        body += `<tr><td><a href="/admin/pages/${row.id}">${slug || '(home)'}</a></td><td>${title}</td><td>${vis}</td><td>${updated}</td></tr>`;
      }
      body += '</tbody></table>';
    }
    const doc = renderAdminPage({ title: 'Pages', bodyHtml: body, active: 'pages' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    console.error('admin pages list failed', err);
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

  return renderAdminPage({ title: 'Category', bodyHtml: body, active: 'categories' });
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

    let body = '<h1>Categories</h1>';
    body += '<div class="toolbar"><div><span class="pill">Categories</span></div><div><a href="/admin/categories/new">New category</a></div></div>';
    if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`;
    if (error) body += `<div class="error">${escapeHtml(error)}</div>`;

    if (!items.length) {
      body += '<p>No categories have been created yet.</p>';
    } else {
      body += '<table><thead><tr><th>Name</th><th>Cultures</th><th>Rules</th><th>Updated</th></tr></thead><tbody>';
      for (const row of items) {
        const id = Number(row.id);
        const name = escapeHtml(String(row.name || ''));
        const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : '';
        const cultures = row.culture_count != null ? escapeHtml(String(row.culture_count)) : '0';
        const rules = row.rule_count != null ? escapeHtml(String(row.rule_count)) : '0';
        const href = `/admin/categories/${encodeURIComponent(String(id))}`;
        body += `<tr><td><a href="${href}">${name}</a></td><td>${cultures}</td><td>${rules}</td><td>${updated}</td></tr>`;
      }
      body += '</tbody></table>';
    }

    const doc = renderAdminPage({ title: 'Categories', bodyHtml: body, active: 'categories' });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    console.error('admin categories list failed', err);
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
    console.error('admin create category failed', err);
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

    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';

    const doc = renderCategoryDetailPage({
      category,
      cultureCount: Number(cCount?.c || 0),
      ruleCount: Number(rCount?.c || 0),
      csrfToken,
      notice,
      error,
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    console.error('admin category detail failed', err);
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

    if (!name) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCategoryDetailPage({
        category: { ...category, name: rawName, description: rawDescription },
        cultureCount,
        ruleCount,
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
    console.error('admin update category failed', err);
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
    console.error('admin delete category failed', err);
    res.status(500).send('Failed to delete category');
  }
});

// -------- Admin: Cultures (server-rendered, minimal JS) --------

function renderCultureForm(opts: { error?: string | null; csrfToken?: string | null; name?: string; description?: string }): string {
  const error = opts.error ? String(opts.error) : '';
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const name = opts.name ? String(opts.name) : '';
  const description = opts.description ? String(opts.description) : '';

  let body = `<h1>New Culture</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/cultures">\u2190 Back to cultures</a></div></div>';
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`;
  body += `<form method="post" action="/admin/cultures">`;
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;
  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(name)}" />
    <div class="field-hint">Unique label for this culture (used by admins; not currently shown to end users).</div>
  </label>`;
  body += `<label>Description
    <textarea name="description" style="min-height: 120px">${escapeHtml(description)}</textarea>
  </label>`;
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
    console.error('admin cultures list failed', err);
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
    const rawDescription = body.description != null ? String(body.description) : '';
    const name = rawName.trim();
    const description = rawDescription.trim();

    if (!name) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCultureForm({ csrfToken, error: 'Name is required.', name: rawName, description: rawDescription });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (name.length > 255) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderCultureForm({ csrfToken, error: 'Name is too long (max 255 characters).', name: rawName, description: rawDescription });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }

    const db = getPool();
    try {
      await db.query(`INSERT INTO cultures (name, description) VALUES (?, ?)`, [name, description ? description : null]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_cultures_name')) {
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderCultureForm({ csrfToken, error: 'A culture with that name already exists.', name: rawName, description: rawDescription });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect(`/admin/cultures?notice=${encodeURIComponent('Culture created.')}`);
  } catch (err) {
    console.error('admin create culture failed', err);
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

function renderCultureDetailPage(opts: {
  culture: any;
  categories: Array<{ id: number; name: string; description: string }>;
  assignedCategoryIds: Set<number>;
  csrfToken?: string | null;
  notice?: string | null;
  error?: string | null;
}): string {
  const culture = opts.culture ?? {};
  const categories = Array.isArray(opts.categories) ? opts.categories : [];
  const assigned = opts.assignedCategoryIds ?? new Set<number>();
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const notice = opts.notice ? String(opts.notice) : '';
  const error = opts.error ? String(opts.error) : '';

  const id = culture.id != null ? String(culture.id) : '';
  const nameValue = culture.name ? String(culture.name) : '';
  const descriptionValue = culture.description ? String(culture.description) : '';

  let body = `<h1>Culture: ${escapeHtml(nameValue || '(unnamed)')}</h1>`;
  body += '<div class="toolbar"><div><a href="/admin/cultures">\u2190 Back to cultures</a></div></div>';
  if (notice) body += `<div class="success">${escapeHtml(notice)}</div>`;
  if (error) body += `<div class="error">${escapeHtml(error)}</div>`;

  body += `<form method="post" action="/admin/cultures/${escapeHtml(id)}">`;
  if (csrfToken) body += `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />`;

  body += `<label>Name
    <input type="text" name="name" value="${escapeHtml(nameValue)}" />
  </label>`;
  body += `<label>Description
    <textarea name="description" style="min-height: 120px">${escapeHtml(descriptionValue)}</textarea>
  </label>`;

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
      body += `<div><div>${escapeHtml(c.name)}</div>`;
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
    const [cultureRows] = await db.query(`SELECT id, name, description, updated_at FROM cultures WHERE id = ? LIMIT 1`, [id]);
    const culture = (cultureRows as any[])[0];
    if (!culture) return res.status(404).send('Culture not found');

    const categories = await listRuleCategoriesForCultures();
    const [assignedRows] = await db.query(`SELECT category_id FROM culture_categories WHERE culture_id = ?`, [id]);
    const assignedCategoryIds = new Set<number>((assignedRows as any[]).map((r) => Number(r.category_id)).filter((n) => Number.isFinite(n) && n > 0));

    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';

    const doc = renderCultureDetailPage({ culture, categories, assignedCategoryIds, csrfToken, notice, error });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    console.error('admin culture detail failed', err);
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
    const rawDescription = body.description != null ? String(body.description) : '';
    const name = rawName.trim();
    const description = rawDescription.trim();

    const rawCategoryIds = (body as any).categoryIds;
    const submittedIds: number[] = Array.isArray(rawCategoryIds)
      ? rawCategoryIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
      : (rawCategoryIds != null && String(rawCategoryIds).trim() !== '')
        ? [Number(rawCategoryIds)].filter((n) => Number.isFinite(n) && n > 0)
        : [];

    if (!name) {
      const db = getPool();
      const [cultureRows] = await db.query(`SELECT id, name, description FROM cultures WHERE id = ? LIMIT 1`, [id]);
      const culture = (cultureRows as any[])[0];
      if (!culture) return res.status(404).send('Culture not found');

      const categories = await listRuleCategoriesForCultures();
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const assignedCategoryIds = new Set<number>(submittedIds);
      const doc = renderCultureDetailPage({ culture: { ...culture, name: rawName, description: rawDescription }, categories, assignedCategoryIds, csrfToken, error: 'Name is required.' });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (name.length > 255) {
      const db = getPool();
      const [cultureRows] = await db.query(`SELECT id, name, description FROM cultures WHERE id = ? LIMIT 1`, [id]);
      const culture = (cultureRows as any[])[0];
      if (!culture) return res.status(404).send('Culture not found');

      const categories = await listRuleCategoriesForCultures();
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const assignedCategoryIds = new Set<number>(submittedIds);
      const doc = renderCultureDetailPage({ culture: { ...culture, name: rawName, description: rawDescription }, categories, assignedCategoryIds, csrfToken, error: 'Name is too long (max 255 characters).' });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }

    const db = getPool() as any;
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [cultureRows] = await conn.query(`SELECT id, name, description FROM cultures WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
    const culture = (cultureRows as any[])[0];
    if (!culture) {
      await conn.rollback();
      return res.status(404).send('Culture not found');
    }

    const uniqueSubmittedIds = Array.from(new Set(submittedIds));
    let validIds: number[] = [];
    if (uniqueSubmittedIds.length) {
      const [catRows] = await conn.query(
        `SELECT id FROM rule_categories WHERE id IN (${uniqueSubmittedIds.map(() => '?').join(',')})`,
        uniqueSubmittedIds
      );
      validIds = (catRows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    }

    try {
      await conn.query(
        `UPDATE cultures
            SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [name, description ? description : null, id]
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_cultures_name')) {
        await conn.rollback();
        const categories = await listRuleCategoriesForCultures();
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const assignedCategoryIds = new Set<number>(validIds);
        const doc = renderCultureDetailPage({
          culture: { ...culture, name: rawName, description: rawDescription },
          categories,
          assignedCategoryIds,
          csrfToken,
          error: 'A culture with that name already exists.',
        });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
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
    console.error('admin update culture failed', err);
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
    console.error('admin delete culture failed', err);
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

  let body = '<h1>Rules</h1>';
  body += '<div class="toolbar"><div><span class="pill">Rules</span></div><div><a href="/admin/rules/new">New rule</a></div></div>';
  body += `<div class="toolbar" style="margin-top: 10px"><div><label style="display:flex; gap:10px; align-items:center; margin:0"><span style="opacity:0.85">Category</span><select name="categoryId" onchange="(function(sel){const qs=new URLSearchParams(window.location.search); if(sel.value){qs.set('categoryId', sel.value)} else {qs.delete('categoryId')} window.location.search=qs.toString()})(this)"><option value=""${selectedCategoryId === '' ? ' selected' : ''}>All</option>${categories
    .map((c) => {
      const id = String(c.id);
      const sel = id === selectedCategoryId ? ' selected' : '';
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(c.name)}</option>`;
    })
    .join('')}</select></label></div></div>`;
  if (!rules.length) {
    body += '<p>No rules have been created yet.</p>';
  } else {
    body += `<table><thead><tr>
      <th>${headerLink('Slug', 'slug')}</th>
      <th>${headerLink('Category', 'category')}</th>
      <th>${headerLink('Title', 'title')}</th>
      <th>${headerLink('Visibility', 'visibility')}</th>
      <th>${headerLink('Current Version', 'version')}</th>
      <th>${headerLink('Draft', 'draft')}</th>
      <th>${headerLink('Updated', 'updated')}</th>
      <th></th>
    </tr></thead><tbody>`;
    for (const row of rules) {
      const slug = escapeHtml(String(row.slug || ''));
      const category = escapeHtml(String(row.category_name || ''));
      const title = escapeHtml(String(row.title || ''));
      const vis = escapeHtml(String(row.visibility || 'public'));
      const ver = row.current_version ?? row.current_version_id ?? null;
      const versionLabel = ver != null ? escapeHtml(String(ver)) : '';
      const draftPending = row.draft_pending != null ? Number(row.draft_pending) === 1 : false;
      const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : '';
      body += `<tr>`;
      body += `<td><a href="/admin/rules/${row.id}">${slug}</a></td>`;
      body += `<td>${category}</td>`;
      body += `<td>${title}</td>`;
      body += `<td>${vis}</td>`;
      body += `<td>${versionLabel}</td>`;
      body += `<td>${draftPending ? '<span class="pill">Draft pending</span>' : ''}</td>`;
      body += `<td>${updated}</td>`;
      body += `<td style="text-align: right; white-space: nowrap">`;
      body += `<a href="/admin/rules/${row.id}/edit" style="margin-right: 10px">Edit Draft</a>`;
      body += `<form method="post" action="/admin/rules/${row.id}/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \\'${slug}\\'? This cannot be undone.');">`;
      if (csrf) {
        body += `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />`;
      }
      body += `<button type="submit" class="danger">Delete</button>`;
      body += `</form>`;
      body += `</td>`;
      body += `</tr>`;
    }
    body += '</tbody></table>';
  }
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
    console.error('admin rules list failed', err);
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
    console.error('admin rule draft load failed', err);
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
    console.error('admin save rule draft failed', err);
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
    console.error('admin delete rule failed', err);
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
    console.error('admin create rule failed', err);
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
    console.error('admin rule detail failed', err);
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
    console.error('admin new rule version form failed', err);
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
    console.error('admin create rule version failed', err);
    res.status(500).send('Failed to create rule version');
  }
});
function renderPageForm(opts: {
  page?: any;
  error?: string | null;
  success?: string | null;
  csrfToken?: string | null;
}): string {
  const page = opts.page ?? {};
  const error = opts.error;
  const success = opts.success;
  const isEdit = !!page.id;
  const title = isEdit ? 'Edit Page' : 'New Page';
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
  body += `<label>Slug (URL path)
    <input type="text" name="slug" value="${escapeHtml(slugValue)}" />
    <div class="field-hint">Lowercase; a–z, 0–9, '-' only; up to 4 segments separated by '/'. The home page uses slug <code>home</code> and is served at <code>/</code>.</div>
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
  body += `<label for="${escapeHtml(pageMdId)}">Markdown</label>`;
  body += `<textarea id="${escapeHtml(pageMdId)}" name="markdown" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(htmlValue)}">${escapeHtml(markdownValue)}</textarea>`;
  body += `<div class="field-hint">Markdown is rendered server-side using the restricted contract in <code>agents/requirements/markdown.md</code>.</div>`;
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
`;

  return renderAdminPage({ title, bodyHtml: body, active: 'pages' });
}

pagesRouter.get('/admin/pages/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie);
  const csrfToken = cookies['csrf'] || '';
  const doc = renderPageForm({ page: {}, error: null, success: null, csrfToken });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(doc);
});

pagesRouter.post('/admin/pages', async (req: any, res: any) => {
  try {
    const body = (req.body || {}) as any;
    const rawSlug = String(body.slug || '');
    const rawTitle = String(body.title || '');
    const rawMarkdown = String(body.markdown || '');
    const rawVisibility = String(body.visibility || 'public');

    const slug = normalizePageSlug(rawSlug);
    if (!slug) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: body, error: 'Slug is required and must use only a–z, 0–9, \'-\' and \'/\' (max 4 segments).', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (isReservedPageSlug(slug)) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: body, error: 'Slug collides with a reserved route (global-feed, channels, groups, users, admin, api, auth, login, logout, assets, static). Please choose a different slug.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    const title = rawTitle.trim() || slug;
    const visibility: PageVisibility = (['public', 'authenticated', 'space_moderator', 'space_admin'] as PageVisibility[]).includes(rawVisibility as PageVisibility)
      ? (rawVisibility as PageVisibility)
      : 'public';

    const { html } = renderMarkdown(rawMarkdown);

    const db = getPool();
    const userId = req.user && req.user.id ? Number(req.user.id) : null;
    try {
      await db.query(
        `INSERT INTO pages (slug, title, markdown, html, visibility, layout, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'default', ?, ?)`,
        [slug, title, rawMarkdown, html, visibility, userId, userId]
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_pages_slug')) {
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderPageForm({ page: body, error: 'Slug already exists. Please choose a different slug.', success: null, csrfToken });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect('/admin/pages');
  } catch (err) {
    console.error('admin create page failed', err);
    res.status(500).send('Failed to create page');
  }
});

pagesRouter.get('/admin/pages/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Page not found');
    const db = getPool();
    const [rows] = await db.query(`SELECT id, slug, title, markdown, html, visibility FROM pages WHERE id = ? LIMIT 1`, [id]);
    const page = (rows as any[])[0];
    if (!page) return res.status(404).send('Page not found');
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const doc = renderPageForm({ page, error: null, success: null, csrfToken });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    console.error('admin edit page load failed', err);
    res.status(500).send('Failed to load page for editing');
  }
});

pagesRouter.post('/admin/pages/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Page not found');

    const body = (req.body || {}) as any;
    const rawSlug = String(body.slug || '');
    const rawTitle = String(body.title || '');
    const rawMarkdown = String(body.markdown || '');
    const rawVisibility = String(body.visibility || 'public');

    const slug = normalizePageSlug(rawSlug);
    if (!slug) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: { ...body, id }, error: 'Slug is required and must use only a–z, 0–9, \'-\' and \'/\' (max 4 segments).', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    if (isReservedPageSlug(slug)) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderPageForm({ page: { ...body, id }, error: 'Slug collides with a reserved route (global-feed, channels, groups, users, admin, api, auth, login, logout, assets, static). Please choose a different slug.', success: null, csrfToken });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(doc);
    }
    const title = rawTitle.trim() || slug;
    const visibility: PageVisibility = (['public', 'authenticated', 'space_moderator', 'space_admin'] as PageVisibility[]).includes(rawVisibility as PageVisibility)
      ? (rawVisibility as PageVisibility)
      : 'public';

    const { html } = renderMarkdown(rawMarkdown);
    const db = getPool();
    const userId = req.user && req.user.id ? Number(req.user.id) : null;

    try {
      await db.query(
        `UPDATE pages
            SET slug = ?, title = ?, markdown = ?, html = ?, visibility = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [slug, title, rawMarkdown, html, visibility, userId, id]
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_pages_slug')) {
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderPageForm({ page: { ...body, id }, error: 'Slug already exists. Please choose a different slug.', success: null, csrfToken });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(doc);
      }
      throw err;
    }

    res.redirect('/admin/pages');
  } catch (err) {
    console.error('admin update page failed', err);
    res.status(500).send('Failed to update page');
  }
});

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
    { title: 'Lower Thirds', href: '/admin/lower-thirds', desc: 'Manage system lower third templates (SVG + descriptor)' },
    { title: 'Audio Configs', href: '/admin/audio-configs', desc: 'Presets for Mix/Replace + ducking (creators pick when producing)' },
    { title: 'Media Jobs', href: '/admin/media-jobs', desc: 'Debug ffmpeg mastering jobs (logs, retries, purge)' },
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
    console.error('admin lower thirds list failed', err)
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
    console.error('admin lower thirds new failed', err)
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
    console.error('archive lower third failed', err)
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
    console.error('unarchive lower third failed', err)
    res.status(500).send('Failed to unarchive')
  }
})

pagesRouter.get('/admin/audio', async (req: any, res: any) => {
  try {
    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, original_filename, modified_filename, description, size_bytes
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
        body += '<div class="adm-audio-card">'
        body += `<div class="adm-audio-title">${name}</div>`
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
    console.error('admin audio list failed', err)
    res.status(500).send('Failed to load audio')
  }
})

	function renderAdminAudioEditPage(opts: { audio: any; csrfToken?: string; error?: string | null; notice?: string | null }): string {
  const audio = opts.audio || {}
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const error = opts.error ? String(opts.error) : ''
  const notice = opts.notice ? String(opts.notice) : ''
  const id = Number(audio.id)
  const nameValue = String(audio.modified_filename || audio.original_filename || '').trim()
  const descValue = audio.description != null ? String(audio.description) : ''

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
  body += `<label>Description
    <textarea name="description" style="min-height: 120px">${escapeHtml(descValue)}</textarea>
    <div class="field-hint">Optional.</div>
  </label>`
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
      `SELECT id, original_filename, modified_filename, description
         FROM uploads
        WHERE id = ? AND kind = 'audio' AND is_system = 1
        LIMIT 1`,
      [id]
    )
    const audio = (rows as any[])[0]
    if (!audio) return res.status(404).send('Not found')
    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''
    const doc = renderAdminAudioEditPage({ audio, csrfToken })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    console.error('admin audio edit page failed', err)
    res.status(500).send('Failed to load audio')
  }
})

pagesRouter.post('/admin/audio/:id', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(404).send('Not found')

    const rawName = String(req.body?.name || '').trim()
    const rawDesc = String(req.body?.description || '')
    const desc = rawDesc.trim().length ? rawDesc.trim() : null

    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, original_filename, modified_filename, description
         FROM uploads
        WHERE id = ? AND kind = 'audio' AND is_system = 1
        LIMIT 1`,
      [id]
    )
    const audio = (rows as any[])[0]
    if (!audio) return res.status(404).send('Not found')

    const cookies = parseCookies(req.headers.cookie)
    const csrfToken = cookies['csrf'] || ''

    if (!rawName) {
      const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: rawDesc }, csrfToken, error: 'Name is required.' })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }
    if (rawName.length > 512) {
      const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: rawDesc }, csrfToken, error: 'Name is too long (max 512 characters).' })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }

    await db.query(
      `UPDATE uploads
          SET modified_filename = ?,
              description = ?
        WHERE id = ? AND kind = 'audio' AND is_system = 1`,
      [rawName, desc, id]
    )

    const doc = renderAdminAudioEditPage({ audio: { ...audio, modified_filename: rawName, description: desc }, csrfToken, notice: 'Saved.' })
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(doc)
  } catch (err) {
    console.error('admin audio update failed', err)
	    res.status(500).send('Failed to save audio')
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
    console.error('admin audio delete failed', err)
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
    console.error('admin audio-configs list failed', err)
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
    console.error('admin audio-config edit page failed', err)
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
    console.error('admin audio-config archive failed', err)
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

pagesRouter.get('/admin/media-jobs', async (req: any, res: any) => {
  try {
    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, type, status, priority, attempts, max_attempts, error_code, error_message, created_at, updated_at, completed_at
         FROM media_jobs
        ORDER BY id DESC
        LIMIT 250`
    )
    const items = rows as any[]
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
      body += '<table><thead><tr><th>ID</th><th>Status</th><th>Type</th><th>Attempts</th><th>Created</th><th>Updated</th><th>Actions</th></tr></thead><tbody>'
      for (const r of items) {
        const id = Number(r.id)
        const st = String(r.status || '')
        const type = String(r.type || '')
        const attempts = `${Number(r.attempts || 0)}/${Number(r.max_attempts || 0)}`
        const created = String(r.created_at || '')
        const updated = String(r.updated_at || '')
        body += `<tr>`
        body += `<td><a href="/admin/media-jobs/${id}">#${id}</a></td>`
        body += `<td>${statusPill(st)}</td>`
        body += `<td>${escapeHtml(type)}</td>`
        body += `<td>${escapeHtml(attempts)}</td>`
        body += `<td>${escapeHtml(created)}</td>`
        body += `<td>${escapeHtml(updated)}</td>`
        body += `<td style="white-space:nowrap">
          <a class="btn" href="/admin/media-jobs/${id}" style="padding:6px 10px; font-size:12px">View</a>
          <form method="post" action="/admin/media-jobs/${id}/retry" style="display:inline" onsubmit="return confirm('Retry media job #${id}?');">
            ${csrfToken ? `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}" />` : ''}
            <button type="submit" class="btn" style="padding:6px 10px; font-size:12px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.18)">Retry</button>
          </form>
          <form method="post" action="/admin/media-jobs/${id}/purge" style="display:inline" onsubmit="return confirm('Purge logs/artifacts for media job #${id}?');">
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
    console.error('admin media-jobs list failed', err)
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
    console.error('admin media-jobs retry failed', err)
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
      body += '<table><thead><tr><th>#</th><th>Started</th><th>Finished</th><th>Exit</th><th>Logs</th></tr></thead><tbody>'
      for (const a of attempts) {
        const aid = Number(a.id)
        const no = Number(a.attempt_no)
        const started = String(a.started_at || '')
        const finished = a.finished_at ? String(a.finished_at) : ''
        const exit = a.exit_code != null ? String(a.exit_code) : ''
        const hasStdout = a.stdout_s3_bucket && a.stdout_s3_key
        const hasStderr = a.stderr_s3_bucket && a.stderr_s3_key
        body += `<tr>`
        body += `<td>${escapeHtml(String(no))}</td>`
        body += `<td>${escapeHtml(started)}</td>`
        body += `<td>${escapeHtml(finished)}</td>`
        body += `<td>${escapeHtml(exit)}</td>`
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
    console.error('admin media-job detail failed', err)
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
    console.error('admin media-job log stream failed', err)
    res.status(500).send('Failed to load log')
  }
})

pagesRouter.post('/admin/media-jobs/:id/purge', async (req: any, res: any) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Bad id')
    const db = getPool()
    const [rows] = await db.query(`SELECT * FROM media_job_attempts WHERE job_id = ?`, [id])
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
    // artifacts prefix best-effort
    for (const a of attempts) {
      if (a.artifacts_s3_bucket && a.artifacts_s3_prefix) {
        await deleteS3Prefix(String(a.artifacts_s3_bucket), String(a.artifacts_s3_prefix))
      }
    }
    await db.query(
      `UPDATE media_job_attempts
          SET stdout_s3_bucket = NULL, stdout_s3_key = NULL,
              stderr_s3_bucket = NULL, stderr_s3_key = NULL,
              artifacts_s3_bucket = NULL, artifacts_s3_prefix = NULL
        WHERE job_id = ?`,
      [id]
    )
    res.redirect(`/admin/media-jobs/${id}`)
  } catch (err) {
    console.error('admin media-job purge failed', err)
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
      const [rows] = await db.query(`SELECT * FROM media_job_attempts WHERE job_id = ?`, [id])
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
      await db.query(
        `UPDATE media_job_attempts
            SET stdout_s3_bucket = NULL, stdout_s3_key = NULL,
                stderr_s3_bucket = NULL, stderr_s3_key = NULL,
                artifacts_s3_bucket = NULL, artifacts_s3_prefix = NULL
          WHERE job_id = ?`,
        [id]
      )
    }
    res.redirect('/admin/media-jobs')
  } catch (err) {
    console.error('admin media-jobs bulk purge failed', err)
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
    console.error('admin review landing failed', err)
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
    console.error('admin review global failed', err)
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
    console.error('admin review personal list failed', err)
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
    console.error('admin review personal queue failed', err)
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
    console.error('admin review groups list failed', err)
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
    console.error('admin review channels list failed', err)
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
    console.error('admin review group queue failed', err)
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
    console.error('admin review channel queue failed', err)
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
    console.error('admin users list failed', err)
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
    console.error('admin user detail failed', err)
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
    console.error('admin create suspension failed', err)
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
    console.error('admin groups list failed', err)
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
    console.error('admin group detail failed', err)
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
    console.error('admin channels list failed', err)
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
    console.error('admin channel detail failed', err)
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
    console.error('admin dev page failed', err)
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
    console.error('admin dev truncate failed', err)
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

pagesRouter.get('/publish/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/produce', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/logo-configs', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
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
