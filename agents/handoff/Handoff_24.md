# Handoff 24 — Plan 89 (Library UI: custom controls + waveform + captions + improved search)

## Status
- **Plan 89** has been drafted (`agents/implementation/plan_89.md`).
- Per user request, I started a **skeleton implementation** in `frontend/src/app/Library.tsx`:
  - Removed native `<video controls>` and added a **custom play/pause + scrub + time readout**.
  - Added a **rolling waveform canvas** fed by `/api/uploads/:id/audio-envelope`.
  - Waveform is a 30s window around current playhead, with a red playhead marker.
  - Hooked `timeupdate` and `loadedmetadata` to track `currentTime`/`duration`.

## Files Modified (pending commit)
- `frontend/src/app/Library.tsx`

## What’s in the skeleton
- New state:
  - `currentTime`, `duration`, `isPlaying`
  - `waveEnv`, `waveStatus`, `waveError`
  - `waveCanvasRef`, `wavePollRef`
- New fetch loop for audio envelope:
  - Polls `GET /api/uploads/:id/audio-envelope` (handles 202 pending).
- Custom controls:
  - play/pause button
  - scrub range input
  - time elapsed / total display
  - waveform strip below

## What’s missing (still to implement)
1. **Captions toggle + rolling captions panel**
   - Need new endpoint: `GET /api/library/videos/:id/captions` (parse VTT into cues)
   - Frontend should add toggle + list with current cue highlight

2. **Transcript search improvement**
   - In `src/features/library/service.ts`, modify search to normalize + remove stopwords
   - Use token match (all tokens must exist in cue text)

3. **Waveform interaction**
   - Currently waveform renders, but no click-to-seek
   - Add `onClick` on canvas to map x → time (within rolling window)

4. **UI polish**
   - Add captions toggle button to control bar
   - Adjust styling to match app patterns

## Notes / Risks
- The waveform uses full envelope points (0.1s). For very long videos this is still okay if only rendering windowed, but if memory is too high consider fetching envelope once and windowing in render only.
- Custom controls must handle mobile autoplay restrictions (user must tap play).

## Suggested next steps
1. Add captions endpoint in backend + wire into Library page.
2. Implement search normalization in `library/service.ts`.
3. Add waveform click-to-seek.
4. Add captions toggle button + rolling captions UI.

## Reminder
User explicitly requested **no native controls** — keep custom controls only.

