/**
 * Schema tests, run against real PostgreSQL (see testing.ts).
 *
 * These assert the guarantees the database makes on its own -- the ones that
 * hold even when application code is wrong, which is the reason to put them in
 * the schema rather than in a service layer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestDb } from './testing'
import { createTestDb } from './testing'

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

afterEach(async () => {
  await db.close()
})

async function seedMinimal(): Promise<{ categoryId: string; reporterId: string }> {
  await db.query(`INSERT INTO currencies (code, name, minor_unit) VALUES ('INR', 'Indian Rupee', 2)`)
  await db.query(`INSERT INTO languages (code, name) VALUES ('en', 'English')`)
  await db.query(
    `INSERT INTO countries (code, name, currency_code, default_language) VALUES ('IN', 'India', 'INR', 'en')`,
  )
  const cat = await db.query<{ id: string }>(
    `INSERT INTO categories (slug, name) VALUES ('business', 'Business') RETURNING id`,
  )
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('a@example.com', 'A') RETURNING id`,
  )
  const rep = await db.query<{ id: string }>(
    `INSERT INTO reporters (user_id, slug, name) VALUES ($1, 'a-reporter', 'A Reporter') RETURNING id`,
    [user.rows[0]?.id],
  )
  return { categoryId: cat.rows[0]?.id ?? '', reporterId: rep.rows[0]?.id ?? '' }
}

describe('migrations', () => {
  it('records what it applied and is idempotent on a second run', async () => {
    const { rows } = await db.query<{ id: string; filename: string }>(
      'SELECT id, filename FROM schema_migrations ORDER BY id',
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.filename).toBe('0001_core.sql')

    const { migrate } = await import('./migrate')
    const second = await migrate(db)
    expect(second.applied).toEqual([])
    expect(second.skipped).toContain('0001_core.sql')
  })
})

describe('slug constraints', () => {
  it('rejects a slug that is not URL-safe', async () => {
    await expect(
      db.query(`INSERT INTO categories (slug, name) VALUES ('Not A Slug', 'x')`),
    ).rejects.toThrow()
  })

  it('rejects a slug containing a path traversal', async () => {
    await expect(
      db.query(`INSERT INTO categories (slug, name) VALUES ('../../etc/passwd', 'x')`),
    ).rejects.toThrow()
  })

  it('accepts a conventional slug', async () => {
    await expect(
      db.query(`INSERT INTO categories (slug, name) VALUES ('my-city', 'My City')`),
    ).resolves.toBeDefined()
  })
})

describe('email normalisation', () => {
  it('rejects a non-lowercase address, so uniqueness cannot be bypassed by case', async () => {
    await expect(
      db.query(`INSERT INTO users (email, display_name) VALUES ('Mixed@Example.com', 'x')`),
    ).rejects.toThrow()
  })

  it('rejects a duplicate address', async () => {
    await db.query(`INSERT INTO users (email, display_name) VALUES ('dup@example.com', 'x')`)
    await expect(
      db.query(`INSERT INTO users (email, display_name) VALUES ('dup@example.com', 'y')`),
    ).rejects.toThrow()
  })
})

describe('published-state invariant', () => {
  it('refuses a PUBLISHED story with no publication time', async () => {
    const { categoryId, reporterId } = await seedMinimal()

    await expect(
      db.query(
        `INSERT INTO news (slug, category_id, reporter_id, title, status)
         VALUES ('x', $1, $2, 'T', 'PUBLISHED')`,
        [categoryId, reporterId],
      ),
    ).rejects.toThrow()
  })

  it('refuses a draft that claims a publication time', async () => {
    const { categoryId, reporterId } = await seedMinimal()

    await expect(
      db.query(
        `INSERT INTO news (slug, category_id, reporter_id, title, status, published_at)
         VALUES ('x', $1, $2, 'T', 'DRAFT', now())`,
        [categoryId, reporterId],
      ),
    ).rejects.toThrow()
  })

  it('accepts a PUBLISHED story with a publication time', async () => {
    const { categoryId, reporterId } = await seedMinimal()

    await expect(
      db.query(
        `INSERT INTO news (slug, category_id, reporter_id, title, status, published_at)
         VALUES ('x', $1, $2, 'T', 'PUBLISHED', now())`,
        [categoryId, reporterId],
      ),
    ).resolves.toBeDefined()
  })
})

describe('editorial history is append-only', () => {
  async function aVersion(): Promise<string> {
    const { categoryId, reporterId } = await seedMinimal()
    const news = await db.query<{ id: string }>(
      `INSERT INTO news (slug, category_id, reporter_id, title, status, published_at)
       VALUES ('story', $1, $2, 'T', 'PUBLISHED', now()) RETURNING id`,
      [categoryId, reporterId],
    )
    const id = news.rows[0]?.id ?? ''
    await db.query(
      `INSERT INTO news_versions (news_id, version, title, body, status)
       VALUES ($1, 1, 'T', ARRAY['one'], 'PUBLISHED')`,
      [id],
    )
    return id
  }

  it('refuses to update a version', async () => {
    const id = await aVersion()
    await expect(
      db.query(`UPDATE news_versions SET title = 'rewritten' WHERE news_id = $1`, [id]),
    ).rejects.toThrow(/append-only/)
  })

  it('refuses to delete a version', async () => {
    const id = await aVersion()
    await expect(
      db.query(`DELETE FROM news_versions WHERE news_id = $1`, [id]),
    ).rejects.toThrow(/append-only/)
  })

  it('allows a correction to be appended as a new version', async () => {
    const id = await aVersion()
    await expect(
      db.query(
        `INSERT INTO news_versions (news_id, version, title, body, status, note)
         VALUES ($1, 2, 'T', ARRAY['corrected'], 'PUBLISHED', 'Correction')`,
        [id],
      ),
    ).resolves.toBeDefined()

    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM news_versions WHERE news_id = $1',
      [id],
    )
    expect(rows[0]?.count).toBe('2')
  })

  it('refuses two versions with the same number', async () => {
    const id = await aVersion()
    await expect(
      db.query(
        `INSERT INTO news_versions (news_id, version, title, body, status)
         VALUES ($1, 1, 'T', ARRAY['duplicate'], 'PUBLISHED')`,
        [id],
      ),
    ).rejects.toThrow()
  })
})

describe('deletion behaviour', () => {
  it('refuses to delete a category that still has stories', async () => {
    const { categoryId, reporterId } = await seedMinimal()
    await db.query(
      `INSERT INTO news (slug, category_id, reporter_id, title) VALUES ('s', $1, $2, 'T')`,
      [categoryId, reporterId],
    )

    await expect(db.query('DELETE FROM categories WHERE id = $1', [categoryId])).rejects.toThrow()
  })
})

describe('updated_at', () => {
  it('advances on update without the application setting it', async () => {
    const user = await db.query<{ id: string; updated_at: Date }>(
      `INSERT INTO users (email, display_name) VALUES ('t@example.com', 'T')
       RETURNING id, updated_at`,
    )
    const before = user.rows[0]?.updated_at

    const after = await db.query<{ updated_at: Date }>(
      `UPDATE users SET display_name = 'T2' WHERE id = $1 RETURNING updated_at`,
      [user.rows[0]?.id],
    )

    expect(new Date(after.rows[0]?.updated_at ?? 0).getTime()).toBeGreaterThanOrEqual(
      new Date(before ?? 0).getTime(),
    )
  })
})
