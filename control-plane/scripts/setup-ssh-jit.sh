#!/bin/bash
# Configures the `ssh-target` demo container to accept Remotely's JIT SSH
# credentials (see control-plane/src/sshJit.ts for the full explanation of
# why this exists instead of real OpenSSH certificates — short version:
# the `ssh2` npm client library has zero support for the
# `*-cert-v01@openssh.com` key types, so certs were a dead end; this gets
# the same "short-lived, single-session credential" property via sshd's
# AuthorizedKeysCommand instead, the same mechanism AWS EC2 Instance
# Connect uses).
#
# Idempotent — safe to re-run, and MUST be re-run if the ssh-target
# container is ever recreated (`docker rm` + `docker run`), since none of
# this lives outside the container's own filesystem.
set -euo pipefail

CONTAINER=${SSH_TARGET_CONTAINER:-ssh-target}
INTERNAL_TOKEN=${SSH_JIT_INTERNAL_TOKEN:-demo-jit-token}
CONTROL_PLANE_URL=${CONTROL_PLANE_URL:-http://host.docker.internal:4000}

echo "Installing AuthorizedKeysCommand helper into $CONTAINER..."
docker exec -i "$CONTAINER" sh -c "cat > /usr/local/bin/remotely-jit-authkeys.sh" <<EOF
#!/bin/sh
LOGIN="\$1"
KEYBLOB="\$2"
curl -s -H "X-Internal-Token: ${INTERNAL_TOKEN}" "${CONTROL_PLANE_URL}/internal/ssh-authorized-keys?login=\${LOGIN}&key=\${KEYBLOB}"
EOF
docker exec "$CONTAINER" chmod 755 /usr/local/bin/remotely-jit-authkeys.sh

CONFIG=/config/sshd/sshd_config
if docker exec "$CONTAINER" grep -q "remotely-jit-authkeys.sh" "$CONFIG"; then
  echo "sshd_config already has the JIT directives — skipping append."
else
  echo "Appending JIT directives to $CONFIG..."
  # AuthorizedKeysCommandUser MUST match the (unprivileged) user the sshd
  # listener itself runs as in this image — it can only setresgid to a
  # user it already has permission for, so "nobody" fails with
  # "Operation not permitted" here. Find that user dynamically instead of
  # hardcoding "demo" so this keeps working if the image's user changes.
  LISTENER_USER=$(docker exec "$CONTAINER" sh -c "ps -o user= -C sshd.pam 2>/dev/null | grep -v root | head -1 | tr -d ' '")
  LISTENER_USER=${LISTENER_USER:-demo}
  docker exec -i "$CONTAINER" sh -c "cat >> $CONFIG" <<EOF

# Remotely JIT SSH auth (short-lived, per-session keys instead of static creds)
PubkeyAuthentication yes
AuthorizedKeysCommand /usr/local/bin/remotely-jit-authkeys.sh %u %k
AuthorizedKeysCommandUser ${LISTENER_USER}
EOF
fi

docker exec "$CONTAINER" /usr/sbin/sshd.pam -t -f "$CONFIG"
echo "Config valid. Reloading sshd..."
LISTENER_PID=$(docker exec "$CONTAINER" sh -c "ps -o pid=,args= -C sshd.pam 2>/dev/null | grep listener | awk '{print \$1}'")
docker exec "$CONTAINER" kill -HUP "$LISTENER_PID"
echo "Done — ssh-target now accepts Remotely JIT-authorized ephemeral keys."
