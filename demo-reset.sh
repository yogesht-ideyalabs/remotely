#!/bin/bash
# Wipes all persisted demo state back to nothing — for going into a client
# demo with a guaranteed-pristine instance. Destructive: deletes the real
# SQLite DB, audit log, and session recordings. Does NOT touch Docker
# images/containers (those get reused, just re-seeded by the next
# ./start.sh) or any of your own non-demo code changes.
set -euo pipefail
cd "$(dirname "$0")"

read -p "This deletes all users/connections/audit history/recordings and resets to the pristine seeded demo. Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

./stop.sh

rm -f control-plane/remotely.db control-plane/remotely.db-wal control-plane/remotely.db-shm
rm -f control-plane/audit.jsonl
rm -rf recordings
mkdir -p recordings

echo "Wiped. Run ./start.sh to bring up a fresh, freshly-seeded demo."
