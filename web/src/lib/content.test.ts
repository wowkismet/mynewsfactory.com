/**
 * Editorial content tests (§52).
 *
 * These were written against the accessor contract rather than the fixture
 * data, on the expectation that `content.ts` would stop being a fixture module
 * and start being a query layer. It has, and they did keep their value:
 * referential integrity, slug uniqueness and filter correctness are exactly
 * the properties the queries must also satisfy, and every assertion below is
 * unchanged apart from the two that needed a full article rather than a
 * summary.
 *
 * They now run against real PostgreSQL, seeded with the same fixtures.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TestDb } from './db/testing'

const shared = vi.hoisted(() => ({ db: null as { query: unknown } | null }))

vi.mock('./db/pool', () => ({
  db: () => {
    if (shared.db === null) throw new Error('DATABASE_URL is not set')
    return shared.db
  },
  getPool: () => {
    throw new Error('the pool is not used in tests')
  },
  closePool: async () => Promise.resolve(),
}))

const { createTestDb } = await import('./db/testing')
const { seed } = await import('./db/seed')

const {
  getArticle,
  getArticles,
  getArticlesByCategory,
  getArticlesByCity,
  getBreaking,
  getCategories,
  getCategory,
  getCities,
  getCity,
  getLead,
  getRelated,
  getReporter,
} = await import('./content')

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  shared.db = db
  await seed(db)
}, 60_000)

afterAll(async () => {
  shared.db = null
  await db.close()
})

describe('referential integrity', () => {
  it('resolves every article to an existing category', async () => {
    const [articles, categories] = await Promise.all([getArticles(), getCategories()])
    const known = new Set(categories.map((c) => c.slug))

    for (const article of articles) {
      expect(known.has(article.categorySlug), `${article.slug} -> ${article.categorySlug}`).toBe(true)
    }
  })

  it('resolves every article to an existing reporter', async () => {
    const articles = await getArticles()

    for (const article of articles) {
      const reporter = await getReporter(article.reporterSlug)
      expect(reporter, `${article.slug} -> ${article.reporterSlug}`).toBeDefined()
    }
  })

  it('resolves every article city to an existing city, or to null', async () => {
    const [articles, cities] = await Promise.all([getArticles(), getCities()])
    const known = new Set(cities.map((c) => c.slug))

    for (const article of articles) {
      if (article.citySlug === null) continue
      expect(known.has(article.citySlug), `${article.slug} -> ${article.citySlug}`).toBe(true)
    }
  })
})

describe('slug uniqueness', () => {
  it.each([
    ['articles', getArticles],
    ['categories', getCategories],
    ['cities', getCities],
  ])('has no duplicate slug among %s', async (_name, load) => {
    const records = await load()
    const slugs = records.map((r) => r.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('uses URL-safe slugs throughout', async () => {
    const articles = await getArticles()

    for (const article of articles) {
      expect(article.slug, article.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})

describe('lookups', () => {
  it('returns undefined rather than throwing for an unknown article', async () => {
    await expect(getArticle('no-such-article')).resolves.toBeUndefined()
  })

  it('returns undefined rather than throwing for an unknown category', async () => {
    await expect(getCategory('no-such-category')).resolves.toBeUndefined()
  })

  it('returns undefined rather than throwing for an unknown city', async () => {
    await expect(getCity('no-such-city')).resolves.toBeUndefined()
  })

  it('does not treat a path-traversal string as a valid slug', async () => {
    await expect(getArticle('../../../etc/passwd')).resolves.toBeUndefined()
  })

  it('round-trips a known article by its own slug', async () => {
    const [first] = await getArticles()
    if (first === undefined) throw new Error('fixture has no articles')

    const found = await getArticle(first.slug)
    expect(found?.slug).toBe(first.slug)
  })
})

describe('filters', () => {
  it('returns only articles belonging to the requested category', async () => {
    const categories = await getCategories()

    for (const category of categories) {
      const articles = await getArticlesByCategory(category.slug)
      for (const article of articles) {
        expect(article.categorySlug).toBe(category.slug)
      }
    }
  })

  it('returns only articles belonging to the requested city', async () => {
    const cities = await getCities()

    for (const city of cities) {
      const articles = await getArticlesByCity(city.slug)
      for (const article of articles) {
        expect(article.citySlug).toBe(city.slug)
      }
    }
  })

  it('returns an empty list for an unknown category rather than every article', async () => {
    await expect(getArticlesByCategory('no-such-category')).resolves.toEqual([])
  })

  it('returns only urgent articles from getBreaking', async () => {
    // getBreaking feeds the ticker, which carries breaking stories *and* live
    // event hubs. Asserting the union is the real contract; asserting
    // `breaking === true` alone would have quietly excluded live coverage.
    for (const article of await getBreaking()) {
      const urgent = article.breaking === true || article.live === true
      expect(urgent, `${article.slug} is neither breaking nor live`).toBe(true)
    }
  })

  it('includes every breaking article in getBreaking', async () => {
    const breaking = (await getArticles()).filter((a) => a.breaking === true)
    const returned = new Set((await getBreaking()).map((a) => a.slug))

    for (const article of breaking) {
      expect(returned.has(article.slug), `${article.slug} missing from ticker`).toBe(true)
    }
  })
})

describe('getRelated', () => {
  it('never includes the article it was given', async () => {
    for (const article of await getArticles()) {
      const related = await getRelated(article)
      expect(related.map((r) => r.slug)).not.toContain(article.slug)
    }
  })

  it('honours the requested limit', async () => {
    const [first] = await getArticles()
    if (first === undefined) throw new Error('fixture has no articles')

    const related = await getRelated(first, 2)
    expect(related.length).toBeLessThanOrEqual(2)
  })

  it('returns no duplicates', async () => {
    const [first] = await getArticles()
    if (first === undefined) throw new Error('fixture has no articles')

    const related = await getRelated(first)
    const slugs = related.map((r) => r.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('article shape', () => {
  it('gives every article a lead paragraph and a valid publish date', async () => {
    // A listing carries no body -- that is the point of the summary type -- so
    // the body is asserted on the full article the page actually renders.
    for (const summary of await getArticles()) {
      const article = await getArticle(summary.slug)
      expect(article?.body.length, summary.slug).toBeGreaterThan(0)
      expect(Number.isNaN(Date.parse(summary.publishedAt)), summary.slug).toBe(false)
    }
  })

  it('stores body copy as plain text, never as markup', async () => {
    // Bodies are rendered as text nodes. Copy containing a tag would be a
    // silent invitation to switch to dangerouslySetInnerHTML later (§8).
    for (const summary of await getArticles()) {
      const article = await getArticle(summary.slug)
      for (const paragraph of article?.body ?? []) {
        expect(paragraph, summary.slug).not.toMatch(/<[a-z/][^>]*>/i)
      }
    }
  })

  it('has a lead article', async () => {
    await expect(getLead()).resolves.toBeDefined()
  })
})

describe('when the database cannot answer', () => {
  it('returns empty rather than serving fixtures as if they were published', async () => {
    const live = shared.db
    shared.db = null
    try {
      // Every accessor degrades. The alternative -- falling back to the
      // fixtures -- would put invented stories under real reporter names on a
      // live site, with nothing to indicate anything was wrong (§89).
      expect(await getArticles()).toEqual([])
      expect(await getCategories()).toEqual([])
      expect(await getCities()).toEqual([])
      expect(await getBreaking()).toEqual([])
      expect(await getLead()).toBeUndefined()
      expect(await getArticle('mumbai-drainage-audit-fourteen-wards-flagged')).toBeUndefined()
    } finally {
      shared.db = live
    }
  })

  it('recovers as soon as it can answer again', async () => {
    expect((await getArticles()).length).toBeGreaterThan(0)
  })
})
