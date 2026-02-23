import type { AudioSegment, Clip, Graphic, Logo, LowerThird, Narration, ScreenTitle, Still, Timeline, VideoOverlay, VideoOverlayStill } from './timelineTypes'
import { clamp, clipDurationSeconds, computeClipStarts, computeTimelineEndSecondsFromClips, locate, roundToTenth } from './timelineMath'

export function insertClipAtPlayhead(timeline: Timeline, clip: Clip, maxEndSeconds?: number): Timeline {
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

  let placed: Clip = { ...clip, startSeconds }
  if (maxEndSeconds != null && Number.isFinite(Number(maxEndSeconds))) {
    const maxDur = roundToTenth(Math.max(0, Number(maxEndSeconds) - startSeconds))
    if (maxDur <= 0.05) return timeline
    if (dur > maxDur + 1e-6) {
      const srcStart = Number((placed as any).sourceStartSeconds || 0)
      placed = { ...placed, sourceEndSeconds: roundToTenth(srcStart + maxDur) }
    }
  }
  const nextClips = [...normalizedExisting, placed].sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0))
  return { ...timeline, clips: nextClips }
}

export function insertVideoOverlayAtPlayhead(timeline: Timeline, overlay: VideoOverlay, maxEndSeconds?: number): Timeline {
  const existing: VideoOverlay[] = Array.isArray((timeline as any).videoOverlays) ? ((timeline as any).videoOverlays as any) : []
  const starts = computeClipStarts(existing as any)
  const endSeconds = computeTimelineEndSecondsFromClips(existing as any, starts)
  const t = clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, endSeconds))
  const dur = clipDurationSeconds(overlay as any)

  const normalizedExisting: VideoOverlay[] = existing.map((c, i) => ({
    ...(c as any),
    startSeconds: roundToTenth(starts[i] || 0),
  }))

  const existingRanges = normalizedExisting
    .map((c) => {
      const s = Number((c as any).startSeconds || 0)
      const e = roundToTenth(s + clipDurationSeconds(c as any))
      return { id: String((c as any).id), start: s, end: e }
    })
    .sort((a, b) => a.start - b.start)

  let startSeconds = roundToTenth(t)
  for (const r of existingRanges) {
    const overlaps = startSeconds < r.end - 1e-6 && (startSeconds + dur) > r.start + 1e-6
    if (overlaps) startSeconds = roundToTenth(r.end)
  }

  let placed: VideoOverlay = { ...(overlay as any), startSeconds }
  if (maxEndSeconds != null && Number.isFinite(Number(maxEndSeconds))) {
    const maxDur = roundToTenth(Math.max(0, Number(maxEndSeconds) - startSeconds))
    if (maxDur <= 0.05) return timeline
    if (dur > maxDur + 1e-6) {
      const srcStart = Number((placed as any).sourceStartSeconds || 0)
      placed = { ...(placed as any), sourceEndSeconds: roundToTenth(srcStart + maxDur) } as any
    }
  }
  const next = [...normalizedExisting, placed].sort(
    (a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String((a as any).id).localeCompare(String((b as any).id))
  )
  return { ...(timeline as any), videoOverlays: next } as any
}

export function splitClipAtPlayhead(timeline: Timeline, selectedClipId: string | null): { timeline: Timeline; selectedClipId: string | null } {
  if (!selectedClipId) return { timeline, selectedClipId }
  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const starts = computeClipStarts(timeline.clips)
  const { clipIndex, within } = locate(t, timeline.clips)
  if (clipIndex < 0) return { timeline, selectedClipId }
  const clip = timeline.clips[clipIndex]
  if (!clip || clip.id !== selectedClipId) return { timeline, selectedClipId }

  const cut = roundToTenth(clip.sourceStartSeconds + within)
  const minLen = 0.2
  if (cut <= clip.sourceStartSeconds + minLen || cut >= clip.sourceEndSeconds - minLen) return { timeline, selectedClipId }

  const startSeconds = roundToTenth(starts[clipIndex] || 0)
  const left: Clip = { ...clip, id: `${clip.id}_a`, startSeconds, sourceEndSeconds: cut }
  const leftDur = roundToTenth(cut - clip.sourceStartSeconds)
  const right: Clip = { ...clip, id: `${clip.id}_b`, startSeconds: roundToTenth(startSeconds + leftDur), sourceStartSeconds: cut }
  const splitAtTimelineSeconds = roundToTenth(startSeconds + leftDur)
  const idx = timeline.clips.findIndex((c) => c.id === clip.id)
  if (idx < 0) return { timeline, selectedClipId }
  const normalizedExisting: Clip[] = timeline.clips.map((c, i) => ({
    ...c,
    startSeconds: roundToTenth(starts[i] || 0),
  }))
  const next = [...normalizedExisting.slice(0, idx), left, right, ...normalizedExisting.slice(idx + 1)]
  next.sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0))
  const prevStills: Still[] = Array.isArray((timeline as any).stills) ? (((timeline as any).stills as any) as Still[]) : []
  const nextStills: Still[] = prevStills.map((s: any) => {
    if (String((s as any).sourceClipId || '') !== String(clip.id)) return s as Still
    const stillStart = roundToTenth(Number((s as any).startSeconds || 0))
    const mappedClipId = stillStart < splitAtTimelineSeconds - 1e-6 ? left.id : right.id
    return { ...(s as any), sourceClipId: mappedClipId } as Still
  })
  return { timeline: { ...timeline, clips: next, stills: nextStills }, selectedClipId: right.id }
}

export function splitVideoOverlayAtPlayhead(
  timeline: Timeline,
  selectedVideoOverlayId: string | null
): { timeline: Timeline; selectedVideoOverlayId: string | null } {
  if (!selectedVideoOverlayId) return { timeline, selectedVideoOverlayId }
  const overlays: VideoOverlay[] = Array.isArray((timeline as any).videoOverlays) ? ((timeline as any).videoOverlays as any) : []
  if (!overlays.length) return { timeline, selectedVideoOverlayId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const starts = computeClipStarts(overlays as any)
  const { clipIndex, within } = locate(t, overlays as any)
  if (clipIndex < 0) return { timeline, selectedVideoOverlayId }
  const overlay = overlays[clipIndex] as any
  if (!overlay || String(overlay.id) !== String(selectedVideoOverlayId)) return { timeline, selectedVideoOverlayId }

  const cut = roundToTenth(Number(overlay.sourceStartSeconds) + within)
  const minLen = 0.2
  if (cut <= Number(overlay.sourceStartSeconds) + minLen || cut >= Number(overlay.sourceEndSeconds) - minLen) return { timeline, selectedVideoOverlayId }

  const startSeconds = roundToTenth(starts[clipIndex] || 0)
  const left: VideoOverlay = { ...(overlay as any), id: `${String(overlay.id)}_a`, startSeconds, sourceEndSeconds: cut }
  const leftDur = roundToTenth(cut - Number(overlay.sourceStartSeconds))
  const right: VideoOverlay = {
    ...(overlay as any),
    id: `${String(overlay.id)}_b`,
    startSeconds: roundToTenth(startSeconds + leftDur),
    sourceStartSeconds: cut,
  }

  const idx = overlays.findIndex((c: any) => String(c.id) === String(overlay.id))
  if (idx < 0) return { timeline, selectedVideoOverlayId }
  const normalizedExisting: VideoOverlay[] = overlays.map((c: any, i: number) => ({
    ...(c as any),
    startSeconds: roundToTenth(starts[i] || 0),
  }))
  const next = [...normalizedExisting.slice(0, idx), left, right, ...normalizedExisting.slice(idx + 1)]
  next.sort(
    (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
  )
  return { timeline: { ...(timeline as any), videoOverlays: next } as any, selectedVideoOverlayId: String((right as any).id) }
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

export function splitStillAtPlayhead(
  timeline: Timeline,
  selectedStillId: string | null
): { timeline: Timeline; selectedStillId: string | null } {
  if (!selectedStillId) return { timeline, selectedStillId }
  const ss: Still[] = Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any) : []
  const idx = ss.findIndex((s: any) => String(s?.id) === String(selectedStillId))
  if (idx < 0) return { timeline, selectedStillId }
  const s0: any = ss[idx]
  const start = roundToTenth(Number(s0?.startSeconds || 0))
  const end = roundToTenth(Number(s0?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedStillId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.1
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedStillId }

  const left: Still = { ...s0, id: `${String(s0.id)}_a`, startSeconds: start, endSeconds: cut }
  const right: Still = { ...s0, id: `${String(s0.id)}_b`, startSeconds: cut, endSeconds: end }
  const next = [...ss.slice(0, idx), left, right, ...ss.slice(idx + 1)]
  next.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), stills: next } as any, selectedStillId: right.id }
}

export function splitVideoOverlayStillAtPlayhead(
  timeline: Timeline,
  selectedVideoOverlayStillId: string | null
): { timeline: Timeline; selectedVideoOverlayStillId: string | null } {
  if (!selectedVideoOverlayStillId) return { timeline, selectedVideoOverlayStillId }
  const ss: VideoOverlayStill[] = Array.isArray((timeline as any).videoOverlayStills) ? ((timeline as any).videoOverlayStills as any) : []
  const idx = ss.findIndex((s: any) => String(s?.id) === String(selectedVideoOverlayStillId))
  if (idx < 0) return { timeline, selectedVideoOverlayStillId }
  const s0: any = ss[idx]
  const start = roundToTenth(Number(s0?.startSeconds || 0))
  const end = roundToTenth(Number(s0?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedVideoOverlayStillId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.1
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedVideoOverlayStillId }

  const left: VideoOverlayStill = { ...s0, id: `${String(s0.id)}_a`, startSeconds: start, endSeconds: cut }
  const right: VideoOverlayStill = { ...s0, id: `${String(s0.id)}_b`, startSeconds: cut, endSeconds: end }
  const next = [...ss.slice(0, idx), left, right, ...ss.slice(idx + 1)]
  next.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), videoOverlayStills: next } as any, selectedVideoOverlayStillId: right.id }
}

export function splitLogoAtPlayhead(
  timeline: Timeline,
  selectedLogoId: string | null
): { timeline: Timeline; selectedLogoId: string | null } {
  if (!selectedLogoId) return { timeline, selectedLogoId }
  const logos: Logo[] = Array.isArray((timeline as any).logos) ? ((timeline as any).logos as any) : []
  const idx = logos.findIndex((l: any) => String(l?.id) === String(selectedLogoId))
  if (idx < 0) return { timeline, selectedLogoId }
  const l: any = logos[idx]
  const start = roundToTenth(Number(l?.startSeconds || 0))
  const end = roundToTenth(Number(l?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedLogoId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.2
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedLogoId }

  const left: Logo = { ...l, id: `${String(l.id)}_a`, startSeconds: start, endSeconds: cut }
  const right: Logo = { ...l, id: `${String(l.id)}_b`, startSeconds: cut, endSeconds: end }
  const nextLogos = [...logos.slice(0, idx), left, right, ...logos.slice(idx + 1)]
  nextLogos.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), logos: nextLogos } as any, selectedLogoId: right.id }
}

export function splitLowerThirdAtPlayhead(
  timeline: Timeline,
  selectedLowerThirdId: string | null
): { timeline: Timeline; selectedLowerThirdId: string | null } {
  if (!selectedLowerThirdId) return { timeline, selectedLowerThirdId }
  const lowerThirds: LowerThird[] = Array.isArray((timeline as any).lowerThirds) ? ((timeline as any).lowerThirds as any) : []
  const idx = lowerThirds.findIndex((lt: any) => String(lt?.id) === String(selectedLowerThirdId))
  if (idx < 0) return { timeline, selectedLowerThirdId }
  const lt: any = lowerThirds[idx]
  const start = roundToTenth(Number(lt?.startSeconds || 0))
  const end = roundToTenth(Number(lt?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedLowerThirdId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.2
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedLowerThirdId }

  const left: LowerThird = { ...lt, id: `${String(lt.id)}_a`, startSeconds: start, endSeconds: cut }
  const right: LowerThird = { ...lt, id: `${String(lt.id)}_b`, startSeconds: cut, endSeconds: end }
  const nextLts = [...lowerThirds.slice(0, idx), left, right, ...lowerThirds.slice(idx + 1)]
  nextLts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), lowerThirds: nextLts } as any, selectedLowerThirdId: right.id }
}

export function splitScreenTitleAtPlayhead(
  timeline: Timeline,
  selectedScreenTitleId: string | null
): { timeline: Timeline; selectedScreenTitleId: string | null } {
  if (!selectedScreenTitleId) return { timeline, selectedScreenTitleId }
  const sts: ScreenTitle[] = Array.isArray((timeline as any).screenTitles) ? ((timeline as any).screenTitles as any) : []
  const idx = sts.findIndex((st: any) => String(st?.id) === String(selectedScreenTitleId))
  if (idx < 0) return { timeline, selectedScreenTitleId }
  const st: any = sts[idx]
  const start = roundToTenth(Number(st?.startSeconds || 0))
  const end = roundToTenth(Number(st?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedScreenTitleId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.2
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedScreenTitleId }

  const left: ScreenTitle = { ...st, id: `${String(st.id)}_a`, startSeconds: start, endSeconds: cut }
  const right: ScreenTitle = { ...st, id: `${String(st.id)}_b`, startSeconds: cut, endSeconds: end }
  const nextSts = [...sts.slice(0, idx), left, right, ...sts.slice(idx + 1)]
  nextSts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), screenTitles: nextSts } as any, selectedScreenTitleId: right.id }
}

export function splitNarrationAtPlayhead(
  timeline: Timeline,
  selectedNarrationId: string | null
): { timeline: Timeline; selectedNarrationId: string | null } {
  if (!selectedNarrationId) return { timeline, selectedNarrationId }
  const ns: Narration[] = Array.isArray((timeline as any).narration) ? ((timeline as any).narration as any) : []
  const idx = ns.findIndex((n: any) => String(n?.id) === String(selectedNarrationId))
  if (idx < 0) return { timeline, selectedNarrationId }
  const n: any = ns[idx]
  const start = roundToTenth(Number(n?.startSeconds || 0))
  const end = roundToTenth(Number(n?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedNarrationId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.2
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedNarrationId }

  const baseSourceStart = n.sourceStartSeconds != null && Number.isFinite(Number(n.sourceStartSeconds)) ? Number(n.sourceStartSeconds) : 0
  const offsetInto = Math.max(0, roundToTenth(cut - start))
  const left: Narration = { ...n, id: `${String(n.id)}_a`, startSeconds: start, endSeconds: cut, sourceStartSeconds: baseSourceStart }
  const right: Narration = {
    ...n,
    id: `${String(n.id)}_b`,
    startSeconds: cut,
    endSeconds: end,
    sourceStartSeconds: roundToTenth(baseSourceStart + offsetInto),
  }
  const next = [...ns.slice(0, idx), left, right, ...ns.slice(idx + 1)]
  next.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), narration: next } as any, selectedNarrationId: right.id }
}

export function splitAudioSegmentAtPlayhead(
  timeline: Timeline,
  selectedAudioId: string | null
): { timeline: Timeline; selectedAudioId: string | null } {
  if (!selectedAudioId) return { timeline, selectedAudioId }
  const segs: AudioSegment[] = Array.isArray((timeline as any).audioSegments) ? ((timeline as any).audioSegments as any) : []
  const idx = segs.findIndex((s: any) => String(s?.id) === String(selectedAudioId))
  if (idx < 0) return { timeline, selectedAudioId }
  const seg: any = segs[idx]
  const start = roundToTenth(Number(seg?.startSeconds || 0))
  const end = roundToTenth(Number(seg?.endSeconds || 0))
  if (!(end > start)) return { timeline, selectedAudioId }

  const t = roundToTenth(Number(timeline.playheadSeconds || 0))
  const cut = clamp(t, start, end)
  const minLen = 0.2
  if (cut <= start + minLen || cut >= end - minLen) return { timeline, selectedAudioId }

  const baseSourceStart = seg.sourceStartSeconds != null && Number.isFinite(Number(seg.sourceStartSeconds)) ? Number(seg.sourceStartSeconds) : 0
  const offsetInto = Math.max(0, roundToTenth(cut - start))
  const left: AudioSegment = { ...(seg as any), id: `${String(seg.id)}_a`, startSeconds: start, endSeconds: cut, sourceStartSeconds: baseSourceStart }
  const right: AudioSegment = {
    ...(seg as any),
    id: `${String(seg.id)}_b`,
    startSeconds: cut,
    endSeconds: end,
    sourceStartSeconds: roundToTenth(baseSourceStart + offsetInto),
  }
  const next = [...segs.slice(0, idx), left, right, ...segs.slice(idx + 1)]
  next.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), audioSegments: next, audioTrack: null } as any, selectedAudioId: right.id }
}
