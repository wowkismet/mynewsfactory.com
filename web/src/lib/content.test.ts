/**
 * Editorial content tests (§52).
 *
 * `content.ts` is a fixture module today and becomes a database query layer in
 * Phase 1 (docs/IMPLEMENTATION_PLAN.md). These tests are written against the
 * accessor contract rather than the fixture data, so they keep their value
 * after the swap: referential integrity, slug uniqueness and filter correctness
 * are exactly the properties a real query layer must also satisfy.
 */

import { describe, expect, it } from 'vitest'
import {
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
} from './content'

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
    for (const article of await getArticles()) {
      expect(article.body.length, article.slug).toBeGreaterThan(0)
      expect(Number.isNaN(Date.parse(article.publishedAt)), article.slug).toBe(false)
    }
  })

  it('stores body copy as plain text, never as markup', async () => {
    // Bodies are rendered as text nodes. A fixture containing a tag would be a
    // silent invitation to switch to dangerouslySetInnerHTML later (§8).
    for (const article of await getArticles()) {
      for (const paragraph of article.body) {
        expect(paragraph, article.slug).not.toMatch(/<[a-z/][^>]*>/i)
      }
    }
  })

  it('has a lead article', async () => {
    await expect(getLead()).resolves.toBeDefined()
  })
})
