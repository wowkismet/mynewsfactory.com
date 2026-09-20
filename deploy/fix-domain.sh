#!/usr/bin/env bash
# Diagnose and repair mynewsfactory.com serving on this host.
#
# Safety rules this script obeys:
#   - It never edits, reloads over, or kills anything belonging to rareminting.
#   - It backs up the whole of /etc/nginx before any change.
#   - It only adds nginx config; it never rewrites an existing site file except
#     to correct a proxy_pass port inside a file that mentions mynewsfactory.com
#     and does not mention rareminting.
#   - If "nginx -t" fails after a change, the backup is restored and nginx is
#     left exactly as it was.

set -u

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'
step() { printf '\n%s== %s ==%s\n' "$YEL" "$*" "$OFF"; }
ok()   { printf '%s  ok%s  %s\n' "$GRN" "$OFF" "$*"; }
bad()  { printf '%s  !!%s  %s\n' "$RED" "$OFF" "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  bad "run this as root (sudo bash $0)"
  exit 1
fi

APP=/srv/mynewsfactory
PORT=3100
CHANGED=0

# ---------------------------------------------------------------- 1. container
step "1. container state"
docker ps -a --format '{{.Names}} | {{.Status}} | {{.Ports}}' 2>/dev/null || bad "docker not responding"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx mynewsfactory; then
  ok "container mynewsfactory is running"
else
  bad "container mynewsfactory is NOT running - starting it"
  if [ -d "$APP" ]; then
    ( cd "$APP" && docker compose up -d --build ) || bad "docker compose failed - read the output above"
  else
    bad "$APP does not exist; cannot start the container"
  fi
fi

# ------------------------------------------------------------------- 2. the app
step "2. app on 127.0.0.1:$PORT"
APP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:$PORT" 2>/dev/null)
if [ "$APP_CODE" = "200" ]; then
  ok "127.0.0.1:$PORT -> 200"
else
  bad "127.0.0.1:$PORT -> ${APP_CODE:-no answer}  (nginx has nothing to proxy to)"
  docker logs --tail 30 mynewsfactory 2>&1 | sed 's/^/      /' || true
fi

# ------------------------------------------------------------------ 3. backup
step "3. backing up nginx"
BACKUP=/root/nginx-backup-$(date +%Y%m%d-%H%M%S)
cp -a /etc/nginx "$BACKUP" && ok "saved to $BACKUP"

restore() {
  bad "restoring nginx from $BACKUP"
  rm -rf /etc/nginx && cp -a "$BACKUP" /etc/nginx
  nginx -t && systemctl reload nginx
}

# ------------------------------------------------------------------- 4. vhost
step "4. mynewsfactory vhost"
VH=""
for f in /etc/nginx/sites-enabled/*; do
  [ -f "$f" ] || continue
  if grep -q 'mynewsfactory\.com' "$f" && ! grep -qi 'rareminting' "$f"; then
    VH=$(readlink -f "$f"); break
  fi
done

if [ -z "$VH" ]; then
  bad "no enabled vhost mentions mynewsfactory.com - nothing routes the domain"
else
  ok "vhost: $VH"
  if grep -q 'listen.*443' "$VH"; then
    ok "vhost has a 443 block"
  else
    bad "vhost has NO 443 block - HTTPS for this domain falls through to another site"
    bad "fix: certbot --nginx -d mynewsfactory.com -d www.mynewsfactory.com"
  fi
  if grep -q "proxy_pass http://127.0.0.1:3000" "$VH"; then
    bad "vhost still proxies to port 3000 (that is rareminting's port) - correcting to $PORT"
    sed -i "s#proxy_pass http://127\.0\.0\.1:3000#proxy_pass http://127.0.0.1:$PORT#g" "$VH"
    CHANGED=1
  fi
  grep -nE 'server_name|listen|proxy_pass|ssl_certificate ' "$VH" | sed 's/^/      /'
fi

# ------------------------------------------------- 5. default_server on 443
step "5. default server on 443"
if nginx -T 2>/dev/null | grep -qE 'listen[^;]*443[^;]*default_server'; then
  ok "a 443 default_server already exists - unmatched HTTPS is not leaking"
else
  bad "NO 443 default_server - unmatched HTTPS lands on whichever site loaded first"
  echo "      adding a silent catch-all so only exact server_name matches are served"

  NGXV=$(nginx -v 2>&1 | sed 's#.*nginx/##; s#[^0-9.].*##')
  # ssl_reject_handshake needs nginx >= 1.19.4; older builds need a throwaway cert.
  OLDEST=$(printf '1.19.4\n%s\n' "${NGXV:-0}" | sort -V | head -1)

  CATCH=/etc/nginx/sites-available/zz-catch-all-ssl
  if [ "$OLDEST" = "1.19.4" ]; then
    cat > "$CATCH" <<'EOF'
# Silent catch-all for HTTPS requests whose SNI matches no site on this host.
# Without this, such a request is served by whichever 443 block nginx loaded
# first, which is how one domain ends up showing another domain's site.
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
}
EOF
  else
    # nginx older than 1.19.4 has no ssl_reject_handshake; use a throwaway cert.
    KEY=/etc/ssl/private/nginx-catchall.key
    CRT=/etc/ssl/certs/nginx-catchall.crt
    if [ ! -f "$CRT" ]; then
      openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
        -keyout "$KEY" -out "$CRT" -subj "/CN=invalid" >/dev/null 2>&1
      chmod 600 "$KEY"
    fi
    cat > "$CATCH" <<EOF
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_certificate $CRT;
    ssl_certificate_key $KEY;
    return 444;
}
EOF
  fi
  ln -sf "$CATCH" /etc/nginx/sites-enabled/zz-catch-all-ssl
  CHANGED=1
fi

# ------------------------------------------------------------------ 6. reload
step "6. validate and reload"
if [ "$CHANGED" -eq 1 ]; then
  if nginx -t; then
    systemctl reload nginx && ok "nginx reloaded"
  else
    restore
    bad "config was rejected; nothing changed. Paste the error above."
    exit 1
  fi
else
  ok "no nginx change was needed"
fi

# ------------------------------------------------------------------ 7. verify
step "7. what each domain actually serves"
for host in mynewsfactory.com www.mynewsfactory.com rareminting.com; do
  code=$(curl -sk --max-time 15 -o /dev/null -w '%{http_code}' \
         --resolve "$host:443:127.0.0.1" "https://$host/" 2>/dev/null)
  title=$(curl -sk --max-time 15 --resolve "$host:443:127.0.0.1" "https://$host/" 2>/dev/null \
          | tr -d '\n' | grep -o '<title[^>]*>[^<]*' | head -1 | sed 's/.*>//')
  printf '  %-26s %s   %s\n' "$host" "${code:-000}" "${title:-（no title）}"
done

step "done"
echo "  Backup of the previous nginx config: $BACKUP"
echo "  To undo everything this script did:"
echo "    rm -rf /etc/nginx && cp -a $BACKUP /etc/nginx && nginx -t && systemctl reload nginx"
