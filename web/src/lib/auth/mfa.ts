/**
 * The second-factor flows (§7).
 *
 * The primitives already exist -- TOTP in `totp.ts`, recovery codes in
 * `recovery.ts`, sealing in `sealed.ts`, storage in `db/identity.ts`. What was
 * missing was the sequence that ties them to a session, which is the part that
 * decides whether a privileged account can actually act.
 *
 * Two rules shape everything here:
 *
 *   The factor is satisfied per session, never per account. A second device
 *   signing in has proven possession of a password and nothing else.
 *
 *   A failed code counts towards the same lockout window as a failed password
 *   (§8). Otherwise the second factor is the cheaper of the two to brute force,
 *   which inverts the point of having it.
 */

import type { Db } from '../db/client'
import {
  beginMfaEnrolment,
  consumeRecoveryCode,
  countLiveRecoveryCodes,
  failuresSinceLastSuccess,
  getMfaEnrolment,
  markSessionMfaSatisfied,
  recordAudit,
  recordLoginAttempt,
  recordMfaSuccess,
  replaceRecoveryCodes,
} from '../db/identity'
import { generateRecoveryCodes, hashRecoveryCode } from './recovery'
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp'
import { open, seal } from './sealed'

/** The label an authenticator app shows. */
const ISSUER = 'My News Factory'

/** Attempts are counted under this identifier, separate from the password one. */
function attemptIdentifier(userId: string): string {
  return `mfa:${userId}`
}

export interface MfaStatus {
  /** A secret exists, whether or not a code has ever been accepted. */
  enrolled: boolean
  /** A code has been accepted at least once, so the secret is known to work. */
  confirmed: boolean
  /** Unused recovery codes left. */
  recoveryCodesRemaining: number
}

export async function mfaStatus(db: Db, userId: string): Promise<MfaStatus> {
  const enrolment = await getMfaEnrolment(db, userId)

  return {
    enrolled: enrolment !== null,
    confirmed: enrolment?.confirmed === true,
    recoveryCodesRemaining: await countLiveRecoveryCodes(db, userId),
  }
}

export interface EnrolmentOffer {
  /** Shown once, so it can be typed into an app that cannot scan. */
  secret: string
  otpauthUri: string
}

export type BeginResult =
  | { status: 'OFFERED'; offer: EnrolmentOffer }
  | { status: 'ALREADY_CONFIRMED' }

/**
 * Issues a secret to enrol against.
 *
 * Refuses when a confirmed credential already exists. Silently replacing one
 * would mean anyone holding a live session could swap out the second factor,
 * which turns MFA into something a session hijacker can simply re-point at
 * their own device.
 */
export async function beginEnrolment(
  db: Db,
  params: { userId: string; email: string; ip?: string | null; requestId?: string },
): Promise<BeginResult> {
  const existing = await getMfaEnrolment(db, params.userId)
  if (existing?.confirmed === true) return { status: 'ALREADY_CONFIRMED' }

  const secret = generateTotpSecret()
  await beginMfaEnrolment(db, params.userId, seal(secret))

  await recordAudit(db, {
    actorId: params.userId,
    action: 'MFA_ENROLMENT_STARTED',
    resourceType: 'user',
    resourceId: params.userId,
    ip: params.ip,
    requestId: params.requestId,
  })

  return {
    status: 'OFFERED',
    offer: {
      secret,
      otpauthUri: otpauthUri({ secretBase32: secret, account: params.email, issuer: ISSUER }),
    },
  }
}

export type VerifyOutcome =
  | { status: 'OK'; recoveryCodes?: string[] }
  | { status: 'NOT_ENROLLED' }
  | { status: 'LOCKED'; until: Date }
  | { status: 'REJECTED' }

interface VerifyParams {
  userId: string
  sessionId: string
  code: string
  /** True on the confirm step, which issues recovery codes on success. */
  issueRecoveryCodes?: boolean
  ip?: string | null
  requestId?: string
}

/**
 * Checks a TOTP code and, on success, marks the session as having cleared it.
 *
 * The accepted step is stored, so the same code cannot be replayed inside the
 * thirty seconds it remains arithmetically valid -- the window an attacker
 * who reads one over a shoulder or off a phishing page would otherwise have.
 */
export async function verifyCode(db: Db, params: VerifyParams): Promise<VerifyOutcome> {
  const identifier = attemptIdentifier(params.userId)

  const window = await failuresSinceLastSuccess(db, identifier)
  if (window.lockedUntil !== null && window.lockedUntil > new Date()) {
    return { status: 'LOCKED', until: window.lockedUntil }
  }

  const enrolment = await getMfaEnrolment(db, params.userId)
  if (enrolment === null) return { status: 'NOT_ENROLLED' }

  const result = verifyTotp(open(enrolment.secretSealed), params.code, Date.now(), {
    lastStep: enrolment.lastStep,
  })

  if (!result.valid || result.step === null) {
    await recordLoginAttempt(db, { identifier, ip: params.ip, succeeded: false })
    await recordAudit(db, {
      actorId: params.userId,
      action: 'MFA_CODE_REJECTED',
      resourceType: 'user',
      resourceId: params.userId,
      ip: params.ip,
      requestId: params.requestId,
    })
    return { status: 'REJECTED' }
  }

  await recordMfaSuccess(db, params.userId, result.step)
  await recordLoginAttempt(db, { identifier, ip: params.ip, succeeded: true })
  await markSessionMfaSatisfied(db, params.sessionId)

  let recoveryCodes: string[] | undefined
  if (params.issueRecoveryCodes === true) {
    const codes = generateRecoveryCodes()
    await replaceRecoveryCodes(db, params.userId, codes.hashes)
    recoveryCodes = codes.plaintext
  }

  await recordAudit(db, {
    actorId: params.userId,
    action: params.issueRecoveryCodes === true ? 'MFA_CONFIRMED' : 'MFA_SATISFIED',
    resourceType: 'session',
    resourceId: params.sessionId,
    ip: params.ip,
    requestId: params.requestId,
  })

  return { status: 'OK', recoveryCodes }
}

/**
 * Spends a recovery code to satisfy the factor.
 *
 * A consumed code is gone whether or not the caller goes on to do anything
 * with the session, and the count remaining is returned so the interface can
 * say how close the account is to having no way back in.
 */
export async function useRecoveryCode(
  db: Db,
  params: { userId: string; sessionId: string; code: string; ip?: string | null; requestId?: string },
): Promise<VerifyOutcome & { remaining?: number }> {
  const identifier = attemptIdentifier(params.userId)

  const window = await failuresSinceLastSuccess(db, identifier)
  if (window.lockedUntil !== null && window.lockedUntil > new Date()) {
    return { status: 'LOCKED', until: window.lockedUntil }
  }

  const consumed = await consumeRecoveryCode(db, params.userId, hashRecoveryCode(params.code))

  if (!consumed) {
    await recordLoginAttempt(db, { identifier, ip: params.ip, succeeded: false })
    await recordAudit(db, {
      actorId: params.userId,
      action: 'MFA_RECOVERY_REJECTED',
      resourceType: 'user',
      resourceId: params.userId,
      ip: params.ip,
      requestId: params.requestId,
    })
    return { status: 'REJECTED' }
  }

  await recordLoginAttempt(db, { identifier, ip: params.ip, succeeded: true })
  await markSessionMfaSatisfied(db, params.sessionId)

  await recordAudit(db, {
    actorId: params.userId,
    // Spending a recovery code is the event a security desk wants to see,
    // because it is the one path that does not involve the enrolled device.
    action: 'MFA_RECOVERY_USED',
    resourceType: 'session',
    resourceId: params.sessionId,
    ip: params.ip,
    requestId: params.requestId,
  })

  return { status: 'OK', remaining: await countLiveRecoveryCodes(db, params.userId) }
}
