# Implementation Plan: Avatars in Feed and Per-Space Follow (Phase 1)

## 1. Overview
Goal: Show author avatars on feed slides and introduce a per-space follow/unfollow mechanism so users can follow other authors in the specific topic/space contexts they care about, without changing feed filtering behavior yet.

In scope:
- Displaying each slide’s author avatar (48×48, circular) across feeds, reusing the existing profile avatar pipeline (`profiles.avatar_url`).
- A lightweight profile peek overlay when clicking an avatar, with a link to that author’s public profile page (e.g., `/users/:userId`).
- A per-space follow/unfollow model and basic counts for **group and channel** spaces, so users can follow authors within those spaces and see whether they’re already following them.

Out of scope (for this phase):
- Feed filtering or custom timelines based on follow status (e.g., “only posts from people I follow”).
- The “Follow ALL spaces” control from a user’s Profile page (we will design that in a later plan).
- Detailed block/mute UIs; we will respect existing moderation/visibility rules but not design new ones here.
- Following authors from the Global or personal feeds; Phase 1 follow relationships exist only in group and channel spaces.

References:
- `agents/features/feature_01.md` — Profile vs Identification vs Credibility semantics.
- `agents/implementation/plan_02.md` — Profiles backend (including `profiles.avatar_url`).
- `agents/implementation/plan_03.md` — `/profile` route and Profile UI.
- `agents/implementation/plan_04.md` — Avatar upload, storage layout, and normalization.
- `frontend/src/app/Feed.tsx` — Feed slide rendering.
- `frontend/src/app/Profile.tsx`, `frontend/src/app/ProfileAvatar.tsx` — current Profile and avatar behavior.

---

## 2. Step-by-Step Plan

1. Model per-space follow relationships  
   Status: Completed  
   Testing: Add a new table (e.g., `space_user_follows`) via `src/db.ts` with columns such as `follower_user_id`, `target_user_id`, `space_id`, and `created_at`. Ensure the DDL is non-destructive and idempotent per `agents/db_access.md`. Verify with `mysql` that the table exists and that unique constraints (e.g., one active follow per follower/target/space) are enforced. Confirm that `space_id` refers only to **group/channel** spaces in this phase (no rows for Global or personal feeds).

2. Backend follow service and APIs  
   Status: Completed  
   Testing: Implement a small service module (e.g., `src/features/follows/service.ts`) to create/delete and read per-space follow records, with guards to prevent self-follow and to respect any existing suspension/blocking checks. Add API routes such as:  
   - `GET /api/spaces/:spaceId/users/:userId/follow` → returns current follow status and simple counts for that space (e.g., `{ following, followersCount }`).  
   - `POST /api/spaces/:spaceId/users/:userId/follow` → follow in that space (authenticated user only, idempotent).  
   - `DELETE /api/spaces/:spaceId/users/:userId/follow` → unfollow in that space (idempotent).  
   Confirm via curl/Postman that these endpoints correctly reflect follow state and counts, enforce that the target space is a **group or channel** (not Global/personal), and that blocked/suspended users are either hidden or not followable according to existing moderation rules. Defer any batch follow-status APIs to a later phase.

3. Feed avatar display  
   Status: Completed  
   Testing: Extend the feed backend and UI so each slide can render the author’s avatar:  
   - Update the feed data pipeline (`src/features/feeds/repo.ts`, `src/features/feeds/service.ts`, and the `FeedResponse` mapping) to left-join `profiles` for each owner and expose `avatar_url` in the feed payload.  
   - Update `UploadItem` in `frontend/src/app/Feed.tsx` to include an `ownerAvatarUrl` populated from `profiles.avatar_url`.  
   - Render a 48×48 circular avatar in the feed slide UI using this URL when available; otherwise, show a generic fallback icon or initials.  
   Manually verify in the browser that avatars render crisply at 48×48 CSS pixels, work across global and space feeds without breaking layout, and that slides without avatars still look good.

4. Profile peek overlay on avatar click  
   Status: Completed  
   Testing: Add a lightweight overlay/card that opens when a user clicks an avatar in the feed:  
   - Shows the author’s display name, avatar, brief bio (if public), “member since” information, and a “View full profile” link to `/users/:userId` (public-other view).  
   - Includes a follow/unfollow button for the **current space** when the user is viewing a group or channel feed (wire this to the follow APIs from Step 2); on feeds where we do not yet support follows, the overlay can be view-only.  
   Implement this with a simple React overlay or anchored popover that does not navigate away from the feed. Test that only one overlay is visible at a time, that clicking outside or pressing Escape dismisses it, and that navigation to the full profile page (`/users/:userId`) works as expected.

5. Follow state, counts, and basic UX  
   Status: Completed  
   Testing:  
   - In the profile peek overlay, show follow status (“Follow” vs “Following”) and a simple count like “N followers in this space” using the follow APIs.  
   - Ensure that follow/unfollow actions update UI state immediately (optimistic update) and reconcile with API responses.  
   - Verify that users can follow any visible author in a **group or channel** they have access to, except where the author’s profile disallows following or where moderation rules block interaction (when those rules are implemented).  
   Confirm via manual testing that follow state is consistent when revisiting the feed and that suspended/blocked users appear dimmed or un-followable according to your existing rules.

---

## 3. Progress Tracking Notes

- Step 1 — Status: Completed.  
- Step 2 — Status: Completed.  
- Step 3 — Status: Completed.  
- Step 4 — Status: Completed.  
- Step 5 — Status: Completed.  

---

## 4. Clarifications from discussion

1. Follow scope for Phase 1  
   - Per-space follows are limited to **group and channel** spaces; following from Global or personal feeds is out of scope for this plan and will be handled in a later phase.

2. Public profile routing  
   - `/profile` remains the “me” route; public views of other users will use `/users/:userId`. The profile peek overlay should link to `/users/:userId` rather than `/profile`.

3. Feed payload for avatars and follow state  
   - Current feed responses already include the author user ID (`owner_id`) and `space_id` for each item, but not `profiles.avatar_url`. Step 3 will extend the feed backend to include an avatar URL per item, and the client will use that to render avatars.

4. Follow API design and batching  
   - Step 2 will implement `GET/POST/DELETE /api/spaces/:spaceId/users/:userId/follow` returning a small summary payload (e.g., `{ following, followersCount }`). Batch follow-status endpoints are explicitly deferred to a future plan.

5. Avatar overlay behavior  
   - Clicking an avatar opens a small, anchored overlay with basic author info and a follow/unfollow control (when supported for that feed); “View full profile” navigates to `/users/:userId` as a normal route change, not another overlay.
