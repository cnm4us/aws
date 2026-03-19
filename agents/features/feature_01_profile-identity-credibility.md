1. Core Concepts (Authoritative Definitions)
1.1 Profile (Public Identity Layer)

The Profile represents who a user chooses to be in the system.

It is:

Public-by-design

Singular per user

Persistent across all spaces

Ceremonial to edit

Viewable by other users

The Profile is a social object, not a configuration surface.

1.2 Identification (Private Verification Layer)

Identification represents how the system verifies that a user is a real, accountable human.

It is:

Private and non-social

Not expressive

Not discoverable by other users

Not editable as part of Profile

Treated as security and compliance infrastructure

Identification exists to support trust, moderation, and recovery — not self-presentation.

1.3 Credibility (Contextual Trust Layer)

Credibility is the system’s assessment of a user’s standing within a specific space (channel or group).

It is:

Scoped per space

Based on behavior and rule adherence

Expressed publicly as general labels

Fully explainable privately to the user

Credibility is neither global nor numerical.

2. Profile Responsibilities (What Belongs Here)
2.1 Identity & Presence

The Profile surface includes:

Display name

Avatar / profile image

Short bio / description

Other intentional self-descriptive fields

Field-level visibility controls

Edits to these fields are:

Explicitly previewed

Clearly marked as public

Intentionally frictioned (ceremonial)

2.2 Space-Scoped Credibility Signals

When a Profile is viewed within a given space, it may display:

Current credibility / standing label for that space

High-level status only (e.g., “Good Standing”, “Posting Limited”)

The Profile must not expose:

Metrics

Strike counts

Internal moderation notes

Cross-space credibility leakage

2.3 Private Credibility Explanation (Self View Only)

When users view their own Profile, they may access:

Detailed explanations of their credibility status per space

Clear reasons for the current status

Guidance on remediation and recovery

Expectations for improvement

This experience must be:

Informational, not punitive

Transparent, not algorithmically opaque

Actionable, not vague

3. Identification Responsibilities (What Explicitly Does NOT Go in Profile)
3.1 Identification Data

Identification includes (non-exhaustive):

Phone number verification

ID.me or equivalent services

Alternative verification providers

Fraud or bot-detection signals

This data is:

Never displayed on Profile

Never visible to other users

Never editable through Profile flows

3.2 Placement & Access

Identification is accessed via:

Settings → Account / Security / Verification

It may influence:

Which actions a user can take

Which spaces a user can participate in

Whether additional verification is required

It does not change:

The user’s Profile identity

Their name, persona, or presentation

3.3 Public Indicators (Abstracted)

The system may expose abstract verification signals, such as:

“Verified Human”

“Additional verification required to post here”

These indicators:

Do not reveal verification methods

Do not disclose providers

Do not expose sensitive metadata

4. Boundary Rules (Non-Negotiable)

Profile never reveals Identification mechanisms

Identification never alters Profile identity

Credibility is contextual, not global

Public views show status, not evidence

Private views show evidence and paths forward

One human = one identity across time

Sanctions attach to identity, not personas

Recovery is possible and explainable

5. UX Posture (Guiding Principles)

Profile edits feel intentional and durable

Identification feels protective, not coercive

Credibility feels legible, not gamified

Moderation feels procedural, not arbitrary

Transparency is prioritized over mystery

Accountability is prioritized over anonymity theater

6. Explicit Non-Goals (Out of Scope for This Plan)

Database schema

UI component design

Scoring formulas

Moderation algorithms

Provider selection details

Enforcement heuristics

These are intentionally deferred to implementation planning.

7. Handoff Intent (For Codex)

Codex is expected to:

Respect these conceptual boundaries

Preserve separation of concerns

Avoid collapsing Profile and Identification

Avoid inventing global scores or personas

Implement with restraint and clarity

This plan is the source of truth for Profile and Identification semantics.