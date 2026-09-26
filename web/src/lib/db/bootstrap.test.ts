/**
 * What a production deploy is allowed to install (§81, D-010, D-026).
 *
 * The distinction these tests defend: reference data is what the schema's
 * foreign keys point at and every environment needs it, while reporters and
 * articles are invented and must never reach a live site. Conflating the two
 * is how a deploy either publishes fiction or fails halfway.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrap, seed } from './seed'
import type { TestDb } from './testing'
import { createTestDb } from './testing'

async function count(db: TestDb, table: string): Promise<number> {
  // The table name is a literal from this file, never caller input.
  const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)
  return Number(rows[0]?.n ?? '0')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('bootstrap', () => {
  it('installs the reference data and the role catalogue', async () => {
    const db = await createTestDb()
    try {
      await bootstrap(db)

      expect(await count(db, 'roles')).toBeGreaterThan(0)
      expect(await count(db, 'permissions')).toBeGreaterThan(0)
      expect(await count(db, 'currencies')).toBeGreaterThan(0)
      expect(await count(db, 'languages')).toBeGreaterThan(0)
      expect(await count(db, 'countries')).toBeGreaterThan(0)
      expect(await count(db, 'cities')).toBeGreaterThan(0)
      expect(await count(db, 'categories')).toBeGreaterThan(0)
    } finally {
      await db.close()
    }
  }, 60_000)

  it('installs no reporters and no stories', async () => {
    const db = await createTestDb()
    try {
      await bootstrap(db)

      // The whole point. A deploy must not put invented people and invented
      // events on a live news site.
      expect(await count(db, 'reporters')).toBe(0)
      expect(await count(db, 'news')).toBe(0)
    } finally {
      await db.close()
    }
  }, 60_000)

  it('runs in production, because a deploy has to be able to call it', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const db = await createTestDb()
    try {
      await expect(bootstrap(db)).resolves.toBeUndefined()
      expect(await count(db, 'roles')).toBeGreaterThan(0)
    } finally {
      await db.close()
    }
  }, 60_000)

  it('changes nothing when run twice', async () => {
    const db = await createTestDb()
    try {
      await bootstrap(db)
      const before = {
        roles: await count(db, 'roles'),
        categories: await count(db, 'categories'),
        cities: await count(db, 'cities'),
      }

      // Every deploy re-runs this against a live database.
      await bootstrap(db)

      expect({
        roles: await count(db, 'roles'),
        categories: await count(db, 'categories'),
        cities: await count(db, 'cities'),
      }).toEqual(before)
    } finally {
      await db.close()
    }
  }, 60_000)
})

describe('seed', () => {
  it('adds the demonstration reporters and stories on top', async () => {
    const db = await createTestDb()
    try {
      await seed(db)
      expect(await count(db, 'reporters')).toBeGreaterThan(0)
      expect(await count(db, 'news')).toBeGreaterThan(0)
      // And still everything bootstrap installs.
      expect(await count(db, 'roles')).toBeGreaterThan(0)
    } finally {
      await db.close()
    }
  }, 60_000)

  it('refuses to run in production, and says what to use instead', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const db = await createTestDb()
    try {
      await expect(seed(db)).rejects.toThrow(/db:bootstrap/)
      expect(await count(db, 'news')).toBe(0)
    } finally {
      await db.close()
    }
  }, 60_000)
})
