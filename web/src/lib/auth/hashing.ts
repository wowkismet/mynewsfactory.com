/**
 * Token hashing and comparison.
 *
 * Two distinct jobs, deliberately not confused:
 *
 *   - `hashToken` digests a high-entropy token the server issued. SHA-256 with
 *     no salt is correct here: the input is 256 random bits, so there is
 *     nothing to brute-force, and an unsalted digest is what makes a lookup by
 *     token possible at all.
 *   - `keyedHash` covers low-entropy values -- an email address, an IP -- where
 *     an unkeyed digest would be trivially reversible by enumeration. The HMAC
 *     key lives in the environment, so the table alone reveals nothing.
 *
 * Passwords use neither; see password.ts.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SecretSource } from './secrets'
import { authSecrets } from './secrets'

/** 256 bits of entropy, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Digest of a server-issued token, for storage and lookup. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Keyed digest of a low-entropy value. Used for email addresses in the
 * attempt log and for IP addresses everywhere (§57): enough to group and
 * rate-limit, never enough to recover the address.
 */
export function keyedHash(value: string, env: SecretSource = process.env): string {
  return createHmac('sha256', authSecrets(env).pepper).update(value, 'utf8').digest('hex')
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak
 * length, so both sides are digested to a fixed width first.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest()
  const right = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(left, right)
}
