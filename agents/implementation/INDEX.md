# Implementation Index

This file is a lightweight index for ongoing implementation work.

## Planning Standard
- Active execution continuity lives in `agents/implementation/plan_NN.md`.
- Use `agents/implementation/PLAN_TEMPLATE.md` when creating new plans.
- Archived plans live in `agents/implementation/archives/`.
- Archive navigation: `agents/implementation/archives/INDEX.md`.
- Lifecycle rule: keep only active/recent plans in `agents/implementation/`.
- Move a plan to `archives/` when it has `Status: Complete` and no immediate follow-up execution remains.

## Roadmaps
- `agents/roadmaps/roadmap_create_video.md` — timeline-based Create Video composer
- `agents/roadmaps/roadmap_native_viewing.md` — web and native viewing over a shared backend

## Recent Plans
- `agents/implementation/plan_129.md` — Prompt/message targeting model completion
- `agents/implementation/plan_130.md` — Rename prompts to messages (UI/route/module phases)
- `agents/implementation/plan_131.md` — Message-first API path cleanup
- `agents/implementation/plan_132.md` — Message wire contract cleanup
- `agents/implementation/plan_133.md` — Final message conversion cleanup
- `agents/implementation/plan_134.md` — Admin debug panel + structured browser debug emission
- `agents/implementation/plan_135.md` — Unified client debug model + bundle analysis upgrades
- `agents/implementation/plan_136.md` — Message CTA completion attribution + completion-based suppression
- `agents/implementation/plan_137.md` — Modular CTA widget (message content split + multi-CTA workflows)
- `agents/implementation/plan_138.md` — Reusable message CTA definitions + slot-based placement
- `agents/implementation/plan_139.md` — Payments foundation and provider wiring
- `agents/implementation/plan_140.md` — Support checkout and subscription UX flows
- `agents/implementation/plan_141.md` — PayPal subscription lifecycle integration
- `agents/implementation/plan_142.md` — Message eligibility rulesets (inclusion/exclusion)
- `agents/implementation/plan_143.md` — Remove audience segment and move to rulesets-only targeting
- `agents/implementation/plan_144.md` — Stateful message journeys (progression, admin, observability)
- `agents/implementation/plan_145.md` — CTA outcome canonicalization + policy-driven completion architecture
- `agents/implementation/plan_146.md` — Journey-level eligibility rulesets (remove step-level ruleset gating)
- `agents/implementation/plan_147.md` — Multi-surface targeting for messages and journeys
- `agents/implementation/plan_162.md` — Moderation v2 two-stage pipeline rollout and hardening
- `agents/implementation/plan_163.md` — Moderation admin IA consolidation (`/admin/moderation/*` route and nav migration)
- `agents/implementation/plan_164.md` — Global moderation signals registry and rule/culture signal linkage
- `agents/implementation/plan_165.md` — Moderation signal classification evolution (`polarity` + `signal_family`)
- `agents/implementation/plan_166.md` — Retire moderation categories and move reporting entry to moderation user groups
- `agents/implementation/plan_167.md` — Anonymous iOS video feed POC with Expo Go, vertical paging, and preloaded playback
- `agents/implementation/plan_168.md` — Signed-in native viewing across Global and existing accessible personal/group/channel spaces
- `agents/implementation/plan_169.md` — Creator profiles, authorized personal-space entry, and return to the original native feed/video
- `agents/implementation/plan_170.md` — Native publication stories and timed captions; A–F Complete for recorded bundled milestone with limits
- `agents/implementation/plan_171.md` — Bundled internal iPhone Release preview; A–F Complete, build2 accepted with limits
- `agents/implementation/plan_172.md` — Native controls, space navigation, account menu and large-text layout; A–F Complete for build6 phone/performance acceptance with recorded limits; implementation committed/pushed as `f0ed1b3`

- `agents/implementation/plan_173.md` — Native Creator action and authorized Global → group/channel → Global launch; A–F Complete for signed build10 with recorded limits; performance gate passed, recovered cold186 stall retained; commit/push authorized, delivery verification in progress

## Active / Next
- Latest completed native milestone: `agents/implementation/plan_173.md` — A–F Complete with recorded limits on signed build10. Creator/Global Launch exact paused/playing/nested return, Refresh, captions/story, lifecycle, quiet bounded renewal, automatic denial/recovery, offline recovery and sign-out pass. Confirmed Wi-Fi/CC/usual-size forward sample:54 transitions,52 prepared,p95132.86ms,98.11% normal preparation,peak3,0 errors/incomplete/unexpected; all54 have playing/progress. Full timeline reviewed; recovered cold186 firstFrame7.96s/playing8.27s/progress8.65s remains explicit residual, repeat firstFrame123ms.34 prepared>=2s-media rows independently pass p95133.48ms; pacing/history/physical limits retained. Fixtures restored,0 active native fixture sessions. Host161 unit/27 rendered/typecheck/export/archive/artifact pass. No further phone run; commit/push authorized on 2026-10-23; delivery verification is in progress.
- Prior completed bundled baseline: `agents/implementation/plan_171.md` — A–F Complete. Signed 0.1.0/build2 installed, Metro/tunnel off, API online. Functional phone acceptance and stable-Wi-Fi/CC-on sample pass: 40/40 normal prepared, p95 126.87ms, peak3, zero errors/incomplete/unexpected playback; no user-observed spinners/freeze/audio overlap. Fixtures restored, no active test sessions. Medium text readable; larger-size clipping and recorded coverage limits remain. Implementation committed/pushed as `1dfd494`; delivery records follow separately. Recent completed plans retained through handoff.
- Completed text milestone: `agents/implementation/plan_170.md` — A–F Complete. Publication-correct stories/captions, saved CC, host/API/browser/rendered and bundled phone acceptance, with explicit limits.
- Latest native UI milestone: `agents/implementation/plan_172.md` — Build6 installed and accepted over recorded ranges: compact CC/audio pills (50%/100% glyph, 25% background), scalable type-icon header, Feed/Profile Menu, guarded Refresh/returns and delayed caption-loading notice. Stable-Wi-Fi/CC-on/usual-size sample:42/42 normal prepared, p95121.03ms, peak3, zero errors/incomplete/unexpected playback; user confirms CC spinner gone, caption speech sync, no frozen controls/audio overlap. A–F Complete and documentation checked; implementation committed/pushed as `f0ed1b3`, remote implementation SHA verified; delivery records follow separately. All-screen maximum-size/upgrade comparison/VoiceOver/native-memory/store limits retained.
- Latest completed native increment: `agents/implementation/plan_169.md` (A–F Complete for the recorded iPhone development milestone; committed/pushed as `49e8dd6`; creator profiles and authorized personal-feed return, final 40/40 normal transitions prepared, p95 120.38 ms, peak three. Coverage limits and prior unconfirmed native-freeze cause retained).
- Next planned feature: native Like/Comment participation within authorized spaces, with shared server context/permission checks; Global stays discovery-only. Research and implementation require a separate plan. Keep recovered cold-start performance residual visible.
- Later native scope: discovery/shared links, participation and TestFlight/public-release distribution from `agents/roadmaps/roadmap_native_viewing.md`; separate plans before implementation. Bundled internal distribution is complete for Plan171's recorded internal milestone; store release remains separate.
- Previous completed: `agents/implementation/plan_168.md` (A–H Complete — signed-in native Global/Spaces viewing alongside web; committed/pushed as `6cfad70`; VoiceOver deferred and other acceptance limits recorded)
- Other active work: `agents/implementation/plan_166.md` (moderation user groups)
- Native feature contract: `agents/features/feature_02_personal-space-global-feed-context-integrity.md`
- Check latest `plan_NN.md` with `Status: Active`.
- Continue from that plan's `Resume Here` section.
- If no plan is `Active`, create a new `plan_NN.md` from `PLAN_TEMPLATE.md`.
