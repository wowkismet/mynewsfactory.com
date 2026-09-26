#!/usr/bin/env bash
#
# Write the secrets this deployment needs, once, and never overwrite them.
#
# Split out of enable-logins.sh so the CI deploy can call it too. Regenerating
# a key is destructive in ways that are not obvious:
#
#   MFA_ENCRYPTION_KEY  seals every enrolled TOTP secret. A new key means every
#                       second factor stops working and every privileged
#                       account is locked out of acting.
#   AUTH_TOKEN_PEPPER   keys the hashes in the attempt log and the audit trail.
#                       A new one makes existing records unlinkable.
#
# So this only ever fills in what is missing.
#
set -euo pipefail

cd "$(dirname "$0")/.."

changed=0

if [ ! -f .env ]; then
  : > .env
  chmod 600 .env
  echo "Created .env (mode 600)."
  changed=1
fi

# Anything already present is left exactly as it is.
for key in POSTGRES_PASSWORD AUTH_TOKEN_PEPPER MFA_ENCRYPTION_KEY; do
  if ! grep -q "^${key}=..*" .env; then
    printf '%s=%s\n' "${key}" "$(openssl rand -base64 32)" >> .env
    echo "  generated ${key}"
    changed=1
  fi
done

chmod 600 .env

if [ "${changed}" -eq 1 ]; then
  echo
  echo "Back up .env somewhere safe. Losing MFA_ENCRYPTION_KEY locks every"
  echo "account with a second factor out of acting."
fi
