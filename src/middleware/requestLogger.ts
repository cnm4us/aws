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

  reqLogger.debug(
    {
      path: req.path,
      ip: req.ip,
      user_id: req.user?.id ?? null,
    },
    'request.start'
  )

  res.on('finish', () => {
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

