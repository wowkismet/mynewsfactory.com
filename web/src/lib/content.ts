/**
 * Editorial content accessors for the rendered pages (§10, §42).
 *
 * These read PostgreSQL. They used to read `fixtures.ts`, and the swap is the
 * point: what the portal shows is now what the newsroom published, not a file
 * checked into the repository.
 *
 * Every accessor degrades rather than throws. A page that cannot reach the
 * database renders its empty state and says so; it does not fall back to the
 * fixtures. Serving invented stories under real reporter names because the
 * database is down is the §89 failure -- mock data presented as production
 * data -- and it is worse than an empty page, because nobody finds out.
 *
 * The fixtures remain, used only by `db/seed.ts` for development and tests.
 */

import type { Article, ArticleSummary, Category, City, Reporter } from './types'
import {
  findArticle,
  findCategory,
  findCity,
  findLead,
  findRelated,
  findReporter,
  listCategories,
  listCities,
  listPublished,
} from './db/repository'
import type { Db } from './db/client'
import { db } from './db/pool'

/**
 * Runs a read, returning `fallback` if the database cannot answer.
 *
 * The failure is logged with the accessor's name so an operator sees which
 * read failed, while the page gets a value it can render. A missing
 * DATABASE_URL reaches here as a thrown error from `db()`, which is the
 * not-yet-provisioned case rather than a fault.
 */
async function read<T>(name: string, fallback: T, work: (handle: Db) => Promise<T>): Promise<T> {
  try {
    return await work(db())
  } catch (error) {
    console.error('[content] read failed', {
      accessor: name,
      detail: error instanceof Error ? error.message : String(error),
    })
    return fallback
  }
}

/** How many stories a listing page renders before it needs a cursor. */
const PAGE = 40

export async function getCategories(): Promise<Category[]> {
  return read('getCategories', [], (handle) => listCategories(handle))
}

export async function getCategory(slug: string): Promise<Category | undefined> {
  return read('getCategory', undefined, (handle) => findCategory(handle, slug))
}

export async function getCities(): Promise<City[]> {
  return read('getCities', [], (handle) => listCities(handle))
}

export async function getCity(slug: string): Promise<City | undefined> {
  return read('getCity', undefined, (handle) => findCity(handle, slug))
}

export async function getReporter(slug: string): Promise<Reporter | undefined> {
  return read('getReporter', undefined, (handle) => findReporter(handle, slug))
}

/**
 * The newest published stories.
 *
 * Bounded. The fixture version returned every article, which was fine for
 * thirty rows and is the unbounded read the audit flagged for any real table.
 */
export async function getArticles(limit = PAGE): Promise<ArticleSummary[]> {
  return read('getArticles', [], async (handle) => (await listPublished(handle, { limit })).items)
}

export async function getArticle(slug: string): Promise<Article | undefined> {
  return read('getArticle', undefined, (handle) => findArticle(handle, slug))
}

export async function getArticlesByCategory(slug: string, limit = PAGE): Promise<ArticleSummary[]> {
  return read(
    'getArticlesByCategory',
    [],
    async (handle) => (await listPublished(handle, { categorySlug: slug, limit })).items,
  )
}

export async function getArticlesByCity(slug: string, limit = PAGE): Promise<ArticleSummary[]> {
  return read(
    'getArticlesByCity',
    [],
    async (handle) => (await listPublished(handle, { citySlug: slug, limit })).items,
  )
}

/** The ticker: breaking stories and live event hubs. */
export async function getBreaking(limit = 12): Promise<ArticleSummary[]> {
  return read(
    'getBreaking',
    [],
    async (handle) => (await listPublished(handle, { urgentOnly: true, limit })).items,
  )
}

/** The lead story for the homepage. */
export async function getLead(): Promise<ArticleSummary | undefined> {
  return read('getLead', undefined, (handle) => findLead(handle))
}

/** Stories related to `article`, preferring the same city, then category. */
export async function getRelated(article: ArticleSummary, limit = 3): Promise<ArticleSummary[]> {
  return read('getRelated', [], (handle) => findRelated(handle, article, limit))
}
