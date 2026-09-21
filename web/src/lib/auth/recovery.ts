/**
 * MFA recovery codes (§7).
 *
 * Ten single-use codes, shown once at enrolment and stored only as digests.
 * They are the path back in when a phone is lost, which also makes them a
 * standing bypass of the second factor -- so they are high entropy, single
 * use, and their consumption is an audited event.
 */

import { randomInt } from 'node:crypto'
import { hashToken } from './hashing'

export const RECOVERY_CODE_COUNT = 10

/**
 * Crockford base32 without I, L, O or U: no character pairs that are easy to
 * confuse when read off paper, and no accidental words.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const GROUPS = 2
const GROUP_LENGTH = 5

/** ~50 bits per code: far beyond guessing, still short enough to write down. */
function generateCode(): string {
  const groups: string[] = []
  for (let g = 0; g < GROUPS; g += 1) {
    let group = ''
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      // randomInt is rejection-sampled, so the distribution is uniform --
      // randomBytes % length would not be.
      group += ALPHABET.charAt(randomInt(ALPHABET.length))
    }
    groups.push(group)
  }
  return groups.join('-')
}

export interface RecoveryCodes {
  /** Shown to the person once. Never stored, never logged. */
  plaintext: string[]
  /** What goes in the database. */
  hashes: string[]
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): RecoveryCodes {
  const plaintext = Array.from({ length: count }, generateCode)
  return { plaintext, hashes: plaintext.map((code) => hashToken(normaliseRecoveryCode(code))) }
}

/**
 * Normalises a submitted code before hashing: case and separators vary with
 * how it was transcribed, and none of that should decide whether someone can
 * recover their account.
 */
export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export function hashRecoveryCode(code: string): string {
  return hashToken(normaliseRecoveryCode(code))
}
