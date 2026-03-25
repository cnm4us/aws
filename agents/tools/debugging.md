# Debugging Tools

## Purpose

This project has two coordinated debug output channels:

- `debug/terminal/`
  - server runtime output
  - Pino / Jaeger / route logs
- `debug/console/`
  - structured browser-emitted debug events
  - written server-side from `/api/debug/browser-log`

These tools are intended to make reproducible debugging easier without relying on transient browser DevTools output alone.

`debug/` is intentionally disposable. Frequent manual deletion of files in `debug/terminal/` and `debug/console/` is expected.

## Jaeger Query Tool

### Command

```bash
npm run jaeger:query -- <subcommand> [flags]
```

### Supported subcommands

- `services`
- `operations --service <service>`
- `traces [--service ...] [--operation ...] [--tag k=v ...]`
- `trace --trace-id <id>`
- `preset <name>`

### Useful presets

- `message_decide`
- `message_fetch`
- `message_event`
- `admin_messages`
- `admin_message_save`
- `admin_message_analytics`
- `payment_checkout_page`
- `payment_checkout_start`
- `payment_subscribe_create`
- `payment_webhook`
- `payment_webhook_ingest`
- `payment_subscription_lifecycle`
- `payment_subscription_action`
- `feed_message_pipeline` (runs decide/fetch/event in sequence)
- `payment_pipeline` (runs payment lifecycle presets in sequence)
- `support_pipeline` (runs support + payment lifecycle presets in sequence)

Note:
- Message presets are tag-based (`app.operation=...`).
- Admin presets are operation-based (`HTTP GET /admin/...`) to match current server-rendered admin routes.

### Examples

```bash
npm run jaeger:query -- services --summary
npm run jaeger:query -- operations --service aws-mediaconvert-service --summary
npm run jaeger:query -- preset feed_message_pipeline --service aws-mediaconvert-service --lookback 15m --summary
npm run jaeger:query -- traces --service aws-mediaconvert-service --operation "POST /api/feed/message-decision" --tag app.operation=feed.message.decide --lookback 15m --summary
```

### Raw JSON artifacts

Use `--out` to write response payloads for later review:

```bash
npm run jaeger:query -- preset feed_message_pipeline --service aws-mediaconvert-service --lookback 15m --summary --out tests/runs/api-curl/<run_id>/artifacts/jaeger-message-pipeline.json
```

### Jaeger Command Cookbook

Use this section as the known-good baseline before trying ad-hoc variants.
If a new command pattern is discovered during debugging, add it here once validated.

#### 1) Verify Jaeger has your service

```bash
npm run jaeger:query -- services --summary
```

Expected:
- service list includes `aws-mediaconvert-service`

#### 2) List operations for the service

```bash
npm run jaeger:query -- operations --service aws-mediaconvert-service --summary
```

Expected:
- operation names like `HTTP POST /api/feed/message-events`

#### 3) Check message pipeline quickly

```bash
npm run jaeger:query -- preset feed_message_pipeline --service aws-mediaconvert-service --lookback 15m --summary
```

Expected:
- non-zero trace counts after reproducing feed message behavior

#### 4) Query by semantic tag (more stable than operation label)

```bash
npm run jaeger:query -- traces --service aws-mediaconvert-service --tag app.operation=feed.message.event --lookback 1d --limit 50 --summary
```

Use when:
- operation naming may vary, or operation search in UI is noisy

#### 5) Dump raw traces to artifact file

```bash
npm run jaeger:query -- traces --service aws-mediaconvert-service --tag app.operation=feed.message.event --lookback 1d --limit 50 --out tests/runs/api-curl/<run_id>/artifacts/jaeger-message-event.json
```

Expected:
- JSON file written under `tests/runs/.../artifacts/`

#### 6) List unique tags for one endpoint from saved JSON

```bash
jq -r '.data[].spans[] | select(.operationName=="HTTP POST /api/feed/message-events") | .tags[]?.key' tests/runs/api-curl/<run_id>/artifacts/jaeger-message-event.json | sort -u
```

Use when:
- you need a field inventory before changing instrumentation

#### 7) Inspect one tag's observed values

```bash
jq -r '.data[].spans[] | select(.operationName=="HTTP POST /api/feed/message-events") | .tags[]? | select(.key=="app.operation_detail") | .value' tests/runs/api-curl/<run_id>/artifacts/jaeger-message-event.json | sort -u
```

Use when:
- you need to verify outcome/detail cardinality

#### Pitfalls

- Presets are tag-based (`app.operation=...`) and may include related child/internal spans; use explicit `--operation` filters when you need only one HTTP operation.
- Avoid huge terminal output: prefer `--summary` for interactive checks, and `--out` + `jq` for deeper inspection.

## Debug Bundle Tool

### Command

```bash
npm run debug:bundle
```

### Purpose

Creates one run folder under `tests/runs/api-curl/` that captures:

- latest `debug/terminal/*` log copy
- latest `debug/console/*` log copy
- Jaeger preset outputs (JSON)
- quick derived counts + `summary.md`
- operation-only HTTP counts (endpoint-focused)
- per-message-id decide/fetch/event counts
- expectation checks (`PASS/WARN`) for common pipeline relationships
- correlated timeline outputs (`timeline.ndjson`, `timeline-top.txt`)
- Jaeger trace links in timeline rows (`trace_url`) for fast drill-down
- source freshness warnings when terminal/console files are older than bundle window
- strict bundle time window filtering (start/end) applied to timeline and Jaeger-derived counts

### Common options

```bash
npm run debug:bundle -- --lookback 15m
npm run debug:bundle -- --run-id 2026-03-20_message-stuck
npm run debug:bundle -- --base-name message-bundle
```

Naming behavior:
- default: `<base-name>-<UTC timestamp>` (base-name defaults to `debug-bundle`)
- override full folder name with `--run-id <id>`

### Output

Example:

```text
tests/runs/api-curl/debug-bundle-20260320T012000Z/
  summary.md
  artifacts/
```

## Terminal Logging

### Command

```bash
npm run serve:jaeger:log
```

### Behavior

- starts the same server flow as `npm run serve:jaeger`
- mirrors output to:
  - terminal
  - timestamped file under `debug/terminal/`

### Default output path

Example:

```text
debug/terminal/serve-jaeger-20260316T232914Z.txt
```

### Optional custom path

```bash
npm run serve:jaeger:log -- debug/terminal/my-run.txt
```

### Notes

- saved file has ANSI color sequences stripped
- terminal still keeps live colored output
- file updates incrementally while the server is running

## Browser Debug Logging

### Transport

Browser debug events are sent to:

```text
POST /api/debug/browser-log
```

The server writes them to:

```text
debug/console/browser-debug-YYYYMMDDTHHMMSSZ.ndjson
```

Files are created lazily on first event.

### Current frontend module

Shared client debug transport lives at:

```text
frontend/src/debug/clientDebug.ts
```

This module owns:

- enable/disable checks
- browser session id
- batching and flush
- CSRF-aware POST transport
- DOM-event bridge helpers

## Enable Flags

Recommended for site admins: use `/admin/debug` to set/clear flags, then click `Apply + Reload`.
Manual DevTools commands remain available below.

Unified keys are now the primary contract:
- `CLIENT_DEBUG`
- `CLIENT_DEBUG_EMIT`
- `CLIENT_DEBUG_NS`
- `CLIENT_DEBUG_EVENTS`
- `CLIENT_DEBUG_EXCLUDE`
- `CLIENT_DEBUG_LEVEL`
- `CLIENT_DEBUG_SAMPLE`
- `CLIENT_DEBUG_ID`
- `CLIENT_DEBUG_SESSION`

Legacy keys remain compatibility-only during migration.

### General browser debug

```js
localStorage.setItem('browser:debug', '1')
location.reload()
```

### Message debug

```js
localStorage.setItem('message:debug', '1')
location.reload()
```

Optional message debug filters:

```js
localStorage.setItem('message:debug:events', 'decision:*,message_anchor:*') // allowlist
localStorage.setItem('message:debug:sample', '0.5') // 50% sample
localStorage.setItem('message:debug:level', 'debug') // debug|info|warn|error
location.reload()
```

### Disable

```js
localStorage.removeItem('browser:debug')
localStorage.removeItem('message:debug')
location.reload()
```

## Current Event Categories

### `message`

In-feed message decision flow:

- `decision:request`
- `decision:response`
- `decision:no_insert`
- `decision:insert:applied`
- `decision:skip:*`

### `sequence`

Feed sequence engine flow:

- `sequence_active_key_changed`
- `sequence_window_shift`
- `sequence_message_inserted`

### `index`

Client re-anchor / active index flow:

- `reanchor:start`
- `reanchor:end`
- `index:active_changed`
- `message_anchor:*`

## Current DOM Debug Events

`Feed.tsx` currently emits:

- `feed:message-debug`
- `feed:sequence-hook`
- `feed:index-debug`

These are bridged into structured browser logs by `installClientDebugDomBridges(...)`.

## How To Add A New Debug Category

### 1. Emit a DOM debug event

Use the shared helper:

```ts
dispatchClientDebugDomEvent('feature:x-debug', 'some:event', { foo: 1 }, {
  enabled: isClientDebugEnabled({ storageKey: 'browser:debug' }),
  consoleLabel: '[feature-x-debug]',
})
```

### 2. Bridge the DOM event into structured logging

Add a bridge:

```ts
installClientDebugDomBridges(
  [
    { domEventName: 'feature:x-debug', category: 'feature_x' },
  ],
  () => currentContext,
  { enabled: true }
)
```

### 3. Keep payloads structured

Prefer:

- stable event names
- small payloads
- ids/keys/reasons/counters

Avoid:

- dumping full objects
- raw HTML
- credentials/tokens/cookies

## Workflow

### Typical debugging run

1. Start terminal logging:

```bash
npm run serve:jaeger:log
```

2. Enable browser debug:

- Preferred (admin): open `/admin/debug` and enable `browser:debug` + `message:debug`.
- DevTools fallback:

```js
localStorage.setItem('browser:debug', '1')
localStorage.setItem('message:debug', '1')
location.reload()
```

3. Reproduce the issue once.

4. Inspect newest files:

```bash
ls -1t debug/terminal | head
ls -1t debug/console | head
```

5. Share:

- newest `debug/terminal/...`
- newest `debug/console/...`

## File Formats

### Terminal log

- human-readable text
- mixed server output

### Browser console log

- NDJSON
- one JSON object per line
- suitable for `rg`, `jq`, Python parsing, etc.

Example:

```json
{"ts":"2026-03-16T23:29:58.783Z","category":"message","event":"decision:insert:applied", ...}
```

## Guardrails

- Do not commit `debug/`
- Do not commit temporary browser log captures unless intentionally preserved as test artifacts
- Keep debug payloads redaction-safe
- Use structured events instead of raw browser console mirroring when possible

## Current Limitations

- browser debug transport is server-mediated, not direct local file access
- categories currently used most heavily by the feed/message system
- this is a debug tool, not a product analytics pipeline

## Good Use Cases

- message decision debugging
- feed sequencing bugs
- index / re-anchor bugs
- future HLS or editor workflows with structured event streams
