/**
 * Repository tests against real PostgreSQL, over the seeded fixtures.
 *
 * The database is built once for the whole file: these are read-only queries,
 * so sharing one instance keeps the suite fast without letting tests affect
 * each other.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
} from './repository'
import { seed } from './seed'
import type { TestDb } from './testing'
import { createTestDb } from './testing'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
  await seed(db)
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe('reference data', () => {
  it('lists categories in their configured order', async () => {
    const categories = await listCategories(db)
    expect(categories.length).toBeGreaterThan(0)
    expect(categories[0]?.slug).toBe('breaking')
  })

  it('finds a category by slug', async () => {
    expect((await findCategory(db, 'business'))?.name).toBe('Business')
  })

  it('returns undefined for an unknown category', async () => {
    expect(await findCategory(db, 'no-such-category')).toBeUndefined()
  })

  it('joins a city to its country and state', async () => {
    const city = await findCity(db, 'mumbai')
    expect(city?.name).toBe('Mumbai')
    expect(city?.country).toBe('India')
    expect(city?.newsroom).toContain('Mumbai')
  })

  it('lists every seeded city', async () => {
    expect((await listCities(db)).length).toBe(4)
  })

  it('aggregates a reporter with their languages', async () => {
    const reporter = await findReporter(db, 'a-deshmukh')
    expect(reporter).toBeDefined()
    expect(reporter?.name).toBe('A. Deshmukh')
    expect(reporter?.city).toBe('Mumbai')
    // Display names, not codes: the portal prints these directly.
    expect(reporter?.languages).toContain('Marathi')
  })
})

describe('listings', () => {
  it('returns published stories newest first', async () => {
    const page = await listPublished(db, { limit: 50 })
    const dates = page.items.map((a) => Date.parse(a.publishedAt))

    expect(dates.length).toBeGreaterThan(1)
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })

  it('does not carry body copy in a listing', async () => {
    const page = await listPublished(db, { limit: 5 })
    for (const item of page.items) {
      expect(item).not.toHaveProperty('body')
    }
  })

  it('filters by category without leaking other categories', async () => {
    const page = await listPublished(db, { categorySlug: 'business', limit: 50 })
    expect(page.items.length).toBeGreaterThan(0)
    for (const item of page.items) expect(item.categorySlug).toBe('business')
  })

  it('filters by city without leaking other cities', async () => {
    const page = await listPublished(db, { citySlug: 'mumbai', limit: 50 })
    expect(page.items.length).toBeGreaterThan(0)
    for (const item of page.items) expect(item.citySlug).toBe('mumbai')
  })

  it('returns an empty page for an unknown category rather than everything', async () => {
    const page = await listPublished(db, { categorySlug: 'no-such-category' })
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('returns only urgent stories when asked for the ticker', async () => {
    const page = await listPublished(db, { urgentOnly: true, limit: 50 })
    expect(page.items.length).toBeGreaterThan(0)
    for (const item of page.items) {
      expect(item.breaking === true || item.live === true).toBe(true)
    }
  })
})

describe('keyset pagination', () => {
  it('walks every story exactly once across pages', async () => {
    const all = await listPublished(db, { limit: 50 })
    const seen: string[] = []

    let cursor: string | null = null
    for (let guard = 0; guard < 20; guard += 1) {
      const page: Awaited<ReturnType<typeof listPublished>> = await listPublished(db, {
        limit: 2,
        cursor,
      })
      seen.push(...page.items.map((a) => a.slug))
      cursor = page.nextCursor
      if (cursor === null) break
    }

    expect(seen).toEqual(all.items.map((a) => a.slug))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('reports no further page on the last one', async () => {
    const page = await listPublished(db, { limit: 100 })
    expect(page.nextCursor).toBeNull()
  })

  it('treats a malformed cursor as the start rather than failing', async () => {
    const first = await listPublished(db, { limit: 3 })
    const forged = await listPublished(db, { limit: 3, cursor: 'not-a-real-cursor' })

    expect(forged.items.map((a) => a.slug)).toEqual(first.items.map((a) => a.slug))
  })

  it('caps an oversized page request', async () => {
    const page = await listPublished(db, { limit: 10_000 })
    expect(page.items.length).toBeLessThanOrEqual(100)
  })
})

describe('article', () => {
  it('returns a published article with its latest body', async () => {
    const [first] = (await listPublished(db, { limit: 1 })).items
    if (first === undefined) throw new Error('seed produced no articles')

    const article = await findArticle(db, first.slug)
    expect(article?.slug).toBe(first.slug)
    expect(article?.body.length).toBeGreaterThan(0)
  })

  it('returns undefined for an unknown slug', async () => {
    expect(await findArticle(db, 'no-such-article')).toBeUndefined()
  })

  it('returns undefined for a path-traversal string', async () => {
    expect(await findArticle(db, '../../../etc/passwd')).toBeUndefined()
  })

  it('does not expose an unpublished story', async () => {
    const [first] = (await listPublished(db, { limit: 1 })).items
    if (first === undefined) throw new Error('seed produced no articles')

    // Take it out of publication the way the state machine would, then confirm
    // every read path stops returning it.
    await db.query(
      `UPDATE news SET status = 'UNPUBLISHED', published_at = NULL WHERE slug = $1`,
      [first.slug],
    )

    try {
      expect(await findArticle(db, first.slug)).toBeUndefined()
      const page = await listPublished(db, { limit: 50 })
      expect(page.items.map((a) => a.slug)).not.toContain(first.slug)
    } finally {
      await db.query(
        `UPDATE news SET status = 'PUBLISHED', published_at = $2 WHERE slug = $1`,
        [first.slug, first.publishedAt],
      )
    }
  })

  it('has a lead story', async () => {
    expect(await findLead(db)).toBeDefined()
  })
})

describe('related stories', () => {
  it('never includes the article itself', async () => {
    for (const article of (await listPublished(db, { limit: 50 })).items) {
      const related = await findRelated(db, article)
      expect(related.map((r) => r.slug)).not.toContain(article.slug)
    }
  })

  it('honours the limit and returns no duplicates', async () => {
    const [first] = (await listPublished(db, { limit: 1 })).items
    if (first === undefined) throw new Error('seed produced no articles')

    const related = await findRelated(db, first, 2)
    expect(related.length).toBeLessThanOrEqual(2)
    expect(new Set(related.map((r) => r.slug)).size).toBe(related.length)
  })
})

describe('seed safety', () => {
  it('refuses to run in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      await expect(seed(db)).rejects.toThrow(/production/i)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
