import { SpanKind, SpanStatusCode, type Span, trace } from '@opentelemetry/api'

type AttrValue = string | number | boolean
type AttrRecord = Record<string, AttrValue | null | undefined>

export type ExternalSpanInput = {
  spanName: string
  provider: string
  operation: string
  system?: 'http' | 'aws_sdk' | string
  attrs?: AttrRecord
}

type AwsMetadata = {
  httpStatusCode?: number
  requestId?: string
}

const tracer = trace.getTracer('aws.external.providers')

function cleanAttrs(input?: AttrRecord): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {}
  for (const [k, v] of Object.entries(input || {})) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

function classifyOutcomeFromStatus(statusCode: number): 'success' | 'redirect' | 'client_error' | 'server_error' {
  if (statusCode >= 500) return 'server_error'
  if (statusCode >= 400) return 'client_error'
  if (statusCode >= 300) return 'redirect'
  return 'success'
}

function classifyErrorClassFromStatus(statusCode: number): string | null {
  if (statusCode < 400) return null
  if (statusCode === 400 || statusCode === 422) return 'validation'
  if (statusCode === 401 || statusCode === 403) return 'auth'
  if (statusCode === 404) return 'not_found'
  if (statusCode === 409) return 'conflict'
  if (statusCode === 429) return 'rate_limit'
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) return 'upstream'
  if (statusCode >= 500) return 'upstream'
  return 'client'
}

function statusFromUnknownError(err: unknown): number | null {
  const anyErr = err as any
  const raw = anyErr?.$metadata?.httpStatusCode ?? anyErr?.statusCode ?? anyErr?.status
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const v = Math.round(n)
  if (v < 100 || v > 599) return null
  return v
}

export function classifyExternalErrorClass(err: unknown): string {
  const status = statusFromUnknownError(err)
  if (status != null) {
    const byStatus = classifyErrorClassFromStatus(status)
    if (byStatus) return byStatus
  }
  const anyErr = err as any
  const code = String(anyErr?.code || anyErr?.name || '').toLowerCase()
  const msg = String(anyErr?.message || '').toLowerCase()
  if (code.includes('abort') || code.includes('timeout') || msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout'
  }
  if (
    code.includes('econnreset') ||
    code.includes('econnrefused') ||
    code.includes('enotfound') ||
    code.includes('eai_again') ||
    code.includes('network') ||
    msg.includes('network') ||
    msg.includes('connection')
  ) {
    return 'network'
  }
  if (msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('access denied')) return 'auth'
  if (msg.includes('rate limit') || msg.includes('too many requests')) return 'rate_limit'
  if (msg.includes('validation') || msg.includes('invalid')) return 'validation'
  if (msg.includes('not found')) return 'not_found'
  return 'upstream'
}

function applyOutcomeFromStatus(span: Span, statusCode: number) {
  span.setAttribute('http.status_code', statusCode)
  span.setAttribute('app.outcome', classifyOutcomeFromStatus(statusCode))
  const errorClass = classifyErrorClassFromStatus(statusCode)
  if (errorClass) span.setAttribute('error.class', errorClass)
  if (statusCode >= 400) span.setStatus({ code: SpanStatusCode.ERROR, message: `http_status_${statusCode}` })
  else span.setStatus({ code: SpanStatusCode.OK })
}

function applyError(span: Span, err: unknown) {
  const status = statusFromUnknownError(err)
  if (status != null) {
    applyOutcomeFromStatus(span, status)
  } else {
    span.setAttribute('app.outcome', 'server_error')
    span.setStatus({ code: SpanStatusCode.ERROR, message: String((err as any)?.message || err || 'external_error') })
  }
  span.setAttribute('error.class', classifyExternalErrorClass(err))
  span.recordException(err as any)
}

function baseSpanAttrs(input: ExternalSpanInput): Record<string, AttrValue> {
  return cleanAttrs({
    'external.provider': input.provider,
    'external.operation': input.operation,
    'external.system': input.system || 'http',
    ...input.attrs,
  })
}

export async function withExternalSpan<T>(
  input: ExternalSpanInput,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    input.spanName,
    { attributes: baseSpanAttrs(input), kind: SpanKind.CLIENT },
    async (span) => {
    try {
      return await fn(span)
    } catch (err) {
      applyError(span, err)
      throw err
    } finally {
      span.end()
    }
    }
  )
}

export async function withExternalHttpSpan(
  input: ExternalSpanInput,
  fn: (span: Span) => Promise<Response>
): Promise<Response> {
  return withExternalSpan({ ...input, system: input.system || 'http' }, async (span) => {
    const res = await fn(span)
    const requestId =
      res.headers.get('x-request-id') ||
      res.headers.get('x-amzn-requestid') ||
      res.headers.get('x-amz-request-id') ||
      null
    if (requestId) span.setAttribute('external.request_id', requestId)
    applyOutcomeFromStatus(span, res.status)
    return res
  })
}

export async function withExternalAwsSpan<T extends { $metadata?: AwsMetadata }>(
  input: ExternalSpanInput,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return withExternalSpan({ ...input, system: input.system || 'aws_sdk' }, async (span) => {
    const out = await fn(span)
    const meta = (out as any)?.$metadata as AwsMetadata | undefined
    if (meta?.requestId) span.setAttribute('external.request_id', String(meta.requestId))
    if (Number.isFinite(Number(meta?.httpStatusCode))) {
      applyOutcomeFromStatus(span, Number(meta?.httpStatusCode))
    } else {
      span.setAttribute('app.outcome', 'success')
      span.setStatus({ code: SpanStatusCode.OK })
    }
    return out
  })
}

export function recordExternalTurnaroundSpan(input: {
  spanName: string
  provider: string
  operation: string
  startTimeMs: number
  endTimeMs: number
  outcome: 'success' | 'client_error' | 'server_error'
  errorClass?: string | null
  attrs?: AttrRecord
}) {
  const start = Number(input.startTimeMs)
  const end = Number(input.endTimeMs)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  const s = Math.max(0, Math.round(start))
  const e = Math.max(s, Math.round(end))

  const span = tracer.startSpan(
    input.spanName,
    {
      kind: SpanKind.CLIENT,
      startTime: new Date(s),
      attributes: cleanAttrs({
        'external.provider': input.provider,
        'external.operation': input.operation,
        'external.system': 'aws_sdk',
        'app.outcome': input.outcome,
        ...(input.errorClass ? { 'error.class': input.errorClass } : {}),
        ...(input.attrs || {}),
      }),
    }
  )
  if (input.outcome === 'success') span.setStatus({ code: SpanStatusCode.OK })
  else span.setStatus({ code: SpanStatusCode.ERROR, message: input.errorClass || input.outcome })
  span.end(new Date(e))
}
