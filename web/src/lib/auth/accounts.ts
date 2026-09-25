/**
 * Registration and sign-in (§5, §6, §78).
 *
 * The primitives these compose -- Argon2id hashing, sealed secrets, session
 * creation, the attempt log -- already exist and are already tested. What is
 * added here is the order they run in, and the handful of decisions that only
 * make sense at the level of a whole flow. Three are worth reading before the
 * code:
 *
 * Registration does not disclose whether an address is already registered.
 * §77 requires preventing enumeration, and a signup form is the easiest
 * enumeration oracle in any product: submit an address, read the error. So the
 * response is identical either way. A genuinely new address gets an account; a
 * known one gets nothing, silently, and the collision is recorded in the audit
 * log where an operator -- not a prober -- can see it. The cost is that a user
 * who has forgotten they already registered is directed to password reset by
 * the copy rather than by an error, which is the same place that flow would
 * have sent them anyway.
 *
 * Sign-in costs the same whether or not the account exists. Skipping the hash
 * verification for an unknown address would make "user not found" measurably
 * faster than "wrong password", which is the same oracle with a stopwatch. A
 * throwaway hash is verified instead, so both paths do the same work.
 *
 * Suspension is only disclosed after the password is correct. Before that it
 * would be one more bit about an account the caller cannot prove they own.
 */

import type { Db } from '../db/client'
import {
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MINUTES,
  failuresSinceLastSuccess,
  grantRole,
  issueUserToken,
  recordAudit,
  recordLoginAttempt,
  setPassword,
} from '../db/identity'
import { transaction } from '../db/client'
import { generateToken } from './hashing'
import { hashPassword, verifyPassword } from './password'

/** Long enough that a password is not the weak link; short enough to be usable. */
export const MIN_PASSWORD_BYTES = 12

const EMAIL_TOKEN_TTL_HOURS = 24

/**
 * An Argon2id hash of a value nobody knows, verified when an account is not
 * found so that the timing of the two paths matches. Computed once per
 * process, on first use, because hashing at import time would add a second to
 * startup for a value most requests never need.
 */
let decoyHash: string | null = null

async function decoy(): Promise<string> {
  decoyHash ??= await hashPassword(generateToken())
  return decoyHash
}

// ------------------------------------------------------------ registration

export interface RegistrationRequest {
  email: string
  password: string
  displayName: string
  ip: string | null
  requestId: string
}

/**
 * The only outcome a caller sees.
 *
 * There is deliberately no "already registered" case: see the module comment.
 */
export interface RegistrationResult {
  /** Present only when an account was actually created. Never returned to a client. */
  userId: string | null
  /** The verification token, for the mail the notification service will send (§41). */
  verificationToken: string | null
}

export async function register(db: Db, request: RegistrationRequest): Promise<RegistrationResult> {
  return transaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      // ON CONFLICT DO NOTHING rather than a SELECT then an INSERT: two
      // concurrent registrations of the same address would both pass the
      // check and one would then violate the unique index. Letting the index
      // arbitrate makes the race impossible rather than unlikely.
      `INSERT INTO users (email, display_name, status)
       VALUES ($1, $2, 'PENDING')
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [request.email, request.displayName],
    )

    const userId = rows[0]?.id

    if (userId === undefined) {
      // The address is taken. Record it -- repeated collisions on one address
      // are a signal worth having (§35) -- and return the same shape as success.
      await recordAudit(tx, {
        action: 'ACCOUNT_REGISTER_COLLISION',
        resourceType: 'user',
        ip: request.ip,
        requestId: request.requestId,
      })
      return { userId: null, verificationToken: null }
    }

    await setPassword(tx, userId, await hashPassword(request.password))

    // Every account starts as a reader and nothing more. The request body
    // cannot influence this: role is not an input to registration, and the
    // validator rejects a body that tries to make it one (§53).
    await grantRole(tx, { userId, roleKey: 'READER', grantedBy: null })

    const verificationToken = generateToken()
    await issueUserToken(tx, {
      userId,
      purpose: 'EMAIL_VERIFICATION',
      token: verificationToken,
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 3_600_000),
    })

    await recordAudit(tx, {
      actorId: userId,
      action: 'ACCOUNT_REGISTERED',
      resourceType: 'user',
      resourceId: userId,
      ip: request.ip,
      requestId: request.requestId,
      after: { status: 'PENDING' },
    })

    return { userId, verificationToken }
  })
}

// ---------------------------------------------------------------- sign-in

export type SignInOutcome =
  | { status: 'OK'; userId: string; displayName: string }
  | { status: 'REJECTED' }
  | { status: 'LOCKED'; retryAfterSeconds: number }
  | { status: 'SUSPENDED' }

export interface SignInRequest {
  email: string
  password: string
  ip: string | null
  requestId: string
}

interface AccountRow {
  id: string
  display_name: string
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  password_hash: string | null
}

export async function signIn(db: Db, request: SignInRequest): Promise<SignInOutcome> {
  // The per-account lockout, which is shared across instances because it lives
  // in the database. The per-endpoint rate limit in `api/ratelimit.ts` is a
  // separate control with a separate purpose; this one survives a restart and
  // cannot be sidestepped by spreading attempts across instances.
  const window = await failuresSinceLastSuccess(db, request.email)
  if (window.failures >= LOCKOUT_THRESHOLD) {
    await recordLoginAttempt(db, {
      identifier: request.email,
      ip: request.ip,
      succeeded: false,
    })
    return { status: 'LOCKED', retryAfterSeconds: LOCKOUT_WINDOW_MINUTES * 60 }
  }

  const { rows } = await db.query<AccountRow>(
    `SELECT u.id, u.display_name, u.status, c.password_hash
       FROM users u
       LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE u.email = $1`,
    [request.email],
  )

  const account = rows[0]

  // No account, or an account with no password set. Both verify the decoy so
  // that the response time does not distinguish them from a wrong password.
  if (account?.password_hash == null) {
    await verifyPassword(await decoy(), request.password)
    await recordLoginAttempt(db, { identifier: request.email, ip: request.ip, succeeded: false })
    return { status: 'REJECTED' }
  }

  const correct = await verifyPassword(account.password_hash, request.password)

  if (!correct) {
    await recordLoginAttempt(db, { identifier: request.email, ip: request.ip, succeeded: false })
    await recordAudit(db, {
      actorId: account.id,
      action: 'ACCOUNT_SIGNIN_FAILED',
      resourceType: 'user',
      resourceId: account.id,
      ip: request.ip,
      requestId: request.requestId,
    })
    return { status: 'REJECTED' }
  }

  // Past this point the caller has proven they hold the password, so telling
  // them the account's state discloses nothing they could not already infer.
  if (account.status === 'SUSPENDED' || account.status === 'CLOSED') {
    await recordLoginAttempt(db, { identifier: request.email, ip: request.ip, succeeded: false })
    return { status: 'SUSPENDED' }
  }

  await recordLoginAttempt(db, { identifier: request.email, ip: request.ip, succeeded: true })

  return { status: 'OK', userId: account.id, displayName: account.display_name }
}
