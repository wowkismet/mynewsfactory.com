/**
 * Time-based one-time passwords, RFC 6238 (§7).
 *
 * Implemented here rather than taken as a dependency. The algorithm is about
 * forty lines of HMAC and arithmetic, the RFC publishes test vectors that
 * prove an implementation correct, and a second-factor check is a poor place
 * to inherit an unaudited package. `totp.test.ts` runs every vector from the
 * RFC for all three digests.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512'

export interface TotpOptions {
  /** Seconds per step. RFC 6238 recommends 30. */
  period?: number
  digits?: number
  algorithm?: TotpAlgorithm
}

const DEFAULTS = { period: 30, digits: 6, algorithm: 'sha1' as TotpAlgorithm }

/**
 * SHA-1 is the default deliberately: RFC 6238's default and what every
 * authenticator app implements. Its weakness is collision resistance, which
 * HMAC does not rely on, so HMAC-SHA1 remains sound here. The option exists
 * for callers that control both ends.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function toBase32(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      // charAt, not indexing: the mask guarantees 0-31, but charAt returns
      // string rather than string | undefined, so the guarantee is expressed
      // in the type instead of asserted away.
      out += BASE32.charAt((value >>> (bits - 5)) & 31)
      bits -= 5
    }
  }

  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31)
  return out
}

export function fromBase32(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')

  let bits = 0
  let value = 0
  const out: number[] = []

  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`)

    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(out)
}

/** A fresh 160-bit secret, the width RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return toBase32(randomBytes(20))
}

/** The counter value for a moment in time. */
export function stepFor(atMs: number, period: number = DEFAULTS.period): number {
  return Math.floor(atMs / 1000 / period)
}

/** The HOTP code for a counter value (RFC 4226 §5.3). */
export function hotp(secret: Buffer, counter: number, options: TotpOptions = {}): string {
  const digits = options.digits ?? DEFAULTS.digits
  const algorithm = options.algorithm ?? DEFAULTS.algorithm

  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac(algorithm, secret).update(message).digest()

  // Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte picks
  // a four-byte window, and the top bit is masked off so the result is
  // positive regardless of how the platform treats the sign.
  const offset = digest.readUInt8(digest.length - 1) & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff

  return (binary % 10 ** digits).toString().padStart(digits, '0')
}

/** The code for a base32 secret at a moment in time. */
export function totp(secretBase32: string, atMs: number, options: TotpOptions = {}): string {
  return hotp(fromBase32(secretBase32), stepFor(atMs, options.period ?? DEFAULTS.period), options)
}

export interface VerifyResult {
  valid: boolean
  /** The step the code matched, so the caller can reject a replay of it. */
  step: number | null
}

export interface VerifyOptions extends TotpOptions {
  /**
   * Steps of clock skew accepted either side. One step (±30s) is the usual
   * compromise; more widens the window an intercepted code stays usable in.
   */
  window?: number
  /**
   * The last step this credential accepted. A code at or before it is a
   * replay within its own validity window and is refused.
   */
  lastStep?: number | null
}

/**
 * Verifies a submitted code.
 *
 * Every candidate step is evaluated before returning, so the time taken does
 * not reveal which step matched. Comparison is constant-time.
 */
export function verifyTotp(
  secretBase32: string,
  submitted: string,
  atMs: number,
  options: VerifyOptions = {},
): VerifyResult {
  const digits = options.digits ?? DEFAULTS.digits
  const window = options.window ?? 1
  const period = options.period ?? DEFAULTS.period
  const lastStep = options.lastStep ?? null

  const cleaned = submitted.replace(/\s/g, '')
  if (!new RegExp(`^\\d{${digits.toString()}}$`).test(cleaned)) return { valid: false, step: null }

  const secret = fromBase32(secretBase32)
  const current = stepFor(atMs, period)

  let matched: number | null = null
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset
    if (step < 0) continue

    const candidate = hotp(secret, step, { digits, algorithm: options.algorithm, period })
    const same = timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(cleaned, 'utf8'))

    // No early exit: a match still runs the remaining iterations.
    if (same && matched === null) matched = step
  }

  if (matched === null) return { valid: false, step: null }
  if (lastStep !== null && matched <= lastStep) return { valid: false, step: null }

  return { valid: true, step: matched }
}

/** The otpauth:// URI an authenticator app scans. */
export function otpauthUri(params: {
  secretBase32: string
  account: string
  issuer: string
  options?: TotpOptions
}): string {
  const { secretBase32, account, issuer, options = {} } = params
  const query = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: (options.algorithm ?? DEFAULTS.algorithm).toUpperCase(),
    digits: (options.digits ?? DEFAULTS.digits).toString(),
    period: (options.period ?? DEFAULTS.period).toString(),
  })

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${query.toString()}`
}
