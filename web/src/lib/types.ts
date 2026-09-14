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

export interface Article {
  slug: string
  kicker: string
  title: string
  standfirst: string
  /** Body paragraphs as plain text. Never rendered as raw HTML. */
  body: string[]
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
