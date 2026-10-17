#!/bin/sh
# Cloud volumes (Railway, Fly) are mounted root-owned and empty. Fix ownership as root, then drop to the unprivileged user.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${RF_STUDIO_DIR:-/data/studio}" "${RF_STATE_DIR:-/data/state}"
  chown -R 10001:10001 "$(dirname "${RF_STUDIO_DIR:-/data/studio}")" "$(dirname "${RF_STATE_DIR:-/data/state}")" 2>/dev/null || true
  exec setpriv --reuid=10001 --regid=10001 --init-groups "$@"
fi
exec "$@"
