#!/usr/bin/env bash
#
# Turn on accounts: start PostgreSQL, generate the auth keys, migrate, install
# the reference data, and rebuild the site so sign-in works.
#
# Run it on the VPS from the repository root. Safe to re-run: it never
# overwrites an existing key, and the migration runner skips what is applied.
#
# By default it installs reference data only. Pass --with-demo to add the
# demonstration reporters and articles, which is for a development machine and
# is refused by the app itself when NODE_ENV=production.
#
set -euo pipefail

cd "$(dirname "$0")/.."

WITH_DEMO=0
for arg in "$@"; do
  case "$arg" in
    --with-demo) WITH_DEMO=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --- 1. secrets -----------------------------------------------------------
say "Checking secrets"
bash deploy/provision-env.sh

# shellcheck disable=SC1091
set -a; . ./.env; set +a

# --- 2. database and app --------------------------------------------------
say "Starting PostgreSQL and the site"
docker compose up -d --build

printf 'Waiting for PostgreSQL'
for _ in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U "${POSTGRES_USER:-mynewsfactory}" >/dev/null 2>&1; then
    echo " — ready"; break
  fi
  printf '.'; sleep 2
done

# --- 3. schema ------------------------------------------------------------
# Run inside the web container so the migrations use the same code the
# application does and reach the database over the compose network.
say "Applying migrations"
docker compose exec -T web npm run db:migrate

say "Installing reference data and the role catalogue"
docker compose exec -T web npm run db:bootstrap

if [ "${WITH_DEMO}" -eq 1 ]; then
  say "Adding demonstration content"
  # NODE_ENV is overridden for this one command. The app refuses to seed
  # invented reporters and articles in production, and that refusal is
  # correct -- this flag exists for a development machine only.
  docker compose exec -T -e NODE_ENV=development web npm run db:seed
fi

# --- 4. proof -------------------------------------------------------------
say "Checking"
echo -n "  health: "; curl -fsS http://127.0.0.1:3100/api/v1/health || echo "FAILED"
echo
echo -n "  news:   "; curl -fsS 'http://127.0.0.1:3100/api/v1/news?limit=1' | head -c 90 || echo "FAILED"
echo
echo
DB_USER="${POSTGRES_USER:-mynewsfactory}"
DB_NAME="${POSTGRES_DB:-mynewsfactory}"
echo "Done. Open https://mynewsfactory.com/register and create the first account."
echo
echo "To make that account an administrator, with USER_EMAIL set to its address:"
echo "  docker compose exec -T db psql -U ${DB_USER} -d ${DB_NAME} -c \\"
echo "    \"INSERT INTO user_roles (user_id, role_key, scope) \\"
echo "     SELECT id, 'SUPER_ADMIN', 'GLOBAL' FROM users WHERE email = lower('\$USER_EMAIL');\""
echo
echo "An administrator account requires a second factor before it may act (§7)."
echo "Sign in, then open /account/security to enrol an authenticator app. The ten"
echo "recovery codes are shown once; store them somewhere other than that phone."
