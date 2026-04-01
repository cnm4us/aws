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
  messageCampaignCategory: string | null
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
  messageCtaSlot: number | null
  messageCtaDefinitionId: number | null
  messageCtaIntentKey: string | null
  messageCtaExecutorType: string | null
  flow: 'login' | 'register' | 'donate' | 'subscribe' | 'upgrade' | null
  intentId: string | null
  messageSequenceKey: string | null
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
        cta_kind, message_cta_slot, message_cta_definition_id, message_cta_intent_key, message_cta_executor_type,
        flow, intent_id, message_sequence_key, attributed,
        occurred_at, dedupe_bucket_start, dedupe_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.eventType,
      input.surface,
      input.viewerState,
      input.sessionId,
      input.userId,
      input.messageId,
      input.messageCampaignKey,
      input.ctaKind,
      input.messageCtaSlot,
      input.messageCtaDefinitionId,
      input.messageCtaIntentKey,
      input.messageCtaExecutorType,
      input.flow,
      input.intentId,
      input.messageSequenceKey,
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
  if (filter.messageCampaignCategory) {
    where.push(`EXISTS (SELECT 1 FROM feed_messages p_filter WHERE p_filter.id = message_id AND p_filter.campaign_category = ?)`)
    args.push(filter.messageCampaignCategory)
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
  if (filter.messageCampaignCategory) {
    where.push(`EXISTS (SELECT 1 FROM feed_messages p_filter WHERE p_filter.id = message_id AND p_filter.campaign_category = ?)`)
    args.push(filter.messageCampaignCategory)
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
        COALESCE(SUM(CASE WHEN event_type = 'message_click' THEN total_events ELSE 0 END), 0) AS clicks_primary,
        0 AS clicks_secondary,
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
        MAX(NULLIF(p.campaign_category, '')) AS message_campaign_category,
        MAX(p.name) AS message_name,
        COALESCE(SUM(CASE WHEN s.event_type = 'message_impression' THEN s.total_events ELSE 0 END), 0) AS impressions,
        COALESCE(SUM(CASE WHEN s.event_type = 'message_click' THEN s.total_events ELSE 0 END), 0) AS clicks_primary,
        0 AS clicks_secondary,
        COALESCE(SUM(CASE WHEN s.event_type = 'message_dismiss' THEN s.total_events ELSE 0 END), 0) AS dismiss,
        COALESCE(SUM(CASE WHEN s.event_type = 'auth_start_from_message' THEN s.total_events ELSE 0 END), 0) AS auth_start,
        COALESCE(SUM(CASE WHEN s.event_type = 'auth_complete_from_message' THEN s.total_events ELSE 0 END), 0) AS auth_complete
      FROM feed_message_daily_stats s
      LEFT JOIN feed_messages p ON p.id = s.message_id
      WHERE ${whereSql}
      GROUP BY s.message_id
      ORDER BY impressions DESC, clicks_primary DESC, s.message_id DESC
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
        COALESCE(SUM(CASE WHEN event_type = 'message_click' THEN total_events ELSE 0 END), 0) AS clicks_total,
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
        COUNT(DISTINCT CASE WHEN event_type = 'message_click' THEN ${SESSION_KEY_EXPR} END) AS clicks_total_unique,
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
        COUNT(DISTINCT CASE WHEN event_type = 'message_click' THEN ${SESSION_KEY_EXPR} END) AS clicks_total_unique,
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

export async function getJourneyRunTotals(filter: MessageAnalyticsQueryFilter): Promise<any> {
  const db = getPool()
  const where: string[] = ['1=1']
  const args: any[] = []
  if (filter.surface) {
    where.push('j.applies_to_surface = ?')
    args.push(filter.surface)
  }
  if (filter.messageCampaignCategory) {
    where.push('j.campaign_category = ?')
    args.push(filter.messageCampaignCategory)
  }
  if (filter.viewerState === 'anonymous') where.push(`i.identity_type = 'anon'`)
  if (filter.viewerState === 'authenticated') where.push(`i.identity_type = 'user'`)
  const [rows] = await db.query(
    `SELECT
        COALESCE(SUM(CASE WHEN i.created_at >= ? AND i.created_at < ? THEN 1 ELSE 0 END), 0) AS starts,
        COALESCE(SUM(CASE WHEN i.state = 'completed' AND i.completed_at >= ? AND i.completed_at < ? THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN i.state = 'abandoned' AND i.completed_at >= ? AND i.completed_at < ? THEN 1 ELSE 0 END), 0) AS abandoned,
        COALESCE(SUM(CASE WHEN i.state = 'expired' AND i.completed_at >= ? AND i.completed_at < ? THEN 1 ELSE 0 END), 0) AS expired
      FROM feed_message_journey_instances i
      INNER JOIN feed_message_journeys j ON j.id = i.journey_id
      WHERE ${where.join(' AND ')}`,
    [
      filter.fromDateTime, filter.toDateTimeExclusive,
      filter.fromDateTime, filter.toDateTimeExclusive,
      filter.fromDateTime, filter.toDateTimeExclusive,
      filter.fromDateTime, filter.toDateTimeExclusive,
      ...args,
    ]
  )
  return (rows as any[])[0] || {}
}

export async function getJourneyRunByJourney(filter: MessageAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const where: string[] = ['1=1']
  const args: any[] = []
  if (filter.surface) {
    where.push('j.applies_to_surface = ?')
    args.push(filter.surface)
  }
  if (filter.messageCampaignCategory) {
    where.push('j.campaign_category = ?')
    args.push(filter.messageCampaignCategory)
  }
  if (filter.viewerState === 'anonymous') where.push(`i.identity_type = 'anon'`)
  if (filter.viewerState === 'authenticated') where.push(`i.identity_type = 'user'`)
  const [rows] = await db.query(
    `SELECT
        i.journey_id AS journey_id,
        MAX(j.journey_key) AS journey_key,
        COALESCE(SUM(CASE WHEN i.created_at >= ? AND i.created_at < ? THEN 1 ELSE 0 END), 0) AS starts,
        COALESCE(SUM(CASE WHEN i.state = 'completed' AND i.completed_at >= ? AND i.completed_at < ? THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN i.state = 'abandoned' AND i.completed_at >= ? AND i.completed_at < ? THEN 1 ELSE 0 END), 0) AS abandoned,
        COALESCE(SUM(CASE WHEN i.state = 'expired' AND i.completed_at >= ? AND i.completed_at < ? THEN 1 ELSE 0 END), 0) AS expired
      FROM feed_message_journey_instances i
      INNER JOIN feed_message_journeys j ON j.id = i.journey_id
      WHERE ${where.join(' AND ')}
      GROUP BY i.journey_id
      HAVING starts > 0 OR completed > 0 OR abandoned > 0 OR expired > 0
      ORDER BY starts DESC, completed DESC, i.journey_id DESC`,
    [
      filter.fromDateTime, filter.toDateTimeExclusive,
      filter.fromDateTime, filter.toDateTimeExclusive,
      filter.fromDateTime, filter.toDateTimeExclusive,
      filter.fromDateTime, filter.toDateTimeExclusive,
      ...args,
    ]
  )
  return rows as any[]
}

export async function getJourneyStepFunnel(filter: MessageAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const where: string[] = ['1=1']
  const args: any[] = []
  if (filter.surface) {
    where.push('j.applies_to_surface = ?')
    args.push(filter.surface)
  }
  if (filter.messageCampaignCategory) {
    where.push('j.campaign_category = ?')
    args.push(filter.messageCampaignCategory)
  }
  if (filter.viewerState === 'anonymous') where.push(`i.identity_type = 'anon'`)
  if (filter.viewerState === 'authenticated') where.push(`i.identity_type = 'user'`)
  const [rows] = await db.query(
    `SELECT
        p.journey_id AS journey_id,
        MAX(j.journey_key) AS journey_key,
        s.step_order AS step_order,
        MAX(s.step_key) AS step_key,
        COUNT(DISTINCT p.journey_instance_id) AS completed_runs
      FROM (
        SELECT journey_id, journey_instance_id, step_id, completed_at
        FROM feed_user_message_journey_progress
        WHERE state = 'completed'
          AND journey_instance_id IS NOT NULL
          AND completed_at >= ? AND completed_at < ?
        UNION ALL
        SELECT journey_id, journey_instance_id, step_id, completed_at
        FROM feed_anon_message_journey_progress
        WHERE state = 'completed'
          AND journey_instance_id IS NOT NULL
          AND completed_at >= ? AND completed_at < ?
      ) p
      INNER JOIN feed_message_journey_instances i ON i.id = p.journey_instance_id
      INNER JOIN feed_message_journeys j ON j.id = p.journey_id
      INNER JOIN feed_message_journey_steps s ON s.id = p.step_id
      WHERE ${where.join(' AND ')}
      GROUP BY p.journey_id, s.step_order
      ORDER BY p.journey_id DESC, s.step_order ASC`,
    [
      filter.fromDateTime, filter.toDateTimeExclusive,
      filter.fromDateTime, filter.toDateTimeExclusive,
      ...args,
    ]
  )
  return rows as any[]
}
