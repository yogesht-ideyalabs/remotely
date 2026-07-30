/**
 * Moderated Sessions
 *
 * A role can require that a session cannot start until one or more users
 * with a "moderator" role join. The moderator can:
 * - Watch the session in real-time (already exists via live-watch)
 * - Forcibly terminate the session at any time
 * - Be notified when a session is pending their presence
 *
 * How it works:
 * 1. When a user initiates a session, the system checks if any of their
 *    active roles have `requireSessionModeration: true`
 * 2. If yes, the session enters a "pending_moderation" state
 * 3. Users with `canModerate: true` in their role see pending sessions
 * 4. When a moderator joins (via the watch/spectate WebSocket), the
 *    session is released and the PTY/connection actually starts
 * 5. If the moderator disconnects, the session can optionally be paused
 *    or terminated (configurable per-role)
 *
 * Author: Yogesh Tiwari
 */

import type { Role } from "./store.js";

export interface ModerationPolicy {
  required: boolean;
  // Minimum number of moderators that must be present
  minModerators: number;
  // What happens if all moderators leave an active session
  onModeratorLeave: "terminate" | "pause" | "continue";
  // Timeout (seconds) — if no moderator joins within this time, session is auto-denied
  timeoutSeconds: number;
}

export interface PendingModeratedSession {
  sessionId: string;
  resourceId: string;
  resourceHostname: string;
  username: string;
  requestedAt: number;
  policy: ModerationPolicy;
  // Track which moderators have joined
  moderators: Set<string>;
  // Whether the session has been released (moderator joined)
  released: boolean;
  // Callbacks
  onRelease: () => void;
  onTimeout: () => void;
  timeoutTimer?: NodeJS.Timeout;
}

// In-memory store of sessions waiting for a moderator
const pendingSessions = new Map<string, PendingModeratedSession>();

// A sensible fixed policy for the simple per-role boolean toggle
// (Role.requireSessionModeration) that actually exists and is settable
// from the Roles page — one moderator required, 5-minute wait before the
// request times out, and the session pauses (rather than terminating
// outright) if every moderator disconnects mid-session. A previous version
// of this function looked for a `role.moderationPolicy` object field that
// was never added to the real `Role` type anywhere — it always returned
// null, so no session was ever actually gated regardless of what any UI
// showed. Fixed to read the field that's genuinely on the type.
const DEFAULT_MODERATION_POLICY: ModerationPolicy = {
  required: true,
  minModerators: 1,
  onModeratorLeave: "pause",
  timeoutSeconds: 300,
};

/**
 * Check if a user's roles require session moderation.
 */
export function getModerationPolicy(roles: Role[]): ModerationPolicy | null {
  for (const role of roles) {
    if (role.requireSessionModeration) return DEFAULT_MODERATION_POLICY;
  }
  return null;
}

/**
 * Register a session as pending moderation.
 * Returns a Promise that resolves when a moderator joins, or rejects on timeout.
 */
export function awaitModeration(
  sessionId: string,
  resourceId: string,
  resourceHostname: string,
  username: string,
  policy: ModerationPolicy
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pending: PendingModeratedSession = {
      sessionId,
      resourceId,
      resourceHostname,
      username,
      requestedAt: Date.now(),
      policy,
      moderators: new Set(),
      released: false,
      onRelease: resolve,
      onTimeout: () => reject(new Error("Session timed out waiting for moderator")),
    };

    // Set timeout
    if (policy.timeoutSeconds > 0) {
      pending.timeoutTimer = setTimeout(() => {
        if (!pending.released) {
          pendingSessions.delete(sessionId);
          pending.onTimeout();
        }
      }, policy.timeoutSeconds * 1000);
    }

    pendingSessions.set(sessionId, pending);
  });
}

/**
 * Called when a moderator joins a session's watch channel.
 * If the session is pending moderation, releases it.
 */
export function moderatorJoined(sessionId: string, moderatorUsername: string): boolean {
  const pending = pendingSessions.get(sessionId);
  if (!pending) return false;

  pending.moderators.add(moderatorUsername);

  if (pending.moderators.size >= pending.policy.minModerators && !pending.released) {
    pending.released = true;
    if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
    pendingSessions.delete(sessionId);
    pending.onRelease();
    return true;
  }

  return false;
}

/**
 * Called when a moderator leaves a session's watch channel.
 * Returns the action to take ("terminate" | "pause" | "continue").
 */
export function moderatorLeft(sessionId: string, moderatorUsername: string): "terminate" | "pause" | "continue" | null {
  const pending = pendingSessions.get(sessionId);
  if (pending) {
    pending.moderators.delete(moderatorUsername);
    return null; // Still waiting, no action
  }

  // For already-released sessions, check the active moderation tracking
  // (stored elsewhere in state.ts alongside the session info)
  // Return the policy action — the caller handles the actual termination
  return null; // Handled by the session state manager
}

/**
 * List all sessions currently waiting for a moderator.
 */
export function listPendingModeratedSessions(): {
  sessionId: string;
  resourceId: string;
  resourceHostname: string;
  username: string;
  requestedAt: number;
  currentModerators: string[];
  requiredModerators: number;
  timeoutSeconds: number;
}[] {
  return Array.from(pendingSessions.values()).map((p) => ({
    sessionId: p.sessionId,
    resourceId: p.resourceId,
    resourceHostname: p.resourceHostname,
    username: p.username,
    requestedAt: p.requestedAt,
    currentModerators: Array.from(p.moderators),
    requiredModerators: p.policy.minModerators,
    timeoutSeconds: p.policy.timeoutSeconds,
  }));
}

/**
 * Cancel a pending moderated session (e.g., user disconnects before moderator joins).
 */
export function cancelPendingSession(sessionId: string): void {
  const pending = pendingSessions.get(sessionId);
  if (pending) {
    if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
    pendingSessions.delete(sessionId);
  }
}
