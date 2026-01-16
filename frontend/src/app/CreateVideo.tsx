import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUploadCdnUrl } from '../ui/uploadsCdn'
import type { AudioTrack, Clip, Graphic, Timeline } from './createVideo/timelineTypes'
import { cloneTimeline } from './createVideo/timelineTypes'
import { clamp, computeClipStarts, findClipIndexAtTime, locate, roundToTenth, sumDur } from './createVideo/timelineMath'
import { insertClipAtPlayhead, splitClipAtPlayhead } from './createVideo/timelineOps'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type UploadListItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  description: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  status: string
  kind?: string
  created_at: string
}

type UploadSummary = { id: number; original_filename: string; modified_filename: string | null; duration_seconds?: number | null }

type Project = {
  id: number
  status: string
  timeline: Timeline
  lastExportJobId?: number | null
  lastExportUploadId?: number | null
}

type SystemAudioItem = UploadListItem & {
  artist?: string | null
}

type AudioConfigItem = {
  id: number
  name: string
  mode: string
  duckingMode?: string
}

type AddStep = 'type' | 'video' | 'graphic' | 'audio'

async function ensureLoggedIn(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    const data = (await res.json()) as MeResponse
    if (!data || !data.userId) return null
    return data
  } catch {
    return null
  }
}

function getCsrfToken(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const raw = String(text || '')
  if (!raw) return ''
  if (ctx.measureText(raw).width <= maxWidth) return raw
  const ell = '…'
  const ellW = ctx.measureText(ell).width
  const target = Math.max(0, maxWidth - ellW)
  if (target <= 0) return ell
  let lo = 0
  let hi = raw.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const s = raw.slice(0, mid)
    if (ctx.measureText(s).width <= target) lo = mid
    else hi = mid - 1
  }
  return raw.slice(0, Math.max(0, lo)) + ell
}

export default function CreateVideo() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [timeline, setTimeline] = useState<Timeline>({ version: 'create_video_v1', playheadSeconds: 0, clips: [], graphics: [], audioTrack: null })
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null)
  const [selectedAudio, setSelectedAudio] = useState(false)
  const [namesByUploadId, setNamesByUploadId] = useState<Record<number, string>>({})
  const [durationsByUploadId, setDurationsByUploadId] = useState<Record<number, number>>({})
  const [pickOpen, setPickOpen] = useState(false)
  const [addStep, setAddStep] = useState<AddStep>('type')
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerItems, setPickerItems] = useState<UploadListItem[]>([])
  const [clipEditor, setClipEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [clipEditorError, setClipEditorError] = useState<string | null>(null)
  const [graphicPickerLoading, setGraphicPickerLoading] = useState(false)
  const [graphicPickerError, setGraphicPickerError] = useState<string | null>(null)
  const [graphicPickerItems, setGraphicPickerItems] = useState<UploadListItem[]>([])
  const [graphicEditor, setGraphicEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [graphicEditorError, setGraphicEditorError] = useState<string | null>(null)
  const [audioPickerLoading, setAudioPickerLoading] = useState(false)
  const [audioPickerError, setAudioPickerError] = useState<string | null>(null)
  const [audioPickerItems, setAudioPickerItems] = useState<SystemAudioItem[]>([])
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [audioPreviewPlayingId, setAudioPreviewPlayingId] = useState<number | null>(null)
  const [audioConfigs, setAudioConfigs] = useState<AudioConfigItem[]>([])
  const [audioConfigsLoaded, setAudioConfigsLoaded] = useState(false)
  const [audioConfigsError, setAudioConfigsError] = useState<string | null>(null)
  const [audioEditor, setAudioEditor] = useState<{ start: number; end: number; audioConfigId: number } | null>(null)
  const [audioEditorError, setAudioEditorError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [previewObjectFit, setPreviewObjectFit] = useState<'cover' | 'contain'>('cover')
  const [playing, setPlaying] = useState(false)
  const [activeUploadId, setActiveUploadId] = useState<number | null>(null)
  const playheadRef = useRef(0)
  const activeClipIndexRef = useRef(0)
  const playheadFromVideoRef = useRef(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const undoStackRef = useRef<Array<{ timeline: Timeline; selectedClipId: string | null; selectedGraphicId: string | null; selectedAudio: boolean }>>([])
  const [undoDepth, setUndoDepth] = useState(0)
  const lastSavedRef = useRef<string>('')
  const hydratingRef = useRef(false)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const [timelineScrollEl, setTimelineScrollEl] = useState<HTMLDivElement | null>(null)
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [timelinePadPx, setTimelinePadPx] = useState(0)
  const playheadFromScrollRef = useRef(false)
  const ignoreScrollRef = useRef(false)
  const [timelineScrollLeftPx, setTimelineScrollLeftPx] = useState(0)
  const primedFrameSrcRef = useRef<string>('')
  const [posterByUploadId, setPosterByUploadId] = useState<Record<number, string>>({})
  const [graphicFileUrlByUploadId, setGraphicFileUrlByUploadId] = useState<Record<number, string>>({})
  const [audioEnvelopeByUploadId, setAudioEnvelopeByUploadId] = useState<Record<number, any>>({})
  const [audioEnvelopeStatusByUploadId, setAudioEnvelopeStatusByUploadId] = useState<Record<number, 'idle' | 'pending' | 'ready' | 'error'>>({})
  const [audioEnvelopeErrorByUploadId, setAudioEnvelopeErrorByUploadId] = useState<Record<number, string>>({})
  const audioEnvelopePollTimerRef = useRef<Record<number, number>>({})
  const activePoster = useMemo(() => {
    if (!activeUploadId) return null
    return posterByUploadId[activeUploadId] || null
  }, [activeUploadId, posterByUploadId])

  const nudgeRepeatRef = useRef<{ timeout: number | null; interval: number | null; deltaSeconds: number; fired: boolean } | null>(null)
  const suppressNextNudgeClickRef = useRef(false)

  const trimDragRef = useRef<
    | {
        kind: 'clip'
        clipId: string
        edge: 'start' | 'end'
        pointerId: number
        startClientX: number
        startStartSeconds: number
        startEndSeconds: number
        maxDurationSeconds: number
      }
    | {
        kind: 'graphic'
        graphicId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startStartSeconds: number
        startEndSeconds: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
      }
    | {
        kind: 'audio'
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startStartSeconds: number
        startEndSeconds: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
      }
    | null
  >(null)
  const [trimDragging, setTrimDragging] = useState(false)
  const trimDragLockScrollLeftRef = useRef<number | null>(null)
  const trimDragScrollRestoreRef = useRef<{
    overflowX: string
    webkitOverflowScrolling: string
    overscrollBehaviorX: string
  } | null>(null)

  const panDragRef = useRef<{ pointerId: number; startClientX: number; startScrollLeft: number } | null>(null)
  const [panDragging, setPanDragging] = useState(false)

  const primePausedFrame = useCallback(async (v: HTMLVideoElement) => {
    try {
      if (!v.paused) return
      const prevMuted = v.muted
      v.muted = true
      const p = v.play()
      if (p && typeof (p as any).then === 'function') {
        await p.catch(() => {})
      }
      await new Promise((r) => window.setTimeout(r, 80))
      try { v.pause() } catch {}
      v.muted = prevMuted
    } catch {
      try { v.pause() } catch {}
    }
  }, [])

  const totalSecondsVideo = useMemo(() => sumDur(timeline.clips), [timeline.clips])
  const totalSecondsGraphics = useMemo(() => {
    const gs = Array.isArray((timeline as any).graphics) ? (timeline as any).graphics as Graphic[] : []
    let m = 0
    for (const g of gs) {
      const e = Number((g as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    return Math.max(0, roundToTenth(m))
  }, [timeline])
  const totalSeconds = useMemo(() => (timeline.clips.length ? totalSecondsVideo : totalSecondsGraphics), [timeline.clips.length, totalSecondsGraphics, totalSecondsVideo])
  const clipStarts = useMemo(() => computeClipStarts(timeline.clips), [timeline.clips])
  const playhead = useMemo(() => clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, totalSeconds)), [timeline.playheadSeconds, totalSeconds])
  const pxPerSecond = 48
  const dragNoRipple = useMemo(() => {
    const drag = trimDragRef.current
    if (!trimDragging || !drag || drag.kind !== 'clip' || drag.edge !== 'start') return { idx: -1, deltaSeconds: 0 }
    const idx = timeline.clips.findIndex((c) => c.id === drag.clipId)
    if (idx < 0) return { idx: -1, deltaSeconds: 0 }
    const clip = timeline.clips[idx]
    const deltaSeconds = clamp(roundToTenth(Number(clip.sourceStartSeconds) - Number(drag.startStartSeconds)), -36000, 36000)
    if (Math.abs(deltaSeconds) < 0.05) return { idx: -1, deltaSeconds: 0 }
    return { idx, deltaSeconds }
  }, [trimDragging, timeline.clips])
  const visualTotalSeconds = useMemo(() => Math.max(0, totalSeconds + dragNoRipple.deltaSeconds), [dragNoRipple.deltaSeconds, totalSeconds])
  const stripContentW = useMemo(() => Math.max(0, Math.ceil(visualTotalSeconds * pxPerSecond)), [pxPerSecond, visualTotalSeconds])
  const RULER_H = 16
  const WAVEFORM_H = 34
  const TRACK_H = 48
  const TRACKS_TOP = RULER_H + WAVEFORM_H
  const GRAPHICS_Y = TRACKS_TOP + 6
  const VIDEO_Y = TRACKS_TOP + TRACK_H + 6
  const AUDIO_Y = TRACKS_TOP + TRACK_H * 2 + 6
  const PILL_H = Math.max(18, TRACK_H - 12)
  const HANDLE_HIT_PX = 12
  const TIMELINE_H = TRACKS_TOP + TRACK_H * 3

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null
    return timeline.clips.find((c) => c.id === selectedClipId) || null
  }, [selectedClipId, timeline.clips])
  const selectedClipIndex = useMemo(() => {
    if (!selectedClipId) return -1
    return timeline.clips.findIndex((c) => c.id === selectedClipId)
  }, [selectedClipId, timeline.clips])

  const graphics = useMemo(() => (Array.isArray((timeline as any).graphics) ? ((timeline as any).graphics as Graphic[]) : []), [timeline])
  const selectedGraphic = useMemo(() => {
    if (!selectedGraphicId) return null
    return graphics.find((g) => g.id === selectedGraphicId) || null
  }, [graphics, selectedGraphicId])

  const audioTrack: AudioTrack | null = useMemo(() => {
    const raw = (timeline as any).audioTrack
    if (!raw || typeof raw !== 'object') return null
    const uploadId = Number((raw as any).uploadId)
    const audioConfigId = Number((raw as any).audioConfigId)
    const startSeconds = Number((raw as any).startSeconds ?? 0)
    const endSeconds = Number((raw as any).endSeconds ?? 0)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return null
    if (!Number.isFinite(audioConfigId) || audioConfigId <= 0) return null
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !(endSeconds > startSeconds)) return null
    return {
      uploadId,
      audioConfigId,
      startSeconds: roundToTenth(Math.max(0, startSeconds)),
      endSeconds: roundToTenth(Math.max(0, endSeconds)),
    }
  }, [timeline])

  const audioConfigNameById = useMemo(() => {
    const map: Record<number, string> = {}
    for (const c of audioConfigs) {
      const id = Number((c as any).id)
      if (!Number.isFinite(id) || id <= 0) continue
      map[id] = String((c as any).name || '')
    }
    return map
  }, [audioConfigs])

  const timelinePanLocked = (Boolean(selectedClipId) || Boolean(selectedGraphicId) || selectedAudio) && !playing && !trimDragging

  const canUndo = undoDepth > 0

  const boundaries = useMemo(() => {
    const out: number[] = []
    out.push(0)
    for (let i = 0; i < timeline.clips.length; i++) {
      const start = roundToTenth(clipStarts[i] || 0)
      const len = Math.max(0, Number(timeline.clips[i].sourceEndSeconds) - Number(timeline.clips[i].sourceStartSeconds))
      const end = roundToTenth(start + len)
      out.push(start, end)
    }
    for (const g of graphics) {
      const s = roundToTenth(Number((g as any).startSeconds || 0))
      const e = roundToTenth(Number((g as any).endSeconds || 0))
      if (e > s) out.push(s, e)
    }
    if (audioTrack) {
      const s = roundToTenth(Number(audioTrack.startSeconds || 0))
      const e = roundToTenth(Number(audioTrack.endSeconds || 0))
      if (e > s) out.push(s, e)
    }
    out.push(roundToTenth(totalSeconds))
    const uniq = new Map<string, number>()
    for (const t of out) {
      const tt = roundToTenth(Number(t) || 0)
      uniq.set(tt.toFixed(1), tt)
    }
    return Array.from(uniq.values()).sort((a, b) => a - b)
  }, [audioTrack, clipStarts, graphics, timeline.clips, totalSeconds])

  const nudgePlayhead = useCallback((deltaSeconds: number) => {
    setTimeline((prev) => {
      const total = prev.clips.length
        ? sumDur(prev.clips)
        : Math.max(
            0,
            roundToTenth(
              (Array.isArray((prev as any).graphics) ? (prev as any).graphics : []).reduce((m: number, gg: any) => {
                const e = Number(gg?.endSeconds)
                return Number.isFinite(e) && e > m ? e : m
              }, 0)
            )
          )
      const next = clamp(roundToTenth(Number(prev.playheadSeconds || 0) + deltaSeconds), 0, Math.max(0, total))
      return { ...prev, playheadSeconds: next }
    })
  }, [])

  const jumpPrevBoundary = useCallback(() => {
    const eps = 0.05
    const target = [...boundaries].reverse().find((t) => t < playhead - eps)
    if (target == null) return
    nudgePlayhead(target - playhead)
  }, [boundaries, nudgePlayhead, playhead])

  const jumpNextBoundary = useCallback(() => {
    const eps = 0.05
    const target = boundaries.find((t) => t > playhead + eps)
    if (target == null) return
    nudgePlayhead(target - playhead)
  }, [boundaries, nudgePlayhead, playhead])

  const canJumpPrev = useMemo(() => boundaries.some((t) => t < playhead - 0.05), [boundaries, playhead])
  const canJumpNext = useMemo(() => boundaries.some((t) => t > playhead + 0.05), [boundaries, playhead])

  const stopNudgeRepeat = useCallback(() => {
    const t = nudgeRepeatRef.current
    if (!t) return
    if (t.timeout != null) window.clearTimeout(t.timeout)
    if (t.interval != null) window.clearInterval(t.interval)
    nudgeRepeatRef.current = null
  }, [])

  const startNudgeRepeat = useCallback((deltaSeconds: number) => {
    stopNudgeRepeat()
    const HOLD_MS = 420
    const timeout = window.setTimeout(() => {
      const cur = nudgeRepeatRef.current
      if (!cur) return
      cur.fired = true
      // Start repeating nudges after the hold threshold.
      nudgePlayhead(deltaSeconds)
      const interval = window.setInterval(() => {
        nudgePlayhead(deltaSeconds)
      }, 55)
      nudgeRepeatRef.current = { timeout: null, interval, deltaSeconds, fired: true }
    }, HOLD_MS)
    nudgeRepeatRef.current = { timeout, interval: null, deltaSeconds, fired: false }
  }, [nudgePlayhead, stopNudgeRepeat])

  const finishNudgePress = useCallback((deltaSeconds: number) => {
    const cur = nudgeRepeatRef.current
    // If the hold timer never fired, treat as a normal single nudge.
    if (cur && cur.deltaSeconds === deltaSeconds && !cur.fired) {
      nudgePlayhead(deltaSeconds)
    }
    suppressNextNudgeClickRef.current = true
    stopNudgeRepeat()
  }, [nudgePlayhead, stopNudgeRepeat])

  const findGraphicAtTime = useCallback((t: number): Graphic | null => {
    const tt = Number(t)
    if (!Number.isFinite(tt) || tt < 0) return null
    for (const g of graphics) {
      const s = Number((g as any).startSeconds)
      const e = Number((g as any).endSeconds)
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue
      if (tt >= s && tt < e) return g
    }
    return null
  }, [graphics])

  const activeGraphicAtPlayhead = useMemo(() => findGraphicAtTime(playhead), [findGraphicAtTime, playhead])
  const activeGraphicUploadId = useMemo(() => {
    const g = activeGraphicAtPlayhead
    if (!g) return null
    const id = Number((g as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [activeGraphicAtPlayhead])
  const activeGraphicUrl = useMemo(() => {
    if (!activeGraphicUploadId) return null
    return graphicFileUrlByUploadId[activeGraphicUploadId] || `/api/uploads/${encodeURIComponent(String(activeGraphicUploadId))}/file`
  }, [activeGraphicUploadId, graphicFileUrlByUploadId])

  const ensureAudioEnvelope = useCallback(async (uploadId: number) => {
    const id = Number(uploadId)
    if (!Number.isFinite(id) || id <= 0) return
    if (audioEnvelopeByUploadId[id]) return
    const status = audioEnvelopeStatusByUploadId[id]
    if (status === 'pending') return

    setAudioEnvelopeStatusByUploadId((prev) => ({ ...prev, [id]: 'pending' }))
    setAudioEnvelopeErrorByUploadId((prev) => ({ ...prev, [id]: '' }))
    try {
      const res = await fetch(`/api/uploads/${encodeURIComponent(String(id))}/audio-envelope`, { credentials: 'same-origin' })
      if (res.status === 202) {
        const t = window.setTimeout(() => {
          delete audioEnvelopePollTimerRef.current[id]
          ensureAudioEnvelope(id).catch(() => {})
        }, 2000)
        audioEnvelopePollTimerRef.current[id] = t
        return
      }
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      setAudioEnvelopeByUploadId((prev) => ({ ...prev, [id]: json }))
      setAudioEnvelopeStatusByUploadId((prev) => ({ ...prev, [id]: 'ready' }))
    } catch (e: any) {
      setAudioEnvelopeStatusByUploadId((prev) => ({ ...prev, [id]: 'error' }))
      setAudioEnvelopeErrorByUploadId((prev) => ({ ...prev, [id]: e?.message || 'failed_to_load' }))
    }
  }, [audioEnvelopeByUploadId, audioEnvelopeStatusByUploadId])

  useEffect(() => {
    if (selectedClipIndex < 0) return
    const clip = timeline.clips[selectedClipIndex]
    if (!clip) return
    const uploadId = Number(clip.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    ensureAudioEnvelope(uploadId).catch(() => {})
  }, [ensureAudioEnvelope, selectedClipIndex, timeline.clips])

  useEffect(() => {
    return () => {
      const timers = audioEnvelopePollTimerRef.current
      for (const k of Object.keys(timers)) {
        const id = Number(k)
        const t = timers[id]
        if (t != null) window.clearTimeout(t)
      }
      audioEnvelopePollTimerRef.current = {}
    }
  }, [])

  const toggleAudioPreview = useCallback(
    async (uploadId: number) => {
      const id = Number(uploadId)
      if (!Number.isFinite(id) || id <= 0) return
      try {
        let player = audioPreviewRef.current
        if (!player) {
          player = new Audio()
          player.preload = 'none'
          player.crossOrigin = 'anonymous'
          audioPreviewRef.current = player
        }

        const isSame = audioPreviewPlayingId === id
        if (isSame) {
          player.pause()
          setAudioPreviewPlayingId(null)
          return
        }

        try {
          player.pause()
          player.removeAttribute('src')
          player.load()
        } catch {}

        const url = (await getUploadCdnUrl(id, { kind: 'file' })) || `/api/uploads/${encodeURIComponent(String(id))}/file`
        player.src = url
        player.currentTime = 0
        try {
          const p = player.play()
          if (p && typeof (p as any).then === 'function') await p.catch(() => {})
        } catch {}
        setAudioPreviewPlayingId(id)
        player.onended = () => {
          setAudioPreviewPlayingId((prev) => (prev === id ? null : prev))
        }
      } catch {
        setAudioPreviewPlayingId(null)
      }
    },
    [audioPreviewPlayingId]
  )

  useEffect(() => {
    playheadRef.current = playhead
  }, [playhead])

  const prevTotalSecondsRef = useRef<number>(0)
  useEffect(() => {
    const prevTotal = Number(prevTotalSecondsRef.current || 0)
    prevTotalSecondsRef.current = totalSeconds
    if (!audioTrack) return
    const nextTotal = Math.max(0, roundToTenth(totalSeconds))
    if (!(nextTotal > 0)) return

    const curStart = roundToTenth(Number(audioTrack.startSeconds || 0))
    const curEnd = roundToTenth(Number(audioTrack.endSeconds || 0))
    const shouldExtendToEnd = prevTotal > 0 && curEnd >= prevTotal - 0.2 && nextTotal > prevTotal + 1e-6
    const nextEnd = shouldExtendToEnd ? nextTotal : Math.min(curEnd, nextTotal)
    const nextStart = Math.min(curStart, nextEnd - 0.2)
    if (Math.abs(nextStart - curStart) < 0.05 && Math.abs(nextEnd - curEnd) < 0.05) return
    setTimeline((prev) => {
      const at = (prev as any).audioTrack
      if (!at || typeof at !== 'object') return prev
      return { ...prev, audioTrack: { ...(at as any), startSeconds: nextStart, endSeconds: nextEnd } }
    })
  }, [audioTrack, totalSeconds])

  useEffect(() => {
    const onUp = () => stopNudgeRepeat()
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [stopNudgeRepeat])

  const snapshotUndo = useCallback(() => {
    const stack = undoStackRef.current
    const snapshot = { timeline: cloneTimeline(timeline), selectedClipId, selectedGraphicId, selectedAudio }
    stack.push(snapshot)
    // Cap memory and keep behavior predictable.
    if (stack.length > 50) stack.splice(0, stack.length - 50)
    setUndoDepth(stack.length)
  }, [selectedAudio, selectedClipId, selectedGraphicId, timeline])

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    const snap = stack.pop()
    if (!snap) return
    setUndoDepth(stack.length)
    hydratingRef.current = true
    try {
      setTimeline(snap.timeline)
      setSelectedClipId(snap.selectedClipId)
      setSelectedGraphicId(snap.selectedGraphicId)
      setSelectedAudio(Boolean(snap.selectedAudio))
    } finally {
      hydratingRef.current = false
    }
  }, [])

  // Timeline padding so t=0 and t=end can align under the centered playhead line.
  useEffect(() => {
    const el = timelineScrollEl || timelineScrollRef.current
    if (!el) return
    let ro: ResizeObserver | null = null
    const update = (width: number) => {
      const w = Math.max(0, Math.round(width || 0))
      setTimelinePadPx(Math.floor(w / 2))
    }
    try {
      ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          if (e.target !== el) continue
          update(e.contentRect?.width || el.clientWidth || 0)
        }
      })
      ro.observe(el)
      update(el.clientWidth || 0)
    } catch {
      // Fallback if ResizeObserver is unavailable.
      const onResize = () => update(el.clientWidth || 0)
      window.addEventListener('resize', onResize)
      update(el.clientWidth || 0)
      return () => window.removeEventListener('resize', onResize)
    }
    return () => {
      try { ro?.disconnect() } catch {}
    }
  }, [timelineScrollEl])

  const drawTimeline = useCallback(() => {
    const canvas = timelineCanvasRef.current
    const sc = timelineScrollRef.current
    if (!canvas || !sc) return
    const wCss = Math.max(0, Math.round(sc.clientWidth || 0))
    const rulerH = RULER_H
    const waveformH = WAVEFORM_H
    const trackH = TRACK_H
    const hCss = TIMELINE_H
    const dpr = Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100)
    canvas.width = Math.max(1, Math.floor(wCss * dpr))
    canvas.height = Math.max(1, Math.floor(hCss * dpr))
    canvas.style.width = `${wCss}px`
    canvas.style.height = `${hCss}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, hCss)

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, wCss, rulerH)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, rulerH, wCss, waveformH)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, rulerH + waveformH, wCss, trackH)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, rulerH + waveformH + trackH, wCss, trackH)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, rulerH + waveformH + trackH * 2, wCss, trackH)

    // Ticks (0.1s minor, 1.0s major, 5.0s extra-major)
    const scrollLeft = Math.max(0, Number(timelineScrollLeftPx) || 0)
    const padPx = timelinePadPx || Math.floor(wCss / 2)
    const totalForTicks = Math.max(0, Number(visualTotalSeconds) || 0)
    const startT = clamp((scrollLeft - padPx) / pxPerSecond, 0, totalForTicks)
    const endT = clamp((scrollLeft - padPx + wCss) / pxPerSecond, 0, totalForTicks)
    const eps = 1e-6
    const firstTenth = Math.max(0, Math.floor(startT * 10) / 10)
    const lastTenth = Math.ceil(endT * 10) / 10
    const count = Math.max(0, Math.round((lastTenth - firstTenth) * 10) + 1)
    for (let i = 0; i <= count; i++) {
      const t = firstTenth + i * 0.1
      if (t < startT - 0.2) continue
      if (t > endT + 0.2) break
      const x = padPx + t * pxPerSecond - scrollLeft
      if (x < -2 || x > wCss + 2) continue

      const isOne = Math.abs(t - Math.round(t)) < eps
      const isFive = isOne && (Math.round(t) % 5 === 0)
      ctx.strokeStyle = isFive
        ? 'rgba(255,255,255,0.62)'
        : isOne
          ? 'rgba(255,255,255,0.46)'
          : 'rgba(255,255,255,0.28)'
      ctx.lineWidth = 1
      const tickLen = isFive ? 14 : isOne ? 10 : 6
      ctx.beginPath()
      ctx.moveTo(x + 0.5, rulerH - tickLen)
      ctx.lineTo(x + 0.5, rulerH)
      ctx.stroke()

      // Optional faint guide line down into the track for 1s/5s marks.
      if (isOne) {
        ctx.strokeStyle = isFive ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.moveTo(x + 0.5, rulerH)
        ctx.lineTo(x + 0.5, hCss)
        ctx.stroke()
      }
    }

    // Waveform (selected clip only)
    const waveformTop = rulerH + 2
    const waveformBottom = rulerH + waveformH - 2
    const waveformHeight = Math.max(4, waveformBottom - waveformTop)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, waveformBottom + 0.5)
    ctx.lineTo(wCss, waveformBottom + 0.5)
    ctx.stroke()

    const clipIdx = selectedClipIndex
    const clip = clipIdx >= 0 ? timeline.clips[clipIdx] : null
    if (!clip) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = '700 12px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText('Select a clip to see waveform', 10, rulerH + waveformH / 2)
    } else {
      const uploadId = Number(clip.uploadId)
      const env = uploadId > 0 ? audioEnvelopeByUploadId[uploadId] : null
      const envStatus = uploadId > 0 ? (audioEnvelopeStatusByUploadId[uploadId] || 'idle') : 'idle'
      const clipStartT = roundToTenth(clipStarts[clipIdx] || 0) + (dragNoRipple.idx >= 0 && clipIdx >= dragNoRipple.idx ? dragNoRipple.deltaSeconds : 0)
      const sourceStart = Number(clip.sourceStartSeconds || 0)
      const sourceEnd = Number(clip.sourceEndSeconds || 0)
      const hasAudio = env && typeof env === 'object' ? Boolean((env as any).hasAudio) : false
      const points = env && typeof env === 'object' && Array.isArray((env as any).points) ? ((env as any).points as any[]) : []

      if (envStatus === 'pending' || envStatus === 'idle') {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.font = '700 12px system-ui, -apple-system, Segoe UI, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText('Waveform loading…', 10, rulerH + waveformH / 2)
      } else if (envStatus === 'error') {
        ctx.fillStyle = 'rgba(255,155,155,0.92)'
        ctx.font = '700 12px system-ui, -apple-system, Segoe UI, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText('Waveform unavailable', 10, rulerH + waveformH / 2)
      } else if (!hasAudio || !points.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.font = '700 12px system-ui, -apple-system, Segoe UI, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText('No audio', 10, rulerH + waveformH / 2)
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.82)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        let started = false
        for (const p of points) {
          const tSrc = Number((p as any).t)
          const vRaw = Number((p as any).v)
          if (!Number.isFinite(tSrc) || !Number.isFinite(vRaw)) continue
          if (tSrc < sourceStart - 1e-6) continue
          if (tSrc > sourceEnd + 1e-6) break
          const rel = tSrc - sourceStart
          const tComp = clipStartT + rel
          const x = padPx + tComp * pxPerSecond - scrollLeft
          if (x < -4 || x > wCss + 4) continue
          const v = clamp(vRaw, 0, 1)
          const y = waveformBottom - v * (waveformHeight - 2)
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else {
            ctx.lineTo(x, y)
          }
        }
        if (started) ctx.stroke()
      }
    }

    // Graphics + clip pills
    const graphicsY = GRAPHICS_Y
    const videoY = VIDEO_Y
    const audioY = AUDIO_Y
    const pillH = PILL_H
    ctx.font = '900 12px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.textBaseline = 'middle'

    for (let i = 0; i < graphics.length; i++) {
      const g = graphics[i]
      const start = Math.max(0, Number((g as any).startSeconds || 0))
      const end = Math.max(0, Number((g as any).endSeconds || 0))
      const len = Math.max(0, end - start)
      if (len <= 0) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = g.id === selectedGraphicId

      ctx.fillStyle = 'rgba(10,132,255,0.18)'
      roundRect(ctx, x, graphicsY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.92)' : 'rgba(10,132,255,0.55)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, graphicsY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      const name = namesByUploadId[g.uploadId] || `Image ${g.uploadId}`
      ctx.fillStyle = '#fff'
      const padLeft = 12
      const padRight = 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, graphicsY + pillH / 2)
      }

      if (isSelected && w >= 20) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        const hw = 3
        const hh = pillH - 10
        const hy = graphicsY + 5
        ctx.fillRect(x + 6, hy, hw, hh)
        ctx.fillRect(x + w - 6 - hw, hy, hw, hh)
      }
    }
    for (let i = 0; i < timeline.clips.length; i++) {
      const clip = timeline.clips[i]
      const start = (clipStarts[i] || 0) + (dragNoRipple.idx >= 0 && i >= dragNoRipple.idx ? dragNoRipple.deltaSeconds : 0)
      const len = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = clip.id === selectedClipId

      // pill background
      ctx.fillStyle = 'rgba(212,175,55,0.28)'
      roundRect(ctx, x, videoY, w, pillH, 10)
      ctx.fill()

      // pill border
      ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.92)' : 'rgba(212,175,55,0.65)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, videoY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      const name = namesByUploadId[clip.uploadId] || `Video ${clip.uploadId}`
      ctx.fillStyle = '#fff'
      const padLeft = isSelected ? 18 : 12
      const padRight = 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, videoY + pillH / 2)
      }

      if (isSelected && w >= 20) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        const hw = 3
        const hh = pillH - 10
        const hy = videoY + 5
        ctx.fillRect(x + 6, hy, hw, hh)
        ctx.fillRect(x + w - 6 - hw, hy, hw, hh)
      }
    }

    if (audioTrack) {
      const start = clamp(Number(audioTrack.startSeconds || 0), 0, Math.max(0, totalSeconds))
      const end = clamp(Number(audioTrack.endSeconds || 0), 0, Math.max(0, totalSeconds))
      const len = Math.max(0, end - start)
      if (len > 0.01) {
        const x = padPx + start * pxPerSecond - scrollLeft
        const w = Math.max(8, len * pxPerSecond)
        if (!(x > wCss + 4 || x + w < -4)) {
          const isSelected = Boolean(selectedAudio)
          ctx.fillStyle = 'rgba(48,209,88,0.18)'
          roundRect(ctx, x, audioY, w, pillH, 10)
          ctx.fill()

          ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.92)' : 'rgba(48,209,88,0.55)'
          ctx.lineWidth = 1
          roundRect(ctx, x + 0.5, audioY + 0.5, w - 1, pillH - 1, 10)
          ctx.stroke()

          const audioName = namesByUploadId[audioTrack.uploadId] || `Audio ${audioTrack.uploadId}`
          const cfgName = audioConfigNameById[audioTrack.audioConfigId] || `Config ${audioTrack.audioConfigId}`
          const label = `${audioName} • ${cfgName}`
          ctx.fillStyle = '#fff'
          const padLeft = 12
          const padRight = 12
          const maxTextW = Math.max(0, w - padLeft - padRight)
          if (maxTextW >= 20) {
            const clipped = ellipsizeText(ctx, label, maxTextW)
            ctx.fillText(clipped, x + padLeft, audioY + pillH / 2)
          }

          if (isSelected && w >= 20) {
            ctx.fillStyle = 'rgba(255,255,255,0.85)'
            const hw = 3
            const hh = pillH - 10
            const hy = audioY + 5
            ctx.fillRect(x + 6, hy, hw, hh)
            ctx.fillRect(x + w - 6 - hw, hy, hw, hh)
          }
        }
      }
    }
  }, [
    audioEnvelopeByUploadId,
    audioEnvelopeStatusByUploadId,
    audioConfigNameById,
    audioTrack,
    clipStarts,
    dragNoRipple.deltaSeconds,
    dragNoRipple.idx,
    graphics,
    namesByUploadId,
    pxPerSecond,
    selectedAudio,
    selectedClipId,
    selectedClipIndex,
    selectedGraphicId,
    timeline.clips,
    timelinePadPx,
    timelineScrollLeftPx,
    totalSeconds,
    visualTotalSeconds,
  ])

  useEffect(() => {
    drawTimeline()
  }, [drawTimeline])

  // Scroll timeline to match playhead unless the user is currently scrubbing via scroll.
  useEffect(() => {
    const sc = timelineScrollRef.current
    if (!sc) return
    if (playheadFromScrollRef.current) {
      playheadFromScrollRef.current = false
      return
    }
    const target = clamp(Math.round(playhead * pxPerSecond), 0, Math.max(0, stripContentW))
    ignoreScrollRef.current = true
    sc.scrollLeft = target
    setTimelineScrollLeftPx(target)
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false
    })
  }, [playhead, pxPerSecond, stripContentW, timelinePadPx])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        if (cancelled) return
        setMe(user)
        if (!user || !user.userId) throw new Error('not_authenticated')

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch('/api/create-video/project', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
        const json: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
        const pj = (json?.project || null) as any
        const id = Number(pj?.id)
        if (!Number.isFinite(id) || id <= 0) throw new Error('failed_to_load')
        const tlRaw = pj?.timeline && typeof pj.timeline === 'object' ? pj.timeline : null
        const tl: Timeline = {
          version: 'create_video_v1',
          playheadSeconds: roundToTenth(Number(tlRaw?.playheadSeconds || 0)),
          clips: Array.isArray(tlRaw?.clips) ? (tlRaw.clips as any) : [],
          graphics: Array.isArray(tlRaw?.graphics) ? (tlRaw.graphics as any) : [],
          audioTrack: tlRaw?.audioTrack && typeof tlRaw.audioTrack === 'object' ? (tlRaw.audioTrack as any) : null,
        }
        hydratingRef.current = true
        try {
          setProject(pj)
          setTimeline(tl)
          lastSavedRef.current = JSON.stringify(tl)
          undoStackRef.current = []
          setUndoDepth(0)
          setSelectedAudio(false)
        } finally {
          hydratingRef.current = false
        }
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || 'Failed to load project')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Autosave timeline (debounced)
  useEffect(() => {
    if (!project?.id) return
    if (hydratingRef.current) return
    const next = { ...timeline, playheadSeconds: playhead }
    const json = JSON.stringify(next)
    if (json === lastSavedRef.current) return
    const timer = window.setTimeout(async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch('/api/create-video/project', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ timeline: next }),
        })
        const data: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(data?.error || 'save_failed'))
        lastSavedRef.current = json
      } catch {
        // ignore; user can still export later
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [playhead, project?.id, timeline])

  // Fetch upload names for clip pills
  useEffect(() => {
    const clipIds = timeline.clips.map((c) => Number(c.uploadId)).filter((n) => Number.isFinite(n) && n > 0)
    const graphicIds = graphics.map((g) => Number((g as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
    const ids = Array.from(new Set([...clipIds, ...graphicIds]))
    if (!ids.length) return
    const clipSet = new Set<number>(clipIds)
    const missing = ids.filter((id) => !namesByUploadId[id] || (clipSet.has(id) && !durationsByUploadId[id]))
    if (!missing.length) return
    let alive = true
    const qs = encodeURIComponent(missing.slice(0, 50).join(','))
    fetch(`/api/uploads/summary?ids=${qs}`, { credentials: 'same-origin' })
      .then(async (r) => {
        const json: any = await r.json().catch(() => null)
        if (!alive) return
        if (!r.ok) return
        const items: UploadSummary[] = Array.isArray(json?.items) ? json.items : []
        if (!items.length) return
        setNamesByUploadId((prev) => {
          const next = { ...prev }
          for (const it of items) {
            const id = Number((it as any).id)
            if (!Number.isFinite(id) || id <= 0) continue
            next[id] = String((it as any).modified_filename || (it as any).original_filename || `Video ${id}`)
          }
          return next
        })
        setDurationsByUploadId((prev) => {
          const next = { ...prev }
          for (const it of items as any[]) {
            const id = Number((it as any).id)
            const dur = (it as any).duration_seconds
            if (!Number.isFinite(id) || id <= 0) continue
            const d = dur == null ? null : Number(dur)
            if (d != null && Number.isFinite(d) && d > 0) next[id] = d
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [durationsByUploadId, graphics, namesByUploadId, timeline.clips])

  const seek = useCallback(
    async (t: number, opts?: { autoPlay?: boolean }) => {
      const v = videoRef.current
      if (!v) return
      const tClamped = clamp(roundToTenth(t), 0, Math.max(0, totalSeconds))
      if (!timeline.clips.length) return
      const { clipIndex, within } = locate(tClamped, timeline.clips)
      activeClipIndexRef.current = clipIndex
      const clip = timeline.clips[clipIndex]
      if (!clip) return
      const sourceTime = clip.sourceStartSeconds + within
      const nextUploadId = Number(clip.uploadId)
      if (!Number.isFinite(nextUploadId) || nextUploadId <= 0) return

      if (activeUploadId !== nextUploadId) {
        setActiveUploadId(nextUploadId)
        const cdn = await getUploadCdnUrl(nextUploadId, { kind: 'edit-proxy' })
        v.src = `${cdn || `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy`}#t=0.1`
        v.load()
        const onMeta = () => {
          v.removeEventListener('loadedmetadata', onMeta)
          try {
            const w = Number(v.videoWidth || 0)
            const h = Number(v.videoHeight || 0)
            if (w > 0 && h > 0) setPreviewObjectFit(w > h ? 'contain' : 'cover')
          } catch {}
          try { v.currentTime = Math.max(0, sourceTime) } catch {}
          const srcKey = String(v.currentSrc || v.src || '')
          if (!opts?.autoPlay && srcKey && primedFrameSrcRef.current !== srcKey) {
            primedFrameSrcRef.current = srcKey
            void primePausedFrame(v)
          }
          if (opts?.autoPlay) {
            try { void v.play() } catch {}
          }
        }
        v.addEventListener('loadedmetadata', onMeta)
      } else {
        try { v.currentTime = Math.max(0, sourceTime) } catch {}
        if (opts?.autoPlay) {
          try { void v.play() } catch {}
        }
      }
    },
    [activeUploadId, timeline.clips, totalSeconds]
  )

  // Ensure the preview initializes after the timeline loads (especially when playhead is 0.0).
  // Without this, `playhead` may not change during hydration, so the normal playhead-driven sync won't run.
  useEffect(() => {
    if (!timeline.clips.length) return
    if (activeUploadId != null) return
    void seek(playhead)
  }, [activeUploadId, playhead, seek, timeline.clips.length])

  // Keep a stable poster image for iOS Safari (initial paused frame often won’t paint reliably).
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!activeUploadId) return
      if (posterByUploadId[activeUploadId]) return
      const cdn = await getUploadCdnUrl(activeUploadId, { kind: 'thumb' })
      const url = cdn || `/api/uploads/${encodeURIComponent(String(activeUploadId))}/thumb`
      if (!alive) return
      setPosterByUploadId((prev) => (prev[activeUploadId] ? prev : { ...prev, [activeUploadId]: url }))
    })()
    return () => {
      alive = false
    }
  }, [activeUploadId, posterByUploadId])

  // Prefetch CloudFront-signed file URLs for overlay images so playback doesn't stall.
  useEffect(() => {
    const ids = Array.from(new Set(graphics.map((g) => Number(g.uploadId)).filter((n) => Number.isFinite(n) && n > 0)))
    if (!ids.length) return
    const missing = ids.filter((id) => !graphicFileUrlByUploadId[id])
    if (!missing.length) return
    let alive = true
    ;(async () => {
      const batchSize = 8
      for (let i = 0; i < missing.length; i += batchSize) {
        const batch = missing.slice(i, i + batchSize)
        const urls = await Promise.all(batch.map((id) => getUploadCdnUrl(id, { kind: 'file' })))
        if (!alive) return
        setGraphicFileUrlByUploadId((prev) => {
          const next = { ...prev }
          for (let j = 0; j < batch.length; j++) {
            const id = batch[j]
            const url = urls[j]
            if (url) next[id] = url
          }
          return next
        })
      }
    })()
    return () => {
      alive = false
    }
  }, [graphicFileUrlByUploadId, graphics])

  // Keep video position synced when playhead changes by UI
  useEffect(() => {
    if (!timeline.clips.length) return
    if (playheadFromVideoRef.current) {
      playheadFromVideoRef.current = false
      return
    }
    // If user scrubs while playing, pause for predictable behavior.
    if (playing) {
      try { videoRef.current?.pause?.() } catch {}
      setPlaying(false)
    }
    void seek(playhead)
  }, [playhead]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the timeline becomes empty, clear the preview video so we don't leave stale frames on screen.
  useEffect(() => {
    if (timeline.clips.length) return
    const v = videoRef.current
    try { v?.pause?.() } catch {}
    setPlaying(false)
    setActiveUploadId(null)
    setSelectedClipId(null)
    setSelectedGraphicId(null)
    setSelectedAudio(false)
    setClipEditor(null)
    setClipEditorError(null)
    setPreviewObjectFit('cover')
    activeClipIndexRef.current = 0
    playheadFromVideoRef.current = false
    playheadFromScrollRef.current = false
    primedFrameSrcRef.current = ''
    if (v) {
      try {
        v.removeAttribute('src')
        v.load()
      } catch {}
    }
  }, [timeline.clips.length])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!(totalSeconds > 0)) return

    // Graphics-only playback uses a synthetic clock.
    if (!timeline.clips.length) {
      if (playing) {
        setPlaying(false)
        return
      }
      if (playhead >= totalSeconds - 0.05) {
        setTimeline((prev) => ({ ...prev, playheadSeconds: 0 }))
      }
      setPlaying(true)
      return
    }

    if (!v) return
    if (v.paused) {
      try {
        v.muted = false
        v.volume = 1
      } catch {}
      void seek(playhead, { autoPlay: true })
    } else {
      try { v.pause() } catch {}
    }
  }, [playhead, playing, seek, timeline.clips.length, totalSeconds])

  // Synthetic playback for graphics-only projects.
  useEffect(() => {
    if (timeline.clips.length) return
    if (!playing) return
    if (!(totalSeconds > 0)) {
      setPlaying(false)
      return
    }

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      const cur = Number(playheadRef.current || 0)
      let next = cur + dt
      if (next >= totalSeconds - 0.001) next = totalSeconds
      playheadRef.current = next
      setTimeline((prev) => ({ ...prev, playheadSeconds: roundToTenth(next) }))
      if (next >= totalSeconds - 0.001) {
        setPlaying(false)
        return
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [playing, timeline.clips.length, totalSeconds])

  // Drive playhead from video time while playing.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => {
      if (!playing) return
      if (!timeline.clips.length) return
      const clipIndex = Math.max(0, Math.min(activeClipIndexRef.current, timeline.clips.length - 1))
      const clip = timeline.clips[clipIndex]
      if (!clip) return
      const startTimeline = clipStarts[clipIndex] || 0
      const withinNow = Math.max(0, (v.currentTime || 0) - clip.sourceStartSeconds)
      const nextPlayhead = startTimeline + withinNow
      const next = clamp(roundToTenth(nextPlayhead), 0, Math.max(0, totalSeconds))
      if (Math.abs(next - playhead) >= 0.1) {
        playheadFromVideoRef.current = true
        setTimeline((prev) => ({ ...prev, playheadSeconds: next }))
      }
      // If we reached the end of this clip, advance to next.
      const clipLen = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
      if (withinNow >= clipLen - 0.12 && clipIndex < timeline.clips.length - 1) {
        const nextStart = clipStarts[clipIndex + 1] || 0
        activeClipIndexRef.current = clipIndex + 1
        playheadFromVideoRef.current = true
        setTimeline((prev) => ({ ...prev, playheadSeconds: nextStart }))
        void seek(nextStart, { autoPlay: true })
      } else if (withinNow >= clipLen - 0.05 && clipIndex === timeline.clips.length - 1) {
        try { v.pause() } catch {}
        setPlaying(false)
      }
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('timeupdate', onTime)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('timeupdate', onTime)
    }
  }, [clipStarts, playhead, playing, seek, timeline.clips, totalSeconds])

  const openPicker = useCallback(async () => {
    if (!me?.userId) return
    setPickerLoading(true)
    setPickerError(null)
    try {
      const params = new URLSearchParams({
        kind: 'video',
        status: 'uploaded,completed',
        user_id: String(me.userId),
        limit: '200',
      })
      const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: UploadListItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      setPickerItems(items)
    } catch (e: any) {
      setPickerError(e?.message || 'Failed to load videos')
    } finally {
      setPickerLoading(false)
    }
  }, [me?.userId])

  const openGraphicPicker = useCallback(async () => {
    if (!me?.userId) return
    setGraphicPickerLoading(true)
    setGraphicPickerError(null)
    try {
      const params = new URLSearchParams({
        kind: 'image',
        image_role: 'overlay',
        status: 'uploaded,completed',
        user_id: String(me.userId),
        limit: '200',
      })
      const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: UploadListItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      setGraphicPickerItems(items)
    } catch (e: any) {
      setGraphicPickerError(e?.message || 'Failed to load images')
    } finally {
      setGraphicPickerLoading(false)
    }
  }, [me?.userId])

  const ensureAudioConfigs = useCallback(async (): Promise<AudioConfigItem[]> => {
    if (audioConfigsLoaded) return audioConfigs
    setAudioConfigsError(null)
    try {
      const res = await fetch(`/api/audio-configs?limit=200`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: AudioConfigItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      setAudioConfigs(items)
      setAudioConfigsLoaded(true)
      return items
    } catch (e: any) {
      setAudioConfigsError(e?.message || 'Failed to load audio configs')
      setAudioConfigsLoaded(true)
      return []
    }
  }, [audioConfigs, audioConfigsLoaded])

  const openAudioPicker = useCallback(async () => {
    if (!me?.userId) return
    setAudioPickerLoading(true)
    setAudioPickerError(null)
    try {
      await ensureAudioConfigs()
      const res = await fetch(`/api/system-audio?limit=200`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: SystemAudioItem[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : []
      setAudioPickerItems(items)
    } catch (e: any) {
      setAudioPickerError(e?.message || 'Failed to load system audio')
    } finally {
      setAudioPickerLoading(false)
    }
  }, [ensureAudioConfigs, me?.userId])

  useEffect(() => {
    if (pickOpen && addStep === 'audio') return
    const a = audioPreviewRef.current
    if (!a) return
    try {
      a.pause()
      a.removeAttribute('src')
      a.load()
    } catch {}
    setAudioPreviewPlayingId(null)
  }, [addStep, pickOpen])

  const addClipFromUpload = useCallback(
    (upload: UploadListItem) => {
      const dur = upload.duration_seconds != null ? Number(upload.duration_seconds) : null
      if (dur == null || !Number.isFinite(dur) || dur <= 0) {
        setPickerError('That video is missing duration metadata. Please try a different video.')
        return
      }
      setDurationsByUploadId((prev) => (prev[Number(upload.id)] ? prev : { ...prev, [Number(upload.id)]: Number(dur) }))
      const id = `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const newClip: Clip = {
        id,
        uploadId: Number(upload.id),
        sourceStartSeconds: 0,
        sourceEndSeconds: roundToTenth(dur),
      }
      snapshotUndo()
      setTimeline((prev) => insertClipAtPlayhead(prev, newClip))
      setSelectedClipId(id)
      setSelectedGraphicId(null)
      setSelectedAudio(false)
      setPickOpen(false)
      setAddStep('type')
    },
    [setTimeline, snapshotUndo]
  )

  const addGraphicFromUpload = useCallback(
    (upload: UploadListItem) => {
      const dur = 5.0
      const id = `gfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const name = String(upload.modified_filename || upload.original_filename || `Image ${upload.id}`)
      setNamesByUploadId((prev) => (prev[Number(upload.id)] ? prev : { ...prev, [Number(upload.id)]: name }))

      const cap = timeline.clips.length ? totalSecondsVideo : null
      let start = clamp(roundToTenth(playhead), 0, cap != null ? cap : Number.POSITIVE_INFINITY)
      let end = roundToTenth(start + dur)
      if (cap != null && end > cap + 1e-6) {
        setGraphicPickerError('Not enough room to add a 5s graphic within the video duration.')
        return
      }

      // Disallow overlaps: slide forward to the next available slot.
      const existing = graphics.slice().sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
      for (let i = 0; i < existing.length; i++) {
        const g = existing[i]
        const gs = Number((g as any).startSeconds)
        const ge = Number((g as any).endSeconds)
        if (!(Number.isFinite(gs) && Number.isFinite(ge))) continue
        const overlaps = start < ge - 1e-6 && end > gs + 1e-6
        if (overlaps) {
          start = roundToTenth(ge)
          end = roundToTenth(start + dur)
          i = -1
          if (cap != null && end > cap + 1e-6) {
            setGraphicPickerError('No available slot for a 5s graphic without overlapping.')
            return
          }
        }
      }

      const newGraphic: Graphic = { id, uploadId: Number(upload.id), startSeconds: start, endSeconds: end }
      snapshotUndo()
      setTimeline((prev) => {
        const next = [...(Array.isArray((prev as any).graphics) ? (prev as any).graphics : []), newGraphic]
        next.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds))
        return { ...prev, graphics: next }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(id)
      setSelectedAudio(false)
      setPickOpen(false)
      setAddStep('type')
    },
    [graphics, playhead, snapshotUndo, timeline.clips.length, totalSecondsVideo]
  )

  const addAudioFromUpload = useCallback(
    (upload: SystemAudioItem) => {
      if (!(totalSeconds > 0)) {
        setAudioPickerError('Add at least one video or graphic first.')
        return
      }
      const id = Number(upload.id)
      if (!Number.isFinite(id) || id <= 0) {
        setAudioPickerError('Invalid audio id')
        return
      }
      const name = String(upload.modified_filename || upload.original_filename || `Audio ${id}`)
      setNamesByUploadId((prev) => (prev[id] ? prev : { ...prev, [id]: name }))

      const cfgs = Array.isArray(audioConfigs) ? audioConfigs : []
      const pickDefault = (): number | null => {
        const existing = audioTrack?.audioConfigId
        if (existing && cfgs.some((c) => Number((c as any).id) === Number(existing))) return Number(existing)
        const preferred = cfgs.find((c) => String((c as any).name || '').trim().toLowerCase() === 'mix (medium)')
        const first = preferred || cfgs[0] || null
        const v = first ? Number((first as any).id) : null
        return v != null && Number.isFinite(v) && v > 0 ? v : null
      }
      const audioConfigId = pickDefault()
      if (!audioConfigId) {
        setAudioPickerError('No audio configs available yet. Ask site_admin to create an audio config.')
        return
      }

      const end = roundToTenth(Math.max(0, totalSeconds))
      snapshotUndo()
      setTimeline((prev) => ({ ...prev, audioTrack: { uploadId: id, audioConfigId, startSeconds: 0, endSeconds: end } }))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedAudio(true)
      setPickOpen(false)
      setAddStep('type')
      try {
        const a = audioPreviewRef.current
        if (a) {
          a.pause()
          a.removeAttribute('src')
          a.load()
        }
      } catch {}
      setAudioPreviewPlayingId(null)
    },
    [audioConfigs, audioTrack?.audioConfigId, snapshotUndo, totalSeconds]
  )

  const openAudioEditor = useCallback(async () => {
    if (!audioTrack) return
    setAudioEditorError(null)
    try {
      await ensureAudioConfigs()
    } catch {}
    setAudioEditor({
      start: Number(audioTrack.startSeconds),
      end: Number(audioTrack.endSeconds),
      audioConfigId: Number(audioTrack.audioConfigId),
    })
  }, [audioTrack, ensureAudioConfigs])

  const saveAudioEditor = useCallback(() => {
    if (!audioEditor) return
    const start = roundToTenth(Number(audioEditor.start))
    const end = roundToTenth(Number(audioEditor.end))
    const audioConfigId = Number(audioEditor.audioConfigId)
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setAudioEditorError('End must be after start.')
      return
    }
    if (!Number.isFinite(audioConfigId) || audioConfigId <= 0) {
      setAudioEditorError('Invalid audio config.')
      return
    }
    if (!(totalSeconds > 0)) {
      setAudioEditorError('Add video or graphics first.')
      return
    }
    if (end > totalSeconds + 1e-6) {
      setAudioEditorError(`End exceeds timeline (${totalSeconds.toFixed(1)}s).`)
      return
    }
    snapshotUndo()
    setTimeline((prev) => {
      const at = (prev as any).audioTrack
      if (!at || typeof at !== 'object') return prev
      const safeStart = clamp(start, 0, Math.max(0, end - 0.2))
      const safeEnd = clamp(end, safeStart + 0.2, Math.max(safeStart + 0.2, totalSeconds))
      return { ...prev, audioTrack: { ...(at as any), startSeconds: safeStart, endSeconds: safeEnd, audioConfigId } }
    })
    setAudioEditor(null)
    setAudioEditorError(null)
  }, [audioEditor, snapshotUndo, totalSeconds])

  const split = useCallback(() => {
    if (!selectedClipId) return
    const res = splitClipAtPlayhead(timeline, selectedClipId)
    if (res.timeline === timeline && res.selectedClipId === selectedClipId) return
    if (res.timeline.clips === timeline.clips) return
    snapshotUndo()
    setTimeline(res.timeline)
    setSelectedClipId(res.selectedClipId)
    setSelectedGraphicId(null)
    setSelectedAudio(false)
  }, [selectedClipId, snapshotUndo, timeline])

  const deleteSelected = useCallback(() => {
    if (selectedAudio) {
      if (!audioTrack) return
      snapshotUndo()
      setTimeline((prev) => ({ ...prev, audioTrack: null }))
      setSelectedAudio(false)
      return
    }

    if (selectedGraphicId) {
      const target = selectedGraphic
      if (!target) return
      snapshotUndo()
      setTimeline((prev) => {
        const nextGraphics = (Array.isArray((prev as any).graphics) ? (prev as any).graphics : []).filter((g: any) => String(g.id) !== String(target.id))
        return { ...prev, graphics: nextGraphics }
      })
      setSelectedGraphicId(null)
      return
    }

    if (!timeline.clips.length) return
    const fallbackIdx = findClipIndexAtTime(playhead, timeline.clips, clipStarts)
    const fallback = timeline.clips[fallbackIdx] || null
    const target = selectedClip || fallback
    if (!target) return
    snapshotUndo()
    setTimeline((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === target.id)
      if (idx < 0) return prev
      const next = prev.clips.filter((c) => c.id !== target.id)
      const nextTotal = sumDur(next)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, clips: next, playheadSeconds: nextPlayhead }
    })
    // If we deleted the currently-loaded upload, force re-seek when a new clip is added/selected.
    setActiveUploadId((prev) => (prev === Number(target.uploadId) ? null : prev))
    setSelectedGraphicId(null)
    setSelectedAudio(false)
    // Keep selection stable by selecting the next clip (or previous if we deleted the last).
    setSelectedClipId((prevSel) => {
      const wasSelected = prevSel === target.id
      if (!wasSelected && prevSel) return prevSel
      const nextIdx = Math.min(fallbackIdx, Math.max(0, timeline.clips.length - 2))
      const nextClip = timeline.clips.filter((c) => c.id !== target.id)[nextIdx] || null
      return nextClip ? nextClip.id : null
    })
  }, [audioTrack, clipStarts, playhead, selectedAudio, selectedClip, selectedGraphic, selectedGraphicId, snapshotUndo, timeline.clips])

  const saveClipEditor = useCallback(() => {
    if (!clipEditor) return
    const start = roundToTenth(Number(clipEditor.start))
    const end = roundToTenth(Number(clipEditor.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setClipEditorError('End must be after start.')
      return
    }
    const clip = timeline.clips.find((c) => c.id === clipEditor.id) || null
    const maxDur = clip ? (durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds) : null
    if (maxDur != null && Number.isFinite(maxDur) && end > maxDur + 1e-6) {
      setClipEditorError(`End exceeds source duration (${Number(maxDur).toFixed(1)}s).`)
      return
    }
    snapshotUndo()
    setTimeline((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === clipEditor.id)
      if (idx < 0) return prev
      const clip = prev.clips[idx]
      const maxEnd = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
      const safeStart = Math.max(0, start)
      const safeEnd = Math.min(maxEnd, Math.max(safeStart + 0.2, end))
      const updated: Clip = { ...clip, sourceStartSeconds: safeStart, sourceEndSeconds: safeEnd }
      const next = prev.clips.slice()
      next[idx] = updated
      const nextTotal = sumDur(next)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, clips: next, playheadSeconds: nextPlayhead }
    })
    setClipEditor(null)
  }, [clipEditor, durationsByUploadId, snapshotUndo, timeline.clips])

  const saveGraphicEditor = useCallback(() => {
    if (!graphicEditor) return
    const start = roundToTenth(Number(graphicEditor.start))
    const end = roundToTenth(Number(graphicEditor.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setGraphicEditorError('End must be after start.')
      return
    }

    const cap = timeline.clips.length ? totalSecondsVideo : 20 * 60
    if (end > cap + 1e-6) {
      setGraphicEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
    }

    // Disallow overlaps with other graphics.
    for (const g of graphics) {
      if (String(g.id) === String(graphicEditor.id)) continue
      const gs = Number((g as any).startSeconds || 0)
      const ge = Number((g as any).endSeconds || 0)
      if (!(Number.isFinite(gs) && Number.isFinite(ge) && ge > gs)) continue
      const overlaps = start < ge - 1e-6 && end > gs + 1e-6
      if (overlaps) {
        setGraphicEditorError('Graphics cannot overlap in time.')
        return
      }
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevGraphics: Graphic[] = Array.isArray((prev as any).graphics) ? ((prev as any).graphics as any) : []
      const idx = prevGraphics.findIndex((g) => String((g as any).id) === String(graphicEditor.id))
      if (idx < 0) return prev
      const updated: Graphic = { ...prevGraphics[idx], startSeconds: Math.max(0, start), endSeconds: Math.max(0, end) }
      const nextGraphics = prevGraphics.slice()
      nextGraphics[idx] = updated
      nextGraphics.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds))
      const nextTotal = prev.clips.length
        ? sumDur(prev.clips)
        : Math.max(0, roundToTenth(nextGraphics.reduce((m, gg: any) => Math.max(m, Number(gg?.endSeconds) || 0), 0)))
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, graphics: nextGraphics, playheadSeconds: nextPlayhead }
    })
    setGraphicEditor(null)
    setGraphicEditorError(null)
  }, [graphicEditor, graphics, snapshotUndo, timeline.clips.length, totalSecondsVideo])

  const openAdd = useCallback(() => {
    setPickOpen(true)
    setAddStep('type')
    setPickerError(null)
    setGraphicPickerError(null)
    setAudioPickerError(null)
    setAudioConfigsError(null)
  }, [])

  const closeAdd = useCallback(() => {
    setPickOpen(false)
    setAddStep('type')
  }, [])

  useEffect(() => {
    if (!trimDragging) return
    const onMove = (e: PointerEvent) => {
      const drag = trimDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      e.preventDefault()
      const sc = timelineScrollRef.current
      const lockedScrollLeft = trimDragLockScrollLeftRef.current
      if (sc && lockedScrollLeft != null && sc.scrollLeft !== lockedScrollLeft) {
        ignoreScrollRef.current = true
        sc.scrollLeft = lockedScrollLeft
        ignoreScrollRef.current = false
      }
      const dx = e.clientX - drag.startClientX
      const deltaSeconds = dx / pxPerSecond
      const minLen = 0.2
      setTimeline((prev) => {
        if (drag.kind === 'clip') {
          const idx = prev.clips.findIndex((c) => c.id === drag.clipId)
          if (idx < 0) return prev
          const c = prev.clips[idx]
          let startS = c.sourceStartSeconds
          let endS = c.sourceEndSeconds
          if (drag.edge === 'start') {
            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), 0, Math.max(0, drag.startEndSeconds - minLen))
          } else {
            endS = clamp(
              roundToTenth(drag.startEndSeconds + deltaSeconds),
              Math.max(0, drag.startStartSeconds + minLen),
              drag.maxDurationSeconds
            )
          }
          const next = prev.clips.slice()
          next[idx] = { ...c, sourceStartSeconds: startS, sourceEndSeconds: endS }
          const nextTotal = sumDur(next)
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
          return { ...prev, clips: next, playheadSeconds: nextPlayhead }
        }

        if (drag.kind === 'audio') {
          const at = (prev as any).audioTrack
          if (!at || typeof at !== 'object') return prev
          let startS = Number((at as any).startSeconds || 0)
          let endS = Number((at as any).endSeconds || 0)
          const dur = Math.max(0.2, roundToTenth(Number(drag.startEndSeconds) - Number(drag.startStartSeconds)))
          if (drag.edge === 'start') {
            startS = clamp(
              roundToTenth(drag.startStartSeconds + deltaSeconds),
              drag.minStartSeconds,
              Math.max(drag.minStartSeconds, drag.startEndSeconds - minLen)
            )
          } else if (drag.edge === 'end') {
            endS = clamp(
              roundToTenth(drag.startEndSeconds + deltaSeconds),
              Math.max(drag.startStartSeconds + minLen, drag.minStartSeconds + minLen),
              drag.maxEndSeconds
            )
          } else {
            const maxStart =
              drag.maxStartSeconds != null ? Number(drag.maxStartSeconds) : Math.max(drag.minStartSeconds, drag.maxEndSeconds - dur)
            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
            endS = roundToTenth(startS + dur)
          }
          const nextAt = { ...(at as any), startSeconds: startS, endSeconds: endS }
          return { ...prev, audioTrack: nextAt }
        }

        const prevGraphics: Graphic[] = Array.isArray((prev as any).graphics) ? ((prev as any).graphics as any) : []
        const idx = prevGraphics.findIndex((g: any) => String(g?.id) === String(drag.graphicId))
        if (idx < 0) return prev
        const g = prevGraphics[idx] as any
        let startS = Number(g.startSeconds || 0)
        let endS = Number(g.endSeconds || 0)
        const dur = Math.max(0.2, roundToTenth(Number(drag.startEndSeconds) - Number(drag.startStartSeconds)))
        if (drag.edge === 'start') {
          startS = clamp(
            roundToTenth(drag.startStartSeconds + deltaSeconds),
            drag.minStartSeconds,
            Math.max(drag.minStartSeconds, drag.startEndSeconds - minLen)
          )
        } else if (drag.edge === 'end') {
          endS = clamp(
            roundToTenth(drag.startEndSeconds + deltaSeconds),
            Math.max(drag.startStartSeconds + minLen, drag.minStartSeconds + minLen),
            drag.maxEndSeconds
          )
        } else {
          const maxStart =
            drag.maxStartSeconds != null ? Number(drag.maxStartSeconds) : Math.max(drag.minStartSeconds, drag.maxEndSeconds - dur)
          startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
          endS = roundToTenth(startS + dur)
        }

        const nextGraphics = prevGraphics.slice()
        nextGraphics[idx] = { ...g, startSeconds: startS, endSeconds: endS }
        nextGraphics.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds))
        const nextTotal = prev.clips.length
          ? sumDur(prev.clips)
          : Math.max(0, roundToTenth(nextGraphics.reduce((m, gg: any) => Math.max(m, Number(gg?.endSeconds) || 0), 0)))
        const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
        return { ...prev, graphics: nextGraphics, playheadSeconds: nextPlayhead }
      })
    }
    const onUp = (e: PointerEvent) => {
      const drag = trimDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      trimDragRef.current = null
      setTrimDragging(false)
      try { timelineScrollRef.current?.releasePointerCapture?.(e.pointerId) } catch {}
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove as any)
      window.removeEventListener('pointerup', onUp as any)
      window.removeEventListener('pointercancel', onUp as any)
    }
  }, [pxPerSecond, trimDragging])

  // Desktop UX: allow click+drag panning when nothing is selected (mobile already pans naturally).
  useEffect(() => {
    if (!panDragging) return
    const onMove = (e: PointerEvent) => {
      const drag = panDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      e.preventDefault()
      const sc = timelineScrollRef.current
      if (!sc) return
      const dx = e.clientX - drag.startClientX
      const nextScrollLeft = clamp(Math.round(drag.startScrollLeft - dx), 0, Math.max(0, stripContentW))
      ignoreScrollRef.current = true
      sc.scrollLeft = nextScrollLeft
      setTimelineScrollLeftPx(nextScrollLeft)
      const t = clamp(roundToTenth(nextScrollLeft / pxPerSecond), 0, Math.max(0, totalSeconds))
      playheadFromScrollRef.current = true
      setTimeline((prev) => ({ ...prev, playheadSeconds: t }))
      window.requestAnimationFrame(() => {
        ignoreScrollRef.current = false
      })
    }
    const onUp = (e: PointerEvent) => {
      const drag = panDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      panDragRef.current = null
      setPanDragging(false)
      try { timelineScrollRef.current?.releasePointerCapture?.(e.pointerId) } catch {}
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove as any)
      window.removeEventListener('pointerup', onUp as any)
      window.removeEventListener('pointercancel', onUp as any)
    }
  }, [panDragging, pxPerSecond, stripContentW, totalSeconds])

  // While dragging trim handles, hard-lock the timeline scroll position so the drag gesture
  // doesn't get interpreted as horizontal panning (especially on iOS).
  useEffect(() => {
    const sc = timelineScrollRef.current
    if (!sc) return
    if (!trimDragging) return

    const locked = trimDragLockScrollLeftRef.current ?? sc.scrollLeft
    trimDragLockScrollLeftRef.current = locked

    trimDragScrollRestoreRef.current = {
      overflowX: sc.style.overflowX || '',
      webkitOverflowScrolling: (sc.style as any).WebkitOverflowScrolling || '',
      overscrollBehaviorX: (sc.style as any).overscrollBehaviorX || '',
    }

    ignoreScrollRef.current = true
    sc.scrollLeft = locked
    ignoreScrollRef.current = false

    sc.style.overflowX = 'hidden'
    ;(sc.style as any).WebkitOverflowScrolling = 'auto'
    ;(sc.style as any).overscrollBehaviorX = 'none'

    const preventScroll = (e: Event) => {
      e.preventDefault()
    }
    const enforceScrollLeft = () => {
      const want = trimDragLockScrollLeftRef.current
      if (want == null) return
      if (sc.scrollLeft === want) return
      ignoreScrollRef.current = true
      sc.scrollLeft = want
      ignoreScrollRef.current = false
    }

    sc.addEventListener('wheel', preventScroll as any, { passive: false })
    sc.addEventListener('touchmove', preventScroll as any, { passive: false })
    sc.addEventListener('scroll', enforceScrollLeft, { passive: true })

    return () => {
      sc.removeEventListener('wheel', preventScroll as any)
      sc.removeEventListener('touchmove', preventScroll as any)
      sc.removeEventListener('scroll', enforceScrollLeft as any)
      const prev = trimDragScrollRestoreRef.current
      if (prev) {
        sc.style.overflowX = prev.overflowX
        ;(sc.style as any).WebkitOverflowScrolling = prev.webkitOverflowScrolling
        ;(sc.style as any).overscrollBehaviorX = prev.overscrollBehaviorX
      } else {
        sc.style.overflowX = ''
        ;(sc.style as any).WebkitOverflowScrolling = ''
        ;(sc.style as any).overscrollBehaviorX = ''
      }
      trimDragScrollRestoreRef.current = null
      trimDragLockScrollLeftRef.current = null
    }
  }, [trimDragging])

  const archiveAndRestart = useCallback(async () => {
    if (!project?.id) return
    const ok = window.confirm('Start a new Create Video project? This will archive the current timeline.')
    if (!ok) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      await fetch('/api/create-video/project/archive', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
    } catch {}
    undoStackRef.current = []
    setUndoDepth(0)
    window.location.reload()
  }, [project?.id])

  const exportNow = useCallback(async () => {
    if (!(totalSeconds > 0)) return
    setExporting(true)
    setExportError(null)
    setExportStatus('Starting export…')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch('/api/create-video/project/export', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'export_failed'))
      setExportStatus('Export in progress…')
    } catch (e: any) {
      setExportError(e?.message || 'export_failed')
      setExportStatus(null)
      setExporting(false)
    }
  }, [totalSeconds])

  useEffect(() => {
    if (!exporting) return
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/create-video/project/export-status', { credentials: 'same-origin' })
        const json: any = await res.json().catch(() => null)
        if (!alive) return
        const status = String(json?.status || '')
        if (!status || status === 'idle') {
          setExportStatus('Waiting…')
          return
        }
        if (status === 'completed') {
          const uploadId = Number(json?.resultUploadId)
          if (Number.isFinite(uploadId) && uploadId > 0) {
            window.location.href = `/produce?upload=${encodeURIComponent(String(uploadId))}&from=${encodeURIComponent('/create-video')}`
            return
          }
          setExportError('Export completed but missing upload id.')
          setExporting(false)
          return
        }
        if (status === 'failed' || status === 'dead') {
          setExportError(String(json?.error?.message || json?.error?.code || 'export_failed'))
          setExporting(false)
          return
        }
        setExportStatus(`Export: ${status}`)
      } catch {
        // ignore transient
      }
    }
    tick()
    const t = window.setInterval(tick, 2000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [exporting])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Create Video</h1>
          <p style={{ color: '#bbb' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Create Video</h1>
          <p style={{ color: '#ff9b9b' }}>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/uploads" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to Uploads</a>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={archiveAndRestart}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              New Project
            </button>
            <button
              type="button"
              onClick={openAdd}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(212,175,55,0.65)',
                background: 'rgba(212,175,55,0.12)',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={exportNow}
              disabled={totalSeconds <= 0 || exporting}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(10,132,255,0.55)',
                background: exporting ? 'rgba(10,132,255,0.18)' : '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: totalSeconds <= 0 || exporting ? 'default' : 'pointer',
              }}
            >
              Export
            </button>
          </div>
        </div>

        <h1 style={{ margin: '12px 0 10px', fontSize: 28 }}>Create Video</h1>
        <div style={{ color: '#bbb', fontSize: 13 }}>
          Clips: {timeline.clips.length} • Graphics: {graphics.length} • Total: {totalSeconds.toFixed(1)}s
        </div>

        <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', overflow: 'hidden', background: '#000' }}>
          <div style={{ width: '100%', aspectRatio: '9 / 16', background: '#000', position: 'relative' }}>
            <video
              ref={videoRef}
              playsInline
              preload="metadata"
              poster={activePoster || undefined}
              style={{ width: '100%', height: '100%', objectFit: previewObjectFit, display: timeline.clips.length ? 'block' : 'none' }}
            />
            {activeGraphicUrl ? (
              <img
                src={activeGraphicUrl}
                alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
              />
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.35)', padding: 12 }}>
          <div style={{ position: 'relative', paddingTop: 14 }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', color: '#bbb', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {playhead.toFixed(1)}s
            </div>
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: '#ff3b30',
                  transform: 'translateX(-50%)',
                  zIndex: 50,
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.75)',
                }}
              />
              <div
                ref={(el) => {
                  timelineScrollRef.current = el
                  setTimelineScrollEl(el)
                }}
                onScroll={() => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if (ignoreScrollRef.current) return
                  if (trimDragRef.current) return
                  const nextScrollLeft = Math.max(0, sc.scrollLeft)
                  setTimelineScrollLeftPx(nextScrollLeft)
                  const t = clamp(roundToTenth(nextScrollLeft / pxPerSecond), 0, Math.max(0, totalSeconds))
                  if (Math.abs(t - playhead) < 0.05) return
                  playheadFromScrollRef.current = true
                  setTimeline((prev) => ({ ...prev, playheadSeconds: t }))
                }}
                onPointerDown={(e) => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if (trimDragging) return
                  // Only do mouse drag-panning on desktop. Touch already pans the scroll container.
                  const isMouse = (e as any).pointerType === 'mouse'
                  if (isMouse && e.button != null && e.button !== 0) return
                  const rect = sc.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
                  const clickXInScroll = (e.clientX - rect.left) + sc.scrollLeft
                  const x = clickXInScroll - padPx
                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))

                  if (withinGraphics) {
                    const g = findGraphicAtTime(t)
                    if (!g) return
                    const s = Number((g as any).startSeconds || 0)
                    const e2 = Number((g as any).endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
                    const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                    const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
                    if (!inside) return

                    // Slide (body drag) only when already selected.
                    if (!nearLeft && !nearRight) {
                      if (selectedGraphicId !== g.id) return
                      e.preventDefault()
                      snapshotUndo()
                      setSelectedGraphicId(g.id)
                      setSelectedClipId(null)
                      setSelectedAudio(false)

                      trimDragLockScrollLeftRef.current = sc.scrollLeft
                      const sorted = graphics.slice().sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
                      const pos = sorted.findIndex((gg: any) => String(gg?.id) === String(g.id))
                      const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
                      const capEnd = timeline.clips.length ? totalSecondsVideo : 20 * 60
                      const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
                      const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                      const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)
                      const dur = Math.max(0.2, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)

                      trimDragRef.current = {
                        kind: 'graphic',
                        graphicId: g.id,
                        edge: 'move',
                        pointerId: e.pointerId,
                        startClientX: e.clientX,
                        startStartSeconds: s,
                        startEndSeconds: e2,
                        minStartSeconds,
                        maxEndSeconds,
                        maxStartSeconds,
                      }
                      setTrimDragging(true)
                      try { sc.setPointerCapture(e.pointerId) } catch {}
                      return
                    }

                    e.preventDefault()
                    snapshotUndo()
                    setSelectedGraphicId(g.id)
                    setSelectedClipId(null)
                    setSelectedAudio(false)

                    trimDragLockScrollLeftRef.current = sc.scrollLeft
                    const sorted = graphics.slice().sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
                    const pos = sorted.findIndex((gg: any) => String(gg?.id) === String(g.id))
                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
                    const capEnd = timeline.clips.length ? totalSecondsVideo : 20 * 60
                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

                    trimDragRef.current = {
                      kind: 'graphic',
                      graphicId: g.id,
                      edge: nearLeft ? 'start' : 'end',
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startStartSeconds: s,
                      startEndSeconds: e2,
                      minStartSeconds,
                      maxEndSeconds,
                    }
                    setTrimDragging(true)
                    try { sc.setPointerCapture(e.pointerId) } catch {}
                    return
                  }

                  if (withinAudio) {
                    if (!audioTrack) return
                    const s = Number(audioTrack.startSeconds || 0)
                    const e2 = Number(audioTrack.endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
                    const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                    const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
                    if (!inside) return

                    // Slide (body drag) only when already selected.
                    if (!nearLeft && !nearRight) {
                      if (!selectedAudio) return
                      e.preventDefault()
                      snapshotUndo()
                      setSelectedAudio(true)
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)

                      const dur = Math.max(0.2, roundToTenth(e2 - s))
                      const maxEndSeconds = Math.max(0, totalSeconds)
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), 0, maxEndSeconds)

                      trimDragLockScrollLeftRef.current = sc.scrollLeft
                      trimDragRef.current = {
                        kind: 'audio',
                        edge: 'move',
                        pointerId: e.pointerId,
                        startClientX: e.clientX,
                        startStartSeconds: s,
                        startEndSeconds: e2,
                        minStartSeconds: 0,
                        maxEndSeconds,
                        maxStartSeconds,
                      }
                      setTrimDragging(true)
                      try { sc.setPointerCapture(e.pointerId) } catch {}
                      return
                    }

                    e.preventDefault()
                    snapshotUndo()
                    setSelectedAudio(true)
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)

                    trimDragLockScrollLeftRef.current = sc.scrollLeft
                    trimDragRef.current = {
                      kind: 'audio',
                      edge: nearLeft ? 'start' : 'end',
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startStartSeconds: s,
                      startEndSeconds: e2,
                      minStartSeconds: 0,
                      maxEndSeconds: Math.max(0, totalSeconds),
                    }
                    setTrimDragging(true)
                    try { sc.setPointerCapture(e.pointerId) } catch {}
                    return
                  }

                  if (!timeline.clips.length) return
                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = timeline.clips[idx]
                  if (!clip) return

                  const start = (clipStarts[idx] || 0)
                  const len = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
                  const leftX = padPx + start * pxPerSecond
                  const rightX = padPx + (start + len) * pxPerSecond
                  const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                  const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                  if (!nearLeft && !nearRight) return

                  e.preventDefault()
                  snapshotUndo()
                  setSelectedClipId(clip.id)
                  setSelectedGraphicId(null)
                  setSelectedAudio(false)
                  trimDragLockScrollLeftRef.current = sc.scrollLeft
                  const maxDur = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
                  trimDragRef.current = {
                    kind: 'clip',
                    clipId: clip.id,
                    edge: nearLeft ? 'start' : 'end',
                    pointerId: e.pointerId,
                    startClientX: e.clientX,
                    startStartSeconds: clip.sourceStartSeconds,
                    startEndSeconds: clip.sourceEndSeconds,
                    maxDurationSeconds: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : clip.sourceEndSeconds,
                  }
                  setTrimDragging(true)
                  try { sc.setPointerCapture(e.pointerId) } catch {}
                  return
                }}
                onPointerDownCapture={(e) => {
                  // If we didn't start a handle drag, allow mouse click+drag panning on empty areas.
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if ((e as any).pointerType !== 'mouse') return
                  if (e.button != null && e.button !== 0) return
                  if (trimDragging || trimDragRef.current) return
                  if (timelinePanLocked) return
                  // Don't pan when starting on a pill (let click-selection work). This only kicks in for empty space.
                  const rect = sc.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
                  const clickXInScroll = (e.clientX - rect.left) + sc.scrollLeft
                  const x = clickXInScroll - padPx
                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H

                  if (withinGraphics) {
                    const g = findGraphicAtTime(t)
                    if (g) return
                  }
                  if (withinAudio) {
                    if (audioTrack) {
                      const s = Number(audioTrack.startSeconds || 0)
                      const e2 = Number(audioTrack.endSeconds || 0)
                      if (t >= s && t <= e2) return
                    }
                  }
                  if (withinVideo) {
                    if (timeline.clips.length) {
                      const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                      const clip = timeline.clips[idx]
                      if (clip) {
                        const start = (clipStarts[idx] || 0)
                        const len = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
                        const leftX = padPx + start * pxPerSecond
                        const rightX = padPx + (start + len) * pxPerSecond
                        if (clickXInScroll >= leftX && clickXInScroll <= rightX) return
                      }
                    }
                  }

                  panDragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startScrollLeft: sc.scrollLeft }
                  setPanDragging(true)
                  try { sc.setPointerCapture(e.pointerId) } catch {}
                  e.preventDefault()
                }}
                onClick={(e) => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if (trimDragging) return
                  const rect = sc.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const clickX = e.clientX - rect.left
                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
                  const clickXInScroll = clickX + sc.scrollLeft
                  const x = clickXInScroll - padPx
                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
                  if (!withinGraphics && !withinVideo && !withinAudio) {
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)
                    setSelectedAudio(false)
                    return
                  }

                  if (withinGraphics) {
                    const g = findGraphicAtTime(t)
                    if (!g) {
                      setSelectedGraphicId(null)
                      setSelectedClipId(null)
                      setSelectedAudio(false)
                      return
                    }
                    const s = Number((g as any).startSeconds || 0)
                    const e2 = Number((g as any).endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
                      setSelectedGraphicId(null)
                      setSelectedClipId(null)
                      setSelectedAudio(false)
                      return
                    }
                    if (selectedGraphicId === g.id) {
                      setGraphicEditor({ id: g.id, start: s, end: e2 })
                      setGraphicEditorError(null)
                      return
                    }
                    setSelectedClipId(null)
                    setSelectedGraphicId(g.id)
                    setSelectedAudio(false)
                    return
                  }

                  if (withinAudio) {
                    if (!audioTrack) {
                      setSelectedAudio(false)
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      return
                    }
                    const s = Number(audioTrack.startSeconds || 0)
                    const e2 = Number(audioTrack.endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
                      setSelectedAudio(false)
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      return
                    }
                    const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                    const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                    if (nearLeft || nearRight) return

                    if (selectedAudio) {
                      openAudioEditor()
                      return
                    }
                    setSelectedAudio(true)
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)
                    return
                  }

                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = timeline.clips[idx]
                  if (!clip) {
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)
                    setSelectedAudio(false)
                    return
                  }

                  // If user taps the same selected clip again (not on a handle), open properties.
                  const start = (clipStarts[idx] || 0)
                  const len = Math.max(0, clip.sourceEndSeconds - clip.sourceStartSeconds)
                  const leftX = padPx + start * pxPerSecond
                  const rightX = padPx + (start + len) * pxPerSecond
                  // Clicking the track outside any pill should deselect.
                  if (clickXInScroll < leftX || clickXInScroll > rightX) {
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)
                    setSelectedAudio(false)
                    return
                  }
                  const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                  const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                  if (nearLeft || nearRight) return

                  if (selectedClipId === clip.id) {
                    setClipEditor({ id: clip.id, start: clip.sourceStartSeconds, end: clip.sourceEndSeconds })
                    setClipEditorError(null)
                    return
                  }

                  setSelectedClipId(clip.id)
                  setSelectedGraphicId(null)
                  setSelectedAudio(false)
                }}
                style={{
                  width: '100%',
                  overflowX: trimDragging || timelinePanLocked ? 'hidden' : 'auto',
                  overflowY: 'hidden',
                  WebkitOverflowScrolling: trimDragging || timelinePanLocked ? 'auto' : 'touch',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.28)',
                  background: 'rgba(0,0,0,0.60)',
                  height: TIMELINE_H,
                  position: 'relative',
                  touchAction: trimDragging || timelinePanLocked ? 'none' : 'pan-x',
                }}
              >
                <div style={{ width: timelinePadPx + stripContentW + timelinePadPx, height: TIMELINE_H, position: 'relative' }}>
                  <canvas
                    ref={timelineCanvasRef}
                    style={{ position: 'sticky', left: 0, top: 0, display: 'block', pointerEvents: 'none' }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={openAdd}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(212,175,55,0.65)',
                    background: 'rgba(212,175,55,0.12)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: 'pointer',
                    flex: '0 0 auto',
                  }}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={split}
                  disabled={!selectedClipId}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: selectedClipId ? '#0c0c0c' : 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: selectedClipId ? 'pointer' : 'default',
                    flex: '0 0 auto',
                  }}
                >
                  Split
                </button>
                <button
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: canUndo ? '#0c0c0c' : 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: canUndo ? 'pointer' : 'default',
                    flex: '0 0 auto',
                  }}
                >
                  Undo
                </button>
              </div>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={!selectedClipId && !selectedGraphicId && !selectedAudio}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: selectedClipId || selectedGraphicId || selectedAudio ? '#300' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: selectedClipId || selectedGraphicId || selectedAudio ? 'pointer' : 'default',
                  flex: '0 0 auto',
                }}
              >
                Delete
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={jumpPrevBoundary}
                disabled={totalSeconds <= 0 || !canJumpPrev}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: totalSeconds <= 0 || !canJumpPrev ? 'rgba(255,255,255,0.06)' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: totalSeconds <= 0 || !canJumpPrev ? 'default' : 'pointer',
                  flex: '0 0 auto',
                }}
                title="Jump to previous boundary"
                aria-label="Jump to previous boundary"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => {
                  if (suppressNextNudgeClickRef.current) {
                    suppressNextNudgeClickRef.current = false
                    return
                  }
                  nudgePlayhead(-0.1)
                }}
                onContextMenu={(e) => e.preventDefault()}
                disabled={totalSeconds <= 0}
                onPointerDown={(e) => {
                  if (e.button != null && e.button !== 0) return
                  if (totalSeconds <= 0) return
                  try { (e.currentTarget as any).setPointerCapture?.(e.pointerId) } catch {}
                  startNudgeRepeat(-0.1)
                }}
                onPointerUp={() => finishNudgePress(-0.1)}
                onPointerLeave={() => finishNudgePress(-0.1)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                  flex: '0 0 auto',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                }}
                title="Nudge backward 0.1s"
                aria-label="Nudge backward 0.1 seconds"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={togglePlay}
                disabled={totalSeconds <= 0}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(10,132,255,0.55)',
                  background: playing ? 'rgba(10,132,255,0.18)' : '#0a84ff',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                  flex: '0 0 auto',
                  minWidth: 96,
                }}
                title="Play/Pause"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (suppressNextNudgeClickRef.current) {
                    suppressNextNudgeClickRef.current = false
                    return
                  }
                  nudgePlayhead(0.1)
                }}
                onContextMenu={(e) => e.preventDefault()}
                disabled={totalSeconds <= 0}
                onPointerDown={(e) => {
                  if (e.button != null && e.button !== 0) return
                  if (totalSeconds <= 0) return
                  try { (e.currentTarget as any).setPointerCapture?.(e.pointerId) } catch {}
                  startNudgeRepeat(0.1)
                }}
                onPointerUp={() => finishNudgePress(0.1)}
                onPointerLeave={() => finishNudgePress(0.1)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                  flex: '0 0 auto',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                }}
                title="Nudge forward 0.1s"
                aria-label="Nudge forward 0.1 seconds"
              >
                ›
              </button>
              <button
                type="button"
                onClick={jumpNextBoundary}
                disabled={totalSeconds <= 0 || !canJumpNext}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: totalSeconds <= 0 || !canJumpNext ? 'rgba(255,255,255,0.06)' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: totalSeconds <= 0 || !canJumpNext ? 'default' : 'pointer',
                  flex: '0 0 auto',
                }}
                title="Jump to next boundary"
                aria-label="Jump to next boundary"
              >
                »
              </button>
            </div>
          </div>
        </div>

        {exportStatus ? <div style={{ marginTop: 12, color: '#bbb' }}>{exportStatus}</div> : null}
        {exportError ? <div style={{ marginTop: 10, color: '#ff9b9b' }}>{exportError}</div> : null}
      </div>

      {pickOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 5000, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
          onClick={closeAdd}
        >
          <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#000', padding: '6px 0 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  {addStep === 'type' ? (
                    <button
                      type="button"
                      onClick={closeAdd}
                      style={{ color: '#0a84ff', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14 }}
                    >
                      ← Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddStep('type')}
                      style={{ color: '#0a84ff', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14 }}
                    >
                      ← Types
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeAdd}
                  style={{
                    color: '#fff',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    padding: '8px 10px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 800,
                  }}
                >
                  Close
                </button>
                <div style={{ color: '#bbb', fontSize: 13 }}>
                  {addStep === 'video'
                    ? `Videos: ${pickerItems.length}`
                    : addStep === 'graphic'
                      ? `Images: ${graphicPickerItems.length}`
                      : addStep === 'audio'
                        ? `Tracks: ${audioPickerItems.length}`
                        : 'Choose a type'}
                </div>
              </div>
            </div>
            {addStep === 'type' ? (
              <>
                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Add Asset</h1>
                <div style={{ display: 'grid', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddStep('video')
                      openPicker().catch(() => {})
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid rgba(212,175,55,0.55)',
                      background: 'rgba(0,0,0,0.35)',
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16 }}>Video</div>
                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Add and trim video clips</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddStep('graphic')
                      openGraphicPicker().catch(() => {})
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid rgba(10,132,255,0.55)',
                      background: 'rgba(0,0,0,0.35)',
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16 }}>Graphic</div>
                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Full-frame overlays (no overlaps)</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddStep('audio')
                      openAudioPicker().catch(() => {})
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid rgba(48,209,88,0.55)',
                      background: 'rgba(0,0,0,0.35)',
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16 }}>Audio</div>
                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Background music (system audio)</div>
                  </button>
                </div>
              </>
            ) : addStep === 'video' ? (
              <>
                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Video</h1>
                {pickerLoading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
                {pickerError ? <div style={{ color: '#ff9b9b' }}>{pickerError}</div> : null}
                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                  {pickerItems.map((it) => {
                    const id = Number(it.id)
                    if (!Number.isFinite(id) || id <= 0) return null
                    const name = String(it.modified_filename || it.original_filename || `Upload ${id}`)
                    const thumb = `/api/uploads/${encodeURIComponent(String(id))}/thumb`
                    const dur = it.duration_seconds != null ? Number(it.duration_seconds) : null
                    return (
                      <button
                        key={`pick-${id}`}
                        type="button"
                        onClick={() => addClipFromUpload(it)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '96px 1fr',
                          gap: 12,
                          alignItems: 'center',
                          padding: 12,
                          borderRadius: 12,
                          border: '1px solid rgba(212,175,55,0.55)',
                          background: 'rgba(0,0,0,0.35)',
                          color: '#fff',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <img src={thumb} alt="" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 8, background: '#000' }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                          <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>
                            {dur != null && Number.isFinite(dur) ? `${dur}s` : 'Duration unknown'}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : addStep === 'graphic' ? (
              <>
                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Graphic</h1>
                {graphicPickerLoading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
                {graphicPickerError ? <div style={{ color: '#ff9b9b' }}>{graphicPickerError}</div> : null}
                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                  {graphicPickerItems.map((it) => {
                    const id = Number(it.id)
                    if (!Number.isFinite(id) || id <= 0) return null
                    const name = String(it.modified_filename || it.original_filename || `Upload ${id}`)
                    const src = `/api/uploads/${encodeURIComponent(String(id))}/file`
                    return (
                      <button
                        key={`pick-gfx-${id}`}
                        type="button"
                        onClick={() => addGraphicFromUpload(it)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '96px 1fr',
                          gap: 12,
                          alignItems: 'center',
                          padding: 12,
                          borderRadius: 12,
                          border: '1px solid rgba(10,132,255,0.55)',
                          background: 'rgba(0,0,0,0.35)',
                          color: '#fff',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <img src={src} alt="" loading="lazy" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 8, background: '#000' }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                          <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>Full-frame graphic • No overlaps</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Audio</h1>
                {audioPickerLoading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
                {audioPickerError ? <div style={{ color: '#ff9b9b' }}>{audioPickerError}</div> : null}
                {audioConfigsError ? <div style={{ color: '#ff9b9b' }}>{audioConfigsError}</div> : null}
                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                  {audioPickerItems.map((it) => {
                    const id = Number(it.id)
                    if (!Number.isFinite(id) || id <= 0) return null
                    const name = String(it.modified_filename || it.original_filename || `Audio ${id}`)
                    const artist = (it as any).artist != null ? String((it as any).artist || '').trim() : ''
                    const isPlaying = audioPreviewPlayingId === id
                    return (
                      <div
                        key={`pick-audio-${id}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr auto',
                          gap: 12,
                          alignItems: 'center',
                          padding: 12,
                          borderRadius: 12,
                          border: '1px solid rgba(48,209,88,0.55)',
                          background: 'rgba(0,0,0,0.35)',
                          color: '#fff',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleAudioPreview(id)}
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.20)',
                            background: 'rgba(255,255,255,0.06)',
                            color: '#fff',
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                          aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
                        >
                          {isPlaying ? '❚❚' : '▶'}
                        </button>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                          <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>{artist ? `Artist: ${artist}` : 'System audio'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addAudioFromUpload(it)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: '#0c0c0c',
                            color: '#fff',
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          Select
                        </button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {graphicEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setGraphicEditor(null); setGraphicEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(10,132,255,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Graphic Properties</div>
              <button
                type="button"
                onClick={() => { setGraphicEditor(null); setGraphicEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {(() => {
                const start = Number(graphicEditor.start)
                const end = Number(graphicEditor.end)
                const minLen = 0.2
                const cap = timeline.clips.length ? totalSecondsVideo : 20 * 60

                const adjustStart = (delta: number) => {
                  setGraphicEditorError(null)
                  setGraphicEditor((p) => {
                    if (!p) return p
                    const next = roundToTenth(Number(p.start) + delta)
                    const maxStart = Math.max(0, (Number(p.end) - minLen))
                    return { ...p, start: clamp(next, 0, maxStart) }
                  })
                }

                const adjustEnd = (delta: number) => {
                  setGraphicEditorError(null)
                  setGraphicEditor((p) => {
                    if (!p) return p
                    const next = roundToTenth(Number(p.end) + delta)
                    const minEnd = Math.max(0, (Number(p.start) + minLen))
                    return { ...p, end: clamp(next, minEnd, cap) }
                  })
                }

                const statBox: React.CSSProperties = {
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: 10,
                  minWidth: 0,
                }

                const adjustBtn = (enabled: boolean): React.CSSProperties => ({
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: `1px solid ${enabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)'}`,
                  background: enabled ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                  color: enabled ? '#fff' : 'rgba(255,255,255,0.55)',
                  fontWeight: 900,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                })

                const canStartDec1 = Number.isFinite(start) && start > 0 + 1e-9
                const canStartInc1 = Number.isFinite(start) && Number.isFinite(end) && start + 1 <= end - minLen + 1e-9
                const canEndDec1 = Number.isFinite(start) && Number.isFinite(end) && end - 1 >= start + minLen - 1e-9
                const canEndInc1 = Number.isFinite(end) && end + 1 <= cap + 1e-9

                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Start</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(start) ? `${start.toFixed(1)}s` : '—'}</div>
                      </div>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Duration</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(start) && Number.isFinite(end) ? `${Math.max(0, end - start).toFixed(1)}s` : '—'}</div>
                      </div>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>End</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(end) ? `${end.toFixed(1)}s` : '—'}</div>
                      </div>
                    </div>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={String(graphicEditor.start)}
                        onChange={(e) => { setGraphicEditorError(null); setGraphicEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
                        style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                      />
                    </label>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust Start</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" disabled={!canStartDec1} onClick={() => adjustStart(-1)} style={adjustBtn(canStartDec1)}>-1s</button>
                        <button type="button" disabled={!canStartInc1} onClick={() => adjustStart(1)} style={adjustBtn(canStartInc1)}>+1s</button>
                      </div>
                    </div>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={String(graphicEditor.end)}
                        onChange={(e) => { setGraphicEditorError(null); setGraphicEditor((p) => p ? ({ ...p, end: Number(e.target.value) }) : p) }}
                        style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                      />
                    </label>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust End</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" disabled={!canEndDec1} onClick={() => adjustEnd(-1)} style={adjustBtn(canEndDec1)}>-1s</button>
                        <button type="button" disabled={!canEndInc1} onClick={() => adjustEnd(1)} style={adjustBtn(canEndInc1)}>+1s</button>
                      </div>
                      <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Max end: {cap.toFixed(1)}s</div>
                    </div>
                  </>
                )
              })()}
              {graphicEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{graphicEditorError}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setGraphicEditor(null); setGraphicEditorError(null) }}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveGraphicEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(10,132,255,0.65)', background: 'rgba(10,132,255,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {audioEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setAudioEditor(null); setAudioEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(48,209,88,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Audio Properties</div>
              <button
                type="button"
                onClick={() => { setAudioEditor(null); setAudioEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Audio Config</div>
                <select
                  value={String(audioEditor.audioConfigId)}
                  onChange={(e) => { setAudioEditorError(null); setAudioEditor((p) => p ? ({ ...p, audioConfigId: Number(e.target.value) }) : p) }}
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                >
                  {audioConfigs.map((c) => (
                    <option key={`cfg-${c.id}`} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={String(audioEditor.start)}
                    onChange={(e) => { setAudioEditorError(null); setAudioEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={String(audioEditor.end)}
                    onChange={(e) => { setAudioEditorError(null); setAudioEditor((p) => p ? ({ ...p, end: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                  />
                </label>
              </div>

              {audioEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{audioEditorError}</div> : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setAudioEditor(null); setAudioEditorError(null) }}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveAudioEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(48,209,88,0.65)', background: 'rgba(48,209,88,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {clipEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setClipEditor(null); setClipEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(212,175,55,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Video Properties</div>
              <button type="button" onClick={() => { setClipEditor(null); setClipEditorError(null) }} style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {(() => {
                const clip = timeline.clips.find((c) => c.id === clipEditor.id) || null
                const maxDur = clip ? (durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds) : null
                const start = Number(clipEditor.start)
                const end = Number(clipEditor.end)
                const safeMax = maxDur != null && Number.isFinite(Number(maxDur)) ? Number(maxDur) : null
                const minLen = 0.2

                const adjustStart = (delta: number) => {
                  setClipEditorError(null)
                  setClipEditor((p) => {
                    if (!p) return p
                    const next = roundToTenth(Number(p.start) + delta)
                    const maxStart = Math.max(0, (Number(p.end) - minLen))
                    return { ...p, start: clamp(next, 0, maxStart) }
                  })
                }

                const adjustEnd = (delta: number) => {
                  setClipEditorError(null)
                  setClipEditor((p) => {
                    if (!p) return p
                    const maxEnd = safeMax ?? Number.POSITIVE_INFINITY
                    const next = roundToTenth(Number(p.end) + delta)
                    const minEnd = Math.max(0, (Number(p.start) + minLen))
                    return { ...p, end: clamp(next, minEnd, maxEnd) }
                  })
                }

                const canStartDec1 = Number.isFinite(start) && start > 0 + 1e-9
                const canStartDec10 = Number.isFinite(start) && start > 10 + 1e-9
                const canStartInc1 = Number.isFinite(start) && Number.isFinite(end) && start + 1 <= end - minLen + 1e-9
                const canStartInc10 = Number.isFinite(start) && Number.isFinite(end) && start + 10 <= end - minLen + 1e-9

                const canEndDec1 = Number.isFinite(start) && Number.isFinite(end) && end - 1 >= start + minLen - 1e-9
                const canEndDec10 = Number.isFinite(start) && Number.isFinite(end) && end - 10 >= start + minLen - 1e-9
                const canEndInc1 = safeMax == null ? Number.isFinite(end) : (Number.isFinite(end) && end + 1 <= safeMax + 1e-9)
                const canEndInc10 = safeMax == null ? Number.isFinite(end) : (Number.isFinite(end) && end + 10 <= safeMax + 1e-9)

                const statBox: React.CSSProperties = {
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: 10,
                  minWidth: 0,
                }

                const adjustBtn = (enabled: boolean): React.CSSProperties => ({
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: `1px solid ${enabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)'}`,
                  background: enabled ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                  color: enabled ? '#fff' : 'rgba(255,255,255,0.55)',
                  fontWeight: 900,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                })

                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Start</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(start) ? `${start.toFixed(1)}s` : '—'}</div>
                      </div>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Total</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{safeMax != null ? `${safeMax.toFixed(1)}s` : '—'}</div>
                      </div>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>End</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{Number.isFinite(end) ? `${end.toFixed(1)}s` : '—'}</div>
                      </div>
                    </div>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={String(clipEditor.start)}
                        onChange={(e) => { setClipEditorError(null); setClipEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
                        style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                      />
                    </label>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust Start</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" disabled={!canStartDec10} onClick={() => adjustStart(-10)} style={adjustBtn(canStartDec10)}>-10s</button>
                        <button type="button" disabled={!canStartDec1} onClick={() => adjustStart(-1)} style={adjustBtn(canStartDec1)}>-1s</button>
                        <button type="button" disabled={!canStartInc1} onClick={() => adjustStart(1)} style={adjustBtn(canStartInc1)}>+1s</button>
                        <button type="button" disabled={!canStartInc10} onClick={() => adjustStart(10)} style={adjustBtn(canStartInc10)}>+10s</button>
                      </div>
                    </div>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={String(clipEditor.end)}
                        onChange={(e) => { setClipEditorError(null); setClipEditor((p) => p ? ({ ...p, end: Number(e.target.value) }) : p) }}
                        style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                      />
                    </label>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust End</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" disabled={!canEndDec10} onClick={() => adjustEnd(-10)} style={adjustBtn(canEndDec10)}>-10s</button>
                        <button type="button" disabled={!canEndDec1} onClick={() => adjustEnd(-1)} style={adjustBtn(canEndDec1)}>-1s</button>
                        <button type="button" disabled={!canEndInc1} onClick={() => adjustEnd(1)} style={adjustBtn(canEndInc1)}>+1s</button>
                        <button type="button" disabled={!canEndInc10} onClick={() => adjustEnd(10)} style={adjustBtn(canEndInc10)}>+10s</button>
                      </div>
                      {safeMax != null ? <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Max end: {safeMax.toFixed(1)}s</div> : null}
                    </div>
                  </>
                )
              })()}
              {clipEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{clipEditorError}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button type="button" onClick={() => { setClipEditor(null); setClipEditorError(null) }} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="button" onClick={saveClipEditor} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(212,175,55,0.65)', background: 'rgba(212,175,55,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
