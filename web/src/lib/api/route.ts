/**
 * The request pipeline every `/api/v1` endpoint runs through (§56, §77, §83).
 *
 * §77 lists what every API must do: validate, authenticate, authorize, rate
 * limit, log sensitive actions, prevent IDOR, sanitise output, handle errors
 * safely. A list like that is not satisfied by asking each route to remember
 * it. It is satisfied by making the route unable to skip it -- so a handler
 * here cannot run before the checks have, and cannot return a shape other than
 * the envelope.
 *
 * Order is deliberate, cheapest and most protective first:
 *
 *   method → rate limit → content type → body size → parse → authenticate
 *          → CSRF → MFA → validate → authorize → handle
 *
 * Rate limiting precedes authentication so that an unauthenticated flood costs
 * a Map lookup rather than a database round trip. Authorization comes last of
 * the checks because it is the only one that needs the parsed input to know
 * which scope is being asked for.
 */

import type { Actor, RequestContext } from './context'
import type { Infer, Shape } from './validate'
import type { AuthzTarget } from '../auth/rbac'
import type { RateLimitRule } from './ratelimit'
import { AuthorizationError, require_ } from '../auth/rbac'
import { ApiProblem, errorBody } from './problem'
import { assertSameOrigin, isMutating } from './csrf'
import { consume, limiterIdentity } from './ratelimit'
import { fromSearchParams, parse } from './validate'
import { resolveActor, resolveIp, resolveRequestId } from './context'
import { db } from '../db/pool'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type AuthRequirement = 'none' | 'optional' | 'required'

/** A request body larger than this is refused unread (§77). */
const MAX_BODY_BYTES = 256 * 1024

export interface HandlerResult<T> {
  data: T
  status?: number
  headers?: Record<string, string>
  /** Serialised Set-Cookie values. */
  cookies?: string[]
}

export interface HandlerInput<BodyShape extends Shape, QueryShape extends Shape> {
  ctx: RequestContext
  body: Infer<BodyShape>
  query: Infer<QueryShape>
  params: Record<string, string>
  /** Non-null whenever `auth` is 'required'; the wrapper has already enforced it. */
  actor: Actor | null
}

export interface RouteSpec<BodyShape extends Shape, QueryShape extends Shape, Payload> {
  method: HttpMethod
  auth?: AuthRequirement
  rateLimit?: RateLimitRule
  body?: BodyShape
  query?: QueryShape
  /**
   * Set only by the endpoints that exist to satisfy the second factor.
   *
   * The MFA gate below refuses a privileged session that has not cleared a
   * code -- which would include the endpoint the caller uses to clear one, so
   * those would be unreachable by exactly the accounts that need them. The
   * opt-out is named rather than inferred so that adding it to anything else
   * is a visible decision in a diff (§7).
   */
  allowWithoutMfa?: boolean
  permission?: {
    key: string
    /** Which scope the caller is asking to act in. Omitted means unscoped. */
    target?: (input: {
      body: Infer<BodyShape>
      query: Infer<QueryShape>
      params: Record<string, string>
    }) => AuthzTarget
  }
  handle: (input: HandlerInput<BodyShape, QueryShape>) => Promise<HandlerResult<Payload>>
}

/** What Next.js passes as the second argument to a route handler. */
export interface RouteArgs {
  params?: Promise<Record<string, string>>
}

/**
 * Headers every response carries.
 *
 * `no-store` is the one that matters: an API response is per-caller by
 * definition, and a shared cache holding one is how a reader is served
 * another reader's session state. `nosniff` stops a JSON body being
 * reinterpreted as script.
 */
function baseHeaders(requestId: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  }
}

function respond(
  body: unknown,
  status: number,
  requestId: string,
  extra: Record<string, string> = {},
  cookies: string[] = [],
): Response {
  const headers = new Headers({ ...baseHeaders(requestId), ...extra })
  for (const cookie of cookies) headers.append('set-cookie', cookie)

  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * Turns anything thrown into a safe response.
 *
 * The unrecognised case is the important one. It logs the real error with the
 * request id and returns a generic 500 carrying the same id -- so an operator
 * can rejoin the two, and a caller learns nothing about what broke. This is
 * the §83 prohibition on leaking stack traces and SQL, enforced structurally
 * rather than by remembering it at each throw site.
 */
function toResponse(error: unknown, requestId: string, route: string): Response {
  if (error instanceof ApiProblem) {
    if (error.internal !== undefined) {
      console.warn('[api] rejected', { route, requestId, code: error.code, detail: error.internal })
    }
    return respond(errorBody(error, requestId), error.status, requestId, error.headers)
  }

  if (error instanceof AuthorizationError) {
    // The message names the permission, which is a map of the authorization
    // model. It goes to the log; the caller gets the bare refusal.
    console.warn('[api] denied', { route, requestId, detail: error.message })
    const problem = new ApiProblem('FORBIDDEN', 'You do not have access to this.')
    return respond(errorBody(problem, requestId), problem.status, requestId)
  }

  console.error('[api] unhandled', {
    route,
    requestId,
    detail: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })

  const problem = new ApiProblem('INTERNAL_ERROR', 'Something went wrong on our side.')
  return respond(errorBody(problem, requestId), problem.status, requestId)
}

/** Reads and parses the JSON body, enforcing type and size first. */
async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiProblem('UNSUPPORTED_MEDIA_TYPE', 'Send this request as application/json.')
  }

  // Trust the declared length when it is present and excessive, so an oversized
  // upload is refused before it is buffered.
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiProblem('PAYLOAD_TOO_LARGE', 'That request body is too large.')
  }

  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new ApiProblem('PAYLOAD_TOO_LARGE', 'That request body is too large.')
  }

  if (text === '') return {}

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiProblem('VALIDATION_ERROR', 'The request body is not valid JSON.')
  }
}

/**
 * Opens the database handle.
 *
 * A missing DATABASE_URL is a deployment state, not a bug, and the portal
 * currently runs without one. Reporting it as 503 is accurate and tells an
 * operator what to do; letting the environment error escape would return 500
 * and print the variable's name and expectations to the caller.
 */
function openDb(): ReturnType<typeof db> {
  try {
    return db()
  } catch (error) {
    throw new ApiProblem('SERVICE_UNAVAILABLE', 'This service is not available yet.', {
      internal: error instanceof Error ? error.message : String(error),
      headers: { 'retry-after': '30' },
    })
  }
}

export function route<BodyShape extends Shape, QueryShape extends Shape, Payload>(
  spec: RouteSpec<BodyShape, QueryShape, Payload>,
): (request: Request, args?: RouteArgs) => Promise<Response> {
  const auth = spec.auth ?? 'none'

  return async function handler(request: Request, args?: RouteArgs): Promise<Response> {
    const requestId = resolveRequestId(request)
    const routeLabel = `${spec.method} ${new URL(request.url).pathname}`

    try {
      if (request.method.toUpperCase() !== spec.method) {
        throw new ApiProblem('METHOD_NOT_ALLOWED', `Use ${spec.method} for this endpoint.`, {
          headers: { allow: spec.method },
        })
      }

      const ip = resolveIp(request)

      // Before authentication: an anonymous flood must not reach the database.
      if (spec.rateLimit !== undefined) {
        const verdict = consume(spec.rateLimit, limiterIdentity(null, ip))
        if (!verdict.allowed) {
          throw new ApiProblem('RATE_LIMITED', 'Too many requests. Try again shortly.', {
            headers: { 'retry-after': verdict.resetSeconds.toString() },
          })
        }
      }

      const rawBody = spec.body === undefined ? {} : await readBody(request)

      const handle = openDb()
      const { actor, cookieAuthenticated } = await resolveActor(handle, request)

      if (auth === 'required' && actor === null) {
        throw new ApiProblem('UNAUTHENTICATED', 'Sign in to continue.')
      }

      // CSRF applies exactly where the browser attaches credentials for us.
      if (isMutating(spec.method) && cookieAuthenticated) {
        assertSameOrigin(request)
      }

      // A privileged grant without a second factor is not a usable session (§7).
      if (
        spec.allowWithoutMfa !== true &&
        actor !== null &&
        actor.mfaRequired &&
        !actor.mfaSatisfied
      ) {
        throw new ApiProblem('MFA_REQUIRED', 'This account requires two-factor authentication.')
      }

      const params = args?.params === undefined ? {} : await args.params

      let body = {} as Infer<BodyShape>
      if (spec.body !== undefined) {
        const parsed = parse(spec.body, rawBody)
        if (!parsed.ok) {
          throw new ApiProblem('VALIDATION_ERROR', 'Some fields need attention.', {
            fields: parsed.problems,
          })
        }
        body = parsed.value
      }

      let query = {} as Infer<QueryShape>
      if (spec.query !== undefined) {
        const parsed = parse(spec.query, fromSearchParams(new URL(request.url).searchParams))
        if (!parsed.ok) {
          throw new ApiProblem('VALIDATION_ERROR', 'Some query parameters need attention.', {
            fields: parsed.problems,
          })
        }
        query = parsed.value
      }

      if (spec.permission !== undefined) {
        if (actor === null) throw new ApiProblem('UNAUTHENTICATED', 'Sign in to continue.')

        // Throws AuthorizationError, which `toResponse` renders as a bare 403.
        require_(actor.grants, spec.permission.key, spec.permission.target?.({ body, query, params }))
      }

      const ctx: RequestContext = {
        db: handle,
        request,
        requestId,
        actor,
        ip,
        cookieAuthenticated,
      }

      const result = await spec.handle({ ctx, body, query, params, actor })

      return respond(
        { success: true, data: result.data },
        result.status ?? 200,
        requestId,
        result.headers ?? {},
        result.cookies ?? [],
      )
    } catch (error) {
      return toResponse(error, requestId, routeLabel)
    }
  }
}
