### 2025-12-29T00:04:00+00:00

Goal: inventory current space-console routes that are owned by the **main feed SPA** (and therefore currently part of the user frontend build graph).

Frontend SPA ownership (routing/import graph)

- `/space/review/groups` + `/space/review/channels`
  - `frontend/src/main.tsx`:
    - `const SpaceReviewGroupsPage = React.lazy(() => import('./app/SpaceReviewGroups'))`
    - `const SpaceReviewChannelsPage = React.lazy(() => import('./app/SpaceReviewChannels'))`
    - route branches for `/space/review/groups` and `/space/review/channels`
  - `frontend/src/ui/routes.ts`:
    - `loadSpaceReviewGroups()` + `loadSpaceReviewChannels()` dynamic imports
    - hover prefetch hooks for links starting with `/space/review/groups|channels`
  - UI modules:
    - `frontend/src/app/SpaceReviewGroups.tsx`
    - `frontend/src/app/SpaceReviewChannels.tsx`
    - `frontend/src/app/SpaceReviewList.tsx` (calls `/api/space/review/groups|channels`)

- `/spaces/:id/admin/*` + `/spaces/:id/review`
  - `frontend/src/main.tsx`:
    - `SpaceMembersPage`, `SpaceSettingsPage`, `SpaceModerationPage` are lazy-imported and rendered when pathname matches:
      - `/spaces/:id/admin` (and `/members`)
      - `/spaces/:id/admin/settings`
      - `/spaces/:id/review`
    - Note: `/spaces/:id/review` currently renders `SpaceModerationPage` (pre-publish review UI lived there historically; naming differs from desired “review vs moderation” split).
  - UI modules:
    - `frontend/src/app/SpaceMembers.tsx`
    - `frontend/src/app/SpaceSettings.tsx`
    - `frontend/src/app/SpaceModeration.tsx`

Backend route mapping (HTML shell served)

- `src/routes/pages.ts` currently serves the **main SPA shell** (`public/app/index.html`) for:
  - `/space/review/groups`
  - `/space/review/channels`
  - `/spaces/:id/admin`, `/spaces/:id/admin/members`, `/spaces/:id/admin/users/:userId`, `/spaces/:id/admin/settings`
  - `/spaces/:id/review`

Implication (why this step matters)

- Even though React pages are lazy-loaded, these space-console screens are still part of the **main feed app** build graph today (and ship as chunks under `public/app/assets/*`).
- To meet the stronger goal (“don’t ship space console code to normal users”), we need to:
  - remove these imports/route branches from `frontend/src/main.tsx`, and
  - serve a separate space-console bundle (or server-rendered pages) under `/space/*` + `/spaces/*`.

