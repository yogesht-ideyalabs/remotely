#!/bin/bash
# Builds the agent for Windows x64 using esbuild to bundle,
# then pairs with a downloaded Node.js Windows binary.
#
# Output: dist-windows-x64/
#   remotely-agent.exe  (Node.js runtime)
#   agent.cjs           (bundled agent code)
#   native/pty.node     (node-pty prebuilt for Windows)
#   run-agent.bat       (launcher script)
#
# The Windows agent uses node-pty's prebuilt Windows binary.
# node-pty publishes prebuilds for Windows via prebuildify.
#
# Author: Yogesh Tiwari
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_VERSION="22.16.0"
OUT_DIR="dist-windows-x64"
CONTAINER=remotely-agent-win-builder-$$

echo "Building Windows agent bundle..."

# Use a Linux container to do the JS bundling (esbuild doesn't need the target OS)
docker run -d --name "$CONTAINER" node:22-bookworm sleep infinity >/dev/null
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

docker cp src "$CONTAINER":/build-src >/dev/null
docker cp package.json "$CONTAINER":/build-package.json >/dev/null

docker exec "$CONTAINER" sh -c '
  set -e
  mkdir -p /build && mv /build-src /build/src && mv /build-package.json /build/package.json
  cd /build
  npm install --no-audit --no-fund >/dev/null
  npm install --no-audit --no-fund --save-dev esbuild >/dev/null
  # Bundle for Node (CJS) — excludes node-pty (loaded separately on Windows)
  node_modules/.bin/esbuild src/index.ts --bundle --platform=node --format=cjs \
    --external:node-pty --outfile=dist/agent.cjs
'

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/native"

# Get the bundled JS
docker cp "$CONTAINER":/build/dist/agent.cjs "$OUT_DIR"/agent.cjs >/dev/null

# Download Node.js Windows binary
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"
TMPZIP="/tmp/node-win-$$-zip"
echo "Downloading Node.js v${NODE_VERSION} for Windows..."
curl -sL "$NODE_URL" -o "$TMPZIP"
unzip -q -j "$TMPZIP" "node-v${NODE_VERSION}-win-x64/node.exe" -d "$OUT_DIR" 2>/dev/null
rm -f "$TMPZIP"
mv "$OUT_DIR/node.exe" "$OUT_DIR/remotely-agent.exe"

# Download node-pty prebuilt for Windows
# node-pty uses prebuildify — the prebuilt .node files are inside the npm package
echo "Fetching node-pty Windows prebuilt..."
docker exec "$CONTAINER" sh -c '
  ls /build/node_modules/node-pty/prebuilds/win32-x64/ 2>/dev/null || echo "no-prebuilt"
' > /tmp/check-prebuilt-$$
if grep -q "no-prebuilt" /tmp/check-prebuilt-$$; then
  echo "WARNING: node-pty prebuilt for Windows not found in container."
  echo "You may need to install node-pty on a Windows machine and copy the .node file."
  echo "For now, shipping without PTY support (SSH-agent shell sessions won't work, but infra discovery will)."
else
  docker cp "$CONTAINER":/build/node_modules/node-pty/prebuilds/win32-x64/ "$OUT_DIR/native/" 2>/dev/null || true
fi
rm -f /tmp/check-prebuilt-$$

# Create launcher batch file
cat > "$OUT_DIR/run-agent.bat" << 'BATCH'
@echo off
REM Remotely Agent for Windows
REM Configure these environment variables before running:

IF "%CONTROL_PLANE_URL%"=="" SET CONTROL_PLANE_URL=ws://YOUR-CONTROL-PLANE-IP:4000
IF "%AGENT_ID%"=="" SET AGENT_ID=%COMPUTERNAME%
IF "%AGENT_HOSTNAME%"=="" SET AGENT_HOSTNAME=%COMPUTERNAME%
IF "%AGENT_LABELS%"=="" SET AGENT_LABELS={"os":"windows"}
IF "%AGENT_JOIN_TOKEN%"=="" SET AGENT_JOIN_TOKEN=demo-agent-token

echo Starting Remotely Agent...
echo   Control Plane: %CONTROL_PLANE_URL%
echo   Agent ID: %AGENT_ID%
echo   Hostname: %AGENT_HOSTNAME%

"%~dp0remotely-agent.exe" "%~dp0agent.cjs"
BATCH

# Create PowerShell install script
cat > "$OUT_DIR/install-agent.ps1" << 'PS1'
# Remotely Agent Installer for Windows
# Run as Administrator
#
# Author: Yogesh Tiwari

param(
    [string]$ControlPlaneUrl = "ws://YOUR-CONTROL-PLANE-IP:4000",
    [string]$AgentId = $env:COMPUTERNAME,
    [string]$JoinToken = "demo-agent-token",
    [string]$Labels = '{"os":"windows"}'
)

$installDir = "C:\Program Files\Remotely\Agent"
$serviceName = "RemotelyAgent"

Write-Host "Installing Remotely Agent to $installDir..."

# Create directory
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\native" | Out-Null

# Copy files
Copy-Item "$PSScriptRoot\remotely-agent.exe" "$installDir\" -Force
Copy-Item "$PSScriptRoot\agent.cjs" "$installDir\" -Force
if (Test-Path "$PSScriptRoot\native") {
    Copy-Item "$PSScriptRoot\native\*" "$installDir\native\" -Force
}

# Set environment variables (machine level)
[Environment]::SetEnvironmentVariable("CONTROL_PLANE_URL", $ControlPlaneUrl, "Machine")
[Environment]::SetEnvironmentVariable("AGENT_ID", $AgentId, "Machine")
[Environment]::SetEnvironmentVariable("AGENT_HOSTNAME", $AgentId, "Machine")
[Environment]::SetEnvironmentVariable("AGENT_LABELS", $Labels, "Machine")
[Environment]::SetEnvironmentVariable("AGENT_JOIN_TOKEN", $JoinToken, "Machine")

# Register as Windows Service using sc.exe
Write-Host "Registering Windows Service: $serviceName"
$binPath = "`"$installDir\remotely-agent.exe`" `"$installDir\agent.cjs`""
sc.exe create $serviceName binPath= $binPath start= auto DisplayName= "Remotely Agent" | Out-Null
sc.exe description $serviceName "Remotely reverse-tunnel agent - provides secure access without inbound ports" | Out-Null
sc.exe start $serviceName | Out-Null

Write-Host ""
Write-Host "Done! Agent installed and running as service '$serviceName'"
Write-Host "  Control Plane: $ControlPlaneUrl"
Write-Host "  Agent ID: $AgentId"
Write-Host ""
Write-Host "To check status:  sc.exe query $serviceName"
Write-Host "To stop:          sc.exe stop $serviceName"
Write-Host "To uninstall:     sc.exe delete $serviceName"
PS1

echo ""
echo "Built: $OUT_DIR/"
echo "  remotely-agent.exe  (Node.js runtime)"
echo "  agent.cjs           (bundled agent code)"
echo "  run-agent.bat       (manual launcher)"
echo "  install-agent.ps1   (PowerShell installer — registers as Windows Service)"
echo ""
echo "Deploy to a Windows VM:"
echo "  1. Copy the entire $OUT_DIR/ folder to the Windows machine"
echo "  2. Open PowerShell as Admin"
echo "  3. Run: .\\install-agent.ps1 -ControlPlaneUrl ws://YOUR-IP:4000 -JoinToken YOUR-TOKEN"
