/**
 * Identity persistence (§6, §7, §60).
 *
 * Everything that touches a credential lives here, so there is one place to
 * audit. The rules this module enforces:
 *
 *   - no secret is ever stored in a form that can be replayed
 *   - a refresh token is single use, and reusing a consumed one revokes the
 *     whole session rather than the single token
 *   - permission answers come from live grants, never from a cached role name
 *   - every privileged action writes an audit event in the same transaction
 *     as the change it describes
 */

import { hashToken, keyedHash } from '../auth/hashing'
import { PERMISSIONS, ROLES } from '../auth/roles'
import type { Db } from './client'
import { transaction } from './client'

// ----------------------------------------------------------------- seeding

/** Writes the role and permission catalogue. Idempotent. */
export async function syncRoleCatalogue(db: Db): Promise<void> {
  await transaction(db, async (tx) => {
    for (const permission of PERMISSIONS) {
      await tx.query(
        `INSERT INTO permissions (key, description) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [permission.key, permission.description],
      )
    }

    for (const role of ROLES) {
      await tx.query(
        `INSERT INTO roles (key, name, description, privileged) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                privileged = EXCLUDED.privileged`,
        [role.key, role.name, role.description, role.privileged],
      )

      // Replace rather than merge: a permission removed from a role in code
      // must be removed from the database, or revocation never takes effect.
      await tx.query('DELETE FROM role_permissions WHERE role_key = $1', [role.key])
      for (const permission of role.permissions) {
        await tx.query(
          'INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2)',
          [role.key, permission],
        )
      }
    }
  })
}

// ------------------------------------------------------------- credentials

export async function setPassword(db: Db, userId: string, passwordHash: string): Promise<void> {
  await db.query(
    `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [userId, passwordHash],
  )
}

export async function getPasswordHash(db: Db, userId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM user_credentials WHERE user_id = $1',
    [userId],
  )
  return rows[0]?.password_hash
}

// ----------------------------------------------------------------- tokens

export type TokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'

/**
 * Issues a single-use token, superseding any live one for the same purpose.
 * The caller keeps the plaintext; only its digest is stored.
 */
export async function issueUserToken(
  db: Db,
  params: { userId: string; purpose: TokenPurpose; token: string; expiresAt: Date },
): Promise<void> {
  await transaction(db, async (tx) => {
    await tx.query(
      `UPDATE user_tokens SET consumed_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [params.userId, params.purpose],
    )
    await tx.query(
      `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [params.userId, params.purpose, hashToken(params.token), params.expiresAt],
    )
  })
}

export interface ConsumedToken {
  userId: string
  purpose: TokenPurpose
}

/**
 * Consumes a token if it is live.
 *
 * The consume is the lookup: a single UPDATE ... RETURNING, so two concurrent
 * requests cannot both succeed with the same token.
 */
export async function consumeUserToken(
  db: Db,
  token: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
): Promise<ConsumedToken | null> {
  const { rows } = await db.query<{ user_id: string; purpose: TokenPurpose }>(
    `UPDATE user_tokens
        SET consumed_at = $3
      WHERE token_hash = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > $3
    RETURNING user_id, purpose`,
    [hashToken(token), purpose, now],
  )

  const row = rows[0]
  return row === undefined ? null : { userId: row.user_id, purpose: row.purpose }
}

// ---------------------------------------------------------------- sessions

export interface SessionRecord {
  id: string
  userId: string
  mfaSatisfied: boolean
  expiresAt: Date
}

export interface CreateSessionParams {
  userId: string
  accessToken: string
  refreshToken: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
  ip?: string | null
  userAgent?: string
  deviceLabel?: string
  mfaSatisfied?: boolean
}

export async function createSession(db: Db, params: CreateSessionParams): Promise<string> {
  return transaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO sessions (
         user_id, token_hash, ip_hash, user_agent, device_label, expires_at, mfa_satisfied_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        params.userId,
        hashToken(params.accessToken),
        params.ip == null ? null : keyedHash(params.ip),
        params.userAgent ?? '',
        params.deviceLabel ?? '',
        params.accessExpiresAt,
        params.mfaSatisfied === true ? new Date() : null,
      ],
    )

    const sessionId = rows[0]?.id
    if (sessionId === undefined) throw new Error('Session insert returned no id')

    await tx.query(
      `INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [sessionId, hashToken(params.refreshToken), params.refreshExpiresAt],
    )

    return sessionId
  })
}

/** Looks up a live session by its access token. Expired or revoked returns null. */
export async function findSessionByAccessToken(
  db: Db,
  accessToken: string,
  now: Date = new Date(),
): Promise<SessionRecord | null> {
  const { rows } = await db.query<{
    id: string
    user_id: string
    mfa_satisfied_at: Date | null
    expires_at: Date
  }>(
    `SELECT id, user_id, mfa_satisfied_at, expires_at
       FROM sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [hashToken(accessToken), now],
  )

  const row = rows[0]
  if (row === undefined) return null

  return {
    id: row.id,
    userId: row.user_id,
    mfaSatisfied: row.mfa_satisfied_at !== null,
    expiresAt: row.expires_at,
  }
}

/**
 * Marks this session as having cleared a second factor (§7).
 *
 * Per session, not per account: a second device signing in later has not
 * proven anything, and must present a code of its own. `COALESCE` keeps the
 * first time it was satisfied, so the timestamp answers "when did this session
 * become privileged" rather than "when was a code last typed".
 */
export async function markSessionMfaSatisfied(db: Db, sessionId: string): Promise<void> {
  await db.query(
    `UPDATE sessions
        SET mfa_satisfied_at = COALESCE(mfa_satisfied_at, now())
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  )
}

export async function revokeSession(db: Db, sessionId: string, reason: string): Promise<void> {
  if (reason === '') throw new Error('A revocation must carry a reason')

  await db.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  )
}

export async function revokeAllSessions(db: Db, userId: string, reason: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL
    RETURNING id`,
    [userId, reason],
  )
  return rows.length
}

export type RefreshOutcome =
  | { status: 'ROTATED'; sessionId: string; userId: string }
  | { status: 'INVALID' }
  /** A consumed token was presented again: it leaked. The family is revoked. */
  | { status: 'REUSE_DETECTED'; sessionId: string; userId: string }

/**
 * Rotates a refresh token.
 *
 * Reuse detection is the reason this is not a simple lookup. A refresh token
 * is single use; if a consumed one is presented again, either the legitimate
 * client replayed it or an attacker captured it, and there is no way to tell
 * which. The safe response to both is to revoke the session, forcing a fresh
 * sign-in (§7).
 *
 * The whole operation is one transaction, so a concurrent refresh cannot
 * produce two live tokens -- and the partial unique index on the table would
 * refuse it even if this code were wrong.
 */
export async function rotateRefreshToken(
  db: Db,
  presented: string,
  issued: { refreshToken: string; refreshExpiresAt: Date },
  now: Date = new Date(),
): Promise<RefreshOutcome> {
  const presentedHash = hashToken(presented)

  return transaction(db, async (tx) => {
    const { rows } = await tx.query<{
      id: string
      session_id: string
      user_id: string
      consumed_at: Date | null
      expires_at: Date
      revoked_at: Date | null
    }>(
      `SELECT rt.id, rt.session_id, s.user_id, rt.consumed_at, rt.expires_at, s.revoked_at
         FROM refresh_tokens rt
         JOIN sessions s ON s.id = rt.session_id
        WHERE rt.token_hash = $1`,
      [presentedHash],
    )

    const token = rows[0]
    if (token === undefined) return { status: 'INVALID' }

    if (token.consumed_at !== null) {
      // Already used. Revoke the session rather than just refusing, because a
      // refusal would leave a live session an attacker may also hold.
      await tx.query(
        `UPDATE sessions SET revoked_at = $2, revoked_reason = 'refresh token reuse detected'
          WHERE id = $1 AND revoked_at IS NULL`,
        [token.session_id, now],
      )
      return { status: 'REUSE_DETECTED', sessionId: token.session_id, userId: token.user_id }
    }

    if (token.revoked_at !== null || token.expires_at <= now) return { status: 'INVALID' }

    await tx.query('UPDATE refresh_tokens SET consumed_at = $2 WHERE id = $1', [token.id, now])
    await tx.query(
      `INSERT INTO refresh_tokens (session_id, token_hash, replaces_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token.session_id, hashToken(issued.refreshToken), token.id, issued.refreshExpiresAt],
    )
    await tx.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [token.session_id, now])

    return { status: 'ROTATED', sessionId: token.session_id, userId: token.user_id }
  })
}

// -------------------------------------------------------------------- RBAC

export interface Grant {
  role: string
  permission: string
  scope: 'GLOBAL' | 'COUNTRY' | 'CITY'
  countryCode: string | null
  cityId: string | null
  privileged: boolean
}

/**
 * Every permission an account currently holds, with the scope of each grant.
 *
 * Resolved from live rows on every call. There is no cached role on the
 * session: revoking a role must take effect immediately, not at next sign-in.
 */
export async function resolveGrants(db: Db, userId: string): Promise<Grant[]> {
  const { rows } = await db.query<{
    role_key: string
    permission_key: string
    scope: 'GLOBAL' | 'COUNTRY' | 'CITY'
    country_code: string | null
    city_id: string | null
    privileged: boolean
  }>(
    `SELECT ur.role_key, rp.permission_key, ur.scope, ur.country_code, ur.city_id, r.privileged
       FROM user_roles ur
       JOIN roles r ON r.key = ur.role_key
       JOIN role_permissions rp ON rp.role_key = ur.role_key
      WHERE ur.user_id = $1 AND ur.revoked_at IS NULL`,
    [userId],
  )

  return rows.map((row) => ({
    role: row.role_key,
    permission: row.permission_key,
    scope: row.scope,
    countryCode: row.country_code,
    cityId: row.city_id,
    privileged: row.privileged,
  }))
}

export async function grantRole(
  db: Db,
  params: {
    userId: string
    roleKey: string
    grantedBy: string | null
    scope?: 'GLOBAL' | 'COUNTRY' | 'CITY'
    countryCode?: string | null
    cityId?: string | null
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO user_roles (user_id, role_key, granted_by, scope, country_code, city_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      params.userId,
      params.roleKey,
      params.grantedBy,
      params.scope ?? 'GLOBAL',
      params.countryCode ?? null,
      params.cityId ?? null,
    ],
  )

  const id = rows[0]?.id
  if (id === undefined) throw new Error('Role grant returned no id')
  return id
}

export async function revokeRole(db: Db, grantId: string): Promise<void> {
  await db.query('UPDATE user_roles SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
    grantId,
  ])
}

// ------------------------------------------------------------------- audit

export interface AuditEvent {
  actorId?: string | null
  actorRole?: string | null
  action: string
  resourceType: string
  resourceId?: string
  before?: unknown
  after?: unknown
  ip?: string | null
  requestId?: string
}

/**
 * Records a privileged action (§60).
 *
 * Takes a `Db`, so a caller inside a transaction passes the transaction
 * handle and the event commits or rolls back with the change it describes.
 * An audit log that can disagree with the data is worse than none.
 */
export async function recordAudit(db: Db, event: AuditEvent): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (
       actor_id, actor_role, action, resource_type, resource_id,
       before_state, after_state, ip_hash, request_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      event.actorId ?? null,
      event.actorRole ?? null,
      event.action,
      event.resourceType,
      event.resourceId ?? '',
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      event.ip == null ? null : keyedHash(event.ip),
      event.requestId ?? '',
    ],
  )
}

// --------------------------------------------------------------------- MFA

export interface MfaEnrolment {
  id: string
  /** Sealed; open it with `open` from auth/sealed. */
  secretSealed: string
  confirmed: boolean
  lastStep: number | null
}

/**
 * Starts or restarts TOTP enrolment.
 *
 * Re-enrolling replaces the secret and clears confirmation, so an abandoned
 * half-finished enrolment can never be completed later with a secret nobody
 * still has.
 */
export async function beginMfaEnrolment(
  db: Db,
  userId: string,
  secretSealed: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO mfa_credentials (user_id, kind, secret_encrypted)
     VALUES ($1, 'TOTP', $2)
     ON CONFLICT (user_id, kind) DO UPDATE
        SET secret_encrypted = EXCLUDED.secret_encrypted,
            confirmed_at = NULL,
            last_step = NULL,
            last_used_at = NULL
     RETURNING id`,
    [userId, secretSealed],
  )

  const id = rows[0]?.id
  if (id === undefined) throw new Error('MFA enrolment returned no id')
  return id
}

export async function getMfaEnrolment(db: Db, userId: string): Promise<MfaEnrolment | null> {
  const { rows } = await db.query<{
    id: string
    secret_encrypted: string
    confirmed_at: Date | null
    last_step: string | number | null
  }>(
    `SELECT id, secret_encrypted, confirmed_at, last_step
       FROM mfa_credentials WHERE user_id = $1 AND kind = 'TOTP'`,
    [userId],
  )

  const row = rows[0]
  if (row === undefined) return null

  return {
    id: row.id,
    secretSealed: row.secret_encrypted,
    confirmed: row.confirmed_at !== null,
    // bigint arrives as a string from node-postgres.
    lastStep: row.last_step === null ? null : Number(row.last_step),
  }
}

/**
 * Records that a code was accepted.
 *
 * Storing the step is what stops a code being replayed inside its own validity
 * window: `verifyTotp` refuses anything at or below `lastStep`.
 */
export async function recordMfaSuccess(db: Db, userId: string, step: number): Promise<void> {
  await db.query(
    `UPDATE mfa_credentials
        SET last_step = $2, last_used_at = now(), confirmed_at = COALESCE(confirmed_at, now())
      WHERE user_id = $1 AND kind = 'TOTP'`,
    [userId, step],
  )
}

/** Replaces every recovery code. Issuing a new set invalidates the old one. */
export async function replaceRecoveryCodes(
  db: Db,
  userId: string,
  hashes: string[],
): Promise<void> {
  await transaction(db, async (tx) => {
    await tx.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId])
    for (const hash of hashes) {
      await tx.query('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [
        userId,
        hash,
      ])
    }
  })
}

/**
 * Consumes a recovery code if it is live and belongs to this account.
 *
 * One statement, so two concurrent attempts cannot both succeed with the same
 * code. The user_id predicate matters: without it, a code would unlock
 * whichever account happened to hold it.
 */
export async function consumeRecoveryCode(
  db: Db,
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE mfa_recovery_codes
        SET consumed_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND consumed_at IS NULL
    RETURNING id`,
    [userId, codeHash],
  )
  return rows.length === 1
}

export async function countLiveRecoveryCodes(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM mfa_recovery_codes
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  )
  return Number(rows[0]?.count ?? '0')
}

// ------------------------------------------------------------ brute force

export interface AttemptWindow {
  failures: number
  lockedUntil: Date | null
}

export const LOCKOUT_THRESHOLD = 10
export const LOCKOUT_WINDOW_MINUTES = 15

export async function recordLoginAttempt(
  db: Db,
  params: { identifier: string; ip?: string | null; succeeded: boolean },
): Promise<void> {
  await db.query(
    `INSERT INTO login_attempts (identifier_hash, ip_hash, succeeded) VALUES ($1, $2, $3)`,
    [keyedHash(params.identifier), params.ip == null ? null : keyedHash(params.ip), params.succeeded],
  )
}

/**
 * Failures for an identifier since the last success inside the window.
 *
 * Counting since the last success matters: a correct sign-in clears the
 * count, so someone who mistypes their password four times and then succeeds
 * is not one attempt away from a lockout for the next quarter of an hour.
 */
export async function failuresSinceLastSuccess(
  db: Db,
  identifier: string,
  now: Date = new Date(),
): Promise<AttemptWindow> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * 60_000)

  const { rows } = await db.query<{ failures: string; last_failure: Date | null }>(
    `WITH window_attempts AS (
       SELECT succeeded, created_at
         FROM login_attempts
        WHERE identifier_hash = $1 AND created_at > $2
     ),
     last_success AS (
       SELECT max(created_at) AS at FROM window_attempts WHERE succeeded
     )
     SELECT count(*)::text AS failures, max(created_at) AS last_failure
       FROM window_attempts, last_success
      WHERE NOT succeeded
        AND (last_success.at IS NULL OR window_attempts.created_at > last_success.at)`,
    [keyedHash(identifier), since],
  )

  const failures = Number(rows[0]?.failures ?? '0')
  const lastFailure = rows[0]?.last_failure ?? null

  return {
    failures,
    lockedUntil:
      failures >= LOCKOUT_THRESHOLD && lastFailure !== null
        ? new Date(new Date(lastFailure).getTime() + LOCKOUT_WINDOW_MINUTES * 60_000)
        : null,
  }
}
