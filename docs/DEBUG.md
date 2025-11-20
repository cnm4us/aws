Debugging Guide

Purpose
- Turn on structured, filterable logs at runtime without code edits.
- Keep zero overhead when disabled.
- Provide consistent, styled output with file:line callsites.

How It Works
- A small debug module reads flags from `localStorage` and query params.
- When `DEBUG != '1'`, all debug calls are no-ops (no stack parsing, no object work).
- When enabled, logs are namespaced (e.g., `feed`, `slides`, `video`) and can be filtered by IDs.

Quick Start
- Enable master switch: in DevTools console run `localStorage.DEBUG = '1'` and reload.
- Turn on a category: `localStorage.DEBUG_SLIDES = '1'` (or `DEBUG_FEED`, `DEBUG_VIDEO`, etc.).
- Optional: filter to one item: `localStorage.DEBUG_SLIDE_ID = 'v-01K9*'`.
- Verify: in console run `dlog.currentFlags()` (dev only, after enabling).

Address Bar Bootstrap
- Append query params to set flags for the current origin on first load:
  - `?debug=1&debug_slides=1&debug_slide_id=v-01K9*`
- Supported params mirror localStorage keys (see Reference below).
- You can remove flags later from DevTools: `localStorage.removeItem('DEBUG_SLIDES')`.

Dev vs Prod
- In dev (`import.meta.env.DEV`), flags are honored when `DEBUG='1'`.
- In prod, debug is disabled by default. You can enable it either at build time or at runtime:
  - Build-time allow: set `VITE_ALLOW_DEBUG_IN_PROD=1` and rebuild/deploy.
  - Runtime override (no rebuild): set `localStorage.DEBUG_ALLOW_PROD='1'` or visit with `?debug=1&debug_allow_prod=1` once.
    - After that, set your categories (e.g., `DEBUG_FEED='1'`) and reload.
    - Note: `window.dlog` remains dev-only by default; ask if you want it available under the override.

Categories
- `DEBUG_FEED` – feed interactions, taps/clicks, paging, like/comment flows.
- `DEBUG_SLIDES` – per-slide render decisions (e.g., active/warm) and active index changes.
- `DEBUG_AUTH` – auth bootstrap (e.g., `/api/me`).
- `DEBUG_VIDEO` – HLS attach/cleanup and media events.
- `DEBUG_NETWORK` – network tracing for `fetch` calls (method, URL, status, duration, size).
- `DEBUG_RENDER` – per-component render tracing (mount/update/unmount and shallow key diffs).
- `DEBUG_PERF` – perf timing (initial feed load, like toggles, comment submissions).
- `DEBUG_PERM` – permissions/RBAC state (roles, space access summaries).
- `DEBUG_ERRORS` – reserved for future error reporting.

ID Filters
- Limit logs to specific items by ID (exact, comma list, or prefix with `*`).
- Supported filters:
  - `DEBUG_FEED_ID`
  - `DEBUG_SLIDE_ID`
  - `DEBUG_VIDEO_ID`
- Examples:
  - `localStorage.DEBUG_VIDEO_ID = 'v-01K9NZTQ6BDX5KPNYM9Y3P9QKY'`
  - `localStorage.DEBUG_SLIDE_ID = 'v-01K9*'`
  - `localStorage.DEBUG_FEED_ID = 'v-01K9...,v-02ABC...'`

What Logs Look Like
- Styled prefix: `[SLIDES]`, `[FEED]`, `[VIDEO]` with distinct colors.
- Context suffix: when a context is provided, the label becomes `[NAMESPACE:context]`, e.g. `[SLIDES:render]` vs `[SLIDES:index]`.
- Includes time delta and callsite: `[Feed.tsx:1068]` when source maps are available.
- Uses `console.groupCollapsed` for multi-line sequences (internally handled by the module when used).

Global Helper
- In dev, when `DEBUG='1'`, `window.dlog` is attached for quick access.
- Useful calls:
  - `dlog.currentFlags()` – inspect active flags.
  - `dlog.enabled('video')` – check if a namespace is enabled.
  - `dlog.log('feed', 'example event', { any: 'meta' })` – ad-hoc log.

Common Tasks
- Enable slides only: `localStorage.DEBUG='1'; localStorage.DEBUG_SLIDES='1'; location.reload()`
- Focus on one video: set `DEBUG_VIDEO='1'` and `DEBUG_VIDEO_ID` to the ULID or prefix.
- Temporarily enable via URL: `/?debug=1&debug_feed=1&debug_feed_id=v-01K9*`
- Turn everything off: remove all `localStorage` keys starting with `DEBUG` or run a small loop:
  - `Object.keys(localStorage).filter(k=>k.startsWith('DEBUG')).forEach(k=>localStorage.removeItem(k))`

Zero Overhead When Off
- If `DEBUG` is not `'1'`:
  - No logs are emitted.
  - No stack/callsite parsing occurs.
  - No event listeners or timers are added by the debug module.

Current Coverage
- Feed (`feed`): click/touch toggles, like/comment flows, selected auth lifecycle logs.
- Slides (`slides`): per-slide render decisions (active/warm/prewarm state) and active index changes.
- Video (`video`): mount/cleanup, media/hls.js events, attach strategy.
- Permissions (`perm`): `/api/me` roles snapshot and `/api/me/spaces` access summaries.
- Network (`network`): `fetch` calls with method, URL, status, `ok`, duration, and optional content-length.
 - Render (`render`): opt-in per-component tracing via `useRenderDebug`.

Network-Specific Debug Details (`DEBUG_NETWORK`)
- Enabling `DEBUG_NETWORK` and `DEBUG` installs a `fetch` wrapper (once per page load).
- Logs appear as `[NETWORK:fetch]` / `[NETWORK:fetch error]` and include:
  - `method`: HTTP method (e.g., `GET`, `POST`).
  - `url`: request URL.
  - `status`: HTTP status code (for successful fetches).
  - `ok`: `true`/`false` from the Response object.
  - `durationMs`: rounded elapsed time in milliseconds.
  - `size`: parsed `Content-Length` header when available (number or raw string).
- How to use:
  - Turn on: `localStorage.DEBUG='1'; localStorage.DEBUG_NETWORK='1'; location.reload()`.
  - Or via URL: `/?debug=1&debug_network=1` (initial load).
  - Watch for `[NETWORK:fetch]` lines when APIs like `/api/me`, `/api/feed/global`, `/api/publications/:id/likes`, etc. are called.
- Notes:
  - Only `window.fetch` is wrapped; XHRs (e.g., from `hls.js`) still only show in the browser's Network panel.
  - If `DEBUG_NETWORK` is turned off at runtime, the wrapper still delegates to the original `fetch` but skips logging.

Render-Specific Debug Details (`DEBUG_RENDER`)
- Enabling `DEBUG_RENDER` and `DEBUG` turns on a helper hook `useRenderDebug` for components that opt in.
- Hook location: `frontend/src/debug/useRenderDebug.ts`.
- Usage example (inside a React component):
  - `useRenderDebug('Feed', { index, itemsLen: items.length, mode: feedMode.kind })`
- Logs appear as `[RENDER:component]` with events like:
  - `Feed mount` – first committed render of that component instance.
  - `Feed update` – subsequent renders.
  - `Feed unmount` – when the component is removed.
- Payload includes:
  - `label`: the label you passed (e.g., `Feed`).
  - `phase`: `'mount' | 'update' | 'unmount'`.
  - `count`: render count for that instance.
  - `keys`: the latest snapshot of keys you provided.
  - `changed`: keys whose values changed between the previous and current render (shallow compare).
- How to use:
  - Turn on: `localStorage.DEBUG='1'; localStorage.DEBUG_RENDER='1'; location.reload()`.
  - Add `useRenderDebug` calls to components where you want to understand why/how often they re-render.

Perf-Specific Debug Details (`DEBUG_PERF`)
- Enabling `DEBUG_PERF` and `DEBUG` causes additional timing logs via `console.time` / `console.timeEnd`.
- Labels are namespaced, for example:
  - `[perf] feed load:global` – time from start of feed load (including network) to completion for the global feed.
  - `[perf] like toggle:94` – time from optimistic like toggle start to server response/rollback for publication `94`.
  - `[perf] comment submit:94` – time from optimistic comment submit start to successful response/rollback for publication `94`.
- How to use:
  - Turn on perf: `localStorage.DEBUG='1'; localStorage.DEBUG_PERF='1'; location.reload()`.
  - Watch for `[perf] ...` entries in the console’s `console.time` output when:
    - The feed initially loads or the feed mode changes.
    - You like/unlike a video.
    - You submit a comment.

Slides-Specific Debug Details
- Render logs (`[SLIDES:render]`):
  - Emitted from the slides `useMemo` while mapping `items.map((it, i) => ...)`.
  - Payload includes:
    - `i`: this slide's position in the `items` array.
    - `slideId`: stable identifier (e.g., `v-<ULID>`).
    - `active`: whether `i === index` (on-stage slide).
    - `warm`: whether the slide is prewarmed (typically `i === index + 1`).
    - `n`: per-slide render counter (starts at 1 for that `slideId` and increments on each re-render of that slide).
    - `deps`: small snapshot of key dependencies (like state, comment state, playback hints, etc.) so you can see what changed between renders.
- Index logs (`[SLIDES:index]`):
  - Emitted from a `useEffect` whenever the active `index` or `items` reference changes.
  - Payload includes:
    - `index`: active slide index for the feed (0-based).
    - `slideId` / `pubId`: resolved from `items[index]` (or `null` if items are not yet loaded).
  - You may see multiple `index -> 0` logs around initial load:
    - First when `index` is 0 but `items` is still empty (no `slideId` yet).
    - Again after items arrive (same numeric index, now with a real `slideId`/`pubId`).

Troubleshooting
- Seeing logs but didn’t expect them? Check `localStorage.DEBUG` and category flags via `dlog.currentFlags()`.
- Logs appear twice in dev? React StrictMode double-invokes some lifecycles; this is expected during development.
- No `dlog` in console? Ensure you’re in dev, and enable the master switch first, then reload.

Reference: Supported Flags
- Master switch:
  - `DEBUG = '1'`
- Categories (set to `'1'` to enable):
  - `DEBUG_FEED`
  - `DEBUG_SLIDES`
  - `DEBUG_AUTH`
  - `DEBUG_VIDEO`
  - `DEBUG_NETWORK` (reserved)
  - `DEBUG_RENDER` (reserved)
  - `DEBUG_PERF` (reserved)
  - `DEBUG_ERRORS` (reserved)
- ID filters:
  - `DEBUG_FEED_ID`
  - `DEBUG_SLIDE_ID`
  - `DEBUG_VIDEO_ID`
- Query bootstrap (examples):
  - `?debug=1&debug_slides=1`
  - `?debug=1&debug_video=1&debug_video_id=v-01K9*`

Notes
- Source maps must be present in dev for accurate file:line in the console.
- We’ll evolve this doc as we add network tracing, render reasons, and perf reporting behind the existing flags.

Console Hygiene (reduce noise)
- Chrome Console
  - Hide network spam: open Console, click the filter funnel icon and uncheck the Network category (or in older Chrome, open Console settings and uncheck “Log XMLHttpRequests”).
  - Use the search filter to exclude patterns: prefix terms with a minus, e.g. `-XHR -m3u8 -ts`.
  - Preserve logs on navigation: enable “Preserve log” if you’re reloading.
- Safari Web Inspector
  - In the Console pane, uncheck “Network Requests” to hide XHR/Fetch messages.
  - Use the filter box to exclude noisy substrings.
- Firefox DevTools
  - In the Console settings, uncheck “XHR” (or “Network”) messages.
  - Use the filter input with negative terms to hide patterns.
