import { getPool } from '../../db'
import type {
  MessageAnalyticsCtaKind,
  MessageAnalyticsEventType,
  MessageAnalyticsSurface,
  MessageAnalyticsViewerState,
} from './types'

export type MessageAnalyticsQueryFilter = {
  fromDate: string
  toDate: string
  fromDateTime: string
  toDateTimeExclusive: string
  surface: MessageAnalyticsSurface | null
  messageId: number | null
  messageType: string | null
  messageCampaignKey: string | null
  viewerState: MessageAnalyticsViewerState | null
}

export async function insertEvent(input: {
  eventType: MessageAnalyticsEventType
  surface: MessageAnalyticsSurface
  viewerState: MessageAnalyticsViewerState
  sessionId: string | null
  userId: number | null
  messageId: number
  messageCampaignKey: string | null
  ctaKind: MessageAnalyticsCtaKind
  attributed: boolean
  occurredAt: string
  dedupeBucketStart: string
  dedupeKey: string
}): Promise<{ inserted: boolean }> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT IGNORE INTO feed_message_events
      (
        event_type, surface, viewer_state,
        session_id, user_id,
        message_id, message_campaign_key,
        cta_kind, attributed,
        occurred_at, dedupe_bucket_start, dedupe_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.eventType,
      input.surface,
      input.viewerState,
      input.sessionId,
      input.userId,
      input.messageId,
      input.messageCampaignKey,
      input.ctaKind,
      input.attributed ? 1 : 0,
      input.occurredAt,
      input.dedupeBucketStart,
      input.dedupeKey,
    ]
  )
  const inserted = Number((result as any)?.affectedRows || 0) > 0
  return { inserted }
}

export async function upsertDailyCount(input: {
  dateUtc: string
  surface: MessageAnalyticsSurface
  messageId: number
  messageCampaignKey: string | null
  viewerState: MessageAnalyticsViewerState
  eventType: MessageAnalyticsEventType
  totalDelta: number
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO feed_message_daily_stats
      (
        date_utc, surface, message_id, message_campaign_key,
        viewer_state, event_type, total_events
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_events = total_events + VALUES(total_events),
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.dateUtc,
      input.surface,
      input.messageId,
      input.messageCampaignKey || '',
      input.viewerState,
      input.eventType,
      Math.max(1, Math.round(input.totalDelta || 1)),
    ]
  )
}

export async function hasRecentAuthStart(input: {
  sessionId: string | null
  userId: number | null
  messageId: number
  sinceDateTimeUtc: string
}): Promise<boolean> {
  const db = getPool()

  if (input.sessionId) {
    const [rows] = await db.query(
      `SELECT id
         FROM feed_message_events
        WHERE event_type = 'auth_start_from_message'
          AND message_id = ?
          AND session_id = ?
          AND occurred_at >= ?
        ORDER BY id DESC
        LIMIT 1`,
      [input.messageId, input.sessionId, input.sinceDateTimeUtc]
    )
    if ((rows as any[]).length > 0) return true
  }

  if (input.userId != null && Number.isFinite(Number(input.userId)) && Number(input.userId) > 0) {
    const [rows] = await db.query(
      `SELECT id
         FROM feed_message_events
        WHERE event_type = 'auth_start_from_message'
          AND message_id = ?
          AND user_id = ?
          AND occurred_at >= ?
        ORDER BY id DESC
        LIMIT 1`,
      [input.messageId, Number(input.userId), input.sinceDateTimeUtc]
    )
    if ((rows as any[]).length > 0) return true
  }

  return false
}

function buildDailyWhere(filter: MessageAnalyticsQueryFilter): { whereSql: string; args: any[] } {
  const where: string[] = ['date_utc >= ?', 'date_utc <= ?']
  const args: any[] = [filter.fromDate, filter.toDate]
  if (filter.surface) {
    where.push('surface = ?')
    args.push(filter.surface)
  }
  if (filter.messageId != null) {
    where.push('message_id = ?')
    args.push(filter.messageId)
  }
  if (filter.messageType) {
    where.push(`EXISTS (SELECT 1 FROM feed_messages p_filter WHERE p_filter.id = message_id AND p_filter.type = ?)`)
    args.push(filter.messageType)
  }
  if (filter.messageCampaignKey) {
    where.push('message_campaign_key = ?')
    args.push(filter.messageCampaignKey)
  }
  if (filter.viewerState) {
    where.push('viewer_state = ?')
    args.push(filter.viewerState)
  }
  return { whereSql: where.join(' AND '), args }
}

function buildRawWhere(filter: MessageAnalyticsQueryFilter): { whereSql: string; args: any[] } {
  const where: string[] = ['occurred_at >= ?', 'occurred_at < ?']
  const args: any[] = [filter.fromDateTime, filter.toDateTimeExclusive]
  if (filter.surface) {
    where.push('surface = ?')
    args.push(filter.surface)
  }
  if (filter.messageId != null) {
    where.push('message_id = ?')
    args.push(filter.messageId)
  }
  if (filter.messageType) {
    where.push(`EXISTS (SELECT 1 FROM feed_messages p_filter WHERE p_filter.id = message_id AND p_filter.type = ?)`)
    args.push(filter.messageType)
  }
  if (filter.messageCampaignKey) {
    where.push('message_campaign_key = ?')
    args.push(filter.messageCampaignKey)
  }
  if (filter.viewerState) {
    where.push('viewer_state = ?')
    args.push(filter.viewerState)
  }
  return { whereSql: where.join(' AND '), args }
}

export async function getTotalsFromDaily(filter: MessageAnalyticsQueryFilter): Promise<any> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
        COALESCE(SUM(CASE WHEN event_type = 'message_impression' THEN total_events ELSE 0 END), 0) AS impressions,
        COALESCE(SUM(CASE WHEN event_type = 'message_click_primary' THEN total_events ELSE 0 END), 0) AS clicks_primary,
        COALESCE(SUM(CASE WHEN event_type = 'message_click_secondary' THEN total_events ELSE 0 END), 0) AS clicks_secondary,
        COALESCE(SUM(CASE WHEN event_type = 'message_dismiss' THEN total_events ELSE 0 END), 0) AS dismiss,
        COALESCE(SUM(CASE WHEN event_type = 'auth_start_from_message' THEN total_events ELSE 0 END), 0) AS auth_start,
        COALESCE(SUM(CASE WHEN event_type = 'auth_complete_from_message' THEN total_events ELSE 0 END), 0) AS auth_complete
      FROM feed_message_daily_stats
      WHERE ${whereSql}`,
    args
  )
  return (rows as any[])[0] || {}
}

export async function getByMessageFromDaily(filter: MessageAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
        s.message_id AS message_id,
        MAX(p.type) AS message_type,
        MAX(NULLIF(s.message_campaign_key, '')) AS message_campaign_key,
        MAX(p.name) AS message_name,
        COALESCE(SUM(CASE WHEN s.event_type = 'message_impression' THEN s.total_events ELSE 0 END), 0) AS impressions,
        COALESCE(SUM(CASE WHEN s.event_type = 'message_click_primary' THEN s.total_events ELSE 0 END), 0) AS clicks_primary,
        COALESCE(SUM(CASE WHEN s.event_type = 'message_click_secondary' THEN s.total_events ELSE 0 END), 0) AS clicks_secondary,
        COALESCE(SUM(CASE WHEN s.event_type = 'message_dismiss' THEN s.total_events ELSE 0 END), 0) AS dismiss,
        COALESCE(SUM(CASE WHEN s.event_type = 'auth_start_from_message' THEN s.total_events ELSE 0 END), 0) AS auth_start,
        COALESCE(SUM(CASE WHEN s.event_type = 'auth_complete_from_message' THEN s.total_events ELSE 0 END), 0) AS auth_complete
      FROM feed_message_daily_stats s
      LEFT JOIN feed_messages p ON p.id = s.message_id
      WHERE ${whereSql}
      GROUP BY s.message_id
      ORDER BY impressions DESC, clicks_primary DESC, clicks_secondary DESC, s.message_id DESC
      LIMIT 1000`,
    args
  )
  return rows as any[]
}

export async function getByDayFromDaily(filter: MessageAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
        date_utc,
        COALESCE(SUM(CASE WHEN event_type = 'message_impression' THEN total_events ELSE 0 END), 0) AS impressions,
        COALESCE(SUM(CASE WHEN event_type IN ('message_click_primary','message_click_secondary') THEN total_events ELSE 0 END), 0) AS clicks_total,
        COALESCE(SUM(CASE WHEN event_type = 'message_dismiss' THEN total_events ELSE 0 END), 0) AS dismiss,
        COALESCE(SUM(CASE WHEN event_type = 'auth_start_from_message' THEN total_events ELSE 0 END), 0) AS auth_start,
        COALESCE(SUM(CASE WHEN event_type = 'auth_complete_from_message' THEN total_events ELSE 0 END), 0) AS auth_complete
      FROM feed_message_daily_stats
      WHERE ${whereSql}
      GROUP BY date_utc
      ORDER BY date_utc ASC`,
    args
  )
  return rows as any[]
}

const SESSION_KEY_EXPR = `COALESCE(NULLIF(session_id, ''), IF(user_id IS NULL, NULL, CONCAT('u:', CAST(user_id AS CHAR))))`

export async function getUniqueTotalsFromRaw(filter: MessageAnalyticsQueryFilter): Promise<any> {
  const db = getPool()
  const { whereSql, args } = buildRawWhere(filter)
  const [rows] = await db.query(
    `SELECT
        COUNT(DISTINCT CASE WHEN event_type = 'message_impression' THEN ${SESSION_KEY_EXPR} END) AS impressions_unique,
        COUNT(DISTINCT CASE WHEN event_type IN ('message_click_primary','message_click_secondary') THEN ${SESSION_KEY_EXPR} END) AS clicks_total_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'message_dismiss' THEN ${SESSION_KEY_EXPR} END) AS dismiss_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_start_from_message' THEN ${SESSION_KEY_EXPR} END) AS auth_start_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_complete_from_message' AND attributed = 1 THEN ${SESSION_KEY_EXPR} END) AS auth_complete_unique
      FROM feed_message_events
      WHERE ${whereSql}`,
    args
  )
  return (rows as any[])[0] || {}
}

export async function getUniqueByMessageFromRaw(filter: MessageAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const { whereSql, args } = buildRawWhere(filter)
  const [rows] = await db.query(
    `SELECT
        message_id AS message_id,
        COUNT(DISTINCT CASE WHEN event_type = 'message_impression' THEN ${SESSION_KEY_EXPR} END) AS impressions_unique,
        COUNT(DISTINCT CASE WHEN event_type IN ('message_click_primary','message_click_secondary') THEN ${SESSION_KEY_EXPR} END) AS clicks_total_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'message_dismiss' THEN ${SESSION_KEY_EXPR} END) AS dismiss_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_start_from_message' THEN ${SESSION_KEY_EXPR} END) AS auth_start_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_complete_from_message' AND attributed = 1 THEN ${SESSION_KEY_EXPR} END) AS auth_complete_unique
      FROM feed_message_events
      WHERE ${whereSql}
      GROUP BY message_id`,
    args
  )
  return rows as any[]
}

export async function purgeExpiredData(input?: { rawRetentionDays?: number; rollupRetentionDays?: number }): Promise<void> {
  const db = getPool()
  const rawDays = Math.max(7, Math.min(365, Number(input?.rawRetentionDays || 90)))
  const rollupDays = Math.max(30, Math.min(3650, Number(input?.rollupRetentionDays || 365)))

  await db.query(`DELETE FROM feed_message_events WHERE occurred_at < (UTC_TIMESTAMP() - INTERVAL ? DAY)`, [rawDays])
  await db.query(`DELETE FROM feed_message_daily_stats WHERE date_utc < (UTC_DATE() - INTERVAL ? DAY)`, [rollupDays])
}
