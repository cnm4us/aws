import { metrics, type Span, SpanStatusCode, trace } from '@opentelemetry/api'

type AttrValue = string | number | boolean
type AttrRecord = Record<string, AttrValue | null | undefined>

function cleanAttrs(input: AttrRecord): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {}
  for (const [k, v] of Object.entries(input || {})) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

const tracer = trace.getTracer('aws.mediajobs.worker')
const meter = metrics.getMeter('aws.mediajobs.worker')

const mediaJobDurationMs = meter.createHistogram('mediajob.duration_ms', {
  description: 'End-to-end processing duration per media job',
  unit: 'ms',
})

const mediaJobQueueWaitMs = meter.createHistogram('mediajob.queue_wait_ms', {
  description: 'Time from job create to processing start',
  unit: 'ms',
})

const mediaJobInputBytes = meter.createHistogram('mediajob.input_bytes', {
  description: 'Total input bytes read for a media job',
  unit: 'By',
})

const mediaJobOutputBytes = meter.createHistogram('mediajob.output_bytes', {
  description: 'Total output bytes written for a media job',
  unit: 'By',
})

const mediaJobFailures = meter.createCounter('mediajob.failures_total', {
  description: 'Number of failed/dead media jobs',
})

const mediaJobCount = meter.createCounter('mediajob.count_total', {
  description: 'Count of processed media jobs by status',
})

export async function withMediaJobSpan<T>(
  attrs: AttrRecord,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const spanAttrs = cleanAttrs(attrs)
  return tracer.startActiveSpan('mediajob.process', { attributes: spanAttrs }, async (span) => {
    try {
      return await fn(span)
    } catch (err: any) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err) })
      throw err
    } finally {
      span.end()
    }
  })
}

export async function withMediaJobStage<T>(
  stage: string,
  attrs: AttrRecord,
  fn: () => Promise<T>
): Promise<T> {
  const spanName = `mediajob.${String(stage || 'stage')}`
  return tracer.startActiveSpan(spanName, { attributes: cleanAttrs(attrs) }, async (span) => {
    try {
      const out = await fn()
      span.setStatus({ code: SpanStatusCode.OK })
      return out
    } catch (err: any) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err) })
      throw err
    } finally {
      span.end()
    }
  })
}

export function annotateMediaJobSpanOutcome(
  span: Span,
  input: {
    status: 'completed' | 'failed' | 'dead' | 'unknown'
    errorCode?: string | null
    errorMessage?: string | null
    durationMs?: number | null
    queueWaitMs?: number | null
    inputBytes?: number | null
    outputBytes?: number | null
  }
) {
  const status = input.status
  span.setAttributes(
    cleanAttrs({
      'mediajob.status': status,
      'mediajob.error_code': input.errorCode || undefined,
      'mediajob.duration_ms': Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : undefined,
      'mediajob.queue_wait_ms': Number.isFinite(Number(input.queueWaitMs)) ? Number(input.queueWaitMs) : undefined,
      'mediajob.input_bytes': Number.isFinite(Number(input.inputBytes)) ? Number(input.inputBytes) : undefined,
      'mediajob.output_bytes': Number.isFinite(Number(input.outputBytes)) ? Number(input.outputBytes) : undefined,
    })
  )
  if (status === 'failed' || status === 'dead') {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: String(input.errorMessage || input.errorCode || status),
    })
  } else if (status === 'completed') {
    span.setStatus({ code: SpanStatusCode.OK })
  }
}

export function recordMediaJobMetrics(input: {
  type: string
  status: 'completed' | 'failed' | 'dead' | 'unknown'
  errorCode?: string | null
  durationMs?: number | null
  queueWaitMs?: number | null
  inputBytes?: number | null
  outputBytes?: number | null
}) {
  const attrs = cleanAttrs({
    mediajob_type: input.type || 'unknown',
    mediajob_status: input.status,
    error_code: input.errorCode || undefined,
  })

  mediaJobCount.add(1, attrs)

  const durationMs = Number(input.durationMs)
  if (Number.isFinite(durationMs) && durationMs >= 0) mediaJobDurationMs.record(durationMs, attrs)
  const queueWaitMs = Number(input.queueWaitMs)
  if (Number.isFinite(queueWaitMs) && queueWaitMs >= 0) mediaJobQueueWaitMs.record(queueWaitMs, attrs)
  const inputBytes = Number(input.inputBytes)
  if (Number.isFinite(inputBytes) && inputBytes >= 0) mediaJobInputBytes.record(inputBytes, attrs)
  const outputBytes = Number(input.outputBytes)
  if (Number.isFinite(outputBytes) && outputBytes >= 0) mediaJobOutputBytes.record(outputBytes, attrs)

  if (input.status === 'failed' || input.status === 'dead') {
    mediaJobFailures.add(1, attrs)
  }
}

