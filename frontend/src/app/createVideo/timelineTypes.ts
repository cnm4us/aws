export type Clip = {
  id: string
  uploadId: number
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  freezeStartSeconds?: number
  freezeEndSeconds?: number
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
}

export type LogoConfigSnapshot = {
  id: number
  name: string
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: string
  timingSeconds: number | null
  fade: string
  insetXPreset?: string | null
  insetYPreset?: string | null
}

export type Logo = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  configId: number
  configSnapshot: LogoConfigSnapshot
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

export type Narration = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
  gainDb?: number
}

export type ScreenTitlePresetSnapshot = {
  id: number
  name: string
  style: 'pill' | 'outline' | 'strip'
  fontKey: string
  fontSizePct: number
  trackingPct: number
  fontColor: string
  pillBgColor: string
  pillBgOpacityPct: number
  position: 'top' | 'middle' | 'bottom'
  maxWidthPct: number
  insetXPreset: 'small' | 'medium' | 'large' | null
  insetYPreset: 'small' | 'medium' | 'large' | null
  fade: 'none' | 'in' | 'out' | 'in_out'
}

export type ScreenTitle = {
  id: string
  startSeconds: number
  endSeconds: number
  presetId: number | null
  presetSnapshot: ScreenTitlePresetSnapshot | null
  text: string
  renderUploadId: number | null
}

export type Timeline = {
  version: 'create_video_v1'
  playheadSeconds: number
  clips: Clip[]
  stills?: Still[]
  graphics: Graphic[]
  logos?: Logo[]
  lowerThirds?: LowerThird[]
  screenTitles?: ScreenTitle[]
  narration?: Narration[]
  audioTrack?: AudioTrack | null
}

export type TimelineSnapshot = { timeline: Timeline; selectedClipId: string | null }

export function cloneTimeline(timeline: Timeline): Timeline {
  return {
    version: 'create_video_v1',
    playheadSeconds: Number(timeline.playheadSeconds || 0),
    clips: timeline.clips.map((c) => ({
      id: String(c.id),
      uploadId: Number(c.uploadId),
      startSeconds: (c as any).startSeconds != null ? Number((c as any).startSeconds) : undefined,
      sourceStartSeconds: Number(c.sourceStartSeconds),
      sourceEndSeconds: Number(c.sourceEndSeconds),
      freezeStartSeconds: (c as any).freezeStartSeconds != null ? Number((c as any).freezeStartSeconds) : undefined,
      freezeEndSeconds: (c as any).freezeEndSeconds != null ? Number((c as any).freezeEndSeconds) : undefined,
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
    graphics: Array.isArray((timeline as any).graphics)
      ? (timeline as any).graphics.map((g: any) => ({
          id: String(g.id),
          uploadId: Number(g.uploadId),
          startSeconds: Number(g.startSeconds),
          endSeconds: Number(g.endSeconds),
        }))
      : [],
    narration: Array.isArray((timeline as any).narration)
      ? (timeline as any).narration.map((n: any) => ({
          id: String(n.id),
          uploadId: Number(n.uploadId),
          startSeconds: Number(n.startSeconds),
          endSeconds: Number(n.endSeconds),
          gainDb: n.gainDb == null ? 0 : Number(n.gainDb),
        }))
      : [],
    screenTitles: Array.isArray((timeline as any).screenTitles)
      ? (timeline as any).screenTitles.map((st: any) => ({
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
                    : String(st.presetSnapshot.style || 'outline').toLowerCase() === 'strip'
                      ? 'strip'
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
          text: st.text == null ? '' : String(st.text),
          renderUploadId: st.renderUploadId == null ? null : Number(st.renderUploadId),
        }))
      : [],
    logos: Array.isArray((timeline as any).logos)
      ? (timeline as any).logos.map((l: any) => ({
          id: String(l.id),
          uploadId: Number(l.uploadId),
          startSeconds: Number(l.startSeconds),
          endSeconds: Number(l.endSeconds),
          configId: Number(l.configId),
          configSnapshot: l.configSnapshot && typeof l.configSnapshot === 'object'
            ? {
                id: Number(l.configSnapshot.id),
                name: String(l.configSnapshot.name || ''),
                position: String(l.configSnapshot.position || ''),
                sizePctWidth: Number(l.configSnapshot.sizePctWidth),
                opacityPct: Number(l.configSnapshot.opacityPct),
                timingRule: String(l.configSnapshot.timingRule || ''),
                timingSeconds: l.configSnapshot.timingSeconds == null ? null : Number(l.configSnapshot.timingSeconds),
                fade: String(l.configSnapshot.fade || ''),
                insetXPreset: l.configSnapshot.insetXPreset == null ? null : String(l.configSnapshot.insetXPreset),
                insetYPreset: l.configSnapshot.insetYPreset == null ? null : String(l.configSnapshot.insetYPreset),
              }
            : ({ id: 0, name: '', position: 'bottom_right', sizePctWidth: 15, opacityPct: 35, timingRule: 'entire', timingSeconds: null, fade: 'none', insetXPreset: null, insetYPreset: null } as any),
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
