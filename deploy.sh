#!/bin/bash
set -euo pipefail

REPO="$HOME/apps/comptaos"
NGINX_HTML=/usr/share/nginx/html/comptaos
NODE_IMAGE=node:20.19.5-alpine

echo "=== [1/7] git pull ==="
cd "$REPO"
git pull --ff-only origin master

echo "=== [2/7] build frontend (Node 20) ==="
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e BASE_PATH=/comptaos/ \
  -v "$REPO/frontend:/app" \
  -w /app \
  "$NODE_IMAGE" \
  sh -c 'npm ci --prefer-offline --silent && npm run build'

echo "=== [3/7] build backend (Node 20) ==="
docker run --rm \
  -v "$REPO/backend:/app" \
  -w /app \
  "$NODE_IMAGE" \
  sh -c 'npm ci --prefer-offline --silent && npm run build'

echo "=== [4/7] install nginx security headers ==="
docker cp "$REPO/deployment/nginx/comptaos-security.conf" tipforgood_frontend_1:/etc/nginx/conf.d/comptaos-security.conf
if ! docker exec tipforgood_frontend_1 nginx -t; then
  docker exec tipforgood_frontend_1 rm -f /etc/nginx/conf.d/comptaos-security.conf
  echo "Configuration Nginx refusée et retirée." >&2
  exit 1
fi

echo "=== [5/7] deploy frontend ==="
docker cp "$REPO/frontend/dist/." tipforgood_frontend_1:"$NGINX_HTML/"
docker exec tipforgood_frontend_1 nginx -s reload

echo "=== [6/7] migrate or restart backend ==="
"$REPO/deployment/recreate-backend-node20.sh"

echo "=== [7/7] health check ==="
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --show-error https://tipforgood.com/comptaos/api/health; then
    echo
    echo "=== DEPLOY OK ==="
    exit 0
  fi
  sleep 2
done

echo "Health check failed after backend restart" >&2
exit 1
