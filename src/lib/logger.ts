import os from 'os'
import pino, { type Logger, type LoggerOptions } from 'pino'
import { context, trace } from '@opentelemetry/api'
import { BUILD_TAG, getVersionInfo } from '../utils/version'

type AppEnv = 'development' | 'staging' | 'production'
type LogFormat = 'pretty' | 'json'

function normalizeEnv(raw: string | undefined): AppEnv {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'production') return 'production'
  if (value === 'staging') return 'staging'
  return 'development'
}

function normalizeLogFormat(raw: string | undefined, appEnv: AppEnv): LogFormat {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'pretty') return 'pretty'
  if (value === 'json') return 'json'
  return appEnv === 'development' ? 'pretty' : 'json'
}

function normalizeLogLevel(raw: string | undefined, appEnv: AppEnv): LoggerOptions['level'] {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'fatal' || value === 'error' || value === 'warn' || value === 'info' || value === 'debug' || value === 'trace') {
    return value
  }
  return appEnv === 'development' ? 'debug' : 'info'
}

function envBool(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return fallback
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return fallback
}

const appEnv = normalizeEnv(process.env.APP_ENV || process.env.NODE_ENV)
const logFormat = normalizeLogFormat(process.env.LOG_FORMAT, appEnv)
const logLevel = normalizeLogLevel(process.env.LOG_LEVEL, appEnv)
const redactEnabled = envBool(process.env.LOG_REDACT, true)
const serviceName = String(process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || 'aws-mediaconvert-service').trim() || 'aws-mediaconvert-service'
const versionInfo = getVersionInfo()
const serviceVersion = String(process.env.OTEL_SERVICE_VERSION || versionInfo.buildTag || BUILD_TAG || 'dev').trim() || 'dev'

const redactPaths: string[] = redactEnabled
  ? [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.headers.x-api-key',
      'req.headers.x-auth-token',
      'authorization',
      'cookie',
      'set-cookie',
      '*.authorization',
      '*.cookie',
      '*.set-cookie',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.password',
      '*.secret',
      '*.apiKey',
    ]
  : []

const baseOptions: LoggerOptions = {
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: serviceName,
    env: appEnv,
    version: serviceVersion,
    hostname: os.hostname(),
    pid: process.pid,
  },
  redact: redactPaths.length ? { paths: redactPaths, censor: '[redacted]' } : undefined,
  formatters: {
    level(label) {
      return { level: label }
    },
  },
  mixin() {
    try {
      const span = trace.getSpan(context.active())
      const spanCtx = span?.spanContext()
      if (!spanCtx) return {}
      return {
        trace_id: spanCtx.traceId,
        span_id: spanCtx.spanId,
        trace_flags: spanCtx.traceFlags,
      }
    } catch {
      return {}
    }
  },
}

function buildLogger(): Logger {
  if (logFormat === 'pretty') {
    const transport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })
    return pino(baseOptions, transport)
  }
  return pino(baseOptions)
}

export const logger: Logger = buildLogger()

export function getLogger(bindings?: Record<string, unknown>): Logger {
  return bindings ? logger.child(bindings) : logger
}

export function logError(log: Logger, err: unknown, message: string, fields?: Record<string, unknown>) {
  const payload = {
    ...(fields || {}),
    err: err instanceof Error
      ? {
          name: err.name,
          message: err.message,
          stack: err.stack,
        }
      : err,
  }
  log.error(payload, message)
}

export function observabilityConfig() {
  return {
    appEnv,
    logFormat,
    logLevel,
    redactEnabled,
    serviceName,
    serviceVersion,
  }
}
