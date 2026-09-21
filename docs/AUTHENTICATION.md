# Authentication

Phase 1b of `IMPLEMENTATION_PLAN.md`. Covers credentials, sessions, MFA and
brute-force controls (§7).

**Nothing here is wired to an HTTP surface yet.** There is no `/api/v1`, so
none of this is reachable by a request. It is the foundation the endpoints in
Phase 1c sit on, and it is tested to that standard now so the endpoints are
thin.

---

## What is stored, and in what form

The rule is that a dump of this database yields nothing replayable.

| Secret | Stored as | Why |
| --- | --- | --- |
| Password | Argon2id PHC string | Memory-hard; carries its own salt and parameters |
| Session token | SHA-256 digest | High entropy already, so no salt needed; unsalted makes lookup possible |
| Refresh token | SHA-256 digest | As above |
| Email / reset token | SHA-256 digest | A leaked table cannot verify an address or reset a password |
| TOTP secret | AES-256-GCM ciphertext | The key is in the environment, so a dump alone generates no codes |
| Recovery code | SHA-256 digest | Single use, and never recoverable from the table |
| Email address (attempt log) | HMAC-SHA256 | Low entropy, so an unkeyed digest would be reversible by enumeration |
| IP address | HMAC-SHA256 | Enough to rate-limit and spot a moved session; never the address (§57) |

Two different constructions appear above and the distinction is deliberate.
A server-issued token has 256 bits of entropy, so a plain SHA-256 is correct
and a salt would only prevent lookup. An email address or an IP has almost no
entropy, so it gets a keyed hash whose key never enters the database.

---

## Passwords

Argon2id at OWASP's 2024 parameters: 19 MiB, two iterations, one lane —
about 70 ms per hash on the deployment host.

`needsRehash` reports when a stored hash was produced with weaker parameters,
so raising the cost later upgrades accounts on their next sign-in without a
migration and without locking anyone out.

Three behaviours worth knowing:

- A **corrupted or unknown-format hash verifies as false**, never throws. A
  row that throws produces a 500 that distinguishes this account from one that
  does not exist.
- An **oversized password is rejected, not truncated**. Silently ignoring the
  tail of a passphrase weakens it without telling anyone.
- Length is measured in **bytes**, so a non-ASCII passphrase is treated
  correctly.

---

## Sessions

A session has an access token and a refresh token, both stored as digests, plus
the device context §7 asks for: a keyed hash of the address, the user agent and
a label.

`mfa_satisfied_at` is separate from the session's existence. A session that
exists is not necessarily a session that may act — which is what lets a
sign-in complete before the second factor is presented.

### Refresh rotation and reuse detection

A refresh token is single use. Rotating one consumes it and issues the next,
recording `replaces_id` so the chain can be walked.

If a **consumed** token is presented again, it leaked. There is no way to tell
whether the legitimate client replayed it or an attacker captured it, and the
safe response to both is the same: revoke the whole session. Refusing the
single token would leave a live session the attacker may also hold.

Two things enforce "one live refresh token per session": the rotation runs in
one transaction, and a partial unique index refuses a second live row even if
that code were wrong.

---

## MFA

TOTP, RFC 6238, implemented in `auth/totp.ts` rather than taken as a
dependency — see `DECISIONS.md` D-014. Every vector from the RFC's Appendix B
runs as a test, for all three digests.

- ±1 step (30 seconds) of clock skew is accepted
- The accepted step is recorded, so **a code cannot be replayed inside its own
  validity window**
- Verification evaluates every candidate step before returning and compares in
  constant time, so timing does not reveal which step matched
- Enrolment is incomplete until one code has been verified; restarting
  enrolment clears confirmation, so an abandoned secret cannot be completed
  later

Ten recovery codes, in an alphabet without `I`, `L`, `O` or `U`. They are
normalised before hashing — case and dashes vary with transcription, and that
should not decide whether someone can recover their account.

**Recovery codes are a standing bypass of the second factor.** They are single
use, scoped to their owner (a code cannot unlock another account), and
issuing a new set invalidates the old one.

---

## Brute force

Failures are counted **since the last success** inside a 15-minute window, with
lockout at 10. Counting since the last success matters: someone who mistypes
four times and then signs in correctly is not one attempt away from a lockout
for the rest of the window.

The attempt log stores a keyed hash of the identifier, so it supports lockout
without becoming a record of who tried to sign in from where.

---

## Not done yet

- **No HTTP endpoints.** Phase 1c.
- **No email delivery.** Tokens are issued and consumed; nothing sends them.
- **No step-up authentication** for high-value financial actions (§39). Phase 6.
- **No WebAuthn.** TOTP only for now.
- **No session-anomaly detection** (§7). The address hash is recorded, which is
  what a detector would read; nothing reads it yet.
