import { Router } from 'express';
import path from 'path';
import { BUILD_TAG } from '../utils/version';
import { requireSiteAdminPage, requireSpaceAdminPage, requireSpaceModeratorPage } from '../middleware/auth';

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

// Split admin pages
pagesRouter.get('/admin/settings', (_req, res) => {
  serveHtml(res, 'admin-settings.html');
});

pagesRouter.get('/admin/users', (_req, res) => {
  serveHtml(res, 'admin-users.html');
});
pagesRouter.get('/admin/users/new', (_req, res) => {
  serveHtml(res, 'admin-user-new.html');
});
pagesRouter.get('/admin/users/:id', (_req, res) => {
  serveHtml(res, 'admin-user.html');
});

pagesRouter.get('/admin/groups', (_req, res) => {
  serveHtml(res, 'admin-groups.html');
});
// Singular fallbacks for convenience
pagesRouter.get('/admin/group', (_req, res) => {
  serveHtml(res, 'admin-groups.html');
});
pagesRouter.get('/admin/groups/new', (_req, res) => {
  serveHtml(res, 'admin-group-new.html');
});
pagesRouter.get('/admin/groups/:id', (_req, res) => {
  serveHtml(res, 'admin-group.html');
});
pagesRouter.get('/admin/group/:id', (_req, res) => {
  serveHtml(res, 'admin-group.html');
});
pagesRouter.get('/admin/groups/:id/user/:userId', (_req, res) => {
  serveHtml(res, 'admin-group-user.html');
});

pagesRouter.get('/admin/channels', (_req, res) => {
  serveHtml(res, 'admin-channels.html');
});
pagesRouter.get('/admin/channel', (_req, res) => {
  serveHtml(res, 'admin-channels.html');
});
pagesRouter.get('/admin/channels/new', (_req, res) => {
  serveHtml(res, 'admin-channel-new.html');
});
pagesRouter.get('/admin/channels/:id', (_req, res) => {
  serveHtml(res, 'admin-channel.html');
});
pagesRouter.get('/admin/channel/:id', (_req, res) => {
  serveHtml(res, 'admin-channel.html');
});
pagesRouter.get('/admin/channels/:id/user/:userId', (_req, res) => {
  serveHtml(res, 'admin-channel-user.html');
});

// Dev utilities page
pagesRouter.get('/admin/dev', (_req, res) => {
  serveHtml(res, 'admin-dev.html');
});

// -------- Space-level Admin & Moderation UI --------
// Redirect space root to per-member admin page for current user
pagesRouter.get('/spaces/:id', requireSpaceAdminPage, (req: any, res) => {
  const id = req.params.id;
  const currentUserId = req.user && req.user.id ? String(req.user.id) : '';
  if (!currentUserId) {
    return res.redirect(`/forbidden?from=${encodeURIComponent(req.originalUrl || '')}`);
  }
  res.redirect(`/spaces/${id}/admin/users/${currentUserId}`);
});

// Members default and explicit route
pagesRouter.get('/spaces/:id/admin', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-members.html');
});
pagesRouter.get('/spaces/:id/admin/members', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-members.html');
});
// Per-member admin page
pagesRouter.get('/spaces/:id/admin/users/:userId', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-admin-user.html');
});
// Space settings
pagesRouter.get('/spaces/:id/admin/settings', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-settings.html');
});
pagesRouter.get('/spaces/:id/moderation', requireSpaceModeratorPage, (_req, res) => {
  serveHtml(res, 'space-moderation.html');
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
  serveHtml(res, 'space-members.html');
});
pagesRouter.get('/groups/:id/admin/members', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-members.html');
});
pagesRouter.get('/groups/:id/admin/users/:userId', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-admin-user.html');
});
pagesRouter.get('/groups/:id/admin/settings', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-settings.html');
});
pagesRouter.get('/channels/:id/admin', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-members.html');
});
pagesRouter.get('/channels/:id/admin/members', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-members.html');
});
pagesRouter.get('/channels/:id/admin/users/:userId', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-admin-user.html');
});
pagesRouter.get('/channels/:id/admin/settings', requireSpaceAdminPage, (_req, res) => {
  serveHtml(res, 'space-settings.html');
});
pagesRouter.get('/groups/:id/moderation', requireSpaceModeratorPage, (_req, res) => {
  serveHtml(res, 'space-moderation.html');
});
pagesRouter.get('/channels/:id/moderation', requireSpaceModeratorPage, (_req, res) => {
  serveHtml(res, 'space-moderation.html');
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
