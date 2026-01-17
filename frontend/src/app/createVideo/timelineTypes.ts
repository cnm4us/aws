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

export type AudioTrack = {
  uploadId: number
  audioConfigId: number
  startSeconds: number
  endSeconds: number
}

export type Timeline = {
  version: 'create_video_v1'
  playheadSeconds: number
  clips: Clip[]
  stills?: Still[]
  graphics: Graphic[]
  logos?: Logo[]
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
