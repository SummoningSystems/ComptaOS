#!/bin/bash
set -euo pipefail

ROOT="${ROOT:-$HOME/apps/comptaos}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/comptaos-production}"
WORKSPACE="$ROOT/workspace"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_DIR/comptaos-production-$timestamp.tar.gz"

test -d "$WORKSPACE"
resolved_root="$(realpath "$ROOT")"
resolved_workspace="$(realpath "$WORKSPACE")"
case "$resolved_workspace" in "$resolved_root"/workspace) ;; *) echo "Chemin workspace inattendu: $resolved_workspace" >&2; exit 1;; esac

umask 077
mkdir -p "$BACKUP_DIR"
tar -C "$resolved_root" -czf "$archive" workspace
tar -tzf "$archive" >/dev/null
sha256sum "$archive" > "$archive.sha256"
git -C "$resolved_root" rev-parse HEAD > "$archive.commit"
printf 'archive=%s\nsha256=%s\ncommit=%s\n' "$archive" "$(cut -d' ' -f1 "$archive.sha256")" "$(cat "$archive.commit")"
