#!/usr/bin/env bash
# Deploys the My News Factory portal on Ubuntu with nginx already installed.
# Run as root:  bash deploy/install.sh
set -euo pipefail

REPO=https://github.com/wowkismet/mynewsfactory.com
APP=/srv/mynewsfactory
SVC=mynewsfactory

echo "==> Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> service user"
id -u mnf >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin mnf

echo "==> source"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --depth 1 origin main
  git -C "$APP" reset --hard origin/main
else
  rm -rf "$APP"
  git clone --depth 1 "$REPO" "$APP"
fi

echo "==> build"
cd "$APP/web"
npm ci
npm run build
chown -R mnf:mnf "$APP"

echo "==> service"
install -m 0644 "$APP/deploy/mynewsfactory.service" /etc/systemd/system/$SVC.service
systemctl daemon-reload
systemctl enable --now $SVC
sleep 3
systemctl is-active --quiet $SVC || { journalctl -u $SVC -n 40 --no-pager; exit 1; }

echo "==> nginx"
install -m 0644 "$APP/deploy/nginx-mynewsfactory.conf" /etc/nginx/sites-available/mynewsfactory.com
ln -sf /etc/nginx/sites-available/mynewsfactory.com /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

echo "==> check"
curl -sS -o /dev/null -w "app  127.0.0.1:3000 -> %{http_code}\n" http://127.0.0.1:3000
curl -sS -o /dev/null -w "site via nginx     -> %{http_code}\n" -H 'Host: mynewsfactory.com' http://127.0.0.1

echo
echo "Done. Next: certbot --nginx -d mynewsfactory.com -d www.mynewsfactory.com"
