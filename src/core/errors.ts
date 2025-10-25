export class DomainError extends Error {
  readonly name: string
  readonly code: string
  readonly status?: number
  constructor(message: string, code = 'domain_error', status?: number) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.status = status
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'not_found') { super(message, 'not_found', 404) }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'forbidden') { super(message, 'forbidden', 403) }
}

export class ConflictError extends DomainError {
  constructor(message = 'conflict') { super(message, 'conflict', 409) }
}

export class InvalidStateError extends DomainError {
  constructor(message = 'invalid_state') { super(message, 'invalid_state', 422) }
}

export class ValidationError extends DomainError {
  constructor(message = 'invalid_body') { super(message, 'invalid_body', 400) }
}

