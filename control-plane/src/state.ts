import type { WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listConnections, type Connection } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RECORDINGS_DIR = path.join(__dirname, "..", "..", "recordings");
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

export interface AgentInfo {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  type: string; // "ssh-agent" for everything the agent binary registers
  socket: WebSocket;
  connectedAt: number;
  version: string;
  lastSeen: number;
  lastLatencyMs: number | null;
}

// Every connected agent = one reachable, reverse-tunneled resource. Keyed
// by agent id. Distinct from `connections` (store.ts): those are directly
// dialed by the control plane (ssh-direct/rdp/database), these dial out to
// us — the two architectures discussed earlier in this project.
export const agents = new Map<string, AgentInfo>();

export interface SessionInfo {
  id: string;
  agentId: string;
  resourceHostname: string;
  browserSocket: WebSocket;
  username: string;
  login: string;
  startedAt: number;
  recordingStream: fs.WriteStream;
  ttlTimer?: NodeJS.Timeout;
  // Set once the session is fully established — lets the Active Sessions
  // admin page force-close a session the same way TTL expiry already does,
  // without duplicating that cleanup logic in a second place.
  terminate?: () => void;
}

// Keyed by session id. A session bridges exactly one browser socket to
// exactly one agent's PTY, multiplexed over the agent's single outbound
// connection via the session id prefix on binary frames.
export const sessions = new Map<string, SessionInfo>();

// The other three session types (ssh-direct/rdp/database) don't need a
// shared map for data routing — each WS handler already holds its own
// direct references via closure — but DO need to be somewhere for the
// Active Sessions admin page to enumerate and terminate.
export interface OtherSessionInfo {
  id: string;
  username: string;
  resourceId: string;
  resourceHostname: string;
  type: string;
  startedAt: number;
  terminate: () => void;
}

export const otherSessions = new Map<string, OtherSessionInfo>();

// Live session co-watching (view-only): a spectator's browser opens a
// second WebSocket that receives a copy of everything the *primary*
// browserSocket receives for that session — same recording-relevant bytes,
// just fanned out to N extra sockets instead of 1. Spectators never write
// back into the session (their inbound messages are ignored server-side,
// see the /watch-session handler) — this is "join and watch," not shared
// control. A spectator joining mid-session has no scrollback/backfill; for
// SSH that means a blank pane until the next output, for RDP the next
// screen update mostly self-corrects it — both acceptable for a POC.
export const sessionSpectators = new Map<string, Set<WebSocket>>();

export function addSpectator(sessionId: string, ws: WebSocket) {
  let set = sessionSpectators.get(sessionId);
  if (!set) {
    set = new Set();
    sessionSpectators.set(sessionId, set);
  }
  set.add(ws);
}

export function removeSpectator(sessionId: string, ws: WebSocket) {
  const set = sessionSpectators.get(sessionId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) sessionSpectators.delete(sessionId);
}

export function broadcastToSpectators(sessionId: string, data: Buffer | string) {
  const set = sessionSpectators.get(sessionId);
  if (!set || set.size === 0) return;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

export function spectatorCount(sessionId: string): number {
  return sessionSpectators.get(sessionId)?.size ?? 0;
}

// File transfer for ssh-agent (reverse-tunnel) resources — unlike
// ssh-direct, the control plane has no direct connection to dial an SFTP
// subsystem against; all it has is the same WS tunnel PTY sessions
// multiplex over. So file operations become a small request/response
// protocol over that same tunnel: the control plane sends a JSON message
// with a requestId, the agent does the real fs work and replies with a
// matching requestId, and this map bridges that back to the waiting REST
// handler's Promise. File bytes travel as base64 inside JSON (not the raw
// binary PTY frames — deliberately not reusing that framing, since it
// would mean changing the already-working PTY wire format everywhere just
// to add a type tag). Fine for the POC's file sizes; a real
// implementation would stream instead.
interface PendingAgentFileRequest {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}
const pendingAgentFileRequests = new Map<string, PendingAgentFileRequest>();

export function sendAgentFileRequest(agent: AgentInfo, message: Record<string, unknown>, timeoutMs = 15000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingAgentFileRequests.delete(requestId);
      reject(new Error("agent did not respond in time"));
    }, timeoutMs);
    pendingAgentFileRequests.set(requestId, { resolve, reject, timer });
    agent.socket.send(JSON.stringify({ ...message, requestId }));
  });
}

export function resolveAgentFileRequest(requestId: string, msg: Record<string, unknown>) {
  const pending = pendingAgentFileRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingAgentFileRequests.delete(requestId);
  pending.resolve(msg);
}

export function startRecording(sessionId: string): fs.WriteStream {
  const filePath = path.join(RECORDINGS_DIR, `${sessionId}.jsonl`);
  return fs.createWriteStream(filePath, { flags: "a" });
}

export function appendRecording(session: SessionInfo, direction: "i" | "o", data: Buffer) {
  const line = JSON.stringify({
    t: Date.now() - session.startedAt,
    dir: direction,
    data: data.toString("base64"),
  });
  session.recordingStream.write(line + "\n");
}

export interface ResourceSummary {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  folder: string;
  type: string;
  connectedAt: number;
  assignedUsers?: string[];
}

export function listResources(): ResourceSummary[] {
  const agentResources = Array.from(agents.values()).map((a) => ({
    id: a.id,
    hostname: a.hostname,
    labels: a.labels,
    folder: a.labels.folder ?? "",
    type: a.type,
    connectedAt: a.connectedAt,
  }));
  const dialedResources = listConnections().map((c: Connection) => ({
    id: c.id,
    hostname: c.hostname,
    labels: c.labels,
    folder: c.folder,
    type: c.type,
    connectedAt: c.createdAt,
    assignedUsers: c.assignedUsers,
  }));
  return [...agentResources, ...dialedResources];
}
