# Browser Debug Artifacts

This directory is the default disposable location for ad hoc browser-debug artifacts created during interactive investigation.

Typical contents:

- Chromium screenshots captured through Chrome DevTools MCP
- temporary DOM snapshots
- temporary browser-session notes

## Default Mobile Screenshot Profile

Unless a request says otherwise, mobile screenshots should use:

- `iPhone 14 Pro Max`
- viewport `430x932`
- device pixel ratio `3`
- mobile/touch emulation enabled

This keeps screenshots and layout investigations consistent across sessions.

## Screenshot Mode Defaults

Use:

- viewport screenshots for page-level state
- element screenshots for menus, drawers, and modals

Use full-page screenshots only for relatively static pages where whole-document capture is actually needed.

## Lighthouse Artifacts

For ad hoc browser audits, store Lighthouse output under a focused subdirectory such as:

- `debug/browser/lighthouse-home/`
- `debug/browser/lighthouse-admin-reports/`

Typical files:

- `report.html`
- `report.json`

If the audit is evidence for a named validation run, move the durable artifacts into `tests/runs/.../artifacts/` instead.

## Use This Directory When

Store files here when they are:

- short-lived
- created during active debugging
- not intended to be durable evidence
- useful only for the current investigation session

Examples:

- a screenshot taken while reproducing a UI bug
- an intermediate screenshot before and after a click path
- one-off captures used to inspect rendering on the EC2-hosted browser

## Do Not Use This Directory When

Do not store files here when they are intended to be preserved as run evidence for validation, implementation phases, or reproducible test output.

Use `tests/runs/.../artifacts/` instead for:

- bug reproduction evidence that should be retained
- validation screenshots tied to a plan phase
- screenshots referenced from `summary.md`
- any durable artifact associated with a named run

## Retention

`debug/browser/` is disposable.

Manual cleanup is expected.
Do not treat files in this directory as durable project history.
