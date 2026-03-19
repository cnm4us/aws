# Plan 68 — Step 4 (Frontend Projects) Test Log

## Build
- `npm run web:build`

## Manual
- Open `/create-video`
- Open `Timelines` picker → `New` → verify URL updates to `/create-video?project=<id>` and timeline is empty/new.
- Create a second project via `New` → switch between projects → confirm each retains its own timeline state.
- Hard refresh → confirm the current project is restored from `localStorage` / `?project=`.

