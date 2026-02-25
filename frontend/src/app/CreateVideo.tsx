import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX,
  SCREEN_TITLE_PLACEMENT_MIN_H_PCT,
  SCREEN_TITLE_PLACEMENT_MIN_W_PCT,
  SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT,
  SCREEN_TITLE_SAFE_AREA_LEFT_PCT,
  SCREEN_TITLE_SAFE_AREA_RIGHT_PCT,
  SCREEN_TITLE_SAFE_AREA_TOP_PCT,
  applyScreenTitleCustomStyle,
  applyScreenTitlePlacementDrag,
  buildScreenTitlePresetOverride,
  buildScreenTitlePresetSnapshot,
  clamp01,
  defaultScreenTitlePlacementRect,
  easeInCubic,
  easeOutCubic,
  isSameScreenTitlePlacementRect,
  normalizeScreenTitleCustomStyleForSave,
  normalizeScreenTitlePlacementRect,
  normalizeScreenTitlePlacementRectForEditor,
  normalizeSpeedPresetMs,
  screenTitleMarginPctToPx,
  screenTitleMarginPxToPct,
} from './createVideo/screenTitleHelpers'
import {
  computeFadeAlpha,
  computeOverlayCssNoOpacity,
  computeSegmentTimingWindow,
  ellipsizeText,
  maybePromoteLowerThirdTimingOnExpand,
  normalizeLegacyPosition,
  roundRect,
} from './createVideo/overlayHelpers'
import { migrateLegacyAudioTrackToSegments, migrateLegacyClipFreezeTimeline } from './createVideo/timelineMigrations'
import { normalizeScreenTitleSizeKey, resolveScreenTitleSizePresetForUi, SCREEN_TITLE_SIZE_OPTIONS } from './screenTitleSizeScale'

const UNDO_ICON_URL = new URL('./icons/undo.svg', import.meta.url).toString()
const REDO_ICON_URL = new URL('./icons/redo.svg', import.meta.url).toString()
const PLUS_ICON_URL = new URL('./icons/plus.svg', import.meta.url).toString()
const RIPPLE_ICON_URL = new URL('./icons/ripple.svg', import.meta.url).toString()
const FLOAT_ICON_URL = new URL('./icons/float.svg', import.meta.url).toString()
const EXPAND_ICON_URL = new URL('./icons/expand.svg', import.meta.url).toString()
const ACTION_ARROW_ICON_URL = new URL('./icons/arrow.svg', import.meta.url).toString()
const AUDIO_ON_ICON_URL = new URL('./icons/audio-on.svg', import.meta.url).toString()
const AUDIO_OFF_ICON_URL = new URL('./icons/audio-off.svg', import.meta.url).toString()
const VIDEO_ON_ICON_URL = new URL('./icons/video-on.svg', import.meta.url).toString()
const VIDEO_OFF_ICON_URL = new URL('./icons/video-off.svg', import.meta.url).toString()
const LazyEditorModalHost = React.lazy(() => import('./createVideo/modals/EditorModalHost'))
const LazyScreenTitleQuickPanelOverlay = React.lazy(() => import('./createVideo/modals/ScreenTitleQuickPanelOverlay'))
const LazyTimelineContextMenu = React.lazy(() => import('./createVideo/modals/TimelineContextMenu'))
const LazyGuidelineMenuModal = React.lazy(() => import('./createVideo/modals/GuidelineMenuModal'))
const LazyPreviewFloatingToolbar = React.lazy(() => import('./createVideo/modals/PreviewFloatingToolbar'))
const SCREEN_TITLE_STYLE_PANEL_WIDTH_PX = 244
const SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX = SCREEN_TITLE_STYLE_PANEL_WIDTH_PX
const SCREEN_TITLE_PLACEMENT_COL_GAP_PX = 10
const SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX = Math.floor(
  (SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX - 24 - SCREEN_TITLE_PLACEMENT_COL_GAP_PX) / 2
)
const SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX = 7
const SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX = Math.floor(
  (SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX - SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX) / 2
)
const SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX = SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX
const SCREEN_TITLE_PLACEMENT_ACTION_BUTTON_WIDTH_PX = SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX
const TIMELINE_ZOOM_MIN = 0.25
const TIMELINE_ZOOM_MAX = 2
const TIMELINE_ZOOM_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
// [cv-shell] shared DTOs and editor-local types; safe to move into dedicated type modules first.
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

type LaneKey = 'graphics' | 'logo' | 'lowerThird' | 'screenTitle' | 'videoOverlay' | 'video' | 'narration' | 'audio'
type PreviewAudioLaneKey = 'video' | 'videoOverlay' | 'narration' | 'audio'
type PreviewVideoLaneKey = 'video' | 'videoOverlay'

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

type ScreenTitleFontFamily = {
  familyKey: string
  label: string
  variants: Array<{ key: string; label: string }>
}

type ScreenTitleFontPresetsResponse = {
  families: Record<
    string,
    {
      sizes: Record<string, { fontSizePct: number; trackingPct: number; lineSpacingPct: number }>
      variants?: Record<string, { sizes?: Record<string, { fontSizePct: number; trackingPct: number; lineSpacingPct: number }> }>
    }
  >
}

type ScreenTitlePlacementRect = { xPct: number; yPct: number; wPct: number; hPct: number }

type ScreenTitleCustomStyleDraft = {
  position?: 'top' | 'middle' | 'bottom'
  alignment?: 'left' | 'center' | 'right'
  marginXPx?: number
  marginYPx?: number
  offsetXPx?: number
  offsetYPx?: number
  placementRect?: ScreenTitlePlacementRect | null
  fontKey?: string
  fontSizePct?: number
  fontColor?: string
  fontGradientKey?: string | null
}

type ScreenTitleInstanceDraft = {
  id: string
  text: string
  customStyle: ScreenTitleCustomStyleDraft | null
}

type TimelineCtxKind =
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

const normalizeHexColor = (raw: any, fallback = '#000000'): string => {
  const s = String(raw == null ? fallback : raw).trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(s)) return fallback
  return s.startsWith('#') ? s : `#${s}`
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

// [cv-shell helpers] helper/migration/math section; first extraction target for Phase B.
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

// [cv-shell host] CreateVideo currently owns all state wiring and composition boundaries.
export default function CreateVideo() {
  // [cv-shell] global project/timeline/editor state ownership stays here during Phase B extraction.
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [timeline, setTimeline] = useState<Timeline>({
    version: 'create_video_v1',
    playheadSeconds: 0,
    timelineBackgroundMode: 'none',
    timelineBackgroundColor: '#000000',
    timelineBackgroundUploadId: null,
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
  const [clipEditor, setClipEditor] = useState<{
    id: string
    start: number
    end: number
    boostDb: number
    bgFillStyle: 'none' | 'blur' | 'color' | 'image'
    bgFillBrightness: 'light3' | 'light2' | 'light1' | 'neutral' | 'dim1' | 'dim2' | 'dim3'
    bgFillBlur: 'soft' | 'medium' | 'strong' | 'very_strong'
    bgFillColor: string
    bgFillImageUploadId: number | null
  } | null>(null)
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
    mode: 'full' | 'positioned' | 'animated'
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
    fadeDurationMs: number
    animate: 'none' | 'slide_in' | 'slide_out' | 'slide_in_out' | 'doc_reveal'
    animateDurationMs: number
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
  const [screenTitleFontFamilies, setScreenTitleFontFamilies] = useState<ScreenTitleFontFamily[]>([])
  const [screenTitleFontPresets, setScreenTitleFontPresets] = useState<ScreenTitleFontPresetsResponse | null>(null)
  const [screenTitleFontsLoaded, setScreenTitleFontsLoaded] = useState(false)
  const [screenTitleGradients, setScreenTitleGradients] = useState<Array<{ key: string; label: string }>>([])
  const [screenTitleGradientsLoaded, setScreenTitleGradientsLoaded] = useState(false)
  const [screenTitleEditor, setScreenTitleEditor] = useState<{ id: string; start: number; end: number } | null>(null)
  const [screenTitleEditorError, setScreenTitleEditorError] = useState<string | null>(null)
  const [screenTitleCustomizeEditor, setScreenTitleCustomizeEditor] = useState<{
    id: string
    presetId: number | null
    instances: ScreenTitleInstanceDraft[]
    activeInstanceId: string
  } | null>(null)
  const [screenTitleCustomizeError, setScreenTitleCustomizeError] = useState<string | null>(null)
  const [screenTitlePlacementEditor, setScreenTitlePlacementEditor] = useState<{
    id: string
    presetId: number | null
    instances: ScreenTitleInstanceDraft[]
    activeInstanceId: string
  } | null>(null)
  const [screenTitleMiniPanelTab, setScreenTitleMiniPanelTab] = useState<'style' | 'placement'>('placement')
  const [screenTitleStyleAlignMenuOpen, setScreenTitleStyleAlignMenuOpen] = useState(false)
  const [screenTitlePlacementError, setScreenTitlePlacementError] = useState<string | null>(null)
  const [screenTitlePlacementAdvancedOpen, setScreenTitlePlacementAdvancedOpen] = useState(false)
  const [screenTitlePlacementControlMode, setScreenTitlePlacementControlMode] = useState<'move' | 'left' | 'right' | 'top' | 'bottom'>('move')
  const [screenTitlePlacementMoveAxis, setScreenTitlePlacementMoveAxis] = useState<'vertical' | 'horizontal'>('vertical')
  const [screenTitlePlacementStepPx, setScreenTitlePlacementStepPx] = useState<1 | 5>(1)
  const [screenTitlePlacementPanelPos, setScreenTitlePlacementPanelPos] = useState<{ x: number; y: number }>({ x: 8, y: 126 })
  const [screenTitlePlacementDirty, setScreenTitlePlacementDirty] = useState(false)
  const [screenTitleLastInstanceById, setScreenTitleLastInstanceById] = useState<Record<string, string>>({})
  const [screenTitleRenderBusy, setScreenTitleRenderBusy] = useState(false)
  const screenTitleTextAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const screenTitlePlacementStageRef = useRef<HTMLDivElement | null>(null)
  const screenTitlePlacementPanelRef = useRef<HTMLDivElement | null>(null)
  const screenTitleStyleAlignMenuRef = useRef<HTMLDivElement | null>(null)
  const screenTitlePlacementDragRef = useRef<{
    mode: 'move' | 'left' | 'right' | 'top' | 'bottom'
    startClientX: number
    startClientY: number
    stageW: number
    stageH: number
    baseRect: ScreenTitlePlacementRect
  } | null>(null)
  const screenTitlePlacementStopDragRef = useRef<(() => void) | null>(null)
  const screenTitlePlacementPanelDragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    baseX: number
    baseY: number
  } | null>(null)
  const screenTitlePlacementPanelStopDragRef = useRef<(() => void) | null>(null)
  const screenTitleNudgeRepeatRef = useRef<{
    pointerId: number | null
    timeoutId: number | null
    intervalId: number | null
    repeating: boolean
    active: boolean
  }>({ pointerId: null, timeoutId: null, intervalId: null, repeating: false, active: false })
  const saveScreenTitlePlacementRef = useRef<(closeEditorOnSuccess?: boolean) => Promise<void>>(async () => {})
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
  const iconScratchRef = useRef<HTMLCanvasElement | null>(null)
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [audioPreviewPlayingId, setAudioPreviewPlayingId] = useState<number | null>(null)
  const [audioConfigs, setAudioConfigs] = useState<AudioConfigItem[]>([])
  const [audioConfigsLoaded, setAudioConfigsLoaded] = useState(false)
  const [audioConfigsError, setAudioConfigsError] = useState<string | null>(null)
  const [previewAudioLaneEnabled, setPreviewAudioLaneEnabled] = useState<Record<PreviewAudioLaneKey, boolean>>({
    video: true,
    videoOverlay: true,
    narration: true,
    audio: true,
  })
  const [previewVideoLaneEnabled, setPreviewVideoLaneEnabled] = useState<Record<PreviewVideoLaneKey, boolean>>({
    video: true,
    videoOverlay: true,
  })
  const [audioEditor, setAudioEditor] = useState<{
    id: string
    start: number
    end: number
    audioConfigId: number
    audioEnabled: boolean
    musicMode: '' | 'opener_cutoff' | 'replace' | 'mix' | 'mix_duck'
    musicLevel: '' | 'quiet' | 'medium' | 'loud'
    duckingIntensity: '' | 'min' | 'medium' | 'max'
  } | null>(null)
  const [audioEditorError, setAudioEditorError] = useState<string | null>(null)
  const [narrationEditor, setNarrationEditor] = useState<{ id: string; start: number; end: number; boostDb: number } | null>(null)
  const [narrationEditorError, setNarrationEditorError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const bgVideoRef = useRef<HTMLVideoElement | null>(null)
  const overlayVideoRef = useRef<HTMLVideoElement | null>(null)
  const [previewObjectFit, setPreviewObjectFit] = useState<'cover' | 'contain'>('cover')
  const [baseVideoDims, setBaseVideoDims] = useState<{ w: number; h: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [previewMotionSource, setPreviewMotionSource] = useState<'video' | 'videoOverlay'>('video')
  const [activeUploadId, setActiveUploadId] = useState<number | null>(null)
  const [overlayActiveUploadId, setOverlayActiveUploadId] = useState<number | null>(null)
  // Tracks which upload ID is currently loaded into each <video> element's src, even if we temporarily
  // hide it by setting activeUploadId=null (e.g. while showing a freeze-frame still overlay).
  // This helps iOS Safari: if we can avoid an async src swap, we can seek + play within the user gesture.
  const baseLoadedUploadIdRef = useRef<number | null>(null)
  const bgLoadedUploadIdRef = useRef<number | null>(null)
  const overlayLoadedUploadIdRef = useRef<number | null>(null)
  const playbackClockRef = useRef<'base' | 'overlay' | 'synthetic'>('base')
  const playheadRef = useRef(0)
  const playingRef = useRef(false)
  const [previewPlayhead, setPreviewPlayhead] = useState(0)
  const previewPlayheadRef = useRef(0)
  const activeClipIndexRef = useRef(0)
  const syntheticStillIdRef = useRef<string>('')
  const syntheticOverlayStillIdRef = useRef<string>('')
  const playheadFromVideoRef = useRef(false)
  const suppressNextVideoPauseRef = useRef(false)
  const gapPlaybackRef = useRef<{ raf: number; target: number; nextClipIndex: number | null } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exportJobId, setExportJobId] = useState<number | null>(null)
  const [timelineMessage, setTimelineMessage] = useState<string | null>(null)
  const [timelineErrorModal, setTimelineErrorModal] = useState<string | null>(null)
  const [guidelineMenuOpen, setGuidelineMenuOpen] = useState(false)
  const guidelinePressRef = useRef<{ timer: number | null; fired: boolean } | null>(null)
  const [guidelineFlash, setGuidelineFlash] = useState<{ t: number; at: number } | null>(null)
  const guidelineFlashTimerRef = useRef<number | null>(null)
  const timelineCtxMenuOpenedAtRef = useRef<number | null>(null)
  const timelineCtxSnapTargetRef = useRef<'timeline' | 'guideline' | 'object_lane' | 'object_any'>('guideline')
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
  const scrubberDragRef = useRef<
    | null
    | {
        pointerId: number
        startX: number
        startScrollLeft: number
        maxLeft: number
        scrollRange: number
      }
  >(null)
  const [scrubberDragging, setScrubberDragging] = useState(false)
  const [timelineCtxMenu, setTimelineCtxMenu] = useState<
    | null
    | {
        kind: TimelineCtxKind
        id: string
        x: number
        y: number
        view?: 'main' | 'guidelines' | 'screenTitlePlacementPick'
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
  const bodyHoldRef = useRef<null | { timer: number; pointerId: number; startX: number; startY: number }>(null)
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
  const [showEmptyLanes, setShowEmptyLanes] = useState(false)
  const [timelineZoom, setTimelineZoom] = useState(1)
  const setTimelineZoomValue = useCallback((next: number) => {
    setTimelineZoom(clamp(Math.round(next * 100) / 100, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX))
  }, [])
  const timelineZoomLabel = useMemo(() => `${Math.round(timelineZoom * 100)}%`, [timelineZoom])
  const [showTimelineZoomMenu, setShowTimelineZoomMenu] = useState(false)
  const timelineZoomMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!showTimelineZoomMenu) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (timelineZoomMenuRef.current && timelineZoomMenuRef.current.contains(target)) return
      setShowTimelineZoomMenu(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [showTimelineZoomMenu])
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
  const timelineZoomRef = useRef(timelineZoom)
  const primedFrameSrcRef = useRef<string>('')
  const primedOverlayFrameSrcRef = useRef<string>('')
  const [posterByUploadId, setPosterByUploadId] = useState<Record<number, string>>({})
  const iconImagesRef = useRef<{
    audioOn?: HTMLImageElement
    audioOff?: HTMLImageElement
    videoOn?: HTMLImageElement
    videoOff?: HTMLImageElement
  }>({})
  const [iconReadyTick, setIconReadyTick] = useState(0)
  const [graphicFileUrlByUploadId, setGraphicFileUrlByUploadId] = useState<Record<number, string>>({})
  const [audioEnvelopeByUploadId, setAudioEnvelopeByUploadId] = useState<Record<number, any>>({})
  const [audioEnvelopeStatusByUploadId, setAudioEnvelopeStatusByUploadId] = useState<Record<number, 'idle' | 'pending' | 'ready' | 'error'>>({})
  const [audioEnvelopeErrorByUploadId, setAudioEnvelopeErrorByUploadId] = useState<Record<number, string>>({})
  const audioEnvelopePollTimerRef = useRef<Record<number, number>>({})
  const activePoster = useMemo(() => {
    if (!activeUploadId) return null
    return posterByUploadId[activeUploadId] || null
  }, [activeUploadId, posterByUploadId])
  const baseMotionPoster = useMemo(() => {
    if (!activeUploadId) return null
    return posterByUploadId[activeUploadId] || `/api/uploads/${encodeURIComponent(String(activeUploadId))}/thumb`
  }, [activeUploadId, posterByUploadId])

  useEffect(() => {
    let alive = true
    const load = (key: 'audioOn' | 'audioOff' | 'videoOn' | 'videoOff', url: string) => {
      if (iconImagesRef.current[key]) return
      const img = new Image()
      img.onload = () => {
        if (!alive) return
        iconImagesRef.current[key] = img
        setIconReadyTick((v) => v + 1)
      }
      img.onerror = () => {
        if (!alive) return
        iconImagesRef.current[key] = img
        setIconReadyTick((v) => v + 1)
      }
      img.src = url
    }
    load('audioOn', AUDIO_ON_ICON_URL)
    load('audioOff', AUDIO_OFF_ICON_URL)
    load('videoOn', VIDEO_ON_ICON_URL)
    load('videoOff', VIDEO_OFF_ICON_URL)
    return () => {
      alive = false
    }
  }, [])

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
      const min = Math.floor(-barH)
      const max = Math.max(min, Math.floor(h))
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
  const openTimelineCtxMenuForEdge = useCallback(
    (kind: TimelineCtxKind, id: string, edgeIntent: 'move' | 'start' | 'end') => {
      const readHeaderPx = () => {
        if (typeof window === 'undefined') return 44
        const headerEl = document.querySelector('[class*="sharedNav_container__"]') as HTMLElement | null
        if (headerEl) {
          const rect = headerEl.getBoundingClientRect()
          if (rect.height > 0) return rect.height
        }
        try {
          const probe = document.createElement('div')
          probe.style.position = 'fixed'
          probe.style.visibility = 'hidden'
          probe.style.height = 'var(--header-h, 44px)'
          document.body.appendChild(probe)
          const h = probe.getBoundingClientRect().height
          probe.remove()
          if (h > 0) return h
        } catch {}
        return 44
      }
      const w = window.innerWidth || 0
      const h = window.innerHeight || 0
      const menuW = 170
      const menuH = 188
      const pad = 10
      const x = clamp(Math.round((w - menuW) / 2), pad, Math.max(pad, w - menuW - pad))
      const headerPx = readHeaderPx()
      const minY = Math.max(pad, Math.round(headerPx) + 8)
      const maxY = Math.max(minY, h - menuH - pad)
      const y = clamp(minY, minY, maxY)
      timelineCtxMenuOpenedAtRef.current = performance.now()
      setTimelineCtxMenu((prev) => ({
        kind,
        id,
        x: prev?.x ?? x,
        y: prev?.y ?? y,
        view: edgeIntent === 'move' ? 'main' : 'guidelines',
        edgeIntent,
      }))
    },
    [clamp]
  )

  const openTimelineCtxMenu = useCallback(
    (target: { kind: 'graphic' | 'logo'; id: string }, clientX: number, clientY: number) => {
      openTimelineCtxMenuForEdge(target.kind as any, target.id, 'move')
    },
    [openTimelineCtxMenuForEdge]
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
      const min = Math.floor(-barH)
      const max = Math.max(min, Math.floor(h))
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
  useEffect(() => {
    if (!playing) {
      previewPlayheadRef.current = playhead
      setPreviewPlayhead(playhead)
    } else {
      previewPlayheadRef.current = playhead
    }
  }, [playhead, playing])

  useEffect(() => {
    if (!playing) return
    if (!(totalSeconds > 0)) return
    let raf = 0
    let last = performance.now()
    let cur = Number(previewPlayheadRef.current || 0)
    const tick = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      cur = clamp(cur + dt, 0, Math.max(0, totalSeconds))
      const target = Number(playheadRef.current || 0)
      if (Math.abs(target - cur) > 0.2) cur = target
      if (Math.abs(cur - Number(previewPlayheadRef.current || 0)) >= 0.02) {
        previewPlayheadRef.current = cur
        setPreviewPlayhead(cur)
      }
      if (cur >= totalSeconds - 0.001) return
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [playing, totalSeconds])
  const pxPerSecondBase = 48
  const pxPerSecond = pxPerSecondBase * timelineZoom
  const visualTotalSeconds = useMemo(() => Math.max(10, totalSeconds), [totalSeconds])
  const stripContentW = useMemo(() => Math.max(0, Math.ceil(visualTotalSeconds * pxPerSecond)), [pxPerSecond, visualTotalSeconds])
  const RULER_H = 16
  const WAVEFORM_H = 34
  const TRACK_H = 48
  const TRACKS_TOP = RULER_H + WAVEFORM_H
  const LANE_TOP_PAD = 6
  const PILL_H = Math.max(18, TRACK_H - 12)
  const SCRUBBER_H = 24
  const SCRUBBER_MIN_HANDLE_PX = 26
  const HANDLE_HIT_PX = 36
  const pickTrimEdge = (
    clickX: number,
    leftX: number,
    rightX: number,
    nearLeft: boolean,
    nearRight: boolean
  ): 'start' | 'end' => {
    if (nearLeft && nearRight) {
      const handleSize = Math.max(10, Math.min(18, Math.floor(PILL_H - 10)))
      const inset = 6
      const handleW = handleSize * 2
      const leftCenter = leftX + inset + handleW / 2
      const rightCenter = rightX - inset - handleW / 2
      return Math.abs(clickX - leftCenter) <= Math.abs(clickX - rightCenter) ? 'start' : 'end'
    }
    return nearLeft ? 'start' : 'end'
  }

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
      setSelectedScreenTitleId(String((st as any).id))
      setSelectedClipId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      setScreenTitleEditor({ id: String((st as any).id), start: s, end: e2 })
      setScreenTitleEditorError(null)
      return true
    },
    [screenTitles]
  )

  const getDefaultScreenTitlePanelPos = useCallback(
    (panelWidthPx: number, panelHeightPx: number) => {
      const stageRect = screenTitlePlacementStageRef.current?.getBoundingClientRect()
      const previewRect = previewWrapRef.current?.getBoundingClientRect()
      const stageWRaw = Number(stageRect?.width || previewRect?.width || previewBoxSize.w || 0)
      const stageHRaw = Number(stageRect?.height || previewRect?.height || previewBoxSize.h || 0)
      const stageW = stageWRaw > 0 ? stageWRaw : 1080
      const stageH = stageHRaw > 0 ? stageHRaw : 1920
      const panelW = Math.max(1, Number(panelWidthPx || SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX))
      const panelH = Math.max(1, Number(panelHeightPx || 228))
      // Keep at least 25% of the panel visible so it can't be fully lost off-canvas.
      const minX = Math.round(-panelW * 0.75)
      const minY = Math.round(-panelH * 0.75)
      const maxX = Math.round(stageW - panelW * 0.25)
      const maxY = Math.round(stageH - panelH * 0.25)
      const centeredX = Math.round((stageW - panelW) / 2)
      const bottomAnchorY = Math.round(stageH - panelH * 0.25)
      return {
        x: Math.round(clamp(centeredX, minX, maxX)),
        y: Math.round(clamp(bottomAnchorY, minY, maxY)),
      }
    },
    [previewBoxSize.h, previewBoxSize.w]
  )

  const openScreenTitlePlacementById = useCallback(
    (id: string, requestedInstanceId?: string | null): boolean => {
      const st = screenTitles.find((ss: any) => String((ss as any).id) === String(id)) as any
      if (!st) return false
      const presetId = Number((st as any)?.presetId || 0)
      if (!Number.isFinite(presetId) || presetId <= 0) {
        setScreenTitlePlacementError('Pick a screen title style.')
        return false
      }
      setSelectedScreenTitleId(String((st as any).id))
      setSelectedClipId(null)
      setSelectedVideoOverlayId(null)
      setSelectedGraphicId(null)
      setSelectedLogoId(null)
      setSelectedLowerThirdId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
      const rawInstances = Array.isArray((st as any).instances) ? ((st as any).instances as any[]) : []
      const instances =
        rawInstances.length > 0
          ? rawInstances.map((inst: any, idx: number) => ({
              id: String(inst?.id || `${String((st as any).id)}_i${idx + 1}`),
              text: inst?.text == null ? '' : String(inst.text),
              customStyle: inst?.customStyle ? { ...(inst.customStyle as any) } : null,
            }))
          : [
              {
                id: `${String((st as any).id)}_i1`,
                text: String((st as any).text || ''),
                customStyle: (st as any).customStyle ? { ...(st as any).customStyle } : null,
              },
            ]
      const safeInstances = instances.map((inst: any) => ({
        ...inst,
        customStyle: {
          ...(inst.customStyle || {}),
          placementRect: normalizeScreenTitlePlacementRectForEditor((inst.customStyle as any)?.placementRect),
        },
      }))
      const stId = String((st as any).id)
      const requested = String(requestedInstanceId || '')
      const requestedExists = requested && safeInstances.some((inst: any) => String(inst.id) === requested)
      const preferred = screenTitleLastInstanceById[stId]
      const preferredExists = preferred && safeInstances.some((inst: any) => String(inst.id) === String(preferred))
      const activeInstanceId = String(
        requestedExists ? requested : preferredExists ? preferred : safeInstances[0]?.id || ''
      )

      const stStart = roundToTenth(Math.max(0, Number((st as any).startSeconds || 0)))
      try { videoRef.current?.pause?.() } catch {}
      try { overlayVideoRef.current?.pause?.() } catch {}
      setPlaying(false)
      playheadFromVideoRef.current = true
      setTimeline((prev) => ({ ...prev, playheadSeconds: stStart }))
      setScreenTitlePlacementEditor({
        id: stId,
        presetId,
        instances: safeInstances,
        activeInstanceId,
      })
      setScreenTitleMiniPanelTab('placement')
      setScreenTitlePlacementControlMode('move')
      setScreenTitlePlacementMoveAxis('vertical')
      setScreenTitlePlacementStepPx(1)
      setScreenTitlePlacementPanelPos(
        getDefaultScreenTitlePanelPos(SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX, 228)
      )
      setScreenTitlePlacementDirty(false)
      setScreenTitlePlacementError(null)
      setScreenTitlePlacementAdvancedOpen(false)
      return true
    },
    [getDefaultScreenTitlePanelPos, screenTitles, screenTitleLastInstanceById]
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
          audioEnabled: true,
        },
      ]
    }
    return []
  }, [audioTrack, timeline])

  const laneMeta = useMemo<Record<LaneKey, { label: string; swatch: string }>>(
    () => ({
      graphics: { label: 'GRAPHICS', swatch: 'rgba(10,132,255,0.90)' },
      logo: { label: 'LOGO', swatch: 'rgba(212,175,55,0.95)' },
      lowerThird: { label: 'LOWER THIRD', swatch: 'rgba(94,92,230,0.90)' },
      screenTitle: { label: 'SCREEN TITLES', swatch: 'rgba(255,214,10,0.90)' },
      videoOverlay: { label: 'VIDEO OVERLAY', swatch: 'rgba(255,159,10,0.90)' },
      video: { label: 'VIDEOS', swatch: 'rgba(212,175,55,0.75)' },
      narration: { label: 'NARRATION', swatch: 'rgba(175,82,222,0.90)' },
      audio: { label: 'AUDIO/MUSIC', swatch: 'rgba(48,209,88,0.90)' },
    }),
    []
  )
  const laneSwatchForButton = (swatch: string) => {
    const match = swatch.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/i)
    if (!match) return swatch
    const nextAlpha = Math.min(1, Math.max(0, Number(match[4]) * 0.92))
    return `rgba(${match[1]},${match[2]},${match[3]},${nextAlpha})`
  }
  const isPreviewAudioLaneOn = useCallback(
    (lane: PreviewAudioLaneKey) => {
      const audioOn = previewAudioLaneEnabled[lane] !== false
      if ((lane === 'video' || lane === 'videoOverlay') && previewVideoLaneEnabled[lane] === false) return false
      return audioOn
    },
    [previewAudioLaneEnabled, previewVideoLaneEnabled]
  )
  const narrationButtonSwatch = laneSwatchForButton(laneMeta.narration.swatch)
  const audioButtonSwatch = laneSwatchForButton(laneMeta.audio.swatch)
  const narrationPreviewEnabled = isPreviewAudioLaneOn('narration')
  const audioPreviewEnabled = isPreviewAudioLaneOn('audio')
  const laneVisibility = useMemo(
    () => ({
      graphics: showEmptyLanes || graphics.length > 0,
      logo: showEmptyLanes || logos.length > 0,
      lowerThird: showEmptyLanes || lowerThirds.length > 0,
      screenTitle: showEmptyLanes || screenTitles.length > 0,
      videoOverlay: showEmptyLanes || videoOverlays.length > 0 || videoOverlayStills.length > 0,
      video: showEmptyLanes || timeline.clips.length > 0 || stills.length > 0,
      narration: showEmptyLanes || narration.length > 0,
      audio: showEmptyLanes || audioSegments.length > 0,
    }),
    [
      showEmptyLanes,
      graphics.length,
      logos.length,
      lowerThirds.length,
      screenTitles.length,
      videoOverlays.length,
      videoOverlayStills.length,
      timeline.clips.length,
      stills.length,
      narration.length,
      audioSegments.length,
    ]
  )
  const laneLayout = useMemo(() => {
    const order: LaneKey[] = ['graphics', 'logo', 'lowerThird', 'screenTitle', 'videoOverlay', 'video', 'narration', 'audio']
    const yByLane: Record<LaneKey, number | null> = {
      graphics: null,
      logo: null,
      lowerThird: null,
      screenTitle: null,
      videoOverlay: null,
      video: null,
      narration: null,
      audio: null,
    }
    const visibleKeys: LaneKey[] = []
    let y = TRACKS_TOP + LANE_TOP_PAD
    for (const key of order) {
      if (!laneVisibility[key]) continue
      yByLane[key] = y
      visibleKeys.push(key)
      y += TRACK_H
    }
    const visibleRows = Math.max(visibleKeys.length, 1)
    const height = TRACKS_TOP + LANE_TOP_PAD + TRACK_H * visibleRows
    return { yByLane, visibleKeys, height }
  }, [LANE_TOP_PAD, TRACKS_TOP, TRACK_H, laneVisibility])
  const GRAPHICS_Y = laneLayout.yByLane.graphics
  const LOGO_Y = laneLayout.yByLane.logo
  const LOWER_THIRD_Y = laneLayout.yByLane.lowerThird
  const SCREEN_TITLE_Y = laneLayout.yByLane.screenTitle
  const VIDEO_OVERLAY_Y = laneLayout.yByLane.videoOverlay
  const VIDEO_Y = laneLayout.yByLane.video
  const NARRATION_Y = laneLayout.yByLane.narration
  const AUDIO_Y = laneLayout.yByLane.audio
  const TIMELINE_H = laneLayout.height
  const showEmptyState = !showEmptyLanes && laneLayout.visibleKeys.length === 0
  const layerToggleSize = 44
  const layerToggleTop = Math.max(0, Math.floor((TRACKS_TOP - layerToggleSize) / 2))
  const layerToggleGutterRight = Math.round((timelinePadPx || 0) - timelineScrollLeftPx - 10)
  const layerToggleVisible = layerToggleGutterRight > 80
  const layerToggleLabel = showEmptyLanes ? 'Compact Layers' : 'Expand Layers'
  const layerToggleIconSize = Math.min(24, Math.max(16, Math.floor(PILL_H * 0.675)))
  const layerToggleWidth = Math.max(layerToggleIconSize * 3, 60)
  const layerToggleLeft = layerToggleGutterRight - layerToggleWidth

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

  const { laneBoundariesByKind, objectBoundariesAll, timelineGuidelines } = useMemo(() => {
    const push = (arr: number[], all: number[], start: number, end: number) => {
      const s = roundToTenth(Number(start))
      const e = roundToTenth(Number(end))
      if (!(e > s)) return
      arr.push(s, e)
      all.push(s, e)
    }

    const baseLane: number[] = []
    const overlayLane: number[] = []
    const graphicLane: number[] = []
    const logoLane: number[] = []
    const lowerThirdLane: number[] = []
    const screenTitleLane: number[] = []
    const narrationLane: number[] = []
    const audioLane: number[] = []
    const all: number[] = []

    for (let i = 0; i < timeline.clips.length; i++) {
      const start = roundToTenth(clipStarts[i] || 0)
      const len = clipDurationSeconds(timeline.clips[i])
      const end = roundToTenth(start + len)
      push(baseLane, all, start, end)
    }
    for (const s of stills) {
      const a = roundToTenth(Number((s as any).startSeconds || 0))
      const b = roundToTenth(Number((s as any).endSeconds || 0))
      push(baseLane, all, a, b)
    }
    const overlayStarts = computeClipStarts(videoOverlays as any)
    for (let i = 0; i < videoOverlays.length; i++) {
      const start = roundToTenth(overlayStarts[i] || 0)
      const len = clipDurationSeconds(videoOverlays[i] as any)
      const end = roundToTenth(start + len)
      push(overlayLane, all, start, end)
    }
    for (const s of videoOverlayStills) {
      const a = roundToTenth(Number((s as any).startSeconds || 0))
      const b = roundToTenth(Number((s as any).endSeconds || 0))
      push(overlayLane, all, a, b)
    }
    for (const g of graphics) {
      push(graphicLane, all, Number((g as any).startSeconds || 0), Number((g as any).endSeconds || 0))
    }
    for (const l of logos) {
      push(logoLane, all, Number((l as any).startSeconds || 0), Number((l as any).endSeconds || 0))
    }
    for (const lt of lowerThirds) {
      push(lowerThirdLane, all, Number((lt as any).startSeconds || 0), Number((lt as any).endSeconds || 0))
    }
    for (const st of screenTitles) {
      push(screenTitleLane, all, Number((st as any).startSeconds || 0), Number((st as any).endSeconds || 0))
    }
    for (const n of narration) {
      push(narrationLane, all, Number((n as any).startSeconds || 0), Number((n as any).endSeconds || 0))
    }
    for (const a of audioSegments) {
      push(audioLane, all, Number((a as any).startSeconds || 0), Number((a as any).endSeconds || 0))
    }

    const uniqSorted = (arr: number[]) => {
      const uniq = new Map<string, number>()
      for (const t of arr) {
        const tt = roundToTenth(Number(t) || 0)
        uniq.set(tt.toFixed(1), tt)
      }
      return Array.from(uniq.values()).sort((a, b) => a - b)
    }

    const laneBoundaries: Record<string, number[]> = {
      clip: uniqSorted(baseLane),
      still: uniqSorted(baseLane),
      videoOverlay: uniqSorted(overlayLane),
      videoOverlayStill: uniqSorted(overlayLane),
      graphic: uniqSorted(graphicLane),
      logo: uniqSorted(logoLane),
      lowerThird: uniqSorted(lowerThirdLane),
      screenTitle: uniqSorted(screenTitleLane),
      narration: uniqSorted(narrationLane),
      audioSegment: uniqSorted(audioLane),
    }

    const objectBoundariesAll = uniqSorted(all)

    const guidelineRaw: any[] = Array.isArray((timeline as any).guidelines) ? (timeline as any).guidelines : []
    const guidelineSorted = uniqSorted(
      guidelineRaw
        .map((t) => roundToTenth(Number(t)))
        .filter((t) => Number.isFinite(t) && t >= 0)
    )

    return { laneBoundariesByKind: laneBoundaries, objectBoundariesAll, timelineGuidelines: guidelineSorted }
  }, [
    audioSegments,
    clipStarts,
    graphics,
    logos,
    lowerThirds,
    narration,
    screenTitles,
    stills,
    timeline,
    videoOverlayStills,
    videoOverlays,
  ])

  const isBlockingTimelineMessage = useCallback((msg: string) => {
    const text = String(msg || '').toLowerCase()
    const blockingHints = [
      'no room',
      'cannot',
      'not enough',
      'invalid',
      'missing',
      'no more',
      'exceeds',
      'overlap',
      'resulting duration is too small',
      'timeline max length reached',
      'no available slot',
      'no more source',
      'no more source video',
      'no more source audio',
    ]
    return blockingHints.some((hint) => text.includes(hint))
  }, [])

  useEffect(() => {
    if (!timelineMessage) return
    if (!isBlockingTimelineMessage(timelineMessage)) return
    setTimelineErrorModal(timelineMessage)
    setTimelineMessage(null)
  }, [isBlockingTimelineMessage, timelineMessage])

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
    playheadFromScrollRef.current = false
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
  const activeClipAtPlayhead = useMemo(() => {
    if (!timeline.clips.length) return null
    const idx = findClipIndexAtTime(playhead, timeline.clips, clipStarts)
    if (idx < 0 || idx >= timeline.clips.length) return null
    return timeline.clips[idx]
  }, [playhead, timeline.clips, clipStarts])

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

  const timelineBackgroundMode = useMemo<'none' | 'color' | 'image'>(() => {
    const raw = String((timeline as any).timelineBackgroundMode || 'none').trim().toLowerCase()
    return raw === 'color' ? 'color' : raw === 'image' ? 'image' : 'none'
  }, [timeline])

  const timelineBackgroundColor = useMemo(() => normalizeHexColor((timeline as any).timelineBackgroundColor, '#000000'), [timeline])

  const timelineBackgroundUploadId = useMemo(() => {
    const id = Number((timeline as any).timelineBackgroundUploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [timeline])

  const timelineBackgroundImageUrl = useMemo(() => {
    if (!timelineBackgroundUploadId) return null
    return (
      graphicFileUrlByUploadId[timelineBackgroundUploadId] ||
      `/api/uploads/${encodeURIComponent(String(timelineBackgroundUploadId))}/file`
    )
  }, [graphicFileUrlByUploadId, timelineBackgroundUploadId])

  const hasTimelineBackgroundPreview =
    timelineBackgroundMode === 'color' || (timelineBackgroundMode === 'image' && !!timelineBackgroundImageUrl)

  const resolveClipForStill = useCallback(
    (still: any): any | null => {
      if (!still) return null
      let clip: any | null = null
      const sourceClipId = still.sourceClipId != null ? String(still.sourceClipId) : ''
      if (sourceClipId) {
        clip = (timeline.clips || []).find((c: any) => String(c.id) === sourceClipId) || null
      }
      if (clip || !timeline.clips.length) return clip

      const stillStart = roundToTenth(Number(still.startSeconds || 0))
      const stillEnd = roundToTenth(Number(still.endSeconds || stillStart))
      for (let i = 0; i < timeline.clips.length; i++) {
        const clipStart = roundToTenth(Number(clipStarts[i] || 0))
        const clipEnd = roundToTenth(clipStart + clipSourceDurationSeconds(timeline.clips[i] as any))
        if (
          Math.abs(clipStart - stillStart) < 0.05 ||
          Math.abs(clipEnd - stillStart) < 0.05 ||
          Math.abs(clipStart - stillEnd) < 0.05 ||
          Math.abs(clipEnd - stillEnd) < 0.05
        ) {
          return timeline.clips[i]
        }
      }

      let bestClip: any | null = null
      let bestDist = Number.POSITIVE_INFINITY
      for (let i = 0; i < timeline.clips.length; i++) {
        const clipStart = roundToTenth(Number(clipStarts[i] || 0))
        const clipEnd = roundToTenth(clipStart + clipSourceDurationSeconds(timeline.clips[i] as any))
        const dist = Math.min(
          Math.abs(clipStart - stillStart),
          Math.abs(clipEnd - stillStart),
          Math.abs(clipStart - stillEnd),
          Math.abs(clipEnd - stillEnd)
        )
        if (dist < bestDist) {
          bestDist = dist
          bestClip = timeline.clips[i]
        }
      }
      return bestClip
    },
    [clipStarts, timeline.clips]
  )

  const activeStillBgFill = useMemo(() => {
    const s: any = previewStillAtPlayhead as any
    if (!s) return null
    const clip = resolveClipForStill(s)
    if (!clip) return null
    const style = String(clip.bgFillStyle || 'none')
    if (style !== 'blur') return null
    const uploadId = Number(clip.uploadId || 0)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return null
    const dims = dimsByUploadId[uploadId]
    const w = Number(dims?.width ?? (baseVideoDims?.w ?? 0))
    const h = Number(dims?.height ?? (baseVideoDims?.h ?? 0))
    if (w > 0 && h > 0 && w <= h) return null
    const brightness = String(clip.bgFillBrightness || 'neutral')
    const blur = String(clip.bgFillBlur || 'medium')
    return { brightness, blur }
  }, [baseVideoDims, dimsByUploadId, previewStillAtPlayhead, resolveClipForStill])

  const activeStillBgFillDebug = useMemo(() => {
    const s: any = previewStillAtPlayhead as any
    if (!s) return { ok: false, reason: 'no_still' }
    const sourceClipId = s.sourceClipId != null ? String(s.sourceClipId) : ''
    const clip = resolveClipForStill(s)
    if (!clip) return { ok: false, reason: 'clip_not_found', sourceClipId, stillStart: s.startSeconds }
    const style = String(clip.bgFillStyle || 'none')
    const uploadId = Number(clip.uploadId || 0)
    const dims = dimsByUploadId[uploadId]
    const w = Number(dims?.width ?? (baseVideoDims?.w ?? 0))
    const h = Number(dims?.height ?? (baseVideoDims?.h ?? 0))
    if (style !== 'blur') {
      return { ok: false, reason: 'style_not_blur', style, uploadId }
    }
    if (w > 0 && h > 0 && w <= h) {
      return { ok: false, reason: 'portrait_source', uploadId, w, h }
    }
    return {
      ok: true,
      reason: 'ok',
      style,
      uploadId,
      w,
      h,
      brightness: String(clip.bgFillBrightness || 'neutral'),
      blur: String(clip.bgFillBlur || 'medium'),
    }
  }, [baseVideoDims, dimsByUploadId, previewStillAtPlayhead, resolveClipForStill])

  const activeStillObjectFit = useMemo<'cover' | 'contain'>(() => {
    if (!activeStillUploadId) return 'cover'
    return 'contain'
  }, [activeStillUploadId])

  const activeVideoOverlayStillUploadId = useMemo(() => {
    const s = previewVideoOverlayStillAtPlayhead
    if (!s) return null
    const id = Number((s as any).uploadId)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [previewVideoOverlayStillAtPlayhead])

  const activeClipBgFill = useMemo(() => {
    const clip: any = activeClipAtPlayhead as any
    if (!clip) return null
    const style = String(clip.bgFillStyle || 'none')
    if (style !== 'blur') return null
    const uploadId = Number(clip.uploadId || 0)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return null
    const dims = dimsByUploadId[uploadId]
    const w = Number(dims?.width ?? (baseVideoDims?.w ?? 0))
    const h = Number(dims?.height ?? (baseVideoDims?.h ?? 0))
    if (!(w > 0 && h > 0)) return null
    if (w <= h) return null
    const brightness = String(clip.bgFillBrightness || 'neutral')
    const blur = String(clip.bgFillBlur || 'medium')
    return { uploadId, brightness, blur }
  }, [activeClipAtPlayhead, baseVideoDims, dimsByUploadId])

  const activeClipBgStatic = useMemo<null | { kind: 'color'; color: string } | { kind: 'image'; url: string }>(() => {
    const clip: any = activeClipAtPlayhead as any
    if (!clip) return null
    const style = String((clip as any).bgFillStyle || 'none').trim().toLowerCase()
    if (style === 'color') {
      return { kind: 'color', color: normalizeHexColor((clip as any).bgFillColor, '#000000') }
    }
    if (style === 'image') {
      const uploadId = Number((clip as any).bgFillImageUploadId)
      if (!(Number.isFinite(uploadId) && uploadId > 0)) return null
      const id = Math.round(uploadId)
      const url = graphicFileUrlByUploadId[id] || `/api/uploads/${encodeURIComponent(String(id))}/file`
      return { kind: 'image', url }
    }
    return null
  }, [activeClipAtPlayhead, graphicFileUrlByUploadId])

  const activeStillBgStatic = useMemo<null | { kind: 'color'; color: string } | { kind: 'image'; url: string }>(() => {
    const s: any = previewStillAtPlayhead as any
    if (!s) return null
    const clip = resolveClipForStill(s)
    if (!clip) return null
    const style = String((clip as any).bgFillStyle || 'none').trim().toLowerCase()
    if (style === 'color') {
      return { kind: 'color', color: normalizeHexColor((clip as any).bgFillColor, '#000000') }
    }
    if (style === 'image') {
      const uploadId = Number((clip as any).bgFillImageUploadId)
      if (!(Number.isFinite(uploadId) && uploadId > 0)) return null
      const id = Math.round(uploadId)
      const url = graphicFileUrlByUploadId[id] || `/api/uploads/${encodeURIComponent(String(id))}/file`
      return { kind: 'image', url }
    }
    return null
  }, [graphicFileUrlByUploadId, previewStillAtPlayhead, resolveClipForStill])

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
    const animateRaw = String(g.animate || 'none').trim().toLowerCase()
    const animateAllowed = new Set(['none', 'slide_in', 'slide_out', 'slide_in_out', 'doc_reveal'])
    const animateModeRaw = animateAllowed.has(animateRaw) ? animateRaw : 'none'
    const animate = animateModeRaw === 'doc_reveal' ? 'doc_reveal' : animateModeRaw === 'none' ? 'none' : 'slide_in_out'
    const fadeRaw = String(g.fade || 'none').trim().toLowerCase()
    const fade = fadeRaw === 'none' ? 'none' : 'in_out'
    const animateDurationRaw = Number(g.animateDurationMs)
    let animateDurationMs = Number.isFinite(animateDurationRaw) ? Math.round(animateDurationRaw) : 600
    animateDurationMs = Math.round(clamp(animateDurationMs, 100, 2000))
    let fadeDurationMs = Number.isFinite(Number(g.fadeDurationMs)) ? Math.round(Number(g.fadeDurationMs)) : 600
    fadeDurationMs = Math.round(clamp(fadeDurationMs, 100, 2000))
    const segStart = Number(g.startSeconds || 0)
    const segEnd = Number(g.endSeconds || 0)
    const segMs = Math.max(0, Math.round((segEnd - segStart) * 1000))
    const maxAnimMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
    const maxFadeMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
    if (maxAnimMs > 0) animateDurationMs = Math.min(animateDurationMs, maxAnimMs)
    if (maxFadeMs > 0) fadeDurationMs = Math.min(fadeDurationMs, maxFadeMs)
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
        zIndex: 60,
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
        zIndex: 60,
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
    let pos = normalizeLegacyPosition(posRaw)
    if (animate !== 'none') {
      if (pos.includes('top')) pos = 'top_center'
      else if (pos.includes('bottom')) pos = 'bottom_center'
      else pos = 'middle_center'
    }
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
      zIndex: 60,
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
    if (animate === 'doc_reveal' && segMs > 0 && animateDurationMs > 0) {
      style.left = 0
      style.right = 0
      style.top = 0
      style.bottom = 0
      style.width = '100%'
      style.height = '100%'
      style.maxWidth = undefined
      style.maxHeight = undefined
      style.objectFit = 'contain'
      const tRelMs = (Number(previewPlayhead) - segStart) * 1000
      const inDurMs = Math.max(1, Math.min(animateDurationMs, segMs))
      const outDurMs = inDurMs
      const outStartMs = Math.max(0, segMs - outDurMs)
      const fadeInDurMs = Math.max(1, Math.min(fadeDurationMs, segMs))
      const fadeOutDurMs = fadeInDurMs
      const fadeOutStartMs = Math.max(0, segMs - fadeOutDurMs)
      const offscreenPx = Math.max(0, Math.round(previewW + 20))
      let translateX = 0
      let scale = 1
      let alpha = 1
      if (tRelMs <= inDurMs + 1e-6) {
        const p = inDurMs > 0 ? tRelMs / inDurMs : 1
        const eased = easeOutCubic(p)
        scale = 0.2 + 0.8 * eased
        alpha = eased
        translateX = -offscreenPx + offscreenPx * eased
      } else if (tRelMs >= outStartMs - 1e-6) {
        const p = outDurMs > 0 ? (tRelMs - outStartMs) / outDurMs : 1
        const eased = easeInCubic(p)
        scale = 1 - 0.8 * eased
        translateX = offscreenPx * eased
      }
      if (fadeInDurMs > 0 && tRelMs <= fadeInDurMs + 1e-6) {
        alpha *= clamp01(tRelMs / fadeInDurMs)
      }
      if (fadeOutDurMs > 0 && tRelMs >= fadeOutStartMs - 1e-6) {
        alpha *= clamp01(1 - (tRelMs - fadeOutStartMs) / fadeOutDurMs)
      }
      style.opacity = clamp01(alpha)
      style.transformOrigin = 'center center'
      style.transform = `translateX(${Math.round(translateX)}px) scale(${scale.toFixed(4)})`
      return style as React.CSSProperties
    }

    if (animate !== 'none' && segMs > 0 && animateDurationMs > 0) {
      const tRelMs = (Number(previewPlayhead) - segStart) * 1000
      const inDurMs = Math.max(1, Math.min(animateDurationMs, segMs))
      const outDurMs = inDurMs
      const outStartMs = Math.max(0, segMs - outDurMs)
      const offscreenPx = Math.max(0, Math.round((previewW + widthPx) / 2 + 20))
      let translateX = 0
      if ((animate === 'slide_out' || animate === 'slide_in_out') && tRelMs >= outStartMs - 1e-6) {
        const p = outDurMs > 0 ? (tRelMs - outStartMs) / outDurMs : 1
        translateX = offscreenPx * easeInCubic(p)
      } else if ((animate === 'slide_in' || animate === 'slide_in_out') && tRelMs <= inDurMs + 1e-6) {
        const p = inDurMs > 0 ? tRelMs / inDurMs : 1
        translateX = -offscreenPx + offscreenPx * easeOutCubic(p)
      }
      if (Math.abs(translateX) > 0.5) {
        const baseTransform = String(style.transform || '').trim()
        style.transform = `${baseTransform} translateX(${Math.round(translateX)}px)`.trim()
      }
    }
    if (fade === 'in_out' && segMs > 0 && fadeDurationMs > 0) {
      const tRelMs = (Number(previewPlayhead) - segStart) * 1000
      const fadeInDurMs = Math.max(1, Math.min(fadeDurationMs, segMs))
      const fadeOutDurMs = fadeInDurMs
      const fadeOutStartMs = Math.max(0, segMs - fadeOutDurMs)
      let alpha = 1
      if (tRelMs <= fadeInDurMs + 1e-6) alpha *= clamp01(tRelMs / fadeInDurMs)
      if (tRelMs >= fadeOutStartMs - 1e-6) alpha *= clamp01(1 - (tRelMs - fadeOutStartMs) / fadeOutDurMs)
      style.opacity = clamp01(alpha)
    }
    return style as React.CSSProperties
  }, [activeGraphicAtPlayhead, previewBoxSize.h, previewBoxSize.w, previewPlayhead])

  const activeGraphicPreviewIndicators = useMemo(() => {
    const g: any = activeGraphicAtPlayhead as any
    if (!g) return { show: false, hasFade: false }
    if (String((g as any).id || '') !== String(selectedGraphicId || '')) return { show: false, hasFade: false }
    const fade = String((g as any).fade || 'none')
    const hasFade = fade !== 'none'
    const animate = String((g as any).animate || 'none')
    const hasAnimate = animate !== 'none'
    return { show: hasFade || hasAnimate, hasFade, hasAnimate }
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

  const screenTitlePlacementSegment = useMemo(() => {
    if (!screenTitlePlacementEditor?.id) return null
    return (
      screenTitles.find((st: any) => String((st as any).id) === String(screenTitlePlacementEditor.id)) ||
      null
    )
  }, [screenTitlePlacementEditor?.id, screenTitles])

  const screenTitlePlacementActiveRect = useMemo(() => {
    const instances = Array.isArray(screenTitlePlacementEditor?.instances) ? screenTitlePlacementEditor?.instances : []
    if (!instances.length) return null
    const activeId = String(screenTitlePlacementEditor?.activeInstanceId || '')
    const inst = instances.find((it: any) => String(it?.id) === activeId) || instances[0]
    return normalizeScreenTitlePlacementRectForEditor((inst?.customStyle as any)?.placementRect)
  }, [screenTitlePlacementEditor?.activeInstanceId, screenTitlePlacementEditor?.instances])

  const screenTitlePlacementPassiveRects = useMemo(() => {
    const instances = Array.isArray(screenTitlePlacementEditor?.instances) ? screenTitlePlacementEditor?.instances : []
    if (!instances.length) return []
    const activeId = String(screenTitlePlacementEditor?.activeInstanceId || '')
    return instances
      .filter((inst: any) => String(inst?.id) !== activeId)
      .map((inst: any) => ({
        id: String(inst?.id || ''),
        rect: normalizeScreenTitlePlacementRectForEditor((inst?.customStyle as any)?.placementRect),
      }))
  }, [screenTitlePlacementEditor?.activeInstanceId, screenTitlePlacementEditor?.instances])

  const screenTitlePlacementInRange = useMemo(() => {
    const seg: any = screenTitlePlacementSegment as any
    if (!seg) return false
    const s = Number((seg as any).startSeconds || 0)
    const e = Number((seg as any).endSeconds || 0)
    const t = Number(playhead || 0)
    return Number.isFinite(s) && Number.isFinite(e) && Number.isFinite(t) && t >= s - 1e-6 && t <= e + 1e-6
  }, [playhead, screenTitlePlacementSegment])

  const screenTitlePlacementMoveVertical = screenTitlePlacementControlMode === 'move' && screenTitlePlacementMoveAxis === 'vertical'
  const screenTitlePlacementMoveHorizontal = screenTitlePlacementControlMode === 'move' && screenTitlePlacementMoveAxis === 'horizontal'

  const screenTitlePlacementArrowControls = useMemo(() => {
    if (screenTitlePlacementControlMode === 'move') {
      if (screenTitlePlacementMoveAxis === 'vertical') {
        return {
          firstAction: 'move_up' as const,
          secondAction: 'move_down' as const,
          firstRotation: -90,
          secondRotation: 90,
          firstAria: 'Nudge up',
          secondAria: 'Nudge down',
        }
      }
      return {
        firstAction: 'move_left' as const,
        secondAction: 'move_right' as const,
        firstRotation: 180,
        secondRotation: 0,
        firstAria: 'Nudge left',
        secondAria: 'Nudge right',
      }
    }
    if (screenTitlePlacementControlMode === 'left') {
      return {
        firstAction: 'edge_in' as const,
        secondAction: 'edge_out' as const,
        firstRotation: 0,
        secondRotation: 180,
        firstAria: 'Nudge edge in',
        secondAria: 'Nudge edge out',
      }
    }
    if (screenTitlePlacementControlMode === 'right') {
      return {
        firstAction: 'edge_in' as const,
        secondAction: 'edge_out' as const,
        firstRotation: 180,
        secondRotation: 0,
        firstAria: 'Nudge edge in',
        secondAria: 'Nudge edge out',
      }
    }
    if (screenTitlePlacementControlMode === 'top') {
      return {
        firstAction: 'edge_in' as const,
        secondAction: 'edge_out' as const,
        firstRotation: 90,
        secondRotation: -90,
        firstAria: 'Nudge edge in',
        secondAria: 'Nudge edge out',
      }
    }
    return {
      firstAction: 'edge_in' as const,
      secondAction: 'edge_out' as const,
      firstRotation: -90,
      secondRotation: 90,
      firstAria: 'Nudge edge in',
      secondAria: 'Nudge edge out',
    }
  }, [screenTitlePlacementControlMode, screenTitlePlacementMoveAxis])

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

  const previewBgVideoStyle = useMemo<React.CSSProperties>(() => {
    if (!activeClipBgFill) {
      return { display: 'none' }
    }
    const brightnessPreset = String(activeClipBgFill.brightness || 'neutral')
    const blur = String(activeClipBgFill.blur || 'medium')
    const brightness = brightnessPreset === 'light3'
      ? 1.24
      : brightnessPreset === 'light2'
        ? 1.16
        : brightnessPreset === 'light1'
          ? 1.04
          : brightnessPreset === 'dim1'
            ? 0.94
            : brightnessPreset === 'dim3'
              ? 0.64
              : brightnessPreset === 'dim2'
                ? 0.76
                : 1
    const blurPxRaw = blur === 'soft' ? 12 : blur === 'strong' ? 60 : blur === 'very_strong' ? 80 : 32
    const blurPx = Math.max(2, Math.round(blurPxRaw * 0.55))
    return {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      pointerEvents: 'none',
      zIndex: 2,
      filter: `blur(${blurPx}px) brightness(${brightness}) saturate(0.9)`,
      transform: 'scale(1.02)',
      display: 'block',
    }
  }, [activeClipBgFill])

  const previewBgStillStyle = useMemo<React.CSSProperties>(() => {
    if (!activeStillBgFill) {
      return { display: 'none' }
    }
    const brightnessPreset = String(activeStillBgFill.brightness || 'neutral')
    const blur = String(activeStillBgFill.blur || 'medium')
    const brightness = brightnessPreset === 'light3'
      ? 1.24
      : brightnessPreset === 'light2'
        ? 1.16
        : brightnessPreset === 'light1'
          ? 1.04
          : brightnessPreset === 'dim1'
            ? 0.94
            : brightnessPreset === 'dim3'
              ? 0.64
              : brightnessPreset === 'dim2'
                ? 0.76
                : 1
    const blurPxRaw = blur === 'soft' ? 12 : blur === 'strong' ? 60 : blur === 'very_strong' ? 80 : 32
    const blurPx = Math.max(2, Math.round(blurPxRaw * 0.55))
    return {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      pointerEvents: 'none',
      zIndex: 2,
      filter: `blur(${blurPx}px) brightness(${brightness}) saturate(0.9)`,
      transform: 'scale(1.02)',
      display: 'block',
    }
  }, [activeStillBgFill])

  const previewBaseVideoStyle = useMemo<React.CSSProperties>(() => {
    return {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: previewObjectFit,
      pointerEvents: 'none',
      display: activeUploadId != null && previewVideoLaneEnabled.video !== false ? 'block' : 'none',
      zIndex: 5,
    }
  }, [activeUploadId, previewObjectFit, previewVideoLaneEnabled])

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
    if (!isPreviewAudioLaneOn('narration')) {
      setTimelineMessage('Narration preview muted')
      return
    }
    if (musicPreviewPlaying) stopMusicPreview()
    if (!sortedNarration.length) {
      setTimelineMessage('No narration segments')
      return
    }
    const enabledNarration = sortedNarration.filter((n: any) => (n as any).audioEnabled !== false)
    if (!enabledNarration.length) {
      setTimelineMessage('Narration muted')
      return
    }

    // If playhead is not inside a narration segment, jump to the next segment start and stop.
    const segAtRaw = findNarrationAtTime(playhead)
    const segAt = segAtRaw && (segAtRaw as any).audioEnabled !== false ? segAtRaw : null
    const eps = 0.05
    if (!segAt) {
      const next = enabledNarration.find((n: any) => Number(n.startSeconds) > Number(playhead) + eps)
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
    const url = `/api/uploads/${encodeURIComponent(String(uploadId))}/file`
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
        const next = enabledNarration.find(
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
    isPreviewAudioLaneOn,
    stopMusicPreview,
    stopNarrationPreview,
    totalSeconds,
  ])

  const toggleMusicPlay = useCallback(async () => {
    if (musicPreviewPlaying) {
      stopMusicPreview()
      return
    }
    if (!isPreviewAudioLaneOn('audio')) {
      setTimelineMessage('Music preview muted')
      return
    }
    if (narrationPreviewPlaying) stopNarrationPreview()
    const enabledSegments = sortedAudioSegments.filter((s: any) => (s as any).audioEnabled !== false)
    if (!enabledSegments.length) {
      setTimelineMessage('No music segments')
      return
    }

    // If playhead is not inside a music segment, jump to the next segment start and stop.
    const segAtRaw = findAudioSegmentAtTime(playhead)
    const segAt = segAtRaw && (segAtRaw as any).audioEnabled !== false ? segAtRaw : null
    const eps = 0.05
    if (!segAt) {
      const next = enabledSegments.find((s: any) => Number(s.startSeconds) > Number(playhead) + eps)
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
    const url = `/api/uploads/${encodeURIComponent(String(uploadId))}/file`
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
        const next = enabledSegments.find(
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
    isPreviewAudioLaneOn,
    stopMusicPreview,
    stopNarrationPreview,
    totalSeconds,
  ])

  useEffect(() => {
    if (!isPreviewAudioLaneOn('narration') && narrationPreviewPlaying) {
      stopNarrationPreview()
    }
    if (!isPreviewAudioLaneOn('audio') && musicPreviewPlaying) {
      stopMusicPreview()
    }
  }, [
    isPreviewAudioLaneOn,
    musicPreviewPlaying,
    narrationPreviewPlaying,
    previewAudioLaneEnabled,
    previewVideoLaneEnabled,
    stopMusicPreview,
    stopNarrationPreview,
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

        const url = `/api/uploads/${encodeURIComponent(String(id))}/file`
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
      const now = performance.now()
      ctx.strokeStyle = 'rgba(212,175,55,0.85)'
      ctx.lineWidth = 1
      const centerX = wCss / 2
      for (const g of gs) {
        const t = roundToTenth(Number(g))
        if (!Number.isFinite(t) || t < startT - 0.5 || t > endT + 0.5) continue
        const onPlayhead = Math.abs(t - playhead) < 0.001
        const x = onPlayhead ? centerX - 0.5 : padPx + t * pxPerSecond - scrollLeft
        if (x < -2 || x > wCss + 2) continue
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, hCss)
        ctx.stroke()

        if (guidelineFlash && Math.abs(t - guidelineFlash.t) < 0.001 && now - guidelineFlash.at < 700) {
          ctx.save()
          ctx.strokeStyle = 'rgba(255,214,10,0.95)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.moveTo(x + 0.5, 0)
          ctx.lineTo(x + 0.5, hCss)
          ctx.stroke()
          ctx.restore()
        }
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
      // No waveform target selected; keep the waveform area empty.
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
	    const HANDLE_BOUND = 'rgba(96,165,250,0.95)'
	    const boundHandleEdge: 'start' | 'end' | null =
	      timelineCtxMenu?.edgeIntent === 'start' || timelineCtxMenu?.edgeIntent === 'end'
	        ? (timelineCtxMenu.edgeIntent as any)
	        : null
	    const boundHandleKind = boundHandleEdge ? String((timelineCtxMenu as any)?.kind || '') : null
	    const boundHandleId = boundHandleEdge ? String((timelineCtxMenu as any)?.id || '') : null
	    const drawHandle = (hx: number, hy: number, hs: number, color: string, bound: boolean) => {
	      const hw = hs * 2
	      const hh = hs
	      if (!bound) {
	        ctx.fillStyle = color
	        roundRect(ctx, hx, hy, hw, hh, 4)
	        ctx.fill()
	        return
	      }
	      const ds = Math.max(6, Math.floor(hh * 0.9))
	      const cx = hx + hw / 2
	      const cy = hy + hh / 2
	      ctx.save()
	      ctx.translate(cx, cy)
	      ctx.rotate(Math.PI / 4)
	      ctx.fillStyle = HANDLE_BOUND
	      ctx.fillRect(-ds / 2, -ds / 2, ds, ds)
	      ctx.restore()
	    }
    const ICON_ACCENT_ON = 'rgba(48,209,88,0.95)'
    const ICON_ACCENT_OFF = 'rgba(255,69,58,0.95)'
    const drawIcon = (img: HTMLImageElement | undefined, x: number, y: number, size: number, accent: string) => {
      if (!img) return
      const scratch = iconScratchRef.current || document.createElement('canvas')
      iconScratchRef.current = scratch
      scratch.width = size
      scratch.height = size
      const sctx = scratch.getContext('2d')
      if (!sctx) return
      sctx.clearRect(0, 0, size, size)
      sctx.drawImage(img, 0, 0, size, size)
      sctx.globalCompositeOperation = 'source-in'
      sctx.fillStyle = '#fff'
      sctx.fillRect(0, 0, size, size)
      sctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(scratch, x, y)
      ctx.beginPath()
      ctx.fillStyle = accent
      ctx.arc(x + size - 2, y + 2, 2, 0, Math.PI * 2)
      ctx.fill()
    }
    const pillIconSize = Math.max(15, Math.min(21, Math.floor(pillH * 0.6)))
	    const pillIconGap = 6
	    const drawPillAudioIcon = (x: number, y: number, enabled: boolean) => {
	      drawIcon(
	        enabled ? iconImagesRef.current.audioOn : iconImagesRef.current.audioOff,
	        x,
	        y,
	        pillIconSize,
	        enabled ? ICON_ACCENT_ON : ICON_ACCENT_OFF
	      )
	    }
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
	        const iconGap = 6
	        const labels: Array<{ y: number; label: string; swatch: string; key: LaneKey }> = laneLayout.visibleKeys
	          .map((key) => {
	            const y = laneLayout.yByLane[key]
	            if (y == null) return null
	            return { y: y + pillH / 2, label: laneMeta[key].label, swatch: laneMeta[key].swatch, key }
	          })
	          .filter((row): row is { y: number; label: string; swatch: string; key: LaneKey } => Boolean(row))

	        ctx.save()
	        ctx.globalAlpha = 0.92
	        ctx.textAlign = 'right'
	        ctx.textBaseline = 'middle'
	        ctx.font = '900 14px system-ui, -apple-system, Segoe UI, sans-serif'
	        for (const row of labels) {
	          const y = Math.round(row.y)
	          const swatchX = gutterRight - swatchW
	          const swatchY = Math.round(y - swatchH / 2)
	          ctx.fillStyle = row.swatch
	          ctx.fillRect(swatchX, swatchY, swatchW, swatchH)

	          const textX = Math.round(swatchX - iconGap)
	          const maxW = Math.max(0, textX - 8)
	          if (maxW < 20) continue
	          ctx.fillStyle = 'rgba(187,187,187,0.95)'
	          const clipped = ellipsizeText(ctx, row.label, maxW)
	          ctx.fillText(clipped, textX, y)
	        }
	        ctx.restore()
	      }
	    }

	    // Logo segments (logo lane; no overlaps)
	    if (logoY != null) {
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
      const handleW = handleSize * 2

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
      const padLeft = showHandles ? 6 + handleW + 10 : 12
      const padRight = showHandles ? 6 + handleW + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, logoY + pillH / 2)
      }

      if (showHandles) {
        const hs = handleSize
        const hy = logoY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'logo' && String((l as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, HANDLE_GREEN, boundEdge === 'start')
        drawHandle(hxR, hy, hs, HANDLE_GREEN, boundEdge === 'end')
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
    }

    // Lower-third segments (below logos; no overlaps)
    if (lowerThirdY != null) {
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
      const handleW = handleSize * 2

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
      const padLeft = showHandles ? 6 + handleW + 10 : 12
      const padRight = showHandles ? 6 + handleW + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, lowerThirdY + pillH / 2)
      }

      if (showHandles) {
        const hs = handleSize
        const hy = lowerThirdY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'lowerThird' && String((lt as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, HANDLE_GREEN, boundEdge === 'start')
        drawHandle(hxR, hy, hs, HANDLE_GREEN, boundEdge === 'end')
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
    }

    // Screen-title segments (below lower thirds; no overlaps)
    if (screenTitleY != null) {
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
      const handleW = handleSize * 2

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
      const padLeft = showHandles ? 6 + handleW + 10 : 12
      const padRight = showHandles ? 6 + handleW + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, label, maxTextW)
        ctx.fillText(clipped, x + padLeft, screenTitleY + pillH / 2)
      }

      if (showHandles) {
        const hs = handleSize
        const hy = screenTitleY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'screenTitle' && String((st as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, HANDLE_GREEN, boundEdge === 'start')
        drawHandle(hxR, hy, hs, HANDLE_GREEN, boundEdge === 'end')
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
    }

    // Freeze-frame still segments (video overlay lane)
    if (videoOverlayY != null) {
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
      const handleW = handleSize * 2

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
      const padLeft = showHandles ? 6 + handleW + 10 : 12
      const padRight = showHandles ? 6 + handleW + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, label, maxTextW)
        ctx.fillText(clipped, x + padLeft, videoOverlayY + pillH / 2)
      }

      if (showHandles) {
        const hs = handleSize
        const hy = videoOverlayY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'videoOverlayStill' && String((s as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, HANDLE_GREEN, boundEdge === 'start')
        drawHandle(hxR, hy, hs, HANDLE_GREEN, boundEdge === 'end')
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

    // Video overlay segments (PiP videos; no overlaps)
    if (videoOverlayY != null && videoOverlays.length) {
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
        const handleW = handleSize * 2

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
        const audioEnabled = (o as any).audioEnabled !== false
        ctx.fillStyle = '#fff'
        const basePadLeft = showHandles ? 6 + handleW + 6 : 12
        const iconX = x + basePadLeft
        const iconY = videoOverlayY + Math.floor((pillH - pillIconSize) / 2)
        drawPillAudioIcon(iconX, iconY, audioEnabled)
        const padLeft = basePadLeft + pillIconSize + pillIconGap
        const padRight = showHandles ? 6 + handleW + 10 : 12
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
          const hxR = x + w - 6 - handleW
          const boundEdge =
            boundHandleEdge && boundHandleKind === 'videoOverlay' && String((o as any)?.id) === boundHandleId ? boundHandleEdge : null
          drawHandle(hxL, hy, hs, leftIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'start')
          drawHandle(hxR, hy, hs, rightIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'end')
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

    if (graphicsY != null) {
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
      const handleW = handleSize * 2

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
      const padLeft = showHandles ? 6 + handleW + 10 : 12
      const padRight = showHandles ? 6 + handleW + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, name, maxTextW)
        ctx.fillText(clipped, x + padLeft, graphicsY + pillH / 2)
      }

      if (showHandles) {
        const hs = handleSize
        const hy = graphicsY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'graphic' && String((g as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, HANDLE_GREEN, boundEdge === 'start')
        drawHandle(hxR, hy, hs, HANDLE_GREEN, boundEdge === 'end')
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
    }

    // Freeze-frame still segments (base track)
    if (videoY != null) {
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
      const handleW = handleSize * 2

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
      const padLeft = showHandles ? 6 + handleW + 10 : 12
      const padRight = showHandles ? 6 + handleW + 10 : 12
      const maxTextW = Math.max(0, w - padLeft - padRight)
      if (maxTextW >= 20) {
        const clipped = ellipsizeText(ctx, label, maxTextW)
        ctx.fillText(clipped, x + padLeft, videoY + pillH / 2)
      }

      if (showHandles) {
        const hs = handleSize
        const hy = videoY + Math.floor((pillH - handleSize) / 2)
        const hxL = x + 6
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'still' && String((s as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, HANDLE_GREEN, boundEdge === 'start')
        drawHandle(hxR, hy, hs, HANDLE_GREEN, boundEdge === 'end')
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
    }
    if (videoY != null) {
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
      const handleW = handleSize * 2

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
      const audioEnabled = (clip as any).audioEnabled !== false
      ctx.fillStyle = '#fff'
      const basePadLeft = showHandles ? 6 + handleW + 6 : isSelected ? 18 : 12
      const iconX = x + basePadLeft
      const iconY = videoY + Math.floor((pillH - pillIconSize) / 2)
      drawPillAudioIcon(iconX, iconY, audioEnabled)
      const padLeft = basePadLeft + pillIconSize + pillIconGap
      const padRight = showHandles ? 6 + handleW + 10 : 12
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
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'clip' && String((clip as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, leftIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'start')
        drawHandle(hxR, hy, hs, rightIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'end')
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
    }

    // Narration segments (above music; no overlaps)
    if (narrationY != null) {
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
      const handleW = handleSize * 2

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
      const audioEnabled = (n as any).audioEnabled !== false
      const baseName = namesByUploadId[uploadId] || `Narration ${uploadId}`
      const boostDbRaw = (n as any).boostDb != null ? Number((n as any).boostDb) : ((n as any).gainDb == null ? 0 : Number((n as any).gainDb))
      const boostDb = Number.isFinite(boostDbRaw) ? boostDbRaw : 0
      const boostLabel = Math.abs(boostDb) > 0.05 ? `${boostDb > 0 ? '+' : ''}${boostDb.toFixed(0)}dB` : '0dB'
      const label = `${baseName} • ${boostLabel}`
      ctx.fillStyle = '#fff'
      const basePadLeft = showHandles ? 6 + handleW + 6 : 12
      const iconX = x + basePadLeft
      const iconY = narrationY + Math.floor((pillH - pillIconSize) / 2)
      drawPillAudioIcon(iconX, iconY, audioEnabled)
      const padLeft = basePadLeft + pillIconSize + pillIconGap
      const padRight = showHandles ? 6 + handleW + 10 : 12
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
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'narration' && String((n as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, leftIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'start')
        drawHandle(hxR, hy, hs, rightIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'end')
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
    }

    if (audioY != null) {
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
      const handleW = handleSize * 2
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
      const audioEnabled = (seg as any).audioEnabled !== false
      ctx.fillStyle = '#fff'
      const basePadLeft = showHandles ? 6 + handleW + 6 : 12
      const iconX = x + basePadLeft
      const iconY = audioY + Math.floor((pillH - pillIconSize) / 2)
      drawPillAudioIcon(iconX, iconY, audioEnabled)
      const padLeft = basePadLeft + pillIconSize + pillIconGap
      const padRight = showHandles ? 6 + handleW + 10 : 12
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
        const hxR = x + w - 6 - handleW
        const boundEdge =
          boundHandleEdge && boundHandleKind === 'audioSegment' && String((seg as any)?.id) === boundHandleId ? boundHandleEdge : null
        drawHandle(hxL, hy, hs, leftIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'start')
        drawHandle(hxR, hy, hs, rightIsGreen ? HANDLE_GREEN : HANDLE_GOLD, boundEdge === 'end')
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
  }, [
    audioEnvelopeByUploadId,
    audioEnvelopeStatusByUploadId,
    audioConfigNameById,
    audioSegments,
    clipStarts,
    graphics,
    laneLayout,
    laneMeta,
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
    timelineCtxMenu,
    previewAudioLaneEnabled,
    previewVideoLaneEnabled,
    iconReadyTick,
    isPreviewAudioLaneOn,
    guidelineFlash,
    playhead,
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
    const zoomChanged = timelineZoomRef.current !== timelineZoom
    if (playheadFromScrollRef.current && !zoomChanged) {
      playheadFromScrollRef.current = false
      return
    }
    if (zoomChanged) timelineZoomRef.current = timelineZoom
    const target = clamp(Math.round(playhead * pxPerSecond), 0, Math.max(0, stripContentW))
    ignoreScrollRef.current = true
    sc.scrollLeft = target
    setTimelineScrollLeftPx(target)
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false
    })
  }, [playhead, pxPerSecond, stripContentW, timelinePadPx, timelineZoom])

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
                timelineBackgroundMode:
                  String((tlRaw as any)?.timelineBackgroundMode || 'none').trim().toLowerCase() === 'color'
                    ? 'color'
                    : String((tlRaw as any)?.timelineBackgroundMode || 'none').trim().toLowerCase() === 'image'
                      ? 'image'
                      : 'none',
                timelineBackgroundColor: normalizeHexColor((tlRaw as any)?.timelineBackgroundColor, '#000000'),
                timelineBackgroundUploadId:
                  (tlRaw as any)?.timelineBackgroundUploadId == null
                    ? null
                    : Number.isFinite(Number((tlRaw as any).timelineBackgroundUploadId)) && Number((tlRaw as any).timelineBackgroundUploadId) > 0
                      ? Number((tlRaw as any).timelineBackgroundUploadId)
                      : null,
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
          const presetOverride = buildScreenTitlePresetOverride((st as any).customStyle || null)
          const res = await fetch(`/api/create-video/screen-titles/render`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ presetId, text, frameW: outputFrame.width, frameH: outputFrame.height, presetOverride }),
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

          const url = `/api/uploads/${encodeURIComponent(String(uploadId))}/file`
          setGraphicFileUrlByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: url }))
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
  }, [
    buildScreenTitlePresetOverride,
    forceReloadScreenTitlePresets,
    outputFrame.height,
    outputFrame.width,
    refreshScreenTitlePresetId,
    saveTimelineNow,
    screenTitles,
    timeline,
  ])

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
    try {
      if (guidelineFlashTimerRef.current != null) {
        window.clearTimeout(guidelineFlashTimerRef.current)
      }
      setGuidelineFlash({ t, at: performance.now() })
      guidelineFlashTimerRef.current = window.setTimeout(() => {
        setGuidelineFlash(null)
        guidelineFlashTimerRef.current = null
      }, 700)
    } catch {}
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
        const clipBackgroundImageIds = timeline.clips
          .map((c: any) => Number((c as any).bgFillImageUploadId))
          .filter((n) => Number.isFinite(n) && n > 0)
        const videoOverlayIds = videoOverlays.map((o: any) => Number((o as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const graphicIds = graphics.map((g) => Number((g as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const logoIds = logos.map((l) => Number((l as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const lowerThirdIds = lowerThirds.map((lt) => Number((lt as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const narrationIds = narration.map((n: any) => Number((n as any).uploadId)).filter((x) => Number.isFinite(x) && x > 0)
		    const timelineBackgroundIds =
		      timelineBackgroundMode === 'image' && timelineBackgroundUploadId != null ? [timelineBackgroundUploadId] : []
		    const stillIds = (Array.isArray((timeline as any).stills) ? ((timeline as any).stills as any[]) : [])
		      .map((s) => Number(s?.uploadId))
		      .filter((n) => Number.isFinite(n) && n > 0)
		    const audioIds = audioSegments.map((a: any) => Number((a as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0)
		    const ids = Array.from(
          new Set([
            ...clipIds,
            ...clipBackgroundImageIds,
            ...videoOverlayIds,
            ...graphicIds,
            ...logoIds,
            ...lowerThirdIds,
            ...narrationIds,
            ...timelineBackgroundIds,
            ...stillIds,
            ...audioIds,
          ])
        )
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
	  }, [
      audioSegments,
      durationsByUploadId,
      graphics,
      logos,
      lowerThirds,
      namesByUploadId,
      narration,
      timeline.clips,
      timeline.stills,
      timelineBackgroundMode,
      timelineBackgroundUploadId,
      videoOverlays,
    ])

  const seek = useCallback(
    async (t: number, opts?: { autoPlay?: boolean }) => {
      const v = videoRef.current
      const bg = bgVideoRef.current
      if (!v) return
      const tClamped = clamp(roundToTenth(t), 0, Math.max(0, totalSeconds))
      if (!timeline.clips.length) return
      const motionEnabled = previewVideoLaneEnabled.video !== false
      const previewAudioEnabled = isPreviewAudioLaneOn('video')
      // Freeze-frame stills are a base-track segment: pause the video and let the still image render as an overlay.
      if (findStillAtTime(tClamped)) {
        try { v.pause() } catch {}
        try { bg?.pause?.() } catch {}
        setActiveUploadId(null)
        return
      }
      const idx = findClipIndexAtTime(tClamped, timeline.clips, clipStarts)
      if (idx < 0) {
        activeClipIndexRef.current = Math.max(0, clipStarts.findIndex((s) => Number(s) > tClamped + 1e-6))
        try { v.pause() } catch {}
        try { bg?.pause?.() } catch {}
        setActiveUploadId(null)
        return
      }
      activeClipIndexRef.current = idx
      const clip = timeline.clips[idx]
      if (!clip) return
      const desiredMuted = (clip as any).audioEnabled === false || !previewAudioEnabled || !motionEnabled
      const startTimeline = Number(clipStarts[idx] || 0)
      const within = Math.max(0, tClamped - startTimeline)
      const srcDur = clipSourceDurationSeconds(clip)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = clip.sourceStartSeconds + withinMoving
      const nextUploadId = Number(clip.uploadId)
      if (!Number.isFinite(nextUploadId) || nextUploadId <= 0) return
      const clipBgStyle = String((clip as any).bgFillStyle || 'none')
      const clipDims = dimsByUploadId[nextUploadId]
      const wantsBg = clipBgStyle === 'blur' && clipDims && Number(clipDims.width) > Number(clipDims.height)

      if (!motionEnabled) {
        const stillTime = clip.sourceStartSeconds
        if (activeUploadId !== nextUploadId) {
          setActiveUploadId(nextUploadId)
          const src = `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy#t=0.1`
          v.src = src
          baseLoadedUploadIdRef.current = nextUploadId
          v.load()
          if (bg && wantsBg) {
            if (bgLoadedUploadIdRef.current !== nextUploadId || bg.currentSrc !== src) {
              bg.src = src
              bgLoadedUploadIdRef.current = nextUploadId
              bg.load()
            }
          } else if (bg) {
            try { bg.pause() } catch {}
          }
          const onMeta = () => {
            v.removeEventListener('loadedmetadata', onMeta)
            try { v.muted = true } catch {}
            try {
              const w = Number(v.videoWidth || 0)
              const h = Number(v.videoHeight || 0)
              if (w > 0 && h > 0) {
                setPreviewObjectFit(w > h ? 'contain' : 'cover')
                setBaseVideoDims({ w, h })
              }
            } catch {}
            try { v.currentTime = Math.max(0, stillTime) } catch {}
            if (bg && wantsBg) {
              try { bg.muted = true } catch {}
              try { bg.currentTime = Math.max(0, stillTime) } catch {}
            }
          }
          v.addEventListener('loadedmetadata', onMeta)
        } else {
          baseLoadedUploadIdRef.current = nextUploadId
          try { v.muted = true } catch {}
          try { v.currentTime = Math.max(0, stillTime) } catch {}
          if (bg && wantsBg) {
            try { bg.muted = true } catch {}
            try { bg.currentTime = Math.max(0, stillTime) } catch {}
          } else if (bg) {
            try { bg.pause() } catch {}
          }
        }
        try { v.pause() } catch {}
        return
      }

      // Fast-path: the correct upload is already loaded into the element's src (even if activeUploadId is null,
      // e.g. while showing a freeze-frame still). Avoid async src swap so play stays within the user gesture on iOS.
      if (baseLoadedUploadIdRef.current === nextUploadId) {
        if (activeUploadId !== nextUploadId) setActiveUploadId(nextUploadId)
        try { v.muted = desiredMuted } catch {}
        try {
          const w = Number(v.videoWidth || 0)
          const h = Number(v.videoHeight || 0)
          if (w > 0 && h > 0) {
            setPreviewObjectFit(w > h ? 'contain' : 'cover')
            setBaseVideoDims({ w, h })
          }
        } catch {}
        try { v.currentTime = Math.max(0, sourceTime) } catch {}
        if (bg) {
          if (wantsBg) {
            const src = v.currentSrc || v.src || ''
            if (bgLoadedUploadIdRef.current !== nextUploadId || (src && bg.currentSrc !== src)) {
              bg.src = src
              bgLoadedUploadIdRef.current = nextUploadId
              bg.load()
            }
            try { bg.muted = true } catch {}
            try { bg.currentTime = Math.max(0, sourceTime) } catch {}
            if (opts?.autoPlay) {
              void bg.play().catch(() => {})
            }
          } else {
            try { bg.pause() } catch {}
          }
        }
        if (opts?.autoPlay) {
          void (async () => {
            const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
            if (!ok && playbackClockRef.current === 'base') setPlaying(false)
          })()
        }
        return
      }

      if (activeUploadId !== nextUploadId) {
        setActiveUploadId(nextUploadId)
        const src = `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy#t=0.1`
        v.src = src
        baseLoadedUploadIdRef.current = nextUploadId
        v.load()
        if (bg && wantsBg) {
          if (bgLoadedUploadIdRef.current !== nextUploadId || bg.currentSrc !== src) {
            bg.src = src
            bgLoadedUploadIdRef.current = nextUploadId
            bg.load()
          }
        } else if (bg) {
          try { bg.pause() } catch {}
        }
        const onMeta = () => {
          v.removeEventListener('loadedmetadata', onMeta)
          try { v.muted = desiredMuted } catch {}
          try {
            const w = Number(v.videoWidth || 0)
            const h = Number(v.videoHeight || 0)
            if (w > 0 && h > 0) {
              setPreviewObjectFit(w > h ? 'contain' : 'cover')
              setBaseVideoDims({ w, h })
            }
          } catch {}
          try { v.currentTime = Math.max(0, sourceTime) } catch {}
          const srcKey = String(v.currentSrc || v.src || '')
          if (!opts?.autoPlay && srcKey && primedFrameSrcRef.current !== srcKey) {
            primedFrameSrcRef.current = srcKey
            void primePausedFrame(v)
          }
          if (bg && wantsBg) {
            try { bg.muted = true } catch {}
            try { bg.currentTime = Math.max(0, sourceTime) } catch {}
            if (opts?.autoPlay) {
              void bg.play().catch(() => {})
            }
          }
          if (opts?.autoPlay) {
            void (async () => {
              const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
              if (!ok && playbackClockRef.current === 'base') setPlaying(false)
            })()
          }
        }
        v.addEventListener('loadedmetadata', onMeta)
      } else {
        baseLoadedUploadIdRef.current = nextUploadId
        try { v.muted = desiredMuted } catch {}
        try { v.currentTime = Math.max(0, sourceTime) } catch {}
        if (bg) {
          if (wantsBg) {
            const src = v.currentSrc || v.src || ''
            if (bgLoadedUploadIdRef.current !== nextUploadId || (src && bg.currentSrc !== src)) {
              bg.src = src
              bgLoadedUploadIdRef.current = nextUploadId
              bg.load()
            }
            try { bg.muted = true } catch {}
            try { bg.currentTime = Math.max(0, sourceTime) } catch {}
            if (opts?.autoPlay) {
              void bg.play().catch(() => {})
            }
          } else {
            try { bg.pause() } catch {}
          }
        }
        if (opts?.autoPlay) {
          void (async () => {
            const ok = await playWithAutoplayFallback(v, { unmuteAfterPlay: !desiredMuted })
            if (!ok && playbackClockRef.current === 'base') setPlaying(false)
          })()
        }
      }
    },
    [
      activeUploadId,
      clipStarts,
      dimsByUploadId,
      findStillAtTime,
      playWithAutoplayFallback,
      timeline.clips,
      totalSeconds,
      previewVideoLaneEnabled,
      isPreviewAudioLaneOn,
    ]
  )

  useEffect(() => {
    if (playing) return
    try { bgVideoRef.current?.pause?.() } catch {}
  }, [playing])

  useEffect(() => {
    const bg = bgVideoRef.current
    const v = videoRef.current
    if (!bg || !v) return
    if (!activeClipBgFill) {
      try { bg.pause() } catch {}
      return
    }
    const src = v.currentSrc || v.src || ''
    if (src && bg.currentSrc !== src) {
      bg.src = src
      bgLoadedUploadIdRef.current = activeClipBgFill.uploadId
      bg.load()
    }
    try { bg.muted = true } catch {}
    try {
      const t = Number.isFinite(v.currentTime) ? v.currentTime : 0
      bg.currentTime = Math.max(0, t)
    } catch {}
    if (playing) {
      void bg.play().catch(() => {})
    }
  }, [activeClipBgFill, activeUploadId, playing])

  const seekOverlay = useCallback(
    async (t: number, opts?: { autoPlay?: boolean }) => {
      const v = overlayVideoRef.current
      if (!v) return
      const shouldAutoPlay = Boolean(opts?.autoPlay)
      if (!shouldAutoPlay) {
        try { v.pause() } catch {}
      }
      const motionEnabled = previewVideoLaneEnabled.videoOverlay !== false
      const previewAudioEnabled = isPreviewAudioLaneOn('videoOverlay')
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
      const desiredMuted = !Boolean((o as any).audioEnabled) || !previewAudioEnabled || !motionEnabled
      const startTimeline = Number((videoOverlayStarts as any)[idx] || 0)
      const within = Math.max(0, tClamped - startTimeline)
      const srcDur = clipSourceDurationSeconds(o as any)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = Number(o.sourceStartSeconds || 0) + withinMoving
      const nextUploadId = Number(o.uploadId)
      if (!Number.isFinite(nextUploadId) || nextUploadId <= 0) return

      if (!motionEnabled) {
        const stillTime = Number(o.sourceStartSeconds || 0)
        if (overlayActiveUploadId !== nextUploadId) {
          setOverlayActiveUploadId(nextUploadId)
          v.src = `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy#t=0.1`
          overlayLoadedUploadIdRef.current = nextUploadId
          v.load()
          const onMeta = () => {
            v.removeEventListener('loadedmetadata', onMeta)
            try { v.muted = true } catch {}
            try {
              const w = Number(v.videoWidth || 0)
              const h = Number(v.videoHeight || 0)
              if (w > 0 && h > 0) {
                setDimsByUploadId((prev) =>
                  prev[nextUploadId] ? prev : { ...prev, [nextUploadId]: { width: Math.round(w), height: Math.round(h) } }
                )
              }
            } catch {}
            try { v.currentTime = Math.max(0, stillTime) } catch {}
          }
          v.addEventListener('loadedmetadata', onMeta)
        } else {
          overlayLoadedUploadIdRef.current = nextUploadId
          try { v.muted = true } catch {}
          try { v.currentTime = Math.max(0, stillTime) } catch {}
        }
        try { v.pause() } catch {}
        return
      }

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
	            if (!ok && playbackClockRef.current === 'overlay') setPlaying(false)
	          })()
	        }
	        return
      }

	      if (overlayActiveUploadId !== nextUploadId) {
	        setOverlayActiveUploadId(nextUploadId)
	        v.src = `/api/uploads/${encodeURIComponent(String(nextUploadId))}/edit-proxy#t=0.1`
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
		              if (!ok && playbackClockRef.current === 'overlay') setPlaying(false)
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
		          if (!ok && playbackClockRef.current === 'overlay') setPlaying(false)
		          })()
		        }
		      }
		    },
    [
      findVideoOverlayStillAtTime,
      overlayActiveUploadId,
      playWithAutoplayFallback,
      totalSeconds,
      videoOverlayStarts,
      videoOverlays,
      videoOverlayStills,
      previewVideoLaneEnabled,
      isPreviewAudioLaneOn,
    ]
  )

  // If the overlay lane changes (e.g. user inserts an overlay), ensure the overlay preview is
  // synced to the current playhead and NOT playing until the user hits Play.
  useEffect(() => {
    if (playingRef.current) return
    void seekOverlay(playheadRef.current)
  }, [seekOverlay, videoOverlays.length, videoOverlayStills.length])

  // Keep base + overlay previews aligned with the playhead when not playing, so a play gesture
  // can start immediately without an async src swap (helps iOS).
  useEffect(() => {
    if (playingRef.current) return
    void seek(playhead)
    void seekOverlay(playhead)
  }, [playhead, seek, seekOverlay])

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

  useEffect(() => {
    const baseOn = previewVideoLaneEnabled.video !== false
    const overlayOn = previewVideoLaneEnabled.videoOverlay !== false
    if (!baseOn) {
      try { videoRef.current?.pause?.() } catch {}
    }
    if (!overlayOn) {
      try { overlayVideoRef.current?.pause?.() } catch {}
    }
    if (playingRef.current) {
      if (playbackClockRef.current === 'base' && !baseOn) {
        playbackClockRef.current = overlayOn ? 'overlay' : 'synthetic'
      } else if (playbackClockRef.current === 'overlay' && !overlayOn) {
        playbackClockRef.current = baseOn ? 'base' : 'synthetic'
      }
    }
    void seek(playheadRef.current)
    void seekOverlay(playheadRef.current)
  }, [previewVideoLaneEnabled, seek, seekOverlay])

  // Keep a stable poster image for iOS Safari (initial paused frame often won’t paint reliably).
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!activeUploadId) return
      if (posterByUploadId[activeUploadId]) return
      const url = `/api/uploads/${encodeURIComponent(String(activeUploadId))}/thumb`
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
      const url = `/api/uploads/${encodeURIComponent(String(uploadId))}/thumb`
      if (!alive) return
      setPosterByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: url }))
    })()
    return () => {
      alive = false
    }
  }, [activeVideoOverlayAtPlayhead, posterByUploadId])

  // Prefetch file URLs for image assets (graphics + logos + freeze-frame stills) so playback doesn't stall.
  useEffect(() => {
    const ids = Array.from(
      new Set(
        [
          ...graphics.map((g) => Number(g.uploadId)).filter((n) => Number.isFinite(n) && n > 0),
          ...logos.map((l) => Number((l as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0),
          ...lowerThirds.map((lt) => Number((lt as any).uploadId)).filter((n) => Number.isFinite(n) && n > 0),
          ...screenTitles.map((st: any) => Number((st as any).renderUploadId)).filter((n) => Number.isFinite(n) && n > 0),
          ...timeline.clips
            .map((c: any) => Number((c as any).bgFillImageUploadId))
            .filter((n) => Number.isFinite(n) && n > 0),
          ...(timelineBackgroundMode === 'image' && timelineBackgroundUploadId != null ? [timelineBackgroundUploadId] : []),
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
        const urls = batch.map((id) => `/api/uploads/${encodeURIComponent(String(id))}/file`)
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
  }, [
    graphicFileUrlByUploadId,
    graphics,
    logos,
    lowerThirds,
    screenTitles,
    stills,
    timelineBackgroundMode,
    timelineBackgroundUploadId,
    videoOverlayStills,
  ])

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

  const stopPlayback = useCallback(() => {
    setPlaying(false)
    const curGap = gapPlaybackRef.current
    if (curGap) {
      window.cancelAnimationFrame(curGap.raf)
      gapPlaybackRef.current = null
    }
    try { videoRef.current?.pause?.() } catch {}
    try { overlayVideoRef.current?.pause?.() } catch {}
  }, [])

  const startPlayback = useCallback(
    (preferredSource?: 'video' | 'videoOverlay') => {
      if (!(totalSeconds > 0)) return
      if (narrationPreviewPlaying) stopNarrationPreview()
      if (musicPreviewPlaying) stopMusicPreview()

      const desiredSource = preferredSource || previewMotionSource
      if (preferredSource && preferredSource !== previewMotionSource) {
        setPreviewMotionSource(preferredSource)
      }
      const t0 = clamp(roundToTenth(playhead), 0, Math.max(0, totalSeconds))
      if (t0 >= totalSeconds - 0.05) {
        playheadFromVideoRef.current = true
        playheadRef.current = 0
        setTimeline((prev) => ({ ...prev, playheadSeconds: 0 }))
      }

      const baseIdx = timeline.clips.length ? findClipIndexAtTime(t0, timeline.clips, clipStarts) : -1
      const overlayIdx = videoOverlays.length ? findClipIndexAtTime(t0, videoOverlays as any, videoOverlayStarts as any) : -1
      const baseMotionEnabled = previewVideoLaneEnabled.video !== false
      const overlayMotionEnabled = previewVideoLaneEnabled.videoOverlay !== false

      // Choose which element drives the playhead based on desired motion source.
      if (desiredSource === 'video') {
        if (baseIdx >= 0 && baseMotionEnabled) playbackClockRef.current = 'base'
        else if (overlayIdx >= 0 && overlayMotionEnabled) playbackClockRef.current = 'overlay'
        else playbackClockRef.current = 'synthetic'
      } else {
        if (overlayIdx >= 0 && overlayMotionEnabled) playbackClockRef.current = 'overlay'
        else if (baseIdx >= 0 && baseMotionEnabled) playbackClockRef.current = 'base'
        else playbackClockRef.current = 'synthetic'
      }

      setPlaying(true)

      if (baseIdx >= 0) {
        void seek(t0, { autoPlay: playbackClockRef.current === 'base' && baseMotionEnabled })
      } else {
        try { videoRef.current?.pause?.() } catch {}
        setActiveUploadId(null)
      }

      if (overlayIdx >= 0) {
        void seekOverlay(t0, { autoPlay: playbackClockRef.current === 'overlay' && overlayMotionEnabled })
      } else {
        try { overlayVideoRef.current?.pause?.() } catch {}
      }
    },
    [
      clipStarts,
      musicPreviewPlaying,
      narrationPreviewPlaying,
      playhead,
      previewMotionSource,
      previewVideoLaneEnabled,
      seek,
      seekOverlay,
      stopMusicPreview,
      stopNarrationPreview,
      timeline.clips,
      totalSeconds,
      videoOverlayStarts,
      videoOverlays,
    ]
  )

  const togglePlay = useCallback(
    (preferredSource?: 'video' | 'videoOverlay') => {
      if (playing) {
        if (!preferredSource || preferredSource === previewMotionSource) {
          stopPlayback()
          return
        }
        stopPlayback()
        startPlayback(preferredSource)
        return
      }
      startPlayback(preferredSource)
    },
    [playing, previewMotionSource, startPlayback, stopPlayback]
  )

  // Synthetic playback for cases where no video element is driving the clock (e.g. motion disabled).
  useEffect(() => {
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
      playheadFromVideoRef.current = true
      playheadRef.current = next
      setTimeline((prev) => ({ ...prev, playheadSeconds: roundToTenth(next) }))
      const nextClipIdx = timeline.clips.length ? findClipIndexAtTime(next, timeline.clips, clipStarts) : -1
      const stillNow = findStillAtTime(next)
      const stillId = stillNow ? String((stillNow as any).id || '') : ''
      let needsSeekBase = false
      if (nextClipIdx !== activeClipIndexRef.current) {
        activeClipIndexRef.current = nextClipIdx
        needsSeekBase = true
      }
      if (stillId !== syntheticStillIdRef.current) {
        syntheticStillIdRef.current = stillId
        needsSeekBase = true
      }
      if (needsSeekBase) void seek(next)

      const nextOverlayIdx = videoOverlays.length
        ? findClipIndexAtTime(next, videoOverlays as any, videoOverlayStarts as any)
        : -1
      const overlayStillNow = findVideoOverlayStillAtTime(next)
      const overlayStillId = overlayStillNow ? String((overlayStillNow as any).id || '') : ''
      let needsSeekOverlay = false
      if (nextOverlayIdx !== activeVideoOverlayIndexRef.current) {
        activeVideoOverlayIndexRef.current = nextOverlayIdx
        needsSeekOverlay = true
      }
      if (overlayStillId !== syntheticOverlayStillIdRef.current) {
        syntheticOverlayStillIdRef.current = overlayStillId
        needsSeekOverlay = true
      }
      if (needsSeekOverlay) void seekOverlay(next)
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
  }, [
    clipStarts,
    findStillAtTime,
    findVideoOverlayStillAtTime,
    playing,
    seek,
    seekOverlay,
    timeline.clips,
    totalSeconds,
    videoOverlayStarts,
    videoOverlays,
  ])

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
      if (previewVideoLaneEnabled.videoOverlay === false) {
        safePause(overlay)
        return
      }
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
      const desiredMuted = !Boolean((seg as any).audioEnabled) || !isPreviewAudioLaneOn('videoOverlay')
      try { overlay.muted = desiredMuted } catch {}

      if (playbackClockRef.current !== 'overlay') {
        if (overlayActiveUploadId !== uploadId) {
          void seekOverlay(t, { autoPlay: false })
          return
        }
        if (Number.isFinite(sourceTime) && Math.abs((overlay.currentTime || 0) - sourceTime) > 0.25) {
          try { overlay.currentTime = Math.max(0, sourceTime) } catch {}
        }
        safePause(overlay)
        return
      }
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
      if (previewVideoLaneEnabled.video === false) {
        safePause(base)
        return
      }
      const idx = findClipIndexAtTime(t, timeline.clips, clipStarts)
      if (idx < 0) {
        safePause(base)
        return
      }
      const clip = timeline.clips[idx]
      if (!clip) return
      const desiredMuted = (clip as any).audioEnabled === false || !isPreviewAudioLaneOn('video')
      try { base.muted = desiredMuted } catch {}
      const startTimeline = Number(clipStarts[idx] || 0)
      const within = Math.max(0, t - startTimeline)
      const srcDur = clipSourceDurationSeconds(clip)
      const withinMoving = clamp(roundToTenth(within), 0, Math.max(0, srcDur))
      const sourceTime = Number(clip.sourceStartSeconds) + withinMoving
      if (playbackClockRef.current !== 'base') {
        if (activeUploadId !== Number(clip.uploadId)) {
          void seek(t, { autoPlay: false })
          return
        }
        if (Number.isFinite(sourceTime) && Math.abs((base.currentTime || 0) - sourceTime) > 0.25) {
          try { base.currentTime = Math.max(0, sourceTime) } catch {}
        }
        safePause(base)
        return
      }
      if (activeUploadId !== Number(clip.uploadId)) {
        void seek(t, { autoPlay: playingRef.current })
        return
      }
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
    previewVideoLaneEnabled,
    isPreviewAudioLaneOn,
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

  const ensureScreenTitleFonts = useCallback(async (): Promise<ScreenTitleFontFamily[]> => {
    if (screenTitleFontsLoaded) return screenTitleFontFamilies
    try {
      const [fontsRes, fontPresetsRes] = await Promise.all([
        fetch('/api/screen-title-fonts', { credentials: 'same-origin' }),
        fetch('/api/screen-title-font-presets', { credentials: 'same-origin' }),
      ])
      if (fontsRes.ok) {
        const fontsData = (await fontsRes.json().catch(() => null)) as { families?: ScreenTitleFontFamily[] } | null
        const fams = Array.isArray(fontsData?.families) ? fontsData!.families : []
        setScreenTitleFontFamilies(
          fams.map((f) => ({
            familyKey: String((f as any).familyKey || ''),
            label: String((f as any).label || ''),
            variants: Array.isArray((f as any).variants)
              ? (f as any).variants.map((v: any) => ({ key: String(v.key || ''), label: String(v.label || '') }))
              : [],
          }))
        )
      }
      if (fontPresetsRes.ok) {
        const data = (await fontPresetsRes.json().catch(() => null)) as ScreenTitleFontPresetsResponse | null
        if (data && typeof data === 'object' && (data as any).families && typeof (data as any).families === 'object') {
          setScreenTitleFontPresets(data)
        }
      }
    } catch {}
    setScreenTitleFontsLoaded(true)
    return screenTitleFontFamilies
  }, [screenTitleFontFamilies, screenTitleFontsLoaded])

  const ensureScreenTitleGradients = useCallback(async (): Promise<Array<{ key: string; label: string }>> => {
    if (screenTitleGradientsLoaded) return screenTitleGradients
    try {
      const res = await fetch('/api/screen-title-gradients', { credentials: 'same-origin' })
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { gradients?: Array<{ key: string; label: string }> } | null
        const list = Array.isArray(data?.gradients) ? data!.gradients : []
        setScreenTitleGradients(
          list
            .map((g) => ({ key: String((g as any).key || ''), label: String((g as any).label || '') }))
            .filter((g) => g.key)
        )
      }
    } catch {}
    setScreenTitleGradientsLoaded(true)
    return screenTitleGradients
  }, [screenTitleGradients, screenTitleGradientsLoaded])

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

  useEffect(() => {
    if (!screenTitleCustomizeEditor) return
    void ensureScreenTitlePresets()
    void ensureScreenTitleFonts()
    void ensureScreenTitleGradients()
  }, [screenTitleCustomizeEditor, ensureScreenTitlePresets, ensureScreenTitleFonts, ensureScreenTitleGradients])

  useEffect(() => {
    if (!screenTitlePlacementEditor) return
    void ensureScreenTitlePresets()
    void ensureScreenTitleFonts()
    void ensureScreenTitleGradients()
  }, [screenTitlePlacementEditor, ensureScreenTitleFonts, ensureScreenTitleGradients, ensureScreenTitlePresets])

  useEffect(() => {
    if (!screenTitleCustomizeEditor?.id) return
    const stId = String(screenTitleCustomizeEditor.id)
    const activeId = String(screenTitleCustomizeEditor.activeInstanceId || '')
    if (!activeId) return
    setScreenTitleLastInstanceById((prev) => {
      if (prev[stId] === activeId) return prev
      return { ...prev, [stId]: activeId }
    })
  }, [screenTitleCustomizeEditor?.id, screenTitleCustomizeEditor?.activeInstanceId])

  useEffect(() => {
    if (!screenTitlePlacementEditor?.id) return
    const stId = String(screenTitlePlacementEditor.id)
    const activeId = String(screenTitlePlacementEditor.activeInstanceId || '')
    if (!activeId) return
    setScreenTitleLastInstanceById((prev) => {
      if (prev[stId] === activeId) return prev
      return { ...prev, [stId]: activeId }
    })
  }, [screenTitlePlacementEditor?.id, screenTitlePlacementEditor?.activeInstanceId])

  useEffect(() => {
    if (screenTitlePlacementEditor) return
    setScreenTitleMiniPanelTab('placement')
    setScreenTitleStyleAlignMenuOpen(false)
    setScreenTitlePlacementAdvancedOpen(false)
    setScreenTitlePlacementMoveAxis('vertical')
    setScreenTitlePlacementDirty(false)
    screenTitlePlacementPanelDragRef.current = null
    if (screenTitlePlacementPanelStopDragRef.current) {
      screenTitlePlacementPanelStopDragRef.current()
      screenTitlePlacementPanelStopDragRef.current = null
    }
    if (screenTitlePlacementStopDragRef.current) {
      screenTitlePlacementStopDragRef.current()
      screenTitlePlacementStopDragRef.current = null
    }
  }, [screenTitlePlacementEditor])

  useEffect(() => {
    return () => {
      if (screenTitlePlacementPanelStopDragRef.current) {
        screenTitlePlacementPanelStopDragRef.current()
        screenTitlePlacementPanelStopDragRef.current = null
      }
      if (screenTitlePlacementStopDragRef.current) {
        screenTitlePlacementStopDragRef.current()
        screenTitlePlacementStopDragRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!screenTitleStyleAlignMenuOpen) return
    const onPointerDown = (ev: PointerEvent) => {
      const root = screenTitleStyleAlignMenuRef.current
      const target = ev.target as Node | null
      if (root && target && root.contains(target)) return
      setScreenTitleStyleAlignMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [screenTitleStyleAlignMenuOpen])

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

  useEffect(() => {
    if (!screenTitles.length) return
    if (screenTitleFontsLoaded) return
    void ensureScreenTitleFonts()
  }, [ensureScreenTitleFonts, screenTitleFontsLoaded, screenTitles.length])

  const resolveScreenTitleFamilyForFontKey = useCallback(
    (fontKey: string | null) => {
      const key = String(fontKey || '').trim()
      for (const fam of screenTitleFontFamilies) {
        if (fam.variants.some((v) => String(v.key) === key)) return fam
      }
      return screenTitleFontFamilies[0] || null
    },
    [screenTitleFontFamilies]
  )

  const getScreenTitleSizeOptions = useCallback(
    (familyKey: string | null, fontKey: string | null) => {
      const famKey = String(familyKey || '').trim()
      const fontKeyStr = String(fontKey || '').trim()
      const fam = famKey ? screenTitleFontPresets?.families?.[famKey] : null
      return SCREEN_TITLE_SIZE_OPTIONS.map((opt) => {
        const resolved = resolveScreenTitleSizePresetForUi(opt.value, fam as any, fontKeyStr)
        return { key: opt.value, label: opt.label, fontSizePct: Number(resolved.fontSizePct) }
      })
    },
    [screenTitleFontPresets]
  )

  const pickScreenTitleSizeKey = useCallback((fontSizePct: number, options: Array<{ key: string; fontSizePct: number }>) => {
    const fallback = String(
      options.find((opt) => String(opt.key) === '18')?.key || options[0]?.key || '18'
    )
    if (!Number.isFinite(fontSizePct)) return fallback
    let bestKey = fallback
    let bestDist = Number.POSITIVE_INFINITY
    for (const opt of options) {
      const d = Math.abs(Number(opt.fontSizePct) - Number(fontSizePct))
      if (d < bestDist - 1e-6) {
        bestDist = d
        bestKey = opt.key
      }
    }
    return normalizeScreenTitleSizeKey(bestKey, 18)
  }, [])

  const clampClipToTimeline = useCallback(
    (clip: Clip, startSeconds: number) => {
      const maxDur = roundToTenth(Math.max(0, MAX_TIMELINE_SECONDS - startSeconds))
      if (maxDur <= 0.05) return null
      const dur = clipDurationSeconds(clip)
      if (dur > maxDur + 1e-6) {
        const srcStart = Number((clip as any).sourceStartSeconds || 0)
        return { ...(clip as any), sourceEndSeconds: roundToTenth(srcStart + maxDur) } as Clip
      }
      return clip
    },
    [MAX_TIMELINE_SECONDS]
  )

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
	        if (!rippleEnabledRef.current) return insertClipAtPlayhead(prev, newClip, MAX_TIMELINE_SECONDS)
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

	        const capped = clampClipToTimeline(newClip, startSeconds)
	        if (!capped) {
	          setTimelineMessage('Timeline max length reached.')
	          return prev
	        }
	        const placed: Clip = { ...capped, startSeconds }
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

  const addClipFromLibraryClip = useCallback(
    (clip: any) => {
      const uploadId = Number(clip?.upload_id ?? clip?.uploadId)
      const sourceStart = Number(clip?.start_seconds ?? clip?.startSeconds)
      const sourceEnd = Number(clip?.end_seconds ?? clip?.endSeconds)
      if (!Number.isFinite(uploadId) || uploadId <= 0) {
        setTimelineMessage('That clip is missing its source video.')
        return
      }
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || !(sourceEnd > sourceStart)) {
        setTimelineMessage('That clip has an invalid time range.')
        return
      }
      const srcDur = clip?.duration_seconds != null ? Number(clip.duration_seconds) : null
      if (srcDur != null && Number.isFinite(srcDur) && srcDur > 0) {
        setDurationsByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: srcDur }))
      }
      try {
        const w = clip?.width != null ? Number(clip.width) : null
        const h = clip?.height != null ? Number(clip.height) : null
        if (w != null && h != null && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          setDimsByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: { width: Math.round(w), height: Math.round(h) } }))
        }
      } catch {}
      const id = `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const newClip: Clip = {
        id,
        uploadId,
        sourceStartSeconds: roundToTenth(sourceStart),
        sourceEndSeconds: roundToTenth(sourceEnd),
        audioEnabled: true,
      }
      snapshotUndo()
      setTimeline((prev) => {
        if (!rippleEnabledRef.current) return insertClipAtPlayhead(prev, newClip, MAX_TIMELINE_SECONDS)
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

        const capped = clampClipToTimeline(newClip, startSeconds)
        if (!capped) {
          setTimelineMessage('Timeline max length reached.')
          return prev
        }
        const placed: Clip = { ...capped, startSeconds }
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
      setSelectedScreenTitleId(null)
      setSelectedNarrationId(null)
      setSelectedStillId(null)
      setSelectedAudioId(null)
    },
    [computeTotalSecondsForTimeline, extendViewportEndSecondsIfNeeded, insertClipAtPlayhead, rippleRightBaseLane, snapshotUndo]
  )

  const addVideoOverlayFromLibraryClip = useCallback(
    (clip: any) => {
      const uploadId = Number(clip?.upload_id ?? clip?.uploadId)
      const sourceStart = Number(clip?.start_seconds ?? clip?.startSeconds)
      const sourceEnd = Number(clip?.end_seconds ?? clip?.endSeconds)
      if (!Number.isFinite(uploadId) || uploadId <= 0) {
        setTimelineMessage('That clip is missing its source video.')
        return
      }
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || !(sourceEnd > sourceStart)) {
        setTimelineMessage('That clip has an invalid time range.')
        return
      }
      const srcDur = clip?.duration_seconds != null ? Number(clip.duration_seconds) : null
      if (srcDur != null && Number.isFinite(srcDur) && srcDur > 0) {
        setDurationsByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: srcDur }))
      }
      try {
        const w = clip?.width != null ? Number(clip.width) : null
        const h = clip?.height != null ? Number(clip.height) : null
        if (w != null && h != null && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          setDimsByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: { width: Math.round(w), height: Math.round(h) } }))
        }
      } catch {}
      const id = `vo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const overlay: VideoOverlay = {
        id,
        uploadId,
        sourceStartSeconds: roundToTenth(sourceStart),
        sourceEndSeconds: roundToTenth(sourceEnd),
        sizePctWidth: 90,
        position: 'bottom_center',
        audioEnabled: true,
        plateStyle: 'none',
        plateColor: '#000000',
        plateOpacityPct: 85,
      }
      snapshotUndo()
      setTimeline((prev) => {
        if (!rippleEnabledRef.current) return insertVideoOverlayAtPlayhead(prev as any, overlay as any, MAX_TIMELINE_SECONDS) as any
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
        const capped = clampClipToTimeline(overlay as any, startSeconds)
        if (!capped) {
          setTimelineMessage('Timeline max length reached.')
          return prev
        }
        const placed: any = { ...(capped as any), startSeconds }
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
        if (!rippleEnabledRef.current) return insertVideoOverlayAtPlayhead(prev as any, overlay as any, MAX_TIMELINE_SECONDS) as any
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
        const capped = clampClipToTimeline(overlay as any, startSeconds)
        if (!capped) {
          setTimelineMessage('Timeline max length reached.')
          return prev
        }
        const placed: any = { ...(capped as any), startSeconds }
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
        fadeDurationMs: 600,
        animate: 'none',
        animateDurationMs: 600,
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
    (preset: ScreenTitlePresetItem, opts?: { openEditor?: boolean }) => {
      const openEditor = opts?.openEditor !== false
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
          : String((preset as any).style || 'none').toLowerCase() === 'merged_pill'
            ? 'merged_pill'
            : String((preset as any).style || 'none').toLowerCase() === 'strip'
              ? 'pill'
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
        customStyle: null,
        instances: [{ id: `${id}_i1`, text: '', customStyle: null }],
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
      if (openEditor) {
        setScreenTitleEditor({ id, start, end })
        setScreenTitleEditorError(null)
      }
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
	      const seg: Narration = { id, uploadId, startSeconds: start, endSeconds: end, sourceStartSeconds: 0, boostDb: 0, audioEnabled: true }
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
      const clipId = Number(String(qp.get('cvPickClipId') || '0'))
      const targetClipIdRaw = String(qp.get('cvPickTargetClipId') || '').trim()
      return {
        type,
        uploadId: Number.isFinite(uploadId) && uploadId > 0 ? uploadId : null,
        configId: Number.isFinite(configId) && configId > 0 ? configId : null,
        audioConfigId: Number.isFinite(audioConfigId) && audioConfigId > 0 ? audioConfigId : null,
        presetId: Number.isFinite(presetId) && presetId > 0 ? presetId : null,
        clipId: Number.isFinite(clipId) && clipId > 0 ? clipId : null,
        targetClipId: targetClipIdRaw || null,
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
        url.searchParams.delete('cvPickClipId')
        url.searchParams.delete('cvPickTargetClipId')
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

    const fetchClip = async (id: number): Promise<any | null> => {
      const res = await fetch(`/api/library/clips/${encodeURIComponent(String(id))}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) return null
      const clip = json?.clip && typeof json.clip === 'object' ? json.clip : json
      return clip && typeof clip === 'object' ? clip : null
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
        if (t === 'clip' && pickFromAssets.clipId) {
          const clip = await fetchClip(pickFromAssets.clipId)
          if (clip) {
            addClipFromLibraryClip(clip as any)
            const uploadId = Number((clip as any).upload_id || (clip as any).uploadId)
            if (Number.isFinite(uploadId) && uploadId > 0) void markVideoUsed(uploadId)
          }
        } else if (t === 'videoOverlayClip' && pickFromAssets.clipId) {
          const clip = await fetchClip(pickFromAssets.clipId)
          if (clip) {
            addVideoOverlayFromLibraryClip(clip as any)
            const uploadId = Number((clip as any).upload_id || (clip as any).uploadId)
            if (Number.isFinite(uploadId) && uploadId > 0) void markVideoUsed(uploadId)
          }
        } else if (t === 'video' && pickFromAssets.uploadId) {
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
        } else if (t === 'timelineBackground' && pickFromAssets.uploadId) {
          const up = await fetchUpload(pickFromAssets.uploadId)
          if (up && String((up as any).kind || '').toLowerCase() === 'image') {
            const pickedId = Number(pickFromAssets.uploadId)
            const pickedName = String((up as any).modified_filename || (up as any).original_filename || '').trim()
            const pickedW = Number((up as any).width)
            const pickedH = Number((up as any).height)
            if (pickedName) {
              setNamesByUploadId((prev) => ({ ...prev, [pickedId]: pickedName }))
            }
            if (Number.isFinite(pickedW) && Number.isFinite(pickedH) && pickedW > 0 && pickedH > 0) {
              setDimsByUploadId((prev) => ({ ...prev, [pickedId]: { width: Math.round(pickedW), height: Math.round(pickedH) } }))
            }
            snapshotUndo()
            setTimeline((prev) => ({
              ...(prev as any),
              timelineBackgroundMode: 'image',
              timelineBackgroundUploadId: Number(pickFromAssets.uploadId),
            }) as any)
            void markGraphicUsed(pickFromAssets.uploadId)
          }
        } else if (t === 'clipBackground' && pickFromAssets.uploadId) {
          const up = await fetchUpload(pickFromAssets.uploadId)
          if (up && String((up as any).kind || '').toLowerCase() === 'image') {
            const pickedId = Number(pickFromAssets.uploadId)
            const pickedName = String((up as any).modified_filename || (up as any).original_filename || '').trim()
            const pickedW = Number((up as any).width)
            const pickedH = Number((up as any).height)
            if (pickedName) {
              setNamesByUploadId((prev) => ({ ...prev, [pickedId]: pickedName }))
            }
            if (Number.isFinite(pickedW) && Number.isFinite(pickedH) && pickedW > 0 && pickedH > 0) {
              setDimsByUploadId((prev) => ({ ...prev, [pickedId]: { width: Math.round(pickedW), height: Math.round(pickedH) } }))
            }
            const targetClipId = String((pickFromAssets as any).targetClipId || (clipEditor as any)?.id || selectedClipId || '').trim()
            if (targetClipId) {
              snapshotUndo()
              setTimeline((prev) => ({
                ...(prev as any),
                clips: (Array.isArray((prev as any).clips) ? ((prev as any).clips as any[]) : []).map((c: any) =>
                  String((c as any).id) === targetClipId
                    ? ({
                        ...(c as any),
                        bgFillStyle: 'image',
                        bgFillImageUploadId: Number(pickFromAssets.uploadId),
                      } as any)
                    : c
                ),
              }) as any)
              setSelectedClipId(targetClipId)
            }
            setClipEditor((prev) =>
              prev && String((prev as any).id) === targetClipId
                ? ({
                    ...(prev as any),
                    bgFillStyle: 'image',
                    bgFillImageUploadId: Number(pickFromAssets.uploadId),
                  } as any)
                : prev
            )
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
          if (preset) addScreenTitleFromPreset(preset as any, { openEditor: false })
        }
      } finally {
        cleanUrl()
      }
    })()
  }, [
    addAudioFromUpload,
    addAudioFromUploadWithConfig,
    addClipFromLibraryClip,
    addClipFromUpload,
    addVideoOverlayFromLibraryClip,
    addVideoOverlayFromUpload,
    addGraphicFromUpload,
    addLogoFromPick,
    addLowerThirdFromPick,
    addNarrationFromUpload,
    addScreenTitleFromPreset,
    ensureAudioConfigs,
    ensureLowerThirdConfigs,
    ensureScreenTitlePresets,
    clipEditor,
    loading,
    pickFromAssets,
    project?.id,
    selectedClipId,
    snapshotUndo,
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
      audioEnabled: (selectedAudioSegment as any).audioEnabled !== false,
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
      const audioEnabled = Boolean(audioEditor.audioEnabled)
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
        audioEnabled,
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

  const getTimelineCtxSegmentEnd = useCallback(
    (kind: TimelineCtxKind, id: string): number | null => {
      const targetId = String(id || '')
      if (!targetId) return null
      if (kind === 'clip') {
        const idx = timeline.clips.findIndex((c) => String(c?.id) === targetId)
        if (idx < 0) return null
        const start = roundToTenth(Number(clipStarts[idx] || 0))
        return roundToTenth(start + clipDurationSeconds(timeline.clips[idx] as any))
      }
      if (kind === 'still') {
        const seg = (Array.isArray((timeline as any).stills) ? (timeline as any).stills : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      if (kind === 'videoOverlay') {
        const list: any[] = Array.isArray((timeline as any).videoOverlays) ? (timeline as any).videoOverlays : []
        const idx = list.findIndex((s: any) => String(s?.id) === targetId)
        if (idx < 0) return null
        const start = roundToTenth(Number((videoOverlayStarts as any)[idx] || 0))
        return roundToTenth(start + clipDurationSeconds(list[idx] as any))
      }
      if (kind === 'videoOverlayStill') {
        const seg = (Array.isArray((timeline as any).videoOverlayStills) ? (timeline as any).videoOverlayStills : []).find(
          (s: any) => String(s?.id) === targetId
        )
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      if (kind === 'graphic') {
        const seg = (Array.isArray((timeline as any).graphics) ? (timeline as any).graphics : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      if (kind === 'logo') {
        const seg = (Array.isArray((timeline as any).logos) ? (timeline as any).logos : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      if (kind === 'lowerThird') {
        const seg = (Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      if (kind === 'screenTitle') {
        const seg = (Array.isArray((timeline as any).screenTitles) ? (timeline as any).screenTitles : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      if (kind === 'narration') {
        const seg = (Array.isArray((timeline as any).narration) ? (timeline as any).narration : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      if (kind === 'audioSegment') {
        const seg = (Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : []).find(
          (s: any) => String(s?.id) === targetId
        )
        if (!seg) return null
        return roundToTenth(Number((seg as any).endSeconds || 0))
      }
      return null
    },
    [clipStarts, timeline, videoOverlayStarts]
  )

  const getTimelineCtxSegmentStart = useCallback(
    (kind: TimelineCtxKind, id: string): number | null => {
      const targetId = String(id || '')
      if (!targetId) return null
      if (kind === 'clip') {
        const idx = timeline.clips.findIndex((c: any) => String(c?.id) === targetId)
        if (idx < 0) return null
        return roundToTenth(Number((clipStarts as any)[idx] || 0))
      }
      if (kind === 'still') {
        const seg = (Array.isArray((timeline as any).stills) ? (timeline as any).stills : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      if (kind === 'videoOverlay') {
        const list: any[] = Array.isArray((timeline as any).videoOverlays) ? (timeline as any).videoOverlays : []
        const idx = list.findIndex((s: any) => String(s?.id) === targetId)
        if (idx < 0) return null
        return roundToTenth(Number((videoOverlayStarts as any)[idx] || 0))
      }
      if (kind === 'videoOverlayStill') {
        const seg = (Array.isArray((timeline as any).videoOverlayStills) ? (timeline as any).videoOverlayStills : []).find(
          (s: any) => String(s?.id) === targetId
        )
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      if (kind === 'graphic') {
        const seg = (Array.isArray((timeline as any).graphics) ? (timeline as any).graphics : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      if (kind === 'logo') {
        const seg = (Array.isArray((timeline as any).logos) ? (timeline as any).logos : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      if (kind === 'lowerThird') {
        const seg = (Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      if (kind === 'screenTitle') {
        const seg = (Array.isArray((timeline as any).screenTitles) ? (timeline as any).screenTitles : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      if (kind === 'narration') {
        const seg = (Array.isArray((timeline as any).narration) ? (timeline as any).narration : []).find((s: any) => String(s?.id) === targetId)
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      if (kind === 'audioSegment') {
        const seg = (Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : []).find(
          (s: any) => String(s?.id) === targetId
        )
        if (!seg) return null
        return roundToTenth(Number((seg as any).startSeconds || 0))
      }
      return null
    },
    [clipStarts, timeline, videoOverlayStarts]
  )

  const applyTimelineExpandEndAction = useCallback(
    (kind: TimelineCtxKind, id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const laneEnd = roundToTenth(Math.max(0, Number(totalSeconds) || 0))
      if (!(laneEnd > 0)) return
      const rippleOn = Boolean(rippleEnabledRef.current)
      const eps = 1e-6
      const noRoomMessage = 'No room to expand on this lane.'

      const computeTargetAndPlacements = (
        targetEnd0: number,
        rightSegs: Array<{ key: string; start: number; end: number; dur: number }>
      ): { targetEnd: number; placements: Map<string, { start: number; end: number }>; movedRight: boolean; message: string | null } => {
        const placements = new Map<string, { start: number; end: number }>()
        let movedRight = false
        let targetEnd = roundToTenth(targetEnd0)

        if (rippleOn) {
          if (rightSegs.length > 0) {
            const totalRightDur = roundToTenth(rightSegs.reduce((sum, seg) => sum + Math.max(0, Number(seg.dur) || 0), 0))
            const packedStart = roundToTenth(laneEnd - totalRightDur)
            if (packedStart < targetEnd0 - eps) {
              return { targetEnd: targetEnd0, placements, movedRight, message: 'No room to expand to timeline end on this lane.' }
            }
            targetEnd = packedStart
            let cursor = packedStart
            for (const seg of rightSegs) {
              const ns = roundToTenth(cursor)
              const ne = roundToTenth(ns + seg.dur)
              if (Math.abs(ns - seg.start) > eps || Math.abs(ne - seg.end) > eps) movedRight = true
              placements.set(seg.key, { start: ns, end: ne })
              cursor = ne
            }
          } else {
            targetEnd = laneEnd
          }
        } else {
          if (rightSegs.length > 0) {
            targetEnd = Math.min(laneEnd, roundToTenth(Number(rightSegs[0].start || laneEnd)))
          } else {
            targetEnd = laneEnd
          }
        }
        return { targetEnd: roundToTenth(clamp(targetEnd, 0, laneEnd)), placements, movedRight, message: null }
      }

      const applySimpleLane = (
        itemsRaw: any[],
        minLen: number,
        canExtend?: (item: any, targetEnd: number) => string | null
      ): { items: any[]; changed: boolean; message: string | null } => {
        const items = (itemsRaw || [])
          .map((seg: any) => ({
            ...(seg as any),
            startSeconds: roundToTenth(Number((seg as any).startSeconds || 0)),
            endSeconds: roundToTenth(Number((seg as any).endSeconds || 0)),
          }))
          .filter((seg: any) => Number(seg.endSeconds) > Number(seg.startSeconds))
        const sorted = items
          .slice()
          .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
        const idx = sorted.findIndex((seg: any) => String(seg?.id) === targetId)
        if (idx < 0) return { items: itemsRaw || [], changed: false, message: null }
        const target = sorted[idx] as any
        const targetStart = roundToTenth(Number(target.startSeconds || 0))
        const targetEnd0 = roundToTenth(Number(target.endSeconds || 0))
        const rightSegs = sorted
          .slice(idx + 1)
          .filter((seg: any) => Number(seg.startSeconds || 0) >= targetEnd0 - eps)
          .map((seg: any) => ({
            key: String(seg.id),
            start: roundToTenth(Number(seg.startSeconds || 0)),
            end: roundToTenth(Number(seg.endSeconds || 0)),
            dur: roundToTenth(Math.max(0, Number(seg.endSeconds || 0) - Number(seg.startSeconds || 0))),
          }))

        const packed = computeTargetAndPlacements(targetEnd0, rightSegs)
        if (packed.message) return { items: itemsRaw || [], changed: false, message: packed.message }
        const targetEnd = packed.targetEnd
        if (targetEnd < targetStart + minLen - eps) {
          return { items: itemsRaw || [], changed: false, message: 'Resulting duration is too small.' }
        }
        if (canExtend) {
          const err = canExtend(target, targetEnd)
          if (err) return { items: itemsRaw || [], changed: false, message: err }
        }
        const didExtend = targetEnd > targetEnd0 + eps
        if (!didExtend && !packed.movedRight) {
          return { items: itemsRaw || [], changed: false, message: targetEnd0 >= laneEnd - eps ? 'Already at timeline end.' : noRoomMessage }
        }

        const next = items.slice()
        for (let i = 0; i < next.length; i++) {
          const cur = next[i] as any
          const placement = packed.placements.get(String(cur.id))
          if (placement) {
            next[i] = { ...(cur as any), startSeconds: placement.start, endSeconds: placement.end }
          }
        }
        const ti = next.findIndex((seg: any) => String(seg?.id) === targetId)
        if (ti < 0) return { items: itemsRaw || [], changed: false, message: null }
        next[ti] = { ...(next[ti] as any), endSeconds: targetEnd }
        next.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
        return { items: next, changed: true, message: null }
      }

      let nextTimeline: any | null = null
      let message: string | null = null

      if (kind === 'clip' || kind === 'still') {
        const nextClips = timeline.clips.map((clip, i) => ({ ...clip, startSeconds: roundToTenth(Number(clipStarts[i] || 0)) }))
        const nextStills = (Array.isArray((timeline as any).stills) ? (timeline as any).stills : []).map((s: any) => ({
          ...(s as any),
          startSeconds: roundToTenth(Number((s as any).startSeconds || 0)),
          endSeconds: roundToTenth(Number((s as any).endSeconds || 0)),
        }))

        const segments: Array<{ key: string; kind: 'clip' | 'still'; id: string; start: number; end: number; dur: number }> = []
        for (const c of nextClips as any[]) {
          const start = roundToTenth(Number((c as any).startSeconds || 0))
          const dur = roundToTenth(Math.max(0.2, clipDurationSeconds(c as any)))
          const end = roundToTenth(start + dur)
          if (end > start) segments.push({ key: `clip:${String((c as any).id)}`, kind: 'clip', id: String((c as any).id), start, end, dur })
        }
        for (const s of nextStills as any[]) {
          const start = roundToTenth(Number((s as any).startSeconds || 0))
          const end = roundToTenth(Number((s as any).endSeconds || 0))
          const dur = roundToTenth(Math.max(0, end - start))
          if (end > start) segments.push({ key: `still:${String((s as any).id)}`, kind: 'still', id: String((s as any).id), start, end, dur })
        }
        segments.sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key))
        const targetLaneKind: 'clip' | 'still' = kind === 'clip' ? 'clip' : 'still'
        const targetIdx = segments.findIndex((seg) => seg.kind === targetLaneKind && seg.id === targetId)
        if (targetIdx < 0) return
        const target = segments[targetIdx]
        const rightSegs = segments.slice(targetIdx + 1).filter((seg) => seg.start >= target.end - eps)
        const packed = computeTargetAndPlacements(target.end, rightSegs)
        if (packed.message) {
          setTimelineMessage(packed.message)
          return
        }
        const targetEnd = packed.targetEnd
        const didExtend = targetEnd > target.end + eps
        if (!didExtend && !packed.movedRight) {
          setTimelineMessage(target.end >= laneEnd - eps ? 'Already at timeline end.' : noRoomMessage)
          return
        }

        for (const seg of rightSegs) {
          const placement = packed.placements.get(seg.key)
          if (!placement) continue
          if (seg.kind === 'clip') {
            const ci = nextClips.findIndex((c: any) => String(c?.id) === seg.id)
            if (ci >= 0) nextClips[ci] = { ...(nextClips[ci] as any), startSeconds: placement.start }
          } else {
            const si = nextStills.findIndex((s: any) => String(s?.id) === seg.id)
            if (si >= 0) nextStills[si] = { ...(nextStills[si] as any), startSeconds: placement.start, endSeconds: placement.end }
          }
        }

        if (targetLaneKind === 'clip') {
          const ci = nextClips.findIndex((c: any) => String(c?.id) === target.id)
          if (ci < 0) return
          const clip0: any = nextClips[ci]
          const sourceStart = roundToTenth(Number((clip0 as any).sourceStartSeconds || 0))
          const sourceEnd0 = roundToTenth(Number((clip0 as any).sourceEndSeconds || 0))
          const sourceMaxRaw = durationsByUploadId[Number((clip0 as any).uploadId)] ?? sourceEnd0
          const sourceMax = roundToTenth(Math.max(0, Number(sourceMaxRaw) || 0))
          const desiredDur = roundToTenth(targetEnd - target.start)
          if (!(desiredDur > 0.2)) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          const desiredSourceEnd = roundToTenth(sourceStart + desiredDur)
          if (desiredSourceEnd > sourceMax + eps) {
            setTimelineMessage('No more source video available to expand to timeline end.')
            return
          }
          nextClips[ci] = {
            ...(clip0 as any),
            sourceEndSeconds: roundToTenth(clamp(desiredSourceEnd, sourceStart + 0.2, sourceMax)),
          }
        } else {
          const si = nextStills.findIndex((s: any) => String(s?.id) === target.id)
          if (si < 0) return
          const start = roundToTenth(Number((nextStills[si] as any).startSeconds || 0))
          if (!(targetEnd > start + 0.1 - eps)) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          nextStills[si] = { ...(nextStills[si] as any), endSeconds: targetEnd }
        }

        nextClips.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextStills.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextTimeline = { ...(timeline as any), clips: nextClips, stills: nextStills }
      } else if (kind === 'videoOverlay' || kind === 'videoOverlayStill') {
        const prevOs: any[] = Array.isArray((timeline as any).videoOverlays) ? (timeline as any).videoOverlays : []
        const nextOverlays = prevOs.map((o: any, i: number) => ({ ...(o as any), startSeconds: roundToTenth(Number((videoOverlayStarts as any)[i] || 0)) }))
        const nextOverlayStills = (Array.isArray((timeline as any).videoOverlayStills) ? (timeline as any).videoOverlayStills : []).map((s: any) => ({
          ...(s as any),
          startSeconds: roundToTenth(Number((s as any).startSeconds || 0)),
          endSeconds: roundToTenth(Number((s as any).endSeconds || 0)),
        }))
        const segments: Array<
          { key: string; kind: 'videoOverlay'; id: string; start: number; end: number; dur: number } | { key: string; kind: 'videoOverlayStill'; id: string; start: number; end: number; dur: number }
        > = []
        for (const o of nextOverlays as any[]) {
          const start = roundToTenth(Number((o as any).startSeconds || 0))
          const dur = roundToTenth(Math.max(0.2, clipDurationSeconds(o as any)))
          const end = roundToTenth(start + dur)
          if (end > start) segments.push({ key: `videoOverlay:${String((o as any).id)}`, kind: 'videoOverlay', id: String((o as any).id), start, end, dur })
        }
        for (const s of nextOverlayStills as any[]) {
          const start = roundToTenth(Number((s as any).startSeconds || 0))
          const end = roundToTenth(Number((s as any).endSeconds || 0))
          const dur = roundToTenth(Math.max(0, end - start))
          if (end > start) {
            segments.push({ key: `videoOverlayStill:${String((s as any).id)}`, kind: 'videoOverlayStill', id: String((s as any).id), start, end, dur })
          }
        }
        segments.sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key))
        const targetLaneKind: 'videoOverlay' | 'videoOverlayStill' = kind === 'videoOverlay' ? 'videoOverlay' : 'videoOverlayStill'
        const targetIdx = segments.findIndex((seg) => seg.kind === targetLaneKind && seg.id === targetId)
        if (targetIdx < 0) return
        const target = segments[targetIdx]
        const rightSegs = segments.slice(targetIdx + 1).filter((seg) => seg.start >= target.end - eps)
        const packed = computeTargetAndPlacements(target.end, rightSegs)
        if (packed.message) {
          setTimelineMessage(packed.message)
          return
        }
        const targetEnd = packed.targetEnd
        const didExtend = targetEnd > target.end + eps
        if (!didExtend && !packed.movedRight) {
          setTimelineMessage(target.end >= laneEnd - eps ? 'Already at timeline end.' : noRoomMessage)
          return
        }

        for (const seg of rightSegs) {
          const placement = packed.placements.get(seg.key)
          if (!placement) continue
          if (seg.kind === 'videoOverlay') {
            const oi = nextOverlays.findIndex((o: any) => String(o?.id) === seg.id)
            if (oi >= 0) nextOverlays[oi] = { ...(nextOverlays[oi] as any), startSeconds: placement.start }
          } else {
            const si = nextOverlayStills.findIndex((s: any) => String(s?.id) === seg.id)
            if (si >= 0) nextOverlayStills[si] = { ...(nextOverlayStills[si] as any), startSeconds: placement.start, endSeconds: placement.end }
          }
        }

        if (targetLaneKind === 'videoOverlay') {
          const oi = nextOverlays.findIndex((o: any) => String(o?.id) === target.id)
          if (oi < 0) return
          const overlay0: any = nextOverlays[oi]
          const sourceStart = roundToTenth(Number((overlay0 as any).sourceStartSeconds || 0))
          const sourceEnd0 = roundToTenth(Number((overlay0 as any).sourceEndSeconds || 0))
          const sourceMaxRaw = durationsByUploadId[Number((overlay0 as any).uploadId)] ?? sourceEnd0
          const sourceMax = roundToTenth(Math.max(0, Number(sourceMaxRaw) || 0))
          const desiredDur = roundToTenth(targetEnd - target.start)
          if (!(desiredDur > 0.2)) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          const desiredSourceEnd = roundToTenth(sourceStart + desiredDur)
          if (desiredSourceEnd > sourceMax + eps) {
            setTimelineMessage('No more source video available to expand to timeline end.')
            return
          }
          nextOverlays[oi] = {
            ...(overlay0 as any),
            sourceEndSeconds: roundToTenth(clamp(desiredSourceEnd, sourceStart + 0.2, sourceMax)),
          }
        } else {
          const si = nextOverlayStills.findIndex((s: any) => String(s?.id) === target.id)
          if (si < 0) return
          const start = roundToTenth(Number((nextOverlayStills[si] as any).startSeconds || 0))
          if (!(targetEnd > start + 0.1 - eps)) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          nextOverlayStills[si] = { ...(nextOverlayStills[si] as any), endSeconds: targetEnd }
        }

        nextOverlays.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextOverlayStills.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextTimeline = { ...(timeline as any), videoOverlays: nextOverlays, videoOverlayStills: nextOverlayStills }
      } else if (kind === 'graphic') {
        const res = applySimpleLane(Array.isArray((timeline as any).graphics) ? (timeline as any).graphics : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), graphics: res.items }
      } else if (kind === 'logo') {
        const res = applySimpleLane(Array.isArray((timeline as any).logos) ? (timeline as any).logos : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), logos: res.items }
      } else if (kind === 'lowerThird') {
        const res = applySimpleLane(Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) {
          const prevSeg = (Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : []).find(
            (s: any) => String((s as any)?.id) === targetId
          ) as any
          const nextItems = (res.items || []).map((s: any) => {
            if (String((s as any)?.id) !== targetId) return s
            return maybePromoteLowerThirdTimingOnExpand(prevSeg, s)
          })
          nextTimeline = { ...(timeline as any), lowerThirds: nextItems }
        }
      } else if (kind === 'screenTitle') {
        const res = applySimpleLane(Array.isArray((timeline as any).screenTitles) ? (timeline as any).screenTitles : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), screenTitles: res.items }
      } else if (kind === 'narration') {
        const res = applySimpleLane(Array.isArray((timeline as any).narration) ? (timeline as any).narration : [], 0.2, (seg, targetEnd) => {
          const sourceStart = roundToTenth(Number((seg as any).sourceStartSeconds || 0))
          const totalRaw = durationsByUploadId[Number((seg as any).uploadId)] ?? 0
          const total = roundToTenth(Math.max(0, Number(totalRaw) || 0))
          if (total > 0) {
            const requested = roundToTenth(Math.max(0, targetEnd - Number((seg as any).startSeconds || 0)))
            const maxLen = roundToTenth(Math.max(0, total - sourceStart))
            if (requested > maxLen + eps) return 'No more source audio available to expand to timeline end.'
          }
          return null
        })
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), narration: res.items }
      } else if (kind === 'audioSegment') {
        const res = applySimpleLane(Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : [], 0.2, (seg, targetEnd) => {
          const sourceStart = roundToTenth(Number((seg as any).sourceStartSeconds || 0))
          const totalRaw = durationsByUploadId[Number((seg as any).uploadId)] ?? 0
          const total = roundToTenth(Math.max(0, Number(totalRaw) || 0))
          if (total > 0) {
            const requested = roundToTenth(Math.max(0, targetEnd - Number((seg as any).startSeconds || 0)))
            const maxLen = roundToTenth(Math.max(0, total - sourceStart))
            if (requested > maxLen + eps) return 'No more source audio available to expand to timeline end.'
          }
          return null
        })
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), audioSegments: res.items, audioTrack: null }
      }

      if (message) {
        setTimelineMessage(message)
        return
      }
      if (!nextTimeline) return
      snapshotUndo()
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [clipStarts, durationsByUploadId, playhead, saveTimelineNow, snapshotUndo, timeline, totalSeconds, videoOverlayStarts]
  )

  const applyTimelineExpandStartAction = useCallback(
    (kind: TimelineCtxKind, id: string) => {
      const targetId = String(id || '')
      if (!targetId) return
      const laneStart = 0
      const rippleOn = Boolean(rippleEnabledRef.current)
      const eps = 1e-6
      const noRoomMessage = 'No room to expand on this lane.'

      const computeTargetAndPlacements = (
        targetStart0: number,
        leftSegs: Array<{ key: string; start: number; end: number; dur: number }>
      ): { targetStart: number; placements: Map<string, { start: number; end: number }>; movedLeft: boolean; message: string | null } => {
        const placements = new Map<string, { start: number; end: number }>()
        let movedLeft = false
        let targetStart = roundToTenth(targetStart0)

        if (rippleOn) {
          if (leftSegs.length > 0) {
            const totalLeftDur = roundToTenth(leftSegs.reduce((sum, seg) => sum + Math.max(0, Number(seg.dur) || 0), 0))
            const packedEnd = roundToTenth(totalLeftDur)
            if (packedEnd > targetStart0 + eps) {
              return { targetStart: targetStart0, placements, movedLeft, message: 'No room to expand to timeline start on this lane.' }
            }
            targetStart = packedEnd
            let cursor = laneStart
            for (const seg of leftSegs) {
              const ns = roundToTenth(cursor)
              const ne = roundToTenth(ns + seg.dur)
              if (Math.abs(ns - seg.start) > eps || Math.abs(ne - seg.end) > eps) movedLeft = true
              placements.set(seg.key, { start: ns, end: ne })
              cursor = ne
            }
          } else {
            targetStart = laneStart
          }
        } else {
          if (leftSegs.length > 0) {
            targetStart = roundToTenth(Math.max(laneStart, leftSegs[leftSegs.length - 1].end))
          } else {
            targetStart = laneStart
          }
        }
        return { targetStart: roundToTenth(clamp(targetStart, laneStart, Math.max(laneStart, Number(totalSeconds) || 0))), placements, movedLeft, message: null }
      }

      const applySimpleLaneStart = (
        itemsRaw: any[],
        minLen: number,
        canExtend?: (item: any, targetStart: number) => string | null
      ): { items: any[]; changed: boolean; message: string | null } => {
        const items = (itemsRaw || [])
          .map((seg: any) => ({
            ...(seg as any),
            startSeconds: roundToTenth(Number((seg as any).startSeconds || 0)),
            endSeconds: roundToTenth(Number((seg as any).endSeconds || 0)),
          }))
          .filter((seg: any) => Number(seg.endSeconds) > Number(seg.startSeconds))
        const sorted = items
          .slice()
          .sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
        const idx = sorted.findIndex((seg: any) => String(seg?.id) === targetId)
        if (idx < 0) return { items: itemsRaw || [], changed: false, message: null }
        const target = sorted[idx] as any
        const targetStart0 = roundToTenth(Number(target.startSeconds || 0))
        const targetEnd0 = roundToTenth(Number(target.endSeconds || 0))
        const leftSegs = sorted
          .slice(0, idx)
          .filter((seg: any) => Number(seg.endSeconds || 0) <= targetStart0 + eps)
          .map((seg: any) => ({
            key: String(seg.id),
            start: roundToTenth(Number(seg.startSeconds || 0)),
            end: roundToTenth(Number(seg.endSeconds || 0)),
            dur: roundToTenth(Math.max(0, Number(seg.endSeconds || 0) - Number(seg.startSeconds || 0))),
          }))

        const packed = computeTargetAndPlacements(targetStart0, leftSegs)
        if (packed.message) return { items: itemsRaw || [], changed: false, message: packed.message }
        const targetStart = packed.targetStart
        if (targetStart > targetEnd0 - minLen + eps) {
          return { items: itemsRaw || [], changed: false, message: 'Resulting duration is too small.' }
        }
        if (canExtend) {
          const err = canExtend(target, targetStart)
          if (err) return { items: itemsRaw || [], changed: false, message: err }
        }
        const didExtend = targetStart < targetStart0 - eps
        if (!didExtend && !packed.movedLeft) {
          return { items: itemsRaw || [], changed: false, message: targetStart0 <= laneStart + eps ? 'Already at timeline start.' : noRoomMessage }
        }

        const next = items.slice()
        for (let i = 0; i < next.length; i++) {
          const cur = next[i] as any
          const placement = packed.placements.get(String(cur.id))
          if (placement) {
            next[i] = { ...(cur as any), startSeconds: placement.start, endSeconds: placement.end }
          }
        }
        const ti = next.findIndex((seg: any) => String(seg?.id) === targetId)
        if (ti < 0) return { items: itemsRaw || [], changed: false, message: null }
        next[ti] = { ...(next[ti] as any), startSeconds: targetStart }
        next.sort((a: any, b: any) => Number(a.startSeconds) - Number(b.startSeconds) || String(a.id).localeCompare(String(b.id)))
        return { items: next, changed: true, message: null }
      }

      let nextTimeline: any | null = null
      let message: string | null = null

      if (kind === 'clip' || kind === 'still') {
        const nextClips = timeline.clips.map((clip, i) => ({ ...clip, startSeconds: roundToTenth(Number(clipStarts[i] || 0)) }))
        const nextStills = (Array.isArray((timeline as any).stills) ? (timeline as any).stills : []).map((s: any) => ({
          ...(s as any),
          startSeconds: roundToTenth(Number((s as any).startSeconds || 0)),
          endSeconds: roundToTenth(Number((s as any).endSeconds || 0)),
        }))

        const segments: Array<{ key: string; kind: 'clip' | 'still'; id: string; start: number; end: number; dur: number }> = []
        for (const c of nextClips as any[]) {
          const start = roundToTenth(Number((c as any).startSeconds || 0))
          const dur = roundToTenth(Math.max(0.2, clipDurationSeconds(c as any)))
          const end = roundToTenth(start + dur)
          if (end > start) segments.push({ key: `clip:${String((c as any).id)}`, kind: 'clip', id: String((c as any).id), start, end, dur })
        }
        for (const s of nextStills as any[]) {
          const start = roundToTenth(Number((s as any).startSeconds || 0))
          const end = roundToTenth(Number((s as any).endSeconds || 0))
          const dur = roundToTenth(Math.max(0, end - start))
          if (end > start) segments.push({ key: `still:${String((s as any).id)}`, kind: 'still', id: String((s as any).id), start, end, dur })
        }
        segments.sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key))
        const targetLaneKind: 'clip' | 'still' = kind === 'clip' ? 'clip' : 'still'
        const targetIdx = segments.findIndex((seg) => seg.kind === targetLaneKind && seg.id === targetId)
        if (targetIdx < 0) return
        const target = segments[targetIdx]
        const leftSegs = segments.slice(0, targetIdx).filter((seg) => seg.end <= target.start + eps)
        const packed = computeTargetAndPlacements(target.start, leftSegs)
        if (packed.message) {
          setTimelineMessage(packed.message)
          return
        }
        const targetStart = packed.targetStart
        const didExtend = targetStart < target.start - eps
        if (!didExtend && !packed.movedLeft) {
          setTimelineMessage(target.start <= laneStart + eps ? 'Already at timeline start.' : noRoomMessage)
          return
        }

        for (const seg of leftSegs) {
          const placement = packed.placements.get(seg.key)
          if (!placement) continue
          if (seg.kind === 'clip') {
            const ci = nextClips.findIndex((c: any) => String(c?.id) === seg.id)
            if (ci >= 0) nextClips[ci] = { ...(nextClips[ci] as any), startSeconds: placement.start }
          } else {
            const si = nextStills.findIndex((s: any) => String(s?.id) === seg.id)
            if (si >= 0) nextStills[si] = { ...(nextStills[si] as any), startSeconds: placement.start, endSeconds: placement.end }
          }
        }

        if (targetLaneKind === 'clip') {
          const ci = nextClips.findIndex((c: any) => String(c?.id) === target.id)
          if (ci < 0) return
          const clip0: any = nextClips[ci]
          const sourceStart = roundToTenth(Number((clip0 as any).sourceStartSeconds || 0))
          const delta = roundToTenth(target.start - targetStart)
          if (delta > 0 && sourceStart < delta - eps) {
            setTimelineMessage('No more source video available to expand to timeline start.')
            return
          }
          nextClips[ci] = {
            ...(clip0 as any),
            startSeconds: targetStart,
            sourceStartSeconds: roundToTenth(Math.max(0, sourceStart - Math.max(0, delta))),
          }
        } else {
          const si = nextStills.findIndex((s: any) => String(s?.id) === target.id)
          if (si < 0) return
          const end = roundToTenth(Number((nextStills[si] as any).endSeconds || 0))
          if (!(end > targetStart + 0.1 - eps)) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          nextStills[si] = { ...(nextStills[si] as any), startSeconds: targetStart }
        }

        nextClips.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextStills.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextTimeline = { ...(timeline as any), clips: nextClips, stills: nextStills }
      } else if (kind === 'videoOverlay' || kind === 'videoOverlayStill') {
        const prevOs: any[] = Array.isArray((timeline as any).videoOverlays) ? (timeline as any).videoOverlays : []
        const nextOverlays = prevOs.map((o: any, i: number) => ({ ...(o as any), startSeconds: roundToTenth(Number((videoOverlayStarts as any)[i] || 0)) }))
        const nextOverlayStills = (Array.isArray((timeline as any).videoOverlayStills) ? (timeline as any).videoOverlayStills : []).map((s: any) => ({
          ...(s as any),
          startSeconds: roundToTenth(Number((s as any).startSeconds || 0)),
          endSeconds: roundToTenth(Number((s as any).endSeconds || 0)),
        }))
        const segments: Array<
          { key: string; kind: 'videoOverlay'; id: string; start: number; end: number; dur: number } | { key: string; kind: 'videoOverlayStill'; id: string; start: number; end: number; dur: number }
        > = []
        for (const o of nextOverlays as any[]) {
          const start = roundToTenth(Number((o as any).startSeconds || 0))
          const dur = roundToTenth(Math.max(0.2, clipDurationSeconds(o as any)))
          const end = roundToTenth(start + dur)
          if (end > start) segments.push({ key: `videoOverlay:${String((o as any).id)}`, kind: 'videoOverlay', id: String((o as any).id), start, end, dur })
        }
        for (const s of nextOverlayStills as any[]) {
          const start = roundToTenth(Number((s as any).startSeconds || 0))
          const end = roundToTenth(Number((s as any).endSeconds || 0))
          const dur = roundToTenth(Math.max(0, end - start))
          if (end > start) {
            segments.push({ key: `videoOverlayStill:${String((s as any).id)}`, kind: 'videoOverlayStill', id: String((s as any).id), start, end, dur })
          }
        }
        segments.sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key))
        const targetLaneKind: 'videoOverlay' | 'videoOverlayStill' = kind === 'videoOverlay' ? 'videoOverlay' : 'videoOverlayStill'
        const targetIdx = segments.findIndex((seg) => seg.kind === targetLaneKind && seg.id === targetId)
        if (targetIdx < 0) return
        const target = segments[targetIdx]
        const leftSegs = segments.slice(0, targetIdx).filter((seg) => seg.end <= target.start + eps)
        const packed = computeTargetAndPlacements(target.start, leftSegs)
        if (packed.message) {
          setTimelineMessage(packed.message)
          return
        }
        const targetStart = packed.targetStart
        const didExtend = targetStart < target.start - eps
        if (!didExtend && !packed.movedLeft) {
          setTimelineMessage(target.start <= laneStart + eps ? 'Already at timeline start.' : noRoomMessage)
          return
        }

        for (const seg of leftSegs) {
          const placement = packed.placements.get(seg.key)
          if (!placement) continue
          if (seg.kind === 'videoOverlay') {
            const oi = nextOverlays.findIndex((o: any) => String(o?.id) === seg.id)
            if (oi >= 0) nextOverlays[oi] = { ...(nextOverlays[oi] as any), startSeconds: placement.start }
          } else {
            const si = nextOverlayStills.findIndex((s: any) => String(s?.id) === seg.id)
            if (si >= 0) nextOverlayStills[si] = { ...(nextOverlayStills[si] as any), startSeconds: placement.start, endSeconds: placement.end }
          }
        }

        if (targetLaneKind === 'videoOverlay') {
          const oi = nextOverlays.findIndex((o: any) => String(o?.id) === target.id)
          if (oi < 0) return
          const overlay0: any = nextOverlays[oi]
          const sourceStart = roundToTenth(Number((overlay0 as any).sourceStartSeconds || 0))
          const delta = roundToTenth(target.start - targetStart)
          if (delta > 0 && sourceStart < delta - eps) {
            setTimelineMessage('No more source video available to expand to timeline start.')
            return
          }
          nextOverlays[oi] = {
            ...(overlay0 as any),
            startSeconds: targetStart,
            sourceStartSeconds: roundToTenth(Math.max(0, sourceStart - Math.max(0, delta))),
          }
        } else {
          const si = nextOverlayStills.findIndex((s: any) => String(s?.id) === target.id)
          if (si < 0) return
          const end = roundToTenth(Number((nextOverlayStills[si] as any).endSeconds || 0))
          if (!(end > targetStart + 0.1 - eps)) {
            setTimelineMessage('Resulting duration is too small.')
            return
          }
          nextOverlayStills[si] = { ...(nextOverlayStills[si] as any), startSeconds: targetStart }
        }

        nextOverlays.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextOverlayStills.sort(
          (a: any, b: any) => Number((a as any).startSeconds || 0) - Number((b as any).startSeconds || 0) || String(a.id).localeCompare(String(b.id))
        )
        nextTimeline = { ...(timeline as any), videoOverlays: nextOverlays, videoOverlayStills: nextOverlayStills }
      } else if (kind === 'graphic') {
        const res = applySimpleLaneStart(Array.isArray((timeline as any).graphics) ? (timeline as any).graphics : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), graphics: res.items }
      } else if (kind === 'logo') {
        const res = applySimpleLaneStart(Array.isArray((timeline as any).logos) ? (timeline as any).logos : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), logos: res.items }
      } else if (kind === 'lowerThird') {
        const res = applySimpleLaneStart(Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) {
          const prevSeg = (Array.isArray((timeline as any).lowerThirds) ? (timeline as any).lowerThirds : []).find(
            (s: any) => String((s as any)?.id) === targetId
          ) as any
          const nextItems = (res.items || []).map((s: any) => {
            if (String((s as any)?.id) !== targetId) return s
            return maybePromoteLowerThirdTimingOnExpand(prevSeg, s)
          })
          nextTimeline = { ...(timeline as any), lowerThirds: nextItems }
        }
      } else if (kind === 'screenTitle') {
        const res = applySimpleLaneStart(Array.isArray((timeline as any).screenTitles) ? (timeline as any).screenTitles : [], 0.2)
        if (res.message) message = res.message
        else if (res.changed) nextTimeline = { ...(timeline as any), screenTitles: res.items }
      } else if (kind === 'narration') {
        const prev = Array.isArray((timeline as any).narration) ? (timeline as any).narration : []
        const res = applySimpleLaneStart(prev, 0.2, (seg, targetStart) => {
          const sourceStart = roundToTenth(Number((seg as any).sourceStartSeconds || 0))
          const delta = roundToTenth(Number((seg as any).startSeconds || 0) - targetStart)
          if (delta > 0 && sourceStart < delta - eps) return 'No more source audio available to expand to timeline start.'
          return null
        })
        if (res.message) message = res.message
        else if (res.changed) {
          const prevSeg = (prev as any[]).find((x: any) => String(x?.id) === targetId) as any
          const prevStart = roundToTenth(Number((prevSeg as any)?.startSeconds || 0))
          const nextItems = (res.items || []).map((s: any) => {
            if (String((s as any)?.id) !== targetId) return s
            const nextStart = roundToTenth(Number((s as any).startSeconds || 0))
            const shift = roundToTenth(prevStart - nextStart)
            if (!(shift > 0)) return s
            const sourceStart = roundToTenth(Number((s as any).sourceStartSeconds || 0))
            return { ...(s as any), sourceStartSeconds: roundToTenth(Math.max(0, sourceStart - shift)) }
          })
          nextTimeline = { ...(timeline as any), narration: nextItems }
        }
      } else if (kind === 'audioSegment') {
        const prev = Array.isArray((timeline as any).audioSegments) ? (timeline as any).audioSegments : []
        const res = applySimpleLaneStart(prev, 0.2, (seg, targetStart) => {
          const sourceStart = roundToTenth(Number((seg as any).sourceStartSeconds || 0))
          const delta = roundToTenth(Number((seg as any).startSeconds || 0) - targetStart)
          if (delta > 0 && sourceStart < delta - eps) return 'No more source audio available to expand to timeline start.'
          return null
        })
        if (res.message) message = res.message
        else if (res.changed) {
          const prevSeg = (prev as any[]).find((x: any) => String(x?.id) === targetId) as any
          const prevStart = roundToTenth(Number((prevSeg as any)?.startSeconds || 0))
          const nextItems = (res.items || []).map((s: any) => {
            if (String((s as any)?.id) !== targetId) return s
            const nextStart = roundToTenth(Number((s as any).startSeconds || 0))
            const shift = roundToTenth(prevStart - nextStart)
            if (!(shift > 0)) return s
            const sourceStart = roundToTenth(Number((s as any).sourceStartSeconds || 0))
            return { ...(s as any), sourceStartSeconds: roundToTenth(Math.max(0, sourceStart - shift)) }
          })
          nextTimeline = { ...(timeline as any), audioSegments: nextItems, audioTrack: null }
        }
      }

      if (message) {
        setTimelineMessage(message)
        return
      }
      if (!nextTimeline) return
      snapshotUndo()
      setTimeline(nextTimeline)
      void saveTimelineNow({ ...(nextTimeline as any), playheadSeconds: playhead } as any)
    },
    [clipStarts, durationsByUploadId, playhead, saveTimelineNow, snapshotUndo, timeline, totalSeconds, videoOverlayStarts]
  )
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
      nextSegs[idx] = maybePromoteLowerThirdTimingOnExpand(seg0, { ...seg0, startSeconds: startS, endSeconds: endS })
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

  const applyTimelineGuidelineActionByKind = useCallback(
    (
      kind: TimelineCtxKind,
      id: string,
      action: 'snap' | 'expand_start' | 'contract_start' | 'expand_end' | 'contract_end',
      opts?: GuidelineActionOpts
    ) => {
      if (kind === 'graphic') return applyGraphicGuidelineAction(id, action, opts)
      if (kind === 'still') return applyStillGuidelineAction(id, action, opts)
      if (kind === 'videoOverlayStill') return applyVideoOverlayStillGuidelineAction(id, action, opts)
      if (kind === 'logo') return applyLogoGuidelineAction(id, action, opts)
      if (kind === 'lowerThird') return applyLowerThirdGuidelineAction(id, action, opts)
      if (kind === 'screenTitle') return applyScreenTitleGuidelineAction(id, action, opts)
      if (kind === 'videoOverlay') return applyVideoOverlayGuidelineAction(id, action, opts)
      if (kind === 'clip') return applyClipGuidelineAction(id, action, opts)
      if (kind === 'narration') return applyNarrationGuidelineAction(id, action, opts)
      if (kind === 'audioSegment') return applyAudioSegmentGuidelineAction(id, action, opts)
    },
    [
      applyAudioSegmentGuidelineAction,
      applyClipGuidelineAction,
      applyGraphicGuidelineAction,
      applyLogoGuidelineAction,
      applyLowerThirdGuidelineAction,
      applyNarrationGuidelineAction,
      applyScreenTitleGuidelineAction,
      applyStillGuidelineAction,
      applyVideoOverlayGuidelineAction,
      applyVideoOverlayStillGuidelineAction,
    ]
  )

  const resolveTimelineTargetTime = useCallback(
    (
      targetType: 'timeline' | 'guideline' | 'object_lane' | 'object_any',
      direction: 'left' | 'right',
      anchorTime: number,
      kind: TimelineCtxKind
    ): number | null => {
      const total = roundToTenth(Math.max(0, Number(totalSeconds) || 0))
      if (!Number.isFinite(anchorTime)) return null
      const eps = 0.05
      const prevStrict = (list: number[], t: number) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const v = list[i]
          if (v < t - eps) return v
        }
        return null
      }
      const nextStrict = (list: number[], t: number) => {
        for (let i = 0; i < list.length; i++) {
          const v = list[i]
          if (v > t + eps) return v
        }
        return null
      }
      const list =
        targetType === 'timeline'
          ? [roundToTenth(Number(playhead) || 0)]
          : targetType === 'guideline'
            ? timelineGuidelines
            : targetType === 'object_lane'
              ? laneBoundariesByKind[kind] || []
              : objectBoundariesAll
      const target = direction === 'left' ? prevStrict(list, anchorTime) : nextStrict(list, anchorTime)
      if (target == null) return direction === 'left' ? 0 : total
      return target
    },
    [laneBoundariesByKind, objectBoundariesAll, playhead, timelineGuidelines, totalSeconds]
  )

  const applyTimelineArrowAction = useCallback(
    (
      kind: TimelineCtxKind,
      id: string,
      mode: 'move' | 'resize',
      direction: 'left' | 'right',
      targetType: 'timeline' | 'guideline' | 'object_lane' | 'object_any',
      edgeIntent?: 'start' | 'end' | 'move'
    ) => {
      const start = getTimelineCtxSegmentStart(kind, id)
      const end = getTimelineCtxSegmentEnd(kind, id)
      if (start == null || end == null) return
      const anchor =
        mode === 'move' ? (direction === 'left' ? start : end) : edgeIntent === 'end' ? end : start
      const target = resolveTimelineTargetTime(targetType, direction, anchor, kind)
      if (target == null || Math.abs(target - anchor) <= 0.05) {
        setTimelineMessage('No target in that direction.')
        return
      }
      if (mode === 'move') {
        const moveEdge: any = direction === 'left' ? 'start' : 'end'
        applyTimelineGuidelineActionByKind(kind, id, 'snap', {
          edgeIntent: moveEdge,
          guidelinesOverride: [target],
          noopIfNoCandidate: true,
        })
        return
      }
      const edge: any = edgeIntent === 'end' ? 'end' : 'start'
      const action =
        edge === 'start'
          ? direction === 'left'
            ? 'expand_start'
            : 'contract_start'
          : direction === 'left'
            ? 'contract_end'
            : 'expand_end'
      applyTimelineGuidelineActionByKind(kind, id, action, {
        edgeIntent: edge,
        guidelinesOverride: [target],
        noopIfNoCandidate: true,
      })
    },
    [applyTimelineGuidelineActionByKind, getTimelineCtxSegmentEnd, getTimelineCtxSegmentStart, resolveTimelineTargetTime]
  )

  const saveClipEditor = useCallback(() => {
    if (!clipEditor) return
    const start = roundToTenth(Number(clipEditor.start))
    const end = roundToTenth(Number(clipEditor.end))
    const boostRaw = Number((clipEditor as any).boostDb)
    const boostAllowed = new Set([0, 3, 6, 9])
    const boostDb = Number.isFinite(boostRaw) && boostAllowed.has(Math.round(boostRaw)) ? Math.round(boostRaw) : 0
    const bgFillStyleRaw = String((clipEditor as any).bgFillStyle || 'none').toLowerCase()
    let bgFillStyle: 'none' | 'blur' | 'color' | 'image' =
      bgFillStyleRaw === 'blur' ? 'blur' : bgFillStyleRaw === 'color' ? 'color' : bgFillStyleRaw === 'image' ? 'image' : 'none'
    const bgFillBrightnessRaw = String((clipEditor as any).bgFillBrightness || '').toLowerCase()
    const bgFillBrightness = bgFillBrightnessRaw === 'light3'
      ? 'light3'
      : bgFillBrightnessRaw === 'light2'
        ? 'light2'
        : bgFillBrightnessRaw === 'light1'
          ? 'light1'
          : bgFillBrightnessRaw === 'dim1'
            ? 'dim1'
            : bgFillBrightnessRaw === 'dim3'
              ? 'dim3'
              : bgFillBrightnessRaw === 'dim2'
                ? 'dim2'
                : bgFillBrightnessRaw === 'neutral'
                  ? 'neutral'
                  : 'neutral'
    const bgFillBlurRaw = String((clipEditor as any).bgFillBlur || 'medium').toLowerCase()
    const bgFillBlur = bgFillBlurRaw === 'soft'
      ? 'soft'
      : bgFillBlurRaw === 'strong'
        ? 'strong'
        : bgFillBlurRaw === 'very_strong'
          ? 'very_strong'
          : 'medium'
    const bgFillColor = normalizeHexColor((clipEditor as any).bgFillColor, '#000000')
    const bgFillImageUploadIdRaw = Number((clipEditor as any).bgFillImageUploadId)
    const bgFillImageUploadId =
      Number.isFinite(bgFillImageUploadIdRaw) && bgFillImageUploadIdRaw > 0 ? Math.round(bgFillImageUploadIdRaw) : null
    if (bgFillStyle === 'image' && bgFillImageUploadId == null) bgFillStyle = 'none'
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
    const prev = timeline
    const idx = prev.clips.findIndex((c) => c.id === clipEditor.id)
    if (idx < 0) return
    // Normalize to explicit startSeconds so edits don't implicitly shift later clips.
    const starts = computeClipStarts(prev.clips)
    const normalized: Clip[] = prev.clips.map((c, i) => ({ ...c, startSeconds: roundToTenth(starts[i] || 0) }))
    const clipAtIdx = normalized[idx]
    const maxEnd = durationsByUploadId[Number(clipAtIdx.uploadId)] ?? clipAtIdx.sourceEndSeconds
    const safeStart = Math.max(0, start)
    const safeEnd = Math.min(maxEnd, Math.max(safeStart + 0.2, end))
    const updated: Clip = {
      ...clipAtIdx,
      sourceStartSeconds: safeStart,
      sourceEndSeconds: safeEnd,
      boostDb,
      bgFillStyle,
      bgFillBrightness,
      bgFillBlur,
      bgFillColor,
      bgFillImageUploadId,
    }
    const next = normalized.slice()
    next[idx] = updated
    const nextTimeline: any = { ...prev, clips: next }
    const nextTotal = computeTotalSecondsForTimeline(nextTimeline)
    const nextPlayhead = clamp(prev.playheadSeconds || 0, 0, Math.max(0, nextTotal))
    const finalized = { ...nextTimeline, playheadSeconds: nextPlayhead }
    setTimeline(finalized)
    void saveTimelineNow({ ...(finalized as any), playheadSeconds: nextPlayhead } as any)
    setClipEditor(null)
  }, [clipEditor, clipStarts, durationsByUploadId, snapshotUndo, timeline, computeTotalSecondsForTimeline, stills, saveTimelineNow])

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
        let nextTimeline: any = { ...(shifted as any), stills: nextStills }
        if (which === 'first') {
          const nextTotal = computeTotalSecondsForTimeline(nextTimeline as any)
          const excess = roundToTenth(Math.max(0, nextTotal - MAX_TIMELINE_SECONDS))
          if (excess > 0.01) {
            const nextClips = Array.isArray((nextTimeline as any).clips) ? (nextTimeline as any).clips.slice() : []
            const ci = nextClips.findIndex((c: any) => String(c?.id) === String(clip.id))
            if (ci >= 0) {
              const clip0: any = { ...(nextClips[ci] as any) }
              const sourceStart = roundToTenth(Number(clip0.sourceStartSeconds || 0))
              const sourceEnd0 = roundToTenth(Number(clip0.sourceEndSeconds || 0))
              const newSourceEnd = roundToTenth(Math.max(sourceStart + 0.2, sourceEnd0 - excess))
              if (newSourceEnd < sourceEnd0 - 1e-6) {
                clip0.sourceEndSeconds = newSourceEnd
                nextClips[ci] = clip0
                nextTimeline = { ...(nextTimeline as any), clips: nextClips }
              }
            }
          }
        }
        setTimeline(nextTimeline as any)
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
      computeTotalSecondsForTimeline,
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
      const currentHasEffects = current?.borderWidthPx != null || current?.borderColor != null || current?.fade != null || current?.fadeDurationMs != null
      const currentHasAnimation = current?.animate != null || current?.animateDurationMs != null

      const nextBase: any = { ...current, startSeconds: Math.max(0, start), endSeconds: Math.max(0, end) }
      const mode = graphicEditor.mode || (graphicEditor.fitMode === 'contain_transparent' ? 'positioned' : 'full')
      const wantsPlacement = mode !== 'full'
      const fitMode: 'cover_full' | 'contain_transparent' = wantsPlacement ? 'contain_transparent' : 'cover_full'

      const positionRaw = String(graphicEditor.position || 'middle_center')
      let position = positionRaw as any
      if (mode === 'animated') {
        if (positionRaw.includes('top')) position = 'top_center'
        else if (positionRaw.includes('bottom')) position = 'bottom_center'
        else position = 'middle_center'
      }

      const placement = {
        fitMode,
        sizePctWidth: Math.round(clamp(Number.isFinite(Number(graphicEditor.sizePctWidth)) ? Number(graphicEditor.sizePctWidth) : 70, 10, 100)),
        position,
        insetXPx: Math.round(clamp(Number.isFinite(Number(graphicEditor.insetXPx)) ? Number(graphicEditor.insetXPx) : 24, 0, 300)),
        insetYPx: Math.round(clamp(Number.isFinite(Number(graphicEditor.insetYPx)) ? Number(graphicEditor.insetYPx) : 24, 0, 300)),
      }
      const borderWidthAllowed = new Set([0, 2, 4, 6])
      const borderWidth = borderWidthAllowed.has(Number(graphicEditor.borderWidthPx)) ? Number(graphicEditor.borderWidthPx) : 0
      const fadeModeRaw = String(graphicEditor.fade || 'none')
      const fadeAllowed = new Set(['none', 'in', 'out', 'in_out'])
      const fadeMode = fadeAllowed.has(fadeModeRaw) ? fadeModeRaw : 'none'
      const animateAllowed = new Set(['none', 'slide_in', 'slide_out', 'slide_in_out', 'doc_reveal'])
      const animateRaw = String(graphicEditor.animate || 'none').trim().toLowerCase()
      const animateModeRaw = animateAllowed.has(animateRaw) ? animateRaw : 'none'
      const animateMode = animateModeRaw === 'doc_reveal' ? 'doc_reveal' : animateModeRaw === 'none' ? 'none' : 'slide_in_out'
      const normalizedAnimateMode = mode === 'animated' && animateMode === 'none' ? 'slide_in_out' : animateMode
      const wantsEffects = borderWidth > 0 || fadeMode !== 'none' || normalizedAnimateMode === 'doc_reveal'
      const wantsAnimation = mode === 'animated' && normalizedAnimateMode !== 'none'
      const segMs = Math.max(0, Math.round((end - start) * 1000))
      const maxAnimMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
      let animateDurationMs = Math.round(Number(graphicEditor.animateDurationMs) || 600)
      animateDurationMs = Math.round(clamp(animateDurationMs, 100, 2000))
      if (maxAnimMs > 0) animateDurationMs = Math.min(animateDurationMs, maxAnimMs)
      const maxFadeMs = segMs > 0 ? Math.round(segMs * 0.45) : 0
      let fadeDurationMs = Math.round(Number(graphicEditor.fadeDurationMs) || 600)
      fadeDurationMs = Math.round(clamp(fadeDurationMs, 100, 2000))
      if (maxFadeMs > 0) fadeDurationMs = Math.min(fadeDurationMs, maxFadeMs)
      if (mode === 'animated' && normalizedAnimateMode === 'doc_reveal') {
        placement.sizePctWidth = 100
        placement.position = 'middle_center'
        placement.insetXPx = 0
        placement.insetYPx = 0
      }

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
          if (mode === 'animated') {
            updated = { ...(nextBase as any), ...placement, insetXPx: 0, insetYPx: placement.insetYPx } as Graphic
          } else {
            updated = { ...(nextBase as any), ...placement } as Graphic
          }
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
        delete (nextGraphics[idx] as any).fadeDurationMs
      } else {
        ;(nextGraphics[idx] as any).borderWidthPx = borderWidth
        ;(nextGraphics[idx] as any).borderColor = String(graphicEditor.borderColor || '#000000')
        ;(nextGraphics[idx] as any).fade = fadeMode
        ;(nextGraphics[idx] as any).fadeDurationMs = fadeDurationMs
      }
      if (!currentHasAnimation && !wantsAnimation) {
        delete (nextGraphics[idx] as any).animate
        delete (nextGraphics[idx] as any).animateDurationMs
      } else {
        ;(nextGraphics[idx] as any).animate = wantsAnimation ? normalizedAnimateMode : 'none'
        ;(nextGraphics[idx] as any).animateDurationMs = animateDurationMs
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
      const prevSeg: any = prevLts[idx] as any
      const updatedBase: LowerThird = {
        ...prevSeg,
        startSeconds: Math.max(0, start),
        endSeconds: Math.max(0, end),
        configId,
        configSnapshot: cfg as any,
      }
      const updated = maybePromoteLowerThirdTimingOnExpand(prevSeg, updatedBase) as LowerThird
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

    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      setScreenTitleEditorError('End must be after start.')
      return
    }

    const cap = 20 * 60
    if (end > cap + 1e-6) {
      setScreenTitleEditorError(`End exceeds allowed duration (${cap.toFixed(1)}s).`)
      return
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
      const updated: any = {
        ...prevSeg,
        startSeconds: Math.max(0, start),
        endSeconds: Math.max(0, end),
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
  }, [computeTotalSecondsForTimeline, screenTitleEditor, screenTitles, snapshotUndo])

  const saveScreenTitleCustomizeEditor = useCallback(() => {
    if (!screenTitleCustomizeEditor) return
    const presetIdRaw = screenTitleCustomizeEditor.presetId
    const presetId = presetIdRaw == null ? null : Number(presetIdRaw)
    if (presetId == null || !Number.isFinite(presetId) || presetId <= 0) {
      setScreenTitleCustomizeError('Pick a screen title style.')
      return
    }
    const rawInstances = Array.isArray(screenTitleCustomizeEditor.instances)
      ? screenTitleCustomizeEditor.instances
      : []
    if (!rawInstances.length) {
      setScreenTitleCustomizeError('Add a text instance.')
      return
    }

    const preset = screenTitlePresets.find((p: any) => Number((p as any).id) === presetId) as any
    if (!preset) {
      setScreenTitleCustomizeError('Screen title style not found.')
      return
    }
    const snapshot = buildScreenTitlePresetSnapshot(preset)
    const normalizedInstances: ScreenTitleInstanceDraft[] = []
    for (const inst of rawInstances) {
      const text = String(inst?.text || '').replace(/\r\n/g, '\n')
      if (text.length > 1000) {
        setScreenTitleCustomizeError('Max 1000 characters.')
        return
      }
      if (text.split('\n').length > 30) {
        setScreenTitleCustomizeError('Max 30 lines.')
        return
      }
      const customStyle = normalizeScreenTitleCustomStyleForSave(inst?.customStyle || null, snapshot)
      normalizedInstances.push({
        id: String(inst?.id || ''),
        text,
        customStyle,
      })
    }

    const sameCustomStyle = (a: any, b: any): boolean => {
      if (!a && !b) return true
      if (!a || !b) return false
      const keys = ['position', 'alignment', 'marginXPx', 'marginYPx', 'offsetXPx', 'offsetYPx', 'fontKey', 'fontSizePct', 'fontColor', 'fontGradientKey']
      const base = keys.every((k) => {
        const av = (a as any)[k]
        const bv = (b as any)[k]
        if (av == null && bv == null) return true
        if (Number.isFinite(Number(av)) && Number.isFinite(Number(bv))) return Math.abs(Number(av) - Number(bv)) < 0.001
        return String(av || '') === String(bv || '')
      })
      if (!base) return false
      const ar = normalizeScreenTitlePlacementRect((a as any).placementRect)
      const br = normalizeScreenTitlePlacementRect((b as any).placementRect)
      if (!ar && !br) return true
      if (!ar || !br) return false
      return (
        Math.abs(Number(ar.xPct) - Number(br.xPct)) < 0.001 &&
        Math.abs(Number(ar.yPct) - Number(br.yPct)) < 0.001 &&
        Math.abs(Number(ar.wPct) - Number(br.wPct)) < 0.001 &&
        Math.abs(Number(ar.hPct) - Number(br.hPct)) < 0.001
      )
    }
    const sameInstances = (a: any[], b: any[]): boolean => {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        const ai = a[i]
        const bi = b[i]
        if (String(ai?.id || '') !== String(bi?.id || '')) return false
        if (String(ai?.text || '') !== String(bi?.text || '')) return false
        if (!sameCustomStyle(ai?.customStyle || null, bi?.customStyle || null)) return false
      }
      return true
    }

    snapshotUndo()
    setTimeline((prev) => {
      const prevSts: ScreenTitle[] = Array.isArray((prev as any).screenTitles) ? ((prev as any).screenTitles as any) : []
      const idx = prevSts.findIndex((st) => String((st as any).id) === String(screenTitleCustomizeEditor.id))
      if (idx < 0) return prev
      const prevSeg: any = prevSts[idx] as any
      const prevInstancesRaw = Array.isArray(prevSeg?.instances) && prevSeg.instances.length
        ? prevSeg.instances
        : [
            {
              id: `${String(prevSeg?.id || screenTitleCustomizeEditor.id)}_i1`,
              text: String(prevSeg?.text || ''),
              customStyle: (prevSeg?.customStyle as any) || null,
            },
          ]
      const invalidateRender =
        Number(prevSeg?.presetId) !== presetId ||
        !sameInstances(prevInstancesRaw, normalizedInstances)
      const primaryInst = normalizedInstances[0] || { text: '', customStyle: null }
      const updated: any = {
        ...prevSeg,
        presetId,
        presetSnapshot: snapshot,
        instances: normalizedInstances,
        customStyle: primaryInst?.customStyle || null,
        text: String(primaryInst?.text || ''),
        renderUploadId: invalidateRender ? null : (prevSeg?.renderUploadId ?? null),
      }
      const nextSts = prevSts.slice()
      nextSts[idx] = updated
      nextSts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
      return { ...prev, screenTitles: nextSts }
    })

    setScreenTitleCustomizeEditor(null)
    setScreenTitleCustomizeError(null)
  }, [screenTitleCustomizeEditor, screenTitlePresets, snapshotUndo])

  const beginScreenTitlePlacementDrag = useCallback(
    (mode: 'move' | 'left' | 'right' | 'top' | 'bottom', baseRect: ScreenTitlePlacementRect, e: React.PointerEvent) => {
      if (!screenTitlePlacementEditor) return
      if (!screenTitlePlacementStageRef.current) return
      const stageBounds = screenTitlePlacementStageRef.current.getBoundingClientRect()
      if (!(stageBounds.width > 0 && stageBounds.height > 0)) return
      if (screenTitlePlacementStopDragRef.current) {
        screenTitlePlacementStopDragRef.current()
        screenTitlePlacementStopDragRef.current = null
      }
      const safeBase = normalizeScreenTitlePlacementRectForEditor(baseRect)
      screenTitlePlacementDragRef.current = {
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        stageW: stageBounds.width,
        stageH: stageBounds.height,
        baseRect: safeBase,
      }
      let placementChanged = false
      const onMove = (ev: PointerEvent) => {
        const drag = screenTitlePlacementDragRef.current
        if (!drag) return
        const dxPct = ((ev.clientX - drag.startClientX) / Math.max(1, drag.stageW)) * 100
        const dyPct = ((ev.clientY - drag.startClientY) / Math.max(1, drag.stageH)) * 100
        const nextRect = applyScreenTitlePlacementDrag(drag.baseRect, drag.mode, dxPct, dyPct)
        if (!placementChanged && !isSameScreenTitlePlacementRect(nextRect, safeBase)) {
          placementChanged = true
          setScreenTitlePlacementDirty(true)
        }
        setScreenTitlePlacementEditor((prev) => {
          if (!prev) return prev
          const activeId = String(prev.activeInstanceId || '')
          const nextInstances = (prev.instances || []).map((inst) =>
            String(inst.id) === activeId
              ? { ...inst, customStyle: { ...(inst.customStyle || {}), placementRect: nextRect } }
              : inst
          )
          return { ...prev, instances: nextInstances }
        })
      }
      const stop = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        screenTitlePlacementDragRef.current = null
      }
      const onUp = () => {
        stop()
        if (screenTitlePlacementStopDragRef.current === stop) {
          screenTitlePlacementStopDragRef.current = null
        }
        if (placementChanged && !screenTitleRenderBusy) {
          void saveScreenTitlePlacementRef.current(false)
        }
      }
      screenTitlePlacementStopDragRef.current = stop
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerup', onUp, { once: true })
      window.addEventListener('pointercancel', onUp, { once: true })
      setScreenTitlePlacementError(null)
      e.preventDefault()
      e.stopPropagation()
    },
    [screenTitlePlacementEditor, screenTitleRenderBusy]
  )

  const beginScreenTitlePlacementPanelDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!screenTitlePlacementEditor) return
      if ((e as any).button != null && (e as any).button !== 0) return
      if (screenTitlePlacementPanelStopDragRef.current) {
        screenTitlePlacementPanelStopDragRef.current()
        screenTitlePlacementPanelStopDragRef.current = null
      }
      screenTitlePlacementPanelDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        baseX: Number(screenTitlePlacementPanelPos.x || 0),
        baseY: Number(screenTitlePlacementPanelPos.y || 0),
      }
      const onMove = (ev: PointerEvent) => {
        const drag = screenTitlePlacementPanelDragRef.current
        if (!drag || ev.pointerId !== drag.pointerId) return
        const dx = ev.clientX - drag.startClientX
        const dy = ev.clientY - drag.startClientY
        const stageRect = screenTitlePlacementStageRef.current?.getBoundingClientRect()
        const panelRect = screenTitlePlacementPanelRef.current?.getBoundingClientRect()
        const stageW = Number(stageRect?.width || 0)
        const stageH = Number(stageRect?.height || 0)
        const panelW = Number(panelRect?.width || SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX)
        const panelH = Number(panelRect?.height || 228)
        // Keep at least 25% of the panel visible so it can't be fully lost off-canvas.
        const minX = stageW > 0 ? Math.round(-panelW * 0.75) : -9999
        const minY = stageH > 0 ? Math.round(-panelH * 0.75) : -9999
        const maxX = stageW > 0 ? Math.round(stageW - panelW * 0.25) : 9999
        const maxY = stageH > 0 ? Math.round(stageH - panelH * 0.25) : 9999
        setScreenTitlePlacementPanelPos({
          x: Math.round(clamp(drag.baseX + dx, minX, maxX)),
          y: Math.round(clamp(drag.baseY + dy, minY, maxY)),
        })
      }
      const stop = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        screenTitlePlacementPanelDragRef.current = null
      }
      const onUp = (ev: PointerEvent) => {
        const drag = screenTitlePlacementPanelDragRef.current
        if (!drag || ev.pointerId !== drag.pointerId) return
        stop()
        if (screenTitlePlacementPanelStopDragRef.current === stop) {
          screenTitlePlacementPanelStopDragRef.current = null
        }
      }
      screenTitlePlacementPanelStopDragRef.current = stop
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      e.preventDefault()
      e.stopPropagation()
    },
    [screenTitlePlacementEditor, screenTitlePlacementPanelPos.x, screenTitlePlacementPanelPos.y]
  )

  const nudgeScreenTitlePlacement = useCallback(
    (action: 'move_left' | 'move_right' | 'move_up' | 'move_down' | 'edge_in' | 'edge_out') => {
      const stageBounds = screenTitlePlacementStageRef.current?.getBoundingClientRect()
      const stageW = Number(stageBounds?.width || 0)
      const stageH = Number(stageBounds?.height || 0)
      if (!(stageW > 0 && stageH > 0)) return
      const stepPx = Number(screenTitlePlacementStepPx || 1)
      const dxPct = (stepPx / stageW) * 100
      const dyPct = (stepPx / stageH) * 100
      // Arrow nudges are explicit edit intent; mark dirty so Render is available.
      setScreenTitlePlacementDirty(true)
      setScreenTitlePlacementError(null)
      setScreenTitlePlacementEditor((prev) => {
        if (!prev) return prev
        const activeId = String(prev.activeInstanceId || '')
        const idx = (prev.instances || []).findIndex((inst) => String(inst.id) === activeId)
        if (idx < 0) return prev
        const current = (prev.instances || [])[idx] as any
        const baseRect = normalizeScreenTitlePlacementRectForEditor((current?.customStyle as any)?.placementRect)
        let nextRect = baseRect
        if (screenTitlePlacementControlMode === 'move') {
          if (action === 'move_left') nextRect = applyScreenTitlePlacementDrag(baseRect, 'move', -dxPct, 0)
          if (action === 'move_right') nextRect = applyScreenTitlePlacementDrag(baseRect, 'move', dxPct, 0)
          if (action === 'move_up') nextRect = applyScreenTitlePlacementDrag(baseRect, 'move', 0, -dyPct)
          if (action === 'move_down') nextRect = applyScreenTitlePlacementDrag(baseRect, 'move', 0, dyPct)
        } else {
          if (action !== 'edge_in' && action !== 'edge_out') return prev
          if (screenTitlePlacementControlMode === 'left') {
            nextRect = applyScreenTitlePlacementDrag(baseRect, 'left', action === 'edge_out' ? -dxPct : dxPct, 0)
          } else if (screenTitlePlacementControlMode === 'right') {
            nextRect = applyScreenTitlePlacementDrag(baseRect, 'right', action === 'edge_out' ? dxPct : -dxPct, 0)
          } else if (screenTitlePlacementControlMode === 'top') {
            nextRect = applyScreenTitlePlacementDrag(baseRect, 'top', 0, action === 'edge_out' ? -dyPct : dyPct)
          } else if (screenTitlePlacementControlMode === 'bottom') {
            nextRect = applyScreenTitlePlacementDrag(baseRect, 'bottom', 0, action === 'edge_out' ? dyPct : -dyPct)
          }
        }
        if (isSameScreenTitlePlacementRect(nextRect, baseRect)) return prev
        const nextInstances = (prev.instances || []).slice()
        nextInstances[idx] = {
          ...current,
          customStyle: { ...(current?.customStyle || {}), placementRect: nextRect },
        }
        return { ...prev, instances: nextInstances }
      })
    },
    [screenTitlePlacementControlMode, screenTitlePlacementStepPx]
  )

  const stopScreenTitleNudgeRepeat = useCallback(() => {
    const rep = screenTitleNudgeRepeatRef.current
    if (rep.timeoutId != null) {
      try { window.clearTimeout(rep.timeoutId) } catch {}
      rep.timeoutId = null
    }
    if (rep.intervalId != null) {
      try { window.clearInterval(rep.intervalId) } catch {}
      rep.intervalId = null
    }
    rep.pointerId = null
    rep.repeating = false
    rep.active = false
  }, [])

  const startScreenTitleNudgeRepeat = useCallback(
    (
      action: 'move_left' | 'move_right' | 'move_up' | 'move_down' | 'edge_in' | 'edge_out',
      pointerId: number | null
    ) => {
      const rep = screenTitleNudgeRepeatRef.current
      if (rep.active) return
      stopScreenTitleNudgeRepeat()
      rep.active = true
      rep.pointerId = pointerId
      rep.repeating = false
      nudgeScreenTitlePlacement(action)
      rep.timeoutId = window.setTimeout(() => {
        rep.timeoutId = null
        rep.repeating = true
        rep.intervalId = window.setInterval(() => {
          nudgeScreenTitlePlacement(action)
        }, 55)
      }, 240)
    },
    [nudgeScreenTitlePlacement, stopScreenTitleNudgeRepeat]
  )

  const beginScreenTitleNudgeRepeat = useCallback(
    (action: 'move_left' | 'move_right' | 'move_up' | 'move_down' | 'edge_in' | 'edge_out') =>
      (e: React.PointerEvent<HTMLButtonElement>) => {
        if ((e as any).button != null && (e as any).button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        startScreenTitleNudgeRepeat(action, e.pointerId)
        try { (e.currentTarget as any).setPointerCapture?.(e.pointerId) } catch {}
      },
    [startScreenTitleNudgeRepeat]
  )

  const shouldUseLegacyNudgeEvents = useCallback((): boolean => {
    try {
      return !(typeof window !== 'undefined' && (window as any).PointerEvent)
    } catch {
      return true
    }
  }, [])

  const beginScreenTitleNudgeRepeatMouse = useCallback(
    (action: 'move_left' | 'move_right' | 'move_up' | 'move_down' | 'edge_in' | 'edge_out') =>
      (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!shouldUseLegacyNudgeEvents()) return
        if (e.button != null && e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        startScreenTitleNudgeRepeat(action, null)
      },
    [shouldUseLegacyNudgeEvents, startScreenTitleNudgeRepeat]
  )

  const beginScreenTitleNudgeRepeatTouch = useCallback(
    (action: 'move_left' | 'move_right' | 'move_up' | 'move_down' | 'edge_in' | 'edge_out') =>
      (e: React.TouchEvent<HTMLButtonElement>) => {
        if (!shouldUseLegacyNudgeEvents()) return
        e.stopPropagation()
        startScreenTitleNudgeRepeat(action, null)
      },
    [shouldUseLegacyNudgeEvents, startScreenTitleNudgeRepeat]
  )

  const endScreenTitleNudgeRepeat = useCallback((e?: React.PointerEvent<HTMLButtonElement> | PointerEvent) => {
    const rep = screenTitleNudgeRepeatRef.current
    const incomingPointerId =
      e && typeof (e as any).pointerId === 'number' ? Number((e as any).pointerId) : null
    if (incomingPointerId == null && rep.pointerId != null) return
    if (incomingPointerId != null && rep.pointerId != null && incomingPointerId !== rep.pointerId) return
    stopScreenTitleNudgeRepeat()
  }, [stopScreenTitleNudgeRepeat])

  const endScreenTitleNudgeRepeatLegacy = useCallback((e?: React.SyntheticEvent<HTMLButtonElement>) => {
    if (!shouldUseLegacyNudgeEvents()) return
    e?.stopPropagation?.()
    endScreenTitleNudgeRepeat()
  }, [endScreenTitleNudgeRepeat, shouldUseLegacyNudgeEvents])

  useEffect(() => {
    if (screenTitlePlacementEditor) return
    stopScreenTitleNudgeRepeat()
  }, [screenTitlePlacementEditor, stopScreenTitleNudgeRepeat])

  useEffect(() => {
    return () => {
      stopScreenTitleNudgeRepeat()
    }
  }, [stopScreenTitleNudgeRepeat])

  useEffect(() => {
    const onPointerDone = (ev: PointerEvent) => {
      const rep = screenTitleNudgeRepeatRef.current
      if (rep.pointerId == null) return
      if (ev.pointerId !== rep.pointerId) return
      endScreenTitleNudgeRepeat(ev)
    }
    const onLegacyDone = () => {
      const rep = screenTitleNudgeRepeatRef.current
      if (!rep.active) return
      if (rep.pointerId != null) return
      endScreenTitleNudgeRepeat()
    }
    window.addEventListener('pointerup', onPointerDone, { passive: true })
    window.addEventListener('pointercancel', onPointerDone, { passive: true })
    window.addEventListener('mouseup', onLegacyDone, { passive: true })
    window.addEventListener('touchend', onLegacyDone, { passive: true })
    window.addEventListener('touchcancel', onLegacyDone, { passive: true })
    return () => {
      window.removeEventListener('pointerup', onPointerDone as any)
      window.removeEventListener('pointercancel', onPointerDone as any)
      window.removeEventListener('mouseup', onLegacyDone as any)
      window.removeEventListener('touchend', onLegacyDone as any)
      window.removeEventListener('touchcancel', onLegacyDone as any)
    }
  }, [endScreenTitleNudgeRepeat])

  const saveScreenTitlePlacement = useCallback(async (closeEditorOnSuccess: boolean = true) => {
    if (!screenTitlePlacementEditor) return
    const presetIdRaw = screenTitlePlacementEditor.presetId
    const presetId = presetIdRaw == null ? null : Number(presetIdRaw)
    if (!presetId || !Number.isFinite(presetId) || presetId <= 0) {
      setScreenTitlePlacementError('Pick a screen title style.')
      return
    }
    const rawInstances = Array.isArray(screenTitlePlacementEditor.instances) ? screenTitlePlacementEditor.instances : []
    if (!rawInstances.length) {
      setScreenTitlePlacementError('Add a text instance.')
      return
    }

    setScreenTitleRenderBusy(true)
    setScreenTitlePlacementError(null)
    try {
      const preset = screenTitlePresets.find((p: any) => Number((p as any).id) === presetId) as any
      if (!preset) throw new Error('Screen title style not found.')
      const snapshot = buildScreenTitlePresetSnapshot(preset)
      const normalizedInstances: ScreenTitleInstanceDraft[] = []
      for (const inst of rawInstances) {
        const text = String(inst?.text || '').replace(/\r\n/g, '\n').trim()
        if (!text) continue
        if (text.length > 1000) throw new Error('Max 1000 characters.')
        if (text.split('\n').length > 30) throw new Error('Max 30 lines.')
        const safePlacementRect = normalizeScreenTitlePlacementRectForEditor((inst?.customStyle as any)?.placementRect)
        const customStyle = normalizeScreenTitleCustomStyleForSave(
          { ...(inst?.customStyle || {}), placementRect: safePlacementRect },
          snapshot
        )
        normalizedInstances.push({
          id: String(inst?.id || ''),
          text,
          customStyle,
        })
      }
      if (!normalizedInstances.length) throw new Error('Enter text.')
      const renderInstances = normalizedInstances.map((inst) => ({
        text: inst.text,
        presetOverride: buildScreenTitlePresetOverride(inst.customStyle || null),
      }))

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/screen-titles/render`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({
          presetId,
          frameW: outputFrame.width,
          frameH: outputFrame.height,
          instances: renderInstances,
        }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || json?.message || 'internal_error'))
      const uploadId = Number(json?.uploadId || 0)
      if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('bad_upload_id')

      snapshotUndo()
      setTimeline((prev) => {
        const prevSts: ScreenTitle[] = Array.isArray((prev as any).screenTitles) ? ((prev as any).screenTitles as any) : []
        const idx = prevSts.findIndex((st) => String((st as any).id) === String(screenTitlePlacementEditor.id))
        if (idx < 0) return prev
        const prevSeg: any = prevSts[idx] as any
        const primaryInst = normalizedInstances[0] || { text: '', customStyle: null }
        const updated: any = {
          ...prevSeg,
          presetId,
          presetSnapshot: snapshot,
          instances: normalizedInstances,
          customStyle: primaryInst?.customStyle || null,
          text: String(primaryInst?.text || ''),
          renderUploadId: uploadId,
        }
        const nextSts = prevSts.slice()
        nextSts[idx] = updated
        nextSts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
        return { ...prev, screenTitles: nextSts }
      })

      const url = `/api/uploads/${encodeURIComponent(String(uploadId))}/file`
      setGraphicFileUrlByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: url }))

      if (closeEditorOnSuccess) {
        setScreenTitlePlacementEditor(null)
      } else {
        setScreenTitlePlacementEditor((prev) => {
          if (!prev) return prev
          if (String(prev.id) !== String(screenTitlePlacementEditor.id)) return prev
          return {
            ...prev,
            presetId,
            instances: normalizedInstances,
          }
        })
      }
      setScreenTitlePlacementDirty(false)
      setScreenTitlePlacementError(null)
    } catch (e: any) {
      setScreenTitlePlacementError(e?.message || 'internal_error')
    } finally {
      setScreenTitleRenderBusy(false)
    }
  }, [outputFrame.height, outputFrame.width, screenTitlePlacementEditor, screenTitlePresets, snapshotUndo])

  saveScreenTitlePlacementRef.current = saveScreenTitlePlacement

  const closeScreenTitlePlacement = useCallback(() => {
    if (screenTitleRenderBusy) return
    if (screenTitlePlacementDirty) {
      let renderBeforeClose = false
      try {
        renderBeforeClose = window.confirm(
          'Render placement changes before closing?\n\nOK = Render + Close\nCancel = Close without render'
        )
      } catch {
        renderBeforeClose = false
      }
      if (renderBeforeClose) {
        void saveScreenTitlePlacement(true)
        return
      }
    }
    setScreenTitlePlacementEditor(null)
    setScreenTitlePlacementError(null)
    setScreenTitlePlacementAdvancedOpen(false)
    setScreenTitlePlacementDirty(false)
  }, [saveScreenTitlePlacement, screenTitlePlacementDirty, screenTitleRenderBusy])

  const generateScreenTitle = useCallback(async () => {
    if (!screenTitleCustomizeEditor) return
    const presetIdRaw = screenTitleCustomizeEditor.presetId
    const presetId = presetIdRaw == null ? null : Number(presetIdRaw)
    if (!presetId || !Number.isFinite(presetId) || presetId <= 0) {
      setScreenTitleCustomizeError('Pick a screen title style.')
      return
    }
    const rawInstances = Array.isArray(screenTitleCustomizeEditor.instances)
      ? screenTitleCustomizeEditor.instances
      : []
    if (!rawInstances.length) {
      setScreenTitleCustomizeError('Add a text instance.')
      return
    }

    setScreenTitleRenderBusy(true)
    setScreenTitleCustomizeError(null)
    try {
      const preset = screenTitlePresets.find((p: any) => Number((p as any).id) === presetId) as any
      if (!preset) throw new Error('Screen title style not found.')
      const snapshot = buildScreenTitlePresetSnapshot(preset)
      const normalizedInstances: ScreenTitleInstanceDraft[] = []
      for (const inst of rawInstances) {
        const text = String(inst?.text || '').replace(/\r\n/g, '\n').trim()
        if (!text) continue
        if (text.length > 1000) throw new Error('Max 1000 characters.')
        if (text.split('\n').length > 30) throw new Error('Max 30 lines.')
        const customStyle = normalizeScreenTitleCustomStyleForSave(inst?.customStyle || null, snapshot)
        normalizedInstances.push({
          id: String(inst?.id || ''),
          text,
          customStyle,
        })
      }
      if (!normalizedInstances.length) throw new Error('Enter text.')
      const renderInstances = normalizedInstances.map((inst) => ({
        text: inst.text,
        presetOverride: buildScreenTitlePresetOverride(inst.customStyle || null),
      }))

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/screen-titles/render`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({
          presetId,
          frameW: outputFrame.width,
          frameH: outputFrame.height,
          instances: renderInstances,
        }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || json?.message || 'internal_error'))
      const uploadId = Number(json?.uploadId || 0)
      if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('bad_upload_id')

      // Persist preset/text/custom style then set the new render upload id.
      snapshotUndo()
      setTimeline((prev) => {
        const prevSts: ScreenTitle[] = Array.isArray((prev as any).screenTitles) ? ((prev as any).screenTitles as any) : []
        const idx = prevSts.findIndex((st) => String((st as any).id) === String(screenTitleCustomizeEditor.id))
        if (idx < 0) return prev
        const prevSeg: any = prevSts[idx] as any
        const primaryInst = normalizedInstances[0] || { text: '', customStyle: null }
        const updated: any = {
          ...prevSeg,
          presetId,
          presetSnapshot: snapshot,
          instances: normalizedInstances,
          customStyle: primaryInst?.customStyle || null,
          text: String(primaryInst?.text || ''),
          renderUploadId: uploadId,
        }
        const nextSts = prevSts.slice()
        nextSts[idx] = updated
        nextSts.sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds) || String(a.id).localeCompare(String(b.id)))
        return { ...prev, screenTitles: nextSts }
      })

      const url = `/api/uploads/${encodeURIComponent(String(uploadId))}/file`
      setGraphicFileUrlByUploadId((prev) => (prev[uploadId] ? prev : { ...prev, [uploadId]: url }))

      setScreenTitleCustomizeEditor(null)
      setScreenTitleCustomizeError(null)
    } catch (e: any) {
      setScreenTitleCustomizeError(e?.message || 'internal_error')
    } finally {
      setScreenTitleRenderBusy(false)
    }
  }, [outputFrame.height, outputFrame.width, screenTitleCustomizeEditor, screenTitlePresets, snapshotUndo])

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

  const openClipBackgroundPicker = useCallback(() => {
    const clipId = String((clipEditor as any)?.id || selectedClipId || '').trim()
    if (!clipId) return
    try {
      const ret = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`
      const u = new URL('/assets/graphic', window.location.origin)
      u.searchParams.set('mode', 'pick')
      u.searchParams.set('return', ret)
      u.searchParams.set('pickType', 'clipBackground')
      u.searchParams.set('cvPickTargetClipId', clipId)
      const qp = new URLSearchParams(window.location.search)
      const projectQ = qp.get('project')
      if (projectQ) u.searchParams.set('project', String(projectQ))
      window.location.href = `${u.pathname}${u.search}`
    } catch {
      window.location.href = `/assets/graphic?mode=pick&pickType=clipBackground&cvPickTargetClipId=${encodeURIComponent(clipId)}`
    }
  }, [clipEditor, selectedClipId])

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
          nextLts[idx] = maybePromoteLowerThirdTimingOnExpand(lt0, { ...lt0, startSeconds: startS, endSeconds: endS })
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
          const edgeIntent: any =
            drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('graphic', String((drag as any).graphicId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('logo', String((drag as any).logoId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('lowerThird', String((drag as any).lowerThirdId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('screenTitle', String((drag as any).screenTitleId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('videoOverlay', String((drag as any).videoOverlayId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('clip', String((drag as any).clipId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('narration', String((drag as any).narrationId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('audioSegment', String((drag as any).audioSegmentId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('still', String((drag as any).stillId), edgeIntent)
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
          const edgeIntent: any = drag.edge === 'start' ? 'start' : drag.edge === 'end' ? 'end' : 'move'
          openTimelineCtxMenuForEdge('videoOverlayStill', String((drag as any).videoOverlayStillId), edgeIntent)
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
  }, [openTimelineCtxMenuForEdge, pxPerSecond, stopTrimDrag, trimDragging])

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

  const cancelBodyHold = useCallback(
    (reason: string) => {
      const cur = bodyHoldRef.current
      if (!cur) return
      try { window.clearTimeout(cur.timer) } catch {}
      bodyHoldRef.current = null
      dbg('cancelBodyHold', { reason })
    },
    [dbg]
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const cur = bodyHoldRef.current
      if (!cur) return
      if (e.pointerId !== cur.pointerId) return
      if (trimDragging) {
        cancelBodyHold('dragging')
        return
      }
      const dx = e.clientX - cur.startX
      const dy = e.clientY - cur.startY
      if (dx * dx + dy * dy > 9 * 9) cancelBodyHold('moved')
    }
    const onUp = (e: PointerEvent) => {
      const cur = bodyHoldRef.current
      if (!cur) return
      if (e.pointerId !== cur.pointerId) return
      cancelBodyHold('pointerup')
    }
    const onBlur = () => cancelBodyHold('blur')
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onMove as any)
      window.removeEventListener('pointerup', onUp as any)
      window.removeEventListener('pointercancel', onUp as any)
      window.removeEventListener('blur', onBlur as any)
    }
  }, [cancelBodyHold, trimDragging])


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

  useEffect(() => {
    if (!scrubberDragging) return
    const onMove = (e: PointerEvent) => {
      const drag = scrubberDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      e.preventDefault()
      const sc = timelineScrollRef.current
      if (!sc) return
      const dx = e.clientX - drag.startX
      const maxLeft = drag.maxLeft
      const scrollRange = drag.scrollRange
      if (!(maxLeft > 0 && scrollRange > 0)) return
      const nextScrollLeft = clamp(Math.round(drag.startScrollLeft + (dx * scrollRange) / maxLeft), 0, Math.max(0, scrollRange))
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
      const drag = scrubberDragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      scrubberDragRef.current = null
      setScrubberDragging(false)
      try { (e.target as HTMLElement | null)?.releasePointerCapture?.(e.pointerId) } catch {}
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove as any)
      window.removeEventListener('pointerup', onUp as any)
      window.removeEventListener('pointercancel', onUp as any)
    }
  }, [pxPerSecond, scrubberDragging, totalSeconds])

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

  const beginBodyPanHoldMove = useCallback(
    (
      e: React.PointerEvent,
      moveDrag: any,
      selectFn: () => void,
      dbgInfo: { kind: string; edge: string; id: string }
    ) => {
      const sc = timelineScrollRef.current
      if (!sc) return
      if (trimDragging) return
      cancelBodyHold('restart')
      panDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startScrollLeft: sc.scrollLeft,
        moved: false,
      }
      setPanDragging(true)
      try { sc.setPointerCapture(e.pointerId) } catch {}
      const pointerId = e.pointerId
      const startX = e.clientX
      const startY = e.clientY
      const timer = window.setTimeout(() => {
        const cur = bodyHoldRef.current
        if (!cur || cur.pointerId !== pointerId) return
        bodyHoldRef.current = null
        panDragRef.current = null
        setPanDragging(false)
        try { sc.releasePointerCapture?.(pointerId) } catch {}
        selectFn()
        trimDragRef.current = {
          ...moveDrag,
          pointerId,
          startClientX: startX,
          startClientY: startY,
          armed: true,
          moved: false,
        }
        try { sc.setPointerCapture(pointerId) } catch {}
        dbg('armTrimDrag', dbgInfo)
      }, 300)
      bodyHoldRef.current = { timer, pointerId, startX, startY }
    },
    [cancelBodyHold, dbg, trimDragging]
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

  // [cv-shell + cv-preview-stage + cv-timeline-lanes] primary page composition.
  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ padding: '24px 16px 80px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  const payload = {
                    projectId: project?.id ?? null,
                    timeline,
                    clipStarts,
                    activeClipId: (activeClipAtPlayhead as any)?.id ?? null,
                    activeStillId: (previewStillAtPlayhead as any)?.id ?? null,
                    activeStillBgFill,
                    activeStillBgFillDebug,
                    activeClipBgFill,
                  }
                  const text = JSON.stringify(payload, null, 2)
                  try { await navigator.clipboard.writeText(text) } catch {}
                  try { console.log('[create-video] timeline debug', payload) } catch {}
                  alert('Timeline debug JSON copied to clipboard.')
                } catch (err) {
                  console.error(err)
                  alert('Failed to copy timeline debug JSON.')
                }
              }}
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
              Copy Timeline JSON
            </button>
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
        <div style={{ maxWidth: 520, margin: '14px auto 0' }}>
          <div
            style={{
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.14)',
              overflow: screenTitlePlacementEditor || showPreviewToolbar ? 'visible' : 'hidden',
              background: '#000',
              position: 'relative',
              zIndex: screenTitlePlacementEditor ? 260 : 'auto',
            }}
          >
            <div
              ref={previewWrapRef}
              style={{
                width: '100%',
                aspectRatio: '9 / 16',
                background: timelineBackgroundMode === 'color' ? timelineBackgroundColor : '#000',
                position: 'relative',
                overflow: screenTitlePlacementEditor || showPreviewToolbar ? 'visible' : 'hidden',
              }}
            >
            {timelineBackgroundMode === 'color' ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: timelineBackgroundColor,
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
            ) : null}
            {timelineBackgroundMode === 'image' && timelineBackgroundImageUrl ? (
              <img
                src={timelineBackgroundImageUrl}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
                />
              ) : null}
            {activeClipBgStatic?.kind === 'color' ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: activeClipBgStatic.color,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
            ) : null}
            {activeClipBgStatic?.kind === 'image' ? (
              <img
                src={activeClipBgStatic.url}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
            ) : null}
            {activeStillBgStatic?.kind === 'color' ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: activeStillBgStatic.color,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
            ) : null}
            {activeStillBgStatic?.kind === 'image' ? (
              <img
                src={activeStillBgStatic.url}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
            ) : null}
            <video
              ref={bgVideoRef}
              playsInline
              preload="metadata"
              muted
              style={previewBgVideoStyle}
            />
            {activeStillUrl && activeStillBgFill ? (
              <img
                src={activeStillUrl}
                alt=""
                style={previewBgStillStyle}
              />
            ) : null}
            <video
              ref={videoRef}
              playsInline
              preload="metadata"
              poster={activePoster || undefined}
	              style={previewBaseVideoStyle}
	            />
            {previewVideoLaneEnabled.video === false && baseMotionPoster ? (
              <img
                src={baseMotionPoster}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: previewObjectFit,
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
            ) : null}
            {activeStillUrl ? (
              <img
                src={activeStillUrl}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: activeStillObjectFit,
                  pointerEvents: 'none',
                  zIndex: 10,
                  background: activeStillBgFill || activeStillBgStatic || hasTimelineBackgroundPreview ? 'transparent' : '#000',
                }}
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
	                      zIndex: 65,
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
	                      {activeGraphicPreviewIndicators.hasAnimate ? <span>ANIM</span> : null}
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
                    style={{
                      ...activeVideoOverlayPreview.innerStyle,
                      display: previewVideoLaneEnabled.videoOverlay !== false ? 'block' : 'none',
                    }}
                  />
                  {previewVideoLaneEnabled.videoOverlay === false ? (
                    <img
                      src={activeVideoOverlayPreview.thumbUrl}
                      alt=""
                      style={activeVideoOverlayPreview.innerStyle}
                    />
                  ) : null}
                </div>
              </>
            ) : null}
            {showPreviewToolbar && hasPlayablePreview && !screenTitlePlacementEditor ? (
              <React.Suspense fallback={null}>
                <LazyPreviewFloatingToolbar
                  ctx={{
                    audioSegments,
                    canJumpNext,
                    canJumpPrev,
                    clamp,
                    jumpNextBoundary,
                    jumpPrevBoundary,
                    musicPreviewPlaying,
                    narrationPreviewPlaying,
                    nudgePlayhead,
                    overlayVideoRef,
                    playPauseGlyph,
                    playing,
                    playingRef,
                    playhead,
                    playheadFromVideoRef,
                    playheadRef,
                    previewMiniDragRef,
                    previewMiniTimelineRef,
                    previewToolbarBottomPx,
                    previewToolbarDragRef,
                    previewToolbarRef,
                    pxPerSecond,
                    roundToTenth,
                    seek,
                    seekOverlay,
                    setPlaying,
                    setPreviewToolbarDragging,
                    setTimeline,
                    sortedNarration,
                    narrationButtonSwatch,
                    audioButtonSwatch,
                    toggleMusicPlay,
                    toggleNarrationPlay,
                    togglePlay,
                    totalSeconds,
                    videoRef,
                    playbackClockRef,
                    previewMotionSource,
                    baseHasVideo: Boolean(timeline.clips.length || stills.length),
                    overlayHasVideo: Boolean(videoOverlays.length || videoOverlayStills.length),
                  }}
                />
              </React.Suspense>
            ) : null}
	              {activeScreenTitlePreview ? (
	                <img
	                  src={activeScreenTitlePreview.url}
	                  alt=""
	                  style={activeScreenTitlePreview.style}
                />
              ) : null}
              {screenTitlePlacementEditor ? (
                <React.Suspense fallback={null}>
                  <LazyScreenTitleQuickPanelOverlay
                    screenTitlePlacementStageRef={screenTitlePlacementStageRef}
                    screenTitlePlacementPanelRef={screenTitlePlacementPanelRef}
                    screenTitlePlacementPanelPos={screenTitlePlacementPanelPos}
                    screenTitleMiniPanelTab={screenTitleMiniPanelTab}
                    SCREEN_TITLE_STYLE_PANEL_WIDTH_PX={SCREEN_TITLE_STYLE_PANEL_WIDTH_PX}
                    SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX={SCREEN_TITLE_PLACEMENT_PANEL_WIDTH_PX}
                    beginScreenTitlePlacementPanelDrag={beginScreenTitlePlacementPanelDrag}
                    closeScreenTitlePlacement={closeScreenTitlePlacement}
                    screenTitleRenderBusy={screenTitleRenderBusy}
                    screenTitlePlacementEditor={screenTitlePlacementEditor}
                    setScreenTitlePlacementEditor={setScreenTitlePlacementEditor}
                    setScreenTitleStyleAlignMenuOpen={setScreenTitleStyleAlignMenuOpen}
                    setScreenTitlePlacementError={setScreenTitlePlacementError}
                    setScreenTitleMiniPanelTab={setScreenTitleMiniPanelTab}
                    SCREEN_TITLE_PLACEMENT_COL_GAP_PX={SCREEN_TITLE_PLACEMENT_COL_GAP_PX}
                    SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX={SCREEN_TITLE_PLACEMENT_MODEL_SIZE_PX}
                    setScreenTitlePlacementControlMode={setScreenTitlePlacementControlMode}
                    screenTitlePlacementControlMode={screenTitlePlacementControlMode}
                    screenTitlePlacementMoveVertical={screenTitlePlacementMoveVertical}
                    screenTitlePlacementMoveHorizontal={screenTitlePlacementMoveHorizontal}
                    setScreenTitlePlacementMoveAxis={setScreenTitlePlacementMoveAxis}
                    SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX={SCREEN_TITLE_PLACEMENT_CONTROL_GAP_PX}
                    SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX={SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_WIDTH_PX}
                    SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX={SCREEN_TITLE_PLACEMENT_NUDGE_BUTTON_HEIGHT_PX}
                    setScreenTitlePlacementStepPx={setScreenTitlePlacementStepPx}
                    screenTitlePlacementStepPx={screenTitlePlacementStepPx}
                    beginScreenTitleNudgeRepeat={beginScreenTitleNudgeRepeat}
                    screenTitlePlacementArrowControls={screenTitlePlacementArrowControls}
                    endScreenTitleNudgeRepeat={endScreenTitleNudgeRepeat}
                    beginScreenTitleNudgeRepeatMouse={beginScreenTitleNudgeRepeatMouse}
                    endScreenTitleNudgeRepeatLegacy={endScreenTitleNudgeRepeatLegacy}
                    beginScreenTitleNudgeRepeatTouch={beginScreenTitleNudgeRepeatTouch}
                    ACTION_ARROW_ICON_URL={ACTION_ARROW_ICON_URL}
                    normalizeScreenTitlePlacementRect={normalizeScreenTitlePlacementRect}
                    screenTitlePresets={screenTitlePresets}
                    buildScreenTitlePresetSnapshot={buildScreenTitlePresetSnapshot}
                    applyScreenTitleCustomStyle={applyScreenTitleCustomStyle}
                    resolveScreenTitleFamilyForFontKey={resolveScreenTitleFamilyForFontKey}
                    getScreenTitleSizeOptions={getScreenTitleSizeOptions}
                    pickScreenTitleSizeKey={pickScreenTitleSizeKey}
                    setScreenTitlePlacementDirty={setScreenTitlePlacementDirty}
                    screenTitleStyleAlignMenuRef={screenTitleStyleAlignMenuRef}
                    screenTitleStyleAlignMenuOpen={screenTitleStyleAlignMenuOpen}
                    screenTitleFontFamilies={screenTitleFontFamilies}
                    screenTitleGradients={screenTitleGradients}
                    screenTitlePlacementDirty={screenTitlePlacementDirty}
                    saveScreenTitlePlacement={saveScreenTitlePlacement}
                    screenTitlePlacementError={screenTitlePlacementError}
                    screenTitlePlacementInRange={screenTitlePlacementInRange}
                    screenTitlePlacementActiveRect={screenTitlePlacementActiveRect}
                    SCREEN_TITLE_SAFE_AREA_LEFT_PCT={SCREEN_TITLE_SAFE_AREA_LEFT_PCT}
                    SCREEN_TITLE_SAFE_AREA_TOP_PCT={SCREEN_TITLE_SAFE_AREA_TOP_PCT}
                    SCREEN_TITLE_SAFE_AREA_RIGHT_PCT={SCREEN_TITLE_SAFE_AREA_RIGHT_PCT}
                    SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT={SCREEN_TITLE_SAFE_AREA_BOTTOM_PCT}
                    screenTitlePlacementPassiveRects={screenTitlePlacementPassiveRects}
                    beginScreenTitlePlacementDrag={beginScreenTitlePlacementDrag}
                    SCREEN_TITLE_PLACEMENT_ACTION_BUTTON_WIDTH_PX={SCREEN_TITLE_PLACEMENT_ACTION_BUTTON_WIDTH_PX}
                  />
                </React.Suspense>
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
            <style>{`
              .cv-timeline-scroll::-webkit-scrollbar { height: 0; }
            `}</style>
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
              {layerToggleVisible ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setShowEmptyLanes((v) => !v)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setShowEmptyLanes((v) => !v)
                    }
                  }}
                  style={{
                    position: 'absolute',
                    left: layerToggleLeft,
                    top: layerToggleTop,
                    width: layerToggleWidth,
                    height: layerToggleSize,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    zIndex: 55,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                  }}
                  title={showEmptyLanes ? 'Hide empty lanes' : 'Show empty lanes'}
                  aria-label={showEmptyLanes ? 'Hide empty lanes' : 'Show empty lanes'}
                >
                  <img
                    src={EXPAND_ICON_URL}
                    alt=""
                    aria-hidden="true"
                    style={{
                      width: layerToggleIconSize,
                      height: layerToggleIconSize,
                      display: 'block',
                      filter: 'brightness(0) invert(1)',
                      opacity: 0.95,
                      transform: showEmptyLanes ? 'rotate(180deg)' : 'rotate(0deg)',
                      transformOrigin: '50% 50%',
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              ) : null}
              {showEmptyState ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: TRACKS_TOP + LANE_TOP_PAD,
                    height: TRACK_H,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 800,
                    color: 'rgba(255,255,255,0.7)',
                    pointerEvents: 'none',
                    zIndex: 6,
                  }}
                >
                  No layers yet — add an asset
                </div>
              ) : null}
              <div
                ref={timelineZoomMenuRef}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: Math.max(0, Math.round(RULER_H + 10)),
                  zIndex: 60,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowTimelineZoomMenu((v) => !v)}
                  style={{
                    padding: '4px 6px',
                    border: 'none',
                    background: 'transparent',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: 13,
                    cursor: 'pointer',
                    lineHeight: 1,
                    letterSpacing: 0.2,
                    opacity: 0.5,
                  }}
                  title="Zoom timeline"
                  aria-label="Zoom timeline"
                >
                  {timelineZoomLabel}
                </button>
                {showTimelineZoomMenu ? (
                  <div
                    style={{
                      position: 'fixed',
                      left: '50%',
                      top: (() => {
                        const rect = timelineScrollEl?.getBoundingClientRect()
                        if (!rect) return 120
                        return Math.max(8, Math.round(rect.top + 8))
                      })(),
                      transform: 'translateX(-50%)',
                      background: 'rgba(0,0,0,0.55)',
                      backdropFilter: 'blur(6px)',
                      WebkitBackdropFilter: 'blur(6px)',
                      border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: 14,
                      padding: 8,
                      display: 'grid',
                      gap: 6,
                      minWidth: 120,
                      zIndex: 2000,
                      boxShadow: 'none',
                    }}
                  >
                    {TIMELINE_ZOOM_OPTIONS.map((opt) => {
                      const active = Math.abs(opt - timelineZoom) < 1e-6
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setTimelineZoomValue(opt)
                            setShowTimelineZoomMenu(false)
                          }}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: active ? '1px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.18)',
                            background: active ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.06)',
                            color: '#fff',
                            fontWeight: 900,
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          {Math.round(opt * 100)}%
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
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
                className="cv-timeline-scroll"
	                onPointerDown={(e) => {
                  const sc = timelineScrollRef.current
                  if (!sc) return
                  if (trimDragging) return
                  cancelBodyHold('new_pointerdown')
                  // If a pan gesture started in capture phase for this pointer, don't run selection logic.
                  if (panDragRef.current && panDragRef.current.pointerId === e.pointerId) return
	                  // Only do mouse drag-panning on desktop. Touch already pans the scroll container.
	                  const isMouse = (e as any).pointerType === 'mouse'
	                  if (isMouse && e.button != null && e.button !== 0) return
	                  const rect = sc.getBoundingClientRect()
	                  const y = e.clientY - rect.top
	                  const withinLogo = LOGO_Y != null && y >= LOGO_Y && y <= LOGO_Y + PILL_H
	                  const withinLowerThird = LOWER_THIRD_Y != null && y >= LOWER_THIRD_Y && y <= LOWER_THIRD_Y + PILL_H
	                  const withinScreenTitle = SCREEN_TITLE_Y != null && y >= SCREEN_TITLE_Y && y <= SCREEN_TITLE_Y + PILL_H
	                  const withinVideoOverlay = VIDEO_OVERLAY_Y != null && y >= VIDEO_OVERLAY_Y && y <= VIDEO_OVERLAY_Y + PILL_H
	                  const withinGraphics = GRAPHICS_Y != null && y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
	                  const withinVideo = VIDEO_Y != null && y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
	                  const withinNarration = NARRATION_Y != null && y >= NARRATION_Y && y <= NARRATION_Y + PILL_H
	                  const withinAudio = AUDIO_Y != null && y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
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

                    // Body drag: pan timeline by default; long-press to move the object.
                    if (!nearLeft && !nearRight) {
                      const dur = Math.max(0.2, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)
                      beginBodyPanHoldMove(
                        e,
                        {
                          kind: 'logo',
                          logoId: String((l as any).id),
                          edge: 'move',
                          startStartSeconds: s,
                          startEndSeconds: e2,
                          minStartSeconds,
                          maxEndSeconds,
                          maxStartSeconds,
                        },
                        () => {
                          setSelectedLogoId(String((l as any).id))
                          setSelectedClipId(null)
                          setSelectedGraphicId(null)
                          setSelectedLowerThirdId(null)
                          setSelectedScreenTitleId(null)
                          setSelectedNarrationId(null)
                          setSelectedStillId(null)
                          setSelectedAudioId(null)
                        },
                        { kind: 'logo', edge: 'move', id: String((l as any).id) }
                      )
                      return
                    }

	                    // Resize only when already selected (unless the action panel is open).
	                    if (selectedLogoId !== String((l as any).id)) {
	                      setSelectedLogoId(String((l as any).id))
	                      setSelectedClipId(null)
	                      setSelectedGraphicId(null)
	                      setSelectedLowerThirdId(null)
	                      setSelectedScreenTitleId(null)
	                      setSelectedNarrationId(null)
	                      setSelectedStillId(null)
	                      setSelectedAudioId(null)
	                    }
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
		                      edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
		                    dbg('armTrimDrag', { kind: 'logo', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String((l as any).id) })
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

                    // Body drag: pan timeline by default; long-press to move the object.
                    if (!nearLeft && !nearRight) {
                      const dur = Math.max(0.2, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)
                      beginBodyPanHoldMove(
                        e,
                        {
                          kind: 'lowerThird',
                          lowerThirdId: String((lt as any).id),
                          edge: 'move',
                          startStartSeconds: s,
                          startEndSeconds: e2,
                          minStartSeconds,
                          maxEndSeconds,
                          maxStartSeconds,
                        },
                        () => {
                          setSelectedLowerThirdId(String((lt as any).id))
                          setSelectedClipId(null)
                          setSelectedGraphicId(null)
                          setSelectedLogoId(null)
                          setSelectedScreenTitleId(null)
                          setSelectedNarrationId(null)
                          setSelectedStillId(null)
                          setSelectedAudioId(null)
                        },
                        { kind: 'lowerThird', edge: 'move', id: String((lt as any).id) }
                      )
                      return
                    }

                    // Resize only when already selected (unless the action panel is open).
                    if (selectedLowerThirdId !== String((lt as any).id)) {
                      setSelectedLowerThirdId(String((lt as any).id))
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      setSelectedLogoId(null)
                      setSelectedScreenTitleId(null)
                      setSelectedNarrationId(null)
                      setSelectedStillId(null)
                      setSelectedAudioId(null)
                    }
                    e.preventDefault()
                    trimDragRef.current = {
                      kind: 'lowerThird',
                      lowerThirdId: String((lt as any).id),
                      edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
                    dbg('armTrimDrag', { kind: 'lowerThird', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String((lt as any).id) })
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

                    const allowEdgeBind = nearLeft || nearRight
                    // Ensure first tap selects the segment when binding edges.
	                    if (selectedScreenTitleId !== String((st as any).id) && allowEdgeBind) {
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
                    }

                    const capEnd = MAX_TIMELINE_SECONDS
                    const sorted = screenTitles.slice().sort((a: any, b: any) => Number((a as any).startSeconds) - Number((b as any).startSeconds))
                    const pos = sorted.findIndex((x: any) => String(x?.id) === String((st as any).id))
                    const prevEnd = pos > 0 ? Number((sorted[pos - 1] as any).endSeconds || 0) : 0
                    const nextStart = pos >= 0 && pos < sorted.length - 1 ? Number((sorted[pos + 1] as any).startSeconds || capEnd) : capEnd
                    const maxEndSeconds = clamp(roundToTenth(nextStart), 0, capEnd)
                    const minStartSeconds = clamp(roundToTenth(prevEnd), 0, maxEndSeconds)

                    // Body drag: pan timeline by default; long-press to move the object.
                    if (!nearLeft && !nearRight) {
                      const dur = Math.max(0.2, roundToTenth(e2 - s))
                      const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)
                      beginBodyPanHoldMove(
                        e,
                        {
                          kind: 'screenTitle',
                          screenTitleId: String((st as any).id),
                          edge: 'move',
                          startStartSeconds: s,
                          startEndSeconds: e2,
                          minStartSeconds,
                          maxEndSeconds,
                          maxStartSeconds,
                        },
                        () => {
                          setSelectedScreenTitleId(String((st as any).id))
                          setSelectedClipId(null)
                          setSelectedGraphicId(null)
                          setSelectedLogoId(null)
                          setSelectedLowerThirdId(null)
                          setSelectedNarrationId(null)
                          setSelectedStillId(null)
                          setSelectedAudioId(null)
                        },
                        { kind: 'screenTitle', edge: 'move', id: String((st as any).id) }
                      )
                      return
                    }

                    // Resize only when already selected (unless the action panel is open).
                    if (selectedScreenTitleId !== String((st as any).id)) {
                      setSelectedScreenTitleId(String((st as any).id))
                      setSelectedClipId(null)
                      setSelectedGraphicId(null)
                      setSelectedLogoId(null)
                      setSelectedLowerThirdId(null)
                      setSelectedNarrationId(null)
                      setSelectedStillId(null)
                      setSelectedAudioId(null)
                      if (!allowEdgeBind) return
                    }
                    e.preventDefault()
                    trimDragRef.current = {
                      kind: 'screenTitle',
                      screenTitleId: String((st as any).id),
                      edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
                    dbg('armTrimDrag', { kind: 'screenTitle', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String((st as any).id) })
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
                      const allowEdgeBind = nearLeft || nearRight

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

                      if (!nearLeft && !nearRight) {
                        beginBodyPanHoldMove(
                          e,
                          {
                            kind: 'videoOverlayStill',
                            videoOverlayStillId: String((overlayStill as any).id),
                            edge: 'move',
                            startStartSeconds: s,
                            startEndSeconds: e2,
                            minStartSeconds,
                            maxEndSeconds,
                            maxStartSeconds,
                          },
                          () => {
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
                          },
                          { kind: 'videoOverlayStill', edge: 'move', id: String((overlayStill as any).id) }
                        )
                        return
                      }

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
                        if (!allowEdgeBind) return
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
                        edge: nearLeft || nearRight ? pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight) : 'move',
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
                        dbg('startTrimDrag', { kind: 'videoOverlayStill', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String((overlayStill as any).id) })
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
	                    const allowEdgeBind = nearLeft || nearRight

	                    // Ensure first tap selects when binding edges.
                    if (selectedVideoOverlayId !== String((o as any).id) && allowEdgeBind) {
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
	                      beginBodyPanHoldMove(
	                        e,
	                        {
	                          kind: 'videoOverlay',
	                          videoOverlayId: String((o as any).id),
	                          edge: 'move',
	                          startStartSeconds: Number((o as any).sourceStartSeconds || 0),
	                          startEndSeconds: Number((o as any).sourceEndSeconds || 0),
	                          startTimelineStartSeconds: start0,
	                          startTimelineEndSeconds: end0,
	                          maxDurationSeconds,
	                          minStartSeconds,
	                          maxEndSeconds,
	                          maxStartSeconds,
	                        },
	                        () => {
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
	                        },
	                        { kind: 'videoOverlay', edge: 'move', id: String((o as any).id) }
	                      )
	                      return
	                    }

	                    // Resize only when already selected.
	                    e.preventDefault()
	                    trimDragRef.current = {
	                      kind: 'videoOverlay',
	                      videoOverlayId: String((o as any).id),
	                      edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
	                    dbg('armTrimDrag', { kind: 'videoOverlay', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String((o as any).id) })
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
		                    const allowEdgeBind = nearLeft || nearRight

		                    // Select immediately when binding edges.
		                    if (selectedGraphicId !== g.id && allowEdgeBind) {
		                      setSelectedGraphicId(g.id)
		                      setSelectedClipId(null)
		                      setSelectedLogoId(null)
		                      setSelectedLowerThirdId(null)
		                      setSelectedScreenTitleId(null)
		                      setSelectedNarrationId(null)
		                      setSelectedStillId(null)
		                      setSelectedAudioId(null)
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
		                        edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
		                      dbg('startTrimDrag', { kind: 'graphic', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: g.id })
		                      return
		                    }

		                    // Body drag: pan timeline by default; long-press to move the object.
		                    const dur = Math.max(0.2, roundToTenth(e2 - s))
		                    const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)
		                    beginBodyPanHoldMove(
		                      e,
		                      {
		                        kind: 'graphic',
		                        graphicId: g.id,
		                        edge: 'move',
		                        startStartSeconds: s,
		                        startEndSeconds: e2,
		                        minStartSeconds,
		                        maxEndSeconds,
		                        maxStartSeconds,
		                      },
		                      () => {
		                        setSelectedGraphicId(g.id)
		                        setSelectedClipId(null)
		                        setSelectedLogoId(null)
		                        setSelectedLowerThirdId(null)
		                        setSelectedScreenTitleId(null)
		                        setSelectedNarrationId(null)
		                        setSelectedStillId(null)
		                        setSelectedAudioId(null)
		                      },
		                      { kind: 'graphic', edge: 'move', id: String(g.id) }
		                    )
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

	                    // Select immediately when binding edges.
	                    if (selectedNarrationId !== String((n as any).id) && (nearLeft || nearRight)) {
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
	                    }

	                    const dur = Math.max(0.2, roundToTenth(e2 - s))
	                    const maxStartSeconds = clamp(roundToTenth(maxEndSeconds - dur), minStartSeconds, maxEndSeconds)

	                    if (!nearLeft && !nearRight) {
	                      beginBodyPanHoldMove(
	                        e,
	                        {
	                          kind: 'narration',
	                          narrationId: String((n as any).id),
	                          edge: 'move',
	                          startStartSeconds: s,
	                          startEndSeconds: e2,
	                          startSourceStartSeconds: nSourceStart,
	                          maxDurationSeconds: nMaxDurationSeconds,
	                          minStartSeconds,
	                          maxEndSeconds,
	                          maxStartSeconds,
	                        },
	                        () => {
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
	                        },
	                        { kind: 'narration', edge: 'move', id: String((n as any).id) }
	                      )
	                      return
	                    }

	                    // Arm resize (tap-release can open the context menu; pointer movement begins drag).
	                    e.preventDefault()
	                    trimDragRef.current = {
	                      kind: 'narration',
	                      narrationId: String((n as any).id),
	                      edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
	                    dbg('armTrimDrag', { kind: 'narration', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String((n as any).id) })
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

		                    // Select immediately when binding edges.
		                    if (String(selectedAudioId || '') !== String(seg.id) && (nearLeft || nearRight)) {
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
		                    }

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
		                      beginBodyPanHoldMove(
		                        e,
		                        {
		                          kind: 'audioSegment',
		                          audioSegmentId: String(seg.id),
		                          edge: 'move',
		                          startStartSeconds: s,
		                          startEndSeconds: e2,
		                          startSourceStartSeconds: segSourceStart,
		                          maxDurationSeconds: segMaxDurationSeconds ?? undefined,
		                          minStartSeconds,
		                          maxEndSeconds,
		                          maxStartSeconds,
		                        },
		                        () => {
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
		                        },
		                        { kind: 'audioSegment', edge: 'move', id: String(seg.id) }
		                      )
		                      return
		                    }

		                    // Arm resize (tap-release can open the context menu; pointer movement begins drag).
		                    e.preventDefault()
		                    trimDragRef.current = {
		                      kind: 'audioSegment',
		                      audioSegmentId: String(seg.id),
		                      edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
		                    dbg('armTrimDrag', { kind: 'audioSegment', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String(seg.id) })
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
                      const allowEdgeBind = nearLeft || nearRight

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

                      // Select immediately when binding edges.
	                      if (selectedStillId !== String((still as any).id) && allowEdgeBind) {
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
                      }

                      if (!nearLeft && !nearRight) {
                        beginBodyPanHoldMove(
                          e,
                          {
                            kind: 'still',
                            stillId: String((still as any).id),
                            edge: 'move',
                            startStartSeconds: s,
                            startEndSeconds: e2,
                            minStartSeconds,
                            maxEndSeconds,
                            maxStartSeconds,
                          },
                          () => {
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
                          },
                          { kind: 'still', edge: 'move', id: String((still as any).id) }
                        )
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
                        edge: nearLeft || nearRight ? pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight) : 'move',
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
                        dbg('startTrimDrag', { kind: 'still', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: String((still as any).id) })
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

                  // Body drag: pan timeline by default; long-press to move the object.
                  if (!nearLeft && !nearRight) {
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
                    beginBodyPanHoldMove(
                      e,
                      {
                        kind: 'clip',
                        clipId: clip.id,
                        edge: 'move',
                        startStartSeconds: start,
                        startEndSeconds: start + len,
                        maxDurationSeconds: Number.isFinite(maxDur) && maxDur > 0 ? maxDur : clip.sourceEndSeconds,
                        minStartSeconds,
                        maxEndSeconds,
                        maxStartSeconds,
                      },
                      () => {
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
                      },
                      { kind: 'clip', edge: 'move', id: clip.id }
                    )
                    return
                  }

                  // Resize only when already selected (unless the action panel is open on a handle).
                  if (selectedClipId !== clip.id) {
                    if (nearLeft || nearRight) {
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
                    } else {
                      return
                    }
                  }
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
	                    edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight),
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
                  dbg('armTrimDrag', { kind: 'clip', edge: pickTrimEdge(clickXInScroll, leftX, rightX, nearLeft, nearRight), id: clip.id })
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
	                  const hitX = e.clientX - rect.left
	                  const padPx = timelinePadPx || Math.floor((sc.clientWidth || 0) / 2)
	                  const clickXInScroll = (e.clientX - rect.left) + sc.scrollLeft
	                  const x = clickXInScroll - padPx
	                  const t = clamp(roundToTenth(x / pxPerSecond), 0, Math.max(0, totalSeconds))
		                  const withinLogo = LOGO_Y != null && y >= LOGO_Y && y <= LOGO_Y + PILL_H
		                  const withinLowerThird = LOWER_THIRD_Y != null && y >= LOWER_THIRD_Y && y <= LOWER_THIRD_Y + PILL_H
		                  const withinScreenTitle = SCREEN_TITLE_Y != null && y >= SCREEN_TITLE_Y && y <= SCREEN_TITLE_Y + PILL_H
		                  const withinVideoOverlay = VIDEO_OVERLAY_Y != null && y >= VIDEO_OVERLAY_Y && y <= VIDEO_OVERLAY_Y + PILL_H
		                  const withinGraphics = GRAPHICS_Y != null && y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
		                  const withinVideo = VIDEO_Y != null && y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
		                  const withinNarration = NARRATION_Y != null && y >= NARRATION_Y && y <= NARRATION_Y + PILL_H
		                  const withinAudio = AUDIO_Y != null && y >= AUDIO_Y && y <= AUDIO_Y + PILL_H

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
	                  const maybeOpenCtxMenu = (
	                    kind: TimelineCtxKind,
	                    id: string,
	                    selectedId: string | null,
	                    leftX: number,
	                    rightX: number
	                  ) => {
	                    if (!selectedId || String(selectedId) !== String(id)) return false
	                    const nearLeft = Math.abs(clickXInScroll - leftX) <= EDGE_HIT_PX
	                    const nearRight = Math.abs(clickXInScroll - rightX) <= EDGE_HIT_PX
	                    if (nearLeft || nearRight) return false
	                    openTimelineCtxMenuForEdge(kind, String(id), 'move')
	                    return true
	                  }
		                  const withinLogo = LOGO_Y != null && y >= LOGO_Y && y <= LOGO_Y + PILL_H
		                  const withinLowerThird = LOWER_THIRD_Y != null && y >= LOWER_THIRD_Y && y <= LOWER_THIRD_Y + PILL_H
		                  const withinScreenTitle = SCREEN_TITLE_Y != null && y >= SCREEN_TITLE_Y && y <= SCREEN_TITLE_Y + PILL_H
		                  const withinVideoOverlay = VIDEO_OVERLAY_Y != null && y >= VIDEO_OVERLAY_Y && y <= VIDEO_OVERLAY_Y + PILL_H
		                  const withinGraphics = GRAPHICS_Y != null && y >= GRAPHICS_Y && y <= GRAPHICS_Y + PILL_H
		                  const withinVideo = VIDEO_Y != null && y >= VIDEO_Y && y <= VIDEO_Y + PILL_H
		                  const withinNarration = NARRATION_Y != null && y >= NARRATION_Y && y <= NARRATION_Y + PILL_H
		                  const withinAudio = AUDIO_Y != null && y >= AUDIO_Y && y <= AUDIO_Y + PILL_H
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
	                    if (maybeOpenCtxMenu('logo', String((l as any).id), selectedLogoId, leftX, rightX)) return
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
	                    if (maybeOpenCtxMenu('lowerThird', String((lt as any).id), selectedLowerThirdId, leftX, rightX)) return
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
	                    if (maybeOpenCtxMenu('screenTitle', String((st as any).id), selectedScreenTitleId, leftX, rightX)) return
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
		                      if (maybeOpenCtxMenu('videoOverlayStill', String((overlayStill as any).id), selectedVideoOverlayStillId, leftX, rightX)) return
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
				                    if (maybeOpenCtxMenu('videoOverlay', String((o as any).id), selectedVideoOverlayId, leftX, rightX)) return
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
			                    if ((nearLeft || nearRight) && selectedNarrationId === String((n as any).id)) return
			                    if (maybeOpenCtxMenu('narration', String((n as any).id), selectedNarrationId, leftX, rightX)) return

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
	                    if (maybeOpenCtxMenu('graphic', String(g.id), selectedGraphicId, leftX, rightX)) return
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
	                    if ((nearLeft || nearRight) && String(selectedAudioId || '') === String(seg.id)) return

	                    if (maybeOpenCtxMenu('audioSegment', String(seg.id), selectedAudioId, leftX, rightX)) return
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
	                    if (maybeOpenCtxMenu('still', String((still as any).id), selectedStillId, leftX, rightX)) return
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
	                  if ((nearLeft || nearRight) && selectedClipId === clip.id) return

                  if (selectedClipId === clip.id) {
                    if (maybeOpenCtxMenu('clip', String(clip.id), selectedClipId, leftX, rightX)) return
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
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
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
              {(() => {
                const viewportW = Math.max(0, (timelinePadPx || 0) * 2)
                const contentW = viewportW + stripContentW
                const showScrubber = viewportW > 0 && stripContentW > 1 && contentW > viewportW + 1
                if (!showScrubber) return null
                const trackW = viewportW
                const ratio = trackW > 0 ? Math.min(1, trackW / contentW) : 1
                const handleW = Math.min(trackW, Math.max(SCRUBBER_MIN_HANDLE_PX, Math.round(trackW * ratio)))
                const maxLeft = Math.max(0, trackW - handleW)
                const scrollRange = Math.max(0, stripContentW)
                const left =
                  maxLeft > 0 && scrollRange > 0
                    ? Math.round((Math.max(0, Number(timelineScrollLeftPx) || 0) / scrollRange) * maxLeft)
                    : 0
                return (
                  <div style={{ marginTop: 12, padding: '0 0' }}>
                    <div
                      style={{
                        position: 'relative',
                        height: SCRUBBER_H,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: '50%',
                          height: 2,
                          transform: 'translateY(-50%)',
                          background: 'rgba(255,255,255,0.35)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          width: Math.max(0, left),
                          top: '50%',
                          height: 2,
                          transform: 'translateY(-50%)',
                          background: '#d4af37',
                        }}
                      />
                      <div
                        onPointerDown={(e) => {
                          if (trimDragging) return
                          if (!(maxLeft > 0 && scrollRange > 0)) return
                          scrubberDragRef.current = {
                            pointerId: e.pointerId,
                            startX: e.clientX,
                            startScrollLeft: Math.max(0, Number(timelineScrollLeftPx) || 0),
                            maxLeft,
                            scrollRange,
                          }
                          setScrubberDragging(true)
                          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
                        }}
                        style={{
                          position: 'absolute',
                          left,
                          top: 0,
                          height: '100%',
                          width: handleW,
                          borderRadius: 999,
                          background: '#d4af37',
                          cursor: 'pointer',
                          touchAction: 'none',
                        }}
                      />
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

              <div style={{ maxWidth: 620, margin: '0 auto' }}>
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
			                      border: showPreviewToolbar ? '1px solid rgba(48,209,88,0.85)' : '1px solid rgba(255,255,255,0.18)',
			                      background: showPreviewToolbar ? 'rgba(48,209,88,0.18)' : '#0c0c0c',
			                      color: '#fff',
			                      fontWeight: 900,
			                      cursor: 'pointer',
			                      flex: '0 0 auto',
			                      minWidth: 44,
			                      lineHeight: 1,
			                    }}
			                    title="Toggle floating preview controls"
			                    aria-label={showPreviewToolbar ? 'Floating preview controls enabled' : 'Floating preview controls disabled'}
			                  >
                          <img src={FLOAT_ICON_URL} alt="" aria-hidden="true" style={{ width: 25, height: 25, display: 'block' }} />
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
                        {(() => {
                          const baseHas = Boolean(timeline.clips.length || stills.length)
                          const overlayHas = Boolean(videoOverlays.length || videoOverlayStills.length)
                          const showDual = baseHas && overlayHas
                          if (!showDual) {
                            const singleSource = baseHas ? 'video' : overlayHas ? 'videoOverlay' : undefined
                            const singleActive =
                              singleSource === 'video'
                                ? playbackClockRef.current === 'base'
                                : singleSource === 'videoOverlay'
                                  ? playbackClockRef.current === 'overlay'
                                  : false
                            const isPlaying = playing && (singleSource ? singleActive : true)
                            return (
                              <button
                                type="button"
                                onClick={() => togglePlay(singleSource)}
                                disabled={totalSeconds <= 0}
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: 10,
                                  border: '1px solid rgba(10,132,255,0.55)',
                                  background: isPlaying ? 'rgba(10,132,255,0.18)' : '#0a84ff',
                                  color: '#fff',
                                  fontWeight: 900,
                                  cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                                  flex: '0 0 auto',
                                  minWidth: 44,
                                  lineHeight: 1,
                                }}
                                title={isPlaying ? 'Pause' : 'Play'}
                                aria-label={isPlaying ? 'Pause' : 'Play'}
                              >
                                <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                                  {playPauseGlyph(isPlaying)}
                                </span>
                              </button>
                            )
                          }
                          const activeMotion =
                            playing
                              ? playbackClockRef.current === 'overlay'
                                ? 'videoOverlay'
                                : playbackClockRef.current === 'base'
                                  ? 'video'
                                  : previewMotionSource
                              : previewMotionSource
                          const baseActive = activeMotion === 'video'
                          const overlayActive = activeMotion === 'videoOverlay'
                          const basePlaying = playing && baseActive
                          const overlayPlaying = playing && overlayActive
                          const baseStyle = {
                            padding: '10px 10px',
                            borderRadius: 10,
                            border: '1px solid #0a84ff',
                            background: '#0a84ff',
                            color: '#fff',
                            fontWeight: 900,
                            cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                            flex: '0 0 auto' as const,
                            minWidth: 44,
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }
                          const overlayStyle = {
                            padding: '10px 10px',
                            borderRadius: 10,
                            border: '1px solid #0a84ff',
                            background: '#0a84ff',
                            color: '#fff',
                            fontWeight: 900,
                            cursor: totalSeconds <= 0 ? 'default' : 'pointer',
                            flex: '0 0 auto' as const,
                            minWidth: 44,
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => togglePlay('video')}
                                disabled={totalSeconds <= 0}
                                style={baseStyle}
                                title={basePlaying ? 'Pause video (V1)' : 'Play video (V1)'}
                                aria-label={basePlaying ? 'Pause video (V1)' : 'Play video (V1)'}
                              >
                                <span style={{ display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                                  {playPauseGlyph(basePlaying)}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => togglePlay('videoOverlay')}
                                disabled={totalSeconds <= 0}
                                style={overlayStyle}
                                title={overlayPlaying ? 'Pause overlay (V2)' : 'Play overlay (V2)'}
                                aria-label={overlayPlaying ? 'Pause overlay (V2)' : 'Play overlay (V2)'}
                              >
                                <span style={{ position: 'relative', display: 'inline-block', width: 20, textAlign: 'center', fontSize: 20 }}>
                                  {playPauseGlyph(overlayPlaying)}
                                  <span
                                    style={{
                                      position: 'absolute',
                                      top: -4,
                                      right: -6,
                                      fontSize: 10,
                                      fontWeight: 900,
                                      lineHeight: 1,
                                    }}
                                  >
                                    O
                                  </span>
                                </span>
                              </button>
                            </>
                          )
                        })()}

				                {sortedNarration.length ? (
				                  <button
				                    type="button"
				                    onClick={narrationPreviewEnabled ? toggleNarrationPlay : undefined}
				                    style={{
				                      padding: '10px 12px',
				                      borderRadius: 10,
				                      border: `1px solid ${laneSwatchForButton(laneMeta.narration.swatch)}`,
				                      background: narrationPreviewPlaying
				                        ? 'rgba(175,82,222,0.18)'
				                        : laneSwatchForButton(laneMeta.narration.swatch),
				                      color: '#fff',
				                      fontWeight: 900,
				                      cursor: narrationPreviewEnabled ? 'pointer' : 'default',
				                      flex: '0 0 auto',
				                      minWidth: 44,
				                      lineHeight: 1,
				                      opacity: narrationPreviewEnabled ? 1 : 0.5,
				                    }}
				                    title="Play narration (voice memo)"
				                    aria-label={narrationPreviewPlaying ? 'Pause voice' : 'Play voice'}
				                  >
				                    <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
				                      {playPauseGlyph(narrationPreviewPlaying)}
				                    </span>
				                  </button>
				                ) : null}

				                {audioSegments.length ? (
				                  <button
				                    type="button"
				                    onClick={audioPreviewEnabled ? toggleMusicPlay : undefined}
				                    style={{
				                      padding: '10px 12px',
				                      borderRadius: 10,
				                      border: `1px solid ${laneSwatchForButton(laneMeta.audio.swatch)}`,
				                      background: musicPreviewPlaying
				                        ? 'rgba(48,209,88,0.18)'
				                        : laneSwatchForButton(laneMeta.audio.swatch),
				                      color: '#fff',
				                      fontWeight: 900,
				                      cursor: audioPreviewEnabled ? 'pointer' : 'default',
				                      flex: '0 0 auto',
				                      minWidth: 44,
				                      lineHeight: 1,
				                      opacity: audioPreviewEnabled ? 1 : 0.5,
				                    }}
				                    title="Play music"
				                    aria-label={musicPreviewPlaying ? 'Pause music' : 'Play music'}
				                  >
				                    <span style={{ display: 'inline-block', width: 18, textAlign: 'center', fontSize: 18 }}>
				                      {playPauseGlyph(musicPreviewPlaying)}
				                    </span>
				                  </button>
				                ) : null}
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

            {timelineErrorModal ? (
              <div
                role="dialog"
                aria-modal="true"
                onClick={() => setTimelineErrorModal(null)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 5600,
                  background: 'rgba(0,0,0,0.86)',
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  padding: '64px 16px 80px',
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    maxWidth: 560,
                    margin: '0 auto',
                    borderRadius: 14,
                    padding: 16,
                    boxSizing: 'border-box',
                    border: '1px solid rgba(96,165,250,0.95)',
                    background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
                    color: '#fff',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>Timeline Alert</div>
                    <button
                      type="button"
                      onClick={() => setTimelineErrorModal(null)}
                      style={{
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: 'rgba(255,255,255,0.06)',
                        color: '#fff',
                        fontWeight: 800,
                        padding: '6px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      Close
                    </button>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 14, fontWeight: 700, color: '#fff' }}>{timelineErrorModal}</div>
                </div>
              </div>
            ) : null}
        </div>

        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          {exportStatus ? <div style={{ marginTop: 12, color: '#bbb' }}>{exportStatus}</div> : null}
          {exportError ? <div style={{ marginTop: 10, color: '#ff9b9b' }}>{exportError}</div> : null}
        </div>
      </div>

      {/* [cv-editor-video-graphics + cv-editor-branding-audio] modal host boundary for standalone lazy chunk. */}
      {graphicEditor ||
      stillEditor ||
      videoOverlayStillEditor ||
      audioEditor ||
      logoEditor ||
      lowerThirdEditor ||
      videoOverlayEditor ||
      screenTitleEditor ||
      screenTitleCustomizeEditor ||
      (screenTitlePlacementEditor && screenTitlePlacementAdvancedOpen) ||
      clipEditor ||
      narrationEditor ? (
        <React.Suspense fallback={null}>
          <LazyEditorModalHost
            ctx={{
              audioConfigNameById,
              audioEditor,
              audioEditorError,
              audioPreviewPlayingId,
              audioSegments,
              buildScreenTitlePresetSnapshot,
              clipEditor,
              clipEditorError,
              defaultScreenTitlePlacementRect,
              dimsByUploadId,
              durationsByUploadId,
              freezeInsertBusy,
              freezeInsertError,
              generateScreenTitle,
              getScreenTitleSizeOptions,
              graphicEditor,
              graphicEditorError,
              insertFreezeStill,
              insertVideoOverlayFreezeStill,
              logoEditor,
              logoEditorError,
              logos,
              lowerThirdConfigs,
              lowerThirdEditor,
              lowerThirdEditorError,
              lowerThirds,
              namesByUploadId,
              narration,
              narrationEditor,
              narrationEditorError,
              normalizeScreenTitlePlacementRectForEditor,
              openClipBackgroundPicker,
              overlayFreezeInsertBusy,
              overlayFreezeInsertError,
              pickScreenTitleSizeKey,
              playPauseGlyph,
              resolveScreenTitleFamilyForFontKey,
              saveAudioEditor,
              saveClipEditor,
              saveGraphicEditor,
              saveLogoEditor,
              saveLowerThirdEditor,
              saveNarrationEditor,
              saveScreenTitleEditor,
              saveScreenTitlePlacement,
              saveStillEditor,
              saveVideoOverlayEditor,
              saveVideoOverlayStillEditor,
              screenTitleCustomizeEditor,
              screenTitleCustomizeError,
              screenTitleFontFamilies,
              screenTitleGradients,
              screenTitlePlacementAdvancedOpen,
              screenTitlePlacementControlMode,
              screenTitlePlacementEditor,
              screenTitlePlacementError,
              screenTitlePlacementMoveHorizontal,
              screenTitlePlacementMoveVertical,
              screenTitlePlacementStageRef,
              screenTitlePresets,
              screenTitleRenderBusy,
              screenTitleTextAreaHeight,
              screenTitleTextAreaRef,
              screenTitleEditor,
              screenTitleEditorError,
              setAudioEditor,
              setAudioEditorError,
              setClipEditor,
              setClipEditorError,
              setFreezeInsertBusy,
              setFreezeInsertError,
              setGraphicEditor,
              setGraphicEditorError,
              setLogoEditor,
              setLogoEditorError,
              setLowerThirdEditor,
              setLowerThirdEditorError,
              setNarrationEditor,
              setNarrationEditorError,
              setScreenTitleCustomizeEditor,
              setScreenTitleCustomizeError,
              setScreenTitleEditor,
              setScreenTitleEditorError,
              setScreenTitlePlacementAdvancedOpen,
              setScreenTitlePlacementControlMode,
              setScreenTitlePlacementEditor,
              setScreenTitlePlacementError,
              setScreenTitleTextAreaHeight,
              setStillEditor,
              setStillEditorError,
              setTimeline,
              setVideoOverlayEditor,
              setVideoOverlayEditorError,
              setVideoOverlayStillEditor,
              setVideoOverlayStillEditorError,
              snapshotUndo,
              stillEditor,
              stillEditorError,
              timeline,
              toggleAudioPreview,
              totalSeconds,
              totalSecondsVideo,
              videoOverlayEditor,
              videoOverlayEditorError,
              videoOverlayStillEditor,
              videoOverlayStillEditorError,
              videoOverlays,
              beginScreenTitlePlacementDrag,
              SCREEN_TITLE_PLACEMENT_MIN_H_PCT,
              SCREEN_TITLE_PLACEMENT_MIN_W_PCT,
              applyScreenTitleCustomStyle,
            }}
          />
        </React.Suspense>
      ) : null}

      {/* [cv-context-actions] action menu tree boundary for standalone lazy chunk. */}
      {timelineCtxMenu ? (
        <React.Suspense fallback={null}>
          <LazyTimelineContextMenu
            ctx={{
              ACTION_ARROW_ICON_URL,
              applyAudioSegmentGuidelineAction,
              applyClipGuidelineAction,
              applyGraphicGuidelineAction,
              applyLogoGuidelineAction,
              applyLowerThirdGuidelineAction,
              applyNarrationGuidelineAction,
              applyScreenTitleGuidelineAction,
              applyStillGuidelineAction,
              applyTimelineArrowAction,
              applyTimelineExpandEndAction,
              applyTimelineExpandStartAction,
              applyVideoOverlayGuidelineAction,
              applyVideoOverlayStillGuidelineAction,
              audioSegments,
              clamp,
              deleteAudioSegmentById,
              deleteClipById,
              deleteGraphicById,
              deleteLogoById,
              deleteLowerThirdById,
              deleteNarrationById,
              deleteScreenTitleById,
              deleteStillById,
              deleteVideoOverlayById,
              deleteVideoOverlayStillById,
              duplicateAudioSegmentById,
              duplicateClipById,
              duplicateGraphicById,
              duplicateLogoById,
              duplicateLowerThirdById,
              duplicateNarrationById,
              duplicateScreenTitleById,
              duplicateStillById,
              duplicateVideoOverlayById,
              duplicateVideoOverlayStillById,
              ensureAudioConfigs,
              ensureScreenTitleFonts,
              ensureScreenTitlePresets,
              getTimelineCtxSegmentEnd,
              getTimelineCtxSegmentStart,
              graphics,
              logos,
              lowerThirds,
              narration,
              normalizeHexColor,
              normalizeSpeedPresetMs,
              openScreenTitlePlacementById,
              playhead,
              roundToTenth,
              screenTitleLastInstanceById,
              screenTitles,
              setAudioEditor,
              setAudioEditorError,
              setClipEditor,
              setClipEditorError,
              setFreezeInsertError,
              setGraphicEditor,
              setGraphicEditorError,
              setLogoEditor,
              setLogoEditorError,
              setLowerThirdEditor,
              setLowerThirdEditorError,
              setNarrationEditor,
              setNarrationEditorError,
              setScreenTitleCustomizeEditor,
              setScreenTitleCustomizeError,
              setScreenTitleEditor,
              setScreenTitleEditorError,
              setSelectedAudioId,
              setSelectedClipId,
              setSelectedGraphicId,
              setSelectedLogoId,
              setSelectedLowerThirdId,
              setSelectedNarrationId,
              setSelectedScreenTitleId,
              setSelectedStillId,
              setSelectedVideoOverlayId,
              setSelectedVideoOverlayStillId,
              setStillEditor,
              setStillEditorError,
              setTimeline,
              setTimelineCtxMenu,
              setVideoOverlayEditor,
              setVideoOverlayEditorError,
              setVideoOverlayStillEditor,
              setVideoOverlayStillEditorError,
              snapshotUndo,
              splitAudioSegmentById,
              splitClipById,
              splitGraphicById,
              splitLogoById,
              splitLowerThirdById,
              splitNarrationById,
              splitScreenTitleById,
              splitStillById,
              splitVideoOverlayById,
              splitVideoOverlayStillById,
              stills,
              timeline,
              timelineCtxMenu,
              timelineCtxMenuOpenedAtRef,
              timelineCtxSnapTargetRef,
              totalSeconds,
              videoOverlayStills,
              videoOverlays,
            }}
          />
        </React.Suspense>
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
        <React.Suspense fallback={null}>
          <LazyGuidelineMenuModal
            ctx={{
              closeGuidelineMenu,
              guidelineMenuOpen,
              guidelines,
              removeAllGuidelines,
              removeNearestGuideline,
            }}
          />
        </React.Suspense>
      ) : null}
	    </div>
	  )
}
