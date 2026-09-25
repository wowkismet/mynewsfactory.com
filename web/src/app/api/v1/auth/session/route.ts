/**
 * GET /api/v1/auth/session -- who the caller is (§5, §77).
 *
 * The IDOR defence here is that there is nothing to tamper with. The endpoint
 * takes no identifier: the user it describes is the one the presented token
 * resolves to, and no input can redirect it. An endpoint shaped
 * `/users/{id}` has to check ownership on every path; this one has no path on
 * which ownership could be wrong.
 *
 * It returns permissions rather than roles. A client rendering a menu needs to
 * know what is permitted, and telling it the role name invites it to decide by
 * role -- which is the check §6 says must never be the real one. Sending
 * verbs keeps the client's view of authorization the same shape as the
 * server's, while the server remains the only place it is enforced.
 */

import { route } from '@/lib/api/route'

export const GET = route({
  method: 'GET',
  auth: 'required',
  handle: async ({ ctx, actor }) => {
    if (actor === null) throw new Error('unreachable: session without an actor')

    const { rows } = await ctx.db.query<{ display_name: string; email: string; status: string }>(
      'SELECT display_name, email, status FROM users WHERE id = $1',
      [actor.userId],
    )

    const user = rows[0]
    if (user === undefined) throw new Error('session resolved to a user that does not exist')

    return {
      data: {
        user: {
          id: actor.userId,
          displayName: user.display_name,
          email: user.email,
          status: user.status,
        },
        // Deduplicated: the same verb can arrive from two roles, and a client
        // does not care which one carried it.
        permissions: [...new Set(actor.grants.map((grant) => grant.permission))].sort(),
        scopes: actor.grants.map((grant) => ({
          permission: grant.permission,
          scope: grant.scope,
          countryCode: grant.countryCode,
          cityId: grant.cityId,
        })),
        mfa: { required: actor.mfaRequired, satisfied: actor.mfaSatisfied },
      },
    }
  },
})
