#!/usr/bin/env node
import WebSocket from "ws";
import { loadSession, saveSession, clearSession, requireSession, type CliSession } from "./config.js";
import { apiFetch, fetchResources } from "./api.js";
import { promptHidden, promptCode } from "./prompt.js";

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string, fallback?: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : fallback;
}

async function cmdLogin() {
  const username = args[1];
  if (!username) {
    console.error("usage: remotely login <username> [--url http://control-plane:4000]");
    process.exit(1);
  }
  const url = flag("url", loadSession()?.controlPlaneUrl ?? "http://localhost:4000")!;
  const password = await promptHidden("Password: ");

  let result: any = await apiFetch(url, "/api/login", null, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

  if (result.mfaRequired) {
    const code = await promptCode("MFA code: ");
    result = await apiFetch(url, "/api/login/verify-mfa", null, {
      method: "POST",
      body: JSON.stringify({ mfaToken: result.mfaToken, code }),
    });
  }

  const session: CliSession = { controlPlaneUrl: url, token: result.token, username: result.username, roles: result.roles };
  saveSession(session);
  console.log(`Logged in as ${session.username} (roles: ${session.roles.join(", ") || "none"})`);
}

function cmdLogout() {
  clearSession();
  console.log("Logged out.");
}

function cmdWhoami() {
  const session = requireSession();
  console.log(`${session.username}  (roles: ${session.roles.join(", ") || "none"})  ${session.controlPlaneUrl}`);
}

async function cmdResources() {
  const session = requireSession();
  const resources = await fetchResources(session);
  if (resources.length === 0) {
    console.log("No resources visible to your current role.");
    return;
  }
  const idWidth = Math.max(2, ...resources.map((r) => r.id.length));
  const typeWidth = Math.max(4, ...resources.map((r) => r.type.length));
  for (const r of resources) {
    console.log(`${r.id.padEnd(idWidth)}  ${r.type.padEnd(typeWidth)}  ${r.folder || "-"}  ${r.hostname}`);
  }
}

async function cmdSsh() {
  const session = requireSession();
  const resourceId = args[1];
  if (!resourceId) {
    console.error("usage: remotely ssh <resourceId> [--login <user>]");
    process.exit(1);
  }
  const resources = await fetchResources(session);
  const resource = resources.find((r) => r.id === resourceId);
  if (!resource) {
    console.error(`Resource "${resourceId}" not found or not visible to your role.`);
    process.exit(1);
  }
  if (resource.type !== "ssh-agent" && resource.type !== "ssh-direct") {
    console.error(`Resource "${resourceId}" is type "${resource.type}" — the CLI only supports SSH sessions so far.`);
    process.exit(1);
  }

  const login = flag("login", "demo")!;
  const wsBase = session.controlPlaneUrl.replace(/^http/, "ws");
  const path = resource.type === "ssh-agent" ? "/session" : "/ssh-direct-session";
  const query =
    resource.type === "ssh-agent"
      ? `resourceId=${encodeURIComponent(resourceId)}&login=${encodeURIComponent(login)}&token=${encodeURIComponent(session.token)}`
      : `resourceId=${encodeURIComponent(resourceId)}&token=${encodeURIComponent(session.token)}`;
  const ws = new WebSocket(`${wsBase}${path}?${query}`);

  ws.on("open", () => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 }));
      }
    };
    sendResize();
    process.stdout.on("resize", sendResize);

    process.stdin.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
    });
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) process.stdout.write(data as Buffer);
  });

  function restoreTty() {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }

  ws.on("close", (code, reason) => {
    restoreTty();
    const reasonStr = reason.toString();
    console.log(`\n[session closed]${reasonStr ? ` ${reasonStr}` : ""}`);
    process.exit(code === 1000 || code === 1005 ? 0 : 1);
  });
  ws.on("error", (err) => {
    restoreTty();
    console.error(`\n[connection error] ${err.message}`);
    process.exit(1);
  });
}

function usage() {
  console.log(`remotely — CLI for the Remotely remote-access control plane

Usage:
  remotely login <username> [--url http://control-plane:4000]
  remotely logout
  remotely whoami
  remotely resources                 List resources visible to you
  remotely ssh <resourceId> [--login <user>]   Open an interactive SSH session
`);
}

async function main() {
  switch (command) {
    case "login":
      await cmdLogin();
      process.exit(0);
      break;
    case "logout":
      cmdLogout();
      process.exit(0);
      break;
    case "whoami":
      cmdWhoami();
      process.exit(0);
      break;
    case "resources":
    case "ls":
      await cmdResources();
      process.exit(0);
      break;
    case "ssh":
      await cmdSsh(); // exits itself via the ws "close"/"error" handlers, once the session ends
      break;
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
