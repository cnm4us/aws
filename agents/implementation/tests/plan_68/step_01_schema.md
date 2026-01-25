# Plan 68 — Step 1 (Schema + Discriminators)

Date: 2026-01-25

## Summary
- Added `uploads.video_role` + `uploads.create_video_project_id` to discriminate raw vs export videos and link exports to Create Video timelines.
- Added `create_video_projects.name`.
- Removed the “single active project per user” uniqueness (`uniq_create_video_projects_active`) via best-effort drop in `ensureSchema`.
- Added supporting indexes.

## Commands

### Typecheck
```bash
npm run build
```
Result: OK

### Web build
```bash
npm run web:build
```
Result: OK

