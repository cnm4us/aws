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
