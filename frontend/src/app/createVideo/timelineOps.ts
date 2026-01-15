import type { Clip, Timeline } from './timelineTypes'
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

