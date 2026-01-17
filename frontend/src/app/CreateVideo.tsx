import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUploadCdnUrl } from '../ui/uploadsCdn'
import type { AudioTrack, Clip, Graphic, Logo, LogoConfigSnapshot, LowerThird, LowerThirdConfigSnapshot, Still, Timeline } from './createVideo/timelineTypes'
import { cloneTimeline } from './createVideo/timelineTypes'
import {
  clamp,
  clipDurationSeconds,
  clipSourceDurationSeconds,
  computeClipStarts,
  computeTimelineEndSecondsFromClips,
  findClipIndexAtTime,
  locate,
  roundToTenth,
} from './createVideo/timelineMath'
import { insertClipAtPlayhead, splitClipAtPlayhead, splitGraphicAtPlayhead, splitLogoAtPlayhead, splitLowerThirdAtPlayhead } from './createVideo/timelineOps'

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

type LogoConfigItem = LogoConfigSnapshot
type LowerThirdConfigItem = LowerThirdConfigSnapshot

type AddStep = 'type' | 'video' | 'graphic' | 'audio' | 'logo' | 'logoConfig' | 'lowerThird' | 'lowerThirdConfig'

const FREEZE_OPTIONS_SECONDS = [
  0,
  0.1,
  0.2,
  0.3,
  0.4,
  0.5,
  0.6,
  0.7,
  0.8,
  0.9,
  1.0,
  2,
  3,
  4,
  5,
] as const

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

function normalizeLegacyPosition(pos: string): string {
  return pos === 'center' ? 'middle_center' : pos
}

function insetPctForPreset(preset: any): number {
  const p = String(preset || '').toLowerCase()
  if (p === 'small') return 0.06
  if (p === 'large') return 0.14
  return 0.10
}

function computeOverlayCssNoOpacity(cfg: {
  position?: string | null
  sizePctWidth?: number | null
  insetXPreset?: string | null
  insetYPreset?: string | null
}): React.CSSProperties {
  const clampNumber = (n: any, min: number, max: number): number => {
    const v = Number(n)
    if (!Number.isFinite(v)) return min
    return Math.min(Math.max(v, min), max)
  }
  const sizePctWidth = clampNumber(cfg.sizePctWidth ?? 15, 1, 100)
  const posRaw = String(cfg.position || 'bottom_right')
  const pos = normalizeLegacyPosition(posRaw)
  const [rowRaw, colRaw] = String(pos).split('_') as [string, string]
  const row = rowRaw || 'bottom'
  const col = colRaw || 'right'
  const yMode = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle'
  const xMode = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'
  const insetXPct = insetPctForPreset(cfg.insetXPreset) * 100
  const insetYPct = insetPctForPreset(cfg.insetYPreset) * 100
  const marginXPct = xMode === 'center' ? 0 : insetXPct
  const marginYPct = yMode === 'middle' ? 0 : insetYPct

  const style: React.CSSProperties = {
    position: 'absolute',
    width: `${sizePctWidth}%`,
    height: 'auto',
    pointerEvents: 'none',
  }
  let transform = ''
  if (xMode === 'left') style.left = `${marginXPct}%`
  else if (xMode === 'right') style.right = `${marginXPct}%`
  else {
    style.left = '50%'
    transform += ' translateX(-50%)'
  }
  if (yMode === 'top') style.top = `${marginYPct}%`
  else if (yMode === 'bottom') style.bottom = `${marginYPct}%`
  else {
    style.top = '50%'
    transform += ' translateY(-50%)'
  }
  if (transform.trim()) style.transform = transform.trim()
  return style
}

function computeSegmentTimingWindow(cfg: { timingRule?: any; timingSeconds?: any }, segmentDurationSeconds: number): { startRelS: number; endRelS: number } {
  const rule = String(cfg.timingRule || 'entire').toLowerCase()
  const secsRaw = cfg.timingSeconds == null ? null : Number(cfg.timingSeconds)
  const secs = secsRaw != null && Number.isFinite(secsRaw) ? Math.max(0, secsRaw) : null
  const totalS = Math.max(0, Number.isFinite(segmentDurationSeconds) ? segmentDurationSeconds : 0)
  if (rule === 'start_after') {
    const startRelS = Math.min(totalS, secs ?? 0)
    return { startRelS, endRelS: totalS }
  }
  if (rule === 'first_only') {
    const d = secs ?? 0
    return { startRelS: 0, endRelS: Math.max(0, Math.min(d, totalS)) }
  }
  if (rule === 'last_only') {
    const d = secs ?? totalS
    const endRelS = totalS
    const startRelS = Math.max(0, endRelS - Math.max(0, Math.min(d, totalS)))
    return { startRelS, endRelS }
  }
  return { startRelS: 0, endRelS: totalS }
}

function computeFadeAlpha(cfg: { fade?: any }, tRelS: number, windowStartRelS: number, windowEndRelS: number): number {
  const fadeS = 0.5
  const fade = String(cfg.fade || 'none').toLowerCase()
  let a = 1
  if ((fade === 'in' || fade === 'in_out') && fadeS > 0) {
    const x = (tRelS - windowStartRelS) / fadeS
    a *= Math.min(1, Math.max(0, x))
  }
  if ((fade === 'out' || fade === 'in_out') && fadeS > 0) {
    const x = (windowEndRelS - tRelS) / fadeS
    a *= Math.min(1, Math.max(0, x))
  }
  return a
}

export default function CreateVideo() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [timeline, setTimeline] = useState<Timeline>({
    version: 'create_video_v1',
    playheadSeconds: 0,
    clips: [],
    stills: [],
    graphics: [],
    logos: [],
    lowerThirds: [],
    audioTrack: null,
  })
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null)
  const [selectedLogoId, setSelectedLogoId] = useState<string | null>(null)
  const [selectedLowerThirdId, setSelectedLowerThirdId] = useState<string | null>(null)
  const [selectedStillId, setSelectedStillId] = useState<string | null>(null)
  const [selectedAudio, setSelectedAudio] = useState(false)
  const [namesByUploadId, setNamesByUploadId] = useState<Record<number, string>>({})
  const [durationsByUploadId, setDurationsByUploadId] = useState<Record<number, number>>({})
  const [dimsByUploadId, setDimsByUploadId] = useState<Record<number, { width: number; height: number }>>({})
  const [pickOpen, setPickOpen] = useState(false)
  const [addStep, setAddStep] = useState<AddStep>('type')
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerItems, setPickerItems] = useState<UploadListItem[]>([])
  const [clipEditor, setClipEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [clipEditorError, setClipEditorError] = useState<string | null>(null)
  const [freezeInsertSeconds, setFreezeInsertSeconds] = useState<number>(2)
  const [freezeInsertBusy, setFreezeInsertBusy] = useState(false)
  const [freezeInsertError, setFreezeInsertError] = useState<string | null>(null)
  const [graphicPickerLoading, setGraphicPickerLoading] = useState(false)
  const [graphicPickerError, setGraphicPickerError] = useState<string | null>(null)
  const [graphicPickerItems, setGraphicPickerItems] = useState<UploadListItem[]>([])
  const [logoPickerLoading, setLogoPickerLoading] = useState(false)
  const [logoPickerError, setLogoPickerError] = useState<string | null>(null)
  const [logoPickerItems, setLogoPickerItems] = useState<UploadListItem[]>([])
  const [logoConfigs, setLogoConfigs] = useState<LogoConfigItem[]>([])
  const [logoConfigsLoaded, setLogoConfigsLoaded] = useState(false)
  const [logoConfigsError, setLogoConfigsError] = useState<string | null>(null)
  const [pendingLogoUploadId, setPendingLogoUploadId] = useState<number | null>(null)
  const [lowerThirdPickerLoading, setLowerThirdPickerLoading] = useState(false)
  const [lowerThirdPickerError, setLowerThirdPickerError] = useState<string | null>(null)
  const [lowerThirdPickerItems, setLowerThirdPickerItems] = useState<UploadListItem[]>([])
  const [lowerThirdConfigs, setLowerThirdConfigs] = useState<LowerThirdConfigItem[]>([])
  const [lowerThirdConfigsLoaded, setLowerThirdConfigsLoaded] = useState(false)
  const [lowerThirdConfigsError, setLowerThirdConfigsError] = useState<string | null>(null)
  const [pendingLowerThirdUploadId, setPendingLowerThirdUploadId] = useState<number | null>(null)
  const [graphicEditor, setGraphicEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [graphicEditorError, setGraphicEditorError] = useState<string | null>(null)
  const [logoEditor, setLogoEditor] = useState<{ id: string; start: number; end: number; configId: number } | null>(null)
  const [logoEditorError, setLogoEditorError] = useState<string | null>(null)
  const [lowerThirdEditor, setLowerThirdEditor] = useState<{ id: string; start: number; end: number; configId: number } | null>(null)
  const [lowerThirdEditorError, setLowerThirdEditorError] = useState<string | null>(null)
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
  const playingRef = useRef(false)
  const activeClipIndexRef = useRef(0)
  const playheadFromVideoRef = useRef(false)
  const suppressNextVideoPauseRef = useRef(false)
  const gapPlaybackRef = useRef<{ raf: number; target: number; nextClipIndex: number | null } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [timelineMessage, setTimelineMessage] = useState<string | null>(null)
  const undoStackRef = useRef<
    Array<{
      timeline: Timeline
      selectedClipId: string | null
      selectedGraphicId: string | null
      selectedLogoId: string | null
      selectedLowerThirdId: string | null
      selectedStillId: string | null
      selectedAudio: boolean
    }>
  >([])
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

  const setTimelineScrollContainerRef = useCallback((el: HTMLDivElement | null) => {
    timelineScrollRef.current = el
    setTimelineScrollEl(el)
  }, [])

  const trimDragRef = useRef<
    | {
        kind: 'clip'
        clipId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startStartSeconds: number
        startEndSeconds: number
        maxDurationSeconds: number
        // For move (timeline placement)
        minStartSeconds?: number
        maxEndSeconds?: number
        maxStartSeconds?: number
        // For trim (prevent overlapping the next clip on the timeline)
        maxTimelineDurationSeconds?: number
      }
    | {
        kind: 'still'
        stillId: string
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
        kind: 'logo'
        logoId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startClientY?: number
        startStartSeconds: number
        startEndSeconds: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
        // For armed body-drag (so a click can still open the properties modal)
        armed?: boolean
        moved?: boolean
      }
    | {
        kind: 'lowerThird'
        lowerThirdId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startClientY?: number
        startStartSeconds: number
        startEndSeconds: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
        // For armed body-drag (so a click can still open the properties modal)
        armed?: boolean
        moved?: boolean
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

  const panDragRef = useRef<{ pointerId: number; startClientX: number; startScrollLeft: number; moved: boolean } | null>(null)
  const [panDragging, setPanDragging] = useState(false)
  const suppressNextTimelineClickRef = useRef(false)

  const debugEnabled = useMemo(() => {
    try {
      if (typeof window === 'undefined') return false
      const qp = new URLSearchParams(window.location.search)
      if (qp.get('cvDebug') === '1') return true
      return window.localStorage?.getItem('CV_DEBUG') === '1'
    } catch {
      return false
    }
  }, [])

  const dbg = useCallback(
    (label: string, data?: any) => {
      if (!debugEnabled) return
      try {
        const sc = timelineScrollRef.current
        // eslint-disable-next-line no-console
        console.log(`[cv] ${label}`, {
          selectedClipId,
          selectedGraphicId,
          selectedLogoId,
          selectedLowerThirdId,
          selectedAudio,
          trimDragging,
          panDragging,
          hasTrimDrag: Boolean(trimDragRef.current),
          scrollLeft: sc ? sc.scrollLeft : null,
          overflowX: sc ? sc.style.overflowX : null,
          webkitOverflowScrolling: sc ? (sc.style as any).WebkitOverflowScrolling : null,
          ...(data || {}),
        })
      } catch {}
    },
    [debugEnabled, panDragging, selectedAudio, selectedClipId, selectedGraphicId, selectedLogoId, selectedLowerThirdId, trimDragging]
  )

  const stopTrimDrag = useCallback(
    (reason: string) => {
      const drag = trimDragRef.current
      const sc = timelineScrollRef.current
      if (drag && sc) {
        try {
          sc.releasePointerCapture?.(drag.pointerId)
        } catch {}
      }
      trimDragRef.current = null
      trimDragLockScrollLeftRef.current = null
      setTrimDragging(false)
      dbg('stopTrimDrag', { reason })
    },
    [dbg]
  )

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

  // Synchronous "autoplay unlock" attempt for iOS Safari: must be called directly from a user gesture.
  // This does not await anything (so we preserve gesture context); it just starts muted playback briefly.
  const primeAutoplayUnlock = useCallback((v: HTMLVideoElement) => {
    try {
      const prevMuted = v.muted
      v.muted = true
      const p = v.play()
      // Don't await; schedule pause/restore.
      window.setTimeout(() => {
        try { v.pause() } catch {}
        try { v.muted = prevMuted } catch {}
      }, 60)
      // Silence unhandled promise rejections.
      if (p && typeof (p as any).catch === 'function') {
        ;(p as any).catch(() => {})
      }
    } catch {}
  }, [])

  const playWithAutoplayFallback = useCallback(async (v: HTMLVideoElement): Promise<boolean> => {
    const tryPlay = async (): Promise<boolean> => {
      try {
        const p = v.play()
        if (p && typeof (p as any).then === 'function') await p.catch(() => {})
        return true
      } catch {
        return false
      }
    }

    // First attempt: play with current mute state.
    if (await tryPlay()) return true

    // Fallback: autoplay policies (esp iOS Safari) may block non-gesture play with audio.
    // Try muted autoplay, then unmute once playback starts.
    try { v.muted = true } catch {}
    if (await tryPlay()) {
      window.setTimeout(() => {
        try {
          v.muted = false
          v.volume = 1
        } catch {}
      }, 0)
      return true
    }
    return false
  }, [])

  const clipStarts = useMemo(() => computeClipStarts(timeline.clips), [timeline.clips])
  const totalSecondsVideo = useMemo(() => computeTimelineEndSecondsFromClips(timeline.clips, clipStarts), [clipStarts, timeline.clips])
  const totalSecondsStills = useMemo(() => {
    const ss = Array.isArray((timeline as any).stills) ? ((timeline as any).stills as Still[]) : []
    let m = 0
    for (const s of ss) {
      const e = Number((s as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    return Math.max(0, roundToTenth(m))
  }, [timeline])
  const totalSecondsGraphics = useMemo(() => {
    const gs = Array.isArray((timeline as any).graphics) ? (timeline as any).graphics as Graphic[] : []
    let m = 0
    for (const g of gs) {
      const e = Number((g as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    return Math.max(0, roundToTenth(m))
  }, [timeline])
  const totalSeconds = useMemo(
    () => Math.max(0, roundToTenth(Math.max(totalSecondsVideo, totalSecondsGraphics, totalSecondsStills))),
    [totalSecondsGraphics, totalSecondsStills, totalSecondsVideo]
  )

  const computeTotalSecondsForTimeline = useCallback((tl: Timeline): number => {
    const clips = Array.isArray(tl.clips) ? tl.clips : []
    const starts = computeClipStarts(clips)
    const videoEnd = computeTimelineEndSecondsFromClips(clips, starts)
    const gs: any[] = Array.isArray((tl as any).graphics) ? (tl as any).graphics : []
    let gEnd = 0
    for (const g of gs) {
      const e = Number((g as any).endSeconds)
      if (Number.isFinite(e) && e > gEnd) gEnd = e
    }
    const ss: any[] = Array.isArray((tl as any).stills) ? (tl as any).stills : []
    let sEnd = 0
    for (const s of ss) {
      const e = Number((s as any).endSeconds)
      if (Number.isFinite(e) && e > sEnd) sEnd = e
    }
    const ls: any[] = Array.isArray((tl as any).logos) ? (tl as any).logos : []
    let lEnd = 0
    for (const l of ls) {
      const e = Number((l as any).endSeconds)
      if (Number.isFinite(e) && e > lEnd) lEnd = e
    }
    const lts: any[] = Array.isArray((tl as any).lowerThirds) ? (tl as any).lowerThirds : []
    let ltEnd = 0
    for (const lt of lts) {
      const e = Number((lt as any).endSeconds)
      if (Number.isFinite(e) && e > ltEnd) ltEnd = e
    }
    const at = (tl as any).audioTrack
    const aEnd = at && typeof at === 'object' ? Number((at as any).endSeconds || 0) : 0
    return Math.max(0, roundToTenth(Math.max(videoEnd, gEnd, sEnd, lEnd, ltEnd, aEnd)))
  }, [])
  const playhead = useMemo(() => clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, totalSeconds)), [timeline.playheadSeconds, totalSeconds])
  const pxPerSecond = 48
  const visualTotalSeconds = useMemo(() => Math.max(0, totalSeconds), [totalSeconds])
  const stripContentW = useMemo(() => Math.max(0, Math.ceil(visualTotalSeconds * pxPerSecond)), [pxPerSecond, visualTotalSeconds])
  const RULER_H = 16
  const WAVEFORM_H = 34
  const TRACK_H = 48
  const TRACKS_TOP = RULER_H + WAVEFORM_H
  const LOGO_Y = TRACKS_TOP + 6
  const LOWER_THIRD_Y = TRACKS_TOP + TRACK_H + 6
  const GRAPHICS_Y = TRACKS_TOP + TRACK_H * 2 + 6
  const VIDEO_Y = TRACKS_TOP + TRACK_H * 3 + 6
  const AUDIO_Y = TRACKS_TOP + TRACK_H * 4 + 6
  const PILL_H = Math.max(18, TRACK_H - 12)
  const HANDLE_HIT_PX = 18
  const TIMELINE_H = TRACKS_TOP + TRACK_H * 5

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

  const logos = useMemo(() => (Array.isArray((timeline as any).logos) ? ((timeline as any).logos as Logo[]) : []), [timeline])
  const selectedLogo = useMemo(() => {
    if (!selectedLogoId) return null
    return logos.find((l) => String(l.id) === String(selectedLogoId)) || null
  }, [logos, selectedLogoId])

  const lowerThirds = useMemo(() => (Array.isArray((timeline as any).lowerThirds) ? ((timeline as any).lowerThirds as LowerThird[]) : []), [timeline])
  const selectedLowerThird = useMemo(() => {
    if (!selectedLowerThirdId) return null
    return lowerThirds.find((lt) => String((lt as any).id) === String(selectedLowerThirdId)) || null
  }, [lowerThirds, selectedLowerThirdId])

  const stills = useMemo(() => (Array.isArray((timeline as any).stills) ? ((timeline as any).stills as Still[]) : []), [timeline])
  const selectedStill = useMemo(() => {
    if (!selectedStillId) return null
    return stills.find((s) => s.id === selectedStillId) || null
  }, [selectedStillId, stills])

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

  const canUndo = undoDepth > 0

  const boundaries = useMemo(() => {
    const out: number[] = []
    out.push(0)
    for (let i = 0; i < timeline.clips.length; i++) {
      const start = roundToTenth(clipStarts[i] || 0)
      const len = clipDurationSeconds(timeline.clips[i])
      const end = roundToTenth(start + len)
      out.push(start, end)
    }
    for (const s of stills) {
      const a = roundToTenth(Number((s as any).startSeconds || 0))
      const b = roundToTenth(Number((s as any).endSeconds || 0))
      if (b > a) out.push(a, b)
    }
    for (const g of graphics) {
      const s = roundToTenth(Number((g as any).startSeconds || 0))
      const e = roundToTenth(Number((g as any).endSeconds || 0))
      if (e > s) out.push(s, e)
    }
    for (const l of logos) {
      const s = roundToTenth(Number((l as any).startSeconds || 0))
      const e = roundToTenth(Number((l as any).endSeconds || 0))
      if (e > s) out.push(s, e)
    }
    for (const lt of lowerThirds) {
      const s = roundToTenth(Number((lt as any).startSeconds || 0))
      const e = roundToTenth(Number((lt as any).endSeconds || 0))
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
  }, [audioTrack, clipStarts, graphics, logos, lowerThirds, stills, timeline.clips, totalSeconds])

  const dragHud = useMemo(() => {
    if (!trimDragging) return null
    const drag = trimDragRef.current
    if (!drag) return null

    const actionLabel =
      drag.edge === 'move' ? 'Move' : drag.edge === 'start' ? 'Resize start' : drag.edge === 'end' ? 'Resize end' : String(drag.edge)

    if (drag.kind === 'clip') {
      const idx = timeline.clips.findIndex((c) => c.id === drag.clipId)
      if (idx < 0) return null
      const clip = timeline.clips[idx]
      const name = namesByUploadId[Number(clip.uploadId)] || `Video ${clip.uploadId}`
      const start = roundToTenth(clipStarts[idx] || 0)
      const len = Math.max(0, roundToTenth(clipDurationSeconds(clip)))
      const end = roundToTenth(start + len)
      return { kindLabel: 'Video', actionLabel, name, start, end, len }
    }

    if (drag.kind === 'graphic') {
      const g = graphics.find((gg) => String((gg as any).id) === String(drag.graphicId)) as any
      if (!g) return null
      const name = namesByUploadId[Number(g.uploadId)] || `Image ${g.uploadId}`
      const start = roundToTenth(Number(g.startSeconds || 0))
      const end = roundToTenth(Number(g.endSeconds || 0))
      const len = Math.max(0, roundToTenth(end - start))
      return { kindLabel: 'Graphic', actionLabel, name, start, end, len }
    }

    if (drag.kind === 'logo') {
      const l = logos.find((ll: any) => String((ll as any).id) === String((drag as any).logoId)) as any
      if (!l) return null
      const logoName = namesByUploadId[Number(l.uploadId)] || `Logo ${l.uploadId}`
      const cfgName = String(l?.configSnapshot?.name || '') || `Config ${l.configId}`
      const name = `${logoName} • ${cfgName}`
      const start = roundToTenth(Number(l.startSeconds || 0))
      const end = roundToTenth(Number(l.endSeconds || 0))
      const len = Math.max(0, roundToTenth(end - start))
      return { kindLabel: 'Logo', actionLabel, name, start, end, len }
    }

    if (drag.kind === 'lowerThird') {
      const lt = lowerThirds.find((x: any) => String((x as any).id) === String((drag as any).lowerThirdId)) as any
      if (!lt) return null
      const imgName = namesByUploadId[Number(lt.uploadId)] || `Lower third ${lt.uploadId}`
      const cfgName = String(lt?.configSnapshot?.name || '') || `Config ${lt.configId}`
      const name = `${imgName} • ${cfgName}`
      const start = roundToTenth(Number(lt.startSeconds || 0))
      const end = roundToTenth(Number(lt.endSeconds || 0))
      const len = Math.max(0, roundToTenth(end - start))
      return { kindLabel: 'Lower third', actionLabel, name, start, end, len }
    }

    if (drag.kind === 'audio') {
      if (!audioTrack) return null
      const audioName = namesByUploadId[Number(audioTrack.uploadId)] || `Audio ${audioTrack.uploadId}`
      const cfgName = audioConfigNameById[Number(audioTrack.audioConfigId)] || `Config ${audioTrack.audioConfigId}`
      const name = `${audioName} • ${cfgName}`
      const start = roundToTenth(Number(audioTrack.startSeconds || 0))
      const end = roundToTenth(Number(audioTrack.endSeconds || 0))
      const len = Math.max(0, roundToTenth(end - start))
      return { kindLabel: 'Audio', actionLabel, name, start, end, len }
    }

    if (drag.kind === 'still') {
      const s = stills.find((ss: any) => String(ss?.id) === String((drag as any).stillId)) as any
      if (!s) return null
      const start = roundToTenth(Number(s.startSeconds || 0))
      const end = roundToTenth(Number(s.endSeconds || 0))
      const len = Math.max(0, roundToTenth(end - start))
      const name = `Freeze ${len.toFixed(1)}s`
      return { kindLabel: 'Freeze', actionLabel, name, start, end, len }
    }

    return null
  }, [
    audioConfigNameById,
    audioTrack,
    clipStarts,
    graphics,
    logos,
    lowerThirds,
    stills,
    namesByUploadId,
    timeline.clips,
    trimDragging,
  ])

  const nudgePlayhead = useCallback((deltaSeconds: number) => {
    setTimeline((prev) => {
      const total = computeTotalSecondsForTimeline(prev as any)
      const next = clamp(roundToTenth(Number(prev.playheadSeconds || 0) + deltaSeconds), 0, Math.max(0, total))
      return { ...prev, playheadSeconds: next }
    })
  }, [computeTotalSecondsForTimeline])

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

  const findLogoAtTime = useCallback((t: number): Logo | null => {
    const tt = Number(t)
    if (!Number.isFinite(tt) || tt < 0) return null
    const candidates: Array<{ s: number; e: number; l: Logo }> = []
    for (const l of logos) {
      const s = Number((l as any).startSeconds)
      const e = Number((l as any).endSeconds)
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue
      if (tt >= s && tt <= e) candidates.push({ s, e, l })
    }
    if (!candidates.length) return null
    // If we're exactly on a boundary, prefer the segment whose start matches.
    for (const c of candidates) {
      if (roundToTenth(c.s) === roundToTenth(tt)) return c.l
    }
    candidates.sort((a, b) => a.s - b.s || a.e - b.e)
    return candidates[0].l
    return null
  }, [logos])

  const findLowerThirdAtTime = useCallback((t: number): LowerThird | null => {
    const tt = Number(t)
    if (!Number.isFinite(tt) || tt < 0) return null
    const candidates: Array<{ s: number; e: number; lt: LowerThird }> = []
    for (const lt of lowerThirds) {
      const s = Number((lt as any).startSeconds)
      const e = Number((lt as any).endSeconds)
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue
      if (tt >= s && tt <= e) candidates.push({ s, e, lt })
    }
    if (!candidates.length) return null
    for (const c of candidates) {
      if (roundToTenth(c.s) === roundToTenth(tt)) return c.lt
    }
    candidates.sort((a, b) => a.s - b.s || a.e - b.e)
    return candidates[0].lt
  }, [lowerThirds])

  const findStillAtTime = useCallback((t: number): Still | null => {
    const tt = Number(t)
    if (!Number.isFinite(tt) || tt < 0) return null
    for (const s of stills) {
      const a = Number((s as any).startSeconds)
      const b = Number((s as any).endSeconds)
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      if (tt >= a && tt < b) return s
    }
    return null
  }, [stills])

  const activeGraphicAtPlayhead = useMemo(() => findGraphicAtTime(playhead), [findGraphicAtTime, playhead])
  const activeLogoAtPlayhead = useMemo(() => findLogoAtTime(playhead), [findLogoAtTime, playhead])
  const activeLowerThirdAtPlayhead = useMemo(() => findLowerThirdAtTime(playhead), [findLowerThirdAtTime, playhead])
  const activeStillAtPlayhead = useMemo(() => findStillAtTime(playhead), [findStillAtTime, playhead])
  const activeGraphicUploadId = useMemo(() => {
    const g = activeGraphicAtPlayhead
    if (!g) return null
    const id = Number((g as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [activeGraphicAtPlayhead])

  const activeStillUploadId = useMemo(() => {
    const s = activeStillAtPlayhead
    if (!s) return null
    const id = Number((s as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [activeStillAtPlayhead])

  const activeLogoUploadId = useMemo(() => {
    const l = activeLogoAtPlayhead
    if (!l) return null
    const id = Number((l as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [activeLogoAtPlayhead])

  const activeLowerThirdUploadId = useMemo(() => {
    const lt = activeLowerThirdAtPlayhead
    if (!lt) return null
    const id = Number((lt as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [activeLowerThirdAtPlayhead])
  const activeGraphicUrl = useMemo(() => {
    if (!activeGraphicUploadId) return null
    return graphicFileUrlByUploadId[activeGraphicUploadId] || `/api/uploads/${encodeURIComponent(String(activeGraphicUploadId))}/file`
  }, [activeGraphicUploadId, graphicFileUrlByUploadId])

  const activeStillUrl = useMemo(() => {
    if (!activeStillUploadId) return null
    return graphicFileUrlByUploadId[activeStillUploadId] || `/api/uploads/${encodeURIComponent(String(activeStillUploadId))}/file`
  }, [activeStillUploadId, graphicFileUrlByUploadId])

  const activeLogoUrl = useMemo(() => {
    if (!activeLogoUploadId) return null
    return graphicFileUrlByUploadId[activeLogoUploadId] || `/api/uploads/${encodeURIComponent(String(activeLogoUploadId))}/file`
  }, [activeLogoUploadId, graphicFileUrlByUploadId])

  const activeLowerThirdUrl = useMemo(() => {
    if (!activeLowerThirdUploadId) return null
    return graphicFileUrlByUploadId[activeLowerThirdUploadId] || `/api/uploads/${encodeURIComponent(String(activeLowerThirdUploadId))}/file`
  }, [activeLowerThirdUploadId, graphicFileUrlByUploadId])

  const activeLogoPreview = useMemo(() => {
    const seg: any = activeLogoAtPlayhead as any
    const url = activeLogoUrl
    if (!seg || !url) return null
    const segStart = Number(seg.startSeconds || 0)
    const segEnd = Number(seg.endSeconds || 0)
    if (!(Number.isFinite(segStart) && Number.isFinite(segEnd) && segEnd > segStart)) return null
    const segDur = Math.max(0, segEnd - segStart)
    const cfg: any = seg.configSnapshot && typeof seg.configSnapshot === 'object' ? seg.configSnapshot : {}
    const { startRelS, endRelS } = computeSegmentTimingWindow(cfg, segDur)
    if (!(endRelS > startRelS)) return null
    const tRel = Number(playhead) - segStart
    if (!(Number.isFinite(tRel) && tRel >= startRelS - 1e-6 && tRel <= endRelS + 1e-6)) return null

    const baseOpacityPct = cfg.opacityPct != null ? Number(cfg.opacityPct) : 100
    const baseOpacity = Math.min(1, Math.max(0, (Number.isFinite(baseOpacityPct) ? baseOpacityPct : 100) / 100))
    const fadeAlpha = computeFadeAlpha(cfg, tRel, startRelS, endRelS)
    const alpha = baseOpacity * fadeAlpha
    if (!(alpha > 0.001)) return null

    const style: any = computeOverlayCssNoOpacity(cfg)
    style.opacity = alpha
    style.zIndex = 50
    return { url, style }
  }, [activeLogoAtPlayhead, activeLogoUrl, playhead])

  const activeLowerThirdPreview = useMemo(() => {
    const seg: any = activeLowerThirdAtPlayhead as any
    const url = activeLowerThirdUrl
    if (!seg || !url) return null
    const segStart = Number(seg.startSeconds || 0)
    const segEnd = Number(seg.endSeconds || 0)
    if (!(Number.isFinite(segStart) && Number.isFinite(segEnd) && segEnd > segStart)) return null
    const segDur = Math.max(0, segEnd - segStart)
    const cfg: any = seg.configSnapshot && typeof seg.configSnapshot === 'object' ? seg.configSnapshot : {}
    const { startRelS, endRelS } = computeSegmentTimingWindow(cfg, segDur)
    if (!(endRelS > startRelS)) return null
    const tRel = Number(playhead) - segStart
    if (!(Number.isFinite(tRel) && tRel >= startRelS - 1e-6 && tRel <= endRelS + 1e-6)) return null

    const baseOpacityPct = cfg.opacityPct != null ? Number(cfg.opacityPct) : 100
    const baseOpacity = Math.min(1, Math.max(0, (Number.isFinite(baseOpacityPct) ? baseOpacityPct : 100) / 100))
    const fadeAlpha = computeFadeAlpha(cfg, tRel, startRelS, endRelS)
    const alpha = baseOpacity * fadeAlpha
    if (!(alpha > 0.001)) return null

    // Lower thirds can use match_image sizing; convert to a % width when we have the image pixel width.
    const cfgForCss: any = { ...(cfg as any) }
    try {
      if (String(cfgForCss.sizeMode || '').toLowerCase() === 'match_image') {
        const base = Number(cfgForCss.baselineWidth) === 1920 ? 1920 : 1080
        const w = dimsByUploadId[Number(seg.uploadId)]?.width
        if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) {
          cfgForCss.sizePctWidth = clamp((Number(w) / base) * 100, 1, 100)
        }
      }
    } catch {}

    const style: any = computeOverlayCssNoOpacity(cfgForCss)
    style.opacity = alpha
    style.zIndex = 40
    return { url, style }
  }, [activeLowerThirdAtPlayhead, activeLowerThirdUrl, dimsByUploadId, playhead])

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

  const waitForFreezeFrameUpload = useCallback(async (uploadId: number, atSeconds: number): Promise<number> => {
    const id = Number(uploadId)
    if (!Number.isFinite(id) || id <= 0) throw new Error('bad_upload')
    const at = Number(atSeconds)
    if (!Number.isFinite(at) || at < 0) throw new Error('bad_time')

    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const csrf = getCsrfToken()
    if (csrf) headers['x-csrf-token'] = csrf

    const started = Date.now()
    const overallTimeoutMs = 2 * 60 * 1000
    const pollEveryMs = 1500

    const pollUploadUntilReady = async (freezeUploadId: number): Promise<number> => {
      const fid = Number(freezeUploadId)
      if (!Number.isFinite(fid) || fid <= 0) throw new Error('bad_freeze_upload')
      while (Date.now() - started < overallTimeoutMs) {
        const res = await fetch(`/api/uploads/${encodeURIComponent(String(fid))}`, { credentials: 'same-origin' })
        const json: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.error || 'failed_to_get'))
        const up = json?.upload && typeof json.upload === 'object' ? json.upload : json
        const status = String(up?.status || '')
        if (status === 'completed' || status === 'uploaded') return fid
        if (status === 'error' || status === 'failed') throw new Error('freeze_failed')
        await sleep(pollEveryMs)
      }
      throw new Error('freeze_timeout')
    }

    while (Date.now() - started < overallTimeoutMs) {
      const res = await fetch(`/api/uploads/${encodeURIComponent(String(id))}/freeze-frame`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ atSeconds: at, longEdgePx: 1280 }),
      })

      const json: any = await res.json().catch(() => null)
      if (res.status === 202) {
        const freezeUploadId = Number(json?.freezeUploadId || 0)
        if (freezeUploadId > 0) return await pollUploadUntilReady(freezeUploadId)
        await sleep(pollEveryMs)
        continue
      }
      if (!res.ok) throw new Error(String(json?.error || 'freeze_failed'))

      const freezeUploadId = Number(json?.freezeUploadId || 0)
      if (!Number.isFinite(freezeUploadId) || freezeUploadId <= 0) throw new Error('freeze_failed')
      const status = String(json?.status || '')
      if (status === 'completed') return freezeUploadId
      return await pollUploadUntilReady(freezeUploadId)
    }
    throw new Error('freeze_timeout')
  }, [])

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

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

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
    const snapshot = { timeline: cloneTimeline(timeline), selectedClipId, selectedGraphicId, selectedLogoId, selectedLowerThirdId, selectedStillId, selectedAudio }
    stack.push(snapshot)
    // Cap memory and keep behavior predictable.
    if (stack.length > 50) stack.splice(0, stack.length - 50)
    setUndoDepth(stack.length)
  }, [selectedAudio, selectedClipId, selectedGraphicId, selectedLogoId, selectedLowerThirdId, selectedStillId, timeline])

  const snapshotUndoRef = useRef(snapshotUndo)
  useEffect(() => {
    snapshotUndoRef.current = snapshotUndo
  }, [snapshotUndo])

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
      setSelectedLogoId(snap.selectedLogoId)
      setSelectedLowerThirdId((snap as any).selectedLowerThirdId || null)
      setSelectedStillId(snap.selectedStillId)
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
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, rulerH + waveformH + trackH * 3, wCss, trackH)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, rulerH + waveformH + trackH * 4, wCss, trackH)

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
      const clipStartT = roundToTenth(clipStarts[clipIdx] || 0)
      const freezeStartT = 0
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
          const tComp = clipStartT + freezeStartT + rel
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

    // Logo + graphics + clip pills
    const logoY = LOGO_Y
    const lowerThirdY = LOWER_THIRD_Y
    const graphicsY = GRAPHICS_Y
    const videoY = VIDEO_Y
    const audioY = AUDIO_Y
    const pillH = PILL_H
    ctx.font = '900 12px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.textBaseline = 'middle'
    const activeDrag = trimDragging ? trimDragRef.current : null

    // Logo segments (topmost overlay lane; no overlaps)
    for (let i = 0; i < logos.length; i++) {
      const l: any = logos[i]
      const start = Math.max(0, Number(l?.startSeconds || 0))
      const end = Math.max(0, Number(l?.endSeconds || 0))
      const len = Math.max(0, end - start)
      if (len <= 0) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = String(l?.id) === String(selectedLogoId || '')
      const isDragging = Boolean(activeDrag) && (activeDrag as any).kind === 'logo' && String((activeDrag as any).logoId) === String(l?.id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      ctx.fillStyle = 'rgba(212,175,55,0.10)'
      roundRect(ctx, x, logoY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(212,175,55,0.55)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, logoY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, logoY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()
        ctx.restore()
      }

      const logoName = namesByUploadId[Number(l.uploadId)] || `Logo ${l.uploadId}`
      const cfgName = String(l?.configSnapshot?.name || '') || `Config ${l.configId}`
      const name = `${logoName} • ${cfgName}`
      ctx.fillStyle = '#fff'
      const padLeft = showHandles ? 6 + handleSize + 10 : 12
      const padRight = showHandles ? 6 + handleSize + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, logoY + pillH / 2)
      }

      if (showHandles) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const hs = handleSize
        const hy = logoY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        roundRect(ctx, hxR, hy, hs, hs, 4)
        ctx.fill()
      }

      if (isResizing) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const barW = 5
        const by = logoY + 3
        const bh = pillH - 6
        if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
        if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
      }
    }

    // Lower-third segments (below logos; no overlaps)
    for (let i = 0; i < lowerThirds.length; i++) {
      const lt: any = lowerThirds[i]
      const start = Math.max(0, Number(lt?.startSeconds || 0))
      const end = Math.max(0, Number(lt?.endSeconds || 0))
      const len = Math.max(0, end - start)
      if (len <= 0) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = String(lt?.id) === String(selectedLowerThirdId || '')
      const isDragging = Boolean(activeDrag) && (activeDrag as any).kind === 'lowerThird' && String((activeDrag as any).lowerThirdId) === String(lt?.id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      ctx.fillStyle = 'rgba(94,92,230,0.18)'
      roundRect(ctx, x, lowerThirdY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(94,92,230,0.55)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, lowerThirdY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, lowerThirdY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()
        ctx.restore()
      }

      const imgName = namesByUploadId[Number(lt.uploadId)] || `Lower third ${lt.uploadId}`
      const cfgName = String(lt?.configSnapshot?.name || '') || `Config ${lt.configId}`
      const name = `${imgName} • ${cfgName}`
      ctx.fillStyle = '#fff'
      const padLeft = showHandles ? 6 + handleSize + 10 : 12
      const padRight = showHandles ? 6 + handleSize + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, lowerThirdY + pillH / 2)
      }

      if (showHandles) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const hs = handleSize
        const hy = lowerThirdY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        roundRect(ctx, hxR, hy, hs, hs, 4)
        ctx.fill()
      }

      if (isResizing) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const barW = 5
        const by = lowerThirdY + 3
        const bh = pillH - 6
        if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
        if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
      }
    }

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
      const isDragging =
        Boolean(activeDrag) && (activeDrag as any).kind === 'graphic' && String((activeDrag as any).graphicId) === String((g as any).id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      ctx.fillStyle = 'rgba(10,132,255,0.18)'
      roundRect(ctx, x, graphicsY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(10,132,255,0.55)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, graphicsY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, graphicsY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()
        ctx.restore()
      }

      const name = namesByUploadId[g.uploadId] || `Image ${g.uploadId}`
      ctx.fillStyle = '#fff'
      const padLeft = showHandles ? 6 + handleSize + 10 : 12
      const padRight = showHandles ? 6 + handleSize + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, graphicsY + pillH / 2)
      }

      if (showHandles) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const hs = handleSize
        const hy = graphicsY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        roundRect(ctx, hxR, hy, hs, hs, 4)
        ctx.fill()
      }

      if (isResizing) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const barW = 5
        const by = graphicsY + 3
        const bh = pillH - 6
        if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
        if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
      }
    }

    // Freeze-frame still segments (base track)
    for (let i = 0; i < stills.length; i++) {
      const s: any = stills[i]
      const start = Math.max(0, Number(s?.startSeconds || 0))
      const end = Math.max(0, Number(s?.endSeconds || 0))
      const len = Math.max(0, end - start)
      if (len <= 0.01) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = String(s?.id) === String(selectedStillId || '')
      const isDragging = Boolean(activeDrag) && (activeDrag as any).kind === 'still' && String((activeDrag as any).stillId) === String(s?.id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      roundRect(ctx, x, videoY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(255,255,255,0.40)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, videoY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, videoY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()
        ctx.restore()
      }

      ctx.fillStyle = '#fff'
      const label = `Freeze ${len.toFixed(1)}s`
      const padLeft = showHandles ? 6 + handleSize + 10 : 12
      const padRight = showHandles ? 6 + handleSize + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, label, maxTextW)
        ctx.fillText(clipped, x + padLeft, videoY + pillH / 2)
      }

      if (showHandles) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const hs = handleSize
        const hy = videoY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        roundRect(ctx, hxR, hy, hs, hs, 4)
        ctx.fill()
      }

      if (isResizing) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const barW = 5
        const by = videoY + 3
        const bh = pillH - 6
        if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
        if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
      }
    }
    for (let i = 0; i < timeline.clips.length; i++) {
      const clip = timeline.clips[i]
      const start = (clipStarts[i] || 0)
      const len = Math.max(0, clipDurationSeconds(clip))
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = clip.id === selectedClipId
      const isDragging = Boolean(activeDrag) && (activeDrag as any).kind === 'clip' && String((activeDrag as any).clipId) === String(clip.id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      // pill background
      ctx.fillStyle = 'rgba(212,175,55,0.28)'
      roundRect(ctx, x, videoY, w, pillH, 10)
      ctx.fill()

      // pill border
      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(212,175,55,0.65)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, videoY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, videoY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()
        ctx.restore()
      }

      const name = namesByUploadId[clip.uploadId] || `Video ${clip.uploadId}`
      ctx.fillStyle = '#fff'
      const padLeft = showHandles ? 6 + handleSize + 10 : isSelected ? 18 : 12
      const padRight = showHandles ? 6 + handleSize + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, videoY + pillH / 2)
      }

      if (showHandles) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const hs = handleSize
        const hy = videoY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        roundRect(ctx, hxR, hy, hs, hs, 4)
        ctx.fill()
      }

      if (isResizing) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const barW = 5
        const by = videoY + 3
        const bh = pillH - 6
        if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
        if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
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
          const isDragging = Boolean(activeDrag) && (activeDrag as any).kind === 'audio'
          const activeEdge = isDragging ? String((activeDrag as any).edge) : null
          const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
          const showHandles = (isSelected || isDragging) && w >= 28
          const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0
          ctx.fillStyle = 'rgba(48,209,88,0.18)'
          roundRect(ctx, x, audioY, w, pillH, 10)
          ctx.fill()

          ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(48,209,88,0.55)'
          ctx.lineWidth = 1
          roundRect(ctx, x + 0.5, audioY + 0.5, w - 1, pillH - 1, 10)
          ctx.stroke()

          if (isResizing) {
            ctx.save()
            ctx.setLineDash([6, 4])
            ctx.strokeStyle = 'rgba(212,175,55,0.92)'
            ctx.lineWidth = 2
            roundRect(ctx, x + 0.5, audioY + 0.5, w - 1, pillH - 1, 10)
            ctx.stroke()
            ctx.restore()
          }

          const audioName = namesByUploadId[audioTrack.uploadId] || `Audio ${audioTrack.uploadId}`
          const cfgName = audioConfigNameById[audioTrack.audioConfigId] || `Config ${audioTrack.audioConfigId}`
          const label = `${audioName} • ${cfgName}`
          ctx.fillStyle = '#fff'
          const padLeft = showHandles ? 6 + handleSize + 10 : 12
          const padRight = showHandles ? 6 + handleSize + 10 : 12
          const maxTextW = Math.max(0, w - padLeft - padRight)
          if (maxTextW >= 20) {
            const clipped = ellipsizeText(ctx, label, maxTextW)
            ctx.fillText(clipped, x + padLeft, audioY + pillH / 2)
          }

          if (showHandles) {
            ctx.fillStyle = 'rgba(212,175,55,0.95)'
            const hs = handleSize
            const hy = audioY + Math.floor((pillH - handleSize) / 2)
            const hxL = x + 6
            const hxR = x + w - 6 - hs
            roundRect(ctx, hxL, hy, hs, hs, 4)
            ctx.fill()
            roundRect(ctx, hxR, hy, hs, hs, 4)
            ctx.fill()
          }

          if (isResizing) {
            ctx.fillStyle = 'rgba(212,175,55,0.95)'
            const barW = 5
            const by = audioY + 3
            const bh = pillH - 6
            if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
            if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
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
    graphics,
    logos,
    lowerThirds,
    stills,
    namesByUploadId,
    pxPerSecond,
    selectedAudio,
    selectedClipId,
    selectedClipIndex,
    selectedGraphicId,
    selectedLogoId,
    selectedLowerThirdId,
    selectedStillId,
    trimDragging,
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
          stills: Array.isArray(tlRaw?.stills) ? (tlRaw.stills as any) : [],
          graphics: Array.isArray(tlRaw?.graphics) ? (tlRaw.graphics as any) : [],
          logos: Array.isArray(tlRaw?.logos) ? (tlRaw.logos as any) : [],
          lowerThirds: Array.isArray(tlRaw?.lowerThirds) ? (tlRaw.lowerThirds as any) : [],
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
    const logoIds = logos.map((l) => Number((l as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
    const lowerThirdIds = lowerThirds.map((lt) => Number((lt as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
    const stillIds = (Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : [])
      .map((s) => Number(s?.uploadId))
      .filter((n) => Number.isFinite(n) && n > 0)
    const audioUploadId = Number((timeline as any).audioTrack?.uploadId)
    const audioIds = Number.isFinite(audioUploadId) && audioUploadId > 0 ? [audioUploadId] : []
    const ids = Array.from(new Set([...clipIds, ...graphicIds, ...logoIds, ...lowerThirdIds, ...stillIds, ...audioIds]))
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
  }, [durationsByUploadId, graphics, logos, lowerThirds, namesByUploadId, timeline.clips])

  const seek = useCallback(
    async (t: number, opts?: { autoPlay?: boolean }) => {
      const v = videoRef.current
      if (!v) return
      const tClamped = clamp(roundToTenth(t), 0, Math.max(0, totalSeconds))
      if (!timeline.clips.length) return
      // Freeze-frame stills are a base-track segment: pause the video and let the still image render as an overlay.
      if (findStillAtTime(tClamped)) {
        try { v.pause() } catch {}
        setActiveUploadId(null)
        return
      }
      const idx = findClipIndexAtTime(tClamped, timeline.clips, clipStarts)
      if (idx < 0) {
        activeClipIndexRef.current = Math.max(0, clipStarts.findIndex((s) => Number(s) > tClamped + 1e-6))
        try { v.pause() } catch {}
        setActiveUploadId(null)
        return
      }
      activeClipIndexRef.current = idx
      const clip = timeline.clips[idx]
      if (!clip) return
      const startTimeline = Number(clipStarts[idx] || 0)
      const within = Math.max(0, tClamped - startTimeline)
      const srcDur = clipSourceDurationSeconds(clip)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = clip.sourceStartSeconds + withinMoving
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
            void (async () => {
              const ok = await playWithAutoplayFallback(v)
              if (!ok) setPlaying(false)
            })()
          }
        }
        v.addEventListener('loadedmetadata', onMeta)
      } else {
        try { v.currentTime = Math.max(0, sourceTime) } catch {}
        if (opts?.autoPlay) {
          void (async () => {
            const ok = await playWithAutoplayFallback(v)
            if (!ok) setPlaying(false)
          })()
        }
      }
    },
    [activeUploadId, clipStarts, findStillAtTime, playWithAutoplayFallback, timeline.clips, totalSeconds]
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

  // Prefetch CloudFront-signed file URLs for image assets (graphics + logos + freeze-frame stills) so playback doesn't stall.
  useEffect(() => {
    const ids = Array.from(
      new Set(
        [
          ...graphics.map((g) => Number(g.uploadId)).filter((n) => Number.isFinite(n) && n > 0),
          ...logos.map((l) => Number((l as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0),
          ...stills.map((s) => Number((s as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0),
        ]
      )
    )
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
  }, [graphicFileUrlByUploadId, graphics, logos, stills])

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
    setSelectedStillId(null)
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

    if (playing) {
      setPlaying(false)
      const curGap = gapPlaybackRef.current
      if (curGap) {
        window.cancelAnimationFrame(curGap.raf)
        gapPlaybackRef.current = null
      }
      try { v?.pause?.() } catch {}
      return
    }

    if (!v) return
    const idx = findClipIndexAtTime(playhead, timeline.clips, clipStarts)
    if (idx < 0) {
      // Start gap playback (or trailing playback) even when no clip is active at the playhead.
      setPlaying(true)
      return
    }

    if (v.paused) {
      try {
        v.muted = false
        v.volume = 1
      } catch {}
      void seek(playhead, { autoPlay: true })
    } else {
      try { v.pause() } catch {}
    }
  }, [clipStarts, playhead, playing, primeAutoplayUnlock, seek, timeline.clips, totalSeconds])

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
    const onPause = () => {
      if (suppressNextVideoPauseRef.current) {
        suppressNextVideoPauseRef.current = false
        return
      }
      setPlaying(false)
    }
    const onTime = () => {
      if (!playing) return
      if (!timeline.clips.length) return
      // `timeupdate` can fire during seeks/pauses; while paused we drive the playhead via gap playback.
      if (v.paused) return
      const clipIndex = Math.max(0, Math.min(activeClipIndexRef.current, timeline.clips.length - 1))
      const clip = timeline.clips[clipIndex]
      if (!clip) return
      const startTimeline = clipStarts[clipIndex] || 0
      const withinNow = Math.max(0, (v.currentTime || 0) - clip.sourceStartSeconds)
      const srcDur = clipSourceDurationSeconds(clip)

      // Map video time to timeline time.
      const nextPlayhead = startTimeline + withinNow
      const next = clamp(roundToTenth(nextPlayhead), 0, Math.max(0, totalSeconds))
      if (Math.abs(next - playhead) >= 0.1) {
        playheadFromVideoRef.current = true
        setTimeline((prev) => ({ ...prev, playheadSeconds: next }))
      }

      const clipLen = clipDurationSeconds(clip)
      const endTimeline = roundToTenth(startTimeline + clipLen)
      if (withinNow >= srcDur - 0.12 && clipIndex < timeline.clips.length - 1) {
        const nextStart = roundToTenth(Number(clipStarts[clipIndex + 1] || 0))
        if (nextStart > endTimeline + 0.05) {
          // Enter a black-gap segment; the gap playback loop will advance to nextStart.
          suppressNextVideoPauseRef.current = true
          try { v.pause() } catch {}
          setActiveUploadId(null)
          playheadFromVideoRef.current = true
          setTimeline((prev) => ({ ...prev, playheadSeconds: endTimeline }))
          return
        }
        activeClipIndexRef.current = clipIndex + 1
        playheadFromVideoRef.current = true
        setTimeline((prev) => ({ ...prev, playheadSeconds: nextStart }))
        void seek(nextStart, { autoPlay: true })
      } else if (withinNow >= srcDur - 0.05 && clipIndex === timeline.clips.length - 1) {
        if (totalSeconds > endTimeline + 0.05) {
          // Allow trailing black/graphics to play out to totalSeconds.
          suppressNextVideoPauseRef.current = true
          try { v.pause() } catch {}
          setActiveUploadId(null)
          playheadFromVideoRef.current = true
          setTimeline((prev) => ({ ...prev, playheadSeconds: endTimeline }))
          return
        }
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

  // Gap playback for absolute-positioned clips: advance the playhead through black gaps.
  useEffect(() => {
    if (!timeline.clips.length) return
    if (!playing) {
      const cur = gapPlaybackRef.current
      if (cur) {
        window.cancelAnimationFrame(cur.raf)
        gapPlaybackRef.current = null
      }
      return
    }

    const idx = findClipIndexAtTime(playhead, timeline.clips, clipStarts)
    if (idx >= 0) {
      const cur = gapPlaybackRef.current
      if (cur) {
        window.cancelAnimationFrame(cur.raf)
        gapPlaybackRef.current = null
      }
      return
    }

    const eps = 0.05
    let nextClipIndex: number | null = null
    for (let i = 0; i < clipStarts.length; i++) {
      const s = Number(clipStarts[i] || 0)
      if (s > playhead + eps) {
        nextClipIndex = i
        break
      }
    }
    const target = nextClipIndex != null ? roundToTenth(Number(clipStarts[nextClipIndex] || 0)) : roundToTenth(totalSeconds)
    if (!(target > playhead + 0.01)) {
      setPlaying(false)
      return
    }

    const existing = gapPlaybackRef.current
    if (existing && Math.abs(existing.target - target) < 0.05) return
    if (existing) {
      window.cancelAnimationFrame(existing.raf)
      gapPlaybackRef.current = null
    }

    let last = performance.now()
    const tick = (now: number) => {
      const curState = gapPlaybackRef.current
      if (!curState) return
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      const cur = Number(playheadRef.current || 0)
      let next = cur + dt
      if (next >= target - 0.001) next = target
      playheadFromVideoRef.current = true
      playheadRef.current = next
      setTimeline((prev) => ({ ...prev, playheadSeconds: roundToTenth(next) }))
      if (next >= target - 0.001) {
        gapPlaybackRef.current = null
        if (nextClipIndex != null) {
          activeClipIndexRef.current = nextClipIndex
          void seek(target, { autoPlay: true })
        } else {
          setPlaying(false)
        }
        return
      }
      const raf = window.requestAnimationFrame(tick)
      gapPlaybackRef.current = { raf, target, nextClipIndex }
    }
    const raf = window.requestAnimationFrame(tick)
    gapPlaybackRef.current = { raf, target, nextClipIndex }
  }, [clipStarts, playhead, playing, seek, timeline.clips.length, totalSeconds])

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

  const openLogoPicker = useCallback(async () => {
    if (!me?.userId) return
    setLogoPickerLoading(true)
    setLogoPickerError(null)
    try {
      const params = new URLSearchParams({
        kind: 'logo',
        status: 'uploaded,completed',
        user_id: String(me.userId),
        limit: '200',
      })
      const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: UploadListItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      setLogoPickerItems(items)
    } catch (e: any) {
      setLogoPickerError(e?.message || 'Failed to load logos')
    } finally {
      setLogoPickerLoading(false)
    }
  }, [me?.userId])

  const ensureLogoConfigs = useCallback(async (): Promise<LogoConfigItem[]> => {
    if (logoConfigsLoaded) return logoConfigs
    setLogoConfigsError(null)
    try {
      const res = await fetch(`/api/logo-configs`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: LogoConfigItem[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : []
      setLogoConfigs(items)
      setLogoConfigsLoaded(true)
      return items
    } catch (e: any) {
      setLogoConfigsError(e?.message || 'Failed to load logo configs')
      setLogoConfigsLoaded(true)
      return []
    }
  }, [logoConfigs, logoConfigsLoaded])

  const openLowerThirdPicker = useCallback(async () => {
    if (!me?.userId) return
    setLowerThirdPickerLoading(true)
    setLowerThirdPickerError(null)
    try {
      const params = new URLSearchParams({
        kind: 'image',
        image_role: 'lower_third',
        status: 'uploaded,completed',
        user_id: String(me.userId),
        limit: '200',
      })
      const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: UploadListItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      setLowerThirdPickerItems(items)
    } catch (e: any) {
      setLowerThirdPickerError(e?.message || 'Failed to load lower third images')
    } finally {
      setLowerThirdPickerLoading(false)
    }
  }, [me?.userId])

  const ensureLowerThirdConfigs = useCallback(async (): Promise<LowerThirdConfigItem[]> => {
    if (lowerThirdConfigsLoaded) return lowerThirdConfigs
    setLowerThirdConfigsError(null)
    try {
      const res = await fetch(`/api/lower-third-configs?limit=200`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: LowerThirdConfigItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      setLowerThirdConfigs(items)
      setLowerThirdConfigsLoaded(true)
      return items
    } catch (e: any) {
      setLowerThirdConfigsError(e?.message || 'Failed to load lower third configs')
      setLowerThirdConfigsLoaded(true)
      return []
    }
  }, [lowerThirdConfigs, lowerThirdConfigsLoaded])

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

  // If a timeline already has an audio track (hydrated from a saved draft), prefetch audio configs
  // so labels render as "{audio_name} * {audioConfig_name}" without requiring opening the editor.
  useEffect(() => {
    if (!audioTrack) return
    if (audioConfigsLoaded) return
    void ensureAudioConfigs()
  }, [audioConfigsLoaded, audioTrack, ensureAudioConfigs])

  // If a timeline already has logo segments (hydrated from a saved draft), prefetch logo configs so
  // the Logo Properties editor can show the config list immediately.
  useEffect(() => {
    if (!logos.length) return
    if (logoConfigsLoaded) return
    void ensureLogoConfigs()
  }, [ensureLogoConfigs, logoConfigsLoaded, logos.length])

  // If a timeline already has lower-third segments (hydrated from a saved draft), prefetch lower-third configs so
  // the properties editor can show the config list immediately.
  useEffect(() => {
    if (!lowerThirds.length) return
    if (lowerThirdConfigsLoaded) return
    void ensureLowerThirdConfigs()
  }, [ensureLowerThirdConfigs, lowerThirdConfigsLoaded, lowerThirds.length])

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
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
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
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
      setSelectedAudio(false)
      setPickOpen(false)
      setAddStep('type')
    },
    [graphics, playhead, snapshotUndo, timeline.clips.length, totalSecondsVideo]
  )

  const chooseLogoUpload = useCallback(
    async (upload: UploadListItem) => {
      const id = Number(upload.id)
      if (!Number.isFinite(id) || id <= 0) return
      setPendingLogoUploadId(id)
      const name = String(upload.modified_filename || upload.original_filename || `Logo ${upload.id}`)
      setNamesByUploadId((prev) => (prev[id] ? prev : { ...prev, [id]: name }))
      await ensureLogoConfigs()
      setAddStep('logoConfig')
    },
    [ensureLogoConfigs]
  )

  const addLogoFromPending = useCallback(
    (configIdRaw: number) => {
      const uploadId = pendingLogoUploadId
      if (!uploadId) return
      const cfgId = Number(configIdRaw)
      if (!Number.isFinite(cfgId) || cfgId <= 0) {
        setLogoPickerError('Pick a logo configuration.')
        return
      }
      const cfg = logoConfigs.find((c) => Number((c as any).id) === cfgId) || null
      if (!cfg) {
        setLogoPickerError('Logo configuration not found.')
        return
      }
      if (!(totalSeconds > 0)) {
        setLogoPickerError('Add a video or graphic first.')
        return
      }

      const dur = 5.0
      const id = `logo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const start0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
      let start = start0
      let end = roundToTenth(start + dur)
      if (end > totalSeconds + 1e-6) {
        setLogoPickerError('Not enough room to add a 5s logo segment within the timeline.')
        return
      }

      // Disallow overlaps: slide forward to the next available slot.
      const existing = logos.slice().sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
      for (let i = 0; i < existing.length; i++) {
        const l = existing[i] as any
        const ls = Number(l.startSeconds)
        const le = Number(l.endSeconds)
        if (!(Number.isFinite(ls) && Number.isFinite(le))) continue
        const overlaps = start < le - 1e-6 && end > ls + 1e-6
        if (overlaps) {
          start = roundToTenth(le)
          end = roundToTenth(start + dur)
          i = -1
          if (end > totalSeconds + 1e-6) {
            setLogoPickerError('No available slot for a 5s logo segment without overlapping.')
            return
          }
        }
      }

      const seg: Logo = {
        id,
        uploadId: Number(uploadId),
        startSeconds: start,
        endSeconds: end,
        configId: cfgId,
        configSnapshot: cfg as any,
      }
      snapshotUndo()
      setTimeline((prev) => {
        const prevLogos: Logo[] = Array.isArray((prev as any).logos) ? ((prev as any).logos as any) : []
        const next = [...prevLogos, seg].sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
        return { ...prev, logos: next }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedStillId(null)
      setSelectedAudio(false)
      setSelectedLogoId(id)
      setSelectedLowerThirdId(null)
      setPickOpen(false)
      setAddStep('type')
      setPendingLogoUploadId(null)
    },
    [logoConfigs, logos, pendingLogoUploadId, playhead, snapshotUndo, totalSeconds]
  )

  const chooseLowerThirdUpload = useCallback(
    async (upload: UploadListItem) => {
      const id = Number(upload.id)
      if (!Number.isFinite(id) || id <= 0) return
      setPendingLowerThirdUploadId(id)
      const name = String(upload.modified_filename || upload.original_filename || `Lower third ${upload.id}`)
      setNamesByUploadId((prev) => (prev[id] ? prev : { ...prev, [id]: name }))
      const w = upload.width != null ? Number(upload.width) : null
      const h = upload.height != null ? Number(upload.height) : null
      if (w != null && h != null && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        setDimsByUploadId((prev) => (prev[id] ? prev : { ...prev, [id]: { width: Math.round(w), height: Math.round(h) } }))
      }
      await ensureLowerThirdConfigs()
      setAddStep('lowerThirdConfig')
    },
    [ensureLowerThirdConfigs]
  )

  const addLowerThirdFromPending = useCallback(
    (configIdRaw: number) => {
      const uploadId = pendingLowerThirdUploadId
      if (!uploadId) return
      const cfgId = Number(configIdRaw)
      if (!Number.isFinite(cfgId) || cfgId <= 0) {
        setLowerThirdPickerError('Pick a lower third configuration.')
        return
      }
      const cfg = lowerThirdConfigs.find((c: any) => Number((c as any).id) === cfgId) || null
      if (!cfg) {
        setLowerThirdPickerError('Lower third configuration not found.')
        return
      }
      if (!(totalSeconds > 0)) {
        setLowerThirdPickerError('Add a video or graphic first.')
        return
      }

      const dur = 10.0
      const id = `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const start0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
      let start = start0
      let end = roundToTenth(start + dur)
      if (end > totalSeconds + 1e-6) {
        setLowerThirdPickerError('Not enough room to add a 10s lower third segment within the timeline.')
        return
      }

      // Disallow overlaps: slide forward to the next available slot.
      const existing = lowerThirds.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
      for (let i = 0; i < existing.length; i++) {
        const lt = existing[i] as any
        const ls = Number(lt.startSeconds)
        const le = Number(lt.endSeconds)
        if (!(Number.isFinite(ls) && Number.isFinite(le))) continue
        const overlaps = start < le - 1e-6 && end > ls + 1e-6
        if (overlaps) {
          start = roundToTenth(le)
          end = roundToTenth(start + dur)
          i = -1
          if (end > totalSeconds + 1e-6) {
            setLowerThirdPickerError('No available slot for a 10s lower third segment without overlapping.')
            return
          }
        }
      }

      const seg: LowerThird = {
        id,
        uploadId: Number(uploadId),
        startSeconds: start,
        endSeconds: end,
        configId: cfgId,
        configSnapshot: cfg as any,
      }
      snapshotUndo()
      setTimeline((prev) => {
        const prevLts: LowerThird[] = Array.isArray((prev as any).lowerThirds) ? ((prev as any).lowerThirds as any) : []
        const next = [...prevLts, seg].sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
        return { ...prev, lowerThirds: next }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedStillId(null)
      setSelectedAudio(false)
      setSelectedLowerThirdId(id)
      setPickOpen(false)
      setAddStep('type')
      setPendingLowerThirdUploadId(null)
    },
    [lowerThirdConfigs, lowerThirds, pendingLowerThirdUploadId, playhead, snapshotUndo, totalSeconds]
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
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
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
    if (selectedClipId) {
      const res = splitClipAtPlayhead(timeline, selectedClipId)
      if (res.timeline === timeline && res.selectedClipId === selectedClipId) return
      if (res.timeline.clips === timeline.clips) return
      snapshotUndo()
      setTimeline(res.timeline)
      setSelectedClipId(res.selectedClipId)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedAudio(false)
      return
    }
    if (selectedLogoId) {
      const res = splitLogoAtPlayhead(timeline as any, selectedLogoId)
      const prevLogos = Array.isArray((timeline as any).logos) ? (timeline as any).logos : []
      const nextLogos = Array.isArray((res.timeline as any).logos) ? (res.timeline as any).logos : []
      if (res.timeline === (timeline as any) && res.selectedLogoId === selectedLogoId) return
      if (nextLogos === prevLogos) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(res.selectedLogoId)
      setSelectedLowerThirdId(null)
      setSelectedAudio(false)
      return
    }
    if (selectedLowerThirdId) {
      const res = splitLowerThirdAtPlayhead(timeline as any, selectedLowerThirdId)
      const prevLts = Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : []
      const nextLts = Array.isArray((res.timeline as any).lowerThirds) ? (res.timeline as any).lowerThirds : []
      if (res.timeline === (timeline as any) && res.selectedLowerThirdId === selectedLowerThirdId) return
      if (nextLts === prevLts) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(res.selectedLowerThirdId)
      setSelectedAudio(false)
      return
    }
    if (selectedGraphicId) {
      const res = splitGraphicAtPlayhead(timeline, selectedGraphicId)
      const prevGraphics = Array.isArray((timeline as any).graphics) ? (timeline as any).graphics : []
      const nextGraphics = Array.isArray((res.timeline as any).graphics) ? (res.timeline as any).graphics : []
      if (res.timeline === timeline && res.selectedGraphicId === selectedGraphicId) return
      if (nextGraphics === prevGraphics) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      setSelectedClipId(null)
      setSelectedGraphicId(res.selectedGraphicId)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedAudio(false)
    }
  }, [clipStarts, playhead, selectedClipId, selectedGraphicId, selectedLogoId, selectedLowerThirdId, snapshotUndo, timeline])

  const deleteSelected = useCallback(() => {
    if (selectedAudio) {
      if (!audioTrack) return
      snapshotUndo()
      setTimeline((prev) => ({ ...prev, audioTrack: null }))
      setSelectedAudio(false)
      return
    }

    if (selectedStillId) {
      const target = selectedStill
      if (!target) return
      snapshotUndo()
      setTimeline((prev) => {
        const prevStills: any[] = Array.isArray((prev as any).stills) ? (prev as any).stills : []
        const nextStills = prevStills.filter((s: any) => String(s.id) !== String(target.id))
        return { ...(prev as any), stills: nextStills } as any
      })
      setSelectedStillId(null)
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

    if (selectedLogoId) {
      const target = selectedLogo
      if (!target) return
      snapshotUndo()
      setTimeline((prev) => {
        const prevLogos: any[] = Array.isArray((prev as any).logos) ? (prev as any).logos : []
        const nextLogos = prevLogos.filter((l: any) => String(l.id) !== String(target.id))
        return { ...(prev as any), logos: nextLogos } as any
      })
      setSelectedLogoId(null)
      return
    }

    if (selectedLowerThirdId) {
      const target = selectedLowerThird
      if (!target) return
      snapshotUndo()
      setTimeline((prev) => {
        const prevLts: any[] = Array.isArray((prev as any).lowerThirds) ? (prev as any).lowerThirds : []
        const nextLts = prevLts.filter((lt: any) => String(lt.id) !== String((target as any).id))
        return { ...(prev as any), lowerThirds: nextLts } as any
      })
      setSelectedLowerThirdId(null)
      return
    }

    if (!timeline.clips.length) return
    const fallbackIdx = findClipIndexAtTime(playhead, timeline.clips, clipStarts)
    const fallback = fallbackIdx >= 0 ? (timeline.clips[fallbackIdx] || null) : null
    const target = selectedClip || fallback
    if (!target) return
    snapshotUndo()
    setTimeline((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === target.id)
      if (idx < 0) return prev
      const next = prev.clips.filter((c) => c.id !== target.id)
      const nextTimeline: any = { ...prev, clips: next }
      const nextTotal = computeTotalSecondsForTimeline(nextTimeline)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...nextTimeline, playheadSeconds: nextPlayhead }
    })
    // If we deleted the currently-loaded upload, force re-seek when a new clip is added/selected.
    setActiveUploadId((prev) => (prev === Number(target.uploadId) ? null : prev))
    setSelectedGraphicId(null)
    setSelectedLogoId(null)
    setSelectedStillId(null)
    setSelectedAudio(false)
    // Keep selection stable by selecting the next clip (or previous if we deleted the last).
    setSelectedClipId((prevSel) => {
      const wasSelected = prevSel === target.id
      if (!wasSelected && prevSel) return prevSel
      const nextIdx = Math.min(fallbackIdx, Math.max(0, timeline.clips.length - 2))
      const nextClip = timeline.clips.filter((c) => c.id !== target.id)[nextIdx] || null
      return nextClip ? nextClip.id : null
    })
  }, [audioTrack, clipStarts, playhead, selectedAudio, selectedClip, selectedGraphic, selectedGraphicId, selectedStill, selectedStillId, snapshotUndo, timeline.clips])

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

    // Prevent overlap with the next clip when clips are absolutely positioned.
    const idxCurrent = timeline.clips.findIndex((c) => c.id === clipEditor.id)
    if (idxCurrent >= 0) {
      const startTimeline = Number(clipStarts[idxCurrent] || 0)
      const durTimeline = roundToTenth(Math.max(0, end - start))
      // Find the next clip start strictly after this clip's start.
      let nextStart = Number.POSITIVE_INFINITY
      for (let i = 0; i < clipStarts.length; i++) {
        if (i === idxCurrent) continue
        const s = Number(clipStarts[i] || 0)
        if (s > startTimeline + 1e-6 && s < nextStart) nextStart = s
      }
      for (const st of stills as any[]) {
        const s = Number((st as any)?.startSeconds || 0)
        if (s > startTimeline + 1e-6 && s < nextStart) nextStart = s
      }
      if (Number.isFinite(nextStart) && nextStart < Number.POSITIVE_INFINITY) {
        const maxDurTimeline = roundToTenth(Math.max(0, nextStart - startTimeline))
        if (durTimeline > maxDurTimeline + 1e-6) {
          setClipEditorError(`Clip overlaps next clip (max ${maxDurTimeline.toFixed(1)}s at this position).`)
          return
        }
      }
    }
    snapshotUndo()
    setTimeline((prev) => {
      const idx = prev.clips.findIndex((c) => c.id === clipEditor.id)
      if (idx < 0) return prev
      // Normalize to explicit startSeconds so edits don't implicitly shift later clips.
      const starts = computeClipStarts(prev.clips)
      const normalized: Clip[] = prev.clips.map((c, i) => ({ ...c, startSeconds: roundToTenth(starts[i] || 0) }))
      const clip = normalized[idx]
      const maxEnd = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
      const safeStart = Math.max(0, start)
      const safeEnd = Math.min(maxEnd, Math.max(safeStart + 0.2, end))
      const updated: Clip = {
        ...clip,
        sourceStartSeconds: safeStart,
        sourceEndSeconds: safeEnd,
      }
      const next = normalized.slice()
      next[idx] = updated
      const nextTimeline: any = { ...prev, clips: next }
      const nextTotal = computeTotalSecondsForTimeline(nextTimeline)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...nextTimeline, playheadSeconds: nextPlayhead }
    })
    setClipEditor(null)
  }, [clipEditor, clipStarts, durationsByUploadId, snapshotUndo, timeline.clips, computeTotalSecondsForTimeline, stills])

  const rippleInsert = useCallback(
    (tl: Timeline, atSeconds: number, insertSeconds: number): Timeline => {
      const at = roundToTenth(Math.max(0, Number(atSeconds || 0)))
      const delta = roundToTenth(Math.max(0, Number(insertSeconds || 0)))
      if (!(delta > 0)) return tl

      const starts = computeClipStarts(tl.clips)
      const normalizedClips: Clip[] = tl.clips.map((c, i) => ({
        ...c,
        startSeconds: roundToTenth(starts[i] || 0),
      }))

      const nextClips: Clip[] = normalizedClips.map((c) => {
        const s = roundToTenth(Number((c as any).startSeconds || 0))
        if (s + 1e-6 < at) return c
        return { ...c, startSeconds: roundToTenth(s + delta) }
      })

      const prevStills: Still[] = Array.isArray((tl as any).stills) ? (((tl as any).stills as any) as Still[]) : []
      const nextStills: Still[] = prevStills.map((s) => {
        const a = roundToTenth(Number((s as any).startSeconds || 0))
        const b = roundToTenth(Number((s as any).endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(s as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) } as any
        if (b > at + 1e-6) return { ...(s as any), endSeconds: roundToTenth(b + delta) } as any
        return s
      })

      const prevGraphics: Graphic[] = Array.isArray((tl as any).graphics) ? (((tl as any).graphics as any) as Graphic[]) : []
      const nextGraphics: Graphic[] = prevGraphics.map((g) => {
        const a = roundToTenth(Number((g as any).startSeconds || 0))
        const b = roundToTenth(Number((g as any).endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(g as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) } as any
        if (b > at + 1e-6) return { ...(g as any), endSeconds: roundToTenth(b + delta) } as any
        return g
      })

      const prevAudio = (tl as any).audioTrack && typeof (tl as any).audioTrack === 'object' ? ((tl as any).audioTrack as any) : null
      const nextAudio =
        prevAudio && typeof prevAudio === 'object'
          ? (() => {
              const a = roundToTenth(Number(prevAudio.startSeconds || 0))
              const b = roundToTenth(Number(prevAudio.endSeconds || 0))
              if (a + 1e-6 >= at) return { ...prevAudio, startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
              if (b > at + 1e-6) return { ...prevAudio, endSeconds: roundToTenth(b + delta) }
              return prevAudio
            })()
          : prevAudio

      const nextPlayhead = roundToTenth(Number(tl.playheadSeconds || 0) + (Number(tl.playheadSeconds || 0) + 1e-6 >= at ? delta : 0))

      const out: any = {
        ...tl,
        clips: nextClips.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        stills: nextStills.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        graphics: nextGraphics.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        audioTrack: nextAudio,
        playheadSeconds: nextPlayhead,
      }
      const nextTotal = computeTotalSecondsForTimeline(out as any)
      out.playheadSeconds = clamp(out.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return out as Timeline
    },
    [computeTotalSecondsForTimeline]
  )

  const insertFreezeStill = useCallback(
    async (which: 'first' | 'last') => {
      if (!clipEditor) return
      if (freezeInsertBusy) return
      setFreezeInsertBusy(true)
      setFreezeInsertError(null)
      setClipEditorError(null)
      try {
        const dur = roundToTenth(Number(freezeInsertSeconds || 0))
        if (!(dur > 0)) throw new Error('pick_duration')

        const idx = timeline.clips.findIndex((c) => c.id === clipEditor.id)
        if (idx < 0) throw new Error('clip_not_found')
        const clip = timeline.clips[idx]
        if (!clip) throw new Error('clip_not_found')

        // Require that trim changes are saved before inserting freeze segments.
        if (
          roundToTenth(Number(clipEditor.start)) !== roundToTenth(Number(clip.sourceStartSeconds)) ||
          roundToTenth(Number(clipEditor.end)) !== roundToTenth(Number(clip.sourceEndSeconds))
        ) {
          throw new Error('save_trim_first')
        }

        const clipStart = roundToTenth(Number(clipStarts[idx] || 0))
        const clipLen = roundToTenth(Math.max(0, clipSourceDurationSeconds(clip)))
        const clipEnd = roundToTenth(clipStart + clipLen)

        const insertAt = which === 'first' ? clipStart : clipEnd
        const atSeconds = which === 'first' ? Number(clip.sourceStartSeconds) : Math.max(0, Number(clip.sourceEndSeconds) - 0.05)

        const freezeUploadId = await waitForFreezeFrameUpload(Number(clip.uploadId), atSeconds)

        const stillId = `still_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
        const still: Still = {
          id: stillId,
          uploadId: freezeUploadId,
          startSeconds: roundToTenth(insertAt),
          endSeconds: roundToTenth(insertAt + dur),
          sourceClipId: String(clip.id),
        }

        snapshotUndo()
        const shifted = rippleInsert(cloneTimeline(timeline), insertAt, dur)
        const prevStills: Still[] = Array.isArray((shifted as any).stills) ? (((shifted as any).stills as any) as Still[]) : []
        const nextStills = [...prevStills, still].sort(
          (a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        setTimeline({ ...(shifted as any), stills: nextStills } as any)
        setSelectedStillId(stillId)
        setSelectedClipId(null)
        setSelectedGraphicId(null)
        setSelectedAudio(false)
        setClipEditor(null)
      } catch (e: any) {
        const msg = String(e?.message || 'failed')
        if (msg === 'save_trim_first') setFreezeInsertError('Save trim changes first (click Save), then insert a freeze frame.')
        else if (msg === 'freeze_timeout') setFreezeInsertError('Timed out while generating freeze frame. Try again.')
        else if (msg === 'freeze_failed') setFreezeInsertError('Freeze frame generation failed.')
        else if (msg === 'pick_duration') setFreezeInsertError('Pick a freeze duration.')
        else setFreezeInsertError('Failed to insert freeze frame.')
      } finally {
        setFreezeInsertBusy(false)
      }
    },
    [
      clipEditor,
      clipStarts,
      freezeInsertBusy,
      freezeInsertSeconds,
      rippleInsert,
      snapshotUndo,
      timeline,
      waitForFreezeFrameUpload,
    ]
  )

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
      const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), graphics: nextGraphics } as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, graphics: nextGraphics, playheadSeconds: nextPlayhead }
    })
    setGraphicEditor(null)
    setGraphicEditorError(null)
  }, [graphicEditor, graphics, snapshotUndo, timeline.clips.length, totalSecondsVideo])

  const saveLogoEditor = useCallback(() => {
    if (!logoEditor) return
    const start = roundToTenth(Number(logoEditor.start))
    const end = roundToTenth(Number(logoEditor.end))
    const configId = Number(logoEditor.configId)
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setLogoEditorError('End must be after start.')
      return
    }
    if (!Number.isFinite(configId) || configId <= 0) {
      setLogoEditorError('Pick a logo configuration.')
      return
    }

    const cap = 20 * 60
    if (end > cap + 1e-6) {
      setLogoEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
    }

    const cfg = logoConfigs.find((c: any) => Number((c as any).id) === configId) as any
    if (!cfg) {
      setLogoEditorError('Logo configuration not found.')
      return
    }

    // Disallow overlaps with other logo segments.
    for (const l of logos) {
      if (String((l as any).id) === String(logoEditor.id)) continue
      const ls = Number((l as any).startSeconds || 0)
      const le = Number((l as any).endSeconds || 0)
      if (!(Number.isFinite(ls) && Number.isFinite(le) && le > ls)) continue
      const overlaps = start < le - 1e-6 && end > ls + 1e-6
      if (overlaps) {
        setLogoEditorError('Logos cannot overlap in time.')
        return
      }
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevLogos: Logo[] = Array.isArray((prev as any).logos) ? ((prev as any).logos as any) : []
      const idx = prevLogos.findIndex((l) => String((l as any).id) === String(logoEditor.id))
      if (idx < 0) return prev
      const updated: Logo = {
        ...prevLogos[idx],
        startSeconds: Math.max(0, start),
        endSeconds: Math.max(0, end),
        configId,
        configSnapshot: cfg as any,
      }
      const nextLogos = prevLogos.slice()
      nextLogos[idx] = updated
      nextLogos.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), logos: nextLogos } as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, logos: nextLogos, playheadSeconds: nextPlayhead }
    })
    setLogoEditor(null)
    setLogoEditorError(null)
  }, [computeTotalSecondsForTimeline, logoConfigs, logoEditor, logos, snapshotUndo])

  const saveLowerThirdEditor = useCallback(() => {
    if (!lowerThirdEditor) return
    const start = roundToTenth(Number(lowerThirdEditor.start))
    const end = roundToTenth(Number(lowerThirdEditor.end))
    const configId = Number(lowerThirdEditor.configId)
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setLowerThirdEditorError('End must be after start.')
      return
    }
    if (!Number.isFinite(configId) || configId <= 0) {
      setLowerThirdEditorError('Pick a lower third configuration.')
      return
    }

    const cap = 20 * 60
    if (end > cap + 1e-6) {
      setLowerThirdEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
    }

    const cfg = lowerThirdConfigs.find((c: any) => Number((c as any).id) === configId) as any
    if (!cfg) {
      setLowerThirdEditorError('Lower third configuration not found.')
      return
    }

    // Disallow overlaps with other lower thirds.
    for (const lt of lowerThirds) {
      if (String((lt as any).id) === String(lowerThirdEditor.id)) continue
      const ls = Number((lt as any).startSeconds || 0)
      const le = Number((lt as any).endSeconds || 0)
      if (!(Number.isFinite(ls) && Number.isFinite(le) && le > ls)) continue
      const overlaps = start < le - 1e-6 && end > ls + 1e-6
      if (overlaps) {
        setLowerThirdEditorError('Lower thirds cannot overlap in time.')
        return
      }
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevLts: LowerThird[] = Array.isArray((prev as any).lowerThirds) ? ((prev as any).lowerThirds as any) : []
      const idx = prevLts.findIndex((lt) => String((lt as any).id) === String(lowerThirdEditor.id))
      if (idx < 0) return prev
      const updated: LowerThird = {
        ...prevLts[idx],
        startSeconds: Math.max(0, start),
        endSeconds: Math.max(0, end),
        configId,
        configSnapshot: cfg as any,
      }
      const nextLts = prevLts.slice()
      nextLts[idx] = updated
      nextLts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), lowerThirds: nextLts } as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, lowerThirds: nextLts, playheadSeconds: nextPlayhead }
    })
    setLowerThirdEditor(null)
    setLowerThirdEditorError(null)
  }, [computeTotalSecondsForTimeline, lowerThirdConfigs, lowerThirdEditor, lowerThirds, snapshotUndo])

  const openAdd = useCallback(() => {
    setPickOpen(true)
    setAddStep('type')
    setPickerError(null)
    setGraphicPickerError(null)
    setLogoPickerError(null)
    setLowerThirdPickerError(null)
    setAudioPickerError(null)
    setAudioConfigsError(null)
    setLogoConfigsError(null)
    setLowerThirdConfigsError(null)
    setPendingLogoUploadId(null)
    setPendingLowerThirdUploadId(null)
  }, [])

  const closeAdd = useCallback(() => {
    setPickOpen(false)
    setAddStep('type')
    setPendingLogoUploadId(null)
    setPendingLowerThirdUploadId(null)
  }, [])

  // Global listeners (always attached) so quick drags can't miss the pointerup and leave the timeline "locked".
  useEffect(() => {
	    const onMove = (e: PointerEvent) => {
	      const drag = trimDragRef.current
	      if (!drag) return
	      if (e.pointerId !== drag.pointerId) return

	      // Special case: "armed" moves (body-drag). Don't start dragging until the pointer has moved a bit,
	      // otherwise a simple click on the selected pill can't open the properties modal.
	      if ((drag.kind === 'logo' || drag.kind === 'lowerThird') && drag.edge === 'move' && (drag as any).armed) {
	        const dx0 = e.clientX - drag.startClientX
	        const dy0 = e.clientY - Number((drag as any).startClientY ?? e.clientY)
	        const moved = Boolean((drag as any).moved)
	        if (!moved) {
	          const thresholdPx = 6
	          if (Math.abs(dx0) < thresholdPx && Math.abs(dy0) < thresholdPx) return
	          ;(drag as any).moved = true
	          ;(drag as any).armed = false
	          trimDragLockScrollLeftRef.current = timelineScrollRef.current ? timelineScrollRef.current.scrollLeft : null
	          try { snapshotUndoRef.current?.() } catch {}
	          setTrimDragging(true)
	          dbg('startTrimDrag', { kind: drag.kind, edge: 'move', id: String((drag as any).logoId || (drag as any).lowerThirdId || '') })
	        }
	      }

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
            // Normalize to explicit startSeconds so collision math is stable even if older timelines omitted startSeconds.
            const prevStarts = computeClipStarts(prev.clips)
            const normalizedClips: Clip[] = prev.clips.map((c, i) => ({ ...c, startSeconds: roundToTenth(prevStarts[i] || 0) }))
            const idx = normalizedClips.findIndex((c) => c.id === drag.clipId)
            if (idx < 0) return prev
            const c = normalizedClips[idx]
            const next = normalizedClips.slice()
            const prevStills: any[] = Array.isArray((prev as any).stills) ? (prev as any).stills : []

          if (drag.edge === 'move') {
            const dur = Math.max(0.2, roundToTenth(clipDurationSeconds(c)))
            const minStartSeconds = drag.minStartSeconds != null ? Number(drag.minStartSeconds) : 0
            const maxEndSeconds = drag.maxEndSeconds != null ? Number(drag.maxEndSeconds) : 20 * 60
            const maxStartSeconds =
              drag.maxStartSeconds != null ? Number(drag.maxStartSeconds) : Math.max(minStartSeconds, roundToTenth(maxEndSeconds - dur))
            let startTimeline = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), minStartSeconds, maxStartSeconds)

            // Safety valve: never allow moving a clip into a freeze-frame still segment (or any other base-track segment).
            // We mostly rely on pointerdown-time constraints, but dynamic enforcement keeps behavior correct if neighbors change.
            const otherBaseRanges: Array<{ start: number; end: number }> = []
            for (let i = 0; i < next.length; i++) {
              if (i === idx) continue
              const s = roundToTenth(Number((next[i] as any).startSeconds || 0))
              const e = roundToTenth(s + clipDurationSeconds(next[i]))
              if (e > s) otherBaseRanges.push({ start: s, end: e })
            }
            for (const st of prevStills) {
              const s = roundToTenth(Number((st as any).startSeconds || 0))
              const e = roundToTenth(Number((st as any).endSeconds || 0))
              if (e > s) otherBaseRanges.push({ start: s, end: e })
            }
            otherBaseRanges.sort((a, b) => a.start - b.start || a.end - b.end)
            const movingRight = deltaSeconds >= 0
            for (let guard = 0; guard < 6; guard++) {
              const endTimeline = roundToTenth(startTimeline + dur)
              const hit = otherBaseRanges.find((r) => startTimeline < r.end - 1e-6 && endTimeline > r.start + 1e-6)
              if (!hit) break
              if (movingRight) startTimeline = roundToTenth(Math.max(minStartSeconds, hit.start - dur))
              else startTimeline = roundToTenth(Math.min(maxStartSeconds, hit.end))
              startTimeline = clamp(startTimeline, minStartSeconds, maxStartSeconds)
            }

            next[idx] = { ...c, startSeconds: startTimeline }
            next.sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
	          } else {
	            let startS = c.sourceStartSeconds
	            let endS = c.sourceEndSeconds
	            const maxTimelineDur = drag.maxTimelineDurationSeconds != null ? Number(drag.maxTimelineDurationSeconds) : Number.POSITIVE_INFINITY
	            if (drag.edge === 'start') {
	              startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), 0, Math.max(0, drag.startEndSeconds - minLen))
	              if (Number.isFinite(maxTimelineDur) && maxTimelineDur > 0) {
	                const maxSourceDur = Math.max(minLen, roundToTenth(maxTimelineDur))
	                startS = Math.max(startS, roundToTenth(drag.startEndSeconds - maxSourceDur))
	              }
	            } else {
	              endS = clamp(
	                roundToTenth(drag.startEndSeconds + deltaSeconds),
	                Math.max(0, drag.startStartSeconds + minLen),
	                drag.maxDurationSeconds
	              )
	              if (Number.isFinite(maxTimelineDur) && maxTimelineDur > 0) {
	                const maxSourceDur = Math.max(minLen, roundToTenth(maxTimelineDur))
	                endS = Math.min(endS, roundToTenth(drag.startStartSeconds + maxSourceDur))
	              }
	              endS = Math.max(endS, startS + minLen)
	            }

	            // Safety valve: trimming that extends duration must never overlap the next base-track segment
	            // (including freeze-frame stills). We already constrain at pointerdown-time, but this keeps
	            // behavior correct if nearby items change while dragging.
	            const clipStartTimeline = roundToTenth(Number((c as any).startSeconds || 0))
	            if (Number.isFinite(clipStartTimeline)) {
	              const otherBaseStarts: number[] = []
	              for (let i = 0; i < next.length; i++) {
	                if (i === idx) continue
	                const s = roundToTenth(Number((next[i] as any).startSeconds || 0))
	                if (Number.isFinite(s) && s > clipStartTimeline + 1e-6) otherBaseStarts.push(s)
	              }
	              for (const st of prevStills) {
	                const s = roundToTenth(Number((st as any)?.startSeconds || 0))
	                if (Number.isFinite(s) && s > clipStartTimeline + 1e-6) otherBaseStarts.push(s)
	              }
	              const nextBaseStart =
	                otherBaseStarts.length > 0 ? otherBaseStarts.reduce((min, v) => (v < min ? v : min), Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
	              if (Number.isFinite(nextBaseStart) && nextBaseStart < Number.POSITIVE_INFINITY) {
	                const maxDur = roundToTenth(Math.max(minLen, nextBaseStart - clipStartTimeline))
	                const curDur = roundToTenth(Math.max(minLen, endS - startS))
	                if (curDur > maxDur + 1e-6) {
	                  if (drag.edge === 'start') {
	                    startS = roundToTenth(endS - maxDur)
	                    startS = clamp(startS, 0, Math.max(0, endS - minLen))
	                  } else {
	                    endS = roundToTenth(startS + maxDur)
	                    endS = Math.max(endS, startS + minLen)
	                  }
	                }
	              }
	            }

	            next[idx] = { ...c, sourceStartSeconds: startS, sourceEndSeconds: endS }
	          }
          const nextTimeline: any = { ...prev, clips: next }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline)
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
          return { ...nextTimeline, playheadSeconds: nextPlayhead }
        }

        if (drag.kind === 'still') {
          const prevStills: any[] = Array.isArray((prev as any).stills) ? (prev as any).stills : []
          const idx = prevStills.findIndex((s: any) => String(s?.id) === String(drag.stillId))
          if (idx < 0) return prev
          const s0: any = prevStills[idx]
          const nextStills = prevStills.slice()
          const minLen = 0.1

          let startS = roundToTenth(Number(s0.startSeconds || 0))
          let endS = roundToTenth(Number(s0.endSeconds || 0))
          const dur = Math.max(minLen, roundToTenth(Number(drag.startEndSeconds) - Number(drag.startStartSeconds)))

          if (drag.edge === 'move') {
            const maxStart =
              drag.maxStartSeconds != null
                ? Number(drag.maxStartSeconds)
                : Math.max(drag.minStartSeconds, roundToTenth(drag.maxEndSeconds - dur))
            startS = clamp(roundToTenth(Number(drag.startStartSeconds) + deltaSeconds), drag.minStartSeconds, maxStart)
            endS = roundToTenth(startS + dur)
          } else if (drag.edge === 'start') {
            startS = clamp(
              roundToTenth(Number(drag.startStartSeconds) + deltaSeconds),
              drag.minStartSeconds,
              Math.max(drag.minStartSeconds, roundToTenth(Number(drag.startEndSeconds) - minLen))
            )
            endS = roundToTenth(Number(drag.startEndSeconds))
          } else {
            endS = clamp(
              roundToTenth(Number(drag.startEndSeconds) + deltaSeconds),
              Math.max(drag.minStartSeconds + minLen, roundToTenth(Number(drag.startStartSeconds) + minLen)),
              drag.maxEndSeconds
            )
            startS = roundToTenth(Number(drag.startStartSeconds))
          }

          if (!(endS > startS)) endS = roundToTenth(startS + minLen)
          nextStills[idx] = { ...s0, startSeconds: startS, endSeconds: endS }
          nextStills.sort(
            (a: any, b: any) =>
              Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
          )

          const nextTimeline: any = { ...(prev as any), stills: nextStills }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
          return { ...(nextTimeline as any), playheadSeconds: nextPlayhead }
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

        if (drag.kind === 'logo') {
          const prevLogos: any[] = Array.isArray((prev as any).logos) ? (prev as any).logos : []
          const idx = prevLogos.findIndex((l: any) => String(l?.id) === String((drag as any).logoId))
          if (idx < 0) return prev
          const l0 = prevLogos[idx] as any
          const nextLogos = prevLogos.slice()
          let startS = Number(l0.startSeconds || 0)
          let endS = Number(l0.endSeconds || 0)
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
          nextLogos[idx] = { ...l0, startSeconds: startS, endSeconds: endS }
          nextLogos.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
          const nextTimeline: any = { ...(prev as any), logos: nextLogos }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
          return { ...(nextTimeline as any), playheadSeconds: nextPlayhead }
        }

        if (drag.kind === 'lowerThird') {
          const prevLts: any[] = Array.isArray((prev as any).lowerThirds) ? (prev as any).lowerThirds : []
          const idx = prevLts.findIndex((lt: any) => String(lt?.id) === String((drag as any).lowerThirdId))
          if (idx < 0) return prev
          const lt0 = prevLts[idx] as any
          const nextLts = prevLts.slice()
          let startS = Number(lt0.startSeconds || 0)
          let endS = Number(lt0.endSeconds || 0)
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
          nextLts[idx] = { ...lt0, startSeconds: startS, endSeconds: endS }
          nextLts.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
          const nextTimeline: any = { ...(prev as any), lowerThirds: nextLts }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
          return { ...(nextTimeline as any), playheadSeconds: nextPlayhead }
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
        const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), graphics: nextGraphics } as any)
        const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
        return { ...prev, graphics: nextGraphics, playheadSeconds: nextPlayhead }
      })
    }
    const onUp = () => {
      if (!trimDragging && !trimDragRef.current) return
      stopTrimDrag('pointerup')
    }
    const onCancel = () => {
      if (!trimDragging && !trimDragRef.current) return
      stopTrimDrag('pointercancel')
    }
    const onBlur = () => {
      if (!trimDragging && !trimDragRef.current) return
      stopTrimDrag('window_blur')
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onMove as any)
      window.removeEventListener('pointerup', onUp as any)
      window.removeEventListener('pointercancel', onCancel as any)
      window.removeEventListener('blur', onBlur as any)
    }
  }, [pxPerSecond, stopTrimDrag, trimDragging])

  useEffect(() => {
    dbg('state', {
      trimDragging,
      panDragging,
      hasTrimDrag: Boolean(trimDragRef.current),
    })
  }, [dbg, panDragging, trimDragging])

  // Desktop UX: allow click+drag panning (mobile already pans naturally).
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
      if (Math.abs(dx) > 4) drag.moved = true
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
      if (drag.moved) {
        suppressNextTimelineClickRef.current = true
        // Only suppress the synthetic click that can be emitted immediately after a drag ends.
        window.setTimeout(() => {
          suppressNextTimelineClickRef.current = false
        }, 0)
      }
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
          Clips: {timeline.clips.length} • Stills: {stills.length} • Graphics: {graphics.length} • Total: {totalSeconds.toFixed(1)}s
        </div>

        <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', overflow: 'hidden', background: '#000' }}>
          <div style={{ width: '100%', aspectRatio: '9 / 16', background: '#000', position: 'relative' }}>
            <video
              ref={videoRef}
              playsInline
              preload="metadata"
              poster={activePoster || undefined}
              style={{ width: '100%', height: '100%', objectFit: previewObjectFit, display: activeUploadId != null ? 'block' : 'none' }}
            />
            {activeStillUrl ? (
              <img
                src={activeStillUrl}
                alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
              />
            ) : null}
	            {activeGraphicUrl ? (
	              <img
	                src={activeGraphicUrl}
	                alt=""
	                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
	              />
	            ) : null}
	            {activeLowerThirdPreview ? (
	              <img
	                src={activeLowerThirdPreview.url}
	                alt=""
	                style={activeLowerThirdPreview.style}
	              />
	            ) : null}
	            {activeLogoPreview ? (
	              <img
	                src={activeLogoPreview.url}
	                alt=""
	                style={activeLogoPreview.style}
	              />
	            ) : null}
	          </div>
	        </div>

        <div style={{ marginTop: 14, borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.35)', padding: 12 }}>
          <div style={{ position: 'relative', paddingTop: 14 }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', color: '#bbb', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {playhead.toFixed(1)}s
            </div>
            {dragHud ? (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 18,
                  transform: 'translateX(-50%)',
                  maxWidth: '92%',
                  textAlign: 'center',
                  pointerEvents: 'none',
                  fontVariantNumeric: 'tabular-nums',
                  zIndex: 60,
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '6px 10px',
                    borderRadius: 999,
                    background: 'rgba(0,0,0,0.55)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dragHud.actionLabel === 'Move' ? (
                    <>
                      <span>Start: {dragHud.start.toFixed(1)}</span>
                      <span>|</span>
                      <span>End: {dragHud.end.toFixed(1)}</span>
                    </>
                  ) : (
                    <span>Length: {dragHud.len.toFixed(1)}</span>
                  )}
                </div>
              </div>
            ) : null}
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
                ref={setTimelineScrollContainerRef}
                onScroll={() => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if (ignoreScrollRef.current) return
                  if (trimDragging) return
                  dbg('scroll', { scrollLeft: sc.scrollLeft })
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
                  // If a pan gesture started in capture phase for this pointer, don't run selection logic.
                  if (panDragRef.current && panDragRef.current.pointerId === e.pointerId) return
                  // Only do mouse drag-panning on desktop. Touch already pans the scroll container.
                  const isMouse = (e as any).pointerType === 'mouse'
                  if (isMouse && e.button != null && e.button !== 0) return
                  const rect = sc.getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const withinLogo = y >= LOGO_Y && y <= LOGO_Y + PILL_H
                  const withinLowerThird = y >= LOWER_THIRD_Y && y <= LOWER_THIRD_Y + PILL_H
                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
                  const clickXInScroll = (e.clientX - rect.left) + sc.scrollLeft
                  const x = clickXInScroll - padPx
                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
                  dbg('pointerdown', {
                    pointerType: (e as any).pointerType,
                    withinLogo,
                    withinLowerThird,
                    withinGraphics,
                    withinVideo,
                    withinAudio,
                    t,
                  })

	                  if (withinLogo) {
	                    const l = findLogoAtTime(t)
	                    if (!l) return
                    const s = Number((l as any).startSeconds || 0)
                    const e2 = Number((l as any).endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
                    const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                    const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
                    if (!inside) return

                    const capEnd = Math.max(0, totalSeconds)
                    const sorted = logos.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
                    const pos = sorted.findIndex((ll: any) => String(ll?.id) === String((l as any).id))
                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

	                    // Slide (body drag) only when already selected.
	                    if (!nearLeft && !nearRight) {
	                      if (selectedLogoId !== String((l as any).id)) return
	                      const dur = Math.max(0.2, roundToTenth(e2 - s))
	                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)
	                      // Arm the drag; we only enter "dragging" state once pointer movement crosses a threshold.
	                      // This keeps a normal click on a selected logo pill available for opening the properties modal.
	                      trimDragRef.current = {
	                        kind: 'logo',
	                        logoId: String((l as any).id),
	                        edge: 'move',
	                        pointerId: e.pointerId,
	                        startClientX: e.clientX,
	                        startClientY: e.clientY,
	                        startStartSeconds: s,
	                        startEndSeconds: e2,
	                        minStartSeconds,
	                        maxEndSeconds,
	                        maxStartSeconds,
	                        armed: true,
	                        moved: false,
	                      }
	                      try { sc.setPointerCapture(e.pointerId) } catch {}
	                      dbg('armTrimDrag', { kind: 'logo', edge: 'move', id: String((l as any).id) })
	                      return
	                    }

                    e.preventDefault()
                    snapshotUndo()
                    setSelectedLogoId(String((l as any).id))
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)
                    setSelectedStillId(null)
                    setSelectedAudio(false)

                    trimDragLockScrollLeftRef.current = sc.scrollLeft
                    trimDragRef.current = {
                      kind: 'logo',
                      logoId: String((l as any).id),
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
                    dbg('startTrimDrag', { kind: 'logo', edge: nearLeft ? 'start' : 'end', id: String((l as any).id) })
                    return
                  }

                  if (withinLowerThird) {
                    const lt = findLowerThirdAtTime(t)
                    if (!lt) return
                    const s = Number((lt as any).startSeconds || 0)
                    const e2 = Number((lt as any).endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
                    const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                    const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
                    if (!inside) return

                    const capEnd = Math.max(0, totalSeconds)
                    const sorted = lowerThirds
                      .slice()
                      .sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
                    const pos = sorted.findIndex((x: any) => String(x?.id) === String((lt as any).id))
                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

                    // Slide (body drag) only when already selected.
                    if (!nearLeft && !nearRight) {
                      if (selectedLowerThirdId !== String((lt as any).id)) return
                      const dur = Math.max(0.2, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)
                      // Arm the drag; we only enter "dragging" state once pointer movement crosses a threshold.
                      trimDragRef.current = {
                        kind: 'lowerThird',
                        lowerThirdId: String((lt as any).id),
                        edge: 'move',
                        pointerId: e.pointerId,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        startStartSeconds: s,
                        startEndSeconds: e2,
                        minStartSeconds,
                        maxEndSeconds,
                        maxStartSeconds,
                        armed: true,
                        moved: false,
                      }
                      try { sc.setPointerCapture(e.pointerId) } catch {}
                      dbg('armTrimDrag', { kind: 'lowerThird', edge: 'move', id: String((lt as any).id) })
                      return
                    }

                    e.preventDefault()
                    snapshotUndo()
                    setSelectedLowerThirdId(String((lt as any).id))
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)
                    setSelectedLogoId(null)
                    setSelectedStillId(null)
                    setSelectedAudio(false)

                    trimDragLockScrollLeftRef.current = sc.scrollLeft
                    trimDragRef.current = {
                      kind: 'lowerThird',
                      lowerThirdId: String((lt as any).id),
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
                    dbg('startTrimDrag', { kind: 'lowerThird', edge: nearLeft ? 'start' : 'end', id: String((lt as any).id) })
                    return
                  }

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
                      setSelectedLogoId(null)
                      setSelectedStillId(null)
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
                    setSelectedLogoId(null)
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
                    dbg('startTrimDrag', { kind: 'graphic', edge: nearLeft ? 'start' : 'end', id: g.id })
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
                      setSelectedLogoId(null)
                      setSelectedStillId(null)

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
                      dbg('startTrimDrag', { kind: 'audio', edge: 'move' })
                      return
                    }

                    e.preventDefault()
                    snapshotUndo()
                    setSelectedAudio(true)
                    setSelectedClipId(null)
                    setSelectedGraphicId(null)
                    setSelectedLogoId(null)
                    setSelectedStillId(null)

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
                    dbg('startTrimDrag', { kind: 'audio', edge: nearLeft ? 'start' : 'end' })
                    return
                  }

                  if (withinVideo) {
                    const still = findStillAtTime(t)
                    if (still) {
                      const s = roundToTenth(Number((still as any).startSeconds || 0))
                      const e2 = roundToTenth(Number((still as any).endSeconds || 0))
                      const leftX = padPx + s * pxPerSecond
                      const rightX = padPx + e2 * pxPerSecond
                      const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                      const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                      const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
                      if (!inside) return

                      const capEnd = 20 * 60
                      const clipRanges = timeline.clips.map((c, i) => ({
                        id: `clip:${String(c.id)}`,
                        start: roundToTenth(Number(clipStarts[i] || 0)),
                        end: roundToTenth(Number(clipStarts[i] || 0) + clipDurationSeconds(c)),
                      }))
                      const stillRanges = stills.map((ss: any) => ({
                        id: `still:${String(ss?.id)}`,
                        start: roundToTenth(Number((ss as any).startSeconds || 0)),
                        end: roundToTenth(Number((ss as any).endSeconds || 0)),
                      }))
                      const ranges = [...clipRanges, ...stillRanges].sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)))
                      const pos = ranges.findIndex((r) => r.id === `still:${String((still as any).id)}`)
                      const prevEnd = pos > 0 ? Number(ranges[pos - 1].end || 0) : 0
                      const nextStart = pos >= 0 && pos < ranges.length - 1 ? Number(ranges[pos + 1].start || capEnd) : capEnd
                      const minStartSeconds = clamp(roundToTenth(prevEnd), 0, capEnd)
                      const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                      const dur = Math.max(0.1, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)

                      // Slide (body drag) only when already selected.
                      if (!nearLeft && !nearRight) {
                        if (selectedStillId !== String((still as any).id)) return
                        e.preventDefault()
                        snapshotUndo()
                        setSelectedStillId(String((still as any).id))
                        setSelectedClipId(null)
                        setSelectedGraphicId(null)
                        setSelectedAudio(false)

                        trimDragLockScrollLeftRef.current = sc.scrollLeft
                        trimDragRef.current = {
                          kind: 'still',
                          stillId: String((still as any).id),
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
                        dbg('startTrimDrag', { kind: 'still', edge: 'move', id: String((still as any).id) })
                        return
                      }

                      e.preventDefault()
                      snapshotUndo()
                      setSelectedStillId(String((still as any).id))
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      setSelectedAudio(false)

                      trimDragLockScrollLeftRef.current = sc.scrollLeft
                      trimDragRef.current = {
                        kind: 'still',
                        stillId: String((still as any).id),
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
                      dbg('startTrimDrag', { kind: 'still', edge: nearLeft ? 'start' : 'end', id: String((still as any).id) })
                      return
                    }
                  }

                  if (!timeline.clips.length) return
                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = idx >= 0 ? timeline.clips[idx] : null
                  if (!clip) return

                  const start = (clipStarts[idx] || 0)
                  const len = clipDurationSeconds(clip)
                  const leftX = padPx + start * pxPerSecond
                  const rightX = padPx + (start + len) * pxPerSecond
                  const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                  const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                  const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
                  if (!inside) return

                  // Slide (body drag) only when already selected.
                  if (!nearLeft && !nearRight) {
                    if (selectedClipId !== clip.id) return
                    e.preventDefault()
                    snapshotUndo()
                    setSelectedClipId(clip.id)
                    setSelectedGraphicId(null)
                    setSelectedStillId(null)
                    setSelectedAudio(false)

                    const capEnd = 20 * 60
                    const clipRanges = timeline.clips.map((c, i) => ({
                      id: `clip:${String(c.id)}`,
                      start: roundToTenth(Number(clipStarts[i] || 0)),
                      end: roundToTenth(Number(clipStarts[i] || 0) + clipDurationSeconds(c)),
                    }))
                    const stillRanges = stills.map((s: any) => ({
                      id: `still:${String(s?.id)}`,
                      start: roundToTenth(Number((s as any).startSeconds || 0)),
                      end: roundToTenth(Number((s as any).endSeconds || 0)),
                    }))
                    const ranges = [...clipRanges, ...stillRanges].sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)))
                    const pos = ranges.findIndex((r) => r.id === `clip:${String(clip.id)}`)
                    const prevEnd = pos > 0 ? Number(ranges[pos - 1].end || 0) : 0
                    const nextStart = pos >= 0 && pos < ranges.length - 1 ? Number(ranges[pos + 1].start || capEnd) : capEnd
                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, capEnd)
                    const maxEndSeconds = capEnd
                    const maxStartSeconds = clamp(roundToTenth(nextStart - len), minStartSeconds, maxEndSeconds)

                    trimDragLockScrollLeftRef.current = sc.scrollLeft
                    const maxDur = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
                    trimDragRef.current = {
                      kind: 'clip',
                      clipId: clip.id,
                      edge: 'move',
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startStartSeconds: start,
                      startEndSeconds: start + len,
                      maxDurationSeconds: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : clip.sourceEndSeconds,
                      minStartSeconds,
                      maxEndSeconds,
                      maxStartSeconds,
                    }
                    setTrimDragging(true)
                    try { sc.setPointerCapture(e.pointerId) } catch {}
                    dbg('startTrimDrag', { kind: 'clip', edge: 'move', id: clip.id })
                    return
                  }

                  e.preventDefault()
                  snapshotUndo()
                  setSelectedClipId(clip.id)
                  setSelectedGraphicId(null)
                  setSelectedAudio(false)
                  trimDragLockScrollLeftRef.current = sc.scrollLeft
                  const maxDur = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
                  const capEnd = 20 * 60
                  const clipRanges = timeline.clips.map((c, i) => ({
                    id: `clip:${String(c.id)}`,
                    start: roundToTenth(Number(clipStarts[i] || 0)),
                    end: roundToTenth(Number(clipStarts[i] || 0) + clipDurationSeconds(c)),
                  }))
                  const stillRanges = stills.map((s: any) => ({
                    id: `still:${String(s?.id)}`,
                    start: roundToTenth(Number((s as any).startSeconds || 0)),
                    end: roundToTenth(Number((s as any).endSeconds || 0)),
                  }))
                  const ranges = [...clipRanges, ...stillRanges].sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)))
                  const pos = ranges.findIndex((r) => r.id === `clip:${String(clip.id)}`)
                  const nextStart = pos >= 0 && pos < ranges.length - 1 ? Number(ranges[pos + 1].start || capEnd) : capEnd
                  const maxTimelineDurationSeconds = clamp(roundToTenth(nextStart - start), 0.2, capEnd)
                  trimDragRef.current = {
                    kind: 'clip',
                    clipId: clip.id,
                    edge: nearLeft ? 'start' : 'end',
                    pointerId: e.pointerId,
                    startClientX: e.clientX,
                    startStartSeconds: clip.sourceStartSeconds,
                    startEndSeconds: clip.sourceEndSeconds,
                    maxDurationSeconds: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : clip.sourceEndSeconds,
                    maxTimelineDurationSeconds,
                  }
                  setTrimDragging(true)
                  try { sc.setPointerCapture(e.pointerId) } catch {}
                  dbg('startTrimDrag', { kind: 'clip', edge: nearLeft ? 'start' : 'end', id: clip.id })
                  return
                }}
	                onPointerDownCapture={(e) => {
	                  // If we didn't start a handle drag, allow click+drag panning on empty areas.
	                  const sc = timelineScrollRef.current
	                  if (!sc) return
	                  const isMouse = (e as any).pointerType === 'mouse'
	                  if (isMouse && e.button != null && e.button !== 0) return
	                  if (trimDragging) return
	                  dbg('pointerdownCapture', { pointerType: (e as any).pointerType })
	                  // Don't pan when starting on a pill (let click-selection work). This only kicks in for empty space.
	                  const rect = sc.getBoundingClientRect()
	                  const y = e.clientY - rect.top
	                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
	                  const clickXInScroll = (e.clientX - rect.left) + sc.scrollLeft
	                  const x = clickXInScroll - padPx
	                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
	                  const withinLogo = y >= LOGO_Y && y <= LOGO_Y + PILL_H
	                  const withinLowerThird = y >= LOWER_THIRD_Y && y <= LOWER_THIRD_Y + PILL_H
	                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
	                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
	                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H

	                  if (withinLogo) {
	                    const l = findLogoAtTime(t)
	                    if (l) return
	                  }
	                  if (withinLowerThird) {
	                    const lt = findLowerThirdAtTime(t)
	                    if (lt) return
	                  }
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
                    const still = findStillAtTime(t)
                    if (still) {
                      const s = Number((still as any).startSeconds || 0)
                      const e2 = Number((still as any).endSeconds || 0)
                      const leftX = padPx + s * pxPerSecond
                      const rightX = padPx + e2 * pxPerSecond
                      if (clickXInScroll >= leftX && clickXInScroll <= rightX) return
                    }
                    if (timeline.clips.length) {
                      const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                      const clip = idx >= 0 ? timeline.clips[idx] : null
                      if (clip) {
                        const start = (clipStarts[idx] || 0)
                        const len = Math.max(0, clipDurationSeconds(clip))
                        const leftX = padPx + start * pxPerSecond
                        const rightX = padPx + (start + len) * pxPerSecond
                        if (clickXInScroll >= leftX && clickXInScroll <= rightX) return
                      }
                    }
                  }

                  panDragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startScrollLeft: sc.scrollLeft, moved: false }
                  setPanDragging(true)
                  try { sc.setPointerCapture(e.pointerId) } catch {}
                  e.preventDefault()
                }}
	                onClick={(e) => {
	                  if (suppressNextTimelineClickRef.current) {
	                    suppressNextTimelineClickRef.current = false
	                    return
	                  }
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
	                  const withinLogo = y >= LOGO_Y && y <= LOGO_Y + PILL_H
	                  const withinLowerThird = y >= LOWER_THIRD_Y && y <= LOWER_THIRD_Y + PILL_H
	                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
	                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
	                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
	                  if (!withinLogo && !withinLowerThird && !withinGraphics && !withinVideo && !withinAudio) {
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedLowerThirdId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudio(false)
	                    return
	                  }

	                  if (withinLogo) {
	                    const l = findLogoAtTime(t)
	                    if (!l) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudio(false)
	                      return
	                    }
	                    const s = Number((l as any).startSeconds || 0)
	                    const e2 = Number((l as any).endSeconds || 0)
	                    const leftX = padPx + s * pxPerSecond
	                    const rightX = padPx + e2 * pxPerSecond
	                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudio(false)
	                      return
	                    }
	                    if (selectedLogoId === String((l as any).id)) {
	                      setLogoEditor({ id: String((l as any).id), start: s, end: e2, configId: Number((l as any).configId || 0) })
	                      setLogoEditorError(null)
	                      return
	                    }
	                    setSelectedLogoId(String((l as any).id))
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLowerThirdId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudio(false)
	                    return
	                  }

	                  if (withinLowerThird) {
	                    const lt = findLowerThirdAtTime(t)
	                    if (!lt) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudio(false)
	                      return
	                    }
	                    const s = Number((lt as any).startSeconds || 0)
	                    const e2 = Number((lt as any).endSeconds || 0)
	                    const leftX = padPx + s * pxPerSecond
	                    const rightX = padPx + e2 * pxPerSecond
	                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudio(false)
	                      return
	                    }
	                    if (selectedLowerThirdId === String((lt as any).id)) {
	                      setLowerThirdEditor({
	                        id: String((lt as any).id),
	                        start: s,
	                        end: e2,
	                        configId: Number((lt as any).configId || 0),
	                      })
	                      setLowerThirdEditorError(null)
	                      return
	                    }
	                    setSelectedLowerThirdId(String((lt as any).id))
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudio(false)
	                    return
	                  }

	                  if (withinGraphics) {
	                    const g = findGraphicAtTime(t)
	                    if (!g) {
	                      setSelectedGraphicId(null)
	                      setSelectedClipId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedStillId(null)
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
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedStillId(null)
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
	                    setSelectedLogoId(null)
	                    setSelectedLowerThirdId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudio(false)
	                    return
	                  }

	                  if (withinAudio) {
	                    if (!audioTrack) {
	                      setSelectedAudio(false)
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedStillId(null)
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
	                      setSelectedLogoId(null)
	                      setSelectedStillId(null)
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
	                    setSelectedLogoId(null)
	                    setSelectedStillId(null)
	                    return
	                  }

	                  const still = findStillAtTime(t)
	                  if (still) {
                    const s = Number((still as any).startSeconds || 0)
                    const e2 = Number((still as any).endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
	                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudio(false)
	                      return
	                    }
	                    setSelectedStillId(String((still as any).id))
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedAudio(false)
	                    return
	                  }

                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = idx >= 0 ? timeline.clips[idx] : null
	                  if (!clip) {
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudio(false)
	                    return
	                  }

                  // If user taps the same selected clip again (not on a handle), open properties.
                  const start = (clipStarts[idx] || 0)
                  const len = Math.max(0, clipDurationSeconds(clip))
                  const leftX = padPx + start * pxPerSecond
                  const rightX = padPx + (start + len) * pxPerSecond
                  // Clicking the track outside any pill should deselect.
	                  if (clickXInScroll < leftX || clickXInScroll > rightX) {
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudio(false)
	                    return
	                  }
                  const nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                  const nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                  if (nearLeft || nearRight) return

                  if (selectedClipId === clip.id) {
                    setClipEditor({
                      id: clip.id,
                      start: clip.sourceStartSeconds,
                      end: clip.sourceEndSeconds,
                    })
                    setClipEditorError(null)
                    setFreezeInsertError(null)
                    return
                  }

	                  setSelectedClipId(clip.id)
	                  setSelectedGraphicId(null)
	                  setSelectedLogoId(null)
	                  setSelectedStillId(null)
	                  setSelectedAudio(false)
	                }}
                style={{
                  width: '100%',
                  overflowX: trimDragging ? 'hidden' : 'auto',
                  overflowY: 'hidden',
                  WebkitOverflowScrolling: trimDragging ? 'auto' : 'touch',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.28)',
                  background: 'rgba(0,0,0,0.60)',
                  height: TIMELINE_H,
                  position: 'relative',
                  // Disable native touch panning so trim/slide drags don't get cancelled by scroll gestures.
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                }}
                onContextMenu={(e) => e.preventDefault()}
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
	                  disabled={!selectedClipId && !selectedGraphicId && !selectedLogoId && !selectedLowerThirdId}
	                  style={{
	                    padding: '10px 12px',
	                    borderRadius: 10,
	                    border: '1px solid rgba(255,255,255,0.18)',
	                    background: selectedClipId || selectedGraphicId || selectedLogoId || selectedLowerThirdId ? '#0c0c0c' : 'rgba(255,255,255,0.06)',
	                    color: '#fff',
	                    fontWeight: 900,
	                    cursor: selectedClipId || selectedGraphicId || selectedLogoId || selectedLowerThirdId ? 'pointer' : 'default',
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
                disabled={!selectedClipId && !selectedGraphicId && !selectedLogoId && !selectedLowerThirdId && !selectedStillId && !selectedAudio}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: selectedClipId || selectedGraphicId || selectedLogoId || selectedLowerThirdId || selectedStillId || selectedAudio ? '#300' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: selectedClipId || selectedGraphicId || selectedLogoId || selectedLowerThirdId || selectedStillId || selectedAudio ? 'pointer' : 'default',
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

            {timelineMessage ? <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center' }}>{timelineMessage}</div> : null}
          </div>
        </div>

        {audioTrack ? (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ color: '#fff', fontWeight: 900 }}>
              {(namesByUploadId[audioTrack.uploadId] || `Audio ${audioTrack.uploadId}`) +
                ' * ' +
                (audioConfigNameById[audioTrack.audioConfigId] || `Config ${audioTrack.audioConfigId}`)}
            </div>
            <button
              type="button"
              onClick={() => toggleAudioPreview(audioTrack.uploadId)}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(48,209,88,0.65)',
                background: audioPreviewPlayingId === audioTrack.uploadId ? 'rgba(48,209,88,0.22)' : 'rgba(48,209,88,0.12)',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
                flex: '0 0 auto',
              }}
              aria-label={audioPreviewPlayingId === audioTrack.uploadId ? 'Pause audio preview' : 'Play audio preview'}
            >
              {audioPreviewPlayingId === audioTrack.uploadId ? 'Pause' : 'Play'}
            </button>
          </div>
        ) : null}

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
	                      onClick={() => {
	                        if (addStep === 'logoConfig') setAddStep('logo')
	                        else if (addStep === 'lowerThirdConfig') setAddStep('lowerThird')
	                        else setAddStep('type')
	                      }}
	                      style={{ color: '#0a84ff', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14 }}
	                    >
	                      ← Back
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
	                      : addStep === 'logo'
	                          ? `Logos: ${logoPickerItems.length}`
	                          : addStep === 'logoConfig'
	                              ? `Configs: ${logoConfigs.length}`
	                              : addStep === 'lowerThird'
	                                ? `Lower thirds: ${lowerThirdPickerItems.length}`
	                                : addStep === 'lowerThirdConfig'
	                                  ? `Configs: ${lowerThirdConfigs.length}`
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
	                      setAddStep('logo')
	                      openLogoPicker().catch(() => {})
	                    }}
	                    style={{
	                      padding: 12,
	                      borderRadius: 12,
	                      border: '1px solid rgba(255,214,10,0.55)',
	                      background: 'rgba(0,0,0,0.35)',
	                      color: '#fff',
	                      cursor: 'pointer',
	                      textAlign: 'left',
	                    }}
	                  >
	                    <div style={{ fontWeight: 900, fontSize: 16 }}>Logo</div>
	                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Watermark segments (no overlaps)</div>
	                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddStep('lowerThird')
                      openLowerThirdPicker().catch(() => {})
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid rgba(175,82,222,0.55)',
                      background: 'rgba(0,0,0,0.35)',
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16 }}>Lower Third</div>
                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Lower-third segments (no overlaps)</div>
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
	            ) : addStep === 'logo' ? (
	              <>
	                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Logo</h1>
	                {logoPickerLoading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
	                {logoPickerError ? <div style={{ color: '#ff9b9b' }}>{logoPickerError}</div> : null}
	                {logoConfigsError ? <div style={{ color: '#ff9b9b' }}>{logoConfigsError}</div> : null}
	                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
	                  {logoPickerItems.map((it) => {
	                    const id = Number(it.id)
	                    if (!Number.isFinite(id) || id <= 0) return null
	                    const name = String(it.modified_filename || it.original_filename || `Logo ${id}`)
	                    const src = `/api/uploads/${encodeURIComponent(String(id))}/file`
	                    return (
	                      <button
	                        key={`pick-logo-${id}`}
	                        type="button"
	                        onClick={() => chooseLogoUpload(it)}
	                        style={{
	                          display: 'grid',
	                          gridTemplateColumns: '96px 1fr',
	                          gap: 12,
	                          alignItems: 'center',
	                          padding: 12,
	                          borderRadius: 12,
	                          border: '1px solid rgba(255,214,10,0.55)',
	                          background: 'rgba(0,0,0,0.35)',
	                          color: '#fff',
	                          cursor: 'pointer',
	                          textAlign: 'left',
	                        }}
	                      >
	                        <img
	                          src={src}
	                          alt=""
	                          loading="lazy"
	                          style={{ width: 96, height: 54, objectFit: 'contain', borderRadius: 8, background: '#000' }}
	                        />
	                        <div style={{ minWidth: 0 }}>
	                          <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
	                          <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>Pick a logo, then pick a logo config</div>
	                        </div>
	                      </button>
	                    )
	                  })}
	                </div>
	              </>
	            ) : addStep === 'logoConfig' ? (
	              <>
	                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Logo Config</h1>
	                {logoConfigsError ? <div style={{ color: '#ff9b9b' }}>{logoConfigsError}</div> : null}
	                {logoPickerError ? <div style={{ color: '#ff9b9b' }}>{logoPickerError}</div> : null}
	                {!pendingLogoUploadId ? (
	                  <div style={{ color: '#bbb', marginTop: 12 }}>Pick a logo first.</div>
	                ) : null}
	                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
	                  {logoConfigs
	                    .filter((c: any) => !(c && typeof c === 'object' && c.archived_at))
	                    .map((cfg: any) => {
	                      const cfgId = Number(cfg.id)
	                      if (!Number.isFinite(cfgId) || cfgId <= 0) return null
	                      const name = String(cfg.name || `Config ${cfgId}`)
	                      const pos = String(cfg.position || '')
	                      const size = cfg.sizePctWidth != null ? Number(cfg.sizePctWidth) : null
	                      const opacity = cfg.opacityPct != null ? Number(cfg.opacityPct) : null
	                      return (
	                        <button
	                          key={`pick-logo-cfg-${cfgId}`}
	                          type="button"
	                          onClick={() => addLogoFromPending(cfgId)}
	                          style={{
	                            display: 'grid',
	                            gridTemplateColumns: '1fr auto',
	                            gap: 12,
	                            alignItems: 'center',
	                            padding: 12,
	                            borderRadius: 12,
	                            border: '1px solid rgba(255,214,10,0.55)',
	                            background: 'rgba(0,0,0,0.35)',
	                            color: '#fff',
	                            cursor: 'pointer',
	                            textAlign: 'left',
	                          }}
	                        >
	                          <div style={{ minWidth: 0 }}>
	                            <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
	                            <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>
	                              {(pos ? `Position: ${pos}` : 'Position') +
	                                (size != null && Number.isFinite(size) ? ` • Size: ${size}%` : '') +
	                                (opacity != null && Number.isFinite(opacity) ? ` • Opacity: ${opacity}%` : '')}
	                            </div>
	                          </div>
	                          <div style={{ fontWeight: 900, color: '#fff' }}>Select</div>
	                        </button>
	                      )
	                    })}
	                </div>
	              </>
	            ) : addStep === 'lowerThird' ? (
	              <>
	                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Lower Third</h1>
	                {lowerThirdPickerLoading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
	                {lowerThirdPickerError ? <div style={{ color: '#ff9b9b' }}>{lowerThirdPickerError}</div> : null}
	                {lowerThirdConfigsError ? <div style={{ color: '#ff9b9b' }}>{lowerThirdConfigsError}</div> : null}
	                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
	                  {lowerThirdPickerItems.map((it) => {
	                    const id = Number(it.id)
	                    if (!Number.isFinite(id) || id <= 0) return null
	                    const name = String(it.modified_filename || it.original_filename || `Lower third ${id}`)
	                    const src = `/api/uploads/${encodeURIComponent(String(id))}/file`
	                    return (
	                      <button
	                        key={`pick-lt-${id}`}
	                        type="button"
	                        onClick={() => chooseLowerThirdUpload(it)}
	                        style={{
	                          display: 'grid',
	                          gridTemplateColumns: '96px 1fr',
	                          gap: 12,
	                          alignItems: 'center',
	                          padding: 12,
	                          borderRadius: 12,
	                          border: '1px solid rgba(175,82,222,0.55)',
	                          background: 'rgba(0,0,0,0.35)',
	                          color: '#fff',
	                          cursor: 'pointer',
	                          textAlign: 'left',
	                        }}
	                      >
	                        <img
	                          src={src}
	                          alt=""
	                          loading="lazy"
	                          style={{ width: 96, height: 54, objectFit: 'contain', borderRadius: 8, background: '#000' }}
	                        />
	                        <div style={{ minWidth: 0 }}>
	                          <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
	                          <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>Pick an image, then pick a lower third config</div>
	                        </div>
	                      </button>
	                    )
	                  })}
	                </div>
	              </>
	            ) : addStep === 'lowerThirdConfig' ? (
	              <>
	                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Lower Third Config</h1>
	                {lowerThirdConfigsError ? <div style={{ color: '#ff9b9b' }}>{lowerThirdConfigsError}</div> : null}
	                {lowerThirdPickerError ? <div style={{ color: '#ff9b9b' }}>{lowerThirdPickerError}</div> : null}
	                {!pendingLowerThirdUploadId ? <div style={{ color: '#bbb', marginTop: 12 }}>Pick a lower third image first.</div> : null}
	                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
	                  {lowerThirdConfigs
	                    .filter((c: any) => !(c && typeof c === 'object' && c.archived_at))
	                    .map((cfg: any) => {
	                      const cfgId = Number(cfg.id)
	                      if (!Number.isFinite(cfgId) || cfgId <= 0) return null
	                      const name = String(cfg.name || `Config ${cfgId}`)
	                      const mode = String((cfg as any).sizeMode || 'pct')
	                      const pct = cfg.sizePctWidth != null ? Number(cfg.sizePctWidth) : null
	                      const opacity = cfg.opacityPct != null ? Number(cfg.opacityPct) : null
	                      return (
	                        <button
	                          key={`pick-lt-cfg-${cfgId}`}
	                          type="button"
	                          onClick={() => addLowerThirdFromPending(cfgId)}
	                          style={{
	                            display: 'grid',
	                            gridTemplateColumns: '1fr auto',
	                            gap: 12,
	                            alignItems: 'center',
	                            padding: 12,
	                            borderRadius: 12,
	                            border: '1px solid rgba(175,82,222,0.55)',
	                            background: 'rgba(0,0,0,0.35)',
	                            color: '#fff',
	                            cursor: 'pointer',
	                            textAlign: 'left',
	                          }}
	                        >
	                          <div style={{ minWidth: 0 }}>
	                            <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
	                            <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>
	                              {(mode === 'match_image' ? 'Size: match image' : 'Size: percent') +
	                                (pct != null && Number.isFinite(pct) ? ` • Width: ${pct}%` : '') +
	                                (opacity != null && Number.isFinite(opacity) ? ` • Opacity: ${opacity}%` : '')}
	                            </div>
	                          </div>
	                          <div style={{ fontWeight: 900, color: '#fff' }}>Select</div>
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

            {audioTrack ? (
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ color: '#fff', fontWeight: 900 }}>
                  {(namesByUploadId[audioTrack.uploadId] || `Audio ${audioTrack.uploadId}`) +
                    ' * ' +
                    (audioConfigNameById[audioTrack.audioConfigId] || `Config ${audioTrack.audioConfigId}`)}
                </div>
                <button
                  type="button"
                  onClick={() => toggleAudioPreview(audioTrack.uploadId)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(48,209,88,0.65)',
                    background: audioPreviewPlayingId === audioTrack.uploadId ? 'rgba(48,209,88,0.22)' : 'rgba(48,209,88,0.12)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  {audioPreviewPlayingId === audioTrack.uploadId ? 'Pause' : 'Play'}
                </button>
              </div>
            ) : null}

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

      {logoEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setLogoEditor(null); setLogoEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(255,159,10,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Logo Properties</div>
              <button
                type="button"
                onClick={() => { setLogoEditor(null); setLogoEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>

            {(() => {
              const seg = logos.find((l) => String((l as any).id) === String(logoEditor.id)) as any
              const uploadId = Number(seg?.uploadId)
              const name = (Number.isFinite(uploadId) && uploadId > 0 ? (namesByUploadId[uploadId] || `Logo ${uploadId}`) : 'Logo')
              const cfgName = seg?.configSnapshot?.name || (seg?.configId ? `Config ${seg.configId}` : 'Config')
              return (
                <div style={{ marginTop: 10, color: '#fff', fontWeight: 900 }}>
                  {name} * {cfgName}
                </div>
              )
            })()}

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Logo Config</div>
                <select
                  value={String(logoEditor.configId)}
                  onChange={(e) => { setLogoEditorError(null); setLogoEditor((p) => p ? ({ ...p, configId: Number(e.target.value) }) : p) }}
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                >
                  <option value="0" disabled>
                    Select…
                  </option>
                  {logoConfigs.map((c: any) => (
                    <option key={`logo_cfg_${String(c.id)}`} value={String(c.id)}>
                      {String(c.name || `Config ${c.id}`)}
                    </option>
                  ))}
                </select>
                {logoConfigsError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{logoConfigsError}</div> : null}
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={String(logoEditor.start)}
                    onChange={(e) => { setLogoEditorError(null); setLogoEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={String(logoEditor.end)}
                    onChange={(e) => { setLogoEditorError(null); setLogoEditor((p) => p ? ({ ...p, end: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                  />
                </label>
              </div>

              {logoEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{logoEditorError}</div> : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setLogoEditor(null); setLogoEditorError(null) }}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveLogoEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,159,10,0.65)', background: 'rgba(255,159,10,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {lowerThirdEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setLowerThirdEditor(null); setLowerThirdEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(175,82,222,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Lower Third Properties</div>
              <button
                type="button"
                onClick={() => { setLowerThirdEditor(null); setLowerThirdEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>

            {(() => {
              const seg = lowerThirds.find((lt) => String((lt as any).id) === String(lowerThirdEditor.id)) as any
              const uploadId = Number(seg?.uploadId)
              const name = (Number.isFinite(uploadId) && uploadId > 0 ? (namesByUploadId[uploadId] || `Lower third ${uploadId}`) : 'Lower third')
              const cfgName = seg?.configSnapshot?.name || (seg?.configId ? `Config ${seg.configId}` : 'Config')
              return <div style={{ marginTop: 10, color: '#bbb', fontSize: 13 }}>{name} • {cfgName}</div>
            })()}

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Lower Third Config</div>
                <select
                  value={String(lowerThirdEditor.configId)}
                  onChange={(e) => { setLowerThirdEditorError(null); setLowerThirdEditor((p) => p ? ({ ...p, configId: Number(e.target.value) }) : p) }}
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                >
                  {lowerThirdConfigs
                    .filter((c: any) => !(c && typeof c === 'object' && c.archived_at))
                    .map((c: any) => (
                      <option key={`ltcfg-${c.id}`} value={String(c.id)}>{String(c.name || `Config ${c.id}`)}</option>
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
                    value={String(lowerThirdEditor.start)}
                    onChange={(e) => { setLowerThirdEditorError(null); setLowerThirdEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={String(lowerThirdEditor.end)}
                    onChange={(e) => { setLowerThirdEditorError(null); setLowerThirdEditor((p) => p ? ({ ...p, end: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                  />
                </label>
              </div>

              {lowerThirdEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{lowerThirdEditorError}</div> : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setLowerThirdEditor(null); setLowerThirdEditorError(null) }}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveLowerThirdEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(175,82,222,0.65)', background: 'rgba(175,82,222,0.16)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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
          onClick={() => { setClipEditor(null); setClipEditorError(null); setFreezeInsertError(null); setFreezeInsertBusy(false) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(212,175,55,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Video Properties</div>
              <button type="button" onClick={() => { setClipEditor(null); setClipEditorError(null); setFreezeInsertError(null); setFreezeInsertBusy(false) }} style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>
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

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Freeze Frames</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <label style={{ display: 'grid', gap: 6, minWidth: 180 }}>
                          <div style={{ color: '#bbb', fontSize: 13 }}>Duration</div>
                          <select
                            value={String(freezeInsertSeconds)}
                            onChange={(e) => { setFreezeInsertError(null); setFreezeInsertSeconds(Number(e.target.value)) }}
                            style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
                          >
                            {FREEZE_OPTIONS_SECONDS.filter((v) => Number(v) > 0).map((v) => (
                              <option key={`fi_${String(v)}`} value={String(v)}>{Number(v).toFixed(1)}s</option>
                            ))}
                          </select>
                        </label>

                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            disabled={freezeInsertBusy}
                            onClick={() => insertFreezeStill('first')}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(212,175,55,0.65)',
                              background: 'rgba(212,175,55,0.14)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: freezeInsertBusy ? 'not-allowed' : 'pointer',
                              opacity: freezeInsertBusy ? 0.6 : 1,
                            }}
                          >
                            Insert first-frame freeze
                          </button>
                          <button
                            type="button"
                            disabled={freezeInsertBusy}
                            onClick={() => insertFreezeStill('last')}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(212,175,55,0.65)',
                              background: 'rgba(212,175,55,0.14)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: freezeInsertBusy ? 'not-allowed' : 'pointer',
                              opacity: freezeInsertBusy ? 0.6 : 1,
                            }}
                          >
                            Insert last-frame freeze
                          </button>
                        </div>
                      </div>
                      {freezeInsertBusy ? <div style={{ color: '#bbb', fontSize: 12, marginTop: 8 }}>Generating freeze frame…</div> : null}
                      {freezeInsertError ? <div style={{ color: '#ff9b9b', fontSize: 13, marginTop: 8 }}>{freezeInsertError}</div> : null}
                      <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
                        Freeze frames are inserted as still segments and ripple-shift later items. Clip audio is silent during the still segment.
                      </div>
                    </div>
                  </>
                )
              })()}
              {clipEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{clipEditorError}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button type="button" onClick={() => { setClipEditor(null); setClipEditorError(null); setFreezeInsertError(null); setFreezeInsertBusy(false) }} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
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
