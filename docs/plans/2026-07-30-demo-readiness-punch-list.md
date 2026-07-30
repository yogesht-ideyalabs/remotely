# Demo-readiness punch list

**Status:** done (14 of 17 items fixed; 2 already fixed before this pass; 1 dropped — see below)
**Date:** 2026-07-30

## Context

A 17-item punch list from a demo-readiness review, split into Must-Fix /
Should-Fix / Nice-to-Have. Verified each claim against the real code before
building anything — two turned out to already be fixed (#15 README is
current after this session's earlier rewrite; #17 the diagram share modal
already has a real copy-to-clipboard button) and are dropped from this
list. One turned out to be worse than described: **Moderated Sessions'
underlying trigger is broken, not just missing a UI** —
`getModerationPolicy()` reads `role.moderationPolicy`, a field that has
never existed on the real `Role` type; the real fields added later are
`requireSessionModeration`/`canModerate` (different name, different
shape). It would never have fired regardless of any UI built on top.

## Design decisions on the trickier items

**Moderated Sessions (#6)** — fixed `getModerationPolicy` to read the real
`requireSessionModeration` boolean and construct a sensible default
policy from it (1 moderator required, 5-minute timeout, pause-on-leave)
rather than expecting a full nested per-role config object nothing
writes. Wired the actual gate into **ssh-direct** sessions as the
reference implementation (generate the session id before dialing, check
the policy, await a moderator via the existing `awaitModeration`/
`moderatorJoined` functions, only dial the target after release) plus a
moderator queue page. Extending the identical pattern to RDP/VNC/
database/Kubernetes sessions is real, straightforward, repetitive work —
tracked as a fast-follow, not silently skipped.

**SSO (#2)** — OIDC config is read once from env vars at process start
(`oidc.ts`'s module-level constants); making it truly hot-reloadable
would mean restructuring the OIDC client to re-initialize on config
change, a bigger change than this pass. Built a read-only admin page
showing the live-active issuer/client ID (never the secret) plus the
exact env vars to set and restart to change them — honest about the
current mechanism rather than implying a save button that doesn't
actually take effect.

**Rate limiting (#3)** — extended `SecurityPolicy` with
`loginMaxAttempts`/`loginWindowMinutes`/`loginLockoutMinutes`, and made
the existing `loginLimiter` read these live on every check instead of
closing over constants fixed at server start — same "live, not
login-time-snapshotted" principle already used for RBAC roles.

**Agent binary (#8)** — turned out better than the original README scope
note ("packaged binary not built") suggested: `agent/dist-linux-x64/` and
`agent/dist-windows-x64/` already contain real compiled binaries (built by
the existing `build-binary.sh`/`build-windows.sh` scripts), just gitignored
and with no path from the UI to them. Built a real download path instead of
a placeholder: `GET /api/admin/agent/download-info` reports per-platform
availability by checking the dist dirs on disk (so the UI never shows a
button that 404s on a fresh checkout that hasn't run the build scripts),
and `GET /api/admin/agent/download/:platform` lazily tars the dist dir
(cached by the dir's mtime) and streams it — for Linux, the archive also
bundles `scripts/install-linux.sh` for parity with the Windows dist, which
already ships its own installer. The join-token REST endpoints and API
client functions this reused (`createJoinTokenApi`/`fetchJoinTokens`/
`revokeJoinTokenApi`) already existed fully built with no UI in front of
them — a second pre-existing gap the same page closes.

**Loading/error states (#12)** — added `Skeleton` loading placeholders to
list-fetching pages that previously rendered nothing while `null` (Roles,
Sessions, AccessRequests, Plugins, Organizations, Files, Users). Also found
`ChatOps.tsx`'s config load had a bare `catch {}` — a failed load left the
form showing unchecked/blank defaults with zero indication anything went
wrong, indistinguishable from "nothing configured yet." Added a real error
banner for that case.

**Theme toggle (#13)** — added a one-time dismissible tooltip pointing at
the theme/accent switcher in the topbar, shown until first interacted with
or dismissed (tracked via `localStorage`), rather than a fuller onboarding
tour.

**Demo video (#14)** — dropped. Requires real video production, not
something a code change produces.

## Files touched

- `control-plane/src/store.ts` — `SecurityPolicy` rate-limit fields; fixed
  a real bug found during verification (see below) where a stale persisted
  record silently dropped the new fields
- `control-plane/src/moderatedSessions.ts` — fixed `getModerationPolicy`
- `control-plane/src/rateLimiter.ts` — resolver-based live config
- `control-plane/src/index.ts` — ssh-direct moderation gate, dynamic rate
  limiter, `/api/admin/security-policy` extended, `/api/status` endpoint,
  test-connection endpoint, SSO config read endpoint, agent binary
  download-info/download endpoints
- `.gitignore` — agent download archive cache
- `web/src/pages/Resources.tsx` — Browse Cluster button, onboarding empty
  state
- `web/src/pages/Connections.tsx` — Mongo/Redis in engine dropdown, Test
  Connection button
- `web/src/pages/ModeratedSessions.tsx` — new, moderator queue
- `web/src/pages/SsoConfig.tsx` — new, read-only OIDC display
- `web/src/pages/InstallAgent.tsx` — new: join-token issuance, real binary
  downloads, per-platform install instructions
- `web/src/pages/Status.tsx` — new
- `web/src/pages/SecurityPolicy.tsx` — rate-limit fields UI
- `web/src/pages/ChatOps.tsx`, `web/src/pages/Plugins.tsx` — cross-reference
  copy, ChatOps load-error banner
- `web/src/pages/Roles.tsx`, `Sessions.tsx`, `AccessRequests.tsx`,
  `Organizations.tsx`, `Files.tsx`, `Users.tsx` — loading skeletons
- `web/src/ThemeSwitcher.tsx`, `web/src/index.css` — onboarding hint
- `web/src/IconSprite.tsx` — new `download` icon
- `web/src/Sidebar.tsx`, `web/src/App.tsx` — new routes/nav entries
- `web/src/api.ts` — client functions for status, SSO config, agent
  download, security-policy rate-limit fields

## Verification

- `npx tsc -b` clean on both `control-plane` and `web` after every step
  (pre-existing, unrelated errors in `CloudIcon.tsx`/`DiagramEditor.tsx`
  confirmed present before this pass and left untouched).
- Restarted both dev servers from cold (`tsx`/`vite` don't watch every file
  changed here) — `/api/health` → `{"status":"ok"}`, `/api/status` → real
  uptime/version/agent/session counts, web root → HTTP 200.
- Logged in as `admin`, exercised every new/changed admin endpoint live:
  `/api/admin/security-policy` (GET + POST round-trip with the three new
  rate-limit fields), `/api/admin/sso-config`, `/api/admin/moderated-sessions`,
  `/api/admin/join-tokens`, `/api/admin/agent/download-info` (both platforms
  correctly reported available), and `/api/admin/agent/download/linux` +
  `/download/windows` — both downloaded real, non-empty `.tar.gz` archives
  (41MB/40MB) and `tar tzf` confirmed real contents (`remotely-agent`
  binary + `native/pty.node` for Linux, `.exe`/`.ps1`/`.bat` for Windows).
- **Found and fixed a real bug during this pass**: `GET
  /api/admin/security-policy` was returning the three new rate-limit
  fields as **entirely absent** on first live test — a `securityPolicy`
  row persisted to disk before this session (from an earlier MFA-toggle
  save) was replacing `DEFAULT_SECURITY_POLICY` wholesale instead of
  merging with it, so every reader — including the login rate limiter
  itself — would have silently read `undefined` for all three. Fixed by
  spreading defaults under the persisted row instead of falling back only
  when no row exists at all; re-verified the GET/POST round-trip after the
  fix.
- All new/changed client routes (`/admin/moderated-sessions`,
  `/admin/sso-config`, `/admin/security-policy`, `/admin/install-agent`,
  `/status`, `/notifications`, `/admin/chatops`, `/admin/plugins`) resolve
  to HTTP 200 through the dev server.
- Not done in this pass: a full interactive browser walkthrough of every
  page (forms weren't click-tested in a real browser, only typechecked +
  endpoint-verified) — noted as a gap in the final report to the user.
