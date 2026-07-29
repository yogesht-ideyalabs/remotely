# Machine ID / non-human identity ("Bots")

**Status:** live
**Date:** 2026-07-29

## Context

Every credential in this product is designed to be short-lived or revocable
for *humans* (JIT SSH keys, tokenVersion-based instant revocation, 8h
session TTL) — but CI pipelines and automation scripts wanting to reach
Remotely today would have to hold a static, long-lived human credential,
the exact standing-credential problem this whole product exists to solve.
Teleport calls this gap "Machine ID"; it's the one item from the Teleport
catalog worth promoting off the "later" pile even though it's a real gap,
not a quick win — CI-needs-a-non-human-identity is a common, legitimate ask.

Deliberately **not** building Teleport's full join-method matrix (AWS IAM,
Azure federated credentials, GitHub Actions OIDC, GitLab CI, etc.) — that's
a wide integration tail, not a single design decision. This ships a real,
working MVP using a mechanism that already exists in this codebase and is
already proven in production use here: the same shared join-token system
agents already use to register (`createJoinToken`/`consumeJoinToken`/
`revokeJoinToken` in `store.ts`). Federated (OIDC-based) join methods are a
natural, additive next step once this lands — noted in Roadmap, not blocking
this pass.

## Design

**Reuse, not reinvent — the whole point of this design:**

- **Identity & RBAC**: a `Bot` is a `User`-shaped-but-simpler record (id,
  name, `roles: string[]`, `tokenVersion?`) — roles are the *exact* existing
  `Role` records humans use. A bot scoped to `resourceTypes: ["database"]`
  is bound by the identical label/TTL/CIDR rules a human would be. Zero new
  authorization code.
- **Bootstrap**: extend `JoinToken` with an optional `subjectId?: string`
  (undefined for existing agent-join tokens — fully backward compatible).
  `POST /api/admin/bots/:id/join-token` calls the existing `createJoinToken`
  with `subjectId` set to the bot's id; the raw token is shown once, same
  pattern as every other secret-on-creation flow in this app.
  `POST /api/bots/join` (public, no auth — the token *is* the auth) calls
  the existing `consumeJoinToken`, looks up which bot the token was scoped
  to, and issues a real JWT.
- **Token issuance & rotation**: a new `signBotToken(botId, roles,
  tokenVersion)` in `auth.ts`, structurally identical to `signToken` but
  with its own short TTL (15 minutes, vs. humans' 8 hours) and an
  `isBot: true` claim. `sub` is `bot:<id>` — prefixed so bot activity is
  visually distinguishable in the audit log without touching its schema.
  `POST /api/bots/refresh` lets a bot holding a still-valid token mint a
  fresh one before expiry — the actual "continuously rotated" behavior,
  achieved with one endpoint instead of Teleport's separate `tbot` daemon.
- **The one real code change to shared infrastructure**: `verifyTokenLive`
  (`auth.ts`) branches on `payload.isBot` — bot branch looks up the `Bot`
  record instead of `findUser`, otherwise identical (same tokenVersion
  revocation check, same live-roles-not-login-time-snapshot reasoning).
  Because every one of the 9 `verifyTokenLive` call sites (`requireAuth` +
  8 WS upgrade handlers) already goes through this one function, bots get
  first-class access to every existing session type and admin endpoint —
  SSH, database, Kubernetes, admin CRUD — for free, with the exact same
  audit trail, the exact same instant-revocation "log out everywhere," and
  the exact same RBAC enforcement humans get. Nothing about *what* a bot can
  reach is bot-specific; only *how it authenticates* is different.

**Admin UI**: new `Bots.tsx` page, modeled directly on `Users.tsx` —
list/create/delete bots, assign roles via the same tag-chip picker, a
"Generate join token" action showing the raw secret once, and a "Log out
everywhere" button reusing the same tokenVersion-bump pattern already built
for human users.

## Files touched

- `control-plane/src/store.ts` — `Bot` model, `JoinToken.subjectId`,
  `createBot`/`listBots`/`deleteBot`/`bumpBotTokenVersion`/`findBot`
- `control-plane/src/auth.ts` — `signBotToken`, `verifyTokenLive` bot branch
- `control-plane/src/index.ts` — `POST/GET/DELETE /api/admin/bots`,
  `POST /api/admin/bots/:id/join-token`, `POST /api/bots/join`,
  `POST /api/bots/refresh`, `POST /api/admin/bots/:id/logout-everywhere`
- `web/src/api.ts` — Bot types + API functions
- `web/src/pages/Bots.tsx` — new admin page
- `web/src/App.tsx`, `web/src/Sidebar.tsx` — route + nav entry
- `web/src/pages/Features.tsx` — status flip once verified live

## Verification

- `npx tsc -b` clean on control-plane and web (only the two pre-existing,
  unrelated errors in `CloudIcon.tsx`/`DiagramEditor.tsx` remain).
- Live, full lifecycle against real seeded data: created a role scoped to
  `resourceTypes: ["ssh-direct"]` + `client=acme-corp`, created a bot with
  that role, generated a join token, exchanged it via `POST /api/bots/join`
  for a real 15-minute JWT (`sub: "bot:ci-test-bot"`, `isBot: true`
  confirmed by decoding the token).
- Confirmed the join token is genuinely single-use: a second `/api/bots/join`
  attempt with the same token correctly returned 401 "join token already
  used."
- Confirmed real RBAC scoping, not just a listing check: the bot's
  `/api/resources` showed exactly one resource (the one its role allows),
  and it successfully opened a **real** `/ssh-direct-session` WebSocket
  against that resource (received real session data) — proving scoped
  access works for an actual session, not just the resource list.
- Confirmed the bot is correctly denied admin routes (403, no admin role)
  — the exact same enforcement a human without the admin role gets.
- Confirmed `POST /api/bots/refresh` issues a working fresh token, and
  correctly rejects a human's token with 403 "this endpoint is for bot
  identities only" (the bot-only guard actually works, not just present).
- Confirmed revocation: `POST /api/admin/bots/:id/logout-everywhere`
  instantly invalidated the bot's token on both a REST call (401) and a
  live WebSocket upgrade attempt (4001 unauthorized) — same bar as every
  other revocation test this session.
- Confirmed the audit log correctly attributes every bot action to
  `bot:ci-test-bot`, visually distinguishable from human usernames, across
  creation, join-token issuance, join, session start/end, and
  logout-everywhere.
- Test bot and role deleted afterward; confirmed `GET /api/admin/bots`
  returns empty again.
