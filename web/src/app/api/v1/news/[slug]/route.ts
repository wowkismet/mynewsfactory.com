/**
 * GET /api/v1/news/[slug] -- one published story (§10, §13).
 *
 * The slug is validated against the same pattern the database constrains the
 * column with, so a path that could never match a row is refused before it
 * becomes a query. That is cheap, but it is not the injection defence: the
 * defence is that `findArticle` parameterises the value, which would hold even
 * if this check were removed.
 *
 * A draft and a slug that was never used both return 404. Distinguishing them
 * would confirm the existence of unpublished work to anyone who can guess a
 * headline (§77).
 */

import { findArticle, findRelated } from '@/lib/db/repository'
import { ApiProblem } from '@/lib/api/problem'
import { route } from '@/lib/api/route'

export const GET = route({
  method: 'GET',
  rateLimit: { bucket: 'news.read', limit: 240, windowSeconds: 60 },
  handle: async ({ ctx, params }) => {
    const requested = params.slug ?? ''

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(requested)) {
      throw new ApiProblem('NOT_FOUND', 'No such story.')
    }

    const article = await findArticle(ctx.db, requested)
    if (article === undefined) {
      throw new ApiProblem('NOT_FOUND', 'No such story.')
    }

    const related = await findRelated(ctx.db, article, 4)

    return { data: { article, related } }
  },
})
