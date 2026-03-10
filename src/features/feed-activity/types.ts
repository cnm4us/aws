export type FeedActivitySurface = 'global_feed' | 'group_feed' | 'channel_feed' | 'my_feed'
export type FeedActivityViewerState = 'anonymous' | 'authenticated'

export type FeedActivityInputEvent =
  | 'session_start'
  | 'slide_impression'
  | 'slide_complete'
  | 'session_end'

export type FeedActivityEventType =
  | 'feed_session_start'
  | 'feed_slide_impression'
  | 'feed_slide_complete'
  | 'feed_session_end'

export type FeedActivityKpis = {
  totals: {
    sessionsStarted: number
    sessionsEnded: number
    slideImpressions: number
    slideCompletes: number
    totalWatchSeconds: number
  }
  rates: {
    completionRate: number
    avgWatchSecondsPerSession: number
  }
}

export type FeedActivityDayRow = {
  dateUtc: string
  totals: {
    sessionsStarted: number
    sessionsEnded: number
    slideImpressions: number
    slideCompletes: number
    totalWatchSeconds: number
  }
  rates: {
    completionRate: number
    avgWatchSecondsPerSession: number
  }
}

export type FeedActivityReport = {
  range: {
    fromDate: string
    toDate: string
    surface: FeedActivitySurface | null
    spaceId: number | null
    viewerState: FeedActivityViewerState | null
  }
  kpis: FeedActivityKpis
  byDay: FeedActivityDayRow[]
}
