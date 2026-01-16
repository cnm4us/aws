import type { Clip } from './timelineTypes'

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

export function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

export function sumDur(clips: Clip[]): number {
  return clips.reduce((acc, c) => acc + clipDurationSeconds(c), 0)
}

export function clipSourceDurationSeconds(c: Clip): number {
  return Math.max(0, Number(c.sourceEndSeconds) - Number(c.sourceStartSeconds))
}

export function clipFreezeStartSeconds(c: Clip): number {
  const v = Number((c as any).freezeStartSeconds || 0)
  return Number.isFinite(v) ? Math.max(0, v) : 0
}

export function clipFreezeEndSeconds(c: Clip): number {
  const v = Number((c as any).freezeEndSeconds || 0)
  return Number.isFinite(v) ? Math.max(0, v) : 0
}

export function clipDurationSeconds(c: Clip): number {
  return roundToTenth(clipSourceDurationSeconds(c) + clipFreezeStartSeconds(c) + clipFreezeEndSeconds(c))
}

export function computeClipStarts(clips: Clip[]): number[] {
  const out: number[] = []
  let cursor = 0
  for (const c of clips) {
    const dur = clipDurationSeconds(c)
    const raw = (c as any).startSeconds
    const hasStart = raw != null && Number.isFinite(Number(raw))
    const start = hasStart ? roundToTenth(Math.max(0, Number(raw))) : roundToTenth(Math.max(0, cursor))
    out.push(start)
    cursor = Math.max(cursor, roundToTenth(start + dur))
  }
  return out
}

export function findClipIndexAtTime(t: number, clips: Clip[], clipStarts: number[]): number {
  const tt = Number(t)
  if (!Number.isFinite(tt) || tt < 0) return -1
  for (let i = 0; i < clips.length; i++) {
    const len = clipDurationSeconds(clips[i])
    const a = clipStarts[i] || 0
    const b = a + len
    if (tt >= a && tt < b) return i
  }
  return -1
}

export function locate(t: number, clips: Clip[]): { clipIndex: number; within: number } {
  const starts = computeClipStarts(clips)
  const idx = findClipIndexAtTime(t, clips, starts)
  if (idx < 0) return { clipIndex: -1, within: 0 }
  const a = starts[idx] || 0
  return { clipIndex: idx, within: Math.max(0, t - a) }
}

export function computeTimelineEndSecondsFromClips(clips: Clip[], clipStarts: number[]): number {
  let end = 0
  for (let i = 0; i < clips.length; i++) {
    const start = Number(clipStarts[i] || 0)
    const dur = clipDurationSeconds(clips[i])
    end = Math.max(end, roundToTenth(start + dur))
  }
  return roundToTenth(end)
}
