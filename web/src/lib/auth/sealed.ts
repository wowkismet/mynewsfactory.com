/**
 * Authenticated encryption for secrets held in the database (§9).
 *
 * AES-256-GCM. The key lives in the environment and never in a row, so a
 * database dump on its own cannot produce a valid TOTP code.
 *
 * The sealed form is `v1.<iv>.<tag>.<ciphertext>`, all base64url. Versioning
 * the prefix means a future key rotation or algorithm change can be told
 * apart from the current one rather than guessed at.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SecretSource } from './secrets'
import { authSecrets } from './secrets'

const VERSION = 'v1'
const IV_BYTES = 12 // 96 bits, the width GCM is specified for
const TAG_BYTES = 16

export function seal(plaintext: string, env: SecretSource = process.env): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', authSecrets(env).mfaKey.subarray(0, 32), iv)

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export class SealedValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealedValueError'
  }
}

/**
 * Opens a sealed value.
 *
 * Throws on any tampering: GCM's tag makes a modified ciphertext
 * indistinguishable from a wrong key, and both must fail rather than return
 * plausible bytes.
 */
export function open(sealed: string, env: SecretSource = process.env): string {
  const parts = sealed.split('.')
  if (parts.length !== 4) throw new SealedValueError('Sealed value is malformed.')

  const [version, ivPart, tagPart, bodyPart] = parts as [string, string, string, string]
  if (version !== VERSION) throw new SealedValueError(`Unknown sealed value version: ${version}`)

  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SealedValueError('Sealed value has the wrong shape.')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', authSecrets(env).mfaKey.subarray(0, 32), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(Buffer.from(bodyPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new SealedValueError('Sealed value failed authentication.')
  }
}
