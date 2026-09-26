/**
 * GET /api/v1/news -- the published listing (§10, §45).
 *
 * Public, and deliberately so. The portal is a news site; requiring a session
 * to read a published story would be a security control protecting nothing,
 * since the same story is served to anyone by the web pages.
 *
 * Only PUBLISHED rows are reachable. That is not enforced here -- it is
 * enforced by `listPublished`, whose every statement carries the predicate, so
 * a route that forgot to filter could not leak a draft even if it tried.
 *
 * Pagination is by opaque cursor. An offset over a table that grows at the
 * head reads duplicates and skips rows; a cursor on `(published_at, id)` does
 * not, and it does not invite a caller to request page 50,000.
 */

import { MAX_PAGE_SIZE } from '@/lib/db/cursor'
import { listPublished } from '@/lib/db/repository'
import { route } from '@/lib/api/route'
import { boolean, integer, optional, slug, string } from '@/lib/api/validate'

const query = {
  limit: optional(integer({ min: 1, max: MAX_PAGE_SIZE })),
  // Opaque to the caller and validated by `decodeCursor`, which returns null
  // for anything malformed rather than throwing -- a tampered cursor restarts
  // the listing instead of erroring.
  cursor: optional(string({ max: 256 })),
  category: optional(slug()),
  city: optional(slug()),
  urgent: optional(boolean()),
}

export const GET = route({
  method: 'GET',
  query,
  rateLimit: { bucket: 'news.list', limit: 120, windowSeconds: 60 },
  handle: async ({ ctx, query: q }) => {
    const page = await listPublished(ctx.db, {
      limit: q.limit,
      cursor: q.cursor,
      categorySlug: q.category,
      citySlug: q.city,
      urgentOnly: q.urgent,
    })

    return { data: { items: page.items, nextCursor: page.nextCursor } }
  },
})
