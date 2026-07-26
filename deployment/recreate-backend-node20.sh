#!/bin/bash
set -euo pipefail

CONTAINER=comptaos-backend
BACKUP_CONTAINER=comptaos-backend-node18-backup
NODE_IMAGE=node:20.19.5-alpine
REPO="$HOME/apps/comptaos"

current_image=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
if [ "$current_image" = "$NODE_IMAGE" ]; then
  docker restart "$CONTAINER" >/dev/null
  echo "$CONTAINER redémarré avec $NODE_IMAGE"
  exit 0
fi

if docker container inspect "$BACKUP_CONTAINER" >/dev/null 2>&1; then
  echo "Le conteneur de rollback $BACKUP_CONTAINER existe déjà; migration refusée." >&2
  exit 1
fi

env_file=$(mktemp /tmp/comptaos-env.XXXXXX)
chmod 600 "$env_file"
trap 'rm -f "$env_file"' EXIT
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" \
  | grep -Ev '^(PATH|NODE_VERSION|YARN_VERSION)=' > "$env_file"

docker pull "$NODE_IMAGE" >/dev/null
docker rename "$CONTAINER" "$BACKUP_CONTAINER"
docker stop "$BACKUP_CONTAINER" >/dev/null

rollback() {
  echo "Échec Node 20, restauration du conteneur Node 18." >&2
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rename "$BACKUP_CONTAINER" "$CONTAINER"
  docker start "$CONTAINER" >/dev/null
}
trap 'rollback; rm -f "$env_file"' ERR

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network tipforgood_tipforgood-network \
  --env-file "$env_file" \
  -v "$REPO/backend:/app" \
  -v "$REPO/workspace:/workspace" \
  -w /app \
  "$NODE_IMAGE" \
  node dist/index.js >/dev/null

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$CONTAINER" wget -q -O /dev/null http://127.0.0.1:3003/api/health; then
    trap 'rm -f "$env_file"' EXIT
    echo "$CONTAINER migré vers $NODE_IMAGE; rollback conservé dans $BACKUP_CONTAINER"
    exit 0
  fi
  sleep 2
done

echo "Le backend Node 20 n'a pas passé son health check." >&2
false
