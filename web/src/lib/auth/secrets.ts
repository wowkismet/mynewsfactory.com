/**
 * Auth secrets, read from the environment (§51).
 *
 * Kept separate from `readEnv` and resolved lazily: the portal does not use
 * authentication yet, so requiring these at startup would stop a running site
 * for a feature it never calls. The moment any auth code path runs, a missing
 * or weak key fails loudly rather than defaulting to something usable.
 */

const MIN_KEY_BYTES = 32

/**
 * Where the keys are read from.
 *
 * The framework augments NodeJS.ProcessEnv without an index signature, so a
 * narrower structural type would not accept `process.env` itself. Callers that
 * need to override -- tests -- spread the real environment and replace the two
 * variables, which is also what a deployment does.
 */
export type SecretSource = NodeJS.ProcessEnv

export interface AuthSecrets {
  /** HMAC key for identifier and address hashes. Never leaves the server. */
  pepper: Buffer
  /** AES-256-GCM key protecting TOTP secrets at rest. */
  mfaKey: Buffer
}

class AuthSecretError extends Error {
  constructor(message: string) {
    super(`${message}\nGenerate one with: openssl rand -base64 32`)
    this.name = 'AuthSecretError'
  }
}

function readKey(name: string, raw: string | undefined): Buffer {
  if (raw === undefined || raw === '') {
    throw new AuthSecretError(`${name} is not set.`)
  }

  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new AuthSecretError(`${name} is not valid base64.`)
  }

  if (key.length < MIN_KEY_BYTES) {
    throw new AuthSecretError(
      `${name} decodes to ${key.length.toString()} bytes; at least ${MIN_KEY_BYTES.toString()} are required.`,
    )
  }

  return key
}

let cached: AuthSecrets | null = null

export function authSecrets(source: SecretSource = process.env): AuthSecrets {
  if (cached !== null) return cached

  const secrets: AuthSecrets = {
    pepper: readKey('AUTH_TOKEN_PEPPER', source.AUTH_TOKEN_PEPPER),
    mfaKey: readKey('MFA_ENCRYPTION_KEY', source.MFA_ENCRYPTION_KEY),
  }

  // The same value for both would make one compromise two.
  if (secrets.pepper.equals(secrets.mfaKey)) {
    throw new AuthSecretError('AUTH_TOKEN_PEPPER and MFA_ENCRYPTION_KEY must differ.')
  }

  cached = secrets
  return secrets
}

/** Test seam: forget the cached keys so a test can supply its own. */
export function resetAuthSecrets(): void {
  cached = null
}
