/**
 * Migration runner (§83).
 *
 * Applies every unapplied `NNNN_name.sql` in `migrations/`, in filename order,
 * each in its own transaction. A migration that fails leaves the database
 * exactly as it was.
 *
 * Applied migrations are recorded with a checksum of their contents. If a file
 * that has already run is later edited, the next run refuses to proceed rather
 * than silently skipping it -- the situation where a developer's database and
 * production's have diverged without anyone noticing.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from './client'
import { transaction } from './client'

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/

export interface Migration {
  id: string
  filename: string
  sql: string
  checksum: string
}

export interface MigrationResult {
  applied: string[]
  skipped: string[]
}

function checksum(sql: string): string {
  // Normalise line endings so the same file checked out on another platform
  // does not look like a different migration.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

/** Default location of the migration directory, relative to the web package. */
export function migrationsDir(): string {
  return path.join(process.cwd(), 'migrations')
}

/** Reads the forward migrations from disk, in order. `.down.sql` is ignored. */
export async function loadMigrations(dir: string = migrationsDir()): Promise<Migration[]> {
  const entries = await readdir(dir)
  const files = entries.filter((name) => MIGRATION_FILE.test(name)).sort()

  const migrations: Migration[] = []
  for (const filename of files) {
    const sql = await readFile(path.join(dir, filename), 'utf8')
    const id = MIGRATION_FILE.exec(filename)?.[1] ?? filename
    migrations.push({ id, filename, sql, checksum: checksum(sql) })
  }

  // Two files claiming the same number would apply in an order that depends on
  // the rest of the name, which is not an order anyone intended.
  const ids = migrations.map((m) => m.id)
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i)
  if (duplicate !== undefined) {
    throw new Error(`Duplicate migration number ${duplicate} in ${dir}`)
  }

  return migrations
}

async function ensureRegistry(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          text PRIMARY KEY,
      filename    text        NOT NULL,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/** Applies every migration not yet recorded. Safe to run repeatedly. */
export async function migrate(db: Db, dir: string = migrationsDir()): Promise<MigrationResult> {
  await ensureRegistry(db)

  const migrations = await loadMigrations(dir)
  const { rows } = await db.query<{ id: string; filename: string; checksum: string }>(
    'SELECT id, filename, checksum FROM schema_migrations',
  )
  const already = new Map(rows.map((r) => [r.id, r]))

  const applied: string[] = []
  const skipped: string[] = []

  for (const migration of migrations) {
    const record = already.get(migration.id)

    if (record !== undefined) {
      if (record.checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.filename} has changed since it was applied. ` +
            'A migration that has run is immutable: add a new migration instead ' +
            'of editing this one.',
        )
      }
      skipped.push(migration.filename)
      continue
    }

    await transaction(db, async (tx) => {
      await tx.query(migration.sql)
      await tx.query(
        'INSERT INTO schema_migrations (id, filename, checksum) VALUES ($1, $2, $3)',
        [migration.id, migration.filename, migration.checksum],
      )
    })

    applied.push(migration.filename)
  }

  return { applied, skipped }
}
