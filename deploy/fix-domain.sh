#!/usr/bin/env bash
# Repair mynewsfactory.com serving on this host.
#
# Root cause this fixes: the mynewsfactory vhost proxies to 127.0.0.1:3000,
# which is rareminting's app. nginx matches the server_name correctly and then
# hands the request to the wrong upstream, so the domain shows the other site.
#
# Safety rules this script obeys:
#   - The proxy_pass rewrite is scoped to individual server blocks whose
#     server_name mentions mynewsfactory and which do not mention rareminting.
#     A block belonging to rareminting is never touched, even in a shared file.
#   - /etc/nginx is backed up before any change, and restored if nginx -t fails.
#   - No process is killed and no unit outside this project is touched.

set -u

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'
step() { printf '\n%s== %s ==%s\n' "$YEL" "$*" "$OFF"; }
ok()   { printf '%s  ok%s  %s\n' "$GRN" "$OFF" "$*"; }
bad()  { printf '%s  !!%s  %s\n' "$RED" "$OFF" "$*"; }

[ "$(id -u)" -eq 0 ] || { bad "run as root: sudo bash $0"; exit 1; }

APP=/srv/mynewsfactory
PORT=3100
CHANGED=0

# ---------------------------------------------------------------- 1. container
step "1. container"
docker ps -a --format '{{.Names}} | {{.Status}} | {{.Ports}}' 2>/dev/null | sed 's/^/   /'

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx mynewsfactory; then
  ok "mynewsfactory is running"
else
  bad "mynewsfactory is not running - starting it"
  [ -d "$APP" ] && ( cd "$APP" && docker compose up -d --build ) || bad "could not start it"
fi

step "2. app on 127.0.0.1:$PORT"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:$PORT" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  ok "127.0.0.1:$PORT -> 200"
else
  bad "127.0.0.1:$PORT -> ${CODE:-no answer}"
  docker logs --tail 25 mynewsfactory 2>&1 | sed 's/^/      /' || true
fi

# ------------------------------------------------------------------ 3. backup
step "3. backup"
BACKUP=/root/nginx-backup-$(date +%Y%m%d-%H%M%S)
cp -a /etc/nginx "$BACKUP" && ok "saved $BACKUP"

restore() {
  bad "restoring $BACKUP"
  rm -rf /etc/nginx && cp -a "$BACKUP" /etc/nginx
  nginx -t && systemctl reload nginx
}

# ------------------------------------------------- 4. correct the upstream port
# Rewrites 127.0.0.1:3000 -> 127.0.0.1:PORT, but only inside a server block that
# mentions mynewsfactory and does not mention rareminting. Blocks are buffered
# whole and matched individually, so a file holding both sites is handled safely.
step "4. upstream port in the mynewsfactory server block"

rewrite_blocks() {
  awk -v want="$PORT" '
    function flush() {
      if (buf != "") {
        if (buf ~ /mynewsfactory/ && buf !~ /rareminting/) {
          n = gsub(/127\.0\.0\.1:3000/, "127.0.0.1:" want, buf)
          if (n > 0) hits += n
        }
        printf "%s", buf
        buf = ""
      }
    }
    {
      op = $0; nopen  = gsub(/\{/, "{", op)
      cl = $0; nclose = gsub(/\}/, "}", cl)

      if (!inblk && depth == 0 && $0 ~ /^[[:space:]]*server[[:space:]]*(\{|$)/) inblk = 1

      if (inblk) buf = buf $0 "\n"; else print

      depth += nopen - nclose

      if (inblk && depth <= 0) { flush(); inblk = 0; depth = 0 }
    }
    END { flush(); if (hits > 0) print "REWROTE=" hits > "/dev/stderr" }
  ' "$1"
}

for link in /etc/nginx/sites-enabled/*; do
  [ -e "$link" ] || continue
  f=$(readlink -f "$link")
  grep -q 'mynewsfactory' "$f" 2>/dev/null || continue

  tmp=$(mktemp)
  rewrite_blocks "$f" 2>/dev/null > "$tmp"

  if cmp -s "$f" "$tmp"; then
    rm -f "$tmp"
  else
    cat "$tmp" > "$f" && rm -f "$tmp"
    bad "corrected proxy_pass 3000 -> $PORT in $f"
    CHANGED=1
  fi

  echo "   $f"
  awk '/^[[:space:]]*(server_name|proxy_pass|listen)/ {print "      " $0}' "$f" | tr -s ' '
done

[ "$CHANGED" -eq 0 ] && ok "no port correction was needed"

# ------------------------------------------------- 5. default_server on 443
step "5. default server on 443"
if nginx -T 2>/dev/null | grep -qE 'listen[^;]*443[^;]*default_server'; then
  ok "443 default_server exists"
else
  bad "no 443 default_server - adding a silent catch-all"
  NGXV=$(nginx -v 2>&1 | sed 's#.*nginx/##; s#[^0-9.].*##')
  OLDEST=$(printf '1.19.4\n%s\n' "${NGXV:-0}" | sort -V | head -1)
  CATCH=/etc/nginx/sites-available/zz-catch-all-ssl

  if [ "$OLDEST" = "1.19.4" ]; then
    cat > "$CATCH" <<'EOF'
# Silent catch-all for HTTPS whose SNI matches no site here. Without it, such a
# request is served by whichever 443 block loaded first -- somebody else's site.
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
}
EOF
  else
    KEY=/etc/ssl/private/nginx-catchall.key
    CRT=/etc/ssl/certs/nginx-catchall.crt
    [ -f "$CRT" ] || { openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
        -keyout "$KEY" -out "$CRT" -subj "/CN=invalid" >/dev/null 2>&1; chmod 600 "$KEY"; }
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
    bad "config rejected, nothing changed"
    exit 1
  fi
else
  ok "no nginx change was needed"
fi

# ------------------------------------------------------------------ 7. verify
step "7. what each domain serves"
for h in mynewsfactory.com www.mynewsfactory.com rareminting.com; do
  code=$(curl -sk --max-time 15 -o /dev/null -w '%{http_code}' \
         --resolve "$h:443:127.0.0.1" "https://$h/" 2>/dev/null)
  title=$(curl -sk --max-time 15 --resolve "$h:443:127.0.0.1" "https://$h/" 2>/dev/null \
          | tr -d '\n' | grep -o '<title[^>]*>[^<]*' | head -1 | sed 's/.*>//' | cut -c1-45)
  printf '   %-26s %s   %s\n' "$h" "${code:-000}" "${title:-no title}"
done

step "done"
echo "   backup: $BACKUP"
echo "   undo:   rm -rf /etc/nginx && cp -a $BACKUP /etc/nginx && nginx -t && systemctl reload nginx"
