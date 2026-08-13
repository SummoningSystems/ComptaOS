#!/bin/bash
set -euo pipefail

REPO="$HOME/apps/comptaos"
IMAGE=comptaos-ocr:3.3.0
CONTAINER=comptaos-ocr
BACKUP=comptaos-ocr-rollback
NETWORK=tipforgood_tipforgood-network

docker build --tag "$IMAGE" "$REPO/deployment/ocr-worker"
docker rm --force "$BACKUP" >/dev/null 2>&1 || true
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker rename "$CONTAINER" "$BACKUP"
  docker stop "$BACKUP" >/dev/null
fi

rollback() {
  echo "Le nouveau worker OCR a échoué, restauration du précédent." >&2
  docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
  if docker inspect "$BACKUP" >/dev/null 2>&1; then docker rename "$BACKUP" "$CONTAINER"; docker start "$CONTAINER" >/dev/null; fi
}
trap rollback ERR

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --cpus 1 \
  --memory 1536m \
  --pids-limit 256 \
  --read-only \
  --tmpfs /tmp:size=256m \
  --volume comptaos-ocr-models:/root/.paddlex:rw \
  "$IMAGE" >/dev/null

for attempt in $(seq 1 120); do
  if docker exec "$CONTAINER" python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" >/dev/null 2>&1; then
    docker rm "$BACKUP" >/dev/null 2>&1 || true
    trap - ERR
    echo "OCR local prêt (CPU limité à 1, file séquentielle)."
    exit 0
  fi
  sleep 5
done

docker logs --tail 50 "$CONTAINER" >&2
false
