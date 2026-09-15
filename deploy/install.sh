#!/usr/bin/env bash
#
# Deploys the My News Factory portal on Ubuntu with nginx already installed.
#
#   sudo bash deploy/install.sh
#
# Clones over HTTPS by default. If the source is already present at the target
# path it is used as-is, so no GitHub credentials are needed at all. Only when
# REPO is overridden with an ssh:// form does the script set up a deploy key.
#
# Override the source with:  REPO=... bash deploy/install.sh
set -euo pipefail

REPO="${REPO:-https://github.com/wowkismet/mynewsfactory.com}"
APP=/srv/mynewsfactory
SVC=mynewsfactory
KEY=/root/.ssh/mnf_deploy
NODE_MAJOR=22

LOG=/var/log/mnf-deploy.log
exec > >(tee -a "$LOG") 2>&1
say() { printf '\n==> %s\n' "$1"; }
die() { printf '\nERROR: %s\n\nFull log: %s\n' "$1" "${LOG:-/var/log/mnf-deploy.log}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"

# Source already present (cloned by hand, or shipped in by CI): skip fetching
# entirely, which also means no GitHub credentials are needed.
if [ -d "$APP/web" ] && [ "${SKIP_FETCH:-0}" != "1" ]; then
  echo "source already present at $APP — skipping fetch"
  SKIP_FETCH=1
fi

# --- deploy key ------------------------------------------------------------
if [[ "$REPO" == git@* ]] && [ "${SKIP_FETCH:-0}" != "1" ]; then
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

# --- memory ----------------------------------------------------------------
# Next.js builds need roughly 2 GB. Small VPS plans OOM-kill the build with no
# useful error, so add swap when total memory + swap is short.
say "memory"
TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
echo "RAM ${TOTAL_MB}MB, swap ${SWAP_MB}MB"
if [ $((TOTAL_MB + SWAP_MB)) -lt 2400 ]; then
  if [ ! -f /swapfile ]; then
    echo "adding a 2G swapfile so the build does not get OOM-killed"
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  else
    swapon /swapfile 2>/dev/null || true
  fi
  free -m | awk '/^Swap:/{print "swap now " $2 "MB"}'
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
# SKIP_FETCH=1 means the source has already been placed in $APP by the caller
# (the GitHub Actions deploy copies it in over SSH), so no clone or deploy key
# is needed on the server.
if [ "${SKIP_FETCH:-0}" = "1" ]; then
  say "source (supplied by caller)"
  [ -d "$APP/web" ] || die "SKIP_FETCH=1 but $APP/web is missing"
elif [ -d "$APP/.git" ]; then
  say "source"
  git -C "$APP" remote set-url origin "$REPO"
  git -C "$APP" fetch --depth 1 origin main
  git -C "$APP" reset --hard origin/main
else
  say "source"
  [ -e "$APP" ] && die "$APP exists but is not a git clone — move it aside first"
  git clone --depth 1 "$REPO" "$APP"
fi
git -C "$APP" --no-pager log --oneline -1 2>/dev/null || true

# --- build -----------------------------------------------------------------
say "build"
cd "$APP/web"
npm ci
# Bound the heap so the kernel does not kill node outright.
if ! NODE_OPTIONS="--max-old-space-size=1536" npm run build; then
  echo
  echo "The build failed. If the last thing you see is 'Killed' or the log stops"
  echo "abruptly, the server ran out of memory. Check with: dmesg | tail -20"
  die "next build failed"
fi
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
