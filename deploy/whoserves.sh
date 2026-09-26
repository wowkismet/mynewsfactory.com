#!/usr/bin/env bash
# Read-only. Changes nothing. Prints ~12 lines: who actually serves port 443,
# and which config claims mynewsfactory.com.
set -u
[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo bash $0"; exit 1; }

echo "=== 1. who owns port 80 / 443 ==="
ss -tlnp 2>/dev/null | awk '/:80 |:443 /{print $4, $6}' | sed 's/users:(//; s/)$//' | sort -u

echo "=== 2. containers publishing 80/443 ==="
docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E ':80->|:443->' || echo "none"

echo "=== 3. mynewsfactory container ==="
docker ps -a --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -i mynews || echo "no such container"
curl -sS -o /dev/null -w "   127.0.0.1:3100 -> %{http_code}\n" --max-time 8 http://127.0.0.1:3100

echo "=== 4. every 443 server_name in host nginx ==="
nginx -T 2>/dev/null | awk '/listen[^;]*443/{f=1} f&&/server_name/{print "   "$0; f=0}' | tr -s ' ' || echo "   host nginx has no config"

echo "=== 5. does any rareminting config claim mynewsfactory? ==="
grep -rl 'rareminting' /etc/nginx 2>/dev/null | while read -r f; do
  grep -q 'mynewsfactory' "$f" && echo "   YES: $f" || true
done | sort -u
echo "   (blank above = no)"

echo "=== 6. what is actually served ==="
for h in mynewsfactory.com rareminting.com; do
  t=$(curl -sk --max-time 10 --resolve "$h:443:127.0.0.1" "https://$h/" 2>/dev/null \
      | tr -d '\n' | grep -o '<title[^>]*>[^<]*' | head -1 | sed 's/.*>//' | cut -c1-40)
  printf '   %-20s %s\n' "$h" "${t:-no title}"
done
