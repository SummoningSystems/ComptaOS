#!/bin/bash
set -euo pipefail

BRANCH="${BRANCH:-release/develop-migration}"
ROOT="${PREPROD_ROOT:-$HOME/apps/comptaos-preprod}"
REPO="$ROOT/repo"
WORKSPACE="$ROOT/workspace"
PRODUCTION_WORKSPACE="${PRODUCTION_WORKSPACE:-$HOME/apps/comptaos/workspace}"
NETWORK="${NETWORK:-comptaos-preprod-network}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-tipforgood_frontend_1}"
NGINX_CONFIG="/etc/nginx/conf.d/default.conf"
BACKEND="comptaos-preprod-backend"
WEB="comptaos-preprod-web"
timestamp=$(date +%Y%m%d%H%M%S)

mkdir -p "$ROOT/backups"
if [[ ! -d "$REPO/.git" ]]; then
  git clone --branch "$BRANCH" --single-branch https://github.com/SummoningSystems/ComptaOS.git "$REPO"
else
  cd "$REPO"
  current_branch=$(git branch --show-current)
  [[ "$current_branch" == "$BRANCH" ]] || { echo "Branche inattendue dans $REPO: $current_branch" >&2; exit 1; }
  git pull --ff-only origin "$BRANCH"
fi

cd "$REPO"
commit=$(git rev-parse --short=12 HEAD)
if [[ ! -d "$WORKSPACE" ]]; then
  [[ -d "$PRODUCTION_WORKSPACE" ]] || { echo "Workspace de production introuvable." >&2; exit 1; }
  cp -a "$PRODUCTION_WORKSPACE" "$WORKSPACE"
  umask 077
  openssl rand -hex 32 > "$WORKSPACE/.jwt_secret"
else
  backup_name="workspace-before-$timestamp.tar.gz"
  docker run --rm -v "$ROOT:/source:ro" -v "$ROOT/backups:/backup" alpine:3.20 tar -C /source -czf "/backup/$backup_name" workspace
  docker run --rm -v "$ROOT/backups:/backup" alpine:3.20 tar -tzf "/backup/$backup_name" >/dev/null
  docker run --rm -v "$ROOT/backups:/backup" alpine:3.20 chown "$(id -u):$(id -g)" "/backup/$backup_name"
fi

backend_image="comptaos-preprod-backend:$commit"
web_image="comptaos-preprod-web:$commit"
docker build -f deployment/preproduction-backend.Dockerfile -t "$backend_image" .
docker build -f deployment/preproduction-web.Dockerfile -t "$web_image" .
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
if ! docker inspect "$FRONTEND_CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$NETWORK\""; then
  docker network connect "$NETWORK" "$FRONTEND_CONTAINER"
fi

rollback_backend="${BACKEND}-rollback-$timestamp"
rollback_web="${WEB}-rollback-$timestamp"
had_backend=false
had_web=false
nginx_backup=$(mktemp)
nginx_candidate=$(mktemp)
docker exec "$FRONTEND_CONTAINER" cat "$NGINX_CONFIG" > "$nginx_backup"
cp "$nginx_backup" "$nginx_candidate"

rollback() {
  docker rm -f "$WEB" "$BACKEND" >/dev/null 2>&1 || true
  if [[ "$had_backend" == true ]]; then docker rename "$rollback_backend" "$BACKEND"; docker start "$BACKEND" >/dev/null; fi
  if [[ "$had_web" == true ]]; then docker rename "$rollback_web" "$WEB"; docker start "$WEB" >/dev/null; fi
  docker cp "$nginx_backup" "$FRONTEND_CONTAINER:$NGINX_CONFIG" >/dev/null 2>&1 || true
  docker exec "$FRONTEND_CONTAINER" nginx -s reload >/dev/null 2>&1 || true
}
trap rollback ERR
trap 'rm -f "$nginx_backup" "$nginx_candidate"' EXIT

if docker inspect "$WEB" >/dev/null 2>&1; then had_web=true; docker rename "$WEB" "$rollback_web"; docker stop "$rollback_web" >/dev/null; fi
if docker inspect "$BACKEND" >/dev/null 2>&1; then had_backend=true; docker rename "$BACKEND" "$rollback_backend"; docker stop "$rollback_backend" >/dev/null; fi

docker run -d --name "$BACKEND" --restart unless-stopped \
  --network "$NETWORK" \
  -e AUTH_ENABLED=true -e NODE_ENV=production -e HTTPS_ONLY=true \
  -e AUTH_COOKIE_NAME=comptaos_preprod_token -e AUTH_COOKIE_PATH=/comptaos-preprod \
  -e HOST=0.0.0.0 -e PORT=3004 -e WORKSPACE_PATH=/workspace \
  -e OCR_LOCAL_URL= -e OCR_REMOTE_FALLBACK=false \
  -v "$WORKSPACE:/workspace" \
  "$backend_image" >/dev/null

docker run -d --name "$WEB" --restart unless-stopped \
  --network "$NETWORK" \
  "$web_image" >/dev/null

if ! grep -q 'COMPTAOS PREPRODUCTION' "$nginx_candidate"; then
  awk -v block="$REPO/deployment/comptaos-preproduction-location.conf" '
    /# Cache pour les assets statiques/ && !inserted {
      while ((getline line < block) > 0) print line;
      close(block); inserted=1
    }
    { print }
    END { if (!inserted) exit 42 }
  ' "$nginx_backup" > "$nginx_candidate"
fi
docker cp "$nginx_candidate" "$FRONTEND_CONTAINER:$NGINX_CONFIG"
docker exec "$FRONTEND_CONTAINER" nginx -t
docker exec "$FRONTEND_CONTAINER" nginx -s reload

ready=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 https://tipforgood.com/comptaos-preprod/api/health | grep -q '"status":"ok"'; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { docker logs --tail 80 "$BACKEND" >&2; exit 1; }

trap - ERR
docker rm "$rollback_web" "$rollback_backend" >/dev/null 2>&1 || true
printf '%s\n' "Préproduction déployée: commit=$commit url=https://tipforgood.com/comptaos-preprod/"
