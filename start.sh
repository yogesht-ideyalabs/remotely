#!/bin/bash
# One-command demo bring-up: Docker targets (via docker-compose.yml) + the
# app itself (control plane, 2 simulated client-region agents, web UI) +
# one-time container setup (RDP password, DB seed table, SSH-JIT sshd
# config) + demo infra data (34 multi-cloud resources) — all idempotent,
# safe to re-run on an already-running stack. Logs go to /tmp/remotely-*.log.
#
# Requires: Docker Desktop (or equivalent) running. Nothing else — this
# replaces the old two-step "create Docker targets by hand, then run this"
# flow with a genuine single command on a completely fresh machine.
set -euo pipefail
cd "$(dirname "$0")"

CONTROL_PLANE_URL="http://localhost:4000"

echo "==> Bringing up Docker targets (guacd, rdp-target, vnc-target, ssh-target, db-target, dex)..."
# Start whatever already exists (from either this compose file or the old
# manual `docker run` commands — either way it's just `docker start <name>`,
# a harmless no-op if it's already running), and only ask compose to
# *create* the ones genuinely missing, by name — never a blind
# `docker compose up`, which would try to create fresh containers on top of
# already-running ones with the same names/ports and fail.
MISSING=()
for name in guacd rdp-target vnc-target ssh-target db-target dex; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    MISSING+=("$name")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "    Creating: ${MISSING[*]}"
  docker compose up -d --wait --wait-timeout 90 "${MISSING[@]}"
fi

echo "==> One-time container setup (idempotent, safe on every run)..."
for i in $(seq 1 10); do
  docker exec rdp-target bash -c "echo 'ubuntu:demo1234' | chpasswd" 2>/dev/null && break
  sleep 2
done
# vnc-target needs no equivalent post-start step — its VNC_PASSWORD is set
# via the compose env var at container-creation time, correct from first boot.

for i in $(seq 1 10); do
  docker exec db-target psql -U demo -d appdb -c "
    CREATE TABLE IF NOT EXISTS customers (id serial primary key, name text, plan text);
    INSERT INTO customers (name, plan)
      SELECT * FROM (VALUES ('Acme Corp','enterprise'), ('Globex Inc','pro')) AS v(name, plan)
      WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.name = v.name);
  " >/dev/null 2>/dev/null && break
  sleep 2
done

echo "==> Starting control plane on :4000..."
(cd control-plane && nohup npx tsx src/index.ts > /tmp/remotely-control-plane.log 2>&1 &)

echo "==> Waiting for control plane to be ready..."
for i in $(seq 1 30); do
  curl -sf "$CONTROL_PLANE_URL/api/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "$CONTROL_PLANE_URL/api/health" >/dev/null 2>&1; then
  echo "Control plane didn't come up in time — check /tmp/remotely-control-plane.log" >&2
  exit 1
fi

echo "==> Configuring ssh-target for JIT ephemeral-key auth..."
control-plane/scripts/setup-ssh-jit.sh >/dev/null

echo "==> Seeding demo multi-cloud infrastructure data (idempotent — skips accounts that already exist)..."
LOGIN_RESPONSE=$(curl -sf -X POST "$CONTROL_PLANE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' 2>/dev/null || echo '{}')
ADMIN_TOKEN=$(echo "$LOGIN_RESPONSE" | node -e "process.stdin.on('data',d=>{try{process.stdout.write(JSON.parse(d).token||'')}catch{}})")
if [ -n "$ADMIN_TOKEN" ]; then
  curl -sf -X POST "$CONTROL_PLANE_URL/api/infra/seed-demo" -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null \
    || echo "  (demo data seed request failed — non-fatal, re-run ./start.sh or seed manually from the Architecture page)"
else
  echo "  (skipped — couldn't log in as admin yet, probably a fresh DB still finishing its first-boot seed; re-run ./start.sh once more if the Architecture page looks empty)"
fi

echo "==> Starting agent: client-a-web-01 (client=acme-corp)..."
(cd agent && AGENT_ID=client-a-web-01 AGENT_HOSTNAME=client-a-web-01 \
  AGENT_LABELS='{"client":"acme-corp","region":"us-east-1","env":"prod"}' \
  nohup npx tsx src/index.ts > /tmp/remotely-agent-a.log 2>&1 &)

echo "==> Starting agent: client-b-web-01 (client=globex-inc)..."
(cd agent && AGENT_ID=client-b-web-01 AGENT_HOSTNAME=client-b-web-01 \
  AGENT_LABELS='{"client":"globex-inc","region":"eu-west-1","env":"prod"}' \
  nohup npx tsx src/index.ts > /tmp/remotely-agent-b.log 2>&1 &)

echo "==> Starting web UI on :5173..."
(cd web && nohup npx vite --port 5173 > /tmp/remotely-web.log 2>&1 &)

sleep 2
echo
echo "All up. Open http://localhost:5173"
echo "  admin / admin123          -> full admin, every resource/type/login"
echo "  acme-admin / acmeadmin123 -> delegated admin, scoped to acme-corp"
echo "  alice / alice123          -> scoped to acme-corp SSH-agent resources only"
echo "  bob / bob1234567          -> zero roles, direct-connection access only"
echo
echo "Logs: /tmp/remotely-control-plane.log /tmp/remotely-agent-a.log /tmp/remotely-agent-b.log /tmp/remotely-web.log"
echo "Reset everything to a clean demo state: ./demo-reset.sh"
