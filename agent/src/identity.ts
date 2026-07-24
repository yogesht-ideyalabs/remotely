import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Persistent per-agent cryptographic identity, replacing "prove yourself
// with the shared secret every single time" with "prove yourself once
// (via a single-use join token), then sign your own challenges forever
// after." See control-plane/src/store.ts's comment above
// registerAgentIdentity for the full reasoning. Stored next to the agent's
// own home directory (not next to the binary, which may be read-only or
// on ephemeral storage) so it survives both a plain restart and — for the
// compiled binary — a self-update that replaces the executable file.
export interface StoredIdentity {
  privateKeyPem: string;
  publicKeyPem: string;
  confirmed: boolean; // true once the control plane has actually registered this key
}

function identityPath(agentId: string): string {
  const dir = path.join(os.homedir(), ".remotely-agent");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${agentId}.json`);
}

export function loadOrCreateIdentity(agentId: string): StoredIdentity {
  const file = identityPath(agentId);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const identity: StoredIdentity = {
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
      confirmed: false,
    };
    fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return identity;
  }
}

export function markConfirmed(agentId: string, identity: StoredIdentity) {
  identity.confirmed = true;
  fs.writeFileSync(identityPath(agentId), JSON.stringify(identity, null, 2), { mode: 0o600 });
}

// Inverse of markConfirmed — used when a signature-based reconnect gets
// rejected (e.g. the control plane's in-memory identity records were lost
// to a restart), so the next attempt falls back to rejoining with a token
// instead of retrying the same signature forever.
export function markUnconfirmed(agentId: string, identity: StoredIdentity) {
  identity.confirmed = false;
  fs.writeFileSync(identityPath(agentId), JSON.stringify(identity, null, 2), { mode: 0o600 });
}

export function signChallenge(identity: StoredIdentity, timestamp: string): string {
  const key = crypto.createPrivateKey(identity.privateKeyPem);
  return crypto.sign(null, Buffer.from(timestamp), key).toString("base64");
}
