#!/bin/bash
set -euo pipefail

REPO="${REPO:-$HOME/apps/comptaos}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-tipforgood_frontend_1}"
STATE_DIR="$REPO/.deploy-state"
STATE_FILE="$STATE_DIR/last-successful-commit"
RELEASE="comptaos-release-$(date +%Y%m%d%H%M%S)"
STAGING="/usr/share/nginx/html/$RELEASE"
CURRENT="/usr/share/nginx/html/comptaos"
BACKUP="/usr/share/nginx/html/comptaos-rollback"

cd "$REPO"
before_pull=$(git rev-parse HEAD)
mkdir -p "$STATE_DIR"
base_commit=$(cat "$STATE_FILE" 2>/dev/null || printf '%s' "$before_pull")
git pull --ff-only origin master
target_commit=$(git rev-parse HEAD)

if ! git cat-file -e "$base_commit^{commit}" 2>/dev/null; then
  echo "Commit de référence inconnu, déploiement complet par sécurité."
  base_commit="$before_pull"
  FORCE_FULL=1
fi

changed_files=$(git diff --name-only "$base_commit" "$target_commit")
frontend_changed=false
backend_changed=false
ocr_changed=false

matches() { grep -Eq "$1" <<<"$changed_files"; }
if [[ "${FORCE_FULL:-0}" == "1" ]]; then
  frontend_changed=true; backend_changed=true; ocr_changed=true
else
  if matches '^(frontend/|deployment/nginx/)'; then frontend_changed=true; fi
  if matches '^(backend/|deployment/backend\.Dockerfile$|deployment/recreate-backend-node20\.sh$)'; then backend_changed=true; fi
  if matches '^deployment/(ocr-worker/|deploy-local-ocr\.sh$)'; then ocr_changed=true; fi
  if matches '^(package\.json|package-lock\.json|deployment/deploy-production\.sh$)'; then
    frontend_changed=true; backend_changed=true; ocr_changed=true
  fi
fi
[[ "${FORCE_FRONTEND:-0}" == "1" ]] && frontend_changed=true
[[ "${FORCE_BACKEND:-0}" == "1" ]] && backend_changed=true
[[ "${FORCE_OCR:-0}" == "1" ]] && ocr_changed=true

echo "Composants à déployer : frontend=$frontend_changed backend=$backend_changed ocr=$ocr_changed"
if [[ -n "$changed_files" ]]; then sed 's/^/  - /' <<<"$changed_files"; else echo "  - aucun fichier modifié"; fi

rollback_frontend() {
  docker exec "$FRONTEND_CONTAINER" sh -c "rm -rf '$CURRENT'; test ! -d '$BACKUP' || mv '$BACKUP' '$CURRENT'"
}

if [[ "$frontend_changed" == true ]]; then
  docker run --rm -e BASE_PATH=/comptaos/ -v "$REPO/frontend:/app" -w /app node:20.19.5-alpine sh -c 'npm run build'
  index="$REPO/frontend/dist/index.html"
  grep -q 'src="/comptaos/assets/' "$index"
  grep -q 'href="/comptaos/assets/' "$index"
  while IFS= read -r asset; do test -f "$REPO/frontend/dist/${asset#/comptaos/}" || exit 1; done < <(grep -oE '/comptaos/assets/[^" ]+' "$index" | sort -u)
fi

if [[ "$backend_changed" == true ]]; then
  docker run --rm -v "$REPO/backend:/app" -w /app node:20.19.5-alpine sh -c 'npm run build'
fi

if [[ "$ocr_changed" == true ]]; then bash "$REPO/deployment/deploy-local-ocr.sh"; fi
if [[ "$backend_changed" == true ]]; then bash "$REPO/deployment/recreate-backend-node20.sh"; fi

if [[ "$frontend_changed" == true ]]; then
  docker exec "$FRONTEND_CONTAINER" mkdir -p "$STAGING"
  docker cp "$REPO/frontend/dist/." "$FRONTEND_CONTAINER:$STAGING/"
  docker exec "$FRONTEND_CONTAINER" sh -c "test -s '$STAGING/index.html' && rm -rf '$BACKUP' && if test -d '$CURRENT'; then mv '$CURRENT' '$BACKUP'; fi && mv '$STAGING' '$CURRENT'"
  trap rollback_frontend ERR
fi

public_index=$(mktemp)
trap 'rm -f "$public_index"' EXIT
curl -fsS --max-time 10 https://tipforgood.com/comptaos/ >"$public_index"
grep -q '/comptaos/assets/' "$public_index"
main_asset=$(grep -oE '/comptaos/assets/index-[^" ]+\.js' "$public_index" | head -1)
curl -fsS --max-time 20 "https://tipforgood.com$main_asset" >/dev/null
curl -fsS --max-time 10 https://tipforgood.com/comptaos/api/health | grep -q '"status":"ok"'

if [[ "$frontend_changed" == true ]]; then
  trap - ERR
  docker exec "$FRONTEND_CONTAINER" rm -rf "$BACKUP"
fi
if [[ "$backend_changed" == true ]]; then
  docker ps -a --format '{{.Names}}' | grep '^comptaos-backend-rollback-' | sort -r | tail -n +3 | xargs -r docker rm
fi
printf '%s\n' "$target_commit" >"$STATE_FILE"
echo "Déploiement validé ($target_commit) : $main_asset"
