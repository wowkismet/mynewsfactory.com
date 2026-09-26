/**
 * Tests for the credential primitives: password hashing, token digests,
 * sealed secrets and recovery codes.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken, keyedHash, safeEqual } from './hashing'
import { hashPassword, MAX_PASSWORD_BYTES, needsRehash, PasswordTooLongError, verifyPassword } from './password'
import { generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_COUNT } from './recovery'
import type { SecretSource } from './secrets'
import { resetAuthSecrets } from './secrets'
import { open, seal, SealedValueError } from './sealed'

// Test keys. Real ones come from the environment and are never committed.
const ENV: SecretSource = {
  ...process.env,
  AUTH_TOKEN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
}

beforeEach(() => {
  resetAuthSecrets()
})

describe('password hashing', () => {
  it('produces an argon2id hash, not some other algorithm', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('uses at least the OWASP parameters', async () => {
    const hash = await hashPassword('correct horse battery staple')
    const match = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash)

    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(19_456)
    expect(Number(match?.[2])).toBeGreaterThanOrEqual(2)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')])
    expect(a).not.toBe(b)
  })

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple')

    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true)
    await expect(verifyPassword(hash, 'Correct horse battery staple')).resolves.toBe(false)
    await expect(verifyPassword(hash, '')).resolves.toBe(false)
  })

  it('returns false rather than throwing for a corrupted hash', async () => {
    // A corrupted row must fail closed. Throwing would surface a 500 that
    // distinguishes this account from one that does not exist.
    for (const bad of ['', 'not-a-hash', '$argon2id$garbage', '$2y$10$bcryptstyle']) {
      await expect(verifyPassword(bad, 'anything')).resolves.toBe(false)
    }
  })

  it('rejects an oversized password rather than silently truncating it', async () => {
    const huge = 'a'.repeat(MAX_PASSWORD_BYTES + 1)
    await expect(hashPassword(huge)).rejects.toThrow(PasswordTooLongError)
  })

  it('accepts a password exactly at the limit', async () => {
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_BYTES))).resolves.toContain('$argon2id$')
  })

  it('handles non-ASCII passphrases by bytes, not characters', async () => {
    const passphrase = 'ओम् शान्ति शान्ति'
    const hash = await hashPassword(passphrase)
    await expect(verifyPassword(hash, passphrase)).resolves.toBe(true)
  })

  describe('needsRehash', () => {
    it('is false for a hash at current policy', async () => {
      expect(needsRehash(await hashPassword('x'))).toBe(false)
    })

    it('is true for weaker parameters', () => {
      expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$aGFzaA')).toBe(true)
    })

    it('is true for anything unrecognised, so an unknown format is replaced', () => {
      expect(needsRehash('$2y$10$bcrypt')).toBe(true)
      expect(needsRehash('')).toBe(true)
    })
  })
})

describe('token hashing', () => {
  it('generates 256 bits, URL-safe', () => {
    const token = generateToken()
    expect(Buffer.from(token, 'base64url').length).toBe(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 100 }, generateToken)).size).toBe(100)
  })

  it('hashes to a stable 64-character digest', () => {
    const token = generateToken()
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('gives different digests for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })

  describe('keyedHash', () => {
    it('is stable for the same value and key', () => {
      expect(keyedHash('user@example.com', ENV)).toBe(keyedHash('user@example.com', ENV))
    })

    it('differs from the unkeyed digest, so the table is not a rainbow lookup', () => {
      expect(keyedHash('user@example.com', ENV)).not.toBe(hashToken('user@example.com'))
    })

    it('changes completely with the key', () => {
      const other = { ...ENV, AUTH_TOKEN_PEPPER: Buffer.alloc(32, 9).toString('base64') }
      resetAuthSecrets()
      const a = keyedHash('203.0.113.7', other)
      resetAuthSecrets()
      const b = keyedHash('203.0.113.7', ENV)

      expect(a).not.toBe(b)
    })
  })

  describe('safeEqual', () => {
    it('is true for identical strings and false otherwise', () => {
      expect(safeEqual('abc', 'abc')).toBe(true)
      expect(safeEqual('abc', 'abd')).toBe(false)
    })

    it('handles differing lengths without throwing', () => {
      expect(safeEqual('a', 'a much longer value')).toBe(false)
    })
  })
})

describe('sealed secrets', () => {
  it('round-trips a TOTP secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    expect(open(seal(secret, ENV), ENV)).toBe(secret)
  })

  it('produces a different ciphertext each time, so equal secrets are not visible as equal', () => {
    expect(seal('same', ENV)).not.toBe(seal('same', ENV))
  })

  it('does not contain the plaintext', () => {
    expect(seal('JBSWY3DPEHPK3PXP', ENV)).not.toContain('JBSWY3DPEHPK3PXP')
  })

  /** Flips one bit in the given part of a sealed value. */
  function tamper(sealed: string, index: number): string {
    const parts = sealed.split('.')
    const decoded = Buffer.from(parts[index] ?? '', 'base64url')
    decoded.writeUInt8(decoded.readUInt8(0) ^ 0xff, 0)
    parts[index] = decoded.toString('base64url')
    return parts.join('.')
  }

  it('refuses a tampered ciphertext', () => {
    expect(() => open(tamper(seal('JBSWY3DPEHPK3PXP', ENV), 3), ENV)).toThrow(SealedValueError)
  })

  it('refuses a tampered tag', () => {
    expect(() => open(tamper(seal('JBSWY3DPEHPK3PXP', ENV), 2), ENV)).toThrow(SealedValueError)
  })

  it('refuses a tampered nonce', () => {
    expect(() => open(tamper(seal('JBSWY3DPEHPK3PXP', ENV), 1), ENV)).toThrow(SealedValueError)
  })

  it('refuses a value sealed with a different key', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', ENV)
    resetAuthSecrets()
    const otherKey = { ...ENV, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }

    expect(() => open(sealed, otherKey)).toThrow(SealedValueError)
  })

  it.each([
    ['empty', ''],
    ['not sealed', 'plain text'],
    ['wrong part count', 'v1.aaa.bbb'],
    ['unknown version', 'v2.aaa.bbb.ccc'],
  ])('refuses a malformed value: %s', (_name, value) => {
    expect(() => open(value, ENV)).toThrow(SealedValueError)
  })
})

describe('recovery codes', () => {
  it('generates the configured number', () => {
    expect(generateRecoveryCodes().plaintext.length).toBe(RECOVERY_CODE_COUNT)
  })

  it('returns a hash for every code and no duplicates', () => {
    const { plaintext, hashes } = generateRecoveryCodes()

    expect(hashes.length).toBe(plaintext.length)
    expect(new Set(plaintext).size).toBe(plaintext.length)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('uses an alphabet without easily confused characters', () => {
    for (const code of generateRecoveryCodes().plaintext) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
      expect(code).not.toMatch(/[ILOU]/)
    }
  })

  it('hashes the normalised form, so transcription does not lock someone out', () => {
    const [code] = generateRecoveryCodes().plaintext
    if (code === undefined) throw new Error('no code generated')

    const expected = hashRecoveryCode(code)
    expect(hashRecoveryCode(code.toLowerCase())).toBe(expected)
    expect(hashRecoveryCode(code.replace('-', ''))).toBe(expected)
    expect(hashRecoveryCode(` ${code} `)).toBe(expected)
  })

  it('normalises away separators and case but not the characters themselves', () => {
    expect(normaliseRecoveryCode('ab-cd1')).toBe('ABCD1')
  })

  it('does not store the code itself', () => {
    const { plaintext, hashes } = generateRecoveryCodes()
    for (const [i, code] of plaintext.entries()) {
      expect(hashes[i]).not.toContain(code)
      expect(hashes[i]).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
