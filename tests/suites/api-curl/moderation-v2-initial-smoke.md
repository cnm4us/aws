# Moderation V2 Initial Smoke

This is the initial operator smoke for the moderation-v2 pipeline.

## Goal

Verify that the basic moderation-v2 chain works end to end in development:

- policy profiles can be seeded
- measure -> judge -> review completes successfully
- admin inspect can render moderation-v2 artifacts
- evaluation artifacts can be queried by `evaluation_id`
- optional Jaeger trace tags are visible when the observability stack is running

## Preconditions

- dev database is reachable
- schema is current
- at least one `space_publication_reports` row exists
- at least one culture definition exists
- at least one moderator-capable user exists

## Fast Path

Run the minimum functional smoke:

```bash
npm run build
npm run moderation:v2:policy-profiles:seed
npm run moderation:v2:pipeline:smoke
npm run moderation:v2:admin-inspect:smoke
```

Expected:

- build succeeds
- policy-profile seed prints one active default profile
- pipeline smoke prints `[moderation-v2-pipeline-smoke] ok <evaluation_id>`
- admin inspect smoke exits `0`

## Evaluation Debug

Take the `evaluation_id` printed by the pipeline smoke and inspect the stored chain:

```bash
npm run moderation:v2:evaluation:debug -- --evaluation-id <ULID>
```

Expected summary:

- `status` is `reviewed`
- one measurement, one judgment, one review
- final disposition is present
- replay request counts are non-zero

For full JSON:

```bash
npm run moderation:v2:evaluation:debug -- --evaluation-id <ULID> --json
```

To export replayable request snapshots:

```bash
npm run moderation:v2:evaluation:debug -- --evaluation-id <ULID> --out-dir /tmp/modv2-eval-debug
ls -1 /tmp/modv2-eval-debug
```

Expected files:

- `moderation-evaluation-<ULID>.json`
- `measure-stage-1.json`
- `judge-stage-1.json`
- `review-stage-1.json`

## Admin Inspect

The admin inspect smoke already validates the rendered page path. If you want to check manually:

1. Run the pipeline smoke or admin inspect smoke to create a fresh moderation-v2 chain.
2. Open `/admin/reports?report_id=<report_id>&view=inspect`.
3. Confirm the modal shows:
   - `Moderation V2`
   - `Evaluation ID`
   - `Latest Measurement`
   - `Latest Judgment`
   - `Review Timeline`

## Optional Jaeger Check

Only run this when the local observability stack is available.

Start the stack:

```bash
npm run obs:start
```

Run the smoke under the Jaeger env profile:

```bash
set -a
source .env.jaeger
set +a
npm run moderation:v2:admin-inspect:smoke
```

Query traces:

```bash
npm run jaeger:query -- traces --service aws-mediaconvert-service --tag app.operation=moderation.v2.measure --lookback 15m --limit 3 --summary
npm run jaeger:query -- traces --service aws-mediaconvert-service --tag app.operation=moderation.v2.judge --lookback 15m --limit 3 --summary
npm run jaeger:query -- traces --service aws-mediaconvert-service --tag app.operation=moderation.v2.review --lookback 15m --limit 5 --summary
```

Expected:

- at least one trace for each stage
- server spans include:
  - `app.moderation_evaluation_id`
  - `app.moderation_stage`
  - `app.moderation_policy_profile_id`
  - `app.moderation_policy_profile_version`
  - `app.moderation_culture_id`
  - `app.moderation_culture_version`

Stop the stack when done:

```bash
npm run obs:stop
```

## Failure Triage

- `missing_report` or empty report set:
  - create or retain at least one published report in dev
- `missing_culture_definition`:
  - ensure cultures exist and have `definition_json`
- `missing_moderator_user`:
  - ensure at least one user has global or relevant space moderation permissions
- `policy_profile_not_found`:
  - rerun `npm run moderation:v2:policy-profiles:seed`
- no Jaeger traces:
  - confirm `npm run obs:start`
  - confirm the smoke was run with `.env.jaeger`
  - confirm `OTEL_ENABLED=1` and exporter endpoint points at the collector
