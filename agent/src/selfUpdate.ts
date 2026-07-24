import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// Real self-update, but only meaningful when running as the compiled SEA
// binary (see agent/scripts/build-binary.sh) — under `npx tsx src/index.ts`
// there is no single executable file to replace, so this is a log-only
// no-op there. Detected via node:sea's isSea(), not a guess.
export async function maybeSelfUpdate(downloadUrl: string, targetVersion: string, agentId: string): Promise<boolean> {
  let sea: typeof import("node:sea");
  try {
    sea = await import("node:sea");
  } catch {
    console.log(`[${agentId}] update to ${targetVersion} requested, but node:sea isn't available on this Node version — skipping`);
    return false;
  }
  if (!sea.isSea()) {
    console.log(`[${agentId}] update to ${targetVersion} requested, but not running as the compiled binary (dev/tsx mode) — skipping`);
    return false;
  }

  const currentPath = process.execPath;
  const dir = path.dirname(currentPath);
  const tmpPath = path.join(dir, `.remotely-agent-update-${Date.now()}`);

  console.log(`[${agentId}] downloading update from ${downloadUrl}...`);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`update download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1_000_000) {
    // A real Node SEA binary embeds the whole Node runtime — anything
    // suspiciously small is almost certainly a bad URL/error page, not a
    // truncated-but-real binary. Cheap sanity check before we ever
    // overwrite the running executable.
    throw new Error(`downloaded artifact is only ${bytes.length} bytes — refusing to install, looks wrong`);
  }

  fs.writeFileSync(tmpPath, bytes, { mode: 0o755 });
  // Same-directory rename is atomic on POSIX filesystems — there's no
  // window where the path exists but is half-written, which is the
  // property that actually matters for "safe to be running while this
  // happens" (the OS keeps the currently-executing binary's inode alive
  // even after its path is replaced out from under it).
  fs.renameSync(tmpPath, currentPath);
  console.log(`[${agentId}] update installed, restarting into new binary...`);

  const child = spawn(currentPath, [], {
    env: process.env,
    detached: true,
    stdio: "inherit",
  });
  child.unref();

  // Without this, the old process just keeps running alongside the new
  // one — both connected to the control plane under the same agent id,
  // fighting over which one actually owns that id's `agents` map entry
  // (found this exact bug by testing the update against a real running
  // container: `ps` showed two live processes after "restarting", not
  // one). A brief delay just gives the spawn call's own process-creation
  // syscall a moment to land before we pull the rug out from under it.
  setTimeout(() => process.exit(0), 250);
  return true;
}
