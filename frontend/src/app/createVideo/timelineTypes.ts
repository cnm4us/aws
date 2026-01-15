export type Clip = {
  id: string
  uploadId: number
  sourceStartSeconds: number
  sourceEndSeconds: number
}

export type Timeline = {
  version: 'create_video_v1'
  playheadSeconds: number
  clips: Clip[]
}

export type TimelineSnapshot = { timeline: Timeline; selectedClipId: string | null }

export function cloneTimeline(timeline: Timeline): Timeline {
  return {
    version: 'create_video_v1',
    playheadSeconds: Number(timeline.playheadSeconds || 0),
    clips: timeline.clips.map((c) => ({
      id: String(c.id),
      uploadId: Number(c.uploadId),
      sourceStartSeconds: Number(c.sourceStartSeconds),
      sourceEndSeconds: Number(c.sourceEndSeconds),
    })),
  }
}

