/**
 * Newsroom tests against real PostgreSQL.
 *
 * The desk queries read rows the public repository deliberately cannot see, so
 * the seeded fixtures are not enough on their own: every status other than
 * PUBLISHED has to be created here. `transitionStory` writes, so those tests
 * get a fresh database rather than sharing one -- a status change is not
 * something a later test should have to reason about.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from './client'
import {
  listAccounts,
  listForReporter,
  listQueue,
  listReporters,
  platformSummary,
  recentAudit,
  reporterForUser,
  reporterTotals,
  searchPublished,
  statusCounts,
  transitionStory,
} from './newsroom'
import { seed } from './seed'
import type { TestDb } from './testing'
import { createTestDb } from './testing'

/** A seeded reporter's profile id, by slug. */
async function reporterId(db: Db, slug: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM reporters WHERE slug = $1', [slug])
  const id = rows[0]?.id
  if (id === undefined) throw new Error(`no reporter ${slug}`)
  return id
}

async function anyUserId(db: Db): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users LIMIT 1')
  const id = rows[0]?.id
  if (id === undefined) throw new Error('no users seeded')
  return id
}

/** Adds an unpublished story so the desk queries have something to find. */
async function addDraft(db: Db, slug: string, status: string): Promise<void> {
  await db.query(
    `INSERT INTO news (slug, category_id, reporter_id, kicker, title, standfirst, status, read_minutes)
     SELECT $1, cat.id, rep.id, 'Desk', $2, 'Filed for the desk', $3::news_status, 3
       FROM categories cat, reporters rep
      WHERE cat.slug = 'business' AND rep.slug = 'a-deshmukh'`,
    [slug, `Draft story ${slug}`, status],
  )
}

describe('read-only desk queries', () => {
  let db: TestDb

  beforeAll(async () => {
    db = await createTestDb()
    await seed(db)
    await addDraft(db, 'desk-draft-one', 'DRAFT')
    await addDraft(db, 'desk-draft-two', 'EDITOR_REVIEW')
  }, 60_000)

  afterAll(async () => {
    await db.close()
  })

  describe('search', () => {
    it('finds a published story by a word in its title', async () => {
      const hits = await searchPublished(db, 'monsoon')
      expect(hits.length).toBeGreaterThan(0)
      for (const hit of hits) expect(hit.status).toBe('PUBLISHED')
    })

    it('never returns an unpublished story', async () => {
      const hits = await searchPublished(db, 'Draft story')
      expect(hits).toEqual([])
    })

    it('returns nothing for a blank query rather than everything', async () => {
      expect(await searchPublished(db, '   ')).toEqual([])
    })

    it('treats a wildcard in the query as text, not as a pattern', async () => {
      // Unescaped, '%' would match every published row.
      const hits = await searchPublished(db, '%')
      expect(hits).toEqual([])
    })

    it('treats an underscore as text', async () => {
      const hits = await searchPublished(db, '_')
      expect(hits).toEqual([])
    })

    it('is case-insensitive', async () => {
      const lower = await searchPublished(db, 'monsoon')
      const upper = await searchPublished(db, 'MONSOON')
      expect(upper.map((h) => h.slug)).toEqual(lower.map((h) => h.slug))
    })

    it('survives a query shaped like SQL', async () => {
      const hits = await searchPublished(db, "'; DROP TABLE news; --")
      expect(hits).toEqual([])
      const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM news')
      expect(Number(rows[0]?.count)).toBeGreaterThan(0)
    })
  })

  describe('reporter desk', () => {
    it('resolves the reporter profile behind an account', async () => {
      const { rows } = await db.query<{ user_id: string }>(
        'SELECT user_id FROM reporters WHERE slug = $1',
        ['a-deshmukh'],
      )
      const profile = await reporterForUser(db, rows[0]?.user_id ?? '')
      expect(profile?.slug).toBe('a-deshmukh')
    })

    it('returns null for an account with no reporter profile', async () => {
      expect(await reporterForUser(db, '00000000-0000-0000-0000-000000000000')).toBeNull()
    })

    it('lists a reporter their own work, drafts included', async () => {
      const stories = await listForReporter(db, await reporterId(db, 'a-deshmukh'))
      const slugs = stories.map((s) => s.slug)
      expect(slugs).toContain('desk-draft-one')
      for (const story of stories) expect(story.reporterSlug).toBe('a-deshmukh')
    })

    it('counts published, open and views separately', async () => {
      const totals = await reporterTotals(db, await reporterId(db, 'a-deshmukh'))
      expect(totals.open).toBe(2)
      expect(totals.published).toBeGreaterThan(0)
      expect(totals.views).toBeGreaterThan(0)
    })

    it('reports zeroes for a reporter with nothing filed', async () => {
      const totals = await reporterTotals(db, '00000000-0000-0000-0000-000000000000')
      expect(totals).toEqual({ published: 0, open: 0, views: 0 })
    })

    it('lists every reporter with a real published count', async () => {
      const all = await listReporters(db)
      expect(all.length).toBeGreaterThan(0)
      const filer = all.find((r) => r.slug === 'a-deshmukh')
      // The two drafts must not be counted as published.
      expect(filer?.published).toBe(
        (await reporterTotals(db, await reporterId(db, 'a-deshmukh'))).published,
      )
    })
  })

  describe('editorial queue', () => {
    it('holds exactly the unpublished stories', async () => {
      const queue = await listQueue(db)
      expect(queue.map((s) => s.slug).sort()).toEqual(['desk-draft-one', 'desk-draft-two'])
      for (const story of queue) expect(story.status).not.toBe('PUBLISHED')
    })

    it('counts stories by status', async () => {
      const counts = await statusCounts(db)
      const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.count]))
      expect(byStatus.DRAFT).toBe(1)
      expect(byStatus.EDITOR_REVIEW).toBe(1)
      expect(byStatus.PUBLISHED).toBeGreaterThan(0)
    })
  })

  describe('admin', () => {
    it('summarises the platform from real counts', async () => {
      const summary = await platformSummary(db)
      const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM users')
      expect(summary.users).toBe(Number(rows[0]?.count))
      expect(summary.unpublished).toBe(2)
      expect(summary.liveSessions).toBe(0)
      expect(summary.failedSignInsToday).toBe(0)
    })

    it('lists accounts with their live roles', async () => {
      const accounts = await listAccounts(db)
      expect(accounts.length).toBeGreaterThan(0)
      for (const account of accounts) expect(Array.isArray(account.roles)).toBe(true)
    })

    it('omits a revoked role from an account', async () => {
      const userId = await anyUserId(db)
      await db.query(
        `INSERT INTO user_roles (user_id, role_key, revoked_at)
         VALUES ($1, 'READER', now())`,
        [userId],
      )
      const account = (await listAccounts(db, 200)).find((a) => a.id === userId)
      expect(account?.roles).not.toContain('READER')
      await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId])
    })
  })
})

describe('transitionStory', () => {
  let db: TestDb
  let actor: string

  beforeAll(async () => {
    db = await createTestDb()
    await seed(db)
    await addDraft(db, 'moving-story', 'EDITOR_REVIEW')
    actor = await anyUserId(db)
  }, 60_000)

  afterAll(async () => {
    await db.close()
  })

  it('reports a story it cannot find rather than throwing', async () => {
    expect(await transitionStory(db, { slug: 'no-such-story', to: 'PUBLISHED', actorId: actor })).toEqual(
      { status: 'NOT_FOUND' },
    )
  })

  it('refuses to move a story to the status it already holds', async () => {
    expect(
      await transitionStory(db, { slug: 'moving-story', to: 'EDITOR_REVIEW', actorId: actor }),
    ).toEqual({ status: 'NO_CHANGE', current: 'EDITOR_REVIEW' })
  })

  it('publishes, stamping published_at to satisfy the CHECK constraint', async () => {
    const outcome = await transitionStory(db, {
      slug: 'moving-story',
      to: 'PUBLISHED',
      actorId: actor,
      actorRole: 'EDITOR',
      note: 'Cleared the desk',
    })
    expect(outcome).toEqual({ status: 'CHANGED', from: 'EDITOR_REVIEW', to: 'PUBLISHED' })

    const { rows } = await db.query<{ status: string; published_at: string | null }>(
      'SELECT status, published_at FROM news WHERE slug = $1',
      ['moving-story'],
    )
    expect(rows[0]?.status).toBe('PUBLISHED')
    expect(rows[0]?.published_at).not.toBeNull()
  })

  it('records a version carrying the note and the new status', async () => {
    const { rows } = await db.query<{ version: number; status: string; note: string; body: string[] }>(
      `SELECT v.version, v.status, v.note, v.body
         FROM news_versions v JOIN news n ON n.id = v.news_id
        WHERE n.slug = $1 ORDER BY v.version DESC LIMIT 1`,
      ['moving-story'],
    )
    expect(rows[0]?.status).toBe('PUBLISHED')
    expect(rows[0]?.note).toBe('Cleared the desk')
    expect(rows[0]?.body.length).toBeGreaterThan(0)
  })

  it('writes an audit entry naming the actor and both statuses', async () => {
    const entries = await recentAudit(db, 5)
    const entry = entries.find((e) => e.resourceId === 'moving-story')
    expect(entry?.action).toBe('NEWS_PUBLISHED')
    expect(entry?.resourceType).toBe('news')

    const { rows } = await db.query<{ before_state: unknown; after_state: unknown }>(
      `SELECT before_state, after_state FROM audit_events
        WHERE resource_id = $1 ORDER BY created_at DESC LIMIT 1`,
      ['moving-story'],
    )
    expect(rows[0]?.before_state).toMatchObject({ status: 'EDITOR_REVIEW' })
    expect(rows[0]?.after_state).toMatchObject({ status: 'PUBLISHED' })
  })

  it('clears published_at when the story is taken down', async () => {
    const outcome = await transitionStory(db, {
      slug: 'moving-story',
      to: 'UNPUBLISHED',
      actorId: actor,
    })
    expect(outcome).toEqual({ status: 'CHANGED', from: 'PUBLISHED', to: 'UNPUBLISHED' })

    const { rows } = await db.query<{ published_at: string | null }>(
      'SELECT published_at FROM news WHERE slug = $1',
      ['moving-story'],
    )
    expect(rows[0]?.published_at).toBeNull()
  })

  it('numbers versions consecutively across transitions', async () => {
    const { rows } = await db.query<{ versions: string }>(
      `SELECT array_agg(v.version ORDER BY v.version)::text AS versions
         FROM news_versions v JOIN news n ON n.id = v.news_id
        WHERE n.slug = $1`,
      ['moving-story'],
    )
    expect(rows[0]?.versions).toBe('{1,2}')
  })

  it('leaves nothing behind when the transition fails', async () => {
    const before = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_events',
    )

    await expect(
      transitionStory(db, {
        slug: 'moving-story',
        to: 'NOT_A_STATUS' as never,
        actorId: actor,
      }),
    ).rejects.toThrow()

    const after = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_events',
    )
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count)

    const { rows } = await db.query<{ status: string }>(
      'SELECT status FROM news WHERE slug = $1',
      ['moving-story'],
    )
    expect(rows[0]?.status).toBe('UNPUBLISHED')
  })
})
