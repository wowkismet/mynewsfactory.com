/**
 * A real PostgreSQL instance for tests.
 *
 * PGlite is PostgreSQL itself compiled to WebAssembly, running in-process. The
 * tests therefore exercise real constraints, real triggers, real enum types and
 * real row-value comparisons -- not a mock's impression of them. A test that
 * passes here would pass against a server.
 *
 * Each call gets its own empty in-memory database, so tests neither share state
 * nor need cleanup.
 */

import { PGlite } from '@electric-sql/pglite'
import path from 'node:path'
import type { Db } from './client'
import { migrate } from './migrate'

export interface TestDb extends Db {
  close: () => Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite()

  const db: Db = {
      // The row type is the caller's assertion about the columns this SQL
      // returns. No type system can check a claim about a string against the
      // database, so the rule's objection is correct -- and unavoidable for a
      // SQL driver. Keeping it explicit here is better than an `any` that
      // spreads silently into every call site.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    query: async <R,>(text: string, params?: readonly unknown[]) => {
      // node-postgres runs a parameterless statement through the simple query
      // protocol, which accepts several statements at once; a parameterised one
      // goes through the extended protocol, which accepts exactly one. PGlite
      // splits those across two methods. Matching the same rule here keeps the
      // adapter faithful rather than convenient -- a migration file must behave
      // identically under both drivers.
      if (params === undefined || params.length === 0) {
        const results = await pglite.exec(text)
        const last = results.at(-1)
        return { rows: (last?.rows ?? []) as R[] }
      }

      const result = await pglite.query<R>(text, params as unknown[])
      return { rows: result.rows }
    },
  }

  await migrate(db, path.join(process.cwd(), 'migrations'))

  return {
    query: db.query,
    close: async () => {
      await pglite.close()
    },
  }
}
