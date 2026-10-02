#!/bin/bash
set -euo pipefail

: "${ARCHIVE:?Indique ARCHIVE=/chemin/sauvegarde.tar.gz}"
if [[ "${CONFIRM_RESTORE:-}" != "RESTORE_COMPTAOS_PRODUCTION" ]]; then
  echo "Restauration refusée. Définis CONFIRM_RESTORE=RESTORE_COMPTAOS_PRODUCTION après la fenêtre de maintenance." >&2
  exit 2
fi

ROOT="${ROOT:-$HOME/apps/comptaos}"
CONTAINER="${CONTAINER:-comptaos-backend}"
resolved_root="$(realpath "$ROOT")"
resolved_archive="$(realpath "$ARCHIVE")"
workspace="$resolved_root/workspace"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d "$resolved_root/.restore-stage.XXXXXX")"
rollback="$resolved_root/workspace-before-restore-$timestamp"

cleanup() { test ! -d "$stage" || rm -rf -- "$stage"; }
trap cleanup EXIT
tar -tzf "$resolved_archive" | awk '$0 !~ /^workspace\// || $0 ~ /(^|\/)\.\.($|\/)/ { bad=1 } END { exit bad }'
tar -C "$stage" -xzf "$resolved_archive"
test -d "$stage/workspace/settings"
test -d "$stage/workspace/transactions"

docker stop "$CONTAINER" >/dev/null
mv -- "$workspace" "$rollback"
mv -- "$stage/workspace" "$workspace"
if docker start "$CONTAINER" >/dev/null && curl -fsS --max-time 20 https://tipforgood.com/comptaos/api/health | grep -q '"status":"ok"'; then
  echo "Restauration validée. Ancien workspace conservé dans $rollback"
  exit 0
fi

echo "Échec du contrôle, retour immédiat au workspace précédent." >&2
docker stop "$CONTAINER" >/dev/null 2>&1 || true
mv -- "$workspace" "$resolved_root/workspace-failed-$timestamp"
mv -- "$rollback" "$workspace"
docker start "$CONTAINER" >/dev/null
exit 1
