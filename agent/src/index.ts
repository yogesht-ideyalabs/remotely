import WebSocket from "ws";
import pty from "node-pty";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { loadOrCreateIdentity, markConfirmed, markUnconfirmed, signChallenge } from "./identity.js";
import { maybeSelfUpdate } from "./selfUpdate.js";
import { runCollection, type InfraCollectorConfig } from "./infraCollector.js";

// DEMO ONLY: config via env vars set per-instance instead of a real
// enrollment flow (join tokens, IAM-based joining, etc — see the Teleport
// walkthrough this project followed). AGENT_JOIN_TOKEN is a single shared
// secret every agent uses; a real deployment issues single-use tokens.
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? "ws://localhost:4000";
const AGENT_JOIN_TOKEN = process.env.AGENT_JOIN_TOKEN ?? "demo-agent-token";
const AGENT_ID = process.env.AGENT_ID ?? os.hostname();
const AGENT_HOSTNAME = process.env.AGENT_HOSTNAME ?? AGENT_ID;
const AGENT_LABELS = process.env.AGENT_LABELS ?? "{}";
const AGENT_VERSION = "0.1.0"; // keep in sync with package.json — surfaced on the admin Agent Health page
const SESSION_ID_LEN = 36;
const SHELL = process.env.SHELL ?? "/bin/bash";

// Infrastructure discovery configuration (via env vars)
const INFRA_ENABLED = process.env.INFRA_ENABLED === "true";
const INFRA_PROVIDER = (process.env.INFRA_PROVIDER ?? "auto") as InfraCollectorConfig["provider"];
const INFRA_INTERVAL = Number(process.env.INFRA_INTERVAL_MINUTES ?? "15");
const INFRA_ACCOUNT_ID = process.env.INFRA_ACCOUNT_ID ?? "";
const INFRA_API_ENDPOINT = process.env.INFRA_API_ENDPOINT ?? "";
const INFRA_API_TOKEN = process.env.INFRA_API_TOKEN ?? "";
const INFRA_AWS_REGION = process.env.INFRA_AWS_REGION ?? "";
// HTTP base URL for the control plane (REST API for infra reporting)
const CONTROL_PLANE_HTTP_URL = process.env.CONTROL_PLANE_HTTP_URL ?? "http://localhost:4000";

const ptys = new Map<string, pty.IPty>();

// File transfer for reverse-tunnel resources — see sendAgentFileRequest's
// comment in control-plane/src/state.ts for why this is a small JSON
// request/response protocol over the existing WS tunnel instead of a real
// SFTP subsystem (the control plane has no direct connection to this host
// to open one against). Paths are resolved relative to the agent's own
// home directory, same base the PTY sessions already use — no sandboxing
// beyond that, same posture as the ssh-direct/SFTP file browser elsewhere
// in this project (full filesystem access as whatever user the process
// runs as, not scoped further).
function resolveAgentPath(relPath: string): string {
  return path.resolve(os.homedir(), relPath || ".");
}

async function handleFileMessage(ws: WebSocket, msg: Record<string, unknown>) {
  const requestId = msg.requestId as string;
  const send = (payload: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...payload, requestId }));
  };

  try {
    if (msg.type === "file-list") {
      const dir = resolveAgentPath(msg.path as string);
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      const entries = await Promise.all(
        dirents.map(async (d) => {
          const stat = await fs.stat(path.join(dir, d.name)).catch(() => null);
          return {
            name: d.name,
            isDirectory: d.isDirectory(),
            size: stat?.size ?? 0,
            modifiedAt: stat ? stat.mtimeMs : 0,
          };
        })
      );
      send({ type: "file-list-result", entries });
    } else if (msg.type === "file-read") {
      const filePath = resolveAgentPath(msg.path as string);
      const maxBytes = (msg.maxBytes as number) ?? 20 * 1024 * 1024;
      const stat = await fs.stat(filePath);
      if (stat.size > maxBytes) {
        send({ type: "file-read-error", message: `file is ${stat.size} bytes, exceeds the ${maxBytes} byte transfer limit` });
        return;
      }
      const data = await fs.readFile(filePath);
      send({ type: "file-read-result", dataBase64: data.toString("base64") });
    } else if (msg.type === "file-write") {
      const filePath = resolveAgentPath(msg.path as string);
      const data = Buffer.from(msg.dataBase64 as string, "base64");
      await fs.writeFile(filePath, data);
      send({ type: "file-write-result", bytes: data.length });
    }
  } catch (err) {
    const errorType = `${msg.type}-error`;
    send({ type: errorType, message: (err as Error).message });
  }
}

const identity = loadOrCreateIdentity(AGENT_ID);

function buildJoinUrl(): string {
  const base = `${CONTROL_PLANE_URL}/agent?id=${encodeURIComponent(AGENT_ID)}&hostname=${encodeURIComponent(
    AGENT_HOSTNAME
  )}&labels=${encodeURIComponent(AGENT_LABELS)}&version=${encodeURIComponent(AGENT_VERSION)}`;

  if (identity.confirmed) {
    // Already registered a keypair with the control plane on a previous
    // run — reconnect by signing a fresh challenge, no token needed at all.
    const timestamp = String(Date.now());
    const signature = signChallenge(identity, timestamp);
    return `${base}&timestamp=${encodeURIComponent(timestamp)}&signature=${encodeURIComponent(signature)}`;
  }
  // Not yet registered — join with whatever token was provided (either a
  // real single-use join token, generated via the admin API, or the
  // legacy static AGENT_JOIN_TOKEN for backward compat) plus this agent's
  // public key so the control plane can register it if the token is real.
  return `${base}&token=${encodeURIComponent(AGENT_JOIN_TOKEN)}&publicKey=${encodeURIComponent(identity.publicKeyPem)}`;
}

function connect() {
  const attemptedSignatureAuth = identity.confirmed;
  const url = buildJoinUrl();
  const ws = new WebSocket(url);

  let pingInterval: NodeJS.Timeout | undefined;

  ws.on("open", () => {
    console.log(`[${AGENT_ID}] connected to control plane at ${CONTROL_PLANE_URL}`);
    // Idle heartbeat so the control plane's Agent Health page can show
    // "last seen"/latency even when no session is active — otherwise a
    // quietly-dead agent (process hung, network partitioned but socket
    // not yet timed out) would look identical to a healthy idle one.
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    }, 20000);
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      // <sessionId (36 bytes ascii)><stdin bytes> — keystrokes from the browser
      const buf = data as Buffer;
      const sessionId = buf.subarray(0, SESSION_ID_LEN).toString("ascii");
      const payload = buf.subarray(SESSION_ID_LEN);
      ptys.get(sessionId)?.write(payload.toString("utf8"));
      return;
    }

    const msg = JSON.parse(data.toString());
    switch (msg.type) {
      case "registered":
        console.log(`[${AGENT_ID}] registered, labels=${AGENT_LABELS}`);
        if (msg.identityRegistered && !identity.confirmed) {
          markConfirmed(AGENT_ID, identity);
          console.log(`[${AGENT_ID}] identity confirmed — future reconnects will use it instead of the join token`);
        }
        if (msg.latestVersion && msg.latestVersion !== AGENT_VERSION) {
          console.log(`[${AGENT_ID}] running ${AGENT_VERSION}, control plane recommends ${msg.latestVersion} (admin can trigger an update)`);
        }
        break;

      case "update":
        maybeSelfUpdate(msg.downloadUrl, msg.version, AGENT_ID).catch((err) =>
          console.error(`[${AGENT_ID}] self-update failed:`, err.message)
        );
        break;

      case "open": {
        const { sessionId, login } = msg;
        console.log(`[${AGENT_ID}] opening session ${sessionId} (login=${login})`);
        const term = pty.spawn(SHELL, [], {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: os.homedir(),
          // NOTE: "login" is not actually enforced as a distinct OS user in
          // this POC — every session runs as whichever user the agent
          // process itself runs as. A real deployment maps roles to
          // specific OS logins (Teleport's `logins` role field) and uses
          // certs/su/sudo to actually assume that user.
          env: { ...process.env, TERM: "xterm-256color" } as { [key: string]: string },
        });
        ptys.set(sessionId, term);

        term.onData((chunk) => {
          const framed = Buffer.concat([Buffer.from(sessionId, "ascii"), Buffer.from(chunk, "utf8")]);
          if (ws.readyState === WebSocket.OPEN) ws.send(framed);
        });

        term.onExit(() => {
          ptys.delete(sessionId);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "closed", sessionId }));
        });
        break;
      }

      case "resize": {
        const { sessionId, cols, rows } = msg;
        ptys.get(sessionId)?.resize(Math.max(cols, 2), Math.max(rows, 2));
        break;
      }

      case "close": {
        const { sessionId } = msg;
        ptys.get(sessionId)?.kill();
        ptys.delete(sessionId);
        break;
      }

      case "file-list":
      case "file-read":
      case "file-write":
        handleFileMessage(ws, msg);
        break;
    }
  });

  ws.on("close", (code) => {
    console.log(`[${AGENT_ID}] disconnected (code ${code}), retrying in 2s...`);
    // The control plane's registered-agent-identities are in-memory only
    // (same as everything else in this POC) — a control-plane restart
    // silently forgets every agent's public key. Falling back to a token
    // join here at least gives the legacy static AGENT_JOIN_TOKEN path a
    // chance to recover automatically. It does NOT fully solve this for an
    // agent that originally bootstrapped with a real single-use join
    // token, though — that token is already consumed, so re-joining still
    // needs an admin to issue a fresh one and restart the agent with it.
    // The real fix is persisting agentIdentities server-side, which this
    // POC's in-memory store deliberately doesn't do anywhere.
    if (attemptedSignatureAuth && code === 4001) {
      console.log(`[${AGENT_ID}] signature-based reconnect was rejected (control plane restarted?) — falling back to token join`);
      markUnconfirmed(AGENT_ID, identity);
    }
    if (pingInterval) clearInterval(pingInterval);
    for (const term of ptys.values()) term.kill();
    ptys.clear();
    setTimeout(connect, 2000);
  });

  ws.on("error", (err) => {
    console.error(`[${AGENT_ID}] connection error:`, err.message);
  });
}

connect();

// ─── Infrastructure Discovery Loop ──────────────────────────────────────────
// Runs separately from the WS connection — reports discovered resources
// to the control plane via REST API on a configurable interval.

if (INFRA_ENABLED && INFRA_ACCOUNT_ID) {
  const infraConfig: InfraCollectorConfig = {
    enabled: true,
    provider: INFRA_PROVIDER,
    intervalMinutes: INFRA_INTERVAL,
    infraAccountId: INFRA_ACCOUNT_ID,
    apiEndpoint: INFRA_API_ENDPOINT || undefined,
    apiToken: INFRA_API_TOKEN || undefined,
    awsRegion: INFRA_AWS_REGION || undefined,
  };

  async function runInfraSync() {
    try {
      console.log(`[${AGENT_ID}] running infrastructure discovery (provider=${infraConfig.provider})...`);
      const resources = await runCollection(infraConfig, AGENT_ID);
      console.log(`[${AGENT_ID}] discovered ${resources.length} infrastructure resource(s)`);

      if (resources.length > 0) {
        // Report to control plane
        const resp = await fetch(`${CONTROL_PLANE_HTTP_URL}/api/infra/resources/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: INFRA_ACCOUNT_ID,
            region: resources[0]?.region || "local",
            resources,
            pruneStale: true,
          }),
        });

        if (resp.ok) {
          const result = await resp.json() as { created: number; updated: number; pruned: number };
          console.log(
            `[${AGENT_ID}] infra sync complete: ${result.created} created, ${result.updated} updated, ${result.pruned} pruned`
          );
        } else {
          console.error(`[${AGENT_ID}] infra sync failed: ${resp.status} ${resp.statusText}`);
        }
      }
    } catch (err) {
      console.error(`[${AGENT_ID}] infra collection error:`, (err as Error).message);
    }
  }

  // Run immediately on startup, then on interval
  setTimeout(runInfraSync, 5000); // small delay to let WS connect first
  setInterval(runInfraSync, INFRA_INTERVAL * 60 * 1000);
  console.log(`[${AGENT_ID}] infrastructure discovery enabled (interval=${INFRA_INTERVAL}m, provider=${INFRA_PROVIDER})`);
} else if (INFRA_ENABLED && !INFRA_ACCOUNT_ID) {
  console.warn(`[${AGENT_ID}] INFRA_ENABLED=true but INFRA_ACCOUNT_ID not set — infrastructure discovery disabled`);
}
