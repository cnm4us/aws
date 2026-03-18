# Feature 13: Feed Campaign Inserts (Future Expansion of In-Feed Messages)

## Summary
Evolve today’s in-feed message capability into a broader feed campaign system that can support:
- registration/login messages
- fund drive messages
- limited corporate sponsor slides
- other house/community messages

This is a future-direction document (intent + product framing), not an implementation spec.

## Product Intent
The platform aims to be "Public Social Media" (analogous to Public Radio), intentionally avoiding the ad-revenue/outrage/dopamine cycle.

Feed inserts should support that model by enabling:
- mission-aligned calls-to-action (e.g., register, subscribe, support)
- periodic fund drives for non-subscribers
- limited, clearly bounded corporate sponsor placements

## Core Principles
- Trust first: inserts must not degrade the core feed experience.
- Mission alignment: prioritize community and sustainability over engagement manipulation.
- Audience respect: subscriber status must influence what users see.
- Policy-driven behavior: eligibility and pacing should be configurable and auditable.
- Measurable outcomes: every insert type should have analytics coverage.

## Audience Expectations
- Subscribers:
  - should not see fund drive asks.
  - may still see neutral house messages if policy allows.
- Non-subscribers:
  - can be shown fund drive messages under frequency limits.
- All users:
  - should see only tightly controlled sponsor placements.

## Scope Expansion Concept
Current `Messages` can later expand into a generalized `Feed Campaigns` model with campaign types such as:
- `auth_prompt`
- `fund_drive`
- `sponsor`
- `house_message`

Current in-feed message targeting and insertion mechanics are a strong base for this evolution.

## High-Level Functional Needs (Future)
- campaign type and category taxonomy
- audience targeting (subscriber/non-subscriber, auth state, surface)
- pacing/frequency controls per campaign type
- explicit exclusions (e.g., fund_drive excluded for subscribers)
- scheduling windows
- creative variants for experimentation
- analytics by campaign type/category/outcome

## UX Direction
- inserts should feel native in feed flow (not disruptive popups)
- clear distinction between:
  - community/fund-drive messaging
  - sponsor messaging
- predictable exposure: strict caps and cooldowns by default

## Governance & Safety
- sponsor inventory should remain intentionally small and policy-bounded
- rule changes should be traceable and reversible
- campaign analytics should support integrity checks (overexposure, mis-targeting)

## Out of Scope (For Now)
- schema migrations from prompts to campaigns
- admin UI redesign for campaign management
- targeting engine changes
- subscriber entitlement integration details
- insertion algorithm changes

## Relationship to Current Work
This feature is a strategic extension of:
- `admin/messages`
- in-feed message decision/insertion logic
- message analytics

Implementation planning will happen later when prioritization moves from message UX polish to campaign system expansion.

## Current Naming Note
User-facing/admin terminology should use `Message` / `In-Feed Message`.

Current implementation details are message-first at the table/module level:
- `feed_messages`
- `message_decision_sessions`
- `feed_message_events`
- `feed_message_daily_stats`

Active runtime payloads, routes, and tables are message-first. Remaining prompt-era strings are limited to migration logic and historical planning context.
