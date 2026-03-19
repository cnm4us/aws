# Plan 110: Trace Naming + Signal Quality Hardening

## Goal
Improve Jaeger usability by making traces and spans consistently meaningful, low-noise, and searchable.

This plan focuses on:
- Better span names (human-readable, stable).
- Better attributes (context-rich, low-cardinality).
- Reduced noisy spans that obscure important workflows.

## Why Now
Current traces include useful entries (for example route-template spans), but also generic ones (`GET`, `PATCH`) that require deeper clicks to understand. This is expected after initial instrumentation and is the right time for a hardening pass.

## Working Method (Q&A + Iterative Plan Refinement)
We will run this as a collaborative trace review:
1. Collect real Jaeger examples from your current traffic.
2. Classify each span type as:
   - keep as-is
   - rename
   - add attributes
   - suppress/de-emphasize
3. Update this plan with endpoint/job-specific decisions before implementation.

---

## Decisions Confirmed So Far
- We will do **both** for static-resource traces:
  - rename clearly when visible
  - suppress by default for daily debugging views
- Static resource traces are now a single known class:
  - `http.target` like `/favicon.ico`, `/app/assets/*`, css/js/fonts/images
  - additional samples in this class are optional unless they are slow or failing
- We will use a **noise taxonomy** with category toggles (not one global binary switch only):
  - `critical` (never suppress)
  - `useful` (keep by default)
  - `low_value` (suppress by default; enable on demand)
  - `noisy_internal` (express middleware/router internals; suppress by default)

## Initial Classified Example
- Current root span: `GET` (generic)
- Attributes: `http.target=/favicon.ico`, `http.status_code=304`, no `http.route`
- Classification:
  - category: `low_value` (static resource)
  - action: rename + suppress-by-default
  - target name when visible: `HTTP GET /favicon.ico`

---

## Naming Standard (Target)

## Span names
- HTTP server spans: `HTTP <METHOD> <route-template>`
  - Example: `HTTP PATCH /api/create-video/projects/:id/timeline`
- Media job root span: `mediajob.process`
- Media job stage spans:
  - `mediajob.fetch_inputs`
  - `mediajob.execute`
  - `mediajob.upload_outputs`
  - `mediajob.persist_results`
- Background/system spans should be explicit:
  - Example: `worker.poll.media_jobs` (if we keep them visible)

## Naming rules
- No raw IDs in span names.
- No user-generated text in span names.
- Put variable values into attributes, not names.
- Keep names stable across deployments.

## Attribute Standard (Target)

## Core correlation
- `request_id`
- `trace_id` / `span_id` (already present in logs)
- `service.name`
- `deployment.environment`

## HTTP attributes
- `http.method`
- `http.route` (template)
- `http.status_code`
- `app.operation` (business action label, where useful)

## Media job attributes
- `mediajob.id`
- `mediajob.type`
- `mediajob.attempt_no`
- `mediajob.status`
- `project_id` / `upload_id` (when available)
- `mediajob.queue_wait_ms`
- `mediajob.duration_ms`
- `mediajob.input_bytes`
- `mediajob.output_bytes`
- `mediajob.error_code` / `mediajob.error_class`

---

## Phase A — Trace Inventory + Classification
1. Capture representative traces from Jaeger for:
   - create-video timeline edits
   - export flow
   - upload processing
   - media jobs worker/polling
   - one representative static-resource trace class (already captured)
2. Build a classification table:
   - current span name
   - source (auto/manual)
   - category (`critical`/`useful`/`low_value`/`noisy_internal`)
   - action (keep/rename/attribute/suppress)
   - reason
3. Mark top noisy operations that reduce signal.
4. Group static traces by class (no need to enumerate each file path unless anomalous).

Deliverable:
- Updated matrix in this plan (or companion table file) based on your real traces.

## Phase B — HTTP Span Naming Hardening
1. Ensure route-template naming consistently wins over generic method-only naming.
2. Add/normalize `app.operation` for high-value endpoints.
3. Ensure request logger fields align with trace fields for easy cross-navigation.

Deliverable:
- Consistent HTTP span names for top API routes.

## Phase C — Media Jobs Semantics Hardening
1. Confirm/normalize manual media job span attributes.
2. Add missing job context attributes where low-cardinality and useful.
3. Ensure failed/dead outcomes have consistent status + error classification.

Deliverable:
- Media job traces are self-explanatory from span list + attributes alone.

## Phase D — Noise Reduction Controls
1. Suppress or reduce low-value auto-instrumentation noise via env toggles and config:
   - mysql2 auto-spans (already toggleable)
   - route-level filters for health/static/polling noise
   - express internal middleware/router span suppression by default
2. Add per-category toggles (proposed env set):
   - `OTEL_TRACE_STATIC=0|1`
   - `OTEL_TRACE_HEALTH=0|1`
   - `OTEL_TRACE_EXPRESS_INTERNAL=0|1`
   - keep existing `OTEL_INSTRUMENT_MYSQL2=0|1`
2. Preserve critical traces while reducing clutter.

Deliverable:
- “High signal” default view in Jaeger for day-to-day debugging.

## Phase E — Validation + Runbook
1. Validate in Jaeger with real flows:
   - one timeline edit
   - one export
   - one media job failure scenario
2. Confirm naming/attribute consistency across traces.
3. Document query recipes:
   - by operation
   - by `mediajob.id`
   - by status/error class

Deliverable:
- Updated `docs/OBSERVABILITY.md` with trace query playbook.

---

## QA Checklist
- Generic `GET`/`PATCH` spans are minimized for key app flows.
- Top traces can be understood from list view without deep drilling.
- IDs and dynamic values are attributes, not span names.
- Media job traces clearly show stage timing and failure reason.
- Logs and traces share correlation fields for fast triage.

## Open Decisions For Our Q&A Session
- Which endpoints should get explicit `app.operation` labels first?
- Which background spans should be suppressed vs retained?
- Preferred default Jaeger filters for daily use?
- Any spans we should treat as security-sensitive and redact further?
