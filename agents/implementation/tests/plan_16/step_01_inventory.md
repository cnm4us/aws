### 2025-12-28T20:05:00+00:00

#### Frontend: current `/admin*` route ownership (SPA)

`src/routes/pages.ts` serves SPA shell for these admin routes today:
```
2842:pagesRouter.get('/admin/settings', (_req, res) => {
2846:pagesRouter.get('/admin/users', (_req, res) => {
2859:pagesRouter.get('/admin/users/new', (_req, res) => {
2862:pagesRouter.get('/admin/users/:id', (_req, res) => {
3422:pagesRouter.get('/admin/dev', (_req, res) => {
3427:pagesRouter.get('/admin/moderation/groups', (_req, res) => {
3430:pagesRouter.get('/admin/moderation/channels', (_req, res) => {
```

`frontend/src/main.tsx` explicitly renders SPA pages for:
```
201:} else if (path.startsWith('/adminx/users')) {
220:  if (path.startsWith('/adminx/settings')) {
228:} else if (path.startsWith('/admin/')) {
230:    if (path.startsWith('/admin/moderation/groups')) {
238:    } else if (path.startsWith('/admin/moderation/channels')) {
254:    } else if (path.startsWith('/admin/users')) {
262:    } else if (path.startsWith('/admin/settings')) {
```

Notes:
- `/admin/dev` currently lands on the SPA “Admin placeholder” (no dedicated SPA page found).
- `/admin/users/new` is served as SPA but is not implemented as a distinct page (it falls under the `/admin/users*` SPA handler).

#### Frontend: existing admin SPA components + APIs they call

Admin users list (SPA beta):
```
frontend/src/app/AdminUsers.tsx:22:      const res = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'same-origin' })
```

Admin user detail (SPA beta) — loads and edits profile + site roles + capabilities:
```
frontend/src/app/AdminUser.tsx:87:          fetch(`/api/admin/users/${userId}`, { credentials: 'same-origin' }),
frontend/src/app/AdminUser.tsx:88:          fetch(`/api/admin/users/${userId}/roles`, { credentials: 'same-origin' }),
frontend/src/app/AdminUser.tsx:89:          fetch(`/api/admin/users/${userId}/spaces`, { credentials: 'same-origin' }),
frontend/src/app/AdminUser.tsx:90:          fetch(`/api/admin/roles`, { credentials: 'same-origin' }),
frontend/src/app/AdminUser.tsx:91:          fetch(`/api/admin/users/${userId}/capabilities`, { credentials: 'same-origin' }),
frontend/src/app/AdminUser.tsx:131:      const res = await fetch(`/api/admin/users/${userId}/roles`, {
frontend/src/app/AdminUser.tsx:154:      const res = await fetch(`/api/admin/users/${userId}/capabilities`, {
frontend/src/app/AdminUser.tsx:194:      const res = await fetch(`/api/admin/users/${userId}`, {
```

Admin site settings (SPA beta):
```
frontend/src/app/AdminSiteSettings.tsx:29:        const res = await fetch('/api/admin/site-settings', { credentials: 'same-origin' })
frontend/src/app/AdminSiteSettings.tsx:47:      const res = await fetch('/api/admin/site-settings', {
```

Admin “moderation” overview list (SPA) (pre-publish pending counts, links to per-space review queue):
```
frontend/src/app/AdminModerationList.tsx:39:        const url = kind === 'group' ? '/api/admin/moderation/groups' : '/api/admin/moderation/channels'
frontend/src/app/AdminModerationList.tsx:75:            <a key={it.id} href={`/spaces/${it.id}/review`} className={styles.row}>
```

#### Backend: current admin APIs (site_admin)

Moderation overview (pending counts) — groups/channels only:
```
127:adminRouter.get('/moderation/groups', async (_req, res) => {
155:adminRouter.get('/moderation/channels', async (_req, res) => {
```

Per-user review hold + suspensions (ban/posting) (required for Plan 16 `/admin/users/:id`):
```
183:adminRouter.get('/users/:id/moderation', async (req, res) => {
220:adminRouter.put('/users/:id/moderation', async (req, res) => {
236:adminRouter.post('/users/:id/suspensions', async (req, res) => {
281:adminRouter.delete('/users/:id/suspensions/:sid', async (req, res) => {
```

Users + roles + capabilities:
```
397:adminRouter.get('/users', async (req, res, next) => {
420:adminRouter.get('/users/:id', async (req, res, next) => {
432:adminRouter.put('/users/:id', async (req, res) => {
353:adminRouter.get('/users/:id/roles', async (req, res, next) => {
362:adminRouter.put('/users/:id/roles', async (req, res, next) => {
579:adminRouter.get('/users/:id/capabilities', async (req, res, next) => {
588:adminRouter.put('/users/:id/capabilities', async (req, res, next) => {
```

Per-space role assignment (required for Plan 16 `/admin/users/:id` space role edits):
```
527:adminRouter.get('/spaces/:id/users/:userId/roles', async (req, res) => {
548:adminRouter.put('/spaces/:id/users/:userId/roles', async (req, res) => {
```

Dev utilities:
```
335:adminRouter.get('/dev/stats', async (_req, res) => {
344:adminRouter.post('/dev/truncate-content', async (_req, res) => {
```

Site settings:
```
563:adminRouter.get('/site-settings', async (_req, res, next) => {
570:adminRouter.put('/site-settings', async (req, res, next) => {
```

#### Gaps for Plan 16 `/admin/review/*`

- Existing overview endpoints cover only `group` and `channel` pending counts.
- Plan 16 requires new site_admin review listings/queues for:
  - Global Feed (space slug `global` / `global-feed`)
  - Personal spaces (`spaces.type = 'personal'`)
  - Groups + Channels (can reuse existing patterns)

