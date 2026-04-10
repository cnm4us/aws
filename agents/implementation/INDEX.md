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

## Active / Next
- Active now: `agents/implementation/plan_163.md`
- Feature contract: `none`
- Check latest `plan_NN.md` with `Status: Active`.
- Continue from that plan's `Resume Here` section.
- If no plan is `Active`, create a new `plan_NN.md` from `PLAN_TEMPLATE.md`.
