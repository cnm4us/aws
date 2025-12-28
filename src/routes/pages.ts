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

const publicDir = path.join(process.cwd(), 'public');

function serveHtml(res: any, relativePath: string) {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, relativePath));
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
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/rules/', (_req: any, res: any) => {
  serveHtml(res, path.join('app', 'index.html'));
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

type AdminNavKey = 'groups' | 'channels' | 'rules' | 'categories' | 'cultures' | 'pages';

const ADMIN_NAV_ITEMS: Array<{ key: AdminNavKey; label: string; href: string }> = [
  { key: 'groups', label: 'Groups', href: '/admin/groups' },
  { key: 'channels', label: 'Channels', href: '/admin/channels' },
  { key: 'rules', label: 'Rules', href: '/admin/rules' },
  { key: 'categories', label: 'Categories', href: '/admin/categories' },
  { key: 'cultures', label: 'Cultures', href: '/admin/cultures' },
  { key: 'pages', label: 'Pages', href: '/admin/pages' },
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

pagesRouter.get('/uploads', (_req, res) => {
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

// Space review (pre-publish approval) — standard SPA bundle
pagesRouter.get('/space/review/groups', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/space/review/channels', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

// Forbidden page (shows message and requested URL via querystring)
pagesRouter.get('/forbidden', (_req, res) => {
  serveHtml(res, 'forbidden.html');
});

// Split admin pages
pagesRouter.get('/admin/settings', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/admin/users', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
// SPA Admin (beta) — users list and (later) detail
pagesRouter.get('/adminx/users', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/adminx/users/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/adminx/settings', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/users/new', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/users/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

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
  draft?: { name?: string; commentsPolicy?: 'on' | 'off' | 'inherit'; requireReview?: boolean; cultureIds?: number[] };
}): string {
  const kindLabel = opts.kind === 'group' ? 'Group' : 'Channel'
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : ''
  const notice = opts.notice ? String(opts.notice) : ''
  const error = opts.error ? String(opts.error) : ''

  const space = opts.space
  const settings = space.settings || {}

  const nameValue = opts.draft?.name != null ? String(opts.draft.name) : String(space.name || '')
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
        draft: { name: rawName, commentsPolicy, requireReview, cultureIds },
      })
      res.set('Content-Type', 'text/html; charset=utf-8')
      return res.status(400).send(doc)
    }

    await adminSvc.updateSpace(id, { name, commentsPolicy, requireReview, cultureIds })
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
      'Failed to save.'

    if (!detail || detail.type !== 'channel') return res.status(500).send('Failed to save channel')
    const draftName = body.name != null ? String(body.name) : ''
    const commentsPolicy = String(body.commentsPolicy || 'inherit').toLowerCase() as any
    const requireReview = toFormBool(body.requireReview)
    const cultureIds = toIdList(body.cultureIds)
    const doc = renderAdminSpaceDetailPage({
      kind: 'channel',
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

pagesRouter.get('/admin/channel/:id', (req, res) => {
  res.redirect(`/admin/channels/${encodeURIComponent(String(req.params.id || ''))}`)
});
pagesRouter.get('/admin/channels/:id/user/:userId', (req, res) => {
  res.redirect(`/admin/channels/${encodeURIComponent(String(req.params.id || ''))}`)
});

// Dev utilities page
pagesRouter.get('/admin/dev', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

// Admin moderation overviews (SPA)
pagesRouter.get('/admin/moderation/groups', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/moderation/channels', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
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
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/channels', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
// Exact one-segment slug (avoid matching admin/moderation subpaths)
pagesRouter.get(/^\/groups\/([^\/]+)\/?$/, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get(/^\/channels\/([^\/]+)\/?$/, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

// Members default and explicit route
pagesRouter.get('/spaces/:id/admin', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/spaces/:id/admin/members', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
// Per-member admin page
pagesRouter.get('/spaces/:id/admin/users/:userId', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
// Space settings
pagesRouter.get('/spaces/:id/admin/settings', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/spaces/:id/review', requireSpaceModeratorPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
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

pagesRouter.get('/uploads/new', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/publish', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/publish/:id', (_req, res) => {
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
