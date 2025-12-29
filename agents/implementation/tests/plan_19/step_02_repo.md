# Plan 19 — Step 2 Repo/Service (Pinned row)

Date: 2025-12-29

## Changes

- Added repo helper `getSpaceFeedPinnedRowByProductionUlid(spaceId, { productionUlid, userId })` in `src/features/feeds/repo.ts`.
- Added service helper `getPinnedSpaceFeedItem(spaceId, { userId, productionUlid })` in `src/features/feeds/service.ts`.

## Build

```bash
npm run build
```


> aws-mediaconvert-service@0.1.0 build
> tsc -p .

