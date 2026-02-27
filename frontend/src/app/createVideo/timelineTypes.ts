export type Clip = {
  id: string
  uploadId: number
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  audioEnabled?: boolean
  freezeStartSeconds?: number
  freezeEndSeconds?: number
  bgFillStyle?: 'none' | 'blur' | 'color' | 'image'
  bgFillBrightness?: 'light3' | 'light2' | 'light1' | 'neutral' | 'dim1' | 'dim2' | 'dim3'
  bgFillBlur?: 'soft' | 'medium' | 'strong' | 'very_strong'
  bgFillColor?: string
  bgFillImageUploadId?: number | null
}

export type Still = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  sourceClipId?: string
}

export type Graphic = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  // Optional placement fields. When absent, graphics render full-frame (legacy).
  fitMode?: 'cover_full' | 'contain_transparent'
  sizePctWidth?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
  insetXPx?: number
  insetYPx?: number
  // Optional presentation effects (v1).
  borderWidthPx?: 0 | 2 | 4 | 6
  borderColor?: string
  fade?: 'none' | 'in' | 'out' | 'in_out'
  fadeDurationMs?: number
  // Optional motion effects (v1.1).
  animate?: 'none' | 'slide_in' | 'slide_out' | 'slide_in_out' | 'doc_reveal'
  animateDurationMs?: number
}

export type VideoOverlay = {
  id: string
  uploadId: number
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
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
  audioEnabled?: boolean
  plateStyle?: 'none' | 'thin' | 'medium' | 'thick' | 'band'
  plateColor?: string
  plateOpacityPct?: number
}

export type VideoOverlayStill = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  // Optional linkage for debugging/UX (e.g. which overlay generated this).
  sourceVideoOverlayId?: string
  // Optional: keep the still pinned to the same overlay box layout as its originating overlay (when known).
  sizePctWidth?: number
  position?: VideoOverlay['position']
}

export type Logo = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  // Simplified logo placement (Create Video v1).
  sizePctWidth?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
  opacityPct?: number
  fade?: 'none' | 'in' | 'out' | 'in_out'
  insetXPx?: number
  insetYPx?: number
}

export type LowerThirdConfigSnapshot = {
  id: number
  name: string
  description?: string | null
  sizeMode: 'pct' | 'match_image'
  baselineWidth: 1080 | 1920
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: 'first_only' | 'entire'
  timingSeconds: number | null
  fade: string
  insetXPreset?: string | null
  insetYPreset?: string | null
}

export type LowerThird = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  configId: number
  configSnapshot: LowerThirdConfigSnapshot
}

export type AudioTrack = {
  uploadId: number
  audioConfigId: number
  startSeconds: number
  endSeconds: number
}

export type AudioSegment = {
  id: string
  uploadId: number
  audioConfigId: number
  startSeconds: number
  endSeconds: number
  audioEnabled?: boolean
  // Offset into the audio file for where this segment begins (in seconds).
  // This enables split/trim to play the continuation instead of restarting at 0.
  sourceStartSeconds?: number
  // Music mix behavior for this segment.
  musicMode?: 'opener_cutoff' | 'replace' | 'mix' | 'mix_duck'
  musicLevel?: 'quiet' | 'medium' | 'loud'
  duckingIntensity?: 'min' | 'medium' | 'max'
}

export type Narration = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  audioEnabled?: boolean
  // Offset into the audio file for where this segment begins (in seconds).
  // This enables split/trim to play the continuation instead of restarting at 0.
  sourceStartSeconds?: number
  gainDb?: number
  visualizer?: NarrationVisualizerConfig
}

export type NarrationVisualizerStyle = 'wave_line' | 'wave_fill' | 'spectrum_bars' | 'radial_bars'
export type NarrationVisualizerScale = 'linear' | 'log'
export type NarrationVisualizerConfig = {
  enabled: boolean
  style: NarrationVisualizerStyle
  fgColor: string
  gradientEnabled?: boolean
  gradientStart?: string
  gradientEnd?: string
  gradientMode?: 'vertical' | 'horizontal'
  clipMode?: 'none' | 'rect'
  clipInsetPct?: number
  clipHeightPct?: number
  bgColor: string | 'transparent'
  opacity: number
  scale: NarrationVisualizerScale
}

export type VisualizerStyle = 'wave_line' | 'wave_fill' | 'spectrum_bars' | 'radial_bars'
export type VisualizerScale = 'linear' | 'log'
export type VisualizerGradientMode = 'vertical' | 'horizontal'
export type VisualizerClipMode = 'none' | 'rect'
export type VisualizerSpectrumMode = 'full' | 'voice'
export type VisualizerBandMode = 'full' | 'band_1' | 'band_2' | 'band_3' | 'band_4'

export type VisualizerPresetInstanceSnapshot = {
  id: string
  style: VisualizerStyle
  fgColor: string
  opacity: number
  scale: VisualizerScale
  barCount: number
  spectrumMode: VisualizerSpectrumMode
  bandMode: VisualizerBandMode
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: VisualizerGradientMode
}

export type VisualizerPresetSnapshot = {
  id: number
  name: string
  description?: string | null
  style: VisualizerStyle
  fgColor: string
  bgColor: string | 'transparent'
  opacity: number
  scale: VisualizerScale
  barCount: number
  spectrumMode: VisualizerSpectrumMode
  bandMode: VisualizerBandMode
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: VisualizerGradientMode
  clipMode: VisualizerClipMode
  clipInsetPct: number
  clipHeightPct: number
  instances?: VisualizerPresetInstanceSnapshot[]
}

export type VisualizerSegment = {
  id: string
  presetId: number
  presetSnapshot: VisualizerPresetSnapshot | null
  startSeconds: number
  endSeconds: number
  audioSourceKind: 'video' | 'video_overlay' | 'narration' | 'music'
  audioSourceSegmentId?: string | null
  audioSourceStartSeconds?: number
  sizePctWidth?: number
  sizePctHeight?: number
  insetXPx?: number
  insetYPx?: number
  position?:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right'
  fitMode?: 'contain' | 'cover'
}

export const DEFAULT_NARRATION_VISUALIZER: NarrationVisualizerConfig = {
  enabled: false,
  style: 'wave_line',
  fgColor: '#d4af37',
  gradientEnabled: false,
  gradientStart: '#d4af37',
  gradientEnd: '#f7d774',
  gradientMode: 'vertical',
  clipMode: 'none',
  clipInsetPct: 6,
  clipHeightPct: 100,
  bgColor: 'transparent',
  opacity: 1,
  scale: 'linear',
}

export const DEFAULT_VISUALIZER_PRESET_SNAPSHOT: VisualizerPresetSnapshot = {
  id: 0,
  name: 'Visualizer Preset',
  description: null,
  style: 'wave_line',
  fgColor: '#d4af37',
  bgColor: 'transparent',
  opacity: 1,
  scale: 'linear',
  barCount: 48,
  spectrumMode: 'full',
  bandMode: 'full',
  gradientEnabled: false,
  gradientStart: '#d4af37',
  gradientEnd: '#f7d774',
  gradientMode: 'vertical',
  clipMode: 'none',
  clipInsetPct: 6,
  clipHeightPct: 100,
  instances: [
    {
      id: 'instance_1',
      style: 'wave_line',
      fgColor: '#d4af37',
      opacity: 1,
      scale: 'linear',
      barCount: 48,
      spectrumMode: 'full',
      bandMode: 'full',
      gradientEnabled: false,
      gradientStart: '#d4af37',
      gradientEnd: '#f7d774',
      gradientMode: 'vertical',
    },
  ],
}

export function normalizeNarrationVisualizer(raw: any): NarrationVisualizerConfig {
  const styleRaw = String(raw?.style || DEFAULT_NARRATION_VISUALIZER.style).trim().toLowerCase()
  const styleAllowed = new Set(['wave_line', 'wave_fill', 'spectrum_bars', 'radial_bars'])
  const style = styleAllowed.has(styleRaw) ? (styleRaw as NarrationVisualizerStyle) : DEFAULT_NARRATION_VISUALIZER.style
  const scaleRaw = String(raw?.scale || DEFAULT_NARRATION_VISUALIZER.scale).trim().toLowerCase()
  const scale = scaleRaw === 'log' ? 'log' : 'linear'
  const fgColor = normalizeHexColor(raw?.fgColor, DEFAULT_NARRATION_VISUALIZER.fgColor)
  const gradientEnabled = raw?.gradientEnabled === true
  const gradientStart = normalizeHexColor(raw?.gradientStart, fgColor)
  const gradientEnd = normalizeHexColor(raw?.gradientEnd, DEFAULT_NARRATION_VISUALIZER.gradientEnd || '#f7d774')
  const gradientModeRaw = String(raw?.gradientMode || DEFAULT_NARRATION_VISUALIZER.gradientMode || 'vertical').trim().toLowerCase()
  const gradientMode = gradientModeRaw === 'horizontal' ? 'horizontal' : 'vertical'
  const clipModeRaw = String(raw?.clipMode || DEFAULT_NARRATION_VISUALIZER.clipMode || 'none').trim().toLowerCase()
  const clipMode = clipModeRaw === 'rect' ? 'rect' : 'none'
  const clipInsetRaw = Number(raw?.clipInsetPct)
  const clipInsetPct = Number.isFinite(clipInsetRaw) ? Math.max(0, Math.min(40, clipInsetRaw)) : (DEFAULT_NARRATION_VISUALIZER.clipInsetPct || 0)
  const clipHeightRaw = Number(raw?.clipHeightPct)
  const clipHeightPct = Number.isFinite(clipHeightRaw) ? Math.max(10, Math.min(100, clipHeightRaw)) : (DEFAULT_NARRATION_VISUALIZER.clipHeightPct || 100)
  const bgRaw = String(raw?.bgColor || DEFAULT_NARRATION_VISUALIZER.bgColor).trim().toLowerCase()
  const bgColor = bgRaw === 'transparent' ? 'transparent' : normalizeHexColor(bgRaw, '#000000')
  const opacityRaw = Number(raw?.opacity)
  const opacity = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(1, opacityRaw)) : DEFAULT_NARRATION_VISUALIZER.opacity
  const enabled = raw?.enabled === true
  return { enabled, style, fgColor, gradientEnabled, gradientStart, gradientEnd, gradientMode, clipMode, clipInsetPct, clipHeightPct, bgColor, opacity, scale }
}

function normalizeHexColor(raw: any, fallback: string): string {
  const s = String(raw == null ? fallback : raw).trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(s)) return fallback
  return s.startsWith('#') ? s : `#${s}`
}

export type ScreenTitlePresetSnapshot = {
  id: number
  name: string
  // Legacy: some stored timelines may still contain style='outline' (used to mean "no background + outline").
  style: 'none' | 'pill' | 'merged_pill' | 'outline'
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
  alignment?: 'left' | 'center' | 'right'
  position: 'top' | 'middle' | 'bottom'
  maxWidthPct: number
  insetXPreset: 'small' | 'medium' | 'large' | null
  insetYPreset: 'small' | 'medium' | 'large' | null
  marginLeftPct?: number | null
  marginRightPct?: number | null
  marginTopPct?: number | null
  marginBottomPct?: number | null
  fade: 'none' | 'in' | 'out' | 'in_out'
}

export type ScreenTitleCustomStyle = {
  position?: 'top' | 'middle' | 'bottom'
  alignment?: 'left' | 'center' | 'right'
  marginXPx?: number
  marginYPx?: number
  offsetXPx?: number
  offsetYPx?: number
  placementRect?: {
    xPct: number
    yPct: number
    wPct: number
    hPct: number
  } | null
  fontKey?: string
  fontSizePct?: number
  fontColor?: string
  fontGradientKey?: string | null
}

export type ScreenTitleInstance = {
  id: string
  text: string
  customStyle?: ScreenTitleCustomStyle | null
}

export type ScreenTitle = {
  id: string
  startSeconds: number
  endSeconds: number
  presetId: number | null
  presetSnapshot: ScreenTitlePresetSnapshot | null
  customStyle?: ScreenTitleCustomStyle | null
  text: string
  instances?: ScreenTitleInstance[]
  renderUploadId: number | null
}

export type Timeline = {
  version: 'create_video_v1'
  playheadSeconds: number
  timelineBackgroundMode?: 'none' | 'color' | 'image'
  timelineBackgroundColor?: string
  timelineBackgroundUploadId?: number | null
  viewportEndSeconds?: number
  clips: Clip[]
  stills?: Still[]
  videoOverlays?: VideoOverlay[]
  videoOverlayStills?: VideoOverlayStill[]
  graphics: Graphic[]
  guidelines?: number[]
  logos?: Logo[]
  lowerThirds?: LowerThird[]
  screenTitles?: ScreenTitle[]
  narration?: Narration[]
  visualizers?: VisualizerSegment[]
  audioSegments?: AudioSegment[]
  // Deprecated: retained for backward compatibility with existing projects.
  audioTrack?: AudioTrack | null
}

export type TimelineSnapshot = { timeline: Timeline; selectedClipId: string | null }

export function cloneTimeline(timeline: Timeline): Timeline {
  return {
    version: 'create_video_v1',
    playheadSeconds: Number(timeline.playheadSeconds || 0),
    timelineBackgroundMode:
      String((timeline as any).timelineBackgroundMode || 'none').trim().toLowerCase() === 'color'
        ? 'color'
        : String((timeline as any).timelineBackgroundMode || 'none').trim().toLowerCase() === 'image'
          ? 'image'
          : 'none',
    timelineBackgroundColor: (() => {
      const raw = String((timeline as any).timelineBackgroundColor || '#000000').trim()
      if (/^#?[0-9a-fA-F]{6}$/.test(raw)) return raw.startsWith('#') ? raw : `#${raw}`
      return '#000000'
    })(),
    timelineBackgroundUploadId:
      (timeline as any).timelineBackgroundUploadId == null
        ? null
        : Number.isFinite(Number((timeline as any).timelineBackgroundUploadId)) && Number((timeline as any).timelineBackgroundUploadId) > 0
          ? Number((timeline as any).timelineBackgroundUploadId)
          : null,
    viewportEndSeconds:
      (timeline as any).viewportEndSeconds == null
        ? undefined
        : Number.isFinite(Number((timeline as any).viewportEndSeconds))
          ? Number((timeline as any).viewportEndSeconds)
          : undefined,
    clips: timeline.clips.map((c) => ({
      id: String(c.id),
      uploadId: Number(c.uploadId),
      startSeconds: (c as any).startSeconds != null ? Number((c as any).startSeconds) : undefined,
      sourceStartSeconds: Number(c.sourceStartSeconds),
      sourceEndSeconds: Number(c.sourceEndSeconds),
      audioEnabled: (c as any).audioEnabled == null ? true : Boolean((c as any).audioEnabled),
      freezeStartSeconds: (c as any).freezeStartSeconds != null ? Number((c as any).freezeStartSeconds) : undefined,
      freezeEndSeconds: (c as any).freezeEndSeconds != null ? Number((c as any).freezeEndSeconds) : undefined,
      bgFillStyle: (() => {
        const raw = String((c as any).bgFillStyle || 'none').trim().toLowerCase()
        return raw === 'blur' ? 'blur' : raw === 'color' ? 'color' : raw === 'image' ? 'image' : 'none'
      })(),
      bgFillBrightness:
        (c as any).bgFillBrightness == null ? undefined : ((String((c as any).bgFillBrightness) as any) || undefined),
      bgFillBlur: (c as any).bgFillBlur == null ? undefined : ((String((c as any).bgFillBlur) as any) || undefined),
      bgFillColor: (() => {
        const raw = String((c as any).bgFillColor || '#000000').trim()
        if (/^#?[0-9a-fA-F]{6}$/.test(raw)) return raw.startsWith('#') ? raw : `#${raw}`
        return '#000000'
      })(),
      bgFillImageUploadId:
        (c as any).bgFillImageUploadId == null
          ? null
          : Number.isFinite(Number((c as any).bgFillImageUploadId)) && Number((c as any).bgFillImageUploadId) > 0
            ? Number((c as any).bgFillImageUploadId)
            : null,
    })),
    stills: Array.isArray((timeline as any).stills)
      ? (timeline as any).stills.map((s: any) => ({
          id: String(s.id),
          uploadId: Number(s.uploadId),
          startSeconds: Number(s.startSeconds),
          endSeconds: Number(s.endSeconds),
          sourceClipId: s.sourceClipId != null ? String(s.sourceClipId) : undefined,
        }))
      : [],
    videoOverlays: Array.isArray((timeline as any).videoOverlays)
      ? (timeline as any).videoOverlays.map((o: any) => ({
          id: String(o.id),
          uploadId: Number(o.uploadId),
          startSeconds: o.startSeconds != null ? Number(o.startSeconds) : undefined,
          sourceStartSeconds: Number(o.sourceStartSeconds ?? 0),
          sourceEndSeconds: Number(o.sourceEndSeconds ?? 0),
          sizePctWidth: Number(o.sizePctWidth ?? 40),
          position: String(o.position || 'bottom_right') as any,
          audioEnabled: o.audioEnabled == null ? false : Boolean(o.audioEnabled),
          plateStyle: String((o as any).plateStyle || 'none') as any,
          plateColor: (o as any).plateColor != null ? String((o as any).plateColor) : '#000000',
          plateOpacityPct: (o as any).plateOpacityPct != null ? Number((o as any).plateOpacityPct) : 85,
        }))
      : [],
    videoOverlayStills: Array.isArray((timeline as any).videoOverlayStills)
      ? (timeline as any).videoOverlayStills.map((s: any) => ({
          id: String(s.id),
          uploadId: Number(s.uploadId),
          startSeconds: Number(s.startSeconds),
          endSeconds: Number(s.endSeconds),
          sourceVideoOverlayId: s.sourceVideoOverlayId != null ? String(s.sourceVideoOverlayId) : undefined,
          sizePctWidth: s.sizePctWidth != null ? Number(s.sizePctWidth) : undefined,
          position: s.position != null ? (String(s.position) as any) : undefined,
        }))
      : [],
    graphics: Array.isArray((timeline as any).graphics)
      ? (timeline as any).graphics.map((g: any) => ({
          id: String(g.id),
          uploadId: Number(g.uploadId),
          startSeconds: Number(g.startSeconds),
          endSeconds: Number(g.endSeconds),
          fitMode: g.fitMode != null ? (String(g.fitMode) as any) : undefined,
          sizePctWidth: g.sizePctWidth != null ? Number(g.sizePctWidth) : undefined,
          position: g.position != null ? (String(g.position) as any) : undefined,
          insetXPx: g.insetXPx != null ? Number(g.insetXPx) : undefined,
          insetYPx: g.insetYPx != null ? Number(g.insetYPx) : undefined,
          borderWidthPx: g.borderWidthPx != null ? (Number(g.borderWidthPx) as any) : undefined,
          borderColor: g.borderColor != null ? String(g.borderColor) : undefined,
          fade: g.fade != null ? (String(g.fade) as any) : undefined,
          fadeDurationMs: g.fadeDurationMs != null ? Number(g.fadeDurationMs) : undefined,
          animate: g.animate != null ? (String(g.animate) as any) : undefined,
          animateDurationMs: g.animateDurationMs != null ? Number(g.animateDurationMs) : undefined,
        }))
      : [],
    guidelines: Array.isArray((timeline as any).guidelines)
      ? (timeline as any).guidelines
          .map((t: any) => Number(t))
          .filter((t: any) => Number.isFinite(t))
      : [],
    narration: Array.isArray((timeline as any).narration)
      ? (timeline as any).narration.map((n: any) => ({
          id: String(n.id),
          uploadId: Number(n.uploadId),
          startSeconds: Number(n.startSeconds),
          endSeconds: Number(n.endSeconds),
          audioEnabled: n.audioEnabled == null ? true : Boolean(n.audioEnabled),
          sourceStartSeconds: n.sourceStartSeconds == null ? 0 : Number(n.sourceStartSeconds),
          gainDb: n.gainDb == null ? 0 : Number(n.gainDb),
          visualizer: normalizeNarrationVisualizer((n as any).visualizer),
        }))
      : [],
    visualizers: Array.isArray((timeline as any).visualizers)
      ? (timeline as any).visualizers
          .map((v: any) => {
            const presetIdRaw = Number((v as any).presetId)
            const presetId = Number.isFinite(presetIdRaw) && presetIdRaw > 0 ? presetIdRaw : 0
            const snapRaw = (v as any).presetSnapshot
            const snapBase: any = snapRaw && typeof snapRaw === 'object' ? snapRaw : {}
            const snapshot: VisualizerPresetSnapshot = {
              ...DEFAULT_VISUALIZER_PRESET_SNAPSHOT,
              id: Number(snapBase.id ?? presetId ?? DEFAULT_VISUALIZER_PRESET_SNAPSHOT.id) || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.id,
              name: String(snapBase.name || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.name),
              description:
                snapBase.description == null ? DEFAULT_VISUALIZER_PRESET_SNAPSHOT.description : String(snapBase.description),
              style: (String(snapBase.style || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.style) as any) || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.style,
              fgColor: String(snapBase.fgColor || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.fgColor),
              bgColor: (snapBase.bgColor == null ? DEFAULT_VISUALIZER_PRESET_SNAPSHOT.bgColor : snapBase.bgColor) as any,
              opacity: Number.isFinite(Number(snapBase.opacity)) ? Number(snapBase.opacity) : DEFAULT_VISUALIZER_PRESET_SNAPSHOT.opacity,
              scale: (String(snapBase.scale || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.scale) as any) || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.scale,
              barCount: Number.isFinite(Number(snapBase.barCount))
                ? Math.max(12, Math.min(128, Number(snapBase.barCount)))
                : DEFAULT_VISUALIZER_PRESET_SNAPSHOT.barCount,
              spectrumMode:
                String(snapBase.spectrumMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.spectrumMode).trim().toLowerCase() === 'voice'
                  ? 'voice'
                  : 'full',
              bandMode:
                String(snapBase.bandMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.bandMode).trim().toLowerCase() === 'band_1' ||
                String(snapBase.bandMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.bandMode).trim().toLowerCase() === 'band_2' ||
                String(snapBase.bandMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.bandMode).trim().toLowerCase() === 'band_3' ||
                String(snapBase.bandMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.bandMode).trim().toLowerCase() === 'band_4'
                  ? (String(snapBase.bandMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.bandMode).trim().toLowerCase() as any)
                  : 'full',
              gradientEnabled: snapBase.gradientEnabled === true,
              gradientStart: String(snapBase.gradientStart || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.gradientStart),
              gradientEnd: String(snapBase.gradientEnd || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.gradientEnd),
              gradientMode:
                (String(snapBase.gradientMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.gradientMode) as any) || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.gradientMode,
              clipMode: (String(snapBase.clipMode || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.clipMode) as any) || DEFAULT_VISUALIZER_PRESET_SNAPSHOT.clipMode,
              clipInsetPct: Number.isFinite(Number(snapBase.clipInsetPct))
                ? Number(snapBase.clipInsetPct)
                : DEFAULT_VISUALIZER_PRESET_SNAPSHOT.clipInsetPct,
              clipHeightPct: Number.isFinite(Number(snapBase.clipHeightPct))
                ? Number(snapBase.clipHeightPct)
                : DEFAULT_VISUALIZER_PRESET_SNAPSHOT.clipHeightPct,
            }
            const instancesRaw = Array.isArray((snapBase as any).instances) ? ((snapBase as any).instances as any[]) : []
            const normalizedInstances = instancesRaw
              .slice(0, 8)
              .map((inst: any, idx: number) => {
                const styleRaw = String(inst?.style || snapshot.style).trim().toLowerCase()
                const style =
                  styleRaw === 'wave_fill' || styleRaw === 'spectrum_bars' || styleRaw === 'radial_bars'
                    ? (styleRaw as any)
                    : 'wave_line'
                const scaleRaw = String(inst?.scale || snapshot.scale).trim().toLowerCase()
                const scale = scaleRaw === 'log' ? 'log' : 'linear'
                const spectrumRaw = String(inst?.spectrumMode || snapshot.spectrumMode).trim().toLowerCase()
                const spectrumMode = spectrumRaw === 'voice' ? 'voice' : 'full'
                const bandRaw = String(inst?.bandMode || snapshot.bandMode || 'full').trim().toLowerCase()
                const bandMode =
                  bandRaw === 'band_1' || bandRaw === 'band_2' || bandRaw === 'band_3' || bandRaw === 'band_4' ? (bandRaw as any) : 'full'
                const gradientModeRaw = String(inst?.gradientMode || snapshot.gradientMode).trim().toLowerCase()
                const gradientMode = gradientModeRaw === 'horizontal' ? 'horizontal' : 'vertical'
                return {
                  id: String(inst?.id || `instance_${idx + 1}`),
                  style,
                  fgColor: String(inst?.fgColor || snapshot.fgColor),
                  opacity: Number.isFinite(Number(inst?.opacity)) ? Math.max(0, Math.min(1, Number(inst?.opacity))) : snapshot.opacity,
                  scale,
                  barCount: Number.isFinite(Number(inst?.barCount))
                    ? Math.max(12, Math.min(128, Number(inst?.barCount)))
                    : snapshot.barCount,
                  spectrumMode,
                  bandMode,
                  gradientEnabled: inst?.gradientEnabled === true,
                  gradientStart: String(inst?.gradientStart || snapshot.gradientStart),
                  gradientEnd: String(inst?.gradientEnd || snapshot.gradientEnd),
                  gradientMode,
                } as VisualizerPresetInstanceSnapshot
              })
            snapshot.instances =
              normalizedInstances.length > 0
                ? normalizedInstances
                : [
                    {
                      id: 'instance_1',
                      style: snapshot.style,
                      fgColor: snapshot.fgColor,
                      opacity: snapshot.opacity,
                      scale: snapshot.scale,
                      barCount: snapshot.barCount,
                      spectrumMode: snapshot.spectrumMode,
                      bandMode: snapshot.bandMode || 'full',
                      gradientEnabled: snapshot.gradientEnabled,
                      gradientStart: snapshot.gradientStart,
                      gradientEnd: snapshot.gradientEnd,
                      gradientMode: snapshot.gradientMode,
                    },
                  ]
            const kindRaw = String((v as any).audioSourceKind || '').trim().toLowerCase()
            const audioSourceKind =
              kindRaw === 'video_overlay'
                ? 'video_overlay'
                : kindRaw === 'video'
                  ? 'video'
                  : kindRaw === 'music'
                    ? 'music'
                    : 'narration'
            const positionRaw = String((v as any).position || '').trim().toLowerCase()
            const positionAllowed = new Set([
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
            const position = positionAllowed.has(positionRaw) ? (positionRaw as any) : 'middle_center'
            const fitRaw = String((v as any).fitMode || '').trim().toLowerCase()
            const fitMode = fitRaw === 'cover' ? 'cover' : 'contain'
            const sizePctWidthRaw = Number((v as any).sizePctWidth)
            const sizePctHeightRaw = Number((v as any).sizePctHeight)
            const sizePctWidth = Number.isFinite(sizePctWidthRaw) ? Math.max(10, Math.min(100, sizePctWidthRaw)) : 100
            const sizePctHeight = Number.isFinite(sizePctHeightRaw) ? Math.max(10, Math.min(100, sizePctHeightRaw)) : 100
            const insetXPxRaw = Number((v as any).insetXPx)
            const insetYPxRaw = Number((v as any).insetYPx)
            const insetXPx = Number.isFinite(insetXPxRaw) ? Math.max(0, Math.min(200, insetXPxRaw)) : 0
            const insetYPx = Number.isFinite(insetYPxRaw) ? Math.max(0, Math.min(200, insetYPxRaw)) : 0
            return {
              id: String((v as any).id || ''),
              presetId,
              presetSnapshot: snapshot,
              startSeconds: Number((v as any).startSeconds),
              endSeconds: Number((v as any).endSeconds),
              audioSourceKind,
              audioSourceSegmentId: (v as any).audioSourceSegmentId != null ? String((v as any).audioSourceSegmentId) : null,
              audioSourceStartSeconds:
                (v as any).audioSourceStartSeconds == null ? undefined : Number((v as any).audioSourceStartSeconds),
              sizePctWidth,
              sizePctHeight,
              insetXPx,
              insetYPx,
              position,
              fitMode,
            }
          })
          .filter((v: any) => v && v.id)
      : [],
    audioSegments: Array.isArray((timeline as any).audioSegments)
      ? (timeline as any).audioSegments.map((s: any) => ({
          id: String(s.id),
          uploadId: Number(s.uploadId),
          audioConfigId: Number(s.audioConfigId),
          startSeconds: Number(s.startSeconds),
          endSeconds: Number(s.endSeconds),
          audioEnabled: s.audioEnabled == null ? true : Boolean(s.audioEnabled),
          sourceStartSeconds: s.sourceStartSeconds == null ? 0 : Number(s.sourceStartSeconds),
          musicMode: s.musicMode == null ? undefined : String(s.musicMode),
          musicLevel: s.musicLevel == null ? undefined : String(s.musicLevel),
          duckingIntensity: s.duckingIntensity == null ? undefined : String(s.duckingIntensity),
        }))
      : [],
    screenTitles: Array.isArray((timeline as any).screenTitles)
      ? (timeline as any).screenTitles.map((st: any) => {
          const mapCustomStyle = (raw: any): ScreenTitleCustomStyle | null => {
            if (!raw || typeof raw !== 'object') return null
            const xRaw = Number((raw as any).placementRect?.xPct)
            const yRaw = Number((raw as any).placementRect?.yPct)
            const wRaw = Number((raw as any).placementRect?.wPct)
            const hRaw = Number((raw as any).placementRect?.hPct)
            let placementRect: { xPct: number; yPct: number; wPct: number; hPct: number } | null = null
            if (Number.isFinite(xRaw) && Number.isFinite(yRaw) && Number.isFinite(wRaw) && Number.isFinite(hRaw)) {
              let xPct = Math.min(100, Math.max(0, Number(xRaw)))
              let yPct = Math.min(100, Math.max(0, Number(yRaw)))
              let wPct = Math.min(100, Math.max(0, Number(wRaw)))
              let hPct = Math.min(100, Math.max(0, Number(hRaw)))
              wPct = Math.min(wPct, Math.max(0, 100 - xPct))
              hPct = Math.min(hPct, Math.max(0, 100 - yPct))
              if (wPct > 0.001 && hPct > 0.001) {
                placementRect = {
                  xPct: Math.round(xPct * 1000) / 1000,
                  yPct: Math.round(yPct * 1000) / 1000,
                  wPct: Math.round(wPct * 1000) / 1000,
                  hPct: Math.round(hPct * 1000) / 1000,
                }
              }
            }
            return {
              position:
                String(raw.position || '').trim().toLowerCase() === 'bottom'
                  ? 'bottom'
                  : String(raw.position || '').trim().toLowerCase() === 'middle'
                    ? 'middle'
                    : String(raw.position || '').trim().toLowerCase() === 'top'
                      ? 'top'
                      : undefined,
              alignment:
                String(raw.alignment || '').trim().toLowerCase() === 'left'
                  ? 'left'
                  : String(raw.alignment || '').trim().toLowerCase() === 'right'
                    ? 'right'
                    : String(raw.alignment || '').trim().toLowerCase() === 'center'
                      ? 'center'
                      : undefined,
              marginXPx: raw.marginXPx == null ? undefined : Number(raw.marginXPx),
              marginYPx: raw.marginYPx == null ? undefined : Number(raw.marginYPx),
              offsetXPx: raw.offsetXPx == null ? undefined : Number(raw.offsetXPx),
              offsetYPx: raw.offsetYPx == null ? undefined : Number(raw.offsetYPx),
              placementRect,
              fontKey: raw.fontKey == null ? undefined : String(raw.fontKey),
              fontSizePct: raw.fontSizePct == null ? undefined : Number(raw.fontSizePct),
              fontColor: raw.fontColor == null ? undefined : String(raw.fontColor),
              fontGradientKey:
                raw.fontGradientKey === undefined
                  ? undefined
                  : raw.fontGradientKey == null
                    ? null
                    : String(raw.fontGradientKey),
            }
          }
          const legacyText = st.text == null ? '' : String(st.text)
          const legacyCustomStyle = mapCustomStyle(st.customStyle)
          const instancesRaw = Array.isArray(st.instances) ? st.instances : []
          const instances = instancesRaw.length
            ? instancesRaw.map((inst: any, idx: number) => ({
                id: String(inst?.id || `${String(st.id)}_i${idx + 1}`),
                text: inst?.text == null ? '' : String(inst.text),
                customStyle: mapCustomStyle(inst?.customStyle),
              }))
            : [
                {
                  id: `${String(st.id)}_i1`,
                  text: legacyText,
                  customStyle: legacyCustomStyle,
                },
              ]
          const primary = instances[0] || { text: legacyText, customStyle: legacyCustomStyle }
          return {
            id: String(st.id),
            startSeconds: Number(st.startSeconds),
            endSeconds: Number(st.endSeconds),
            presetId: st.presetId == null ? null : Number(st.presetId),
            presetSnapshot:
              st.presetSnapshot && typeof st.presetSnapshot === 'object'
                ? {
                    id: Number(st.presetSnapshot.id),
                    name: String(st.presetSnapshot.name || ''),
                    style: (String(st.presetSnapshot.style || 'outline').toLowerCase() === 'pill'
                      ? 'pill'
                      : String(st.presetSnapshot.style || 'outline').toLowerCase() === 'merged_pill'
                        ? 'merged_pill'
                        : String(st.presetSnapshot.style || 'outline').toLowerCase() === 'strip'
                          ? 'pill'
                          : 'outline') as any,
                    fontKey: String(st.presetSnapshot.fontKey || 'dejavu_sans_bold'),
                    fontSizePct: Number(st.presetSnapshot.fontSizePct),
                    trackingPct: Number(st.presetSnapshot.trackingPct),
                    fontColor: String(st.presetSnapshot.fontColor || '#ffffff'),
                    pillBgColor: String(st.presetSnapshot.pillBgColor || '#000000'),
                    pillBgOpacityPct: Number(st.presetSnapshot.pillBgOpacityPct),
                    position: (String(st.presetSnapshot.position || 'top').toLowerCase() === 'bottom'
                      ? 'bottom'
                      : String(st.presetSnapshot.position || 'top').toLowerCase() === 'middle'
                        ? 'middle'
                        : 'top') as any,
                    maxWidthPct: Number(st.presetSnapshot.maxWidthPct),
                    insetXPreset: st.presetSnapshot.insetXPreset == null ? null : (String(st.presetSnapshot.insetXPreset || '').trim() as any),
                    insetYPreset: st.presetSnapshot.insetYPreset == null ? null : (String(st.presetSnapshot.insetYPreset || '').trim() as any),
                    fade: (String(st.presetSnapshot.fade || 'none').toLowerCase() === 'in_out'
                      ? 'in_out'
                      : String(st.presetSnapshot.fade || 'none').toLowerCase() === 'in'
                        ? 'in'
                        : String(st.presetSnapshot.fade || 'none').toLowerCase() === 'out'
                          ? 'out'
                          : 'none') as any,
                  }
                : null,
            customStyle: primary?.customStyle || null,
            text: primary?.text == null ? '' : String(primary.text),
            instances,
            renderUploadId: st.renderUploadId == null ? null : Number(st.renderUploadId),
          }
        })
      : [],
    logos: Array.isArray((timeline as any).logos)
      ? (timeline as any).logos.map((l: any) => ({
          id: String(l.id),
          uploadId: Number(l.uploadId),
          startSeconds: Number(l.startSeconds),
          endSeconds: Number(l.endSeconds),
          // Legacy timelines may contain logo configs; we normalize to the new simplified fields with defaults.
          sizePctWidth: (() => {
            const raw = l?.sizePctWidth
            const n = Math.round(Number(raw))
            if (Number.isFinite(n) && n >= 1 && n <= 100) return n
            return 20
          })(),
          position: (() => {
            const raw = String(l?.position || '').trim()
            const allowed = new Set([
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
            if (allowed.has(raw)) return raw as any
            return 'top_left' as any
          })(),
          opacityPct: (() => {
            const n = Math.round(Number(l?.opacityPct))
            if (Number.isFinite(n) && n >= 0 && n <= 100) return n
            return 100
          })(),
          fade: (() => {
            const raw = String(l?.fade || '').trim().toLowerCase()
            if (raw === 'in') return 'in' as any
            if (raw === 'out') return 'out' as any
            if (raw === 'in_out') return 'in_out' as any
            return 'none' as any
          })(),
          insetXPx: (() => {
            const n = Math.round(Number(l?.insetXPx))
            if (Number.isFinite(n) && n >= 0 && n <= 9999) return n
	            return 100
	          })(),
	          insetYPx: (() => {
	            const n = Math.round(Number(l?.insetYPx))
	            if (Number.isFinite(n) && n >= 0 && n <= 9999) return n
	            return 100
	          })(),
        }))
      : [],
    lowerThirds: Array.isArray((timeline as any).lowerThirds)
      ? (timeline as any).lowerThirds.map((lt: any) => ({
          id: String(lt.id),
          uploadId: Number(lt.uploadId),
          startSeconds: Number(lt.startSeconds),
          endSeconds: Number(lt.endSeconds),
          configId: Number(lt.configId),
          configSnapshot:
            lt.configSnapshot && typeof lt.configSnapshot === 'object'
              ? {
                  id: Number(lt.configSnapshot.id),
                  name: String(lt.configSnapshot.name || ''),
                  description: lt.configSnapshot.description == null ? null : String(lt.configSnapshot.description),
                  sizeMode: (String(lt.configSnapshot.sizeMode || 'pct').toLowerCase() === 'match_image' ? 'match_image' : 'pct') as any,
                  baselineWidth: Number(lt.configSnapshot.baselineWidth) === 1920 ? 1920 : 1080,
                  position: String(lt.configSnapshot.position || 'bottom_center'),
                  sizePctWidth: Number(lt.configSnapshot.sizePctWidth),
                  opacityPct: Number(lt.configSnapshot.opacityPct),
                  timingRule: (String(lt.configSnapshot.timingRule || 'first_only').toLowerCase() === 'entire' ? 'entire' : 'first_only') as any,
                  timingSeconds: lt.configSnapshot.timingSeconds == null ? null : Number(lt.configSnapshot.timingSeconds),
                  fade: String(lt.configSnapshot.fade || ''),
                  insetXPreset: lt.configSnapshot.insetXPreset == null ? null : String(lt.configSnapshot.insetXPreset),
                  insetYPreset: lt.configSnapshot.insetYPreset == null ? null : String(lt.configSnapshot.insetYPreset),
                }
              : ({ id: 0, name: '', description: null, sizeMode: 'pct', baselineWidth: 1080, position: 'bottom_center', sizePctWidth: 82, opacityPct: 100, timingRule: 'first_only', timingSeconds: 10, fade: 'none', insetXPreset: null, insetYPreset: null } as any),
        }))
      : [],
    audioTrack:
      (timeline as any).audioTrack && typeof (timeline as any).audioTrack === 'object'
        ? {
            uploadId: Number((timeline as any).audioTrack.uploadId),
            audioConfigId: Number((timeline as any).audioTrack.audioConfigId),
            startSeconds: Number((timeline as any).audioTrack.startSeconds),
            endSeconds: Number((timeline as any).audioTrack.endSeconds),
          }
        : null,
  }
}
