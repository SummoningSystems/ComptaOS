#!/bin/bash
set -euo pipefail

CONTAINER=comptaos-backend
NODE_IMAGE=comptaos-backend:node20-git
REPO="$HOME/apps/comptaos"

docker build -f "$REPO/deployment/backend.Dockerfile" -t "$NODE_IMAGE" "$REPO"

host_uid=$(id -u)
host_gid=$(id -g)
docker run --rm -v "$REPO/workspace:/workspace" alpine:3.20 chown -R "$host_uid:$host_gid" /workspace
docker run --rm -v "$REPO/backend:/app" alpine:3.20 sh -c "test ! -d /app/dist || chown -R $host_uid:$host_gid /app/dist"

env_file=$(mktemp /tmp/comptaos-env.XXXXXX)
chmod 600 "$env_file"
trap 'rm -f "$env_file"' EXIT
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" \
  | grep -Ev '^(PATH|NODE_VERSION|YARN_VERSION|OCR_LOCAL_URL|OCR_REMOTE_FALLBACK|OCR_LOCAL_TIMEOUT_MS)=' > "$env_file"

backup_container="comptaos-backend-rollback-$(date +%Y%m%d%H%M%S)"
docker rename "$CONTAINER" "$backup_container"
docker stop "$backup_container" >/dev/null

rollback() {
  echo "Échec de la recréation, restauration du backend précédent." >&2
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rename "$backup_container" "$CONTAINER"
  docker start "$CONTAINER" >/dev/null
}
trap 'rollback; rm -f "$env_file"' ERR

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network tipforgood_tipforgood-network \
  --env-file "$env_file" \
  -e OCR_LOCAL_URL=http://comptaos-ocr:8000 \
  -e OCR_REMOTE_FALLBACK=false \
  -e OCR_LOCAL_TIMEOUT_MS=180000 \
  -v "$REPO/backend:/app" \
  -v "$REPO/workspace:/workspace" \
  --user "$host_uid:$host_gid" \
  -w /app \
  "$NODE_IMAGE" \
  node dist/index.js >/dev/null

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$CONTAINER" wget -q -O /dev/null http://127.0.0.1:3003/api/health; then
    trap 'rm -f "$env_file"' EXIT
    echo "$CONTAINER recréé; rollback conservé dans $backup_container"
    exit 0
  fi
  sleep 2
done

echo "Le backend n'a pas passé son health check." >&2
false
