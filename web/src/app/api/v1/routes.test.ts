/**
 * End-to-end tests for the `/api/v1` surface, against real PostgreSQL.
 *
 * These call the exported route handlers with real `Request` objects, so what
 * is exercised is the whole pipeline -- method check, rate limit, body
 * parsing, authentication, CSRF, validation, authorization, handler, envelope
 * -- and not a handler in isolation with the interesting parts stubbed out.
 *
 * The §53 cases that needed an HTTP surface to be testable at all are here:
 * parameter tampering, session fixation, token replay, refresh reuse, IDOR,
 * CSRF, brute force, and account enumeration. Each is written as the attack,
 * with the assertion on what the attacker fails to obtain.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from '@/lib/db/testing'

// Hoisted so the mock factory can close over it: `vi.mock` is lifted above the
// imports, and the factory runs when the route modules first import the pool.
const shared = vi.hoisted(() => ({ db: null as { query: unknown } | null }))

vi.mock('@/lib/db/pool', () => ({
  db: () => {
    if (shared.db === null) throw new Error('DATABASE_URL is not set')
    return shared.db
  },
  getPool: () => {
    throw new Error('the pool is not used in tests')
  },
  closePool: async () => Promise.resolve(),
}))

const { createTestDb } = await import('@/lib/db/testing')
const { seed } = await import('@/lib/db/seed')
const { syncRoleCatalogue, findSessionByAccessToken, grantRole, revokeSession } = await import(
  '@/lib/db/identity'
)
const { resetAuthSecrets } = await import('@/lib/auth/secrets')
const { resetRateLimits } = await import('@/lib/api/ratelimit')
const { hashPassword } = await import('@/lib/auth/password')
const { setPassword } = await import('@/lib/db/identity')

const { GET: getNews } = await import('./news/route')
const { GET: getStory } = await import('./news/[slug]/route')
const { GET: getCategories } = await import('./categories/route')
const { GET: getCities } = await import('./cities/route')
const { POST: postRegister } = await import('./auth/register/route')
const { POST: postLogin } = await import('./auth/login/route')
const { POST: postLogout } = await import('./auth/logout/route')
const { POST: postRefresh } = await import('./auth/refresh/route')
const { GET: getSession } = await import('./auth/session/route')

const ORIGIN = 'https://mynewsfactory.com'
const PASSWORD = 'a-sufficiently-long-password'

let db: TestDb

beforeAll(async () => {
  process.env.AUTH_TOKEN_PEPPER = Buffer.alloc(32, 1).toString('base64')
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64')
  resetAuthSecrets()

  db = await createTestDb()
  shared.db = db
  await seed(db)
  await syncRoleCatalogue(db)
}, 120_000)

afterAll(async () => {
  shared.db = null
  await db.close()
})

beforeEach(() => {
  // Each test gets the full budget, so an earlier test's traffic cannot make a
  // later one fail with a 429 that has nothing to do with what it asserts.
  resetRateLimits()
})

// ------------------------------------------------------------------ helpers

let addressCounter = 0
function freshEmail(): string {
  addressCounter += 1
  return `reader${addressCounter.toString()}@example.com`
}

let ipCounter = 0
/** A distinct address per caller, so per-IP limits do not bleed between tests. */
function freshIp(): string {
  ipCounter += 1
  return `198.51.100.${(ipCounter % 250 + 1).toString()}`
}

interface RequestOptions {
  body?: unknown
  cookies?: Record<string, string>
  origin?: string | null
  bearer?: string
  ip?: string
  headers?: Record<string, string>
}

function build(method: string, url: string, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = {
    host: 'mynewsfactory.com',
    'x-forwarded-proto': 'https',
    'x-forwarded-for': options.ip ?? freshIp(),
    ...options.headers,
  }

  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN
  if (options.bearer !== undefined) headers.authorization = `Bearer ${options.bearer}`

  if (options.cookies !== undefined) {
    headers.cookie = Object.entries(options.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }

  return new Request(`${ORIGIN}${url}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

interface Envelope {
  success: boolean
  data?: Record<string, unknown>
  error?: { code: string; message: string; requestId: string; fields?: { field: string }[] }
}

async function read(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope
}

/** Pulls one cookie's value out of the Set-Cookie headers on a response. */
function cookieFrom(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    if (header.startsWith(`${name}=`)) {
      const value = header.slice(name.length + 1).split(';')[0] ?? ''
      return value === '' ? null : value
    }
  }
  return null
}

interface SignedIn {
  email: string
  userId: string
  accessToken: string
  refreshToken: string
}

async function createAccount(roleKey = 'READER'): Promise<{ email: string; userId: string }> {
  const email = freshEmail()
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [email, 'Test Reader'],
  )
  const userId = rows[0]?.id
  if (userId === undefined) throw new Error('could not create the test account')

  await setPassword(db, userId, await hashPassword(PASSWORD))
  await grantRole(db, { userId, roleKey, grantedBy: null })

  return { email, userId }
}

async function signIn(roleKey = 'READER'): Promise<SignedIn> {
  const { email, userId } = await createAccount(roleKey)

  const response = await postLogin(build('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } }))
  expect(response.status).toBe(200)

  const accessToken = cookieFrom(response, '__Host-mnf_at')
  const refreshToken = cookieFrom(response, '__Host-mnf_rt')
  if (accessToken === null || refreshToken === null) throw new Error('sign-in set no cookies')

  return { email, userId, accessToken, refreshToken }
}

// --------------------------------------------------------- public content

describe('public content', () => {
  it('lists published stories in the success envelope', async () => {
    const response = await getNews(build('GET', '/api/v1/news'))
    const body = await read(response)

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data?.items)).toBe(true)
    expect((body.data?.items as unknown[]).length).toBeGreaterThan(0)
  })

  it('pages with an opaque cursor rather than an offset', async () => {
    const first = await read(await getNews(build('GET', '/api/v1/news?limit=2')))
    const cursor = first.data?.nextCursor

    expect(typeof cursor).toBe('string')

    const second = await read(
      await getNews(build('GET', `/api/v1/news?limit=2&cursor=${encodeURIComponent(String(cursor))}`)),
    )

    const firstSlugs = (first.data?.items as { slug: string }[]).map((i) => i.slug)
    const secondSlugs = (second.data?.items as { slug: string }[]).map((i) => i.slug)

    expect(secondSlugs.some((slug) => firstSlugs.includes(slug))).toBe(false)
  })

  it('restarts the listing for a tampered cursor rather than failing', async () => {
    const response = await getNews(build('GET', '/api/v1/news?cursor=not-a-real-cursor'))
    expect(response.status).toBe(200)
  })

  it('rejects an out-of-range limit with a named field', async () => {
    const response = await getNews(build('GET', '/api/v1/news?limit=5000'))
    const body = await read(response)

    expect(response.status).toBe(400)
    expect(body.error?.code).toBe('VALIDATION_ERROR')
    expect(body.error?.fields?.[0]?.field).toBe('limit')
  })

  it('refuses a query parameter the endpoint does not accept', async () => {
    const response = await getNews(build('GET', '/api/v1/news?status=DRAFT'))
    const body = await read(response)

    expect(response.status).toBe(400)
    expect(body.error?.fields?.[0]?.field).toBe('status')
  })

  it('returns a story with its related items', async () => {
    const listing = await read(await getNews(build('GET', '/api/v1/news?limit=1')))
    const slug = (listing.data?.items as { slug: string }[])[0]?.slug ?? ''

    const response = await getStory(build('GET', `/api/v1/news/${slug}`), {
      params: Promise.resolve({ slug }),
    })
    const body = await read(response)

    expect(response.status).toBe(200)
    expect((body.data?.article as { slug: string }).slug).toBe(slug)
    expect(Array.isArray(body.data?.related)).toBe(true)
  })

  it('answers 404 for an unknown slug and for a traversal attempt alike', async () => {
    for (const slug of ['no-such-story', '../../etc/passwd', 'Robert%27); DROP TABLE news;--']) {
      const response = await getStory(build('GET', `/api/v1/news/${slug}`), {
        params: Promise.resolve({ slug }),
      })
      expect(response.status).toBe(404)
    }

    // The table is still there.
    const survived = await getNews(build('GET', '/api/v1/news'))
    expect(survived.status).toBe(200)
  })

  it('serves the reference endpoints', async () => {
    const categories = await read(await getCategories(build('GET', '/api/v1/categories')))
    const cities = await read(await getCities(build('GET', '/api/v1/cities')))

    expect((categories.data?.items as unknown[]).length).toBeGreaterThan(0)
    expect((cities.data?.items as unknown[]).length).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------- the envelope

describe('the envelope and its headers', () => {
  it('refuses the wrong method and says which one to use', async () => {
    const response = await getNews(build('POST', '/api/v1/news'))
    const body = await read(response)

    expect(response.status).toBe(405)
    expect(body.error?.code).toBe('METHOD_NOT_ALLOWED')
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('marks every response uncacheable and non-sniffable', async () => {
    const response = await getNews(build('GET', '/api/v1/news'))

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-request-id')).not.toBeNull()
  })

  it('carries a supplied request id through, but not an injected one', async () => {
    const clean = await getNews(
      build('GET', '/api/v1/news', { headers: { 'x-request-id': 'trace-abc-123' } }),
    )
    expect(clean.headers.get('x-request-id')).toBe('trace-abc-123')

    // A header value that is legal at the HTTP layer but is not a request id.
    // Echoing it would put caller-controlled punctuation into every log line
    // that quotes the id, and into the error envelope the caller is shown.
    const dirty = await getNews(
      build('GET', '/api/v1/news', {
        headers: { 'x-request-id': 'id with spaces; and="quotes"' },
      }),
    )
    const substituted = dirty.headers.get('x-request-id') ?? ''
    expect(substituted).not.toContain('quotes')
    expect(substituted).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects a body that is not JSON before trying to parse it', async () => {
    const request = new Request(`${ORIGIN}/api/v1/auth/register`, {
      method: 'POST',
      headers: { host: 'mynewsfactory.com', 'content-type': 'text/plain', origin: ORIGIN },
      body: 'email=a@b.co',
    })

    const response = await postRegister(request)
    expect(response.status).toBe(415)
  })

  it('reports a database outage as 503 rather than leaking the reason', async () => {
    const saved = shared.db
    shared.db = null
    try {
      const response = await getNews(build('GET', '/api/v1/news'))
      const body = await read(response)

      expect(response.status).toBe(503)
      expect(body.error?.code).toBe('SERVICE_UNAVAILABLE')
      expect(JSON.stringify(body)).not.toContain('DATABASE_URL')
    } finally {
      shared.db = saved
    }
  })
})

// ------------------------------------------------------------ registration

describe('registration', () => {
  it('creates an account with the reader role and nothing more', async () => {
    const email = freshEmail()
    const response = await postRegister(
      build('POST', '/api/v1/auth/register', {
        body: { email, password: PASSWORD, displayName: 'New Reader' },
      }),
    )

    expect(response.status).toBe(202)

    const { rows } = await db.query<{ id: string; status: string }>(
      'SELECT id, status FROM users WHERE email = $1',
      [email],
    )
    expect(rows[0]?.status).toBe('PENDING')

    const roles = await db.query<{ role_key: string }>(
      'SELECT role_key FROM user_roles WHERE user_id = $1',
      [rows[0]?.id],
    )
    expect(roles.rows.map((r) => r.role_key)).toEqual(['READER'])
  })

  /**
   * Account enumeration (§77). Registering an address that already exists must
   * be indistinguishable from registering a new one -- same status, same body.
   */
  it('does not reveal that an address is already registered', async () => {
    const email = freshEmail()
    const payload = { email, password: PASSWORD, displayName: 'First' }

    const first = await postRegister(build('POST', '/api/v1/auth/register', { body: payload }))
    const second = await postRegister(
      build('POST', '/api/v1/auth/register', {
        body: { email, password: PASSWORD, displayName: 'Impostor' },
      }),
    )

    expect(second.status).toBe(first.status)
    expect(await read(second)).toEqual(await read(first))

    // And the second attempt changed nothing.
    const { rows } = await db.query<{ count: string; display_name: string }>(
      'SELECT count(*)::text AS count, max(display_name) AS display_name FROM users WHERE email = $1',
      [email],
    )
    expect(rows[0]?.count).toBe('1')
    expect(rows[0]?.display_name).toBe('First')
  })

  /** Parameter tampering (§53): a role cannot be requested by sending one. */
  it('refuses a body that tries to grant itself a role', async () => {
    const response = await postRegister(
      build('POST', '/api/v1/auth/register', {
        body: {
          email: freshEmail(),
          password: PASSWORD,
          displayName: 'Climber',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
      }),
    )
    const body = await read(response)

    expect(response.status).toBe(400)
    expect(body.error?.fields?.map((f) => f.field).sort()).toEqual(['role', 'status'])
  })

  it('enforces the password floor', async () => {
    const response = await postRegister(
      build('POST', '/api/v1/auth/register', {
        body: { email: freshEmail(), password: 'short', displayName: 'Reader' },
      }),
    )
    expect(response.status).toBe(400)
  })
})

// ---------------------------------------------------------------- sign-in

describe('sign-in', () => {
  it('sets both cookies, hardened, and returns the account', async () => {
    const { email } = await createAccount()

    const response = await postLogin(
      build('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } }),
    )
    const body = await read(response)

    expect(response.status).toBe(200)
    expect((body.data?.user as { displayName: string }).displayName).toBe('Test Reader')

    const cookies = response.headers.getSetCookie()
    const access = cookies.find((c) => c.startsWith('__Host-mnf_at='))
    const refresh = cookies.find((c) => c.startsWith('__Host-mnf_rt='))

    expect(access).toContain('HttpOnly')
    expect(access).toContain('Secure')
    expect(access).toContain('SameSite=Lax')
    expect(refresh).toContain('SameSite=Strict')
    expect(access).not.toContain('Domain')
  })

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const { email } = await createAccount()

    const wrongPassword = await postLogin(
      build('POST', '/api/v1/auth/login', { body: { email, password: 'wrong-password-entirely' } }),
    )
    const unknownAddress = await postLogin(
      build('POST', '/api/v1/auth/login', {
        body: { email: 'nobody-at-all@example.com', password: 'wrong-password-entirely' },
      }),
    )

    expect(wrongPassword.status).toBe(401)
    expect(unknownAddress.status).toBe(401)

    const a = await read(wrongPassword)
    const b = await read(unknownAddress)
    expect(a.error?.code).toBe(b.error?.code)
    expect(a.error?.message).toBe(b.error?.message)
  })

  /**
   * Session fixation (§53). The caller presents a token of their own choosing
   * in the cookie; the session that results must not be that one.
   */
  it('never adopts a session identifier supplied by the caller', async () => {
    const { email } = await createAccount()
    const planted = 'attacker-chosen-session-token-value'

    const response = await postLogin(
      build('POST', '/api/v1/auth/login', {
        body: { email, password: PASSWORD },
        cookies: { '__Host-mnf_at': planted, '__Host-mnf_rt': planted },
      }),
    )

    const issued = cookieFrom(response, '__Host-mnf_at')
    expect(issued).not.toBe(planted)
    expect(await findSessionByAccessToken(db, planted)).toBeNull()
    expect(await findSessionByAccessToken(db, issued ?? '')).not.toBeNull()
  })

  it('locks an account after repeated failures', async () => {
    const { email } = await createAccount()
    const ip = freshIp()

    let last: Response | null = null
    for (let attempt = 0; attempt < 11; attempt += 1) {
      resetRateLimits() // isolate the account lockout from the endpoint limit
      last = await postLogin(
        build('POST', '/api/v1/auth/login', { body: { email, password: 'wrong-password' }, ip }),
      )
    }

    expect(last?.status).toBe(423)
    expect(last?.headers.get('retry-after')).not.toBeNull()

    // And the correct password does not get past the lock.
    const correct = await postLogin(
      build('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD }, ip }),
    )
    expect(correct.status).toBe(423)
  })

  it('rate limits the endpoint independently of any one account', async () => {
    const ip = freshIp()

    let limited: Response | null = null
    for (let attempt = 0; attempt < 12; attempt += 1) {
      limited = await postLogin(
        build('POST', '/api/v1/auth/login', {
          // A different address each time: the endpoint limit must bite even
          // though no single account has accumulated failures.
          body: { email: freshEmail(), password: 'wrong-password' },
          ip,
        }),
      )
    }

    expect(limited?.status).toBe(429)
    expect(limited?.headers.get('retry-after')).not.toBeNull()
  })
})

// ------------------------------------------------------------ the session

describe('the session endpoint', () => {
  it('refuses an anonymous caller', async () => {
    const response = await getSession(build('GET', '/api/v1/auth/session'))
    expect(response.status).toBe(401)
  })

  it('describes the caller, with permissions rather than role names', async () => {
    const session = await signIn()

    const response = await getSession(
      build('GET', '/api/v1/auth/session', { cookies: { '__Host-mnf_at': session.accessToken } }),
    )
    const body = await read(response)

    expect(response.status).toBe(200)
    expect((body.data?.user as { id: string }).id).toBe(session.userId)
    expect(body.data?.permissions).toContain('news.read')
  })

  /**
   * IDOR (§53). The endpoint takes no identifier, so an attempt to name
   * another user has nowhere to land -- the answer stays the caller's own.
   */
  it('ignores any attempt to name a different user', async () => {
    const mine = await signIn()
    const theirs = await createAccount()

    const response = await getSession(
      build('GET', `/api/v1/auth/session?userId=${theirs.userId}&id=${theirs.userId}`, {
        cookies: { '__Host-mnf_at': mine.accessToken },
      }),
    )
    const body = await read(response)

    expect(response.status).toBe(200)
    expect((body.data?.user as { id: string }).id).toBe(mine.userId)
    expect((body.data?.user as { email: string }).email).toBe(mine.email)
  })

  /** Token replay (§53): a revoked token is dead immediately, not at expiry. */
  it('refuses a token whose session has been revoked', async () => {
    const session = await signIn()
    const live = await findSessionByAccessToken(db, session.accessToken)
    if (live === null) throw new Error('the session should exist')

    await revokeSession(db, live.id, 'revoked by test')

    const response = await getSession(
      build('GET', '/api/v1/auth/session', { cookies: { '__Host-mnf_at': session.accessToken } }),
    )
    expect(response.status).toBe(401)
  })

  it('accepts a bearer token as well as a cookie', async () => {
    const session = await signIn()

    const response = await getSession(
      build('GET', '/api/v1/auth/session', { bearer: session.accessToken }),
    )
    expect(response.status).toBe(200)
  })

  /** §7: a privileged grant without a second factor is not a usable session. */
  it('refuses a privileged session that has not cleared MFA', async () => {
    const admin = await createAccount('SUPER_ADMIN')

    const login = await postLogin(
      build('POST', '/api/v1/auth/login', { body: { email: admin.email, password: PASSWORD } }),
    )
    const loginBody = await read(login)
    expect(loginBody.data?.mfaRequired).toBe(true)

    const token = cookieFrom(login, '__Host-mnf_at') ?? ''
    const response = await getSession(
      build('GET', '/api/v1/auth/session', { cookies: { '__Host-mnf_at': token } }),
    )
    const body = await read(response)

    expect(response.status).toBe(403)
    expect(body.error?.code).toBe('MFA_REQUIRED')
  })
})

// ------------------------------------------------------------------- CSRF

describe('CSRF', () => {
  it('refuses a cookie-authenticated mutation from another site', async () => {
    const session = await signIn()

    const response = await postLogout(
      build('POST', '/api/v1/auth/logout', {
        body: {},
        cookies: { '__Host-mnf_at': session.accessToken },
        origin: 'https://evil.example',
      }),
    )
    const body = await read(response)

    expect(response.status).toBe(403)
    expect(body.error?.code).toBe('CSRF_REJECTED')

    // The session survived the attempt.
    expect(await findSessionByAccessToken(db, session.accessToken)).not.toBeNull()
  })

  it('refuses a cookie-authenticated mutation carrying no Origin', async () => {
    const session = await signIn()

    const response = await postLogout(
      build('POST', '/api/v1/auth/logout', {
        body: {},
        cookies: { '__Host-mnf_at': session.accessToken },
        origin: null,
      }),
    )
    expect(response.status).toBe(403)
  })

  /**
   * A bearer token is attached by client code, never by the browser, so a
   * cross-site page cannot cause an authenticated request with one. Requiring
   * an Origin there would break non-browser clients for no gain.
   */
  it('allows a bearer-authenticated mutation with no Origin', async () => {
    const session = await signIn()

    const response = await postLogout(
      build('POST', '/api/v1/auth/logout', {
        body: {},
        bearer: session.accessToken,
        origin: null,
      }),
    )
    expect(response.status).toBe(200)
  })

  it('accepts the same-origin mutation and really ends the session', async () => {
    const session = await signIn()

    const response = await postLogout(
      build('POST', '/api/v1/auth/logout', {
        body: {},
        cookies: { '__Host-mnf_at': session.accessToken },
      }),
    )

    expect(response.status).toBe(200)
    expect(await findSessionByAccessToken(db, session.accessToken)).toBeNull()

    // Both cookies are expired, not merely forgotten by the client.
    const cleared = response.headers.getSetCookie()
    expect(cleared.every((c) => c.includes('Max-Age=0'))).toBe(true)
  })
})

// ---------------------------------------------------------------- refresh

describe('refresh', () => {
  it('rotates both tokens and keeps the session usable', async () => {
    const session = await signIn()

    const response = await postRefresh(
      build('POST', '/api/v1/auth/refresh', {
        cookies: { '__Host-mnf_rt': session.refreshToken },
        bearer: session.accessToken,
      }),
    )

    expect(response.status).toBe(200)

    const nextAccess = cookieFrom(response, '__Host-mnf_at')
    const nextRefresh = cookieFrom(response, '__Host-mnf_rt')

    expect(nextAccess).not.toBe(session.accessToken)
    expect(nextRefresh).not.toBe(session.refreshToken)

    // The new access token works and the old one no longer does.
    expect(await findSessionByAccessToken(db, nextAccess ?? '')).not.toBeNull()
    expect(await findSessionByAccessToken(db, session.accessToken)).toBeNull()
  })

  /**
   * Refresh reuse (§53, D-013). Presenting a consumed token revokes the
   * session rather than merely refusing the token, because a refusal would
   * leave a live session the attacker may also hold.
   */
  it('revokes the session when a consumed refresh token is presented again', async () => {
    const session = await signIn()

    const first = await postRefresh(
      build('POST', '/api/v1/auth/refresh', { cookies: { '__Host-mnf_rt': session.refreshToken } }),
    )
    expect(first.status).toBe(200)
    const rotated = cookieFrom(first, '__Host-mnf_at') ?? ''

    const replay = await postRefresh(
      build('POST', '/api/v1/auth/refresh', { cookies: { '__Host-mnf_rt': session.refreshToken } }),
    )
    expect(replay.status).toBe(401)

    // The whole session is gone, including the token the rotation just issued.
    expect(await findSessionByAccessToken(db, rotated)).toBeNull()
  })

  it('refuses a request with no refresh cookie', async () => {
    const response = await postRefresh(build('POST', '/api/v1/auth/refresh'))
    expect(response.status).toBe(401)
  })

  it('does not accept a refresh token offered in the body or the query string', async () => {
    const session = await signIn()

    const inBody = await postRefresh(
      build('POST', '/api/v1/auth/refresh', { body: { refreshToken: session.refreshToken } }),
    )
    expect(inBody.status).toBe(401)

    const inQuery = await postRefresh(
      build('POST', `/api/v1/auth/refresh?refreshToken=${session.refreshToken}`),
    )
    expect(inQuery.status).toBe(401)

    // Still usable from the cookie, so the refusals were about placement.
    const proper = await postRefresh(
      build('POST', '/api/v1/auth/refresh', { cookies: { '__Host-mnf_rt': session.refreshToken } }),
    )
    expect(proper.status).toBe(200)
  })
})
