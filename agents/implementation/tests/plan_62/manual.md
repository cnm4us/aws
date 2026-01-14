## Plan 62 manual test notes

### Build
- `npm run build` ✅
- `npm run web:build` ✅

### Manual smoke test (suggested)
1. Open `/create-video`
2. Click `Add Video`, select 2 uploads
3. Select a clip → `Split` at playhead → verify 2 clips
4. Select a clip → `Trim` → verify source in/out updates
5. Select a clip → `Delete` → verify ripple close
6. Click `Undo` → verify last edit reverts
7. Click `Export` → wait for completion → verify redirect to `/produce?upload=<newId>&from=/create-video`
8. On `/produce`, confirm the new upload behaves like a normal video upload (preview, proxy generation, etc.)

