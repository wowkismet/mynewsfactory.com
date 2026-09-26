/**
 * Editorial queries (§10, §45).
 *
 * Every statement is parameterised. No value reaching these functions is ever
 * concatenated into SQL, including slugs from route parameters and cursors from
 * the client.
 *
 * Listings are keyset-paginated on `(published_at DESC, id DESC)`, which is the
 * order of the partial indexes in migration 0001. Only PUBLISHED rows are
 * visible here: an unpublished story is not merely hidden by the UI, it is
 * excluded by every query in this module (§59).
 */

import type {
  Article,
  ArticleSummary,
  Category,
  City,
  Page,
  Reporter,
  ReporterTier,
} from '../types'
import type { Db } from './client'
import { clampLimit, decodeCursor, encodeCursor } from './cursor'

// ------------------------------------------------------------------- rows

interface CategoryRow {
  slug: string
  name: string
  blurb: string
}

interface CityRow {
  slug: string
  name: string
  newsroom_label: string
  country_name: string
  state_name: string | null
}

interface ReporterRow {
  id: string
  slug: string
  name: string
  tier: ReporterTier
  verified: boolean
  city_name: string | null
  languages: string[] | null
}

interface SummaryRow {
  id: string
  slug: string
  kicker: string
  title: string
  standfirst: string
  category_slug: string
  city_slug: string | null
  reporter_slug: string
  published_at: Date | string
  read_minutes: number
  view_count: string | number
  breaking: boolean
  live: boolean
  source_count: number
}

interface ArticleRow extends SummaryRow {
  body: string[]
}

// --------------------------------------------------------------- mapping

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toSummary(row: SummaryRow): ArticleSummary {
  return {
    slug: row.slug,
    kicker: row.kicker,
    title: row.title,
    standfirst: row.standfirst,
    categorySlug: row.category_slug,
    citySlug: row.city_slug,
    reporterSlug: row.reporter_slug,
    publishedAt: toIso(row.published_at),
    readMinutes: row.read_minutes,
    // bigint arrives as a string from node-postgres, because it does not fit a
    // JavaScript number in the general case. View counts do fit, so converting
    // here is safe -- but the conversion is explicit rather than implicit.
    views: typeof row.view_count === 'string' ? Number(row.view_count) : row.view_count,
    breaking: row.breaking,
    live: row.live,
    sourceCount: row.source_count,
  }
}

function toArticle(row: ArticleRow): Article {
  return { ...toSummary(row), body: row.body }
}

// ------------------------------------------------------------- reference

export async function listCategories(db: Db): Promise<Category[]> {
  const { rows } = await db.query<CategoryRow>(
    'SELECT slug, name, blurb FROM categories ORDER BY sort_order, name',
  )
  return rows
}

export async function findCategory(db: Db, slug: string): Promise<Category | undefined> {
  const { rows } = await db.query<CategoryRow>(
    'SELECT slug, name, blurb FROM categories WHERE slug = $1',
    [slug],
  )
  return rows[0]
}

const CITY_COLUMNS = `
  SELECT c.slug,
         c.name,
         c.newsroom_label,
         co.name AS country_name,
         s.name  AS state_name
    FROM cities c
    JOIN countries co ON co.code = c.country_code
    LEFT JOIN states s ON s.id = c.state_id
`

function toCity(row: CityRow): City {
  return {
    slug: row.slug,
    name: row.name,
    newsroom: row.newsroom_label,
    country: row.country_name,
    state: row.state_name ?? '',
  }
}

export async function listCities(db: Db): Promise<City[]> {
  const { rows } = await db.query<CityRow>(`${CITY_COLUMNS} ORDER BY c.name`)
  return rows.map(toCity)
}

export async function findCity(db: Db, slug: string): Promise<City | undefined> {
  const { rows } = await db.query<CityRow>(`${CITY_COLUMNS} WHERE c.slug = $1`, [slug])
  const row = rows[0]
  return row === undefined ? undefined : toCity(row)
}

export async function findReporter(db: Db, slug: string): Promise<Reporter | undefined> {
  const { rows } = await db.query<ReporterRow>(
    `SELECT r.id,
            r.slug,
            r.name,
            r.tier,
            r.verified,
            c.name AS city_name,
            array_remove(array_agg(lang.name ORDER BY lang.name), NULL) AS languages
       FROM reporters r
       LEFT JOIN cities c ON c.id = r.city_id
       LEFT JOIN reporter_languages rl ON rl.reporter_id = r.id
       LEFT JOIN languages lang ON lang.code = rl.language_code
      WHERE r.slug = $1
      GROUP BY r.id, c.name`,
    [slug],
  )

  const row = rows[0]
  if (row === undefined) return undefined

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tier: row.tier,
    verified: row.verified,
    city: row.city_name ?? '',
    languages: row.languages ?? [],
  }
}

// -------------------------------------------------------------- listings

const SUMMARY_COLUMNS = `
  SELECT n.id,
         n.slug,
         n.kicker,
         n.title,
         n.standfirst,
         cat.slug AS category_slug,
         city.slug AS city_slug,
         rep.slug AS reporter_slug,
         n.published_at,
         n.read_minutes,
         n.view_count,
         n.breaking,
         n.live,
         n.source_count
    FROM news n
    JOIN categories cat ON cat.id = n.category_id
    JOIN reporters  rep ON rep.id = n.reporter_id
    LEFT JOIN cities city ON city.id = n.city_id
`

export interface ListOptions {
  limit?: number
  cursor?: string | null
  categorySlug?: string
  citySlug?: string
  /** Restrict to the ticker: breaking stories and live event hubs. */
  urgentOnly?: boolean
}

/**
 * One page of published stories, newest first.
 *
 * Fetches `limit + 1` rows to decide whether a further page exists without a
 * second count query -- a count over a growing table is the other half of the
 * problem keyset pagination is solving.
 */
export async function listPublished(db: Db, options: ListOptions = {}): Promise<Page<ArticleSummary>> {
  const limit = clampLimit(options.limit)
  const cursor = decodeCursor(options.cursor)

  const conditions = ["n.status = 'PUBLISHED'"]
  const params: unknown[] = []

  if (options.categorySlug !== undefined) {
    params.push(options.categorySlug)
    conditions.push(`cat.slug = $${params.length.toString()}`)
  }

  if (options.citySlug !== undefined) {
    params.push(options.citySlug)
    conditions.push(`city.slug = $${params.length.toString()}`)
  }

  if (options.urgentOnly === true) {
    conditions.push('(n.breaking OR n.live)')
  }

  if (cursor !== null) {
    // Row-value comparison, which PostgreSQL can satisfy directly from the
    // (published_at DESC, id DESC) index rather than by filtering after a scan.
    params.push(cursor.publishedAt, cursor.id)
    conditions.push(
      `(n.published_at, n.id) < ($${(params.length - 1).toString()}::timestamptz, $${params.length.toString()}::uuid)`,
    )
  }

  params.push(limit + 1)

  const { rows } = await db.query<SummaryRow>(
    `${SUMMARY_COLUMNS}
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.published_at DESC, n.id DESC
      LIMIT $${params.length.toString()}`,
    params,
  )

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page.at(-1)

  return {
    items: page.map(toSummary),
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor({ publishedAt: toIso(last.published_at), id: last.id })
        : null,
  }
}

export async function findArticle(db: Db, slug: string): Promise<Article | undefined> {
  const { rows } = await db.query<ArticleRow>(
    `${SUMMARY_COLUMNS.replace('SELECT n.id,', 'SELECT n.id, v.body,')}
       JOIN LATERAL (
         SELECT body
           FROM news_versions
          WHERE news_id = n.id
          ORDER BY version DESC
          LIMIT 1
       ) v ON true
      WHERE n.slug = $1 AND n.status = 'PUBLISHED'`,
    [slug],
  )

  const row = rows[0]
  return row === undefined ? undefined : toArticle(row)
}

/**
 * Stories related to `article`: same city scores higher than same category,
 * and the article itself is always excluded.
 */
export async function findRelated(
  db: Db,
  article: ArticleSummary,
  limit = 3,
): Promise<ArticleSummary[]> {
  const { rows } = await db.query<SummaryRow>(
    `${SUMMARY_COLUMNS}
      WHERE n.status = 'PUBLISHED'
        AND n.slug <> $1
        AND (city.slug IS NOT DISTINCT FROM $2 OR cat.slug = $3)
      ORDER BY (CASE WHEN city.slug IS NOT DISTINCT FROM $2 THEN 2 ELSE 0 END)
             + (CASE WHEN cat.slug = $3 THEN 1 ELSE 0 END) DESC,
               n.published_at DESC,
               n.id DESC
      LIMIT $4`,
    [article.slug, article.citySlug, article.categorySlug, clampLimit(limit)],
  )

  return rows.map(toSummary)
}

/** The homepage lead: the most recent published story. */
export async function findLead(db: Db): Promise<ArticleSummary | undefined> {
  const page = await listPublished(db, { limit: 1 })
  return page.items[0]
}
