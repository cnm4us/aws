import { Router } from 'express';
import path from 'path';
import { BUILD_TAG } from '../utils/version';
import { requireSiteAdminPage, requireSpaceAdminPage, requireSpaceModeratorPage } from '../middleware/auth';
import { getPool } from '../db'
import { renderMarkdown } from '../utils/markdown'
import { parseCookies } from '../utils/cookies'
import { can } from '../security/permissions'
import { PERM } from '../security/perm'

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
              guidance_html
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
    jsonNoStore(res);
    res.json({
      slug,
      title: rule.title != null ? String(rule.title) : '',
      html: String(current.html || ''),
      ...(current.short_description ? { shortDescription: String(current.short_description) } : {}),
      ...(current.allowed_examples_html ? { allowedExamplesHtml: String(current.allowed_examples_html) } : {}),
      ...(current.disallowed_examples_html ? { disallowedExamplesHtml: String(current.disallowed_examples_html) } : {}),
      ...(includeGuidance && current.guidance_html ? { guidanceHtml: String(current.guidance_html) } : {}),
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
              guidance_html
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
    if (version.guidance_html) {
      const showGuidance = await canViewGuidance(req);
      if (showGuidance) {
        body += `<div class="section">\n`;
        body += `<div class="section-title">Guidance (moderators only)</div>\n`;
        body += String(version.guidance_html || '');
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

function renderAdminPage(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title || 'Pages Admin');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${safeTitle}</title>
    <style>
      html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #05070a; color: #f5f5f5; }
      a { color: #9cf; }
      main { max-width: 880px; margin: 0 auto; padding: 20px 16px 40px; line-height: 1.5; }
      h1 { font-size: 1.7rem; margin-bottom: 0.5rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
      th, td { border-bottom: 1px solid rgba(255,255,255,0.15); padding: 6px 4px; text-align: left; }
      th { font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.8; }
      input[type="text"], textarea, select {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3);
        background: rgba(0,0,0,0.6);
        color: #f5f5f5;
        font-family: inherit;
        font-size: 0.95rem;
      }
      textarea { min-height: 220px; resize: vertical; }
      label { display: block; margin-top: 10px; font-size: 0.9rem; }
      .field-hint { font-size: 0.8rem; opacity: 0.7; margin-top: 2px; }
      .actions { margin-top: 14px; display: flex; gap: 10px; align-items: center; }
      button {
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.35);
        background: #1976d2;
        color: #fff;
        cursor: pointer;
        font-size: 0.9rem;
      }
      button.danger {
        background: #b71c1c;
        border-color: rgba(255,255,255,0.35);
      }
      button.danger:hover { background: #c62828; }
      .error { margin-top: 8px; color: #ffb3b3; font-size: 0.85rem; }
      .success { margin-top: 8px; color: #b3ffd2; font-size: 0.85rem; }
      .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
      .toolbar a { font-size: 0.9rem; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.25); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.85; }
    </style>
  </head>
  <body>
    <main>
${bodyHtml}
    </main>
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
    const doc = renderAdminPage('Pages', body);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    console.error('admin pages list failed', err);
    res.status(500).send('Failed to load pages');
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
            rv.guidance_markdown, rv.guidance_html
       FROM rules r
       JOIN rule_versions rv ON rv.id = r.current_version_id
      WHERE r.id = ?
      LIMIT 1`,
    [ruleId]
  );
  const base = (baseRows as any[])[0];
  if (!base) return null;

  await db.query(
    `INSERT IGNORE INTO rule_drafts (
       rule_id, markdown, html,
       short_description,
       allowed_examples_markdown, allowed_examples_html,
       disallowed_examples_markdown, disallowed_examples_html,
       guidance_markdown, guidance_html,
       updated_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      ruleId,
      String(base.markdown || ''),
      String(base.html || ''),
      base.short_description != null ? String(base.short_description) : null,
      base.allowed_examples_markdown != null ? String(base.allowed_examples_markdown) : null,
      base.allowed_examples_html != null ? String(base.allowed_examples_html) : null,
      base.disallowed_examples_markdown != null ? String(base.disallowed_examples_markdown) : null,
      base.disallowed_examples_html != null ? String(base.disallowed_examples_html) : null,
      base.guidance_markdown != null ? String(base.guidance_markdown) : null,
      base.guidance_html != null ? String(base.guidance_html) : null,
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

  const guidanceValue = draft.guidance_markdown ? String(draft.guidance_markdown) : '';
  const guidanceHtmlValue = draft.guidance_html ? String(draft.guidance_html) : '';

  const changeSummaryId = `rule_draft_change_summary_${String(rule.id)}`;

  const mdId = `rule_draft_markdown_${String(rule.id)}`;
  const allowedId = `rule_draft_allowed_${String(rule.id)}`;
  const disallowedId = `rule_draft_disallowed_${String(rule.id)}`;
  const guidanceId = `rule_draft_guidance_${String(rule.id)}`;

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

  body += `<label for="${escapeHtml(guidanceId)}">Guidance</label>`;
  body += `<textarea id="${escapeHtml(guidanceId)}" name="guidance" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(guidanceHtmlValue)}">${escapeHtml(guidanceValue)}</textarea>`;
  body += `<div class="field-hint">Guidance is intended for moderators and automated agents; do not expose it to regular users.</div>`;

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

  return renderAdminPage('Edit Rule Draft', body);
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
  return renderAdminPage('Rules', body);
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
  const guidanceValue = rule.guidance_markdown ? String(rule.guidance_markdown) : (rule.guidance ? String(rule.guidance) : '');
  const guidanceHtmlValue = rule.guidance_html ? String(rule.guidance_html) : '';
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
  const guidanceId = `rule_guidance_${isNewVersion ? 'v' : 'r'}_${rule.id ? String(rule.id) : 'new'}`;
  body += `<label for="${escapeHtml(mdId)}">Long Description</label>`;
  body += `<textarea id="${escapeHtml(mdId)}" name="markdown" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(htmlValue)}">${escapeHtml(markdownValue)}</textarea>`;
  body += `<div class="field-hint">Markdown is rendered server-side using the restricted contract in <code>agents/requirements/markdown.md</code>.</div>`;

  body += `<label for="${escapeHtml(allowedId)}">Allowed Examples</label>`;
  body += `<textarea id="${escapeHtml(allowedId)}" name="allowedExamples" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(allowedExamplesHtmlValue)}">${escapeHtml(allowedExamplesValue)}</textarea>`;

  body += `<label for="${escapeHtml(disallowedId)}">Disallowed Examples</label>`;
  body += `<textarea id="${escapeHtml(disallowedId)}" name="disallowedExamples" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(disallowedExamplesHtmlValue)}">${escapeHtml(disallowedExamplesValue)}</textarea>`;

  body += `<label for="${escapeHtml(guidanceId)}">Guidance</label>`;
  body += `<textarea id="${escapeHtml(guidanceId)}" name="guidance" data-md-wysiwyg="1" data-md-initial-html="${escapeHtml(guidanceHtmlValue)}">${escapeHtml(guidanceValue)}</textarea>`;
  body += `<div class="field-hint">This field is intended for moderators and automated agents; do not expose it to regular users.</div>`;
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

  return renderAdminPage(title, body);
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
    const guidanceMarkdown = body.guidance ? String(body.guidance) : '';
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
                guidance_markdown, guidance_html
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
      await conn.query(
        `INSERT INTO rule_drafts (
           rule_id, markdown, html,
           short_description,
           allowed_examples_markdown, allowed_examples_html,
           disallowed_examples_markdown, disallowed_examples_html,
           guidance_markdown, guidance_html,
           updated_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          String(base.markdown || ''),
          String(base.html || ''),
          base.short_description != null ? String(base.short_description) : null,
          base.allowed_examples_markdown != null ? String(base.allowed_examples_markdown) : null,
          base.allowed_examples_html != null ? String(base.allowed_examples_html) : null,
          base.disallowed_examples_markdown != null ? String(base.disallowed_examples_markdown) : null,
          base.disallowed_examples_html != null ? String(base.disallowed_examples_html) : null,
          base.guidance_markdown != null ? String(base.guidance_markdown) : null,
          base.guidance_html != null ? String(base.guidance_html) : null,
          userId,
        ]
      );
    }

    const html = renderMarkdown(markdown).html;
    const allowedExamplesHtml = allowedExamplesMarkdown ? renderMarkdown(allowedExamplesMarkdown).html : '';
    const disallowedExamplesHtml = disallowedExamplesMarkdown ? renderMarkdown(disallowedExamplesMarkdown).html : '';
    const guidanceHtml = guidanceMarkdown ? renderMarkdown(guidanceMarkdown).html : '';

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
        guidanceMarkdown || null,
        guidanceMarkdown ? guidanceHtml : null,
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
           change_summary,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          guidanceMarkdown || null,
          guidanceMarkdown ? guidanceHtml : null,
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
    const guidanceMarkdown = body.guidance ? String(body.guidance) : '';
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
    const guidanceHtml = guidanceMarkdown ? renderMarkdown(guidanceMarkdown).html : '';
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
           change_summary, created_by
         )
         VALUES (
           ?, 1, ?, ?,
           ?,
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
          guidanceMarkdown || null,
          guidanceMarkdown ? guidanceHtml : null,
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

    const doc = renderAdminPage('Rule detail', body);
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
                guidance_markdown, guidance_html
           FROM rule_versions
          WHERE id = ?
          LIMIT 1`,
        [rule.current_version_id]
      );
      const v = (verRows as any[])[0];
      if (v) {
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
          guidance_markdown: v.guidance_markdown,
          guidance_html: v.guidance_html,
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
    const guidanceMarkdown = body.guidance ? String(body.guidance) : '';

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
    const guidanceHtml = guidanceMarkdown ? renderMarkdown(guidanceMarkdown).html : '';
    const userId = req.user && req.user.id ? Number(req.user.id) : null;

    const [insVersion] = await db.query(
      `INSERT INTO rule_versions (
         rule_id, version, markdown, html,
         short_description,
         allowed_examples_markdown, allowed_examples_html,
         disallowed_examples_markdown, disallowed_examples_html,
         guidance_markdown, guidance_html,
         change_summary, created_by
       )
       VALUES (
         ?, ?, ?, ?,
         ?,
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
        guidanceMarkdown || null,
        guidanceMarkdown ? guidanceHtml : null,
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

  return renderAdminPage(title, body);
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

pagesRouter.get('/admin/groups', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
// Singular fallbacks for convenience
pagesRouter.get('/admin/group', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/groups/new', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/groups/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/group/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/groups/:id/user/:userId', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/admin/channels', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/channel', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/channels/new', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/channels/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/channel/:id', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/admin/channels/:id/user/:userId', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
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
pagesRouter.get('/spaces/:id/moderation', requireSpaceModeratorPage, (_req, res) => {
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
pagesRouter.get('/groups/:slug/moderation', resolveIdFromSlug('group'), requireSpaceModeratorPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/moderation`);
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
pagesRouter.get('/channels/:slug/moderation', resolveIdFromSlug('channel'), requireSpaceModeratorPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/moderation`);
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
pagesRouter.get('/groups/:id/moderation', requireSpaceModeratorPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/moderation`);
});
pagesRouter.get('/channels/:id/moderation', requireSpaceModeratorPage, (req: any, res) => {
  const id = req.params.id;
  res.redirect(`/spaces/${id}/moderation`);
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
