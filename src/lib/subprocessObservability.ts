import { SpanKind, SpanStatusCode, type Span, trace } from '@opentelemetry/api'

type AttrValue = string | number | boolean
type AttrRecord = Record<string, AttrValue | null | undefined>

export type SubprocessSpanInput = {
  spanName: string
  command: string
  operation: string
  attrs?: AttrRecord
}

const tracer = trace.getTracer('aws.subprocess')

function cleanAttrs(input?: AttrRecord): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {}
  for (const [k, v] of Object.entries(input || {})) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

function baseAttrs(input: SubprocessSpanInput): Record<string, AttrValue> {
  return cleanAttrs({
    'app.operation': input.operation,
    'subprocess.name': input.command,
    'subprocess.exec_mode': process.env.FFMPEG_EXEC_MODE || 'local',
    ...input.attrs,
  })
}

export function markSubprocessResult(
  span: Span,
  input: { exitCode?: number | null; success: boolean; handled?: boolean }
) {
  const exitCodeRaw = Number(input.exitCode)
  span.setAttributes(
    cleanAttrs({
      'subprocess.exit_code': Number.isFinite(exitCodeRaw) ? Math.round(exitCodeRaw) : undefined,
      'subprocess.success': Boolean(input.success),
      'subprocess.handled_nonzero': input.handled ? true : undefined,
      'app.outcome': input.success ? 'success' : input.handled ? 'success' : 'server_error',
    })
  )
  if (input.success || input.handled) {
    span.setStatus({ code: SpanStatusCode.OK })
  } else {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'subprocess_nonzero_exit' })
  }
}

export async function withSubprocessSpan<T>(
  input: SubprocessSpanInput,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    input.spanName,
    { kind: SpanKind.CLIENT, attributes: baseAttrs(input) },
    async (span) => {
      try {
        const out = await fn(span)
        return out
      } catch (err: any) {
        span.setAttributes(
          cleanAttrs({
            'app.outcome': 'server_error',
            'error.class': 'internal',
          })
        )
        span.recordException(err)
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message || err || 'subprocess_error') })
        throw err
      } finally {
        span.end()
      }
    }
  )
}
