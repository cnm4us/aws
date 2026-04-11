# Moderation Signal Classification Smoke

Use this checklist after moderation signal classification changes.

## Purpose

Verify that:

- all signals have persisted `polarity`
- all signals have persisted `signal_family`
- `/admin/moderation/signals` filters and forms reflect the stored classification model
- rule and culture signal grouping still reads correctly from the registry

## Fast Path

Run:

```bash
npm run build
npm run moderation:signals:classification:backfill
npm run moderation:signals:classification:verify
```

Expected:

- `build` exits cleanly
- backfill prints `"ok": true`
- verify prints `"ok": true`
- verify output shows:
  - `"missing_polarity": 0`
  - `"missing_signal_family": 0`
  - `"missing_any": 0`
  - `"unresolved": []`

## Registry UI Check

Open:

- `/admin/moderation/signals`

Verify:

- list is still grouped as `Positive Signals` and `Disruptive Signals`
- each signal row shows both `polarity` and `signal_family`
- `Polarity` filter works
- `Signal Family` filter works
- family options narrow correctly when polarity is selected

## Create / Edit Check

Open:

- `/admin/moderation/signals/new`
- `/admin/moderation/signals/:id`

Verify:

- `polarity` is required
- `signal_family` is required
- `signal_family` choices change with the selected polarity
- invalid polarity/family combinations are rejected
- saved detail pages show the expected classification badges

## Rule / Culture Compatibility Check

Open:

- `/admin/moderation/cultures/:id`
- `/admin/moderation/rules/:id/edit`
- `/admin/moderation/rules/:id`

Verify:

- culture `Positive Signals` uses positive-polarity registry signals
- culture `Disruptive Signals` uses disruptive-polarity registry signals
- rule linked-signal grouping still separates positive vs disruptive correctly
- no metadata-based mixed bleed-through appears in either page

## Temporary Assignments To Remember

These signals are intentionally temporary fits in the classification model:

- `qualified_language` -> `positive / clarity`
- `assertive_language` -> `disruptive / credibility`
- `direct_identifiers` -> `disruptive / privacy_identity`
- `indirect_identifiers` -> `disruptive / privacy_identity`
- `factual_assertion` -> `positive / reasoning`

If these look surprising in the UI, that is expected for now.

## Deferred Cleanup

Do not silently rename signal IDs during this smoke pass.

Singularization examples such as:

- `curious_questions`
- `encouraging_responses`
- `helpful_suggestions`
- `aggressive_commands`

remain deferred until reference-safe cleanup work is scheduled explicitly.
