import { cloneTimeline } from './timelineTypes'
import type { Timeline } from './timelineTypes'
import { computeClipStarts, roundToTenth } from './timelineMath'

export function migrateLegacyClipFreezeTimeline(tl: Timeline): { timeline: Timeline; changed: boolean } {
  const clips: any[] = Array.isArray((tl as any).clips) ? (((tl as any).clips as any) as any[]) : []
  if (!clips.length) return { timeline: tl, changed: false }

  const starts = computeClipStarts(clips as any)
  const events: Array<{ t: number; delta: number }> = []
  for (let i = 0; i < clips.length; i++) {
    const c: any = clips[i]
    const fs = c?.freezeStartSeconds == null ? 0 : Number(c.freezeStartSeconds)
    const fe = c?.freezeEndSeconds == null ? 0 : Number(c.freezeEndSeconds)
    const delta = roundToTenth(Math.max(0, Number.isFinite(fs) ? fs : 0) + Math.max(0, Number.isFinite(fe) ? fe : 0))
    if (!(delta > 1e-6)) continue
    const startRaw = c?.startSeconds
    const start = startRaw != null && Number.isFinite(Number(startRaw)) ? roundToTenth(Math.max(0, Number(startRaw))) : roundToTenth(Number(starts[i] || 0))
    const srcStart = Number(c?.sourceStartSeconds || 0)
    const srcEnd = Number(c?.sourceEndSeconds || 0)
    const baseLen = roundToTenth(Math.max(0, srcEnd - srcStart))
    const legacyEnd = roundToTenth(start + baseLen + delta)
    events.push({ t: legacyEnd, delta })
  }
  if (!events.length) return { timeline: tl, changed: false }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta)
  const cumulative: Array<{ t: number; sum: number }> = []
  let sum = 0
  for (const e of events) {
    sum = roundToTenth(sum + e.delta)
    cumulative.push({ t: e.t, sum })
  }
  const shiftAt = (t: number): number => {
    const tt = roundToTenth(Math.max(0, Number(t || 0)))
    let s = 0
    for (const e of cumulative) {
      if (tt + 1e-6 >= e.t) s = e.sum
      else break
    }
    return s
  }
  const mapTime = (t: any): any => {
    const n = Number(t)
    if (!Number.isFinite(n)) return t
    const tt = roundToTenth(Math.max(0, n))
    return roundToTenth(Math.max(0, tt - shiftAt(tt)))
  }

  const mapRange = (x: any) => ({
    ...x,
    startSeconds: mapTime(x?.startSeconds),
    endSeconds: mapTime(x?.endSeconds),
  })

  const next: any = cloneTimeline(tl as any)
  next.playheadSeconds = mapTime((tl as any).playheadSeconds || 0)
  next.clips = clips.map((c: any, i: number) => ({
    ...c,
    startSeconds: mapTime(c?.startSeconds == null ? starts[i] : c.startSeconds),
    freezeStartSeconds: 0,
    freezeEndSeconds: 0,
  }))
  next.stills = Array.isArray((tl as any).stills) ? ((tl as any).stills as any[]).map(mapRange) : []
  next.graphics = Array.isArray((tl as any).graphics) ? ((tl as any).graphics as any[]).map(mapRange) : []
  next.guidelines = Array.isArray((tl as any).guidelines) ? ((tl as any).guidelines as any[]).map(mapTime) : []
  next.logos = Array.isArray((tl as any).logos) ? ((tl as any).logos as any[]).map(mapRange) : []
  next.lowerThirds = Array.isArray((tl as any).lowerThirds) ? ((tl as any).lowerThirds as any[]).map(mapRange) : []
  next.screenTitles = Array.isArray((tl as any).screenTitles) ? ((tl as any).screenTitles as any[]).map(mapRange) : []
  next.narration = Array.isArray((tl as any).narration) ? ((tl as any).narration as any[]).map(mapRange) : []
  next.audioSegments = Array.isArray((tl as any).audioSegments) ? ((tl as any).audioSegments as any[]).map(mapRange) : []
  // Migrate legacy single-track audio into audioSegments.
  if (!next.audioSegments.length && (tl as any).audioTrack && typeof (tl as any).audioTrack === 'object') {
    const at: any = (tl as any).audioTrack
    next.audioSegments = [
      {
        id: 'audio_track_legacy',
        uploadId: Number(at.uploadId),
        audioConfigId: Number(at.audioConfigId),
        startSeconds: mapTime(at.startSeconds),
        endSeconds: mapTime(at.endSeconds),
        sourceStartSeconds: 0,
      },
    ]
  }
  next.audioTrack = null
  return { timeline: next as Timeline, changed: true }
}

export function migrateLegacyAudioTrackToSegments(tl: Timeline): { timeline: Timeline; changed: boolean } {
  const rawSegments = (tl as any).audioSegments
  const hasSegments = Array.isArray(rawSegments) && rawSegments.length
  const hasTrack = (tl as any).audioTrack && typeof (tl as any).audioTrack === 'object'
  if (!hasSegments && !hasTrack) return { timeline: tl, changed: false }

  const next: any = cloneTimeline(tl as any)
  let changed = false

  if (!Array.isArray((next as any).audioSegments)) (next as any).audioSegments = []

  if (!(next as any).audioSegments.length && hasTrack) {
    const at: any = (tl as any).audioTrack
    ;(next as any).audioSegments = [
      {
        id: 'audio_track_legacy',
        uploadId: Number(at.uploadId),
        audioConfigId: Number(at.audioConfigId),
        startSeconds: roundToTenth(Math.max(0, Number(at.startSeconds || 0))),
        endSeconds: roundToTenth(Math.max(0, Number(at.endSeconds || 0))),
        sourceStartSeconds: 0,
      },
    ]
    changed = true
  }

  // Normalize segment fields.
  ;(next as any).audioSegments = ((next as any).audioSegments as any[]).map((s: any, i: number) => {
    const id = String(s?.id || '') || `aud_legacy_${i + 1}`
    if (id !== String(s?.id || '')) changed = true
    const out = {
      ...s,
      id,
      uploadId: Number(s?.uploadId),
      audioConfigId: Number(s?.audioConfigId),
      startSeconds: roundToTenth(Math.max(0, Number(s?.startSeconds || 0))),
      endSeconds: roundToTenth(Math.max(0, Number(s?.endSeconds || 0))),
      sourceStartSeconds: s?.sourceStartSeconds == null ? 0 : roundToTenth(Math.max(0, Number(s?.sourceStartSeconds || 0))),
    }
    return out
  })

  if ((tl as any).audioTrack != null) changed = true
  next.audioTrack = null
  return { timeline: changed ? (next as Timeline) : tl, changed }
}

