/**
 * Database access (§10).
 *
 * The application talks to PostgreSQL through this narrow interface rather than
 * an ORM. Two reasons, recorded in docs/DECISIONS.md D-011: every query is
 * parameterised SQL, so injection is prevented by construction rather than by
 * an abstraction's good behaviour; and the same interface is satisfied by
 * node-postgres in production and by an in-process PostgreSQL in tests, so
 * tests run against real PostgreSQL semantics -- real constraints, real
 * triggers, real enum types -- without a mock anywhere.
 */

/** The shape both drivers return. Only `rows` is relied upon. */
export interface QueryResult<R> {
  rows: R[]
}

/**
 * The whole database contract. Anything satisfying this can back the
 * repository: node-postgres, an in-process engine, or a transaction handle.
 */
export interface Db {
  query: <R>(text: string, params?: readonly unknown[]) => Promise<QueryResult<R>>
}

/**
 * Runs `work` inside a transaction, committing on success and rolling back on
 * any thrown error. The callback receives a handle bound to the transaction, so
 * a caller cannot accidentally issue a statement outside it.
 */
export async function transaction<T>(db: Db, work: (tx: Db) => Promise<T>): Promise<T> {
  await db.query('BEGIN')
  try {
    const result = await work(db)
    await db.query('COMMIT')
    return result
  } catch (error) {
    // Rollback is best-effort: if the connection itself is gone, the original
    // error is the one worth propagating, not the failure to roll back.
    try {
      await db.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw error
  }
}
