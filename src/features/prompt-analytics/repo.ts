import { getPool } from '../../db'
import type {
  PromptAnalyticsCtaKind,
  PromptAnalyticsEventType,
  PromptAnalyticsSurface,
  PromptAnalyticsViewerState,
} from './types'

export type PromptAnalyticsQueryFilter = {
  fromDate: string
  toDate: string
  fromDateTime: string
  toDateTimeExclusive: string
  surface: PromptAnalyticsSurface | null
  promptId: number | null
  promptCategory: string | null
  viewerState: PromptAnalyticsViewerState | null
}

export async function insertEvent(input: {
  eventType: PromptAnalyticsEventType
  surface: PromptAnalyticsSurface
  viewerState: PromptAnalyticsViewerState
  sessionId: string | null
  userId: number | null
  promptId: number
  promptCategory: string | null
  ctaKind: PromptAnalyticsCtaKind
  attributed: boolean
  occurredAt: string
  dedupeBucketStart: string
  dedupeKey: string
}): Promise<{ inserted: boolean }> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT IGNORE INTO feed_prompt_events
      (
        event_type, surface, viewer_state,
        session_id, user_id,
        prompt_id, prompt_category,
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
      input.promptId,
      input.promptCategory,
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
  surface: PromptAnalyticsSurface
  promptId: number
  promptCategory: string | null
  viewerState: PromptAnalyticsViewerState
  eventType: PromptAnalyticsEventType
  totalDelta: number
}): Promise<void> {
  const db = getPool()
  await db.query(
    `INSERT INTO feed_prompt_daily_stats
      (
        date_utc, surface, prompt_id, prompt_category,
        viewer_state, event_type, total_events
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_events = total_events + VALUES(total_events),
        updated_at = CURRENT_TIMESTAMP`,
    [
      input.dateUtc,
      input.surface,
      input.promptId,
      input.promptCategory || '',
      input.viewerState,
      input.eventType,
      Math.max(1, Math.round(input.totalDelta || 1)),
    ]
  )
}

export async function hasRecentAuthStart(input: {
  sessionId: string | null
  userId: number | null
  promptId: number
  sinceDateTimeUtc: string
}): Promise<boolean> {
  const db = getPool()

  if (input.sessionId) {
    const [rows] = await db.query(
      `SELECT id
         FROM feed_prompt_events
        WHERE event_type = 'auth_start_from_prompt'
          AND prompt_id = ?
          AND session_id = ?
          AND occurred_at >= ?
        ORDER BY id DESC
        LIMIT 1`,
      [input.promptId, input.sessionId, input.sinceDateTimeUtc]
    )
    if ((rows as any[]).length > 0) return true
  }

  if (input.userId != null && Number.isFinite(Number(input.userId)) && Number(input.userId) > 0) {
    const [rows] = await db.query(
      `SELECT id
         FROM feed_prompt_events
        WHERE event_type = 'auth_start_from_prompt'
          AND prompt_id = ?
          AND user_id = ?
          AND occurred_at >= ?
        ORDER BY id DESC
        LIMIT 1`,
      [input.promptId, Number(input.userId), input.sinceDateTimeUtc]
    )
    if ((rows as any[]).length > 0) return true
  }

  return false
}

function buildDailyWhere(filter: PromptAnalyticsQueryFilter): { whereSql: string; args: any[] } {
  const where: string[] = ['date_utc >= ?', 'date_utc <= ?']
  const args: any[] = [filter.fromDate, filter.toDate]
  if (filter.surface) {
    where.push('surface = ?')
    args.push(filter.surface)
  }
  if (filter.promptId != null) {
    where.push('prompt_id = ?')
    args.push(filter.promptId)
  }
  if (filter.promptCategory) {
    where.push('prompt_category = ?')
    args.push(filter.promptCategory)
  }
  if (filter.viewerState) {
    where.push('viewer_state = ?')
    args.push(filter.viewerState)
  }
  return { whereSql: where.join(' AND '), args }
}

function buildRawWhere(filter: PromptAnalyticsQueryFilter): { whereSql: string; args: any[] } {
  const where: string[] = ['occurred_at >= ?', 'occurred_at < ?']
  const args: any[] = [filter.fromDateTime, filter.toDateTimeExclusive]
  if (filter.surface) {
    where.push('surface = ?')
    args.push(filter.surface)
  }
  if (filter.promptId != null) {
    where.push('prompt_id = ?')
    args.push(filter.promptId)
  }
  if (filter.promptCategory) {
    where.push('prompt_category = ?')
    args.push(filter.promptCategory)
  }
  if (filter.viewerState) {
    where.push('viewer_state = ?')
    args.push(filter.viewerState)
  }
  return { whereSql: where.join(' AND '), args }
}

export async function getTotalsFromDaily(filter: PromptAnalyticsQueryFilter): Promise<any> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
        COALESCE(SUM(CASE WHEN event_type = 'prompt_impression' THEN total_events ELSE 0 END), 0) AS impressions,
        COALESCE(SUM(CASE WHEN event_type = 'prompt_click_primary' THEN total_events ELSE 0 END), 0) AS clicks_primary,
        COALESCE(SUM(CASE WHEN event_type = 'prompt_click_secondary' THEN total_events ELSE 0 END), 0) AS clicks_secondary,
        COALESCE(SUM(CASE WHEN event_type = 'prompt_dismiss' THEN total_events ELSE 0 END), 0) AS dismiss,
        COALESCE(SUM(CASE WHEN event_type = 'auth_start_from_prompt' THEN total_events ELSE 0 END), 0) AS auth_start,
        COALESCE(SUM(CASE WHEN event_type = 'auth_complete_from_prompt' THEN total_events ELSE 0 END), 0) AS auth_complete
      FROM feed_prompt_daily_stats
      WHERE ${whereSql}`,
    args
  )
  return (rows as any[])[0] || {}
}

export async function getByPromptFromDaily(filter: PromptAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
        s.prompt_id,
        MAX(NULLIF(s.prompt_category, '')) AS prompt_category,
        MAX(p.name) AS prompt_name,
        COALESCE(SUM(CASE WHEN s.event_type = 'prompt_impression' THEN s.total_events ELSE 0 END), 0) AS impressions,
        COALESCE(SUM(CASE WHEN s.event_type = 'prompt_click_primary' THEN s.total_events ELSE 0 END), 0) AS clicks_primary,
        COALESCE(SUM(CASE WHEN s.event_type = 'prompt_click_secondary' THEN s.total_events ELSE 0 END), 0) AS clicks_secondary,
        COALESCE(SUM(CASE WHEN s.event_type = 'prompt_dismiss' THEN s.total_events ELSE 0 END), 0) AS dismiss,
        COALESCE(SUM(CASE WHEN s.event_type = 'auth_start_from_prompt' THEN s.total_events ELSE 0 END), 0) AS auth_start,
        COALESCE(SUM(CASE WHEN s.event_type = 'auth_complete_from_prompt' THEN s.total_events ELSE 0 END), 0) AS auth_complete
      FROM feed_prompt_daily_stats s
      LEFT JOIN feed_prompts p ON p.id = s.prompt_id
      WHERE ${whereSql}
      GROUP BY s.prompt_id
      ORDER BY impressions DESC, clicks_primary DESC, clicks_secondary DESC, s.prompt_id DESC
      LIMIT 1000`,
    args
  )
  return rows as any[]
}

export async function getByDayFromDaily(filter: PromptAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const { whereSql, args } = buildDailyWhere(filter)
  const [rows] = await db.query(
    `SELECT
        date_utc,
        COALESCE(SUM(CASE WHEN event_type = 'prompt_impression' THEN total_events ELSE 0 END), 0) AS impressions,
        COALESCE(SUM(CASE WHEN event_type IN ('prompt_click_primary','prompt_click_secondary') THEN total_events ELSE 0 END), 0) AS clicks_total,
        COALESCE(SUM(CASE WHEN event_type = 'prompt_dismiss' THEN total_events ELSE 0 END), 0) AS dismiss,
        COALESCE(SUM(CASE WHEN event_type = 'auth_start_from_prompt' THEN total_events ELSE 0 END), 0) AS auth_start,
        COALESCE(SUM(CASE WHEN event_type = 'auth_complete_from_prompt' THEN total_events ELSE 0 END), 0) AS auth_complete
      FROM feed_prompt_daily_stats
      WHERE ${whereSql}
      GROUP BY date_utc
      ORDER BY date_utc ASC`,
    args
  )
  return rows as any[]
}

const SESSION_KEY_EXPR = `COALESCE(NULLIF(session_id, ''), IF(user_id IS NULL, NULL, CONCAT('u:', CAST(user_id AS CHAR))))`

export async function getUniqueTotalsFromRaw(filter: PromptAnalyticsQueryFilter): Promise<any> {
  const db = getPool()
  const { whereSql, args } = buildRawWhere(filter)
  const [rows] = await db.query(
    `SELECT
        COUNT(DISTINCT CASE WHEN event_type = 'prompt_impression' THEN ${SESSION_KEY_EXPR} END) AS impressions_unique,
        COUNT(DISTINCT CASE WHEN event_type IN ('prompt_click_primary','prompt_click_secondary') THEN ${SESSION_KEY_EXPR} END) AS clicks_total_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'prompt_dismiss' THEN ${SESSION_KEY_EXPR} END) AS dismiss_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_start_from_prompt' THEN ${SESSION_KEY_EXPR} END) AS auth_start_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_complete_from_prompt' AND attributed = 1 THEN ${SESSION_KEY_EXPR} END) AS auth_complete_unique
      FROM feed_prompt_events
      WHERE ${whereSql}`,
    args
  )
  return (rows as any[])[0] || {}
}

export async function getUniqueByPromptFromRaw(filter: PromptAnalyticsQueryFilter): Promise<any[]> {
  const db = getPool()
  const { whereSql, args } = buildRawWhere(filter)
  const [rows] = await db.query(
    `SELECT
        prompt_id,
        COUNT(DISTINCT CASE WHEN event_type = 'prompt_impression' THEN ${SESSION_KEY_EXPR} END) AS impressions_unique,
        COUNT(DISTINCT CASE WHEN event_type IN ('prompt_click_primary','prompt_click_secondary') THEN ${SESSION_KEY_EXPR} END) AS clicks_total_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'prompt_dismiss' THEN ${SESSION_KEY_EXPR} END) AS dismiss_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_start_from_prompt' THEN ${SESSION_KEY_EXPR} END) AS auth_start_unique,
        COUNT(DISTINCT CASE WHEN event_type = 'auth_complete_from_prompt' AND attributed = 1 THEN ${SESSION_KEY_EXPR} END) AS auth_complete_unique
      FROM feed_prompt_events
      WHERE ${whereSql}
      GROUP BY prompt_id`,
    args
  )
  return rows as any[]
}

export async function purgeExpiredData(input?: { rawRetentionDays?: number; rollupRetentionDays?: number }): Promise<void> {
  const db = getPool()
  const rawDays = Math.max(7, Math.min(365, Number(input?.rawRetentionDays || 90)))
  const rollupDays = Math.max(30, Math.min(3650, Number(input?.rollupRetentionDays || 365)))

  await db.query(`DELETE FROM feed_prompt_events WHERE occurred_at < (UTC_TIMESTAMP() - INTERVAL ? DAY)`, [rawDays])
  await db.query(`DELETE FROM feed_prompt_daily_stats WHERE date_utc < (UTC_DATE() - INTERVAL ? DAY)`, [rollupDays])
}
