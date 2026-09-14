#!/usr/bin/env bash
#
# Deploys the My News Factory portal on Ubuntu with nginx already installed.
#
#   sudo bash deploy/install.sh
#
# The repository is private, so the clone uses a read-only GitHub deploy key.
# Run with no key present and the script generates one, prints it and stops
# with instructions — rerun once the key is registered on the repository.
#
# Override the source with:  REPO=... bash deploy/install.sh
set -euo pipefail

REPO="${REPO:-git@github.com:wowkismet/mynewsfactory.com.git}"
APP=/srv/mynewsfactory
SVC=mynewsfactory
KEY=/root/.ssh/mnf_deploy
NODE_MAJOR=22

say() { printf '\n==> %s\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"

# --- deploy key ------------------------------------------------------------
if [[ "$REPO" == git@* ]]; then
  say "GitHub deploy key"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh

  if [ ! -f "$KEY" ]; then
    ssh-keygen -t ed25519 -f "$KEY" -N "" -C "mnf-vps-deploy" >/dev/null
    chmod 600 "$KEY"
  fi

  if ! grep -q 'IdentityFile '"$KEY" /root/.ssh/config 2>/dev/null; then
    printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' "$KEY" >> /root/.ssh/config
    chmod 600 /root/.ssh/config
  fi

  # `ssh -T git@github.com` exits 1 even on success, so match the greeting.
  if ! ssh -o BatchMode=yes -T git@github.com 2>&1 | grep -q 'successfully authenticated'; then
    cat <<MSG

The deploy key is not registered on the repository yet.

1. Copy the public key below.
2. Open  https://github.com/wowkismet/mynewsfactory.com/settings/keys
3. "Add deploy key" — paste it, leave "Allow write access" UNCHECKED, save.
4. Re-run this script.

------------------------------------------------------------------
$(cat "$KEY".pub)
------------------------------------------------------------------
MSG
    exit 2
  fi
  echo "deploy key authenticates to GitHub"
fi

# --- node ------------------------------------------------------------------
say "Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v

# --- service user ----------------------------------------------------------
say "service user"
id -u mnf >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin mnf

# --- source ----------------------------------------------------------------
say "source"
if [ -d "$APP/.git" ]; then
  git -C "$APP" remote set-url origin "$REPO"
  git -C "$APP" fetch --depth 1 origin main
  git -C "$APP" reset --hard origin/main
else
  [ -e "$APP" ] && die "$APP exists but is not a git clone — move it aside first"
  git clone --depth 1 "$REPO" "$APP"
fi
git -C "$APP" --no-pager log --oneline -1

# --- build -----------------------------------------------------------------
say "build"
cd "$APP/web"
npm ci
npm run build
chown -R mnf:mnf "$APP"

# --- service ---------------------------------------------------------------
say "service"
install -m 0644 "$APP/deploy/mynewsfactory.service" "/etc/systemd/system/$SVC.service"
systemctl daemon-reload
systemctl enable --now "$SVC"
sleep 3
systemctl is-active --quiet "$SVC" || { journalctl -u "$SVC" -n 40 --no-pager; die "service failed to start"; }
echo "$SVC is active"

# --- nginx -----------------------------------------------------------------
say "nginx"
VHOST=/etc/nginx/sites-available/mynewsfactory.com
[ -f "$VHOST" ] && cp "$VHOST" "$VHOST.bak.$(date +%s)"
install -m 0644 "$APP/deploy/nginx-mynewsfactory.conf" "$VHOST"
ln -sf "$VHOST" /etc/nginx/sites-enabled/
nginx -t
# reload has been observed not to pick up vhost changes on this host.
systemctl restart nginx

# --- verify ----------------------------------------------------------------
say "verify"
APP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 || true)
WEB_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: mynewsfactory.com' http://127.0.0.1 || true)
printf 'app  127.0.0.1:3000            -> %s\n' "$APP_CODE"
printf 'site via nginx (Host header)   -> %s\n' "$WEB_CODE"
[ "$APP_CODE" = "200" ] || die "the app is not responding on port 3000"
[ "$WEB_CODE" = "200" ] || die "nginx is not proxying to the app"

cat <<'DONE'

Deployed. http://mynewsfactory.com should now serve the portal.

Next, for TLS:
  certbot --nginx -d mynewsfactory.com -d www.mynewsfactory.com
  certbot renew --dry-run

The old placeholder is still at /var/www/mynewsfactory.com/html and the
previous vhost was backed up alongside the new one. Remove them once you are
happy the new site is serving.
DONE
