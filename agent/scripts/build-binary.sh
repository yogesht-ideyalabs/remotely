#!/bin/bash
# Builds the agent as a real compiled single-executable binary (Node's SEA
# feature) for Linux x64, using a throwaway Linux container as the build
# environment — not cross-compiled from macOS, so node-pty's native addon
# is genuinely built for (and tested on) the actual deployment target.
#
# Why this exists / the one real wrinkle it works around:
# Node's SEA embeds the app as a blob inside a copy of the `node` binary,
# but `require()` from *inside* that embedded blob only resolves Node
# built-in modules — arbitrary node_modules requires throw
# ERR_UNKNOWN_BUILTIN_MODULE, including node-pty's own internal
# `require(dir + name + '.node')` native-addon loader. `process.dlopen()`
# with an absolute path is NOT subject to that restriction, so
# `patch-node-pty-loader.cjs` (applied to a throwaway copy of node_modules,
# never the real one) swaps node-pty's loader to use dlopen against a
# `native/pty.node` file shipped next to the binary instead. Verified by
# actually opening an interactive PTY session through the compiled binary
# end-to-end, not just by checking it launches.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=${NODE_BUILD_IMAGE:-node:22-bookworm}
OUT_DIR="dist-linux-x64"
CONTAINER=remotely-agent-builder-$$

echo "Building in a throwaway $IMAGE container..."
docker run -d --name "$CONTAINER" "$IMAGE" sleep infinity >/dev/null
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

docker cp src "$CONTAINER":/build-src >/dev/null
docker cp package.json "$CONTAINER":/build-package.json >/dev/null
docker cp scripts/patch-node-pty-loader.cjs "$CONTAINER":/patch-node-pty-loader.cjs >/dev/null

docker exec "$CONTAINER" sh -c '
  set -e
  mkdir -p /build && mv /build-src /build/src && mv /build-package.json /build/package.json
  cd /build
  npm install --no-audit --no-fund >/dev/null
  npm install --no-audit --no-fund --save-dev esbuild >/dev/null
  node /patch-node-pty-loader.cjs node_modules/node-pty/lib/utils.js
  node_modules/.bin/esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/agent.cjs
  mkdir -p dist/native
  cp node_modules/node-pty/build/Release/pty.node dist/native/pty.node
  echo "{\"main\":\"dist/agent.cjs\",\"output\":\"dist/sea-prep.blob\",\"disableExperimentalSEAWarning\":true}" > sea-config.json
  node --experimental-sea-config sea-config.json
  cp "$(command -v node)" dist/remotely-agent
  npx --yes postject dist/remotely-agent NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
  chmod +x dist/remotely-agent
'

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/native"
docker cp "$CONTAINER":/build/dist/remotely-agent "$OUT_DIR"/remotely-agent >/dev/null
docker cp "$CONTAINER":/build/dist/native/pty.node "$OUT_DIR"/native/pty.node >/dev/null

echo "Built: $OUT_DIR/remotely-agent (+ $OUT_DIR/native/pty.node, must stay alongside it)"
echo "Run with the same env vars as the tsx version, e.g.:"
echo "  CONTROL_PLANE_URL=ws://your-control-plane:4000 AGENT_ID=... AGENT_HOSTNAME=... AGENT_LABELS='{...}' ./$OUT_DIR/remotely-agent"
