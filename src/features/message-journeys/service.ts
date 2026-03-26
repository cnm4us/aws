import * as repo from './repo'
import type { MessageJourneyProgressState } from './types'

type MessageJourneySignalEvent =
  | 'impression'
  | 'click'
  | 'pass_through'
  | 'dismiss'
  | 'auth_complete'
  | 'donation_complete'
  | 'subscription_complete'
  | 'upgrade_complete'

function eventToState(event: MessageJourneySignalEvent): MessageJourneyProgressState {
  if (event === 'impression') return 'shown'
  if (event === 'click') return 'clicked'
  if (event === 'pass_through' || event === 'dismiss') return 'skipped'
  return 'completed'
}

function canTransition(from: MessageJourneyProgressState, to: MessageJourneyProgressState): boolean {
  if (from === to) return true
  if (from === 'completed') return false
  if (from === 'expired' || from === 'suppressed') return false

  if (to === 'completed') return true
  if (to === 'clicked') return from === 'eligible' || from === 'shown' || from === 'skipped'
  if (to === 'shown') return from === 'eligible'
  if (to === 'skipped') return from === 'eligible' || from === 'shown'

  return false
}

function mergeMetadata(existingRaw: string, patch: Record<string, any>): string {
  let base: Record<string, any> = {}
  try {
    const parsed = JSON.parse(existingRaw || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, any>
  } catch {}
  return JSON.stringify({ ...base, ...patch })
}

function toUtcDateTimeString(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

export async function recordJourneySignalFromMessageEvent(input: {
  userId: number | null
  messageId: number
  event: MessageJourneySignalEvent
  sessionId?: string | null
  occurredAt?: Date
}): Promise<{ stepsMatched: number; progressed: number; ignored: number }> {
  const userId = Number(input.userId || 0)
  const messageId = Number(input.messageId || 0)
  if (!Number.isFinite(userId) || userId <= 0) {
    return { stepsMatched: 0, progressed: 0, ignored: 0 }
  }
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return { stepsMatched: 0, progressed: 0, ignored: 0 }
  }

  const steps = await repo.listActiveStepsByMessageId(messageId)
  if (!steps.length) return { stepsMatched: 0, progressed: 0, ignored: 0 }

  const eventState = eventToState(input.event)
  const ts = toUtcDateTimeString(input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date())

  let progressed = 0
  let ignored = 0

  for (const step of steps) {
    const existing = await repo.getProgressByUserStep(userId, Number(step.id))
    if (!existing) {
      const metadata = JSON.stringify({
        source: 'message_event',
        source_event: input.event,
        source_message_id: messageId,
        last_event_at: ts,
      })
      await repo.upsertProgress({
        userId,
        journeyId: Number(step.journey_id),
        stepId: Number(step.id),
        state: eventState,
        firstSeenAt: eventState === 'shown' ? ts : null,
        lastSeenAt: ts,
        completedAt: eventState === 'completed' ? ts : null,
        sessionId: input.sessionId ?? null,
        metadataJson: metadata,
      })
      progressed += 1
      continue
    }

    const from = existing.state
    const to = eventState
    if (!canTransition(from, to)) {
      ignored += 1
      continue
    }

    const metadataJson = mergeMetadata(existing.metadata_json, {
      source: 'message_event',
      source_event: input.event,
      source_message_id: messageId,
      last_event_at: ts,
    })

    await repo.updateProgressById(Number(existing.id), {
      state: to,
      firstSeenAt: existing.first_seen_at || (to === 'shown' ? ts : null),
      lastSeenAt: ts,
      completedAt: to === 'completed' ? (existing.completed_at || ts) : existing.completed_at,
      sessionId: input.sessionId ?? existing.session_id,
      metadataJson,
    })
    progressed += 1
  }

  return {
    stepsMatched: steps.length,
    progressed,
    ignored,
  }
}
