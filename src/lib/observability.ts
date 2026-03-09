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

function instrumentExpressEnabled() {
  return envBool(process.env.OTEL_INSTRUMENT_EXPRESS, false)
}

function traceStaticEnabled() {
  return envBool(process.env.OTEL_TRACE_STATIC, false)
}

function traceProbeEnabled() {
  return envBool(process.env.OTEL_TRACE_PROBES, false)
}

function traceRootEnabled() {
  return envBool(process.env.OTEL_TRACE_ROOT, false)
}

const STATIC_EXT_RE = /\.(?:html|json|css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i
const PROBE_RE = /^\/(?:\.env(?:\..*)?|\.git(?:\/.*)?|wp-(?:admin|login\.php|content)(?:\/.*)?|xmlrpc\.php|phpmyadmin(?:\/.*)?|server-status(?:\/.*)?|boaform(?:\/.*)?|cgi-bin(?:\/.*)?)/i

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

function isProbePath(pathname: string): boolean {
  if (!pathname) return false
  return PROBE_RE.test(pathname)
}

function isDynamicSegment(seg: string): boolean {
  if (!seg) return false
  if (/^\d+$/.test(seg)) return true
  if (/^[0-9a-f]{8,}$/i.test(seg)) return true
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg)) return true
  return false
}

function pathTemplate(pathname: string): string {
  if (!pathname) return '/'
  const parts = pathname.split('/').filter(Boolean)
  if (!parts.length) return '/'
  return '/' + parts.map((p) => (isDynamicSegment(p) ? ':id' : p)).join('/')
}

function classifyHttpOperation(methodRaw: string, pathname: string): string | null {
  const method = String(methodRaw || '').toUpperCase()
  const rules: Array<{ method: string; re: RegExp; op: string }> = [
    // Create Video (projects + legacy active project routes)
    { method: 'POST', re: /^\/api\/create-video\/project$/, op: 'create_video.project.active.ensure' },
    { method: 'GET', re: /^\/api\/create-video\/project$/, op: 'create_video.project.active.get' },
    { method: 'PATCH', re: /^\/api\/create-video\/project$/, op: 'create_video.timeline.patch' },
    { method: 'POST', re: /^\/api\/create-video\/project\/archive$/, op: 'create_video.project.active.archive' },
    { method: 'POST', re: /^\/api\/create-video\/project\/export$/, op: 'create_video.export.enqueue' },
    { method: 'GET', re: /^\/api\/create-video\/project\/export-status$/, op: 'create_video.export.status' },
    { method: 'GET', re: /^\/api\/create-video\/projects$/, op: 'create_video.projects.list' },
    { method: 'POST', re: /^\/api\/create-video\/projects$/, op: 'create_video.projects.create' },
    { method: 'GET', re: /^\/api\/create-video\/projects\/[^/]+$/, op: 'create_video.projects.get' },
    { method: 'PATCH', re: /^\/api\/create-video\/projects\/[^/]+$/, op: 'create_video.projects.patch' },
    { method: 'DELETE', re: /^\/api\/create-video\/projects\/[^/]+$/, op: 'create_video.projects.delete' },
    { method: 'POST', re: /^\/api\/create-video\/projects\/[^/]+\/archive$/, op: 'create_video.projects.archive' },
    { method: 'PATCH', re: /^\/api\/create-video\/projects\/[^/]+\/timeline$/, op: 'create_video.timeline.patch' },
    { method: 'POST', re: /^\/api\/create-video\/projects\/[^/]+\/export$/, op: 'create_video.export.enqueue' },
    { method: 'GET', re: /^\/api\/create-video\/projects\/[^/]+\/export-status$/, op: 'create_video.export.status' },
    { method: 'POST', re: /^\/api\/create-video\/screen-titles\/render$/, op: 'create_video.screen_titles.render' },
    { method: 'POST', re: /^\/api\/create-video\/narration\/sign$/, op: 'create_video.narration.sign' },
    { method: 'GET', re: /^\/api\/create-video\/narration\/list$/, op: 'create_video.narration.list' },
    { method: 'PATCH', re: /^\/api\/create-video\/narration\/[^/]+$/, op: 'create_video.narration.patch' },
    { method: 'DELETE', re: /^\/api\/create-video\/narration\/[^/]+$/, op: 'create_video.narration.delete' },
    { method: 'POST', re: /^\/api\/create-video\/audio\/sign$/, op: 'create_video.audio.sign' },
    { method: 'GET', re: /^\/api\/create-video\/audio\/list$/, op: 'create_video.audio.list' },
    { method: 'PATCH', re: /^\/api\/create-video\/audio\/[^/]+$/, op: 'create_video.audio.patch' },
    { method: 'DELETE', re: /^\/api\/create-video\/audio\/[^/]+$/, op: 'create_video.audio.delete' },
    { method: 'GET', re: /^\/api\/exports\/[^/]+\/hls-status$/, op: 'create_video.exports.hls_status.get' },
    { method: 'POST', re: /^\/api\/exports\/[^/]+\/prep-hls$/, op: 'create_video.exports.hls_prep.post' },
    { method: 'GET', re: /^\/api\/exports\/hls-status$/, op: 'create_video.exports.hls_status.get' },

    // Uploads + asset browsing
    { method: 'GET', re: /^\/api\/uploads$/, op: 'uploads.list' },
    { method: 'GET', re: /^\/api\/uploads\/summary$/, op: 'uploads.summary.get' },
    { method: 'GET', re: /^\/api\/uploads\/[^/]+$/, op: 'uploads.get' },
    { method: 'PATCH', re: /^\/api\/uploads\/[^/]+$/, op: 'uploads.patch' },
    { method: 'DELETE', re: /^\/api\/uploads\/[^/]+$/, op: 'uploads.delete' },
    { method: 'GET', re: /^\/api\/uploads\/[^/]+\/file$/, op: 'uploads.file.get' },
    { method: 'GET', re: /^\/api\/uploads\/[^/]+\/edit-proxy$/, op: 'uploads.edit_proxy.get' },
    { method: 'GET', re: /^\/api\/uploads\/[^/]+\/audio-envelope$/, op: 'uploads.audio_envelope.get' },
    { method: 'GET', re: /^\/api\/uploads\/[^/]+\/thumb$/, op: 'uploads.thumb.get' },
    { method: 'POST', re: /^\/api\/uploads\/[^/]+\/thumb$/, op: 'uploads.thumb.refresh' },
    { method: 'GET', re: /^\/api\/uploads\/[^/]+\/publish-options$/, op: 'uploads.publish_options.get' },
    { method: 'POST', re: /^\/api\/uploads\/[^/]+\/delete-source$/, op: 'uploads.delete_source' },
    { method: 'POST', re: /^\/api\/uploads\/[^/]+\/freeze-frame$/, op: 'uploads.freeze_frame' },
    { method: 'GET', re: /^\/api\/assets\/videos$/, op: 'assets.videos.list' },
    { method: 'POST', re: /^\/api\/assets\/videos\/[^/]+\/favorite$/, op: 'assets.videos.favorite' },
    { method: 'POST', re: /^\/api\/assets\/videos\/[^/]+\/used$/, op: 'assets.videos.used' },
    { method: 'GET', re: /^\/api\/assets\/graphics$/, op: 'assets.graphics.list' },
    { method: 'POST', re: /^\/api\/assets\/graphics\/[^/]+\/favorite$/, op: 'assets.graphics.favorite' },
    { method: 'POST', re: /^\/api\/assets\/graphics\/[^/]+\/used$/, op: 'assets.graphics.used' },
    { method: 'GET', re: /^\/api\/system-audio$/, op: 'assets.audio.system.list' },
    { method: 'GET', re: /^\/api\/system-audio\/search$/, op: 'assets.audio.system.search' },
    { method: 'POST', re: /^\/api\/system-audio\/[^/]+\/favorite$/, op: 'assets.audio.system.favorite' },
    { method: 'GET', re: /^\/api\/audio-tags$/, op: 'assets.audio.tags.list' },

    // Library (shared/system videos + clips)
    { method: 'GET', re: /^\/api\/library\/source-orgs$/, op: 'library.source_orgs.list' },
    { method: 'GET', re: /^\/api\/library\/videos$/, op: 'library.videos.list' },
    { method: 'GET', re: /^\/api\/library\/videos\/[^/]+$/, op: 'library.videos.get' },
    { method: 'GET', re: /^\/api\/library\/videos\/[^/]+\/captions$/, op: 'library.videos.captions' },
    { method: 'GET', re: /^\/api\/library\/videos\/[^/]+\/search$/, op: 'library.videos.search' },
    { method: 'GET', re: /^\/api\/library\/clips$/, op: 'library.clips.list' },
    { method: 'POST', re: /^\/api\/library\/clips$/, op: 'library.clips.create' },
    { method: 'GET', re: /^\/api\/library\/clips\/[^/]+$/, op: 'library.clips.get' },
    { method: 'PATCH', re: /^\/api\/library\/clips\/[^/]+$/, op: 'library.clips.patch' },
    { method: 'DELETE', re: /^\/api\/library\/clips\/[^/]+$/, op: 'library.clips.delete' },
    { method: 'POST', re: /^\/api\/library\/clips\/[^/]+\/favorite$/, op: 'library.clips.favorite' },

    // Visualizer presets
    { method: 'GET', re: /^\/api\/visualizer-presets$/, op: 'visualizer_presets.list' },
    { method: 'POST', re: /^\/api\/visualizer-presets$/, op: 'visualizer_presets.create' },
    { method: 'GET', re: /^\/api\/visualizer-presets\/[^/]+$/, op: 'visualizer_presets.get' },
    { method: 'PATCH', re: /^\/api\/visualizer-presets\/[^/]+$/, op: 'visualizer_presets.patch' },
    { method: 'PUT', re: /^\/api\/visualizer-presets\/[^/]+$/, op: 'visualizer_presets.patch' },
    { method: 'DELETE', re: /^\/api\/visualizer-presets\/[^/]+$/, op: 'visualizer_presets.delete' },
    { method: 'POST', re: /^\/api\/visualizer-presets\/[^/]+\/reset$/, op: 'visualizer_presets.reset' },

    // Admin prompts (plan_114A)
    { method: 'GET', re: /^\/api\/admin\/prompts$/, op: 'admin.prompts.list' },
    { method: 'POST', re: /^\/api\/admin\/prompts$/, op: 'admin.prompts.write' },
    { method: 'GET', re: /^\/api\/admin\/prompts\/[^/]+$/, op: 'admin.prompts.get' },
    { method: 'PATCH', re: /^\/api\/admin\/prompts\/[^/]+$/, op: 'admin.prompts.write' },
    { method: 'POST', re: /^\/api\/admin\/prompts\/[^/]+\/clone$/, op: 'admin.prompts.write' },
    { method: 'POST', re: /^\/api\/admin\/prompts\/[^/]+\/status$/, op: 'admin.prompts.write' },

    // Admin prompt rules (plan_114B)
    { method: 'GET', re: /^\/api\/admin\/prompt-rules$/, op: 'admin.prompt_rules.list' },
    { method: 'POST', re: /^\/api\/admin\/prompt-rules$/, op: 'admin.prompt_rules.write' },
    { method: 'GET', re: /^\/api\/admin\/prompt-rules\/[^/]+$/, op: 'admin.prompt_rules.get' },
    { method: 'PATCH', re: /^\/api\/admin\/prompt-rules\/[^/]+$/, op: 'admin.prompt_rules.write' },
    { method: 'POST', re: /^\/api\/admin\/prompt-rules\/[^/]+\/toggle$/, op: 'admin.prompt_rules.write' },

    // Admin prompt analytics (plan_114E)
    { method: 'GET', re: /^\/api\/admin\/prompt-analytics$/, op: 'prompt.analytics.query' },
    { method: 'GET', re: /^\/api\/admin\/prompt-analytics\.csv$/, op: 'prompt.analytics.query' },

    // Feed prompt decision (plan_114C)
    { method: 'GET', re: /^\/api\/feed\/global$/, op: 'feed.global.list' },
    { method: 'POST', re: /^\/api\/feed\/prompt-decision$/, op: 'feed.prompt.decide' },
    { method: 'GET', re: /^\/api\/feed\/prompt-decision$/, op: 'feed.prompt.decide' },
    { method: 'GET', re: /^\/api\/feed\/prompts\/[^/]+$/, op: 'feed.prompt.fetch' },
    { method: 'POST', re: /^\/api\/feed\/prompt-events$/, op: 'feed.prompt.event' },
  ]
  for (const rule of rules) {
    if (method === rule.method && rule.re.test(pathname)) {
      return rule.op
    }
  }
  return null
}

function classifySurface(pathname: string, req: any, operation: string | null): string | null {
  if (operation?.startsWith('create_video.')) return 'create_video'
  if (
    operation?.startsWith('assets.') ||
    operation?.startsWith('library.') ||
    operation?.startsWith('visualizer_presets.')
  ) {
    return 'assets'
  }
  if (operation?.startsWith('admin.')) return 'admin'
  if (operation?.startsWith('prompt.analytics.')) return 'admin'
  if (operation?.startsWith('feed.global.')) return 'global_feed'
  if (operation?.startsWith('feed.prompt.')) return 'global_feed'
  const refPath = requestRefererPath(req)
  if (refPath && refPath.startsWith('/create-video')) return 'create_video'
  if (refPath && (refPath.startsWith('/assets') || refPath.startsWith('/library') || refPath.startsWith('/uploads'))) {
    return 'assets'
  }
  if (pathname.startsWith('/api/assets/') || pathname.startsWith('/api/library/') || pathname.startsWith('/api/visualizer-presets')) {
    return 'assets'
  }
  if (pathname.startsWith('/api/admin/')) return 'admin'
  if (pathname.startsWith('/api/uploads/')) return 'unknown'
  return null
}

function applySpanNamingAndTags(span: any, req: any) {
  const p = requestPath(req)
  const method = String(req?.method || 'GET').toUpperCase()
  const isStatic = isStaticAssetPath(p)
  const isProbe = isProbePath(p)
  const currentName = String(span?.name || '')
  if (isStatic) {
    span?.setAttribute?.('app.request.class', 'static_asset')
  } else if (isProbe) {
    span?.setAttribute?.('app.request.class', 'probe')
  } else if (p === '/') {
    span?.setAttribute?.('app.request.class', 'root')
  }
  if (isStatic && isLowCardinalityPath(p)) {
    span?.updateName?.(`HTTP ${method} ${p}`)
  } else if (isProbe) {
    span?.updateName?.(`HTTP ${method} ${p}`)
  } else if (!currentName.match(/\//)) {
    span?.updateName?.(`HTTP ${method} ${pathTemplate(p)}`)
  }
  const op = classifyHttpOperation(method, p)
  if (op) span?.setAttribute?.('app.operation', op)
  const surface = classifySurface(p, req, op)
  if (surface) span?.setAttribute?.('app.surface', surface)
}

function responseStatusCode(res: any): number | null {
  const raw = res?.statusCode
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const v = Math.round(n)
  if (v < 100 || v > 599) return null
  return v
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
  if (statusCode === 401) return 'auth'
  if (statusCode === 403) return 'forbidden'
  if (statusCode === 404) return 'not_found'
  if (statusCode === 409) return 'conflict'
  if (statusCode === 429) return 'rate_limit'
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) return 'upstream'
  if (statusCode >= 500) return 'internal'
  return 'client'
}

function applySpanOutcomeTags(span: any, req: any, res: any) {
  if (!req?.method) return
  const statusCode = responseStatusCode(res)
  if (statusCode == null) return
  span?.setAttribute?.('app.outcome', classifyOutcomeFromStatus(statusCode))
  if (statusCode >= 400) {
    const errorClass = classifyErrorClassFromStatus(statusCode)
    if (errorClass) span?.setAttribute?.('error.class', errorClass)
  }
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
            const p = requestPath(req)
            if (!traceRootEnabled() && p === '/') return true
            if (!traceProbeEnabled() && isProbePath(p)) return true
            if (!traceStaticEnabled() && isStaticAssetPath(p)) return true
            return false
          },
          requestHook: (span: any, req: any) => {
            applySpanNamingAndTags(span, req)
          },
          applyCustomAttributesOnSpan: (span: any, req: any, res: any) => {
            applySpanNamingAndTags(span, req)
            applySpanOutcomeTags(span, req, res)
          },
        },
        '@opentelemetry/instrumentation-express': { enabled: instrumentExpressEnabled() },
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
      express_instrumentation_enabled: instrumentExpressEnabled(),
      net_instrumentation_enabled: instrumentNetEnabled(),
      trace_static_enabled: traceStaticEnabled(),
      trace_probe_enabled: traceProbeEnabled(),
      trace_root_enabled: traceRootEnabled(),
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
