import { Router } from 'express';
import path from 'path';
import { BUILD_TAG } from '../utils/version';
import { requireSiteAdminPage, requireSpaceAdminPage, requireSpaceModeratorPage } from '../middleware/auth';
import { getPool } from '../db'

const publicDir = path.join(process.cwd(), 'public');

function serveHtml(res: any, relativePath: string) {
  res.set('X-Build', BUILD_TAG);
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, relativePath));
}

export const pagesRouter = Router();

pagesRouter.get('/', (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});

pagesRouter.get('/uploads', (_req, res) => {
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

// Slug-based convenience redirects (groups/channels)
pagesRouter.get('/groups/:slug', resolveIdFromSlug('group'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const currentUserId = req.user && req.user.id ? String(req.user.id) : '';
  if (!currentUserId) {
    return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '')}`);
  }
  res.redirect(`/spaces/${id}/admin/users/${currentUserId}`);
});
pagesRouter.get('/channels/:slug', resolveIdFromSlug('channel'), requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const currentUserId = req.user && req.user.id ? String(req.user.id) : '';
  if (!currentUserId) {
    return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '')}`);
  }
  res.redirect(`/spaces/${id}/admin/users/${currentUserId}`);
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
pagesRouter.get('/groups/:id/admin', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/groups/:id/admin/members', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/groups/:id/admin/users/:userId', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/groups/:id/admin/settings', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/channels/:id/admin', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/channels/:id/admin/members', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/channels/:id/admin/users/:userId', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/channels/:id/admin/settings', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/groups/:id/moderation', requireSpaceModeratorPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
});
pagesRouter.get('/channels/:id/moderation', requireSpaceModeratorPage, (_req, res) => {
  serveHtml(res, path.join('app', 'index.html'));
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
