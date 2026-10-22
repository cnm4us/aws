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

## Active / Next
- Latest completed native increment: `agents/implementation/plan_169.md` (A–F Complete for the recorded iPhone development milestone; creator profiles and authorized personal-feed return, final 40/40 normal transitions prepared, p95 120.38 ms, peak three. Coverage limits and prior unconfirmed native-freeze cause retained. Recent plan retained through review/Git handoff; user authorized commit/push, staging in progress).
- Next native scope: remaining viewing/discovery from `agents/roadmaps/roadmap_native_viewing.md`; create its detailed plan before implementation.
- Previous completed: `agents/implementation/plan_168.md` (A–H Complete — signed-in native Global/Spaces viewing alongside web; committed/pushed as `6cfad70`; VoiceOver deferred and other acceptance limits recorded)
- Other active work: `agents/implementation/plan_166.md` (moderation user groups)
- Native feature contract: `agents/features/feature_02_personal-space-global-feed-context-integrity.md`
- Check latest `plan_NN.md` with `Status: Active`.
- Continue from that plan's `Resume Here` section.
- If no plan is `Active`, create a new `plan_NN.md` from `PLAN_TEMPLATE.md`.
