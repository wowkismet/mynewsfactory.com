/**
 * GET /api/v1/health -- liveness and database reachability (§66).
 *
 * The one endpoint that deliberately bypasses the shared pipeline. Every other
 * route opens the database first and reports 503 if it cannot; this route's
 * entire job is to say whether that is the case, so it must answer while the
 * database is unreachable. It still returns the §83 envelope, because a health
 * check a monitor cannot parse uniformly is a health check that gets ignored.
 *
 * It exposes reachability and nothing else. No version, no host, no connection
 * string, no migration state -- an unauthenticated endpoint is not the place
 * to publish the shape of the deployment (§77).
 */

import { db } from '@/lib/db/pool'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  let database: 'up' | 'down'

  try {
    await db().query('SELECT 1')
    database = 'up'
  } catch {
    // Deliberately swallowed. The caller learns 'down'; the reason is an
    // operator's question, answered by the logs of whatever actually failed.
    database = 'down'
  }

  return new Response(JSON.stringify({ success: true, data: { status: 'ok', database } }), {
    // 200 either way: the process is alive, which is what liveness asks. A
    // monitor that needs the database reads the field. Returning 503 here
    // would make an orchestrator restart a healthy process because a
    // dependency was briefly unavailable.
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
