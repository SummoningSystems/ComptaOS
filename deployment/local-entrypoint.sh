#!/bin/sh
set -eu
mkdir -p /data/workspace /backups
if [ "$(id -u)" = 0 ]; then
  chown -R node:node /data /backups
  exec su-exec node "$@"
fi
exec "$@"
