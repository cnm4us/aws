# Plan 89 — Library Player UI (Custom Controls + Rolling Waveform + Captions + Better Search)

## Goals
- Replace native `<video>` controls in `/library` with a **custom control bar** that always shows time elapsed / total.
- Add a **rolling waveform** (windowed view) to aid precise clip in/out selection.
- Add **toggleable captions panel** that follows playback and allows clicking cues to jump.
- Improve transcript search with **normalized token matching + stopword removal**.

---

## Scope Decisions (from discussion)
- **Replace** native controls completely.
- Waveform shows **rolling window only** (not full-length).
- Captions are **behind a toggle**.
- Search uses **normalize + stopwords** (no semantic yet).

---

## UX / UI Layout
- Player area:
  - Video viewport (custom overlay allowed).
  - **Custom control bar** (play/pause, time, scrubber).
  - **Waveform strip** below video (rolling window).
  - **Captions toggle** button (e.g., “CC”) in control bar.
- Captions panel:
  - Appears below waveform or in a collapsible drawer.
  - Shows rolling cues, highlights current cue.
  - Clicking cue jumps to time.

---

## Data / API
### 1) Rolling waveform
- Reuse `/api/uploads/:id/audio-envelope` (existing).
- For library videos, ensure audio envelope is generated:
  - already created via `upload_audio_envelope_v1` after edit proxy.
- Add frontend windowing:
  - fetch full envelope once, render rolling 30s window around current time.
  - resolution: 0.1s interval (existing).

### 2) Captions
- Reuse `upload_captions` (VTT in S3).
- Add endpoint to fetch VTT for library uploads:
  - `GET /api/library/videos/:id/captions`
  - returns parsed cues with start/end/text (server parses VTT).
- Client stores cues and displays rolling view + current highlight.

### 3) Transcript search upgrade
- On `/api/library/videos/:id/search`:
  - normalize query and cue text:
    - lowercase
    - remove punctuation
    - remove stopwords
  - match: all tokens must be present in cue text tokens.
- Return results with same schema but improved matching.

---

## Implementation Steps
1. **Custom controls in `/library`**
   - Remove `controls` from `<video>`.
   - Add custom bar:
     - play/pause button
     - time elapsed / total
     - scrub slider (input range)
   - Keep `currentTime` synced with slider.

2. **Rolling waveform**
   - Fetch `/api/uploads/:id/audio-envelope`.
   - Render waveform canvas/DOM for a 30s window centered on playhead.
   - As playback moves, update waveform window.
   - Clicking waveform seeks.

3. **Captions toggle + rolling display**
   - Add toggle state in `/library`.
   - New endpoint: `/api/library/videos/:id/captions`
     - parse VTT into cue list in backend.
   - Render cue list; highlight current cue based on `currentTime`.

4. **Transcript search matching**
   - Implement tokenizer + stopwords in `features/library/service.ts`.
   - Normalize cue text and query tokens.
   - Match: all query tokens must appear in cue token set.

5. **Polish**
   - Ensure scrubber + waveform + captions all stay in sync.
   - Waveform updates when user jumps via transcript search results.

---

## New / Updated Endpoints
- `GET /api/library/videos/:id/captions`
  - returns `{ items: [{ startSeconds, endSeconds, text }] }`

---

## Risks / Notes
- Waveform fetch size: may be large for long videos; windowing on client avoids heavy rendering.
- Captions parsing should reuse existing VTT parser in library service.
- Custom controls must handle mobile autoplay restrictions (tap to play).

---

## Rollback Plan
- Keep native controls toggled via a feature flag if needed.
- Waveform + captions can be disabled independently if performance issues appear.
