Please update the moderation signal model and admin UI to support a cleaner signal classification structure.

## Objective

Keep the existing top-level grouping of signals as:

* Positive Signals
* Disruptive Signals

But treat that grouping as a **UI convenience only**, not the core semantic model.

Add a new required field on signals called:

* `signal_family`

Optionally also add:

* `polarity`

Where:

* `polarity` = `positive` or `disruptive`
* `signal_family` provides the real normalized classification used for organization, filtering, and future architecture work

## Why

We want to preserve the simple admin experience of viewing signals under “Positive” and “Disruptive,” while also introducing a more precise internal structure that can support:

* cleaner rule-to-signal alignment
* future signal-to-dimension mapping
* better filtering and reporting
* reduced ambiguity between very different kinds of disruptive signals

Example problem:
Right now, profanity, threats, doxxing-related signals, and credibility-related signals can all sit under “Disruptive Signals,” but these are fundamentally different families of behavior and should not be treated as one flat bucket internally.

## Requirements

### 1. Data Model Changes

Update the signal model to include:

* `polarity` (required)
* `signal_family` (required)

Expected values:

#### polarity

* `positive`
* `disruptive`

#### signal_family

Use this initial controlled vocabulary:

For positive signals:

* `clarity`
* `engagement`
* `reasoning`
* `tone_positive`

For disruptive signals:

* `discourse_tone`
* `discourse_quality`
* `targeting`
* `aggression`
* `safety_harm`
* `privacy_identity`
* `sexual_exploitation`
* `credibility`

If needed, implement these as enums or controlled DB values rather than free text.

### 2. Admin UI Behavior

Within `/admin/moderation/signals`:

* continue showing signals grouped visually under:

  * Positive Signals
  * Disruptive Signals

But within each grouping, show or allow filtering by `signal_family`.

Preferred behavior:

* top-level section by polarity
* secondary label, badge, column, or filter for signal family

### 3. Signal Editing / Creation Form

Update the signal create/edit UI so that:

* polarity is required
* signal_family is required
* signal_family choices are constrained based on polarity

Example:
If polarity = `positive`, only show:

* clarity
* engagement
* reasoning
* tone_positive

If polarity = `disruptive`, only show:

* discourse_tone
* discourse_quality
* targeting
* aggression
* safety_harm
* privacy_identity
* sexual_exploitation
* credibility

### 4. Migration / Backfill

Please backfill the existing signals with proposed polarity + signal_family assignments.

Use the following suggested mapping unless implementation details require slight adjustment:

#### Positive signals

* `clear_explanation` → positive / clarity
* `clear_fact_opinion_separation` → positive / clarity
* `evidence_reference` → positive / reasoning
* `source_attribution` → positive / reasoning
* `reasoned_argument` → positive / reasoning
* `curious_questions` or `curious_question` → positive / engagement
* `respectful_disagreement` → positive / engagement
* `measured_delivery` → positive / tone_positive
* `friendly_sharing` → positive / tone_positive
* `welcoming_language` → positive / tone_positive
* `supportive_acknowledgment` → positive / tone_positive
* `encouraging_responses` or `encouraging_response` → positive / tone_positive
* `lighthearted_engagement` → positive / engagement
* `playful_exaggeration` → positive / engagement
* `clearly_signaled_satire` → positive / engagement
* `helpful_suggestions` or `helpful_suggestion` → positive / reasoning

#### Disruptive signals

* `dismissive_language` → disruptive / discourse_tone
* `contemptuous_tone` → disruptive / discourse_tone
* `degrading_sarcasm` → disruptive / discourse_tone
* `mocking_targeted_participant` → disruptive / targeting
* `insult_like_framing` → disruptive / targeting
* `shaming_language` → disruptive / targeting
* `needless_escalation` → disruptive / aggression
* `provocative_derailment` → disruptive / discourse_quality
* `repeated_confrontation` → disruptive / aggression
* `bad_faith_argumentation` → disruptive / discourse_quality
* `unsupported_factual_assertion` → disruptive / credibility
* `absence_of_attribution` → disruptive / credibility
* `aggressive_commands` or `aggressive_command` → disruptive / aggression
* `audience_incitement_style_framing` → disruptive / aggression
* `person_directed_hostility` → disruptive / targeting

### 5. Naming Normalization

Where practical, normalize signal IDs to singular form for consistency.

Examples:

* `curious_questions` → `curious_question`
* `encouraging_responses` → `encouraging_response`
* `helpful_suggestions` → `helpful_suggestion`
* `aggressive_commands` → `aggressive_command`

Do not break existing references silently. If renaming IDs would be risky, preserve existing IDs for now and note follow-up work needed.

### 6. Non-Goals

Do not yet implement:

* signal-to-dimension mapping
* rule auto-classification from family
* changes to moderation judgment logic
* changes to user-facing moderation UI

This task is only for:

* signal model cleanup
* signal classification structure
* admin UI support

## Deliverables

Please provide:

1. A high-level implementation plan
2. Any schema/model changes required
3. Any migration/backfill plan
4. Admin UI changes needed
5. Risks or edge cases
6. Recommended order of implementation

## Important architectural guidance

The intended model is:

* `polarity` = simple UI grouping
* `signal_family` = internal normalized classification

Do not treat “Positive” and “Disruptive” as sufficient semantic categories by themselves.

We want the best of both:

* simple UI grouping
* stronger internal structure
