/** Domain types for the public portal. Mirrors the Phase 2 database schema. */

export type ReporterTier =
  | 'Citizen Contributor'
  | 'Verified Reporter'
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Senior'
  | 'Elite'
  | 'Global Correspondent'

export interface Reporter {
  id: string
  slug: string
  name: string
  tier: ReporterTier
  verified: boolean
  city: string
  languages: string[]
}

export interface Category {
  slug: string
  name: string
  blurb: string
}

export interface City {
  slug: string
  name: string
  /** Display label for the city newsroom, e.g. "My Mumbai" (Part LX). */
  newsroom: string
  country: string
  state: string
}

/**
 * An article without its body.
 *
 * Listings render only this. Feeds must not carry body copy they will not
 * display: `getArticles()` returning every column of every row is exactly the
 * unbounded read flagged in docs/ARCHITECTURE_AUDIT.md section 8.
 */
export interface ArticleSummary {
  slug: string
  kicker: string
  title: string
  standfirst: string
  categorySlug: string
  citySlug: string | null
  reporterSlug: string
  publishedAt: string
  readMinutes: number
  views: number
  /** Breaking stories surface in the ticker and lead slot. */
  breaking?: boolean
  /** Live event hubs aggregate multiple sources (Part XLI). */
  live?: boolean
  sourceCount?: number
}

/** A full article, as the article page renders it. */
export interface Article extends ArticleSummary {
  /** Body paragraphs as plain text. Never rendered as raw HTML. */
  body: string[]
}

/**
 * One page of a keyset-paginated listing.
 *
 * `nextCursor` is opaque to the caller and is passed back verbatim to fetch the
 * following page. Offset pagination is not offered: it degrades as the table
 * grows and skips or repeats rows when the underlying data changes between
 * requests, which on a news feed it constantly does.
 */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}
