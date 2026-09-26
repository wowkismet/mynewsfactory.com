/**
 * Password hashing (§7).
 *
 * Argon2id at the OWASP-recommended parameters: 19 MiB of memory, two
 * iterations, one lane. Memory hardness is the point -- it is what makes a
 * GPU or ASIC attack cost what it should.
 *
 * The stored value is a PHC string carrying its own algorithm, parameters and
 * salt, so raising the cost later needs no migration and old hashes stay
 * verifiable until their owner next signs in.
 */

import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id. The library exposes this as an ambient const enum, which
 * isolatedModules forbids importing, so the value is written out: the
 * Algorithm enum is Argon2d = 0, Argon2i = 1, Argon2id = 2. A test asserts
 * the stored hash actually says argon2id, so a wrong value here cannot pass
 * unnoticed.
 */
const ARGON2ID = 2

/** OWASP's Argon2id recommendation (2024). Raise, never lower. */
export const ARGON2_PARAMS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * Upper bound on what will be hashed.
 *
 * Argon2 is not vulnerable to the long-input denial of service that affects
 * bcrypt, but there is no reason to spend memory and time on a megabyte of
 * submitted text. Rejected rather than truncated: silently ignoring the tail
 * of a passphrase weakens it without telling anyone.
 */
export const MAX_PASSWORD_BYTES = 1024

export class PasswordTooLongError extends Error {
  constructor() {
    super(`Password exceeds ${MAX_PASSWORD_BYTES.toString()} bytes.`)
    this.name = 'PasswordTooLongError'
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new PasswordTooLongError()
  }
  return hash(password, ARGON2_PARAMS)
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing for a malformed or unknown-algorithm
 * hash: a corrupted row must fail closed, not produce a 500 that tells an
 * attacker the account exists.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return false

  try {
    return await verify(storedHash, password)
  } catch {
    return false
  }
}

/**
 * Whether a stored hash was produced with weaker parameters than current
 * policy, and should be replaced on the next successful sign-in.
 */
export function needsRehash(storedHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash)
  if (match === null) return true

  const [, memory, time, lanes] = match
  return (
    Number(memory) < ARGON2_PARAMS.memoryCost ||
    Number(time) < ARGON2_PARAMS.timeCost ||
    Number(lanes) < ARGON2_PARAMS.parallelism
  )
}
