/**
 * Rate limiting (§5, §77).
 *
 * A fixed window counter held in process memory.
 *
 * The limitation is real and worth stating plainly: this counts per instance,
 * so N instances permit N times the configured rate, and a restart forgets
 * every window. §65 puts Redis in the caching phase and the shared counter
 * belongs there. Until then the choice is between an imperfect limit and none,
 * and none is the wrong answer for the login endpoint -- a single instance is
 * what is deployed today (D-009), so today this limit is exact.
 *
 * It is also not the only brute-force control. `login_attempts` in migration
 * 0002 counts failures per account in the database, which is shared, durable,
 * and unaffected by how many instances are running. This limit protects the
 * endpoint; that one protects the account.
 */

export interface RateLimitRule {
  /** Counter namespace, so two endpoints never share a budget. */
  bucket: string
  limit: number
  windowSeconds: number
}

export interface RateLimitVerdict {
  allowed: boolean
  remaining: number
  /** Seconds until the window resets. For Retry-After. */
  resetSeconds: number
}

interface Window {
  count: number
  /** Epoch milliseconds at which this window expires. */
  expiresAt: number
}

const windows = new Map<string, Window>()

/**
 * Drops expired windows.
 *
 * Called on a fraction of requests rather than on a timer: a timer keeps the
 * process alive and has to be torn down in tests, while an unbounded Map is a
 * memory leak an attacker can drive by rotating the key. Sweeping on write
 * costs nothing amortised and needs no lifecycle.
 */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.expiresAt <= now) windows.delete(key)
  }
}

let writes = 0
const SWEEP_EVERY = 512

export function consume(
  rule: RateLimitRule,
  identity: string,
  now: number = Date.now(),
): RateLimitVerdict {
  writes += 1
  if (writes % SWEEP_EVERY === 0) sweep(now)

  const key = `${rule.bucket}:${identity}`
  const existing = windows.get(key)

  if (existing === undefined || existing.expiresAt <= now) {
    windows.set(key, { count: 1, expiresAt: now + rule.windowSeconds * 1000 })
    return { allowed: true, remaining: rule.limit - 1, resetSeconds: rule.windowSeconds }
  }

  existing.count += 1
  const resetSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000))

  if (existing.count > rule.limit) {
    return { allowed: false, remaining: 0, resetSeconds }
  }

  return { allowed: true, remaining: rule.limit - existing.count, resetSeconds }
}

/** Test seam. Never called by the server. */
export function resetRateLimits(): void {
  windows.clear()
  writes = 0
}

/**
 * The identity a limit counts against.
 *
 * Prefers the authenticated user, because that is the accountable actor and it
 * survives an address change. Falls back to the client address for anonymous
 * traffic -- which is the case that matters for login, where there is no user
 * yet by definition.
 */
export function limiterIdentity(userId: string | null, ip: string | null): string {
  if (userId !== null) return `user:${userId}`
  return `ip:${ip ?? 'unknown'}`
}
