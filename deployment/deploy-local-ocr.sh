#!/bin/bash
set -euo pipefail

REPO="$HOME/apps/comptaos"
IMAGE=comptaos-ocr:3.2.0
CONTAINER=comptaos-ocr
NETWORK=tipforgood_tipforgood-network

docker build --tag "$IMAGE" "$REPO/deployment/ocr-worker"
docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
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
  if docker exec "$CONTAINER" python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"; then
    echo "OCR local prêt (CPU limité à 1, file séquentielle)."
    exit 0
  fi
  sleep 5
done

echo "Le service OCR local n'a pas passé son health check." >&2
docker logs --tail 50 "$CONTAINER" >&2
exit 1
