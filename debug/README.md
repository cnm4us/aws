# Debug Artifact Workspace

`debug/` is a local, disposable workspace for runtime diagnostics.

## Directories
- `debug/terminal/` - terminal/server logs (for example `npm run serve:jaeger:log` output).
- `debug/console/` - browser-emitted debug logs captured server-side.

## Lifecycle
- Files here are expected to be deleted frequently.
- Manual cleanup is normal and does not require migration.
- Do not treat files here as canonical long-term evidence.

## Canonical Evidence Location
- Preserve durable test evidence under `tests/runs/...`.
- If a debug artifact is important long-term, copy it into a run artifact folder and reference it from the plan.
