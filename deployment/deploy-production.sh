#!/bin/bash
set -euo pipefail
REPO="${REPO:-$HOME/apps/comptaos}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-tipforgood_frontend_1}"
RELEASE="comptaos-release-$(date +%Y%m%d%H%M%S)"
STAGING="/usr/share/nginx/html/$RELEASE"
CURRENT="/usr/share/nginx/html/comptaos"
BACKUP="/usr/share/nginx/html/comptaos-rollback"

cd "$REPO"
git pull --ff-only origin master
docker run --rm -e BASE_PATH=/comptaos/ -v "$REPO/frontend:/app" -w /app node:20.19.5-alpine sh -c 'npm run build'
docker run --rm -v "$REPO/backend:/app" -w /app node:20.19.5-alpine sh -c 'npm run build'

index="$REPO/frontend/dist/index.html"
grep -q 'src="/comptaos/assets/' "$index"
grep -q 'href="/comptaos/assets/' "$index"
while IFS= read -r asset; do test -f "$REPO/frontend/dist/${asset#/comptaos/}" || exit 1; done < <(grep -oE '/comptaos/assets/[^" ]+' "$index" | sort -u)

bash "$REPO/deployment/deploy-local-ocr.sh"
bash "$REPO/deployment/recreate-backend-node20.sh"
docker exec "$FRONTEND_CONTAINER" mkdir -p "$STAGING"
docker cp "$REPO/frontend/dist/." "$FRONTEND_CONTAINER:$STAGING/"
docker exec "$FRONTEND_CONTAINER" sh -c "test -s '$STAGING/index.html' && rm -rf '$BACKUP' && if test -d '$CURRENT'; then mv '$CURRENT' '$BACKUP'; fi && mv '$STAGING' '$CURRENT'"
rollback() { docker exec "$FRONTEND_CONTAINER" sh -c "rm -rf '$CURRENT'; test ! -d '$BACKUP' || mv '$BACKUP' '$CURRENT'"; }
trap rollback ERR
curl -fsS --max-time 10 https://tipforgood.com/comptaos/ | grep -q '/comptaos/assets/'
main_asset=$(grep -oE '/comptaos/assets/index-[^" ]+\.js' "$index" | head -1)
curl -fsS --max-time 20 "https://tipforgood.com$main_asset" >/dev/null
curl -fsS --max-time 10 https://tipforgood.com/comptaos/api/health | grep -q '"status":"ok"'
trap - ERR
docker exec "$FRONTEND_CONTAINER" rm -rf "$BACKUP"
docker ps -a --format '{{.Names}}' | grep '^comptaos-backend-rollback-' | sort -r | tail -n +3 | xargs -r docker rm
echo "Déploiement validé : $main_asset"
