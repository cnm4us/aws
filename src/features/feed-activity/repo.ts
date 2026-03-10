import { getPool } from '../../db'
import type { FeedActivityEventType, FeedActivitySurface, FeedActivityViewerState } from './types'

export type FeedActivityQueryFilter = {
  fromDate: string
  toDate: string
  surface: FeedActivitySurface | null
  viewerState: FeedActivityViewerState | null
}

export async function insertEvent(input: {
  eventType: FeedActivityEventType
  surface: FeedActivitySurface
  viewerState: FeedActivityViewerState
  sessionId: string
  userId: number | null
  contentId: number | null
  watchSeconds: number
  occurredAt: string
  dedupeKey: string
}): Promise<{ inserted: boolean }> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT IGNORE INTO feed_activity_events
      (
        event_type, surface, viewer_state,
        session_id, user_id, content_id, watch_seconds,
        occurred_at, dedupe_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.eventType,
      input.surface,
      input.viewerState,
      input.sessionId,
      input.userId,
      input.contentId == null ? 0 : input.contentId,
      input.watchSeconds,
      input.occurredAt,
      input.dedupeKey,
    ]
  )
  return { inserted: Number((result as any)?.affectedRows || 0) > 0 }
}

export async function upsertDailyCount(input: {
  dateUtc: string
  surface: FeedActivitySurface
  viewerState: FeedActivityViewerState
  eventType: FeedActivityEventType
  contentId: number | null
  totalEventsDelta: number
  watchSecondsDelta: number
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO feed_activity_daily_stats
      (
        date_utc, surface, viewer_state,
        event_type, content_id, total_events, total_watch_seconds
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_events = total_events + VALUES(total_events),
        total_watch_seconds = total_watch_seconds + VALUES(total_watch_seconds),
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.dateUtc,
      input.surface,
      input.viewerState,
      input.eventType,
      input.contentId == null ? 0 : input.contentId,
      Math.max(1, Math.round(input.totalEventsDelta || 1)),
      Math.max(0, Math.round(input.watchSecondsDelta || 0)),
    ]
  )
}

function buildDailyWhere(filter: FeedActivityQueryFilter): { whereSql: string; args: any[] } {
  const where: string[] = ['date_utc >= ?', 'date_utc <= ?']
  const args: any[] = [filter.fromDate, filter.toDate]
  if (filter.surface) {
    where.push('surface = ?')
    args.push(filter.surface)
  }
  if (filter.viewerState) {
    where.push('viewer_state = ?')
    args.push(filter.viewerState)
  }
  return { whereSql: where.join(' AND '), args }
}

export async function getTotalsFromDaily(filter: FeedActivityQueryFilter): Promise<any> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
      COALESCE(SUM(CASE WHEN event_type = 'feed_session_start' THEN total_events ELSE 0 END), 0) AS sessions_started,
      COALESCE(SUM(CASE WHEN event_type = 'feed_session_end' THEN total_events ELSE 0 END), 0) AS sessions_ended,
      COALESCE(SUM(CASE WHEN event_type = 'feed_slide_impression' THEN total_events ELSE 0 END), 0) AS slide_impressions,
      COALESCE(SUM(CASE WHEN event_type = 'feed_slide_complete' THEN total_events ELSE 0 END), 0) AS slide_completes,
      COALESCE(SUM(CASE WHEN event_type = 'feed_session_end' THEN total_watch_seconds ELSE 0 END), 0) AS total_watch_seconds
     FROM feed_activity_daily_stats
     WHERE ${whereSql}`,
    args
  )
  return (rows as any[])[0] || {}
}

export async function getByDayFromDaily(filter: FeedActivityQueryFilter): Promise<any[]> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
      date_utc,
      COALESCE(SUM(CASE WHEN event_type = 'feed_session_start' THEN total_events ELSE 0 END), 0) AS sessions_started,
      COALESCE(SUM(CASE WHEN event_type = 'feed_session_end' THEN total_events ELSE 0 END), 0) AS sessions_ended,
      COALESCE(SUM(CASE WHEN event_type = 'feed_slide_impression' THEN total_events ELSE 0 END), 0) AS slide_impressions,
      COALESCE(SUM(CASE WHEN event_type = 'feed_slide_complete' THEN total_events ELSE 0 END), 0) AS slide_completes,
      COALESCE(SUM(CASE WHEN event_type = 'feed_session_end' THEN total_watch_seconds ELSE 0 END), 0) AS total_watch_seconds
     FROM feed_activity_daily_stats
     WHERE ${whereSql}
     GROUP BY date_utc
     ORDER BY date_utc ASC`,
    args
  )
  return rows as any[]
}

export async function purgeExpiredData(input?: { rawRetentionDays?: number; rollupRetentionDays?: number }): Promise<void> {
  const db = getPool()
  const rawDays = Math.max(7, Math.min(365, Number(input?.rawRetentionDays || 90)))
  const rollupDays = Math.max(30, Math.min(3650, Number(input?.rollupRetentionDays || 365)))
  await db.query(`DELETE FROM feed_activity_events WHERE occurred_at < (UTC_TIMESTAMP() - INTERVAL ? DAY)`, [rawDays])
  await db.query(`DELETE FROM feed_activity_daily_stats WHERE date_utc < (UTC_DATE() - INTERVAL ? DAY)`, [rollupDays])
}
