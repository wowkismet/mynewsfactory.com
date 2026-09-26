/**
 * Tests for the page guard (§6, §7).
 *
 * The guard is not the authorization control -- the API pipeline is, and the
 * route tests cover it. What is worth isolating here is the ordering, because
 * it is the part that is easy to get subtly wrong: checking the second factor
 * before the permission would tell someone who may never reach a surface that
 * the surface exists and that they are one step away from it.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Grant } from '../db/identity'
import type * as SessionServer from './session-server'
import type { PageViewer } from './session-server'

const shared = vi.hoisted(() => ({
  viewer: null as PageViewer | null,
  redirected: null as string | null,
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    shared.redirected = to
    // The real one throws to abort rendering; a guard that carried on after a
    // redirect would be a bug this mock has to be able to catch.
    throw new Error(`REDIRECT ${to}`)
  },
}))

vi.mock('./session-server', async (original) => ({
  ...(await original<typeof SessionServer>()),
  currentViewer: () => Promise.resolve(shared.viewer),
}))

const { guard } = await import('./guard')

function grant(permission: string, privileged = false): Grant {
  return { role: 'TEST', permission, scope: 'GLOBAL', countryCode: null, cityId: null, privileged }
}

function viewer(grants: Grant[], mfaSatisfied = false): PageViewer {
  return {
    userId: '00000000-0000-0000-0000-000000000001',
    displayName: 'Test Person',
    email: 'test@example.com',
    status: 'ACTIVE',
    grants,
    permissions: grants.map((g) => g.permission),
    mfaRequired: grants.some((g) => g.privileged),
    mfaSatisfied,
  }
}

describe('guard', () => {
  it('sends an anonymous visitor to sign in, carrying where they were going', async () => {
    shared.viewer = null
    shared.redirected = null

    await expect(guard('news.review', '/editorial')).rejects.toThrow('REDIRECT')
    expect(shared.redirected).toBe('/login?next=%2Feditorial')
  })

  it('encodes the destination rather than pasting it into the query', async () => {
    shared.viewer = null
    shared.redirected = null

    await expect(guard('news.review', '/search?q=a&b=c')).rejects.toThrow('REDIRECT')
    expect(shared.redirected).toBe('/login?next=%2Fsearch%3Fq%3Da%26b%3Dc')
  })

  it('refuses rather than redirects when the permission is missing', async () => {
    shared.viewer = viewer([grant('news.read')])
    const outcome = await guard('news.review', '/editorial')
    expect(outcome.state).toBe('FORBIDDEN')
  })

  it('asks for a second factor once the permission is held', async () => {
    shared.viewer = viewer([grant('news.review', true)])
    const outcome = await guard('news.review', '/editorial')
    expect(outcome.state).toBe('MFA_REQUIRED')
  })

  /**
   * The ordering rule. Someone who lacks the permission is told they lack it,
   * never told to set up a second factor -- the second answer confirms the
   * surface is there and that they are close to reaching it.
   */
  it('reports the missing permission before the missing factor', async () => {
    shared.viewer = viewer([grant('finance.read', true)])
    const outcome = await guard('news.review', '/editorial')
    expect(outcome.state).toBe('FORBIDDEN')
  })

  it('lets a privileged viewer through once the factor is satisfied', async () => {
    shared.viewer = viewer([grant('news.review', true)], true)
    const outcome = await guard('news.review', '/editorial')
    expect(outcome.state).toBe('ALLOWED')
  })

  it('lets an unprivileged viewer through with no factor at all', async () => {
    shared.viewer = viewer([grant('news.submit')])
    const outcome = await guard('news.submit', '/desk')
    expect(outcome.state).toBe('ALLOWED')
  })

  it('does not accept a grant scoped narrower than the request', async () => {
    shared.viewer = viewer([
      { role: 'EDITOR', permission: 'news.review', scope: 'CITY', countryCode: null, cityId: 'abc', privileged: true },
    ])
    // An unscoped page request is a request to act everywhere, which a city
    // grant does not authorise.
    const outcome = await guard('news.review', '/editorial')
    expect(outcome.state).toBe('FORBIDDEN')
  })
})
