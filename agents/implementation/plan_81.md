# Plan 81: Smart‑render clean segment starts (keyframe‑safe trims)

## Goal
Eliminate the brief visual flash at the *start* of a trimmed segment (base video + overlay video) **without** re‑encoding the entire segment. We will re‑encode only from the cut start to the next keyframe, then stream‑copy the remainder.

## Why
The flash happens when a segment starts on a non‑I frame. The decoder reconstructs the first frames from an earlier GOP, which can cause a visible luminance/color jump. Fixing just the segment start is sufficient.

---

## Scope (v1)
- Apply to **base video clips** and **video overlay** segments.
- Clean **segment starts only** (no end‑side handling).
- **Audio**: preserve smoothly across the join; if concat fails, fallback to full re‑encode of the segment.

---

## Approach

### 1) Keyframe probe helper
Create a helper that uses `ffprobe` to return a sorted list of keyframe times for a given file:

- Command:  
  `ffprobe -v error -select_streams v:0 -show_entries frame=pkt_pts_time,key_frame -of csv=p=0`  

- Parse: keep `key_frame=1`, collect times as `Number`.

Cache by path to avoid re‑probing the same file.

### 2) “Smart trim” utility
Given `inPath`, `start`, `end`, `outPath`:

1. Find:
   - `Kprev` = nearest keyframe **<= start**
   - `Knext` = nearest keyframe **> start**
2. If `start` is already within epsilon of `Kprev` → use existing **fast trim** (stream copy).
3. Else:
   - **Part A (re‑encode, short)**: from `start` to `min(Knext, end)`  
     - `-ss start -to Knext`
     - `-c:v libx264 -preset veryfast -crf 18 -g 30 -keyint_min 30 -force_key_frames 0`
     - `-c:a aac -b:a 128k` (if audio enabled)
   - **Part B (stream copy)**: from `Knext` to `end`  
     - `-ss Knext -to end -c copy`
   - **Concat A + B** with concat demuxer
   - If concat fails (codec mismatch), fallback to **full re‑encode** of `[start, end]`.

### 3) Integrate into export pipeline

#### Base video segments
In `renderSegmentMp4` (used for base clips):
- Replace current trim logic with `smartTrim` when:
  - clip starts at a non‑keyframe
  - `startSeconds > 0`
- Use existing `audioEnabled` and `boostDb` logic.

#### Overlay segments
In `overlayVideoOverlays`:
- Before building overlay filters, optionally pre‑render each overlay segment with `smartTrim` to a temporary file.
- Use the smart‑trim output as the `inPath` for that overlay segment.

---

## Implementation Steps

1. **Add keyframe probe helper** (in `src/services/ffmpeg/visualPipeline.ts` or `audioPipeline.ts`):
   - `probeKeyframes(path): number[]`
   - Cache results per file path.

2. **Add smartTrim helper** in `src/services/ffmpeg/trimPipeline.ts` or `createVideoExportV1.ts`:
   - Inputs: `inPath`, `outPath`, `start`, `end`, `audioEnabled`
   - Outputs: mp4 segment with clean start

3. **Wire into base clip render**:
   - Use smartTrim in `renderSegmentMp4`.
   - For freeze‑frame segments, keep current logic.

4. **Wire into overlay segments**:
   - If overlay segment start is non‑keyframe, smartTrim to `ovseg_*.mp4` and use that in filters.

5. **Logging**:
   - Use existing ffmpeg command logging to confirm smartTrim commands appear in job attempts.

---

## Edge Cases / Fallbacks
- If ffprobe returns no keyframes → fallback to full re‑encode.
- If `Knext` is missing (cut near end) → full re‑encode of `[start, end]`.
- If concat fails → full re‑encode.
- If `end <= start + 0.05` → skip.

---

## Testing

1. **Overlay split test** (your current repro):
   - Split overlay video into 2 snug segments.
   - Export; verify no color flash at the split boundary.
2. **Base video trim**:
   - Trim clip starting at 5.2s → verify no flash on first frame.
3. **Short segment** (<1s):
   - Ensure smartTrim still works and produces output.
4. **Logging**:
   - Check Media Job attempt manifest for smartTrim ffmpeg command lines.

---

## Notes
This is a targeted fix for segment‑start flashes. It avoids the cost of re‑encoding entire segments while preserving accuracy.
