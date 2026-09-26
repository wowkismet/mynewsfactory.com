/**
 * Newsroom queries and the one write that moves a story (§12, §42, §43).
 *
 * `repository.ts` answers what a reader may see: published rows, and nothing
 * else, on every statement. This module is the other side — the desks. It
 * reads drafts, queues and accounts, so nothing here is safe to expose without
 * an authorization check, and every caller is behind one.
 *
 * The counts are real counts. §89 forbids fake dashboards, which in practice
 * means a tile must either show a number the database produced or say it has
 * no data. There is no third option where a plausible zero stands in.
 */

import type { Db } from './client'
import { transaction } from './client'
import { recordAudit } from './identity'

export type NewsStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AI_REVIEW'
  | 'EDITOR_REVIEW'
  | 'FACT_CHECK'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'CORRECTION_REQUIRED'
  | 'UNPUBLISHED'
  | 'REJECTED'

/** The statuses a story can be in while it is still someone's work. */
export const OPEN_STATUSES: NewsStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'AI_REVIEW',
  'EDITOR_REVIEW',
  'FACT_CHECK',
  'APPROVED',
  'SCHEDULED',
  'CORRECTION_REQUIRED',
]

export interface DeskStory {
  slug: string
  title: string
  status: NewsStatus
  categorySlug: string
  citySlug: string | null
  reporterSlug: string
  reporterName: string
  updatedAt: string
  publishedAt: string | null
  views: number
  breaking: boolean
}

interface DeskRow {
  slug: string
  title: string
  status: NewsStatus
  category_slug: string
  city_slug: string | null
  reporter_slug: string
  reporter_name: string
  updated_at: Date | string
  published_at: Date | string | null
  view_count: string | number
  breaking: boolean
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toDesk(row: DeskRow): DeskStory {
  return {
    slug: row.slug,
    title: row.title,
    status: row.status,
    categorySlug: row.category_slug,
    citySlug: row.city_slug,
    reporterSlug: row.reporter_slug,
    reporterName: row.reporter_name,
    updatedAt: iso(row.updated_at) ?? '',
    publishedAt: iso(row.published_at),
    views: typeof row.view_count === 'string' ? Number(row.view_count) : row.view_count,
    breaking: row.breaking,
  }
}

const DESK_COLUMNS = `
  SELECT n.slug, n.title, n.status,
         cat.slug  AS category_slug,
         city.slug AS city_slug,
         rep.slug  AS reporter_slug,
         rep.name  AS reporter_name,
         n.updated_at, n.published_at, n.view_count, n.breaking
    FROM news n
    JOIN categories cat ON cat.id = n.category_id
    JOIN reporters  rep ON rep.id = n.reporter_id
    LEFT JOIN cities city ON city.id = n.city_id
`

// ------------------------------------------------------------------ search

/**
 * Full-text-ish search over published stories (§39).
 *
 * `ILIKE` over three columns, not a search engine. §39 wants typo tolerance
 * and ranking, which is OpenSearch in §65; promising that here with a LIKE
 * would be the fake-feature failure the audit was written to avoid. What this
 * does do is honest and useful at current volumes, and the pattern is
 * parameterised — the wildcards are added around the bound value, never by
 * concatenating it into SQL.
 */
export async function searchPublished(db: Db, query: string, limit = 30): Promise<DeskStory[]> {
  const trimmed = query.trim()
  if (trimmed === '') return []

  // Escape the LIKE metacharacters so a query of "100%" searches for that text
  // rather than matching everything.
  const pattern = `%${trimmed.replace(/([\\%_])/g, '\\$1')}%`

  const { rows } = await db.query<DeskRow>(
    `${DESK_COLUMNS}
      WHERE n.status = 'PUBLISHED'
        AND (n.title ILIKE $1 OR n.standfirst ILIKE $1 OR n.kicker ILIKE $1)
      ORDER BY n.published_at DESC, n.id DESC
      LIMIT $2`,
    [pattern, Math.min(Math.max(limit, 1), 100)],
  )

  return rows.map(toDesk)
}

// --------------------------------------------------------------- reporters

export interface ReporterIdentity {
  id: string
  slug: string
  name: string
  tier: string
  verified: boolean
}

/** The reporter profile attached to an account, if it has one. */
export async function reporterForUser(db: Db, userId: string): Promise<ReporterIdentity | null> {
  const { rows } = await db.query<{
    id: string
    slug: string
    name: string
    tier: string
    verified: boolean
  }>('SELECT id, slug, name, tier, verified FROM reporters WHERE user_id = $1', [userId])

  return rows[0] ?? null
}

export async function listForReporter(db: Db, reporterId: string, limit = 50): Promise<DeskStory[]> {
  const { rows } = await db.query<DeskRow>(
    `${DESK_COLUMNS}
      WHERE n.reporter_id = $1
      ORDER BY n.updated_at DESC
      LIMIT $2`,
    [reporterId, Math.min(Math.max(limit, 1), 200)],
  )
  return rows.map(toDesk)
}

export interface ReporterTotals {
  published: number
  open: number
  views: number
}

export async function reporterTotals(db: Db, reporterId: string): Promise<ReporterTotals> {
  const { rows } = await db.query<{ published: string; open: string; views: string | null }>(
    `SELECT count(*) FILTER (WHERE status = 'PUBLISHED')::text AS published,
            count(*) FILTER (WHERE status <> 'PUBLISHED')::text AS open,
            coalesce(sum(view_count) FILTER (WHERE status = 'PUBLISHED'), 0)::text AS views
       FROM news WHERE reporter_id = $1`,
    [reporterId],
  )

  const row = rows[0]
  return {
    published: Number(row?.published ?? '0'),
    open: Number(row?.open ?? '0'),
    views: Number(row?.views ?? '0'),
  }
}

export async function listReporters(db: Db, limit = 60): Promise<
  { slug: string; name: string; tier: string; verified: boolean; published: number }[]
> {
  const { rows } = await db.query<{
    slug: string
    name: string
    tier: string
    verified: boolean
    published: string
  }>(
    `SELECT r.slug, r.name, r.tier, r.verified,
            count(n.id) FILTER (WHERE n.status = 'PUBLISHED')::text AS published
       FROM reporters r
       LEFT JOIN news n ON n.reporter_id = r.id
      GROUP BY r.id
      ORDER BY count(n.id) FILTER (WHERE n.status = 'PUBLISHED') DESC, r.name
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  )

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    tier: row.tier,
    verified: row.verified,
    published: Number(row.published),
  }))
}

// ---------------------------------------------------------------- editorial

/** The editorial queue: everything not yet published, oldest change first. */
export async function listQueue(db: Db, limit = 50): Promise<DeskStory[]> {
  const { rows } = await db.query<DeskRow>(
    `${DESK_COLUMNS}
      WHERE n.status <> 'PUBLISHED'
      ORDER BY n.updated_at ASC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  )
  return rows.map(toDesk)
}

export async function statusCounts(db: Db): Promise<{ status: NewsStatus; count: number }[]> {
  const { rows } = await db.query<{ status: NewsStatus; count: string }>(
    'SELECT status, count(*)::text AS count FROM news GROUP BY status ORDER BY status',
  )
  return rows.map((row) => ({ status: row.status, count: Number(row.count) }))
}

export type TransitionOutcome =
  | { status: 'CHANGED'; from: NewsStatus; to: NewsStatus }
  | { status: 'NOT_FOUND' }
  | { status: 'NO_CHANGE'; current: NewsStatus }

/**
 * Moves a story to a new status, recording a version and an audit entry.
 *
 * One transaction, because the three writes are one fact. A status change with
 * no version leaves no record of what the story said when it changed, and a
 * change with no audit entry leaves no record of who changed it — either on
 * its own is worse than the change not happening.
 *
 * `published_at` is set and cleared here rather than by the caller: the CHECK
 * constraint in migration 0001 refuses a PUBLISHED row without a timestamp and
 * a non-published row with one, so the two must move together.
 */
export async function transitionStory(
  db: Db,
  params: {
    slug: string
    to: NewsStatus
    actorId: string
    actorRole?: string | null
    note?: string
    ip?: string | null
    requestId?: string
  },
): Promise<TransitionOutcome> {
  return transaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; status: NewsStatus; title: string; standfirst: string }>(
      // FOR UPDATE: two editors acting at once must serialise, or the second
      // version number collides with the first and the unique index refuses it.
      'SELECT id, status, title, standfirst FROM news WHERE slug = $1 FOR UPDATE',
      [params.slug],
    )

    const story = rows[0]
    if (story === undefined) return { status: 'NOT_FOUND' }
    if (story.status === params.to) return { status: 'NO_CHANGE', current: story.status }

    const from = story.status
    const publishing = params.to === 'PUBLISHED'

    await tx.query(
      `UPDATE news
          SET status = $2,
              published_at = CASE WHEN $3 THEN coalesce(published_at, now()) ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [story.id, params.to, publishing],
    )

    const { rows: versionRows } = await tx.query<{ next: string }>(
      'SELECT coalesce(max(version), 0)::text AS next FROM news_versions WHERE news_id = $1',
      [story.id],
    )
    const nextVersion = Number(versionRows[0]?.next ?? '0') + 1

    // The body is carried forward from the latest version. A transition does
    // not edit copy; recording the copy as it stood is what makes the version
    // history answer "what did this say when it was published".
    const { rows: bodyRows } = await tx.query<{ body: string[] }>(
      'SELECT body FROM news_versions WHERE news_id = $1 ORDER BY version DESC LIMIT 1',
      [story.id],
    )
    const body = bodyRows[0]?.body ?? [story.standfirst === '' ? story.title : story.standfirst]

    await tx.query(
      `INSERT INTO news_versions (news_id, version, title, standfirst, body, status, author_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        story.id,
        nextVersion,
        story.title,
        story.standfirst,
        body,
        params.to,
        params.actorId,
        params.note ?? '',
      ],
    )

    await recordAudit(tx, {
      actorId: params.actorId,
      actorRole: params.actorRole ?? null,
      action: publishing ? 'NEWS_PUBLISHED' : 'NEWS_STATUS_CHANGED',
      resourceType: 'news',
      resourceId: params.slug,
      before: { status: from },
      after: { status: params.to, version: nextVersion },
      ip: params.ip,
      requestId: params.requestId,
    })

    return { status: 'CHANGED', from, to: params.to }
  })
}

// -------------------------------------------------------------------- admin

export interface PlatformSummary {
  users: number
  reporters: number
  published: number
  unpublished: number
  liveSessions: number
  auditEvents: number
  failedSignInsToday: number
}

/** Counts for the admin command centre. Every one is a real count (§42). */
export async function platformSummary(db: Db): Promise<PlatformSummary> {
  const { rows } = await db.query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM users)::text                                          AS users,
       (SELECT count(*) FROM reporters)::text                                      AS reporters,
       (SELECT count(*) FROM news WHERE status = 'PUBLISHED')::text                AS published,
       (SELECT count(*) FROM news WHERE status <> 'PUBLISHED')::text               AS unpublished,
       (SELECT count(*) FROM sessions
          WHERE revoked_at IS NULL AND expires_at > now())::text                   AS live_sessions,
       (SELECT count(*) FROM audit_events)::text                                   AS audit_events,
       (SELECT count(*) FROM login_attempts
          WHERE NOT succeeded AND created_at > now() - interval '24 hours')::text  AS failed_signins`,
  )

  const row = rows[0] ?? {}
  const n = (key: string) => Number(row[key] ?? '0')

  return {
    users: n('users'),
    reporters: n('reporters'),
    published: n('published'),
    unpublished: n('unpublished'),
    liveSessions: n('live_sessions'),
    auditEvents: n('audit_events'),
    failedSignInsToday: n('failed_signins'),
  }
}

export interface AuditEntry {
  action: string
  resourceType: string
  resourceId: string
  actorEmail: string | null
  createdAt: string
}

export async function recentAudit(db: Db, limit = 25): Promise<AuditEntry[]> {
  const { rows } = await db.query<{
    action: string
    resource_type: string
    resource_id: string
    email: string | null
    created_at: Date | string
  }>(
    `SELECT a.action, a.resource_type, a.resource_id, u.email, a.created_at
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  )

  return rows.map((row) => ({
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    actorEmail: row.email,
    createdAt: iso(row.created_at) ?? '',
  }))
}

export interface AccountRow {
  id: string
  email: string
  displayName: string
  status: string
  roles: string[]
  createdAt: string
}

export async function listAccounts(db: Db, limit = 50): Promise<AccountRow[]> {
  const { rows } = await db.query<{
    id: string
    email: string
    display_name: string
    status: string
    roles: string[] | null
    created_at: Date | string
  }>(
    `SELECT u.id, u.email, u.display_name, u.status,
            array_remove(array_agg(DISTINCT ur.role_key) FILTER (WHERE ur.revoked_at IS NULL), NULL) AS roles,
            u.created_at
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  )

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    roles: row.roles ?? [],
    createdAt: iso(row.created_at) ?? '',
  }))
}
