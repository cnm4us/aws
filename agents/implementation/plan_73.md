# Plan 73 — Object-centric Audio (MVP) + Required Music Config

Status: **planning → ready to implement**

This plan implements `agents/features/feature_12.md` (object-centric audio MVP):
- Voice sources (video / videoOverlay / narration): per-object **Audio On/Off** + optional **Boost**
- Music: per-music-object config (**Opener cutoff / Replace / Mix / Mix+Duck**) + knobs
- Export should **block** if any music objects exist but are **not configured**

---

## 0) Scope / Non-goals

### In scope
- UI + persistence for:
  - Video / VideoOverlay / Narration: `audioEnabled` toggle (quick toggle in context menu)
  - Video / VideoOverlay / Narration: `boostDb` (0/+3/+6/+9) in Properties modal
- Music: per-segment “Audio Config” UI and persistence (mode + knobs)
- Enforce: **cannot export** when music segments exist but are not configured
- Render pipeline changes in `create_video_export_v1` to apply:
  - voice `boostDb`
  - music mode + level + ducking intensity + opener cutoff (speech detection from any ON voice source)

### Existing Audio Configs (Important constraint for implementation/testing)
We already have legacy/admin `audioConfigs` used elsewhere (e.g. older Produce flow, system audio presets, etc.). For Create Video MVP audio:
- We **do not remove** audioConfigs from the codebase/UI globally.
- We **bypass** audioConfigs for Create Video music segments so they do not confound behavior while testing.
- Concretely:
  - Create Video music segments should use the new per-segment fields (`musicMode`, `musicLevel`, `duckingIntensity`) and **ignore `audioConfigId`** if present.
  - If the existing UI currently sets `audioConfigId` on create-video music segments, we should leave it in place for now but treat it as deprecated/ignored in Create Video export.
  - If a segment has both `audioConfigId` and `musicMode`, `musicMode` wins.
  - If a segment has neither, export is blocked (music config required).

### Out of scope (defer)
- Automatic per-clip loudness matching (“auto”)
- Crossfades between sources
- Looping overlay clips
- Timeline-level audio presets (not using the preset approach)

---

## 1) Data model changes (Create Video project JSON)

### 1.1 Voice-capable objects
Add/standardize these fields in the timeline JSON:
- Base video clips:
  - `audioEnabled: boolean` (already exists)
  - `boostDb?: number` (new; default 0)
- Video overlays:
  - `audioEnabled: boolean` (already exists)
  - `boostDb?: number` (new; default 0)
- Narration segments:
  - `audioEnabled: boolean` (new; default true)
  - `boostDb?: number` (new; default 0)

### 1.2 Music segments
Replace reliance on `audioConfigId` (admin presets) for Create Video music segments with an object-centric config:
- `musicMode: 'opener_cutoff' | 'replace' | 'mix' | 'mix_duck'` (required when music segment exists)
- `musicLevel: 'quiet' | 'medium' | 'loud'` (required when musicMode exists)
- `duckingIntensity?: 'min' | 'medium' | 'max'` (required when `musicMode==='mix_duck'`)

Mapping constants (initial guesses; iterate in testing):
- musicLevel → gainDb:
  - quiet = -24 dB
  - medium = -18 dB
  - loud = -12 dB
- duckingIntensity → duckAmountDb (initial):
  - min = 6 dB
  - medium = 12 dB
  - max = 18 dB

---

## 2) Backend validation

### 2.1 Create video timeline validation
Update `src/features/create-video/validate.ts` to:
- Normalize missing `audioEnabled` fields for narration and overlays/clips (default true/false as appropriate).
- Normalize missing `boostDb` fields (default 0).
- Validate `boostDb` is one of `{0,3,6,9}`.

### 2.2 Export-time validation (hard block)
In `create_video_export_v1` input validation:
- If any music segments exist:
  - require each to have `musicMode` and `musicLevel`
  - if `musicMode==='mix_duck'` require `duckingIntensity`
- If not valid:
  - fail job with a specific error code like `music_config_required`
  - return a user-friendly message to UI

---

## 3) Create Video UI

### 3.1 Context menu: quick Audio toggle (voice objects)
For Video / VideoOverlay / Narration pills:
- Add a context-menu item:
  - `Audio: On` (On text green)
  - `Audio: Off` (Off text red)
- Tap toggles state **without closing** the menu.
- Add pill icon:
  - 🔊 when ON
  - muted icon (red) when OFF

### 3.2 Properties modal: Boost
In Properties for Video / VideoOverlay / Narration:
- Add `Boost` select:
  - None (0 dB)
  - Small (+3 dB)
  - Medium (+6 dB)
  - Large (+9 dB)

### 3.3 Music segment config UI
For Music objects:
- Context menu item: `Audio…` opens a small modal
- Fields:
  - Audio: On/Off
  - If On:
    - Mode: Opener Cutoff / Replace / Mix / Mix + Duck
    - Music Level: Quiet / Medium / Loud
    - Ducking Intensity (Min/Medium/Max) when Mix+Duck
- Visual indicator on music pill when configured vs missing:
  - e.g. if missing required config: warning badge / red dot

### 3.4 Export gating (front-end)
On Export:
- If any music segments exist and any are missing config:
  - block export
  - show a clear message (and optionally scroll/select the first invalid music segment)
  - guidance: “Select the music segment → Audio… → choose a mode and level.”

---

## 4) Render pipeline (create_video_export_v1)

### 4.1 Voice routing and equal-mix
Implement the MVP rule:
- If multiple voice sources are ON at the same time, they mix equally.

Implementation approach:
- Build a “voice bus” from:
  - base video audio (enabled clips), trimmed and delayed to timeline positions
  - overlay video audio (enabled overlays), trimmed and delayed to timeline positions
  - narration audio (enabled segments), trimmed and delayed to timeline positions
- Apply per-segment `boostDb` via `volume=` before summing.
- Mix voice bus using `amix=normalize=0` (equal contribution).

### 4.2 Music modes
For each music segment (configured):
- Apply `musicLevel` gain to the music audio.
- Behavior by mode:
  - replace: output audio = music only
  - mix: output audio = voiceBus + music
  - mix_duck: output audio = voiceBus + duckedMusic
  - opener_cutoff:
    - analyze “speech present” from the **voice bus** (any ON voice source)
    - cut/fade music to 0 once speech begins (existing fade-before/after params can be reused or kept fixed for MVP)
    - output audio = voiceBus + cutoffMusic

### 4.3 Final loudness normalization
Keep existing final normalization + limiter on the combined output (as today).

---

## 5) Manual test plan

### 5.1 Export blocking
- Add a music segment, leave it unconfigured → export should be blocked with clear UI message.

### 5.2 Voice equal-mix
- Enable base video + narration simultaneously → audible overlap (intentionally “wrong”), confirms equal mix.

### 5.3 Boost
- Overlay quiet clip, set Boost=Large (+9 dB) → noticeably louder overlay audio in export.

### 5.4 Opener cutoff speech detection
- Opener music + narration speech (base video muted) → cutoff triggers when narration speech begins.
- Opener music + overlay speech (base video muted) → cutoff triggers when overlay speech begins.

---

## 6) Deliverables
- Updated validation + types for Create Video timeline JSON.
- Create Video UI: quick audio toggle + boost + music config modal.
- Export job: correct mixing rules + music modes + hard export gating when music config missing.
