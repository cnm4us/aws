import type { Clip, Graphic, Logo, LowerThird, Narration, ScreenTitle, Timeline } from './timelineTypes'
import { clamp, clipDurationSeconds, computeClipStarts, computeTimelineEndSecondsFromClips, locate, roundToTenth } from './timelineMath'

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

  const cut = roundToTenth(clip.sourceStartSeconds + within)
  const minLen = 0.2
  if (cut <= clip.sourceStartSeconds + minLen || cut >= clip.sourceEndSeconds - minLen) return { timeline, selectedClipId }

  const startSeconds = roundToTenth(starts[clipIndex] || 0)
  const left: Clip = { ...clip, id: `${clip.id}_a`, startSeconds, sourceEndSeconds: cut }
  const leftDur = roundToTenth(cut - clip.sourceStartSeconds)
  const right: Clip = { ...clip, id: `${clip.id}_b`, startSeconds: roundToTenth(startSeconds + leftDur), sourceStartSeconds: cut }
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

  const left: Narration = { ...n, id: `${String(n.id)}_a`, startSeconds: start, endSeconds: cut }
  const right: Narration = { ...n, id: `${String(n.id)}_b`, startSeconds: cut, endSeconds: end }
  const next = [...ns.slice(0, idx), left, right, ...ns.slice(idx + 1)]
  next.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
  return { timeline: { ...(timeline as any), narration: next } as any, selectedNarrationId: right.id }
}
