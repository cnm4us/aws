import type { NextFunction, Request, Response } from 'express'
import { DomainError } from './errors'

// Maps DomainError subclasses to HTTP responses. Keep JSON shape aligned with current API errors.
export function domainErrorMiddleware(err: any, _req: Request, res: Response, next: NextFunction) {
  if (!(err instanceof DomainError)) return next(err)
  const status = err.status ?? 400
  const body: any = { error: err.code || 'error', detail: err.message }
  res.status(status).json(body)
}

