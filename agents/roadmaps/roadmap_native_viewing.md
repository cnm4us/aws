# Web and Native Video Viewing Roadmap

Created: 2026-10-18

Artifact: [Web and Native Video Viewing Roadmap](https://chatgpt.com/space/page_7bdd6dd99d048191a8df5747c8374bf8)

Maintain the web app and expand the accepted iPhone video POC into a complete native viewing application. Both clients use one backend for accounts, content, permissions, engagement, and moderation. Signed-in native Global/Spaces viewing is accepted in Plan 168; Plan 169 completes creator profiles and authorized personal-space return for the recorded iPhone development milestone, with coverage limits retained.

## Product and architecture

The web app continues to support viewing and the existing creation, publishing, administration, and moderation tools. The native app grows around the tested swipe player, bounded preloading, lifecycle recovery, and saved sound settings. Native controls and navigation can differ from the browser while preserving the same content and access rules.

```mermaid
flowchart TD
  W[Web application] --> A[Shared backend API]
  N[Native iPhone application] --> A
  A --> D[Accounts content permissions and moderation]
  W --> M[Media delivery]
  N --> M
```

Share API contracts, validation, and business rules where useful. Keep browser rendering and native playback independent. Continue the existing separate mobile package; a monorepo tooling migration is not required to add features.

## Current foundation

| Capability | Current position |
| --- | --- |
| Native video viewing | Anonymous/signed-in Global and accessible Spaces, preloading, pause, sound, lifecycle and recovery accepted on the test iPhone |
| Space viewing | Minimized viewer API and native selector/feeds implemented; device denial/restoration and expired-session recovery accepted |
| Viewer details | Native creator/profile and authorized personal-feed return accepted on the recorded development iPhone, supported by host/API/browser checks. Stories/captions remain later scope |
| Participation | Existing services support comments, likes, contextual follows, and reporting |
| App authentication | Native sessions, secure restore, account switching and online/offline logout implemented and accepted |
| Independent distribution | Signed iPhone development build installed/accepted; TestFlight and public-release acceptance remain |

Existing endpoints are starting points. Their response fields, permission behavior, and errors need contract tests before native adoption.

## Delivery sequence

### 1 Establish viewer contracts

Inventory web viewer actions and assign them to native milestones. Add explicit viewer response shapes and consistent pagination and errors. Keep email, storage keys, processing jobs, and moderation internals out of public viewer responses. New contracts must preserve existing web behavior during adoption.

### 2 Deliver signed in viewing across Global and spaces

Allow existing users to sign in, restore a saved session, sign out, and return to anonymous Global browsing. Add native navigation and a space selector for the user's personal space and existing group and channel relationships. Reuse the current player for every feed, enforce permissions on the server, and clear account-specific state when identity changes.

This first milestone covers browsing existing accessible spaces. New-account onboarding, broad space discovery, membership changes, profiles, stories, captions, and social participation follow in later milestones.

### 3 Complete viewing and discovery

Add group and channel discovery, creator profiles, authorized personal-space entry, stories, app captions, and shared-video links with browser fallback. Define playback behavior for each screen and overlay. Keep publication identity separate from production identity when moving between spaces.

### 4 Add participation and remaining feed behavior

Add comments, likes, contextual follows, reporting, and membership or invitation workflows. Preserve the product rule that Global is for discovery and engagement belongs inside spaces. Reconcile differences between the current web behavior and that rule before copying them.

Integrate in-feed messages and production viewing analytics separately from the POC's local diagnostic reports. Account for platform-specific requirements before introducing subscription or donation checkout.

### 5 Validate and distribute

Introduce an independent Expo development build during the expansion so app-specific configuration is tested early. Use TestFlight before public distribution and run release-build performance, accessibility, memory, network recovery, and account-isolation checks. Expo recommends development builds for apps intended for app-store release. [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)

## Boundaries that guide every milestone

- Keep the web app operational throughout the rollout, using additive API changes and focused browser regression tests.
- Apply the same server-side permissions to both clients. Following or seeing a Global item must never grant personal-space access.
- Preserve the native player limit of three and stop playback when a screen loses eligibility.
- Treat feed authorization and media authorization separately. The POC uses unsigned HLS playback URLs; protected media requires an explicit delivery policy, including playlists, segments, and posters.
- Revalidate saved credentials with the server. Store native credentials using secure device storage; reserve ordinary preference storage for non-secret settings.
- Require phase-specific evidence before marking a milestone complete.

## First milestone acceptance

An existing user can browse Global anonymously, sign in, select an existing accessible space, swipe through its videos, restart the app and restore the session, and sign out safely. Denied or expired access has a clear recovery path. Old requests and hidden screens cannot replay stale content after account or space changes. The browser remains functional.

## Execution documents

The first delivered viewer milestone is maintained in the aws repository at `agents/implementation/plan_168.md`. The completed creator-viewing increment is [Plan 169](../implementation/plan_169.md): creator profiles, authorized personal-space entry, and return to the original feed/video. Plan 169 phases A–F are Complete for the recorded development milestone; later viewing/discovery increments need separate plans. The repository roadmap is the primary high-level artifact; implementation phase status and evidence belong in the repository plans.

## Repository references

- [Detailed first-milestone plan](../implementation/plan_168.md)
- [Creator profiles and personal-feed return plan](../implementation/plan_169.md)
- [Accepted native POC](../implementation/plan_167.md)
- [Context integrity contract](../features/feature_02_personal-space-global-feed-context-integrity.md)

This roadmap describes intended scope and sequencing. Phase execution status remains in the implementation plans. Later milestones need their own plans before execution.


## Current milestone status

Plan 168 is Complete (A–H) for signed-in native Global/Spaces viewing alongside the web app. Independent Video Viewer 0.1.0/build 1 acceptance includes authentication/storage, context/account isolation, playback/lifecycle/sound, offline recovery/logout, normal Wi-Fi timing and mixed browsing. The mixed report records 104 selections/frames, zero errors/incomplete, prepared first-frame p95 about 136 ms and peak three players. Device denial stopped audible playback while identity remained valid; restored access recovered through Refresh without login; session expiry returned to anonymous Global. Fixtures were restored and the test session cleaned up.

VoiceOver was explicitly deferred; high-text-size pill clipping is accepted. Cancellation passed controlled actual-component cases while the too-fast physical gesture remains unexercised. Handled guard events, compact-history limits and an earlier non-reproduced whole-app freeze with unconfirmed cause remain recorded in the plan. This is development-viewer acceptance using public fixture media, not private-CDN or public-release qualification. Plan 169 is also Complete for creator profiles, authorized personal-space entry and original-feed restoration. Device return/pause/mute, access loss/recovery, session expiry and offline return passed; the final Wi-Fi sample records 40/40 prepared normal transitions, first-frame p95 120.38 ms, zero errors/incomplete/unexpected playback and peak three players. One brief spinner and an earlier whole-app freeze with unconfirmed native cause remain documented; no recurrence was reported in the post-correction short/final checks. Qualitative seek/duration, host-versus-physical edge-case coverage and accessibility limits are retained. User authorized commit/push; Git handoff is in progress for this increment. Other viewing/discovery and participation features have not started.
