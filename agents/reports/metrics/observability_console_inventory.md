# Observability Console Inventory (Plan 109 Phase A)

Date: 2026-03-05  
Scope: backend/worker runtime code under `src/**` (frontend `dlog` excluded by design)

## Command used

```bash
rg -n "\\bconsole\\.(log|info|warn|error|debug|trace)\\b" src -S \
  | awk -F: '{print $1}' | sort | uniq -c | sort -nr
```

## Summary

- Total `console.*` matches in `src/**`: **136**
- Files with `console.*`: **15**
- Highest concentration:
  - `src/routes/pages.ts` (73)
  - `src/routes/uploads.ts` (22)
  - `src/server.ts` (14)

## File-level counts

| File | Count | Category |
|---|---:|---|
| `src/routes/pages.ts` | 73 | Runtime routes |
| `src/routes/uploads.ts` | 22 | Runtime routes |
| `src/server.ts` | 14 | Runtime bootstrap/shutdown |
| `src/app.ts` | 5 | Runtime app/auth |
| `src/tools/mediaconvert/describe-endpoints.ts` | 4 | CLI tool |
| `src/routes/admin.ts` | 3 | Runtime routes |
| `src/tools/mediaconvert/create-job.ts` | 2 | CLI tool |
| `src/services/mediaJobs/worker.ts` | 2 | Runtime worker |
| `src/routes/signing.ts` | 2 | Runtime routes |
| `src/routes/publish-single.ts` | 2 | Runtime routes |
| `src/routes/library.ts` | 2 | Runtime routes |
| `src/index.ts` | 2 | Runtime bootstrap |
| `src/utils/requestLog.ts` | 1 | Runtime utility |
| `src/routes/publish.ts` | 1 | Runtime routes |
| `src/middleware/sessionParse.ts` | 1 | Runtime middleware |

## Migration waves (recommended)

1. **Media jobs path first**
   - `src/services/mediaJobs/worker.ts`
   - `src/server.ts` (worker lifecycle lines)
2. **High-volume API routes**
   - `src/routes/uploads.ts`
   - `src/routes/pages.ts`
3. **Core bootstrap/auth**
   - `src/app.ts`
   - `src/index.ts`
4. **Remaining runtime routes/utilities**
   - `src/routes/*` residual files
   - `src/utils/requestLog.ts`, `src/middleware/sessionParse.ts`
5. **CLI tools (optional)**
   - `src/tools/mediaconvert/*` can stay on console initially.

## Guardrail added in this phase

- Script: `scripts/check-backend-console.js`
- NPM script: `npm run check:console:backend`
- Policy:
  - no new backend files may introduce `console.*`
  - existing files may not exceed baseline counts
  - counts may decrease as migration progresses

This guardrail supports incremental replacement with Pino without blocking current runtime behavior.

