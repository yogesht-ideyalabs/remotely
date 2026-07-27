/**
 * Real OS-user impersonation for ssh-agent (reverse-tunnel) sessions.
 *
 * Before this: every session ran as whichever user the agent process
 * itself happened to run as, regardless of the `login` the browser
 * requested — RBAC could DENY a login string against a role's allowlist,
 * but if it was allowed, the shell still silently ran as the agent's own
 * user, not the requested one. That's a real privilege-confusion gap, not
 * just an honesty gap: a role granting "alice can log in as alice" was
 * actually granting "alice gets a shell as whoever the agent runs as."
 *
 * Fix: node-pty's spawn() accepts uid/gid directly (Unix only) — no need
 * to shell out to `sudo`/`su`. Setting them to a different user's
 * uid/gid than the calling process's own requires the process to be
 * running as root (or hold CAP_SETUID/CAP_SETGID), the same requirement
 * any fork+setuid-based impersonation has. If the agent can't actually
 * satisfy that, sessions for any login other than the agent's own user
 * must fail loudly — silently falling back to running as the agent's own
 * user would recreate the exact privilege-confusion bug this fixes.
 */

import fs from "node:fs";
import os from "node:os";

// Known, real, verified-not-guessed limitation: node-pty's native addon
// (src/unix/pty.cc) calls setgid()+setuid() on the target uid/gid but never
// setgroups()/initgroups() — so the spawned shell's EUID/EGID genuinely
// become the target user's (confirmed via a live `id`/`whoami` test: a
// process spawned this way really can't act as the parent's uid anymore),
// but it keeps whatever *supplementary* groups the parent process (the
// agent, running as root) had — including group 0 (root) itself. This is a
// much smaller exposure than retaining root's UID (most sensitive files
// are owner-only, not group-writable by gid 0), but it's a real, not
// theoretical, residual gap — not something achievable to fix from
// node-pty's public options surface without patching its native addon,
// which is out of scope here. Documented rather than hidden; also surfaced
// in the compliance report (see compliance.ts's cc6.1-os-impersonation
// control) rather than only in a code comment nobody reads.
export interface ImpersonationTarget {
  uid: number;
  gid: number;
  home: string;
  shell: string;
}

let passwdCache: Map<string, ImpersonationTarget> | null = null;

function loadPasswd(): Map<string, ImpersonationTarget> {
  if (passwdCache) return passwdCache;
  const map = new Map<string, ImpersonationTarget>();
  try {
    const text = fs.readFileSync("/etc/passwd", "utf8");
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      // name:password:uid:gid:gecos:home:shell
      const fields = line.split(":");
      if (fields.length < 7) continue;
      const [name, , uidStr, gidStr, , home, shell] = fields;
      const uid = Number(uidStr);
      const gid = Number(gidStr);
      if (Number.isNaN(uid) || Number.isNaN(gid)) continue;
      map.set(name, { uid, gid, home, shell: shell || "/bin/sh" });
    }
  } catch {
    // /etc/passwd unreadable or doesn't exist (e.g. non-Linux) — resolveUser
    // just won't find anyone, which correctly fails closed below.
  }
  passwdCache = map;
  return map;
}

/** Looks up a username's uid/gid/home/shell from /etc/passwd. Linux-only (the agent's real deployment target). */
export function resolveUser(username: string): ImpersonationTarget | null {
  return loadPasswd().get(username) ?? null;
}

/** Whether this process could actually set a *different* uid/gid on a child — i.e. is it root. */
export function canImpersonate(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

export function currentOsUsername(): string {
  return os.userInfo().username;
}
