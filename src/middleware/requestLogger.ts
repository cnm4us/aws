import crypto from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Logger } from 'pino'
import { getLogger } from '../lib/logger'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
      log?: Logger
    }
  }
}

function parseRequestId(raw: unknown): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  if (value.length > 128) return null
  return value
}

function makeRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return crypto.randomBytes(16).toString('hex')
}

function envBool(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return fallback
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return fallback
}

const STATIC_EXT_RE = /\.(?:html|json|css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i
const PROBE_RE = /^\/(?:\.env(?:\..*)?|\.git(?:\/.*)?|wp-(?:admin|login\.php|content)(?:\/.*)?|xmlrpc\.php|phpmyadmin(?:\/.*)?|server-status(?:\/.*)?|boaform(?:\/.*)?|cgi-bin(?:\/.*)?)/i

function isStaticAssetPath(pathname: string): boolean {
  if (!pathname) return false
  if (pathname === '/favicon.ico' || pathname === '/robots.txt' || pathname === '/manifest.json') return true
  if (pathname.startsWith('/app/assets/')) return true
  if (pathname.startsWith('/help/')) return true
  return STATIC_EXT_RE.test(pathname)
}

function isProbePath(pathname: string): boolean {
  if (!pathname) return false
  return PROBE_RE.test(pathname)
}

function shouldLogRequest(pathname: string): boolean {
  if (!envBool(process.env.LOG_REQUEST_ROOT, false) && pathname === '/') return false
  if (!envBool(process.env.LOG_REQUEST_PROBES, false) && isProbePath(pathname)) return false
  if (!envBool(process.env.LOG_REQUEST_STATIC, false) && isStaticAssetPath(pathname)) return false
  return true
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startAt = process.hrtime.bigint()
  const inboundRequestId = parseRequestId(req.headers['x-request-id'])
  const requestId = inboundRequestId || makeRequestId()

  req.requestId = requestId
  res.setHeader('x-request-id', requestId)

  const reqLogger = getLogger({
    request_id: requestId,
    method: req.method,
  })
  req.log = reqLogger

  const path = req.path || '/'
  const logThisRequest = shouldLogRequest(path)
  if (logThisRequest) {
    reqLogger.debug(
      {
        path,
        ip: req.ip,
        user_id: req.user?.id ?? null,
      },
      'request.start'
    )
  }

  res.on('finish', () => {
    if (!logThisRequest) return
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000
    const routePath = req.route?.path ? String(req.route.path) : undefined
    const contentLength = Number(res.getHeader('content-length') || 0) || undefined
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    reqLogger[level](
      {
        path: req.path,
        route: routePath,
        status_code: res.statusCode,
        duration_ms: Number(durationMs.toFixed(2)),
        response_bytes: contentLength,
        user_id: req.user?.id ?? null,
      },
      'request.finish'
    )
  })

  next()
}
