import { Router } from 'express';
import path from 'path';
import { BUILD_TAG } from '../utils/version';
import { requireSiteAdminPage, requireSpaceAdminPage, requireSpaceModeratorPage } from '../middleware/auth';
import { getPool } from '../db'
import { renderMarkdown } from '../utils/markdown'
import { parseCookies } from '../utils/cookies'

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

pagesRouter.get('/', async (req: any, res: any) => {
  try {
    const db = getPool();
    const [rows] = await db.query(`SELECT slug, title, html, visibility FROM pages WHERE slug = 'home' LIMIT 1`);
    const page = (rows as any[])[0];
    if (!page) {
      // No CMS-configured home page yet; fall back to SPA shell.
      return serveHtml(res, path.join('app', 'index.html'));
    }
    const ok = await ensurePageVisibility(req, res, page.visibility as PageVisibility);
    if (!ok) return;
    const doc = renderPageDocument(page.title || 'Home', String(page.html || ''));
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(doc);
  } catch (err) {
    console.error('home page render failed', err);
    res.status(500).send('Failed to load home page');
  }
});

pagesRouter.get(/^\/pages\/(.+)$/, async (req: any, res: any) => {
  try {
    const rawSlug = String((req.params as any)[0] || '');
    const slug = normalizePageSlug(decodeURIComponent(rawSlug));
    if (!slug || slug === 'home') {
      return res.status(404).send('Page not found');
    }
    const db = getPool();
    const [rows] = await db.query(`SELECT slug, title, html, visibility FROM pages WHERE slug = ? LIMIT 1`, [slug]);
    const page = (rows as any[])[0];
    if (!page) {
      return res.status(404).send('Page not found');
    }
    const ok = await ensurePageVisibility(req, res, page.visibility as PageVisibility);
    if (!ok) return;
    const doc = renderPageDocument(page.title || page.slug, String(page.html || ''));
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(doc);
  } catch (err) {
    console.error('page render failed', err);
    res.status(500).send('Failed to load page');
  }
});

// -------- Public Rules (latest + specific versions) --------

pagesRouter.get(/^\/rules\/(.+?)\/v:(\d+)$/, async (req: any, res: any) => {
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
      `SELECT id, version, html, created_at, change_summary
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
    body += `<p class="rule-meta">Version v${escapeHtml(String(version.version))}`;
    if (createdLabel) {
      body += ` — published ${escapeHtml(createdLabel)}`;
    }
    body += `</p>\n`;
    if (version.change_summary) {
      body += `<p class="rule-meta">${escapeHtml(String(version.change_summary))}</p>\n`;
    }
    body += String(version.html || '');

    const doc = renderPageDocument(titleText, body);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(doc);
  } catch (err) {
    console.error('rule version render failed', err);
    res.status(500).send('Failed to load rule version');
  }
});

pagesRouter.get(/^\/rules\/(.+)$/, async (req: any, res: any) => {
  try {
    const rawSlug = String((req.params as any)[0] || '');
    const slug = normalizePageSlug(decodeURIComponent(rawSlug));
    if (!slug) {
      return res.status(404).send('Rule not found');
    }

    const db = getPool();
    const [ruleRows] = await db.query(
      `SELECT id, slug, title, visibility, current_version_id
         FROM rules
        WHERE slug = ?
        LIMIT 1`,
      [slug]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule || !rule.current_version_id) {
      return res.status(404).send('Rule not found');
    }

    const [versionRows] = await db.query(
      `SELECT id, version, html, created_at, change_summary
         FROM rule_versions
        WHERE id = ? AND rule_id = ?
        LIMIT 1`,
      [rule.current_version_id, rule.id]
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
    body += `<p class="rule-meta">Current version v${escapeHtml(String(version.version))}`;
    if (createdLabel) {
      body += ` — published ${escapeHtml(createdLabel)}`;
    }
    body += ` (<a href="/rules/${encodeURIComponent(slug)}/v:${encodeURIComponent(String(version.version))}">permalink</a>)</p>\n`;
    if (version.change_summary) {
      body += `<p class="rule-meta">${escapeHtml(String(version.change_summary))}</p>\n`;
    }
    body += String(version.html || '');

    const doc = renderPageDocument(titleText, body);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(doc);
  } catch (err) {
    console.error('rule render failed', err);
    res.status(500).send('Failed to load rule');
  }
});

// -------- Admin: Pages (server-rendered, minimal JS) --------

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

function renderRuleListPage(rules: any[]): string {
  let body = '<h1>Rules</h1>';
  body += '<div class="toolbar"><div><span class="pill">Rules</span></div><div><a href="/admin/rules/new">New rule</a></div></div>';
  if (!rules.length) {
    body += '<p>No rules have been created yet.</p>';
  } else {
    body += '<table><thead><tr><th>Slug</th><th>Title</th><th>Visibility</th><th>Current Version</th><th>Updated</th></tr></thead><tbody>';
    for (const row of rules) {
      const slug = escapeHtml(String(row.slug || ''));
      const title = escapeHtml(String(row.title || ''));
      const vis = escapeHtml(String(row.visibility || 'public'));
      const ver = row.current_version ?? row.current_version_id ?? null;
      const versionLabel = ver != null ? escapeHtml(String(ver)) : '';
      const updated = row.updated_at ? escapeHtml(String(row.updated_at)) : '';
      body += `<tr><td><a href="/admin/rules/${row.id}">${slug}</a></td><td>${title}</td><td>${vis}</td><td>${versionLabel}</td><td>${updated}</td></tr>`;
    }
    body += '</tbody></table>';
  }
  return renderAdminPage('Rules', body);
}

function renderRuleForm(opts: {
  rule?: any;
  error?: string | null;
  success?: string | null;
  csrfToken?: string | null;
  isNewVersion?: boolean;
}): string {
  const rule = opts.rule ?? {};
  const error = opts.error;
  const success = opts.success;
  const csrfToken = opts.csrfToken ? String(opts.csrfToken) : '';
  const isEdit = !!rule.id && !opts.isNewVersion;
  const isNewVersion = !!opts.isNewVersion;
  const title = isNewVersion ? 'New Rule Version' : (isEdit ? 'Edit Rule' : 'New Rule');
  const slugValue = rule.slug ? String(rule.slug) : '';
  const titleValue = rule.title ? String(rule.title) : '';
  const visibilityValue = rule.visibility ? String(rule.visibility) : 'public';
  const markdownValue = rule.markdown ? String(rule.markdown) : '';
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
  }
  body += `<label>Markdown
    <textarea name="markdown">${escapeHtml(markdownValue)}</textarea>
    <div class="field-hint">Markdown is rendered server-side using the restricted contract in <code>agents/requirements/markdown.md</code>.</div>
  </label>`;
  body += `<label>Change summary (optional)
    <input type="text" name="changeSummary" value="${escapeHtml(changeSummaryValue)}" />
    <div class="field-hint">Short description of what changed for this version (e.g., “Clarify harassment examples”).</div>
  </label>`;
  body += `<div class="actions">
    <button type="submit">${isNewVersion ? 'Create version' : (isEdit ? 'Save changes' : 'Create rule')}</button>
  </div>`;
  body += `</form>`;

  return renderAdminPage(title, body);
}

pagesRouter.get('/admin/rules', async (req: any, res: any) => {
  try {
    const db = getPool();
    const [rows] = await db.query(
      `SELECT r.id, r.slug, r.title, r.visibility, r.updated_at, rv.version AS current_version
         FROM rules r
         LEFT JOIN rule_versions rv ON rv.id = r.current_version_id
        ORDER BY r.slug`
    );
    const rules = rows as any[];
    const doc = renderRuleListPage(rules);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(doc);
  } catch (err) {
    console.error('admin rules list failed', err);
    res.status(500).send('Failed to load rules');
  }
});

pagesRouter.get('/admin/rules/new', async (req: any, res: any) => {
  const cookies = parseCookies(req.headers.cookie);
  const csrfToken = cookies['csrf'] || '';
  const doc = renderRuleForm({ rule: {}, error: null, success: null, csrfToken });
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

    const slug = normalizePageSlug(rawSlug);
    if (!slug) {
      const cookies = parseCookies(req.headers.cookie);
      const csrfToken = cookies['csrf'] || '';
      const doc = renderRuleForm({ rule: body, error: 'Slug is required and must use only a–z, 0–9, \'-\' and \'/\' (max 4 segments).', success: null, csrfToken });
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

    let ruleId: number;
    let versionId: number;
    try {
      const [insRule] = await db.query(
        `INSERT INTO rules (slug, title, visibility, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?)`,
        [slug, title, visibility, userId, userId]
      );
      ruleId = Number((insRule as any).insertId);
      const [insVersion] = await db.query(
        `INSERT INTO rule_versions (rule_id, version, markdown, html, change_summary, created_by)
         VALUES (?, 1, ?, ?, ?, ?)`,
        [ruleId, rawMarkdown, html, changeSummary || null, userId]
      );
      versionId = Number((insVersion as any).insertId);
      await db.query(
        `UPDATE rules SET current_version_id = ? WHERE id = ?`,
        [versionId, ruleId]
      );
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('ER_DUP_ENTRY') || msg.includes('uniq_rules_slug')) {
        const cookies = parseCookies(req.headers.cookie);
        const csrfToken = cookies['csrf'] || '';
        const doc = renderRuleForm({ rule: body, error: 'Slug already exists. Please choose a different slug.', success: null, csrfToken });
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

    let body = `<h1>Rule: ${escapeHtml(rule.slug || rule.title || '')}</h1>`;
    body += '<div class="toolbar"><div><a href="/admin/rules">\u2190 Back to rules</a></div><div><a href="/admin/rules/' + escapeHtml(String(rule.id)) + '/versions/new">New version</a></div></div>';
    body += `<p><span class="pill">Visibility: ${escapeHtml(String(rule.visibility || 'public'))}</span></p>`;
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
      `SELECT id, slug, title
         FROM rules
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    const rule = (ruleRows as any[])[0];
    if (!rule) return res.status(404).send('Rule not found');
    const cookies = parseCookies(req.headers.cookie);
    const csrfToken = cookies['csrf'] || '';
    const doc = renderRuleForm({ rule, error: null, success: null, csrfToken, isNewVersion: true });
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
    const userId = req.user && req.user.id ? Number(req.user.id) : null;

    const [insVersion] = await db.query(
      `INSERT INTO rule_versions (rule_id, version, markdown, html, change_summary, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rule.id, nextVersion, rawMarkdown, html, changeSummary || null, userId]
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
  body += `<label>Markdown
    <textarea name="markdown">${escapeHtml(markdownValue)}</textarea>
    <div class="field-hint">Markdown is rendered server-side using the restricted contract in <code>agents/requirements/markdown.md</code>.</div>
  </label>`;
  body += `<div class="actions">
    <button type="submit">${isEdit ? 'Save changes' : 'Create page'}</button>
  </div>`;
  body += `</form>`;

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
    const [rows] = await db.query(`SELECT id, slug, title, markdown, visibility FROM pages WHERE id = ? LIMIT 1`, [id]);
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

// Guard all /admin/* UI routes for site admin only
pagesRouter.use('/admin', requireSiteAdminPage);
pagesRouter.use('/adminx', requireSiteAdminPage);

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
