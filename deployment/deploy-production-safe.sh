#!/bin/bash
set -euo pipefail

REPO="${REPO:-$HOME/apps/comptaos}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups/comptaos-releases}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-comptaos-backend}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "EXPECTED_COMMIT (SHA complet de origin/master) est obligatoire." >&2; exit 1; }

cd "$REPO"
[[ "$(git branch --show-current)" == "master" ]] || { echo "Le dépôt de production doit rester sur master." >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Modifications Git suivies présentes sur le VPS." >&2; exit 1; }
git fetch origin master
target=$(git rev-parse origin/master)
[[ "$target" == "$EXPECTED_COMMIT" ]] || { echo "origin/master=$target, attendu=$EXPECTED_COMMIT" >&2; exit 1; }
previous=$(git rev-parse HEAD)
timestamp=$(date +%Y%m%d%H%M%S)
release_dir="$BACKUP_ROOT/$timestamp-$target"
archive="$release_dir/workspace-before-deploy.tar.gz"
mkdir -p "$release_dir"

backend_was_stopped=false
recover_backend() {
  if [[ "$backend_was_stopped" == true ]] && docker inspect "$BACKEND_CONTAINER" >/dev/null 2>&1; then
    docker start "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap recover_backend ERR INT TERM

docker stop "$BACKEND_CONTAINER" >/dev/null
backend_was_stopped=true
tar -C "$REPO" -czf "$archive" workspace
tar -tzf "$archive" >/dev/null
sha256sum "$archive" > "$archive.sha256"
cat > "$release_dir/release.env" <<EOF
PREVIOUS_COMMIT=$previous
TARGET_COMMIT=$target
BACKUP_ARCHIVE=$archive
CREATED_AT=$(date -Iseconds)
EOF

FORCE_FULL=1 bash deployment/deploy-production.sh
backend_was_stopped=false
curl -fsS --max-time 10 https://tipforgood.com/comptaos/api/health | grep -q '"status":"ok"'
printf '%s\n' "Production validée: $target"
printf '%s\n' "Sauvegarde vérifiée: $archive"
