-- 0002_identity: credentials, sessions, MFA, roles and audit.
--
-- Phase 1b of docs/IMPLEMENTATION_PLAN.md. Nothing here stores a usable secret:
-- passwords are Argon2id hashes, session and refresh tokens are stored as
-- SHA-256 digests, recovery codes are hashed, TOTP secrets are encrypted, and
-- IP addresses are keyed hashes. A dump of this schema yields no credential
-- that can be replayed and no plaintext address.
--
-- The invariants that matter are constraints and triggers rather than
-- application rules, so they hold when application code is wrong.

-- ------------------------------------------------------------- credentials

CREATE TABLE user_credentials (
    user_id       uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    -- PHC string: carries its own algorithm, parameters and salt, so raising
    -- the cost later does not need a schema change and old hashes stay
    -- verifiable until their owner next signs in.
    password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Single-use, expiring tokens: email verification and password reset.
CREATE TYPE token_purpose AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

CREATE TABLE user_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     token_purpose NOT NULL,
    -- The token itself is never stored. A leaked table cannot be used to
    -- verify an address or reset a password.
    token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_tokens_expiry_after_issue CHECK (expires_at > created_at)
);

CREATE INDEX user_tokens_user_idx ON user_tokens (user_id, purpose);
-- One live token per purpose: issuing a new one supersedes the old.
CREATE UNIQUE INDEX user_tokens_one_live
    ON user_tokens (user_id, purpose)
    WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------- sessions

-- A session's refresh tokens form a family. Rotation issues a new token and
-- consumes the old one; presenting a consumed token means it leaked, so the
-- whole family is revoked rather than the single token (§7).
CREATE TABLE sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- Access token, stored as a digest.
    token_hash      text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),

    -- Device tracking (§7). The address is a keyed hash: enough to spot a
    -- session moving between networks, never the address itself (§57).
    ip_hash         text CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
    user_agent      text NOT NULL DEFAULT '',
    device_label    text NOT NULL DEFAULT '',

    -- Set once MFA has been satisfied. A session that exists is not
    -- necessarily a session that may act.
    mfa_satisfied_at timestamptz,

    issued_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    revoked_reason  text NOT NULL DEFAULT '',

    CONSTRAINT sessions_expiry_after_issue CHECK (expires_at > issued_at),
    CONSTRAINT sessions_revocation_has_reason CHECK (
        (revoked_at IS NULL AND revoked_reason = '')
        OR (revoked_at IS NOT NULL AND revoked_reason <> '')
    )
);

CREATE INDEX sessions_user_idx ON sessions (user_id, issued_at DESC);
CREATE INDEX sessions_live_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE refresh_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    -- The token this one replaced, so a rotation chain can be walked.
    replaces_id  uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    issued_at    timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz,

    CONSTRAINT refresh_expiry_after_issue CHECK (expires_at > issued_at)
);

CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id, issued_at DESC);
-- At most one live refresh token per session. Rotation must consume before it
-- issues, so two live tokens cannot exist even under a concurrent refresh.
CREATE UNIQUE INDEX refresh_tokens_one_live
    ON refresh_tokens (session_id)
    WHERE consumed_at IS NULL;

-- --------------------------------------------------------------------- MFA

CREATE TYPE mfa_kind AS ENUM ('TOTP');

CREATE TABLE mfa_credentials (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind         mfa_kind NOT NULL DEFAULT 'TOTP',
    -- AES-256-GCM ciphertext, base64. The key lives in the environment, never
    -- in the database, so a dump alone cannot generate valid codes.
    secret_encrypted text NOT NULL,
    -- Enrolment is not complete until a code has been verified once.
    confirmed_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    -- The last step accepted, so a code cannot be replayed within its window.
    last_step    bigint,

    UNIQUE (user_id, kind)
);

CREATE TABLE mfa_recovery_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash   text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mfa_recovery_user_idx ON mfa_recovery_codes (user_id) WHERE consumed_at IS NULL;

-- -------------------------------------------------------------------- RBAC

CREATE TABLE roles (
    key         text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z_]*$'),
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    -- Roles that act on the platform rather than use it. These require MFA
    -- and are the ones the security dashboard reports on (§7, §40).
    privileged  boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    description text NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
    role_key       text NOT NULL REFERENCES roles (key) ON DELETE CASCADE,
    permission_key text NOT NULL REFERENCES permissions (key) ON DELETE CASCADE,

    PRIMARY KEY (role_key, permission_key)
);

-- A grant may be global, or scoped to a country or a city (§6). Scope is
-- carried on the grant rather than the role, so one role serves every region.
CREATE TYPE grant_scope AS ENUM ('GLOBAL', 'COUNTRY', 'CITY');

CREATE TABLE user_roles (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_key     text NOT NULL REFERENCES roles (key) ON DELETE RESTRICT,

    scope        grant_scope NOT NULL DEFAULT 'GLOBAL',
    country_code char(2) REFERENCES countries (code) ON DELETE RESTRICT,
    city_id      uuid     REFERENCES cities (id) ON DELETE RESTRICT,

    -- Who granted it. RESTRICT: the record of who conferred privilege cannot
    -- be removed by deleting an account.
    granted_by   uuid REFERENCES users (id) ON DELETE RESTRICT,
    granted_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,

    -- The scope column and its target must agree; neither can be set alone.
    CONSTRAINT user_roles_scope_target CHECK (
        (scope = 'GLOBAL'  AND country_code IS NULL     AND city_id IS NULL)
     OR (scope = 'COUNTRY' AND country_code IS NOT NULL AND city_id IS NULL)
     OR (scope = 'CITY'    AND country_code IS NULL     AND city_id IS NOT NULL)
    )
);

CREATE INDEX user_roles_user_idx ON user_roles (user_id) WHERE revoked_at IS NULL;
-- The same role cannot be granted twice over the same scope while live.
CREATE UNIQUE INDEX user_roles_unique_live
    ON user_roles (user_id, role_key, scope, COALESCE(country_code, ''), COALESCE(city_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE revoked_at IS NULL;

-- ------------------------------------------------------------------- audit

-- Every privileged action (§60). Append-only, enforced by the same guard the
-- editorial history uses: a log that can be edited is not a log.
CREATE TABLE audit_events (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id      uuid REFERENCES users (id) ON DELETE RESTRICT,
    actor_role    text REFERENCES roles (key) ON DELETE RESTRICT,
    action        text NOT NULL CHECK (action ~ '^[A-Z][A-Z_]*$'),
    resource_type text NOT NULL,
    resource_id   text NOT NULL DEFAULT '',
    before_state  jsonb,
    after_state   jsonb,
    ip_hash       text CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
    request_id    text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_actor_idx    ON audit_events (actor_id, created_at DESC);
CREATE INDEX audit_resource_idx ON audit_events (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_action_idx   ON audit_events (action, created_at DESC);

CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER audit_events_no_delete
    BEFORE DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ------------------------------------------------------- brute force / rate

-- Attempts are recorded against a keyed hash of the identifier, so the table
-- supports lockout without becoming a list of who tried to sign in where.
CREATE TABLE login_attempts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier_hash text NOT NULL CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
    ip_hash         text CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
    succeeded       boolean NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_identifier_idx ON login_attempts (identifier_hash, created_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;

-- ---------------------------------------------------------------- triggers

CREATE TRIGGER user_credentials_touch
    BEFORE UPDATE ON user_credentials
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
