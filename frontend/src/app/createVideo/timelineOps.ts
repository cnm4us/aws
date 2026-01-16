import type { Clip, Graphic, Timeline } from './timelineTypes'
import { clamp, locate, roundToTenth, sumDur } from './timelineMath'

export function insertClipAtPlayhead(timeline: Timeline, clip: Clip): Timeline {
  const t = clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, sumDur(timeline.clips)))
  if (!timeline.clips.length) return { ...timeline, clips: [clip], playheadSeconds: 0 }

  const { clipIndex, within } = locate(t, timeline.clips)
  const insertIdx = within <= 0.05 ? clipIndex : clipIndex + 1
  const nextClips = [...timeline.clips.slice(0, insertIdx), clip, ...timeline.clips.slice(insertIdx)]
  return { ...timeline, clips: nextClips }
}

export function splitClipAtPlayhead(timeline: Timeline, selectedClipId: string | null): { timeline: Timeline; selectedClipId: string | null } {
  if (!selectedClipId) return { timeline, selectedClipId }
  const t = clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, sumDur(timeline.clips)))
  const { clipIndex, within } = locate(t, timeline.clips)
  const clip = timeline.clips[clipIndex]
  if (!clip || clip.id !== selectedClipId) return { timeline, selectedClipId }

  const cut = roundToTenth(clip.sourceStartSeconds + within)
  const minLen = 0.2
  if (cut <= clip.sourceStartSeconds + minLen || cut >= clip.sourceEndSeconds - minLen) return { timeline, selectedClipId }

  const left: Clip = { ...clip, id: `${clip.id}_a`, sourceEndSeconds: cut }
  const right: Clip = { ...clip, id: `${clip.id}_b`, sourceStartSeconds: cut }
  const idx = timeline.clips.findIndex((c) => c.id === clip.id)
  if (idx < 0) return { timeline, selectedClipId }
  const next = [...timeline.clips.slice(0, idx), left, right, ...timeline.clips.slice(idx + 1)]
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
