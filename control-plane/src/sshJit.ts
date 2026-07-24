import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Short-lived SSH credentials without needing OpenSSH certificate support
// (the `ssh2` npm client library has none — no `*-cert-v01@openssh.com` key
// type parsing at all, confirmed by grepping its source). Instead of a CA
// signing a certificate, this uses the same pattern as AWS EC2 Instance
// Connect / Teleport's agentless mode: generate a brand-new keypair per
// session, tell the target's sshd (via AuthorizedKeysCommand) that this
// exact public key is authorized for this exact login for the next few
// minutes, connect, then revoke. The security property is the same as a
// short-lived cert — a credential that didn't exist before the session and
// won't work after it — just achieved via JIT authorization instead of a
// signature the client library can't verify/present anyway.

export interface EphemeralKeyPair {
  privateKey: string; // OpenSSH PEM — directly usable as ssh2's `privateKey` connect option
  keyBlob: string; // base64 blob only (the middle field of a "ssh-ed25519 <blob> comment" line) — matches sshd's AuthorizedKeysCommand %k token
}

export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remotely-sshjit-"));
  const keyPath = path.join(dir, "id_ed25519");
  try {
    execFileSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", "remotely-ephemeral", "-q"]);
    const privateKey = fs.readFileSync(keyPath, "utf8");
    const publicKeyLine = fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
    const keyBlob = publicKeyLine.split(" ")[1];
    return { privateKey, keyBlob };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

interface Grant {
  login: string;
  keyBlob: string;
  expiresAt: number;
}

// Keyed by `${login}:${keyBlob}` — exactly the two pieces of information
// sshd's AuthorizedKeysCommand gives us (%u and %k), nothing more. The
// actual cryptographic proof-of-possession is still handled entirely by
// the SSH protocol itself (the client has to sign the auth request with
// the matching private key); this map only answers "is this specific
// (login, public key) pair currently something Remotely vouches for."
const grants = new Map<string, Grant>();

function grantKey(login: string, keyBlob: string) {
  return `${login}:${keyBlob}`;
}

export function issueGrant(login: string, keyBlob: string, ttlMs = 5 * 60_000): () => void {
  const key = grantKey(login, keyBlob);
  grants.set(key, { login, keyBlob, expiresAt: Date.now() + ttlMs });
  return () => grants.delete(key);
}

export function checkGrant(login: string, keyBlob: string): boolean {
  const key = grantKey(login, keyBlob);
  const grant = grants.get(key);
  if (!grant) return false;
  if (Date.now() > grant.expiresAt) {
    grants.delete(key);
    return false;
  }
  return true;
}
