#!/usr/bin/env bash
#
# Redeploy the current branch: pull, rebuild, migrate, prove it answers.
#
# For a site that is already running. The first-time setup -- keys, database,
# seed -- is deploy/enable-logins.sh, which this deliberately does not repeat:
# re-seeding a live site would put demonstration stories back next to real
# ones.
#
# Run it on the VPS from the repository root.
#
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [ ! -f .env ]; then
  echo "No .env here. Run deploy/enable-logins.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

say "Fetching ${BRANCH}"
git fetch origin "${BRANCH}"
# The working tree on the server is deployment state, not someone's work in
# progress. A hard reset is what makes the deployed commit knowable; a merge
# could leave the server on a commit that exists nowhere else.
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"
echo "Now on $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

say "Rebuilding"
docker compose up -d --build web

DB_USER="${POSTGRES_USER:-mynewsfactory}"
DB_NAME="${POSTGRES_DB:-mynewsfactory}"
DB_URL="postgres://${DB_USER}:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}"

say "Applying any new migrations"
docker compose exec -T -e DATABASE_URL="${DB_URL}" web npm run db:migrate

say "Checking"
ok=1
printf '  health: '
curl -fsS http://127.0.0.1:3100/api/v1/health || { echo 'FAILED'; ok=0; }
echo
printf '  news:   '
curl -fsS 'http://127.0.0.1:3100/api/v1/news?limit=1' | head -c 90 || { echo 'FAILED'; ok=0; }
echo

if [ "${ok}" -ne 1 ]; then
  say "The site did not answer. Recent logs:"
  docker compose logs --tail 60 web
  exit 1
fi

say "Deployed"
