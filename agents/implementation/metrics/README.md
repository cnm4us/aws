# Web Bundle Snapshots

Use this to log comparable bundle snapshots while we split `CreateVideo`.

## Command

```bash
npm run web:bundle-snapshot
```

This command:
1. Reads built assets from `public/app/assets`.
2. Computes raw and gzip sizes.
3. Appends a JSON line snapshot to `agents/implementation/metrics/web-bundle-snapshots.jsonl`.

## Notes
1. Run `npm run web:build` before snapshotting if assets are stale.
2. Compare `keyChunks.createVideo` over time to verify Phase B improvements.
