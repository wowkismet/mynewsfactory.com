/**
 * The one shared body of an editorial transition route (§12, §43, §77).
 *
 * Publish, unpublish and review differ in exactly two things: the permission
 * the pipeline checks, and which statuses the caller may ask for. Everything
 * else -- the slug check, the audit actor, the outcome mapping -- is identical,
 * and identical code written three times is how three endpoints end up with
 * two behaviours.
 */

import type { NewsStatus, TransitionOutcome } from '../db/newsroom'
import type { HandlerInput } from './route'
import type { Shape } from './validate'
import { ApiProblem } from './problem'
import { transitionStory } from '../db/newsroom'

/** The slug pattern the column is constrained with, checked before the query. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * The role recorded on the audit entry.
 *
 * An account can hold several roles; the one worth recording is the role that
 * carried the permission being exercised, not whichever happens to sort first.
 */
export function actingRole(
  grants: readonly { role: string; permission: string }[],
  permission: string,
): string | null {
  return grants.find((grant) => grant.permission === permission)?.role ?? null
}

export interface TransitionRequest {
  input: HandlerInput<Shape, Shape>
  to: NewsStatus
  permission: string
}

export async function applyTransition({
  input,
  to,
  permission,
}: TransitionRequest): Promise<{ data: { slug: string; from: NewsStatus; to: NewsStatus } }> {
  const slug = input.params.slug ?? ''
  if (!SLUG.test(slug)) throw new ApiProblem('NOT_FOUND', 'No such story.')

  const actor = input.actor
  // `auth: 'required'` has already run; this narrows the type rather than
  // re-checking a condition the pipeline guarantees.
  if (actor === null) throw new ApiProblem('UNAUTHENTICATED', 'Sign in to continue.')

  const note = typeof input.body.note === 'string' ? input.body.note : ''

  const outcome: TransitionOutcome = await transitionStory(input.ctx.db, {
    slug,
    to,
    actorId: actor.userId,
    actorRole: actingRole(actor.grants, permission),
    note,
    ip: input.ctx.ip,
    requestId: input.ctx.requestId,
  })

  if (outcome.status === 'NOT_FOUND') {
    throw new ApiProblem('NOT_FOUND', 'No such story.')
  }

  if (outcome.status === 'NO_CHANGE') {
    // 409, not 200: the caller asked for a change and none happened, and a
    // desk that reports success either way will show a story as moved when it
    // did not move.
    throw new ApiProblem('CONFLICT', `That story is already ${outcome.current.toLowerCase()}.`)
  }

  return { data: { slug, from: outcome.from, to: outcome.to } }
}
