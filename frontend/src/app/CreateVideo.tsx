import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUploadCdnUrl } from '../ui/uploadsCdn'
import type {
  AudioSegment,
  AudioTrack,
  Clip,
  Graphic,
  Logo,
  LogoConfigSnapshot,
  LowerThird,
  LowerThirdConfigSnapshot,
  Narration,
  ScreenTitle,
  Still,
  Timeline,
} from './createVideo/timelineTypes'
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
import {
  insertClipAtPlayhead,
  splitAudioSegmentAtPlayhead,
  splitClipAtPlayhead,
  splitGraphicAtPlayhead,
  splitStillAtPlayhead,
  splitLogoAtPlayhead,
  splitLowerThirdAtPlayhead,
  splitNarrationAtPlayhead,
  splitScreenTitleAtPlayhead,
} from './createVideo/timelineOps'

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

type ScreenTitlePresetItem = {
  id: number
  name: string
  style: string
  fontKey: string
  fontSizePct: number
  trackingPct: number
  fontColor: string
  fontGradientKey?: string | null
  outlineWidthPct?: number | null
  outlineOpacityPct?: number | null
  outlineColor?: string | null
  pillBgColor: string
  pillBgOpacityPct: number
  alignment?: string
  position: string
  maxWidthPct: number
  insetXPreset: string | null
  insetYPreset: string | null
  fade: string
  archivedAt?: string | null
}

type AddStep =
  | 'type'
  | 'video'
  | 'graphic'
  | 'audio'
  | 'narration'
  | 'logo'
  | 'logoConfig'
  | 'lowerThird'
  | 'lowerThirdConfig'
  | 'screenTitle'

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

function migrateLegacyClipFreezeTimeline(tl: Timeline): { timeline: Timeline; changed: boolean } {
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

function migrateLegacyAudioTrackToSegments(tl: Timeline): { timeline: Timeline; changed: boolean } {
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
    screenTitles: [],
    narration: [],
    audioSegments: [],
    audioTrack: null,
  })
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null)
  const [selectedLogoId, setSelectedLogoId] = useState<string | null>(null)
  const [selectedLowerThirdId, setSelectedLowerThirdId] = useState<string | null>(null)
  const [selectedScreenTitleId, setSelectedScreenTitleId] = useState<string | null>(null)
  const [selectedNarrationId, setSelectedNarrationId] = useState<string | null>(null)
  const [selectedStillId, setSelectedStillId] = useState<string | null>(null)
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null)

  const playPauseGlyph = (isPlaying: boolean) => (isPlaying ? '||' : '▶')
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

  // Freeze insertion duration is fixed in v1.
  useEffect(() => {
    if (!clipEditor) return
    setFreezeInsertSeconds(2)
  }, [clipEditor])
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
  const [stillEditor, setStillEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [stillEditorError, setStillEditorError] = useState<string | null>(null)
  const [logoEditor, setLogoEditor] = useState<{ id: string; start: number; end: number; configId: number } | null>(null)
  const [logoEditorError, setLogoEditorError] = useState<string | null>(null)
  const [lowerThirdEditor, setLowerThirdEditor] = useState<{ id: string; start: number; end: number; configId: number } | null>(null)
  const [lowerThirdEditorError, setLowerThirdEditorError] = useState<string | null>(null)
  const [screenTitlePresets, setScreenTitlePresets] = useState<ScreenTitlePresetItem[]>([])
  const [screenTitlePresetsLoaded, setScreenTitlePresetsLoaded] = useState(false)
  const [screenTitlePresetsError, setScreenTitlePresetsError] = useState<string | null>(null)
  const [screenTitleEditor, setScreenTitleEditor] = useState<{ id: string; start: number; end: number; presetId: number | null; text: string } | null>(null)
  const [screenTitleEditorError, setScreenTitleEditorError] = useState<string | null>(null)
  const [screenTitleRenderBusy, setScreenTitleRenderBusy] = useState(false)
  const screenTitleTextAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const [screenTitleTextAreaHeight, setScreenTitleTextAreaHeight] = useState<number>(96)
  const screenTitleTextAreaDragRef = useRef<{ pointerId: number; startClientY: number; startHeight: number } | null>(null)
  const [audioPickerLoading, setAudioPickerLoading] = useState(false)
  const [audioPickerError, setAudioPickerError] = useState<string | null>(null)
  const [audioPickerItems, setAudioPickerItems] = useState<SystemAudioItem[]>([])
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [audioPreviewPlayingId, setAudioPreviewPlayingId] = useState<number | null>(null)
  const musicPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [musicPreviewPlaying, setMusicPreviewPlaying] = useState(false)
  const musicPreviewSegRef = useRef<
    | {
        segId: string
        uploadId: number
        segStart: number
        segEnd: number
        sourceStartSeconds: number
      }
    | null
  >(null)
  const musicPreviewRafRef = useRef<number | null>(null)
  const narrationPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [narrationPreviewPlaying, setNarrationPreviewPlaying] = useState(false)
  const narrationPreviewSegRef = useRef<
    | {
        segId: string
        uploadId: number
        segStart: number
        segEnd: number
        sourceStartSeconds: number
      }
    | null
  >(null)
  const narrationPreviewRafRef = useRef<number | null>(null)
  const [audioConfigs, setAudioConfigs] = useState<AudioConfigItem[]>([])
  const [audioConfigsLoaded, setAudioConfigsLoaded] = useState(false)
  const [audioConfigsError, setAudioConfigsError] = useState<string | null>(null)
  const [audioEditor, setAudioEditor] = useState<{ id: string; start: number; end: number; audioConfigId: number } | null>(null)
  const [audioEditorError, setAudioEditorError] = useState<string | null>(null)
  const [narrationEditor, setNarrationEditor] = useState<{ id: string; start: number; end: number; gainDb: number } | null>(null)
  const [narrationEditorError, setNarrationEditorError] = useState<string | null>(null)
  const [narrationAddError, setNarrationAddError] = useState<string | null>(null)
  const [narrationUploadBusy, setNarrationUploadBusy] = useState(false)
  const narrationFileInputRef = useRef<HTMLInputElement | null>(null)
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
  const [guidelineMenuOpen, setGuidelineMenuOpen] = useState(false)
  const guidelinePressRef = useRef<{ timer: number | null; fired: boolean } | null>(null)
  const timelineCtxMenuOpenedAtRef = useRef<number | null>(null)
  const [timelineCtxMenu, setTimelineCtxMenu] = useState<
    | null
    | {
        kind: 'graphic' | 'still' | 'logo' | 'lowerThird' | 'screenTitle' | 'clip' | 'narration' | 'audioSegment'
        id: string
        x: number
        y: number
        view?: 'main' | 'guidelines'
        edgeIntent?: 'move' | 'start' | 'end'
      }
  >(null)
  const timelineLongPressRef = useRef<
    | null
    | {
        timer: number
        pointerId: number
        startX: number
        startY: number
        kind: 'graphic'
        id: string
        x: number
        y: number
      }
  >(null)
  const undoStackRef = useRef<
    Array<{
      timeline: Timeline
      selectedClipId: string | null
      selectedGraphicId: string | null
      selectedLogoId: string | null
      selectedLowerThirdId: string | null
      selectedScreenTitleId: string | null
      selectedNarrationId: string | null
      selectedStillId: string | null
      selectedAudioId: string | null
    }>
  >([])
  const redoStackRef = useRef<
    Array<{
      timeline: Timeline
      selectedClipId: string | null
      selectedGraphicId: string | null
      selectedLogoId: string | null
      selectedLowerThirdId: string | null
      selectedScreenTitleId: string | null
      selectedNarrationId: string | null
      selectedStillId: string | null
      selectedAudioId: string | null
    }>
  >([])
  const [undoDepth, setUndoDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
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

  const historyKey = useMemo(() => {
    const id = Number(project?.id || 0)
    if (!Number.isFinite(id) || id <= 0) return null
    return `createVideoHistory:v1:${id}`
  }, [project?.id])

  const hashString = useCallback((s: string): string => {
    // FNV-1a 32-bit
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16)
  }, [])

  const computeTimelineHash = useCallback(
    (tl: Timeline): string => {
      try {
        // Ignore playhead for history reconciliation: scrubbing shouldn't invalidate undo/redo persistence.
        // Also normalize key order by hashing the cloned/normalized shape.
        const normalized: any = cloneTimeline(tl as any)
        normalized.playheadSeconds = 0
        return hashString(JSON.stringify(normalized))
      } catch {
        return ''
      }
    },
    [hashString]
  )

  const historyPersistTimerRef = useRef<number | null>(null)
  const persistHistoryNow = useCallback(
    (opts?: { timelineOverride?: Timeline }) => {
      if (!historyKey) return
      try {
        const currentTimeline = opts?.timelineOverride ? cloneTimeline(opts.timelineOverride) : cloneTimeline(timeline)
        const payload = {
          v: 1,
          timelineHash: computeTimelineHash(currentTimeline),
          undo: undoStackRef.current,
          redo: redoStackRef.current,
        }
        localStorage.setItem(historyKey, JSON.stringify(payload))
      } catch {
        // ignore
      }
    },
    [computeTimelineHash, historyKey, timeline]
  )

  const persistHistorySoon = useCallback(() => {
    if (!historyKey) return
    if (historyPersistTimerRef.current != null) {
      try { window.clearTimeout(historyPersistTimerRef.current) } catch {}
    }
    historyPersistTimerRef.current = window.setTimeout(() => {
      historyPersistTimerRef.current = null
      persistHistoryNow()
    }, 200)
  }, [historyKey, persistHistoryNow])

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
        startClientY?: number
        // For trims: these are source-time bounds (seconds in the file)
        startStartSeconds: number
        startEndSeconds: number
        // For trims: the timeline-time bounds at drag start (used to keep the opposite edge fixed)
        startTimelineStartSeconds?: number
        startTimelineEndSeconds?: number
        maxDurationSeconds: number
        // For move (timeline placement)
        minStartSeconds?: number
        maxEndSeconds?: number
        maxStartSeconds?: number
        // For trim (prevent overlapping the next clip on the timeline)
        maxTimelineDurationSeconds?: number
        // For armed body/edge drag (so a click can still open the context menu)
        armed?: boolean
        moved?: boolean
      }
    | {
        kind: 'still'
        stillId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startClientY?: number
        startStartSeconds: number
        startEndSeconds: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
        // For armed body/edge drag (so a tap can open the context menu)
        armed?: boolean
        moved?: boolean
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
        // For armed body-drag (so a tap can open the context menu)
        armed?: boolean
        moved?: boolean
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
        kind: 'screenTitle'
        screenTitleId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startClientY?: number
        startStartSeconds: number
        startEndSeconds: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
        // For armed body/edge drag (so a click can still open the context menu)
        armed?: boolean
        moved?: boolean
      }
    | {
        kind: 'narration'
        narrationId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startClientY?: number
        startStartSeconds: number
        startEndSeconds: number
        startSourceStartSeconds?: number
        maxDurationSeconds?: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
        // For armed body/edge drag (so a click can still open the context menu)
        armed?: boolean
        moved?: boolean
      }
    | {
        kind: 'audioSegment'
        audioSegmentId: string
        edge: 'start' | 'end' | 'move'
        pointerId: number
        startClientX: number
        startClientY?: number
        startStartSeconds: number
        startEndSeconds: number
        startSourceStartSeconds?: number
        maxDurationSeconds?: number
        minStartSeconds: number
        maxEndSeconds: number
        maxStartSeconds?: number
        // For armed body/edge drag (so a click can still open the context menu)
        armed?: boolean
        moved?: boolean
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
          selectedScreenTitleId,
          selectedNarrationId,
          selectedAudioId,
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
    [
      debugEnabled,
      panDragging,
      selectedAudioId,
      selectedClipId,
      selectedGraphicId,
      selectedLogoId,
      selectedLowerThirdId,
      selectedNarrationId,
      selectedScreenTitleId,
      trimDragging,
    ]
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
	        if (p && typeof (p as any).then === 'function') {
	          let ok = true
	          await p.catch(() => { ok = false })
	          return ok
	        }
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
  const totalSeconds = useMemo(() => {
    let m = Math.max(0, roundToTenth(Math.max(totalSecondsVideo, totalSecondsGraphics, totalSecondsStills)))
    const ls: any[] = Array.isArray((timeline as any).logos) ? (timeline as any).logos : []
    const lts: any[] = Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : []
    const sts: any[] = Array.isArray((timeline as any).screenTitles) ? (timeline as any).screenTitles : []
    const ns: any[] = Array.isArray((timeline as any).narration) ? (timeline as any).narration : []
    for (const l of ls) {
      const e = Number((l as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    for (const lt of lts) {
      const e = Number((lt as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    for (const st of sts) {
      const e = Number((st as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    for (const n of ns) {
      const e = Number((n as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    const segs: any[] = Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : []
    for (const seg of segs) {
      const e = Number((seg as any).endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    return Math.max(0, roundToTenth(m))
  }, [timeline, totalSecondsGraphics, totalSecondsStills, totalSecondsVideo])

  const outputFrame = useMemo(() => {
    const even = (n: number) => {
      const v = Math.max(2, Math.round(n))
      return v % 2 === 0 ? v : v - 1
    }
    const computeTarget = (w: number, h: number) => {
      const maxLongEdge = 1080
      const longEdge = Math.max(w, h)
      const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1
      return { width: even(w * scale), height: even(h * scale) }
    }
    if (timeline.clips.length) {
      let firstIdx = 0
      let minStart = Number.POSITIVE_INFINITY
      for (let i = 0; i < timeline.clips.length; i++) {
        const s = Number(clipStarts[i] || 0)
        if (Number.isFinite(s) && s < minStart) {
          minStart = s
          firstIdx = i
        }
      }
      const clip = timeline.clips[firstIdx]
      const dims = clip ? dimsByUploadId[Number(clip.uploadId)] : null
      if (dims && Number.isFinite(Number(dims.width)) && Number.isFinite(Number(dims.height)) && dims.width > 0 && dims.height > 0) {
        return computeTarget(Number(dims.width), Number(dims.height))
      }
    }
    return { width: 1080, height: 1920 }
  }, [clipStarts, dimsByUploadId, timeline.clips])

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
    const sts: any[] = Array.isArray((tl as any).screenTitles) ? (tl as any).screenTitles : []
    let stEnd = 0
    for (const st of sts) {
      const e = Number((st as any).endSeconds)
      if (Number.isFinite(e) && e > stEnd) stEnd = e
    }
    const ns: any[] = Array.isArray((tl as any).narration) ? (tl as any).narration : []
    let nEnd = 0
    for (const n of ns) {
      const e = Number((n as any).endSeconds)
      if (Number.isFinite(e) && e > nEnd) nEnd = e
    }
    const segs: any[] = Array.isArray((tl as any).audioSegments) ? (tl as any).audioSegments : []
    let aEnd = 0
    for (const seg of segs) {
      const e = Number((seg as any).endSeconds)
      if (Number.isFinite(e) && e > aEnd) aEnd = e
    }
    return Math.max(0, roundToTenth(Math.max(videoEnd, gEnd, sEnd, lEnd, ltEnd, stEnd, nEnd, aEnd)))
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
  const SCREEN_TITLE_Y = TRACKS_TOP + TRACK_H * 2 + 6
  const GRAPHICS_Y = TRACKS_TOP + TRACK_H * 3 + 6
  const VIDEO_Y = TRACKS_TOP + TRACK_H * 4 + 6
  const NARRATION_Y = TRACKS_TOP + TRACK_H * 5 + 6
  const AUDIO_Y = TRACKS_TOP + TRACK_H * 6 + 6
  const PILL_H = Math.max(18, TRACK_H - 12)
  const HANDLE_HIT_PX = 18
  const TIMELINE_H = TRACKS_TOP + TRACK_H * 7

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null
    return timeline.clips.find((c) => c.id === selectedClipId) || null
  }, [selectedClipId, timeline.clips])
  const selectedClipIndex = useMemo(() => {
    if (!selectedClipId) return -1
    return timeline.clips.findIndex((c) => c.id === selectedClipId)
  }, [selectedClipId, timeline.clips])

  const graphics = useMemo(() => (Array.isArray((timeline as any).graphics) ? ((timeline as any).graphics as Graphic[]) : []), [timeline])
  const guidelines = useMemo(
    () =>
      (Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : [])
        .map((t: any) => roundToTenth(Number(t)))
        .filter((t: any) => Number.isFinite(t) && t >= 0)
        .sort((a: number, b: number) => a - b),
    [timeline]
  )
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

  const screenTitles = useMemo(() => (Array.isArray((timeline as any).screenTitles) ? ((timeline as any).screenTitles as ScreenTitle[]) : []), [timeline])
  const selectedScreenTitle = useMemo(() => {
    if (!selectedScreenTitleId) return null
    return screenTitles.find((st) => String((st as any).id) === String(selectedScreenTitleId)) || null
  }, [screenTitles, selectedScreenTitleId])

  const openScreenTitleEditorById = useCallback(
    (id: string) => {
      const st = screenTitles.find((ss: any) => String((ss as any).id) === String(id)) as any
      if (!st) return false
      const s = roundToTenth(Number((st as any).startSeconds || 0))
      const e2 = roundToTenth(Number((st as any).endSeconds || 0))
      const presetId = Number((st as any).presetId || 0)
      const text = String((st as any).text || '')
      setSelectedScreenTitleId(String((st as any).id))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setScreenTitleEditor({ id: String((st as any).id), start: s, end: e2, presetId, text })
      setScreenTitleEditorError(null)
      return true
    },
    [screenTitles]
  )

  const returnToScreenTitleId = useMemo(() => {
    try {
      if (typeof window === 'undefined') return null
      const qp = new URLSearchParams(window.location.search)
      const v = String(qp.get('cvScreenTitleId') || '').trim()
      if (!v) return null
      return v
    } catch {
      return null
    }
  }, [])

  const handledReturnToScreenTitleRef = useRef(false)
  useEffect(() => {
    if (handledReturnToScreenTitleRef.current) return
    if (!returnToScreenTitleId) return
    if (!screenTitles.length) return
    const ok = openScreenTitleEditorById(returnToScreenTitleId)
    if (!ok) return
    handledReturnToScreenTitleRef.current = true
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('cvScreenTitleId')
      const next = `${url.pathname}${url.search}${url.hash || ''}`
      window.history.replaceState({}, '', next)
    } catch {}
  }, [openScreenTitleEditorById, returnToScreenTitleId, screenTitles.length])

  const narration = useMemo(() => (Array.isArray((timeline as any).narration) ? (((timeline as any).narration as any) as Narration[]) : []), [timeline])
  const selectedNarration = useMemo(() => {
    if (!selectedNarrationId) return null
    return narration.find((n: any) => String((n as any)?.id) === String(selectedNarrationId)) || null
  }, [narration, selectedNarrationId])

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

  const audioSegments = useMemo(() => {
    const raw = (timeline as any).audioSegments
    if (Array.isArray(raw)) {
      return (raw as any[]).map((s: any) => ({
        id: String(s?.id || ''),
        uploadId: Number(s?.uploadId),
        audioConfigId: Number(s?.audioConfigId),
        startSeconds: roundToTenth(Math.max(0, Number(s?.startSeconds || 0))),
        endSeconds: roundToTenth(Math.max(0, Number(s?.endSeconds || 0))),
        sourceStartSeconds: s?.sourceStartSeconds == null ? 0 : roundToTenth(Math.max(0, Number(s?.sourceStartSeconds || 0))),
      }))
    }
    if (audioTrack) {
      return [
        {
          id: 'audio_track_legacy',
          uploadId: audioTrack.uploadId,
          audioConfigId: audioTrack.audioConfigId,
          startSeconds: audioTrack.startSeconds,
          endSeconds: audioTrack.endSeconds,
          sourceStartSeconds: 0,
        },
      ]
    }
    return []
  }, [audioTrack, timeline])

  // If we learn the true audio duration after a segment was created, clamp its visible duration
  // to avoid implying "looping" behavior.
  useEffect(() => {
    const raw: any[] = Array.isArray((timeline as any).audioSegments) ? ((timeline as any).audioSegments as any[]) : []
    if (!raw.length) return
    let changed = false
    const next = raw.map((s: any) => {
      const uploadId = Number(s?.uploadId)
      const durRaw = durationsByUploadId[uploadId]
      const dur = durRaw != null && Number.isFinite(Number(durRaw)) && Number(durRaw) > 0 ? roundToTenth(Number(durRaw)) : null
      if (dur == null) return s
      const srcStart =
        s?.sourceStartSeconds != null && Number.isFinite(Number(s.sourceStartSeconds)) ? roundToTenth(Number(s.sourceStartSeconds)) : 0
      const startS = roundToTenth(Number(s?.startSeconds || 0))
      const endS = roundToTenth(Number(s?.endSeconds || 0))
      const maxLen = roundToTenth(Math.max(0, dur - srcStart))
      const len = roundToTenth(Math.max(0, endS - startS))
      if (len <= maxLen + 0.05) return s
      changed = true
      return { ...(s as any), endSeconds: roundToTenth(startS + maxLen) }
    })
    if (!changed) return
    setTimeline((prev) => ({ ...(prev as any), audioSegments: next, audioTrack: null } as any))
  }, [durationsByUploadId, timeline])

  const selectedAudio = Boolean(selectedAudioId)
  const selectedAudioSegment = useMemo(() => {
    if (!selectedAudioId) return null
    return audioSegments.find((s: any) => String(s.id) === String(selectedAudioId)) || null
  }, [audioSegments, selectedAudioId])

  const audioConfigNameById = useMemo(() => {
    const map: Record<number, string> = {}
    for (const c of audioConfigs) {
      const id = Number((c as any).id)
      if (!Number.isFinite(id) || id <= 0) continue
      map[id] = String((c as any).name || '')
    }
    return map
  }, [audioConfigs])

  const probeAudioDurationSeconds = useCallback(async (file: File): Promise<number | null> => {
    try {
      const url = URL.createObjectURL(file)
      try {
        const a = new Audio()
        a.preload = 'metadata'
        a.src = url
        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => resolve()
          const onErr = () => reject(new Error('failed_to_probe_audio'))
          a.addEventListener('loadedmetadata', onLoaded, { once: true })
          a.addEventListener('error', onErr, { once: true })
        })
        const d = Number(a.duration)
        if (!Number.isFinite(d) || d <= 0) return null
        return d
      } finally {
        try { URL.revokeObjectURL(url) } catch {}
      }
    } catch {
      return null
    }
  }, [])

  const uploadNarrationFile = useCallback(
    async (file: File): Promise<{ uploadId: number; durationSeconds: number | null }> => {
      const durationSeconds = await probeAudioDurationSeconds(file)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const signRes = await fetch('/api/create-video/narration/sign', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          durationSeconds: durationSeconds != null ? Math.round(durationSeconds) : null,
        }),
      })
      const signJson: any = await signRes.json().catch(() => null)
      if (!signRes.ok) throw new Error(String(signJson?.detail || signJson?.error || 'failed_to_sign'))
      const uploadId = Number(signJson?.id || 0)
      const post = signJson?.post
      if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('failed_to_sign')
      if (!post || typeof post !== 'object' || !post.url) throw new Error('failed_to_sign')

      const formData = new FormData()
      for (const [k, v] of Object.entries(post.fields || {})) formData.append(k, String(v))
      formData.append('file', file)
      const upRes = await fetch(String(post.url), { method: 'POST', body: formData })
      if (!upRes.ok) throw new Error(`s3_upload_failed_${String(upRes.status)}`)

      const completeHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf2 = getCsrfToken()
      if (csrf2) completeHeaders['x-csrf-token'] = csrf2
      const completeRes = await fetch('/api/mark-complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: completeHeaders,
        body: JSON.stringify({ id: uploadId, sizeBytes: file.size }),
      })
      if (!completeRes.ok) {
        const j: any = await completeRes.json().catch(() => null)
        throw new Error(String(j?.detail || j?.error || 'failed_to_mark'))
      }
      return { uploadId, durationSeconds }
    },
    [probeAudioDurationSeconds]
  )

  const canUndo = undoDepth > 0
  const canRedo = redoDepth > 0

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
    for (const st of screenTitles) {
      const s = roundToTenth(Number((st as any).startSeconds || 0))
      const e = roundToTenth(Number((st as any).endSeconds || 0))
      if (e > s) out.push(s, e)
    }
    for (const a of audioSegments) {
      const s = roundToTenth(Number((a as any).startSeconds || 0))
      const e = roundToTenth(Number((a as any).endSeconds || 0))
      if (e > s) out.push(s, e)
    }
    const guidelines: any[] = Array.isArray((timeline as any).guidelines) ? (timeline as any).guidelines : []
    for (const g of guidelines) {
      const t = roundToTenth(Number(g || 0))
      if (Number.isFinite(t) && t >= 0) out.push(t)
    }
    out.push(roundToTenth(totalSeconds))
    const uniq = new Map<string, number>()
    for (const t of out) {
      const tt = roundToTenth(Number(t) || 0)
      uniq.set(tt.toFixed(1), tt)
    }
    return Array.from(uniq.values()).sort((a, b) => a - b)
  }, [audioSegments, clipStarts, graphics, logos, lowerThirds, screenTitles, stills, timeline.clips, totalSeconds])

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
	      const maxDurRaw =
	        drag.maxDurationSeconds != null && Number.isFinite(Number(drag.maxDurationSeconds)) ? Number(drag.maxDurationSeconds) : undefined
	      const totalNoOffsetSecondsRaw =
	        maxDurRaw != null && maxDurRaw > 0 ? maxDurRaw : durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
	      const totalNoOffsetSeconds = roundToTenth(Math.max(0, Number(totalNoOffsetSecondsRaw) || 0))
	      const startWithOffsetSeconds = roundToTenth(Number(clip.sourceStartSeconds || 0))
	      const endWithOffsetSeconds = roundToTenth(Number(clip.sourceEndSeconds || 0))
	      const durationWithOffsetsSeconds = roundToTenth(Math.max(0, endWithOffsetSeconds - startWithOffsetSeconds))
	      return {
	        kindLabel: 'Video',
	        actionLabel,
	        name,
	        start,
	        end,
	        len,
	        trimOffsets: {
	          startWithOffsetSeconds,
	          startNoOffsetSeconds: 0,
	          endWithOffsetSeconds,
	          durationWithOffsetsSeconds,
	          durationNoOffsetsSeconds: totalNoOffsetSeconds,
	          endNoOffsetSeconds: totalNoOffsetSeconds,
	        },
	        edge: drag.edge,
	      }
	    }

	    if (drag.kind === 'narration') {
	      const ns: any[] = Array.isArray((timeline as any).narration) ? (timeline as any).narration : []
	      const n = ns.find((x: any) => String(x?.id) === String((drag as any).narrationId)) as any
	      if (!n) return null
	      const name = namesByUploadId[Number(n.uploadId)] || `Voice ${n.uploadId}`
	      const start = roundToTenth(Number(n.startSeconds || 0))
	      const end = roundToTenth(Number(n.endSeconds || 0))
	      const len = Math.max(0, roundToTenth(end - start))

	      const totalNoOffsetSecondsRaw = durationsByUploadId[Number(n.uploadId)] ?? 0
	      const totalNoOffsetSeconds = roundToTenth(Math.max(0, Number(totalNoOffsetSecondsRaw) || 0))
	      const startWithOffsetSeconds = roundToTenth(
	        n.sourceStartSeconds != null && Number.isFinite(Number(n.sourceStartSeconds)) ? Number(n.sourceStartSeconds) : 0
	      )
	      const durationWithOffsetsSeconds = len
	      const endWithOffsetSeconds = roundToTenth(
	        totalNoOffsetSeconds > 0 ? clamp(startWithOffsetSeconds + durationWithOffsetsSeconds, 0, totalNoOffsetSeconds) : startWithOffsetSeconds + durationWithOffsetsSeconds
	      )

	      return {
	        kindLabel: 'Voice',
	        actionLabel,
	        name,
	        start,
	        end,
	        len,
	        trimOffsets: {
	          startWithOffsetSeconds,
	          startNoOffsetSeconds: 0,
	          endWithOffsetSeconds,
	          durationWithOffsetsSeconds,
	          durationNoOffsetsSeconds: totalNoOffsetSeconds,
	          endNoOffsetSeconds: totalNoOffsetSeconds,
	        },
	        edge: drag.edge,
	      }
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

    if (drag.kind === 'screenTitle') {
      const st = screenTitles.find((x: any) => String((x as any).id) === String((drag as any).screenTitleId)) as any
      if (!st) return null
      const presetName = String(st?.presetSnapshot?.name || '').trim() || 'Unconfigured'
      const text = String(st?.text || '').replace(/\s+/g, ' ').trim()
      const name = text ? `${presetName} • ${text}` : presetName
      const start = roundToTenth(Number(st.startSeconds || 0))
      const end = roundToTenth(Number(st.endSeconds || 0))
      const len = Math.max(0, roundToTenth(end - start))
      return { kindLabel: 'Screen title', actionLabel, name, start, end, len }
    }

	    if (drag.kind === 'audioSegment') {
	      const seg = audioSegments.find((s: any) => String(s?.id) === String((drag as any).audioSegmentId)) as any
	      if (!seg) return null
	      const audioName = namesByUploadId[Number(seg.uploadId)] || `Audio ${seg.uploadId}`
	      const cfgName = audioConfigNameById[Number(seg.audioConfigId)] || `Config ${seg.audioConfigId}`
	      const name = `${audioName} • ${cfgName}`
	      const start = roundToTenth(Number(seg.startSeconds || 0))
	      const end = roundToTenth(Number(seg.endSeconds || 0))
	      const len = Math.max(0, roundToTenth(end - start))

	      const totalNoOffsetSecondsRaw = durationsByUploadId[Number(seg.uploadId)] ?? 0
	      const totalNoOffsetSeconds = roundToTenth(Math.max(0, Number(totalNoOffsetSecondsRaw) || 0))
	      const startWithOffsetSeconds = roundToTenth(Math.max(0, Number(seg.sourceStartSeconds || 0)))
	      const durationWithOffsetsSeconds = len
	      const endWithOffsetSeconds = roundToTenth(
	        totalNoOffsetSeconds > 0
	          ? Math.min(totalNoOffsetSeconds, startWithOffsetSeconds + durationWithOffsetsSeconds)
	          : startWithOffsetSeconds + durationWithOffsetsSeconds
	      )

	      return {
	        kindLabel: 'Audio',
	        actionLabel,
	        name,
	        start,
	        end,
	        len,
	        trimOffsets: {
	          startWithOffsetSeconds,
	          startNoOffsetSeconds: 0,
	          endWithOffsetSeconds,
	          durationWithOffsetsSeconds,
	          durationNoOffsetsSeconds: totalNoOffsetSeconds,
	          endNoOffsetSeconds: totalNoOffsetSeconds,
	        },
	        edge: drag.edge,
	      }
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
	    audioSegments,
	    clipStarts,
	    graphics,
	    logos,
	    lowerThirds,
	    screenTitles,
	    stills,
	    namesByUploadId,
	    durationsByUploadId,
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

  const findScreenTitleAtTime = useCallback((t: number): ScreenTitle | null => {
    const tt = Number(t)
    if (!Number.isFinite(tt) || tt < 0) return null
    const candidates: Array<{ s: number; e: number; st: ScreenTitle }> = []
    for (const st of screenTitles) {
      const s = Number((st as any).startSeconds)
      const e = Number((st as any).endSeconds)
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue
      if (tt >= s && tt <= e) candidates.push({ s, e, st })
    }
    if (!candidates.length) return null
    for (const c of candidates) {
      if (roundToTenth(c.s) === roundToTenth(tt)) return c.st
    }
    candidates.sort((a, b) => a.s - b.s || a.e - b.e)
    return candidates[0].st
  }, [screenTitles])

  const findNarrationAtTime = useCallback((t: number): Narration | null => {
    const tt = Number(t)
    if (!Number.isFinite(tt) || tt < 0) return null
    const candidates: Array<{ s: number; e: number; n: Narration }> = []
    for (const n of narration) {
      const s = Number((n as any).startSeconds)
      const e = Number((n as any).endSeconds)
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue
      if (tt >= s && tt <= e) candidates.push({ s, e, n })
    }
    if (!candidates.length) return null
    for (const c of candidates) {
      if (roundToTenth(c.s) === roundToTenth(tt)) return c.n
    }
    candidates.sort((a, b) => a.s - b.s || a.e - b.e)
    return candidates[0].n
  }, [narration])

  const findAudioSegmentAtTime = useCallback(
    (t: number): any | null => {
      const tt = Number(t)
      if (!Number.isFinite(tt) || tt < 0) return null
      const candidates: Array<{ s: number; e: number; seg: any }> = []
      for (const seg of audioSegments) {
        const s = Number((seg as any).startSeconds)
        const e = Number((seg as any).endSeconds)
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue
        if (tt >= s && tt <= e) candidates.push({ s, e, seg })
      }
      if (!candidates.length) return null
      for (const c of candidates) {
        if (roundToTenth(c.s) === roundToTenth(tt)) return c.seg
      }
      candidates.sort((a, b) => a.s - b.s || a.e - b.e)
      return candidates[0].seg
    },
    [audioSegments]
  )

  const sortedAudioSegments = useMemo(() => {
    return audioSegments
      .slice()
      .map((s: any) => ({
        ...s,
        startSeconds: roundToTenth(Math.max(0, Number(s?.startSeconds || 0))),
        endSeconds: roundToTenth(Math.max(0, Number(s?.endSeconds || 0))),
        sourceStartSeconds:
          s?.sourceStartSeconds != null && Number.isFinite(Number(s.sourceStartSeconds))
            ? roundToTenth(Math.max(0, Number(s.sourceStartSeconds)))
            : 0,
      }))
      .filter((s: any) => Number(s.endSeconds) > Number(s.startSeconds))
      .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  }, [audioSegments])

  const sortedNarration = useMemo(() => {
    return narration
      .slice()
      .map((n: any) => ({
        ...n,
        startSeconds: roundToTenth(Math.max(0, Number(n?.startSeconds || 0))),
        endSeconds: roundToTenth(Math.max(0, Number(n?.endSeconds || 0))),
      }))
      .filter((n: any) => Number(n.endSeconds) > Number(n.startSeconds))
      .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
  }, [narration])

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
  const activeScreenTitleAtPlayhead = useMemo(() => findScreenTitleAtTime(playhead), [findScreenTitleAtTime, playhead])
  const activeStillAtPlayhead = useMemo(() => findStillAtTime(playhead), [findStillAtTime, playhead])

  // Safety: when a freeze-frame still finishes during playback, ensure we leave "playing" state.
  // (Some browsers can leave us in a "playing" UI state even though no video can autoplay-start.)
  useEffect(() => {
    if (!playing) return
    if (activeUploadId != null) return
    if (activeStillAtPlayhead) return
    const t = roundToTenth(Number(playhead) || 0)
    const endedStill = stills.find((s: any) => {
      const a = roundToTenth(Number((s as any).startSeconds || 0))
      const b = roundToTenth(Number((s as any).endSeconds || 0))
      if (!(b > a)) return false
      return Math.abs(b - t) < 0.05
    })
    if (!endedStill) return
    const cur = gapPlaybackRef.current
    if (cur) {
      window.cancelAnimationFrame(cur.raf)
      gapPlaybackRef.current = null
    }
    setPlaying(false)
  }, [activeStillAtPlayhead, activeUploadId, playhead, playing, stills])
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

  const activeScreenTitleRenderUploadId = useMemo(() => {
    const st: any = activeScreenTitleAtPlayhead as any
    if (!st) return null
    const id = Number((st as any).renderUploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [activeScreenTitleAtPlayhead])
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

  const activeScreenTitleUrl = useMemo(() => {
    if (!activeScreenTitleRenderUploadId) return null
    return (
      graphicFileUrlByUploadId[activeScreenTitleRenderUploadId] ||
      `/api/uploads/${encodeURIComponent(String(activeScreenTitleRenderUploadId))}/file`
    )
  }, [activeScreenTitleRenderUploadId, graphicFileUrlByUploadId])

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

  const activeScreenTitlePreview = useMemo(() => {
    const seg: any = activeScreenTitleAtPlayhead as any
    const url = activeScreenTitleUrl
    if (!seg || !url) return null
    const segStart = Number(seg.startSeconds || 0)
    const segEnd = Number(seg.endSeconds || 0)
    if (!(Number.isFinite(segStart) && Number.isFinite(segEnd) && segEnd > segStart)) return null
    const segDur = Math.max(0, segEnd - segStart)
    const preset: any = seg.presetSnapshot && typeof seg.presetSnapshot === 'object' ? seg.presetSnapshot : null
    if (!preset) return null
    const tRel = Number(playhead) - segStart
    if (!(Number.isFinite(tRel) && tRel >= -1e-6 && tRel <= segDur + 1e-6)) return null
    const alpha = computeFadeAlpha({ fade: preset.fade }, tRel, 0, segDur)
    if (!(alpha > 0.001)) return null
    const style: any = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: previewObjectFit,
      pointerEvents: 'none',
      opacity: alpha,
      zIndex: 35,
    }
    return { url, style }
  }, [activeScreenTitleAtPlayhead, activeScreenTitleUrl, playhead, previewObjectFit])

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
    if (!selectedNarrationId) return
    const seg: any = narration.find((n: any) => String(n?.id) === String(selectedNarrationId))
    if (!seg) return
    const uploadId = Number(seg.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    ensureAudioEnvelope(uploadId).catch(() => {})
  }, [ensureAudioEnvelope, narration, selectedNarrationId])

  const stopNarrationPreview = useCallback(() => {
    const a = narrationPreviewRef.current
    try { a?.pause?.() } catch {}
    if (narrationPreviewRafRef.current != null) {
      try { window.cancelAnimationFrame(narrationPreviewRafRef.current) } catch {}
    }
    narrationPreviewRafRef.current = null
    narrationPreviewSegRef.current = null
    setNarrationPreviewPlaying(false)
  }, [])

  const stopMusicPreview = useCallback(() => {
    const a = musicPreviewRef.current
    try { a?.pause?.() } catch {}
    if (musicPreviewRafRef.current != null) {
      try { window.cancelAnimationFrame(musicPreviewRafRef.current) } catch {}
    }
    musicPreviewRafRef.current = null
    musicPreviewSegRef.current = null
    setMusicPreviewPlaying(false)
  }, [])

  const toggleNarrationPlay = useCallback(async () => {
    if (narrationPreviewPlaying) {
      stopNarrationPreview()
      return
    }
    if (musicPreviewPlaying) stopMusicPreview()
    if (!sortedNarration.length) {
      setTimelineMessage('No narration segments')
      return
    }

    // If playhead is not inside a narration segment, jump to the next segment start and stop.
    const segAt = findNarrationAtTime(playhead)
    const eps = 0.05
    if (!segAt) {
      const next = sortedNarration.find((n: any) => Number(n.startSeconds) > Number(playhead) + eps)
      if (!next) {
        setTimelineMessage('No next narration segment')
        return
      }
      setTimeline((prev) => ({ ...prev, playheadSeconds: roundToTenth(Number(next.startSeconds || 0)) }))
      setTimelineMessage(null)
      return
    }

    // Pause main playback (video/graphics clock) so we don't fight over playhead updates.
    try { videoRef.current?.pause?.() } catch {}
    setPlaying(false)
    const curGap = gapPlaybackRef.current
    if (curGap) {
      try { window.cancelAnimationFrame(curGap.raf) } catch {}
      gapPlaybackRef.current = null
    }

    const segStart = roundToTenth(Number((segAt as any).startSeconds || 0))
    const segEnd = roundToTenth(Number((segAt as any).endSeconds || 0))
    if (!(segEnd > segStart + 0.05)) return
    const uploadId = Number((segAt as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return

    const a = narrationPreviewRef.current || new Audio()
    narrationPreviewRef.current = a
    try { a.pause() } catch {}
    const url = (await getUploadCdnUrl(uploadId, { kind: 'file' })) || `/api/uploads/${encodeURIComponent(String(uploadId))}/file`
    a.src = url
    a.preload = 'auto'

    const startTimeline = clamp(roundToTenth(Number(playhead)), segStart, segEnd)
    const startInSeg = Math.max(0, startTimeline - segStart)
    const stopAtTimeline = segEnd

    await new Promise<void>((resolve) => {
      if (a.readyState >= 1) return resolve()
      const onMeta = () => {
        a.removeEventListener('loadedmetadata', onMeta)
        resolve()
      }
      a.addEventListener('loadedmetadata', onMeta)
      try { a.load() } catch {}
    })
    const srcStart0 =
      (segAt as any).sourceStartSeconds != null && Number.isFinite(Number((segAt as any).sourceStartSeconds))
        ? Number((segAt as any).sourceStartSeconds)
        : 0
    try { a.currentTime = Math.max(0, srcStart0 + startInSeg) } catch {}

    narrationPreviewSegRef.current = { segId: String((segAt as any).id), uploadId, segStart, segEnd, sourceStartSeconds: srcStart0 }

    try {
      const p = a.play()
      if (p && typeof (p as any).catch === 'function') await (p as any).catch(() => {})
    } catch {
      stopNarrationPreview()
      return
    }

    setNarrationPreviewPlaying(true)
    setTimelineMessage(null)

    const tick = () => {
      if (!narrationPreviewRef.current) return
      if (!narrationPreviewSegRef.current) return
      const cur = narrationPreviewRef.current
      const seg = narrationPreviewSegRef.current
      const srcStart1 = Number(seg.sourceStartSeconds || 0)
      const nextPlayhead = clamp(roundToTenth(seg.segStart + Math.max(0, Number(cur.currentTime || 0) - srcStart1)), 0, Math.max(0, totalSeconds))
      playheadFromVideoRef.current = true
      playheadRef.current = nextPlayhead
      setTimeline((prev) => ({ ...prev, playheadSeconds: nextPlayhead }))

      // When we hit the end of the current segment, auto-advance only if the next segment is
      // contiguous on the timeline AND uses the same source uploadId. This avoids requiring an
      // extra Play tap when playback can stay on the same <audio> element.
      if (nextPlayhead >= seg.segEnd - 0.02) {
        const eps2 = 0.05
        const at = roundToTenth(Number(seg.segEnd || 0))
        const next = sortedNarration.find(
          (n: any) =>
            Number((n as any).uploadId) === Number(seg.uploadId) &&
            String((n as any).id) !== String(seg.segId) &&
            Math.abs(roundToTenth(Number((n as any).startSeconds || 0)) - at) < eps2
        ) as any

        if (next) {
          const nextStart = roundToTenth(Number(next.startSeconds || 0))
          const nextEnd = roundToTenth(Number(next.endSeconds || 0))
          const nextUploadId = Number(next.uploadId)
          const nextSrcStart =
            next.sourceStartSeconds != null && Number.isFinite(Number(next.sourceStartSeconds)) ? Number(next.sourceStartSeconds) : 0

          const overshoot = roundToTenth(Math.max(0, nextPlayhead - at))
          narrationPreviewSegRef.current = {
            segId: String(next.id),
            uploadId: nextUploadId,
            segStart: nextStart,
            segEnd: nextEnd,
            sourceStartSeconds: nextSrcStart,
          }
          try { cur.currentTime = Math.max(0, nextSrcStart + overshoot) } catch {}
          const ph = clamp(roundToTenth(nextStart + overshoot), 0, Math.max(0, totalSeconds))
          playheadFromVideoRef.current = true
          playheadRef.current = ph
          setTimeline((prev) => ({ ...prev, playheadSeconds: ph }))
          narrationPreviewRafRef.current = window.requestAnimationFrame(tick)
          return
        }

        const stopAt = roundToTenth(Number(seg.segEnd || 0))
        stopNarrationPreview()
        setTimeline((prev) => ({ ...prev, playheadSeconds: stopAt }))
        return
      }
      narrationPreviewRafRef.current = window.requestAnimationFrame(tick)
    }
    narrationPreviewRafRef.current = window.requestAnimationFrame(tick)
  }, [
    findNarrationAtTime,
    musicPreviewPlaying,
    narrationPreviewPlaying,
    playhead,
    sortedNarration,
    stopMusicPreview,
    stopNarrationPreview,
    totalSeconds,
  ])

  const toggleMusicPlay = useCallback(async () => {
    if (musicPreviewPlaying) {
      stopMusicPreview()
      return
    }
    if (narrationPreviewPlaying) stopNarrationPreview()
    if (!sortedAudioSegments.length) {
      setTimelineMessage('No music segments')
      return
    }

    // If playhead is not inside a music segment, jump to the next segment start and stop.
    const segAt = findAudioSegmentAtTime(playhead)
    const eps = 0.05
    if (!segAt) {
      const next = sortedAudioSegments.find((s: any) => Number(s.startSeconds) > Number(playhead) + eps)
      if (!next) {
        setTimelineMessage('No next music segment')
        return
      }
      setTimeline((prev) => ({ ...prev, playheadSeconds: roundToTenth(Number(next.startSeconds || 0)) }))
      setTimelineMessage(null)
      return
    }

    // Pause main playback (video/graphics clock) so we don't fight over playhead updates.
    try { videoRef.current?.pause?.() } catch {}
    setPlaying(false)
    const curGap = gapPlaybackRef.current
    if (curGap) {
      try { window.cancelAnimationFrame(curGap.raf) } catch {}
      gapPlaybackRef.current = null
    }

    const segStart = roundToTenth(Number((segAt as any).startSeconds || 0))
    const segEnd = roundToTenth(Number((segAt as any).endSeconds || 0))
    if (!(segEnd > segStart + 0.05)) return
    const uploadId = Number((segAt as any).uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return

    const a = musicPreviewRef.current || new Audio()
    musicPreviewRef.current = a
    try { a.pause() } catch {}
    const url = (await getUploadCdnUrl(uploadId, { kind: 'file' })) || `/api/uploads/${encodeURIComponent(String(uploadId))}/file`
    a.src = url
    a.preload = 'auto'

    const startTimeline = clamp(roundToTenth(Number(playhead)), segStart, segEnd)
    const startInSeg = Math.max(0, startTimeline - segStart)
    await new Promise<void>((resolve) => {
      if (a.readyState >= 1) return resolve()
      const onMeta = () => {
        a.removeEventListener('loadedmetadata', onMeta)
        resolve()
      }
      a.addEventListener('loadedmetadata', onMeta)
      try { a.load() } catch {}
    })
    const srcStart0 =
      (segAt as any).sourceStartSeconds != null && Number.isFinite(Number((segAt as any).sourceStartSeconds))
        ? Number((segAt as any).sourceStartSeconds)
        : 0
    try { a.currentTime = Math.max(0, srcStart0 + startInSeg) } catch {}

    musicPreviewSegRef.current = { segId: String((segAt as any).id), uploadId, segStart, segEnd, sourceStartSeconds: srcStart0 }
    setSelectedAudioId(String((segAt as any).id))

    try {
      const p = a.play()
      if (p && typeof (p as any).catch === 'function') await (p as any).catch(() => {})
    } catch {
      stopMusicPreview()
      return
    }

    setMusicPreviewPlaying(true)
    setTimelineMessage(null)

    const tick = () => {
      if (!musicPreviewRef.current) return
      if (!musicPreviewSegRef.current) return
      const cur = musicPreviewRef.current
      const seg = musicPreviewSegRef.current
      const srcStart1 = Number(seg.sourceStartSeconds || 0)
      const nextPlayhead = clamp(roundToTenth(seg.segStart + Math.max(0, Number(cur.currentTime || 0) - srcStart1)), 0, Math.max(0, totalSeconds))
      playheadFromVideoRef.current = true
      playheadRef.current = nextPlayhead
      setTimeline((prev) => ({ ...prev, playheadSeconds: nextPlayhead }))

      // Auto-advance to the next contiguous segment when it uses the same source uploadId.
      if (nextPlayhead >= seg.segEnd - 0.02) {
        const eps2 = 0.05
        const at = roundToTenth(Number(seg.segEnd || 0))
        const next = sortedAudioSegments.find(
          (s: any) =>
            Number((s as any).uploadId) === Number(seg.uploadId) &&
            String((s as any).id) !== String(seg.segId) &&
            Math.abs(roundToTenth(Number((s as any).startSeconds || 0)) - at) < eps2
        ) as any

        if (next) {
          const nextStart = roundToTenth(Number(next.startSeconds || 0))
          const nextEnd = roundToTenth(Number(next.endSeconds || 0))
          const nextUploadId = Number(next.uploadId)
          const nextSrcStart =
            next.sourceStartSeconds != null && Number.isFinite(Number(next.sourceStartSeconds)) ? Number(next.sourceStartSeconds) : 0

          const overshoot = roundToTenth(Math.max(0, nextPlayhead - at))
          musicPreviewSegRef.current = {
            segId: String(next.id),
            uploadId: nextUploadId,
            segStart: nextStart,
            segEnd: nextEnd,
            sourceStartSeconds: nextSrcStart,
          }
          try { cur.currentTime = Math.max(0, nextSrcStart + overshoot) } catch {}
          const ph = clamp(roundToTenth(nextStart + overshoot), 0, Math.max(0, totalSeconds))
          playheadFromVideoRef.current = true
          playheadRef.current = ph
          setTimeline((prev) => ({ ...prev, playheadSeconds: ph }))
          setSelectedAudioId(String(next.id))
          musicPreviewRafRef.current = window.requestAnimationFrame(tick)
          return
        }

        const stopAt = roundToTenth(Number(seg.segEnd || 0))
        stopMusicPreview()
        setTimeline((prev) => ({ ...prev, playheadSeconds: stopAt }))
        return
      }
      musicPreviewRafRef.current = window.requestAnimationFrame(tick)
    }
    musicPreviewRafRef.current = window.requestAnimationFrame(tick)
  }, [
    findAudioSegmentAtTime,
    musicPreviewPlaying,
    narrationPreviewPlaying,
    playhead,
    sortedAudioSegments,
    stopMusicPreview,
    stopNarrationPreview,
    totalSeconds,
  ])

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
    if (!audioSegments.length) return
    const nextTotal = Math.max(0, roundToTenth(totalSeconds))
    if (!(nextTotal > 0)) return

    const sorted = audioSegments
      .slice()
      .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
    const last = sorted[sorted.length - 1]
    if (!last) return
    const curStart = roundToTenth(Number(last.startSeconds || 0))
    const curEnd = roundToTenth(Number(last.endSeconds || 0))
    const shouldExtendToEnd = prevTotal > 0 && curEnd >= prevTotal - 0.2 && nextTotal > prevTotal + 1e-6
    const nextEnd = shouldExtendToEnd ? nextTotal : Math.min(curEnd, nextTotal)
    const nextStart = Math.min(curStart, nextEnd - 0.2)
    if (Math.abs(nextStart - curStart) < 0.05 && Math.abs(nextEnd - curEnd) < 0.05) return
    setTimeline((prev) => {
      const prevSegs: any[] = Array.isArray((prev as any).audioSegments) ? (prev as any).audioSegments : []
      if (!prevSegs.length) return prev
      const prevSorted = prevSegs
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const lastSeg: any = prevSorted[prevSorted.length - 1]
      if (!lastSeg) return prev
      const nextSegs = prevSegs.map((s: any) => {
        if (String(s.id) !== String(lastSeg.id)) return s
        return { ...s, startSeconds: nextStart, endSeconds: nextEnd }
      })
      return { ...(prev as any), audioSegments: nextSegs } as any
    })
  }, [audioSegments, totalSeconds])

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
    const snapshot = {
      timeline: cloneTimeline(timeline),
      selectedClipId,
      selectedGraphicId,
      selectedLogoId,
      selectedLowerThirdId,
      selectedScreenTitleId,
      selectedNarrationId,
      selectedStillId,
      selectedAudioId,
    }
    stack.push(snapshot)
    // Cap memory and keep behavior predictable.
    if (stack.length > 50) stack.splice(0, stack.length - 50)
    setUndoDepth(stack.length)
    // New edits invalidate the redo stack.
    redoStackRef.current = []
    setRedoDepth(0)
    persistHistorySoon()
  }, [
    persistHistorySoon,
    selectedAudioId,
    selectedClipId,
    selectedGraphicId,
    selectedLogoId,
    selectedLowerThirdId,
    selectedNarrationId,
    selectedScreenTitleId,
    selectedStillId,
    timeline,
  ])

  const snapshotUndoRef = useRef(snapshotUndo)
  useEffect(() => {
    snapshotUndoRef.current = snapshotUndo
  }, [snapshotUndo])

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    const snap = stack.pop()
    if (!snap) return
    setUndoDepth(stack.length)
    // Push current state to redo stack.
    const redoStack = redoStackRef.current
    redoStack.push({
      timeline: cloneTimeline(timeline),
      selectedClipId,
      selectedGraphicId,
      selectedLogoId,
      selectedLowerThirdId,
      selectedScreenTitleId,
      selectedNarrationId,
      selectedStillId,
      selectedAudioId,
    })
    if (redoStack.length > 50) redoStack.splice(0, redoStack.length - 50)
    setRedoDepth(redoStack.length)
    hydratingRef.current = true
    try {
      setTimeline(snap.timeline)
      setSelectedClipId(snap.selectedClipId)
      setSelectedGraphicId(snap.selectedGraphicId)
      setSelectedLogoId(snap.selectedLogoId)
      setSelectedLowerThirdId((snap as any).selectedLowerThirdId || null)
      setSelectedScreenTitleId((snap as any).selectedScreenTitleId || null)
      setSelectedNarrationId((snap as any).selectedNarrationId || null)
      setSelectedStillId(snap.selectedStillId)
      setSelectedAudioId((snap as any).selectedAudioId || null)
    } finally {
      hydratingRef.current = false
    }
    persistHistorySoon()
  }, [
    persistHistorySoon,
    selectedAudioId,
    selectedClipId,
    selectedGraphicId,
    selectedLogoId,
    selectedLowerThirdId,
    selectedNarrationId,
    selectedScreenTitleId,
    selectedStillId,
    timeline,
  ])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    const snap = stack.pop()
    if (!snap) return
    setRedoDepth(stack.length)
    // Push current state to undo stack.
    const undoStack = undoStackRef.current
    undoStack.push({
      timeline: cloneTimeline(timeline),
      selectedClipId,
      selectedGraphicId,
      selectedLogoId,
      selectedLowerThirdId,
      selectedScreenTitleId,
      selectedNarrationId,
      selectedStillId,
      selectedAudioId,
    })
    if (undoStack.length > 50) undoStack.splice(0, undoStack.length - 50)
    setUndoDepth(undoStack.length)
    hydratingRef.current = true
    try {
      setTimeline(snap.timeline)
      setSelectedClipId(snap.selectedClipId)
      setSelectedGraphicId(snap.selectedGraphicId)
      setSelectedLogoId(snap.selectedLogoId)
      setSelectedLowerThirdId((snap as any).selectedLowerThirdId || null)
      setSelectedScreenTitleId((snap as any).selectedScreenTitleId || null)
      setSelectedNarrationId((snap as any).selectedNarrationId || null)
      setSelectedStillId(snap.selectedStillId)
      setSelectedAudioId((snap as any).selectedAudioId || null)
    } finally {
      hydratingRef.current = false
    }
    persistHistorySoon()
  }, [
    persistHistorySoon,
    selectedAudioId,
    selectedClipId,
    selectedGraphicId,
    selectedLogoId,
    selectedLowerThirdId,
    selectedNarrationId,
    selectedScreenTitleId,
    selectedStillId,
    timeline,
  ])

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
    const laneCount = 7
    for (let i = 0; i < laneCount; i++) {
      ctx.fillRect(0, rulerH + waveformH + trackH * i, wCss, trackH)
    }

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

    // Guidelines (user markers) — full height.
    const gs: number[] = Array.isArray((timeline as any).guidelines) ? (timeline as any).guidelines : []
    if (gs.length) {
      ctx.strokeStyle = 'rgba(212,175,55,0.85)'
      ctx.lineWidth = 1
      for (const g of gs) {
        const t = roundToTenth(Number(g))
        if (!Number.isFinite(t) || t < startT - 0.5 || t > endT + 0.5) continue
        const x = padPx + t * pxPerSecond - scrollLeft
        if (x < -2 || x > wCss + 2) continue
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, hCss)
        ctx.stroke()
      }
    }

    // Waveform (selected clip or narration segment)
    const waveformTop = rulerH + 2
    const waveformBottom = rulerH + waveformH - 2
    const waveformHeight = Math.max(4, waveformBottom - waveformTop)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, waveformBottom + 0.5)
    ctx.lineTo(wCss, waveformBottom + 0.5)
    ctx.stroke()

    const selectedNarration: any =
      selectedNarrationId != null ? narration.find((n: any) => String(n?.id) === String(selectedNarrationId)) : null
    const clipIdx = selectedClipIndex
    const clip = clipIdx >= 0 ? timeline.clips[clipIdx] : null
    const hasAnyTarget = Boolean(selectedNarration) || Boolean(clip)
    if (!hasAnyTarget) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = '700 12px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText('Select a clip or narration segment to see waveform', 10, rulerH + waveformH / 2)
    } else {
      const kind: 'narration' | 'clip' = selectedNarration ? 'narration' : 'clip'
      const uploadId = kind === 'narration' ? Number(selectedNarration.uploadId) : Number((clip as any).uploadId)
      const env = uploadId > 0 ? audioEnvelopeByUploadId[uploadId] : null
      const envStatus = uploadId > 0 ? (audioEnvelopeStatusByUploadId[uploadId] || 'idle') : 'idle'
      const hasAudio = env && typeof env === 'object' ? Boolean((env as any).hasAudio) : false
      const points = env && typeof env === 'object' && Array.isArray((env as any).points) ? ((env as any).points as any[]) : []

      let segStartT = 0
      let segEndT = 0
      let sourceStart = 0
      let sourceEnd = 0
      if (kind === 'narration') {
        segStartT = roundToTenth(Number(selectedNarration.startSeconds || 0))
        segEndT = roundToTenth(Number(selectedNarration.endSeconds || 0))
        sourceStart =
          selectedNarration.sourceStartSeconds != null && Number.isFinite(Number(selectedNarration.sourceStartSeconds))
            ? Math.max(0, roundToTenth(Number(selectedNarration.sourceStartSeconds)))
            : 0
        sourceEnd = Math.max(0, roundToTenth(sourceStart + Math.max(0, segEndT - segStartT)))
      } else {
        segStartT = roundToTenth(clipStarts[clipIdx] || 0)
        segEndT = roundToTenth(segStartT + clipDurationSeconds(clip as any))
        sourceStart = Number((clip as any).sourceStartSeconds || 0)
        sourceEnd = Number((clip as any).sourceEndSeconds || 0)
      }

      // Highlight active window.
      const hx1 = padPx + segStartT * pxPerSecond - scrollLeft
      const hx2 = padPx + segEndT * pxPerSecond - scrollLeft
      if (hx2 > hx1 + 1) {
        ctx.fillStyle = 'rgba(10,132,255,0.08)'
        ctx.fillRect(Math.max(0, hx1), waveformTop, Math.min(wCss, hx2) - Math.max(0, hx1), waveformHeight)
      }

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
          const tComp = segStartT + rel
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
    const screenTitleY = SCREEN_TITLE_Y
    const graphicsY = GRAPHICS_Y
    const videoY = VIDEO_Y
    const narrationY = NARRATION_Y
	    const audioY = AUDIO_Y
	    const pillH = PILL_H
	    const HANDLE_GOLD = 'rgba(212,175,55,0.95)'
	    const HANDLE_GREEN = 'rgba(48,209,88,0.95)'
    const hasNoOffset = (value: unknown, eps = 0.05) => {
      const n = Number(value)
      return Number.isFinite(n) && Math.abs(n) <= eps
    }
    const nearEqual = (a: unknown, b: unknown, eps = 0.05) => {
      const x = Number(a)
      const y = Number(b)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false
      return Math.abs(x - y) <= eps
    }
    ctx.font = '900 12px system-ui, -apple-system, Segoe UI, sans-serif'
	    ctx.textBaseline = 'middle'
	    const activeDrag = trimDragging ? trimDragRef.current : null

	    // Lane labels in the left gutter (only when time=0 is visible, i.e. there is blank space to the left of the 0.0s tick).
	    {
	      const xZero = padPx - scrollLeft
	      const gutterRight = Math.floor(xZero - 10)
	      if (Number.isFinite(gutterRight) && gutterRight > 80) {
	        const swatchW = 8
	        const swatchH = Math.min(16, Math.max(10, Math.floor(pillH * 0.45)))
	        const labels: Array<{ y: number; label: string; swatch: string }> = [
	          { y: logoY + pillH / 2, label: 'LOGO', swatch: 'rgba(212,175,55,0.95)' },
	          { y: lowerThirdY + pillH / 2, label: 'LOWER THIRD', swatch: 'rgba(94,92,230,0.90)' },
	          { y: graphicsY + pillH / 2, label: 'GRAPHICS', swatch: 'rgba(10,132,255,0.90)' },
	          { y: screenTitleY + pillH / 2, label: 'SCREEN TITLES', swatch: 'rgba(255,214,10,0.90)' },
	          { y: videoY + pillH / 2, label: 'VIDEOS', swatch: 'rgba(212,175,55,0.75)' },
	          { y: narrationY + pillH / 2, label: 'NARRATION', swatch: 'rgba(175,82,222,0.90)' },
	          { y: audioY + pillH / 2, label: 'AUDIO/MUSIC', swatch: 'rgba(48,209,88,0.90)' },
	        ]

	        ctx.save()
	        ctx.globalAlpha = 0.92
	        ctx.textAlign = 'right'
	        ctx.textBaseline = 'middle'
	        ctx.font = '900 11px system-ui, -apple-system, Segoe UI, sans-serif'
	        for (const row of labels) {
	          const y = Math.round(row.y)
	          const swatchX = gutterRight - swatchW
	          const swatchY = Math.round(y - swatchH / 2)
	          ctx.fillStyle = row.swatch
	          ctx.fillRect(swatchX, swatchY, swatchW, swatchH)

	          const textX = swatchX - 8
	          const maxW = Math.max(0, textX - 8)
	          if (maxW < 20) continue
	          ctx.fillStyle = 'rgba(187,187,187,0.95)'
	          const clipped = ellipsizeText(ctx, row.label, maxW)
	          ctx.fillText(clipped, textX, y)
	        }
	        ctx.restore()
	      }
	    }

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
        ctx.fillStyle = HANDLE_GREEN
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
        ctx.fillStyle = HANDLE_GREEN
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

    // Screen-title segments (below lower thirds; no overlaps)
    for (let i = 0; i < screenTitles.length; i++) {
      const st: any = screenTitles[i]
      const start = Math.max(0, Number(st?.startSeconds || 0))
      const end = Math.max(0, Number(st?.endSeconds || 0))
      const len = Math.max(0, end - start)
      if (len <= 0) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = String(st?.id) === String(selectedScreenTitleId || '')
      const isDragging =
        Boolean(activeDrag) && (activeDrag as any).kind === 'screenTitle' && String((activeDrag as any).screenTitleId) === String(st?.id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      ctx.fillStyle = 'rgba(255,214,10,0.16)'
      roundRect(ctx, x, screenTitleY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(255,214,10,0.55)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, screenTitleY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, screenTitleY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()
        ctx.restore()
      }

      const presetName = String(st?.presetSnapshot?.name || '').trim()
      const snippetRaw = String(st?.text || '').replace(/\s+/g, ' ').trim()
      const snippet = snippetRaw ? snippetRaw : 'Unconfigured'
      const label = presetName ? `${presetName} • ${snippet}` : snippet
      ctx.fillStyle = '#fff'
      const padLeft = showHandles ? 6 + handleSize + 10 : 12
      const padRight = showHandles ? 6 + handleSize + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, label, maxTextW)
        ctx.fillText(clipped, x + padLeft, screenTitleY + pillH / 2)
      }

      if (showHandles) {
        ctx.fillStyle = HANDLE_GREEN
        const hs = handleSize
        const hy = screenTitleY + Math.floor((pillH - handleSize) / 2)
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
        const by = screenTitleY + 3
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
        ctx.fillStyle = HANDLE_GREEN
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
        ctx.fillStyle = HANDLE_GREEN
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
        const uploadId = Number(clip.uploadId)
        const fullDurRaw = durationsByUploadId[uploadId]
        const fullDur =
          fullDurRaw != null && Number.isFinite(Number(fullDurRaw)) && Number(fullDurRaw) > 0 ? Number(fullDurRaw) : null
        const leftIsGreen = hasNoOffset(clip.sourceStartSeconds)
        const rightIsGreen = fullDur != null && nearEqual(clip.sourceEndSeconds, fullDur)
        const hs = handleSize
        const hy = videoY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        ctx.fillStyle = leftIsGreen ? HANDLE_GREEN : HANDLE_GOLD
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        ctx.fillStyle = rightIsGreen ? HANDLE_GREEN : HANDLE_GOLD
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

    // Narration segments (above music; no overlaps)
    for (let i = 0; i < narration.length; i++) {
      const n: any = narration[i]
      const start = clamp(Number((n as any).startSeconds || 0), 0, Math.max(0, totalSeconds))
      const end = clamp(Number((n as any).endSeconds || 0), 0, Math.max(0, totalSeconds))
      const len = Math.max(0, end - start)
      if (len <= 0.01) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue

      const isSelected = String((n as any).id) === String(selectedNarrationId || '')
      const isDragging = Boolean(activeDrag) && (activeDrag as any).kind === 'narration' && String((activeDrag as any).narrationId) === String((n as any).id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      ctx.fillStyle = 'rgba(175,82,222,0.16)'
      roundRect(ctx, x, narrationY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(175,82,222,0.55)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, narrationY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, narrationY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()
        ctx.restore()
      }

      const uploadId = Number((n as any).uploadId)
      const baseName = namesByUploadId[uploadId] || `Narration ${uploadId}`
      const gainDb = (n as any).gainDb == null ? 0 : Number((n as any).gainDb)
      const gainLabel = Number.isFinite(gainDb) && Math.abs(gainDb) > 0.05 ? `${gainDb > 0 ? '+' : ''}${gainDb.toFixed(0)}dB` : '0dB'
      const label = `${baseName} • ${gainLabel}`
      ctx.fillStyle = '#fff'
      const padLeft = showHandles ? 6 + handleSize + 10 : 12
      const padRight = showHandles ? 6 + handleSize + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, label, maxTextW)
        ctx.fillText(clipped, x + padLeft, narrationY + pillH / 2)
      }

      if (showHandles) {
        const uploadId = Number((n as any).uploadId)
        const fullDurRaw = durationsByUploadId[uploadId]
        const fullDur =
          fullDurRaw != null && Number.isFinite(Number(fullDurRaw)) && Number(fullDurRaw) > 0 ? Number(fullDurRaw) : null
        const srcStart =
          (n as any).sourceStartSeconds != null && Number.isFinite(Number((n as any).sourceStartSeconds))
            ? Number((n as any).sourceStartSeconds)
            : 0
        const srcEnd = roundToTenth(Math.max(0, srcStart + (end - start)))
        const leftIsGreen = hasNoOffset(srcStart)
        const rightIsGreen = fullDur != null && (srcEnd >= fullDur - 0.05)
        const hs = handleSize
        const hy = narrationY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        ctx.fillStyle = leftIsGreen ? HANDLE_GREEN : HANDLE_GOLD
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        ctx.fillStyle = rightIsGreen ? HANDLE_GREEN : HANDLE_GOLD
        roundRect(ctx, hxR, hy, hs, hs, 4)
        ctx.fill()
      }

      if (isResizing) {
        ctx.fillStyle = 'rgba(212,175,55,0.95)'
        const barW = 5
        const by = narrationY + 3
        const bh = pillH - 6
        if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
        if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
      }
    }

    for (let i = 0; i < audioSegments.length; i++) {
      const seg: any = audioSegments[i]
      const start = clamp(Number(seg.startSeconds || 0), 0, Math.max(0, totalSeconds))
      const end = clamp(Number(seg.endSeconds || 0), 0, Math.max(0, totalSeconds))
      const len = Math.max(0, end - start)
      if (len <= 0.01) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue

      const isSelected = String(seg.id) === String(selectedAudioId || '')
      const isDragging =
        Boolean(activeDrag) && (activeDrag as any).kind === 'audioSegment' && String((activeDrag as any).audioSegmentId) === String(seg.id)
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

      const audioName = namesByUploadId[Number(seg.uploadId)] || `Audio ${seg.uploadId}`
      const cfgName = audioConfigNameById[Number(seg.audioConfigId)] || `Config ${seg.audioConfigId}`
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
        const uploadId = Number(seg.uploadId)
        const srcStart =
          seg.sourceStartSeconds != null && Number.isFinite(Number(seg.sourceStartSeconds)) ? Number(seg.sourceStartSeconds) : 0
        const leftIsGreen = hasNoOffset(srcStart)
        const fullDurRaw = durationsByUploadId[uploadId]
        const fullDur =
          fullDurRaw != null && Number.isFinite(Number(fullDurRaw)) && Number(fullDurRaw) > 0 ? roundToTenth(Number(fullDurRaw)) : null
        const srcEnd = roundToTenth(Math.max(0, srcStart + (end - start)))
        const rightIsGreen = fullDur != null ? (srcEnd >= fullDur - 0.05) : true
        const hs = handleSize
        const hy = audioY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - hs
        ctx.fillStyle = leftIsGreen ? HANDLE_GREEN : HANDLE_GOLD
        roundRect(ctx, hxL, hy, hs, hs, 4)
        ctx.fill()
        ctx.fillStyle = rightIsGreen ? HANDLE_GREEN : HANDLE_GOLD
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
  }, [
    audioEnvelopeByUploadId,
    audioEnvelopeStatusByUploadId,
    audioConfigNameById,
    audioSegments,
    clipStarts,
    graphics,
    logos,
    lowerThirds,
    screenTitles,
    narration,
    stills,
    namesByUploadId,
    durationsByUploadId,
    pxPerSecond,
    selectedAudioId,
    selectedClipId,
    selectedClipIndex,
    selectedGraphicId,
    selectedLogoId,
    selectedLowerThirdId,
    selectedScreenTitleId,
    selectedNarrationId,
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
	        const rawGuidelines: any[] = Array.isArray((tlRaw as any)?.guidelines) ? ((tlRaw as any).guidelines as any[]) : []
	        const guidelinesMap = new Map<string, number>()
	        for (const g of rawGuidelines) {
	          const t = roundToTenth(Number(g || 0))
	          if (!Number.isFinite(t) || t < 0) continue
	          guidelinesMap.set(t.toFixed(1), t)
	        }
	        const guidelines = Array.from(guidelinesMap.values()).sort((a, b) => a - b)
		        const tl: Timeline = {
		          version: 'create_video_v1',
		          playheadSeconds: roundToTenth(Number(tlRaw?.playheadSeconds || 0)),
		          clips: Array.isArray(tlRaw?.clips) ? (tlRaw.clips as any) : [],
		          stills: Array.isArray(tlRaw?.stills) ? (tlRaw.stills as any) : [],
		          graphics: Array.isArray(tlRaw?.graphics) ? (tlRaw.graphics as any) : [],
		          guidelines,
		          logos: Array.isArray(tlRaw?.logos) ? (tlRaw.logos as any) : [],
		          lowerThirds: Array.isArray(tlRaw?.lowerThirds) ? (tlRaw.lowerThirds as any) : [],
		          screenTitles: Array.isArray(tlRaw?.screenTitles) ? (tlRaw.screenTitles as any) : [],
		          narration: Array.isArray(tlRaw?.narration)
		            ? (tlRaw.narration as any[]).map((n: any) => ({
	                ...n,
	                id: String(n?.id || ''),
	                uploadId: Number(n?.uploadId),
	                startSeconds: roundToTenth(Number(n?.startSeconds || 0)),
	                endSeconds: roundToTenth(Number(n?.endSeconds || 0)),
	                sourceStartSeconds: n?.sourceStartSeconds == null ? 0 : roundToTenth(Number(n?.sourceStartSeconds || 0)),
	                gainDb: n?.gainDb == null ? 0 : Number(n?.gainDb),
	              }))
	            : [],
	          audioSegments: Array.isArray((tlRaw as any)?.audioSegments)
	            ? ((tlRaw as any).audioSegments as any[]).map((s: any, i: number) => ({
	                ...s,
	                id: String(s?.id || '') || `aud_legacy_${i + 1}`,
	                uploadId: Number(s?.uploadId),
	                audioConfigId: Number(s?.audioConfigId),
	                startSeconds: roundToTenth(Number(s?.startSeconds || 0)),
	                endSeconds: roundToTenth(Number(s?.endSeconds || 0)),
	                sourceStartSeconds: s?.sourceStartSeconds == null ? 0 : roundToTenth(Number(s?.sourceStartSeconds || 0)),
	              }))
	            : [],
	          audioTrack: tlRaw?.audioTrack && typeof tlRaw.audioTrack === 'object' ? (tlRaw.audioTrack as any) : null,
	        }
        const migratedFreeze = migrateLegacyClipFreezeTimeline(tl)
        const migratedAudio = migrateLegacyAudioTrackToSegments(migratedFreeze.timeline)
        const tlFinal = migratedAudio.timeline
        hydratingRef.current = true
        try {
          setProject(pj)
          setTimeline(tlFinal)
          // If we migrated a legacy timeline, leave lastSavedRef pointing at the pre-migration JSON so
          // the debounced autosave will persist the normalized form.
          lastSavedRef.current = JSON.stringify(migratedFreeze.changed || migratedAudio.changed ? tl : tlFinal)
          // Restore undo/redo history if it matches the current timeline (ignoring playhead).
          try {
            const histKey = `createVideoHistory:v1:${id}`
            const raw = localStorage.getItem(histKey)
            const parsed: any = raw ? JSON.parse(raw) : null
            const expectedHash = computeTimelineHash(tlFinal)
            const ok = parsed && typeof parsed === 'object' && Number(parsed.v) === 1 && String(parsed.timelineHash || '') === String(expectedHash || '')
            if (ok) {
              const u = Array.isArray(parsed.undo) ? parsed.undo : []
              const r = Array.isArray(parsed.redo) ? parsed.redo : []
              undoStackRef.current = u
              redoStackRef.current = r
              setUndoDepth(u.length)
              setRedoDepth(r.length)
            } else {
              undoStackRef.current = []
              redoStackRef.current = []
              setUndoDepth(0)
              setRedoDepth(0)
            }
          } catch {
            undoStackRef.current = []
            redoStackRef.current = []
            setUndoDepth(0)
            setRedoDepth(0)
          }
          setSelectedAudioId(null)
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
  }, [computeTimelineHash])

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
        // Keep local undo/redo persistence aligned to the latest saved timeline.
        persistHistoryNow({ timelineOverride: next as any })
      } catch {
        // ignore; user can still export later
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [persistHistoryNow, playhead, project?.id, timeline])

  const saveTimelineNow = useCallback(
    async (nextTimeline: Timeline) => {
      if (!project?.id) return
      if (hydratingRef.current) return
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch('/api/create-video/project', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ timeline: nextTimeline }),
        })
        const data: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(data?.error || 'save_failed'))
        lastSavedRef.current = JSON.stringify(nextTimeline)
        // Keep local undo/redo persistence aligned to the latest saved timeline.
        persistHistoryNow({ timelineOverride: nextTimeline })
      } catch {
        // ignore; user can still export later
      }
    },
    [persistHistoryNow, project?.id]
  )

  const addGuidelineAtPlayhead = useCallback(() => {
    const t = roundToTenth(playhead)
    const prevGs: number[] = Array.isArray((timeline as any).guidelines) ? (timeline as any).guidelines : []
    const map = new Map<string, number>()
    for (const g of prevGs) {
      const gg = roundToTenth(Number(g))
      if (Number.isFinite(gg) && gg >= 0) map.set(gg.toFixed(1), gg)
    }
    map.set(t.toFixed(1), t)
    const nextGs = Array.from(map.values()).sort((a, b) => a - b)
    const nextTimeline: any = { ...(timeline as any), guidelines: nextGs, playheadSeconds: playhead }
    snapshotUndo()
    setTimeline(nextTimeline)
    void saveTimelineNow(nextTimeline)
    setTimelineMessage(`Guideline added at ${t.toFixed(1)}s`)
  }, [playhead, saveTimelineNow, snapshotUndo, timeline])

  const removeNearestGuideline = useCallback(() => {
    const gs: number[] = Array.isArray((timeline as any).guidelines) ? (timeline as any).guidelines : []
    if (!gs.length) return
    const t = roundToTenth(playhead)
    let bestIdx = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < gs.length; i++) {
      const v = roundToTenth(Number(gs[i]))
      const d = Math.abs(v - t)
      if (d < bestDist - 1e-6 || (Math.abs(d - bestDist) < 1e-6 && v > roundToTenth(Number(gs[bestIdx])))) {
        bestDist = d
        bestIdx = i
      }
    }
    const next = gs
      .map((x) => roundToTenth(Number(x)))
      .filter((x) => Number.isFinite(x))
      .filter((_, i) => i !== bestIdx)
      .sort((a, b) => a - b)
    const nextTimeline: any = { ...(timeline as any), guidelines: next, playheadSeconds: playhead }
    snapshotUndo()
    setTimeline(nextTimeline)
    void saveTimelineNow(nextTimeline)
    setTimelineMessage('Guideline removed')
  }, [playhead, saveTimelineNow, snapshotUndo, timeline])

  const removeAllGuidelines = useCallback(() => {
    const gs: number[] = Array.isArray((timeline as any).guidelines) ? (timeline as any).guidelines : []
    if (!gs.length) return
    const nextTimeline: any = { ...(timeline as any), guidelines: [], playheadSeconds: playhead }
    snapshotUndo()
    setTimeline(nextTimeline)
    void saveTimelineNow(nextTimeline)
    setTimelineMessage('All guidelines removed')
  }, [playhead, saveTimelineNow, snapshotUndo, timeline])

  const openGuidelineMenu = useCallback(() => {
    setGuidelineMenuOpen(true)
  }, [])

  const closeGuidelineMenu = useCallback(() => {
    setGuidelineMenuOpen(false)
  }, [])

  const startGuidelinePress = useCallback(() => {
    const cur = guidelinePressRef.current
    if (cur?.timer != null) {
      try { window.clearTimeout(cur.timer) } catch {}
    }
    const ref = { timer: null as any, fired: false }
    ref.timer = window.setTimeout(() => {
      ref.fired = true
      openGuidelineMenu()
    }, 650)
    guidelinePressRef.current = ref
  }, [openGuidelineMenu])

  const finishGuidelinePress = useCallback(() => {
    const cur = guidelinePressRef.current
    guidelinePressRef.current = null
    if (!cur) return
    if (cur.timer != null) {
      try { window.clearTimeout(cur.timer) } catch {}
    }
    if (!cur.fired) addGuidelineAtPlayhead()
  }, [addGuidelineAtPlayhead])

  const cancelGuidelinePress = useCallback(() => {
    const cur = guidelinePressRef.current
    guidelinePressRef.current = null
    if (!cur) return
    if (cur.timer != null) {
      try { window.clearTimeout(cur.timer) } catch {}
    }
  }, [])

  useEffect(() => {
    return () => {
      const cur = guidelinePressRef.current
      if (cur?.timer != null) {
        try { window.clearTimeout(cur.timer) } catch {}
      }
      guidelinePressRef.current = null
    }
  }, [])

  // Fetch upload names for clip pills
		  useEffect(() => {
		    const clipIds = timeline.clips.map((c) => Number(c.uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const graphicIds = graphics.map((g) => Number((g as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const logoIds = logos.map((l) => Number((l as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const lowerThirdIds = lowerThirds.map((lt) => Number((lt as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const narrationIds = narration.map((n: any) => Number((n as any).uploadId)).filter((x) => Number.isFinite(x) && x > 0)
		    const stillIds = (Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : [])
		      .map((s) => Number(s?.uploadId))
		      .filter((n) => Number.isFinite(n) && n > 0)
		    const audioIds = audioSegments.map((a: any) => Number((a as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const ids = Array.from(new Set([...clipIds, ...graphicIds, ...logoIds, ...lowerThirdIds, ...narrationIds, ...stillIds, ...audioIds]))
		    if (!ids.length) return
		    const durationNeeded = new Set<number>([...clipIds, ...narrationIds, ...audioIds])
		    const missing = ids.filter((id) => !namesByUploadId[id] || (durationNeeded.has(id) && !durationsByUploadId[id]))
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
	  }, [audioSegments, durationsByUploadId, graphics, logos, lowerThirds, namesByUploadId, narration, timeline.clips, timeline.stills])

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
          ...lowerThirds.map((lt) => Number((lt as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0),
          ...screenTitles.map((st: any) => Number((st as any).renderUploadId)).filter((n) => Number.isFinite(n) && n > 0),
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
  }, [graphicFileUrlByUploadId, graphics, logos, lowerThirds, screenTitles, stills])

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
    setSelectedLogoId(null)
    setSelectedLowerThirdId(null)
    setSelectedScreenTitleId(null)
    setSelectedAudioId(null)
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
    if (narrationPreviewPlaying) stopNarrationPreview()
    if (musicPreviewPlaying) stopMusicPreview()

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
  }, [
    clipStarts,
    musicPreviewPlaying,
    narrationPreviewPlaying,
    playhead,
    playing,
    primeAutoplayUnlock,
    seek,
    stopMusicPreview,
    stopNarrationPreview,
    timeline.clips,
    totalSeconds,
  ])

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

	    // If we're inside a freeze-frame still segment, playhead should advance to the end of the still
	    // and then stop (user can hit Play again to continue). This also avoids iOS "non-gesture play"
	    // issues since the next video `play()` call will be initiated by the next user tap.
	    const curStill = findStillAtTime(playhead)
	    if (curStill) {
	      const target = roundToTenth(Number((curStill as any).endSeconds || 0))
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
	          setPlaying(false)
	          return
	        }
	        const raf = window.requestAnimationFrame(tick)
	        gapPlaybackRef.current = { raf, target, nextClipIndex: null }
	      }
	      const raf = window.requestAnimationFrame(tick)
	      gapPlaybackRef.current = { raf, target, nextClipIndex: null }
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

  const ensureScreenTitlePresets = useCallback(async (): Promise<ScreenTitlePresetItem[]> => {
    if (screenTitlePresetsLoaded) return screenTitlePresets
    setScreenTitlePresetsError(null)
    try {
      const res = await fetch(`/api/screen-title-presets?limit=200`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const items: ScreenTitlePresetItem[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : []
      setScreenTitlePresets(items)
      setScreenTitlePresetsLoaded(true)
      return items
    } catch (e: any) {
      setScreenTitlePresetsError(e?.message || 'Failed to load screen title presets')
      setScreenTitlePresetsLoaded(true)
      return []
    }
  }, [screenTitlePresets, screenTitlePresetsLoaded])

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
    if (!audioSegments.length) return
    if (audioConfigsLoaded) return
    void ensureAudioConfigs()
  }, [audioConfigsLoaded, audioSegments.length, ensureAudioConfigs])

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

  // If a timeline already has screen-title segments (hydrated from a saved draft), prefetch presets so
  // labels and editors can show presets immediately.
  useEffect(() => {
    if (!screenTitles.length) return
    if (screenTitlePresetsLoaded) return
    void ensureScreenTitlePresets()
  }, [ensureScreenTitlePresets, screenTitlePresetsLoaded, screenTitles.length])

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
      try {
        const w = upload.width != null ? Number(upload.width) : null
        const h = upload.height != null ? Number(upload.height) : null
        if (w != null && h != null && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          const id = Number(upload.id)
          setDimsByUploadId((prev) => (prev[id] ? prev : { ...prev, [id]: { width: Math.round(w), height: Math.round(h) } }))
        }
      } catch {}
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
      setSelectedAudioId(null)
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
      setSelectedAudioId(null)
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
      setSelectedAudioId(null)
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
      setSelectedAudioId(null)
      setSelectedLowerThirdId(id)
      setPickOpen(false)
      setAddStep('type')
      setPendingLowerThirdUploadId(null)
    },
    [lowerThirdConfigs, lowerThirds, pendingLowerThirdUploadId, playhead, snapshotUndo, totalSeconds]
  )

  const addScreenTitleFromPreset = useCallback(
    (preset: ScreenTitlePresetItem) => {
      const presetId = Number((preset as any).id)
      if (!Number.isFinite(presetId) || presetId <= 0) return
      if (!(totalSeconds > 0)) {
        setPickerError('Add a video or graphic first.')
        return
      }

      const dur = 5.0
      const id = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const start0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
      let start = start0
      let end = roundToTenth(start + dur)
      if (end > totalSeconds + 1e-6) {
        setPickerError('Not enough room to add a 5s screen title segment within the timeline.')
        return
      }

      const existing = screenTitles.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
      for (let i = 0; i < existing.length; i++) {
        const st: any = existing[i]
        const ss = Number(st.startSeconds)
        const se = Number(st.endSeconds)
        if (!(Number.isFinite(ss) && Number.isFinite(se))) continue
        const overlaps = start < se - 1e-6 && end > ss + 1e-6
        if (overlaps) {
          start = roundToTenth(se)
          end = roundToTenth(start + dur)
          i = -1
          if (end > totalSeconds + 1e-6) {
            setPickerError('No available slot for a 5s screen title segment without overlapping.')
            return
          }
        }
      }

      const snapshot: any = {
        id: presetId,
        name: String((preset as any).name || ''),
        style: (String((preset as any).style || 'none').toLowerCase() === 'pill'
          ? 'pill'
          : String((preset as any).style || 'none').toLowerCase() === 'strip'
            ? 'strip'
            : 'none') as any,
        fontKey: String((preset as any).fontKey || 'dejavu_sans_bold'),
        fontSizePct: Number((preset as any).fontSizePct),
        trackingPct: Number((preset as any).trackingPct),
        fontColor: String((preset as any).fontColor || '#ffffff'),
        fontGradientKey: (preset as any).fontGradientKey == null ? null : String((preset as any).fontGradientKey),
        outlineWidthPct: (preset as any).outlineWidthPct == null ? null : Number((preset as any).outlineWidthPct),
        outlineOpacityPct: (preset as any).outlineOpacityPct == null ? null : Number((preset as any).outlineOpacityPct),
        outlineColor: (preset as any).outlineColor == null ? null : String((preset as any).outlineColor),
        pillBgColor: String((preset as any).pillBgColor || '#000000'),
        pillBgOpacityPct: Number((preset as any).pillBgOpacityPct),
        alignment: (String((preset as any).alignment || 'center').toLowerCase() === 'left'
          ? 'left'
          : String((preset as any).alignment || 'center').toLowerCase() === 'right'
            ? 'right'
            : 'center') as any,
        position: (String((preset as any).position || 'top').toLowerCase() === 'bottom'
          ? 'bottom'
          : String((preset as any).position || 'top').toLowerCase() === 'middle'
            ? 'middle'
            : 'top') as any,
        maxWidthPct: Number((preset as any).maxWidthPct),
        insetXPreset: (preset as any).insetXPreset == null ? null : String((preset as any).insetXPreset),
        insetYPreset: (preset as any).insetYPreset == null ? null : String((preset as any).insetYPreset),
        fade: (String((preset as any).fade || 'none').toLowerCase() === 'in_out'
          ? 'in_out'
          : String((preset as any).fade || 'none').toLowerCase() === 'in'
            ? 'in'
            : String((preset as any).fade || 'none').toLowerCase() === 'out'
              ? 'out'
              : 'none') as any,
      }

      const seg: ScreenTitle = {
        id,
        startSeconds: start,
        endSeconds: end,
        presetId,
        presetSnapshot: snapshot,
        text: '',
        renderUploadId: null,
      }

      snapshotUndo()
      setTimeline((prev) => {
        const prevSts: ScreenTitle[] = Array.isArray((prev as any).screenTitles) ? ((prev as any).screenTitles as any) : []
        const next = [...prevSts, seg].sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
        return { ...prev, screenTitles: next }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(id)
      setScreenTitleEditor({ id, start, end, presetId, text: '' })
      setScreenTitleEditorError(null)
      setPickOpen(false)
      setAddStep('type')
    },
    [playhead, screenTitles, snapshotUndo, totalSeconds]
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
      const dur = upload.duration_seconds != null ? Number(upload.duration_seconds) : null
      if (dur != null && Number.isFinite(dur) && dur > 0) {
        setDurationsByUploadId((prev) => ({ ...prev, [id]: dur }))
      }

      const cfgs = Array.isArray(audioConfigs) ? audioConfigs : []
      const pickDefault = (): number | null => {
        const existing = audioSegments.length ? Number((audioSegments[0] as any).audioConfigId) : null
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

      const end = roundToTenth(
        Math.max(0, dur != null && Number.isFinite(dur) && dur > 0 ? Math.min(totalSeconds, dur) : Math.max(0, totalSeconds))
      )
      snapshotUndo()
      const segId = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      setTimeline((prev) => ({
        ...(prev as any),
        audioTrack: null,
        audioSegments: [
          {
            id: segId,
            uploadId: id,
            audioConfigId,
            startSeconds: 0,
            endSeconds: end,
            sourceStartSeconds: 0,
          },
        ],
      }))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
      setSelectedAudioId(segId)
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
    [audioConfigs, audioSegments, snapshotUndo, totalSeconds]
  )

  const addNarrationFromFile = useCallback(
    async (file: File) => {
      if (narrationUploadBusy) return
      setNarrationAddError(null)
      setNarrationUploadBusy(true)
      try {
        const maxSeconds = 20 * 60
        const start0 = clamp(roundToTenth(playhead), 0, maxSeconds)
        const { uploadId, durationSeconds } = await uploadNarrationFile(file)
        const baseName = String(file.name || '').trim() || `Narration ${uploadId}`
        setNamesByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: baseName }))
        if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
          setDurationsByUploadId((prev) => ({ ...prev, [uploadId]: durationSeconds }))
        }

        const segDur = roundToTenth(Math.max(0.2, durationSeconds != null && Number.isFinite(durationSeconds) ? durationSeconds : 5.0))
        const start = start0
        const end = clamp(roundToTenth(start + segDur), 0, maxSeconds)
        if (!(end > start + 0.05)) {
          throw new Error('narration_too_short')
        }

        // Disallow overlaps in narration lane.
        const existing = narration.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
        for (const n of existing as any[]) {
          const ns = Number(n.startSeconds || 0)
          const ne = Number(n.endSeconds || 0)
          if (!(Number.isFinite(ns) && Number.isFinite(ne) && ne > ns)) continue
          const overlaps = start < ne - 1e-6 && end > ns + 1e-6
          if (overlaps) {
            throw new Error('narration_overlap')
          }
        }

        const id = `nar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
        const seg: Narration = { id, uploadId, startSeconds: start, endSeconds: end, sourceStartSeconds: 0, gainDb: 0 }
        snapshotUndo()
        setTimeline((prev) => {
          const prevNs: Narration[] = Array.isArray((prev as any).narration) ? ((prev as any).narration as any) : []
          const next = [...prevNs, seg].sort(
            (a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id))
          )
          const nextTimeline: any = { ...(prev as any), narration: next }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
          return { ...(nextTimeline as any), playheadSeconds: nextPlayhead }
        })
        setSelectedNarrationId(id)
        setSelectedClipId(null)
        setSelectedGraphicId(null)
        setSelectedLogoId(null)
        setSelectedLowerThirdId(null)
        setSelectedScreenTitleId(null)
        setSelectedStillId(null)
        setSelectedAudioId(null)

        setPickOpen(false)
        setAddStep('type')
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (msg === 'narration_overlap') setNarrationAddError('Narration overlaps an existing narration segment. Move the playhead or trim/delete the existing narration first.')
        else if (msg === 'narration_too_short') setNarrationAddError('Narration clip is too short.')
        else setNarrationAddError('Failed to add narration.')
      } finally {
        setNarrationUploadBusy(false)
      }
    },
    [computeTotalSecondsForTimeline, narration, narrationUploadBusy, playhead, snapshotUndo, uploadNarrationFile]
  )

  const openAudioEditor = useCallback(async () => {
    if (!selectedAudioSegment) return
    setAudioEditorError(null)
    try {
      await ensureAudioConfigs()
    } catch {}
    setAudioEditor({
      id: String(selectedAudioSegment.id),
      start: Number(selectedAudioSegment.startSeconds),
      end: Number(selectedAudioSegment.endSeconds),
      audioConfigId: Number(selectedAudioSegment.audioConfigId),
    })
  }, [ensureAudioConfigs, selectedAudioSegment])

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
    for (const other of audioSegments) {
      if (String((other as any).id) === String(audioEditor.id)) continue
      const os = roundToTenth(Number((other as any).startSeconds || 0))
      const oe = roundToTenth(Number((other as any).endSeconds || 0))
      if (start < oe - 1e-6 && end > os + 1e-6) {
        setAudioEditorError('Audio cannot overlap in time.')
        return
      }
    }
    snapshotUndo()
    setTimeline((prev) => {
      const prevSegs: any[] = Array.isArray((prev as any).audioSegments) ? (prev as any).audioSegments : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === String(audioEditor.id))
      if (idx < 0) return prev
      const safeStart = clamp(start, 0, Math.max(0, end - 0.2))
      const safeEnd = clamp(end, safeStart + 0.2, Math.max(safeStart + 0.2, totalSeconds))
      const nextSegs = prevSegs.slice()
      nextSegs[idx] = { ...(prevSegs[idx] as any), startSeconds: safeStart, endSeconds: safeEnd, audioConfigId }
      nextSegs.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
      return { ...(prev as any), audioSegments: nextSegs, audioTrack: null } as any
    })
    setAudioEditor(null)
    setAudioEditorError(null)
  }, [audioEditor, audioSegments, snapshotUndo, totalSeconds])

	  const saveNarrationEditor = useCallback(() => {
	    if (!narrationEditor) return
	    const start = roundToTenth(Number(narrationEditor.start))
	    const end = roundToTenth(Number(narrationEditor.end))
	    const gainDb = Number(narrationEditor.gainDb)
	    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
	      setNarrationEditorError('End must be after start.')
	      return
	    }
    if (!Number.isFinite(gainDb) || gainDb < -12 || gainDb > 12) {
      setNarrationEditorError('Gain must be between -12 and +12 dB.')
      return
    }
    const cap = 20 * 60
	    if (end > cap + 1e-6) {
	      setNarrationEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
	      return
	    }

	    const seg = narration.find((n: any) => String((n as any).id) === String(narrationEditor.id)) as any
	    if (seg) {
	      const totalNoOffsetSecondsRaw = durationsByUploadId[Number(seg.uploadId)] ?? 0
	      const totalNoOffsetSeconds = roundToTenth(Math.max(0, Number(totalNoOffsetSecondsRaw) || 0))
	      const sourceStartSeconds =
	        seg.sourceStartSeconds != null && Number.isFinite(Number(seg.sourceStartSeconds)) ? Number(seg.sourceStartSeconds) : 0
	      if (totalNoOffsetSeconds > 0) {
	        const maxLen = roundToTenth(Math.max(0, totalNoOffsetSeconds - sourceStartSeconds))
	        const requestedLen = roundToTenth(Math.max(0, end - start))
	        if (requestedLen > maxLen + 1e-6) {
	          setNarrationEditorError(`Duration exceeds source audio (${maxLen.toFixed(1)}s max).`)
	          return
	        }
	      }
	    }

	    // Disallow overlaps.
	    for (const n of narration) {
	      if (String((n as any).id) === String(narrationEditor.id)) continue
	      const ns = Number((n as any).startSeconds || 0)
      const ne = Number((n as any).endSeconds || 0)
      if (!(Number.isFinite(ns) && Number.isFinite(ne) && ne > ns)) continue
      const overlaps = start < ne - 1e-6 && end > ns + 1e-6
      if (overlaps) {
        setNarrationEditorError('Narration cannot overlap in time.')
        return
      }
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevNs: Narration[] = Array.isArray((prev as any).narration) ? ((prev as any).narration as any) : []
      const idx = prevNs.findIndex((n: any) => String(n?.id) === String(narrationEditor.id))
      if (idx < 0) return prev
      const updated: Narration = { ...(prevNs[idx] as any), startSeconds: Math.max(0, start), endSeconds: Math.max(0, end), gainDb }
      const next = prevNs.slice()
      next[idx] = updated
      next.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(prev as any), narration: next }
      const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...(nextTimeline as any), playheadSeconds: nextPlayhead }
	    })
	    setNarrationEditor(null)
	    setNarrationEditorError(null)
	  }, [computeTotalSecondsForTimeline, durationsByUploadId, narration, narrationEditor, snapshotUndo])

  const split = useCallback(() => {
    if (selectedNarrationId) {
      const res = splitNarrationAtPlayhead(timeline as any, selectedNarrationId)
      const prevNs = Array.isArray((timeline as any).narration) ? (timeline as any).narration : []
      const nextNs = Array.isArray((res.timeline as any).narration) ? (res.timeline as any).narration : []
      if (res.timeline === (timeline as any) && res.selectedNarrationId === selectedNarrationId) return
      if (nextNs === prevNs) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedNarrationId(res.selectedNarrationId)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      return
    }
    if (selectedAudioId) {
      const res = splitAudioSegmentAtPlayhead(timeline as any, selectedAudioId)
      const prevSegs = Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : []
      const nextSegs = Array.isArray((res.timeline as any).audioSegments) ? (res.timeline as any).audioSegments : []
      if (res.timeline === (timeline as any) && res.selectedAudioId === selectedAudioId) return
      if (nextSegs === prevSegs) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedAudioId(res.selectedAudioId)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      return
    }
    if (selectedClipId) {
      const res = splitClipAtPlayhead(timeline, selectedClipId)
      if (res.timeline === timeline && res.selectedClipId === selectedClipId) return
      if (res.timeline.clips === timeline.clips) return
      snapshotUndo()
      setTimeline(res.timeline)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(res.selectedClipId)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedAudioId(null)
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
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(res.selectedLogoId)
      setSelectedLowerThirdId(null)
      setSelectedAudioId(null)
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
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(res.selectedLowerThirdId)
      setSelectedScreenTitleId(null)
      setSelectedAudioId(null)
      return
    }
    if (selectedScreenTitleId) {
      const res = splitScreenTitleAtPlayhead(timeline as any, selectedScreenTitleId)
      const prevSts = Array.isArray((timeline as any).screenTitles) ? (timeline as any).screenTitles : []
      const nextSts = Array.isArray((res.timeline as any).screenTitles) ? (res.timeline as any).screenTitles : []
      if (res.timeline === (timeline as any) && res.selectedScreenTitleId === selectedScreenTitleId) return
      if (nextSts === prevSts) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(res.selectedScreenTitleId)
      setSelectedAudioId(null)
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
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(null)
      setSelectedGraphicId(res.selectedGraphicId)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedAudioId(null)
    }
  }, [
    clipStarts,
    playhead,
    selectedClipId,
    selectedGraphicId,
    selectedLogoId,
    selectedLowerThirdId,
    selectedNarrationId,
    selectedScreenTitleId,
    saveTimelineNow,
    snapshotUndo,
    timeline,
  ])

  const deleteSelected = useCallback(() => {
    if (selectedAudioId) {
      snapshotUndo()
      setTimeline((prev) => {
        const prevSegs: any[] = Array.isArray((prev as any).audioSegments) ? (prev as any).audioSegments : []
        const nextSegs = prevSegs.filter((s: any) => String(s?.id) !== String(selectedAudioId))
        return { ...(prev as any), audioSegments: nextSegs, audioTrack: null } as any
      })
      setSelectedAudioId(null)
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

    if (selectedScreenTitleId) {
      const target = selectedScreenTitle
      if (!target) return
      snapshotUndo()
      setTimeline((prev) => {
        const prevSts: any[] = Array.isArray((prev as any).screenTitles) ? (prev as any).screenTitles : []
        const nextSts = prevSts.filter((st: any) => String(st.id) !== String((target as any).id))
        return { ...(prev as any), screenTitles: nextSts } as any
      })
      setSelectedScreenTitleId(null)
      return
    }

    if (selectedNarrationId) {
      const target = selectedNarration
      if (!target) return
      snapshotUndo()
      setTimeline((prev) => {
        const prevNs: any[] = Array.isArray((prev as any).narration) ? (prev as any).narration : []
        const nextNs = prevNs.filter((n: any) => String(n.id) !== String((target as any).id))
        return { ...(prev as any), narration: nextNs } as any
      })
      setSelectedNarrationId(null)
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
    setSelectedAudioId(null)
    // Keep selection stable by selecting the next clip (or previous if we deleted the last).
    setSelectedClipId((prevSel) => {
      const wasSelected = prevSel === target.id
      if (!wasSelected && prevSel) return prevSel
      const nextIdx = Math.min(fallbackIdx, Math.max(0, timeline.clips.length - 2))
      const nextClip = timeline.clips.filter((c) => c.id !== target.id)[nextIdx] || null
      return nextClip ? nextClip.id : null
    })
  }, [
    clipStarts,
    playhead,
    selectedAudio,
    selectedClip,
    selectedClipId,
    selectedGraphic,
    selectedGraphicId,
    selectedLowerThird,
    selectedLowerThirdId,
    selectedLogo,
    selectedLogoId,
    selectedNarration,
    selectedNarrationId,
    selectedScreenTitle,
    selectedScreenTitleId,
    selectedStill,
    selectedStillId,
    snapshotUndo,
    stills,
    timeline.clips,
  ])

  const deleteClipById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const idx0 = timeline.clips.findIndex((c) => String(c.id) === targetId)
      if (idx0 < 0) return
      const target = timeline.clips[idx0]
      snapshotUndo()
      setTimeline((prev) => {
        const next = prev.clips.filter((c) => String(c.id) !== targetId)
        const nextTimeline: any = { ...prev, clips: next }
        const nextTotal = computeTotalSecondsForTimeline(nextTimeline)
        const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
        return { ...nextTimeline, playheadSeconds: nextPlayhead }
      })
      setActiveUploadId((prev) => (prev === Number((target as any).uploadId) ? null : prev))
      if (selectedClipId === targetId) setSelectedClipId(null)
    },
    [computeTotalSecondsForTimeline, selectedClipId, snapshotUndo, timeline.clips]
  )

  const duplicateClipById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const idx0 = timeline.clips.findIndex((c) => String(c.id) === targetId)
      if (idx0 < 0) return
      const starts0 = computeClipStarts(timeline.clips)
      const normalizedClips: Clip[] = timeline.clips.map((c, i) => ({ ...c, startSeconds: roundToTenth(starts0[i] || 0) }))
      const clip0 = normalizedClips[idx0]
      const start0 = roundToTenth(Number((clip0 as any).startSeconds || 0))
      const dur = Math.max(0.2, roundToTenth(clipDurationSeconds(clip0)))
      const end0 = roundToTenth(start0 + dur)
      const capEnd = 20 * 60

      const occupied: Array<{ start: number; end: number }> = []
      for (let i = 0; i < normalizedClips.length; i++) {
        const c = normalizedClips[i]
        const s = roundToTenth(Number((c as any).startSeconds || 0))
        const e = roundToTenth(s + clipDurationSeconds(c))
        if (e > s) occupied.push({ start: s, end: e })
      }
      const prevStills: any[] = Array.isArray((timeline as any).stills) ? (timeline as any).stills : []
      for (const st of prevStills) {
        const s = roundToTenth(Number((st as any).startSeconds || 0))
        const e = roundToTenth(Number((st as any).endSeconds || 0))
        if (e > s) occupied.push({ start: s, end: e })
      }
      occupied.sort((a, b) => a.start - b.start || a.end - b.end)
      const merged: Array<{ start: number; end: number }> = []
      for (const r of occupied) {
        const s = clamp(roundToTenth(r.start), 0, capEnd)
        const e = clamp(roundToTenth(r.end), 0, capEnd)
        if (!(e > s)) continue
        const last = merged.length ? merged[merged.length - 1] : null
        if (!last) merged.push({ start: s, end: e })
        else if (s <= last.end + 1e-6) last.end = Math.max(last.end, e)
        else merged.push({ start: s, end: e })
      }
      const gaps: Array<{ start: number; end: number }> = []
      let cursor = 0
      for (const r of merged) {
        if (r.start > cursor + 1e-6) gaps.push({ start: cursor, end: r.start })
        cursor = Math.max(cursor, r.end)
      }
      if (capEnd > cursor + 1e-6) gaps.push({ start: cursor, end: capEnd })

      let placedStart: number | null = null
      for (const g of gaps) {
        const s = Math.max(roundToTenth(g.start), roundToTenth(end0))
        const e = roundToTenth(s + dur)
        if (e <= roundToTenth(g.end) + 1e-6) {
          placedStart = s
          break
        }
      }
      if (placedStart == null) {
        setTimelineMessage('No available slot to duplicate that clip without overlapping.')
        return
      }

      const newId = `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const placed: Clip = { ...clip0, id: newId, startSeconds: placedStart }
      const nextClips = [...normalizedClips, placed].sort(
        (a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
      )
      snapshotUndo()
      const nextTimeline: any = { ...(timeline as any), clips: nextClips }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(String(newId))
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, stills]
  )

  const splitClipById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitClipAtPlayhead(timeline as any, targetId)
      if (res.timeline === (timeline as any) && String(res.selectedClipId) === targetId) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(String(res.selectedClipId))
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const deleteAudioSegmentById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).audioSegments) ? ((timeline as any).audioSegments as any[]) : []
      if (!prevSegs.some((s: any) => String(s?.id) === targetId)) return
      snapshotUndo()
      const nextSegs = prevSegs.filter((s: any) => String(s?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), audioSegments: nextSegs, audioTrack: null }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (String(selectedAudioId || '') === targetId) setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, selectedAudioId, snapshotUndo, timeline]
  )

  const duplicateAudioSegmentById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).audioSegments) ? ((timeline as any).audioSegments as any[]) : []
      const s0 = prevSegs.find((s: any) => String(s?.id) === targetId) as any
      if (!s0) return

      const start0 = roundToTenth(Number(s0.startSeconds || 0))
      const end0 = roundToTenth(Number(s0.endSeconds || 0))
      const dur = roundToTenth(Math.max(0.2, end0 - start0))
      const capEnd = 20 * 60
      let start = roundToTenth(Math.max(0, end0))
      let end = roundToTenth(start + dur)
      if (end > capEnd + 1e-6) {
        setTimelineMessage('Not enough room to duplicate that audio segment.')
        return
      }

      // Disallow overlaps: slide forward to the next available slot.
      const sorted = prevSegs
        .filter((s: any) => String(s?.id) !== targetId)
        .slice()
        .map((s: any) => ({
          ...s,
          startSeconds: roundToTenth(Number(s?.startSeconds || 0)),
          endSeconds: roundToTenth(Number(s?.endSeconds || 0)),
        }))
        .filter((s: any) => Number(s.endSeconds) > Number(s.startSeconds))
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

      for (const other of sorted) {
        const os = Number(other.startSeconds || 0)
        const oe = Number(other.endSeconds || 0)
        const overlaps = start < oe - 1e-6 && end > os + 1e-6
        if (overlaps) {
          start = roundToTenth(oe)
          end = roundToTenth(start + dur)
        }
        if (end > capEnd + 1e-6) break
      }

      // Final overlap check.
      for (const other of sorted) {
        const os = Number(other.startSeconds || 0)
        const oe = Number(other.endSeconds || 0)
        if (start < oe - 1e-6 && end > os + 1e-6) {
          setTimelineMessage('No available slot to duplicate that audio segment without overlapping.')
          return
        }
      }

      const newId = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const placed: any = { ...s0, id: newId, startSeconds: start, endSeconds: end }
      const nextSegs = [...prevSegs, placed].sort(
        (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
      )
      snapshotUndo()
      const nextTimeline: any = { ...(timeline as any), audioSegments: nextSegs, audioTrack: null }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedAudioId(String(newId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setTimelineMessage(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const splitAudioSegmentById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitAudioSegmentAtPlayhead(timeline as any, targetId)
      const prevSegs = Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : []
      const nextSegs = Array.isArray((res.timeline as any).audioSegments) ? (res.timeline as any).audioSegments : []
      if (res.timeline === (timeline as any) && String(res.selectedAudioId) === targetId) return
      if (nextSegs === prevSegs) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedAudioId(String(res.selectedAudioId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const deleteNarrationById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevNs: any[] = Array.isArray((timeline as any).narration) ? ((timeline as any).narration as any[]) : []
      if (!prevNs.some((n: any) => String(n?.id) === targetId)) return
      snapshotUndo()
      const nextNs = prevNs.filter((n: any) => String(n?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), narration: nextNs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (selectedNarrationId === targetId) setSelectedNarrationId(null)
    },
    [playhead, saveTimelineNow, selectedNarrationId, snapshotUndo, timeline]
  )

  const duplicateNarrationById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevNs: any[] = Array.isArray((timeline as any).narration) ? ((timeline as any).narration as any[]) : []
      const n0 = prevNs.find((n: any) => String(n?.id) === targetId) as any
      if (!n0) return
      const start0 = roundToTenth(Number(n0.startSeconds || 0))
      const end0 = roundToTenth(Number(n0.endSeconds || 0))
      const dur = roundToTenth(Math.max(0.2, end0 - start0))
      const capEnd = 20 * 60
      let start = roundToTenth(Math.max(0, end0))
      let end = roundToTenth(start + dur)
      if (end > capEnd + 1e-6) {
        setTimelineMessage('Not enough room to duplicate that narration.')
        return
      }

      // Disallow overlaps: slide forward to the next available slot.
      const sorted = prevNs
        .filter((n: any) => String(n?.id) !== targetId)
        .slice()
        .map((n: any) => ({
          ...n,
          startSeconds: roundToTenth(Number(n?.startSeconds || 0)),
          endSeconds: roundToTenth(Number(n?.endSeconds || 0)),
        }))
        .filter((n: any) => Number(n.endSeconds) > Number(n.startSeconds))
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

      for (const other of sorted) {
        const os = Number(other.startSeconds || 0)
        const oe = Number(other.endSeconds || 0)
        const overlaps = start < oe - 1e-6 && end > os + 1e-6
        if (overlaps) {
          start = roundToTenth(oe)
          end = roundToTenth(start + dur)
        }
        if (end > capEnd + 1e-6) break
      }

      // Final overlap check.
      for (const other of sorted) {
        const os = Number(other.startSeconds || 0)
        const oe = Number(other.endSeconds || 0)
        if (start < oe - 1e-6 && end > os + 1e-6) {
          setTimelineMessage('No available slot to duplicate that narration without overlapping.')
          return
        }
      }

      const newId = `narr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const placed: any = { ...n0, id: newId, startSeconds: start, endSeconds: end }
      const nextNs = [...prevNs, placed].sort(
        (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
      )
      snapshotUndo()
      const nextTimeline: any = { ...(timeline as any), narration: nextNs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedNarrationId(String(newId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const splitNarrationById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitNarrationAtPlayhead(timeline as any, targetId)
      const prevNs = Array.isArray((timeline as any).narration) ? (timeline as any).narration : []
      const nextNs = Array.isArray((res.timeline as any).narration) ? (res.timeline as any).narration : []
      if (res.timeline === (timeline as any) && String(res.selectedNarrationId) === targetId) return
      if (nextNs === prevNs) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedNarrationId(String(res.selectedNarrationId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyClipGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const capEnd = 20 * 60
      const starts0 = computeClipStarts(timeline.clips)
      const normalizedClips: Clip[] = timeline.clips.map((c, i) => ({ ...c, startSeconds: roundToTenth(starts0[i] || 0) }))
      const idx = normalizedClips.findIndex((c) => String(c.id) === targetId)
      if (idx < 0) return
      const clip0 = normalizedClips[idx]

      const clipStartTimeline = roundToTenth(Number((clip0 as any).startSeconds || 0))
      const dur0 = roundToTenth(Math.max(0.2, clipDurationSeconds(clip0)))
      const clipEndTimeline = roundToTenth(clipStartTimeline + dur0)

      const sourceStart0 = roundToTenth(Number((clip0 as any).sourceStartSeconds || 0))
      const sourceEnd0 = roundToTenth(Number((clip0 as any).sourceEndSeconds || 0))
      const sourceMaxRaw = durationsByUploadId[Number((clip0 as any).uploadId)] ?? sourceEnd0
      const sourceMax = roundToTenth(Math.max(0, Number(sourceMaxRaw) || 0))

      const occupied: Array<{ start: number; end: number }> = []
      for (let i = 0; i < normalizedClips.length; i++) {
        if (i === idx) continue
        const c = normalizedClips[i]
        const s = roundToTenth(Number((c as any).startSeconds || 0))
        const e = roundToTenth(s + clipDurationSeconds(c))
        if (e > s) occupied.push({ start: s, end: e })
      }
      const prevStills: any[] = Array.isArray((timeline as any).stills) ? (timeline as any).stills : []
      for (const st of prevStills) {
        const s = roundToTenth(Number((st as any).startSeconds || 0))
        const e = roundToTenth(Number((st as any).endSeconds || 0))
        if (e > s) occupied.push({ start: s, end: e })
      }
      occupied.sort((a, b) => a.start - b.start || a.end - b.end)

      const overlapsAny = (start: number, end: number): boolean => {
        const s0 = roundToTenth(start)
        const e0 = roundToTenth(end)
        for (const r of occupied) {
          if (s0 < r.end - 1e-6 && e0 > r.start + 1e-6) return true
        }
        return false
      }

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      let nextStartTimeline = clipStartTimeline
      let nextSourceStart = sourceStart0
      let nextSourceEnd = sourceEnd0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        if (edgeIntent === 'start') {
          const cand = prevStrict(clipStartTimeline)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - clipStartTimeline) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          nextStartTimeline = roundToTenth(cand)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(clipEndTimeline)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - clipEndTimeline) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          nextStartTimeline = roundToTenth(cand - dur0)
        } else {
          const nS = nearestInclusive(clipStartTimeline)
          const nE = nearestInclusive(clipEndTimeline)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          nextStartTimeline = snapEdge === 'start' ? roundToTenth(nn.v) : roundToTenth(nn.v - dur0)
        }

        nextStartTimeline = clamp(roundToTenth(nextStartTimeline), 0, Math.max(0, capEnd - dur0))
        const nextEndTimeline = roundToTenth(nextStartTimeline + dur0)
        if (overlapsAny(nextStartTimeline, nextEndTimeline)) {
          setTimelineMessage('Cannot snap (would overlap another base clip).')
          return
        }
      } else if (action === 'expand_end' || action === 'contract_end') {
        const cand = action === 'expand_end' ? nextStrict(clipEndTimeline) : prevStrict(clipEndTimeline)
        if (cand == null) {
          setTimelineMessage(action === 'expand_end' ? 'No guideline after end.' : 'No guideline before end.')
          return
        }
        const desiredEndTimeline = roundToTenth(cand)
        const desiredDur = roundToTenth(desiredEndTimeline - clipStartTimeline)
        if (!(desiredDur > 0.2)) {
          setTimelineMessage('Resulting duration is too small.')
          return
        }
        const desiredSourceEnd = roundToTenth(sourceStart0 + desiredDur)
        if (desiredSourceEnd > sourceMax + 1e-6) {
          setTimelineMessage('No more source video available to extend to that guideline.')
          return
        }
        nextSourceEnd = clamp(desiredSourceEnd, sourceStart0 + 0.2, sourceMax)
        const nextEndTimeline = roundToTenth(clipStartTimeline + (nextSourceEnd - sourceStart0))
        if (nextEndTimeline > capEnd + 1e-6) {
          setTimelineMessage('End exceeds allowed duration.')
          return
        }
        if (overlapsAny(clipStartTimeline, nextEndTimeline)) {
          setTimelineMessage('Cannot resize (would overlap another base clip).')
          return
        }
      } else if (action === 'expand_start' || action === 'contract_start') {
        const cand = action === 'expand_start' ? prevStrict(clipStartTimeline) : nextStrict(clipStartTimeline)
        if (cand == null) {
          setTimelineMessage(action === 'expand_start' ? 'No guideline before start.' : 'No guideline after start.')
          return
        }
        const desiredStartTimeline = roundToTenth(cand)
        const delta = roundToTenth(clipStartTimeline - desiredStartTimeline)
        if (action === 'contract_start') {
          // delta is negative here (moving right); use abs for source trim.
          const shift = roundToTenth(desiredStartTimeline - clipStartTimeline)
          if (!(shift > 0)) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          const nextSourceStartCandidate = roundToTenth(sourceStart0 + shift)
          if (nextSourceStartCandidate > sourceEnd0 - 0.2 + 1e-6) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          nextStartTimeline = clamp(desiredStartTimeline, 0, capEnd)
          nextSourceStart = nextSourceStartCandidate
          // End stays fixed in timeline; sourceEnd unchanged.
          const nextDur = roundToTenth(sourceEnd0 - nextSourceStart)
          const nextEndTimeline = roundToTenth(nextStartTimeline + nextDur)
          if (Math.abs(nextEndTimeline - clipEndTimeline) > 0.2 + 1e-6) {
            // Keep end fixed: adjust end by shifting start only (duration already shrunk accordingly).
          }
          if (overlapsAny(nextStartTimeline, clipEndTimeline)) {
            setTimelineMessage('Cannot resize (would overlap another base clip).')
            return
          }
        } else {
          // expand_start: move start left, keep end fixed by consuming earlier source.
          if (!(delta > 0)) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (sourceStart0 < delta - 1e-6) {
            setTimelineMessage('No more source video available to extend start to that guideline.')
            return
          }
          nextStartTimeline = clamp(desiredStartTimeline, 0, capEnd)
          nextSourceStart = roundToTenth(sourceStart0 - delta)
          if (overlapsAny(nextStartTimeline, clipEndTimeline)) {
            setTimelineMessage('Cannot resize (would overlap another base clip).')
            return
          }
        }
      }

      snapshotUndo()
      const nextClips = normalizedClips.slice()
      const updated: Clip = {
        ...clip0,
        startSeconds: roundToTenth(nextStartTimeline),
        sourceStartSeconds: roundToTenth(nextSourceStart),
        sourceEndSeconds: roundToTenth(nextSourceEnd),
      }
      nextClips[idx] = updated
      nextClips.sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), clips: nextClips }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, stills, durationsByUploadId]
  )

  const applyNarrationGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return

      const prevSegs: any[] = Array.isArray((timeline as any).narration) ? ((timeline as any).narration as any[]) : []
      const idx = prevSegs.findIndex((n: any) => String(n?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const seg0 = prevSegs[idx] as any
      const start0 = roundToTenth(Number(seg0.startSeconds || 0))
      const end0 = roundToTenth(Number(seg0.endSeconds || 0))
      const minLen = 0.2
      const dur = roundToTenth(Math.max(minLen, end0 - start0))
      const capEnd = 20 * 60

      const sorted = prevSegs
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const pos = sorted.findIndex((s: any) => String(s?.id) === targetId)
      const prevEnd = pos > 0 ? roundToTenth(Number((sorted[pos - 1] as any).endSeconds || 0)) : 0
      const nextStart =
        pos >= 0 && pos < sorted.length - 1 ? roundToTenth(Number((sorted[pos + 1] as any).startSeconds || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const totalNoOffsetSecondsRaw = durationsByUploadId[Number(seg0.uploadId)] ?? 0
      const totalNoOffsetSeconds = roundToTenth(Math.max(0, Number(totalNoOffsetSecondsRaw) || 0))
      const sourceStart0 =
        seg0.sourceStartSeconds != null && Number.isFinite(Number(seg0.sourceStartSeconds)) ? roundToTenth(Number(seg0.sourceStartSeconds)) : 0

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      const overlapsAny = (start: number, end: number): boolean => {
        const s0 = roundToTenth(start)
        const e0 = roundToTenth(end)
        for (const other of prevSegs) {
          if (String((other as any)?.id) === targetId) continue
          const os = roundToTenth(Number((other as any).startSeconds || 0))
          const oe = roundToTenth(Number((other as any).endSeconds || 0))
          if (!(oe > os)) continue
          if (s0 < oe - 1e-6 && e0 > os + 1e-6) return true
        }
        return false
      }

      let startS = start0
      let endS = end0
      let sourceStartS = sourceStart0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        if (edgeIntent === 'start') {
          const cand = prevStrict(start0)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (snapEdge === 'start') {
            startS = roundToTenth(nn.v)
            endS = roundToTenth(startS + dur)
          } else {
            endS = roundToTenth(nn.v)
            startS = roundToTenth(endS - dur)
          }
        }
        if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
          setTimelineMessage('Cannot snap (would overlap another narration segment).')
          return
        }
        if (overlapsAny(startS, endS)) {
          setTimelineMessage('Cannot snap (would overlap another narration segment).')
          return
        }
      } else if (action === 'expand_end' || action === 'contract_end') {
        const cand = action === 'expand_end' ? nextStrict(end0) : prevStrict(end0)
        if (cand == null) {
          setTimelineMessage(action === 'expand_end' ? 'No guideline after end.' : 'No guideline before end.')
          return
        }
        const desiredEnd = roundToTenth(cand)
        if (desiredEnd > maxEndSeconds + 1e-6 || desiredEnd < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to resize end to that guideline.')
          return
        }
        const requestedLen = roundToTenth(Math.max(0, desiredEnd - start0))
        if (!(requestedLen > minLen)) {
          setTimelineMessage('Resulting duration is too small.')
          return
        }
        if (totalNoOffsetSeconds > 0) {
          const maxLen = roundToTenth(Math.max(0, totalNoOffsetSeconds - sourceStart0))
          if (requestedLen > maxLen + 1e-6) {
            setTimelineMessage('No more source audio available to extend to that guideline.')
            return
          }
        }
        startS = start0
        endS = desiredEnd
      } else if (action === 'expand_start' || action === 'contract_start') {
        const cand = action === 'expand_start' ? prevStrict(start0) : nextStrict(start0)
        if (cand == null) {
          setTimelineMessage(action === 'expand_start' ? 'No guideline before start.' : 'No guideline after start.')
          return
        }
        const desiredStart = roundToTenth(cand)
        if (desiredStart < minStartSeconds - 1e-6 || desiredStart > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to resize start to that guideline.')
          return
        }
        const shift = roundToTenth(desiredStart - start0) // + when contracting (moving right), - when expanding (moving left)
        if (shift > 0) {
          // contract_start: move start right and advance sourceStartSeconds so content stays anchored.
          sourceStartS = roundToTenth(Math.max(0, sourceStart0 + shift))
        } else if (shift < 0) {
          // expand_start: move start left and pull sourceStartSeconds back (must have enough source).
          const need = roundToTenth(Math.abs(shift))
          if (sourceStart0 < need - 1e-6) {
            setTimelineMessage('No more source audio available to extend start to that guideline.')
            return
          }
          sourceStartS = roundToTenth(Math.max(0, sourceStart0 - need))
        }
        startS = desiredStart
        endS = end0
        const requestedLen = roundToTenth(Math.max(0, endS - startS))
        if (!(requestedLen > minLen)) {
          setTimelineMessage('Resulting duration is too small.')
          return
        }
        if (totalNoOffsetSeconds > 0) {
          const maxLen = roundToTenth(Math.max(0, totalNoOffsetSeconds - sourceStartS))
          if (requestedLen > maxLen + 1e-6) {
            setTimelineMessage('No more source audio available to extend to that guideline.')
            return
          }
        }
      }

      // Final overlap check after resizing.
      if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
        setTimelineMessage('Cannot resize (would overlap another narration segment).')
        return
      }
      if (overlapsAny(startS, endS)) {
        setTimelineMessage('Cannot resize (would overlap another narration segment).')
        return
      }

      snapshotUndo()
      const nextSegs = prevSegs.slice()
      nextSegs[idx] = { ...seg0, startSeconds: startS, endSeconds: endS, sourceStartSeconds: sourceStartS }
      nextSegs.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), narration: nextSegs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [durationsByUploadId, playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyAudioSegmentGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return

      const prevSegs: any[] = Array.isArray((timeline as any).audioSegments) ? ((timeline as any).audioSegments as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const seg0 = prevSegs[idx] as any
      const start0 = roundToTenth(Number(seg0.startSeconds || 0))
      const end0 = roundToTenth(Number(seg0.endSeconds || 0))
      const minLen = 0.2
      const dur = roundToTenth(Math.max(minLen, end0 - start0))
      const capEnd = 20 * 60

      const sorted = prevSegs
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const pos = sorted.findIndex((s: any) => String(s?.id) === targetId)
      const prevEnd = pos > 0 ? roundToTenth(Number((sorted[pos - 1] as any).endSeconds || 0)) : 0
      const nextStart =
        pos >= 0 && pos < sorted.length - 1 ? roundToTenth(Number((sorted[pos + 1] as any).startSeconds || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const totalNoOffsetSecondsRaw = durationsByUploadId[Number(seg0.uploadId)] ?? 0
      const totalNoOffsetSeconds = roundToTenth(Math.max(0, Number(totalNoOffsetSecondsRaw) || 0))
      const sourceStart0 =
        seg0.sourceStartSeconds != null && Number.isFinite(Number(seg0.sourceStartSeconds)) ? roundToTenth(Number(seg0.sourceStartSeconds)) : 0

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      const overlapsAny = (start: number, end: number): boolean => {
        const s0 = roundToTenth(start)
        const e0 = roundToTenth(end)
        for (const other of prevSegs) {
          if (String((other as any)?.id) === targetId) continue
          const os = roundToTenth(Number((other as any).startSeconds || 0))
          const oe = roundToTenth(Number((other as any).endSeconds || 0))
          if (!(oe > os)) continue
          if (s0 < oe - 1e-6 && e0 > os + 1e-6) return true
        }
        return false
      }

      let startS = start0
      let endS = end0
      let sourceStartS = sourceStart0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        if (edgeIntent === 'start') {
          const cand = prevStrict(start0)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (snapEdge === 'start') {
            startS = roundToTenth(nn.v)
            endS = roundToTenth(startS + dur)
          } else {
            endS = roundToTenth(nn.v)
            startS = roundToTenth(endS - dur)
          }
        }
        if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
          setTimelineMessage('Cannot snap (would overlap another audio segment).')
          return
        }
        if (overlapsAny(startS, endS)) {
          setTimelineMessage('Cannot snap (would overlap another audio segment).')
          return
        }
      } else if (action === 'expand_end' || action === 'contract_end') {
        const cand = action === 'expand_end' ? nextStrict(end0) : prevStrict(end0)
        if (cand == null) {
          setTimelineMessage(action === 'expand_end' ? 'No guideline after end.' : 'No guideline before end.')
          return
        }
        const desiredEnd = roundToTenth(cand)
        if (desiredEnd > maxEndSeconds + 1e-6 || desiredEnd < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to resize end to that guideline.')
          return
        }
        const requestedLen = roundToTenth(Math.max(0, desiredEnd - start0))
        if (!(requestedLen > minLen)) {
          setTimelineMessage('Resulting duration is too small.')
          return
        }
        if (totalNoOffsetSeconds > 0) {
          const maxLen = roundToTenth(Math.max(0, totalNoOffsetSeconds - sourceStart0))
          if (requestedLen > maxLen + 1e-6) {
            setTimelineMessage('No more source audio available to extend to that guideline.')
            return
          }
        }
        startS = start0
        endS = desiredEnd
      } else if (action === 'expand_start' || action === 'contract_start') {
        const cand = action === 'expand_start' ? prevStrict(start0) : nextStrict(start0)
        if (cand == null) {
          setTimelineMessage(action === 'expand_start' ? 'No guideline before start.' : 'No guideline after start.')
          return
        }
        const desiredStart = roundToTenth(cand)
        if (desiredStart < minStartSeconds - 1e-6 || desiredStart > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to resize start to that guideline.')
          return
        }
        const shift = roundToTenth(desiredStart - start0) // + when contracting (moving right), - when expanding (moving left)
        if (shift > 0) {
          // contract_start: move start right and advance sourceStartSeconds so content stays anchored.
          sourceStartS = roundToTenth(Math.max(0, sourceStart0 + shift))
        } else if (shift < 0) {
          // expand_start: move start left and pull sourceStartSeconds back (must have enough source).
          const delta = roundToTenth(-shift)
          if (sourceStart0 < delta - 1e-6) {
            setTimelineMessage('No more source audio available to extend start to that guideline.')
            return
          }
          sourceStartS = roundToTenth(Math.max(0, sourceStart0 - delta))
        }
        startS = desiredStart
        endS = end0
      } else {
        return
      }

      if (overlapsAny(startS, endS)) {
        setTimelineMessage('Cannot resize (would overlap another audio segment).')
        return
      }

      snapshotUndo()
      const nextSegs = prevSegs.slice()
      nextSegs[idx] = { ...seg0, startSeconds: startS, endSeconds: endS, sourceStartSeconds: sourceStartS }
      nextSegs.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), audioSegments: nextSegs, audioTrack: null }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [durationsByUploadId, playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const deleteGraphicById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevGraphics = Array.isArray((timeline as any).graphics) ? ((timeline as any).graphics as any[]) : []
      if (!prevGraphics.some((g: any) => String(g?.id) === targetId)) return
      snapshotUndo()
      const nextGraphics = prevGraphics.filter((g: any) => String(g?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), graphics: nextGraphics }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (selectedGraphicId === targetId) setSelectedGraphicId(null)
    },
    [playhead, saveTimelineNow, selectedGraphicId, snapshotUndo, timeline]
  )

  const duplicateGraphicById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevGraphics: any[] = Array.isArray((timeline as any).graphics) ? ((timeline as any).graphics as any[]) : []
      const g0 = prevGraphics.find((g: any) => String(g?.id) === targetId) as any
      if (!g0) return
      const start0 = roundToTenth(Number(g0.startSeconds || 0))
      const end0 = roundToTenth(Number(g0.endSeconds || 0))
      const dur = roundToTenth(Math.max(0.2, end0 - start0))

      const cap = timeline.clips.length ? totalSecondsVideo : null
      let start = roundToTenth(Math.max(0, end0))
      let end = roundToTenth(start + dur)
      if (cap != null && end > cap + 1e-6) {
        setTimelineMessage('Not enough room to duplicate that graphic within the video duration.')
        return
      }

      // Disallow overlaps: slide forward to the next available slot.
      const sorted = prevGraphics
        .filter((g: any) => String(g?.id) !== targetId)
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      for (let guard = 0; guard < 200; guard++) {
        let hit: any = null
        for (const g of sorted) {
          const gs = Number((g as any).startSeconds)
          const ge = Number((g as any).endSeconds)
          if (!(Number.isFinite(gs) && Number.isFinite(ge))) continue
          const overlaps = start < ge - 1e-6 && end > gs + 1e-6
          if (overlaps) {
            hit = g
            break
          }
        }
        if (!hit) break
        start = roundToTenth(Number((hit as any).endSeconds || start))
        end = roundToTenth(start + dur)
        if (cap != null && end > cap + 1e-6) {
          setTimelineMessage('No available slot to duplicate without overlapping.')
          return
        }
      }

      const newId = `gfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const newGraphic: any = { id: newId, uploadId: Number(g0.uploadId), startSeconds: start, endSeconds: end }
      const nextGraphics = [...prevGraphics, newGraphic].slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds))
      snapshotUndo()
      const nextTimeline: any = { ...(timeline as any), graphics: nextGraphics }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedGraphicId(newId)
      setSelectedClipId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setTimelineMessage(null)
    },
    [
      playhead,
      saveTimelineNow,
      snapshotUndo,
      timeline,
      totalSecondsVideo,
      setSelectedClipId,
      setSelectedLogoId,
      setSelectedLowerThirdId,
      setSelectedScreenTitleId,
      setSelectedNarrationId,
      setSelectedStillId,
      setSelectedAudioId,
    ]
  )

  const deleteStillById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevStills: any[] = Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : []
      if (!prevStills.some((s: any) => String(s?.id) === targetId)) return
      snapshotUndo()
      const nextStills = prevStills.filter((s: any) => String(s?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), stills: nextStills }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (selectedStillId === targetId) setSelectedStillId(null)
      if (stillEditor && String(stillEditor.id) === targetId) {
        setStillEditor(null)
        setStillEditorError(null)
      }
    },
    [playhead, saveTimelineNow, selectedStillId, snapshotUndo, stillEditor, timeline]
  )

  const duplicateStillById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevStills: any[] = Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : []
      const s0 = prevStills.find((s: any) => String(s?.id) === targetId) as any
      if (!s0) return
      const start0 = roundToTenth(Number(s0.startSeconds || 0))
      const end0 = roundToTenth(Number(s0.endSeconds || 0))
      const dur = roundToTenth(Math.max(0.1, end0 - start0))
      const capEnd = 20 * 60

      let start = roundToTenth(Math.max(0, end0))
      let end = roundToTenth(start + dur)
      if (end > capEnd + 1e-6) {
        setTimelineMessage('Not enough room to duplicate that freeze frame within the allowed duration.')
        return
      }

      const clipRanges = timeline.clips.map((c, i) => ({
        start: roundToTenth(Number(clipStarts[i] || 0)),
        end: roundToTenth(Number(clipStarts[i] || 0) + clipDurationSeconds(c)),
      }))
      const otherStills = prevStills
        .filter((s: any) => String(s?.id) !== targetId)
        .map((s: any) => ({ start: roundToTenth(Number(s.startSeconds || 0)), end: roundToTenth(Number(s.endSeconds || 0)) }))
      const occupied = [...clipRanges, ...otherStills].filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)

      for (let guard = 0; guard < 200; guard++) {
        let hit: any = null
        for (const r of occupied) {
          const overlaps = start < r.end - 1e-6 && end > r.start + 1e-6
          if (overlaps) {
            hit = r
            break
          }
        }
        if (!hit) break
        start = roundToTenth(Number(hit.end || start))
        end = roundToTenth(start + dur)
        if (end > capEnd + 1e-6) {
          setTimelineMessage('No available slot to duplicate without overlapping.')
          return
        }
      }

      const newId = `still_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const nextStill: Still = {
        ...(s0 as any),
        id: newId,
        startSeconds: start,
        endSeconds: end,
      }
      const nextStills = [...prevStills, nextStill].slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      snapshotUndo()
      const nextTimeline: any = { ...(timeline as any), stills: nextStills }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedStillId(newId)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedAudioId(null)
      setTimelineMessage(null)
    },
    [clipStarts, playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const splitStillById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitStillAtPlayhead(timeline as any, targetId)
      const prevStills = Array.isArray((timeline as any).stills) ? (timeline as any).stills : []
      const nextStills = Array.isArray((res.timeline as any).stills) ? (res.timeline as any).stills : []
      if (res.timeline === (timeline as any) && String(res.selectedStillId) === targetId) return
      if (nextStills === prevStills) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedStillId(String(res.selectedStillId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyStillGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevStills: any[] = Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : []
      const idx = prevStills.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const s0 = prevStills[idx] as any
      const start0 = roundToTenth(Number(s0.startSeconds || 0))
      const end0 = roundToTenth(Number(s0.endSeconds || 0))
      const minLen = 0.1
      const dur = roundToTenth(Math.max(minLen, end0 - start0))
      const capEnd = 20 * 60

      const clipRanges = timeline.clips.map((c, i) => ({
        id: `clip:${String(c.id)}`,
        start: roundToTenth(Number(clipStarts[i] || 0)),
        end: roundToTenth(Number(clipStarts[i] || 0) + clipDurationSeconds(c)),
      }))
      const stillRanges = prevStills.map((s: any) => ({
        id: `still:${String(s?.id)}`,
        start: roundToTenth(Number(s.startSeconds || 0)),
        end: roundToTenth(Number(s.endSeconds || 0)),
      }))
      const ranges = [...clipRanges, ...stillRanges]
        .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
        .sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)))
      const pos = ranges.findIndex((r) => r.id === `still:${targetId}`)
      const prevEnd = pos > 0 ? roundToTenth(Number(ranges[pos - 1]?.end || 0)) : 0
      const nextStart = pos >= 0 && pos < ranges.length - 1 ? roundToTenth(Number(ranges[pos + 1]?.start || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const overlapsAny = (s: number, e: number) => {
        for (const r of ranges) {
          if (r.id === `still:${targetId}`) continue
          if (s < r.end - 1e-6 && e > r.start + 1e-6) return true
        }
        return false
      }

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      let startS = start0
      let endS = end0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        if (edgeIntent === 'start') {
          const cand = prevStrict(start0)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (snapEdge === 'start') {
            startS = roundToTenth(nn.v)
            endS = roundToTenth(startS + dur)
          } else {
            endS = roundToTenth(nn.v)
            startS = roundToTenth(endS - dur)
          }
        }
        if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
          setTimelineMessage('Cannot snap (would overlap another clip or freeze frame).')
          return
        }
        if (overlapsAny(startS, endS)) {
          setTimelineMessage('Cannot snap (would overlap another clip or freeze frame).')
          return
        }
      } else if (action === 'expand_end' || action === 'contract_end') {
        const cand = action === 'expand_end' ? nextStrict(end0) : prevStrict(end0)
        if (cand == null) {
          setTimelineMessage(action === 'expand_end' ? 'No guideline after end.' : 'No guideline before end.')
          return
        }
        const desiredEnd = roundToTenth(cand)
        if (desiredEnd > maxEndSeconds + 1e-6 || desiredEnd < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to resize end to that guideline.')
          return
        }
        startS = start0
        endS = desiredEnd
      } else if (action === 'expand_start' || action === 'contract_start') {
        const cand = action === 'expand_start' ? prevStrict(start0) : nextStrict(start0)
        if (cand == null) {
          setTimelineMessage(action === 'expand_start' ? 'No guideline before start.' : 'No guideline after start.')
          return
        }
        const desiredStart = roundToTenth(cand)
        if (desiredStart < minStartSeconds - 1e-6 || desiredStart > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to resize start to that guideline.')
          return
        }
        startS = desiredStart
        endS = end0
      } else {
        return
      }

      if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
        setTimelineMessage('Cannot resize (would overlap another clip or freeze frame).')
        return
      }
      if (overlapsAny(startS, endS)) {
        setTimelineMessage('Cannot resize (would overlap another clip or freeze frame).')
        return
      }

      snapshotUndo()
      const nextStills = prevStills.slice()
      nextStills[idx] = { ...(s0 as any), startSeconds: startS, endSeconds: endS }
      nextStills.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), stills: nextStills }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [clipStarts, playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const splitGraphicById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitGraphicAtPlayhead(timeline as any, targetId)
      const prevGraphics = Array.isArray((timeline as any).graphics) ? (timeline as any).graphics : []
      const nextGraphics = Array.isArray((res.timeline as any).graphics) ? (res.timeline as any).graphics : []
      if (res.timeline === (timeline as any) && String(res.selectedGraphicId) === targetId) return
      if (nextGraphics === prevGraphics) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedGraphicId(String(res.selectedGraphicId))
      setSelectedClipId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyGraphicGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevGraphics: any[] = Array.isArray((timeline as any).graphics) ? ((timeline as any).graphics as any[]) : []
      const idx = prevGraphics.findIndex((g: any) => String(g?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const g0 = prevGraphics[idx] as any
      const start0 = roundToTenth(Number(g0.startSeconds || 0))
      const end0 = roundToTenth(Number(g0.endSeconds || 0))
      const minLen = 0.2
      const dur = roundToTenth(Math.max(minLen, end0 - start0))

      // Disallow overlaps: constrain by neighbors.
      const sorted = prevGraphics.slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const pos = sorted.findIndex((gg: any) => String(gg?.id) === targetId)
      const capEnd = timeline.clips.length ? totalSecondsVideo : 20 * 60
      const prevEnd = pos > 0 ? roundToTenth(Number((sorted[pos - 1] as any).endSeconds || 0)) : 0
      const nextStart =
        pos >= 0 && pos < sorted.length - 1 ? roundToTenth(Number((sorted[pos + 1] as any).startSeconds || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      let startS = start0
      let endS = end0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        // Directional snap for edge-specific UX:
        // - start edge: snap left to the nearest guideline strictly before start
        // - end edge: snap right to the nearest guideline strictly after end
        if (edgeIntent === 'start') {
          const cand = prevStrict(start0)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another graphic).')
            return
          }
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another graphic).')
            return
          }
        } else {
          // Fallback: nearest inclusive to whichever edge is closest.
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) {
            setTimelineMessage('No guidelines available.')
            return
          }
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (snapEdge === 'start') {
            startS = roundToTenth(nn.v)
            endS = roundToTenth(startS + dur)
          } else {
            endS = roundToTenth(nn.v)
            startS = roundToTenth(endS - dur)
          }
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another graphic).')
            return
          }
        }
      } else if (action === 'expand_start') {
        const cand = prevStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline before start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to expand start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'contract_start') {
        const cand = nextStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline after start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to contract start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'expand_end') {
        const cand = nextStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline after end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to expand end to that guideline.')
          return
        }
        endS = nextEndS
      } else if (action === 'contract_end') {
        const cand = prevStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline before end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to contract end to that guideline.')
          return
        }
        endS = nextEndS
      }

      startS = roundToTenth(startS)
      endS = roundToTenth(endS)
      if (!(endS > startS + minLen - 1e-6)) {
        setTimelineMessage('Resulting duration is too small.')
        return
      }

      snapshotUndo()
      const nextGraphics = prevGraphics.slice()
      nextGraphics[idx] = { ...g0, startSeconds: startS, endSeconds: endS }
      nextGraphics.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), graphics: nextGraphics }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, totalSecondsVideo]
  )

  const deleteLogoById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevLogos: any[] = Array.isArray((timeline as any).logos) ? ((timeline as any).logos as any[]) : []
      if (!prevLogos.some((l: any) => String(l?.id) === targetId)) return
      snapshotUndo()
      const nextLogos = prevLogos.filter((l: any) => String(l?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), logos: nextLogos }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (selectedLogoId === targetId) setSelectedLogoId(null)
    },
    [playhead, saveTimelineNow, selectedLogoId, snapshotUndo, timeline]
  )

  const duplicateLogoById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevLogos: any[] = Array.isArray((timeline as any).logos) ? ((timeline as any).logos as any[]) : []
      const l0 = prevLogos.find((l: any) => String(l?.id) === targetId) as any
      if (!l0) return
      const start0 = roundToTenth(Number(l0.startSeconds || 0))
      const end0 = roundToTenth(Number(l0.endSeconds || 0))
      const dur = roundToTenth(Math.max(0.2, end0 - start0))
      const capEnd = Math.max(0, Number(totalSeconds) || 0)
      if (dur <= 0 || capEnd <= 0) return

      const sorted = prevLogos.slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const startCandidateBase = roundToTenth(end0)
      let start = startCandidateBase
      let end = roundToTenth(start + dur)
      let guard = 0
      while (guard++ < 200) {
        if (end > capEnd + 1e-6) {
          setTimelineMessage('Not enough room to duplicate that logo within the video duration.')
          return
        }
        let overlapped = false
        for (const seg of sorted) {
          if (String(seg?.id) === targetId) continue
          const s = roundToTenth(Number(seg?.startSeconds || 0))
          const e2 = roundToTenth(Number(seg?.endSeconds || 0))
          if (!(e2 > s)) continue
          if (start < e2 - 1e-6 && end > s + 1e-6) {
            // Move right after the overlapped segment.
            start = roundToTenth(e2)
            end = roundToTenth(start + dur)
            overlapped = true
            break
          }
        }
        if (!overlapped) break
      }

      const newId = `logo_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      const nextLogos = prevLogos.slice()
      nextLogos.push({
        ...l0,
        id: newId,
        startSeconds: start,
        endSeconds: end,
      })
      nextLogos.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), logos: nextLogos }
      snapshotUndo()
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedLogoId(String(newId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [
      playhead,
      saveTimelineNow,
      snapshotUndo,
      timeline,
      totalSeconds,
      setSelectedClipId,
      setSelectedGraphicId,
      setSelectedLowerThirdId,
      setSelectedScreenTitleId,
      setSelectedNarrationId,
      setSelectedStillId,
      setSelectedAudioId,
    ]
  )

  const splitLogoById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitLogoAtPlayhead(timeline as any, targetId)
      const prevLogos = Array.isArray((timeline as any).logos) ? (timeline as any).logos : []
      const nextLogos = Array.isArray((res.timeline as any).logos) ? (res.timeline as any).logos : []
      if (res.timeline === (timeline as any) && String(res.selectedLogoId) === targetId) return
      if (nextLogos === prevLogos) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedLogoId(String(res.selectedLogoId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyLogoGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).logos) ? ((timeline as any).logos as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const seg0 = prevSegs[idx] as any
      const start0 = roundToTenth(Number(seg0.startSeconds || 0))
      const end0 = roundToTenth(Number(seg0.endSeconds || 0))
      const minLen = 0.2
      const dur = roundToTenth(Math.max(minLen, end0 - start0))
      const capEnd = Math.max(0, Number(totalSeconds) || 0)

      const sorted = prevSegs.slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const pos = sorted.findIndex((s: any) => String(s?.id) === targetId)
      const prevEnd = pos > 0 ? roundToTenth(Number((sorted[pos - 1] as any).endSeconds || 0)) : 0
      const nextStart =
        pos >= 0 && pos < sorted.length - 1 ? roundToTenth(Number((sorted[pos + 1] as any).startSeconds || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      let startS = start0
      let endS = end0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        if (edgeIntent === 'start') {
          const cand = prevStrict(start0)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another logo).')
            return
          }
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another logo).')
            return
          }
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (snapEdge === 'start') {
            startS = roundToTenth(nn.v)
            endS = roundToTenth(startS + dur)
          } else {
            endS = roundToTenth(nn.v)
            startS = roundToTenth(endS - dur)
          }
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another logo).')
            return
          }
        }
      } else if (action === 'expand_start') {
        const cand = prevStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline before start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to expand start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'contract_start') {
        const cand = nextStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline after start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to contract start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'expand_end') {
        const cand = nextStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline after end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to expand end to that guideline.')
          return
        }
        endS = nextEndS
      } else if (action === 'contract_end') {
        const cand = prevStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline before end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to contract end to that guideline.')
          return
        }
        endS = nextEndS
      }

      startS = roundToTenth(startS)
      endS = roundToTenth(endS)
      if (!(endS > startS + minLen - 1e-6)) {
        setTimelineMessage('Resulting duration is too small.')
        return
      }

      snapshotUndo()
      const nextSegs = prevSegs.slice()
      nextSegs[idx] = { ...seg0, startSeconds: startS, endSeconds: endS }
      nextSegs.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), logos: nextSegs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, totalSeconds]
  )

  const deleteLowerThirdById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevLts: any[] = Array.isArray((timeline as any).lowerThirds) ? ((timeline as any).lowerThirds as any[]) : []
      if (!prevLts.some((lt: any) => String(lt?.id) === targetId)) return
      snapshotUndo()
      const nextLts = prevLts.filter((lt: any) => String(lt?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), lowerThirds: nextLts }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (selectedLowerThirdId === targetId) setSelectedLowerThirdId(null)
    },
    [playhead, saveTimelineNow, selectedLowerThirdId, snapshotUndo, timeline]
  )

  const duplicateLowerThirdById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevLts: any[] = Array.isArray((timeline as any).lowerThirds) ? ((timeline as any).lowerThirds as any[]) : []
      const lt0 = prevLts.find((lt: any) => String(lt?.id) === targetId) as any
      if (!lt0) return
      const start0 = roundToTenth(Number(lt0.startSeconds || 0))
      const end0 = roundToTenth(Number(lt0.endSeconds || 0))
      const dur = roundToTenth(Math.max(0.2, end0 - start0))
      const capEnd = Math.max(0, Number(totalSeconds) || 0)
      if (dur <= 0 || capEnd <= 0) return

      const sorted = prevLts
        .filter((lt: any) => String(lt?.id) !== targetId)
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

      let start = roundToTenth(Math.max(0, end0))
      let end = roundToTenth(start + dur)
      if (end > capEnd + 1e-6) {
        setTimelineMessage('Not enough room to duplicate that lower third within the video duration.')
        return
      }

      for (let guard = 0; guard < 200; guard++) {
        let hit: any = null
        for (const lt of sorted) {
          const s = Number((lt as any).startSeconds)
          const e2 = Number((lt as any).endSeconds)
          if (!(Number.isFinite(s) && Number.isFinite(e2) && e2 > s)) continue
          if (start < e2 - 1e-6 && end > s + 1e-6) {
            hit = lt
            break
          }
        }
        if (!hit) break
        start = roundToTenth(Number((hit as any).endSeconds || start))
        end = roundToTenth(start + dur)
        if (end > capEnd + 1e-6) {
          setTimelineMessage('No available slot to duplicate without overlapping.')
          return
        }
      }

      const newId = `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const nextLts = prevLts.slice()
      nextLts.push({
        ...lt0,
        id: newId,
        startSeconds: start,
        endSeconds: end,
      })
      nextLts.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), lowerThirds: nextLts }
      snapshotUndo()
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedLowerThirdId(String(newId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [
      playhead,
      saveTimelineNow,
      snapshotUndo,
      timeline,
      totalSeconds,
      setSelectedClipId,
      setSelectedGraphicId,
      setSelectedLogoId,
      setSelectedScreenTitleId,
      setSelectedNarrationId,
      setSelectedStillId,
      setSelectedAudioId,
    ]
  )

  const splitLowerThirdById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitLowerThirdAtPlayhead(timeline as any, targetId)
      const prevLts = Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : []
      const nextLts = Array.isArray((res.timeline as any).lowerThirds) ? (res.timeline as any).lowerThirds : []
      if (res.timeline === (timeline as any) && String(res.selectedLowerThirdId) === targetId) return
      if (nextLts === prevLts) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedLowerThirdId(String(res.selectedLowerThirdId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyLowerThirdGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).lowerThirds) ? ((timeline as any).lowerThirds as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const seg0 = prevSegs[idx] as any
      const start0 = roundToTenth(Number(seg0.startSeconds || 0))
      const end0 = roundToTenth(Number(seg0.endSeconds || 0))
      const minLen = 0.2
      const dur = roundToTenth(Math.max(minLen, end0 - start0))
      const capEnd = Math.max(0, Number(totalSeconds) || 0)

      const sorted = prevSegs.slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const pos = sorted.findIndex((s: any) => String(s?.id) === targetId)
      const prevEnd = pos > 0 ? roundToTenth(Number((sorted[pos - 1] as any).endSeconds || 0)) : 0
      const nextStart =
        pos >= 0 && pos < sorted.length - 1 ? roundToTenth(Number((sorted[pos + 1] as any).startSeconds || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      let startS = start0
      let endS = end0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        if (edgeIntent === 'start') {
          const cand = prevStrict(start0)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another lower third).')
            return
          }
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another lower third).')
            return
          }
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (snapEdge === 'start') {
            startS = roundToTenth(nn.v)
            endS = roundToTenth(startS + dur)
          } else {
            endS = roundToTenth(nn.v)
            startS = roundToTenth(endS - dur)
          }
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another lower third).')
            return
          }
        }
      } else if (action === 'expand_start') {
        const cand = prevStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline before start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to expand start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'contract_start') {
        const cand = nextStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline after start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to contract start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'expand_end') {
        const cand = nextStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline after end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to expand end to that guideline.')
          return
        }
        endS = nextEndS
      } else if (action === 'contract_end') {
        const cand = prevStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline before end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to contract end to that guideline.')
          return
        }
        endS = nextEndS
      }

      startS = roundToTenth(startS)
      endS = roundToTenth(endS)
      if (!(endS > startS + minLen - 1e-6)) {
        setTimelineMessage('Resulting duration is too small.')
        return
      }

      snapshotUndo()
      const nextSegs = prevSegs.slice()
      nextSegs[idx] = { ...seg0, startSeconds: startS, endSeconds: endS }
      nextSegs.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), lowerThirds: nextSegs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, totalSeconds]
  )

  const deleteScreenTitleById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSts: any[] = Array.isArray((timeline as any).screenTitles) ? ((timeline as any).screenTitles as any[]) : []
      if (!prevSts.some((st: any) => String(st?.id) === targetId)) return
      snapshotUndo()
      const nextSts = prevSts.filter((st: any) => String(st?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), screenTitles: nextSts }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (selectedScreenTitleId === targetId) setSelectedScreenTitleId(null)
    },
    [playhead, saveTimelineNow, selectedScreenTitleId, snapshotUndo, timeline]
  )

  const duplicateScreenTitleById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSts: any[] = Array.isArray((timeline as any).screenTitles) ? ((timeline as any).screenTitles as any[]) : []
      const st0 = prevSts.find((st: any) => String(st?.id) === targetId) as any
      if (!st0) return
      const start0 = roundToTenth(Number(st0.startSeconds || 0))
      const end0 = roundToTenth(Number(st0.endSeconds || 0))
      const dur = roundToTenth(Math.max(0.2, end0 - start0))
      const capEnd = Math.max(0, Number(totalSeconds) || 0)
      if (dur <= 0 || capEnd <= 0) return

      const sorted = prevSts
        .filter((st: any) => String(st?.id) !== targetId)
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))

      let start = roundToTenth(Math.max(0, end0))
      let end = roundToTenth(start + dur)
      if (end > capEnd + 1e-6) {
        setTimelineMessage('Not enough room to duplicate that screen title within the video duration.')
        return
      }

      for (let guard = 0; guard < 200; guard++) {
        let hit: any = null
        for (const st of sorted) {
          const s = Number((st as any).startSeconds)
          const e2 = Number((st as any).endSeconds)
          if (!(Number.isFinite(s) && Number.isFinite(e2) && e2 > s)) continue
          if (start < e2 - 1e-6 && end > s + 1e-6) {
            hit = st
            break
          }
        }
        if (!hit) break
        start = roundToTenth(Number((hit as any).endSeconds || start))
        end = roundToTenth(start + dur)
        if (end > capEnd + 1e-6) {
          setTimelineMessage('No available slot to duplicate without overlapping.')
          return
        }
      }

      const newId = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const nextSts = prevSts.slice()
      nextSts.push({
        ...st0,
        id: newId,
        startSeconds: start,
        endSeconds: end,
      })
      nextSts.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), screenTitles: nextSts }
      snapshotUndo()
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedScreenTitleId(String(newId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [
      playhead,
      saveTimelineNow,
      snapshotUndo,
      timeline,
      totalSeconds,
      setSelectedClipId,
      setSelectedGraphicId,
      setSelectedLogoId,
      setSelectedLowerThirdId,
      setSelectedNarrationId,
      setSelectedStillId,
      setSelectedAudioId,
    ]
  )

  const splitScreenTitleById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitScreenTitleAtPlayhead(timeline as any, targetId)
      const prevSts = Array.isArray((timeline as any).screenTitles) ? (timeline as any).screenTitles : []
      const nextSts = Array.isArray((res.timeline as any).screenTitles) ? (res.timeline as any).screenTitles : []
      if (res.timeline === (timeline as any) && String(res.selectedScreenTitleId) === targetId) return
      if (nextSts === prevSts) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedScreenTitleId(String(res.selectedScreenTitleId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyScreenTitleGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: { edgeIntent?: 'move' | 'start' | 'end' }
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).screenTitles) ? ((timeline as any).screenTitles as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray((timeline as any).guidelines) ? ((timeline as any).guidelines as any[]) : []
      const gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        setTimelineMessage('No guidelines yet. Tap G to add one.')
        return
      }

      const seg0 = prevSegs[idx] as any
      const start0 = roundToTenth(Number(seg0.startSeconds || 0))
      const end0 = roundToTenth(Number(seg0.endSeconds || 0))
      const minLen = 0.2
      const dur = roundToTenth(Math.max(minLen, end0 - start0))
      const capEnd = Math.max(0, Number(totalSeconds) || 0)

      const sorted = prevSegs.slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const pos = sorted.findIndex((s: any) => String(s?.id) === targetId)
      const prevEnd = pos > 0 ? roundToTenth(Number((sorted[pos - 1] as any).endSeconds || 0)) : 0
      const nextStart =
        pos >= 0 && pos < sorted.length - 1 ? roundToTenth(Number((sorted[pos + 1] as any).startSeconds || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const eps = 0.05
      const prevStrict = (t: number) => {
        const tt = Number(t)
        for (let i = gsSorted.length - 1; i >= 0; i--) {
          const v = gsSorted[i]
          if (v < tt - eps) return v
        }
        return null
      }
      const nextStrict = (t: number) => {
        const tt = Number(t)
        for (let i = 0; i < gsSorted.length; i++) {
          const v = gsSorted[i]
          if (v > tt + eps) return v
        }
        return null
      }
      const nearestInclusive = (t: number) => {
        let best: number | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const v of gsSorted) {
          const d = Math.abs(v - t)
          if (d < bestDist - 1e-9) {
            bestDist = d
            best = v
          }
        }
        return best == null ? null : { v: best, dist: bestDist }
      }

      let startS = start0
      let endS = end0

      if (action === 'snap') {
        const edgeIntent = opts?.edgeIntent || 'move'
        if (edgeIntent === 'start') {
          const cand = prevStrict(start0)
          if (cand == null) {
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another screen title).')
            return
          }
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another screen title).')
            return
          }
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (snapEdge === 'start') {
            startS = roundToTenth(nn.v)
            endS = roundToTenth(startS + dur)
          } else {
            endS = roundToTenth(nn.v)
            startS = roundToTenth(endS - dur)
          }
          if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
            setTimelineMessage('Cannot snap (would overlap another screen title).')
            return
          }
        }
      } else if (action === 'expand_start') {
        const cand = prevStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline before start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to expand start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'contract_start') {
        const cand = nextStrict(start0)
        if (cand == null) {
          setTimelineMessage('No guideline after start.')
          return
        }
        const nextStartS = roundToTenth(cand)
        if (nextStartS < minStartSeconds - 1e-6 || nextStartS > end0 - minLen + 1e-6) {
          setTimelineMessage('No room to contract start to that guideline.')
          return
        }
        startS = nextStartS
      } else if (action === 'expand_end') {
        const cand = nextStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline after end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to expand end to that guideline.')
          return
        }
        endS = nextEndS
      } else if (action === 'contract_end') {
        const cand = prevStrict(end0)
        if (cand == null) {
          setTimelineMessage('No guideline before end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to contract end to that guideline.')
          return
        }
        endS = nextEndS
      }

      startS = roundToTenth(startS)
      endS = roundToTenth(endS)
      if (!(endS > startS + minLen - 1e-6)) {
        setTimelineMessage('Resulting duration is too small.')
        return
      }

      snapshotUndo()
      const nextSegs = prevSegs.slice()
      nextSegs[idx] = { ...seg0, startSeconds: startS, endSeconds: endS }
      nextSegs.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), screenTitles: nextSegs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, totalSeconds]
  )

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

      const prevAudioSegs: any[] = Array.isArray((tl as any).audioSegments) ? (tl as any).audioSegments : []
      const nextAudioSegments: any[] = prevAudioSegs.map((seg: any) => {
        const a = roundToTenth(Number(seg?.startSeconds || 0))
        const b = roundToTenth(Number(seg?.endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(seg as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
        if (b > at + 1e-6) return { ...(seg as any), endSeconds: roundToTenth(b + delta) }
        return seg
      })

      const nextPlayhead = roundToTenth(Number(tl.playheadSeconds || 0) + (Number(tl.playheadSeconds || 0) + 1e-6 >= at ? delta : 0))

      const out: any = {
        ...tl,
        clips: nextClips.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        stills: nextStills.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        graphics: nextGraphics.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        audioSegments: nextAudioSegments
          .slice()
          .sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        audioTrack: null,
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
        setSelectedAudioId(null)
        setClipEditor(null)
      } catch (e: any) {
        const msg = String(e?.message || 'failed')
        if (msg === 'freeze_timeout') setFreezeInsertError('Timed out while generating freeze frame. Try again.')
        else if (msg === 'freeze_failed') setFreezeInsertError('Freeze frame generation failed.')
        else if (msg === 'pick_duration') setFreezeInsertError('Freeze duration is invalid.')
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

  const saveStillEditor = useCallback(() => {
    if (!stillEditor) return
    const start = roundToTenth(Number(stillEditor.start))
    const end = roundToTenth(Number(stillEditor.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setStillEditorError('End must be after start.')
      return
    }

    const cap = 20 * 60
    if (end > cap + 1e-6) {
      setStillEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
    }

    // Disallow overlaps with clips and other stills.
    for (let i = 0; i < timeline.clips.length; i++) {
      const cs = roundToTenth(Number(clipStarts[i] || 0))
      const ce = roundToTenth(cs + clipDurationSeconds(timeline.clips[i]))
      if (!(ce > cs)) continue
      const overlaps = start < ce - 1e-6 && end > cs + 1e-6
      if (overlaps) {
        setStillEditorError('Freeze frames cannot overlap video clips.')
        return
      }
    }
    for (const s of stills) {
      if (String((s as any).id) === String(stillEditor.id)) continue
      const ss = roundToTenth(Number((s as any).startSeconds || 0))
      const se = roundToTenth(Number((s as any).endSeconds || 0))
      if (!(se > ss)) continue
      const overlaps = start < se - 1e-6 && end > ss + 1e-6
      if (overlaps) {
        setStillEditorError('Freeze frames cannot overlap each other.')
        return
      }
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevStills: Still[] = Array.isArray((prev as any).stills) ? ((prev as any).stills as any) : []
      const idx = prevStills.findIndex((s: any) => String((s as any).id) === String(stillEditor.id))
      if (idx < 0) return prev
      const updated: Still = { ...(prevStills[idx] as any), startSeconds: Math.max(0, start), endSeconds: Math.max(0, end) }
      const nextStills = prevStills.slice()
      nextStills[idx] = updated
      nextStills.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), stills: nextStills } as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...(prev as any), stills: nextStills, playheadSeconds: nextPlayhead } as any
    })
    setStillEditor(null)
    setStillEditorError(null)
  }, [clipStarts, computeTotalSecondsForTimeline, stillEditor, stills, snapshotUndo, timeline.clips])

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

  const saveScreenTitleEditor = useCallback(() => {
    if (!screenTitleEditor) return
    const start = roundToTenth(Number(screenTitleEditor.start))
    const end = roundToTenth(Number(screenTitleEditor.end))
    const presetIdRaw = screenTitleEditor.presetId
    const presetId = presetIdRaw == null ? null : Number(presetIdRaw)
    const text = String(screenTitleEditor.text || '').replace(/\r\n/g, '\n')

    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setScreenTitleEditorError('End must be after start.')
      return
    }
    if (presetId == null || !Number.isFinite(presetId) || presetId <= 0) {
      setScreenTitleEditorError('Pick a screen title style.')
      return
    }
    if (text.length > 1000) {
      setScreenTitleEditorError('Max 1000 characters.')
      return
    }
    if (text.split('\n').length > 30) {
      setScreenTitleEditorError('Max 30 lines.')
      return
    }

    const cap = 20 * 60
    if (end > cap + 1e-6) {
      setScreenTitleEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
    }

    const preset = screenTitlePresets.find((p: any) => Number((p as any).id) === presetId) as any
    if (!preset) {
      setScreenTitleEditorError('Screen title style not found.')
      return
    }

      const snapshot: any = {
      id: presetId,
      name: String((preset as any).name || `Preset ${presetId}`),
      style: (String((preset as any).style || 'none').toLowerCase() === 'pill'
        ? 'pill'
        : String((preset as any).style || 'none').toLowerCase() === 'strip'
          ? 'strip'
          : 'none') as any,
      fontKey: String((preset as any).fontKey || 'dejavu_sans_bold'),
      fontSizePct: Number((preset as any).fontSizePct),
      trackingPct: Number((preset as any).trackingPct),
      fontColor: String((preset as any).fontColor || '#ffffff'),
      fontGradientKey: (preset as any).fontGradientKey == null ? null : String((preset as any).fontGradientKey),
      outlineWidthPct: (preset as any).outlineWidthPct == null ? null : Number((preset as any).outlineWidthPct),
      outlineOpacityPct: (preset as any).outlineOpacityPct == null ? null : Number((preset as any).outlineOpacityPct),
      outlineColor: (preset as any).outlineColor == null ? null : String((preset as any).outlineColor),
      pillBgColor: String((preset as any).pillBgColor || '#000000'),
      pillBgOpacityPct: Number((preset as any).pillBgOpacityPct),
      position: (String((preset as any).position || 'top').toLowerCase() === 'bottom'
        ? 'bottom'
        : String((preset as any).position || 'top').toLowerCase() === 'middle'
          ? 'middle'
          : 'top') as any,
      maxWidthPct: Number((preset as any).maxWidthPct),
      insetXPreset: (preset as any).insetXPreset == null ? null : String((preset as any).insetXPreset),
      insetYPreset: (preset as any).insetYPreset == null ? null : String((preset as any).insetYPreset),
      fade: (String((preset as any).fade || 'none').toLowerCase() === 'in_out'
        ? 'in_out'
        : String((preset as any).fade || 'none').toLowerCase() === 'in'
          ? 'in'
          : String((preset as any).fade || 'none').toLowerCase() === 'out'
            ? 'out'
            : 'none') as any,
    }

    // Disallow overlaps with other screen-title segments.
    for (const st of screenTitles) {
      if (String((st as any).id) === String(screenTitleEditor.id)) continue
      const ls = Number((st as any).startSeconds || 0)
      const le = Number((st as any).endSeconds || 0)
      if (!(Number.isFinite(ls) && Number.isFinite(le) && le > ls)) continue
      const overlaps = start < le - 1e-6 && end > ls + 1e-6
      if (overlaps) {
        setScreenTitleEditorError('Screen titles cannot overlap in time.')
        return
      }
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevSts: ScreenTitle[] = Array.isArray((prev as any).screenTitles) ? ((prev as any).screenTitles as any) : []
      const idx = prevSts.findIndex((st) => String((st as any).id) === String(screenTitleEditor.id))
      if (idx < 0) return prev
      const prevSeg: any = prevSts[idx] as any
      const invalidateRender =
        Number(prevSeg?.presetId) !== presetId ||
        String(prevSeg?.text || '') !== text
      const updated: any = {
        ...prevSeg,
        startSeconds: Math.max(0, start),
        endSeconds: Math.max(0, end),
        presetId,
        presetSnapshot: snapshot,
        text,
        renderUploadId: invalidateRender ? null : (prevSeg?.renderUploadId ?? null),
      }
      const nextSts = prevSts.slice()
      nextSts[idx] = updated
      nextSts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), screenTitles: nextSts } as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...prev, screenTitles: nextSts, playheadSeconds: nextPlayhead }
    })
    setScreenTitleEditor(null)
    setScreenTitleEditorError(null)
  }, [computeTotalSecondsForTimeline, screenTitleEditor, screenTitlePresets, screenTitles, snapshotUndo])

  const generateScreenTitle = useCallback(async () => {
    if (!screenTitleEditor) return
    const presetIdRaw = screenTitleEditor.presetId
    const presetId = presetIdRaw == null ? null : Number(presetIdRaw)
    const text = String(screenTitleEditor.text || '').replace(/\r\n/g, '\n').trim()
    if (!presetId || !Number.isFinite(presetId) || presetId <= 0) {
      setScreenTitleEditorError('Pick a screen title style.')
      return
    }
    if (!text) {
      setScreenTitleEditorError('Enter text.')
      return
    }
    if (text.length > 1000) {
      setScreenTitleEditorError('Max 1000 characters.')
      return
    }
    if (text.split('\n').length > 30) {
      setScreenTitleEditorError('Max 30 lines.')
      return
    }

    setScreenTitleRenderBusy(true)
    setScreenTitleEditorError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/screen-titles/render`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ presetId, text, frameW: outputFrame.width, frameH: outputFrame.height }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || json?.message || 'internal_error'))
      const uploadId = Number(json?.uploadId || 0)
      if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('bad_upload_id')

      // Persist preset/text (and clear renderUploadId if needed), then set the new render upload id.
      snapshotUndo()
      setTimeline((prev) => {
        const prevSts: ScreenTitle[] = Array.isArray((prev as any).screenTitles) ? ((prev as any).screenTitles as any) : []
        const idx = prevSts.findIndex((st) => String((st as any).id) === String(screenTitleEditor.id))
        if (idx < 0) return prev
        const prevSeg: any = prevSts[idx] as any
        const preset = screenTitlePresets.find((p: any) => Number((p as any).id) === presetId) as any
        const snapshot: any = preset
          ? {
              id: presetId,
              name: String((preset as any).name || `Preset ${presetId}`),
              style: (String((preset as any).style || 'none').toLowerCase() === 'pill'
                ? 'pill'
                : String((preset as any).style || 'none').toLowerCase() === 'strip'
                  ? 'strip'
                  : 'none') as any,
              fontKey: String((preset as any).fontKey || 'dejavu_sans_bold'),
              fontSizePct: Number((preset as any).fontSizePct),
              trackingPct: Number((preset as any).trackingPct),
              fontColor: String((preset as any).fontColor || '#ffffff'),
              fontGradientKey: (preset as any).fontGradientKey == null ? null : String((preset as any).fontGradientKey),
              outlineWidthPct: (preset as any).outlineWidthPct == null ? null : Number((preset as any).outlineWidthPct),
              outlineOpacityPct: (preset as any).outlineOpacityPct == null ? null : Number((preset as any).outlineOpacityPct),
              outlineColor: (preset as any).outlineColor == null ? null : String((preset as any).outlineColor),
              pillBgColor: String((preset as any).pillBgColor || '#000000'),
              pillBgOpacityPct: Number((preset as any).pillBgOpacityPct),
              position: (String((preset as any).position || 'top').toLowerCase() === 'bottom'
                ? 'bottom'
                : String((preset as any).position || 'top').toLowerCase() === 'middle'
                  ? 'middle'
                  : 'top') as any,
              maxWidthPct: Number((preset as any).maxWidthPct),
              insetXPreset: (preset as any).insetXPreset == null ? null : String((preset as any).insetXPreset),
              insetYPreset: (preset as any).insetYPreset == null ? null : String((preset as any).insetYPreset),
              fade: (String((preset as any).fade || 'none').toLowerCase() === 'in_out'
                ? 'in_out'
                : String((preset as any).fade || 'none').toLowerCase() === 'in'
                  ? 'in'
                  : String((preset as any).fade || 'none').toLowerCase() === 'out'
                    ? 'out'
                    : 'none') as any,
            }
          : (prevSeg?.presetSnapshot ?? null)

        const updated: any = {
          ...prevSeg,
          presetId,
          presetSnapshot: snapshot,
          text,
          renderUploadId: uploadId,
        }
        const nextSts = prevSts.slice()
        nextSts[idx] = updated
        nextSts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
        return { ...prev, screenTitles: nextSts }
      })

      try {
        const url = await getUploadCdnUrl(uploadId, { kind: 'file' })
        if (url) {
          setGraphicFileUrlByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: url }))
        }
      } catch {}

      setScreenTitleEditor(null)
      setScreenTitleEditorError(null)
    } catch (e: any) {
      setScreenTitleEditorError(e?.message || 'internal_error')
    } finally {
      setScreenTitleRenderBusy(false)
    }
  }, [getUploadCdnUrl, outputFrame.height, outputFrame.width, screenTitleEditor, screenTitlePresets, snapshotUndo])

  const openAdd = useCallback(() => {
    setPickOpen(true)
    setAddStep('type')
    setPickerError(null)
    setGraphicPickerError(null)
    setLogoPickerError(null)
    setLowerThirdPickerError(null)
    setAudioPickerError(null)
    setNarrationAddError(null)
    setAudioConfigsError(null)
    setLogoConfigsError(null)
    setLowerThirdConfigsError(null)
    setPendingLogoUploadId(null)
    setPendingLowerThirdUploadId(null)
  }, [])

  const closeAdd = useCallback(() => {
    setPickOpen(false)
    setAddStep('type')
    setNarrationAddError(null)
    setPendingLogoUploadId(null)
    setPendingLowerThirdUploadId(null)
  }, [])

  // Global listeners (always attached) so quick drags can't miss the pointerup and leave the timeline "locked".
  useEffect(() => {
	    const onMove = (e: PointerEvent) => {
	      const drag = trimDragRef.current
	      if (!drag) return
	      if (e.pointerId !== drag.pointerId) return

		      // Special case: "armed" drags. Don't start mutating the timeline until the pointer has moved a bit,
		      // otherwise a simple tap on the selected pill can open a context menu / modal.
			      if ((drag.kind === 'logo' || drag.kind === 'lowerThird' || drag.kind === 'screenTitle' || drag.kind === 'clip' || drag.kind === 'narration' || drag.kind === 'audioSegment' || drag.kind === 'still') && (drag as any).armed) {
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
			          dbg('startTrimDrag', {
			            kind: drag.kind,
			            edge: String((drag as any).edge || 'move'),
			            id: String(
			              (drag as any).logoId ||
			                (drag as any).lowerThirdId ||
			                (drag as any).screenTitleId ||
			                (drag as any).clipId ||
			                (drag as any).narrationId ||
			                (drag as any).stillId ||
			                (drag as any).audioSegmentId ||
			                ''
			            ),
			          })
			        }
			      }

		      if (drag.kind === 'graphic' && (drag as any).armed) {
		        const dx0 = e.clientX - drag.startClientX
		        const moved = Boolean((drag as any).moved)
		        if (!moved) {
		          const thresholdPx = 6
		          if (Math.abs(dx0) < thresholdPx) return
		          ;(drag as any).moved = true
		          ;(drag as any).armed = false
		          trimDragLockScrollLeftRef.current = timelineScrollRef.current ? timelineScrollRef.current.scrollLeft : null
		          try { snapshotUndoRef.current?.() } catch {}
		          setTrimDragging(true)
		          dbg('startTrimDrag', { kind: 'graphic', edge: drag.edge, id: String((drag as any).graphicId || '') })
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
	            let desiredStart = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), minStartSeconds, maxStartSeconds)

	            // Always enforce: clips may never overlap freeze-frame stills or other clips on the base track.
	            // Compute available gaps and clamp the desired start into the best-fitting gap.
	            const occupied: Array<{ start: number; end: number }> = []
	            for (let i = 0; i < next.length; i++) {
	              if (i === idx) continue
	              const s = roundToTenth(Number((next[i] as any).startSeconds || 0))
	              const e = roundToTenth(s + clipDurationSeconds(next[i]))
	              if (e > s) occupied.push({ start: s, end: e })
	            }
	            for (const st of prevStills) {
	              const s = roundToTenth(Number((st as any).startSeconds || 0))
	              const e = roundToTenth(Number((st as any).endSeconds || 0))
	              if (e > s) occupied.push({ start: s, end: e })
	            }
	            occupied.sort((a, b) => a.start - b.start || a.end - b.end)
	            const merged: Array<{ start: number; end: number }> = []
	            for (const r of occupied) {
	              const s = clamp(roundToTenth(r.start), minStartSeconds, maxEndSeconds)
	              const e = clamp(roundToTenth(r.end), minStartSeconds, maxEndSeconds)
	              if (!(e > s)) continue
	              const last = merged.length ? merged[merged.length - 1] : null
	              if (!last) merged.push({ start: s, end: e })
	              else if (s <= last.end + 1e-6) last.end = Math.max(last.end, e)
	              else merged.push({ start: s, end: e })
	            }
	            const gaps: Array<{ start: number; end: number }> = []
	            let cursor = minStartSeconds
	            for (const r of merged) {
	              if (r.start > cursor + 1e-6) gaps.push({ start: cursor, end: r.start })
	              cursor = Math.max(cursor, r.end)
	            }
	            if (maxEndSeconds > cursor + 1e-6) gaps.push({ start: cursor, end: maxEndSeconds })

	            const validStartIntervals = gaps
	              .map((g) => ({
	                start: roundToTenth(g.start),
	                end: roundToTenth(g.end),
	                startMax: roundToTenth(g.end - dur),
	              }))
	              .filter((g) => g.startMax >= g.start - 1e-6)

	            const movingRight = deltaSeconds >= 0
	            let startTimeline = desiredStart
		            if (validStartIntervals.length > 0) {
		              // Find a gap that can hold the clip and contains the desired start.
		              const inGap = validStartIntervals.find((g) => desiredStart >= g.start - 1e-6 && desiredStart <= g.startMax + 1e-6)
		              if (inGap) {
		                startTimeline = clamp(desiredStart, inGap.start, inGap.startMax)
		              } else {
		                // If desiredStart is inside an occupied range (or outside all gaps), block on collision:
		                // clamp to the nearest boundary rather than jumping to a different gap.
		                const desiredEnd = roundToTenth(desiredStart + dur)
		                const hit = merged.find((r) => desiredStart < r.end - 1e-6 && desiredEnd > r.start + 1e-6) || null
		                if (hit) {
		                  // Moving right: stop with our end aligned to hit.start (if there's a gap that can fit).
		                  // Moving left: stop with our start aligned to hit.end (if there's a gap that can fit).
		                  if (movingRight) {
		                    const before = validStartIntervals
		                      .filter((g) => g.startMax <= hit.start + 1e-6)
		                      .sort((a, b) => b.startMax - a.startMax)[0]
		                    if (before) startTimeline = clamp(before.startMax, minStartSeconds, maxStartSeconds)
		                    else startTimeline = clamp(roundToTenth(Number(drag.startStartSeconds || 0)), minStartSeconds, maxStartSeconds)
		                  } else {
		                    const after = validStartIntervals
		                      .filter((g) => g.start >= hit.end - 1e-6)
		                      .sort((a, b) => a.start - b.start)[0]
		                    if (after) startTimeline = clamp(after.start, minStartSeconds, maxStartSeconds)
		                    else startTimeline = clamp(roundToTenth(Number(drag.startStartSeconds || 0)), minStartSeconds, maxStartSeconds)
		                  }
		                } else {
		                  // No explicit overlap but desiredStart is outside any valid interval: clamp to nearest interval.
		                  const first = validStartIntervals[0]
		                  const last = validStartIntervals[validStartIntervals.length - 1]
		                  if (desiredStart < first.start - 1e-6) startTimeline = first.start
		                  else if (desiredStart > last.startMax + 1e-6) startTimeline = last.startMax
		                  else {
		                    // Between gaps: clamp to the closest boundary in the movement direction.
		                    if (movingRight) {
		                      const before = validStartIntervals
		                        .filter((g) => g.startMax <= desiredStart + 1e-6)
		                        .sort((a, b) => b.startMax - a.startMax)[0]
		                      startTimeline = before ? before.startMax : clamp(desiredStart, minStartSeconds, maxStartSeconds)
		                    } else {
		                      const after = validStartIntervals
		                        .filter((g) => g.start >= desiredStart - 1e-6)
		                        .sort((a, b) => a.start - b.start)[0]
		                      startTimeline = after ? after.start : clamp(desiredStart, minStartSeconds, maxStartSeconds)
		                    }
		                  }
		                }
		              }
		            } else {
		              // No gap can fit this clip duration; keep it at its original position.
		              startTimeline = roundToTenth(Number(drag.startStartSeconds || 0))
	            }
	            startTimeline = clamp(roundToTenth(startTimeline), minStartSeconds, maxStartSeconds)

	            next[idx] = { ...c, startSeconds: startTimeline }
	            next.sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
		          } else {
		            // Trimming clips edits the source-time window, and can also affect the timeline start when trimming the start edge.
		            // `startS/endS` are source-time seconds; `timelineStartS` is timeline-time seconds.
		            let timelineStartS = roundToTenth(Number((c as any).startSeconds || 0))
		            let startS = roundToTenth(Number(c.sourceStartSeconds || 0))
		            let endS = roundToTenth(Number(c.sourceEndSeconds || 0))

		            const maxTimelineDur = drag.maxTimelineDurationSeconds != null ? Number(drag.maxTimelineDurationSeconds) : Number.POSITIVE_INFINITY

		            if (drag.edge === 'start') {
		              // Behave like narration: moving the start edge shifts the clip on the timeline AND
		              // shifts the sourceStartSeconds by the same delta, keeping the timeline end fixed.
		              const startTimeline0 =
		                drag.startTimelineStartSeconds != null && Number.isFinite(Number(drag.startTimelineStartSeconds))
		                  ? roundToTenth(Number(drag.startTimelineStartSeconds))
		                  : timelineStartS
		              const endTimeline0 =
		                drag.startTimelineEndSeconds != null && Number.isFinite(Number(drag.startTimelineEndSeconds))
		                  ? roundToTenth(Number(drag.startTimelineEndSeconds))
		                  : roundToTenth(startTimeline0 + Math.max(minLen, roundToTenth(Number(drag.startEndSeconds || 0) - Number(drag.startStartSeconds || 0))))

		              const minStartByPrev =
		                drag.minStartSeconds != null && Number.isFinite(Number(drag.minStartSeconds)) ? Number(drag.minStartSeconds) : 0
		              const minStartBySource = roundToTenth(startTimeline0 - roundToTenth(Number(drag.startStartSeconds || 0)))
		              const minStartTimeline = Math.max(0, roundToTenth(Math.max(minStartByPrev, minStartBySource)))
		              const maxStartTimeline = roundToTenth(Math.max(minStartTimeline, endTimeline0 - minLen))

		              timelineStartS = clamp(roundToTenth(startTimeline0 + deltaSeconds), minStartTimeline, maxStartTimeline)
		              const deltaTimeline = roundToTenth(timelineStartS - startTimeline0)
		              startS = clamp(
		                roundToTenth(Number(drag.startStartSeconds || 0) + deltaTimeline),
		                0,
		                Math.max(0, roundToTenth(Number(drag.startEndSeconds || 0) - minLen))
		              )
		              // Keep the end fixed (sourceEnd stays anchored to drag.startEndSeconds).
		              endS = roundToTenth(Number(drag.startEndSeconds || endS))
		            } else {
		              // Trimming the end edge keeps the timeline start fixed and adjusts sourceEndSeconds.
		              startS = roundToTenth(Number(drag.startStartSeconds || startS))
		              endS = clamp(
		                roundToTenth(drag.startEndSeconds + deltaSeconds),
		                Math.max(0, Number(drag.startStartSeconds || startS) + minLen),
		                drag.maxDurationSeconds
		              )
		              if (Number.isFinite(maxTimelineDur) && maxTimelineDur > 0) {
		                const maxSourceDur = Math.max(minLen, roundToTenth(maxTimelineDur))
		                endS = Math.min(endS, roundToTenth(Number(drag.startStartSeconds || startS) + maxSourceDur))
		              }
		              endS = Math.max(endS, startS + minLen)
		            }

	            // Safety valve: trimming that extends duration must never overlap the next base-track segment
	            // (including freeze-frame stills). We already constrain at pointerdown-time, but this keeps
	            // behavior correct if nearby items change while dragging.
		            const clipStartTimeline = roundToTenth(timelineStartS)
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
		                    // Adjust timeline start to preserve the fixed end when the safety valve clamps duration.
		                    const endTimeline0 =
		                      drag.startTimelineEndSeconds != null && Number.isFinite(Number(drag.startTimelineEndSeconds))
		                        ? roundToTenth(Number(drag.startTimelineEndSeconds))
		                        : roundToTenth(
		                            (drag.startTimelineStartSeconds != null && Number.isFinite(Number(drag.startTimelineStartSeconds))
		                              ? Number(drag.startTimelineStartSeconds)
		                              : timelineStartS) +
		                              Math.max(minLen, roundToTenth(Number(drag.startEndSeconds || 0) - Number(drag.startStartSeconds || 0)))
		                          )
		                    const newDur = roundToTenth(Math.max(minLen, endS - startS))
		                    timelineStartS = roundToTenth(Math.max(0, endTimeline0 - newDur))
		                  } else {
		                    endS = roundToTenth(startS + maxDur)
		                    endS = Math.max(endS, startS + minLen)
		                  }
		                }
		              }
		            }

		            next[idx] = { ...c, startSeconds: roundToTenth(timelineStartS), sourceStartSeconds: startS, sourceEndSeconds: endS }
		            next.sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
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

        if (drag.kind === 'audioSegment') {
          const prevSegs: any[] = Array.isArray((prev as any).audioSegments) ? (prev as any).audioSegments : []
          const idx = prevSegs.findIndex((s: any) => String(s?.id) === String((drag as any).audioSegmentId))
          if (idx < 0) return prev
          const s0: any = prevSegs[idx]
          let startS = roundToTenth(Number(s0.startSeconds || 0))
          let endS = roundToTenth(Number(s0.endSeconds || 0))
          let sourceStartS =
            (s0 as any).sourceStartSeconds != null && Number.isFinite(Number((s0 as any).sourceStartSeconds))
              ? roundToTenth(Number((s0 as any).sourceStartSeconds))
              : 0

          const rawDur = Math.max(0.2, roundToTenth(Number(drag.startEndSeconds) - Number(drag.startStartSeconds)))
          const maxDurForFile =
            (drag as any).maxDurationSeconds != null && Number.isFinite(Number((drag as any).maxDurationSeconds))
              ? Number((drag as any).maxDurationSeconds)
              : Number.POSITIVE_INFINITY
          const baseSourceStart =
            (drag as any).startSourceStartSeconds != null && Number.isFinite(Number((drag as any).startSourceStartSeconds))
              ? roundToTenth(Number((drag as any).startSourceStartSeconds))
              : sourceStartS

          // Ensure duration doesn't exceed remaining source when file duration is known.
          const maxLenByAudio =
            Number.isFinite(maxDurForFile) && maxDurForFile > 0 ? roundToTenth(Math.max(0, maxDurForFile - baseSourceStart)) : null
          const dur = maxLenByAudio != null && Number.isFinite(maxLenByAudio) && maxLenByAudio > 0 ? Math.min(rawDur, maxLenByAudio) : rawDur

          if (drag.edge === 'start') {
            const minStartByAudio =
              (drag as any).startSourceStartSeconds != null && Number.isFinite(Number((drag as any).startSourceStartSeconds))
                ? roundToTenth(Number(drag.startStartSeconds) - Number((drag as any).startSourceStartSeconds))
                : drag.minStartSeconds
            const nextStart = clamp(
              roundToTenth(drag.startStartSeconds + deltaSeconds),
              Math.max(drag.minStartSeconds, minStartByAudio),
              Math.max(drag.minStartSeconds, drag.startEndSeconds - minLen)
            )
            const delta = roundToTenth(nextStart - Number(drag.startStartSeconds))
            sourceStartS = roundToTenth(Math.max(0, baseSourceStart + delta))
            startS = nextStart
            endS = roundToTenth(Number(drag.startEndSeconds))
          } else if (drag.edge === 'end') {
            const maxEndByAudio =
              Number.isFinite(maxDurForFile) && maxDurForFile > 0
                ? Math.min(
                    drag.maxEndSeconds,
                    roundToTenth(Number(drag.startStartSeconds) + Math.max(0.2, maxLenByAudio != null ? maxLenByAudio : maxDurForFile))
                  )
                : drag.maxEndSeconds
            endS = clamp(
              roundToTenth(drag.startEndSeconds + deltaSeconds),
              Math.max(drag.startStartSeconds + minLen, drag.minStartSeconds + minLen),
              maxEndByAudio
            )
            startS = roundToTenth(Number(drag.startStartSeconds))
            sourceStartS = baseSourceStart
          } else {
            const maxStart =
              drag.maxStartSeconds != null ? Number(drag.maxStartSeconds) : Math.max(drag.minStartSeconds, drag.maxEndSeconds - dur)
            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
            endS = roundToTenth(startS + dur)
            sourceStartS = baseSourceStart
          }

          if (!(endS > startS)) endS = roundToTenth(startS + minLen)
          const nextSegs = prevSegs.slice()
          nextSegs[idx] = { ...(s0 as any), startSeconds: startS, endSeconds: endS, sourceStartSeconds: sourceStartS }
          nextSegs.sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
          return { ...(prev as any), audioSegments: nextSegs, audioTrack: null } as any
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

	        if (drag.kind === 'screenTitle') {
	          const prevSts: any[] = Array.isArray((prev as any).screenTitles) ? (prev as any).screenTitles : []
	          const idx = prevSts.findIndex((st: any) => String(st?.id) === String((drag as any).screenTitleId))
	          if (idx < 0) return prev
	          const st0 = prevSts[idx] as any
          const nextSts = prevSts.slice()
          let startS = Number(st0.startSeconds || 0)
          let endS = Number(st0.endSeconds || 0)
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
          nextSts[idx] = { ...st0, startSeconds: startS, endSeconds: endS }
          nextSts.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
          const nextTimeline: any = { ...(prev as any), screenTitles: nextSts }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
	          return { ...(nextTimeline as any), playheadSeconds: nextPlayhead }
	        }

		        if (drag.kind === 'narration') {
		          const prevNs: any[] = Array.isArray((prev as any).narration) ? (prev as any).narration : []
		          const idx = prevNs.findIndex((n: any) => String(n?.id) === String((drag as any).narrationId))
		          if (idx < 0) return prev
		          const n0 = prevNs[idx] as any
		          const nextNs = prevNs.slice()
		          let startS = Number(n0.startSeconds || 0)
		          let endS = Number(n0.endSeconds || 0)
		          let sourceStartS =
		            n0.sourceStartSeconds != null && Number.isFinite(Number(n0.sourceStartSeconds)) ? Number(n0.sourceStartSeconds) : 0
		          const rawDur = Math.max(0.2, roundToTenth(Number(drag.startEndSeconds) - Number(drag.startStartSeconds)))
		          const maxDurForFile =
		            drag.maxDurationSeconds != null && Number.isFinite(Number(drag.maxDurationSeconds)) ? Number(drag.maxDurationSeconds) : Number.POSITIVE_INFINITY
		          const dur = Number.isFinite(maxDurForFile) && maxDurForFile > 0 ? Math.min(rawDur, maxDurForFile) : rawDur
		          if (drag.edge === 'start') {
		            const minStartByAudio =
		              drag.startSourceStartSeconds != null && Number.isFinite(Number(drag.startSourceStartSeconds))
		                ? roundToTenth(Number(drag.startStartSeconds) - Number(drag.startSourceStartSeconds))
		                : drag.minStartSeconds
		            const nextStart = clamp(
		              roundToTenth(drag.startStartSeconds + deltaSeconds),
		              Math.max(drag.minStartSeconds, minStartByAudio),
		              Math.max(drag.minStartSeconds, drag.startEndSeconds - minLen)
		            )
		            const delta = roundToTenth(nextStart - Number(drag.startStartSeconds))
		            // Keep the audio "content" anchored: trimming start forward advances sourceStartSeconds,
		            // extending start backward reduces sourceStartSeconds (down to 0) when possible.
		            const baseSourceStart =
		              drag.startSourceStartSeconds != null && Number.isFinite(Number(drag.startSourceStartSeconds))
		                ? Number(drag.startSourceStartSeconds)
		                : sourceStartS
		            sourceStartS = roundToTenth(Math.max(0, baseSourceStart + delta))
		            startS = nextStart
		          } else if (drag.edge === 'end') {
		            const maxEndByAudio =
		              Number.isFinite(maxDurForFile) && maxDurForFile > 0
		                ? Math.min(drag.maxEndSeconds, roundToTenth(Number(drag.startStartSeconds) + maxDurForFile))
		                : drag.maxEndSeconds
		            endS = clamp(
		              roundToTenth(drag.startEndSeconds + deltaSeconds),
		              Math.max(drag.startStartSeconds + minLen, drag.minStartSeconds + minLen),
		              maxEndByAudio
		            )
		          } else {
		            const maxStart =
		              drag.maxStartSeconds != null ? Number(drag.maxStartSeconds) : Math.max(drag.minStartSeconds, drag.maxEndSeconds - dur)
		            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
		            endS = roundToTenth(startS + dur)
		          }
	          nextNs[idx] = { ...n0, startSeconds: startS, endSeconds: endS, sourceStartSeconds: sourceStartS }
	          nextNs.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
	          const nextTimeline: any = { ...(prev as any), narration: nextNs }
	          const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
	          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
	          return { ...(nextTimeline as any), playheadSeconds: nextPlayhead }
	        }

	        if (drag.kind !== 'graphic') return prev

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
    const onUp = (e: PointerEvent) => {
      const drag = trimDragRef.current
      if (!trimDragging && !drag) return
      if (drag && e.pointerId !== drag.pointerId) return

      // For graphics: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'graphic' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any =
            drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'graphic',
            id: String((drag as any).graphicId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('graphic_ctx_menu')
        return
      }

      // For logos: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'logo' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'logo',
            id: String((drag as any).logoId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('logo_ctx_menu')
        return
      }

      // For lower thirds: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'lowerThird' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'lowerThird',
            id: String((drag as any).lowerThirdId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('lowerThird_ctx_menu')
        return
      }

      // For screen titles: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'screenTitle' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'screenTitle',
            id: String((drag as any).screenTitleId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('screenTitle_ctx_menu')
        return
      }

      // For clips: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'clip' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'clip',
            id: String((drag as any).clipId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('clip_ctx_menu')
        return
      }

      // For narration: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'narration' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'narration',
            id: String((drag as any).narrationId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('narration_ctx_menu')
        return
      }

      // For audio: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'audioSegment' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'audioSegment',
            id: String((drag as any).audioSegmentId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('audio_ctx_menu')
        return
      }

      // For freeze stills: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'still' && (drag as any).armed && !Boolean((drag as any).moved)) {
        try {
          const w = window.innerWidth || 0
          const h = window.innerHeight || 0
          const menuW = 170
          const menuH = 188
          const pad = 10
          const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
          const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          timelineCtxMenuOpenedAtRef.current = performance.now()
          setTimelineCtxMenu({
            kind: 'still',
            id: String((drag as any).stillId),
            x,
            y,
            view: 'main',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('still_ctx_menu')
        return
      }

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
    redoStackRef.current = []
    setUndoDepth(0)
    setRedoDepth(0)
    try {
      localStorage.removeItem(`createVideoHistory:v1:${Number(project?.id)}`)
    } catch {}
    window.location.reload()
  }, [project?.id])

  const cancelTimelineLongPress = useCallback((reason: string) => {
    const lp = timelineLongPressRef.current
    if (!lp) return
    try { window.clearTimeout(lp.timer) } catch {}
    timelineLongPressRef.current = null
    dbg('cancelLongPress', { reason })
  }, [dbg])

  useEffect(() => {
    const lp = timelineLongPressRef.current
    if (!lp) return
    const onMove = (e: PointerEvent) => {
      const cur = timelineLongPressRef.current
      if (!cur) return
      if (e.pointerId !== cur.pointerId) return
      if (trimDragging || panDragging) {
        cancelTimelineLongPress('dragging')
        return
      }
      const dx = e.clientX - cur.startX
      const dy = e.clientY - cur.startY
      if (dx * dx + dy * dy > 9 * 9) cancelTimelineLongPress('moved')
    }
    const onUp = (e: PointerEvent) => {
      const cur = timelineLongPressRef.current
      if (!cur) return
      if (e.pointerId !== cur.pointerId) return
      cancelTimelineLongPress('pointerup')
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', () => cancelTimelineLongPress('blur'))
    return () => {
      window.removeEventListener('pointermove', onMove as any)
      window.removeEventListener('pointerup', onUp as any)
      window.removeEventListener('pointercancel', onUp as any)
    }
  }, [cancelTimelineLongPress, panDragging, trimDragging])

  const openTimelineCtxMenu = useCallback((target: { kind: 'graphic' | 'logo'; id: string }, clientX: number, clientY: number) => {
    const w = window.innerWidth || 0
    const h = window.innerHeight || 0
    const menuW = 170
    const menuH = 188
    const pad = 10
    // Always center the menu; mobile long-press is imprecise and we want a predictable location.
    const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
    const y = clamp(Math.round((h - menuH) / 2), pad, Math.max(pad, h - menuH - pad))
    timelineCtxMenuOpenedAtRef.current = performance.now()
    setTimelineCtxMenu({ kind: target.kind, id: target.id, x, y, view: 'main', edgeIntent: 'move' })
  }, [])

  const beginGraphicLongPress = useCallback(
    (e: React.PointerEvent, graphicId: string) => {
      cancelTimelineLongPress('restart')
      if (!graphicId) return
      if (trimDragging || panDragging) return
      if ((e as any).button != null && (e as any).button !== 0) return
      const pointerId = e.pointerId
      const startX = e.clientX
      const startY = e.clientY
      const x = e.clientX
      const y = e.clientY
      const timer = window.setTimeout(() => {
        const cur = timelineLongPressRef.current
        if (!cur) return
        if (cur.pointerId !== pointerId) return
        timelineLongPressRef.current = null
        suppressNextTimelineClickRef.current = true
        window.setTimeout(() => {
          suppressNextTimelineClickRef.current = false
        }, 0)
        setSelectedGraphicId(graphicId)
        setSelectedClipId(null)
        setSelectedLogoId(null)
        setSelectedLowerThirdId(null)
        setSelectedScreenTitleId(null)
        setSelectedNarrationId(null)
        setSelectedStillId(null)
        setSelectedAudioId(null)
        openTimelineCtxMenu({ kind: 'graphic', id: graphicId }, x, y)
      }, 900)
      timelineLongPressRef.current = { timer, pointerId, startX, startY, kind: 'graphic', id: graphicId, x, y }
    },
    [cancelTimelineLongPress, openTimelineCtxMenu, panDragging, trimDragging]
  )

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
              {activeScreenTitlePreview ? (
                <img
                  src={activeScreenTitlePreview.url}
                  alt=""
                  style={activeScreenTitlePreview.style}
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
	                  {'trimOffsets' in dragHud ? (
	                    (() => {
	                      const edge = (dragHud as any).edge as any
	                      const gold = '#d4af37'
	                      const startStyle = edge === 'start' ? { color: gold } : undefined
	                      const endStyle = edge === 'end' ? { color: gold } : undefined
	                      const trim = (dragHud as any).trimOffsets as any
	                      return (
	                        <>
	                          <span style={startStyle}>
	                            {trim.startWithOffsetSeconds.toFixed(1)}/{Number(trim.startNoOffsetSeconds || 0).toFixed(1)}
	                          </span>
	                          <span>|</span>
	                          <span>
	                            {trim.durationWithOffsetsSeconds.toFixed(1)}/{trim.durationNoOffsetsSeconds.toFixed(1)}
	                          </span>
	                          <span>|</span>
	                          <span style={endStyle}>
	                            {trim.endWithOffsetSeconds.toFixed(1)}/{trim.endNoOffsetSeconds.toFixed(1)}
	                          </span>
	                        </>
	                      )
	                    })()
	                  ) : dragHud.actionLabel === 'Move' ? (
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
                  const withinScreenTitle = y >= SCREEN_TITLE_Y && y <= SCREEN_TITLE_Y + PILL_H
                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
                  const withinNarration = y >= NARRATION_Y && y <= NARRATION_Y + PILL_H
                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
	                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
	                  const clickXInScroll = (e.clientX - rect.left) + sc.scrollLeft
	                  const x = clickXInScroll - padPx
	                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
	                  const EDGE_HIT_PX = Math.max(24, Math.min(72, Math.round(pxPerSecond * 0.6)))
	                  dbg('pointerdown', {
	                    pointerType: (e as any).pointerType,
	                    withinLogo,
	                    withinLowerThird,
                    withinScreenTitle,
                    withinGraphics,
                    withinVideo,
                    withinNarration,
                    withinAudio,
                    t,
                  })

	                  if (withinLogo) {
	                    cancelTimelineLongPress('new_pointerdown')
	                    const l = findLogoAtTime(t)
	                    if (!l) return
	                    const s = Number((l as any).startSeconds || 0)
	                    const e2 = Number((l as any).endSeconds || 0)
	                    const leftX = padPx + s * pxPerSecond
	                    const rightX = padPx + e2 * pxPerSecond
	                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
	                    if (!inside) return
	                    if (selectedLogoId === String((l as any).id)) {
	                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                    }

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

		                    // Resize only when already selected.
		                    if (selectedLogoId !== String((l as any).id)) return
		                    e.preventDefault()
		                    setSelectedLogoId(String((l as any).id))
		                    setSelectedClipId(null)
		                    setSelectedGraphicId(null)
		                    setSelectedLowerThirdId(null)
		                    setSelectedScreenTitleId(null)
		                    setSelectedNarrationId(null)
		                    setSelectedStillId(null)
		                    setSelectedAudioId(null)

		                    // Arm the drag; we only enter "dragging" state once pointer movement crosses a threshold.
		                    trimDragRef.current = {
		                      kind: 'logo',
		                      logoId: String((l as any).id),
		                      edge: nearLeft ? 'start' : 'end',
		                      pointerId: e.pointerId,
		                      startClientX: e.clientX,
		                      startClientY: e.clientY,
		                      startStartSeconds: s,
		                      startEndSeconds: e2,
		                      minStartSeconds,
		                      maxEndSeconds,
		                      armed: true,
		                      moved: false,
		                    }
		                    try { sc.setPointerCapture(e.pointerId) } catch {}
		                    dbg('armTrimDrag', { kind: 'logo', edge: nearLeft ? 'start' : 'end', id: String((l as any).id) })
		                    return
		                  }

	                  if (withinLowerThird) {
	                    cancelTimelineLongPress('new_pointerdown')
	                    const lt = findLowerThirdAtTime(t)
	                    if (!lt) return
	                    const s = Number((lt as any).startSeconds || 0)
	                    const e2 = Number((lt as any).endSeconds || 0)
	                    const leftX = padPx + s * pxPerSecond
	                    const rightX = padPx + e2 * pxPerSecond
	                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
	                    if (!inside) return
	                    if (selectedLowerThirdId === String((lt as any).id)) {
	                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                    }

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

                    // Resize only when already selected.
                    if (selectedLowerThirdId !== String((lt as any).id)) return
                    e.preventDefault()
                    trimDragRef.current = {
                      kind: 'lowerThird',
                      lowerThirdId: String((lt as any).id),
                      edge: nearLeft ? 'start' : 'end',
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startStartSeconds: s,
                      startEndSeconds: e2,
                      minStartSeconds,
                      maxEndSeconds,
                      armed: true,
                      moved: false,
                    }
                    try { sc.setPointerCapture(e.pointerId) } catch {}
                    dbg('armTrimDrag', { kind: 'lowerThird', edge: nearLeft ? 'start' : 'end', id: String((lt as any).id) })
                    return
                  }

                  if (withinScreenTitle) {
                    cancelTimelineLongPress('new_pointerdown')
                    const st = findScreenTitleAtTime(t)
                    if (!st) return
                    const s = Number((st as any).startSeconds || 0)
	                    const e2 = Number((st as any).endSeconds || 0)
	                    const leftX = padPx + s * pxPerSecond
	                    const rightX = padPx + e2 * pxPerSecond
	                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
	                    if (!inside) return
	                    if (selectedScreenTitleId === String((st as any).id)) {
	                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                    }

                    const capEnd = Math.max(0, totalSeconds)
                    const sorted = screenTitles.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
                    const pos = sorted.findIndex((x: any) => String(x?.id) === String((st as any).id))
                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

                    // Slide (body drag) only when already selected.
                    if (!nearLeft && !nearRight) {
                      if (selectedScreenTitleId !== String((st as any).id)) return
                      const dur = Math.max(0.2, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)
                      trimDragRef.current = {
                        kind: 'screenTitle',
                        screenTitleId: String((st as any).id),
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
                      dbg('armTrimDrag', { kind: 'screenTitle', edge: 'move', id: String((st as any).id) })
                      return
                    }

                    // Resize only when already selected.
                    if (selectedScreenTitleId !== String((st as any).id)) return
                    e.preventDefault()
                    trimDragRef.current = {
                      kind: 'screenTitle',
                      screenTitleId: String((st as any).id),
                      edge: nearLeft ? 'start' : 'end',
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startStartSeconds: s,
                      startEndSeconds: e2,
                      minStartSeconds,
                      maxEndSeconds,
                      armed: true,
                      moved: false,
                    }
                    try { sc.setPointerCapture(e.pointerId) } catch {}
                    dbg('armTrimDrag', { kind: 'screenTitle', edge: nearLeft ? 'start' : 'end', id: String((st as any).id) })
                    return
                  }

		                  if (withinGraphics) {
		                    const g = findGraphicAtTime(t)
		                    if (!g) return
		                    const s = Number((g as any).startSeconds || 0)
		                    const e2 = Number((g as any).endSeconds || 0)
		                    const leftX = padPx + s * pxPerSecond
		                    const rightX = padPx + e2 * pxPerSecond
		                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
		                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
		                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
		                    if (!inside) return
		                    if (selectedGraphicId === g.id) {
		                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
		                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
		                    }

		                    // Tap selects. Tap+drag moves/resizes. Tap-release on an already-selected pill opens the context menu.
		                    if (selectedGraphicId !== g.id) {
		                      e.preventDefault()
		                      setSelectedGraphicId(g.id)
		                      setSelectedClipId(null)
		                      setSelectedLogoId(null)
		                      setSelectedLowerThirdId(null)
		                      setSelectedScreenTitleId(null)
		                      setSelectedNarrationId(null)
		                      setSelectedStillId(null)
		                      setSelectedAudioId(null)
		                      return
		                    }

		                    // Disallow overlaps: trim handles constrained by neighbors.
		                    const sorted = graphics.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
		                    const pos = sorted.findIndex((gg: any) => String(gg?.id) === String(g.id))
		                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
		                    const capEnd = timeline.clips.length ? totalSecondsVideo : 20 * 60
		                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
		                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
		                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

		                    // Resize (start/end).
		                    if (nearLeft || nearRight) {
		                      e.preventDefault()
		                      setSelectedGraphicId(g.id)
		                      setSelectedClipId(null)
		                      setSelectedLogoId(null)
		                      setSelectedLowerThirdId(null)
		                      setSelectedScreenTitleId(null)
		                      setSelectedNarrationId(null)
		                      setSelectedStillId(null)
		                      setSelectedAudioId(null)

		                      trimDragLockScrollLeftRef.current = sc.scrollLeft
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
		                        armed: true,
		                        moved: false,
		                      }
		                      setTrimDragging(true)
		                      try { sc.setPointerCapture(e.pointerId) } catch {}
		                      dbg('startTrimDrag', { kind: 'graphic', edge: nearLeft ? 'start' : 'end', id: g.id })
		                      return
		                    }

		                    // Move (body drag): arm so we can decide between opening the context menu (tap) and moving (drag).
		                    e.preventDefault()
		                    setSelectedGraphicId(g.id)
		                    setSelectedClipId(null)
		                    setSelectedLogoId(null)
		                    setSelectedLowerThirdId(null)
		                    setSelectedScreenTitleId(null)
		                    setSelectedNarrationId(null)
		                    setSelectedStillId(null)
		                    setSelectedAudioId(null)

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
		                      armed: true,
		                      moved: false,
		                    }
		                    try { sc.setPointerCapture(e.pointerId) } catch {}
		                    return
		                  }

	                  if (withinNarration) {
	                    cancelTimelineLongPress('new_pointerdown')
	                    const n = findNarrationAtTime(t)
	                    if (!n) return
	                    const s = Number((n as any).startSeconds || 0)
	                    const e2 = Number((n as any).endSeconds || 0)
	                    const nSourceStart =
	                      (n as any).sourceStartSeconds != null && Number.isFinite(Number((n as any).sourceStartSeconds))
	                        ? Number((n as any).sourceStartSeconds)
	                        : 0
	                    const nTotalSeconds = durationsByUploadId[Number((n as any).uploadId)]
	                    const nMaxDurationSeconds =
	                      nTotalSeconds != null && Number.isFinite(Number(nTotalSeconds)) && Number(nTotalSeconds) > 0
	                        ? roundToTenth(Math.max(0, Number(nTotalSeconds) - nSourceStart))
	                        : undefined
	                    const leftX = padPx + s * pxPerSecond
	                    const rightX = padPx + e2 * pxPerSecond
	                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
	                    if (!inside) return
	                    if (selectedNarrationId === String((n as any).id)) {
	                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                    }

	                    const capEnd = Math.max(0, totalSeconds)
	                    const sorted = narration
	                      .slice()
	                      .sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String((a as any).id).localeCompare(String((b as any).id)))
	                    const pos = sorted.findIndex((x: any) => String((x as any)?.id) === String((n as any).id))
	                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
	                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
	                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
	                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

	                    // Move/resize only when already selected (matches logo/lowerThird/screenTitle/clip).
	                    if (selectedNarrationId !== String((n as any).id)) return

	                    const dur = Math.max(0.2, roundToTenth(e2 - s))
	                    const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)

	                    if (!nearLeft && !nearRight) {
	                      // Arm body drag (tap-release can open the context menu; pointer movement begins drag).
	                      trimDragRef.current = {
	                        kind: 'narration',
	                        narrationId: String((n as any).id),
	                        edge: 'move',
	                        pointerId: e.pointerId,
	                        startClientX: e.clientX,
	                        startClientY: e.clientY,
	                        startStartSeconds: s,
	                        startEndSeconds: e2,
	                        startSourceStartSeconds: nSourceStart,
	                        maxDurationSeconds: nMaxDurationSeconds,
	                        minStartSeconds,
	                        maxEndSeconds,
	                        maxStartSeconds,
	                        armed: true,
	                        moved: false,
	                      }
	                      try { sc.setPointerCapture(e.pointerId) } catch {}
	                      dbg('armTrimDrag', { kind: 'narration', edge: 'move', id: String((n as any).id) })
	                      return
	                    }

	                    // Arm resize (tap-release can open the context menu; pointer movement begins drag).
	                    e.preventDefault()
	                    trimDragRef.current = {
	                      kind: 'narration',
	                      narrationId: String((n as any).id),
	                      edge: nearLeft ? 'start' : 'end',
	                      pointerId: e.pointerId,
	                      startClientX: e.clientX,
	                      startClientY: e.clientY,
	                      startStartSeconds: s,
	                      startEndSeconds: e2,
	                      startSourceStartSeconds: nSourceStart,
	                      maxDurationSeconds: nMaxDurationSeconds,
	                      minStartSeconds,
	                      maxEndSeconds,
	                      armed: true,
	                      moved: false,
	                    }
	                    try { sc.setPointerCapture(e.pointerId) } catch {}
	                    dbg('armTrimDrag', { kind: 'narration', edge: nearLeft ? 'start' : 'end', id: String((n as any).id) })
	                    return
	                  }

		                  if (withinAudio) {
		                    cancelTimelineLongPress('new_pointerdown')
		                    const seg = audioSegments.find((a: any) => {
		                      const ss = Number(a?.startSeconds || 0)
		                      const ee = Number(a?.endSeconds || 0)
		                      return Number.isFinite(ss) && Number.isFinite(ee) && ee > ss && t + 1e-6 >= ss && t <= ee - 1e-6
		                    }) as any
		                    if (!seg) return

		                    const s = Number(seg.startSeconds || 0)
		                    const e2 = Number(seg.endSeconds || 0)
		                    const leftX = padPx + s * pxPerSecond
		                    const rightX = padPx + e2 * pxPerSecond
		                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
		                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
		                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
		                    if (!inside) return
		                    if (String(selectedAudioId || '') === String(seg.id)) {
		                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
		                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
		                    }

		                    const capEnd = 20 * 60
		                    const sorted = audioSegments
		                      .slice()
		                      .sort(
		                        (a: any, b: any) =>
		                          Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id))
		                      )
		                    const pos = sorted.findIndex((x: any) => String(x?.id) === String(seg.id))
		                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
		                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
		                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
		                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

		                    // Move/resize only when already selected (matches logo/lowerThird/screenTitle/narration).
		                    if (String(selectedAudioId || '') !== String(seg.id)) return

		                    const segSourceStart =
		                      seg?.sourceStartSeconds != null && Number.isFinite(Number(seg.sourceStartSeconds))
		                        ? roundToTenth(Number(seg.sourceStartSeconds))
		                        : 0
		                    const segMaxDurationSecondsRaw = durationsByUploadId[Number(seg.uploadId)] ?? 0
		                    const segMaxDurationSeconds =
		                      Number.isFinite(Number(segMaxDurationSecondsRaw)) && Number(segMaxDurationSecondsRaw) > 0
		                        ? roundToTenth(Number(segMaxDurationSecondsRaw))
		                        : null

		                    const dur = Math.max(0.2, roundToTenth(e2 - s))
		                    const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)

		                    if (!nearLeft && !nearRight) {
		                      // Arm body drag (tap-release can open the context menu; pointer movement begins drag).
		                      trimDragRef.current = {
		                        kind: 'audioSegment',
		                        audioSegmentId: String(seg.id),
		                        edge: 'move',
		                        pointerId: e.pointerId,
		                        startClientX: e.clientX,
		                        startClientY: e.clientY,
		                        startStartSeconds: s,
		                        startEndSeconds: e2,
		                        startSourceStartSeconds: segSourceStart,
		                        maxDurationSeconds: segMaxDurationSeconds ?? undefined,
		                        minStartSeconds,
		                        maxEndSeconds,
		                        maxStartSeconds,
		                        armed: true,
		                        moved: false,
		                      }
		                      try {
		                        sc.setPointerCapture(e.pointerId)
		                      } catch {}
		                      dbg('armTrimDrag', { kind: 'audioSegment', edge: 'move', id: String(seg.id) })
		                      return
		                    }

		                    // Arm resize (tap-release can open the context menu; pointer movement begins drag).
		                    e.preventDefault()
		                    trimDragRef.current = {
		                      kind: 'audioSegment',
		                      audioSegmentId: String(seg.id),
		                      edge: nearLeft ? 'start' : 'end',
		                      pointerId: e.pointerId,
		                      startClientX: e.clientX,
		                      startClientY: e.clientY,
		                      startStartSeconds: s,
		                      startEndSeconds: e2,
		                      startSourceStartSeconds: segSourceStart,
		                      maxDurationSeconds: segMaxDurationSeconds ?? undefined,
		                      minStartSeconds,
		                      maxEndSeconds,
		                      maxStartSeconds,
		                      armed: true,
		                      moved: false,
		                    }
		                    try {
		                      sc.setPointerCapture(e.pointerId)
		                    } catch {}
		                    dbg('armTrimDrag', { kind: 'audioSegment', edge: nearLeft ? 'start' : 'end', id: String(seg.id) })
		                    return
		                  }

	                  if (withinVideo) {
	                    cancelTimelineLongPress('new_pointerdown')
	                    const still = findStillAtTime(t)
                    if (still) {
	                      const s = roundToTenth(Number((still as any).startSeconds || 0))
	                      const e2 = roundToTenth(Number((still as any).endSeconds || 0))
	                      const leftX = padPx + s * pxPerSecond
	                      const rightX = padPx + e2 * pxPerSecond
	                      let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                      let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                      const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
	                      if (!inside) return
	                      if (selectedStillId === String((still as any).id)) {
	                        nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                        nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                      }

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

                      // Tap selects. Tap+drag moves/resizes. Tap-release on an already-selected pill opens the context menu.
                      if (selectedStillId !== String((still as any).id)) {
                        e.preventDefault()
                        setSelectedStillId(String((still as any).id))
                        setSelectedClipId(null)
                        setSelectedGraphicId(null)
                        setSelectedLogoId(null)
                        setSelectedLowerThirdId(null)
                        setSelectedScreenTitleId(null)
                        setSelectedNarrationId(null)
                        setSelectedAudioId(null)
                        return
                      }

                      e.preventDefault()
                      setSelectedStillId(String((still as any).id))
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      setSelectedLogoId(null)
                      setSelectedLowerThirdId(null)
                      setSelectedScreenTitleId(null)
                      setSelectedNarrationId(null)
                      setSelectedAudioId(null)

                      trimDragLockScrollLeftRef.current = sc.scrollLeft
                      trimDragRef.current = {
                        kind: 'still',
                        stillId: String((still as any).id),
                        edge: nearLeft ? 'start' : nearRight ? 'end' : 'move',
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
                      if (nearLeft || nearRight) {
                        setTrimDragging(true)
                        try { sc.setPointerCapture(e.pointerId) } catch {}
                        dbg('startTrimDrag', { kind: 'still', edge: nearLeft ? 'start' : 'end', id: String((still as any).id) })
                      } else {
                        try { sc.setPointerCapture(e.pointerId) } catch {}
                        dbg('armTrimDrag', { kind: 'still', edge: 'move', id: String((still as any).id) })
                      }
                      return
                    }
                  }

	                  cancelTimelineLongPress('new_pointerdown')
	                  if (!timeline.clips.length) return
	                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = idx >= 0 ? timeline.clips[idx] : null
                  if (!clip) return

	                  const start = (clipStarts[idx] || 0)
	                  const len = clipDurationSeconds(clip)
	                  const leftX = padPx + start * pxPerSecond
	                  const rightX = padPx + (start + len) * pxPerSecond
	                  let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                  let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                  const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
	                  if (!inside) return
	                  if (selectedClipId === clip.id) {
	                    nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                    nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                  }

                  // Slide (body drag) only when already selected.
                  if (!nearLeft && !nearRight) {
                    if (selectedClipId !== clip.id) return
                    e.preventDefault()

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

                    const maxDur = durationsByUploadId[Number(clip.uploadId)] ?? clip.sourceEndSeconds
                    trimDragRef.current = {
                      kind: 'clip',
                      clipId: clip.id,
                      edge: 'move',
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startStartSeconds: start,
                      startEndSeconds: start + len,
                      maxDurationSeconds: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : clip.sourceEndSeconds,
                      minStartSeconds,
                      maxEndSeconds,
                      maxStartSeconds,
                      armed: true,
                      moved: false,
                    }
                    try { sc.setPointerCapture(e.pointerId) } catch {}
                    dbg('armTrimDrag', { kind: 'clip', edge: 'move', id: clip.id })
                    return
                  }

                  // Resize only when already selected.
                  if (selectedClipId !== clip.id) return
                  e.preventDefault()
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
	                  const prevEnd = pos > 0 ? Number(ranges[pos - 1].end || 0) : 0
	                  const nextStart = pos >= 0 && pos < ranges.length - 1 ? Number(ranges[pos + 1].start || capEnd) : capEnd
	                  const maxTimelineDurationSeconds = clamp(roundToTenth(nextStart - start), 0.2, capEnd)
	                  trimDragRef.current = {
	                    kind: 'clip',
	                    clipId: clip.id,
	                    edge: nearLeft ? 'start' : 'end',
	                    pointerId: e.pointerId,
	                    startClientX: e.clientX,
	                    startClientY: e.clientY,
	                    startStartSeconds: clip.sourceStartSeconds,
	                    startEndSeconds: clip.sourceEndSeconds,
	                    startTimelineStartSeconds: roundToTenth(start),
	                    startTimelineEndSeconds: roundToTenth(start + len),
	                    maxDurationSeconds: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : clip.sourceEndSeconds,
	                    maxTimelineDurationSeconds,
	                    minStartSeconds: clamp(roundToTenth(prevEnd), 0, capEnd),
	                    armed: true,
	                    moved: false,
	                  }
                  try { sc.setPointerCapture(e.pointerId) } catch {}
                  dbg('armTrimDrag', { kind: 'clip', edge: nearLeft ? 'start' : 'end', id: clip.id })
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
	                  const withinScreenTitle = y >= SCREEN_TITLE_Y && y <= SCREEN_TITLE_Y + PILL_H
	                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
	                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
	                  const withinNarration = y >= NARRATION_Y && y <= NARRATION_Y + PILL_H
	                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H

	                  if (withinLogo) {
	                    const l = findLogoAtTime(t)
	                    if (l) return
	                  }
	                  if (withinLowerThird) {
	                    const lt = findLowerThirdAtTime(t)
	                    if (lt) return
	                  }
	                  if (withinScreenTitle) {
	                    const st = findScreenTitleAtTime(t)
	                    if (st) return
	                  }
	                  if (withinNarration) {
	                    const n = findNarrationAtTime(t)
	                    if (n) return
	                  }
	                  if (withinGraphics) {
	                    const g = findGraphicAtTime(t)
	                    if (g) return
	                  }
                  if (withinAudio) {
                    for (const a of audioSegments) {
                      const s = Number((a as any).startSeconds || 0)
                      const e2 = Number((a as any).endSeconds || 0)
                      if (Number.isFinite(s) && Number.isFinite(e2) && e2 > s && t + 1e-6 >= s && t <= e2 - 1e-6) return
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
		                  const EDGE_HIT_PX = Math.max(24, Math.min(72, Math.round(pxPerSecond * 0.6)))
			                  const withinLogo = y >= LOGO_Y && y <= LOGO_Y + PILL_H
			                  const withinLowerThird = y >= LOWER_THIRD_Y && y <= LOWER_THIRD_Y + PILL_H
			                  const withinScreenTitle = y >= SCREEN_TITLE_Y && y <= SCREEN_TITLE_Y + PILL_H
		                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
		                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
		                  const withinNarration = y >= NARRATION_Y && y <= NARRATION_Y + PILL_H
		                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
		                  if (!withinLogo && !withinLowerThird && !withinScreenTitle && !withinGraphics && !withinVideo && !withinNarration && !withinAudio) {
		                    setSelectedClipId(null)
		                    setSelectedGraphicId(null)
		                    setSelectedLogoId(null)
		                    setSelectedLowerThirdId(null)
		                    setSelectedScreenTitleId(null)
		                    setSelectedNarrationId(null)
		                    setSelectedStillId(null)
		                    setSelectedAudioId(null)
		                    return
		                  }

	                  if (withinLogo) {
	                    const l = findLogoAtTime(t)
	                    if (!l) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
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
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
	                      return
	                    }
		                    // Logo properties are opened via the context menu (not by tapping).
		                    if (selectedLogoId === String((l as any).id)) return
	                    setSelectedLogoId(String((l as any).id))
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLowerThirdId(null)
	                    setSelectedScreenTitleId(null)
	                    setSelectedNarrationId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudioId(null)
	                    return
	                  }

	                  if (withinLowerThird) {
	                    const lt = findLowerThirdAtTime(t)
	                    if (!lt) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
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
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
	                      return
	                    }
	                    // Lower third properties are opened via the context menu (not by tapping).
	                    if (selectedLowerThirdId === String((lt as any).id)) return
	                    setSelectedLowerThirdId(String((lt as any).id))
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedScreenTitleId(null)
	                    setSelectedNarrationId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudioId(null)
	                    return
	                  }

	                  if (withinScreenTitle) {
	                    const st = findScreenTitleAtTime(t)
	                    if (!st) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
	                      return
	                    }
	                    const s = Number((st as any).startSeconds || 0)
	                    const e2 = Number((st as any).endSeconds || 0)
	                    const leftX = padPx + s * pxPerSecond
	                    const rightX = padPx + e2 * pxPerSecond
	                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
	                      return
	                    }
	                    // Screen title properties are opened via the context menu (not by tapping).
	                    if (selectedScreenTitleId === String((st as any).id)) return
	                    setSelectedScreenTitleId(String((st as any).id))
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedLowerThirdId(null)
	                    setSelectedNarrationId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudioId(null)
	                    return
	                  }

			                  if (withinNarration) {
			                    const n = findNarrationAtTime(t)
			                    if (!n) {
		                      setSelectedClipId(null)
		                      setSelectedGraphicId(null)
		                      setSelectedLogoId(null)
		                      setSelectedLowerThirdId(null)
		                      setSelectedScreenTitleId(null)
		                      setSelectedNarrationId(null)
		                      setSelectedStillId(null)
		                      setSelectedAudioId(null)
		                      return
		                    }
		                    const s = Number((n as any).startSeconds || 0)
			                    const e2 = Number((n as any).endSeconds || 0)
			                    const leftX = padPx + s * pxPerSecond
			                    const rightX = padPx + e2 * pxPerSecond
		                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
		                      setSelectedClipId(null)
		                      setSelectedGraphicId(null)
		                      setSelectedLogoId(null)
		                      setSelectedLowerThirdId(null)
		                      setSelectedScreenTitleId(null)
		                      setSelectedNarrationId(null)
		                      setSelectedStillId(null)
		                      setSelectedAudioId(null)
		                      return
		                    }
			                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
			                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
			                    if (selectedNarrationId === String((n as any).id)) {
			                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
			                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
			                    }
			                    if (nearLeft || nearRight) return

			                    // Narration properties are opened via the context menu (not by tapping).
			                    if (selectedNarrationId === String((n as any).id)) return

			                    setSelectedNarrationId(String((n as any).id))
			                    setSelectedClipId(null)
			                    setSelectedGraphicId(null)
		                    setSelectedLogoId(null)
		                    setSelectedLowerThirdId(null)
		                    setSelectedScreenTitleId(null)
		                    setSelectedStillId(null)
		                    setSelectedAudioId(null)
		                    return
		                  }

		                  if (withinGraphics) {
	                    const g = findGraphicAtTime(t)
	                    if (!g) {
	                      setSelectedGraphicId(null)
	                      setSelectedClipId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
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
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
	                      return
	                    }
                    // Graphics properties are only opened via the long-press context menu (not by tapping).
                    if (selectedGraphicId === g.id) return
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(g.id)
	                    setSelectedLogoId(null)
	                    setSelectedLowerThirdId(null)
	                    setSelectedScreenTitleId(null)
	                    setSelectedNarrationId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudioId(null)
	                    return
	                  }

		                  if (withinAudio) {
		                    const seg = audioSegments.find((a: any) => {
		                      const ss = Number(a?.startSeconds || 0)
		                      const ee = Number(a?.endSeconds || 0)
		                      return Number.isFinite(ss) && Number.isFinite(ee) && ee > ss && t + 1e-6 >= ss && t <= ee - 1e-6
		                    }) as any
		                    if (!seg) {
		                      setSelectedAudioId(null)
		                      setSelectedClipId(null)
		                      setSelectedGraphicId(null)
		                      setSelectedLogoId(null)
		                      setSelectedLowerThirdId(null)
		                      setSelectedScreenTitleId(null)
		                      setSelectedNarrationId(null)
		                      setSelectedStillId(null)
		                      return
		                    }
                    const s = Number(seg.startSeconds || 0)
                    const e2 = Number(seg.endSeconds || 0)
                    const leftX = padPx + s * pxPerSecond
                    const rightX = padPx + e2 * pxPerSecond
	                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
	                      setSelectedAudioId(null)
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      return
	                    }
	                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                    if (String(selectedAudioId || '') === String(seg.id)) {
	                      nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                      nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                    }
	                    if (nearLeft || nearRight) return

			                    // Audio properties are opened via the context menu (not by tapping).
			                    if (String(selectedAudioId || '') === String(seg.id)) return
			                    setSelectedAudioId(String(seg.id))
			                    setSelectedClipId(null)
			                    setSelectedGraphicId(null)
			                    setSelectedLogoId(null)
			                    setSelectedLowerThirdId(null)
			                    setSelectedScreenTitleId(null)
		                    setSelectedNarrationId(null)
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
		                      setSelectedLowerThirdId(null)
		                      setSelectedScreenTitleId(null)
		                      setSelectedNarrationId(null)
		                      setSelectedStillId(null)
		                      setSelectedAudioId(null)
		                      return
		                    }
		                    setSelectedStillId(String((still as any).id))
		                    setSelectedClipId(null)
		                    setSelectedGraphicId(null)
		                    setSelectedLogoId(null)
		                    setSelectedLowerThirdId(null)
		                    setSelectedScreenTitleId(null)
		                    setSelectedNarrationId(null)
		                    setSelectedAudioId(null)
		                    return
		                  }

                  const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
                  const clip = idx >= 0 ? timeline.clips[idx] : null
	                  if (!clip) {
	                    setSelectedClipId(null)
	                    setSelectedGraphicId(null)
	                    setSelectedLogoId(null)
	                    setSelectedLowerThirdId(null)
	                    setSelectedScreenTitleId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudioId(null)
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
	                    setSelectedLowerThirdId(null)
	                    setSelectedScreenTitleId(null)
	                    setSelectedStillId(null)
	                    setSelectedAudioId(null)
	                    return
	                  }
	                  let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                  let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                  if (selectedClipId === clip.id) {
	                    nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                    nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
	                  }
	                  if (nearLeft || nearRight) return

                  if (selectedClipId === clip.id) {
                    // Video properties are opened via the context menu (not by tapping).
                    return
                  }

		                  setSelectedClipId(clip.id)
		                  setSelectedGraphicId(null)
		                  setSelectedLogoId(null)
		                  setSelectedLowerThirdId(null)
		                  setSelectedScreenTitleId(null)
		                  setSelectedNarrationId(null)
		                  setSelectedStillId(null)
		                  setSelectedAudioId(null)
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
                  title="Undo"
                  aria-label="Undo"
	                >
	                  U
	                </button>
                <button
                  type="button"
                  onClick={redo}
                  disabled={!canRedo}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: canRedo ? '#0c0c0c' : 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: canRedo ? 'pointer' : 'default',
                    flex: '0 0 auto',
                  }}
                  title="Redo"
                  aria-label="Redo"
                >
                  R
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerDown={(e) => {
	                    if (e.button != null && e.button !== 0) return
	                    if (totalSeconds <= 0) return
	                    try { (e.currentTarget as any).setPointerCapture?.(e.pointerId) } catch {}
	                    startGuidelinePress()
	                  }}
	                  onPointerUp={() => finishGuidelinePress()}
	                  onPointerCancel={() => cancelGuidelinePress()}
	                  onPointerLeave={() => cancelGuidelinePress()}
	                  disabled={totalSeconds <= 0}
	                  style={{
	                    padding: '10px 12px',
	                    borderRadius: 10,
	                    border: '1px solid rgba(212,175,55,0.65)',
	                    background: 'rgba(212,175,55,0.12)',
	                    color: '#fff',
	                    fontWeight: 900,
	                    cursor: totalSeconds > 0 ? 'pointer' : 'default',
	                    flex: '0 0 auto',
	                    minWidth: 44,
	                    lineHeight: 1,
	                    userSelect: 'none',
	                    WebkitUserSelect: 'none',
	                    WebkitTouchCallout: 'none',
	                  }}
	                  title="Guideline (tap to add, hold for menu)"
	                  aria-label="Guideline"
	                >
	                  G
	                </button>
	              </div>
	              <button
	                type="button"
	                onClick={deleteSelected}
	                disabled={
	                  !selectedClipId &&
	                  !selectedGraphicId &&
	                  !selectedLogoId &&
	                  !selectedLowerThirdId &&
	                  !selectedScreenTitleId &&
	                  !selectedNarrationId &&
	                  !selectedStillId &&
	                  !selectedAudio
	                }
	                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
	                  background:
	                    selectedClipId ||
	                    selectedGraphicId ||
	                    selectedLogoId ||
	                    selectedLowerThirdId ||
	                    selectedScreenTitleId ||
	                    selectedNarrationId ||
	                    selectedStillId ||
	                    selectedAudio
	                      ? '#300'
	                      : 'rgba(255,255,255,0.06)',
	                  color: '#fff',
	                  fontWeight: 900,
	                  cursor:
	                    selectedClipId ||
	                    selectedGraphicId ||
	                    selectedLogoId ||
	                    selectedLowerThirdId ||
	                    selectedScreenTitleId ||
	                    selectedNarrationId ||
	                    selectedStillId ||
	                    selectedAudio
	                      ? 'pointer'
	                      : 'default',
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
	                  padding: '10px 12px',
	                  borderRadius: 10,
	                  border: '1px solid rgba(10,132,255,0.55)',
	                  background: playing ? 'rgba(10,132,255,0.18)' : '#0a84ff',
	                  color: '#fff',
	                  fontWeight: 900,
	                  cursor: totalSeconds <= 0 ? 'default' : 'pointer',
	                  flex: '0 0 auto',
	                  minWidth: 44,
	                  lineHeight: 1,
	                }}
	                title="Play/Pause"
	                aria-label={playing ? 'Pause' : 'Play'}
	              >
	                <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
	                  {playPauseGlyph(playing)}
	                </span>
	              </button>
	              <button
	                type="button"
	                onClick={toggleNarrationPlay}
	                disabled={!sortedNarration.length}
	                style={{
	                  padding: '10px 12px',
	                  borderRadius: 10,
	                  border: '1px solid rgba(175,82,222,0.65)',
	                  background: narrationPreviewPlaying ? 'rgba(175,82,222,0.22)' : 'rgba(175,82,222,0.12)',
	                  color: '#fff',
	                  fontWeight: 900,
	                  cursor: sortedNarration.length ? 'pointer' : 'default',
	                  flex: '0 0 auto',
	                  minWidth: 44,
	                  lineHeight: 1,
	                }}
	                title="Play narration (voice memo)"
	                aria-label={narrationPreviewPlaying ? 'Pause voice' : 'Play voice'}
	              >
	                <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
	                  {playPauseGlyph(narrationPreviewPlaying)}
	                </span>
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

        {audioSegments.length
          ? (() => {
              const sorted = audioSegments
                .slice()
                .sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
              const primary: any = sorted[0]
              if (!primary) return null
              const uploadId = Number(primary.uploadId)
              const audioConfigId = Number(primary.audioConfigId)
              return (
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ color: '#fff', fontWeight: 900 }}>
                    {(namesByUploadId[uploadId] || `Audio ${uploadId}`) + ' * ' + (audioConfigNameById[audioConfigId] || `Config ${audioConfigId}`)}
                  </div>
	                  <button
	                    type="button"
	                    onClick={toggleMusicPlay}
	                    style={{
	                      padding: '8px 12px',
	                      borderRadius: 10,
	                      border: '1px solid rgba(48,209,88,0.65)',
	                      background: musicPreviewPlaying ? 'rgba(48,209,88,0.22)' : 'rgba(48,209,88,0.12)',
	                      color: '#fff',
	                      fontWeight: 900,
	                      cursor: 'pointer',
	                      flex: '0 0 auto',
	                    }}
	                    aria-label={musicPreviewPlaying ? 'Pause music' : 'Play music'}
	                  >
	                    {musicPreviewPlaying ? 'Pause' : 'Play'}
	                  </button>
	                </div>
	              )
            })()
          : null}

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
		                      : addStep === 'narration'
		                        ? 'Voice Memos'
		                      : addStep === 'logo'
		                          ? `Logos: ${logoPickerItems.length}`
		                          : addStep === 'logoConfig'
		                              ? `Configs: ${logoConfigs.length}`
		                              : addStep === 'lowerThird'
	                                ? `Lower thirds: ${lowerThirdPickerItems.length}`
	                                : addStep === 'lowerThirdConfig'
	                                  ? `Configs: ${lowerThirdConfigs.length}`
	                                  : addStep === 'screenTitle'
	                                    ? `Styles: ${screenTitlePresets.length}`
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
                      setAddStep('screenTitle')
                      ensureScreenTitlePresets().catch(() => {})
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
                    <div style={{ fontWeight: 900, fontSize: 16 }}>Screen Title</div>
                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Text overlays (no overlaps)</div>
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
		                  <button
		                    type="button"
		                    onClick={() => {
		                      setNarrationAddError(null)
		                      setAddStep('narration')
		                    }}
		                    style={{
		                      padding: 12,
		                      borderRadius: 12,
		                      border: '1px solid rgba(191,90,242,0.55)',
		                      background: 'rgba(0,0,0,0.35)',
		                      color: '#fff',
		                      cursor: 'pointer',
		                      textAlign: 'left',
		                    }}
		                  >
		                    <div style={{ fontWeight: 900, fontSize: 16 }}>Narration</div>
		                    <div style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Add a Voice Memo (.m4a)</div>
		                  </button>
		                </div>
		              </>
		            ) : addStep === 'narration' ? (
		              <>
		                <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Add Narration</h1>
		                <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.4 }}>
		                  Import a Voice Memo (or any audio file) as a narration segment. It will be mixed into the export above background music.
		                </div>
		                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
		                  <button
		                    type="button"
		                    disabled={narrationUploadBusy}
		                    onClick={() => narrationFileInputRef.current?.click()}
		                    style={{
		                      padding: '10px 12px',
		                      borderRadius: 10,
		                      border: '1px solid rgba(191,90,242,0.65)',
		                      background: 'rgba(191,90,242,0.14)',
		                      color: '#fff',
		                      fontWeight: 900,
		                      cursor: narrationUploadBusy ? 'not-allowed' : 'pointer',
		                      opacity: narrationUploadBusy ? 0.7 : 1,
		                    }}
		                  >
		                    {narrationUploadBusy ? 'Uploading…' : 'Choose Voice Memo'}
		                  </button>
		                  <input
		                    ref={narrationFileInputRef}
		                    type="file"
		                    accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg,.opus,.webm"
		                    style={{ display: 'none' }}
		                    onChange={(e) => {
		                      const f = (e.target.files && e.target.files[0]) ? e.target.files[0] : null
		                      e.currentTarget.value = ''
		                      if (!f) return
		                      addNarrationFromFile(f).catch(() => {})
		                    }}
		                  />
		                </div>
		                {narrationAddError ? <div style={{ color: '#ff9b9b', marginTop: 10 }}>{narrationAddError}</div> : null}
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
	            ) : addStep === 'screenTitle' ? (
	              <>
	                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
	                  <h1 style={{ margin: '12px 0 14px', fontSize: 28 }}>Select Screen Title Style</h1>
	                  <a href="/screen-title-presets" style={{ color: '#0a84ff', textDecoration: 'none' }}>Manage Styles</a>
	                </div>
	                {screenTitlePresetsError ? <div style={{ color: '#ff9b9b' }}>{screenTitlePresetsError}</div> : null}
	                {!screenTitlePresetsLoaded ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
	                <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
	                  {screenTitlePresets
	                    .filter((p: any) => !(p && typeof p === 'object' && (p.archived_at || p.archivedAt)))
	                    .map((p: any) => {
	                      const id = Number(p.id)
	                      if (!Number.isFinite(id) || id <= 0) return null
	                      const name = String(p.name || `Preset ${id}`)
	                      const style = String(p.style || '').toLowerCase()
	                      const fade = String(p.fade || '').toLowerCase()
	                      return (
	                        <button
	                          key={`pick-st-${id}`}
	                          type="button"
	                          onClick={() => addScreenTitleFromPreset(p)}
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
	                            <div style={{ color: '#bbb', fontSize: 12, marginTop: 2 }}>{`Style: ${style || 'outline'} • Fade: ${fade || 'none'}`}</div>
	                          </div>
	                          <div style={{ fontWeight: 900, color: '#fff' }}>Add</div>
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
                const canStartDec01 = Number.isFinite(start) && start - 0.1 >= 0 - 1e-9
                const canStartInc01 = Number.isFinite(start) && Number.isFinite(end) && start + 0.1 <= end - minLen + 1e-9
                const canEndDec01 = Number.isFinite(start) && Number.isFinite(end) && end - 0.1 >= start + minLen - 1e-9
                const canEndInc01 = Number.isFinite(end) && end + 0.1 <= cap + 1e-9

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

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust Start</div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" disabled={!canStartDec01} onClick={() => adjustStart(-0.1)} style={adjustBtn(canStartDec01)}>-0.1s</button>
                            <button type="button" disabled={!canStartInc01} onClick={() => adjustStart(0.1)} style={adjustBtn(canStartInc01)}>+0.1s</button>
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust End</div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" disabled={!canEndDec01} onClick={() => adjustEnd(-0.1)} style={adjustBtn(canEndDec01)}>-0.1s</button>
                            <button type="button" disabled={!canEndInc01} onClick={() => adjustEnd(0.1)} style={adjustBtn(canEndInc01)}>+0.1s</button>
                          </div>
                          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Max end: {cap.toFixed(1)}s</div>
                        </div>
                      </div>
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

      {stillEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setStillEditor(null); setStillEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(255,214,10,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Freeze Frame Properties</div>
              <button
                type="button"
                onClick={() => { setStillEditor(null); setStillEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {(() => {
                const start = Number(stillEditor.start)
                const end = Number(stillEditor.end)
                const minLen = 0.1
                const cap = 20 * 60

                const adjustStart = (delta: number) => {
                  setStillEditorError(null)
                  setStillEditor((p) => {
                    if (!p) return p
                    const next = roundToTenth(Number(p.start) + delta)
                    const maxStart = Math.max(0, (Number(p.end) - minLen))
                    return { ...p, start: clamp(next, 0, maxStart) }
                  })
                }

                const adjustEnd = (delta: number) => {
                  setStillEditorError(null)
                  setStillEditor((p) => {
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

                const canStartDec01 = Number.isFinite(start) && start - 0.1 >= 0 - 1e-9
                const canStartInc01 = Number.isFinite(start) && Number.isFinite(end) && start + 0.1 <= end - minLen + 1e-9
                const canEndDec01 = Number.isFinite(start) && Number.isFinite(end) && end - 0.1 >= start + minLen - 1e-9
                const canEndInc01 = Number.isFinite(end) && end + 0.1 <= cap + 1e-9

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

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust Start</div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" disabled={!canStartDec01} onClick={() => adjustStart(-0.1)} style={adjustBtn(canStartDec01)}>-0.1s</button>
                            <button type="button" disabled={!canStartInc01} onClick={() => adjustStart(0.1)} style={adjustBtn(canStartInc01)}>+0.1s</button>
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust End</div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" disabled={!canEndDec01} onClick={() => adjustEnd(-0.1)} style={adjustBtn(canEndDec01)}>-0.1s</button>
                            <button type="button" disabled={!canEndInc01} onClick={() => adjustEnd(0.1)} style={adjustBtn(canEndInc01)}>+0.1s</button>
                          </div>
                          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Max end: {cap.toFixed(1)}s</div>
                        </div>
                      </div>
                    </div>
                  </>
                )
              })()}
              {stillEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{stillEditorError}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setStillEditor(null); setStillEditorError(null) }}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveStillEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,214,10,0.65)', background: 'rgba(255,214,10,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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

            {(() => {
              const seg: any = audioSegments.find((s: any) => String(s?.id) === String(audioEditor.id))
              if (!seg) return null
              const uploadId = Number(seg.uploadId)
              const audioConfigId = Number(seg.audioConfigId)
              return (
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ color: '#fff', fontWeight: 900 }}>
                    {(namesByUploadId[uploadId] || `Audio ${uploadId}`) + ' * ' + (audioConfigNameById[audioConfigId] || `Config ${audioConfigId}`)}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleAudioPreview(uploadId)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(48,209,88,0.65)',
                      background: audioPreviewPlayingId === uploadId ? 'rgba(48,209,88,0.22)' : 'rgba(48,209,88,0.12)',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    {audioPreviewPlayingId === uploadId ? 'Pause' : 'Play'}
                  </button>
                </div>
              )
            })()}

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

      {screenTitleEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setScreenTitleEditor(null); setScreenTitleEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(255,204,0,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Screen Title</div>
              <button
                type="button"
                onClick={() => { setScreenTitleEditor(null); setScreenTitleEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
	            </div>
	
	            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
	              {(() => {
	                const start = roundToTenth(Number(screenTitleEditor.start))
	                const end = roundToTenth(Number(screenTitleEditor.end))
	                const cap = roundToTenth(Math.max(0, Number(totalSeconds || 0)))
	                const minLen = 0.1

	                const setStart = (v: number) => {
	                  setScreenTitleEditor((p) => {
	                    if (!p) return p
	                    const next = clamp(roundToTenth(v), 0, Math.max(0, roundToTenth(Number(p.end)) - minLen))
	                    return { ...p, start: next }
	                  })
	                }
	                const setEnd = (v: number) => {
	                  setScreenTitleEditor((p) => {
	                    if (!p) return p
	                    const next = clamp(roundToTenth(v), Math.max(0, roundToTenth(Number(p.start)) + minLen), cap)
	                    return { ...p, end: next }
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

	                const canStartDec01 = Number.isFinite(start) && start - 0.1 >= 0 - 1e-9
	                const canStartInc01 = Number.isFinite(start) && Number.isFinite(end) && start + 0.1 <= end - minLen + 1e-9
	                const canEndDec01 = Number.isFinite(start) && Number.isFinite(end) && end - 0.1 >= start + minLen - 1e-9
	                const canEndInc01 = Number.isFinite(end) && end + 0.1 <= cap + 1e-9

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

	                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
	                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
	                        <div>
	                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust Start</div>
	                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
	                            <button type="button" disabled={!canStartDec01} onClick={() => setStart(start - 0.1)} style={adjustBtn(canStartDec01)}>-0.1s</button>
	                            <button type="button" disabled={!canStartInc01} onClick={() => setStart(start + 0.1)} style={adjustBtn(canStartInc01)}>+0.1s</button>
	                          </div>
	                        </div>
	                        <div>
	                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Adjust End</div>
	                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
	                            <button type="button" disabled={!canEndDec01} onClick={() => setEnd(end - 0.1)} style={adjustBtn(canEndDec01)}>-0.1s</button>
	                            <button type="button" disabled={!canEndInc01} onClick={() => setEnd(end + 0.1)} style={adjustBtn(canEndInc01)}>+0.1s</button>
	                          </div>
	                          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Max end: {cap.toFixed(1)}s</div>
	                        </div>
	                      </div>
	                    </div>
	                  </>
	                )
	              })()}

	            <div style={{ marginTop: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
	                <div style={{ color: '#bbb', fontSize: 13 }}>Select Style</div>
	                <a
	                  href={(() => {
	                    try {
	                      const url = new URL(window.location.href)
	                      url.searchParams.set('cvScreenTitleId', String(screenTitleEditor.id))
	                      const from = `${url.pathname}${url.search}`
	                      return `/screen-title-presets?from=${encodeURIComponent(from)}`
	                    } catch {
	                      return '/screen-title-presets'
	                    }
	                  })()}
	                  style={{ color: '#0a84ff', textDecoration: 'none' }}
	                >
	                  Manage Styles
	                </a>
	              </div>

	              <select
	                value={String(screenTitleEditor.presetId ?? '')}
	                onChange={(e) => { setScreenTitleEditorError(null); setScreenTitleEditor((p) => p ? ({ ...p, presetId: e.target.value ? Number(e.target.value) : null }) : p) }}
	                style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
	              >
	                <option value="" disabled>
	                  Select…
	                </option>
	                {screenTitlePresets
	                  .filter((p: any) => !(p && typeof p === 'object' && (p as any).archived_at))
	                  .map((p: any) => (
	                    <option key={`stp-${String(p.id)}`} value={String(p.id)}>{String(p.name || `Preset ${p.id}`)}</option>
	                  ))}
	              </select>
	              {screenTitlePresetsError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{screenTitlePresetsError}</div> : null}

		              <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
		                <div style={{ position: 'relative' }}>
		                  <textarea
		                    ref={screenTitleTextAreaRef}
		                    value={String(screenTitleEditor.text || '')}
		                    placeholder="Type your screen title here"
		                    rows={3}
		                    maxLength={1000}
		                    onChange={(e) => { setScreenTitleEditorError(null); setScreenTitleEditor((p) => p ? ({ ...p, text: e.target.value }) : p) }}
		                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', paddingBottom: 34, paddingRight: 44, fontSize: 14, resize: 'none', height: screenTitleTextAreaHeight }}
		                  />
		                  <div
		                    role="button"
		                    aria-label="Resize text area"
		                    onPointerDown={(e) => {
		                      const ta = screenTitleTextAreaRef.current
		                      if (!ta) return
		                      e.preventDefault()
		                      e.stopPropagation()
		                      const rect = ta.getBoundingClientRect()
		                      screenTitleTextAreaDragRef.current = { pointerId: e.pointerId, startClientY: e.clientY, startHeight: rect.height }
		                      try { (e.currentTarget as any).setPointerCapture?.(e.pointerId) } catch {}
		                    }}
		                    onPointerMove={(e) => {
		                      const cur = screenTitleTextAreaDragRef.current
		                      if (!cur || e.pointerId !== cur.pointerId) return
		                      e.preventDefault()
		                      e.stopPropagation()
		                      const dy = e.clientY - cur.startClientY
		                      const nextH = clamp(cur.startHeight + dy, 72, 520)
		                      setScreenTitleTextAreaHeight(nextH)
		                    }}
		                    onPointerUp={(e) => {
		                      const cur = screenTitleTextAreaDragRef.current
		                      if (!cur || e.pointerId !== cur.pointerId) return
		                      e.preventDefault()
		                      e.stopPropagation()
		                      screenTitleTextAreaDragRef.current = null
		                      try { (e.currentTarget as any).releasePointerCapture?.(e.pointerId) } catch {}
		                    }}
		                    style={{
		                      position: 'absolute',
		                      right: 8,
		                      bottom: 8,
		                      width: 28,
		                      height: 28,
		                      borderRadius: 8,
		                      background: 'rgba(255,255,255,0.06)',
		                      border: '1px solid rgba(255,255,255,0.22)',
		                      cursor: 'nwse-resize',
		                      touchAction: 'none',
		                      userSelect: 'none',
		                      display: 'grid',
		                      placeItems: 'center',
		                    }}
		                  >
		                    <div style={{ width: 16, height: 16, borderRight: '2px solid rgba(255,255,255,0.38)', borderBottom: '2px solid rgba(255,255,255,0.38)' }} />
		                  </div>
		                </div>
		                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#888', fontSize: 12 }}>
		                  <div>Max 1000 chars • max 30 lines</div>
		                  <div>{String(screenTitleEditor.text || '').length}/1000</div>
		                </div>
		              </div>
	
	              {screenTitleEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{screenTitleEditorError}</div> : null}
	
	              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={saveScreenTitleEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={screenTitleRenderBusy}
                  onClick={generateScreenTitle}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(10,132,255,0.65)', background: 'rgba(10,132,255,0.14)', color: '#fff', fontWeight: 900, cursor: screenTitleRenderBusy ? 'not-allowed' : 'pointer', opacity: screenTitleRenderBusy ? 0.65 : 1 }}
                >
                  {screenTitleRenderBusy ? 'Generating…' : 'Generate'}
                </button>
              </div>
              <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                Generate renders a transparent PNG using the selected style and applies it to the selected time range.
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
                const safeMax = maxDur != null && Number.isFinite(Number(maxDur)) ? roundToTenth(Number(maxDur)) : null
                const start = clip ? roundToTenth(Number(clip.sourceStartSeconds || 0)) : 0
                const end = clip ? roundToTenth(Number(clip.sourceEndSeconds || 0)) : 0
                const dur = roundToTenth(Math.max(0, end - start))

                const statBox: React.CSSProperties = {
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: 10,
                  minWidth: 0,
                }

                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Start</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{`${start.toFixed(1)}s`}</div>
                        <div style={{ height: 1, background: 'rgba(255,255,255,0.14)', margin: '6px 0' }} />
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#bbb' }}>0.0s</div>
                      </div>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>Total</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{`${dur.toFixed(1)}s`}</div>
                        <div style={{ height: 1, background: 'rgba(255,255,255,0.14)', margin: '6px 0' }} />
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#bbb' }}>{safeMax != null ? `${safeMax.toFixed(1)}s` : '—'}</div>
                      </div>
                      <div style={statBox}>
                        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>End</div>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>{`${end.toFixed(1)}s`}</div>
                        <div style={{ height: 1, background: 'rgba(255,255,255,0.14)', margin: '6px 0' }} />
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#bbb' }}>{safeMax != null ? `${safeMax.toFixed(1)}s` : '—'}</div>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Freeze Frames - Duration: 2.0s</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', flex: '1 1 auto' }}>
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
                            First Frame
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
                            Last Frame
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
            </div>
          </div>
        </div>
	      ) : null}

		      {narrationEditor ? (
		        <div
		          role="dialog"
		          aria-modal="true"
		          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
		          onClick={() => { setNarrationEditor(null); setNarrationEditorError(null) }}
		        >
	          <div
	            onClick={(e) => e.stopPropagation()}
	            style={{ maxWidth: 560, margin: '0 auto', borderRadius: 14, border: '1px solid rgba(191,90,242,0.55)', background: 'rgba(15,15,15,0.96)', padding: 16 }}
	          >
	            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
	              <div style={{ fontSize: 18, fontWeight: 900 }}>Narration Properties</div>
	              <button type="button" onClick={() => { setNarrationEditor(null); setNarrationEditorError(null) }} style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>
	                Close
	              </button>
	            </div>

	            {(() => {
	              const seg = narration.find((n: any) => String((n as any).id) === String(narrationEditor.id)) as any
	              const uploadId = seg ? Number(seg.uploadId) : null
	              const name = uploadId != null ? (namesByUploadId[uploadId] || `Narration ${uploadId}`) : 'Narration'
	              const isPlaying = uploadId != null && audioPreviewPlayingId === uploadId
	              return (
	                <div style={{ marginTop: 10, color: '#bbb', fontSize: 13 }}>
	                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
	                    <div style={{ fontWeight: 900, color: '#fff' }}>{name}</div>
	                    {uploadId != null ? (
	                      <button
	                        type="button"
	                        onClick={() => toggleAudioPreview(uploadId)}
	                        style={{
	                          padding: '8px 10px',
	                          borderRadius: 10,
	                          border: '1px solid rgba(255,255,255,0.18)',
	                          background: isPlaying ? 'rgba(48,209,88,0.20)' : 'rgba(255,255,255,0.06)',
	                          color: '#fff',
	                          fontWeight: 900,
	                          cursor: 'pointer',
	                        }}
	                      >
	                        {isPlaying ? 'Pause preview' : 'Play preview'}
	                      </button>
	                    ) : null}
	                  </div>
	                </div>
	              )
	            })()}

	            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
	              <label style={{ display: 'grid', gap: 6 }}>
	                <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
	                <input
	                  type="number"
	                  step={0.1}
	                  min={0}
	                  value={String(narrationEditor.start)}
	                  onChange={(e) => { setNarrationEditorError(null); setNarrationEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
	                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
	                />
	              </label>
	              <label style={{ display: 'grid', gap: 6 }}>
	                <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
	                <input
	                  type="number"
	                  step={0.1}
	                  min={0}
	                  value={String(narrationEditor.end)}
	                  onChange={(e) => { setNarrationEditorError(null); setNarrationEditor((p) => p ? ({ ...p, end: Number(e.target.value) }) : p) }}
	                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14 }}
	                />
	              </label>

	              <label style={{ display: 'grid', gap: 6 }}>
	                <div style={{ color: '#bbb', fontSize: 13 }}>Gain (dB)</div>
	                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
	                  <input
	                    type="range"
	                    min={-12}
	                    max={12}
	                    step={1}
	                    value={String(narrationEditor.gainDb)}
	                    onChange={(e) => { setNarrationEditorError(null); setNarrationEditor((p) => p ? ({ ...p, gainDb: Number(e.target.value) }) : p) }}
	                  />
	                  <div style={{ fontWeight: 900, color: '#fff', width: 64, textAlign: 'right' }}>{Number(narrationEditor.gainDb).toFixed(0)} dB</div>
	                </div>
	              </label>

	              {narrationEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{narrationEditorError}</div> : null}
	              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
	                <button
	                  type="button"
	                  onClick={saveNarrationEditor}
	                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
	                >
	                  Save
	                </button>
	              </div>
	            </div>
	          </div>
		        </div>
		      ) : null}

		      {timelineCtxMenu ? (
		        <div
		          role="dialog"
		          aria-modal="true"
		          style={{ position: 'fixed', inset: 0, zIndex: 1400 }}
		          onClickCapture={(e) => {
		            const openedAt = timelineCtxMenuOpenedAtRef.current
		            if (openedAt == null) return
		            if (performance.now() - openedAt < 120) {
		              timelineCtxMenuOpenedAtRef.current = null
		              e.preventDefault()
		              e.stopPropagation()
		            }
		          }}
		          onPointerDown={() => setTimelineCtxMenu(null)}
		        >
		          <div
		            style={{
		              position: 'fixed',
		              left: timelineCtxMenu.x,
		              top: timelineCtxMenu.y,
		              width: 170,
		              background: '#0756a6',
		              border: '1px solid rgba(255,255,255,0.18)',
		              borderRadius: 12,
		              padding: 8,
		              display: 'grid',
		              gap: 8,
		              boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
		            }}
		            onPointerDown={(e) => e.stopPropagation()}
			          >
			            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 4px' }}>
			              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
			                {(timelineCtxMenu.view || 'main') === 'guidelines' ? (
			                  <button
			                    type="button"
			                    onClick={() => setTimelineCtxMenu((prev) => (prev ? { ...prev, view: 'main' } : prev))}
			                    style={{
			                      width: 28,
			                      height: 28,
			                      borderRadius: 10,
			                      border: '1px solid rgba(255,255,255,0.18)',
			                      background: '#000',
			                      color: '#fff',
			                      fontWeight: 900,
			                      cursor: 'pointer',
			                      lineHeight: '26px',
			                      textAlign: 'center',
			                    }}
			                    aria-label="Back"
			                  >
			                    ←
			                  </button>
			                ) : null}
			                <div style={{ fontSize: 13, fontWeight: 900, color: '#bbb' }}>
					                  {(timelineCtxMenu.view || 'main') === 'guidelines'
					                    ? 'Guidelines'
					                    : timelineCtxMenu.kind === 'audioSegment'
					                      ? 'Audio'
					                    : timelineCtxMenu.kind === 'still'
					                      ? 'Freeze Frame'
					                    : timelineCtxMenu.kind === 'logo'
					                      ? 'Logo'
					                      : timelineCtxMenu.kind === 'lowerThird'
				                        ? 'Lower Third'
				                        : timelineCtxMenu.kind === 'screenTitle'
				                          ? 'Screen Title'
				                          : timelineCtxMenu.kind === 'narration'
				                            ? 'Narration'
				                          : timelineCtxMenu.kind === 'clip'
				                            ? 'Video'
				                        : 'Graphic'}
				                </div>
			              </div>
			              <button
			                type="button"
			                onClick={() => setTimelineCtxMenu(null)}
			                style={{
			                  width: 28,
			                  height: 28,
			                  borderRadius: 10,
			                  border: '1px solid rgba(255,255,255,0.18)',
			                  background: '#000',
			                  color: '#fff',
			                  fontWeight: 900,
			                  cursor: 'pointer',
			                  lineHeight: '26px',
			                  textAlign: 'center',
			                }}
			              >
			                ×
			              </button>
			            </div>

			            {(timelineCtxMenu.view || 'main') === 'main' ? (
			              <>
			                <button
			                  type="button"
			                  onClick={() => {
			                    if (timelineCtxMenu.kind === 'graphic') {
			                      const g = graphics.find((gg) => String((gg as any).id) === String(timelineCtxMenu.id)) as any
			                      if (g) {
			                        const s = roundToTenth(Number((g as any).startSeconds || 0))
			                        const e2 = roundToTenth(Number((g as any).endSeconds || 0))
			                        setSelectedGraphicId(String((g as any).id))
			                        setSelectedClipId(null)
			                        setSelectedLogoId(null)
			                        setSelectedLowerThirdId(null)
			                        setSelectedScreenTitleId(null)
			                        setSelectedNarrationId(null)
			                        setSelectedStillId(null)
			                        setSelectedAudioId(null)
			                        setGraphicEditor({ id: String((g as any).id), start: s, end: e2 })
			                        setGraphicEditorError(null)
			                      }
			                    } else if (timelineCtxMenu.kind === 'logo') {
			                      const l = logos.find((ll) => String((ll as any).id) === String(timelineCtxMenu.id)) as any
			                      if (l) {
			                        const s = roundToTenth(Number((l as any).startSeconds || 0))
			                        const e2 = roundToTenth(Number((l as any).endSeconds || 0))
			                        setSelectedLogoId(String((l as any).id))
			                        setSelectedClipId(null)
			                        setSelectedGraphicId(null)
			                        setSelectedLowerThirdId(null)
			                        setSelectedScreenTitleId(null)
			                        setSelectedNarrationId(null)
			                        setSelectedStillId(null)
			                        setSelectedAudioId(null)
			                        setLogoEditor({ id: String((l as any).id), start: s, end: e2, configId: Number((l as any).configId || 0) })
			                        setLogoEditorError(null)
			                      }
			                    } else if (timelineCtxMenu.kind === 'lowerThird') {
			                      const lt = lowerThirds.find((ll) => String((ll as any).id) === String(timelineCtxMenu.id)) as any
			                      if (lt) {
			                        const s = roundToTenth(Number((lt as any).startSeconds || 0))
			                        const e2 = roundToTenth(Number((lt as any).endSeconds || 0))
			                        setSelectedLowerThirdId(String((lt as any).id))
			                        setSelectedClipId(null)
			                        setSelectedGraphicId(null)
			                        setSelectedLogoId(null)
			                        setSelectedScreenTitleId(null)
			                        setSelectedNarrationId(null)
			                        setSelectedStillId(null)
			                        setSelectedAudioId(null)
			                        setLowerThirdEditor({
			                          id: String((lt as any).id),
			                          start: s,
			                          end: e2,
			                          configId: Number((lt as any).configId || 0),
			                        })
			                        setLowerThirdEditorError(null)
			                      }
			                    } else if (timelineCtxMenu.kind === 'screenTitle') {
			                      const st = screenTitles.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
			                      if (st) {
			                        const s = roundToTenth(Number((st as any).startSeconds || 0))
			                        const e2 = roundToTenth(Number((st as any).endSeconds || 0))
			                        const presetId = Number((st as any).presetId || 0)
			                        const text = String((st as any).text || '')
			                        setSelectedScreenTitleId(String((st as any).id))
			                        setSelectedClipId(null)
			                        setSelectedGraphicId(null)
			                        setSelectedLogoId(null)
			                        setSelectedLowerThirdId(null)
			                        setSelectedNarrationId(null)
			                        setSelectedStillId(null)
			                        setSelectedAudioId(null)
			                        setScreenTitleEditor({ id: String((st as any).id), start: s, end: e2, presetId, text })
			                        setScreenTitleEditorError(null)
			                      }
			                    } else if (timelineCtxMenu.kind === 'still') {
			                      const s0 = stills.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
			                      if (s0) {
			                        const s = roundToTenth(Number((s0 as any).startSeconds || 0))
			                        const e2 = roundToTenth(Number((s0 as any).endSeconds || 0))
			                        setSelectedStillId(String((s0 as any).id))
			                        setSelectedClipId(null)
			                        setSelectedGraphicId(null)
			                        setSelectedLogoId(null)
			                        setSelectedLowerThirdId(null)
			                        setSelectedScreenTitleId(null)
			                        setSelectedNarrationId(null)
			                        setSelectedAudioId(null)
			                        setStillEditor({ id: String((s0 as any).id), start: s, end: e2 })
			                        setStillEditorError(null)
			                      }
				                    } else if (timelineCtxMenu.kind === 'clip') {
				                      const idx = timeline.clips.findIndex((c) => String(c.id) === String(timelineCtxMenu.id))
				                      if (idx >= 0) {
				                        const clip = timeline.clips[idx]
				                        setSelectedClipId(String(clip.id))
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
				                        setClipEditor({ id: clip.id, start: clip.sourceStartSeconds, end: clip.sourceEndSeconds })
				                        setClipEditorError(null)
				                        setFreezeInsertError(null)
				                      }
					                    } else if (timelineCtxMenu.kind === 'narration') {
					                      const n = narration.find((nn: any) => String((nn as any).id) === String(timelineCtxMenu.id)) as any
					                      if (n) {
				                        const s = roundToTenth(Number((n as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((n as any).endSeconds || 0))
				                        setSelectedNarrationId(String((n as any).id))
				                        setSelectedClipId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
				                        setNarrationEditor({
				                          id: String((n as any).id),
				                          start: s,
				                          end: e2,
				                          gainDb: (n as any).gainDb == null ? 0 : Number((n as any).gainDb),
				                        })
					                        setNarrationEditorError(null)
					                      }
					                    } else if (timelineCtxMenu.kind === 'audioSegment') {
					                      const seg = audioSegments.find((aa: any) => String((aa as any).id) === String(timelineCtxMenu.id)) as any
					                      if (seg) {
					                        const s = roundToTenth(Number((seg as any).startSeconds || 0))
					                        const e2 = roundToTenth(Number((seg as any).endSeconds || 0))
					                        setSelectedAudioId(String((seg as any).id))
					                        setSelectedClipId(null)
					                        setSelectedGraphicId(null)
					                        setSelectedLogoId(null)
					                        setSelectedLowerThirdId(null)
					                        setSelectedScreenTitleId(null)
					                        setSelectedNarrationId(null)
					                        setSelectedStillId(null)
					                        setAudioEditorError(null)
					                        void (async () => {
					                          try {
					                            await ensureAudioConfigs()
					                          } catch {}
					                        })()
					                        setAudioEditor({
					                          id: String((seg as any).id),
					                          start: s,
					                          end: e2,
					                          audioConfigId: Number((seg as any).audioConfigId),
					                        })
					                      }
					                    }
					                    setTimelineCtxMenu(null)
					                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,255,255,0.18)',
			                    background: '#000',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
			                >
			                  Properties
			                </button>
			                {(timelineCtxMenu.edgeIntent || 'move') !== 'move' ? (
			                  <button
			                    type="button"
			                    onClick={() => setTimelineCtxMenu((prev) => (prev ? { ...prev, view: 'guidelines' } : prev))}
			                    style={{
			                      width: '100%',
			                      padding: '10px 12px',
			                      borderRadius: 10,
			                      border: '1px solid rgba(255,255,255,0.18)',
			                      background: '#000',
			                      color: '#fff',
			                      fontWeight: 900,
			                      cursor: 'pointer',
			                      textAlign: 'left',
			                    }}
			                  >
			                    Guidelines…
			                  </button>
			                ) : null}
			                <button
			                  type="button"
				                  onClick={() => {
				                    if (timelineCtxMenu.kind === 'graphic') splitGraphicById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'still') splitStillById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'logo') splitLogoById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'lowerThird') splitLowerThirdById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'screenTitle') splitScreenTitleById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'clip') splitClipById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'narration') splitNarrationById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'audioSegment') splitAudioSegmentById(timelineCtxMenu.id)
				                    setTimelineCtxMenu(null)
				                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,255,255,0.18)',
			                    background: '#000',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
			                >
			                  Split
			                </button>
			                <button
			                  type="button"
				                  onClick={() => {
				                    if (timelineCtxMenu.kind === 'graphic') duplicateGraphicById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'still') duplicateStillById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'logo') duplicateLogoById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'lowerThird') duplicateLowerThirdById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'screenTitle') duplicateScreenTitleById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'clip') duplicateClipById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'narration') duplicateNarrationById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'audioSegment') duplicateAudioSegmentById(timelineCtxMenu.id)
				                    setTimelineCtxMenu(null)
				                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,255,255,0.18)',
			                    background: '#000',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
			                >
			                  Duplicate
			                </button>
			                <button
			                  type="button"
				                  onClick={() => {
				                    if (timelineCtxMenu.kind === 'graphic') deleteGraphicById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'still') deleteStillById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'logo') deleteLogoById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'lowerThird') deleteLowerThirdById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'screenTitle') deleteScreenTitleById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'clip') deleteClipById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'narration') deleteNarrationById(timelineCtxMenu.id)
				                    if (timelineCtxMenu.kind === 'audioSegment') deleteAudioSegmentById(timelineCtxMenu.id)
				                    setTimelineCtxMenu(null)
				                  }}
			                  style={{
			                    width: '100%',
			                    padding: '10px 12px',
			                    borderRadius: 10,
			                    border: '1px solid rgba(255,155,155,0.40)',
			                    background: '#300',
			                    color: '#fff',
			                    fontWeight: 900,
			                    cursor: 'pointer',
			                    textAlign: 'left',
			                  }}
			                >
			                  Delete
			                </button>
			              </>
			            ) : (
			              <>
			                {(() => {
			                  const edgeIntent: any = timelineCtxMenu.edgeIntent || 'move'
			                  if (edgeIntent === 'move') return null
			                  const expandAction = edgeIntent === 'start' ? 'expand_start' : 'expand_end'
			                  const contractAction = edgeIntent === 'start' ? 'contract_start' : 'contract_end'
			                  const expandLabel = edgeIntent === 'start' ? 'Expand \u2190' : 'Expand \u2192'
			                  const contractLabel = edgeIntent === 'start' ? 'Contract \u2192' : 'Contract \u2190'
			                  const snapLabel = edgeIntent === 'start' ? 'Snap to \u2190' : 'Snap to \u2192'
			                  return (
			                    <>
			                      <button
			                        type="button"
					                        onClick={() => {
					                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
					                          setTimelineCtxMenu(null)
					                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '1px solid rgba(255,255,255,0.18)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {expandLabel}
			                      </button>
			                      <button
			                        type="button"
					                        onClick={() => {
					                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
					                          setTimelineCtxMenu(null)
					                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '1px solid rgba(255,255,255,0.18)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {contractLabel}
			                      </button>
			                      <button
			                        type="button"
					                        onClick={() => {
					                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
					                          setTimelineCtxMenu(null)
					                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '1px solid rgba(255,255,255,0.18)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {snapLabel}
			                      </button>
			                    </>
			                  )
			                })()}
			              </>
			            )}
			          </div>
			        </div>
			      ) : null}

		      {guidelineMenuOpen ? (
		        <div
		          role="dialog"
		          aria-modal="true"
		          style={{ position: 'fixed', inset: 0, zIndex: 1400 }}
		          onPointerDown={() => closeGuidelineMenu()}
		        >
		          <div
		            style={{
		              position: 'fixed',
		              left: '50%',
		              top: '50%',
		              transform: 'translate(-50%, -50%)',
		              width: 200,
		              background: 'rgba(0,0,0,0.92)',
		              border: '1px solid rgba(255,255,255,0.18)',
		              borderRadius: 12,
		              padding: 8,
		              display: 'grid',
		              gap: 8,
		              boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
		            }}
		            onPointerDown={(e) => e.stopPropagation()}
		          >
		            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 4px' }}>
		              <div style={{ fontSize: 13, fontWeight: 900, color: '#bbb' }}>Guidelines</div>
		              <button
		                type="button"
		                onClick={() => closeGuidelineMenu()}
		                style={{
		                  width: 28,
		                  height: 28,
		                  borderRadius: 10,
		                  border: '1px solid rgba(255,255,255,0.18)',
		                  background: 'rgba(255,255,255,0.06)',
		                  color: '#fff',
		                  fontWeight: 900,
		                  cursor: 'pointer',
		                  lineHeight: '26px',
		                  textAlign: 'center',
		                }}
		              >
		                ×
		              </button>
		            </div>

		            <button
		              type="button"
		              disabled={!guidelines.length}
		              onClick={() => {
		                removeNearestGuideline()
		                closeGuidelineMenu()
		              }}
		              style={{
		                width: '100%',
		                padding: '10px 12px',
		                borderRadius: 10,
		                border: '1px solid rgba(255,255,255,0.18)',
		                background: guidelines.length ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.06)',
		                color: '#fff',
		                fontWeight: 900,
		                cursor: guidelines.length ? 'pointer' : 'default',
		                textAlign: 'left',
		              }}
		            >
		              Remove nearest
		            </button>

		            <button
		              type="button"
		              disabled={!guidelines.length}
		              onClick={() => {
		                removeAllGuidelines()
		                closeGuidelineMenu()
		              }}
		              style={{
		                width: '100%',
		                padding: '10px 12px',
		                borderRadius: 10,
		                border: '1px solid rgba(255,155,155,0.40)',
		                background: guidelines.length ? 'rgba(255,0,0,0.14)' : 'rgba(255,255,255,0.06)',
		                color: '#fff',
		                fontWeight: 900,
		                cursor: guidelines.length ? 'pointer' : 'default',
		                textAlign: 'left',
		              }}
		            >
		              Remove all
		            </button>
		          </div>
		        </div>
		      ) : null}
	    </div>
	  )
}
