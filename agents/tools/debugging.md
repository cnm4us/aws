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

### General browser debug

```js
localStorage.setItem('browser:debug', '1')
location.reload()
```

### Prompt debug

```js
localStorage.setItem('prompt:debug', '1')
location.reload()
```

### Disable

```js
localStorage.removeItem('browser:debug')
localStorage.removeItem('prompt:debug')
location.reload()
```

## Current Event Categories

### `prompt`

In-feed message decision flow (legacy `prompt` event category):

- `decision:request`
- `decision:response`
- `decision:no_insert`
- `decision:insert:applied`
- `decision:skip:*`

### `sequence`

Feed sequence engine flow:

- `sequence_active_key_changed`
- `sequence_window_shift`
- `sequence_prompt_inserted`

### `index`

Client re-anchor / active index flow:

- `reanchor:start`
- `reanchor:end`
- `index:active_changed`
- `prompt_anchor:*`

## Current DOM Debug Events

`Feed.tsx` currently emits:

- `feed:prompt-debug`
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

2. Enable browser debug in DevTools:

```js
localStorage.setItem('browser:debug', '1')
localStorage.setItem('prompt:debug', '1')
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
{"ts":"2026-03-16T23:29:58.783Z","category":"prompt","event":"decision:insert:applied", ...}
```

## Guardrails

- Do not commit `debug/`
- Do not commit temporary browser log captures unless intentionally preserved as test artifacts
- Keep debug payloads redaction-safe
- Use structured events instead of raw browser console mirroring when possible

## Current Limitations

- browser debug transport is server-mediated, not direct local file access
- categories currently used most heavily by the feed/prompt system
- this is a debug tool, not a product analytics pipeline

## Good Use Cases

- prompt decision debugging
- feed sequencing bugs
- index / re-anchor bugs
- future HLS or editor workflows with structured event streams
