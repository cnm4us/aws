import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUploadCdnUrl } from '../ui/uploadsCdn'
import type {
  AudioSegment,
  AudioTrack,
  Clip,
  Graphic,
  Logo,
  LowerThird,
  LowerThirdConfigSnapshot,
  Narration,
  ScreenTitle,
  Still,
  Timeline,
  VideoOverlay,
  VideoOverlayStill,
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
  insertVideoOverlayAtPlayhead,
  splitAudioSegmentAtPlayhead,
  splitClipAtPlayhead,
  splitGraphicAtPlayhead,
  splitStillAtPlayhead,
  splitVideoOverlayStillAtPlayhead,
  splitLogoAtPlayhead,
  splitLowerThirdAtPlayhead,
  splitNarrationAtPlayhead,
  splitScreenTitleAtPlayhead,
  splitVideoOverlayAtPlayhead,
} from './createVideo/timelineOps'

const UNDO_ICON_URL = new URL('./icons/undo.svg', import.meta.url).toString()
const REDO_ICON_URL = new URL('./icons/redo.svg', import.meta.url).toString()
const PLUS_ICON_URL = new URL('./icons/plus.svg', import.meta.url).toString()
const RIPPLE_ICON_URL = new URL('./icons/ripple.svg', import.meta.url).toString()
const FLOAT_ICON_URL = new URL('./icons/float.svg', import.meta.url).toString()

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
  image_role?: string | null
  uploaded_at?: string | null
  created_at: string
  s3_key?: string | null
  video_role?: string | null
}

type UploadSummary = { id: number; original_filename: string; modified_filename: string | null; duration_seconds?: number | null }

type Project = {
  id: number
  name?: string | null
  description?: string | null
  status: string
  timeline: Timeline
  lastExportJobId?: number | null
  lastExportUploadId?: number | null
}

type ProjectListItem = {
  id: number
  name: string | null
  description: string | null
  status: string
  lastExportUploadId: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

type SystemAudioItem = UploadListItem & {
  artist?: string | null
}

type AudioTagSummary = { id: number; name: string; slug: string }
type AudioTagsDto = {
  genres: AudioTagSummary[]
  moods: AudioTagSummary[]
  themes: AudioTagSummary[]
  instruments: AudioTagSummary[]
}

type AudioConfigItem = {
  id: number
  name: string
  mode: string
  duckingMode?: string
}

type LowerThirdConfigItem = LowerThirdConfigSnapshot

type ScreenTitlePresetItem = {
  id: number
  name: string
  style: string
  fontKey: string
  fontSizePct: number
  trackingPct: number
  lineSpacingPct?: number
  fontColor: string
  shadowColor?: string
  shadowOffsetPx?: number
  shadowBlurPx?: number
  shadowOpacityPct?: number
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

const CURRENT_PROJECT_ID_KEY = 'createVideoCurrentProjectId:v1'

const hexToRgba = (hex: string, alpha: number): string => {
  const raw = String(hex || '').trim()
  const cleaned = raw.startsWith('#') ? raw.slice(1) : raw
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return `rgba(0,0,0,${alpha})`
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

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
    // Prefer a parser over regex so we mirror server behavior if duplicate cookie names exist.
    // (Server parseCookies overwrites earlier entries; we do the same here.)
    const cookies: Record<string, string> = {}
    const raw = String(document.cookie || '')
    if (!raw) return null
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=')
      if (idx < 0) continue
      const name = part.slice(0, idx).trim()
      if (!name) continue
      const value = decodeURIComponent(part.slice(idx + 1).trim())
      cookies[name] = value
    }
    return cookies.csrf || null
  } catch {
    return null
  }
}

function fmtDefaultTimelineName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
    now.getSeconds()
  )}`
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
  insetXPx?: number | null
  insetYPx?: number | null
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
  // Inset is specified in px relative to a 1080×1920 baseline (Create Video export resolution).
  // If missing, fall back to legacy preset-based insets.
  const insetXPxRaw = cfg.insetXPx != null ? Number(cfg.insetXPx) : NaN
  const insetYPxRaw = cfg.insetYPx != null ? Number(cfg.insetYPx) : NaN
  const insetXPct = Number.isFinite(insetXPxRaw) ? (clampNumber(insetXPxRaw, 0, 9999) / 1080) * 100 : insetPctForPreset(cfg.insetXPreset) * 100
  const insetYPct = Number.isFinite(insetYPxRaw) ? (clampNumber(insetYPxRaw, 0, 9999) / 1920) * 100 : insetPctForPreset(cfg.insetYPreset) * 100
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
    videoOverlays: [],
    videoOverlayStills: [],
    graphics: [],
    logos: [],
    lowerThirds: [],
    screenTitles: [],
    narration: [],
    audioSegments: [],
    audioTrack: null,
  })
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedVideoOverlayId, setSelectedVideoOverlayId] = useState<string | null>(null)
  const [selectedVideoOverlayStillId, setSelectedVideoOverlayStillId] = useState<string | null>(null)
  const [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null)
  const [selectedLogoId, setSelectedLogoId] = useState<string | null>(null)
  const [selectedLowerThirdId, setSelectedLowerThirdId] = useState<string | null>(null)
  const [selectedScreenTitleId, setSelectedScreenTitleId] = useState<string | null>(null)
  const [selectedNarrationId, setSelectedNarrationId] = useState<string | null>(null)
  const [selectedStillId, setSelectedStillId] = useState<string | null>(null)
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null)

  const playPauseGlyph = (isPlaying: boolean) => (isPlaying ? '||' : '▶')

  const activeVideoOverlayIndexRef = useRef(0)
  const [namesByUploadId, setNamesByUploadId] = useState<Record<number, string>>({})
  const [durationsByUploadId, setDurationsByUploadId] = useState<Record<number, number>>({})
  const [dimsByUploadId, setDimsByUploadId] = useState<Record<number, { width: number; height: number }>>({})
  const [clipEditor, setClipEditor] = useState<{ id: string; start: number; end: number; boostDb: number } | null>(null)
  const [clipEditorError, setClipEditorError] = useState<string | null>(null)
  const [freezeInsertSeconds, setFreezeInsertSeconds] = useState<number>(2)
  const [freezeInsertBusy, setFreezeInsertBusy] = useState(false)
  const [freezeInsertError, setFreezeInsertError] = useState<string | null>(null)
  const [overlayFreezeInsertBusy, setOverlayFreezeInsertBusy] = useState(false)
  const [overlayFreezeInsertError, setOverlayFreezeInsertError] = useState<string | null>(null)

  // Freeze insertion duration is fixed in v1.
  useEffect(() => {
    if (!clipEditor) return
    setFreezeInsertSeconds(2)
  }, [clipEditor])
  const [lowerThirdConfigs, setLowerThirdConfigs] = useState<LowerThirdConfigItem[]>([])
  const [lowerThirdConfigsLoaded, setLowerThirdConfigsLoaded] = useState(false)
  const [lowerThirdConfigsError, setLowerThirdConfigsError] = useState<string | null>(null)
  const [graphicEditor, setGraphicEditor] = useState<{
    id: string
    start: number
    end: number
    fitMode: 'cover_full' | 'contain_transparent'
    sizePctWidth: number
    position:
      | 'top_left'
      | 'top_center'
      | 'top_right'
      | 'middle_left'
      | 'middle_center'
      | 'middle_right'
      | 'bottom_left'
      | 'bottom_center'
      | 'bottom_right'
    insetXPx: number
    insetYPx: number
    borderWidthPx: 0 | 2 | 4 | 6
    borderColor: string
    fade: 'none' | 'in' | 'out' | 'in_out'
  } | null>(null)
  const [graphicEditorError, setGraphicEditorError] = useState<string | null>(null)
  const [stillEditor, setStillEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [stillEditorError, setStillEditorError] = useState<string | null>(null)
  const [videoOverlayStillEditor, setVideoOverlayStillEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [videoOverlayStillEditorError, setVideoOverlayStillEditorError] = useState<string | null>(null)
	  const [logoEditor, setLogoEditor] = useState<{
	    id: string
	    start: number
	    end: number
	    sizePctWidth: number
	    insetPreset: 'small' | 'medium' | 'large'
	    position:
	      | 'top_left'
	      | 'top_center'
	      | 'top_right'
	      | 'middle_left'
      | 'middle_center'
      | 'middle_right'
      | 'bottom_left'
      | 'bottom_center'
      | 'bottom_right'
	    opacityPct: number
	    fade: 'none' | 'in' | 'out' | 'in_out'
	  } | null>(null)
  const [logoEditorError, setLogoEditorError] = useState<string | null>(null)
  const [videoOverlayEditor, setVideoOverlayEditor] = useState<{
    id: string
    sizePctWidth: number
    position: VideoOverlay['position']
    audioEnabled: boolean
    boostDb: number
    plateStyle: 'none' | 'thin' | 'medium' | 'thick' | 'band'
    plateColor: string
    plateOpacityPct: number
  } | null>(null)
  const [videoOverlayEditorError, setVideoOverlayEditorError] = useState<string | null>(null)
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
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [audioPreviewPlayingId, setAudioPreviewPlayingId] = useState<number | null>(null)
  const [audioConfigs, setAudioConfigs] = useState<AudioConfigItem[]>([])
  const [audioConfigsLoaded, setAudioConfigsLoaded] = useState(false)
  const [audioConfigsError, setAudioConfigsError] = useState<string | null>(null)
  const [audioEditor, setAudioEditor] = useState<{
    id: string
    start: number
    end: number
    audioConfigId: number
    musicMode: '' | 'opener_cutoff' | 'replace' | 'mix' | 'mix_duck'
    musicLevel: '' | 'quiet' | 'medium' | 'loud'
    duckingIntensity: '' | 'min' | 'medium' | 'max'
  } | null>(null)
  const [audioEditorError, setAudioEditorError] = useState<string | null>(null)
  const [narrationEditor, setNarrationEditor] = useState<{ id: string; start: number; end: number; boostDb: number } | null>(null)
  const [narrationEditorError, setNarrationEditorError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayVideoRef = useRef<HTMLVideoElement | null>(null)
  const [previewObjectFit, setPreviewObjectFit] = useState<'cover' | 'contain'>('cover')
  const [playing, setPlaying] = useState(false)
  const [activeUploadId, setActiveUploadId] = useState<number | null>(null)
  const [overlayActiveUploadId, setOverlayActiveUploadId] = useState<number | null>(null)
  // Tracks which upload ID is currently loaded into each <video> element's src, even if we temporarily
  // hide it by setting activeUploadId=null (e.g. while showing a freeze-frame still overlay).
  // This helps iOS Safari: if we can avoid an async src swap, we can seek + play within the user gesture.
  const baseLoadedUploadIdRef = useRef<number | null>(null)
  const overlayLoadedUploadIdRef = useRef<number | null>(null)
  const playbackClockRef = useRef<'base' | 'overlay' | 'synthetic'>('base')
  const playheadRef = useRef(0)
  const playingRef = useRef(false)
  const activeClipIndexRef = useRef(0)
  const playheadFromVideoRef = useRef(false)
  const suppressNextVideoPauseRef = useRef(false)
  const gapPlaybackRef = useRef<{ raf: number; target: number; nextClipIndex: number | null } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exportJobId, setExportJobId] = useState<number | null>(null)
  const [timelineMessage, setTimelineMessage] = useState<string | null>(null)
  const [guidelineMenuOpen, setGuidelineMenuOpen] = useState(false)
  const guidelinePressRef = useRef<{ timer: number | null; fired: boolean } | null>(null)
  const timelineCtxMenuOpenedAtRef = useRef<number | null>(null)
  const previewWrapRef = useRef<HTMLDivElement | null>(null)
  const [previewSize, setPreviewSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const previewToolbarRef = useRef<HTMLDivElement | null>(null)
  const previewMiniTimelineRef = useRef<HTMLCanvasElement | null>(null)
  const [previewBoxSize, setPreviewBoxSize] = useState<{ w: number; h: number }>({ w: 1080, h: 1920 })
  const [showPreviewToolbar, setShowPreviewToolbar] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem('cv_preview_toolbar_v1')
      if (!raw) return false
      const v = JSON.parse(raw)
      return Boolean(v?.enabled)
    } catch {
      return false
    }
  })
  const [previewToolbarBottomPx, setPreviewToolbarBottomPx] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem('cv_preview_toolbar_v1')
      if (!raw) return 12
      const v = JSON.parse(raw)
      const n = Number(v?.bottomPx)
      if (Number.isFinite(n) && n >= 0) return n
      return 12
    } catch {
      return 12
    }
  })
  const previewToolbarDragRef = useRef<null | { pointerId: number; startY: number; startBottom: number }>(null)
  const [previewToolbarDragging, setPreviewToolbarDragging] = useState(false)
  const previewMiniDragRef = useRef<null | { pointerId: number; startX: number; startPlayhead: number }>(null)
  const [timelineCtxMenu, setTimelineCtxMenu] = useState<
    | null
    | {
        kind:
          | 'graphic'
          | 'still'
          | 'videoOverlayStill'
          | 'logo'
          | 'lowerThird'
          | 'screenTitle'
          | 'videoOverlay'
          | 'clip'
          | 'narration'
          | 'audioSegment'
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
      selectedVideoOverlayId: string | null
      selectedVideoOverlayStillId: string | null
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
      selectedVideoOverlayId: string | null
      selectedVideoOverlayStillId: string | null
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
  const [rippleEnabled, setRippleEnabled] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem('cv_ripple_v1')
      if (!raw) return false
      const v = JSON.parse(raw)
      return Boolean(v?.enabled)
    } catch {
      return false
    }
  })
  const rippleEnabledRef = useRef(false)
  useEffect(() => {
    rippleEnabledRef.current = rippleEnabled
    try {
      window.localStorage.setItem('cv_ripple_v1', JSON.stringify({ enabled: rippleEnabled }))
    } catch {}
  }, [rippleEnabled])
	  const lastSavedRef = useRef<string>('')
	  const timelineSaveAbortRef = useRef<AbortController | null>(null)
	  const hydratingRef = useRef(false)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const [timelineScrollEl, setTimelineScrollEl] = useState<HTMLDivElement | null>(null)
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [timelinePadPx, setTimelinePadPx] = useState(0)
  const playheadFromScrollRef = useRef(false)
  const ignoreScrollRef = useRef(false)
  const [timelineScrollLeftPx, setTimelineScrollLeftPx] = useState(0)
  const primedFrameSrcRef = useRef<string>('')
  const primedOverlayFrameSrcRef = useRef<string>('')
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
	        kind: 'videoOverlay'
	        videoOverlayId: string
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
	        // For trim (prevent overlapping the next overlay segment on the timeline)
	        maxTimelineDurationSeconds?: number
	        // For armed body/edge drag (so a click can still open the context menu)
	        armed?: boolean
	        moved?: boolean
	      }
	    | {
	        kind: 'videoOverlayStill'
	        videoOverlayStillId: string
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

  // (hasPlayablePreview + related effects are defined later, after totalSeconds is initialized)

  useEffect(() => {
    const el = previewWrapRef.current
    if (!el) return
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(() => {
        try {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) setPreviewBoxSize({ w: r.width, h: r.height })
        } catch {}
      })
      ro.observe(el)
    } catch {}
    // Initialize once.
    try {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setPreviewBoxSize({ w: r.width, h: r.height })
    } catch {}
    return () => {
      try { ro?.disconnect?.() } catch {}
    }
  }, [])

  useEffect(() => {
    if (!previewToolbarDragging) return
    const onMove = (e: PointerEvent) => {
      const cur = previewToolbarDragRef.current
      if (!cur) return
      if (e.pointerId !== cur.pointerId) return
      const el = previewWrapRef.current
      if (!el) return
      const h = el.getBoundingClientRect().height
      const barH = previewToolbarRef.current?.getBoundingClientRect().height || 56
      const min = 8
      const max = Math.max(min, Math.floor(h - barH - 8))
      const dy = e.clientY - cur.startY
      const next = clamp(cur.startBottom - dy, min, max)
      setPreviewToolbarBottomPx(next)
    }
    const onUp = (e: PointerEvent) => {
      const cur = previewToolbarDragRef.current
      if (!cur) return
      if (e.pointerId !== cur.pointerId) return
      previewToolbarDragRef.current = null
      setPreviewToolbarDragging(false)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [previewToolbarDragging])
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
          selectedVideoOverlayId,
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
      selectedVideoOverlayId,
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

		  const playWithAutoplayFallback = useCallback(async (v: HTMLVideoElement, opts?: { unmuteAfterPlay?: boolean }): Promise<boolean> => {
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
	      if (opts?.unmuteAfterPlay !== false) {
	        window.setTimeout(() => {
	          try {
	            v.muted = false
	            v.volume = 1
	          } catch {}
	        }, 0)
	      }
	      return true
	    }
	    return false
		  }, [])

	  const videoOverlays = useMemo(
	    () => (Array.isArray((timeline as any).videoOverlays) ? ((timeline as any).videoOverlays as VideoOverlay[]) : []),
	    [timeline]
	  )

	  const videoOverlayStills = useMemo(
	    () => (Array.isArray((timeline as any).videoOverlayStills) ? ((timeline as any).videoOverlayStills as VideoOverlayStill[]) : []),
	    [timeline]
	  )

	  const clipStarts = useMemo(() => computeClipStarts(timeline.clips), [timeline.clips])
	  const totalSecondsVideo = useMemo(() => computeTimelineEndSecondsFromClips(timeline.clips, clipStarts), [clipStarts, timeline.clips])
	  const videoOverlayStarts = useMemo(() => computeClipStarts(videoOverlays as any), [videoOverlays])
	  const totalSecondsVideoOverlays = useMemo(
	    () => computeTimelineEndSecondsFromClips(videoOverlays as any, videoOverlayStarts),
	    [videoOverlayStarts, videoOverlays]
	  )
  const totalSecondsVideoOverlayStills = useMemo(() => {
    let m = 0
    for (const s of videoOverlayStills as any[]) {
      const e = Number((s as any)?.endSeconds)
      if (Number.isFinite(e) && e > m) m = e
    }
    return Math.max(0, roundToTenth(m))
  }, [videoOverlayStills])
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
  const MAX_TIMELINE_SECONDS = 20 * 60
  const MIN_VIEWPORT_SECONDS = 30
  const VIEWPORT_PAD_SECONDS = 0.5

  const contentTotalSeconds = useMemo(() => {
    let m = Math.max(
      0,
      roundToTenth(
        Math.max(totalSecondsVideo, totalSecondsVideoOverlays, totalSecondsVideoOverlayStills, totalSecondsGraphics, totalSecondsStills)
      )
    )
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
    return Math.max(0, roundToTenth(m))
  }, [timeline, totalSecondsGraphics, totalSecondsStills, totalSecondsVideo, totalSecondsVideoOverlays])

  const viewportEndSecondsRaw = useMemo(() => {
    const v = Number((timeline as any).viewportEndSeconds)
    if (!Number.isFinite(v)) return 0
    return clamp(roundToTenth(v), 0, MAX_TIMELINE_SECONDS)
  }, [timeline])

  // totalSeconds is the editor viewport duration: can be longer than content to allow placing/moving clips later in time.
  const totalSeconds = useMemo(() => {
    const base = Math.max(MIN_VIEWPORT_SECONDS, contentTotalSeconds, viewportEndSecondsRaw)
    return clamp(roundToTenth(base), 0, MAX_TIMELINE_SECONDS)
  }, [contentTotalSeconds, viewportEndSecondsRaw])

  const hasPlayablePreview = useMemo(() => {
    if (!(totalSeconds > 0)) return false
    const nar: any[] = Array.isArray((timeline as any).narration) ? ((timeline as any).narration as any[]) : []
    const segs: any[] = Array.isArray((timeline as any).audioSegments) ? ((timeline as any).audioSegments as any[]) : []
    const hasTrack = Boolean((timeline as any).audioTrack && typeof (timeline as any).audioTrack === 'object')
    return Boolean(timeline.clips.length || videoOverlays.length || nar.length || segs.length || hasTrack)
  }, [totalSeconds, timeline, videoOverlays.length])

  useEffect(() => {
    // Persist toggle + position.
    try {
      window.localStorage.setItem('cv_preview_toolbar_v1', JSON.stringify({ enabled: showPreviewToolbar, bottomPx: previewToolbarBottomPx }))
    } catch {}
  }, [previewToolbarBottomPx, showPreviewToolbar])

  useEffect(() => {
    // Only show when useful; auto-hide if the timeline has no playable sources.
    if (!hasPlayablePreview && showPreviewToolbar) setShowPreviewToolbar(false)
  }, [hasPlayablePreview, showPreviewToolbar])

  useEffect(() => {
    // Clamp toolbar position to the preview container.
    const el = previewWrapRef.current
    if (!el) return
    const clampNow = () => {
      const rect = el.getBoundingClientRect()
      const h = rect.height
      const barH = previewToolbarRef.current?.getBoundingClientRect().height || 56
      const min = 8
      const max = Math.max(min, Math.floor(h - barH - 8))
      setPreviewToolbarBottomPx((b) => clamp(Number(b || 0), min, max))
      if (Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
        setPreviewSize({ w: rect.width, h: rect.height })
      }
    }
    clampNow()
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(() => clampNow())
      ro.observe(el)
    } catch {}
    return () => {
      try { ro?.disconnect?.() } catch {}
    }
  }, [])

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
    const overlays: any[] = Array.isArray((tl as any).videoOverlays) ? (tl as any).videoOverlays : []
    const overlayStarts = computeClipStarts(overlays as any)
    const overlayEnd = computeTimelineEndSecondsFromClips(overlays as any, overlayStarts)
    const overlayStills: any[] = Array.isArray((tl as any).videoOverlayStills) ? (tl as any).videoOverlayStills : []
    let overlayStillEnd = 0
    for (const s of overlayStills) {
      const e = Number((s as any).endSeconds)
      if (Number.isFinite(e) && e > overlayStillEnd) overlayStillEnd = e
    }
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
    return Math.max(0, roundToTenth(Math.max(videoEnd, overlayEnd, overlayStillEnd, gEnd, sEnd, lEnd, ltEnd, stEnd, nEnd)))
  }, [])

  const rippleRightSimpleLane = useCallback(
    <T extends { id: string; startSeconds: number; endSeconds: number }>(
      itemsRaw: T[],
      startId: string
    ): { items: T[]; pushedCount: number } | null => {
      const items = itemsRaw
        .slice()
        .map((x) => ({ ...x }))
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id))) as T[]
      const idx = items.findIndex((x) => String(x.id) === String(startId))
      if (idx < 0) return null
      let pushed = 0
      let prevEnd = roundToTenth(Number((items[idx] as any).endSeconds || 0))
      if (!Number.isFinite(prevEnd)) prevEnd = 0
      for (let i = idx + 1; i < items.length; i++) {
        const cur = items[i] as any
        const s0 = roundToTenth(Number(cur.startSeconds || 0))
        const e0 = roundToTenth(Number(cur.endSeconds || 0))
        if (!(Number.isFinite(e0) && e0 > s0)) continue
        if (s0 < prevEnd - 1e-6) {
          const d = roundToTenth(prevEnd - s0)
          const ns = roundToTenth(s0 + d)
          const ne = roundToTenth(e0 + d)
          if (ne > MAX_TIMELINE_SECONDS + 1e-6) return null
          cur.startSeconds = ns
          cur.endSeconds = ne
          pushed++
        }
        prevEnd = roundToTenth(Math.max(prevEnd, Number(cur.endSeconds || 0)))
      }
      return { items: items as any, pushedCount: pushed }
    },
    [MAX_TIMELINE_SECONDS]
  )

  const rippleRightBaseLane = useCallback(
    (
      clipsRaw: Clip[],
      stillsRaw: Still[],
      startKind: 'clip' | 'still',
      startId: string
    ): { clips: Clip[]; stills: Still[]; pushedCount: number } | null => {
      const clipStarts = computeClipStarts(clipsRaw)
      const clips = clipsRaw.map((c, i) => ({ ...(c as any), startSeconds: roundToTenth(Number((c as any).startSeconds ?? clipStarts[i] ?? 0)) })) as any[]
      const stills = stillsRaw.map((s) => ({ ...(s as any) })) as any[]
      const segments: Array<
        | { kind: 'clip'; id: string; start: number; end: number; clipId: string }
        | { kind: 'still'; id: string; start: number; end: number; stillId: string }
      > = []
      for (const c of clips) {
        const s = roundToTenth(Number((c as any).startSeconds || 0))
        const e = roundToTenth(s + clipDurationSeconds(c as any))
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) segments.push({ kind: 'clip', id: String((c as any).id), start: s, end: e, clipId: String((c as any).id) })
      }
      for (const st of stills) {
        const s = roundToTenth(Number((st as any).startSeconds || 0))
        const e = roundToTenth(Number((st as any).endSeconds || 0))
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) segments.push({ kind: 'still', id: String((st as any).id), start: s, end: e, stillId: String((st as any).id) })
      }
      segments.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
      const idx = segments.findIndex((x) => x.kind === startKind && x.id === String(startId))
      if (idx < 0) return null
      let pushed = 0
      let prevEnd = segments[idx].end
      for (let i = idx + 1; i < segments.length; i++) {
        const cur = segments[i]
        if (cur.start < prevEnd - 1e-6) {
          const d = roundToTenth(prevEnd - cur.start)
          const ns = roundToTenth(cur.start + d)
          const ne = roundToTenth(cur.end + d)
          if (ne > MAX_TIMELINE_SECONDS + 1e-6) return null
          cur.start = ns
          cur.end = ne
          pushed++
          if (cur.kind === 'clip') {
            const ci = clips.findIndex((c: any) => String(c.id) === cur.clipId)
            if (ci >= 0) clips[ci] = { ...(clips[ci] as any), startSeconds: ns }
          } else {
            const si = stills.findIndex((s: any) => String(s.id) === cur.stillId)
            if (si >= 0) stills[si] = { ...(stills[si] as any), startSeconds: ns, endSeconds: ne }
          }
        }
        prevEnd = Math.max(prevEnd, cur.end)
      }
      return { clips: clips as any, stills: stills as any, pushedCount: pushed }
    },
    [MAX_TIMELINE_SECONDS]
  )

  const rippleRightVideoOverlayLane = useCallback(
    (
      videoOverlaysRaw: any[],
      overlayStillsRaw: any[],
      startKind: 'videoOverlay' | 'videoOverlayStill',
      startId: string
    ): { videoOverlays: any[]; videoOverlayStills: any[]; pushedCount: number } | null => {
      const overlayStarts = computeClipStarts(videoOverlaysRaw as any)
      const videoOverlays = (videoOverlaysRaw || []).map((o: any, i: number) => ({
        ...(o as any),
        startSeconds: roundToTenth(Number((o as any).startSeconds ?? overlayStarts[i] ?? 0)),
      })) as any[]
      const videoOverlayStills = (overlayStillsRaw || []).map((s: any) => ({ ...(s as any) })) as any[]

      const segments: Array<
        | { kind: 'videoOverlay'; id: string; start: number; end: number; videoOverlayId: string }
        | { kind: 'videoOverlayStill'; id: string; start: number; end: number; videoOverlayStillId: string }
      > = []

      for (const o of videoOverlays) {
        const s = roundToTenth(Number((o as any).startSeconds || 0))
        const e = roundToTenth(s + clipDurationSeconds(o as any))
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
          segments.push({
            kind: 'videoOverlay',
            id: String((o as any).id),
            start: s,
            end: e,
            videoOverlayId: String((o as any).id),
          })
        }
      }
      for (const st of videoOverlayStills) {
        const s = roundToTenth(Number((st as any).startSeconds || 0))
        const e = roundToTenth(Number((st as any).endSeconds || 0))
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
          segments.push({
            kind: 'videoOverlayStill',
            id: String((st as any).id),
            start: s,
            end: e,
            videoOverlayStillId: String((st as any).id),
          })
        }
      }
      segments.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
      const idx = segments.findIndex((x) => x.kind === startKind && x.id === String(startId))
      if (idx < 0) return null

      let pushed = 0
      let prevEnd = segments[idx].end
      for (let i = idx + 1; i < segments.length; i++) {
        const cur = segments[i]
        if (cur.start < prevEnd - 1e-6) {
          const d = roundToTenth(prevEnd - cur.start)
          const ns = roundToTenth(cur.start + d)
          const ne = roundToTenth(cur.end + d)
          if (ne > MAX_TIMELINE_SECONDS + 1e-6) return null
          cur.start = ns
          cur.end = ne
          pushed++
          if (cur.kind === 'videoOverlay') {
            const oi = videoOverlays.findIndex((o: any) => String(o.id) === cur.videoOverlayId)
            if (oi >= 0) videoOverlays[oi] = { ...(videoOverlays[oi] as any), startSeconds: ns }
          } else {
            const si = videoOverlayStills.findIndex((s: any) => String(s.id) === cur.videoOverlayStillId)
            if (si >= 0) videoOverlayStills[si] = { ...(videoOverlayStills[si] as any), startSeconds: ns, endSeconds: ne }
          }
        }
        prevEnd = Math.max(prevEnd, cur.end)
      }

      return { videoOverlays: videoOverlays as any, videoOverlayStills: videoOverlayStills as any, pushedCount: pushed }
    },
    [MAX_TIMELINE_SECONDS]
  )

  const rippleRightDerivedLane = useCallback(
    <T extends { id: string; startSeconds?: number }>(
      itemsRaw: T[],
      startId: string,
      opts: { getDurationSeconds: (item: T) => number; normalizeStarts?: boolean }
    ): { items: T[]; pushedCount: number } | null => {
      const normalizeStarts = Boolean(opts.normalizeStarts)
      const items0 = itemsRaw.slice().map((x) => ({ ...x })) as any[]
      if (normalizeStarts) {
        const starts = computeClipStarts(items0 as any)
        for (let i = 0; i < items0.length; i++) {
          items0[i] = { ...(items0[i] as any), startSeconds: roundToTenth(Number(starts[i] || 0)) }
        }
      }
      const items = items0
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds || 0) - Number(b.startSeconds || 0) || String(a.id).localeCompare(String(b.id))) as T[]
      const idx = items.findIndex((x: any) => String(x.id) === String(startId))
      if (idx < 0) return null
      let pushed = 0
      const dur0 = roundToTenth(Math.max(0.2, Number(opts.getDurationSeconds(items[idx])) || 0))
      let prevEnd = roundToTenth(Number((items[idx] as any).startSeconds || 0) + dur0)
      for (let i = idx + 1; i < items.length; i++) {
        const cur: any = items[i]
        const s0 = roundToTenth(Number(cur.startSeconds || 0))
        const dur = roundToTenth(Math.max(0.2, Number(opts.getDurationSeconds(cur)) || 0))
        const e0 = roundToTenth(s0 + dur)
        if (!(Number.isFinite(e0) && e0 > s0)) continue
        if (s0 < prevEnd - 1e-6) {
          const d = roundToTenth(prevEnd - s0)
          const ns = roundToTenth(s0 + d)
          const ne = roundToTenth(e0 + d)
          if (ne > MAX_TIMELINE_SECONDS + 1e-6) return null
          cur.startSeconds = ns
          pushed++
          prevEnd = ne
        } else {
          prevEnd = e0
        }
      }
      return { items: items as any, pushedCount: pushed }
    },
    [MAX_TIMELINE_SECONDS]
  )

  const extendViewportEndSecondsIfNeeded = useCallback(
    (prevTl: Timeline, nextTl: Timeline, requiredEndSeconds: number): Timeline => {
      const prevViewportRaw = Number((prevTl as any).viewportEndSeconds)
      const prevViewport = Number.isFinite(prevViewportRaw) ? clamp(roundToTenth(prevViewportRaw), 0, MAX_TIMELINE_SECONDS) : 0
      const required = clamp(roundToTenth(requiredEndSeconds), 0, MAX_TIMELINE_SECONDS)
      const nextViewport = clamp(roundToTenth(Math.max(prevViewport, MIN_VIEWPORT_SECONDS, required)), 0, MAX_TIMELINE_SECONDS)
      if (nextViewport <= prevViewport + 1e-6 && (nextTl as any).viewportEndSeconds === (prevTl as any).viewportEndSeconds) return nextTl
      return { ...(nextTl as any), viewportEndSeconds: nextViewport } as any
    },
    [MAX_TIMELINE_SECONDS, MIN_VIEWPORT_SECONDS]
  )
  const playhead = useMemo(() => clamp(roundToTenth(timeline.playheadSeconds || 0), 0, Math.max(0, totalSeconds)), [timeline.playheadSeconds, totalSeconds])
  const pxPerSecond = 48
  const visualTotalSeconds = useMemo(() => Math.max(10, totalSeconds), [totalSeconds])
  const stripContentW = useMemo(() => Math.max(0, Math.ceil(visualTotalSeconds * pxPerSecond)), [pxPerSecond, visualTotalSeconds])
  const RULER_H = 16
  const WAVEFORM_H = 34
  const TRACK_H = 48
  const TRACKS_TOP = RULER_H + WAVEFORM_H
  const LOGO_Y = TRACKS_TOP + 6
  const LOWER_THIRD_Y = TRACKS_TOP + TRACK_H + 6
  const SCREEN_TITLE_Y = TRACKS_TOP + TRACK_H * 2 + 6
  const VIDEO_OVERLAY_Y = TRACKS_TOP + TRACK_H * 3 + 6
  const GRAPHICS_Y = TRACKS_TOP + TRACK_H * 4 + 6
  const VIDEO_Y = TRACKS_TOP + TRACK_H * 5 + 6
  const NARRATION_Y = TRACKS_TOP + TRACK_H * 6 + 6
  const AUDIO_Y = TRACKS_TOP + TRACK_H * 7 + 6
  const PILL_H = Math.max(18, TRACK_H - 12)
  const HANDLE_HIT_PX = 18
  const TIMELINE_H = TRACKS_TOP + TRACK_H * 8

  // Draw the mini timeline shown in the floating preview toolbar.
  useEffect(() => {
    const c = previewMiniTimelineRef.current
    if (!c) return
    if (!showPreviewToolbar) return
    if (!hasPlayablePreview) return

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    const parent = c.parentElement
    const wCss = Math.max(120, Math.floor(parent?.getBoundingClientRect?.().width || 0))
    const hCss = 32
    c.width = Math.floor(wCss * dpr)
    c.height = Math.floor(hCss * dpr)
    c.style.width = `${wCss}px`
    c.style.height = `${hCss}px`

    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, hCss)

    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(0, 0, wCss, hCss)

    const centerX = Math.floor(wCss / 2)
    const rangeSeconds = wCss / pxPerSecond
    const leftT = clamp(playhead - rangeSeconds / 2, 0, Math.max(0, totalSeconds))
    const rightT = clamp(playhead + rangeSeconds / 2, 0, Math.max(0, totalSeconds))

    const tStart = Math.floor(leftT * 10) / 10
    const tEnd = Math.ceil(rightT * 10) / 10
    for (let t = tStart; t <= tEnd + 1e-6; t = roundToTenth(t + 0.1)) {
      if (t < 0 || t > totalSeconds + 1e-6) continue
      const dx = (t - playhead) * pxPerSecond
      const x = Math.round(centerX + dx)
      if (x < -2 || x > wCss + 2) continue

      const isSecond = Math.abs(t - Math.round(t)) < 1e-6
      ctx.beginPath()
      ctx.strokeStyle = isSecond ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1
      const y0 = 0
      const y1 = isSecond ? hCss : Math.round(hCss * 0.62)
      ctx.moveTo(x + 0.5, y0)
      ctx.lineTo(x + 0.5, y1)
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.strokeStyle = '#ff3b30'
    ctx.lineWidth = 1
    ctx.moveTo(centerX + 0.5, 0)
    ctx.lineTo(centerX + 0.5, hCss)
    ctx.stroke()
  }, [hasPlayablePreview, playhead, pxPerSecond, showPreviewToolbar, totalSeconds])

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null
    return timeline.clips.find((c) => c.id === selectedClipId) || null
  }, [selectedClipId, timeline.clips])
	  const selectedClipIndex = useMemo(() => {
	    if (!selectedClipId) return -1
	    return timeline.clips.findIndex((c) => c.id === selectedClipId)
	  }, [selectedClipId, timeline.clips])

	  const selectedVideoOverlay = useMemo(() => {
	    if (!selectedVideoOverlayId) return null
	    return videoOverlays.find((o: any) => String(o.id) === String(selectedVideoOverlayId)) || null
	  }, [selectedVideoOverlayId, videoOverlays])

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

  const refreshScreenTitlePresetId = useMemo(() => {
    try {
      if (typeof window === 'undefined') return null
      const qp = new URLSearchParams(window.location.search)
      const raw = String(qp.get('cvRefreshScreenTitlePresetId') || '').trim()
      if (!raw) return null
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : null
    } catch {
      return null
    }
  }, [])

  const openAddStepFromUrl = useMemo(() => {
    try {
      if (typeof window === 'undefined') return null
      const qp = new URLSearchParams(window.location.search)
      const raw = String(qp.get('cvOpenAdd') || '').trim()
      if (!raw) return null
      return raw
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
	      return (raw as any[]).map((s: any, i: number) => {
	        const audioConfigIdRaw = s?.audioConfigId
	        const audioConfigId =
	          audioConfigIdRaw == null ? null : (Number.isFinite(Number(audioConfigIdRaw)) ? Number(audioConfigIdRaw) : null)
	        const musicModeRaw = s?.musicMode == null ? null : String(s.musicMode)
	        const musicLevelRaw = s?.musicLevel == null ? null : String(s.musicLevel)
	        const duckRaw = s?.duckingIntensity == null ? null : String(s.duckingIntensity)
	        return {
	          ...(s as any),
	          id: String(s?.id || '') || `aud_legacy_${i + 1}`,
	          uploadId: Number(s?.uploadId),
	          ...(audioConfigId != null && audioConfigId > 0 ? { audioConfigId } : {}),
	          startSeconds: roundToTenth(Math.max(0, Number(s?.startSeconds || 0))),
	          endSeconds: roundToTenth(Math.max(0, Number(s?.endSeconds || 0))),
	          sourceStartSeconds: s?.sourceStartSeconds == null ? 0 : roundToTenth(Math.max(0, Number(s?.sourceStartSeconds || 0))),
	          audioEnabled: s?.audioEnabled == null ? true : Boolean(s?.audioEnabled),
	          ...(musicModeRaw ? { musicMode: musicModeRaw } : {}),
	          ...(musicLevelRaw ? { musicLevel: musicLevelRaw } : {}),
	          ...(duckRaw ? { duckingIntensity: duckRaw } : {}),
	        } as any
	      })
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

  // Legacy embedded asset management (upload/edit/delete) moved to `/assets/*`.

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
      const overlayStarts = computeClipStarts(videoOverlays as any)
      for (let i = 0; i < videoOverlays.length; i++) {
        const start = roundToTenth(overlayStarts[i] || 0)
        const len = clipDurationSeconds(videoOverlays[i] as any)
        const end = roundToTenth(start + len)
        if (end > start) out.push(start, end)
      }
	    for (const n of narration) {
	      const s = roundToTenth(Number((n as any).startSeconds || 0))
	      const e = roundToTenth(Number((n as any).endSeconds || 0))
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
	  }, [audioSegments, clipStarts, graphics, logos, lowerThirds, narration, screenTitles, stills, timeline, totalSeconds, videoOverlays])

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

      if (drag.kind === 'videoOverlay') {
        const id = String((drag as any).videoOverlayId || '')
        const idx = videoOverlays.findIndex((o: any) => String((o as any)?.id) === id)
        if (idx < 0) return null
        const o: any = (videoOverlays as any)[idx]
        if (!o) return null
        const name = namesByUploadId[Number(o.uploadId)] || `Overlay ${o.uploadId}`
        const start = roundToTenth(Number((videoOverlayStarts as any)[idx] || 0))
        const len = Math.max(0, roundToTenth(clipDurationSeconds(o as any)))
        const end = roundToTenth(start + len)

        const maxDurRaw =
          drag.maxDurationSeconds != null && Number.isFinite(Number(drag.maxDurationSeconds)) && Number(drag.maxDurationSeconds) !== Number.POSITIVE_INFINITY
            ? Number(drag.maxDurationSeconds)
            : undefined
        const totalNoOffsetSecondsRaw = maxDurRaw != null ? maxDurRaw : durationsByUploadId[Number(o.uploadId)] ?? o.sourceEndSeconds
        const totalNoOffsetSeconds = roundToTenth(Math.max(0, Number(totalNoOffsetSecondsRaw) || 0))
        const startWithOffsetSeconds = roundToTenth(Math.max(0, Number(o.sourceStartSeconds || 0)))
        const endWithOffsetSeconds = roundToTenth(Math.max(0, Number(o.sourceEndSeconds || 0)))
        const durationWithOffsetsSeconds = roundToTenth(Math.max(0, endWithOffsetSeconds - startWithOffsetSeconds))

        return {
          kindLabel: 'Overlay video',
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
      const name = namesByUploadId[Number(l.uploadId)] || `Logo ${l.uploadId}`
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
      videoOverlayStarts,
      videoOverlays,
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

  const findVideoOverlayAtTime = useCallback(
    (t: number): VideoOverlay | null => {
      const tt = Number(t)
      if (!Number.isFinite(tt) || tt < 0) return null
      const candidates: Array<{ s: number; e: number; o: VideoOverlay }> = []
      const starts = computeClipStarts(videoOverlays as any)
      for (let i = 0; i < videoOverlays.length; i++) {
        const o: any = videoOverlays[i]
        const s = roundToTenth(Number((starts as any)[i] || 0))
        const len = roundToTenth(Math.max(0, clipDurationSeconds(o as any)))
        const e = roundToTenth(s + len)
        if (!(Number.isFinite(s) && Number.isFinite(e))) continue
        if (tt >= s && tt <= e) candidates.push({ s, e, o })
      }
      if (!candidates.length) return null
      for (const c of candidates) {
        if (roundToTenth(c.s) === roundToTenth(tt)) return c.o
      }
      candidates.sort((a, b) => a.s - b.s || a.e - b.e)
      return candidates[0].o
    },
    [videoOverlays]
  )

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

  const findVideoOverlayStillAtTime = useCallback((t: number): VideoOverlayStill | null => {
    const tt = Number(t)
    if (!Number.isFinite(tt) || tt < 0) return null
    for (const s of videoOverlayStills as any[]) {
      const a = Number((s as any).startSeconds)
      const b = Number((s as any).endSeconds)
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      if (tt >= a && tt < b) return s as any
    }
    return null
  }, [videoOverlayStills])

  const activeGraphicAtPlayhead = useMemo(() => findGraphicAtTime(playhead), [findGraphicAtTime, playhead])
  const activeLogoAtPlayhead = useMemo(() => findLogoAtTime(playhead), [findLogoAtTime, playhead])
  const activeLowerThirdAtPlayhead = useMemo(() => findLowerThirdAtTime(playhead), [findLowerThirdAtTime, playhead])
  const activeScreenTitleAtPlayhead = useMemo(() => findScreenTitleAtTime(playhead), [findScreenTitleAtTime, playhead])
  const activeVideoOverlayAtPlayhead = useMemo(() => findVideoOverlayAtTime(playhead), [findVideoOverlayAtTime, playhead])
  const activeVideoOverlayStillAtPlayhead = useMemo(() => findVideoOverlayStillAtTime(playhead), [findVideoOverlayStillAtTime, playhead])
  const activeStillAtPlayhead = useMemo(() => findStillAtTime(playhead), [findStillAtTime, playhead])

  // UX: when playback stops exactly at the end of a freeze-frame still (waiting for a user Play gesture
  // to start the next video segment), keep the still visible instead of flashing to black.
  const previewStillAtPlayhead = useMemo(() => {
    if (activeStillAtPlayhead) return activeStillAtPlayhead
    if (playing) return null
    const t = roundToTenth(Number(playhead) || 0)
    const endedStill = stills.find((s: any) => {
      const a = roundToTenth(Number((s as any).startSeconds || 0))
      const b = roundToTenth(Number((s as any).endSeconds || 0))
      if (!(b > a)) return false
      return Math.abs(b - t) < 0.05
    })
    return (endedStill as any) || null
  }, [activeStillAtPlayhead, playhead, playing, stills])

  // UX: same idea for overlay freeze stills — if playback stops at the boundary, keep the still visible.
  const previewVideoOverlayStillAtPlayhead = useMemo(() => {
    if (activeVideoOverlayStillAtPlayhead) return activeVideoOverlayStillAtPlayhead
    if (playing) return null
    const t = roundToTenth(Number(playhead) || 0)
    const endedStill = (videoOverlayStills as any[]).find((s: any) => {
      const a = roundToTenth(Number((s as any).startSeconds || 0))
      const b = roundToTenth(Number((s as any).endSeconds || 0))
      if (!(b > a)) return false
      return Math.abs(b - t) < 0.05
    })
    return (endedStill as any) || null
  }, [activeVideoOverlayStillAtPlayhead, playhead, playing, videoOverlayStills])

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
    const s = previewStillAtPlayhead
    if (!s) return null
    const id = Number((s as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [previewStillAtPlayhead])

  const activeVideoOverlayStillUploadId = useMemo(() => {
    const s = previewVideoOverlayStillAtPlayhead
    if (!s) return null
    const id = Number((s as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [previewVideoOverlayStillAtPlayhead])

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

  const activeGraphicPreviewStyle = useMemo<React.CSSProperties | null>(() => {
    const g: any = activeGraphicAtPlayhead as any
    if (!g) return null
    const borderWidthAllowed = new Set([0, 2, 4, 6])
    const borderWidth = borderWidthAllowed.has(Number(g.borderWidthPx)) ? Number(g.borderWidthPx) : 0
    const borderColor = String(g.borderColor || '#000000')
    const fitMode = g.fitMode != null ? String(g.fitMode) : ''
    // Legacy behavior: full-frame cover when placement fields are absent.
    if (!fitMode) {
      return {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
        zIndex: 20,
        boxSizing: 'border-box',
        border: borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : undefined,
      }
    }
    if (fitMode !== 'contain_transparent') {
      return {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
        zIndex: 20,
        boxSizing: 'border-box',
        border: borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : undefined,
      }
    }

    const sizePctRaw = Number(g.sizePctWidth)
    const sizePct = clamp(Number.isFinite(sizePctRaw) ? sizePctRaw : 70, 10, 100)
    const insetXPxRaw = Number(g.insetXPx)
    const insetYPxRaw = Number(g.insetYPx)
    const insetXPx = clamp(Number.isFinite(insetXPxRaw) ? insetXPxRaw : 24, 0, 300)
    const insetYPx = clamp(Number.isFinite(insetYPxRaw) ? insetYPxRaw : 24, 0, 300)
    const previewW = Number.isFinite(previewBoxSize.w) && previewBoxSize.w > 0 ? previewBoxSize.w : 1080
    const previewH = Number.isFinite(previewBoxSize.h) && previewBoxSize.h > 0 ? previewBoxSize.h : 1920
    const scale = previewW > 0 ? previewW / 1080 : 1
    const insetX = Math.round(insetXPx * scale)
    const insetY = Math.round(insetYPx * scale)
    const desiredW = Math.round((previewW * sizePct) / 100)
    const maxW = Math.max(0, Math.round(previewW - insetX * 2))
    const maxH = Math.max(0, Math.round(previewH - insetY * 2))
    const widthPxRaw = Math.min(desiredW, maxW)
    const widthPx = Number.isFinite(widthPxRaw) ? Math.max(1, widthPxRaw) : 1

    const posRaw = String(g.position || 'middle_center')
    const pos = normalizeLegacyPosition(posRaw)
    const style: any = {
      position: 'absolute',
      // Use % for width to avoid any chance of px math drifting from the actual preview box size.
      // maxWidth still clamps it if insets would make it too large.
      width: `${sizePct}%`,
      height: 'auto',
      maxWidth: `${Number.isFinite(maxW) ? maxW : 0}px`,
      maxHeight: `${Number.isFinite(maxH) ? maxH : 0}px`,
      objectFit: 'contain',
      pointerEvents: 'none',
      zIndex: 20,
      boxSizing: 'border-box',
      border: borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : undefined,
    }
    const insetXStr = `${insetX}px`
    const insetYStr = `${insetY}px`
    if (pos === 'top_left') {
      style.left = insetXStr
      style.top = insetYStr
    } else if (pos === 'top_center') {
      style.left = '50%'
      style.top = insetYStr
      style.transform = 'translateX(-50%)'
    } else if (pos === 'top_right') {
      style.right = insetXStr
      style.top = insetYStr
    } else if (pos === 'middle_left') {
      style.left = insetXStr
      style.top = '50%'
      style.transform = 'translateY(-50%)'
    } else if (pos === 'middle_center') {
      style.left = '50%'
      style.top = '50%'
      style.transform = 'translate(-50%, -50%)'
    } else if (pos === 'middle_right') {
      style.right = insetXStr
      style.top = '50%'
      style.transform = 'translateY(-50%)'
    } else if (pos === 'bottom_left') {
      style.left = insetXStr
      style.bottom = insetYStr
    } else if (pos === 'bottom_center') {
      style.left = '50%'
      style.bottom = insetYStr
      style.transform = 'translateX(-50%)'
    } else {
      style.right = insetXStr
      style.bottom = insetYStr
    }
    return style as React.CSSProperties
  }, [activeGraphicAtPlayhead, previewBoxSize.h, previewBoxSize.w])

  const activeGraphicPreviewIndicators = useMemo(() => {
    const g: any = activeGraphicAtPlayhead as any
    if (!g) return { show: false, hasFade: false }
    if (String((g as any).id || '') !== String(selectedGraphicId || '')) return { show: false, hasFade: false }
    const fade = String((g as any).fade || 'none')
    const hasFade = fade !== 'none'
    return { show: hasFade, hasFade }
  }, [activeGraphicAtPlayhead, selectedGraphicId])

  const activeStillUrl = useMemo(() => {
    if (!activeStillUploadId) return null
    return graphicFileUrlByUploadId[activeStillUploadId] || `/api/uploads/${encodeURIComponent(String(activeStillUploadId))}/file`
  }, [activeStillUploadId, graphicFileUrlByUploadId])

  const activeVideoOverlayStillUrl = useMemo(() => {
    if (!activeVideoOverlayStillUploadId) return null
    return (
      graphicFileUrlByUploadId[activeVideoOverlayStillUploadId] ||
      `/api/uploads/${encodeURIComponent(String(activeVideoOverlayStillUploadId))}/file`
    )
  }, [activeVideoOverlayStillUploadId, graphicFileUrlByUploadId])

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
    const tRel = Number(playhead) - segStart
    if (!(Number.isFinite(tRel) && tRel >= -1e-6 && tRel <= segDur + 1e-6)) return null

    const baseOpacityPct = seg.opacityPct != null ? Number(seg.opacityPct) : 100
    const baseOpacity = Math.min(1, Math.max(0, (Number.isFinite(baseOpacityPct) ? baseOpacityPct : 100) / 100))
    const fadeAlpha = computeFadeAlpha({ fade: seg.fade }, tRel, 0, segDur)
    const alpha = baseOpacity * fadeAlpha
    if (!(alpha > 0.001)) return null

    const style: any = computeOverlayCssNoOpacity(seg)
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

  const activeVideoOverlayPreview = useMemo(() => {
    const o: any = activeVideoOverlayAtPlayhead as any
    if (!o) return null
    const uploadId = Number(o.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return null
    const dims = dimsByUploadId[uploadId]
    const aspectRatio =
      dims && Number.isFinite(Number(dims.width)) && Number.isFinite(Number(dims.height)) && Number(dims.width) > 0 && Number(dims.height) > 0
        ? `${Math.round(Number(dims.width))} / ${Math.round(Number(dims.height))}`
        : '9 / 16'
    const sizePctWidth = clamp(Number(o.sizePctWidth || 40), 10, 100)
    const insetPct = 0.04
    let measuredW = 0
    let measuredH = 0
    try {
      const rect = previewWrapRef.current?.getBoundingClientRect()
      if (rect && rect.width > 0 && rect.height > 0) {
        measuredW = rect.width
        measuredH = rect.height
      }
    } catch {}
    const previewW =
      measuredW > 0 ? measuredW : previewSize.w > 0 ? previewSize.w : previewBoxSize.w
    const previewH =
      measuredH > 0 ? measuredH : previewSize.h > 0 ? previewSize.h : previewBoxSize.h
    const insetXPx = previewW ? Math.round(previewW * insetPct) : 12
    const insetYPx = previewH ? Math.round(previewH * insetPct) : 12
    const ratio =
      dims && Number.isFinite(Number(dims.width)) && Number.isFinite(Number(dims.height)) && Number(dims.width) > 0 && Number(dims.height) > 0
        ? Number(dims.height) / Number(dims.width)
        : 16 / 9
    const overlayW = previewW ? Math.round((previewW * sizePctWidth) / 100) : 0
    const overlayH = overlayW ? Math.round(overlayW * ratio) : 0
    let left = 0
    let top = 0
    let fallbackStyle: any | null = null
    const pos = String(o.position || 'bottom_right')
    if (previewW && previewH && overlayW && overlayH) {
      if (pos === 'top_left') {
        left = insetXPx
        top = insetYPx
      } else if (pos === 'top_center') {
        left = Math.round((previewW - overlayW) / 2)
        top = insetYPx
      } else if (pos === 'top_right') {
        left = previewW - overlayW - insetXPx
        top = insetYPx
      } else if (pos === 'middle_left') {
        left = insetXPx
        top = (previewH - overlayH) / 2
      } else if (pos === 'middle_center') {
        left = Math.round((previewW - overlayW) / 2)
        top = Math.round((previewH - overlayH) / 2)
      } else if (pos === 'middle_right') {
        left = previewW - overlayW - insetXPx
        top = Math.round((previewH - overlayH) / 2)
      } else if (pos === 'bottom_left') {
        left = insetXPx
        top = previewH - overlayH - insetYPx
      } else if (pos === 'bottom_center') {
        left = Math.round((previewW - overlayW) / 2)
        top = Math.round(previewH - overlayH - insetYPx)
      } else {
        left = Math.round(previewW - overlayW - insetXPx)
        top = Math.round(previewH - overlayH - insetYPx)
      }
      left = Math.round(left)
      top = Math.round(top)
    } else {
      const inset = '4%'
      fallbackStyle = {
        position: 'absolute',
        width: `${sizePctWidth}%`,
        aspectRatio,
        pointerEvents: 'none',
        zIndex: 25,
      }
      if (pos === 'top_left') {
        fallbackStyle.left = inset
        fallbackStyle.top = inset
      } else if (pos === 'top_center') {
        fallbackStyle.left = '50%'
        fallbackStyle.top = inset
        fallbackStyle.transform = 'translateX(-50%)'
      } else if (pos === 'top_right') {
        fallbackStyle.right = inset
        fallbackStyle.top = inset
      } else if (pos === 'middle_left') {
        fallbackStyle.left = inset
        fallbackStyle.top = '50%'
        fallbackStyle.transform = 'translateY(-50%)'
      } else if (pos === 'middle_center') {
        fallbackStyle.left = '50%'
        fallbackStyle.top = '50%'
        fallbackStyle.transform = 'translate(-50%, -50%)'
      } else if (pos === 'middle_right') {
        fallbackStyle.right = inset
        fallbackStyle.top = '50%'
        fallbackStyle.transform = 'translateY(-50%)'
      } else if (pos === 'bottom_left') {
        fallbackStyle.left = inset
        fallbackStyle.bottom = inset
      } else if (pos === 'bottom_center') {
        fallbackStyle.left = '50%'
        fallbackStyle.bottom = inset
        fallbackStyle.transform = 'translateX(-50%)'
      } else {
        fallbackStyle.right = inset
        fallbackStyle.bottom = inset
      }
    }
    const overlayStyleFromPx: any =
      previewW && previewH && overlayW && overlayH
        ? ({
            position: 'absolute',
            width: `${overlayW}px`,
            height: `${overlayH}px`,
            left: `${left}px`,
            top: `${top}px`,
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 25,
          } as any)
        : null
    const style: any = overlayStyleFromPx ?? fallbackStyle
    if (!style) return null
    const plateStyleRaw = String((o as any).plateStyle || 'none')
    const plateOpacityPct = clamp(Number((o as any).plateOpacityPct ?? 85), 0, 100)
    const plateAlpha = plateOpacityPct / 100
    const plateColor = hexToRgba(String((o as any).plateColor || '#000000'), plateAlpha)
    const plateDef = (() => {
      if (plateStyleRaw === 'none') return null
      const padPx = plateStyleRaw === 'thin' ? 4 : plateStyleRaw === 'medium' ? 12 : plateStyleRaw === 'thick' ? 30 : 0
      return { style: plateStyleRaw as any, padPx }
    })()
    const label = (namesByUploadId[uploadId] || `Overlay ${uploadId}`).toString()
    const thumbUrl = posterByUploadId[uploadId] || `/api/uploads/${encodeURIComponent(String(uploadId))}/thumb`
    const outerStyle: React.CSSProperties = { ...style }
    const innerStyle: React.CSSProperties = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      pointerEvents: 'none',
      border: '2px dashed rgba(255,214,170,0.75)',
      borderRadius: 0,
      background: 'rgba(0,0,0,0.25)',
      overflow: 'hidden',
      zIndex: 25,
    }
    let plateStyle: React.CSSProperties | null = null
    if (plateDef && overlayStyleFromPx && previewW && previewH && overlayW && overlayH) {
      if (plateDef.style === 'band') {
        const bandPad = 40
        plateStyle = {
          position: 'absolute',
          left: 0,
          top: `${Math.round(top - bandPad)}px`,
          width: `${previewW}px`,
          height: `${Math.round(overlayH + bandPad * 2)}px`,
          background: plateColor,
          pointerEvents: 'none',
          zIndex: 20,
        }
      } else {
        const pad = plateDef.padPx
        plateStyle = {
          position: 'absolute',
          left: `${Math.round(left - pad)}px`,
          top: `${Math.round(top - pad)}px`,
          width: `${Math.round(overlayW + pad * 2)}px`,
          height: `${Math.round(overlayH + pad * 2)}px`,
          background: plateColor,
          pointerEvents: 'none',
          zIndex: 20,
        } as any
      }
    }
    return { uploadId, style: outerStyle as React.CSSProperties, innerStyle, label, thumbUrl, plateStyle }
  }, [activeVideoOverlayAtPlayhead, dimsByUploadId, namesByUploadId, posterByUploadId, previewBoxSize.h, previewBoxSize.w, previewSize.h, previewSize.w])

  const activeVideoOverlayStillPreview = useMemo(() => {
    const s: any = previewVideoOverlayStillAtPlayhead as any
    const url = activeVideoOverlayStillUrl
    if (!s || !url) return null

    const sizeAllowed = new Set([25, 33, 40, 50, 70, 90])
    const sizeRaw = Math.round(Number(s.sizePctWidth))
    let sizePctWidth = sizeAllowed.has(sizeRaw) ? sizeRaw : 40
    const posAllowed = new Set([
      'top_left',
      'top_center',
      'top_right',
      'middle_left',
      'middle_center',
      'middle_right',
      'bottom_left',
      'bottom_center',
      'bottom_right',
    ])
    let position = posAllowed.has(String(s.position || '')) ? String(s.position) : ''

    // Prefer using the originating overlay's box layout (when available) for aspect ratio + defaults.
    const sourceOverlayId = s.sourceVideoOverlayId ? String(s.sourceVideoOverlayId) : ''
    if (sourceOverlayId) {
      const ov: any = videoOverlays.find((o: any) => String((o as any).id) === sourceOverlayId)
      if (ov) {
        const ovSizeRaw = Math.round(Number((ov as any).sizePctWidth))
        if (!sizeAllowed.has(sizeRaw) && sizeAllowed.has(ovSizeRaw)) sizePctWidth = ovSizeRaw
        if (!position) {
          const ovPos = String((ov as any).position || '')
          if (posAllowed.has(ovPos)) position = ovPos
        }
      }
    }
    if (!position) position = 'bottom_right'

    let aspectRatio: string | null = null
    const stillUploadId = Number((s as any).uploadId || 0)
    const stillDims = stillUploadId ? dimsByUploadId[stillUploadId] : null
    if (stillDims && Number.isFinite(Number(stillDims.width)) && Number.isFinite(Number(stillDims.height)) && Number(stillDims.width) > 0 && Number(stillDims.height) > 0) {
      aspectRatio = `${Math.round(Number(stillDims.width))} / ${Math.round(Number(stillDims.height))}`
    }
    if (sourceOverlayId) {
      const ov: any = videoOverlays.find((o: any) => String((o as any).id) === sourceOverlayId)
      const uploadId = ov ? Number((ov as any).uploadId) : 0
      const dims = uploadId ? dimsByUploadId[uploadId] : null
      if (!aspectRatio && dims && Number.isFinite(Number(dims.width)) && Number.isFinite(Number(dims.height)) && Number(dims.width) > 0 && Number(dims.height) > 0) {
        aspectRatio = `${Math.round(Number(dims.width))} / ${Math.round(Number(dims.height))}`
      }
    }

    const inset = '4%'
    const style: any = {
      position: 'absolute',
      width: `${sizePctWidth}%`,
      ...(aspectRatio ? { aspectRatio } : { height: 'auto' }),
      overflow: 'hidden',
      objectFit: 'contain',
      pointerEvents: 'none',
      zIndex: 30,
      background: 'rgba(0,0,0,0.25)',
      border: '2px dashed rgba(255,214,170,0.75)',
      borderRadius: 10,
    }
    if (position === 'top_left') {
      style.left = inset
      style.top = inset
    } else if (position === 'top_center') {
      style.left = '50%'
      style.top = inset
      style.transform = 'translateX(-50%)'
    } else if (position === 'top_right') {
      style.right = inset
      style.top = inset
    } else if (position === 'middle_left') {
      style.left = inset
      style.top = '50%'
      style.transform = 'translateY(-50%)'
    } else if (position === 'middle_center') {
      style.left = '50%'
      style.top = '50%'
      style.transform = 'translate(-50%, -50%)'
    } else if (position === 'middle_right') {
      style.right = inset
      style.top = '50%'
      style.transform = 'translateY(-50%)'
    } else if (position === 'bottom_left') {
      style.left = inset
      style.bottom = inset
    } else if (position === 'bottom_center') {
      style.left = '50%'
      style.bottom = inset
      style.transform = 'translateX(-50%)'
    } else {
      style.right = inset
      style.bottom = inset
    }

    return { url, style: style as React.CSSProperties }
  }, [activeVideoOverlayStillUrl, dimsByUploadId, previewVideoOverlayStillAtPlayhead, videoOverlays])

  const previewBaseVideoStyle = useMemo<React.CSSProperties>(() => {
    return {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: previewObjectFit,
      pointerEvents: 'none',
      display: activeUploadId != null ? 'block' : 'none',
      zIndex: 5,
    }
  }, [activeUploadId, previewObjectFit])

  const ensureAudioEnvelope = useCallback(async (uploadId: number) => {
    const id = Number(uploadId)
    if (!Number.isFinite(id) || id <= 0) return
    if (audioEnvelopeByUploadId[id]) return
    const status = audioEnvelopeStatusByUploadId[id]
    if (status === 'pending') return
    if (status === 'error') return

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

  useEffect(() => {
    if (!selectedAudioId) return
    const seg: any = audioSegments.find((a: any) => String(a?.id) === String(selectedAudioId))
    if (!seg) return
    const uploadId = Number(seg.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    ensureAudioEnvelope(uploadId).catch(() => {})
  }, [ensureAudioEnvelope, selectedAudioId])

  useEffect(() => {
    if (!selectedVideoOverlayId) return
    const overlay: any = videoOverlays.find((o: any) => String(o?.id) === String(selectedVideoOverlayId))
    if (!overlay) return
    const uploadId = Number(overlay.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    ensureAudioEnvelope(uploadId).catch(() => {})
  }, [ensureAudioEnvelope, selectedVideoOverlayId, videoOverlays])

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
	      // If the <audio> element has ended or was auto-paused, stop the preview loop so it doesn't
	      // fight user timeline panning by repeatedly snapping the playhead back to the segment end.
	      if (cur.ended || cur.paused) {
	        const stopAt = roundToTenth(Number(seg.segEnd || 0))
	        stopNarrationPreview()
	        setTimeline((prev) => ({ ...prev, playheadSeconds: stopAt }))
	        return
	      }
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
	      if (cur.ended || cur.paused) {
	        const stopAt = roundToTenth(Number(seg.segEnd || 0))
	        stopMusicPreview()
	        setTimeline((prev) => ({ ...prev, playheadSeconds: stopAt }))
	        return
	      }
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
      selectedVideoOverlayId,
      selectedVideoOverlayStillId,
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
    selectedVideoOverlayId,
    selectedVideoOverlayStillId,
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
      selectedVideoOverlayId,
      selectedVideoOverlayStillId,
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
      setSelectedVideoOverlayId((snap as any).selectedVideoOverlayId || null)
      setSelectedVideoOverlayStillId((snap as any).selectedVideoOverlayStillId || null)
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
    selectedVideoOverlayId,
    selectedVideoOverlayStillId,
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
      selectedVideoOverlayId,
      selectedVideoOverlayStillId,
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
      setSelectedVideoOverlayId((snap as any).selectedVideoOverlayId || null)
      setSelectedVideoOverlayStillId((snap as any).selectedVideoOverlayStillId || null)
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
    selectedVideoOverlayId,
    selectedVideoOverlayStillId,
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

    // Waveform (selected clip / narration / audio segment)
    const waveformTop = rulerH + 2
    const waveformBottom = rulerH + waveformH - 2
    const waveformHeight = Math.max(4, waveformBottom - waveformTop)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, waveformBottom + 0.5)
    ctx.lineTo(wCss, waveformBottom + 0.5)
    ctx.stroke()

    const selectedOverlay: any =
      selectedVideoOverlayId != null ? videoOverlays.find((o: any) => String(o?.id) === String(selectedVideoOverlayId)) : null
    const overlayIdx =
      selectedOverlay != null ? videoOverlays.findIndex((o: any) => String(o?.id) === String(selectedVideoOverlayId)) : -1
    const selectedNarration: any =
      selectedNarrationId != null ? narration.find((n: any) => String(n?.id) === String(selectedNarrationId)) : null
    const selectedAudioSeg: any =
      selectedAudioId != null ? audioSegments.find((a: any) => String(a?.id) === String(selectedAudioId)) : null
    const clipIdx = selectedClipIndex
    const clip = clipIdx >= 0 ? timeline.clips[clipIdx] : null
    const hasAnyTarget = Boolean(selectedOverlay) || Boolean(selectedNarration) || Boolean(selectedAudioSeg) || Boolean(clip)
    if (!hasAnyTarget) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = '700 12px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText('Select a clip, overlay, narration, or audio segment to see waveform', 10, rulerH + waveformH / 2)
    } else {
      const kind: 'videoOverlay' | 'narration' | 'audio' | 'clip' =
        selectedOverlay ? 'videoOverlay' : selectedNarration ? 'narration' : selectedAudioSeg ? 'audio' : 'clip'
      const uploadId =
        kind === 'videoOverlay'
          ? Number((selectedOverlay as any).uploadId)
          : kind === 'narration'
            ? Number(selectedNarration.uploadId)
            : kind === 'audio'
              ? Number(selectedAudioSeg.uploadId)
              : Number((clip as any).uploadId)
      const env = uploadId > 0 ? audioEnvelopeByUploadId[uploadId] : null
      const envStatus = uploadId > 0 ? (audioEnvelopeStatusByUploadId[uploadId] || 'idle') : 'idle'
      const hasAudio = env && typeof env === 'object' ? Boolean((env as any).hasAudio) : false
      const points = env && typeof env === 'object' && Array.isArray((env as any).points) ? ((env as any).points as any[]) : []

      let segStartT = 0
      let segEndT = 0
      let sourceStart = 0
      let sourceEnd = 0
      if (kind === 'videoOverlay') {
        const start = overlayIdx >= 0 ? Number(videoOverlayStarts[overlayIdx] || 0) : 0
        segStartT = roundToTenth(start)
        segEndT = roundToTenth(segStartT + clipDurationSeconds(selectedOverlay as any))
        sourceStart = Number((selectedOverlay as any).sourceStartSeconds || 0)
        const rawEnd = Number((selectedOverlay as any).sourceEndSeconds || 0)
        sourceEnd = Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : roundToTenth(sourceStart + Math.max(0, segEndT - segStartT))
      } else if (kind === 'narration') {
        segStartT = roundToTenth(Number(selectedNarration.startSeconds || 0))
        segEndT = roundToTenth(Number(selectedNarration.endSeconds || 0))
        sourceStart =
          selectedNarration.sourceStartSeconds != null && Number.isFinite(Number(selectedNarration.sourceStartSeconds))
            ? Math.max(0, roundToTenth(Number(selectedNarration.sourceStartSeconds)))
            : 0
        sourceEnd = Math.max(0, roundToTenth(sourceStart + Math.max(0, segEndT - segStartT)))
      } else if (kind === 'audio') {
        segStartT = roundToTenth(Number(selectedAudioSeg.startSeconds || 0))
        segEndT = roundToTenth(Number(selectedAudioSeg.endSeconds || 0))
        sourceStart =
          selectedAudioSeg.sourceStartSeconds != null && Number.isFinite(Number(selectedAudioSeg.sourceStartSeconds))
            ? Math.max(0, roundToTenth(Number(selectedAudioSeg.sourceStartSeconds)))
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
    const videoOverlayY = VIDEO_OVERLAY_Y
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
	          { y: screenTitleY + pillH / 2, label: 'SCREEN TITLES', swatch: 'rgba(255,214,10,0.90)' },
	          { y: videoOverlayY + pillH / 2, label: 'VIDEO OVERLAY', swatch: 'rgba(255,159,10,0.90)' },
	          { y: graphicsY + pillH / 2, label: 'GRAPHICS', swatch: 'rgba(10,132,255,0.90)' },
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

      const name = namesByUploadId[Number(l.uploadId)] || `Logo ${l.uploadId}`
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

    // Freeze-frame still segments (video overlay lane)
    for (let i = 0; i < (videoOverlayStills as any[]).length; i++) {
      const s: any = (videoOverlayStills as any[])[i]
      const start = Math.max(0, Number(s?.startSeconds || 0))
      const end = Math.max(0, Number(s?.endSeconds || 0))
      const len = Math.max(0, end - start)
      if (len <= 0.01) continue
      const x = padPx + start * pxPerSecond - scrollLeft
      const w = Math.max(8, len * pxPerSecond)
      if (x > wCss + 4 || x + w < -4) continue
      const isSelected = String(s?.id) === String(selectedVideoOverlayStillId || '')
      const isDragging =
        Boolean(activeDrag) &&
        (activeDrag as any).kind === 'videoOverlayStill' &&
        String((activeDrag as any).videoOverlayStillId) === String(s?.id)
      const activeEdge = isDragging ? String((activeDrag as any).edge) : null
      const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
      const showHandles = (isSelected || isDragging) && w >= 28
      const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      roundRect(ctx, x, videoOverlayY, w, pillH, 10)
      ctx.fill()

      ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(255,255,255,0.40)'
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, videoOverlayY + 0.5, w - 1, pillH - 1, 10)
      ctx.stroke()

      if (isResizing) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(212,175,55,0.92)'
        ctx.lineWidth = 2
        roundRect(ctx, x + 0.5, videoOverlayY + 0.5, w - 1, pillH - 1, 10)
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
        ctx.fillText(clipped, x + padLeft, videoOverlayY + pillH / 2)
      }

      if (showHandles) {
        ctx.fillStyle = HANDLE_GREEN
        const hs = handleSize
        const hy = videoOverlayY + Math.floor((pillH - handleSize) / 2)
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
        const by = videoOverlayY + 3
        const bh = pillH - 6
        if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
        if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
      }
    }

    // Video overlay segments (PiP videos; no overlaps)
    if (videoOverlays.length) {
      const starts = computeClipStarts(videoOverlays as any)
      for (let i = 0; i < videoOverlays.length; i++) {
        const o: any = videoOverlays[i]
        const start = roundToTenth(Number((starts as any)[i] || 0))
        const dur = Math.max(0, clipDurationSeconds(o as any))
        const end = roundToTenth(start + dur)
        if (!(end > start + 0.01)) continue
        const x = padPx + start * pxPerSecond - scrollLeft
        const w = Math.max(8, dur * pxPerSecond)
        if (x > wCss + 4 || x + w < -4) continue
        const isSelected = String(o?.id) === String(selectedVideoOverlayId || '')
        const isDragging =
          Boolean(activeDrag) &&
          (activeDrag as any).kind === 'videoOverlay' &&
          String((activeDrag as any).videoOverlayId) === String(o?.id)
        const activeEdge = isDragging ? String((activeDrag as any).edge) : null
        const isResizing = isDragging && activeEdge != null && activeEdge !== 'move'
        const showHandles = (isSelected || isDragging) && w >= 28
        const handleSize = showHandles ? Math.max(10, Math.min(18, Math.floor(pillH - 10))) : 0

        ctx.fillStyle = 'rgba(255,159,10,0.18)'
        roundRect(ctx, x, videoOverlayY, w, pillH, 10)
        ctx.fill()

        ctx.strokeStyle = isSelected ? (isResizing ? 'rgba(212,175,55,0.92)' : 'rgba(255,255,255,0.92)') : 'rgba(255,159,10,0.55)'
        ctx.lineWidth = 1
        roundRect(ctx, x + 0.5, videoOverlayY + 0.5, w - 1, pillH - 1, 10)
        ctx.stroke()

        if (isResizing) {
          ctx.save()
          ctx.setLineDash([6, 4])
          ctx.strokeStyle = 'rgba(212,175,55,0.92)'
          ctx.lineWidth = 2
          roundRect(ctx, x + 0.5, videoOverlayY + 0.5, w - 1, pillH - 1, 10)
          ctx.stroke()
          ctx.restore()
        }

        const name = namesByUploadId[Number(o.uploadId)] || `Overlay ${o.uploadId}`
        ctx.fillStyle = '#fff'
        const padLeft = showHandles ? 6 + handleSize + 10 : 12
        const padRight = showHandles ? 6 + handleSize + 10 : 12
        const maxTextW = Math.max(0, w - padLeft - padRight)
        if (maxTextW >= 20) {
          const clipped = ellipsizeText(ctx, name, maxTextW)
          ctx.fillText(clipped, x + padLeft, videoOverlayY + pillH / 2)
        }

        if (showHandles) {
          const uploadId = Number(o.uploadId)
          const srcStart =
            o.sourceStartSeconds != null && Number.isFinite(Number(o.sourceStartSeconds)) ? Number(o.sourceStartSeconds) : 0
          const leftIsGreen = hasNoOffset(srcStart)
          const fullDurRaw = durationsByUploadId[uploadId]
          const fullDur =
            fullDurRaw != null && Number.isFinite(Number(fullDurRaw)) && Number(fullDurRaw) > 0 ? roundToTenth(Number(fullDurRaw)) : null
          const srcEnd = o.sourceEndSeconds != null && Number.isFinite(Number(o.sourceEndSeconds)) ? Number(o.sourceEndSeconds) : srcStart + dur
          const rightIsGreen = fullDur != null && nearEqual(srcEnd, fullDur)
          const hs = handleSize
          const hy = videoOverlayY + Math.floor((pillH - handleSize) / 2)
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
          const by = videoOverlayY + 3
          const bh = pillH - 6
          if (activeEdge === 'start') ctx.fillRect(x + 2, by, barW, bh)
          if (activeEdge === 'end') ctx.fillRect(x + w - 2 - barW, by, barW, bh)
        }
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
      const boostDbRaw = (n as any).boostDb != null ? Number((n as any).boostDb) : ((n as any).gainDb == null ? 0 : Number((n as any).gainDb))
      const boostDb = Number.isFinite(boostDbRaw) ? boostDbRaw : 0
      const boostLabel = Math.abs(boostDb) > 0.05 ? `${boostDb > 0 ? '+' : ''}${boostDb.toFixed(0)}dB` : '0dB'
      const label = `${baseName} • ${boostLabel}`
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
    selectedVideoOverlayId,
    selectedVideoOverlayStillId,
    selectedNarrationId,
    selectedStillId,
    trimDragging,
    timeline.clips,
    timelinePadPx,
    timelineScrollLeftPx,
    totalSeconds,
    videoOverlays,
    videoOverlayStarts,
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
        const qp = new URLSearchParams(window.location.search)
        const qpProjectId = Number(String(qp.get('project') || '0'))
        const storedProjectId = Number(String(localStorage.getItem(CURRENT_PROJECT_ID_KEY) || '0'))
        const pickId = (n: number) => (Number.isFinite(n) && n > 0 ? n : null)
        let desiredProjectId = pickId(qpProjectId) ?? pickId(storedProjectId)

        let pj: any = null
        if (desiredProjectId) {
          const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(desiredProjectId))}`, { credentials: 'same-origin' })
          const json: any = await res.json().catch(() => null)
          if (res.ok && json?.project) {
            pj = json.project
          } else {
            desiredProjectId = null
          }
        }

        if (pj && String(pj?.status || '') === 'archived') {
          pj = null
        }

        if (!pj) {
          const res = await fetch('/api/create-video/projects', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
          const json: any = await res.json().catch(() => null)
          if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
          pj = json?.project || null
        }

        const id = Number(pj?.id)
        if (!Number.isFinite(id) || id <= 0) throw new Error('failed_to_load')
        try { localStorage.setItem(CURRENT_PROJECT_ID_KEY, String(id)) } catch {}
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
	              videoOverlays: Array.isArray((tlRaw as any)?.videoOverlays) ? (((tlRaw as any).videoOverlays as any) as any) : [],
	              videoOverlayStills: Array.isArray((tlRaw as any)?.videoOverlayStills)
	                ? (((tlRaw as any).videoOverlayStills as any[]) as any[]).map((s: any) => ({
	                    ...s,
	                    id: String(s?.id || ''),
	                    uploadId: Number(s?.uploadId),
	                    startSeconds: roundToTenth(Number(s?.startSeconds || 0)),
	                    endSeconds: roundToTenth(Number(s?.endSeconds || 0)),
	                    sourceVideoOverlayId: s?.sourceVideoOverlayId != null ? String(s.sourceVideoOverlayId) : undefined,
	                    sizePctWidth: s?.sizePctWidth != null ? Number(s.sizePctWidth) : undefined,
	                    position: s?.position != null ? String(s.position) : undefined,
	                  }))
	                : [],
			          graphics: Array.isArray(tlRaw?.graphics) ? (tlRaw.graphics as any) : [],
			          guidelines,
			          logos: Array.isArray(tlRaw?.logos) ? (tlRaw.logos as any) : [],
			          lowerThirds: Array.isArray(tlRaw?.lowerThirds) ? (tlRaw.lowerThirds as any) : [],
			          screenTitles: Array.isArray(tlRaw?.screenTitles) ? (tlRaw.screenTitles as any) : [],
		          narration: Array.isArray(tlRaw?.narration)
		            ? (tlRaw.narration as any[]).map((n: any) => {
		                const gainDbRaw = n?.gainDb == null ? 0 : Number(n?.gainDb)
		                const boostDbRaw = n?.boostDb == null ? gainDbRaw : Number(n?.boostDb)
		                const boostAllowed = new Set([0, 3, 6, 9])
		                const boostDb =
		                  Number.isFinite(boostDbRaw) && boostAllowed.has(Math.round(boostDbRaw)) ? Math.round(boostDbRaw) : 0
		                return {
		                  ...n,
		                  id: String(n?.id || ''),
		                  uploadId: Number(n?.uploadId),
		                  startSeconds: roundToTenth(Number(n?.startSeconds || 0)),
		                  endSeconds: roundToTenth(Number(n?.endSeconds || 0)),
		                  sourceStartSeconds: n?.sourceStartSeconds == null ? 0 : roundToTenth(Number(n?.sourceStartSeconds || 0)),
		                  gainDb: Number.isFinite(gainDbRaw) ? gainDbRaw : 0,
		                  audioEnabled: n?.audioEnabled == null ? true : Boolean(n?.audioEnabled),
		                  boostDb,
		                }
		              })
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

  const stripGraphicsShadowFields = useCallback((tl: Timeline): Timeline => {
    if (!Array.isArray((tl as any).graphics)) return tl
    const nextGraphics = (tl as any).graphics.map((g: any) => {
      if (!g || typeof g !== 'object') return g
      const {
        shadowEnabled,
        shadowBlurSigma,
        shadowOffsetPx,
        shadowOpacityPct,
        shadowBlurPx,
        shadowColor,
        ...rest
      } = g
      return rest
    })
    return { ...(tl as any), graphics: nextGraphics }
  }, [])

	  // Autosave timeline (debounced)
	  useEffect(() => {
	    if (!project?.id) return
	    if (hydratingRef.current) return
	    if (trimDragging || panDragging) return
	    const next = { ...timeline, playheadSeconds: playhead }
	    const sanitizedNext = stripGraphicsShadowFields(next as any)
	    const json = JSON.stringify(sanitizedNext)
	    if (json === lastSavedRef.current) return
	    const timer = window.setTimeout(async () => {
	      let abort: AbortController | null = null
	      try {
	        // Prevent out-of-order saves from overwriting newer timeline state.
	        if (timelineSaveAbortRef.current) {
	          try {
	            timelineSaveAbortRef.current.abort()
	          } catch {}
	        }
	        abort = new AbortController()
	        timelineSaveAbortRef.current = abort
	        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	        const csrf = getCsrfToken()
	        if (csrf) headers['x-csrf-token'] = csrf
	        const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(project.id))}/timeline`, {
	          method: 'PATCH',
	          credentials: 'same-origin',
	          headers,
	          body: JSON.stringify({ timeline: sanitizedNext }),
	          signal: abort.signal,
	        })
	        const data: any = await res.json().catch(() => null)
	        if (!res.ok) throw new Error(String(data?.error || 'save_failed'))
	        lastSavedRef.current = json
	        // Keep local undo/redo persistence aligned to the latest saved timeline.
	        persistHistoryNow({ timelineOverride: sanitizedNext as any })
	      } catch {
	        // ignore; user can still export later
	      } finally {
	        if (abort && timelineSaveAbortRef.current === abort) timelineSaveAbortRef.current = null
	      }
	    }, 400)
	    return () => {
	      window.clearTimeout(timer)
	    }
	  }, [persistHistoryNow, playhead, project?.id, stripGraphicsShadowFields, timeline, trimDragging, panDragging])

  const saveTimelineNow = useCallback(
    async (nextTimeline: Timeline) => {
      if (!project?.id) return
      if (hydratingRef.current) return
      const sanitizedTimeline = stripGraphicsShadowFields(nextTimeline)
      let abort: AbortController | null = null
      try {
	        // Prevent out-of-order saves from overwriting newer timeline state.
	        if (timelineSaveAbortRef.current) {
	          try {
	            timelineSaveAbortRef.current.abort()
	          } catch {}
	        }
	        abort = new AbortController()
	        timelineSaveAbortRef.current = abort
	        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(project.id))}/timeline`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ timeline: sanitizedTimeline }),
          signal: abort.signal,
        })
        const data: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(data?.error || 'save_failed'))
        lastSavedRef.current = JSON.stringify(sanitizedTimeline)
        // Keep local undo/redo persistence aligned to the latest saved timeline.
        persistHistoryNow({ timelineOverride: sanitizedTimeline })
      } catch {
        // ignore; user can still export later
      } finally {
	        if (abort && timelineSaveAbortRef.current === abort) timelineSaveAbortRef.current = null
	      }
	    },
    [persistHistoryNow, project?.id, stripGraphicsShadowFields]
  )

  const forceReloadScreenTitlePresets = useCallback(async (): Promise<ScreenTitlePresetItem[]> => {
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
  }, [])

  const deleteScreenTitlePreset = useCallback(
    async (presetId: number) => {
      const headers: any = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/screen-title-presets/${encodeURIComponent(String(presetId))}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers,
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_delete'))
      await forceReloadScreenTitlePresets()
    },
    [forceReloadScreenTitlePresets]
  )

  const handledRefreshScreenTitlesRef = useRef(false)
  useEffect(() => {
    if (handledRefreshScreenTitlesRef.current) return
    if (refreshScreenTitlePresetId == null) return
    if (!screenTitles.length) return
    handledRefreshScreenTitlesRef.current = true
    ;(async () => {
      try {
        await forceReloadScreenTitlePresets()
      } catch {}
      const presetId = Number(refreshScreenTitlePresetId)
      if (!Number.isFinite(presetId) || presetId <= 0) return

      const headers: any = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf

      let nextTimeline: any = timeline
      let changed = false
      for (const st of screenTitles) {
        const stPresetId = Number((st as any).presetId || 0)
        if (stPresetId !== presetId) continue
        const textRaw = String((st as any).text || '').replace(/\r\n/g, '\n')
        const text = textRaw.trim()
        if (!text) continue
        try {
          const res = await fetch(`/api/create-video/screen-titles/render`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ presetId, text, frameW: outputFrame.width, frameH: outputFrame.height }),
          })
          const json: any = await res.json().catch(() => null)
          if (!res.ok) continue
          const uploadId = Number(json?.uploadId || 0)
          if (!Number.isFinite(uploadId) || uploadId <= 0) continue
          changed = true
          const prevSts: any[] = Array.isArray((nextTimeline as any).screenTitles) ? ((nextTimeline as any).screenTitles as any[]) : []
          const idx = prevSts.findIndex((x: any) => String((x as any).id) === String((st as any).id))
          if (idx >= 0) {
            const updated = { ...(prevSts[idx] as any), renderUploadId: uploadId }
            const out = prevSts.slice()
            out[idx] = updated
            out.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
            nextTimeline = { ...(nextTimeline as any), screenTitles: out }
          }

          try {
            const url = await getUploadCdnUrl(uploadId, { kind: 'file' })
            if (url) {
              setGraphicFileUrlByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: url }))
            }
          } catch {}
        } catch {}
      }

      if (changed) {
        setTimeline(nextTimeline)
        try { await saveTimelineNow(nextTimeline) } catch {}
      }

      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('cvRefreshScreenTitlePresetId')
        const next = `${url.pathname}${url.search}${url.hash || ''}`
        window.history.replaceState({}, '', next)
      } catch {}
    })()
  }, [forceReloadScreenTitlePresets, getUploadCdnUrl, outputFrame.height, outputFrame.width, refreshScreenTitlePresetId, saveTimelineNow, screenTitles, timeline])

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
        const videoOverlayIds = videoOverlays.map((o: any) => Number((o as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const graphicIds = graphics.map((g) => Number((g as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const logoIds = logos.map((l) => Number((l as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const lowerThirdIds = lowerThirds.map((lt) => Number((lt as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const narrationIds = narration.map((n: any) => Number((n as any).uploadId)).filter((x) => Number.isFinite(x) && x > 0)
		    const stillIds = (Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : [])
		      .map((s) => Number(s?.uploadId))
		      .filter((n) => Number.isFinite(n) && n > 0)
		    const audioIds = audioSegments.map((a: any) => Number((a as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const ids = Array.from(new Set([...clipIds, ...videoOverlayIds, ...graphicIds, ...logoIds, ...lowerThirdIds, ...narrationIds, ...stillIds, ...audioIds]))
		    if (!ids.length) return
		    const durationNeeded = new Set<number>([...clipIds, ...videoOverlayIds, ...narrationIds, ...audioIds])
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
        setDimsByUploadId((prev) => {
          const next = { ...prev }
          for (const it of items as any[]) {
            const id = Number((it as any).id)
            if (!Number.isFinite(id) || id <= 0) continue
            const w = (it as any).width
            const h = (it as any).height
            const ww = w == null ? null : Number(w)
            const hh = h == null ? null : Number(h)
            if (ww != null && hh != null && Number.isFinite(ww) && Number.isFinite(hh) && ww > 0 && hh > 0) {
              if (!next[id]) next[id] = { width: Math.round(ww), height: Math.round(hh) }
            }
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
	  }, [audioSegments, durationsByUploadId, graphics, logos, lowerThirds, namesByUploadId, narration, timeline.clips, timeline.stills, videoOverlays])

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
      const desiredMuted = (clip as any).audioEnabled === false
      const startTimeline = Number(clipStarts[idx] || 0)
      const within = Math.max(0, tClamped - startTimeline)
      const srcDur = clipSourceDurationSeconds(clip)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = clip.sourceStartSeconds + withinMoving
      const nextUploadId = Number(clip.uploadId)
      if (!Number.isFinite(nextUploadId) || nextUploadId <= 0) return

      // Fast-path: the correct upload is already loaded into the element's src (even if activeUploadId is null,
      // e.g. while showing a freeze-frame still). Avoid async src swap so play stays within the user gesture on iOS.
      if (baseLoadedUploadIdRef.current === nextUploadId) {
        if (activeUploadId !== nextUploadId) setActiveUploadId(nextUploadId)
        try { v.muted = desiredMuted } catch {}
        try {
          const w = Number(v.videoWidth || 0)
          const h = Number(v.videoHeight || 0)
          if (w > 0 && h > 0) setPreviewObjectFit(w > h ? 'contain' : 'cover')
        } catch {}
        try { v.currentTime = Math.max(0, sourceTime) } catch {}
        if (opts?.autoPlay) {
          void (async () => {
            const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
            if (!ok) setPlaying(false)
          })()
        }
        return
      }

      if (activeUploadId !== nextUploadId) {
        setActiveUploadId(nextUploadId)
        const cdn = await getUploadCdnUrl(nextUploadId, { kind: 'edit-proxy' })
        v.src = `${cdn || `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy`}#t=0.1`
        baseLoadedUploadIdRef.current = nextUploadId
        v.load()
        const onMeta = () => {
          v.removeEventListener('loadedmetadata', onMeta)
          try { v.muted = desiredMuted } catch {}
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
              const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
              if (!ok) setPlaying(false)
            })()
          }
        }
        v.addEventListener('loadedmetadata', onMeta)
      } else {
        baseLoadedUploadIdRef.current = nextUploadId
        try { v.muted = desiredMuted } catch {}
        try { v.currentTime = Math.max(0, sourceTime) } catch {}
        if (opts?.autoPlay) {
          void (async () => {
            const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
            if (!ok) setPlaying(false)
          })()
        }
      }
    },
    [activeUploadId, clipStarts, findStillAtTime, playWithAutoplayFallback, timeline.clips, totalSeconds]
  )

		  const seekOverlay = useCallback(
		    async (t: number, opts?: { autoPlay?: boolean }) => {
		      const v = overlayVideoRef.current
		      if (!v) return
	      const shouldAutoPlay = Boolean(opts?.autoPlay)
	      if (!shouldAutoPlay) {
	        try { v.pause() } catch {}
	      }
	      const tClamped = clamp(roundToTenth(t), 0, Math.max(0, totalSeconds))
	      if (!videoOverlays.length && !(videoOverlayStills as any[]).length) {
	        setOverlayActiveUploadId(null)
	        overlayLoadedUploadIdRef.current = null
	        return
	      }
	      const still = findVideoOverlayStillAtTime(tClamped)
	      if (still) {
	        return
	      }
	      const idx = findClipIndexAtTime(tClamped, videoOverlays as any, videoOverlayStarts as any)
	      if (idx < 0) {
	        activeVideoOverlayIndexRef.current = Math.max(0, videoOverlayStarts.findIndex((s) => Number(s) > tClamped + 1e-6))
	        return
	      }
      activeVideoOverlayIndexRef.current = idx
      const o: any = (videoOverlays as any)[idx]
      if (!o) return
      const desiredMuted = !Boolean((o as any).audioEnabled)
      const startTimeline = Number((videoOverlayStarts as any)[idx] || 0)
      const within = Math.max(0, tClamped - startTimeline)
      const srcDur = clipSourceDurationSeconds(o as any)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = Number(o.sourceStartSeconds || 0) + withinMoving
      const nextUploadId = Number(o.uploadId)
      if (!Number.isFinite(nextUploadId) || nextUploadId <= 0) return

	      // Fast-path: the correct upload is already loaded into the overlay element's src.
	      if (overlayLoadedUploadIdRef.current === nextUploadId) {
	        if (overlayActiveUploadId !== nextUploadId) setOverlayActiveUploadId(nextUploadId)
	        try { v.muted = desiredMuted } catch {}
        try {
          const w = Number(v.videoWidth || 0)
          const h = Number(v.videoHeight || 0)
          if (w > 0 && h > 0) {
            setDimsByUploadId((prev) =>
              prev[nextUploadId] ? prev : { ...prev, [nextUploadId]: { width: Math.round(w), height: Math.round(h) } }
            )
          }
        } catch {}
	        try { v.currentTime = Math.max(0, sourceTime) } catch {}
	        if (shouldAutoPlay) {
	          void (async () => {
	            const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
	            if (!ok) setPlaying(false)
	          })()
	        }
	        return
      }

	      if (overlayActiveUploadId !== nextUploadId) {
	        setOverlayActiveUploadId(nextUploadId)
	        const cdn = await getUploadCdnUrl(nextUploadId, { kind: 'edit-proxy' })
	        v.src = `${cdn || `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy`}#t=0.1`
        overlayLoadedUploadIdRef.current = nextUploadId
        v.load()
        const onMeta = () => {
          v.removeEventListener('loadedmetadata', onMeta)
          try { v.muted = desiredMuted } catch {}
	          try {
	            const w = Number(v.videoWidth || 0)
	            const h = Number(v.videoHeight || 0)
	            if (w > 0 && h > 0) {
	              setDimsByUploadId((prev) => (prev[nextUploadId] ? prev : { ...prev, [nextUploadId]: { width: Math.round(w), height: Math.round(h) } }))
	            }
		          } catch {}
		          try { v.currentTime = Math.max(0, sourceTime) } catch {}
		          const srcKey = String(v.currentSrc || v.src || '')
		          if (!shouldAutoPlay && srcKey && primedOverlayFrameSrcRef.current !== srcKey) {
		            primedOverlayFrameSrcRef.current = srcKey
		            void primePausedFrame(v)
		          }
		          if (shouldAutoPlay) {
		            void (async () => {
		              const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
		              if (!ok) setPlaying(false)
		            })()
		          }
	        }
        v.addEventListener('loadedmetadata', onMeta)
	      } else {
	        overlayLoadedUploadIdRef.current = nextUploadId
	        try { v.muted = desiredMuted } catch {}
	        try { v.currentTime = Math.max(0, sourceTime) } catch {}
		        if (shouldAutoPlay) {
		          void (async () => {
		            const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
		            if (!ok) setPlaying(false)
		          })()
		        }
		      }
		    },
	    [findVideoOverlayStillAtTime, overlayActiveUploadId, playWithAutoplayFallback, totalSeconds, videoOverlayStarts, videoOverlays, videoOverlayStills]
	  )

  // If the overlay lane changes (e.g. user inserts an overlay), ensure the overlay preview is
  // synced to the current playhead and NOT playing until the user hits Play.
  useEffect(() => {
    if (playingRef.current) return
    void seekOverlay(playheadRef.current)
  }, [seekOverlay, videoOverlays.length, videoOverlayStills.length])

  // Extra safety: if we're not playing, force the overlay element to stay paused even if it
  // tries to auto-play after a src swap or metadata load.
  useEffect(() => {
    if (playingRef.current) return
    try { overlayVideoRef.current?.pause?.() } catch {}
  }, [overlayActiveUploadId, videoOverlays.length, playing])

  // Ensure the preview initializes after the timeline loads (especially when playhead is 0.0).
  // Without this, `playhead` may not change during hydration, so the normal playhead-driven sync won't run.
  useEffect(() => {
    if (activeUploadId != null || overlayActiveUploadId != null) return
    void seek(playhead)
    void seekOverlay(playhead)
  }, [activeUploadId, overlayActiveUploadId, playhead, seek, seekOverlay])

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

  // Prefetch thumbnails for the active video overlay (used for preview placeholders).
  useEffect(() => {
    let alive = true
    ;(async () => {
      const o: any = activeVideoOverlayAtPlayhead as any
      if (!o) return
      const uploadId = Number(o.uploadId)
      if (!Number.isFinite(uploadId) || uploadId <= 0) return
      if (posterByUploadId[uploadId]) return
      const cdn = await getUploadCdnUrl(uploadId, { kind: 'thumb' })
      const url = cdn || `/api/uploads/${encodeURIComponent(String(uploadId))}/thumb`
      if (!alive) return
      setPosterByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: url }))
    })()
    return () => {
      alive = false
    }
  }, [activeVideoOverlayAtPlayhead, posterByUploadId])

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
          ...videoOverlayStills.map((s: any) => Number((s as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0),
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
  }, [graphicFileUrlByUploadId, graphics, logos, lowerThirds, screenTitles, stills, videoOverlayStills])

  // Keep video position synced when playhead changes by UI
  useEffect(() => {
    if (playheadFromVideoRef.current) {
      playheadFromVideoRef.current = false
      return
    }
    // If user scrubs while playing, pause for predictable behavior.
    if (playing) {
      try { videoRef.current?.pause?.() } catch {}
      try { overlayVideoRef.current?.pause?.() } catch {}
      setPlaying(false)
    }
    void seek(playhead)
    void seekOverlay(playhead)
  }, [playhead]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the base video lane becomes empty, clear the base preview video so we don't leave stale frames on screen.
  useEffect(() => {
    if (timeline.clips.length) return
    const v = videoRef.current
    try { v?.pause?.() } catch {}
    setActiveUploadId(null)
    setSelectedClipId(null)
    setClipEditor(null)
    setClipEditorError(null)
    setPreviewObjectFit('cover')
    activeClipIndexRef.current = 0
    playheadFromVideoRef.current = false
    playheadFromScrollRef.current = false
    primedFrameSrcRef.current = ''
    baseLoadedUploadIdRef.current = null
    if (v) {
      try {
        v.removeAttribute('src')
        v.load()
      } catch {}
    }
  }, [timeline.clips.length])

  const togglePlay = useCallback(() => {
    if (!(totalSeconds > 0)) return
    if (narrationPreviewPlaying) stopNarrationPreview()
    if (musicPreviewPlaying) stopMusicPreview()

    if (playing) {
      setPlaying(false)
      const curGap = gapPlaybackRef.current
      if (curGap) {
        window.cancelAnimationFrame(curGap.raf)
        gapPlaybackRef.current = null
      }
      try { videoRef.current?.pause?.() } catch {}
      try { overlayVideoRef.current?.pause?.() } catch {}
      return
    }

    const t0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
    if (t0 >= totalSeconds - 0.05) {
      playheadFromVideoRef.current = true
      playheadRef.current = 0
      setTimeline((prev) => ({ ...prev, playheadSeconds: 0 }))
    }

    const baseIdx = timeline.clips.length ? findClipIndexAtTime(t0, timeline.clips, clipStarts) : -1
    const overlayIdx = videoOverlays.length ? findClipIndexAtTime(t0, videoOverlays as any, videoOverlayStarts as any) : -1

    // Choose which element drives the playhead. Base clip wins when present; otherwise overlay; otherwise synthetic (graphics-only).
    if (baseIdx >= 0) playbackClockRef.current = 'base'
    else if (overlayIdx >= 0) playbackClockRef.current = 'overlay'
    else if (timeline.clips.length) playbackClockRef.current = 'base'
    else if (videoOverlays.length) playbackClockRef.current = 'overlay'
    else playbackClockRef.current = 'synthetic'

    setPlaying(true)

    if (baseIdx >= 0) {
      void seek(t0, { autoPlay: true })
    } else {
      try { videoRef.current?.pause?.() } catch {}
      setActiveUploadId(null)
    }

    if (overlayIdx >= 0) {
      void seekOverlay(t0, { autoPlay: true })
    } else {
      try { overlayVideoRef.current?.pause?.() } catch {}
    }
  }, [
    clipStarts,
    musicPreviewPlaying,
    narrationPreviewPlaying,
    playhead,
    playing,
    seek,
    seekOverlay,
    stopMusicPreview,
    stopNarrationPreview,
    timeline.clips,
    totalSeconds,
    videoOverlayStarts,
    videoOverlays,
  ])

  // Synthetic playback for graphics-only projects.
  useEffect(() => {
    if (timeline.clips.length) return
    if (videoOverlays.length) return
    if (playbackClockRef.current !== 'synthetic') return
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
  }, [playing, timeline.clips.length, totalSeconds, videoOverlays.length])

  // Drive playhead from the active clock video element while playing.
  // Best-effort sync: the non-clock video is periodically nudged to match the timeline time.
  useEffect(() => {
    const base = videoRef.current
    const overlay = overlayVideoRef.current
    if (!base && !overlay) return

    const safePause = (v: HTMLVideoElement | null) => {
      try { v?.pause?.() } catch {}
    }

    const syncOverlayToTimeline = (t: number) => {
      if (!overlay || !videoOverlays.length) return
      const idx = findClipIndexAtTime(t, videoOverlays as any, videoOverlayStarts as any)
      if (idx < 0) {
        safePause(overlay)
        return
      }
      const seg: any = (videoOverlays as any)[idx]
      if (!seg) return
      const uploadId = Number(seg.uploadId)
      const startTimeline = Number((videoOverlayStarts as any)[idx] || 0)
      const within = Math.max(0, t - startTimeline)
      const srcDur = clipSourceDurationSeconds(seg as any)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = Number(seg.sourceStartSeconds || 0) + withinMoving
      const desiredMuted = !Boolean((seg as any).audioEnabled)
      try { overlay.muted = desiredMuted } catch {}

      if (overlayActiveUploadId !== uploadId) {
        void seekOverlay(t, { autoPlay: playingRef.current })
        return
      }
      if (Number.isFinite(sourceTime) && Math.abs((overlay.currentTime || 0) - sourceTime) > 0.25) {
        try { overlay.currentTime = Math.max(0, sourceTime) } catch {}
      }
      if (playingRef.current && overlay.paused) {
        void (async () => {
          const ok = await playWithAutoplayFallback(overlay, { unmuteAfterPlay: !desiredMuted })
          if (!ok && playbackClockRef.current === 'overlay') setPlaying(false)
        })()
      }
    }

    const syncBaseToTimeline = (t: number) => {
      if (!base || !timeline.clips.length) return
      const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
      if (idx < 0) {
        safePause(base)
        return
      }
      const clip = timeline.clips[idx]
      if (!clip) return
      const desiredMuted = (clip as any).audioEnabled === false
      try { base.muted = desiredMuted } catch {}
      if (activeUploadId !== Number(clip.uploadId)) {
        void seek(t, { autoPlay: playingRef.current })
        return
      }
      const startTimeline = Number(clipStarts[idx] || 0)
      const within = Math.max(0, t - startTimeline)
      const srcDur = clipSourceDurationSeconds(clip)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = Number(clip.sourceStartSeconds) + withinMoving
      if (Number.isFinite(sourceTime) && Math.abs((base.currentTime || 0) - sourceTime) > 0.25) {
        try { base.currentTime = Math.max(0, sourceTime) } catch {}
      }
      if (playingRef.current && base.paused) {
        void (async () => {
          const ok = await playWithAutoplayFallback(base, { unmuteAfterPlay: !desiredMuted })
          if (!ok && playbackClockRef.current === 'base') setPlaying(false)
        })()
      }
    }

    const onPlayBase = () => {
      if (playbackClockRef.current === 'base') setPlaying(true)
    }
    const onPauseBase = () => {
      if (suppressNextVideoPauseRef.current) {
        suppressNextVideoPauseRef.current = false
        return
      }
      if (playbackClockRef.current === 'base') setPlaying(false)
    }
    const onTimeBase = () => {
      if (!playingRef.current) return
      if (playbackClockRef.current !== 'base') return
      if (!base || base.paused) return
      if (!timeline.clips.length) return

      const clipIndex = Math.max(0, Math.min(activeClipIndexRef.current, timeline.clips.length - 1))
      const clip = timeline.clips[clipIndex]
      if (!clip) return
      const startTimeline = Number(clipStarts[clipIndex] || 0)
      const withinNow = Math.max(0, (base.currentTime || 0) - Number(clip.sourceStartSeconds))
      const srcDur = clipSourceDurationSeconds(clip)

      const nextPlayhead = startTimeline + withinNow
      const next = clamp(roundToTenth(nextPlayhead), 0, Math.max(0, totalSeconds))
      if (Math.abs(next - Number(playheadRef.current || 0)) >= 0.1) {
        playheadFromVideoRef.current = true
        playheadRef.current = next
        setTimeline((prev) => ({ ...prev, playheadSeconds: next }))
      }

      syncOverlayToTimeline(next)

      const clipLen = clipDurationSeconds(clip)
      const endTimeline = roundToTenth(startTimeline + clipLen)
      if (withinNow >= srcDur - 0.12 && clipIndex < timeline.clips.length - 1) {
        const nextStart = roundToTenth(Number(clipStarts[clipIndex + 1] || 0))
        if (nextStart > endTimeline + 0.05) {
          suppressNextVideoPauseRef.current = true
          safePause(base)
          setActiveUploadId(null)
          playheadFromVideoRef.current = true
          playheadRef.current = endTimeline
          setTimeline((prev) => ({ ...prev, playheadSeconds: endTimeline }))
          return
        }
        const nextClip = timeline.clips[clipIndex + 1]
        const sameUpload = nextClip && Number(nextClip.uploadId) === Number(clip.uploadId)
        if (!sameUpload) {
          safePause(base)
          setPlaying(false)
          playheadFromVideoRef.current = true
          playheadRef.current = nextStart
          setTimeline((prev) => ({ ...prev, playheadSeconds: nextStart }))
          void seek(nextStart)
          return
        }
        activeClipIndexRef.current = clipIndex + 1
        playheadFromVideoRef.current = true
        playheadRef.current = nextStart
        setTimeline((prev) => ({ ...prev, playheadSeconds: nextStart }))
        void seek(nextStart, { autoPlay: true })
      } else if (withinNow >= srcDur - 0.05 && clipIndex === timeline.clips.length - 1) {
        if (totalSeconds > endTimeline + 0.05) {
          suppressNextVideoPauseRef.current = true
          safePause(base)
          setActiveUploadId(null)
          playheadFromVideoRef.current = true
          playheadRef.current = endTimeline
          setTimeline((prev) => ({ ...prev, playheadSeconds: endTimeline }))
          return
        }
        safePause(base)
        setPlaying(false)
      }
    }

    const onPlayOverlay = () => {
      if (!playingRef.current) {
        try { overlay?.pause?.() } catch {}
        return
      }
      if (playbackClockRef.current === 'overlay') setPlaying(true)
    }
    const onPauseOverlay = () => {
      if (suppressNextVideoPauseRef.current) {
        suppressNextVideoPauseRef.current = false
        return
      }
      if (playbackClockRef.current === 'overlay') setPlaying(false)
    }
    const onTimeOverlay = () => {
      if (!playingRef.current) return
      if (playbackClockRef.current !== 'overlay') return
      if (!overlay || overlay.paused) return
      if (!videoOverlays.length) return

      const overlayIndex = Math.max(0, Math.min(activeVideoOverlayIndexRef.current, videoOverlays.length - 1))
      const o: any = (videoOverlays as any)[overlayIndex]
      if (!o) return
      const startTimeline = Number((videoOverlayStarts as any)[overlayIndex] || 0)
      const withinNow = Math.max(0, (overlay.currentTime || 0) - Number(o.sourceStartSeconds || 0))
      const srcDur = clipSourceDurationSeconds(o as any)

      const nextPlayhead = startTimeline + withinNow
      const next = clamp(roundToTenth(nextPlayhead), 0, Math.max(0, totalSeconds))
      if (Math.abs(next - Number(playheadRef.current || 0)) >= 0.1) {
        playheadFromVideoRef.current = true
        playheadRef.current = next
        setTimeline((prev) => ({ ...prev, playheadSeconds: next }))
      }

      syncBaseToTimeline(next)

      const clipLen = clipDurationSeconds(o as any)
      const endTimeline = roundToTenth(startTimeline + clipLen)
      if (withinNow >= srcDur - 0.12 && overlayIndex < videoOverlays.length - 1) {
        const nextStart = roundToTenth(Number((videoOverlayStarts as any)[overlayIndex + 1] || 0))
        if (nextStart > endTimeline + 0.05) {
          // There's a gap before the next overlay segment. Pause the overlay and keep advancing the
          // playhead via base "gap playback" until the next boundary (or end). We must not autoplay
          // into the next overlay segment due to iOS gesture requirements.
          playbackClockRef.current = 'base'
          suppressNextVideoPauseRef.current = true
          safePause(overlay)
          playheadFromVideoRef.current = true
          playheadRef.current = endTimeline
          setTimeline((prev) => ({ ...prev, playheadSeconds: endTimeline }))
          void seek(endTimeline)
          void seekOverlay(endTimeline)
          return
        }
        const nextO: any = (videoOverlays as any)[overlayIndex + 1]
        const sameUpload = nextO && Number(nextO.uploadId) === Number(o.uploadId)
        if (!sameUpload) {
          safePause(overlay)
          setPlaying(false)
          playheadFromVideoRef.current = true
          playheadRef.current = nextStart
          setTimeline((prev) => ({ ...prev, playheadSeconds: nextStart }))
          void seekOverlay(nextStart)
          return
        }
        activeVideoOverlayIndexRef.current = overlayIndex + 1
        playheadFromVideoRef.current = true
        playheadRef.current = nextStart
        setTimeline((prev) => ({ ...prev, playheadSeconds: nextStart }))
        void seekOverlay(nextStart, { autoPlay: true })
        return
      }
      if (withinNow >= srcDur - 0.05 && overlayIndex === videoOverlays.length - 1) {
        // Overlay ended. If we're landing on a base clip, stop and wait for a user Play gesture.
        // If we're landing on a gap/freeze, continue advancing the playhead via base "gap playback".
        playbackClockRef.current = 'base'
        suppressNextVideoPauseRef.current = true
        safePause(overlay)
        playheadFromVideoRef.current = true
        playheadRef.current = endTimeline
        setTimeline((prev) => ({ ...prev, playheadSeconds: endTimeline }))
        void seek(endTimeline)
        void seekOverlay(endTimeline)

        const baseIdxAtEnd = findClipIndexAtTime(endTimeline, timeline.clips, clipStarts)
        if (baseIdxAtEnd >= 0) {
          setPlaying(false)
          return
        }
        if (totalSeconds <= endTimeline + 0.05) {
          setPlaying(false)
        }
      }
    }

    if (base) {
      base.addEventListener('play', onPlayBase)
      base.addEventListener('pause', onPauseBase)
      base.addEventListener('timeupdate', onTimeBase)
    }
    if (overlay) {
      overlay.addEventListener('play', onPlayOverlay)
      overlay.addEventListener('pause', onPauseOverlay)
      overlay.addEventListener('timeupdate', onTimeOverlay)
    }
    return () => {
      if (base) {
        base.removeEventListener('play', onPlayBase)
        base.removeEventListener('pause', onPauseBase)
        base.removeEventListener('timeupdate', onTimeBase)
      }
      if (overlay) {
        overlay.removeEventListener('play', onPlayOverlay)
        overlay.removeEventListener('pause', onPauseOverlay)
        overlay.removeEventListener('timeupdate', onTimeOverlay)
      }
    }
  }, [
    activeUploadId,
    clipStarts,
    overlayActiveUploadId,
    playWithAutoplayFallback,
    seek,
    seekOverlay,
    timeline.clips,
    totalSeconds,
    videoOverlayStarts,
    videoOverlays,
  ])

	  // Gap playback for absolute-positioned clips: advance the playhead through black gaps.
	  useEffect(() => {
	    if (playbackClockRef.current !== 'base') return
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

	    // If an overlay segment starts exactly at (or has already reached) the current playhead while
	    // the base lane is in a gap (e.g. during an intro freeze still), stop and wait for a user
	    // Play gesture. This ensures we don't "run through" the overlay start without actually
	    // starting overlay playback.
	    if (videoOverlays.length) {
	      const overlayIdxNow = findClipIndexAtTime(playhead, videoOverlays as any, videoOverlayStarts as any)
	      if (overlayIdxNow >= 0) {
	        const cur = gapPlaybackRef.current
	        if (cur) {
	          window.cancelAnimationFrame(cur.raf)
	          gapPlaybackRef.current = null
	        }
	        setPlaying(false)
	        void seek(playhead)
	        void seekOverlay(playhead)
	        return
	      }
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

	    let nextOverlayIndex: number | null = null
	    if (videoOverlays.length) {
	      for (let i = 0; i < videoOverlayStarts.length; i++) {
	        const s = Number((videoOverlayStarts as any)[i] || 0)
	        if (s > playhead + eps) {
	          nextOverlayIndex = i
	          break
	        }
	      }
	    }

	    const nextClipStart = nextClipIndex != null ? roundToTenth(Number(clipStarts[nextClipIndex] || 0)) : Number.POSITIVE_INFINITY
	    const nextOverlayStart =
	      nextOverlayIndex != null ? roundToTenth(Number((videoOverlayStarts as any)[nextOverlayIndex] || 0)) : Number.POSITIVE_INFINITY
	    const target0 = Math.min(nextClipStart, nextOverlayStart, roundToTenth(totalSeconds))
	    const target = Number.isFinite(target0) ? target0 : roundToTenth(totalSeconds)
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
	        // Prime the next boundary frame (base and overlay) without attempting autoplay.
	        void seek(target)
	        void seekOverlay(target)
	        return
	      }

	      const raf = window.requestAnimationFrame(tick)
	      gapPlaybackRef.current = { raf, target, nextClipIndex }
	    }

	    const raf = window.requestAnimationFrame(tick)
	    gapPlaybackRef.current = { raf, target, nextClipIndex }
	  }, [clipStarts, playhead, playing, seek, seekOverlay, timeline.clips.length, totalSeconds, videoOverlayStarts, videoOverlays.length])

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

  const handledOpenAddStepRef = useRef(false)
  useEffect(() => {
    if (handledOpenAddStepRef.current) return
    if (!openAddStepFromUrl) return
    handledOpenAddStepRef.current = true
    try {
      const current = new URL(window.location.href)
      current.searchParams.delete('cvOpenAdd')
      const ret = `${current.pathname}${current.search}${current.hash || ''}`

      const qp = new URLSearchParams(current.search)
      const project = qp.get('project')

      const path = openAddStepFromUrl === 'screenTitle' ? '/assets/screen-titles' : '/assets'
      const u = new URL(path, window.location.origin)
      u.searchParams.set('mode', 'pick')
      u.searchParams.set('return', ret)
      if (project) u.searchParams.set('project', String(project))
      window.location.href = `${u.pathname}${u.search}`
    } catch {
      window.location.href = '/assets?mode=pick'
    }
  }, [openAddStepFromUrl])

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

	  const addClipFromUpload = useCallback(
	    (upload: UploadListItem) => {
	      const dur = upload.duration_seconds != null ? Number(upload.duration_seconds) : null
	      if (dur == null || !Number.isFinite(dur) || dur <= 0) {
	        setTimelineMessage('That video is missing duration metadata. Please try a different video.')
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
	        audioEnabled: true,
	      }
	      snapshotUndo()
	      setTimeline((prev) => {
	        if (!rippleEnabledRef.current) return insertClipAtPlayhead(prev, newClip)
	        // Insert at (or after) the playhead, allowing overlap to the right (ripple-right only).
	        const clipStarts = computeClipStarts(prev.clips)
	        const prevClips: Clip[] = prev.clips.map((c, i) => ({ ...c, startSeconds: roundToTenth(Number((c as any).startSeconds ?? clipStarts[i] ?? 0)) }))
	        const prevStills: Still[] = Array.isArray((prev as any).stills) ? ((prev as any).stills as any) : []
	        const desiredStart0 = clamp(roundToTenth(Number(prev.playheadSeconds || 0)), 0, MAX_TIMELINE_SECONDS)

	        // Block/adjust left collisions only: if playhead is inside an existing base segment, start after it.
	        const segs: Array<{ kind: 'clip' | 'still'; start: number; end: number }> = []
	        for (const c of prevClips as any[]) {
	          const s = roundToTenth(Number((c as any).startSeconds || 0))
	          const e = roundToTenth(s + clipDurationSeconds(c as any))
	          if (Number.isFinite(s) && Number.isFinite(e) && e > s) segs.push({ kind: 'clip', start: s, end: e })
	        }
	        for (const st of prevStills as any[]) {
	          const s = roundToTenth(Number((st as any).startSeconds || 0))
	          const e = roundToTenth(Number((st as any).endSeconds || 0))
	          if (Number.isFinite(s) && Number.isFinite(e) && e > s) segs.push({ kind: 'still', start: s, end: e })
	        }
	        segs.sort((a, b) => a.start - b.start || a.end - b.end)
	        let startSeconds = desiredStart0
	        for (const seg of segs) {
	          if (startSeconds < seg.end - 1e-6 && startSeconds > seg.start + 1e-6) {
	            startSeconds = roundToTenth(seg.end)
	          }
	        }

	        const placed: Clip = { ...newClip, startSeconds }
	        const nextClips = [...prevClips, placed].sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))

	        const ripple = rippleRightBaseLane(nextClips as any, prevStills as any, 'clip', placed.id)
	        if (!ripple) {
	          setTimelineMessage('Timeline max length reached.')
	          return prev
	        }
	        const nextTimeline0: any = { ...(prev as any), clips: ripple.clips, stills: ripple.stills }
	        const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
	        const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
	        const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
	        const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
	        return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
	      })
	      setSelectedClipId(id)
	      setSelectedVideoOverlayId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, rippleRightBaseLane, setTimeline, snapshotUndo]
  )

  const addVideoOverlayFromUpload = useCallback(
    (upload: UploadListItem) => {
      const dur = upload.duration_seconds != null ? Number(upload.duration_seconds) : null
      if (dur == null || !Number.isFinite(dur) || dur <= 0) {
        setTimelineMessage('That video is missing duration metadata. Please try a different video.')
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
      const id = `vo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const overlay: VideoOverlay = {
        id,
        uploadId: Number(upload.id),
        sourceStartSeconds: 0,
        sourceEndSeconds: roundToTenth(dur),
        sizePctWidth: 90,
        position: 'bottom_center',
        audioEnabled: true,
        plateStyle: 'none',
        plateColor: '#000000',
        plateOpacityPct: 85,
      }
      snapshotUndo()
      setTimeline((prev) => {
        if (!rippleEnabledRef.current) return insertVideoOverlayAtPlayhead(prev as any, overlay as any) as any
        const prevOs0: any[] = Array.isArray((prev as any).videoOverlays) ? (prev as any).videoOverlays : []
        const starts = computeClipStarts(prevOs0 as any)
        const prevOs = prevOs0.map((o: any, i: number) => ({ ...(o as any), startSeconds: roundToTenth(Number((o as any).startSeconds ?? starts[i] ?? 0)) }))
        const desiredStart0 = clamp(roundToTenth(Number(prev.playheadSeconds || 0)), 0, MAX_TIMELINE_SECONDS)
        // Adjust only for left collision (if inside an existing overlay).
        let startSeconds = desiredStart0
        const ranges = prevOs
          .map((o: any) => {
            const s = roundToTenth(Number(o.startSeconds || 0))
            const e = roundToTenth(s + clipDurationSeconds(o as any))
            return { id: String(o.id), start: s, end: e }
          })
          .sort((a: any, b: any) => a.start - b.start)
        for (const r of ranges) {
          if (startSeconds < r.end - 1e-6 && startSeconds > r.start + 1e-6) startSeconds = roundToTenth(r.end)
        }
        const placed: any = { ...(overlay as any), startSeconds }
        const nextOs = [...prevOs, placed].sort((a: any, b: any) => Number(a.startSeconds || 0) - Number(b.startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
        const ripple = rippleRightDerivedLane(nextOs as any, String(placed.id), { getDurationSeconds: (x: any) => clipDurationSeconds(x as any) })
        if (!ripple) {
          setTimelineMessage('Timeline max length reached.')
          return prev
        }
        const nextTimeline0: any = { ...(prev as any), videoOverlays: ripple.items }
        const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
        const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
        const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
        const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
        return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
      })
      setSelectedVideoOverlayId(id)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, insertVideoOverlayAtPlayhead, rippleRightDerivedLane, snapshotUndo]
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
        setTimelineMessage('Not enough room to add a 5s graphic within the video duration.')
        return
      }

      const existing = graphics.slice().sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
      if (!rippleEnabledRef.current) {
        // Disallow overlaps: slide forward to the next available slot.
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
              setTimelineMessage('No available slot for a 5s graphic without overlapping.')
              return
            }
          }
        }
      } else {
        // Ripple-right insert: only adjust for left collision (if playhead is inside an existing segment).
        for (const g of existing as any[]) {
          const gs = Number((g as any).startSeconds)
          const ge = Number((g as any).endSeconds)
          if (!(Number.isFinite(gs) && Number.isFinite(ge) && ge > gs)) continue
          if (start < ge - 1e-6 && start > gs + 1e-6) {
            start = roundToTenth(ge)
            end = roundToTenth(start + dur)
          }
        }
      }

      const newGraphic: Graphic = {
        id,
        uploadId: Number(upload.id),
        startSeconds: start,
        endSeconds: end,
        fitMode: 'contain_transparent',
        sizePctWidth: 70,
        position: 'middle_center',
        insetXPx: 100,
        insetYPx: 100,
        borderWidthPx: 0,
        borderColor: '#000000',
        fade: 'none',
      }
      snapshotUndo()
      setTimeline((prev) => {
        const prevGs: Graphic[] = Array.isArray((prev as any).graphics) ? ((prev as any).graphics as any) : []
        const next = [...prevGs, newGraphic].sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds))
        if (rippleEnabledRef.current) {
          const ripple = rippleRightSimpleLane(next as any, String(newGraphic.id))
          if (!ripple) {
            setTimelineMessage('Timeline max length reached.')
            return prev
          }
          const nextTimeline0: any = { ...(prev as any), graphics: ripple.items }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }
        return { ...prev, graphics: next }
      })
      setSelectedClipId(null)
      setSelectedVideoOverlayId(null)
      setSelectedGraphicId(id)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, graphics, playhead, rippleRightSimpleLane, snapshotUndo, timeline.clips.length, totalSecondsVideo]
  )

  const addLogoFromPick = useCallback(
    (uploadIdRaw: number) => {
      const uploadId = Number(uploadIdRaw)
      if (!Number.isFinite(uploadId) || uploadId <= 0) return

      const dur = 5.0
      const id = `logo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const start0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
      let start = start0
      let end = roundToTenth(start + dur)
      const cap = totalSeconds > 0 ? totalSeconds : end
      if (end > cap + 1e-6) {
        setTimelineMessage('Not enough room to add a 5s logo segment within the timeline.')
        return
      }

      const existing = logos.slice().sort((a, b) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
      if (!rippleEnabledRef.current) {
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
            if (end > cap + 1e-6) {
              setTimelineMessage('No available slot for a 5s logo segment without overlapping.')
              return
            }
          }
        }
      } else {
        // Ripple-right insert: only adjust for left collision (if inside an existing segment).
        for (const l of existing as any[]) {
          const ls = Number((l as any).startSeconds)
          const le = Number((l as any).endSeconds)
          if (!(Number.isFinite(ls) && Number.isFinite(le) && le > ls)) continue
          if (start < le - 1e-6 && start > ls + 1e-6) {
            start = roundToTenth(le)
            end = roundToTenth(start + dur)
            if (end > cap + 1e-6) {
              setTimelineMessage('Not enough room to add a 5s logo segment within the timeline.')
              return
            }
          }
        }
      }

      const seg: Logo = {
        id,
        uploadId,
        startSeconds: start,
        endSeconds: end,
        sizePctWidth: 20,
        position: 'top_left',
        opacityPct: 100,
        fade: 'none',
        insetXPx: 100,
        insetYPx: 100,
      }
      snapshotUndo()
      setTimeline((prev) => {
        const prevLogos: Logo[] = Array.isArray((prev as any).logos) ? ((prev as any).logos as any) : []
        const next = [...prevLogos, seg].sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
        if (rippleEnabledRef.current) {
          const ripple = rippleRightSimpleLane(next as any, String(seg.id))
          if (!ripple) {
            setTimelineMessage('Timeline max length reached.')
            return prev
          }
          const nextTimeline0: any = { ...(prev as any), logos: ripple.items }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }
        return { ...prev, logos: next }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setSelectedLogoId(id)
      setSelectedLowerThirdId(null)
    },
    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, logos, playhead, rippleRightSimpleLane, snapshotUndo, totalSeconds]
  )

	  const addLowerThirdFromPick = useCallback(
	    (uploadIdRaw: number, configIdRaw: number, configsOverride?: LowerThirdConfigItem[]) => {
      const uploadId = Number(uploadIdRaw)
      const cfgId = Number(configIdRaw)
      if (!Number.isFinite(uploadId) || uploadId <= 0) return
      if (!Number.isFinite(cfgId) || cfgId <= 0) {
        setTimelineMessage('Pick a lower third configuration.')
        return
      }
      const cfgSource = Array.isArray(configsOverride) && configsOverride.length ? configsOverride : lowerThirdConfigs
      const cfg = cfgSource.find((c: any) => Number((c as any).id) === cfgId) || null
      if (!cfg) {
        setTimelineMessage('Lower third configuration not found.')
        return
      }

	      const dur = 10.0
	      const id = `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
	      const start0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
	      let start = start0
	      let end = roundToTenth(start + dur)
	      // When there is no base timeline (no clips/graphics/stills), allow lower-thirds to extend the timeline
	      // even if a short logo segment already exists (logos shouldn't "cap" the timeline).
	      const baseSeconds = Math.max(0, roundToTenth(Math.max(totalSecondsVideo, totalSecondsGraphics, totalSecondsStills)))
	      const cap = baseSeconds > 0 ? baseSeconds : Math.max(totalSeconds, end)
	      if (end > cap + 1e-6) {
	        setTimelineMessage('Not enough room to add a 10s lower third segment within the timeline.')
	        return
	      }

      const existing = lowerThirds.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
      if (!rippleEnabledRef.current) {
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
            if (end > cap + 1e-6) {
              setTimelineMessage('No available slot for a 10s lower third segment without overlapping.')
              return
            }
          }
        }
      } else {
        for (const lt of existing as any[]) {
          const ls = Number((lt as any).startSeconds)
          const le = Number((lt as any).endSeconds)
          if (!(Number.isFinite(ls) && Number.isFinite(le) && le > ls)) continue
          if (start < le - 1e-6 && start > ls + 1e-6) {
            start = roundToTenth(le)
            end = roundToTenth(start + dur)
            if (end > cap + 1e-6) {
              setTimelineMessage('Not enough room to add a 10s lower third segment within the timeline.')
              return
            }
          }
        }
      }

      const seg: LowerThird = { id, uploadId, startSeconds: start, endSeconds: end, configId: cfgId, configSnapshot: cfg as any }
      snapshotUndo()
      setTimeline((prev) => {
        const prevLts: LowerThird[] = Array.isArray((prev as any).lowerThirds) ? ((prev as any).lowerThirds as any) : []
        const next = [...prevLts, seg].sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
        if (rippleEnabledRef.current) {
          const ripple = rippleRightSimpleLane(next as any, String(seg.id))
          if (!ripple) {
            setTimelineMessage('Timeline max length reached.')
            return prev
          }
          const nextTimeline0: any = { ...(prev as any), lowerThirds: ripple.items }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }
        return { ...prev, lowerThirds: next }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setSelectedLowerThirdId(id)
      setSelectedScreenTitleId(null)
	    },
	    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, lowerThirdConfigs, lowerThirds, playhead, rippleRightSimpleLane, snapshotUndo, totalSeconds, totalSecondsGraphics, totalSecondsStills, totalSecondsVideo]
	  )

  const addScreenTitleFromPreset = useCallback(
    (preset: ScreenTitlePresetItem) => {
      const presetId = Number((preset as any).id)
      if (!Number.isFinite(presetId) || presetId <= 0) return
      if (!(totalSeconds > 0)) {
        setTimelineMessage('Add a video or graphic first.')
        return
      }

      const dur = 5.0
      const id = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const start0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
      let start = start0
      let end = roundToTenth(start + dur)
      if (end > totalSeconds + 1e-6) {
        setTimelineMessage('Not enough room to add a 5s screen title segment within the timeline.')
        return
      }

      const existing = screenTitles.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
      if (!rippleEnabledRef.current) {
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
              setTimelineMessage('No available slot for a 5s screen title segment without overlapping.')
              return
            }
          }
        }
      } else {
        for (const st of existing as any[]) {
          const ss = Number((st as any).startSeconds)
          const se = Number((st as any).endSeconds)
          if (!(Number.isFinite(ss) && Number.isFinite(se) && se > ss)) continue
          if (start < se - 1e-6 && start > ss + 1e-6) {
            start = roundToTenth(se)
            end = roundToTenth(start + dur)
            if (end > totalSeconds + 1e-6) {
              setTimelineMessage('Not enough room to add a 5s screen title segment within the timeline.')
              return
            }
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
        lineSpacingPct: Number((preset as any).lineSpacingPct ?? 0),
        fontColor: String((preset as any).fontColor || '#ffffff'),
        shadowColor: String((preset as any).shadowColor || '#000000'),
        shadowOffsetPx: Number((preset as any).shadowOffsetPx ?? 2),
        shadowBlurPx: Number((preset as any).shadowBlurPx ?? 0),
        shadowOpacityPct: Number((preset as any).shadowOpacityPct ?? 65),
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
        if (rippleEnabledRef.current) {
          const ripple = rippleRightSimpleLane(next as any, String(seg.id))
          if (!ripple) {
            setTimelineMessage('Timeline max length reached.')
            return prev
          }
          const nextTimeline0: any = { ...(prev as any), screenTitles: ripple.items }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }
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
    },
    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, playhead, rippleRightSimpleLane, screenTitles, snapshotUndo, totalSeconds]
  )

  const addAudioFromUpload = useCallback(
    (upload: SystemAudioItem) => {
      if (!(contentTotalSeconds > 0)) {
        setTimelineMessage('Add a video/graphic (anything with time) before adding Music.')
        return
      }
      const id = Number(upload.id)
      if (!Number.isFinite(id) || id <= 0) {
        setTimelineMessage('Invalid audio id')
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

      snapshotUndo()
      const segId = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      setTimeline((prev) => {
        const prevSegs: any[] = Array.isArray((prev as any).audioSegments) ? ((prev as any).audioSegments as any[]) : []
        const maxEnd = roundToTenth(Math.max(0, contentTotalSeconds))
        const ph = clamp(roundToTenth(Number((prev as any).playheadSeconds || 0)), 0, maxEnd)

        // If this is the first music segment, default to covering the whole content range (or the file duration if shorter).
        // Otherwise, default to a short segment at the playhead.
        const defaultLen = prevSegs.length ? 5 : (dur != null && Number.isFinite(dur) && dur > 0 ? Math.min(maxEnd, dur) : maxEnd)
        const start = prevSegs.length ? ph : 0
        const end0 = prevSegs.length ? Math.min(maxEnd, start + defaultLen) : Math.min(maxEnd, defaultLen)
        const end = roundToTenth(end0)
        if (!(end > start + 1e-6)) {
          setTimelineMessage('No room to add Music here.')
          return prev
        }

        const seg: any = {
          id: segId,
          uploadId: id,
          ...(audioConfigId ? { audioConfigId } : {}),
          audioEnabled: true,
          startSeconds: roundToTenth(start),
          endSeconds: end,
          sourceStartSeconds: 0,
        }

        const next0 = [...prevSegs, seg].sort(
          (a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id))
        )

        if (rippleEnabledRef.current) {
          const ripple = rippleRightSimpleLane(next0 as any, String(seg.id))
          if (!ripple) {
            setTimelineMessage('Timeline max length reached.')
            return prev
          }
          const nextTimeline0: any = { ...(prev as any), audioTrack: null, audioSegments: ripple.items }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }

        // No ripple: require no overlaps.
        for (let i = 1; i < next0.length; i++) {
          const prevSeg = next0[i - 1] as any
          const curSeg = next0[i] as any
          if (Number(curSeg.startSeconds) < Number(prevSeg.endSeconds) - 1e-6) {
            setTimelineMessage('Not enough room to add Music here. Turn Ripple ON or move items.')
            return prev
          }
        }

        return { ...(prev as any), audioTrack: null, audioSegments: next0 }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
      setSelectedAudioId(segId)
    },
    [audioConfigs, audioSegments, contentTotalSeconds, snapshotUndo]
  )

  const addAudioFromUploadWithConfig = useCallback(
    (upload: SystemAudioItem, audioConfigIdRaw: number, configsOverride?: AudioConfigItem[]) => {
      if (!(contentTotalSeconds > 0)) {
        setTimelineMessage('Add a video/graphic (anything with time) before adding Music.')
        return
      }
      const id = Number((upload as any).id)
      if (!Number.isFinite(id) || id <= 0) {
        setTimelineMessage('Invalid audio id')
        return
      }
      const audioConfigId = Number(audioConfigIdRaw)
      const cfgs = Array.isArray(configsOverride) && configsOverride.length ? configsOverride : Array.isArray(audioConfigs) ? audioConfigs : []
      const audioConfigIdOk =
        Number.isFinite(audioConfigId) && audioConfigId > 0 && cfgs.some((c) => Number((c as any).id) === audioConfigId) ? audioConfigId : null

      const name = String((upload as any).modified_filename || (upload as any).original_filename || `Audio ${id}`)
      setNamesByUploadId((prev) => (prev[id] ? prev : { ...prev, [id]: name }))
      const dur = (upload as any).duration_seconds != null ? Number((upload as any).duration_seconds) : null
      if (dur != null && Number.isFinite(dur) && dur > 0) {
        setDurationsByUploadId((prev) => ({ ...prev, [id]: dur }))
      }

      snapshotUndo()
      const segId = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      setTimeline((prev) => {
        const prevSegs: any[] = Array.isArray((prev as any).audioSegments) ? ((prev as any).audioSegments as any[]) : []
        const maxEnd = roundToTenth(Math.max(0, contentTotalSeconds))
        const ph = clamp(roundToTenth(Number((prev as any).playheadSeconds || 0)), 0, maxEnd)
        const defaultLen = prevSegs.length ? 5 : (dur != null && Number.isFinite(dur) && dur > 0 ? Math.min(maxEnd, dur) : maxEnd)
        const start = prevSegs.length ? ph : 0
        const end0 = prevSegs.length ? Math.min(maxEnd, start + defaultLen) : Math.min(maxEnd, defaultLen)
        const end = roundToTenth(end0)
        if (!(end > start + 1e-6)) {
          setTimelineMessage('No room to add Music here.')
          return prev
        }

        const seg: any = {
          id: segId,
          uploadId: id,
          ...(audioConfigIdOk ? { audioConfigId: audioConfigIdOk } : {}),
          audioEnabled: true,
          startSeconds: roundToTenth(start),
          endSeconds: end,
          sourceStartSeconds: 0,
        }

        const next0 = [...prevSegs, seg].sort(
          (a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id))
        )

        if (rippleEnabledRef.current) {
          const ripple = rippleRightSimpleLane(next0 as any, String(seg.id))
          if (!ripple) {
            setTimelineMessage('Timeline max length reached.')
            return prev
          }
          const nextTimeline0: any = { ...(prev as any), audioTrack: null, audioSegments: ripple.items }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }

        for (let i = 1; i < next0.length; i++) {
          const prevSeg = next0[i - 1] as any
          const curSeg = next0[i] as any
          if (Number(curSeg.startSeconds) < Number(prevSeg.endSeconds) - 1e-6) {
            setTimelineMessage('Not enough room to add Music here. Turn Ripple ON or move items.')
            return prev
          }
        }
        return { ...(prev as any), audioTrack: null, audioSegments: next0 }
      })
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedStillId(null)
      setSelectedAudioId(segId)
    },
    [audioConfigs, contentTotalSeconds, snapshotUndo]
  )

  const fmtSize = useCallback((bytes: any): string => {
    const n = Number(bytes)
    if (!Number.isFinite(n) || n <= 0) return '—'
    const kb = n / 1024
    if (kb < 1024) return `${Math.round(kb)} KB`
    const mb = kb / 1024
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
  }, [])

  const fmtYmd = useCallback((dt: any): string => {
    if (!dt) return ''
    const d = new Date(dt)
    if (!Number.isFinite(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }, [])

  const fmtDuration = useCallback((seconds: any): string => {
    const s0 = Number(seconds)
    if (!Number.isFinite(s0) || s0 <= 0) return '—'
    const s = Math.round(s0)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    return `${m}:${String(ss).padStart(2, '0')}`
  }, [])

  const addNarrationFromUpload = useCallback(
    async (item: any) => {
      const uploadId = Number(item?.id || 0)
      if (!Number.isFinite(uploadId) || uploadId <= 0) return
      const name = String(item?.modified_filename || item?.original_filename || `Narration ${uploadId}`).trim() || `Narration ${uploadId}`
      setNamesByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: name }))
      const dur = item?.duration_seconds != null ? Number(item.duration_seconds) : null
      if (dur != null && Number.isFinite(dur) && dur > 0) setDurationsByUploadId((prev) => ({ ...prev, [uploadId]: dur }))

      setTimelineMessage(null)
      const maxSeconds = 20 * 60
      const start0 = clamp(roundToTenth(playhead), 0, maxSeconds)
      const segDur = roundToTenth(Math.max(0.2, dur != null && Number.isFinite(dur) ? dur : 5.0))
      let start = start0
      let end = clamp(roundToTenth(start + segDur), 0, maxSeconds)
      if (!(end > start + 0.05)) {
        setTimelineMessage('Narration clip is too short.')
        return
      }

      const existing = narration.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
      if (!rippleEnabledRef.current) {
        // Disallow overlaps in narration lane.
        for (const n of existing as any[]) {
          const ns = Number(n.startSeconds || 0)
          const ne = Number(n.endSeconds || 0)
          if (!(Number.isFinite(ns) && Number.isFinite(ne) && ne > ns)) continue
          const overlaps = start < ne - 1e-6 && end > ns + 1e-6
          if (overlaps) {
            setTimelineMessage('Narration overlaps an existing narration segment. Move the playhead or trim/delete the existing narration first.')
            return
          }
        }
      } else {
        // Ripple-right insert: only adjust for left collision (if inside an existing segment).
        for (const n of existing as any[]) {
          const ns = Number(n.startSeconds || 0)
          const ne = Number(n.endSeconds || 0)
          if (!(Number.isFinite(ns) && Number.isFinite(ne) && ne > ns)) continue
          if (start < ne - 1e-6 && start > ns + 1e-6) {
            start = roundToTenth(ne)
            end = clamp(roundToTenth(start + segDur), 0, maxSeconds)
            if (!(end > start + 0.05)) {
              setTimelineMessage('Narration clip is too short.')
              return
            }
          }
        }
      }

      const id = `nar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
	      const seg: Narration = { id, uploadId, startSeconds: start, endSeconds: end, sourceStartSeconds: 0, boostDb: 0 }
      snapshotUndo()
      setTimeline((prev) => {
        const prevNs: Narration[] = Array.isArray((prev as any).narration) ? ((prev as any).narration as any) : []
        const next0 = [...prevNs, seg].sort(
          (a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id))
        )
        if (rippleEnabledRef.current) {
          const ripple = rippleRightSimpleLane(next0 as any, String(seg.id))
          if (!ripple) {
            setTimelineMessage('Timeline max length reached.')
            return prev
          }
          const nextTimeline0: any = { ...(prev as any), narration: ripple.items }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }
        const nextTimeline: any = { ...(prev as any), narration: next0 }
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
    },
    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, narration, playhead, rippleRightSimpleLane, snapshotUndo]
  )

  const pickFromAssets = useMemo(() => {
    try {
      const qp = new URLSearchParams(window.location.search)
      const type = String(qp.get('cvPickType') || '').trim()
      if (!type) return null
      const uploadId = Number(String(qp.get('cvPickUploadId') || '0'))
      const configId = Number(String(qp.get('cvPickConfigId') || '0'))
      const audioConfigId = Number(String(qp.get('cvPickAudioConfigId') || '0'))
      const presetId = Number(String(qp.get('cvPickPresetId') || '0'))
      return {
        type,
        uploadId: Number.isFinite(uploadId) && uploadId > 0 ? uploadId : null,
        configId: Number.isFinite(configId) && configId > 0 ? configId : null,
        audioConfigId: Number.isFinite(audioConfigId) && audioConfigId > 0 ? audioConfigId : null,
        presetId: Number.isFinite(presetId) && presetId > 0 ? presetId : null,
      }
    } catch {
      return null
    }
  }, [])

  const handledPickFromAssetsRef = useRef(false)
  useEffect(() => {
    if (handledPickFromAssetsRef.current) return
    if (!pickFromAssets) return
    if (loading) return
    if (!project?.id) return
    handledPickFromAssetsRef.current = true

    const cleanUrl = () => {
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('cvPickType')
        url.searchParams.delete('cvPickUploadId')
        url.searchParams.delete('cvPickConfigId')
        url.searchParams.delete('cvPickAudioConfigId')
        url.searchParams.delete('cvPickPresetId')
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash || ''}`)
      } catch {}
    }

    const fetchUpload = async (id: number): Promise<any | null> => {
      const res = await fetch(`/api/uploads/${encodeURIComponent(String(id))}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) return null
      const up = json?.upload && typeof json.upload === 'object' ? json.upload : json
      return up && typeof up === 'object' ? up : null
    }

    const markVideoUsed = async (id: number) => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        await fetch(`/api/assets/videos/${encodeURIComponent(String(id))}/used`, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({}),
        })
      } catch {}
    }

    const markGraphicUsed = async (id: number) => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        await fetch(`/api/assets/graphics/${encodeURIComponent(String(id))}/used`, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({}),
        })
      } catch {}
    }

    ;(async () => {
      try {
        const t = String(pickFromAssets.type || '')
        if (t === 'video' && pickFromAssets.uploadId) {
          const up = await fetchUpload(pickFromAssets.uploadId)
          if (up) {
            addClipFromUpload(up as any)
            void markVideoUsed(pickFromAssets.uploadId)
          }
        } else if (t === 'videoOverlay' && pickFromAssets.uploadId) {
          const up = await fetchUpload(pickFromAssets.uploadId)
          if (up) {
            addVideoOverlayFromUpload(up as any)
            void markVideoUsed(pickFromAssets.uploadId)
          }
        } else if (t === 'graphic' && pickFromAssets.uploadId) {
          const up = await fetchUpload(pickFromAssets.uploadId)
          if (up) {
            addGraphicFromUpload(up as any)
            void markGraphicUsed(pickFromAssets.uploadId)
          }
        } else if (t === 'narration' && pickFromAssets.uploadId) {
          const up = await fetchUpload(pickFromAssets.uploadId)
          if (up) await addNarrationFromUpload(up as any)
        } else if (t === 'logo' && pickFromAssets.uploadId) {
          addLogoFromPick(pickFromAssets.uploadId)
        } else if (t === 'lowerThird' && pickFromAssets.uploadId && pickFromAssets.configId) {
          const cfgs = await ensureLowerThirdConfigs()
          addLowerThirdFromPick(pickFromAssets.uploadId, pickFromAssets.configId, cfgs as any)
        } else if (t === 'audio' && pickFromAssets.uploadId) {
          const up = await fetchUpload(pickFromAssets.uploadId)
          if (!up) return
          const cfgs = await ensureAudioConfigs()
          if (pickFromAssets.audioConfigId) addAudioFromUploadWithConfig(up as any, pickFromAssets.audioConfigId, cfgs as any)
          else addAudioFromUpload(up as any)
        } else if (t === 'screenTitle' && pickFromAssets.presetId) {
          const presets = await ensureScreenTitlePresets()
          const preset = presets.find((p: any) => Number((p as any).id) === Number(pickFromAssets.presetId)) as any
          if (preset) addScreenTitleFromPreset(preset as any)
        }
      } finally {
        cleanUrl()
      }
    })()
  }, [
    addAudioFromUpload,
    addAudioFromUploadWithConfig,
    addClipFromUpload,
    addVideoOverlayFromUpload,
    addGraphicFromUpload,
    addLogoFromPick,
    addLowerThirdFromPick,
    addNarrationFromUpload,
    addScreenTitleFromPreset,
    ensureAudioConfigs,
    ensureLowerThirdConfigs,
    ensureScreenTitlePresets,
    loading,
    pickFromAssets,
    project?.id,
  ])

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
      audioConfigId: (selectedAudioSegment as any).audioConfigId == null ? 0 : Number((selectedAudioSegment as any).audioConfigId),
      musicMode: (selectedAudioSegment as any).musicMode == null ? '' : (String((selectedAudioSegment as any).musicMode) as any),
      musicLevel: (selectedAudioSegment as any).musicLevel == null ? '' : (String((selectedAudioSegment as any).musicLevel) as any),
      duckingIntensity: (selectedAudioSegment as any).duckingIntensity == null ? '' : (String((selectedAudioSegment as any).duckingIntensity) as any),
    })
  }, [ensureAudioConfigs, selectedAudioSegment])

	  const saveAudioEditor = useCallback(() => {
	    if (!audioEditor) return
	    const start = roundToTenth(Number(audioEditor.start))
	    const end = roundToTenth(Number(audioEditor.end))
	    const audioConfigId = Number(audioEditor.audioConfigId)
	    const musicMode = String(audioEditor.musicMode || '').trim()
	    const musicLevel = String(audioEditor.musicLevel || '').trim()
	    const duckingIntensity = String(audioEditor.duckingIntensity || '').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setAudioEditorError('End must be after start.')
      return
    }
    if (!musicMode || !musicLevel) {
      setAudioEditorError('Music configuration is required.')
      return
    }
    if (musicMode === 'mix_duck' && !duckingIntensity) {
      setAudioEditorError('Select a ducking intensity.')
      return
    }
    if (!(contentTotalSeconds > 0)) {
      setAudioEditorError('Add video or graphics first.')
      return
    }
    if (end > MAX_TIMELINE_SECONDS + 1e-6) {
      setAudioEditorError(`End exceeds max timeline (${MAX_TIMELINE_SECONDS.toFixed(1)}s).`)
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
	    const prevSegs: any[] = Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : []
	    const idx = prevSegs.findIndex((s: any) => String(s?.id) === String(audioEditor.id))
	    if (idx < 0) {
	      setAudioEditorError('Audio segment not found.')
	      return
	    }
	    const safeStart = clamp(start, 0, Math.max(0, end - 0.2))
	    const safeEnd = clamp(end, safeStart + 0.2, MAX_TIMELINE_SECONDS)
	    const nextSegs = prevSegs.slice()
	    nextSegs[idx] = {
	      ...(prevSegs[idx] as any),
	      startSeconds: safeStart,
	      endSeconds: safeEnd,
	      ...(Number.isFinite(audioConfigId) && audioConfigId > 0 ? { audioConfigId } : {}),
	      musicMode,
	      musicLevel,
	      ...(musicMode === 'mix_duck' ? { duckingIntensity: duckingIntensity || 'medium' } : {}),
	    }
	    nextSegs.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
	    const nextTimeline0 = { ...(timeline as any), audioSegments: nextSegs, audioTrack: null }
	    const nextTimeline1: any = extendViewportEndSecondsIfNeeded(timeline as any, nextTimeline0 as any, safeEnd + VIEWPORT_PAD_SECONDS)
	    setTimeline(nextTimeline1 as any)
	    void saveTimelineNow({ ...(nextTimeline1 as any), playheadSeconds: playhead } as any)
	    setAudioEditor(null)
	    setAudioEditorError(null)
	  }, [
	    MAX_TIMELINE_SECONDS,
	    VIEWPORT_PAD_SECONDS,
	    audioEditor,
	    audioSegments,
	    extendViewportEndSecondsIfNeeded,
	    playhead,
	    saveTimelineNow,
	    snapshotUndo,
	    timeline,
	    totalSeconds,
	  ])

		  const saveNarrationEditor = useCallback(() => {
		    if (!narrationEditor) return
		    const start = roundToTenth(Number(narrationEditor.start))
		    const end = roundToTenth(Number(narrationEditor.end))
		    const boostRaw = Number((narrationEditor as any).boostDb)
		    const boostAllowed = new Set([0, 3, 6, 9])
		    const boostDb = Number.isFinite(boostRaw) && boostAllowed.has(Math.round(boostRaw)) ? Math.round(boostRaw) : 0
		    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
		      setNarrationEditorError('End must be after start.')
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
	      const updated: Narration = {
	        ...(prevNs[idx] as any),
	        startSeconds: Math.max(0, start),
	        endSeconds: Math.max(0, end),
	        boostDb,
	        // Keep legacy field in sync for back-compat.
	        gainDb: boostDb,
	      }
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
      setSelectedVideoOverlayId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      return
    }
    if (selectedVideoOverlayId) {
      const res = splitVideoOverlayAtPlayhead(timeline as any, selectedVideoOverlayId)
      const prevOs = Array.isArray((timeline as any).videoOverlays) ? (timeline as any).videoOverlays : []
      const nextOs = Array.isArray((res.timeline as any).videoOverlays) ? (res.timeline as any).videoOverlays : []
      if (res.timeline === (timeline as any) && String(res.selectedVideoOverlayId) === String(selectedVideoOverlayId)) return
      if (nextOs === prevOs) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedVideoOverlayId(String((res as any).selectedVideoOverlayId))
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
    if (selectedClipId) {
      const res = splitClipAtPlayhead(timeline, selectedClipId)
      if (res.timeline === timeline && res.selectedClipId === selectedClipId) return
      if (res.timeline.clips === timeline.clips) return
      snapshotUndo()
      setTimeline(res.timeline)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedClipId(res.selectedClipId)
      setSelectedVideoOverlayId(null)
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
    selectedVideoOverlayId,
    selectedGraphicId,
    selectedLogoId,
    selectedLowerThirdId,
    selectedNarrationId,
    selectedScreenTitleId,
    splitVideoOverlayAtPlayhead,
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

    if (selectedVideoOverlayId) {
      const target = selectedVideoOverlay
      if (!target) return
      snapshotUndo()
      setTimeline((prev) => {
        const prevOs: any[] = Array.isArray((prev as any).videoOverlays) ? (prev as any).videoOverlays : []
        const nextOs = prevOs.filter((o: any) => String(o.id) !== String((target as any).id))
        return { ...(prev as any), videoOverlays: nextOs } as any
      })
      setSelectedVideoOverlayId(null)
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
    setSelectedVideoOverlayId(null)
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
      setSelectedVideoOverlayId(null)
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

  const deleteVideoOverlayById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevOs: any[] = Array.isArray((timeline as any).videoOverlays) ? ((timeline as any).videoOverlays as any[]) : []
      if (!prevOs.some((o: any) => String(o?.id) === targetId)) return
      snapshotUndo()
      const nextOs = prevOs.filter((o: any) => String(o?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), videoOverlays: nextOs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (String(selectedVideoOverlayId || '') === targetId) setSelectedVideoOverlayId(null)
    },
    [playhead, saveTimelineNow, selectedVideoOverlayId, snapshotUndo, timeline]
  )

  const duplicateVideoOverlayById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevOs0: any[] = Array.isArray((timeline as any).videoOverlays) ? ((timeline as any).videoOverlays as any[]) : []
      if (!prevOs0.length) return
      const starts0 = computeClipStarts(prevOs0 as any)
      const prevOs: any[] = prevOs0.map((o: any, i: number) => ({ ...(o as any), startSeconds: roundToTenth(starts0[i] || 0) }))
      const o0 = prevOs.find((o: any) => String(o?.id) === targetId) as any
      if (!o0) return

      const start0 = roundToTenth(Number(o0.startSeconds || 0))
      const dur = roundToTenth(Math.max(0.2, clipDurationSeconds(o0 as any)))
      const end0 = roundToTenth(start0 + dur)
      const capEnd = 20 * 60
      let start = roundToTenth(Math.max(0, end0))
      let end = roundToTenth(start + dur)
      if (end > capEnd + 1e-6) {
        setTimelineMessage('Not enough room to duplicate that video overlay.')
        return
      }

      const sorted = prevOs
        .map((o: any) => ({ ...o, startSeconds: roundToTenth(Number(o.startSeconds || 0)) }))
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      for (const other of sorted) {
        const os = Number(other.startSeconds || 0)
        const oe = roundToTenth(os + clipDurationSeconds(other as any))
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
        const oe = roundToTenth(os + clipDurationSeconds(other as any))
        if (start < oe - 1e-6 && end > os + 1e-6) {
          setTimelineMessage('No available slot to duplicate that video overlay without overlapping.')
          return
        }
      }

      const newId = `vo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const placed: any = { ...(o0 as any), id: newId, startSeconds: start }
      const nextOs = [...prevOs, placed].sort(
        (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
      )
      snapshotUndo()
      const nextTimeline: any = { ...(timeline as any), videoOverlays: nextOs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedVideoOverlayId(String(newId))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setTimelineMessage(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const splitVideoOverlayById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitVideoOverlayAtPlayhead(timeline as any, targetId)
      const prevOs = Array.isArray((timeline as any).videoOverlays) ? (timeline as any).videoOverlays : []
      const nextOs = Array.isArray((res.timeline as any).videoOverlays) ? (res.timeline as any).videoOverlays : []
      if (res.timeline === (timeline as any) && String(res.selectedVideoOverlayId) === targetId) return
      if (nextOs === prevOs) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedVideoOverlayId(String(res.selectedVideoOverlayId))
      setSelectedClipId(null)
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

  type GuidelineActionOpts = {
    edgeIntent?: 'move' | 'start' | 'end'
    guidelinesOverride?: number[]
    noopIfNoCandidate?: boolean
  }

  const applyClipGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - clipStartTimeline) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          nextStartTimeline = roundToTenth(cand)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(clipEndTimeline)
          if (cand == null) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - clipEndTimeline) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          nextStartTimeline = roundToTenth(cand - dur0)
        } else {
          const nS = nearestInclusive(clipStartTimeline)
          const nE = nearestInclusive(clipEndTimeline)
          if (!nS && !nE) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
          setTimelineMessage(action === 'expand_start' ? 'No guideline before start.' : 'No guideline after start.')
          return
        }
        const desiredStartTimeline = roundToTenth(cand)
        const delta = roundToTenth(clipStartTimeline - desiredStartTimeline)
        if (action === 'contract_start') {
          // delta is negative here (moving right); use abs for source trim.
          const shift = roundToTenth(desiredStartTimeline - clipStartTimeline)
          if (!(shift > 0)) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
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

  const applyVideoOverlayGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
      }

      const capEnd = 20 * 60
      const prevOs0: any[] = Array.isArray((timeline as any).videoOverlays) ? ((timeline as any).videoOverlays as any[]) : []
      if (!prevOs0.length) return
      const starts0 = computeClipStarts(prevOs0 as any)
      const normalizedOs: any[] = prevOs0.map((o: any, i: number) => ({ ...(o as any), startSeconds: roundToTenth(starts0[i] || 0) }))
      const idx = normalizedOs.findIndex((o: any) => String(o?.id) === targetId)
      if (idx < 0) return
      const o0 = normalizedOs[idx]

      const overlayStartTimeline = roundToTenth(Number((o0 as any).startSeconds || 0))
      const dur0 = roundToTenth(Math.max(0.2, clipDurationSeconds(o0 as any)))
      const overlayEndTimeline = roundToTenth(overlayStartTimeline + dur0)

      const sourceStart0 = roundToTenth(Number((o0 as any).sourceStartSeconds || 0))
      const sourceEnd0 = roundToTenth(Number((o0 as any).sourceEndSeconds || 0))
      const sourceMaxRaw = durationsByUploadId[Number((o0 as any).uploadId)] ?? sourceEnd0
      const sourceMax = roundToTenth(Math.max(0, Number(sourceMaxRaw) || 0))

      const occupied: Array<{ start: number; end: number }> = []
      for (let i = 0; i < normalizedOs.length; i++) {
        if (i === idx) continue
        const o = normalizedOs[i]
        const s = roundToTenth(Number((o as any).startSeconds || 0))
        const e = roundToTenth(s + clipDurationSeconds(o as any))
        if (e > s) occupied.push({ start: s, end: e })
      }
      const overlayStillsRaw: any[] = Array.isArray((timeline as any).videoOverlayStills) ? ((timeline as any).videoOverlayStills as any[]) : []
      for (const st of overlayStillsRaw) {
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

      let nextStartTimeline = overlayStartTimeline
      let nextSourceStart = sourceStart0
      let nextSourceEnd = sourceEnd0

      if (action === 'snap') {
        const edgeIntent: any = opts?.edgeIntent || 'move'
        const snapPoint = edgeIntent === 'end' ? overlayEndTimeline : overlayStartTimeline
        const best = nearestInclusive(snapPoint)
        if (!best) return
        if (best.dist <= eps + 1e-9) return
        const desiredStart =
          edgeIntent === 'end' ? roundToTenth(best.v - dur0) : roundToTenth(best.v)
        const clampedStart = clamp(desiredStart, 0, Math.max(0, roundToTenth(capEnd - dur0)))
        const clampedEnd = roundToTenth(clampedStart + dur0)
        if (overlapsAny(clampedStart, clampedEnd)) {
          setTimelineMessage('Cannot snap (would overlap another overlay).')
          return
        }
        nextStartTimeline = clampedStart
      } else if (action === 'expand_end' || action === 'contract_end') {
        const cand = action === 'expand_end' ? nextStrict(overlayEndTimeline) : prevStrict(overlayEndTimeline)
        if (cand == null) {
          if (opts?.noopIfNoCandidate) return
          setTimelineMessage(action === 'expand_end' ? 'No guideline after end.' : 'No guideline before end.')
          return
        }
        const desiredEndTimeline = roundToTenth(cand)
        const shift = roundToTenth(desiredEndTimeline - overlayEndTimeline)
        if (action === 'expand_end') {
          if (!(shift > 0)) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          const nextSourceEndCandidate = roundToTenth(sourceEnd0 + shift)
          if (nextSourceEndCandidate > sourceMax + 1e-6) {
            setTimelineMessage('No more source video available to extend end to that guideline.')
            return
          }
          nextSourceEnd = nextSourceEndCandidate
          const nextEndTimeline = roundToTenth(overlayStartTimeline + (nextSourceEnd - sourceStart0))
          if (nextEndTimeline > capEnd + 1e-6) {
            setTimelineMessage('End exceeds allowed duration.')
            return
          }
          if (overlapsAny(overlayStartTimeline, nextEndTimeline)) {
            setTimelineMessage('Cannot resize (would overlap another overlay).')
            return
          }
        } else {
          const shrink = roundToTenth(overlayEndTimeline - desiredEndTimeline)
          if (!(shrink > 0)) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          const nextSourceEndCandidate = roundToTenth(sourceEnd0 - shrink)
          if (nextSourceEndCandidate <= sourceStart0 + 0.2 + 1e-6) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          nextSourceEnd = nextSourceEndCandidate
        }
      } else if (action === 'expand_start' || action === 'contract_start') {
        const cand = action === 'expand_start' ? prevStrict(overlayStartTimeline) : nextStrict(overlayStartTimeline)
        if (cand == null) {
          if (opts?.noopIfNoCandidate) return
          setTimelineMessage(action === 'expand_start' ? 'No guideline before start.' : 'No guideline after start.')
          return
        }
        const desiredStartTimeline = roundToTenth(cand)
        const delta = roundToTenth(overlayStartTimeline - desiredStartTimeline)
        if (action === 'contract_start') {
          const shift = roundToTenth(desiredStartTimeline - overlayStartTimeline)
          if (!(shift > 0)) {
            if (opts?.noopIfNoCandidate) return
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
          // End stays fixed.
          if (overlapsAny(nextStartTimeline, overlayEndTimeline)) {
            setTimelineMessage('Cannot resize (would overlap another overlay).')
            return
          }
        } else {
          // expand_start
          if (!(delta > 0)) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          if (sourceStart0 < delta - 1e-6) {
            setTimelineMessage('No more source video available to extend start to that guideline.')
            return
          }
          nextStartTimeline = clamp(desiredStartTimeline, 0, capEnd)
          nextSourceStart = roundToTenth(sourceStart0 - delta)
          if (overlapsAny(nextStartTimeline, overlayEndTimeline)) {
            setTimelineMessage('Cannot resize (would overlap another overlay).')
            return
          }
        }
      }

      snapshotUndo()
      const nextOs = normalizedOs.slice()
      const updated: any = {
        ...(o0 as any),
        startSeconds: roundToTenth(nextStartTimeline),
        sourceStartSeconds: roundToTenth(nextSourceStart),
        sourceEndSeconds: roundToTenth(nextSourceEnd),
      }
      nextOs[idx] = updated
      nextOs.sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), videoOverlays: nextOs }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [durationsByUploadId, playhead, saveTimelineNow, snapshotUndo, timeline]
  )

  const applyNarrationGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return

      const prevSegs: any[] = Array.isArray((timeline as any).narration) ? ((timeline as any).narration as any[]) : []
      const idx = prevSegs.findIndex((n: any) => String(n?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return

      const prevSegs: any[] = Array.isArray((timeline as any).audioSegments) ? ((timeline as any).audioSegments as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
      const newGraphic: any = { ...(g0 as any), id: newId, uploadId: Number(g0.uploadId), startSeconds: start, endSeconds: end }
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
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevStills: any[] = Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : []
      const idx = prevStills.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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

  const deleteVideoOverlayStillById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevStills: any[] = Array.isArray((timeline as any).videoOverlayStills) ? ((timeline as any).videoOverlayStills as any[]) : []
      if (!prevStills.some((s: any) => String(s?.id) === targetId)) return
      snapshotUndo()
      const nextStills = prevStills.filter((s: any) => String(s?.id) !== targetId)
      const nextTimeline: any = { ...(timeline as any), videoOverlayStills: nextStills }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      if (selectedVideoOverlayStillId === targetId) setSelectedVideoOverlayStillId(null)
      if (videoOverlayStillEditor && String(videoOverlayStillEditor.id) === targetId) {
        setVideoOverlayStillEditor(null)
        setVideoOverlayStillEditorError(null)
      }
    },
    [playhead, saveTimelineNow, selectedVideoOverlayStillId, snapshotUndo, timeline, videoOverlayStillEditor]
  )

  const duplicateVideoOverlayStillById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevStills: any[] = Array.isArray((timeline as any).videoOverlayStills) ? ((timeline as any).videoOverlayStills as any[]) : []
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

      const overlayRanges = (videoOverlays as any[]).map((o: any, i: number) => {
        const s = roundToTenth(Number((videoOverlayStarts as any)[i] || 0))
        const e2 = roundToTenth(s + clipDurationSeconds(o as any))
        return { start: s, end: e2 }
      })
      const otherStills = prevStills
        .filter((s: any) => String(s?.id) !== targetId)
        .map((s: any) => ({ start: roundToTenth(Number(s.startSeconds || 0)), end: roundToTenth(Number(s.endSeconds || 0)) }))
      const occupied = [...overlayRanges, ...otherStills].filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)

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

      const newId = `ovstill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const nextStill: any = { ...(s0 as any), id: newId, startSeconds: start, endSeconds: end }
      const nextStills = [...prevStills, nextStill]
        .slice()
        .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      snapshotUndo()
      const nextTimeline: any = { ...(timeline as any), videoOverlayStills: nextStills }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
      setSelectedVideoOverlayStillId(newId)
      setSelectedVideoOverlayId(null)
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setTimelineMessage(null)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, videoOverlayStarts, videoOverlays]
  )

  const splitVideoOverlayStillById = useCallback(
    (id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const res = splitVideoOverlayStillAtPlayhead(timeline as any, targetId)
      const prevStills = Array.isArray((timeline as any).videoOverlayStills) ? (timeline as any).videoOverlayStills : []
      const nextStills = Array.isArray((res.timeline as any).videoOverlayStills) ? (res.timeline as any).videoOverlayStills : []
      if (res.timeline === (timeline as any) && String(res.selectedVideoOverlayStillId) === targetId) return
      if (nextStills === prevStills) return
      snapshotUndo()
      setTimeline(res.timeline as any)
      void saveTimelineNow({ ...(res.timeline as any), playheadSeconds: playhead } as any)
      setSelectedVideoOverlayStillId(String(res.selectedVideoOverlayStillId))
      setSelectedVideoOverlayId(null)
      setSelectedClipId(null)
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

  const applyVideoOverlayStillGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevStills: any[] = Array.isArray((timeline as any).videoOverlayStills) ? ((timeline as any).videoOverlayStills as any[]) : []
      const idx = prevStills.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
      }

      const s0 = prevStills[idx] as any
      const start0 = roundToTenth(Number(s0.startSeconds || 0))
      const end0 = roundToTenth(Number(s0.endSeconds || 0))
      const minLen = 0.1
      const dur = roundToTenth(Math.max(minLen, end0 - start0))
      const capEnd = 20 * 60

      const overlayRanges = (videoOverlays as any[]).map((o: any, i: number) => ({
        id: `ov:${String(o?.id)}`,
        start: roundToTenth(Number((videoOverlayStarts as any)[i] || 0)),
        end: roundToTenth(Number((videoOverlayStarts as any)[i] || 0) + clipDurationSeconds(o as any)),
      }))
      const stillRanges = prevStills.map((s: any) => ({
        id: `ostill:${String(s?.id)}`,
        start: roundToTenth(Number(s.startSeconds || 0)),
        end: roundToTenth(Number(s.endSeconds || 0)),
      }))
      const ranges = [...overlayRanges, ...stillRanges]
        .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
        .sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)))
      const pos = ranges.findIndex((r) => r.id === `ostill:${targetId}`)
      const prevEnd = pos > 0 ? roundToTenth(Number(ranges[pos - 1]?.end || 0)) : 0
      const nextStart = pos >= 0 && pos < ranges.length - 1 ? roundToTenth(Number(ranges[pos + 1]?.start || capEnd)) : roundToTenth(capEnd)
      const minStartSeconds = clamp(prevEnd, 0, Math.max(0, capEnd))
      const maxEndSeconds = clamp(nextStart, 0, Math.max(0, capEnd))

      const overlapsAny = (s: number, e: number) => {
        for (const r of ranges) {
          if (r.id === `ostill:${targetId}`) continue
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          startS = roundToTenth(cand)
          endS = roundToTenth(startS + dur)
        } else if (edgeIntent === 'end') {
          const cand = nextStrict(end0)
          if (cand == null) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('Already aligned to guideline.')
            return
          }
          endS = roundToTenth(cand)
          startS = roundToTenth(endS - dur)
        } else {
          const nS = nearestInclusive(start0)
          const nE = nearestInclusive(end0)
          if (!nS && !nE) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          setTimelineMessage('Cannot snap (would overlap another overlay segment).')
          return
        }
        if (overlapsAny(startS, endS)) {
          setTimelineMessage('Cannot snap (would overlap another overlay segment).')
          return
        }
      } else if (action === 'expand_start') {
        const cand = prevStrict(start0)
        if (cand == null) {
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
          setTimelineMessage('No guideline before end.')
          return
        }
        const nextEndS = roundToTenth(cand)
        if (nextEndS > maxEndSeconds + 1e-6 || nextEndS < start0 + minLen - 1e-6) {
          setTimelineMessage('No room to contract end to that guideline.')
          return
        }
        endS = nextEndS
      } else {
        return
      }

      startS = roundToTenth(startS)
      endS = roundToTenth(endS)
      if (!(endS > startS + minLen - 1e-6)) {
        setTimelineMessage('Resulting duration is too small.')
        return
      }
      if (startS < minStartSeconds - 1e-6 || endS > maxEndSeconds + 1e-6) {
        setTimelineMessage('Cannot resize (would overlap another overlay segment).')
        return
      }
      if (overlapsAny(startS, endS)) {
        setTimelineMessage('Cannot resize (would overlap another overlay segment).')
        return
      }

      snapshotUndo()
      const nextStills = prevStills.slice()
      nextStills[idx] = { ...(s0 as any), startSeconds: startS, endSeconds: endS }
      nextStills.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTimeline: any = { ...(timeline as any), videoOverlayStills: nextStills }
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [playhead, saveTimelineNow, snapshotUndo, timeline, videoOverlayStarts, videoOverlays]
  )

  const applyGraphicGuidelineAction = useCallback(
    (
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevGraphics: any[] = Array.isArray((timeline as any).graphics) ? ((timeline as any).graphics as any[]) : []
      const idx = prevGraphics.findIndex((g: any) => String(g?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
      }

      const g0 = prevGraphics[idx] as any
      const start0 = roundToTenth(Number(g0.startSeconds || 0))
      const end0 = roundToTenth(Number(g0.endSeconds || 0))
      const minLen = 0.2
      const dur = roundToTenth(Math.max(minLen, end0 - start0))

      // Disallow overlaps: constrain by neighbors.
      const sorted = prevGraphics.slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const pos = sorted.findIndex((gg: any) => String(gg?.id) === targetId)
      const capEnd = MAX_TIMELINE_SECONDS
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) {
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).logos) ? ((timeline as any).logos as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).lowerThirds) ? ((timeline as any).lowerThirds as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
      opts?: GuidelineActionOpts
    ) => {
      const targetId = String(id || '')
      if (!targetId) return
      const prevSegs: any[] = Array.isArray((timeline as any).screenTitles) ? ((timeline as any).screenTitles as any[]) : []
      const idx = prevSegs.findIndex((s: any) => String(s?.id) === targetId)
      if (idx < 0) return

      const gsRaw: any[] = Array.isArray(opts?.guidelinesOverride)
        ? ((opts?.guidelinesOverride as any) || [])
        : Array.isArray((timeline as any).guidelines)
          ? ((timeline as any).guidelines as any[])
          : []
      let gsSorted = Array.from(
        new Map(
          gsRaw
            .map((x) => roundToTenth(Number(x)))
            .filter((x) => Number.isFinite(x) && x >= 0)
            .map((x) => [x.toFixed(1), x] as const)
        ).values()
      ).sort((a, b) => a - b)
      if (!gsSorted.length) {
        if (action === 'snap') {
          setTimelineMessage('No guidelines yet. Tap the guideline button to add one.')
          return
        }
        gsSorted = [roundToTenth(playhead)]
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline before start.')
            return
          }
          if (Math.abs(cand - start0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guideline after end.')
            return
          }
          if (Math.abs(cand - end0) <= eps) {
            if (opts?.noopIfNoCandidate) return
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
            if (opts?.noopIfNoCandidate) return
            setTimelineMessage('No guidelines available.')
            return
          }
          const snapEdge = !nE || (nS && nS.dist <= nE.dist) ? ('start' as const) : ('end' as const)
          const nn = snapEdge === 'start' ? nS : nE
          if (!nn) return
          if (nn.dist <= eps) {
            if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
          if (opts?.noopIfNoCandidate) return
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
    const boostRaw = Number((clipEditor as any).boostDb)
    const boostAllowed = new Set([0, 3, 6, 9])
    const boostDb = Number.isFinite(boostRaw) && boostAllowed.has(Math.round(boostRaw)) ? Math.round(boostRaw) : 0
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
        boostDb,
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

      const prevVideoOverlays: any[] = Array.isArray((tl as any).videoOverlays) ? (tl as any).videoOverlays : []
      const overlayStarts = computeClipStarts(prevVideoOverlays as any)
      const normalizedVideoOverlays: any[] = prevVideoOverlays.map((o: any, i: number) => ({
        ...(o as any),
        startSeconds: roundToTenth(Number((overlayStarts as any)[i] || 0)),
      }))
      const nextVideoOverlays: any[] = normalizedVideoOverlays.map((o: any) => {
        const s = roundToTenth(Number(o?.startSeconds || 0))
        if (s + 1e-6 < at) return o
        return { ...(o as any), startSeconds: roundToTenth(s + delta) }
      })

      const prevVideoOverlayStills: any[] = Array.isArray((tl as any).videoOverlayStills) ? (tl as any).videoOverlayStills : []
      const nextVideoOverlayStills: any[] = prevVideoOverlayStills.map((s: any) => {
        const a = roundToTenth(Number(s?.startSeconds || 0))
        const b = roundToTenth(Number(s?.endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(s as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
        if (b > at + 1e-6) return { ...(s as any), endSeconds: roundToTenth(b + delta) }
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

      const prevLogos: any[] = Array.isArray((tl as any).logos) ? (tl as any).logos : []
      const nextLogos: any[] = prevLogos.map((l: any) => {
        const a = roundToTenth(Number(l?.startSeconds || 0))
        const b = roundToTenth(Number(l?.endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(l as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
        if (b > at + 1e-6) return { ...(l as any), endSeconds: roundToTenth(b + delta) }
        return l
      })

      const prevLowerThirds: any[] = Array.isArray((tl as any).lowerThirds) ? (tl as any).lowerThirds : []
      const nextLowerThirds: any[] = prevLowerThirds.map((lt: any) => {
        const a = roundToTenth(Number(lt?.startSeconds || 0))
        const b = roundToTenth(Number(lt?.endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(lt as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
        if (b > at + 1e-6) return { ...(lt as any), endSeconds: roundToTenth(b + delta) }
        return lt
      })

      const prevScreenTitles: any[] = Array.isArray((tl as any).screenTitles) ? (tl as any).screenTitles : []
      const nextScreenTitles: any[] = prevScreenTitles.map((st: any) => {
        const a = roundToTenth(Number(st?.startSeconds || 0))
        const b = roundToTenth(Number(st?.endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(st as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
        if (b > at + 1e-6) return { ...(st as any), endSeconds: roundToTenth(b + delta) }
        return st
      })

      const prevNarration: any[] = Array.isArray((tl as any).narration) ? (tl as any).narration : []
      const nextNarration: any[] = prevNarration.map((n: any) => {
        const a = roundToTenth(Number(n?.startSeconds || 0))
        const b = roundToTenth(Number(n?.endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(n as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
        if (b > at + 1e-6) return { ...(n as any), endSeconds: roundToTenth(b + delta) }
        return n
      })

      const prevAudioSegs: any[] = Array.isArray((tl as any).audioSegments) ? (tl as any).audioSegments : []
      const nextAudioSegments: any[] = prevAudioSegs.map((seg: any) => {
        const a = roundToTenth(Number(seg?.startSeconds || 0))
        const b = roundToTenth(Number(seg?.endSeconds || 0))
        if (a + 1e-6 >= at) return { ...(seg as any), startSeconds: roundToTenth(a + delta), endSeconds: roundToTenth(b + delta) }
        if (b > at + 1e-6) return { ...(seg as any), endSeconds: roundToTenth(b + delta) }
        return seg
      })

      const prevGuidelines: any[] = Array.isArray((tl as any).guidelines) ? (tl as any).guidelines : []
      const nextGuidelines: any[] = prevGuidelines.map((g: any) => {
        const v = roundToTenth(Number(g))
        if (!Number.isFinite(v) || v < 0) return g
        if (v + 1e-6 < at) return v
        return roundToTenth(v + delta)
      })

      const nextPlayhead = roundToTenth(Number(tl.playheadSeconds || 0) + (Number(tl.playheadSeconds || 0) + 1e-6 >= at ? delta : 0))

      const out: any = {
        ...tl,
        clips: nextClips.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        stills: nextStills.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        videoOverlays: nextVideoOverlays
          .slice()
          .sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        videoOverlayStills: nextVideoOverlayStills
          .slice()
          .sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        graphics: nextGraphics.slice().sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        logos: nextLogos.slice().sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        lowerThirds: nextLowerThirds.slice().sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        screenTitles: nextScreenTitles
          .slice()
          .sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        narration: nextNarration
          .slice()
          .sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        audioSegments: nextAudioSegments
          .slice()
          .sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))),
        audioTrack: null,
        guidelines: nextGuidelines,
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

  const insertVideoOverlayFreezeStill = useCallback(
    async (which: 'first' | 'last') => {
      if (!videoOverlayEditor) return
      if (overlayFreezeInsertBusy) return
      setOverlayFreezeInsertBusy(true)
      setOverlayFreezeInsertError(null)
      setVideoOverlayEditorError(null)
      try {
        const dur = 2.0

        const idx = videoOverlays.findIndex((o: any) => String((o as any).id) === String(videoOverlayEditor.id))
        if (idx < 0) throw new Error('overlay_not_found')
        const o: any = videoOverlays[idx]
        if (!o) throw new Error('overlay_not_found')

        const startTimeline = roundToTenth(Number((videoOverlayStarts as any)[idx] || 0))
        const len = roundToTenth(Math.max(0, clipSourceDurationSeconds(o as any)))
        const endTimeline = roundToTenth(startTimeline + len)

        const insertAt = which === 'first' ? startTimeline : endTimeline
        const atSeconds = which === 'first' ? Number(o.sourceStartSeconds) : Math.max(0, Number(o.sourceEndSeconds) - 0.05)

        const freezeUploadId = await waitForFreezeFrameUpload(Number(o.uploadId), atSeconds)

        const stillId = `ovstill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
        const still: VideoOverlayStill = {
          id: stillId,
          uploadId: freezeUploadId,
          startSeconds: roundToTenth(insertAt),
          endSeconds: roundToTenth(insertAt + dur),
          sourceVideoOverlayId: String((o as any).id),
          sizePctWidth: Number((o as any).sizePctWidth) || 40,
          position: (String((o as any).position || 'bottom_right') as any) || 'bottom_right',
        }

        snapshotUndo()
        const shifted = rippleInsert(cloneTimeline(timeline), insertAt, dur) as any
        const prevStills: any[] = Array.isArray((shifted as any).videoOverlayStills) ? (shifted as any).videoOverlayStills : []
        const nextStills = [...prevStills, still].slice().sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
        const nextTimeline: any = { ...(shifted as any), videoOverlayStills: nextStills }
        setTimeline(nextTimeline)
        void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
        setSelectedVideoOverlayStillId(stillId)
        setSelectedVideoOverlayId(null)
        setSelectedClipId(null)
        setSelectedGraphicId(null)
        setSelectedLogoId(null)
        setSelectedLowerThirdId(null)
        setSelectedScreenTitleId(null)
        setSelectedNarrationId(null)
        setSelectedStillId(null)
        setSelectedAudioId(null)
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (msg === 'freeze_timeout') setOverlayFreezeInsertError('Timed out while generating freeze frame. Try again.')
        else if (msg === 'freeze_failed') setOverlayFreezeInsertError('Freeze frame generation failed. Try again.')
        else setOverlayFreezeInsertError('Failed to insert freeze frame.')
      } finally {
        setOverlayFreezeInsertBusy(false)
      }
    },
    [
      cloneTimeline,
      overlayFreezeInsertBusy,
      playhead,
      rippleInsert,
      saveTimelineNow,
      snapshotUndo,
      timeline,
      videoOverlayEditor,
      videoOverlayStarts,
      videoOverlays,
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
      const current = prevGraphics[idx] as any
      const currentHasPlacement =
        current?.fitMode != null || current?.sizePctWidth != null || current?.position != null || current?.insetXPx != null || current?.insetYPx != null
      const currentHasEffects = current?.borderWidthPx != null || current?.borderColor != null || current?.fade != null

      const nextBase: any = { ...current, startSeconds: Math.max(0, start), endSeconds: Math.max(0, end) }
      const wantsPlacement = graphicEditor.fitMode === 'contain_transparent'
      const placement = {
        fitMode: graphicEditor.fitMode,
        sizePctWidth: Math.round(clamp(Number.isFinite(Number(graphicEditor.sizePctWidth)) ? Number(graphicEditor.sizePctWidth) : 70, 10, 100)),
        position: graphicEditor.position,
        insetXPx: Math.round(clamp(Number.isFinite(Number(graphicEditor.insetXPx)) ? Number(graphicEditor.insetXPx) : 24, 0, 300)),
        insetYPx: Math.round(clamp(Number.isFinite(Number(graphicEditor.insetYPx)) ? Number(graphicEditor.insetYPx) : 24, 0, 300)),
      }
      const borderWidthAllowed = new Set([0, 2, 4, 6])
      const borderWidth = borderWidthAllowed.has(Number(graphicEditor.borderWidthPx)) ? Number(graphicEditor.borderWidthPx) : 0
      const fadeModeRaw = String(graphicEditor.fade || 'none')
      const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
      const fadeMode = fadeAllowed.has(fadeModeRaw) ? fadeModeRaw : 'none'
      const wantsEffects = borderWidth > 0 || fadeMode !== 'none'

      // Backward compatibility:
      // - If the graphic has never had placement fields and the user keeps it as "Full Frame" (cover),
      //   avoid introducing new placement fields implicitly when they only adjust timing.
      let updated: Graphic
      if (!currentHasPlacement && !wantsPlacement) {
        delete (nextBase as any).fitMode
        delete (nextBase as any).sizePctWidth
        delete (nextBase as any).position
        delete (nextBase as any).insetXPx
        delete (nextBase as any).insetYPx
        updated = nextBase as Graphic
      } else {
        if (wantsPlacement) {
          updated = { ...(nextBase as any), ...placement } as Graphic
        } else {
          delete (nextBase as any).sizePctWidth
          delete (nextBase as any).position
          delete (nextBase as any).insetXPx
          delete (nextBase as any).insetYPx
          updated = { ...(nextBase as any), fitMode: 'cover_full' } as Graphic
        }
      }
      const nextGraphics = prevGraphics.slice()
      nextGraphics[idx] = updated
      if (!currentHasEffects && !wantsEffects) {
        delete (nextGraphics[idx] as any).borderWidthPx
        delete (nextGraphics[idx] as any).borderColor
        delete (nextGraphics[idx] as any).fade
      } else {
        ;(nextGraphics[idx] as any).borderWidthPx = borderWidth
        ;(nextGraphics[idx] as any).borderColor = String(graphicEditor.borderColor || '#000000')
        ;(nextGraphics[idx] as any).fade = fadeMode
      }
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

  const saveVideoOverlayStillEditor = useCallback(() => {
    if (!videoOverlayStillEditor) return
    const start = roundToTenth(Number(videoOverlayStillEditor.start))
    const end = roundToTenth(Number(videoOverlayStillEditor.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setVideoOverlayStillEditorError('End must be after start.')
      return
    }

    const cap = 20 * 60
    if (end > cap + 1e-6) {
      setVideoOverlayStillEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
    }

    // Disallow overlaps with video overlays and other overlay freeze frames.
    const overlayRanges = (videoOverlays as any[]).map((o: any, i: number) => {
      const s = roundToTenth(Number((videoOverlayStarts as any)[i] || 0))
      const e2 = roundToTenth(s + clipDurationSeconds(o as any))
      return { start: s, end: e2 }
    })
    for (const r of overlayRanges) {
      if (!(Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)) continue
      const overlaps = start < r.end - 1e-6 && end > r.start + 1e-6
      if (overlaps) {
        setVideoOverlayStillEditorError('Overlay freeze frames cannot overlap video overlay clips.')
        return
      }
    }
    for (const s of videoOverlayStills as any[]) {
      if (String((s as any).id) === String(videoOverlayStillEditor.id)) continue
      const ss = roundToTenth(Number((s as any).startSeconds || 0))
      const se = roundToTenth(Number((s as any).endSeconds || 0))
      if (!(se > ss)) continue
      const overlaps = start < se - 1e-6 && end > ss + 1e-6
      if (overlaps) {
        setVideoOverlayStillEditorError('Overlay freeze frames cannot overlap each other.')
        return
      }
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevStills: any[] = Array.isArray((prev as any).videoOverlayStills) ? ((prev as any).videoOverlayStills as any[]) : []
      const idx = prevStills.findIndex((s: any) => String((s as any).id) === String(videoOverlayStillEditor.id))
      if (idx < 0) return prev
      const updated: any = { ...(prevStills[idx] as any), startSeconds: Math.max(0, start), endSeconds: Math.max(0, end) }
      const nextStills = prevStills.slice()
      nextStills[idx] = updated
      nextStills.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
      const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), videoOverlayStills: nextStills } as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...(prev as any), videoOverlayStills: nextStills, playheadSeconds: nextPlayhead } as any
    })
    setVideoOverlayStillEditor(null)
    setVideoOverlayStillEditorError(null)
  }, [computeTotalSecondsForTimeline, snapshotUndo, videoOverlayStillEditor, videoOverlayStarts, videoOverlays, videoOverlayStills])

  const saveLogoEditor = useCallback(() => {
    if (!logoEditor) return
    const start = roundToTenth(Number(logoEditor.start))
    const end = roundToTenth(Number(logoEditor.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setLogoEditorError('End must be after start.')
      return
    }

    const cap = 20 * 60
    if (end > cap + 1e-6) {
      setLogoEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
    }

	    const sizePctWidth = Math.round(Number(logoEditor.sizePctWidth))
	    const insetPresetRaw = String((logoEditor as any).insetPreset || 'medium').toLowerCase()
	    const insetPreset = insetPresetRaw === 'small' || insetPresetRaw === 'large' ? insetPresetRaw : 'medium'
	    const insetPx = insetPreset === 'small' ? 50 : insetPreset === 'large' ? 150 : 100
	    const position = String(logoEditor.position || '') as any
	    const opacityPctRaw = Number(logoEditor.opacityPct)
	    const opacityPct = Math.round(clamp(Number.isFinite(opacityPctRaw) ? opacityPctRaw : 100, 0, 100))
	    const fadeRaw = String((logoEditor as any).fade || 'none')
    const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
    const fade = (fadeAllowed.has(fadeRaw) ? fadeRaw : 'none') as any

    const allowedSizes = new Set([10, 20, 30, 40, 50])
    const allowedPositions = new Set([
      'top_left',
      'top_center',
      'top_right',
      'middle_left',
      'middle_center',
      'middle_right',
      'bottom_left',
      'bottom_center',
      'bottom_right',
    ])
    if (!allowedSizes.has(sizePctWidth)) {
      setLogoEditorError('Pick a size.')
      return
    }
    if (!allowedPositions.has(position)) {
      setLogoEditorError('Pick a position.')
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
	        sizePctWidth,
	        position,
	        opacityPct,
	        fade,
	        insetXPx: insetPx,
	        insetYPx: insetPx,
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
  }, [computeTotalSecondsForTimeline, logoEditor, logos, snapshotUndo])

  const saveVideoOverlayEditor = useCallback(() => {
    if (!videoOverlayEditor) return
    const sizePctWidth = Number(videoOverlayEditor.sizePctWidth)
    const position = String(videoOverlayEditor.position || '') as any
    const audioEnabled = Boolean(videoOverlayEditor.audioEnabled)
    const boostRaw = Number((videoOverlayEditor as any).boostDb)
    const boostAllowed = new Set([0, 3, 6, 9])
    const boostDb = Number.isFinite(boostRaw) && boostAllowed.has(Math.round(boostRaw)) ? Math.round(boostRaw) : 0
    const plateStyleRaw = String((videoOverlayEditor as any).plateStyle || 'none').toLowerCase()
    const plateAllowed = new Set(['none', 'thin', 'medium', 'thick', 'band'])
    const plateStyle = plateAllowed.has(plateStyleRaw) ? (plateStyleRaw as any) : 'none'
    const plateColorRaw = String((videoOverlayEditor as any).plateColor || '#000000')
    const plateColor = /^#?[0-9a-fA-F]{6}$/.test(plateColorRaw)
      ? (plateColorRaw.startsWith('#') ? plateColorRaw : `#${plateColorRaw}`)
      : '#000000'
    const plateOpacityRaw = Number((videoOverlayEditor as any).plateOpacityPct)
    const plateOpacityPct = Number.isFinite(plateOpacityRaw) ? Math.round(clamp(plateOpacityRaw, 0, 100)) : 85
    const allowedSizes = new Set([25, 33, 40, 50, 70, 90, 100])
    const allowedPositions = new Set([
      'top_left',
      'top_center',
      'top_right',
      'middle_left',
      'middle_center',
      'middle_right',
      'bottom_left',
      'bottom_center',
      'bottom_right',
    ])
    if (!(Number.isFinite(sizePctWidth) && allowedSizes.has(sizePctWidth))) {
      setVideoOverlayEditorError('Pick a size.')
      return
    }
    if (!allowedPositions.has(position)) {
      setVideoOverlayEditorError('Pick a position.')
      return
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevOverlays: VideoOverlay[] = Array.isArray((prev as any).videoOverlays) ? ((prev as any).videoOverlays as any) : []
      const idx = prevOverlays.findIndex((o: any) => String(o?.id) === String(videoOverlayEditor.id))
      if (idx < 0) return prev
      const updated: VideoOverlay = {
        ...(prevOverlays[idx] as any),
        sizePctWidth,
        position,
        audioEnabled,
        boostDb,
        plateStyle,
        plateColor,
        plateOpacityPct,
      }
      const next = prevOverlays.slice()
      next[idx] = updated
      next.sort(
        (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
      )
      const nextTotal = computeTotalSecondsForTimeline({ ...(prev as any), videoOverlays: next } as any)
      const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
      return { ...(prev as any), videoOverlays: next, playheadSeconds: nextPlayhead } as any
    })
    setVideoOverlayEditor(null)
    setVideoOverlayEditorError(null)
  }, [computeTotalSecondsForTimeline, snapshotUndo, videoOverlayEditor])

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
    try {
      const ret = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`
      const u = new URL('/assets', window.location.origin)
      u.searchParams.set('mode', 'pick')
      u.searchParams.set('return', ret)
      const qp = new URLSearchParams(window.location.search)
      const project = qp.get('project')
      if (project) u.searchParams.set('project', String(project))
      window.location.href = `${u.pathname}${u.search}`
    } catch {
      window.location.href = '/assets?mode=pick'
    }
  }, [])

  // Global listeners (always attached) so quick drags can't miss the pointerup and leave the timeline "locked".
  useEffect(() => {
	    const onMove = (e: PointerEvent) => {
	      const drag = trimDragRef.current
	      if (!drag) return
	      if (e.pointerId !== drag.pointerId) return

		      // Special case: "armed" drags. Don't start mutating the timeline until the pointer has moved a bit,
		      // otherwise a simple tap on the selected pill can open a context menu / modal.
				      if ((drag.kind === 'logo' || drag.kind === 'lowerThird' || drag.kind === 'screenTitle' || drag.kind === 'videoOverlay' || drag.kind === 'videoOverlayStill' || drag.kind === 'clip' || drag.kind === 'narration' || drag.kind === 'audioSegment' || drag.kind === 'still') && (drag as any).armed) {
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
					                (drag as any).videoOverlayId ||
					                (drag as any).videoOverlayStillId ||
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
			            const maxEndSeconds = rippleEnabledRef.current
			              ? MAX_TIMELINE_SECONDS
		              : drag.maxEndSeconds != null
		                ? Number(drag.maxEndSeconds)
		                : 20 * 60
			            const maxStartSeconds = rippleEnabledRef.current
			              ? Math.max(minStartSeconds, roundToTenth(maxEndSeconds - dur))
			              : drag.maxStartSeconds != null
			                ? Number(drag.maxStartSeconds)
			                : Math.max(minStartSeconds, roundToTenth(maxEndSeconds - dur))
			            const desiredStart = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), minStartSeconds, maxStartSeconds)

			            if (rippleEnabledRef.current) {
			              // Ripple is right-only: we still must never allow moving *left* into an earlier clip/still.
			              // Otherwise the timeline becomes invalid (base_track_overlap) and won't persist.
			              let startTimeline = desiredStart
			              if (deltaSeconds < 0) {
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
			                let prevEnd = minStartSeconds
			                for (const r of occupied) {
			                  if (r.start < startTimeline + 1e-6) prevEnd = Math.max(prevEnd, r.end)
			                  else break
			                }
			                startTimeline = Math.max(startTimeline, roundToTenth(prevEnd))
			              }
			              startTimeline = clamp(roundToTenth(startTimeline), minStartSeconds, maxStartSeconds)
			              next[idx] = { ...c, startSeconds: startTimeline }
			            } else {
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
		            }
		            next.sort((a, b) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))
		          } else {
		            // Trimming clips edits the source-time window, and can also affect the timeline start when trimming the start edge.
		            // `startS/endS` are source-time seconds; `timelineStartS` is timeline-time seconds.
		            let timelineStartS = roundToTenth(Number((c as any).startSeconds || 0))
		            let startS = roundToTenth(Number(c.sourceStartSeconds || 0))
		            let endS = roundToTenth(Number(c.sourceEndSeconds || 0))

		            const maxTimelineDur =
		              rippleEnabledRef.current && drag.edge === 'end'
		                ? Number.POSITIVE_INFINITY
		                : drag.maxTimelineDurationSeconds != null
		                  ? Number(drag.maxTimelineDurationSeconds)
		                  : Number.POSITIVE_INFINITY

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
		            if (!(rippleEnabledRef.current && drag.edge === 'end') && Number.isFinite(clipStartTimeline)) {
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
          const nextTimeline0: any = { ...prev, clips: next }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
	          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
	        }

	        if (drag.kind === 'videoOverlay') {
	          const prevOs0: any[] = Array.isArray((prev as any).videoOverlays) ? (prev as any).videoOverlays : []
	          if (!prevOs0.length) return prev
	          const prevStarts = computeClipStarts(prevOs0 as any)
	          const normalized: any[] = prevOs0.map((o: any, i: number) => ({ ...(o as any), startSeconds: roundToTenth(prevStarts[i] || 0) }))
	          const idx = normalized.findIndex((o: any) => String(o?.id) === String((drag as any).videoOverlayId))
	          if (idx < 0) return prev
	          const o0: any = normalized[idx]
	          const nextOs = normalized.slice()
	          const minLen = 0.2

	          const fileDurRaw =
	            (drag as any).maxDurationSeconds != null && Number.isFinite(Number((drag as any).maxDurationSeconds))
	              ? Number((drag as any).maxDurationSeconds)
	              : durationsByUploadId[Number(o0.uploadId)] ?? Number.POSITIVE_INFINITY
	          const fileDur =
	            Number.isFinite(Number(fileDurRaw)) && Number(fileDurRaw) > 0 ? roundToTenth(Number(fileDurRaw)) : Number.POSITIVE_INFINITY

	          const timelineStart0 =
	            (drag as any).startTimelineStartSeconds != null && Number.isFinite(Number((drag as any).startTimelineStartSeconds))
	              ? roundToTenth(Number((drag as any).startTimelineStartSeconds))
	              : roundToTenth(Number(o0.startSeconds || 0))
	          const timelineEnd0 =
	            (drag as any).startTimelineEndSeconds != null && Number.isFinite(Number((drag as any).startTimelineEndSeconds))
	              ? roundToTenth(Number((drag as any).startTimelineEndSeconds))
	              : roundToTenth(timelineStart0 + clipDurationSeconds(o0 as any))
	          const dur0 = roundToTenth(Math.max(minLen, timelineEnd0 - timelineStart0))

		          const minStartSeconds =
		            (drag as any).minStartSeconds != null && Number.isFinite(Number((drag as any).minStartSeconds)) ? Number((drag as any).minStartSeconds) : 0
		          const maxEndSecondsRaw =
		            (drag as any).maxEndSeconds != null && Number.isFinite(Number((drag as any).maxEndSeconds))
		              ? Number((drag as any).maxEndSeconds)
		              : Math.max(minStartSeconds, roundToTenth(totalSeconds))
		          const maxEndSeconds = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : maxEndSecondsRaw
		          const maxStartSecondsRaw =
		            (drag as any).maxStartSeconds != null && Number.isFinite(Number((drag as any).maxStartSeconds))
		              ? Number((drag as any).maxStartSeconds)
		              : Math.max(minStartSeconds, roundToTenth(maxEndSecondsRaw - dur0))
		          const maxStartSeconds = rippleEnabledRef.current ? Math.max(minStartSeconds, roundToTenth(maxEndSeconds - dur0)) : maxStartSecondsRaw

	          const sourceStart0 = roundToTenth(Number((drag as any).startStartSeconds || o0.sourceStartSeconds || 0))
	          const sourceEnd0 = roundToTenth(Number((drag as any).startEndSeconds || o0.sourceEndSeconds || 0))

	          let timelineStart = timelineStart0
	          let timelineEnd = timelineEnd0
	          let sourceStart = sourceStart0
	          let sourceEnd = sourceEnd0

		          if (drag.edge === 'move') {
		            timelineStart = clamp(roundToTenth(timelineStart0 + deltaSeconds), minStartSeconds, maxStartSeconds)
		            if (rippleEnabledRef.current && deltaSeconds < 0) {
		              // Ripple is right-only: prevent moving an overlay left into an earlier overlay segment or overlay still.
		              const occupied: Array<{ start: number; end: number }> = []
		              for (let i = 0; i < nextOs.length; i++) {
		                if (i === idx) continue
		                const o1: any = nextOs[i]
		                const s = roundToTenth(Number(o1?.startSeconds || 0))
		                const d = Math.max(0, roundToTenth(Number(o1?.sourceEndSeconds || 0) - Number(o1?.sourceStartSeconds || 0)))
		                const e = roundToTenth(s + d)
		                if (Number.isFinite(s) && Number.isFinite(e) && e > s) occupied.push({ start: s, end: e })
		              }
		              const prevOverlayStills: any[] = Array.isArray((prev as any).videoOverlayStills) ? (prev as any).videoOverlayStills : []
		              for (const st of prevOverlayStills) {
		                const s = roundToTenth(Number((st as any)?.startSeconds || 0))
		                const e = roundToTenth(Number((st as any)?.endSeconds || 0))
		                if (Number.isFinite(s) && Number.isFinite(e) && e > s) occupied.push({ start: s, end: e })
		              }
		              occupied.sort((a, b) => a.start - b.start || a.end - b.end)
		              let prevEnd = minStartSeconds
		              for (const r of occupied) {
		                if (r.start < timelineStart + 1e-6) prevEnd = Math.max(prevEnd, r.end)
		                else break
		              }
		              timelineStart = clamp(roundToTenth(Math.max(timelineStart, prevEnd)), minStartSeconds, maxStartSeconds)
		            }
		            timelineEnd = roundToTenth(timelineStart + dur0)
		            // Keep source trim unchanged.
		            sourceStart = sourceStart0
		            sourceEnd = sourceEnd0
	          } else if (drag.edge === 'start') {
	            const fixedEnd = clamp(roundToTenth(timelineEnd0), minStartSeconds + minLen, maxEndSeconds)
	            let desiredStart = clamp(roundToTenth(timelineStart0 + deltaSeconds), minStartSeconds, Math.max(minStartSeconds, fixedEnd - minLen))
	            let desiredDur = roundToTenth(Math.max(minLen, fixedEnd - desiredStart))
	            // Keep source end fixed, adjust source start to match the new duration.
	            sourceEnd = clamp(roundToTenth(sourceEnd0), minLen, fileDur)
	            sourceStart = roundToTenth(sourceEnd - desiredDur)
	            sourceStart = clamp(sourceStart, 0, Math.max(0, roundToTenth(sourceEnd - minLen)))
	            desiredDur = roundToTenth(Math.max(minLen, sourceEnd - sourceStart))
	            desiredStart = roundToTenth(fixedEnd - desiredDur)
	            timelineStart = clamp(desiredStart, minStartSeconds, Math.max(minStartSeconds, fixedEnd - minLen))
	            timelineEnd = roundToTenth(fixedEnd)
	          } else {
	            const fixedStart = clamp(roundToTenth(timelineStart0), minStartSeconds, Math.max(minStartSeconds, maxEndSeconds - minLen))
	            let desiredEnd = clamp(roundToTenth(timelineEnd0 + deltaSeconds), fixedStart + minLen, maxEndSeconds)
	            let desiredDur = roundToTenth(Math.max(minLen, desiredEnd - fixedStart))
	            // Keep source start fixed, adjust source end to match duration.
	            sourceStart = clamp(roundToTenth(sourceStart0), 0, Math.max(0, roundToTenth(fileDur - minLen)))
	            sourceEnd = roundToTenth(sourceStart + desiredDur)
	            sourceEnd = clamp(sourceEnd, sourceStart + minLen, fileDur)
	            desiredDur = roundToTenth(Math.max(minLen, sourceEnd - sourceStart))
	            desiredEnd = roundToTenth(fixedStart + desiredDur)
	            timelineStart = roundToTenth(fixedStart)
	            timelineEnd = clamp(desiredEnd, fixedStart + minLen, maxEndSeconds)
	          }

	          nextOs[idx] = { ...o0, startSeconds: roundToTenth(timelineStart), sourceStartSeconds: sourceStart, sourceEndSeconds: sourceEnd }
	          nextOs.sort(
	            (a: any, b: any) =>
	              Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
	          )
	          const nextTimeline0: any = { ...(prev as any), videoOverlays: nextOs }
	          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
	          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
	          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
	          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
	          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
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

	          const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number(drag.maxEndSeconds)

		          if (drag.edge === 'move') {
		            const maxStart =
		              rippleEnabledRef.current
		                ? Math.max(drag.minStartSeconds, roundToTenth(maxEndSecondsLane - dur))
		                : drag.maxStartSeconds != null
		                  ? Number(drag.maxStartSeconds)
		                  : Math.max(drag.minStartSeconds, roundToTenth(maxEndSecondsLane - dur))
		            startS = clamp(roundToTenth(Number(drag.startStartSeconds) + deltaSeconds), drag.minStartSeconds, maxStart)
		            if (rippleEnabledRef.current && deltaSeconds < 0) {
		              // Ripple is right-only: prevent moving a still left into an earlier clip/still.
		              const occupied: Array<{ start: number; end: number }> = []
		              const clipStarts = computeClipStarts((prev as any).clips || [])
		              const clips = Array.isArray((prev as any).clips) ? ((prev as any).clips as any[]) : []
		              for (let i = 0; i < clips.length; i++) {
		                const c: any = clips[i]
		                const s = roundToTenth(Number((c as any).startSeconds ?? clipStarts[i] ?? 0))
		                const e = roundToTenth(s + clipDurationSeconds(c as any))
		                if (Number.isFinite(s) && Number.isFinite(e) && e > s) occupied.push({ start: s, end: e })
		              }
		              for (let i = 0; i < prevStills.length; i++) {
		                if (i === idx) continue
		                const st: any = prevStills[i]
		                const s = roundToTenth(Number(st?.startSeconds || 0))
		                const e = roundToTenth(Number(st?.endSeconds || 0))
		                if (e > s) occupied.push({ start: s, end: e })
		              }
		              occupied.sort((a, b) => a.start - b.start || a.end - b.end)
		              let prevEnd = Number(drag.minStartSeconds) || 0
		              for (const r of occupied) {
		                if (r.start < startS + 1e-6) prevEnd = Math.max(prevEnd, r.end)
		                else break
		              }
		              startS = clamp(roundToTenth(Math.max(startS, prevEnd)), Number(drag.minStartSeconds) || 0, maxStart)
		            }
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
	              maxEndSecondsLane
	            )
	            startS = roundToTenth(Number(drag.startStartSeconds))
	          }

          if (!(endS > startS)) endS = roundToTenth(startS + minLen)
          nextStills[idx] = { ...s0, startSeconds: startS, endSeconds: endS }
          nextStills.sort(
            (a: any, b: any) =>
              Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
          )

          const nextTimeline0: any = { ...(prev as any), stills: nextStills }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
        }

        if (drag.kind === 'videoOverlayStill') {
          const prevStills: any[] = Array.isArray((prev as any).videoOverlayStills) ? (prev as any).videoOverlayStills : []
          const idx = prevStills.findIndex((s: any) => String(s?.id) === String((drag as any).videoOverlayStillId))
          if (idx < 0) return prev
          const s0: any = prevStills[idx]
          const nextStills = prevStills.slice()
          const minLen = 0.1

          let startS = roundToTenth(Number(s0.startSeconds || 0))
          let endS = roundToTenth(Number(s0.endSeconds || 0))
          const dur = Math.max(minLen, roundToTenth(Number((drag as any).startEndSeconds) - Number((drag as any).startStartSeconds)))

          const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number((drag as any).maxEndSeconds)

	          if ((drag as any).edge === 'move') {
	            const maxStart =
	              rippleEnabledRef.current
	                ? Math.max(Number((drag as any).minStartSeconds), roundToTenth(maxEndSecondsLane - dur))
                : (drag as any).maxStartSeconds != null
                  ? Number((drag as any).maxStartSeconds)
                  : Math.max(Number((drag as any).minStartSeconds), roundToTenth(maxEndSecondsLane - dur))
	            startS = clamp(roundToTenth(Number((drag as any).startStartSeconds) + deltaSeconds), Number((drag as any).minStartSeconds), maxStart)
	            if (rippleEnabledRef.current && deltaSeconds < 0) {
	              // Ripple is right-only: prevent moving an overlay still left into an earlier overlay segment/still.
	              const occupied: Array<{ start: number; end: number }> = []
	              const overlaysRaw: any[] = Array.isArray((prev as any).videoOverlays) ? (prev as any).videoOverlays : []
	              const overlayStarts = computeClipStarts(overlaysRaw as any)
	              for (let i = 0; i < overlaysRaw.length; i++) {
	                const o1: any = overlaysRaw[i]
	                const s = roundToTenth(Number((o1 as any).startSeconds ?? overlayStarts[i] ?? 0))
	                const d = Math.max(0, roundToTenth(Number((o1 as any).sourceEndSeconds || 0) - Number((o1 as any).sourceStartSeconds || 0)))
	                const e = roundToTenth(s + d)
	                if (Number.isFinite(s) && Number.isFinite(e) && e > s) occupied.push({ start: s, end: e })
	              }
	              for (let i = 0; i < prevStills.length; i++) {
	                if (i === idx) continue
	                const st: any = prevStills[i]
	                const s = roundToTenth(Number(st?.startSeconds || 0))
	                const e = roundToTenth(Number(st?.endSeconds || 0))
	                if (Number.isFinite(s) && Number.isFinite(e) && e > s) occupied.push({ start: s, end: e })
	              }
	              occupied.sort((a, b) => a.start - b.start || a.end - b.end)
	              let prevEnd = Number((drag as any).minStartSeconds) || 0
	              for (const r of occupied) {
	                if (r.start < startS + 1e-6) prevEnd = Math.max(prevEnd, r.end)
	                else break
	              }
	              startS = clamp(roundToTenth(Math.max(startS, prevEnd)), Number((drag as any).minStartSeconds) || 0, maxStart)
	            }
	            endS = roundToTenth(startS + dur)
	          } else if ((drag as any).edge === 'start') {
	            startS = clamp(
	              roundToTenth(Number((drag as any).startStartSeconds) + deltaSeconds),
              Number((drag as any).minStartSeconds),
              Math.max(Number((drag as any).minStartSeconds), roundToTenth(Number((drag as any).startEndSeconds) - minLen))
            )
            endS = roundToTenth(Number((drag as any).startEndSeconds))
          } else {
            endS = clamp(
              roundToTenth(Number((drag as any).startEndSeconds) + deltaSeconds),
              Math.max(Number((drag as any).minStartSeconds) + minLen, roundToTenth(Number((drag as any).startStartSeconds) + minLen)),
              maxEndSecondsLane
            )
            startS = roundToTenth(Number((drag as any).startStartSeconds))
          }

          if (!(endS > startS)) endS = roundToTenth(startS + minLen)
          nextStills[idx] = { ...s0, startSeconds: startS, endSeconds: endS }
          nextStills.sort((a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id)))

          const nextTimeline0: any = { ...(prev as any), videoOverlayStills: nextStills }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
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
	          const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number(drag.maxEndSeconds)

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
	                    maxEndSecondsLane,
	                    roundToTenth(Number(drag.startStartSeconds) + Math.max(0.2, maxLenByAudio != null ? maxLenByAudio : maxDurForFile))
	                  )
	                : maxEndSecondsLane
            endS = clamp(
              roundToTenth(drag.startEndSeconds + deltaSeconds),
              Math.max(drag.startStartSeconds + minLen, drag.minStartSeconds + minLen),
              maxEndByAudio
            )
            startS = roundToTenth(Number(drag.startStartSeconds))
            sourceStartS = baseSourceStart
	          } else {
	            const maxStart =
	              rippleEnabledRef.current
	                ? Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
	                : drag.maxStartSeconds != null
	                  ? Number(drag.maxStartSeconds)
	                  : Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
	            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
	            endS = roundToTenth(startS + dur)
	            sourceStartS = baseSourceStart
	          }

          if (!(endS > startS)) endS = roundToTenth(startS + minLen)
          const nextSegs = prevSegs.slice()
          nextSegs[idx] = { ...(s0 as any), startSeconds: startS, endSeconds: endS, sourceStartSeconds: sourceStartS }
          nextSegs.sort(
            (a: any, b: any) =>
              Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
          )
          const nextTimeline0: any = { ...(prev as any), audioSegments: nextSegs, audioTrack: null }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead } as any
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
          const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number(drag.maxEndSeconds)
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
              maxEndSecondsLane
            )
          } else {
            const maxStart = rippleEnabledRef.current
              ? Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
              : drag.maxStartSeconds != null
                ? Number(drag.maxStartSeconds)
                : Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
            endS = roundToTenth(startS + dur)
          }
          nextLogos[idx] = { ...l0, startSeconds: startS, endSeconds: endS }
          nextLogos.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
          const nextTimeline0: any = { ...(prev as any), logos: nextLogos }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
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
          const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number(drag.maxEndSeconds)
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
              maxEndSecondsLane
            )
          } else {
            const maxStart = rippleEnabledRef.current
              ? Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
              : drag.maxStartSeconds != null
                ? Number(drag.maxStartSeconds)
                : Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
            endS = roundToTenth(startS + dur)
          }
          nextLts[idx] = { ...lt0, startSeconds: startS, endSeconds: endS }
          nextLts.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
          const nextTimeline0: any = { ...(prev as any), lowerThirds: nextLts }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
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
          const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number(drag.maxEndSeconds)
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
              maxEndSecondsLane
            )
          } else {
            const maxStart = rippleEnabledRef.current
              ? Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
              : drag.maxStartSeconds != null
                ? Number(drag.maxStartSeconds)
                : Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
            endS = roundToTenth(startS + dur)
          }
          nextSts[idx] = { ...st0, startSeconds: startS, endSeconds: endS }
          nextSts.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
          const nextTimeline0: any = { ...(prev as any), screenTitles: nextSts }
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
	          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
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
		          const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number(drag.maxEndSeconds)
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
		                ? Math.min(maxEndSecondsLane, roundToTenth(Number(drag.startStartSeconds) + maxDurForFile))
		                : maxEndSecondsLane
		            endS = clamp(
		              roundToTenth(drag.startEndSeconds + deltaSeconds),
		              Math.max(drag.startStartSeconds + minLen, drag.minStartSeconds + minLen),
		              maxEndByAudio
		            )
		          } else {
		            const maxStart =
		              rippleEnabledRef.current
		                ? Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
		                : drag.maxStartSeconds != null
		                  ? Number(drag.maxStartSeconds)
		                  : Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
		            startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
		            endS = roundToTenth(startS + dur)
		          }
	          nextNs[idx] = { ...n0, startSeconds: startS, endSeconds: endS, sourceStartSeconds: sourceStartS }
	          nextNs.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
	          const nextTimeline0: any = { ...(prev as any), narration: nextNs }
	          const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
	          const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
	          const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
	          const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
	          return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
	        }

	        if (drag.kind !== 'graphic') return prev

        const prevGraphics: Graphic[] = Array.isArray((prev as any).graphics) ? ((prev as any).graphics as any) : []
        const idx = prevGraphics.findIndex((g: any) => String(g?.id) === String(drag.graphicId))
        if (idx < 0) return prev
        const g = prevGraphics[idx] as any
        let startS = Number(g.startSeconds || 0)
        let endS = Number(g.endSeconds || 0)
        const dur = Math.max(0.2, roundToTenth(Number(drag.startEndSeconds) - Number(drag.startStartSeconds)))
        const maxEndSecondsLane = rippleEnabledRef.current ? MAX_TIMELINE_SECONDS : Number(drag.maxEndSeconds)
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
            maxEndSecondsLane
          )
        } else {
          const maxStart = rippleEnabledRef.current
            ? Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
            : drag.maxStartSeconds != null
              ? Number(drag.maxStartSeconds)
              : Math.max(drag.minStartSeconds, maxEndSecondsLane - dur)
          startS = clamp(roundToTenth(drag.startStartSeconds + deltaSeconds), drag.minStartSeconds, maxStart)
          endS = roundToTenth(startS + dur)
        }

        const nextGraphics = prevGraphics.slice()
        nextGraphics[idx] = { ...g, startSeconds: startS, endSeconds: endS }
        nextGraphics.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds))
        const nextTimeline0: any = { ...(prev as any), graphics: nextGraphics }
        const nextTotal = computeTotalSecondsForTimeline(nextTimeline0 as any)
        const nextTimeline1: any = extendViewportEndSecondsIfNeeded(prev as any, nextTimeline0 as any, nextTotal + VIEWPORT_PAD_SECONDS)
        const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((nextTimeline1 as any).viewportEndSeconds || 0))
        const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
        return { ...(nextTimeline1 as any), playheadSeconds: nextPlayhead }
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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

      // For video overlays: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'videoOverlay' && (drag as any).armed && !Boolean((drag as any).moved)) {
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
            kind: 'videoOverlay',
            id: String((drag as any).videoOverlayId),
            x,
            y,
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('videoOverlay_ctx_menu')
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
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

      // For overlay freeze stills: tap-release on a selected pill (armed, not moved) opens the context menu immediately.
      if (drag && drag.kind === 'videoOverlayStill' && (drag as any).armed && !Boolean((drag as any).moved)) {
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
            kind: 'videoOverlayStill',
            id: String((drag as any).videoOverlayStillId),
            x,
            y,
            view: edgeIntent === 'move' ? 'main' : 'guidelines',
            edgeIntent,
          })
          suppressNextTimelineClickRef.current = true
          window.setTimeout(() => {
            suppressNextTimelineClickRef.current = false
          }, 0)
        } catch {}
        stopTrimDrag('video_overlay_still_ctx_menu')
        return
      }

      // Commit ripple-right (pointer-up): allow temporary overlaps during drag when ripple is enabled,
      // then cascade-push later items to remove overlaps.
      if (drag && rippleEnabledRef.current && Boolean((drag as any).moved) && (drag.edge === 'end' || drag.edge === 'move')) {
        try {
          setTimeline((prev) => {
            const kind = String((drag as any).kind || '')
            let next: any = prev

            if (kind === 'clip') {
              const prevStills: Still[] = Array.isArray((prev as any).stills) ? ((prev as any).stills as any) : []
              const ripple = rippleRightBaseLane(prev.clips as any, prevStills as any, 'clip', String((drag as any).clipId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), clips: ripple.clips, stills: ripple.stills }
            } else if (kind === 'still') {
              const prevStills: Still[] = Array.isArray((prev as any).stills) ? ((prev as any).stills as any) : []
              const ripple = rippleRightBaseLane(prev.clips as any, prevStills as any, 'still', String((drag as any).stillId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), clips: ripple.clips, stills: ripple.stills }
            } else if (kind === 'videoOverlay') {
              const prevOs: any[] = Array.isArray((prev as any).videoOverlays) ? (prev as any).videoOverlays : []
              const prevOverlayStills: any[] = Array.isArray((prev as any).videoOverlayStills) ? (prev as any).videoOverlayStills : []
              const ripple = rippleRightVideoOverlayLane(prevOs as any, prevOverlayStills as any, 'videoOverlay', String((drag as any).videoOverlayId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), videoOverlays: ripple.videoOverlays, videoOverlayStills: ripple.videoOverlayStills }
            } else if (kind === 'videoOverlayStill') {
              const prevOs: any[] = Array.isArray((prev as any).videoOverlays) ? (prev as any).videoOverlays : []
              const prevOverlayStills: any[] = Array.isArray((prev as any).videoOverlayStills) ? (prev as any).videoOverlayStills : []
              const ripple = rippleRightVideoOverlayLane(
                prevOs as any,
                prevOverlayStills as any,
                'videoOverlayStill',
                String((drag as any).videoOverlayStillId)
              )
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), videoOverlays: ripple.videoOverlays, videoOverlayStills: ripple.videoOverlayStills }
            } else if (kind === 'graphic') {
              const prevGs: Graphic[] = Array.isArray((prev as any).graphics) ? ((prev as any).graphics as any) : []
              const ripple = rippleRightSimpleLane(prevGs as any, String((drag as any).graphicId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), graphics: ripple.items }
            } else if (kind === 'logo') {
              const prevLs: Logo[] = Array.isArray((prev as any).logos) ? ((prev as any).logos as any) : []
              const ripple = rippleRightSimpleLane(prevLs as any, String((drag as any).logoId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), logos: ripple.items }
            } else if (kind === 'lowerThird') {
              const prevLts: LowerThird[] = Array.isArray((prev as any).lowerThirds) ? ((prev as any).lowerThirds as any) : []
              const ripple = rippleRightSimpleLane(prevLts as any, String((drag as any).lowerThirdId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), lowerThirds: ripple.items }
            } else if (kind === 'screenTitle') {
              const prevSts: ScreenTitle[] = Array.isArray((prev as any).screenTitles) ? ((prev as any).screenTitles as any) : []
              const ripple = rippleRightSimpleLane(prevSts as any, String((drag as any).screenTitleId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), screenTitles: ripple.items }
            } else if (kind === 'narration') {
              const prevNs: Narration[] = Array.isArray((prev as any).narration) ? ((prev as any).narration as any) : []
              const ripple = rippleRightSimpleLane(prevNs as any, String((drag as any).narrationId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), narration: ripple.items }
            } else if (kind === 'audioSegment') {
              const prevAs: AudioSegment[] = Array.isArray((prev as any).audioSegments) ? ((prev as any).audioSegments as any) : []
              const ripple = rippleRightSimpleLane(prevAs as any, String((drag as any).audioSegmentId))
              if (!ripple) {
                setTimelineMessage('Timeline max length reached.')
                return prev
              }
              next = { ...(prev as any), audioSegments: ripple.items, audioTrack: null }
            } else {
              return prev
            }

            const nextTotal = computeTotalSecondsForTimeline(next as any)
            const next1: any = extendViewportEndSecondsIfNeeded(prev as any, next as any, nextTotal + VIEWPORT_PAD_SECONDS)
            const capPlayhead = Math.max(0, nextTotal, MIN_VIEWPORT_SECONDS, Number((next1 as any).viewportEndSeconds || 0))
            const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, capPlayhead)
            return { ...(next1 as any), playheadSeconds: nextPlayhead }
          })
        } catch {}
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
    if (!project?.id) return
    const enabledMusicSegments: any[] = Array.isArray(audioSegments)
      ? (audioSegments as any[]).filter((s) => (s as any).audioEnabled !== false)
      : []
    if (enabledMusicSegments.length) {
      const missingCfg = enabledMusicSegments.some((s) => {
        const mode = String((s as any).musicMode || '').trim()
        const level = String((s as any).musicLevel || '').trim()
        const duck = String((s as any).duckingIntensity || '').trim()
        if (!mode || !level) return true
        if (mode === 'mix_duck' && !duck) return true
        return false
      })
      if (missingCfg) {
        setExportError('Music configuration is required. Open each music segment Properties and choose a Music Mode and Level.')
        return
      }
      const hasOpener = enabledMusicSegments.some((s) => String((s as any).musicMode || '') === 'opener_cutoff')
      if (hasOpener && enabledMusicSegments.length !== 1) {
        setExportError('Opener mode requires exactly one music segment.')
        return
      }
    }
    const existingName = String(project?.name || '').trim()
    if (!existingName) {
      const suggested = `Timeline ${new Date().toISOString().slice(0, 10)}`
      const entered = window.prompt('Name this timeline before exporting:', suggested)
      if (entered == null) return
      const nextName = String(entered).trim()
      if (!nextName) {
        window.alert('Timeline name is required.')
        return
      }
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(project.id))}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ name: nextName }),
        })
        const json: any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.error || 'failed_to_save_name'))
        setProject((prev) => (prev ? { ...prev, name: nextName } : prev))
      } catch (e: any) {
        window.alert(e?.message || 'Failed to save timeline name')
        return
      }
    }
    setExporting(true)
    setExportError(null)
    setExportStatus('Starting export…')
    setExportJobId(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(project.id))}/export`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: '{}',
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'export_failed'))
      const jid = Number(json?.jobId)
      if (Number.isFinite(jid) && jid > 0) setExportJobId(jid)
      setExportStatus('Export in progress…')
    } catch (e: any) {
      setExportError(e?.message || 'export_failed')
      setExportStatus(null)
      setExporting(false)
      setExportJobId(null)
    }
  }, [audioSegments, project?.id, project?.name, totalSeconds])

  useEffect(() => {
    if (!exporting) return
    if (!project?.id) return
    let alive = true
    const tick = async () => {
      try {
        const qs = exportJobId != null && Number.isFinite(exportJobId) && exportJobId > 0 ? `?jobId=${encodeURIComponent(String(exportJobId))}` : ''
        const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(project.id))}/export-status${qs}`, { credentials: 'same-origin' })
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
            window.location.href = `/exports?from=${encodeURIComponent('/create-video')}`
            return
          }
          setExportError('Export completed but missing upload id.')
          setExportStatus(null)
          setExporting(false)
          setExportJobId(null)
          return
        }
        if (status === 'failed' || status === 'dead') {
          setExportError(String(json?.error?.message || json?.error?.code || 'export_failed'))
          setExportStatus(null)
          setExporting(false)
          setExportJobId(null)
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
  }, [exporting, exportJobId, project?.id])

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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
            <a
              href={`/timelines?return=${encodeURIComponent('/create-video')}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                fontWeight: 800,
                textDecoration: 'none',
              }}
            >
              Timelines
            </a>
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
	          <div ref={previewWrapRef} style={{ width: '100%', aspectRatio: '9 / 16', background: '#000', position: 'relative', overflow: 'hidden' }}>
	            <video
	              ref={videoRef}
	              playsInline
	              preload="metadata"
	              poster={activePoster || undefined}
	              style={previewBaseVideoStyle}
	            />
            {activeStillUrl ? (
              <img
                src={activeStillUrl}
                alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', zIndex: 10 }}
              />
            ) : null}
	            {activeGraphicUrl && activeGraphicPreviewStyle ? (
	              <>
	                <img src={activeGraphicUrl} alt="" style={activeGraphicPreviewStyle} />
	                {activeGraphicPreviewIndicators.show ? (
	                  <div
	                    style={{
	                      position: 'absolute',
	                      inset: 0,
	                      display: 'flex',
	                      alignItems: 'center',
	                      justifyContent: 'center',
	                      pointerEvents: 'none',
	                      zIndex: 25,
	                    }}
	                  >
	                    <div
	                      style={{
	                        display: 'inline-flex',
	                        gap: 8,
	                        padding: '8px 10px',
	                        borderRadius: 999,
	                        border: '1px solid rgba(255,255,255,0.22)',
	                        background: 'rgba(0,0,0,0.55)',
	                        color: '#fff',
	                        fontWeight: 900,
	                        fontSize: 12,
	                        letterSpacing: 0.4,
	                      }}
	                    >
	                      {activeGraphicPreviewIndicators.hasFade ? <span>FADE</span> : null}
	                    </div>
	                  </div>
	                ) : null}
	              </>
	            ) : null}
            {activeVideoOverlayStillPreview ? (
              <img
                src={activeVideoOverlayStillPreview.url}
                alt=""
                style={activeVideoOverlayStillPreview.style}
              />
            ) : null}
            {activeVideoOverlayPreview && !activeVideoOverlayStillPreview ? (
              <>
                {activeVideoOverlayPreview.plateStyle ? <div style={activeVideoOverlayPreview.plateStyle} /> : null}
                <div style={activeVideoOverlayPreview.style}>
                  <video
                    ref={overlayVideoRef}
                    playsInline
                    preload="metadata"
                    poster={activeVideoOverlayPreview.thumbUrl || undefined}
                    style={activeVideoOverlayPreview.innerStyle}
                  />
                </div>
              </>
            ) : null}
	            {showPreviewToolbar && hasPlayablePreview ? (
	              <div
	                ref={previewToolbarRef}
	                style={{
	                  position: 'absolute',
	                  left: '50%',
	                  transform: 'translateX(-50%)',
	                  bottom: previewToolbarBottomPx,
	                  zIndex: 70,
	                  width: 'min(94vw, 560px)',
	                  userSelect: 'none',
	                  WebkitUserSelect: 'none',
	                  WebkitTouchCallout: 'none',
	                  boxSizing: 'border-box',
	                }}
	              >
	                <div
	                  style={{
	                    display: 'inline-flex',
	                    flexDirection: 'column',
	                    borderRadius: 14,
	                    border: '1px solid rgba(255,255,255,0.18)',
	                    background: 'rgba(0,0,0,0.55)',
	                    backdropFilter: 'blur(6px)',
	                    width: '100%',
	                    boxSizing: 'border-box',
	                  }}
	                >
	                  <div
	                    onPointerDown={(e) => {
	                      if (e.button != null && e.button !== 0) return
	                      e.preventDefault()
	                      e.stopPropagation()
	                      try { (e.currentTarget as any).setPointerCapture?.(e.pointerId) } catch {}
	                      previewToolbarDragRef.current = { pointerId: e.pointerId, startY: e.clientY, startBottom: previewToolbarBottomPx }
	                      setPreviewToolbarDragging(true)
	                    }}
	                    style={{
	                      height: 18,
	                      display: 'flex',
	                      alignItems: 'center',
	                      justifyContent: 'center',
	                      cursor: 'grab',
	                      touchAction: 'none',
	                    }}
	                    title="Drag to move preview controls"
	                  >
	                    <div style={{ width: 44, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.22)' }} />
	                  </div>
		                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 10 }}>
	                    <button
	                      type="button"
	                      onClick={jumpPrevBoundary}
	                      disabled={totalSeconds <= 0 || !canJumpPrev}
	                      style={{
	                        padding: 0,
	                        borderRadius: 10,
	                        border: '1px solid rgba(255,255,255,0.18)',
	                        background: totalSeconds <= 0 || !canJumpPrev ? 'rgba(255,255,255,0.06)' : '#0c0c0c',
	                        color: '#ffd24a',
	                        fontWeight: 900,
	                        fontSize: 26,
	                        lineHeight: 1,
	                        display: 'flex',
	                        alignItems: 'center',
	                        justifyContent: 'center',
	                        cursor: totalSeconds <= 0 || !canJumpPrev ? 'default' : 'pointer',
	                        flex: '0 0 auto',
	                        minWidth: 40,
	                        height: 40,
	                      }}
	                      title="Jump to previous boundary"
	                      aria-label="Jump to previous boundary"
	                    >
	                      «
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => nudgePlayhead(-0.1)}
	                      disabled={totalSeconds <= 0}
	                      style={{
	                        padding: 0,
	                        borderRadius: 10,
	                        border: '1px solid rgba(255,255,255,0.18)',
	                        background: '#0c0c0c',
	                        color: '#ffd24a',
	                        fontWeight: 900,
	                        fontSize: 26,
	                        lineHeight: 1,
	                        display: 'flex',
	                        alignItems: 'center',
	                        justifyContent: 'center',
	                        cursor: totalSeconds <= 0 ? 'default' : 'pointer',
	                        flex: '0 0 auto',
	                        minWidth: 40,
	                        height: 40,
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
	                        minWidth: 40,
	                        height: 40,
	                        lineHeight: 1,
	                        display: 'flex',
	                        alignItems: 'center',
	                        justifyContent: 'center',
	                      }}
	                      title={playing ? 'Pause' : 'Play'}
	                      aria-label={playing ? 'Pause' : 'Play'}
	                    >
	                      <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
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
	                        minWidth: 40,
	                        height: 40,
	                        lineHeight: 1,
	                        display: 'flex',
	                        alignItems: 'center',
	                        justifyContent: 'center',
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
	                      onClick={toggleMusicPlay}
	                      disabled={!audioSegments.length}
	                      style={{
	                        padding: '10px 12px',
	                        borderRadius: 10,
	                        border: '1px solid rgba(48,209,88,0.65)',
	                        background: musicPreviewPlaying ? 'rgba(48,209,88,0.22)' : 'rgba(48,209,88,0.12)',
	                        color: '#fff',
	                        fontWeight: 900,
	                        cursor: audioSegments.length ? 'pointer' : 'default',
	                        flex: '0 0 auto',
	                        minWidth: 40,
	                        height: 40,
	                        lineHeight: 1,
	                        display: 'flex',
	                        alignItems: 'center',
	                        justifyContent: 'center',
	                      }}
	                      title="Play music"
	                      aria-label={musicPreviewPlaying ? 'Pause music' : 'Play music'}
	                    >
	                      <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
	                        {playPauseGlyph(musicPreviewPlaying)}
	                      </span>
	                    </button>
	
	                    <button
	                      type="button"
	                      onClick={() => nudgePlayhead(0.1)}
	                      disabled={totalSeconds <= 0}
	                      style={{
	                        padding: 0,
	                        borderRadius: 10,
	                        border: '1px solid rgba(255,255,255,0.18)',
	                        background: '#0c0c0c',
	                        color: '#ffd24a',
	                        fontWeight: 900,
	                        fontSize: 26,
	                        lineHeight: 1,
	                        display: 'flex',
	                        alignItems: 'center',
	                        justifyContent: 'center',
	                        cursor: totalSeconds <= 0 ? 'default' : 'pointer',
	                        flex: '0 0 auto',
	                        minWidth: 40,
	                        height: 40,
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
	                        padding: 0,
	                        borderRadius: 10,
	                        border: '1px solid rgba(255,255,255,0.18)',
	                        background: totalSeconds <= 0 || !canJumpNext ? 'rgba(255,255,255,0.06)' : '#0c0c0c',
	                        color: '#ffd24a',
	                        fontWeight: 900,
	                        fontSize: 26,
	                        lineHeight: 1,
	                        display: 'flex',
	                        alignItems: 'center',
	                        justifyContent: 'center',
	                        cursor: totalSeconds <= 0 || !canJumpNext ? 'default' : 'pointer',
	                        flex: '0 0 auto',
	                        minWidth: 40,
	                        height: 40,
	                      }}
	                      title="Jump to next boundary"
	                      aria-label="Jump to next boundary"
	                    >
	                      »
	                    </button>
	                  </div>
	                  <div style={{ padding: '0 10px 10px' }}>
	                    <div
	                      style={{
	                        position: 'relative',
	                        height: 32,
	                        borderRadius: 10,
	                        overflow: 'hidden',
	                        border: '1px solid rgba(255,255,255,0.12)',
	                        touchAction: 'none',
	                        userSelect: 'none',
	                        WebkitUserSelect: 'none',
	                        WebkitTouchCallout: 'none',
	                        width: '100%',
	                        boxSizing: 'border-box',
	                      }}
			                      onPointerDown={(e) => {
			                        if (e.button != null && e.button !== 0) return
			                        if (!(totalSeconds > 0)) return
			                        e.preventDefault()
		                        e.stopPropagation()
		                        // If user scrubs while playing, pause for predictable behavior.
		                        if (playingRef.current) {
		                          try { videoRef.current?.pause?.() } catch {}
		                          try { overlayVideoRef.current?.pause?.() } catch {}
		                          setPlaying(false)
		                        }
			                        try { (e.currentTarget as any).setPointerCapture?.(e.pointerId) } catch {}
		                        previewMiniDragRef.current = { pointerId: e.pointerId, startX: e.clientX, startPlayhead: Number(playheadRef.current || 0) }
		                      }}
		                      onPointerMove={(e) => {
		                        const cur = previewMiniDragRef.current
		                        if (!cur) return
		                        if (e.pointerId !== cur.pointerId) return
		                        const dx = e.clientX - cur.startX
		                        const deltaSeconds = -dx / pxPerSecond
		                        const next = clamp(roundToTenth(cur.startPlayhead + deltaSeconds), 0, Math.max(0, totalSeconds))
		                        // This scrubber should behave like the main timeline: as the user drags,
		                        // we actively seek the preview video(s) so the frame updates immediately.
		                        // Mark as "from video" to skip the playhead→seek effect (we are seeking here).
		                        playheadFromVideoRef.current = true
		                        playheadRef.current = next
		                        setTimeline((prev) => ({ ...prev, playheadSeconds: next }))
		                        void seek(next)
		                        void seekOverlay(next)
		                      }}
	                      onPointerUp={(e) => {
	                        const cur = previewMiniDragRef.current
	                        if (!cur) return
	                        if (e.pointerId !== cur.pointerId) return
	                        previewMiniDragRef.current = null
	                      }}
		                      onPointerCancel={() => {
		                        previewMiniDragRef.current = null
		                      }}
		                      title="Scrub timeline"
		                      aria-label="Scrub timeline"
		                    >
	                      <canvas ref={previewMiniTimelineRef} style={{ display: 'block', width: '100%', height: '100%' }} />
	                      <div
	                        style={{
	                          position: 'absolute',
	                          left: '50%',
	                          top: 0,
	                          transform: 'translateX(-50%)',
	                          color: '#ddd',
	                          fontSize: 12,
	                          fontWeight: 900,
	                          fontVariantNumeric: 'tabular-nums',
	                          padding: '2px 6px',
	                          borderRadius: 999,
	                          background: 'rgba(0,0,0,0.35)',
	                          border: '1px solid rgba(255,255,255,0.10)',
	                          pointerEvents: 'none',
	                        }}
	                      >
	                        {playhead.toFixed(1)}s
	                      </div>
	                    </div>
	                  </div>
	                </div>
	              </div>
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

        <div
          style={{
            marginTop: 14,
            borderRadius: 0,
            border: 'none',
            background: 'transparent',
            padding: '12px 0',
          }}
        >
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
	                  const withinVideoOverlay = y >= VIDEO_OVERLAY_Y && y <= VIDEO_OVERLAY_Y + PILL_H
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
	                    withinVideoOverlay,
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

                    const capEnd = MAX_TIMELINE_SECONDS
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

                    const capEnd = MAX_TIMELINE_SECONDS
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

                    // Ensure first tap selects the segment so handles/highlight render even if
                    // the subsequent click event gets suppressed by pointer logic.
	                    if (selectedScreenTitleId !== String((st as any).id)) {
	                      setSelectedScreenTitleId(String((st as any).id))
	                      setSelectedClipId(null)
	                      setSelectedVideoOverlayId(null)
	                      setSelectedVideoOverlayStillId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLogoId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
                      setSelectedAudioId(null)
                      suppressNextTimelineClickRef.current = true
                      return
                    }

                    const capEnd = MAX_TIMELINE_SECONDS
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

                  if (withinVideoOverlay) {
                    cancelTimelineLongPress('new_pointerdown')
                    const overlayStill = findVideoOverlayStillAtTime(t)
                    if (overlayStill) {
                      const s = roundToTenth(Number((overlayStill as any).startSeconds || 0))
                      const e2 = roundToTenth(Number((overlayStill as any).endSeconds || 0))
                      const leftX = padPx + s * pxPerSecond
                      const rightX = padPx + e2 * pxPerSecond
                      let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
                      let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
                      const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
                      if (!inside) return
                      if (selectedVideoOverlayStillId === String((overlayStill as any).id)) {
                        nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
                        nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX
                      }

                      const capEnd = MAX_TIMELINE_SECONDS
                      const overlayStarts = computeClipStarts(videoOverlays as any)
                      const overlayRanges = videoOverlays.map((o2: any, i2: number) => {
                        const ss = roundToTenth(Number((overlayStarts as any)[i2] ?? (o2 as any).startSeconds ?? 0))
                        const ee = roundToTenth(ss + clipDurationSeconds(o2 as any))
                        return { id: `ov:${String((o2 as any).id)}`, start: ss, end: ee }
                      })
                      const overlayStillRanges = (videoOverlayStills as any[]).map((st2: any) => ({
                        id: `ostill:${String((st2 as any).id)}`,
                        start: roundToTenth(Number((st2 as any).startSeconds || 0)),
                        end: roundToTenth(Number((st2 as any).endSeconds || 0)),
                      }))
                      const ranges = [...overlayRanges, ...overlayStillRanges]
                        .filter((r: any) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
                        .sort((a: any, b: any) => a.start - b.start || a.end - b.end || String(a.id).localeCompare(String(b.id)))
                      const pos = ranges.findIndex((r: any) => r.id === `ostill:${String((overlayStill as any).id)}`)
                      const prevEnd = pos > 0 ? Number(ranges[pos - 1].end || 0) : 0
                      const nextStart = pos >= 0 && pos < ranges.length - 1 ? Number(ranges[pos + 1].start || capEnd) : capEnd
                      const minStartSeconds = clamp(roundToTenth(prevEnd), 0, capEnd)
                      const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                      const dur = Math.max(0.1, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)

                      if (selectedVideoOverlayStillId !== String((overlayStill as any).id)) {
                        e.preventDefault()
                        setSelectedVideoOverlayStillId(String((overlayStill as any).id))
                        setSelectedVideoOverlayId(null)
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

                      e.preventDefault()
                      setSelectedVideoOverlayStillId(String((overlayStill as any).id))
                      setSelectedVideoOverlayId(null)
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      setSelectedLogoId(null)
                      setSelectedLowerThirdId(null)
                      setSelectedScreenTitleId(null)
                      setSelectedNarrationId(null)
                      setSelectedStillId(null)
                      setSelectedAudioId(null)

                      trimDragLockScrollLeftRef.current = sc.scrollLeft
                      trimDragRef.current = {
                        kind: 'videoOverlayStill',
                        videoOverlayStillId: String((overlayStill as any).id),
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
                        dbg('startTrimDrag', { kind: 'videoOverlayStill', edge: nearLeft ? 'start' : 'end', id: String((overlayStill as any).id) })
                      } else {
                        try { sc.setPointerCapture(e.pointerId) } catch {}
                        dbg('armTrimDrag', { kind: 'videoOverlayStill', edge: 'move', id: String((overlayStill as any).id) })
                      }
                      return
                    }

                    const o = findVideoOverlayAtTime(t)
                    if (!o) return

                    const starts0 = computeClipStarts(videoOverlays as any)
                    const idx0 = videoOverlays.findIndex((vv: any) => String((vv as any).id) === String((o as any).id))
	                    const start0 = roundToTenth(Number((starts0 as any)[idx0] || (o as any).startSeconds || 0))
	                    const dur0 = roundToTenth(Math.max(0.2, clipDurationSeconds(o as any)))
	                    const end0 = roundToTenth(start0 + dur0)
	                    const leftX = padPx + start0 * pxPerSecond
	                    const rightX = padPx + end0 * pxPerSecond
	                    let nearLeft = Math.abs(clickXInScroll - leftX) <= HANDLE_HIT_PX
	                    let nearRight = Math.abs(clickXInScroll - rightX) <= HANDLE_HIT_PX
	                    const inside = clickXInScroll >= leftX && clickXInScroll <= rightX
	                    if (!inside) return

	                    // Ensure first tap selects so handles/highlight render.
                    if (selectedVideoOverlayId !== String((o as any).id)) {
                      setSelectedVideoOverlayId(String((o as any).id))
                      setSelectedVideoOverlayStillId(null)
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      setSelectedLogoId(null)
                      setSelectedLowerThirdId(null)
                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
	                      suppressNextTimelineClickRef.current = true
	                      return
	                    }

	                    // Expand handle hitboxes when selected.
	                    nearLeft = nearLeft || clickXInScroll - leftX <= EDGE_HIT_PX
	                    nearRight = nearRight || rightX - clickXInScroll <= EDGE_HIT_PX

		                    const capEnd = MAX_TIMELINE_SECONDS
		                    const normalized: any[] = videoOverlays.map((vv: any, i: number) => ({
		                      ...(vv as any),
		                      startSeconds: roundToTenth((starts0 as any)[i] || (vv as any).startSeconds || 0),
		                    }))

		                    const overlayRanges = normalized.map((o2: any) => {
		                      const ss = roundToTenth(Number((o2 as any).startSeconds || 0))
		                      const ee = roundToTenth(ss + clipDurationSeconds(o2 as any))
		                      return { id: `ov:${String((o2 as any).id)}`, start: ss, end: ee }
		                    })
		                    const overlayStillRanges = (videoOverlayStills as any[]).map((st2: any) => ({
		                      id: `ostill:${String((st2 as any).id)}`,
		                      start: roundToTenth(Number((st2 as any).startSeconds || 0)),
		                      end: roundToTenth(Number((st2 as any).endSeconds || 0)),
		                    }))
		                    const ranges = [...overlayRanges, ...overlayStillRanges]
		                      .filter((r: any) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
		                      .sort((a: any, b: any) => a.start - b.start || a.end - b.end || String(a.id).localeCompare(String(b.id)))
		                    const pos = ranges.findIndex((r: any) => r.id === `ov:${String((o as any).id)}`)
		                    const prevEnd = pos > 0 ? Number(ranges[pos - 1].end || 0) : 0
		                    const nextStart = pos >= 0 && pos < ranges.length - 1 ? Number(ranges[pos + 1].start || capEnd) : capEnd
		                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
		                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

	                    const maxDurationSecondsRaw = durationsByUploadId[Number((o as any).uploadId)] ?? Number.POSITIVE_INFINITY
	                    const maxDurationSeconds =
	                      Number.isFinite(Number(maxDurationSecondsRaw)) && Number(maxDurationSecondsRaw) > 0
	                        ? roundToTenth(Number(maxDurationSecondsRaw))
	                        : Number.POSITIVE_INFINITY

	                    const dur = Math.max(0.2, roundToTenth(end0 - start0))
	                    const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)

	                    if (!nearLeft && !nearRight) {
	                      trimDragRef.current = {
	                        kind: 'videoOverlay',
	                        videoOverlayId: String((o as any).id),
	                        edge: 'move',
	                        pointerId: e.pointerId,
	                        startClientX: e.clientX,
	                        startClientY: e.clientY,
	                        startStartSeconds: Number((o as any).sourceStartSeconds || 0),
	                        startEndSeconds: Number((o as any).sourceEndSeconds || 0),
	                        startTimelineStartSeconds: start0,
	                        startTimelineEndSeconds: end0,
	                        maxDurationSeconds,
	                        minStartSeconds,
	                        maxEndSeconds,
	                        maxStartSeconds,
	                        armed: true,
	                        moved: false,
	                      }
	                      try { sc.setPointerCapture(e.pointerId) } catch {}
	                      dbg('armTrimDrag', { kind: 'videoOverlay', edge: 'move', id: String((o as any).id) })
	                      return
	                    }

	                    // Resize only when already selected.
	                    e.preventDefault()
	                    trimDragRef.current = {
	                      kind: 'videoOverlay',
	                      videoOverlayId: String((o as any).id),
	                      edge: nearLeft ? 'start' : 'end',
	                      pointerId: e.pointerId,
	                      startClientX: e.clientX,
	                      startClientY: e.clientY,
	                      startStartSeconds: Number((o as any).sourceStartSeconds || 0),
	                      startEndSeconds: Number((o as any).sourceEndSeconds || 0),
	                      startTimelineStartSeconds: start0,
	                      startTimelineEndSeconds: end0,
	                      maxDurationSeconds,
	                      minStartSeconds,
	                      maxEndSeconds,
	                      armed: true,
	                      moved: false,
	                    }
	                    try { sc.setPointerCapture(e.pointerId) } catch {}
	                    dbg('armTrimDrag', { kind: 'videoOverlay', edge: nearLeft ? 'start' : 'end', id: String((o as any).id) })
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
			                    const capEnd = MAX_TIMELINE_SECONDS
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

	                    const capEnd = MAX_TIMELINE_SECONDS
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
	                        setSelectedVideoOverlayId(null)
	                        setSelectedVideoOverlayStillId(null)
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
	                      setSelectedVideoOverlayId(null)
	                      setSelectedVideoOverlayStillId(null)
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
		                  const withinVideoOverlay = y >= VIDEO_OVERLAY_Y && y <= VIDEO_OVERLAY_Y + PILL_H
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
                  if (withinVideoOverlay) {
                    const st = findVideoOverlayStillAtTime(t)
                    if (st) return
                    const o = findVideoOverlayAtTime(t)
                    if (o) return
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
		                  const withinVideoOverlay = y >= VIDEO_OVERLAY_Y && y <= VIDEO_OVERLAY_Y + PILL_H
		                  const withinGraphics = y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
		                  const withinVideo = y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
		                  const withinNarration = y >= NARRATION_Y && y <= NARRATION_Y + PILL_H
		                  const withinAudio = y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
		                  if (!withinLogo && !withinLowerThird && !withinScreenTitle && !withinVideoOverlay && !withinGraphics && !withinVideo && !withinNarration && !withinAudio) {
		                    setSelectedClipId(null)
		                    setSelectedVideoOverlayId(null)
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
			                    setSelectedVideoOverlayId(null)
			                    setSelectedVideoOverlayStillId(null)
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
			                    setSelectedVideoOverlayId(null)
			                    setSelectedVideoOverlayStillId(null)
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
			                    setSelectedVideoOverlayId(null)
			                    setSelectedVideoOverlayStillId(null)
			                    setSelectedGraphicId(null)
			                    setSelectedLogoId(null)
			                    setSelectedLowerThirdId(null)
			                    setSelectedNarrationId(null)
				                    setSelectedStillId(null)
			                    setSelectedAudioId(null)
			                    return
			                  }

		                  if (withinVideoOverlay) {
		                    const overlayStill = findVideoOverlayStillAtTime(t)
		                    if (overlayStill) {
		                      const s = Number((overlayStill as any).startSeconds || 0)
		                      const e2 = Number((overlayStill as any).endSeconds || 0)
		                      const leftX = padPx + s * pxPerSecond
		                      const rightX = padPx + e2 * pxPerSecond
		                      if (clickXInScroll >= leftX && clickXInScroll <= rightX) {
		                        if (selectedVideoOverlayStillId !== String((overlayStill as any).id)) {
		                          setSelectedVideoOverlayStillId(String((overlayStill as any).id))
		                          setSelectedVideoOverlayId(null)
		                          setSelectedClipId(null)
		                          setSelectedGraphicId(null)
		                          setSelectedLogoId(null)
		                          setSelectedLowerThirdId(null)
		                          setSelectedScreenTitleId(null)
		                          setSelectedNarrationId(null)
		                          setSelectedStillId(null)
		                          setSelectedAudioId(null)
		                        }
		                        return
		                      }
		                    }
		                    const o = findVideoOverlayAtTime(t)
		                    if (!o) {
		                      setSelectedClipId(null)
		                      setSelectedVideoOverlayId(null)
		                      setSelectedVideoOverlayStillId(null)
				                      setSelectedGraphicId(null)
				                      setSelectedLogoId(null)
				                      setSelectedLowerThirdId(null)
				                      setSelectedScreenTitleId(null)
				                      setSelectedNarrationId(null)
			                      setSelectedStillId(null)
			                      setSelectedAudioId(null)
			                      return
			                    }
			                    const starts = computeClipStarts(videoOverlays as any)
			                    const idx = videoOverlays.findIndex((vv: any) => String((vv as any).id) === String((o as any).id))
			                    const start = idx >= 0 ? Number((starts as any)[idx] || 0) : Number((o as any).startSeconds || 0)
			                    const len = Math.max(0, clipDurationSeconds(o as any))
			                    const end = start + len
			                    const leftX = padPx + start * pxPerSecond
			                    const rightX = padPx + end * pxPerSecond
				                    if (clickXInScroll < leftX || clickXInScroll > rightX) {
				                      setSelectedClipId(null)
				                      setSelectedVideoOverlayId(null)
				                      setSelectedVideoOverlayStillId(null)
				                      setSelectedGraphicId(null)
				                      setSelectedLogoId(null)
				                      setSelectedLowerThirdId(null)
				                      setSelectedScreenTitleId(null)
				                      setSelectedNarrationId(null)
			                      setSelectedStillId(null)
			                      setSelectedAudioId(null)
			                      return
			                    }
				                    // Video overlay properties are opened via the context menu (not by tapping).
				                    if (selectedVideoOverlayId === String((o as any).id)) return
				                    setSelectedVideoOverlayId(String((o as any).id))
				                    setSelectedVideoOverlayStillId(null)
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
					                    setSelectedVideoOverlayId(null)
					                    setSelectedVideoOverlayStillId(null)
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
			                    setSelectedVideoOverlayId(null)
			                    setSelectedVideoOverlayStillId(null)
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
			                      setSelectedVideoOverlayId(null)
			                      setSelectedVideoOverlayStillId(null)
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
		                      setSelectedVideoOverlayId(null)
		                      setSelectedVideoOverlayStillId(null)
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
				                    setSelectedVideoOverlayId(null)
				                    setSelectedVideoOverlayStillId(null)
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
			                      setSelectedVideoOverlayId(null)
			                      setSelectedVideoOverlayStillId(null)
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
			                    setSelectedVideoOverlayId(null)
			                    setSelectedVideoOverlayStillId(null)
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
		                    setSelectedVideoOverlayId(null)
		                    setSelectedVideoOverlayStillId(null)
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
		                    setSelectedVideoOverlayId(null)
		                    setSelectedVideoOverlayStillId(null)
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
			                  setSelectedVideoOverlayId(null)
			                  setSelectedVideoOverlayStillId(null)
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
                    fontSize: 20,
                    lineHeight: 1,
                    cursor: 'pointer',
                    flex: '0 0 auto',
                    minWidth: 44,
                  }}
	                  title="Add"
	                  aria-label="Add"
	                >
                    <img src={PLUS_ICON_URL} alt="" aria-hidden="true" style={{ width: 20, height: 20, display: 'block' }} />
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
		                    minWidth: 44,
		                    lineHeight: 1,
		                  }}
	                  title="Undo"
	                  aria-label="Undo"
		                >
                      <img src={UNDO_ICON_URL} alt="" aria-hidden="true" style={{ width: 18, height: 18, display: 'block' }} />
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
	                    minWidth: 44,
	                    lineHeight: 1,
	                  }}
	                  title="Redo"
	                  aria-label="Redo"
	                >
                    <img src={REDO_ICON_URL} alt="" aria-hidden="true" style={{ width: 18, height: 18, display: 'block' }} />
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
                          <span
                            aria-hidden="true"
                            style={{
                              display: 'inline-block',
                              width: 2,
                              height: 18,
                              borderRadius: 2,
                              background: 'rgba(212,175,55,0.85)',
                            }}
                          />
				                </button>
                      <button
                        type="button"
                        onClick={() => setRippleEnabled((v) => !v)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: rippleEnabled ? '1px solid rgba(48,209,88,0.85)' : '1px solid rgba(255,255,255,0.18)',
                          background: rippleEnabled ? 'rgba(48,209,88,0.18)' : '#0c0c0c',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                          flex: '0 0 auto',
                          minWidth: 44,
                          lineHeight: 1,
                        }}
                        title="Toggle ripple-right (push later objects on the same lane)"
                        aria-label={rippleEnabled ? 'Ripple enabled' : 'Ripple disabled'}
	                      >
	                        <img src={RIPPLE_ICON_URL} alt="" aria-hidden="true" style={{ width: 20, height: 20, display: 'block' }} />
	                      </button>
			                {hasPlayablePreview ? (
			                  <button
			                    type="button"
			                    onClick={() => setShowPreviewToolbar((v) => !v)}
			                    style={{
			                      padding: '10px 12px',
			                      borderRadius: 10,
			                      border: '1px solid rgba(212,175,55,0.65)',
			                      background: showPreviewToolbar ? 'rgba(212,175,55,0.22)' : 'rgba(212,175,55,0.08)',
			                      color: '#fff',
			                      fontWeight: 900,
			                      cursor: 'pointer',
			                      flex: '0 0 auto',
			                      minWidth: 44,
			                      lineHeight: 1,
			                    }}
			                    title="Toggle floating preview controls"
			                    aria-label="Toggle floating preview controls"
			                  >
                          <img src={FLOAT_ICON_URL} alt="" aria-hidden="true" style={{ width: 26, height: 26, display: 'block' }} />
			                  </button>
			                ) : null}
					              </div>
			            </div>

		            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center' }}>
		              <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-start' }}>
		                <button
		                  type="button"
		                  onClick={jumpPrevBoundary}
		                  disabled={totalSeconds <= 0 || !canJumpPrev}
		                  style={{
		                    padding: 0,
		                    borderRadius: 10,
		                    border: '1px solid rgba(255,255,255,0.18)',
		                    background: totalSeconds <= 0 || !canJumpPrev ? 'rgba(255,255,255,0.06)' : '#0c0c0c',
		                    color: '#ffd24a',
		                    fontWeight: 900,
		                    fontSize: 30,
		                    lineHeight: 1,
		                    display: 'flex',
		                    alignItems: 'center',
		                    justifyContent: 'center',
		                    cursor: totalSeconds <= 0 || !canJumpPrev ? 'default' : 'pointer',
		                    flex: '0 0 auto',
		                    minWidth: 44,
		                    height: 44,
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
		                    padding: 0,
		                    borderRadius: 10,
		                    border: '1px solid rgba(255,255,255,0.18)',
		                    background: '#0c0c0c',
		                    color: '#ffd24a',
		                    fontWeight: 900,
		                    fontSize: 30,
		                    lineHeight: 1,
		                    display: 'flex',
		                    alignItems: 'center',
		                    justifyContent: 'center',
		                    cursor: totalSeconds <= 0 ? 'default' : 'pointer',
		                    flex: '0 0 auto',
		                    userSelect: 'none',
		                    WebkitUserSelect: 'none',
		                    WebkitTouchCallout: 'none',
		                    minWidth: 44,
		                    height: 44,
		                  }}
		                  title="Nudge backward 0.1s"
		                  aria-label="Nudge backward 0.1 seconds"
		                >
		                  ‹
		                </button>
		              </div>

				              <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
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
			                  title={playing ? 'Pause' : 'Play'}
			                  aria-label={playing ? 'Pause' : 'Play'}
			                >
				                  <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
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
				                  onClick={toggleMusicPlay}
				                  disabled={!audioSegments.length}
				                  style={{
				                    padding: '10px 12px',
				                    borderRadius: 10,
				                    border: '1px solid rgba(48,209,88,0.65)',
				                    background: musicPreviewPlaying ? 'rgba(48,209,88,0.22)' : 'rgba(48,209,88,0.12)',
				                    color: '#fff',
				                    fontWeight: 900,
				                    cursor: audioSegments.length ? 'pointer' : 'default',
				                    flex: '0 0 auto',
				                    minWidth: 44,
				                    lineHeight: 1,
				                  }}
				                  title="Play music"
				                  aria-label={musicPreviewPlaying ? 'Pause music' : 'Play music'}
				                >
				                  <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
				                    {playPauseGlyph(musicPreviewPlaying)}
				                  </span>
				                </button>
				              </div>

		              <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
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
		                    padding: 0,
		                    borderRadius: 10,
		                    border: '1px solid rgba(255,255,255,0.18)',
		                    background: '#0c0c0c',
		                    color: '#ffd24a',
		                    fontWeight: 900,
		                    fontSize: 30,
		                    lineHeight: 1,
		                    display: 'flex',
		                    alignItems: 'center',
		                    justifyContent: 'center',
		                    cursor: totalSeconds <= 0 ? 'default' : 'pointer',
		                    flex: '0 0 auto',
		                    userSelect: 'none',
		                    WebkitUserSelect: 'none',
		                    WebkitTouchCallout: 'none',
		                    minWidth: 44,
		                    height: 44,
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
		                    padding: 0,
		                    borderRadius: 10,
		                    border: '1px solid rgba(255,255,255,0.18)',
		                    background: totalSeconds <= 0 || !canJumpNext ? 'rgba(255,255,255,0.06)' : '#0c0c0c',
		                    color: '#ffd24a',
		                    fontWeight: 900,
		                    fontSize: 30,
		                    lineHeight: 1,
		                    display: 'flex',
		                    alignItems: 'center',
		                    justifyContent: 'center',
		                    cursor: totalSeconds <= 0 || !canJumpNext ? 'default' : 'pointer',
		                    flex: '0 0 auto',
		                    minWidth: 44,
		                    height: 44,
		                  }}
		                  title="Jump to next boundary"
		                  aria-label="Jump to next boundary"
		                >
		                  »
		                </button>
		              </div>
		            </div>

            {timelineMessage ? (
              <div
                style={{
                  marginTop: 6,
                  color: '#ffd24a',
                  fontSize: 13,
                  textAlign: 'center',
                  fontWeight: 900,
                  background: 'rgba(255,210,74,0.10)',
                  border: '1px solid rgba(255,210,74,0.28)',
                  borderRadius: 12,
                  padding: '8px 10px',
                }}
              >
                {timelineMessage}
              </div>
            ) : null}
          </div>
        </div>

        {exportStatus ? <div style={{ marginTop: 12, color: '#bbb' }}>{exportStatus}</div> : null}
        {exportError ? <div style={{ marginTop: 10, color: '#ff9b9b' }}>{exportError}</div> : null}
      </div>

      {graphicEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setGraphicEditor(null); setGraphicEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
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
                  border: `1px solid ${enabled ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.10)'}`,
                  background: enabled ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.03)',
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

		                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
		                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
		                        <div style={{ fontSize: 14, fontWeight: 900 }}>Placement</div>
		                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() =>
                              setGraphicEditor((p) =>
                                p
                                  ? {
                                      ...p,
                                      fitMode: 'cover_full',
                                    }
                                  : p
                              )
                            }
                            style={{
                              padding: '8px 10px',
                              borderRadius: 10,
                              border: graphicEditor.fitMode === 'cover_full' ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
                              background: graphicEditor.fitMode === 'cover_full' ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            Full Frame
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setGraphicEditor((p) =>
                                p
                                  ? {
                                      ...p,
                                      fitMode: 'contain_transparent',
                                    }
                                  : p
                              )
                            }
                            style={{
                              padding: '8px 10px',
                              borderRadius: 10,
                              border:
                                graphicEditor.fitMode === 'contain_transparent'
                                  ? '2px solid rgba(96,165,250,0.95)'
                                  : '1px solid rgba(255,255,255,0.18)',
                              background:
                                graphicEditor.fitMode === 'contain_transparent' ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
	                            Positioned
	                          </button>
	                        </div>
	                      </div>

	                      {graphicEditor.fitMode === 'contain_transparent' ? (
	                          <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
	                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
	                            <div style={{ minWidth: 0 }}>
	                              <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Size (% width)</div>
	                              <select
	                                value={String(graphicEditor.sizePctWidth)}
	                                onChange={(e) => {
	                                  const v = Math.round(Number(e.target.value))
	                                  setGraphicEditor((p) => (p ? { ...p, sizePctWidth: v } : p))
	                                }}
	                                style={{
	                                  width: '100%',
	                                  padding: '10px 12px',
	                                  borderRadius: 12,
	                                  border: '1px solid rgba(255,255,255,0.16)',
	                                  background: '#0c0c0c',
	                                  color: '#fff',
	                                  fontWeight: 900,
	                                }}
	                              >
	                                {[25, 33, 40, 50, 60, 70, 80, 90, 100].map((n) => (
	                                  <option key={n} value={String(n)}>
	                                    {n}%
	                                  </option>
	                                ))}
	                              </select>
	                            </div>
	                            <div style={{ minWidth: 0 }}>
	                              <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Insets (px)</div>
	                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
	                                <input
	                                  type="number"
	                                  inputMode="numeric"
	                                  value={String(graphicEditor.insetXPx)}
	                                  onChange={(e) => {
	                                    const v = Math.round(Number(e.target.value))
	                                    setGraphicEditor((p) => (p ? { ...p, insetXPx: v } : p))
	                                  }}
	                                  style={{
	                                    width: '50px',
	                                    padding: '10px 12px',
	                                    borderRadius: 12,
	                                    border: '1px solid rgba(255,255,255,0.16)',
	                                    background: '#0c0c0c',
	                                    color: '#fff',
	                                    fontWeight: 900,
	                                  }}
	                                  aria-label="Horizontal inset px"
	                                  title="Horizontal inset (px)"
	                                />
	                                <input
	                                  type="number"
	                                  inputMode="numeric"
	                                  value={String(graphicEditor.insetYPx)}
	                                  onChange={(e) => {
	                                    const v = Math.round(Number(e.target.value))
	                                    setGraphicEditor((p) => (p ? { ...p, insetYPx: v } : p))
	                                  }}
	                                  style={{
	                                    width: '50px',
	                                    padding: '10px 12px',
	                                    borderRadius: 12,
	                                    border: '1px solid rgba(255,255,255,0.16)',
	                                    background: '#0c0c0c',
	                                    color: '#fff',
	                                    fontWeight: 900,
	                                  }}
	                                  aria-label="Vertical inset px"
	                                  title="Vertical inset (px)"
	                                />
	                              </div>
	                              <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Left/Right · Top/Bottom</div>
	                            </div>
	                          </div>

	                          <div>
	                            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Position</div>
	                            {(() => {
	                              const cells: Array<{ key: any; label: string }> = [
	                                { key: 'top_left', label: '↖' },
	                                { key: 'top_center', label: '↑' },
	                                { key: 'top_right', label: '↗' },
	                                { key: 'middle_left', label: '←' },
	                                { key: 'middle_center', label: '•' },
	                                { key: 'middle_right', label: '→' },
	                                { key: 'bottom_left', label: '↙' },
	                                { key: 'bottom_center', label: '↓' },
	                                { key: 'bottom_right', label: '↘' },
	                              ]
	                              return (
	                                <div
	                                  style={{
	                                    display: 'grid',
	                                    gridTemplateColumns: 'repeat(3, 1fr)',
	                                    gap: 8,
	                                    maxWidth: 240,
	                                  }}
	                                >
	                                  {cells.map((c) => {
	                                    const selected = String(graphicEditor.position) === String(c.key)
	                                    return (
	                                      <button
	                                        key={String(c.key)}
	                                        type="button"
	                                        onClick={() => setGraphicEditor((p) => (p ? { ...p, position: c.key as any } : p))}
	                                        style={{
	                                          height: 44,
	                                          borderRadius: 12,
	                                          border: selected ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
	                                          background: selected ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
	                                          color: '#fff',
	                                          fontWeight: 900,
	                                          cursor: 'pointer',
	                                          display: 'flex',
	                                          alignItems: 'center',
	                                          justifyContent: 'center',
	                                          fontSize: 18,
	                                        }}
	                                        aria-label={`Position ${String(c.key)}`}
	                                      >
	                                        {c.label}
	                                      </button>
	                                    )
	                                  })}
	                                </div>
	                              )
	                            })()}
	                          </div>
	                        </div>
	                      ) : (
	                        <div style={{ marginTop: 10, color: '#888', fontSize: 13 }}>
	                          Full-frame graphics fill the canvas and may crop to cover.
	                        </div>
	                      )}
	                    </div>

	                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
	                      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Effects</div>
	                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, alignItems: 'end' }}>
	                        <div>
	                          <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Fade</div>
	                          <select
	                            value={String(graphicEditor.fade || 'none')}
	                            onChange={(e) => setGraphicEditor((p) => (p ? { ...p, fade: e.target.value as any } : p))}
	                            style={{
	                              width: '100%',
	                              padding: '10px 12px',
	                              borderRadius: 12,
	                              border: '1px solid rgba(255,255,255,0.16)',
	                              background: '#0c0c0c',
	                              color: '#fff',
	                              fontWeight: 900,
	                            }}
	                          >
	                            <option value="none">None</option>
	                            <option value="in">Fade In</option>
	                            <option value="out">Fade Out</option>
	                            <option value="in_out">Fade In/Out</option>
	                          </select>
	                          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Fixed duration: 0.35s</div>
	                        </div>
	                      </div>
	                      {graphicEditor.fitMode === 'contain_transparent' ? (
	                        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
	                          <div>
	                            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Border</div>
	                            <select
	                              value={String(graphicEditor.borderWidthPx || 0)}
	                              onChange={(e) => setGraphicEditor((p) => (p ? { ...p, borderWidthPx: Number(e.target.value) as any } : p))}
	                              style={{
	                                width: '100%',
	                                padding: '10px 12px',
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                color: '#fff',
	                                fontWeight: 900,
	                              }}
	                            >
	                              <option value="0">None</option>
	                              <option value="2">Thin (2px)</option>
	                              <option value="4">Medium (4px)</option>
	                              <option value="6">Thick (6px)</option>
	                            </select>
	                          </div>
	                          <div>
	                            <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Border color</div>
	                            <input
	                              type="color"
	                              value={String(graphicEditor.borderColor || '#000000')}
	                              disabled={Number(graphicEditor.borderWidthPx || 0) <= 0}
	                              onChange={(e) => setGraphicEditor((p) => (p ? { ...p, borderColor: e.target.value } : p))}
	                              style={{
	                                width: '100%',
	                                height: 44,
	                                padding: 0,
	                                borderRadius: 12,
	                                border: '1px solid rgba(255,255,255,0.16)',
	                                background: '#0c0c0c',
	                                cursor: Number(graphicEditor.borderWidthPx || 0) <= 0 ? 'default' : 'pointer',
	                                opacity: Number(graphicEditor.borderWidthPx || 0) <= 0 ? 0.5 : 1,
	                              }}
	                            />
	                            <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
	                              Default: black
	                            </div>
	                          </div>
	                        </div>
	                      ) : null}
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
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
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
                  border: `1px solid ${enabled ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.10)'}`,
                  background: enabled ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.03)',
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
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {videoOverlayStillEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setVideoOverlayStillEditor(null); setVideoOverlayStillEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Overlay Freeze Frame Properties</div>
              <button
                type="button"
                onClick={() => { setVideoOverlayStillEditor(null); setVideoOverlayStillEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {(() => {
                const start = Number(videoOverlayStillEditor.start)
                const end = Number(videoOverlayStillEditor.end)
                const minLen = 0.1
                const cap = 20 * 60

                const adjustStart = (delta: number) => {
                  setVideoOverlayStillEditorError(null)
                  setVideoOverlayStillEditor((p) => {
                    if (!p) return p
                    const next = roundToTenth(Number(p.start) + delta)
                    const maxStart = Math.max(0, (Number(p.end) - minLen))
                    return { ...p, start: clamp(next, 0, maxStart) }
                  })
                }

                const adjustEnd = (delta: number) => {
                  setVideoOverlayStillEditorError(null)
                  setVideoOverlayStillEditor((p) => {
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
                  border: `1px solid ${enabled ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.10)'}`,
                  background: enabled ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.03)',
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
              {videoOverlayStillEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{videoOverlayStillEditorError}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setVideoOverlayStillEditor(null); setVideoOverlayStillEditorError(null) }}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveVideoOverlayStillEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
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
              const audioConfigId = seg.audioConfigId == null ? null : Number(seg.audioConfigId)
              const mode = seg.musicMode ? String(seg.musicMode) : ''
              const level = seg.musicLevel ? String(seg.musicLevel) : ''
              return (
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ color: '#fff', fontWeight: 900 }}>
                    {namesByUploadId[uploadId] || `Audio ${uploadId}`}
                    {audioConfigId && (audioConfigNameById[audioConfigId] || `Config ${audioConfigId}`) ? (
                      <span style={{ color: '#bbb', fontWeight: 800 }}>{' * ' + (audioConfigNameById[audioConfigId] || `Config ${audioConfigId}`)}</span>
                    ) : null}
                    {mode && level ? <span style={{ color: '#bbb', fontWeight: 800 }}>{' * ' + mode + ' ' + level}</span> : null}
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
                      minWidth: 44,
                      height: 40,
                      lineHeight: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title={audioPreviewPlayingId === uploadId ? 'Pause preview' : 'Play preview'}
                    aria-label={audioPreviewPlayingId === uploadId ? 'Pause preview' : 'Play preview'}
                  >
                    <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                      {playPauseGlyph(audioPreviewPlayingId === uploadId)}
                    </span>
                  </button>
                </div>
              )
            })()}

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Music Mode</div>
                  <select
                    value={String(audioEditor.musicMode)}
                    onChange={(e) => {
                      setAudioEditorError(null)
                      const next = String(e.target.value || '')
                      setAudioEditor((p) =>
                        p
                          ? ({
                              ...p,
                              musicMode: next as any,
                              ...(next !== 'mix_duck' ? { duckingIntensity: '' } : {}),
                            } as any)
                          : p
                      )
                    }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
                  >
                    <option value="">Select…</option>
                    <option value="opener_cutoff">Opener (auto-cut on speech)</option>
                    <option value="replace">Replace</option>
                    <option value="mix">Mix (no ducking)</option>
                    <option value="mix_duck">Mix + Ducking</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Music Level</div>
                  <select
                    value={String(audioEditor.musicLevel)}
                    onChange={(e) => {
                      setAudioEditorError(null)
                      setAudioEditor((p) => (p ? ({ ...p, musicLevel: String(e.target.value || '') as any } as any) : p))
                    }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
                  >
                    <option value="">Select…</option>
                    <option value="quiet">Quiet</option>
                    <option value="medium">Medium</option>
                    <option value="loud">Loud</option>
                  </select>
                </label>
              </div>

              {String(audioEditor.musicMode) === 'mix_duck' ? (
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Ducking</div>
                  <select
                    value={String(audioEditor.duckingIntensity)}
                    onChange={(e) => { setAudioEditorError(null); setAudioEditor((p) => (p ? ({ ...p, duckingIntensity: String(e.target.value || '') as any } as any) : p)) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
                  >
                    <option value="">Select…</option>
                    <option value="min">Min</option>
                    <option value="medium">Medium</option>
                    <option value="max">Max</option>
                  </select>
                </label>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={String(audioEditor.start)}
                    onChange={(e) => { setAudioEditorError(null); setAudioEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
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
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
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
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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
	            style={{
	              maxWidth: 560,
	              margin: '0 auto',
	              borderRadius: 14,
	              border: '1px solid rgba(96,165,250,0.95)',
	              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
	              padding: 16,
	              boxSizing: 'border-box',
	            }}
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
              const name = Number.isFinite(uploadId) && uploadId > 0 ? (namesByUploadId[uploadId] || `Logo ${uploadId}`) : 'Logo'
              return (
                <div style={{ marginTop: 10, color: '#fff', fontWeight: 900 }}>
                  {name}
                </div>
              )
            })()}

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ color: '#bbb', fontSize: 12, fontWeight: 800 }}>Start</div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{Number(logoEditor.start).toFixed(1)}s</div>
                </div>
                <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ color: '#bbb', fontSize: 12, fontWeight: 800 }}>Duration</div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{Math.max(0, Number(logoEditor.end) - Number(logoEditor.start)).toFixed(1)}s</div>
                </div>
                <div style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ color: '#bbb', fontSize: 12, fontWeight: 800 }}>End</div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{Number(logoEditor.end).toFixed(1)}s</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13, fontWeight: 900 }}>Adjust Start</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
	                      type="button"
	                      onClick={() => setLogoEditor((p) => (p ? ({ ...p, start: Math.max(0, roundToTenth(Number(p.start) - 0.1)) } as any) : p))}
	                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
	                    >
                      −0.1s
                    </button>
                    <button
	                      type="button"
	                      onClick={() => setLogoEditor((p) => (p ? ({ ...p, start: roundToTenth(Number(p.start) + 0.1) } as any) : p))}
	                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
	                    >
                      +0.1s
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13, fontWeight: 900 }}>Adjust End</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
	                      type="button"
	                      onClick={() => setLogoEditor((p) => (p ? ({ ...p, end: Math.max(0, roundToTenth(Number(p.end) - 0.1)) } as any) : p))}
	                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
	                    >
                      −0.1s
                    </button>
                    <button
	                      type="button"
	                      onClick={() => setLogoEditor((p) => (p ? ({ ...p, end: roundToTenth(Number(p.end) + 0.1) } as any) : p))}
	                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.65)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
	                    >
                      +0.1s
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Placement</div>
                <div style={{ display: 'grid', gap: 12 }}>
		                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
		                    <label style={{ display: 'grid', gap: 6, minWidth: 0 }}>
		                      <div style={{ color: '#bbb', fontSize: 13 }}>Size (% width)</div>
		                      <select
		                        value={String(logoEditor.sizePctWidth)}
		                        onChange={(e) => { setLogoEditorError(null); setLogoEditor((p) => p ? ({ ...p, sizePctWidth: Number(e.target.value) } as any) : p) }}
		                        style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
		                      >
		                        {[10, 20, 30, 40, 50].map((n) => (
		                          <option key={`logo_sz_${n}`} value={String(n)}>{`${n}%`}</option>
		                        ))}
		                      </select>
		                    </label>
		                    <label style={{ display: 'grid', gap: 6, minWidth: 0 }}>
		                      <div style={{ color: '#bbb', fontSize: 13 }}>Opacity (%)</div>
		                      <select
		                        value={String(Math.round(Number(logoEditor.opacityPct)))}
		                        onChange={(e) => { setLogoEditorError(null); setLogoEditor((p) => p ? ({ ...p, opacityPct: Number(e.target.value) } as any) : p) }}
		                        style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
		                      >
		                        {Array.from({ length: 11 }).map((_, i) => {
		                          const n = i * 10
		                          return (
		                            <option key={`logo_op_${n}`} value={String(n)}>
		                              {`${n}%`}
		                            </option>
		                          )
		                        })}
		                      </select>
		                    </label>
		                  </div>
	
	                  <label style={{ display: 'grid', gap: 6 }}>
	                    <div style={{ color: '#bbb', fontSize: 13 }}>Inset</div>
	                    <select
	                      value={String((logoEditor as any).insetPreset || 'medium')}
	                      onChange={(e) => { setLogoEditorError(null); setLogoEditor((p) => (p ? ({ ...p, insetPreset: e.target.value as any } as any) : p)) }}
	                      style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
	                    >
	                      <option value="small">Small</option>
	                      <option value="medium">Medium</option>
	                      <option value="large">Large</option>
	                    </select>
	                  </label>

	                  <label style={{ display: 'grid', gap: 6 }}>
	                    <div style={{ color: '#bbb', fontSize: 13 }}>Position</div>
	                    {(() => {
                      const cells = [
                        { key: 'top_left', label: '↖' },
                        { key: 'top_center', label: '↑' },
                        { key: 'top_right', label: '↗' },
                        { key: 'middle_left', label: '←' },
                        { key: 'middle_center', label: '•' },
                        { key: 'middle_right', label: '→' },
                        { key: 'bottom_left', label: '↙' },
                        { key: 'bottom_center', label: '↓' },
                        { key: 'bottom_right', label: '↘' },
                      ] as const
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxWidth: 240 }}>
                          {cells.map((c) => {
                            const selected = String(logoEditor.position) === String(c.key)
                            return (
                              <button
                                key={String(c.key)}
                                type="button"
                                onClick={() => { setLogoEditorError(null); setLogoEditor((p) => (p ? ({ ...p, position: c.key as any } as any) : p)) }}
                                style={{
                                  height: 44,
                                  borderRadius: 12,
	                                  border: selected ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
	                                  background: selected ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                                  color: '#fff',
                                  fontWeight: 900,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 18,
                                }}
                                aria-label={`Position ${String(c.key)}`}
                              >
                                {c.label}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </label>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Effects</div>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Fade</div>
                  <select
                    value={String(logoEditor.fade || 'none')}
                    onChange={(e) => setLogoEditor((p) => (p ? ({ ...p, fade: e.target.value as any } as any) : p))}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                  >
                    <option value="none">None</option>
                    <option value="in">Fade In</option>
                    <option value="out">Fade Out</option>
                    <option value="in_out">Fade In/Out</option>
                  </select>
                  <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Fixed duration: 0.35s</div>
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
	                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
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
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
                >
                  {lowerThirdConfigs
                    .filter((c: any) => !(c && typeof c === 'object' && c.archived_at))
                    .map((c: any) => (
                      <option key={`ltcfg-${c.id}`} value={String(c.id)}>{String(c.name || `Config ${c.id}`)}</option>
                    ))}
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={String(lowerThirdEditor.start)}
                    onChange={(e) => { setLowerThirdEditorError(null); setLowerThirdEditor((p) => p ? ({ ...p, start: Number(e.target.value) }) : p) }}
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
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
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
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
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {videoOverlayEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
          onClick={() => { setVideoOverlayEditor(null); setVideoOverlayEditorError(null) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Video Overlay Properties</div>
              <button
                type="button"
                onClick={() => { setVideoOverlayEditor(null); setVideoOverlayEditorError(null) }}
                style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
              >
                Close
              </button>
            </div>

              {(() => {
                const o = videoOverlays.find((oo: any) => String((oo as any).id) === String(videoOverlayEditor.id)) as any
                if (!o) return null
                const uploadId = Number((o as any).uploadId)
                return (
                  <div style={{ marginTop: 10, color: '#fff', fontWeight: 900 }}>
                    {namesByUploadId[uploadId] || `Video ${uploadId}`}
                  </div>
                )
              })()}

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Size (% width)</div>
                <select
                  value={String(videoOverlayEditor.sizePctWidth)}
                  onChange={(e) => { setVideoOverlayEditorError(null); setVideoOverlayEditor((p) => p ? ({ ...p, sizePctWidth: Number(e.target.value) }) : p) }}
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                >
                  {[25, 33, 40, 50, 70, 90, 100].map((n) => (
                    <option key={`sz-${n}`} value={String(n)}>{`${n}%`}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Position</div>
                {(() => {
                  const cells = [
                    { key: 'top_left', label: '↖' },
                    { key: 'top_center', label: '↑' },
                    { key: 'top_right', label: '↗' },
                    { key: 'middle_left', label: '←' },
                    { key: 'middle_center', label: '•' },
                    { key: 'middle_right', label: '→' },
                    { key: 'bottom_left', label: '↙' },
                    { key: 'bottom_center', label: '↓' },
                    { key: 'bottom_right', label: '↘' },
                  ] as const
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxWidth: 240 }}>
                      {cells.map((c) => {
                        const selected = String(videoOverlayEditor.position) === String(c.key)
                        return (
                          <button
                            key={String(c.key)}
                            type="button"
                            onClick={() => {
                              setVideoOverlayEditorError(null)
                              setVideoOverlayEditor((p) => (p ? ({ ...p, position: c.key as any }) : p))
                            }}
                            style={{
                              height: 44,
                              borderRadius: 12,
                              border: selected ? '2px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
                              background: selected ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
                              color: '#fff',
                              fontWeight: 900,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 18,
                            }}
                            aria-label={`Position ${String(c.key)}`}
                          >
                            {c.label}
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
              </label>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Overlay Frame</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, alignItems: 'end' }}>
                  <div>
                    <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Style</div>
                    <select
                      value={String(videoOverlayEditor.plateStyle || 'none')}
                      onChange={(e) => setVideoOverlayEditor((p) => (p ? ({ ...p, plateStyle: e.target.value as any }) : p))}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        fontWeight: 900,
                      }}
                    >
                      <option value="none">None</option>
                      <option value="thin">Thin</option>
                      <option value="medium">Medium</option>
                      <option value="thick">Thick</option>
                      <option value="band">Band</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
                  <div>
                    <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Frame color</div>
                    <input
                      type="color"
                      value={String(videoOverlayEditor.plateColor || '#000000')}
                      onChange={(e) =>
                        setVideoOverlayEditor((p) => (p ? { ...p, plateColor: e.target.value } : p))
                      }
                      style={{
                        width: '100%',
                        height: 44,
                        padding: 0,
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        cursor: 'pointer',
                      }}
                    />
                    <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Default: black</div>
                  </div>
                  <div>
                    <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Frame opacity</div>
                    <select
                      value={String(Number(videoOverlayEditor.plateOpacityPct ?? 85))}
                      onChange={(e) =>
                        setVideoOverlayEditor((p) => (p ? { ...p, plateOpacityPct: Number(e.target.value) } : p))
                      }
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        fontWeight: 900,
                      }}
                    >
                      {Array.from({ length: 11 }, (_, i) => i * 10).map((n) => (
                        <option key={`plate-op-${n}`} value={String(n)}>
                          {n}%
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>Freeze Frames - Duration: 2.0s</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => insertVideoOverlayFreezeStill('first')}
                    disabled={overlayFreezeInsertBusy}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: overlayFreezeInsertBusy ? 'default' : 'pointer',
                      minWidth: 120,
                    }}
                  >
                    First Frame
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVideoOverlayFreezeStill('last')}
                    disabled={overlayFreezeInsertBusy}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: overlayFreezeInsertBusy ? 'default' : 'pointer',
                      minWidth: 120,
                    }}
                  >
                    Last Frame
                  </button>
                </div>
                {overlayFreezeInsertBusy ? <div style={{ color: '#bbb', fontSize: 12, marginTop: 8 }}>Generating freeze frame…</div> : null}
                {overlayFreezeInsertError ? <div style={{ color: '#ff9b9b', fontSize: 13, marginTop: 8 }}>{overlayFreezeInsertError}</div> : null}
              </div>

              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Audio Boost</div>
                <select
                  value={String(videoOverlayEditor.boostDb)}
                  onChange={(e) => { setVideoOverlayEditorError(null); setVideoOverlayEditor((p) => p ? ({ ...p, boostDb: Number(e.target.value) }) : p) }}
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900 }}
                >
                  <option value="0">None</option>
                  <option value="3">+3 dB</option>
                  <option value="6">+6 dB</option>
                  <option value="9">+9 dB</option>
                </select>
              </label>

              {videoOverlayEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{videoOverlayEditorError}</div> : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { setVideoOverlayEditor(null); setVideoOverlayEditorError(null) }}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveVideoOverlayEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
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
		                <button
		                  type="button"
		                  onClick={() => {
		                    try {
		                      const ret = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`
		                      window.location.href = `/assets/screen-titles?return=${encodeURIComponent(ret)}`
		                    } catch {
		                      window.location.href = '/assets/screen-titles'
		                    }
		                  }}
		                  style={{
		                    color: '#0a84ff',
		                    textDecoration: 'none',
		                    background: 'transparent',
		                    border: 'none',
		                    padding: 0,
		                    cursor: 'pointer',
		                    font: 'inherit',
		                  }}
		                >
		                  Manage Styles
		                </button>
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
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={screenTitleRenderBusy}
                  onClick={generateScreenTitle}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: screenTitleRenderBusy ? 'not-allowed' : 'pointer', opacity: screenTitleRenderBusy ? 0.65 : 1 }}
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
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
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

		                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
		                      <div style={{ color: '#bbb', fontSize: 13, fontWeight: 800 }}>Clip audio</div>
		                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
		                        <input
	                          type="checkbox"
	                          checked={clip ? (clip as any).audioEnabled !== false : true}
	                          disabled={!clip}
	                          onChange={(e) => {
	                            if (!clip) return
	                            const nextEnabled = Boolean(e.target.checked)
	                            snapshotUndo()
	                            setTimeline((prev) => ({
	                              ...prev,
	                              clips: prev.clips.map((c) => (c.id === clipEditor.id ? ({ ...c, audioEnabled: nextEnabled } as any) : c)),
	                            }))
	                          }}
	                        />
		                        <span style={{ color: '#fff', fontWeight: 900 }}>{clip && (clip as any).audioEnabled === false ? 'Muted' : 'Enabled'}</span>
		                      </label>
		                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: 10 }}>
                      <div style={{ color: '#bbb', fontSize: 13, fontWeight: 800 }}>Audio Boost</div>
                      <select
                        value={String(clipEditor.boostDb)}
                        onChange={(e) => setClipEditor((p) => (p ? ({ ...p, boostDb: Number(e.target.value) } as any) : p))}
                        style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '8px 10px', fontSize: 14, fontWeight: 900 }}
                      >
                        <option value="0">None</option>
                        <option value="3">+3 dB</option>
                        <option value="6">+6 dB</option>
                        <option value="9">+9 dB</option>
		                      </select>
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
                              border: '1px solid rgba(96,165,250,0.95)',
                              background: 'rgba(96,165,250,0.14)',
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
                              border: '1px solid rgba(96,165,250,0.95)',
                              background: 'rgba(96,165,250,0.14)',
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
            style={{
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
            }}
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
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
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
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
                />
              </label>

		              <label style={{ display: 'grid', gap: 6 }}>
		                <div style={{ color: '#bbb', fontSize: 13 }}>Boost</div>
		                <select
		                  value={String((narrationEditor as any).boostDb)}
		                  onChange={(e) => { setNarrationEditorError(null); setNarrationEditor((p) => p ? ({ ...p, boostDb: Number(e.target.value) }) : p) }}
		                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
		                >
		                  <option value="0">None</option>
		                  <option value="3">+3 dB</option>
		                  <option value="6">+6 dB</option>
		                  <option value="9">+9 dB</option>
		                </select>
		              </label>

	              {narrationEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{narrationEditorError}</div> : null}
	              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
	                <button
	                  type="button"
	                  onClick={saveNarrationEditor}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
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
		              background: (timelineCtxMenu.view || 'main') === 'guidelines' ? 'rgba(48,209,88,0.95)' : '#0756a6',
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
			                <div
			                  style={{
			                    fontSize: 13,
			                    fontWeight: 900,
			                    color: (timelineCtxMenu.view || 'main') === 'guidelines' ? '#0b0b0b' : '#bbb',
			                  }}
			                >
					                  {(timelineCtxMenu.view || 'main') === 'guidelines'
					                    ? 'Actions'
					                    : timelineCtxMenu.kind === 'audioSegment'
					                      ? 'Audio'
					                    : timelineCtxMenu.kind === 'still'
					                      ? 'Freeze Frame'
					                    : timelineCtxMenu.kind === 'videoOverlayStill'
					                      ? 'Overlay Freeze'
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
						                          : timelineCtxMenu.kind === 'videoOverlay'
						                            ? 'Video Overlay'
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
				                        const fitModeRaw = (g as any).fitMode != null ? String((g as any).fitMode) : ''
				                        const fitMode: 'cover_full' | 'contain_transparent' =
				                          fitModeRaw === 'contain_transparent' ? 'contain_transparent' : 'cover_full'
				                        const sizePctWidthRaw = Number((g as any).sizePctWidth)
				                        const sizePctWidth = Number.isFinite(sizePctWidthRaw)
				                          ? Math.round(clamp(sizePctWidthRaw, 10, 100))
				                          : fitMode === 'cover_full'
				                            ? 100
				                            : 70
				                        const posRaw = String((g as any).position || 'middle_center')
				                        const allowedPos = new Set([
				                          'top_left',
				                          'top_center',
				                          'top_right',
				                          'middle_left',
				                          'middle_center',
				                          'middle_right',
				                          'bottom_left',
				                          'bottom_center',
				                          'bottom_right',
				                        ])
				                        const position = (allowedPos.has(posRaw) ? posRaw : 'middle_center') as any
				                        const insetXPxRaw = Number((g as any).insetXPx)
				                        const insetYPxRaw = Number((g as any).insetYPx)
				                        const insetXPx = Math.round(clamp(Number.isFinite(insetXPxRaw) ? insetXPxRaw : 24, 0, 300))
				                        const insetYPx = Math.round(clamp(Number.isFinite(insetYPxRaw) ? insetYPxRaw : 24, 0, 300))
					                        const borderWidthAllowed = new Set([0, 2, 4, 6])
					                        const borderWidthRaw = Number((g as any).borderWidthPx)
					                        const borderWidthPx = (borderWidthAllowed.has(borderWidthRaw) ? borderWidthRaw : 0) as any
					                        const borderColor = String((g as any).borderColor || '#000000')
					                        const fadeRaw = String((g as any).fade || 'none')
					                        const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
					                        const fade = (fadeAllowed.has(fadeRaw) ? fadeRaw : 'none') as any
				                        setSelectedGraphicId(String((g as any).id))
				                        setSelectedClipId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
				                        setGraphicEditor({
				                          id: String((g as any).id),
				                          start: s,
				                          end: e2,
				                          fitMode,
				                          sizePctWidth,
				                          position,
					                          insetXPx,
					                          insetYPx,
					                          borderWidthPx,
					                          borderColor,
					                          fade,
					                        })
					                        setGraphicEditorError(null)
					                      }
                    } else if (timelineCtxMenu.kind === 'logo') {
                      const l = logos.find((ll) => String((ll as any).id) === String(timelineCtxMenu.id)) as any
	                      if (l) {
	                        const s = roundToTenth(Number((l as any).startSeconds || 0))
	                        const e2 = roundToTenth(Number((l as any).endSeconds || 0))
	                        const sizePctWidthRaw = Math.round(Number((l as any).sizePctWidth))
                        const sizeAllowed = new Set([10, 20, 30, 40, 50])
                        const sizePctWidth = sizeAllowed.has(sizePctWidthRaw) ? sizePctWidthRaw : 20
                        const posRaw = String((l as any).position || 'top_left')
                        const posAllowed = new Set([
                          'top_left',
                          'top_center',
                          'top_right',
                          'middle_left',
                          'middle_center',
                          'middle_right',
                          'bottom_left',
                          'bottom_center',
                          'bottom_right',
                        ])
                        const position = (posAllowed.has(posRaw) ? posRaw : 'top_left') as any
	                        const opacityRaw = Number((l as any).opacityPct)
	                        const opacityPct = Math.round(clamp(Number.isFinite(opacityRaw) ? opacityRaw : 100, 0, 100))
	                        const fadeRaw = String((l as any).fade || 'none')
	                        const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
	                        const fade = (fadeAllowed.has(fadeRaw) ? fadeRaw : 'none') as any
	                        const insetXPxRaw = Number((l as any).insetXPx)
	                        const insetYPxRaw = Number((l as any).insetYPx)
	                        const insetXPx = Math.round(clamp(Number.isFinite(insetXPxRaw) ? insetXPxRaw : 24, 0, 300))
	                        const insetYPx = Math.round(clamp(Number.isFinite(insetYPxRaw) ? insetYPxRaw : 24, 0, 300))
	                        const insetMax = Math.max(insetXPx, insetYPx)
	                        const insetPreset = (insetMax <= 75 ? 'small' : insetMax <= 125 ? 'medium' : 'large') as any
	                        setSelectedLogoId(String((l as any).id))
	                        setSelectedClipId(null)
	                        setSelectedGraphicId(null)
	                        setSelectedLowerThirdId(null)
	                        setSelectedScreenTitleId(null)
	                        setSelectedNarrationId(null)
	                        setSelectedStillId(null)
	                        setSelectedAudioId(null)
	                        setLogoEditor({ id: String((l as any).id), start: s, end: e2, sizePctWidth, insetPreset, position, opacityPct, fade })
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
				                        setSelectedVideoOverlayId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
				                        setScreenTitleEditor({ id: String((st as any).id), start: s, end: e2, presetId, text })
				                        setScreenTitleEditorError(null)
				                      }
				                    } else if (timelineCtxMenu.kind === 'videoOverlay') {
				                      const o = videoOverlays.find((oo: any) => String((oo as any).id) === String(timelineCtxMenu.id)) as any
				                      if (o) {
					                        const sizePctWidth = Number((o as any).sizePctWidth || 33)
					                        const position = String((o as any).position || 'top_right') as any
					                        const audioEnabled = Boolean((o as any).audioEnabled)
					                        const boostDb = (o as any).boostDb == null ? 0 : Number((o as any).boostDb)
                              const plateStyle = String((o as any).plateStyle || 'none') as any
                              const plateColor = String((o as any).plateColor || '#000000')
                              const plateOpacityPct = Number((o as any).plateOpacityPct ?? 85)
					                        setSelectedVideoOverlayId(String((o as any).id))
					                        setSelectedVideoOverlayStillId(null)
					                        setSelectedClipId(null)
					                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
					                        setSelectedNarrationId(null)
					                        setSelectedStillId(null)
					                        setSelectedAudioId(null)
					                        setVideoOverlayEditor({
                              id: String((o as any).id),
                              sizePctWidth,
                              position,
                              audioEnabled,
                              boostDb,
                              plateStyle,
                              plateColor,
                              plateOpacityPct,
                            })
					                        setVideoOverlayEditorError(null)
					                      }
				                    } else if (timelineCtxMenu.kind === 'videoOverlayStill') {
				                      const s0 = (videoOverlayStills as any[]).find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
				                      if (s0) {
				                        const s = roundToTenth(Number((s0 as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((s0 as any).endSeconds || 0))
				                        setSelectedVideoOverlayStillId(String((s0 as any).id))
				                        setSelectedVideoOverlayId(null)
				                        setSelectedClipId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
				                        setVideoOverlayStillEditor({ id: String((s0 as any).id), start: s, end: e2 })
				                        setVideoOverlayStillEditorError(null)
				                      }
				                    } else if (timelineCtxMenu.kind === 'still') {
				                      const s0 = stills.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
				                      if (s0) {
				                        const s = roundToTenth(Number((s0 as any).startSeconds || 0))
				                        const e2 = roundToTenth(Number((s0 as any).endSeconds || 0))
				                        setSelectedStillId(String((s0 as any).id))
				                        setSelectedClipId(null)
				                        setSelectedVideoOverlayId(null)
				                        setSelectedVideoOverlayStillId(null)
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
				                        setSelectedVideoOverlayId(null)
				                        setSelectedVideoOverlayStillId(null)
				                        setSelectedGraphicId(null)
				                        setSelectedLogoId(null)
				                        setSelectedLowerThirdId(null)
				                        setSelectedScreenTitleId(null)
				                        setSelectedNarrationId(null)
				                        setSelectedStillId(null)
				                        setSelectedAudioId(null)
					                        setClipEditor({
					                          id: clip.id,
					                          start: clip.sourceStartSeconds,
					                          end: clip.sourceEndSeconds,
					                          boostDb: (clip as any).boostDb == null ? 0 : Number((clip as any).boostDb),
					                        })
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
				                        setSelectedVideoOverlayId(null)
				                        setSelectedVideoOverlayStillId(null)
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
					                          boostDb:
					                            (n as any).boostDb != null && Number.isFinite(Number((n as any).boostDb))
					                              ? Number((n as any).boostDb)
					                              : (n as any).gainDb == null
					                                ? 0
					                                : Number((n as any).gainDb),
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
					                        setSelectedVideoOverlayId(null)
					                        setSelectedVideoOverlayStillId(null)
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
						                          audioConfigId: (seg as any).audioConfigId == null ? 0 : Number((seg as any).audioConfigId),
						                          musicMode: (seg as any).musicMode == null ? '' : (String((seg as any).musicMode) as any),
						                          musicLevel: (seg as any).musicLevel == null ? '' : (String((seg as any).musicLevel) as any),
						                          duckingIntensity: (seg as any).duckingIntensity == null ? '' : (String((seg as any).duckingIntensity) as any),
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
                        {timelineCtxMenu.kind === 'clip' || timelineCtxMenu.kind === 'videoOverlay' || timelineCtxMenu.kind === 'narration' ? (
                          <button
                            type="button"
                            onClick={() => {
                              snapshotUndo()
                              setTimeline((prev) => {
                                if (timelineCtxMenu.kind === 'clip') {
                                  const prevClips: any[] = Array.isArray((prev as any).clips) ? ((prev as any).clips as any[]) : []
                                  const idx = prevClips.findIndex((c: any) => String(c?.id) === String(timelineCtxMenu.id))
                                  if (idx < 0) return prev
                                  const cur = prevClips[idx]
                                  const nextEnabled = cur?.audioEnabled === false
                                  const nextClips = prevClips.slice()
                                  nextClips[idx] = { ...(cur as any), audioEnabled: nextEnabled }
                                  return { ...(prev as any), clips: nextClips } as any
                                }
                                if (timelineCtxMenu.kind === 'videoOverlay') {
                                  const prevVos: any[] = Array.isArray((prev as any).videoOverlays) ? ((prev as any).videoOverlays as any[]) : []
                                  const idx = prevVos.findIndex((o: any) => String(o?.id) === String(timelineCtxMenu.id))
                                  if (idx < 0) return prev
                                  const cur = prevVos[idx]
                                  const nextEnabled = !(cur?.audioEnabled === true)
                                  const next = prevVos.slice()
                                  next[idx] = { ...(cur as any), audioEnabled: nextEnabled }
                                  return { ...(prev as any), videoOverlays: next } as any
                                }
                                if (timelineCtxMenu.kind === 'narration') {
                                  const prevNs: any[] = Array.isArray((prev as any).narration) ? ((prev as any).narration as any[]) : []
                                  const idx = prevNs.findIndex((n: any) => String(n?.id) === String(timelineCtxMenu.id))
                                  if (idx < 0) return prev
                                  const cur = prevNs[idx]
                                  const nextEnabled = cur?.audioEnabled === false
                                  const next = prevNs.slice()
                                  next[idx] = { ...(cur as any), audioEnabled: nextEnabled }
                                  return { ...(prev as any), narration: next } as any
                                }
                                return prev
                              })
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
                            {(() => {
                              const enabled =
                                timelineCtxMenu.kind === 'clip'
                                  ? (timeline.clips.find((c) => String((c as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled !== false
                                  : timelineCtxMenu.kind === 'videoOverlay'
                                    ? Boolean(
                                        (videoOverlays.find((o: any) => String((o as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled
                                      )
                                    : (narration.find((n: any) => String((n as any).id) === String(timelineCtxMenu.id)) as any)?.audioEnabled !== false
                              return (
                                <>
                                  <span style={{ color: '#bbb', fontWeight: 900 }}>Audio: </span>
                                  <span style={{ color: enabled ? '#30d158' : '#ff453a', fontWeight: 900 }}>{enabled ? 'On' : 'Off'}</span>
                                </>
                              )
                            })()}
                          </button>
                        ) : null}
                        {timelineCtxMenu.kind === 'screenTitle' ? (
                          <button
                            type="button"
                            onClick={() => {
                              const st = screenTitles.find((ss: any) => String((ss as any).id) === String(timelineCtxMenu.id)) as any
                              const presetId = Number((st as any)?.presetId || 0)
                              if (!Number.isFinite(presetId) || presetId <= 0) return
                              try {
                                const base = new URL(window.location.href)
                                base.searchParams.set('cvScreenTitleId', String((st as any).id))
                                base.searchParams.set('cvRefreshScreenTitlePresetId', String(presetId))
                                const from = `${base.pathname}${base.search}${base.hash || ''}`
                                window.location.href = `/assets/screen-titles/${encodeURIComponent(String(presetId))}/edit?return=${encodeURIComponent(from)}`
                              } catch {}
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
                            Edit Style
                          </button>
                        ) : null}
			                <button
			                  type="button"
				                  onClick={() => {
					                    if (timelineCtxMenu.kind === 'graphic') splitGraphicById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'still') splitStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlayStill') splitVideoOverlayStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'logo') splitLogoById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'lowerThird') splitLowerThirdById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'screenTitle') splitScreenTitleById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlay') splitVideoOverlayById(timelineCtxMenu.id)
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
					                    if (timelineCtxMenu.kind === 'videoOverlayStill') duplicateVideoOverlayStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'logo') duplicateLogoById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'lowerThird') duplicateLowerThirdById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'screenTitle') duplicateScreenTitleById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlay') duplicateVideoOverlayById(timelineCtxMenu.id)
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
					                    if (timelineCtxMenu.kind === 'videoOverlayStill') deleteVideoOverlayStillById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'logo') deleteLogoById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'lowerThird') deleteLowerThirdById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'screenTitle') deleteScreenTitleById(timelineCtxMenu.id)
					                    if (timelineCtxMenu.kind === 'videoOverlay') deleteVideoOverlayById(timelineCtxMenu.id)
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
			                  const playheadGuidelinesOverride = [roundToTenth(playhead)]
			                  return (
			                    <>
			                      <div style={{ fontSize: 12, fontWeight: 900, color: '#0b0b0b', padding: '2px 2px 0' }}>Guidelines</div>
			                      <button
			                        type="button"
						                        onClick={() => {
						                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, expandAction as any, { edgeIntent })
						                          setTimelineCtxMenu(null)
						                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(212,175,55,0.92)',
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
						                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, contractAction as any, { edgeIntent })
						                          setTimelineCtxMenu(null)
						                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(212,175,55,0.92)',
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
						                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, 'snap', { edgeIntent })
						                          setTimelineCtxMenu(null)
						                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(212,175,55,0.92)',
			                          background: '#000',
			                          color: '#fff',
			                          fontWeight: 900,
			                          cursor: 'pointer',
			                          textAlign: 'left',
			                        }}
			                      >
			                        {snapLabel}
			                      </button>

			                      <div style={{ fontSize: 12, fontWeight: 900, color: '#0b0b0b', padding: '2px 2px 0', marginTop: 6 }}>
			                        Playhead
			                      </div>
			                      <button
			                        type="button"
				                        onClick={() => {
				                          const opts: GuidelineActionOpts = { edgeIntent, guidelinesOverride: playheadGuidelinesOverride, noopIfNoCandidate: true }
				                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, expandAction as any, opts)
				                          setTimelineCtxMenu(null)
				                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(255,59,48,0.92)',
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
				                          const opts: GuidelineActionOpts = { edgeIntent, guidelinesOverride: playheadGuidelinesOverride, noopIfNoCandidate: true }
				                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, contractAction as any, opts)
				                          setTimelineCtxMenu(null)
				                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(255,59,48,0.92)',
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
				                          const opts: GuidelineActionOpts = { edgeIntent, guidelinesOverride: playheadGuidelinesOverride, noopIfNoCandidate: true }
				                          if (timelineCtxMenu.kind === 'graphic') applyGraphicGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'still') applyStillGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'videoOverlayStill') applyVideoOverlayStillGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'logo') applyLogoGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'lowerThird') applyLowerThirdGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'screenTitle') applyScreenTitleGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'videoOverlay') applyVideoOverlayGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'clip') applyClipGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'narration') applyNarrationGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          if (timelineCtxMenu.kind === 'audioSegment') applyAudioSegmentGuidelineAction(timelineCtxMenu.id, 'snap', opts)
				                          setTimelineCtxMenu(null)
				                        }}
			                        style={{
			                          width: '100%',
			                          padding: '10px 12px',
			                          borderRadius: 10,
			                          border: '2px solid rgba(255,59,48,0.92)',
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

        {/* Timelines picker moved to `/timelines`.
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: '#000',
              zIndex: 5200,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
            }}
            onClick={() => setProjectPickerOpen(false)}
          >
            <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#000', padding: '6px 0 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setProjectPickerOpen(false)}
                    style={{ color: '#0a84ff', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14 }}
                  >
                    ← Close
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 22 }}>Timelines</h2>
                  <button
                    type="button"
                    onClick={openCreateProject}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(10,132,255,0.55)',
                      background: '#0a84ff',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    New
                  </button>
                </div>
                {projectPickerError ? <div style={{ color: '#ff9b9b', marginTop: 8 }}>{projectPickerError}</div> : null}
              </div>

              {projectPickerLoading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}

	              <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
	                {projectPickerItems.map((p) => {
	                  const isActive = String((p as any)?.status || '') === 'active'
		                  const isCurrent = Number(project?.id || 0) === Number(p.id)
	                  return (
	                    <div
	                      key={p.id}
	                      style={{
	                        border: isCurrent ? '1px solid rgba(10,132,255,0.75)' : '1px solid rgba(255,255,255,0.14)',
	                        background: 'rgba(255,255,255,0.04)',
	                        borderRadius: 12,
	                        padding: 12,
	                      }}
	                    >
	                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 92 }}>
	                        <div style={{ minWidth: 0 }}>
	                          <div style={{ fontWeight: 900, color: isActive ? '#fff' : '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
	                            {p.name && String(p.name).trim() ? String(p.name) : `Untitled #${p.id}`}
	                          </div>
		                          <div style={{ color: '#9a9a9a', fontSize: 13, marginTop: 4 }}>
		                            {String(p.updatedAt || p.createdAt || '').slice(0, 10)}
		                          </div>
	                        </div>
	                        <div
	                          style={{
	                            display: 'flex',
	                            gap: 8,
	                            flexWrap: 'nowrap',
	                            justifyContent: 'flex-end',
	                            alignItems: 'center',
	                            marginTop: 'auto',
	                            overflowX: 'auto',
	                            WebkitOverflowScrolling: 'touch',
	                          }}
	                        >
	                          <button
	                            type="button"
	                            onClick={() => openProject(p.id)}
	                            style={{
	                              padding: '8px 10px',
	                              borderRadius: 10,
	                              border: '1px solid rgba(10,132,255,0.55)',
	                              background: '#0a84ff',
	                              color: '#fff',
	                              fontWeight: 900,
	                              whiteSpace: 'nowrap',
	                              cursor: 'pointer',
	                            }}
	                          >
	                            Open
	                          </button>
	                          <button
	                            type="button"
	                            onClick={() => openEditProjectFromPicker(p.id)}
	                            style={{
	                              padding: '8px 10px',
	                              borderRadius: 10,
	                              border: '1px solid rgba(255,255,255,0.18)',
	                              background: '#0c0c0c',
	                              color: '#fff',
	                              fontWeight: 900,
	                              whiteSpace: 'nowrap',
	                              cursor: 'pointer',
	                            }}
	                          >
	                            Edit
	                          </button>
	                          <button
	                            type="button"
	                            onClick={() => deleteProjectFromPicker(p.id)}
	                            style={{
	                              padding: '8px 10px',
	                              borderRadius: 10,
	                              border: '1px solid rgba(255,155,155,0.40)',
	                              background: 'rgba(255,0,0,0.14)',
	                              color: '#fff',
	                              fontWeight: 900,
	                              whiteSpace: 'nowrap',
	                              cursor: 'pointer',
	                            }}
	                          >
	                            Delete
	                          </button>
	                        </div>
	                      </div>
	                    </div>
	                  )
	                })}
	              </div>

              {projectCreateOpen ? (
                <div
                  role="dialog"
                  aria-modal="true"
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.6)',
                    zIndex: 5300,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
                    paddingRight: 'calc(env(safe-area-inset-right, 0px) + 16px)',
                    paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                    paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 16px)',
                  }}
                  onClick={() => setProjectCreateOpen(false)}
                >
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 520,
                      borderRadius: 16,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: 'linear-gradient(180deg, rgba(64,200,255,0.14) 0%, rgba(64,200,255,0.06) 100%), #0b0b0b',
                      padding: 14,
                      color: '#fff',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>New Timeline</div>
                      <button
                        type="button"
                        onClick={() => setProjectCreateOpen(false)}
                        style={{
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'rgba(255,255,255,0.06)',
                          color: '#fff',
                          borderRadius: 10,
                          padding: '6px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>

                    <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Name</div>
                        <input
                          value={projectCreateName}
                          onChange={(e) => setProjectCreateName(e.target.value)}
                          onFocus={() => {
                            if (projectCreateName === projectCreateDefaultName) setProjectCreateName('')
                          }}
                          onBlur={() => {
                            if (!String(projectCreateName || '').trim()) setProjectCreateName(projectCreateDefaultName)
                          }}
                          placeholder={projectCreateDefaultName}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.16)',
                            background: '#050505',
                            color: '#fff',
                            fontWeight: 800,
                          }}
                        />
                      </div>

                      <div>
                        <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Description (optional)</div>
                        <textarea
                          value={projectCreateDescription}
                          onChange={(e) => setProjectCreateDescription(e.target.value)}
                          placeholder="Description…"
                          rows={4}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.16)',
                            background: '#050505',
                            color: '#fff',
                            resize: 'vertical',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const nameRaw = String(projectCreateName || '').trim()
                          const descriptionRaw = String(projectCreateDescription || '').trim()
                          const name = nameRaw || projectCreateDefaultName
                          setProjectCreateOpen(false)
                          void createNewProjectAndReload({ name, description: descriptionRaw || null })
                        }}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 12,
                          border: '1px solid rgba(10,132,255,0.55)',
                          background: '#0a84ff',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        Create
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {projectEditOpen ? (
                <div
                  role="dialog"
                  aria-modal="true"
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.6)',
                    zIndex: 5300,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
                    paddingRight: 'calc(env(safe-area-inset-right, 0px) + 16px)',
                    paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                    paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 16px)',
                  }}
                  onClick={() => setProjectEditOpen(false)}
                >
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 520,
                      borderRadius: 16,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: 'linear-gradient(180deg, rgba(255,191,0,0.16) 0%, rgba(255,191,0,0.06) 100%), #0b0b0b',
                      padding: 14,
                      color: '#fff',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>Edit Timeline</div>
                      <button
                        type="button"
                        onClick={() => setProjectEditOpen(false)}
                        style={{
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'rgba(255,255,255,0.06)',
                          color: '#fff',
                          borderRadius: 10,
                          padding: '6px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>

                    <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Name</div>
                        <input
                          value={projectEditName}
                          onChange={(e) => setProjectEditName(e.target.value)}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.16)',
                            background: '#050505',
                            color: '#fff',
                            fontWeight: 800,
                          }}
                        />
                      </div>

                      <div>
                        <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Description (optional)</div>
                        <textarea
                          value={projectEditDescription}
                          onChange={(e) => setProjectEditDescription(e.target.value)}
                          placeholder="Description…"
                          rows={4}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.16)',
                            background: '#050505',
                            color: '#fff',
                            resize: 'vertical',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => void saveEditProjectFromPicker()}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 12,
                          border: '1px solid rgba(10,132,255,0.55)',
                          background: '#0a84ff',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        */}

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
