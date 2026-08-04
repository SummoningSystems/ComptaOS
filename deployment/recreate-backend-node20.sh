#!/bin/bash
set -euo pipefail

CONTAINER=comptaos-backend
NODE_IMAGE=node:20.19.5-alpine
REPO="$HOME/apps/comptaos"

current_image=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
has_local_ocr=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" | grep -c '^OCR_LOCAL_URL=http://comptaos-ocr:8000$' || true)
if [ "$current_image" = "$NODE_IMAGE" ] && [ "$has_local_ocr" -eq 1 ]; then
  docker restart "$CONTAINER" >/dev/null
  echo "$CONTAINER redémarré avec OCR local actif"
  exit 0
fi

env_file=$(mktemp /tmp/comptaos-env.XXXXXX)
chmod 600 "$env_file"
trap 'rm -f "$env_file"' EXIT
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" \
  | grep -Ev '^(PATH|NODE_VERSION|YARN_VERSION|OCR_LOCAL_URL|OCR_REMOTE_FALLBACK)=' > "$env_file"

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
  -v "$REPO/backend:/app" \
  -v "$REPO/workspace:/workspace" \
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
