import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
import { getLogger } from './logger'

const obsLogger = getLogger({ component: 'observability' })

let sdk: NodeSDK | null = null
let started = false

function envBool(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return fallback
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return fallback
}

function otelEnabled() {
  return envBool(process.env.OTEL_ENABLED, false)
}

function instrumentMysql2Enabled() {
  return envBool(process.env.OTEL_INSTRUMENT_MYSQL2, true)
}

function instrumentNetEnabled() {
  return envBool(process.env.OTEL_INSTRUMENT_NET, false)
}

function traceStaticEnabled() {
  return envBool(process.env.OTEL_TRACE_STATIC, false)
}

const STATIC_EXT_RE = /\.(?:html|json|css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i

function requestPath(req: any): string {
  const raw = String(req?.url || '').trim()
  if (!raw) return '/'
  try {
    return new URL(raw, 'http://localhost').pathname || '/'
  } catch {
    const idx = raw.indexOf('?')
    return (idx >= 0 ? raw.slice(0, idx) : raw) || '/'
  }
}

function headerValue(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] || '')
  return String(v || '')
}

function requestRefererPath(req: any): string | null {
  const ref = headerValue(req?.headers?.referer || req?.headers?.referrer).trim()
  if (!ref) return null
  try {
    return new URL(ref).pathname || null
  } catch {
    return null
  }
}

function isStaticAssetPath(pathname: string): boolean {
  if (!pathname) return false
  if (pathname === '/favicon.ico' || pathname === '/robots.txt' || pathname === '/manifest.json') return true
  if (pathname.startsWith('/app/assets/')) return true
  return STATIC_EXT_RE.test(pathname)
}

function classifyHttpOperation(methodRaw: string, pathname: string): string | null {
  const method = String(methodRaw || '').toUpperCase()
  if (method === 'PATCH' && /^\/api\/create-video\/projects\/[^/]+\/timeline$/.test(pathname)) {
    return 'create_video.timeline.patch'
  }
  if (method === 'PATCH' && pathname === '/api/create-video/project') {
    return 'create_video.timeline.patch'
  }
  if (method === 'POST' && /^\/api\/create-video\/projects\/[^/]+\/export$/.test(pathname)) {
    return 'create_video.export.enqueue'
  }
  if (method === 'POST' && pathname === '/api/create-video/project/export') {
    return 'create_video.export.enqueue'
  }
  if (method === 'GET' && /^\/api\/uploads\/[^/]+\/file$/.test(pathname)) {
    return 'uploads.file.get'
  }
  if (method === 'GET' && /^\/api\/uploads\/[^/]+\/edit-proxy$/.test(pathname)) {
    return 'uploads.edit_proxy.get'
  }
  return null
}

function classifySurface(pathname: string, req: any, operation: string | null): string | null {
  if (operation?.startsWith('create_video.')) return 'create_video'
  const refPath = requestRefererPath(req)
  if (refPath && refPath.startsWith('/create-video')) return 'create_video'
  if (refPath && (refPath.startsWith('/assets') || refPath.startsWith('/library') || refPath.startsWith('/uploads'))) {
    return 'assets'
  }
  if (pathname.startsWith('/api/uploads/')) return 'unknown'
  return null
}

function applySpanNamingAndTags(span: any, req: any) {
  const p = requestPath(req)
  const method = String(req?.method || 'GET').toUpperCase()
  const isStatic = isStaticAssetPath(p)
  if (isStatic) {
    span?.setAttribute?.('app.request.class', 'static_asset')
  }
  if ((isStatic || !String(span?.name || '').match(/\//)) && isLowCardinalityPath(p)) {
    span?.updateName?.(`HTTP ${method} ${p}`)
  }
  const op = classifyHttpOperation(method, p)
  if (op) span?.setAttribute?.('app.operation', op)
  const surface = classifySurface(p, req, op)
  if (surface) span?.setAttribute?.('app.surface', surface)
}

function isLowCardinalityPath(pathname: string): boolean {
  if (!pathname) return false
  // Avoid naming spans with dynamic IDs directly in the name.
  const parts = pathname.split('/').filter(Boolean)
  return parts.every((p) => !/^\d+$/.test(p) && !/^[0-9a-f]{8,}$/i.test(p))
}

function buildTraceExporter() {
  const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim()
  if (!endpoint) return new ConsoleSpanExporter()
  return new OTLPTraceExporter({
    url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/+$/, '')}/v1/traces`,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
      ? Object.fromEntries(
          String(process.env.OTEL_EXPORTER_OTLP_HEADERS)
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
              const idx = entry.indexOf('=')
              if (idx <= 0) return [entry, '']
              return [entry.slice(0, idx), entry.slice(idx + 1)]
            })
        )
      : undefined,
  })
}

export async function initObservability() {
  if (started) return
  started = true

  if (!otelEnabled()) {
    obsLogger.info('otel.disabled')
    return
  }

  const diagLevelRaw = String(process.env.OTEL_DIAG_LEVEL || '').trim().toLowerCase()
  if (diagLevelRaw === 'debug') diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
  else if (diagLevelRaw === 'info') diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)

  sdk = new NodeSDK({
    traceExporter: buildTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req: any) => {
            if (traceStaticEnabled()) return false
            const p = requestPath(req)
            return isStaticAssetPath(p)
          },
          requestHook: (span: any, req: any) => {
            applySpanNamingAndTags(span, req)
          },
          applyCustomAttributesOnSpan: (span: any, req: any) => {
            applySpanNamingAndTags(span, req)
          },
        },
        '@opentelemetry/instrumentation-net': { enabled: instrumentNetEnabled() },
        '@opentelemetry/instrumentation-mysql2': { enabled: instrumentMysql2Enabled() },
      }),
    ],
  })

  await sdk.start()
  obsLogger.info(
    {
      service_name: String(process.env.OTEL_SERVICE_NAME || '').trim() || 'aws-mediaconvert-service',
      exporter_endpoint: String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim() || 'console',
      mysql2_instrumentation_enabled: instrumentMysql2Enabled(),
      net_instrumentation_enabled: instrumentNetEnabled(),
      trace_static_enabled: traceStaticEnabled(),
    },
    'otel.started'
  )
}

export async function shutdownObservability() {
  if (!sdk) return
  try {
    await sdk.shutdown()
    obsLogger.info('otel.stopped')
  } catch (err) {
    obsLogger.warn({ err }, 'otel.stop_failed')
  } finally {
    sdk = null
  }
}
