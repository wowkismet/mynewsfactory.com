/**
 * TOTP tests.
 *
 * The first block is RFC 6238 Appendix B verbatim -- every published vector,
 * for all three digests. If this implementation disagrees with the RFC, these
 * fail. That is the reason it is written here rather than taken from a
 * package: correctness is provable rather than assumed.
 */

import { describe, expect, it } from 'vitest'
import {
  fromBase32,
  generateTotpSecret,
  hotp,
  otpauthUri,
  stepFor,
  toBase32,
  totp,
  verifyTotp,
} from './totp'

// RFC 6238 Appendix B. The seeds are ASCII "1234567890" repeated to the width
// of the digest: 20 bytes for SHA-1, 32 for SHA-256, 64 for SHA-512. Built
// from the ASCII rather than transcribed as hex -- the first attempt at this
// got the SHA-512 seed's length wrong, and the vectors caught it.
const seed = (bytes: number): Buffer =>
  Buffer.from('1234567890'.repeat(Math.ceil(bytes / 10)).slice(0, bytes), 'ascii')

const SEED_SHA1 = seed(20)
const SEED_SHA256 = seed(32)
const SEED_SHA512 = seed(64)

const RFC_VECTORS: [seconds: number, sha1: string, sha256: string, sha512: string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1_111_111_109, '07081804', '68084774', '25091201'],
  [1_111_111_111, '14050471', '67062674', '99943326'],
  [1_234_567_890, '89005924', '91819424', '93441116'],
  [2_000_000_000, '69279037', '90698825', '38618901'],
  [20_000_000_000, '65353130', '77737706', '47863826'],
]

describe('RFC 6238 test vectors', () => {
  it.each(RFC_VECTORS)('at T=%i produces the published codes', (seconds, sha1, sha256, sha512) => {
    const counter = stepFor(seconds * 1000, 30)

    expect(hotp(SEED_SHA1, counter, { digits: 8, algorithm: 'sha1' })).toBe(sha1)
    expect(hotp(SEED_SHA256, counter, { digits: 8, algorithm: 'sha256' })).toBe(sha256)
    expect(hotp(SEED_SHA512, counter, { digits: 8, algorithm: 'sha512' })).toBe(sha512)
  })
})

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const hex of ['', '00', 'ff', 'deadbeef', '3132333435363738393031323334353637383930']) {
      const input = Buffer.from(hex, 'hex')
      expect(fromBase32(toBase32(input)).toString('hex')).toBe(hex)
    }
  })

  it('accepts lowercase, padding and spacing, as apps produce them', () => {
    const secret = toBase32(Buffer.from('deadbeef', 'hex'))
    expect(fromBase32(secret.toLowerCase())).toEqual(fromBase32(secret))
    expect(fromBase32(`${secret}====`)).toEqual(fromBase32(secret))
    expect(fromBase32(secret.split('').join(' '))).toEqual(fromBase32(secret))
  })

  it('rejects a character outside the alphabet', () => {
    expect(() => fromBase32('ABC1')).toThrow(/Invalid base32/)
  })
})

describe('generateTotpSecret', () => {
  it('produces 160 bits, as RFC 4226 recommends', () => {
    expect(fromBase32(generateTotpSecret()).length).toBe(20)
  })

  it('does not repeat', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()))
    expect(secrets.size).toBe(50)
  })
})

describe('verifyTotp', () => {
  const secret = toBase32(SEED_SHA1)
  const now = 1_700_000_000_000

  it('accepts the current code', () => {
    const result = verifyTotp(secret, totp(secret, now), now)
    expect(result.valid).toBe(true)
    expect(result.step).toBe(stepFor(now))
  })

  it('accepts one step of clock skew either side', () => {
    const before = now - 30_000
    const after = now + 30_000

    expect(verifyTotp(secret, totp(secret, before), now).valid).toBe(true)
    expect(verifyTotp(secret, totp(secret, after), now).valid).toBe(true)
  })

  it('rejects a code two steps away', () => {
    expect(verifyTotp(secret, totp(secret, now - 90_000), now).valid).toBe(false)
    expect(verifyTotp(secret, totp(secret, now + 90_000), now).valid).toBe(false)
  })

  it('rejects a replay of a code already accepted', () => {
    const code = totp(secret, now)
    const first = verifyTotp(secret, code, now)
    expect(first.valid).toBe(true)

    // Same code, same window, but the credential now records the step.
    const replay = verifyTotp(secret, code, now, { lastStep: first.step })
    expect(replay.valid).toBe(false)
  })

  it('rejects a code from a step at or before the last accepted one', () => {
    const current = stepFor(now)
    const previous = totp(secret, now - 30_000)

    expect(verifyTotp(secret, previous, now, { lastStep: current }).valid).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['too short', '12345'],
    ['too long', '1234567'],
    ['letters', 'abcdef'],
    ['sql', "' OR 1=1 --"],
  ])('rejects a malformed code: %s', (_name, submitted) => {
    expect(verifyTotp(secret, submitted, now).valid).toBe(false)
  })

  it('ignores the spacing authenticator apps display', () => {
    const code = totp(secret, now)
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
    expect(verifyTotp(secret, spaced, now).valid).toBe(true)
  })

  it('rejects a code from a different secret', () => {
    const other = generateTotpSecret()
    expect(verifyTotp(secret, totp(other, now), now).valid).toBe(false)
  })
})

describe('otpauthUri', () => {
  it('carries the secret and parameters an app needs', () => {
    const uri = otpauthUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      account: 'reporter@example.com',
      issuer: 'My News Factory',
    })

    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })

  it('escapes an account containing a separator', () => {
    const uri = otpauthUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      account: 'a:b/c',
      issuer: 'My News Factory',
    })

    expect(uri).toContain('a%3Ab%2Fc')
  })
})
