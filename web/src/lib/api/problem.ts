/**
 * The API error envelope (§83).
 *
 * Every failure leaves the process in exactly one shape, so a client never has
 * to guess. The shape is fixed by §83:
 *
 *   { success: false, error: { code, message, requestId } }
 *
 * What is *not* in it matters as much as what is. No stack trace, no SQL, no
 * driver text, no internal hostname, no table name. §83 forbids leaking those
 * and §77 explains why: an error message is a free map of the system for
 * anyone probing it. So the rule here is that a `message` is written for a
 * caller, never derived from a caught exception -- the exception goes to the
 * log, keyed by the same request id the caller is given, and the two are
 * rejoined by an operator rather than by an attacker.
 */

/**
 * The failure codes this API can return.
 *
 * A closed set, because a client switching on `code` needs the set to be
 * enumerable, and because an open set is how internal strings leak outward.
 */
export type ProblemCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'CSRF_REJECTED'
  | 'RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'MFA_REQUIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

const STATUS: Record<ProblemCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  CSRF_REJECTED: 403,
  RATE_LIMITED: 429,
  ACCOUNT_LOCKED: 423,
  MFA_REQUIRED: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}

/** One rejected field. Names the field and what is wrong with it, nothing more. */
export interface FieldProblem {
  field: string
  message: string
}

/**
 * A failure that is safe to return to a caller.
 *
 * Thrown by handlers and by the middleware around them; converted to a
 * response in exactly one place, so the envelope cannot drift between routes.
 */
export class ApiProblem extends Error {
  readonly code: ProblemCode
  readonly fields: FieldProblem[]
  /** Extra response headers this failure requires, such as Retry-After. */
  readonly headers: Record<string, string>
  /**
   * Detail for the log only. Never serialised. This is where a caught
   * exception's text belongs -- attached to the problem, excluded from the
   * response.
   */
  readonly internal: string | undefined

  constructor(
    code: ProblemCode,
    message: string,
    options: {
      fields?: FieldProblem[]
      headers?: Record<string, string>
      internal?: string
    } = {},
  ) {
    super(message)
    this.name = 'ApiProblem'
    this.code = code
    this.fields = options.fields ?? []
    this.headers = options.headers ?? {}
    this.internal = options.internal
  }

  get status(): number {
    return STATUS[this.code]
  }
}

export interface ErrorBody {
  success: false
  error: {
    code: ProblemCode
    message: string
    requestId: string
    /** Present only for VALIDATION_ERROR, where the caller must know what to fix. */
    fields?: FieldProblem[]
  }
}

export interface SuccessBody<T> {
  success: true
  data: T
}

export function errorBody(problem: ApiProblem, requestId: string): ErrorBody {
  const body: ErrorBody = {
    success: false,
    error: { code: problem.code, message: problem.message, requestId },
  }

  // Field detail is useful for a form and useless to a prober -- it only ever
  // describes input the caller just sent. Anything else stays out.
  if (problem.fields.length > 0) body.error.fields = problem.fields

  return body
}

export function statusFor(code: ProblemCode): number {
  return STATUS[code]
}
