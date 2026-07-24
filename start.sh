#!/bin/bash
# Starts the whole POC: control plane, two simulated client-region agents,
# and the web UI dev server. Logs go to /tmp/remotely-*.log.
#
# Requires the Docker containers (guacd, rdp-target, ssh-target, db-target)
# to already be running — see README.md "Docker targets" for how to create
# them the first time; after that, `docker start guacd rdp-target ssh-target db-target`.
set -e
cd "$(dirname "$0")"

echo "Starting control plane on :4000..."
(cd control-plane && nohup npx tsx src/index.ts > /tmp/remotely-control-plane.log 2>&1 &)
sleep 1

echo "Starting agent: client-a-web-01 (client=acme-corp)..."
(cd agent && AGENT_ID=client-a-web-01 AGENT_HOSTNAME=client-a-web-01 \
  AGENT_LABELS='{"client":"acme-corp","region":"us-east-1","env":"prod"}' \
  nohup npx tsx src/index.ts > /tmp/remotely-agent-a.log 2>&1 &)

echo "Starting agent: client-b-web-01 (client=globex-inc)..."
(cd agent && AGENT_ID=client-b-web-01 AGENT_HOSTNAME=client-b-web-01 \
  AGENT_LABELS='{"client":"globex-inc","region":"eu-west-1","env":"prod"}' \
  nohup npx tsx src/index.ts > /tmp/remotely-agent-b.log 2>&1 &)

echo "Starting web UI on :5173..."
(cd web && nohup npx vite --port 5173 > /tmp/remotely-web.log 2>&1 &)

sleep 2
echo
echo "All up. Open http://localhost:5173"
echo "  admin / admin123        -> full admin, every resource/type/login"
echo "  acme-admin / acmeadmin123 -> delegated admin, scoped to acme-corp"
echo "  alice / alice123        -> scoped to acme-corp SSH-agent resources only"
echo
echo "Logs: /tmp/remotely-control-plane.log /tmp/remotely-agent-a.log /tmp/remotely-agent-b.log /tmp/remotely-web.log"
