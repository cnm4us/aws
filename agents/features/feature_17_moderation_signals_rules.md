Feature Request: Global Signals UI and Signal Registry for Culture-Aware Moderation

Context

We are building a culture-aware moderation system for a video-first platform.

The moderation architecture is evolving toward a structured two-stage AI pipeline:

1. Measurement
- AI detects signals and issue matches from content
- AI returns severity, confidence, and evidence

2. Judgment
- AI uses the Stage 1 assessments plus cultural context to produce:
  - decision_reasoning
  - ai_judgment

The system also includes:
- versioned rules
- culture definitions with dimensions
- human moderator review and override
- auditability and refinement over time

The system is moving toward:
- a global signal vocabulary
- rules that reference signals
- cultures that select positive and disruptive signals from the global vocabulary
- structured AI-facing rule specifications for measurement
- structured cultural definitions for judgment

This aligns with the existing moderation framework emphasis on structured, reusable, versioned components and the principle that rules define violations while cultures define tolerance and context. :contentReference[oaicite:0]{index=0}

Problem

Right now, signals are effectively being managed from within culture definitions.

That is not the right long-term architecture.

We need a global signal registry so that:
- signals are defined once
- signals are reused consistently across rules and cultures
- measurement uses a stable canonical signal vocabulary
- judgment uses stable mappings from detected signals to cultural dimensions
- admins cannot invent ad hoc signal strings separately in each culture

At the same time, we still want culture definitions to be able to choose which signals are:
- positive signals
- disruption signals

So the correct model is:

1. Signals are defined globally
2. Rules reference global signals
3. Cultures reference global signals
4. Judgment uses a global signal-to-dimension mapping
5. Human-readable and machine-readable moderation logic remain aligned

Requested Feature

Create a Global Signals admin UI at:

/admin/moderation/signals

This page should manage the global signal registry and support the future moderation pipeline.

Goals

1. Define signals once globally
2. Allow rules to reference signals
3. Allow cultures to reference signals
4. Support future signal-to-dimension mapping for judgment
5. Prevent drift and duplication in signal naming and meaning
6. Provide a foundation for AI measurement consistency

Core Design Principle

Signals are global.
Rules use signals.
Cultures reference signals.
Judgment interprets signals through dimensions.

This should become a foundational part of the moderation architecture.

What the Global Signals UI Should Support

The /admin/moderation/signals page should allow admins to create and manage a global signal registry.

Each signal should support structured fields such as:

- id
- label
- short description
- long description or guidance
- examples (optional or future)
- status (active / inactive / draft)
- versioning support or revision awareness
- metadata needed for future mapping and reuse

The initial version does not need to solve every downstream use case, but it should be designed so signals can later support:

- measurement pass signal definitions
- rule linkage
- culture linkage
- signal-to-dimension mapping
- auditability

Recommended Signal Object Shape (discussion baseline)

{
  "id": "dismissive_language",
  "label": "Dismissive Language",
  "short_description": "Language that rejects or belittles another person's view without meaningful engagement.",
  "long_description": "Use this signal when content dismisses, brushes off, or belittles another participant's perspective without seriously engaging the substance of what was said.",
  "status": "active"
}

This is only a baseline discussion shape and can be revised.

Required Relationships

This feature needs to support two kinds of relationships:

1. Rules ↔ Signals
2. Cultures ↔ Signals

These need to be explicit and manageable.

Important Clarification on Mapping

We do NOT want a rigid one-to-one global signal-to-rule mapping.

A signal may be relevant to more than one rule.
A rule may reference more than one signal.

So this relationship is many-to-many.

Examples:
- dismissive_language may contribute to hostility-related rules
- unsupported_factual_assertion may contribute to credibility-related rules
- one rule such as hostility may reference several signals

Similarly, cultures should be able to reference many signals as:
- positive_signals
- disruption_signals

So this is also many-to-many.

Feature Requirements

A. Global Signals Registry UI
Create /admin/moderation/signals with the ability to:

- list all signals
- create a new signal
- edit an existing signal
- archive or deactivate a signal
- view where a signal is used
- search/filter signals
- see whether a signal is referenced by:
  - rules
  - cultures
  - future mappings

B. Rule-to-Signal Association
Provide a mechanism so rules can reference global signals.

This may be:
- embedded in the existing rule editor UI
- or accessible from the signal detail page
- or both

At minimum, the system needs a clean many-to-many relationship between rules and signals.

The admin should be able to:
- attach signals to a rule
- detach signals from a rule
- see which signals a rule uses
- see which rules reference a signal

This is important because Stage 1 measurement will rely on rule AI specs that reference signals.

C. Culture-to-Signal Association
Provide a mechanism so culture definitions can reference global signals.

This may continue to appear in the culture editor as:
- positive_signals
- disruption_signals

However, these must become references to globally defined signals, not ad hoc strings.

The culture editor should:
- present selectable global signals
- allow curation of positive_signals
- allow curation of disruption_signals
- prevent arbitrary custom signal strings in v1

D. Foundation for Future Signal-to-Dimension Mapping
This feature should be designed so that a future system can map signals to judgment dimensions.

Example future relationship:
- dismissive_language → tolerance.hostility
- unsupported_factual_assertion → credibility_expectation
- provocative_derailment → discourse_mode

This future mapping does not necessarily need to be fully implemented now, but the schema and UI design should not block it.

Why This Matters

This feature is needed because the two-stage AI moderation pipeline depends on stable signal reuse.

Stage 1 Measurement needs:
- global signal vocabulary
- rule-linked signal definitions

Stage 2 Judgment needs:
- detected signals
- culture-selected signal relevance
- future signal-to-dimension mapping

Without a global signal registry:
- cultures drift
- rules duplicate terminology
- AI outputs become less consistent
- reasoning becomes harder to audit

Expected Architecture Direction

Global layer:
- signal registry

Rules:
- reference signals

Cultures:
- reference signals as positive/disruptive subsets

Future judgment layer:
- maps signals to dimensions

This should result in a reusable moderation language where:
- signals are the vocabulary
- rules are issue patterns
- cultures shape meaning and relevance

Suggested Data Model Direction

Please analyze the best storage model, but assume we likely need:

1. signals table
2. rule_signals join table
3. culture_positive_signals join table
4. culture_disruption_signals join table

Potentially later:
5. signal_dimension_map table

This is only a directional suggestion, not a mandated schema.

UI / UX Expectations

## Current Classification Model

The signals registry now uses a two-layer classification model:

- `polarity`
  - simple operator-facing grouping
  - allowed values: `positive`, `disruptive`
- `signal_family`
  - normalized internal classification for organization, filtering, and future mapping work
  - constrained by polarity

Current controlled vocabulary:

- Positive families
  - `clarity`
  - `engagement`
  - `reasoning`
  - `tone_positive`
- Disruptive families
  - `discourse_tone`
  - `discourse_quality`
  - `targeting`
  - `aggression`
  - `safety_harm`
  - `privacy_identity`
  - `sexual_exploitation`
  - `credibility`

This means:

- signals remain globally reusable
- cultures still curate `positive_signals` and `disruption_signals`
- rules still link to the same global signals
- admin browsing stays simple at the top level
- future signal-to-dimension work can build on the stronger normalized classification

## Temporary Measurement-Oriented Assignments

The current registry also contains several moderation-v2 measurement-oriented signals that are temporarily classified so the system can stay structurally consistent while the catalog is curated:

- `qualified_language` -> `positive / clarity`
- `assertive_language` -> `disruptive / credibility`
- `direct_identifiers` -> `disruptive / privacy_identity`
- `indirect_identifiers` -> `disruptive / privacy_identity`
- `factual_assertion` -> `positive / reasoning`

These assignments are intentionally provisional. They preserve structure now without implying that the catalog curation is finished.

## Deferred ID Cleanup

Signal-ID singularization is still deferred unless the rename is proven safe across:

- rule contracts
- culture signal relationships
- moderation-v2 references

Known alias/normalization follow-up remains a separate cleanup step rather than part of the live classification rollout.

For /admin/moderation/signals, please consider:
- a list view
- detail/edit form
- status indicators
- usage indicators
- ability to see linked rules and cultures
- ability to avoid deleting in-use signals unsafely

For the culture editor:
- signal selection should come from the global registry
- checkboxes, multi-select, or controlled selection UI is fine
- no freeform signal text entry in v1

For the rule editor:
- signals should be selectable from the global registry
- this should support many-to-many linkage cleanly

Out of Scope for This Feature

Please do not implement the full measurement and judgment pipelines yet.

Please do not implement full signal-to-dimension mapping yet unless it is low-cost and clearly foundational.

Please do not redesign the entire culture system in this feature.

This feature is specifically about establishing the global signal registry and its relationships to rules and cultures.

Questions to Analyze

Please respond with a discussion-ready feature analysis that covers:

1. The recommended data model for global signals
2. The recommended UI structure for /admin/moderation/signals
3. The recommended relationship model for:
   - rules ↔ signals
   - cultures ↔ signals
4. What should be editable on the signal record itself
5. What should remain derived or relational
6. Whether signal versioning is needed in v1 or can be deferred
7. Whether signal deactivation/archive is sufficient instead of hard deletion
8. How to safely migrate current culture-embedded signal strings to global signal references
9. How this feature should stage into implementation planning

Important Constraints

- Do not jump directly into coding
- Do not produce an implementation plan yet unless explicitly asked
- Do not treat signals as culture-owned definitions
- Do not assume one signal belongs to only one rule
- Do not assume one rule only uses one signal
- Keep the design discussion consistent with the two-stage moderation pipeline direction

Desired Outcome

After this feature is complete, we should have:

- a single global signal registry
- culture definitions referencing global signals
- rules referencing global signals
- a clear foundation for AI measurement consistency
- a clean path toward future signal-to-dimension judgment logic

Deliverable Requested from Codex

Please provide:
1. a feature analysis
2. recommended data relationships
3. recommended UI approach
4. migration considerations
5. risks and tradeoffs
6. a staged path toward implementation planning

Do not write code yet.
Do not write the final implementation plan yet unless explicitly asked.
Treat this as a discussion-ready feature request.
