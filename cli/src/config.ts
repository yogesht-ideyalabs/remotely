import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same idea as `~/.ssh/config` or `~/.aws/credentials` — a small local
// file, not a system keychain integration (that's a real gap for a
// production CLI, noted rather than hidden).
const CONFIG_DIR = path.join(os.homedir(), ".remotely-cli");
const SESSION_PATH = path.join(CONFIG_DIR, "session.json");

export interface CliSession {
  controlPlaneUrl: string;
  token: string;
  username: string;
  roles: string[];
}

export function loadSession(): CliSession | null {
  try {
    return JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function saveSession(session: CliSession) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearSession() {
  try {
    fs.unlinkSync(SESSION_PATH);
  } catch {
    // already gone — logout is idempotent
  }
}

export function requireSession(): CliSession {
  const session = loadSession();
  if (!session) {
    console.error("Not logged in. Run: remotely login <username> [--url http://control-plane:4000]");
    process.exit(1);
  }
  return session;
}
