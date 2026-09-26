/**
 * Reading the session inside a server component (§5, §6).
 *
 * The API resolves the caller from a `Request`. A page has no Request -- it
 * has the cookie store -- so this is the same resolution expressed for the
 * rendering path. It deliberately shares `findSessionByAccessToken` and
 * `resolveGrants` with the API rather than reimplementing them: two places
 * deciding who someone is, is one place too many.
 *
 * Nothing here is an authorization decision. It answers "who is this" and
 * "what may they do"; a page that acts on the answer asks `can` from
 * `auth/rbac`, and any state change goes through the API, where the pipeline
 * enforces the rest.
 */

import { cookies } from 'next/headers'
import type { Grant } from '../db/identity'
import { findSessionByAccessToken, resolveGrants } from '../db/identity'
import { requiresMfa } from './rbac'
import { ACCESS_COOKIE } from '../api/cookies'
import { db } from '../db/pool'

export interface PageViewer {
  userId: string
  displayName: string
  email: string
  status: string
  grants: Grant[]
  permissions: string[]
  mfaRequired: boolean
  mfaSatisfied: boolean
}

/**
 * The signed-in viewer, or null.
 *
 * Returns null rather than throwing when the database is unreachable. A
 * missing database means nobody is signed in as far as the page is concerned,
 * and the portal still renders its public content -- which is the behaviour
 * that keeps a news site readable during an outage instead of returning 500
 * to every reader.
 */
export async function currentViewer(): Promise<PageViewer | null> {
  let token: string | undefined
  try {
    token = (await cookies()).get(ACCESS_COOKIE)?.value
  } catch {
    return null
  }

  if (token === undefined || token === '') return null

  try {
    const handle = db()
    const session = await findSessionByAccessToken(handle, token)
    if (session === null) return null

    const { rows } = await handle.query<{
      display_name: string
      email: string
      status: string
    }>('SELECT display_name, email, status FROM users WHERE id = $1', [session.userId])

    const row = rows[0]
    if (row === undefined) return null

    const grants = await resolveGrants(handle, session.userId)

    return {
      userId: session.userId,
      displayName: row.display_name,
      email: row.email,
      status: row.status,
      grants,
      permissions: [...new Set(grants.map((grant) => grant.permission))].sort(),
      mfaRequired: requiresMfa(grants),
      mfaSatisfied: session.mfaSatisfied,
    }
  } catch {
    // No database, or it is down. The reader is anonymous; the page renders.
    return null
  }
}

/**
 * Which dashboard a viewer belongs on.
 *
 * Decided from permissions, not role names, for the reason §6 gives: adding a
 * role later must not mean hunting for every place a role was named. The order
 * is most-privileged first, because someone holding several roles should land
 * on the most capable surface rather than the first one that matched.
 */
export function homeSurface(permissions: string[]): {
  key: 'admin' | 'editor' | 'reporter' | 'advertiser' | 'reader'
  label: string
} {
  if (permissions.includes('users.suspend') || permissions.includes('roles.grant')) {
    return { key: 'admin', label: 'Admin command centre' }
  }
  if (permissions.includes('news.review') || permissions.includes('news.publish')) {
    return { key: 'editor', label: 'Editorial desk' }
  }
  if (permissions.includes('news.submit')) {
    return { key: 'reporter', label: 'Reporter desk' }
  }
  if (permissions.includes('ads.manage_own')) {
    return { key: 'advertiser', label: 'Advertiser console' }
  }
  return { key: 'reader', label: 'My news' }
}
