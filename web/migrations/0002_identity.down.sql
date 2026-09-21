-- Rollback for 0002_identity (§83). Destructive: removes every credential,
-- session, role grant and audit record. Never run against a live system
-- without a verified backup -- and note that dropping audit_events destroys
-- the record of who did what, which is the one table worth losing last.

DROP TRIGGER IF EXISTS user_credentials_touch ON user_credentials;
DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;

DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS mfa_recovery_codes;
DROP TABLE IF EXISTS mfa_credentials;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS user_tokens;
DROP TABLE IF EXISTS user_credentials;

DROP TYPE IF EXISTS grant_scope;
DROP TYPE IF EXISTS mfa_kind;
DROP TYPE IF EXISTS token_purpose;
