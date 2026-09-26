/**
 * The production database connection.
 *
 * A single pool per process, created lazily on first use so that importing this
 * module never opens a connection -- a build that prerenders pages should not
 * connect unless a page actually reads.
 */

import { Pool } from 'pg'
import type { Db } from './client'
import { readEnv } from '../env'

let pool: Pool | null = null

export function getPool(): Pool {
  if (pool !== null) return pool

  const env = readEnv()

  pool = new Pool({
    connectionString: env.databaseUrl,
    // Bounded so a burst of requests queues rather than exhausting the
    // server's connection slots, which would take the site down more
    // thoroughly than the queueing ever could.
    max: Number(process.env.DATABASE_POOL_MAX ?? '10'),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // A query that has not returned in 15s is not going to; failing it frees
    // the connection for work that can succeed.
    statement_timeout: 15_000,
    // TLS is required unless the connection string explicitly opts out, which
    // is only appropriate for a loopback development database.
    ssl: env.databaseUrl.includes('sslmode=disable') ? undefined : { rejectUnauthorized: true },
  })

  // An idle client erroring is a connection-level fault, not a query fault. It
  // arrives with no query to attach it to, so it must be handled here or it
  // becomes an unhandled 'error' event and takes the process down.
  pool.on('error', (error) => {
    console.error('[db] idle client error', { message: error.message })
  })

  return pool
}

/** The application's database handle. */
export function db(): Db {
  const p = getPool()
  return {
      // The row type is the caller's assertion about the columns this SQL
      // returns. No type system can check a claim about a string against the
      // database, so the rule's objection is correct -- and unavoidable for a
      // SQL driver. Keeping it explicit here is better than an `any` that
      // spreads silently into every call site.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    query: async <R,>(text: string, params?: readonly unknown[]) => {
      const result = await p.query(text, params as unknown[] | undefined)
      return { rows: result.rows as R[] }
    },
  }
}

/** Closes the pool. For scripts and tests; the server keeps it for its lifetime. */
export async function closePool(): Promise<void> {
  if (pool === null) return
  const current = pool
  pool = null
  await current.end()
}
