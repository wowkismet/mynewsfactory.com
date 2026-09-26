#!/usr/bin/env bash
#
# Redeploy the current branch: pull, rebuild, migrate, prove it answers.
#
# The manual equivalent of the CI deploy workflow. Reference data is installed
# on every run because it is idempotent and a new section or currency should
# not need a person. Demonstration content is never installed here.
#
# Run it on the VPS from the repository root.
#
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Checking secrets"
bash deploy/provision-env.sh

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
docker compose up -d --build

say "Applying migrations"
docker compose exec -T web npm run db:migrate

say "Installing reference data"
docker compose exec -T web npm run db:bootstrap

say "Checking"
ok=1
printf '  health: '
health=$(curl -fsS --max-time 10 http://127.0.0.1:3100/api/v1/health) || { echo 'FAILED'; ok=0; }
echo "${health:-}"
printf '  news:   '
curl -fsS --max-time 10 'http://127.0.0.1:3100/api/v1/news?limit=1' | head -c 90 || { echo 'FAILED'; ok=0; }
echo

# The site answering while its database does not is the case worth catching:
# every page would render its empty state and this would still look like a
# successful deploy.
case "${health:-}" in
  *'"database":"up"'*) ;;
  *) echo "  the app is up but cannot reach the database"; ok=0 ;;
esac

if [ "${ok}" -ne 1 ]; then
  say "The site did not come up cleanly. Recent logs:"
  docker compose logs --tail 60 web
  exit 1
fi

say "Deployed"
