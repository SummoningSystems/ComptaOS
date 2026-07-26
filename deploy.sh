#!/bin/bash
set -e
REPO="$HOME/apps/comptaos"
NGINX_HTML=/usr/share/nginx/html/comptaos

echo "=== [1/6] git pull ==="
cd "$REPO"
git pull --ff-only origin master

echo "=== [2/6] build frontend ==="
cd "$REPO/frontend"
npm ci --prefer-offline --silent
NODE_OPTIONS=--experimental-global-webcrypto BASE_PATH=/comptaos/ npm run build

echo "=== [3/6] build backend ==="
docker exec comptaos-backend sh -c 'cd /app && npx tsc --build'

echo "=== [4/6] deploy frontend ==="
docker cp "$REPO/frontend/dist/." tipforgood_frontend_1:"$NGINX_HTML/"
docker exec tipforgood_frontend_1 nginx -t
docker exec tipforgood_frontend_1 nginx -s reload

echo "=== [5/6] restart backend ==="
docker restart comptaos-backend

echo "=== [6/6] health check ==="
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
