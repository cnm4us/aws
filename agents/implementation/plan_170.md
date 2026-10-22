# Plan 170: Native publication stories and timed captions

Status: Complete

Created: 2026-10-22

Implementation authorized by the user on 2026-10-22. Phases A–F are Complete for the recorded native story/caption milestone, combining host/API/browser/development observations with bundled build2 phone acceptance and the documented limits. Baseline implementation is `49e8dd6`, pushed to origin/main. Preserve the existing uncommitted Plan 169 post-commit continuity note.

## Feature Reference

- Roadmap: [Native viewing](../roadmaps/roadmap_native_viewing.md), remaining viewing/discovery stage.
- Context and publication boundaries: [Feature 02](../features/feature_02_personal-space-global-feed-context-integrity.md).
- Accepted foundation: [Plan 168](plan_168.md) and [Plan 169](plan_169.md).
- Historical intent: [Plan 45](archives/plan_45.md), production WebVTT and custom caption display; [Plan 50](archives/plan_50.md), default stories with publication-specific overrides. Current source takes precedence over historical endpoint examples.
- UI guidance: [Modal properties](../requirements/ui/modal-properties.md) and [Floating panels](../requirements/ui/floating-modals.md), adapted to native components rather than copying DOM/CSS requirements.

## Context

The native viewer now supports anonymous/signed-in Global, authorized spaces, creator profiles, personal-feed detours and return to the original publication/time. It still omits the existing written stories and application-rendered timed captions. Complete those two viewing features without changing publishing, engagement, navigation history, media encoding or account permissions.

Here, **story** means the author's plain-text narrative attached to a publication, not an ephemeral photo/video story format. **Captions** means the existing production's WebVTT transcript rendered over the playing video, separate from upload description and burned-in video text.

### Inspection findings

| Area | Observed source behavior | Implementation consequence |
| --- | --- | --- |
| Story ownership | `space_publications.story_text` is the effective text, with a production default copied/propagated only while using that default. Custom overrides can differ between publications of one production. `src/features/publications/service.ts` normalizes author input and limits it to 2,000 characters. | Read the selected publication's effective story. Never substitute `productions.default_story_text`, upload description or another space's story. No schema or propagation change. |
| Browser story UI | `frontend/src/app/Feed.tsx` shows a two-line preview and expandable, scrollable body. Expansion does not itself pause playback; selection change collapses it. `ensureStory` fetches only when signed in. The legacy story route requires a browser session. | Native inline expansion can preserve that playback model. Full anonymous Global story reading is an intentional new viewer contract, authorized against the exact Global publication. It is not existing browser anonymous full-text parity. |
| Caption production | `src/media/jobs/assemblyAiTranscriptV1.ts` stores generated VTT and a ready `production_captions` pointer. Feed queries join ready production captions. Separate `upload_captions` exist for library assets. | Reuse ready production captions; do not transcribe, generate jobs, use library upload transcripts as a fallback, or re-encode media. |
| Browser captions | `frontend/src/app/Feed.tsx` parses VTT, strips markup, applies readable linger/short-cue merging, follows the active video's clock, resets on seeks/loops, and hides captions while its story is expanded. CC defaults off and persists in browser localStorage. | Native custom captions should match the existing content/readability intent, with an explicit parser subset and deterministic timing tests. Preserve independent native preference storage. |
| Existing text access | Legacy story and signed-in VTT reads assert space-feed access but do not perform the full exact-publication selection check. Anonymous VTT accepts published rows with `visible_in_global` or `visibility=public`. Those rules are not identical to viewer Global eligibility. | Do not call these browser routes with native tokens or copy their access shortcuts. Add context-bound viewer reads using the same eligible row predicates as the native feed. Record the legacy difference rather than silently rewriting browser behavior. |
| Feed metadata | `src/features/feeds/repo.ts` and `service.ts` already compute `has_story`, a 200-character flattened `story_preview`, and `has_captions`. `src/features/feeds/viewer.ts` deliberately omits them. | Add three allowlisted viewer fields; no VTT or full story in paginated responses and no per-item caption object fetches. |
| Native transport | `mobile/src/api/client.ts` supports JSON only; credentials attach only to configured-origin native/viewer paths, with cookies omitted and redirects rejected. | Add a bounded text response operation using the same request/auth/cancellation/error checks, not a separate unconstrained fetch. |
| Native clock | `mobile/src/playback/useFeedPlayback.ts` sets `timeUpdateEventInterval` to 0 in release and exposes progress subscription only in development. The coordinator's progress path currently serves diagnostics/startup evidence. | A product caption clock must work independently of `__DEV__` and diagnostic reports. Use the existing owned selected player; never create a caption player. |
| Native composition | `FeedCard` displays creator and upload description. `FeedSession` owns one selected surface and paging; the navigator owns sound preferences and the bounded profile journey. | Add presentation/state alongside the existing feed. Keep the root Feed and original checkpoint semantics. |
| Settings | `mobile/src/preferences/playbackPreferences.ts` persists version-1 start-muted preference; current mute is session state. | Store captions under a separate versioned key. Preserve existing sound data and behavior exactly. |

Inspection was source/document based. No live account, database row, S3 object, development server or installed app was changed for this plan. Actual caption availability, VTT sizes and device rendering remain execution checks, not claimed inspection results.

### Scope

In scope: native story preview/full reading; ready captions with an on/off control and durable device preference; context-authorized viewer text reads; bounded parsing/caching; selected-player clock; layout and gesture handling; regression coverage for permissions, identity changes, profile returns and accepted playback performance.

Out of scope: story/caption authoring or editing, transcription jobs, translation/language selection, word-by-word animation, rich text/link actions, OS subtitle-track integration, upload-library captions, discovery, sharing/deep links, likes/comments/follows, analytics ingestion, offline downloads, private HLS/CDN delivery, onboarding, bundled distribution, TestFlight and public release.

## Locked Decisions

These are the implementation defaults chosen from the inspected behavior. A material change must update this plan before execution continues.

1. **Publication plus feed context is the content identity.** Global eligibility does not authorize a personal/group/channel publication of the same production. A production caption pointer may be shared internally, but every caption request is authorized through the selected publication and requested context.
2. **No publishing or permission changes.** Preserve Plan 169 personal access: explicit owner/member/site-admin authority, subject to bans; following, public profile flags and subscriptions alone do not grant personal access. Space and individual publication eligibility must both pass.
3. **Additive viewer contract.** New feed fields are `hasStory: boolean`, `storyPreview: string | null`, and `hasCaptions: boolean`. Old clients ignore them; new adapters treat absent fields as false/null. Explicit malformed types are rejected or normalized consistently with tested adapter rules. Full story is fetched on expansion; VTT only when CC is enabled for an eligible selected item.
4. **Inline story, no new navigation route.** Show a collapsed preview near the creator, with Expand story/Collapse story. Expanding immediately displays loading, then full plain text or an inline Retry state. Expansion does not alter play/pause or mute. Story taps/scrolls never trigger underlying tap-to-pause; swiping outside the story can change publication and collapses it. Navigating away, Refresh or context/identity change also collapses it. Returning from a creator profile starts collapsed at the restored publication/time.
5. **Description remains distinct.** A story-bearing card shows story preview rather than a second block duplicating the upload description. A card without a story retains the current description fallback. Creator-profile navigation remains a separate named control. Metadata must not be mislabeled as timed captions.
6. **App captions use a custom plain-text overlay.** No HLS rewriting, subtitle-track attachment, WebView, new player or native-controls change. Hide captions during expanded story, scrolling, position restoration, hidden/locked state, access verification/denial and video failure. Ordinary manual pause holds the correct cue at its frozen media time; it does not disable captions or restart the video. Collapse/resume re-evaluates the current media time.
7. **CC is one immediate device preference.** Default off. The per-video CC control appears only when ready production captions are advertised; Settings also offers Captions On/Off so the choice can be changed without a captioned item. It follows all feeds, profile detours, Refresh, account switches and app restart. Saving this non-secret preference does not save stories, cues or identity. Sound settings are unchanged.
8. **Caption readiness is optional.** Missing, loading or malformed captions cannot block video startup, change the startup watchdog, toggle pause, or replace the whole feed with an error. Show a small caption-specific unavailable/Retry state; turning CC off always works. Story failures remain inside the story panel. Actual authentication/access failures still invoke the existing protective feed behavior.
9. **A release-capable selected-player clock is required.** Target a 250 ms native update interval only for the selected visible player while captions need it. Subscribe/unsubscribe and restore the existing diagnostic interval through one adapter owner; neighbors have no product caption subscription. Read current time on attachment, cue load completion, pause, return and seek/loop boundaries. Store/render only changed cue text; do not re-render the full list or publish coordinator snapshots on every tick. No frame-rate JS polling.
10. **Bound resource use.** Provisional caps: 1 MiB UTF-8 VTT per response, 10,000 parsed cues, 8 KiB decoded text per cue, 20 resource entries and 2 MiB retained text/cue payload per feed-content cache. Enforce byte limits while reading, not only after an unbounded `.text()`. Measure JavaScript representation separately; these caps are not a native-memory guarantee. Fail gracefully on oversize. Revisit caps only with measured fixtures and a documented decision, not a hidden increase.
11. **No protected text persistence.** Caches are memory-only, keyed by API origin, auth generation/principal, context and publication. Abort/ignore obsolete requests. Retain only while the feed visit is current; explicitly evict on Refresh, identity change, access loss and disposal. Background/navigation conceal content immediately and mark cached authorization stale; revalidate before redisplay. A 60-second maximum content-cache age bounds freshness, alongside existing foreground/periodic access checks. Offline protected access verification hides even cached text; cached bytes are not proof of permission.
12. **No incidental infrastructure work.** No schema, dependency, Expo SDK, signing or native-build change is expected. Preserve the three-player budget, selected-only playback, cold-source play intent, startup recovery and one original journey checkpoint. If installed API inspection or physical results demonstrate a native dependency/config requirement, record it and the build consequence before changing scope.

## Proposed API and state contracts

### Context-bound read routes

Add under the existing `/api/viewer/v1` router:

| Method/path | Principal | Success |
| --- | --- | --- |
| `GET /feed/global/publications/:publicationId/story` | Optional viewer identity; invalid supplied credentials still fail | JSON `{ context: { kind: 'global' }, publicationId, storyText: string | null }` |
| `GET /feed/global/publications/:publicationId/captions.vtt` | Same | Bounded `text/vtt; charset=utf-8` |
| `GET /spaces/:spaceId/publications/:publicationId/story` | Required, current space access | JSON `{ context: { kind: 'space', spaceId }, publicationId, storyText: string | null }` |
| `GET /spaces/:spaceId/publications/:publicationId/captions.vtt` | Same | Bounded `text/vtt; charset=utf-8` |

The narrower text-context shape is intentional and independent of the feed's named-space envelope. Bind VTT to the exact requested route and request generation; return a validated publication identity header if the client uses one. No caller-supplied bucket, key, production ID, arbitrary URL or alternate origin is accepted.

Authorization sequence:

1. Resolve principal through `resolveViewer`, retaining bearer/cookie ambiguity and HTTPS rules. Validate positive safe-integer path IDs; reject malformed IDs with 400 `invalid_query`.
2. For a space request, check current space access first, retaining existing 401/403/404 semantics.
3. Select the exact publication using the same Global or space feed row predicates (`publicationId`, `limit: 1`). Global requires published/completed/visible-in-global/not-members-only; space selection also requires requested space, visible-in-space and its existing member-visibility predicate. Reuse or extract the SQL selection boundary; do not scan pages, use an anchor's fallback item or duplicate a weaker predicate.
4. If no eligible row matches, return 404 `publication_not_found` with no story, captions metadata or fallback content. A visible row with no effective story returns 200/null. Captions absent/not-ready returns 404 `captions_not_found`. The latter resource absence must not invalidate otherwise valid feed access.
5. Read only that publication's effective story or bound production's ready VTT. Reuse/refactor the low-level caption pointer/object loader, not the legacy public-visibility or origin-space authorization shortcuts. Authorization must precede S3 fetch even for a warm caption object. For removal concurrent with a read, recheck eligibility before sending bounded content; do not promise retroactive revocation of bytes already delivered.
6. Send `Cache-Control: no-store`, including errors. Do not redirect to S3 or expose storage pointers/transcript IDs. Bound and cancel object reads; handle stream errors, client disconnect and upstream timeout with sanitized errors and no partial successful VTT body. Bound-buffering before send is acceptable at 1 MiB. Distinguish 503 retryable backend/object failure from 401/403 and missing captions.

Keep legacy browser URLs and story-editing routes operational. Their looser legacy read predicates are an existing gap outside this native increment; do not claim they have been hardened. Any shared loader extraction must retain browser response shape/content type/cache headers and have regression tests. The native client must never send credentials to `/api/publications` or media origins.

### Story state

State per current selected publication: collapsed, loading, ready, empty or retryable error. Open immediately; a late response can only fill the same open publication/context/auth generation. Collapse aborts the in-flight operation; navigation/selection/Refresh also invalidates it. Reopening may use a fresh validated bounded entry; no unbounded map across the browsing lifetime. The server returns stored line breaks/plain text with the existing 2,000-character limit; oversized corrupt legacy values produce a resource error, not silently substituted text or a write-back.

### Caption state and parsing

Keep user preference separate from resource state: idle/off, loading, ready, missing, retryable error. A missing transcript and an access-denied publication are distinct server error codes and distinct client outcomes. Ensure `ApiClient` preserves a small tested allowlist of these codes; status 404 alone is insufficient. Caption Retry refreshes the selected resource/eligibility without replacing the feed/player or losing video time.

Use a small pure VTT parser/timing module with bounded work. Support UTF-8 BOM, CRLF/LF, WEBVTT header, optional cue IDs, two- or three-component timestamps, trailing cue settings, multiline text, standard text entities, and generated cue payloads. Skip NOTE/STYLE/REGION blocks. Strip cue markup/inline timestamps to safe text; do not execute markup or turn text into URLs. Reject invalid ranges/non-finite timestamps; ignore invalid individual blocks and fail as malformed if no usable cues remain in a nonempty transcript. Define empty valid VTT as unavailable captions, without failing playback. Advanced styling, positioning, ruby and language-selection behavior are deferred; this is a supported subset, not a claim of full WebVTT conformance.

Preserve browser readability intent with golden cases: ordinary cues linger at least 900 ms and the last cue 1,600 ms where possible; extend only until the next cue/duration boundary. Merge tiny trailing cues (at most two words or eight characters) into the prior cue when within the existing 800 ms gap rule or terminal case. Sort stably, prevent invalid/overlapping output ranges under this single-text display policy, and document differences from malformed/overlapping browser input rather than copying incidental parser bugs. Display uses start-inclusive/end-exclusive intervals. Clamp only to the loaded native player duration when known; upload duration can precede production edits and must not truncate an edited production transcript. Test actual generated VTT during execution before finalizing normalization.

Cue lookup must handle arbitrary forward/backward time changes, loops, Retry and Plan 169 time restoration; do not assume monotonic time or use JS wall time to advance speech. A bounded indexed lookup avoids scanning 10,000 cues on every tick. No raw cue/story text, source URL or credentials enter diagnostic reports. Any added counters are bounded and contain only safe resource outcomes/timing.

### Preference storage

Add a separate `video-feed-poc:caption-preferences:v1` object `{ version: 1, enabled: boolean }`. Hydrate before first caption fetch; absence means off, invalid/read-failed data means off with a Settings message. Toggling updates the current session immediately. Serialize writes so rapid On/Off or stale completions cannot save the wrong final choice. On write failure retain the in-session choice, clearly report that it was not saved, and allow Retry; do not claim restart persistence. Never overwrite the sound key or attach preference storage to account sign-out. Add a scrollable Settings body if necessary for large text.

### Playback/presentation matrix

| Event | Video/sound | Story | Captions |
| --- | --- | --- | --- |
| Expand/collapse story | Preserve current play/pause and mute | Open/close current text; inner scrolling consumes its gesture | Hide while expanded; resync on collapse |
| Toggle CC | Preserve time, play/pause and mute | Unchanged | Immediate preference; fetch selected resource if needed |
| Manual pause | Remain paused until Play | Remains usable | Hold cue at current media time; no ticking clock advancement |
| Swipe/rapid reversal | Existing paging/selected-only behavior | Collapse and cancel old request | Clear old cue immediately; bind after settled selection |
| Refresh | Existing fresh feed session, mute retained | Collapse/evict/reload metadata | Preference retained; old cues/cache invalidated |
| Creator/personal detour and Back | Existing release/checkpoint/time/pause restoration | Collapse on leaving; use returned publication's story | Preference retained; no origin/destination cross-talk; recalc after seek |
| Account/Spaces/Settings/profile cover | Existing pause/eligibility behavior | Conceal/collapse; discard stale authority | No hidden overlay/subscription; resync after current access passes |
| Background or lock | Audio stopped as today | Conceal, mark stale | Stop product updates/conceal; no hidden work |
| Offline protected verification | Existing recoverable access error, no video/audio | Do not display cached protected text | No cached protected cue display; recover after same-account validation |
| Permission loss or hidden/deleted publication | Existing access handling; do not log out solely for space denial | Clear affected text/preview and show recovery | Clear affected cues; no retries against denied content in a loop |
| Session expiry/account switch | Existing anonymous Global/reset | Cancel/clear identity-bound content | Keep only device preference; clear identity-bound text/cues |

## Phase Status

- A: Complete — viewer metadata, exact-publication authorization and text contracts
- B: Complete — native transport, bounded resources and caption preference
- C: Complete — native story reading and gestures
- D: Complete — release-capable caption clock and overlay
- E: Complete — integrated permission, navigation and browser regression coverage
- F: Complete — focused iPhone acceptance and documentation handoff with recorded limits

## Phase A — Viewer metadata and authorized text reads

Goal: make stories/captions accessible through the minimized native contract without broadening feed access.

- [x] Add allowlisted metadata to the viewer serializer; preserve ordinary and anchored response shapes/pagination. No additional per-row S3 lookup or creator/production detail leak.
- [x] Implement an exact eligible publication resolver shared with existing feed selection; cover Global versus space context, personal explicit authority, bans, members-only and hidden/unpublished rows.
- [x] Implement four scoped reads and bounded ready-production VTT loading with sanitized errors/no-store. Keep story and VTT availability errors distinct from denied publication/space errors.
- [x] Retain browser editing/read behavior and low-level-loader compatibility; add docs for proposed routes only after they exist.
- [x] Build a new disposable story/caption fixture set with distinct text for two publications of one production and ready/missing VTT; exercise malformed/oversized/failed objects through controlled loader tests and denied/hidden/unpublished cases through the live API. Keep credentials private and snapshots scoped. No mutation of normal accounts or existing Plan 169 fixture grants; do not run transcription jobs for fixtures.

Test gate: root `npm run build` and `npm run test:viewer`, plus a new focused API harness (proposed `scripts/check-native-text.ts`, exposed as `viewer:check:text`) against disposable fixtures. Verify anonymous Global versus native/cookie identity, wrong context, exact-publication absence, bans, auth-store outage, object errors, 1 MiB overflow, disconnect/cancellation, and metadata allowlist. Assert no S3 operation occurs before successful authority and no full text leaks through error bodies. Fixture scripts must record/restore only their own changes.

Acceptance: authorized reads match feed eligibility, publication overrides stay distinct, old native/browser contract tests pass, no write side effects occur on viewer reads, and no schema or processing change is introduced.

## Phase B — Native resource and preference foundation

Goal: a bounded, cancelable native text path that cannot replay prior identity/context data.

- [x] Extend the API client with text reading/content-type and byte-budget checks; preserve configured-origin, bearer path allowlist, redirect/cookie rejection, timeout and abort behavior. Bound compressed/chunked response reading and decoded parsing, not just Content-Length.
- [x] Extend feed types/adapters with backward-compatible metadata. Validate story response context/publication identity and typed resource errors.
- [x] Add a testable content resource store with request tokens, context/auth keys, byte/entry budgets, bounded freshness, invalidation and retry rules. No disk cache or unbounded per-publication maps.
- [x] Add the pure bounded parser, linger normalization and cue lookup with golden fixtures, including generated transcript format, gaps, duplicates, overlaps, malformed blocks and duration edges.
- [x] Add independent caption preference hydration/serialized writes and Settings state without migrating/resetting the saved sound key.

Test gate: `cd mobile && npm test && npm run typecheck`. Focus on abort races, old account/feed responses, limits enforced before unbounded allocation, 401/403 versus resource absence, last-toggle-wins persistence, read/write failure, and sound preference compatibility. Parser tests assert expected cue content/times; store tests use fake transport/clock with deterministic boundaries.

Acceptance: all resource/persistence failure paths are recoverable; old identity data cannot be displayed; metadata-absent feeds still work; CC starts off until a valid saved choice is hydrated.

## Phase C — Story preview and expansion

Goal: let viewers read the selected publication's narrative while keeping controls and playback predictable.

- [x] Add a native story panel with separate creator, preview, Expand/Collapse and resource Retry controls; support plain-text newlines and empty/removed story states.
- [x] Normal-size expanded body occupies at most about half the feed viewport and scrolls internally; controls remain reachable. At larger text sizes allow wrapping and a scrollable larger panel when needed, without covering every video action. Avoid fixed-height text pills and gesture capture over the full video.
- [x] Integrate request invalidation with settled selection, feed Refresh, visibility/access and navigation. Prevent late expansion or offscreen text after fast swipes.
- [x] Keep existing playing/paused/muted state and same selected publication. Test inner-story scrolling versus outer feed swipe and creator taps.

Test gate: mobile tests/typecheck plus a controlled rendered FeedSession/FeedCard harness using the actual store and navigation callbacks. Verify loading/error/empty/2,000-character stories, taps not reaching pause, identity replacement mid-read, and layout/gesture evidence on the phone during Phase F. Do not claim native gesture behavior from a host mock.

Acceptance: story reading never creates/releases an extra player or rewrites the journey checkpoint, and no description/production default is substituted for a missing publication story.

## Phase D — Captions on the owned native player

Goal: synchronized captions in both development and release execution without regressing player scheduling.

- [x] Expose a selected-player product clock through the existing adapter, with one owner of native event interval/subscription. Keep diagnostic sampling separate; do not disable existing development evidence or change native play intent/readiness thresholds.
- [x] Attach only for a current eligible caption resource; remove/rebind on CC off, hidden state, selection/player replacement and disposal. Re-evaluate currentTime after manual pause, source Retry, loop/seek and restoration completion.
- [x] Render a non-intercepting caption overlay above measured collapsed story/description and away from mute/CC/recovery controls; safe-area/large-text layout must use available height rather than a copied browser pixel offset. Hide during expanded story and access/startup errors as specified.
- [x] Add per-video CC state and caption-specific Retry feedback; keep Settings toggle available for videos with no captions. Changing CC never calls Play, seek or feed Refresh.
- [x] Verify the product clock with development diagnostics disabled in a release-mode adapter/component harness. An iOS JS export is a packaging check, not release runtime proof; record the remaining bundled-build qualification separately.

Test gate: mobile tests/typecheck and `npm run export:ios` with output outside the repository (for example `npx expo export --platform ios --output-dir /dev/shm/plan170-ios-export`). Fake selected/neighbor players must prove interval ownership, no obsolete cue updates, pause/loop/seek behavior, no listener growth across 100 transitions, and no caption-driven play/seek/allocation. Rendered release-mode harness must receive cue updates with `__DEV__` false and no diagnostics session.

Acceptance: media time drives cues, the retained player budget remains three, user pause/mute are preserved, and release caption functionality is independent of diagnostic progress.

## Phase E — Integrated access and regression checks

Goal: establish that the new optional text features preserve existing auth, feed and browser behavior before asking for device work.

- [x] Add focused actual-component checks through the real Account/AuthStore, Spaces and profile journey, including CC preference during account switches and creator/personal-feed return. Keep Plan 169's navigation identity regression coverage.
- [x] Exercise access revoke/restore while a story is open or captions load, publication unpublish/hide with stale metadata, session expiry and network loss during protected return. Remove affected media/text through existing feed protections; do not log out a valid account for missing VTT.
- [x] Verify same production/different publication stories and context isolation, including denied personal access despite Global visibility/follow/subscription.
- [x] Add browser regression checks for existing story expansion/editing/default override and CC rendering/endpoints after shared backend edits. Keep editing writes restricted to fixtures. Document browser anonymous full-story limitations and legacy predicate differences accurately.
- [x] Check privacy: no tokens, S3 pointers, signed media URLs or story/cue text in diagnostics/log evidence; no native token accepted on legacy edit/admin routes.
- [x] Update API/mobile developer docs only for implemented behavior; root README only if developer commands/workflow changed.

Test gate: root build/viewer tests; native text API fixture harness; existing `viewer:check` and `viewer:check:creators` using their own fixture credentials; focused existing/new browser harness; mobile tests/typecheck/export. Run fixture-mutating suites sequentially and restore their snapshots. Save API/browser artifacts under `tests/runs/api-curl/plan_170_*` and `tests/runs/playwright/plan_170_*` when implemented. A browser build/deploy is needed only if frontend code changes; preserve web assets during backend-only work.

Acceptance: prior host regression suites and new text contracts pass, actual-component integration matches the state matrix, and no physical pass is inferred from those results.

## Phase F — Focused iPhone acceptance and handoff

Goal: validate new native text behavior and changed playback work with a small staged device protocol.

Prepare the updated bundle and deterministic disposable fixture instructions first. Keep credentials out of chat; do not ask the user to reproduce an uncontrolled freeze repeatedly. Reuse accepted Plan 168/169 results for unchanged behavior, with the targeted regression checks below.

| Check | Expected observation / evidence |
| --- | --- |
| Anonymous Global story | Preview/Expand/Collapse works for an eligible Global publication without sign-in. Long text scrolls; Story controls do not pause the video accidentally. Empty story has no misleading expansion. |
| Same video in two contexts | Fixture stories visibly differ by publication; Global never retrieves the denied personal story. This can be combined with the existing creator detour. |
| Playing and manually paused story | Expansion preserves both states; collapse does not resume a manual pause. Current sound choice survives. |
| Captions on/off | Captioned speech appears in order, toggles immediately and stays aligned through pause, at least one loop and rapid forward/backward swipes. A video without captions remains playable. |
| Preference durability | CC survives Refresh, creator/personal detour and a full app close/reopen. Prior saved startup sound is unchanged. Exercise storage failures on the host; do not simulate device corruption manually. |
| Profile return | With CC on, creator → personal feed → Back to profile → Back restores the original video/time/manual pause with the correct original cue, no mixed text/audio. |
| Hidden and covered states | One Account/Settings round trip and background/lock cycle: no hidden audio/text updates; same video returns after current access checks. Expanded story is collapsed on return. |
| Access/recovery | Scoped fixture denial clears protected story/captions and stops audio while the account stays valid; restoration/Retry recovers without login. Session expiry clears the identity-bound text and returns to anonymous Global. Combine observations; avoid repeated unrelated sign-out protocols. |
| Network/resource failure | Offline protected return conceals text/media until verification recovers. Host-controlled missing/malformed caption case shows caption-specific recovery while video controls remain usable; no indefinite spinner. |
| Readability and gestures | Long story, multiline captions, normal and larger text: visible content readable; Expand/Collapse/CC/Mute/Play/Retry reachable; story scroll and video swipe do not conflict. Record the tested size range and any accepted limit. |

Use a short deterministic caption timing fixture with known cue boundaries and pauses. Host clock/lookup gate: cue changes within one 250 ms sample plus 100 ms scheduling allowance under the controlled harness; correct cue immediately recalculated on seek/restore. Physical speech alignment is qualitative unless a synchronized recording/time trace is captured; do not infer millisecond sync from a first-frame report. No cue should drift further over repeated loops.

After the focused functional checks pass, capture one clean stable-Wi-Fi forward sample with CC on: at least 30 normal prepared transitions, at least two seconds playing per video, prepared first-frame p95 <=150 ms, normal preparation rate >=90%, peak players <=3, zero errors/unexplained unexpected playback or freezes. Keep rapid swipes, stories and backgrounding out of that numerical run; label initial/cold frames separately and retain failures/incomplete transitions. For reference Plan 169 passed 40/40 normal prepared, p95 120.38 ms, peak three. The sample tests the added clock/render/network work; first-frame timing does not measure caption accuracy or native memory.

Use the short mixed functional run for resource/listener evidence rather than demand another generic ten-minute run. Any whole-app freeze stops device testing and requires native tracing before claiming resolution. VoiceOver remains explicitly deferred by the user; include labels/state/focus in host review but do not ask for physical VoiceOver or claim release accessibility acceptance. Acceptance scope clarification from the final user review: medium-size text and controls are readable; some larger-size buttons clip/become unreadable. The user explicitly defers the proposed control/header/menu UI pass, so record this current-build limit without claiming full larger-text support. No UI redesign was included in build2.

- [x] Record app/build, API/bundle version, phone/OS, network, exact covered cases, timing report and residual limits under the existing ignored device-evidence convention `tests/runs/device/plan_170/`.
- [x] Restore only the new fixture grants/content, revoke host-created disposable sessions, and report any deliberately retained device login explicitly. No cleanup of normal accounts.
- [x] Mark phases Complete only after each gate passes or an explicit accepted exception is recorded. Keep no-store/private-media and release qualification limitations distinct.
- [x] Final source/credential/whitespace/link review; run agent-docs check, retaining unrelated baseline findings separately. Commit/push only if requested.

Acceptance: publication-correct readable stories and synchronized optional captions work on the installed native iPhone; permission/identity isolation, profile return and accepted normal-swipe performance remain intact. Initial observations are from the development client; remaining F checks will be completed on Plan 171's bundled internal Release binary with its build identity recorded. Full accessibility/native memory and store-release qualification remain later gates.

## Expected File Impact

The following names identify existing modules and proposed additions; proposed files/commands do not exist yet.

| Layer | Existing touch points | Proposed additions |
| --- | --- | --- |
| Backend | `src/routes/viewer.ts`, `src/features/feeds/viewer.ts`, `repo.ts`, `service.ts`, publication caption pointer loader if extracted | `src/features/publications/viewerText.ts` or equivalent exact-context service; bounded caption loader |
| API/tests | `docs/API.md`, `package.json`, `tests/backend/native*.test.ts` | `tests/backend/nativeText.test.ts`, `scripts/native-text-fixtures.ts`, `scripts/check-native-text.ts`, focused browser regression harness |
| Native data | `mobile/src/api/client.ts`, feed types/adapters and current feed lifecycle integration | `mobile/src/content/` resource API/store and VTT parser/lookup modules |
| Native presentation | `FeedCard.tsx`, `FeedScreen.tsx`, `VideoSurface.tsx`, navigator preference plumbing, PlaybackSettings | Story panel, caption overlay/controller, separate caption preference module |
| Native playback | `coordinator.ts`, `useFeedPlayback.ts` | Minimal selected-player clock contract; no second coordinator/player pool |
| Native tests/docs | Existing API/feed/playback/preferences/navigation tests, `mobile/README.md` | Resource, VTT, caption clock/preference and actual-component integration tests |

Do not reorganize the large web Feed component or migrate browser text loading simply to share code. Pure parser sharing is optional only when additive, build-compatible and covered in both clients; native and browser presentation remain independent.

## Change Log

- 2026-10-22 — User explicitly requested commit and push with the completed bundled milestone. Review/stage the intended Plan170/171 changes and prior Plan169 continuity note; keep private credentials/fixture state/evidence excluded. No product source change since accepted build2. Git handoff in progress.
- 2026-10-22 — A–F Complete for this recorded milestone: final bundled CC-on stable-Wi-Fi report passes (40/40 prepared normal, p95 126.87ms, peak3, zero recorded errors/incomplete/unexpected playback), and user confirms usual text size with no spinners/freeze/overlapping audio. Host/API/browser and device acceptance coverage/limits recorded; fixture grants restored and all A/B sessions inactive. No commit/push.

- Final integration follow-up — a deliberate edited-duration fixture exposed the same pre-edit upload-length clamp in checkpoint restoration. Moved clamping to source readiness using the loaded native duration (with the prior metadata fallback only for legacy/test ports without a duration method). Added longer/shorter/unknown loaded-duration regressions and repeated the actual paused-return/caption check. Player ownership, pause/mute and source scheduling are unchanged.

- 2026-10-22 — A–E implemented and host-validated, uncommitted. Added publication-correct story/VTT routes, isolated fixtures, native bounded transport/cache/parser, independent saved CC preference, inline story panel, selected-player release-capable caption clock and optional caption feedback. Preserved sound/account/journey/player ownership. Final gates: 25 backend contracts, 143 mobile tests/typecheck/iOS export, 84 text API checks, real native-client parser against HTTPS (8 videos/7 captioned/171 normalized cues), existing 150 viewer/83 creator API checks, 9 text/12 creator browser checks, rendered feed/auth/profile checks. F awaits phone observations; no new native binary required.

- 2026-10-22 — Phase A complete (uncommitted): added allowlisted feed metadata, exact-context viewer stories/VTT, bounded/cancelable object reads, isolated fixtures and API contracts. Backend build and 23 viewer contracts pass; live text harness passed (see Validation). No Global fixture publications or normal-account changes.

- 2026-10-22 — Planning only, no implementation commit: inspected browser stories/captions, publication/default semantics, feed eligibility and serialization, native transport/preferences/player clock, installed Expo interfaces and prior accepted evidence. Created Plan 170 and linked it from the implementation index/native roadmap. Existing Plan 169 post-commit note preserved.

## Validation

- Completion review passes: Plans170/171 A–F Complete, current source matches signed/phone report, 53 local links and whitespace/privacy checks pass. Existing 16 older-plan agent-docs findings are unchanged. Final host gates remain 25 backend contracts, 147 combined mobile tests/typecheck, iOS export, API/browser/rendered checks; no source changed during final phone acceptance.
- Final conditions/visible behavior confirmed by user: stable Wi-Fi, Captions On, usual text size, no spinners, frozen controls or overlapping audio. Together with 40/40 prepared normal transitions/p95 126.87ms/peak3 and zero recorded errors/incomplete/unexpected playback, this closes the bundled milestone gate. Evidence `tests/runs/device/plan_171/final-forward-conditions-observation.json`; full scope matrix `tests/runs/device/plan_171/acceptance-matrix.md`. Known readability/physical-sampling/profiling limits remain. Recorded device baseline from Plan167 is iPhone17 Pro Max/iOS26.6.2; OS/model were not re-reported in this final run. Fixture A26/B27 active sessions zero, original roles restored; no normal account changes.

- Final bundled build2 compact forward report numerically passes: 41 selections/frames, 40/40 normal prepared (100%), median105.39ms / p95 126.87ms / max154.29ms, one initial/cold483.56ms, peak3, zero recorded errors/incomplete/issues/unexpected playback. Latest five rows show playing/progress; report omits36 transition details but drops no transitions/events. Installed source identity matches signed/current source; fixture permissions restored and A26/B27 active sessions zero. Raw/evaluation under `tests/runs/device/plan_171/final-forward-*.json`. Await final Wi-Fi/CC/usual-size and visible spinner/freeze/audio confirmation; F remains In Progress until then.

- Bundled B27 isolation/no-caption observation passed. Readability passes at medium sizes; user reports unreadable/clipped buttons at larger sizes and explicitly defers UI changes, recorded as a current-milestone limit. Both disposable fixture users have zero active sessions, original grants restored. Final CC-enabled numerical report remains the F gate.

- Bundled offline-return observation: Back to profile shows “Cannot load profile / Try again”; reconnect recovers the feed under the same account without a password. Source `CreatorProfileScreen` confirms this is the recoverable profile-error branch with Retry. The second Back to original feed while still offline was not explicitly confirmed; keep that physical coverage limit, alongside prior host/development return coverage. Explicit offline Sign out → reconnect → full close/reopen passed: Account/Spaces remain signed out. Read-only cleanup confirms restored roles3359/3360 and zero active A26 sessions; no additional revocation needed. Evidence `tests/runs/device/plan_171/offline-return-logout-observation.json`.

- Bundled expiry UI passed: user reports anonymous Global with session-ended message; Account and Spaces both require sign-in. Expanded-story recovery after prior permission restoration was “Not checked”; retain this as physical coverage limit with host resource tests, without rerunning the permission cycle. Separate expiry audio/Back observations were not supplied. Guarded `finish` restored original roles3359/3360 and revoked bound fixture session71; phase complete, zero active fixture sessions, no ordinary account change. Evidence `tests/runs/device/plan_171/session-expiry-observation.json`. Requested a new fixture login for offline profile-return/recovery followed by explicit offline sign-out/restart; clean up any newly created fixture session separately.

- Bundled restored-access recovery: user used Refresh and confirms video, sound and captions returned. Expanded-story recovery was not explicitly reported; retrospective confirmation requested. After recovery, guarded driver verified the exact one bound fixture session71 and original roles, then expired only session71 for A26. Status expired, roles3359/3360 still restored, zero active fixture sessions; no normal accounts changed. Await foreground anonymous reset/clear protected media-text/Account sign-in/Spaces gate/Back isolation before final cleanup. Evidence `tests/runs/device/plan_171/access-recovery-and-expiry-applied.json`.

- Bundled access denial passed automatically: user reports “Refresh was not needed. Still signed in. All good” for Access unavailable, stopped video/audio and hidden protected story/captions. Lifecycle retrospectively confirmed “Passed all those checks”: covered Account/Settings and background/lock stop audio, same video/captions return, manual pause survives Account. Original roles3359/3360 restored to only A26 in personal64; guarded status restored, one bound active phone session, normal accounts unchanged. Await video/audio/caption/story recovery without login before expiry. Evidence `tests/runs/device/plan_171/access-denial-and-lifecycle-observation.json`.

- Bundled access protocol: user confirms the test personal feed is currently playing (“Okay, it's playing”). Read-only driver status confirmed original roles3359/3360 and exactly one active fixture session; guarded `deny` bound that session and removed only A26's roles in fixture personal space64. After status: denied, zero explicit roles, one active fixture session, no normal accounts changed. Evidence `tests/runs/device/plan_171/access-removal-applied.json`. Await device denial/media-text concealment/still-signed-in observation before restoring. Lifecycle protocol success is not inferred from the readiness-only reply; a concise retrospective confirmation is pending.

- Bundled CC-on creator/personal-feed return passed: user confirms “Yes, all is good” for original publication/near saved position, still manually paused, correct original cue, no overlapping audio, and “Origin story” restored rather than the destination publication story. Evidence `tests/runs/device/plan_171/creator-return-observation.json`. Position is qualitative, not a synchronized timing trace. No lifecycle/access or numerical gate inferred.

- Bundled build 2 caption/story physical check passed: user answers “Yes, all good” to CC speech alignment and restart after a loop; playing story expand/scroll/collapse preserves video/audio while captions hide/return; expansion/collapse preserves manual pause; text and controls readable/reachable at current phone size. Evidence `tests/runs/device/plan_171/story-captions-observation.json`. Speech sync is qualitative; no larger-size range, numerical timing or creator-return acceptance inferred.

- Connection recovery: user confirms Video Viewer works again. Existing EAS config has development/simulator profiles only; a bundled internal-preview profile/build is the concrete next option to remove Metro/tunnel dependence. Host API uses direct HTTPS; media uses the supplied CloudFront HLS URLs; the running development tunnel is Expo/ngrok. No evidence establishes that the transient development connection notice caused prior HLS buffering. No product code/build change for this observation.

- First physical result: user confirms captions follow speech, hide during expanded story and return on collapse. A red development-server connection notice then interrupted testing. Metro/API/tunnel currently respond; full tunnel iOS bundle HTTP200 (5,249,879 bytes), launch307, disk2.7GB free. Requested one Reload/reopen and exact wording if persistent; no passed-feature repeat. Existing Metro buffer has untimestamped native shared-object getter / React working-state errors, not correlated with this report. Cause remains unconfirmed. Evidence: `tests/runs/device/plan_170/initial-story-captions-observation.json`. Manual pause, full story scrolling/control reachability, persistence/return/access/lifecycle and numerical gates remain pending.

- Final review: whitespace/local Markdown links and scan of changed/new files against private fixture password values pass; no credentials or private fixtures are in the change set. Root/API/mobile developer docs and roadmap/index updated. Agent docs check retains the same 16 older-plan findings, with no new reference or Plan 170 issue. Exact review counts in `tests/runs/device/plan_170/final-review.json`. Physical observations remain pending.

- Final host pass: backend build and 25 viewer contracts (`tests/runs/api-curl/plan_170_phase_a/backend-final.log`); 143 mobile tests/typecheck/export (`tests/runs/device/plan_170/host/`). Expanded text API harness passes 84 checks, including owner ban, members-only exact-publication filtering in a public space, legacy cookie owner story reset/edit and restored fixture override, and revoked-token rejection. Final harness log `tests/runs/api-curl/plan_170_phase_a/api-final.log`.
- Real native client integration: `cd mobile && npm run check:text` passes against the HTTPS development API using actual feed adapter/resource store/VTT parser: 8 fixture videos, 7 captioned, 171 normalized cues, zero access-denied callbacks. Created session revoked in finally; no transcript contents or credentials in summary. Actual generated VTT is covered, not only synthetic fixtures.
- Integration: controlled release-mode rendered FeedScreen/FeedCard/StoryPanel/CaptionLayer/coordinator/native-adapter harness passes selected clock, pause/story/background/swipe/focus/disposal, <=3 players and restored paused time 2.2s showing the correct cue. The same check uses intentionally shorter upload metadata to verify that loaded production duration, not original upload length, bounds captions. Native ports/layout are controlled doubles, so no physical scroll/timing/memory claim. Actual Account/Spaces/AuthStore/StackRouter check additionally proves caption preference retained across identity changes; existing profile journey harness retains 140 assertions. Scripts stay in ignored `.codex-local/plan170-*-check.cjs` and outputs are copied under the host evidence directory.
- Existing API regressions: viewer150 and creator83 pass sequentially with their scoped fixture restoration. Browser regressions pass story expansion/collapse, legacy VTT fetch/CC state, viewer cookie read/logout (9 checks, `tests/runs/playwright/plan_170_text/`), and public/hidden profiles/creator peek/access (12 checks, `tests/runs/playwright/plan_169_profiles/`). Backend-only extension; no browser asset rebuild/deploy.
- Installed Expo source confirms TextDecoder/fetch-stream support in `expo/src/winter/`; native caption code uses the pinned SDK57 API without dependency/native configuration changes. Actual native runtime rendering/stream behavior still needs the phone checks.

- Phase D: 140 mobile tests/typecheck and iOS export pass (`/dev/shm/plan170-mobile-d.log`, `/dev/shm/plan170-export.log`, export `/dev/shm/plan170-ios-export`). Actual CaptionLayer rendered with `__DEV__` false and no diagnostic session passes synchronization/pause/loop/concealment/resource retry plus 30 rebindings without listener growth. Pure adapter clock tests exercise 100 release subscriptions and interval restoration; no native release-runtime pass is claimed.

- Phase C: all 138 mobile tests/typecheck pass. Actual StoryPanel rendered harness passes loading/long-text/collapse/late-response concealment/retry/empty states and touch-propagation isolation (`.codex-local/plan170-story-check.cjs`, local host harness). Native nested scroll versus feed swipe and physical layout remain Phase F observations; no phone pass inferred.

- Phase B: all 138 mobile tests and typecheck pass (`/dev/shm/plan170-mobile-b.log`). New cases cover VTT subset/linger/seek, streaming MIME/byte/abort limits, typed missing-caption versus denied-publication errors, stale response rejection, bounded cache freshness/eviction and serialized independent preference writes. The Phase A live API result was 63 checks, actual fixture VTT 678 bytes.

- Phase A: root build and 23 backend viewer contracts passed. Live disposable text fixture harness passed; raw log `tests/runs/api-curl/plan_170_phase_a/api.log` records check count and actual VTT bytes. Tests include anonymous Global, cookie/native identity, distinct stories for one production, missing captions, hidden/unpublished exact rows, revoked/restored fixture permission and sanitized resource failures. Host-created native/browser sessions revoked; fixture metadata retained for phone checks. Malformed/oversized/stream cancellation are controlled unit cases rather than malformed uploaded S3 objects.

- Planning environment: `/home/ubuntu/aws`, branch main, implementation baseline `49e8dd6`; only the pre-existing Plan 169 continuity note was modified before this task.
- Planning baseline: read-only inspection used `rg`, targeted source/doc reads and installed `expo-video` type declarations. No API/browser/device test was executed for this planning task, no fixture was mutated and no application source/configuration/dependency changed. The source findings above are not runtime acceptance.
- Planning baseline: `npm run check:agents:docs` before and after planning edits: the identical 16 existing older-plan status/header findings (Plans 138, 140–142, 148–159), with no Plan 170 or new reference finding. Targeted validation passes for this plan/index/roadmap: all 16 local Markdown links resolve, required plan headings and A–F Pending statuses are present, no duplicate archived Plan 170 exists, and whitespace checks pass (including the new untracked plan, which `git diff --check` alone would omit). No unrelated plan statuses were edited.
- External technical references checked 2026-10-22: [Expo SDK 57 video reference](https://docs.expo.dev/versions/v57.0.0/sdk/video/) and installed `mobile/node_modules/expo-video/src/VideoPlayer.types.ts` / `VideoPlayerEvents.types.ts` for `timeUpdateEventInterval` and `timeUpdate`; [W3C WebVTT working specification](https://www.w3.org/TR/webvtt1/) for cue/header/timestamp structure. The installed package is the implementation authority; the rolling latest Expo docs describe a later SDK and are not an upgrade instruction. Linger/merge behavior is this app's policy, not WebVTT conformance.
- Host implementation/API contracts and the sampled generated VTT corpus are now verified as recorded above. Physical native text layout/gestures, caption alignment and performance with CC remain unverified until Phase F.

## Open Risks / Deferred

- Browser legacy text read eligibility differs from the viewer contract. This plan avoids copying those shortcuts and retains their current behavior; complete legacy authorization migration is separate work.
- Written stories on anonymous Global expand through the proposed viewer API, while the current browser only fetches full stories when signed in. Treat that as an explicit additive native decision and test only text belonging to an eligible Global publication.
- The live native parser check covers eight fixture videos/seven ready transcripts, not the whole media corpus. A ready database row can point to a missing/malformed object; resource-level recovery must remain separate from feed authorization. Very large or advanced VTT may be unsupported under the documented limits.
- Browser short-cue merging can move a trailing word into an earlier display interval. Preserve the intended reading style, document normalization precisely and use actual speech alignment to assess it; do not claim exact word-level timing.
- Captions require product time events in release. A passing development report alone cannot establish release behavior; host `__DEV__`-false coverage is required here, with bundled native runtime qualification retained for the distribution milestone.
- Caption-fetch overhead and extra rendering could reduce preparation rate or increase resource use. Fetch only the selected eligible resource, bound caches, isolate text updates and run the focused CC-enabled numerical sample.
- First-frame metrics do not prove playback motion, caption sync or leak-free native memory. Keep playing/progress evidence and platform profiling separate.
- Plan 169's prior all-controls freeze has an unconfirmed native cause; subsequent acceptance passed without recurrence. Preserve controller safeguards and obtain native traces on recurrence rather than claim caption work resolves it.
- Existing public HLS URLs remain accessible independently of feed permission. Authorized no-store text delivery does not secure video playlists/segments/posters or revoke content already delivered. Private media remains a separate release requirement.
- VoiceOver was explicitly skipped by the user; full maximum-size/OS caption preference integration, accessibility certification, Android, translation, publishing/editing, offline text downloads and TestFlight/App Store acceptance remain deferred.

## Resume Here

1. Complete: A–F for the recorded native story/caption milestone. Host/API/browser checks and bundled build2 phone acceptance pass; final stable-Wi-Fi/CC-on sample is 40/40 normal prepared, p95 126.87ms, peak3, zero errors/incomplete/unexpected playback; user reports no spinners/freeze/audio overlap. Use Plan 171 and the acceptance matrix for precise runtime/physical limits.
2. Current app is signed internal Release build `7a049a95-613f-4e81-98ee-4c761cc80772`, version0.1.0/build2, source `e912143476b62e0a802eec3985058c2bb1982652b6e5feb2ec29e720069e4d0a`. Metro/tunnel intentionally stopped; API3300/public health online. No development-server connection is needed by this binary.
3. Fixture A26/B27 have zero active sessions; original A26→personal64 roles3359/3360 restored; access driver complete and old bound session71 revoked. No retained fixture login or pending grant cleanup. Keep private credentials/evidence ignored; do not rerun mutation helpers for documentation work.
4. Scope limits: medium-size controls readable; larger-size clipping explicitly deferred to later UI work. Prior upgrade state unknown; anonymous/empty/rapid text edge cases, expanded-story recovery, second offline Back and separate expiry audio/Back observations have host/development coverage rather than a distinct full bundled phone pass. No VoiceOver, private-CDN, native-memory or store-release qualification.
5. Implementation is uncommitted/unpushed; preserve Plan169's pre-existing continuity note. Commit/push only when requested. Keep this recent completed plan through the Git handoff, then consider archiving under repository policy. No new UI implementation is authorized by the design comments alone; roadmap records the proposed controls/navigation refinement.
