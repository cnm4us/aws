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
        }))
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
