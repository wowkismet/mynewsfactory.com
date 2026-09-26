/**
 * The gate every role surface stands behind (§6, §7).
 *
 * A page guard is not the authorization control -- the API pipeline is, and it
 * re-checks everything on each request, because a page that renders a button
 * has decided nothing. What this does is decide what a person is shown, and
 * make the four outcomes uniform: not signed in, signed in but not permitted,
 * permitted but the second factor is outstanding, or through.
 *
 * Uniform matters. A surface that redirects where another renders a refusal is
 * how someone maps the permission model by watching which doors behave
 * differently.
 */

import { redirect } from 'next/navigation'
import type { PageViewer } from './session-server'
import { can } from './rbac'
import { currentViewer } from './session-server'

export type GuardOutcome =
  | { state: 'ALLOWED'; viewer: PageViewer }
  | { state: 'FORBIDDEN'; viewer: PageViewer }
  | { state: 'MFA_REQUIRED'; viewer: PageViewer }

/**
 * Resolves the viewer and checks one permission.
 *
 * Redirects an anonymous visitor to sign in, carrying where they were going.
 * Everything else is returned rather than redirected, so the page can say what
 * happened: silently bouncing someone who is signed in but lacks a permission
 * reads as a broken link, not a refusal.
 */
export async function guard(permission: string, path: string): Promise<GuardOutcome> {
  const viewer = await currentViewer()

  if (viewer === null) {
    redirect(`/login?next=${encodeURIComponent(path)}`)
  }

  if (!can(viewer.grants, permission)) {
    return { state: 'FORBIDDEN', viewer }
  }

  // Checked after the permission, deliberately. Telling someone to set up a
  // second factor for a surface they could never reach anyway would confirm
  // that the surface exists and that they are close to it.
  if (viewer.mfaRequired && !viewer.mfaSatisfied) {
    return { state: 'MFA_REQUIRED', viewer }
  }

  return { state: 'ALLOWED', viewer }
}
