export type Clip = {
  id: string
  uploadId: number
  startSeconds?: number
  sourceStartSeconds: number
  sourceEndSeconds: number
  freezeStartSeconds?: number
  freezeEndSeconds?: number
}

export type Graphic = {
  id: string
  uploadId: number
  startSeconds: number
  endSeconds: number
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
  graphics: Graphic[]
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
    })),
    graphics: Array.isArray((timeline as any).graphics)
      ? (timeline as any).graphics.map((g: any) => ({
          id: String(g.id),
          uploadId: Number(g.uploadId),
          startSeconds: Number(g.startSeconds),
          endSeconds: Number(g.endSeconds),
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
