# Feature 12 — Create Video: Object-centric Audio (MVP)

## Status
Draft (discussion/planning only; not ready for implementation).

## Problem / Motivation
Create Video timelines can combine:
- Base video clips (creator speaking, or general video audio)
- Video overlay clips (PiP; often external source clips)
- Narration (voice memos / voiceover segments)
- Music (background / opener / music-video style)

Creators will frequently combine media from different sources with different loudness. We want:
- **Simple controls** that don’t feel like a DAW
- **Predictable behavior** that encourages correct configuration
- A workflow where creators can export, listen, and iterate quickly

## Goals
- Keep audio controls **object-centric** and minimal:
  - Video / Overlay / Narration: `Audio On | Off` + optional `Boost`
  - Music: a small config (replace/mix/duck/cutoff)
- Preserve the product principle:
  - **Obvious incorrectness over clever automation** in MVP (fail-loud / fail-obvious).
- Provide enough tooling to handle common “quiet clip” problems (via Boost), while still keeping export loudness consistent (final normalization).

## Non-goals (MVP)
- Full multi-track mixing UI (DAW style).
- Automatic per-clip loudness matching by default (e.g., two-pass loudnorm for every clip).
- Crossfades between audio sources.

---

## Audio Sources
We treat these as potentially audible in the final export:
- **VIDEO** (base lane): embedded audio in video clips
- **VIDEO OVERLAY** (PiP lane): embedded audio in overlay video clips
- **NARRATION**: imported/recorded voice segments
- **MUSIC**: background music segments

---

## Core MVP Controls

### 1) Video (base clips)
Per object:
- **Audio**: `On | Off`
- **Boost**:
  - `None (0 dB)` *(default)*
  - `Small (+3 dB)`
  - `Medium (+6 dB)`
  - `Large (+9 dB)`

### 2) Video Overlay (PiP clips)
Per object:
- **Audio**: `On | Off`
- **Boost**:
  - `None (0 dB)` *(default)*
  - `Small (+3 dB)`
  - `Medium (+6 dB)`
  - `Large (+9 dB)`

### 3) Narration
Per object:
- **Audio**: `On | Off`
- **Boost**:
  - `None (0 dB)` *(default)*
  - `Small (+3 dB)`
  - `Medium (+6 dB)`
  - `Large (+9 dB)`

> Note: Boost is intentionally described as an adjustment to what the creator provided, not a universal standard.

---

## Mixing Rules (MVP)

### Voice mixing
“Voice sources” are:
- Video audio (base)
- Video overlay audio
- Narration

Rule:
- If 2 or 3 voice sources are ON at the same time range, **mix equally**.

Rationale:
- Creators rarely want multiple voices simultaneously.
- Equal mix provides clear behavioral feedback when configuration is wrong.
- Creators fix by toggling Audio On/Off and re-exporting.

### Music priority over voice mixing
Music behavior is configured separately (below). Music configuration determines whether music:
- replaces all other audio, or
- mixes under/with voices (and optionally ducks or cuts off).

Voice sources always follow equal-mix when multiple are ON; music behavior does not “pick a winner” among voice sources.

---

## Music Configuration (MVP)
Music configuration can be applied per music object on the timeline.

### Music: Audio
- `On | Off`

If `On`, select exactly one music mode:

1) **Opener (Auto Cutoff)**
- Music starts immediately and **drops to 0** and stays there when speech is detected.
- **Music Level**: `Quiet | Medium | Loud` *(default Medium)*

2) **Replace**
- Music replaces all other audio sources (voices muted).
- **Music Level**: `Quiet | Medium | Loud` *(default Medium)*

3) **Mix (No Ducking)**
- Music mixes with whatever voice sources are ON.
- **Music Level**: `Quiet | Medium | Loud` *(default Medium)*

4) **Mix + Ducking**
- Music mixes with voice sources and ducks under speech/ambient.
- **Music Level**: `Quiet | Medium | Loud` *(default Medium)*
- **Ducking Intensity**: `Min | Medium | Max` *(default Medium)*

---

## Loudness / Normalization Strategy
We keep a final output processing step:
- **Final program loudness normalization** + **true-peak limiting**

This ensures exports have consistent overall loudness across productions.

We do not attempt fully automated per-clip loudness matching in MVP. The creator corrects loudness mismatches using:
- Audio On/Off per object
- Boost per voice-capable object
- Music Level / Ducking / Replace / Cutoff for music

---

## UX / UI Requirements

### Timeline pill visual cues
Every object that can produce audio should show an icon on the pill:
- 🔊 for Audio ON
- Muted icon for Audio OFF (optionally tinted red for clarity)

### Properties messaging
In Properties for voice-capable objects, include a short note:
- “Audio ON will be mixed with any other ON tracks.”

### Placement of controls
To keep the timeline UI clean:
- Video / Overlay / Narration:
  - Audio On/Off + Boost live in **Context Menu → Properties**
- Music:
  - **Context Menu → Audio** opens the music config screen (mode + knobs)

---

## Open Questions (for discussion)
1) Boost mapping: confirm the default dB values:
   - +3 / +6 / +9 (current draft)
   - **Confirmed**: `Small (+3 dB) / Medium (+6 dB) / Large (+9 dB)`
2) Music Level mapping (initial guess; iterate in testing):
   - Goal: levels are perceived relative to final normalized speech loudness.
   - **Quiet**: subtle background bed → **-24 dB**
   - **Medium**: opener/mood but not dominant → **-18 dB**
   - **Loud**: “dominates the scene” opener → **-12 dB**
   - Notes:
     - These are starting points, not guarantees; final normalization may shift perceived balance depending on content.
     - Ducking/cutoff modes should preserve the chosen pre-duck/pre-cut music level.
3) Speech detection source for Opener Cutoff:
   - **Confirmed**: detect speech from **any ON voice source** (base video, overlay video, narration).
