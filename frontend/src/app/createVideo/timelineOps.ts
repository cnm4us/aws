import type { Clip, Graphic, Timeline } from './timelineTypes'
import { clamp, clipDurationSeconds, clipFreezeEndSeconds, clipFreezeStartSeconds, clipSourceDurationSeconds, computeClipStarts, computeTimelineEndSecondsFromClips, locate, roundToTenth } from './timelineMath'

export function insertClipAtPlayhead(timeline: Timeline, clip: Clip): Timeline {
  const starts = computeClipStarts(timeline.clips)
  const endSeconds = computeTimelineEndSecondsFromClips(timeline.clips, starts)
  const t = clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, endSeconds))
  const dur = clipDurationSeconds(clip)

  // Normalize existing clips to explicit startSeconds (so the UI can move them later).
  const normalizedExisting: Clip[] = timeline.clips.map((c, i) => ({
    ...c,
    startSeconds: roundToTenth(starts[i] || 0),
  }))

  const existingRanges = normalizedExisting
    .map((c) => {
      const s = Number((c as any).startSeconds || 0)
      const e = roundToTenth(s + clipDurationSeconds(c))
      return { id: c.id, start: s, end: e }
    })
    .sort((a, b) => a.start - b.start)

  let startSeconds = roundToTenth(t)
  // Slide forward until it doesn't overlap any existing clip.
  for (const r of existingRanges) {
    const overlaps = startSeconds < r.end - 1e-6 && (startSeconds + dur) > r.start + 1e-6
    if (overlaps) startSeconds = roundToTenth(r.end)
  }

  const placed: Clip = { ...clip, startSeconds }
  const nextClips = [...normalizedExisting, placed].sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0))
  return { ...timeline, clips: nextClips }
}

export function splitClipAtPlayhead(timeline: Timeline, selectedClipId: string | null): { timeline: Timeline; selectedClipId: string | null } {
  if (!selectedClipId) return { timeline, selectedClipId }
  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const starts = computeClipStarts(timeline.clips)
  const { clipIndex, within } = locate(t, timeline.clips)
  if (clipIndex < 0) return { timeline, selectedClipId }
  const clip = timeline.clips[clipIndex]
  if (!clip || clip.id !== selectedClipId) return { timeline, selectedClipId }

  const freezeStart = clipFreezeStartSeconds(clip)
  const freezeEnd = clipFreezeEndSeconds(clip)
  const srcDur = clipSourceDurationSeconds(clip)
  const movingStart = freezeStart
  const movingEnd = freezeStart + srcDur
  // Disallow split inside freeze regions; UI can surface a message.
  if (within < movingStart + 1e-6 || within > movingEnd - 1e-6) return { timeline, selectedClipId }

  const cutWithinMoving = roundToTenth(within - freezeStart)
  const cut = roundToTenth(clip.sourceStartSeconds + cutWithinMoving)
  const minLen = 0.2
  if (cut <= clip.sourceStartSeconds + minLen || cut >= clip.sourceEndSeconds - minLen) return { timeline, selectedClipId }

  const startSeconds = roundToTenth(starts[clipIndex] || 0)
  // Keep freeze-start on the left piece; keep freeze-end on the right piece.
  const left: Clip = { ...clip, id: `${clip.id}_a`, startSeconds, sourceEndSeconds: cut, freezeEndSeconds: 0 }
  const leftDur = roundToTenth((cut - clip.sourceStartSeconds) + freezeStart)
  const right: Clip = { ...clip, id: `${clip.id}_b`, startSeconds: roundToTenth(startSeconds + leftDur), sourceStartSeconds: cut, freezeStartSeconds: 0 }
  const idx = timeline.clips.findIndex((c) => c.id === clip.id)
  if (idx < 0) return { timeline, selectedClipId }
  const normalizedExisting: Clip[] = timeline.clips.map((c, i) => ({
    ...c,
    startSeconds: roundToTenth(starts[i] || 0),
  }))
  const next = [...normalizedExisting.slice(0, idx), left, right, ...normalizedExisting.slice(idx + 1)]
  next.sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0))
  return { timeline: { ...timeline, clips: next }, selectedClipId: right.id }
}

export function splitGraphicAtPlayhead(
  timeline: Timeline,
  selectedGraphicId: string | null
): { timeline: Timeline; selectedGraphicId: string | null } {
  if (!selectedGraphicId) return { timeline, selectedGraphicId }
  const graphics: Graphic[] = Array.isArray((timeline as any).graphics) ? ((timeline as any).graphics as any) : []
  const idx = graphics.findIndex((g: any) => String(g?.id) === String(selectedGraphicId))
  if (idx < 0) return { timeline, selectedGraphicId }
  const g: any = graphics[idx]
  const start = roundToTenth(Number(g?.startSeconds || 0))
  const end = roundToTenth(Number(g?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedGraphicId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.2
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedGraphicId }

  const left: Graphic = { ...g, id: `${String(g.id)}_a`, startSeconds: start, endSeconds: cut }
  const right: Graphic = { ...g, id: `${String(g.id)}_b`, startSeconds: cut, endSeconds: end }
  const nextGraphics = [...graphics.slice(0, idx), left, right, ...graphics.slice(idx + 1)]
  nextGraphics.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
  return { timeline: { ...(timeline as any), graphics: nextGraphics } as any, selectedGraphicId: right.id }
}
