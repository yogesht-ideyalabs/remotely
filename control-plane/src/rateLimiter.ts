/**
 * Small hand-rolled rate limiter — not pulling in express-rate-limit for
 * something this size, matching this project's established preference for
 * reasoning-through-directly (see totp.ts's own RFC 6238 implementation for
 * the same philosophy). A factory rather than one hardcoded instance so
 * independent call sites (login, access-request submission, webhook
 * test-sends, ...) each get their own isolated window/Map without
 * copy-pasting the whole block per site — this is exactly the block that
 * used to live inline in index.ts for login only.
 *
 * Author: Yogesh Tiwari
 */

export interface RateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  lockoutMs: number;
}

export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds?: number };
  // Returns justLockedOut:true only on the exact call that transitions a
  // key from "under the limit" to "locked out" — callers that want a
  // one-time notification (e.g. a lockout email) key off this rather than
  // firing on every subsequent failed attempt while already locked.
  recordFailure(key: string): { justLockedOut: boolean };
  clear(key: string): void;
}

interface AttemptState {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

// Accepts either fixed options (every existing call site — access-request
// spam limiting, webhook test-send limiting, unchanged behavior) or a
// resolver function evaluated on every check/recordFailure call, so a
// caller like the login limiter can read admin-configurable settings live
// from SecurityPolicy instead of the limits being baked into this closure
// at server start. Same "live, not startup-snapshotted" principle already
// used for RBAC roles.
export function makeRateLimiter(optionsOrResolver: RateLimiterOptions | (() => RateLimiterOptions)): RateLimiter {
  const attempts = new Map<string, AttemptState>();
  const resolve: () => RateLimiterOptions = typeof optionsOrResolver === "function" ? optionsOrResolver : () => optionsOrResolver;

  function check(key: string): { allowed: boolean; retryAfterSeconds?: number } {
    const state = attempts.get(key);
    if (!state?.lockedUntil) return { allowed: true };
    const now = Date.now();
    if (state.lockedUntil <= now) {
      attempts.delete(key);
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) };
  }

  function recordFailure(key: string): { justLockedOut: boolean } {
    const { windowMs, maxAttempts, lockoutMs } = resolve();
    const now = Date.now();
    const state = attempts.get(key);
    if (!state || now - state.firstAttemptAt > windowMs) {
      attempts.set(key, { count: 1, firstAttemptAt: now, lockedUntil: null });
      return { justLockedOut: false };
    }
    state.count += 1;
    if (state.count >= maxAttempts && !state.lockedUntil) {
      state.lockedUntil = now + lockoutMs;
      return { justLockedOut: true };
    }
    return { justLockedOut: false };
  }

  function clear(key: string): void {
    attempts.delete(key);
  }

  // Periodic sweep so this Map doesn't grow unbounded on a long-running
  // process — drops anything whose window has fully expired and isn't
  // currently locked out. Re-reads windowMs each tick too, so a policy
  // change takes effect here as well, not just on the next login attempt.
  setInterval(() => {
    const { windowMs } = resolve();
    const now = Date.now();
    for (const [key, state] of attempts) {
      const windowExpired = now - state.firstAttemptAt > windowMs;
      const lockExpired = !state.lockedUntil || state.lockedUntil <= now;
      if (windowExpired && lockExpired) attempts.delete(key);
    }
  }, 60 * 60 * 1000).unref();

  return { check, recordFailure, clear };
}
