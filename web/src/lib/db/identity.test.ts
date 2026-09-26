/**
 * Identity tests against real PostgreSQL.
 *
 * The security cases from §53 that apply at this phase are here as executable
 * tests rather than a checklist: role escalation, scope escape, token replay,
 * refresh reuse, and the audit log's immutability.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { can, decide, require_, requiresMfa, AuthorizationError } from '../auth/rbac'
import { generateRecoveryCodes, hashRecoveryCode } from '../auth/recovery'
import { open, seal } from '../auth/sealed'
import { generateTotpSecret, totp, verifyTotp } from '../auth/totp'
import { resetAuthSecrets } from '../auth/secrets'
import {
  beginMfaEnrolment,
  consumeRecoveryCode,
  consumeUserToken,
  countLiveRecoveryCodes,
  getMfaEnrolment,
  recordMfaSuccess,
  replaceRecoveryCodes,
  createSession,
  failuresSinceLastSuccess,
  findSessionByAccessToken,
  getPasswordHash,
  grantRole,
  issueUserToken,
  LOCKOUT_THRESHOLD,
  recordAudit,
  recordLoginAttempt,
  resolveGrants,
  revokeAllSessions,
  revokeRole,
  revokeSession,
  rotateRefreshToken,
  setPassword,
  syncRoleCatalogue,
} from './identity'
import type { TestDb } from './testing'
import { createTestDb } from './testing'

let db: TestDb

/**
 * One database for the file, emptied between tests.
 *
 * Building a fresh instance per test ran the migrations 41 times and took
 * nearly two minutes. Truncating instead keeps every test isolated and brings
 * the file under ten seconds.
 *
 * Worth knowing, and the reason this is a comment rather than a convenience:
 * TRUNCATE does not fire the row-level triggers that make audit_events
 * append-only. That is a property of TRUNCATE, not a gap in the trigger, and
 * it is why the production database role must not hold the TRUNCATE privilege
 * -- see docs/DATABASE.md.
 */
const MUTABLE_TABLES = [
  'audit_events',
  'login_attempts',
  'refresh_tokens',
  'sessions',
  'user_tokens',
  'user_credentials',
  'user_roles',
  'cities',
  'states',
  'users',
]

beforeAll(async () => {
  vi.stubEnv('AUTH_TOKEN_PEPPER', Buffer.alloc(32, 3).toString('base64'))
  vi.stubEnv('MFA_ENCRYPTION_KEY', Buffer.alloc(32, 4).toString('base64'))
  resetAuthSecrets()

  db = await createTestDb()
  await syncRoleCatalogue(db)
}, 60_000)

beforeEach(async () => {
  await db.query(`TRUNCATE ${MUTABLE_TABLES.join(', ')} RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  await db.close()
  resetAuthSecrets()
  vi.unstubAllEnvs()
})

async function makeUser(email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [email, email.split('@')[0] ?? 'user'],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('user insert failed')
  return id
}

async function makeCity(slug: string): Promise<string> {
  await db.query(`INSERT INTO currencies (code, name, minor_unit) VALUES ('INR','Rupee',2) ON CONFLICT DO NOTHING`)
  await db.query(`INSERT INTO languages (code, name) VALUES ('en','English') ON CONFLICT DO NOTHING`)
  await db.query(
    `INSERT INTO countries (code, name, currency_code, default_language) VALUES ('IN','India','INR','en') ON CONFLICT DO NOTHING`,
  )
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cities (slug, name, newsroom_label, country_code) VALUES ($1, $1, $1, 'IN') RETURNING id`,
    [slug],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('city insert failed')
  return id
}

const hour = (n: number) => new Date(Date.now() + n * 3_600_000)

describe('role catalogue', () => {
  it('seeds every role and is idempotent', async () => {
    const first = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM roles')
    await syncRoleCatalogue(db)
    const second = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM roles')

    expect(Number(first.rows[0]?.count)).toBe(22)
    expect(second.rows[0]?.count).toBe(first.rows[0]?.count)
  })

  it('removes a permission from a role when code no longer grants it', async () => {
    await db.query(
      `INSERT INTO role_permissions (role_key, permission_key)
       VALUES ('READER', 'finance.payout') ON CONFLICT DO NOTHING`,
    )
    await syncRoleCatalogue(db)

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM role_permissions
        WHERE role_key = 'READER' AND permission_key = 'finance.payout'`,
    )
    expect(rows[0]?.count).toBe('0')
  })

  it('marks the platform roles privileged and the rest not', async () => {
    const { rows } = await db.query<{ key: string }>(
      `SELECT key FROM roles WHERE privileged ORDER BY key`,
    )
    const keys = rows.map((r) => r.key)

    expect(keys).toContain('FINANCE_ADMIN')
    expect(keys).toContain('SECURITY_ADMIN')
    expect(keys).not.toContain('READER')
    expect(keys).not.toContain('ADVERTISER')
  })
})

describe('credentials', () => {
  it('stores and replaces a password hash', async () => {
    const user = await makeUser('a@example.com')

    await setPassword(db, user, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA')
    expect(await getPasswordHash(db, user)).toContain('$argon2id$')

    await setPassword(db, user, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$b3RoZXI')
    expect(await getPasswordHash(db, user)).toContain('b3RoZXI')
  })

  it('refuses a hash that is not argon2id, so a weaker algorithm cannot be stored', async () => {
    const user = await makeUser('b@example.com')
    await expect(setPassword(db, user, '$2y$10$bcryptstyle')).rejects.toThrow()
  })
})

describe('single-use tokens', () => {
  it('consumes a valid token exactly once', async () => {
    const user = await makeUser('c@example.com')
    await issueUserToken(db, { userId: user, purpose: 'EMAIL_VERIFICATION', token: 'tok-1', expiresAt: hour(1) })

    expect(await consumeUserToken(db, 'tok-1', 'EMAIL_VERIFICATION')).toEqual({
      userId: user,
      purpose: 'EMAIL_VERIFICATION',
    })
    // Replay.
    expect(await consumeUserToken(db, 'tok-1', 'EMAIL_VERIFICATION')).toBeNull()
  })

  it('refuses a token used for the wrong purpose', async () => {
    const user = await makeUser('d@example.com')
    await issueUserToken(db, { userId: user, purpose: 'EMAIL_VERIFICATION', token: 'tok-2', expiresAt: hour(1) })

    expect(await consumeUserToken(db, 'tok-2', 'PASSWORD_RESET')).toBeNull()
  })

  it('refuses an expired token', async () => {
    const user = await makeUser('e@example.com')
    await issueUserToken(db, { userId: user, purpose: 'PASSWORD_RESET', token: 'tok-3', expiresAt: hour(1) })

    expect(await consumeUserToken(db, 'tok-3', 'PASSWORD_RESET', hour(2))).toBeNull()
  })

  it('supersedes the previous live token when a new one is issued', async () => {
    const user = await makeUser('f@example.com')
    await issueUserToken(db, { userId: user, purpose: 'PASSWORD_RESET', token: 'old', expiresAt: hour(1) })
    await issueUserToken(db, { userId: user, purpose: 'PASSWORD_RESET', token: 'new', expiresAt: hour(1) })

    expect(await consumeUserToken(db, 'old', 'PASSWORD_RESET')).toBeNull()
    expect(await consumeUserToken(db, 'new', 'PASSWORD_RESET')).not.toBeNull()
  })

  it('does not store the token itself', async () => {
    const user = await makeUser('g@example.com')
    await issueUserToken(db, { userId: user, purpose: 'PASSWORD_RESET', token: 'secret-value', expiresAt: hour(1) })

    const { rows } = await db.query<{ token_hash: string }>('SELECT token_hash FROM user_tokens')
    expect(rows[0]?.token_hash).not.toContain('secret-value')
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('sessions', () => {
  async function session(userId: string, tokens = { access: 'at-1', refresh: 'rt-1' }) {
    return createSession(db, {
      userId,
      accessToken: tokens.access,
      refreshToken: tokens.refresh,
      accessExpiresAt: hour(1),
      refreshExpiresAt: hour(24),
      ip: '203.0.113.7',
      userAgent: 'test',
    })
  }

  it('finds a live session by its access token', async () => {
    const user = await makeUser('h@example.com')
    const id = await session(user)

    const found = await findSessionByAccessToken(db, 'at-1')
    expect(found?.id).toBe(id)
    expect(found?.userId).toBe(user)
    expect(found?.mfaSatisfied).toBe(false)
  })

  it('does not find a session by an unknown token', async () => {
    await makeUser('i@example.com')
    expect(await findSessionByAccessToken(db, 'not-a-token')).toBeNull()
  })

  it('does not find an expired session', async () => {
    const user = await makeUser('j@example.com')
    await session(user)
    expect(await findSessionByAccessToken(db, 'at-1', hour(2))).toBeNull()
  })

  it('does not find a revoked session', async () => {
    const user = await makeUser('k@example.com')
    const id = await session(user)

    await revokeSession(db, id, 'signed out')
    expect(await findSessionByAccessToken(db, 'at-1')).toBeNull()
  })

  it('stores the address as a keyed hash, not the address', async () => {
    const user = await makeUser('l@example.com')
    await session(user)

    const { rows } = await db.query<{ ip_hash: string }>('SELECT ip_hash FROM sessions')
    expect(rows[0]?.ip_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]?.ip_hash).not.toContain('203.0.113')
  })

  it('requires a reason for every revocation', async () => {
    const user = await makeUser('m@example.com')
    const id = await session(user)

    await expect(revokeSession(db, id, '')).rejects.toThrow(/reason/)
  })

  it('revokes every session for an account at once', async () => {
    const user = await makeUser('n@example.com')
    await session(user, { access: 'a1', refresh: 'r1' })
    await session(user, { access: 'a2', refresh: 'r2' })

    expect(await revokeAllSessions(db, user, 'password changed')).toBe(2)
    expect(await findSessionByAccessToken(db, 'a1')).toBeNull()
    expect(await findSessionByAccessToken(db, 'a2')).toBeNull()
  })
})

describe('refresh rotation', () => {
  async function session(userId: string) {
    return createSession(db, {
      userId,
      accessToken: 'at',
      refreshToken: 'rt-first',
      accessExpiresAt: hour(1),
      refreshExpiresAt: hour(24),
    })
  }

  it('rotates a live token and issues the next one', async () => {
    const user = await makeUser('o@example.com')
    const id = await session(user)

    const result = await rotateRefreshToken(db, 'rt-first', {
      refreshToken: 'rt-second',
      refreshExpiresAt: hour(24),
    })

    expect(result).toEqual({ status: 'ROTATED', sessionId: id, userId: user })
  })

  it('refuses an unknown token', async () => {
    await makeUser('p@example.com')
    const result = await rotateRefreshToken(db, 'never-issued', {
      refreshToken: 'x',
      refreshExpiresAt: hour(24),
    })

    expect(result.status).toBe('INVALID')
  })

  it('detects reuse of a consumed token and revokes the session', async () => {
    const user = await makeUser('q@example.com')
    const id = await session(user)

    await rotateRefreshToken(db, 'rt-first', { refreshToken: 'rt-second', refreshExpiresAt: hour(24) })

    // The old token is presented again: it leaked.
    const reuse = await rotateRefreshToken(db, 'rt-first', {
      refreshToken: 'rt-third',
      refreshExpiresAt: hour(24),
    })

    expect(reuse).toEqual({ status: 'REUSE_DETECTED', sessionId: id, userId: user })

    // The session is gone, so the token the attacker also holds is worthless.
    expect(await findSessionByAccessToken(db, 'at')).toBeNull()
  })

  it('leaves at most one live refresh token per session', async () => {
    const user = await makeUser('r@example.com')
    const id = await session(user)

    await rotateRefreshToken(db, 'rt-first', { refreshToken: 'rt-second', refreshExpiresAt: hour(24) })

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM refresh_tokens WHERE session_id = $1 AND consumed_at IS NULL`,
      [id],
    )
    expect(rows[0]?.count).toBe('1')
  })

  it('records the chain, so a rotation history can be walked', async () => {
    const user = await makeUser('s@example.com')
    await session(user)
    await rotateRefreshToken(db, 'rt-first', { refreshToken: 'rt-second', refreshExpiresAt: hour(24) })

    const { rows } = await db.query<{ replaces_id: string | null }>(
      'SELECT replaces_id FROM refresh_tokens WHERE replaces_id IS NOT NULL',
    )
    expect(rows.length).toBe(1)
  })

  it('refuses a token whose session was revoked', async () => {
    const user = await makeUser('t@example.com')
    const id = await session(user)
    await revokeSession(db, id, 'signed out')

    const result = await rotateRefreshToken(db, 'rt-first', {
      refreshToken: 'rt-next',
      refreshExpiresAt: hour(24),
    })
    expect(result.status).toBe('INVALID')
  })
})

describe('authorization (§53)', () => {
  it('gives a reader no editorial power', async () => {
    const user = await makeUser('u@example.com')
    await grantRole(db, { userId: user, roleKey: 'READER', grantedBy: null })

    const grants = await resolveGrants(db, user)
    expect(can(grants, 'news.read')).toBe(true)
    expect(can(grants, 'news.publish')).toBe(false)
    expect(can(grants, 'finance.payout')).toBe(false)
    expect(can(grants, 'kyc.read')).toBe(false)
  })

  it('does not let a reporter reach administrative permissions', async () => {
    const user = await makeUser('v@example.com')
    await grantRole(db, { userId: user, roleKey: 'VERIFIED_REPORTER', grantedBy: null })

    const grants = await resolveGrants(db, user)
    expect(can(grants, 'news.submit')).toBe(true)
    expect(can(grants, 'news.publish')).toBe(false)
    expect(can(grants, 'users.suspend')).toBe(false)
    expect(can(grants, 'roles.grant')).toBe(false)
  })

  it('keeps identity documents to the one role that may read them', async () => {
    const kyc = await makeUser('w@example.com')
    const admin = await makeUser('x@example.com')
    await grantRole(db, { userId: kyc, roleKey: 'KYC_ADMIN', grantedBy: null })
    await grantRole(db, { userId: admin, roleKey: 'ADMIN', grantedBy: null })

    expect(can(await resolveGrants(db, kyc), 'kyc.read')).toBe(true)
    // Even a platform administrator does not get identity documents.
    expect(can(await resolveGrants(db, admin), 'kyc.read')).toBe(false)
  })

  it('confines a city-scoped grant to that city', async () => {
    const user = await makeUser('y@example.com')
    const mumbai = await makeCity('mumbai')
    const delhi = await makeCity('delhi')

    await grantRole(db, { userId: user, roleKey: 'EDITOR', grantedBy: null, scope: 'CITY', cityId: mumbai })
    const grants = await resolveGrants(db, user)

    expect(can(grants, 'news.publish', { cityId: mumbai })).toBe(true)
    expect(can(grants, 'news.publish', { cityId: delhi })).toBe(false)
  })

  it('refuses a scoped grant when no scope is supplied, so omitting it is not an escalation', async () => {
    const user = await makeUser('z@example.com')
    const mumbai = await makeCity('mumbai')
    await grantRole(db, { userId: user, roleKey: 'EDITOR', grantedBy: null, scope: 'CITY', cityId: mumbai })

    const grants = await resolveGrants(db, user)
    expect(can(grants, 'news.publish')).toBe(false)
    expect(decide(grants, 'news.publish').reason).toMatch(/outside the requested scope/)
  })

  it('confines a country-scoped grant to that country', async () => {
    const user = await makeUser('aa@example.com')
    await makeCity('mumbai')
    await grantRole(db, {
      userId: user, roleKey: 'EDITOR', grantedBy: null, scope: 'COUNTRY', countryCode: 'IN',
    })

    const grants = await resolveGrants(db, user)
    expect(can(grants, 'news.publish', { countryCode: 'IN' })).toBe(true)
    expect(can(grants, 'news.publish', { countryCode: 'AE' })).toBe(false)
  })

  it('takes effect immediately when a role is revoked', async () => {
    const user = await makeUser('bb@example.com')
    const grantId = await grantRole(db, { userId: user, roleKey: 'EDITOR', grantedBy: null })

    expect(can(await resolveGrants(db, user), 'news.publish')).toBe(true)
    await revokeRole(db, grantId)
    expect(can(await resolveGrants(db, user), 'news.publish')).toBe(false)
  })

  it('requires MFA for a privileged role and not for a reader', async () => {
    const admin = await makeUser('cc@example.com')
    const reader = await makeUser('dd@example.com')
    await grantRole(db, { userId: admin, roleKey: 'FINANCE_ADMIN', grantedBy: null })
    await grantRole(db, { userId: reader, roleKey: 'READER', grantedBy: null })

    expect(requiresMfa(await resolveGrants(db, admin))).toBe(true)
    expect(requiresMfa(await resolveGrants(db, reader))).toBe(false)
  })

  it('throws for a denied permission without naming it to the caller', async () => {
    const user = await makeUser('ee@example.com')
    await grantRole(db, { userId: user, roleKey: 'READER', grantedBy: null })
    const grants = await resolveGrants(db, user)

    expect(() => require_(grants, 'finance.payout')).toThrow(AuthorizationError)
  })

  it('refuses a grant whose scope and target disagree', async () => {
    const user = await makeUser('ff@example.com')
    // Scope says country, but a city is supplied: the schema rejects it.
    await expect(
      grantRole(db, { userId: user, roleKey: 'EDITOR', grantedBy: null, scope: 'COUNTRY', cityId: null }),
    ).rejects.toThrow()
  })
})

describe('audit log', () => {
  it('records an event with its actor and resource', async () => {
    const user = await makeUser('gg@example.com')
    await recordAudit(db, {
      actorId: user,
      actorRole: 'ADMIN',
      action: 'ROLE_GRANTED',
      resourceType: 'USER',
      resourceId: user,
      after: { role: 'EDITOR' },
      ip: '203.0.113.7',
    })

    const { rows } = await db.query<{ action: string; ip_hash: string; after_state: unknown }>(
      'SELECT action, ip_hash, after_state FROM audit_events',
    )
    expect(rows[0]?.action).toBe('ROLE_GRANTED')
    expect(rows[0]?.ip_hash).not.toContain('203.0.113')
  })

  it('cannot be updated or deleted', async () => {
    const user = await makeUser('hh@example.com')
    await recordAudit(db, { actorId: user, action: 'TESTED', resourceType: 'THING' })

    await expect(db.query(`UPDATE audit_events SET action = 'REWRITTEN'`)).rejects.toThrow(/append-only/)
    await expect(db.query('DELETE FROM audit_events')).rejects.toThrow(/append-only/)
  })

  it('refuses an action name that is not a constant', async () => {
    const user = await makeUser('ii@example.com')
    await expect(
      recordAudit(db, { actorId: user, action: 'lowercase action', resourceType: 'THING' }),
    ).rejects.toThrow()
  })
})

describe('MFA enrolment', () => {
  it('stores the secret sealed, never in the clear', async () => {
    const user = await makeUser('mfa1@example.com')
    const secret = generateTotpSecret()
    await beginMfaEnrolment(db, user, seal(secret))

    const { rows } = await db.query<{ secret_encrypted: string }>(
      'SELECT secret_encrypted FROM mfa_credentials',
    )
    expect(rows[0]?.secret_encrypted).not.toContain(secret)
    expect(rows[0]?.secret_encrypted.startsWith('v1.')).toBe(true)

    // And it opens back to the original.
    const enrolment = await getMfaEnrolment(db, user)
    expect(open(enrolment?.secretSealed ?? '')).toBe(secret)
  })

  it('is unconfirmed until a code has been accepted', async () => {
    const user = await makeUser('mfa2@example.com')
    await beginMfaEnrolment(db, user, seal(generateTotpSecret()))
    expect((await getMfaEnrolment(db, user))?.confirmed).toBe(false)

    await recordMfaSuccess(db, user, 12345)
    expect((await getMfaEnrolment(db, user))?.confirmed).toBe(true)
  })

  it('clears confirmation when enrolment restarts, so an abandoned secret cannot be completed later', async () => {
    const user = await makeUser('mfa3@example.com')
    await beginMfaEnrolment(db, user, seal(generateTotpSecret()))
    await recordMfaSuccess(db, user, 100)

    await beginMfaEnrolment(db, user, seal(generateTotpSecret()))
    const enrolment = await getMfaEnrolment(db, user)

    expect(enrolment?.confirmed).toBe(false)
    expect(enrolment?.lastStep).toBeNull()
  })

  it('records the accepted step, which is what blocks a replay', async () => {
    const user = await makeUser('mfa4@example.com')
    const secret = generateTotpSecret()
    await beginMfaEnrolment(db, user, seal(secret))

    const now = 1_700_000_000_000
    const first = verifyTotp(secret, totp(secret, now), now)
    expect(first.valid).toBe(true)
    await recordMfaSuccess(db, user, first.step ?? 0)

    const enrolment = await getMfaEnrolment(db, user)
    const replay = verifyTotp(secret, totp(secret, now), now, { lastStep: enrolment?.lastStep })
    expect(replay.valid).toBe(false)
  })

  it('returns null for an account with no enrolment', async () => {
    const user = await makeUser('mfa5@example.com')
    expect(await getMfaEnrolment(db, user)).toBeNull()
  })
})

describe('recovery codes', () => {
  it('consumes a code exactly once', async () => {
    const user = await makeUser('rec1@example.com')
    const codes = generateRecoveryCodes()
    await replaceRecoveryCodes(db, user, codes.hashes)

    const [code] = codes.plaintext
    if (code === undefined) throw new Error('no code')

    expect(await consumeRecoveryCode(db, user, hashRecoveryCode(code))).toBe(true)
    expect(await consumeRecoveryCode(db, user, hashRecoveryCode(code))).toBe(false)
    expect(await countLiveRecoveryCodes(db, user)).toBe(codes.hashes.length - 1)
  })

  it('does not let one account use another account\u2019s code', async () => {
    const owner = await makeUser('rec2@example.com')
    const attacker = await makeUser('rec3@example.com')
    const codes = generateRecoveryCodes()
    await replaceRecoveryCodes(db, owner, codes.hashes)

    const [code] = codes.plaintext
    if (code === undefined) throw new Error('no code')

    expect(await consumeRecoveryCode(db, attacker, hashRecoveryCode(code))).toBe(false)
    // And the owner's code is still usable, so the attempt consumed nothing.
    expect(await consumeRecoveryCode(db, owner, hashRecoveryCode(code))).toBe(true)
  })

  it('invalidates the old set when a new one is issued', async () => {
    const user = await makeUser('rec4@example.com')
    const first = generateRecoveryCodes()
    await replaceRecoveryCodes(db, user, first.hashes)
    await replaceRecoveryCodes(db, user, generateRecoveryCodes().hashes)

    const [old] = first.plaintext
    if (old === undefined) throw new Error('no code')

    expect(await consumeRecoveryCode(db, user, hashRecoveryCode(old))).toBe(false)
  })

  it('rejects an unknown code', async () => {
    const user = await makeUser('rec5@example.com')
    await replaceRecoveryCodes(db, user, generateRecoveryCodes().hashes)

    expect(await consumeRecoveryCode(db, user, hashRecoveryCode('AAAAA-BBBBB'))).toBe(false)
  })
})

describe('brute force accounting', () => {
  it('counts failures inside the window', async () => {
    for (let i = 0; i < 3; i += 1) {
      await recordLoginAttempt(db, { identifier: 'target@example.com', succeeded: false })
    }

    const window = await failuresSinceLastSuccess(db, 'target@example.com')
    expect(window.failures).toBe(3)
    expect(window.lockedUntil).toBeNull()
  })

  it('locks out once the threshold is reached', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      await recordLoginAttempt(db, { identifier: 'target@example.com', succeeded: false })
    }

    const window = await failuresSinceLastSuccess(db, 'target@example.com')
    expect(window.failures).toBeGreaterThanOrEqual(LOCKOUT_THRESHOLD)
    expect(window.lockedUntil).toBeInstanceOf(Date)
  })

  it('clears the count after a success, so a typo streak does not linger', async () => {
    for (let i = 0; i < 4; i += 1) {
      await recordLoginAttempt(db, { identifier: 'target@example.com', succeeded: false })
    }
    await recordLoginAttempt(db, { identifier: 'target@example.com', succeeded: true })

    expect((await failuresSinceLastSuccess(db, 'target@example.com')).failures).toBe(0)
  })

  it('counts each identifier separately', async () => {
    for (let i = 0; i < 5; i += 1) {
      await recordLoginAttempt(db, { identifier: 'one@example.com', succeeded: false })
    }

    expect((await failuresSinceLastSuccess(db, 'two@example.com')).failures).toBe(0)
  })

  it('does not store the identifier', async () => {
    await recordLoginAttempt(db, { identifier: 'target@example.com', ip: '203.0.113.7', succeeded: false })

    const { rows } = await db.query<{ identifier_hash: string; ip_hash: string }>(
      'SELECT identifier_hash, ip_hash FROM login_attempts',
    )
    expect(rows[0]?.identifier_hash).not.toContain('target')
    expect(rows[0]?.ip_hash).not.toContain('203.0.113')
  })
})
