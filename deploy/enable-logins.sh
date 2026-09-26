#!/usr/bin/env bash
#
# Turn on accounts: start PostgreSQL, generate the auth keys, migrate, seed,
# and rebuild the site so sign-in works.
#
# Run it on the VPS from the repository root. It is safe to re-run: it never
# overwrites an existing .env, and the migration runner skips what is already
# applied.
#
set -euo pipefail

cd "$(dirname "$0")/.."

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --- 1. secrets -----------------------------------------------------------
# Generated here and written once. Regenerating MFA_ENCRYPTION_KEY later
# invalidates every enrolled second factor, and regenerating AUTH_TOKEN_PEPPER
# makes existing rate-limit and audit hashes unlinkable -- so if .env already
# has them, they are left alone.
if [ ! -f .env ]; then
  say "Creating .env with fresh keys"
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
    echo "AUTH_TOKEN_PEPPER=$(openssl rand -base64 32)"
    echo "MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
  } > .env
  chmod 600 .env
  echo "Wrote .env (mode 600). Back this file up somewhere safe."
else
  say ".env already exists — keeping the existing keys"
  for key in POSTGRES_PASSWORD AUTH_TOKEN_PEPPER MFA_ENCRYPTION_KEY; do
    if ! grep -q "^${key}=..*" .env; then
      echo "  adding missing ${key}"
      echo "${key}=$(openssl rand -base64 32)" >> .env
    fi
  done
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

# --- 2. database ----------------------------------------------------------
say "Starting PostgreSQL"
docker compose --profile db up -d db

printf 'Waiting for it to accept connections'
for _ in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U "${POSTGRES_USER:-mynewsfactory}" >/dev/null 2>&1; then
    echo " — ready"; break
  fi
  printf '.'; sleep 2
done

# --- 3. app ---------------------------------------------------------------
# The web container needs DATABASE_URL and the two auth keys. They go in .env,
# which compose reads, so the compose file itself never carries a secret.
DB_USER="${POSTGRES_USER:-mynewsfactory}"
DB_NAME="${POSTGRES_DB:-mynewsfactory}"
DB_URL="postgres://${DB_USER}:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}"

if ! grep -q '^DATABASE_URL=' .env; then
  echo "DATABASE_URL=${DB_URL}" >> .env
fi

say "Rebuilding and starting the site"
docker compose up -d --build web

# --- 4. schema ------------------------------------------------------------
# Run inside the web container, so the migrations use the same code the
# application does and reach the database over the compose network.
say "Applying migrations"
docker compose exec -T -e DATABASE_URL="${DB_URL}" web npm run db:migrate

say "Seeding reference data and demonstration content"
docker compose exec -T -e DATABASE_URL="${DB_URL}" web npm run db:seed

# --- 5. proof -------------------------------------------------------------
say "Checking"
echo -n "  health: "; curl -fsS http://127.0.0.1:3100/api/v1/health || echo "FAILED"
echo
echo -n "  news:   "; curl -fsS 'http://127.0.0.1:3100/api/v1/news?limit=1' | head -c 90 || echo "FAILED"
echo
echo
echo "Done. Open https://mynewsfactory.com/register and create the first account."
echo
echo "To make that account an administrator, with USER_EMAIL set to its address:"
echo "  docker compose exec -T db psql -U ${DB_USER} -d ${DB_NAME} -c \\"
echo "    \"INSERT INTO user_roles (user_id, role_key, scope) \\"
echo "     SELECT id, 'SUPER_ADMIN', 'GLOBAL' FROM users WHERE email = lower('\$USER_EMAIL');\""
echo
echo "An administrator account requires a second factor before it may act (§7)."
echo "Enrol it with an authenticator app:"
echo "  POST /api/v1/auth/mfa/enrol    -> returns a secret and an otpauth:// URI"
echo "  POST /api/v1/auth/mfa/confirm  -> {\"code\":\"123456\"}, returns 10 recovery codes"
echo "Both need the session cookie from signing in. Store the recovery codes;"
echo "they are shown once and are the only way back in without the phone."
