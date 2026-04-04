## Feature: User-Facing Reporting Rules Layer

### Objective

Add a new **User-Facing Rules** layer to the moderation/reporting system so the flagging UI can present simple, human-readable reporting options without changing the underlying moderation architecture.

The current moderation model is structurally correct and should remain intact:

* Rules map to Categories
* Categories map to Cultures
* Cultures map to Groups / Channels

This core structure supports moderation logic, AI judgment, audits, appeals, and administrative configuration.

The new feature introduces a separate UX abstraction layer:

* User-Facing Rules map to Rules
* Mapping is many-to-many
* A single User-Facing Rule may map to multiple Rules
* A single Rule may map to multiple User-Facing Rules

This layer exists only to simplify reporting UX. It does not replace or modify the underlying Rule / Category / Culture model.

---

### Problem This Solves

The current moderation taxonomy is well-suited for administration and system logic, but it is too technical and too detailed to serve as the first layer of the user-facing flagging experience.

Users should be able to report content using a smaller set of plain-language reasons, while still preserving:

* transparency
* rule-level specificity
* auditability
* future flexibility

The system must support both:

* **simple reporting** for users who want speed
* **deep transparency** for users who want to drill into full rule details

---

### Proposed Model

#### Existing structure

* Rule
* Category
* Culture
* Group / Channel

#### New structure

* UserFacingRule
* UserFacingRuleRuleMap

Where:

* `UserFacingRule` is a user-visible reporting option
* `UserFacingRuleRuleMap` links User-Facing Rules to underlying Rules

This mapping is many-to-many.

---

### Visibility Logic

In the user-facing flagging modal, show only the User-Facing Rules that are valid for the current reporting context.

A User-Facing Rule should be shown if it maps to **at least one Rule** that is reachable through the current Group / Channel’s assigned Cultures.

This is the selected logic model:

#### Option A — Loose visibility

Show a User-Facing Rule if it maps to at least one Rule that is available through:

Group / Channel → Culture → Category → Rule

This is preferred over strict visibility because it prevents unnecessary UI gaps and keeps the system flexible.

---

### Important Architectural Constraint

User-Facing Rules should **not** belong directly to Categories or Cultures.

They should remain a separate abstraction layer and be filtered dynamically through the existing Culture → Category → Rule availability chain.

This preserves clean separation between:

* moderation logic
* administrative taxonomy
* reporting UX

---

### Admin UI Requirements

Add administrative support for managing User-Facing Rules.

Admins should be able to:

#### Create / edit User-Facing Rules

Suggested fields:

* Label
* Short helper text or short description
* Display order
* Active / inactive
* Optional UI grouping hint (future-friendly)
* Mapped Rules

#### Manage mappings

* Assign one or more Rules to a User-Facing Rule
* Allow the same Rule to be assigned to multiple User-Facing Rules
* Allow the same User-Facing Rule to map to multiple Rules

---

### Reporting UI Requirements

Update the flagging modal so that it presents User-Facing Rules instead of exposing raw moderation taxonomy as the first layer.

Behavior:

* User opens flagging modal for a piece of content
* System determines the current Group / Channel context
* System resolves assigned Cultures
* Cultures determine visible Categories
* Categories determine visible Rules
* User-Facing Rules are filtered to those with at least one mapped visible Rule
* Those User-Facing Rules are shown in the flagging UI

The user-facing flow should support progressive disclosure:

* initial user-facing reason
* optional drill-down to specific mapped Rules
* optional expansion into short / long / allowed / disallowed rule details
* submit available without forcing maximum drill-down

The underlying submitted object should still record the selected Rule, not merely the User-Facing Rule.

If the user does not drill down to a more specific Rule, the implementation plan should consider whether:

* a default Rule may be selected for that User-Facing Rule
* or the UI should require sub-selection before submission

This should be evaluated in the implementation plan rather than assumed prematurely.

---

### Data Model Expectations

Codex should evaluate the best implementation shape, but the conceptual model should include:

#### UserFacingRule

Possible fields:

* id
* label
* short_description
* display_order
* is_active
* created_at
* updated_at

#### UserFacingRuleRuleMap

Possible fields:

* id
* user_facing_rule_id
* rule_id
* display_order or priority (optional, if useful)

Codex should determine whether additional metadata is useful for future extensibility.

---

### Non-Goals

This feature should not:

* alter the Rule / Category / Culture hierarchy
* move moderation logic into the User-Facing Rule layer
* make User-Facing Rules authoritative for enforcement
* remove rule-level transparency
* hard-code user-facing reasons into the UI

The Rule remains the authoritative moderation object for:

* classification
* audits
* enforcement
* appeals
* analytics

---

### Design Intent

This feature is intended to create a cleaner reporting front door while preserving the strength of the underlying moderation framework.

In short:

* Rules are the canonical moderation objects
* User-Facing Rules are the UX entry layer
* visibility is derived dynamically from current cultural context
* the system remains transparent, flexible, and scalable

---

## Request for Codex: Create Implementation Plan

Please create a detailed implementation plan for this feature.

### Planning requirements

* Do not begin coding yet
* Produce a staged implementation plan only
* Each step must leave the system runnable
* Prefer small, testable increments
* Identify backend, admin UI, and reporting UI changes separately
* Note any migrations or schema changes required
* Note any API changes required
* Note any queries / filtering logic required for resolving visible User-Facing Rules in context
* Identify any unresolved product decisions that should be surfaced before implementation
* Include a testing / verification strategy for each stage
* Include rollback safety where relevant

### Areas the plan should address

1. Data model / schema changes
2. Admin UI for managing User-Facing Rules and Rule mappings
3. Backend services / API changes
4. Resolution logic for visible User-Facing Rules by Group / Channel context
5. Reporting modal UI changes
6. Submission behavior and how selected User-Facing Rules resolve to canonical Rules
7. Backward compatibility and migration strategy
8. Test coverage and manual verification plan

### Specific architectural guidance

* Keep User-Facing Rules as a separate abstraction layer
* Do not embed User-Facing Rules into Culture or Category as first-class ownership
* Use loose visibility logic: show a User-Facing Rule if at least one mapped Rule is available in the current context
* Preserve Rule as the canonical moderation object

Please return the implementation plan in a stepwise format suitable for project review before coding.
