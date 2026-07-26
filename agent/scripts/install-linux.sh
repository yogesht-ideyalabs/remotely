#!/bin/bash
# Remotely Agent Installer for Linux
# Run as root or with sudo
#
# Usage:
#   sudo ./install-linux.sh --url ws://your-control-plane:4000 --token YOUR-JOIN-TOKEN
#
# Author: Yogesh Tiwari
set -euo pipefail

# Defaults
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-ws://localhost:4000}"
AGENT_ID="${AGENT_ID:-$(hostname)}"
AGENT_HOSTNAME="${AGENT_HOSTNAME:-$(hostname)}"
AGENT_LABELS="${AGENT_LABELS:-{\"os\":\"linux\"}}"
AGENT_JOIN_TOKEN="${AGENT_JOIN_TOKEN:-demo-agent-token}"
INFRA_ENABLED="${INFRA_ENABLED:-false}"
INSTALL_DIR="/opt/remotely-agent"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --url) CONTROL_PLANE_URL="$2"; shift 2 ;;
    --token) AGENT_JOIN_TOKEN="$2"; shift 2 ;;
    --id) AGENT_ID="$2"; shift 2 ;;
    --labels) AGENT_LABELS="$2"; shift 2 ;;
    --infra) INFRA_ENABLED="true"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "╔══════════════════════════════════════════════╗"
echo "║       Remotely Agent Installer (Linux)      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Control Plane: $CONTROL_PLANE_URL"
echo "  Agent ID:      $AGENT_ID"
echo "  Labels:        $AGENT_LABELS"
echo "  Infra Scan:    $INFRA_ENABLED"
echo ""

# Determine script directory (where the binary is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install
echo "[1/4] Creating install directory..."
mkdir -p "$INSTALL_DIR/native"

echo "[2/4] Copying agent binary..."
cp "$SCRIPT_DIR/remotely-agent" "$INSTALL_DIR/remotely-agent"
cp "$SCRIPT_DIR/native/pty.node" "$INSTALL_DIR/native/pty.node"
chmod +x "$INSTALL_DIR/remotely-agent"

echo "[3/4] Creating systemd service..."
cat > /etc/systemd/system/remotely-agent.service << EOF
[Unit]
Description=Remotely Agent — reverse-tunnel access without inbound ports
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/remotely-agent
Restart=always
RestartSec=5
User=root

Environment=CONTROL_PLANE_URL=$CONTROL_PLANE_URL
Environment=AGENT_ID=$AGENT_ID
Environment=AGENT_HOSTNAME=$AGENT_HOSTNAME
Environment=AGENT_LABELS=$AGENT_LABELS
Environment=AGENT_JOIN_TOKEN=$AGENT_JOIN_TOKEN
Environment=INFRA_ENABLED=$INFRA_ENABLED
Environment=INFRA_PROVIDER=auto

[Install]
WantedBy=multi-user.target
EOF

echo "[4/4] Enabling and starting service..."
systemctl daemon-reload
systemctl enable remotely-agent
systemctl start remotely-agent

echo ""
echo "✅ Remotely Agent installed and running!"
echo ""
echo "  Status:  systemctl status remotely-agent"
echo "  Logs:    journalctl -u remotely-agent -f"
echo "  Stop:    systemctl stop remotely-agent"
echo "  Remove:  systemctl disable remotely-agent && rm -rf $INSTALL_DIR"
echo ""
echo "The agent is now connected to $CONTROL_PLANE_URL"
echo "It should appear on the Agent Health page in the Remotely web UI."
