/**
 * Unit tests for the request pipeline's parts (§69, §77, §83).
 *
 * These cover the pieces that need no database: validation, the rate limiter,
 * cookie construction and the origin check. The parts that need one -- the
 * whole pipeline, and the §53 attack cases -- are in
 * `src/app/api/v1/routes.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { assertSameOrigin, isMutating } from './csrf'
import { ACCESS_COOKIE, clearCookie, readCookie, serialiseCookie } from './cookies'
import { ApiProblem, errorBody, statusFor } from './problem'
import { consume, limiterIdentity, resetRateLimits } from './ratelimit'
import { boolean, email, integer, optional, parse, slug, string } from './validate'

describe('validation', () => {
  const shape = {
    email: email(),
    password: string({ min: 12, max: 100 }),
    nickname: optional(string({ max: 20, trim: true })),
  }

  it('accepts a well-formed body and normalises the address', () => {
    const result = parse(shape, {
      email: '  Reader@Example.COM ',
      password: 'a-long-enough-password',
      nickname: '  ada  ',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.email).toBe('reader@example.com')
    expect(result.value.nickname).toBe('ada')
  })

  it('reports every problem at once rather than one per round trip', () => {
    const result = parse(shape, { email: 'not-an-address', password: 'short' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.field).sort()).toEqual(['email', 'password'])
  })

  /**
   * The parameter-tampering defence (§53). A body carrying a field the
   * endpoint does not accept is refused, not quietly dropped -- so an attempt
   * to set `role` alongside the fields a form sends becomes a 400 an operator
   * can see, rather than a silent no-op nobody records.
   */
  it('refuses unknown fields instead of ignoring them', () => {
    const result = parse(shape, {
      email: 'reader@example.com',
      password: 'a-long-enough-password',
      role: 'SUPER_ADMIN',
      isAdmin: true,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.field).sort()).toEqual(['isAdmin', 'role'])
  })

  it('treats an absent optional field as undefined and a missing required one as an error', () => {
    const ok = parse(shape, { email: 'a@b.co', password: 'a-long-enough-password' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.nickname).toBeUndefined()

    const missing = parse(shape, { email: 'a@b.co' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problems[0]?.field).toBe('password')
  })

  it('rejects a non-object body', () => {
    expect(parse(shape, 'a string').ok).toBe(false)
    expect(parse(shape, ['an', 'array']).ok).toBe(false)
    expect(parse(shape, null).ok).toBe(false)
  })

  it('measures length in bytes, so a multi-byte string cannot slip past a limit', () => {
    // Ten emoji are ten characters and forty bytes.
    const field = string({ max: 20 })
    expect(field.check('🙂'.repeat(10)).ok).toBe(false)
    expect(field.check('12345678901234567890').ok).toBe(true)
  })

  it('accepts only the slug shape the database constrains columns to', () => {
    const field = slug()
    expect(field.check('mumbai-floods-2026').ok).toBe(true)
    expect(field.check('Mumbai_Floods').ok).toBe(false)
    expect(field.check('../../etc/passwd').ok).toBe(false)
    expect(field.check('trailing-').ok).toBe(false)
  })

  it('parses the strings a query parameter actually carries', () => {
    expect(integer({ min: 1, max: 50 }).check('20')).toEqual({ ok: true, value: 20 })
    expect(integer({ min: 1, max: 50 }).check('500').ok).toBe(false)
    expect(integer({ min: 1, max: 50 }).check('1.5').ok).toBe(false)
    expect(boolean().check('true')).toEqual({ ok: true, value: true })
    expect(boolean().check('yes').ok).toBe(false)
  })
})

describe('rate limiting', () => {
  beforeEach(() => {
    resetRateLimits()
  })

  const rule = { bucket: 'test', limit: 3, windowSeconds: 60 }

  it('permits up to the limit and refuses beyond it', () => {
    const results = [1, 2, 3, 4].map(() => consume(rule, 'ip:198.51.100.7'))

    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true)
    expect(results[3]?.allowed).toBe(false)
    expect(results[3]?.resetSeconds).toBeGreaterThan(0)
  })

  it('counts each identity separately', () => {
    consume(rule, 'ip:a')
    consume(rule, 'ip:a')
    consume(rule, 'ip:a')

    expect(consume(rule, 'ip:a').allowed).toBe(false)
    expect(consume(rule, 'ip:b').allowed).toBe(true)
  })

  it('counts each bucket separately, so one endpoint cannot exhaust another', () => {
    for (let i = 0; i < 4; i += 1) consume({ ...rule, bucket: 'login' }, 'ip:a')
    expect(consume({ ...rule, bucket: 'search' }, 'ip:a').allowed).toBe(true)
  })

  it('opens a fresh window once the old one has passed', () => {
    const start = 1_000_000
    for (let i = 0; i < 4; i += 1) consume(rule, 'ip:a', start)
    expect(consume(rule, 'ip:a', start).allowed).toBe(false)
    expect(consume(rule, 'ip:a', start + 61_000).allowed).toBe(true)
  })

  it('attributes to the user when there is one, and the address otherwise', () => {
    expect(limiterIdentity('user-1', '203.0.113.1')).toBe('user:user-1')
    expect(limiterIdentity(null, '203.0.113.1')).toBe('ip:203.0.113.1')
    expect(limiterIdentity(null, null)).toBe('ip:unknown')
  })
})

describe('cookies', () => {
  it('sets every attribute the __Host- prefix requires', () => {
    const cookie = serialiseCookie({
      name: ACCESS_COOKIE,
      value: 'token-value',
      maxAgeSeconds: 900,
      sameSite: 'Lax',
    })

    expect(cookie).toContain('__Host-mnf_at=token-value')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    // A Domain attribute would void the __Host- prefix entirely.
    expect(cookie).not.toContain('Domain')
  })

  it('expires a cookie by setting Max-Age to zero', () => {
    expect(clearCookie(ACCESS_COOKIE)).toContain('Max-Age=0')
  })

  it('reads one cookie out of a header carrying several', () => {
    const header = 'other=1; __Host-mnf_at=abc123; another=2'
    expect(readCookie(header, ACCESS_COOKIE)).toBe('abc123')
    expect(readCookie(header, '__Host-mnf_rt')).toBeNull()
    expect(readCookie(null, ACCESS_COOKIE)).toBeNull()
  })

  it('takes the first of a duplicated name, as a browser does when sending', () => {
    expect(readCookie('__Host-mnf_at=real; __Host-mnf_at=shadow', ACCESS_COOKIE)).toBe('real')
  })
})

describe('origin check', () => {
  const build = (headers: Record<string, string>) =>
    new Request('https://mynewsfactory.com/api/v1/auth/logout', { method: 'POST', headers })

  it('knows which methods change state', () => {
    expect(isMutating('POST')).toBe(true)
    expect(isMutating('delete')).toBe(true)
    expect(isMutating('GET')).toBe(false)
  })

  it('accepts a request from this site', () => {
    const request = build({
      origin: 'https://mynewsfactory.com',
      host: 'mynewsfactory.com',
      'x-forwarded-proto': 'https',
    })
    expect(() => {
      assertSameOrigin(request)
    }).not.toThrow()
  })

  it('refuses a request from another site', () => {
    const request = build({
      origin: 'https://evil.example',
      host: 'mynewsfactory.com',
      'x-forwarded-proto': 'https',
    })
    expect(() => {
      assertSameOrigin(request)
    }).toThrow(ApiProblem)
  })

  it('refuses a cookie-authenticated mutation that carries no Origin at all', () => {
    const request = build({ host: 'mynewsfactory.com' })
    expect(() => {
      assertSameOrigin(request)
    }).toThrow(/must be sent from the site/)
  })

  it('is not fooled by a lookalike host', () => {
    const request = build({
      origin: 'https://mynewsfactory.com.evil.example',
      host: 'mynewsfactory.com',
      'x-forwarded-proto': 'https',
    })
    expect(() => {
      assertSameOrigin(request)
    }).toThrow(ApiProblem)
  })
})

describe('error envelope', () => {
  it('has the shape §83 specifies', () => {
    const body = errorBody(new ApiProblem('VALIDATION_ERROR', 'Some fields need attention.'), 'req-1')

    expect(body).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Some fields need attention.', requestId: 'req-1' },
    })
  })

  it('never serialises the internal detail', () => {
    const problem = new ApiProblem('INTERNAL_ERROR', 'Something went wrong on our side.', {
      internal: 'relation "users" does not exist',
    })

    expect(JSON.stringify(errorBody(problem, 'req-2'))).not.toContain('relation')
  })

  it('includes field detail only where a caller must know what to fix', () => {
    const withFields = errorBody(
      new ApiProblem('VALIDATION_ERROR', 'x', { fields: [{ field: 'email', message: 'is required' }] }),
      'req-3',
    )
    expect(withFields.error.fields).toHaveLength(1)

    expect(errorBody(new ApiProblem('FORBIDDEN', 'x'), 'req-4').error.fields).toBeUndefined()
  })

  it('maps each code to its status', () => {
    expect(statusFor('UNAUTHENTICATED')).toBe(401)
    expect(statusFor('FORBIDDEN')).toBe(403)
    expect(statusFor('RATE_LIMITED')).toBe(429)
    expect(statusFor('SERVICE_UNAVAILABLE')).toBe(503)
  })
})
