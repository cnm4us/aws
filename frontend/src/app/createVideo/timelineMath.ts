import type { Clip } from './timelineTypes'

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

export function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

export function sumDur(clips: Clip[]): number {
  return clips.reduce((acc, c) => acc + Math.max(0, c.sourceEndSeconds - c.sourceStartSeconds), 0)
}

export function computeClipStarts(clips: Clip[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const c of clips) {
    out.push(acc)
    acc += Math.max(0, c.sourceEndSeconds - c.sourceStartSeconds)
  }
  return out
}

export function findClipIndexAtTime(t: number, clips: Clip[], clipStarts: number[]): number {
  const tt = Number(t)
  if (!Number.isFinite(tt) || tt < 0) return 0
  for (let i = 0; i < clips.length; i++) {
    const len = Math.max(0, clips[i].sourceEndSeconds - clips[i].sourceStartSeconds)
    const a = clipStarts[i] || 0
    const b = a + len
    if (tt >= a && tt < b) return i
  }
  return Math.max(0, clips.length - 1)
}

export function locate(t: number, clips: Clip[]): { clipIndex: number; within: number } {
  const starts = computeClipStarts(clips)
  for (let i = 0; i < clips.length; i++) {
    const len = Math.max(0, clips[i].sourceEndSeconds - clips[i].sourceStartSeconds)
    const a = starts[i]
    const b = a + len
    if (t >= a && t < b) return { clipIndex: i, within: t - a }
  }
  return { clipIndex: Math.max(0, clips.length - 1), within: 0 }
}

