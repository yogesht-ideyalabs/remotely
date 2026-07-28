# Remotely — POC

A working proof of concept of "Remotely": browser-based access to SSH, RDP,
databases, and Kubernetes; full RBAC (allow/deny labels, resource-type
scoping, login allowlists, session TTL, source-IP CIDR); SSO (OIDC), MFA
(TOTP + WebAuthn/passkeys), and a full security-hardening layer (rate
limiting, account lockout, password policy, token revocation, admin IP
allowlist, tamper-evident audit log); user/role/connection/organization
administration with delegated (tenant) admin; JIT access requests with
approval workflow and break-glass; multi-cloud infrastructure discovery
(AWS/Azure/GCP direct API sync, Docker/Podman, agent-reported) with
auto-generated and hand-editable draw.io-style diagrams, access-aware
overlays, blast-radius view, and point-in-time snapshots/diffing; uptime
monitoring, SIEM export, a webhook plugin system, and SOC2-style compliance
reporting; session recording/replay and live session watch/spectate; and a
structured, hash-chained audit log. See [Scope, honestly](#scope-honestly)
for exactly what's still cut and why.

## Architecture

```
 [Client A network]              [Client B network]
   agent (client-a-web-01)          agent (client-b-web-01)
   labels: client=acme-corp         labels: client=globex-inc
        │  dials OUT (ws)                │  dials OUT (ws)
        └──────────────┐   ┌─────────────┘
                        ▼   ▼
                  control-plane (Express + ws)
                  - JWT login (password/OIDC/WebAuthn), MFA, full RBAC
                  - rate limiting, lockout, password policy, tokenVersion
                    revocation, admin IP allowlist, hash-chained audit log
                  - users/roles/connections/orgs admin CRUD (store.ts)
                  - delegated/tenant admin (manageLabels)
                  - JIT access requests, approval workflow, break-glass
                  - multiplexes ssh-agent traffic to the
                    right agent's outbound connection
                  - dials ssh-direct/database/Kubernetes itself
                  - relays RDP sessions through guacd (guac.ts)
                  - infra discovery: direct AWS/Azure/GCP sync,
                    agent-reported Docker/Podman, auto + manual diagrams
                  - uptime monitors, SIEM export, webhook plugins,
                    compliance reports
                  - tees session output to a recording file
                  - appends every event to a hash-chained audit log
                        ▲            ▲            ▲
      browser WS, JWT   │            │ TCP (ssh2) │ TCP (pg/mysql)
                        │      ┌─────┴─────┐  ┌────┴─────┐
                  web (React)  │   guacd   │  │ db-target │
                  - login, resource browser │  │(Postgres/ │
                    (folders + search),     │  │  MySQL)   │
                    xterm.js SSH/K8s exec,  │  └──────────┘
                    canvas RDP console,     ▼
                    SQL console, file       rdp-target (xrdp)
                    transfer, audit,
                    recordings + replay,
                    live session watch,
                    diagram editor + auto
                    architecture views,
                    admin dashboards,
                    command palette
```

Two SSH architectures coexist on purpose: **ssh-agent** resources dial
*out* to the control plane (zero inbound ports on the client network — the
Teleport model); **ssh-direct** resources are dialed *by* the control
plane using stored host+credentials, or a real ephemeral-keypair-per-
session JIT mechanism (`sshJit.ts`, the same model as AWS EC2 Instance
Connect). RDP (via guacd), Database (via `pg`/`mysql2`), and Kubernetes
(via `@kubernetes/client-node` exec) are all control-plane-dialed — all
show up as ordinary "Connections" you add through the UI. Infrastructure
discovery is a separate pathway: either an agent reports what it finds
(Docker/Podman) or the control plane calls cloud provider APIs directly
(hand-rolled AWS SigV4, Azure Service Principal + ARM REST, GCP Service
Account + Cloud Asset Inventory) — this data feeds the auto-generated
diagrams, snapshots, and blast-radius view independently of the
session-access pathway above.

## Run it

One command, genuinely from nothing (a fresh machine with nothing set up
yet) to a fully seeded, ready-to-demo instance — brings up the Docker
targets via `docker-compose.yml`, waits for them, does the one-time
container setup (RDP password, DB seed table, SSH-JIT sshd config), starts
the control plane/agents/web UI, and seeds both the RBAC demo data and the
34-resource multi-cloud infra-discovery demo data, all idempotent and safe
to re-run:

```bash
cd /Users/yogesht/Projects/building-with-kiro/remotely-poc
./start.sh
```

(Requires Docker Desktop or equivalent already running — nothing else.
See "Docker targets" below if you'd rather understand/run each container
individually instead of via the compose file.)

Open **http://localhost:5173**:

| User | Password | What they see |
|---|---|---|
| `admin` | `admin123` | Full admin — every resource, every type, every login, all admin pages (Users/Roles/Connections/Organizations/Audit/Recordings/Monitors/SIEM/Compliance/Plugins/Security Policy) |
| `acme-admin` | `acmeadmin123` | **Delegated (tenant) admin** — manages only acme-corp's users + connections; can't see Roles/Recordings/Organizations/Monitors/SIEM/Compliance/Plugins/Security Policy, can't grant admin roles, can't touch other tenants |
| `alice` | `alice123` | Plain user — scoped to acme-corp **SSH-agent** resources only (excludes RDP/database/ssh-direct even though the label matches, via `resourceTypes`) |
| `bob` | `bob1234567` | Plain user with **zero roles** — access comes entirely from direct connection/folder assignment (see below); demonstrates that path independent of RBAC labels |

None of the seeded accounts have MFA enabled by default, so you can log
straight in — enable TOTP or a passkey from **Profile → Security** on any
of them to try that flow.

```bash
./stop.sh        # kill the four Node processes (control plane, 2 agents, web) — Docker targets keep running
./demo-reset.sh  # wipe all persisted state (DB, audit log, recordings) back to a pristine demo, for going into a client demo clean
```

## What's real

### Access & sessions

| Feature | Real, not mocked |
|---|---|
| Browser SSH (reverse-tunnel agent) | Yes — real `node-pty`, real shell |
| Browser SSH (direct-dial, no agent) | Yes — real `ssh2` connection, add-and-go from the UI |
| SSH JIT ephemeral keys | Yes — a real per-session ephemeral keypair via an `AuthorizedKeysCommand` hook (`sshJit.ts`), the same model as AWS EC2 Instance Connect/Teleport agentless mode — no long-lived credential is ever stored on the target |
| Browser RDP viewer | Rendering **confirmed** (real `guacd` + real `xrdp` desktop, screenshotted); input (mouse/key) sends correctly per protocol but **isn't confirmed to reach the session** — see the RDP caveat below |
| Browser database console | Yes — real `pg`/`mysql2` connections, real SQL execution, real result sets, every query text audited |
| Kubernetes access | Yes — real `kubectl exec`-equivalent via `@kubernetes/client-node`, same terminal UI as SSH |
| File transfer (SFTP) | Yes, for `ssh-direct` connections — real directory listing/upload/download, byte-for-byte round-trip verified. Not built for `ssh-agent` resources (would need a new file-op protocol relayed through the agent's tunnel) |
| Session recording + replay | Yes — SSH/RDP/database sessions captured byte + timestamp, replayed via the same viewer components used live |
| Live session watch/spectate | Yes — an admin can mirror any live session (terminal/RDP/DB) read-only over a dedicated WS channel; the server drops all inbound input from the watcher |
| Session kill | Yes — admins can terminate any live session from the Active Sessions page |

### Access management & RBAC

| Feature | Real, not mocked |
|---|---|
| Full RBAC engine | Yes — allow/deny labels, resource-type scoping, login allowlist, session TTL auto-disconnect, source-IP CIDR, time-bound roles, multiple roles per user, direct assignment — all scripted-tested, not just eyeballed |
| **Direct per-user / per-folder assignment** | Yes — a connection or an entire folder can be shared directly with specific users, bypassing RBAC label matching entirely; verified with a zero-role user (`bob`) who gets access purely from this path |
| **Delegated/tenant admin** | Yes — a role's `manageLabels` grants admin-lite access (CRUD users + connections) scoped to a label pattern, without the full `admin` role; verified it can't escalate, can't cross tenants, can't touch roles or organizations |
| **JIT access requests + approval workflow** | Yes — a user requests time-boxed access with a reason, an admin approves/denies, the grant auto-expires; visible on both sides in the UI |
| **Break-glass** | Yes — roles can be marked eligible for self-approved emergency access, time-boxed and fully audited, for the "production is down, I need in now" case |
| **Organizations** (org-level setup) | Yes — a real entity: `/api/admin/organizations` CRUD, a dedicated admin page, branding, usage stats, and User/Connection forms pick from a dropdown instead of a free-typed tenant string |
| Folders (connections) + categories (roles) | Yes — both admin pages group by folder/category, same pattern as the end-user Resources page |
| Bulk actions | Yes — multi-select + bulk delete/role-change on Users, bulk delete/assign/move-folder on Connections |

### Auth & security hardening

| Feature | Real, not mocked |
|---|---|
| Password login | Yes — bcrypt-hashed |
| SSO (OIDC) | Yes — a real authorization-code + PKCE flow, hand-built (no `openid-client` dependency), tested end-to-end against a self-hosted Dex IdP with JIT user provisioning on first login |
| MFA — TOTP | Yes — a hand-rolled RFC 6238 implementation (HMAC-SHA1), Google Authenticator/Authy compatible, enable/disable from Profile |
| MFA — WebAuthn/passkeys | Yes — real FIDO2 registration + login via `@simplewebauthn/server`, multiple keys per user, named/managed from Profile |
| Login rate limiting + account lockout | Yes — sliding-window limiter (shared factory, also used for access-request spam and webhook test-sends), locks out after repeated failures, sends an admin-configured alert email on the lockout transition |
| Password policy | Yes — minimum length + complexity enforced at every password-set path (self-service, admin-create, admin-update), not just one of them |
| Token revocation ("log out everywhere") | Yes — a `tokenVersion` bump on the user record invalidates every already-issued JWT immediately, checked on **every** authenticated request and WebSocket upgrade (8 independent call sites), not just new logins |
| Org-wide "require MFA for admins" policy | Yes — a soft nag (banner + `mfaSetupRequired` flag), not a hard block, so it can never lock out the only admin account |
| Admin IP allowlist | Yes — CIDR-based allowlist enforced on every admin route; empty list (default) = unrestricted |
| Security headers | Yes — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, set on every response |
| Hash-chained audit log | Yes — every audit entry is cryptographically chained to the one before it (`sha256(prevHash + payload)`); an `/api/admin/audit/verify` endpoint recomputes the whole chain and reports the exact break point if anything was edited or deleted out of band |
| Download tokens | Yes — file downloads use a 60-second, path-scoped signed token, not the long-lived session JWT, so a value landing in server logs/browser history is low-stakes |

### Infrastructure discovery & diagramming

| Feature | Real, not mocked |
|---|---|
| Direct AWS sync | Yes — real signed API calls (hand-rolled SigV4, `awsSigV4.ts`) against STS/EC2/RDS/ELB/Lambda, no AWS SDK dependency |
| Direct Azure sync | Yes — real Service Principal OAuth2 + ARM REST calls |
| Direct GCP sync | Yes — real Service Account JSON key + Cloud Asset Inventory API calls |
| Agent-reported discovery | Yes — the same agent binary that tunnels SSH can also report locally-discovered Docker/Podman containers and fingerprinted services |
| Auto-generated diagrams | Yes — regenerated automatically on every sync via a pluggable strategy registry (by-provider, by-account, by-category, all-in-one) |
| Manual diagram editor | Yes — a real draw.io-class canvas (React Flow): shapes, connectors, multi-select, resize, undo/redo, save/version, live multi-user collaboration over WebSocket, public read-only share links |
| Access-aware diagrams / blast radius | Yes — infra resources can be manually linked to their corresponding RBAC `Connection`; the diagram then overlays who can reach a node and, from any node, highlights everything reachable through that access grant |
| Infra snapshots + diff | Yes — point-in-time capture of the whole discovered graph, with an added/removed/modified diff between any two snapshots |
| Demo seed data | **Explicitly demo-only** — a one-click button fabricates ~34 realistic multi-cloud resources across three fake AWS/Azure/GCP "projects," so the diagram/architecture tooling has something to show without live cloud credentials. Everything downstream of it (diagrams, snapshots, blast radius) is real; the seed data itself is not |

### Admin & operational tooling

| Feature | Real, not mocked |
|---|---|
| Uptime monitors | Yes — real scheduled HTTP/TCP/keyword/heartbeat checks with up/down alerting |
| SMTP alert email | Yes — real delivery via `nodemailer`, used for monitor alerts and lockout notifications |
| SIEM export | Yes — real signed webhook delivery of every audit event to one configured external endpoint (Splunk HEC / Datadog Logs intake / generic ingest), the actual mechanism most SIEM integrations use in practice |
| Webhook plugin system | Yes — many independently-configurable, event-filtered, signed outbound webhook targets (Slack/PagerDuty/Jira-style integrations), sharing the same signed-delivery code as SIEM export, plus an SSRF private-IP blocklist on admin-configured destinations |
| Compliance reporting | Yes — a SOC2-style Trust Services Criteria report computed from real live system state (users, roles, audit log, SIEM config, recordings), and honest about what it *can't* verify (e.g., encryption at rest, since the POC's SQLite file isn't encrypted) rather than faking a pass |
| Configurable dashboard | Yes — admin landing page with real aggregate stats and a widget layout the user can rearrange/save |
| Agent health dashboard | Yes — agents send a 20s heartbeat; the page shows live uptime/last-seen/latency/active-sessions, plus join-token issue/revoke |
| Notification center | Yes — bell shows recent denials/expirations/admin actions, scoped to you (or everything, if full admin) |
| Command palette (Cmd/Ctrl+K) | Yes — fuzzy search across resources + admin pages, keyboard nav |
| Real SQLite persistence | Yes (`db.ts`, Node's built-in `node:sqlite`) — closes what was previously the single biggest gap in this POC (in-memory-only storage that reset on every restart) |
| Theming | Yes — dark/light + 4 accents, persisted, live-switchable |

### RBAC — what was actually tested

Each of these was verified with a scripted WS/API test, not just eyeballed: deny-label overriding a wildcard allow; resource-type scoping (an SSH-only role correctly can't see the RDP/database resources even with a matching label); login allowlist denial; session TTL auto-kill; source-IP CIDR denial; a zero-role user gaining access purely through direct connection assignment, then through a folder-level bulk assignment; and for delegated admin specifically — cannot view Roles or Organizations (403), cannot grant the `admin` role or another delegated-admin role (blocked), cannot create/move a user into a tenant outside their scope (blocked), can freely manage their own tenant's users and connections. On the security-hardening side: a revoked token (`tokenVersion` bump) 401s on both a REST call and a live WebSocket upgrade; a tripped login rate limit returns `429` and reaches the lockout-email code path; a deliberately corrupted audit log line is caught by `/api/admin/audit/verify` with the correct break point; an admin IP allowlist correctly 403s hard, including against the admin who set it (a real, expected self-lockout risk — recoverable only by editing the stored policy directly, not through the API).

## RDP caveat (unchanged from before, still true)

Reuses **Apache Guacamole's `guacd`** rather than reimplementing RDP.
Rendering is confirmed with real screenshots of a live remote desktop.
Mouse/keyboard input is sent in the correct Guacamole wire format
(verified at the raw protocol level) but had no observed effect on the
test `xrdp` container — most likely an X11-input quirk in that specific
community Docker image, not proven either way. Try a different RDP target
before investing more time here.

## Docker targets

`./start.sh` already brings these up automatically via `docker-compose.yml`
(guacd, rdp-target, ssh-target, db-target, dex — all on a `remotely-net`
network, plus the one-time RDP-password/DB-seed-table setup). This section
is for understanding what's actually running, or bringing them up by hand
without the rest of `start.sh`:

```bash
docker compose up -d --wait   # everything below, in one shot

# equivalent manual commands, for reference:
docker network create remotely-net
docker run -d --name guacd --network remotely-net -p 4822:4822 guacamole/guacd:1.5.5
docker run -d --name rdp-target --network remotely-net -p 3389:3389 danielguerra/ubuntu-xrdp
docker exec rdp-target bash -c "echo 'ubuntu:demo1234' | chpasswd"
docker run -d --name ssh-target --network remotely-net -p 2222:2222 \
  -e PASSWORD_ACCESS=true -e USER_NAME=demo -e USER_PASSWORD=demo1234 -e SUDO_ACCESS=true \
  linuxserver/openssh-server
docker run -d --name db-target --network remotely-net -p 5432:5432 \
  -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo1234 -e POSTGRES_DB=appdb postgres:16-alpine
docker exec db-target psql -U demo -d appdb -c \
  "CREATE TABLE customers (id serial primary key, name text, plan text); INSERT INTO customers (name, plan) VALUES ('Acme Corp','enterprise'), ('Globex Inc','pro');"
```

Note the asymmetry: `rdp-target`'s connection record uses the **container
name** (`rdp-target:3389`) because `guacd` itself runs inside
`remotely-net` and dials it from there. `ssh-target`/`db-target` use
**`localhost`** + the mapped port because the control plane dials those
directly and runs on the host, not inside Docker. This is exactly the
agent-vs-central-relay distinction from the architecture diagram above,
showing up in miniature.

## Two questions answered along the way

**What do you install on a real remote machine?** The `agent/` folder —
but as shipped it's a dev script (`npx tsx src/index.ts`), not something
you'd hand to a client. Packaging it as a single compiled binary (Node's
"Single Executable Application" support, or `pkg`) is the next step before
this leaves your laptop — not done here, flagged as a gap.

**Separate page for standard users?** No — one Resources page for
everyone, server-filtered by role, with nav items conditionally shown
(`isAdmin` / `isDelegatedAdmin` from the login response). Kept it this way
deliberately: two UIs to maintain in sync is real ongoing cost for a
benefit that hasn't shown up yet.

## Scope, honestly

Deliberately **not built** (each is its own multi-day-to-multi-week effort):

- **Field-level encryption at rest** for stored secrets (SSH keys, DB/SMTP/webhook passwords) — the highest-risk, most invasive item still on the list: it touches every secret read/write path and needs real key management plus a migration story for already-plaintext demo data. Deliberately scoped into its own future pass rather than bundled in.
- **True short-lived-cert auth** — the session JWT is still a fixed-secret, 8-hour-TTL token (now with real revocation via `tokenVersion`, rate limiting, lockout, and an admin IP allowlist layered on top) rather than short-lived certs/mTLS bound to an SSO identity.
- **Packaged/installable agent binary** — still a dev script (`npx tsx`), not a compiled single-file executable.
- **Agent auto-update / IAM-based joining** — agents currently join with a single shared static token (`AGENT_JOIN_TOKEN`), not per-agent enrollment or cloud-IAM-based trust.
- **Per-tenant billing metrics, SLA monitoring, white-label branding beyond logo/name** — reporting/cosmetic layers on top of data that already exists, not built this round.
- **AI features** (anomaly detection, risk scoring, natural-language audit summarization) — entire category, untouched.
- **True OS-user impersonation** — `login`/`username` is RBAC-*enforced* (a role can be denied a specific login) but an ssh-agent session still runs as whichever OS user the agent process itself runs as.
- **Terraform provider / public SDK** as a maintained, versioned package — the control-plane REST API is stable enough to script against, but no dedicated client library or Terraform provider ships from this repo.

## Known rough edges

- `node-pty`'s prebuilt `spawn-helper` binary isn't executable by default until you `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` in `agent/` after a fresh install.
- `AGENT_JOIN_TOKEN`, `JWT_SECRET`, `SSH_JIT_INTERNAL_TOKEN`, and every Docker target's password are hardcoded dev defaults — the control plane prints a startup warning about this, but nothing enforces changing them.
- `guacd`/`rdp-target`/`ssh-target`/`db-target` are Docker containers, not part of `start.sh`/`stop.sh` — `docker start`/`stop` them separately (or use `docker compose`).
- Delegated-admin scoping on `/api/audit` filters by tenant/connection ownership; the notification bell uses a simpler "your own events only" rule for non-full-admins — intentionally less precise, it's a glanceable feed, not the compliance record.
- The audit hash chain only covers entries written after it shipped — older entries are honestly reported as "pre-hardening, unverifiable" by `/api/admin/audit/verify` rather than falsely claimed as always having been chained.
- The admin IP allowlist has no separate recovery path: if you set it to exclude yourself, every admin route (including the one that would let you undo it) 403s immediately — the only way back is editing the stored policy directly in `remotely.db`. This is called out deliberately, not a bug, but worth knowing before trying it live.
- `req.ip` is the raw socket address everywhere (`app.set("trust proxy", ...)` is never called) — correct for a direct deployment, but the admin IP allowlist and rate limiters would all need that set first behind a real reverse proxy.
- `npm audit` in `web/` reports one HIGH finding for `react-router-dom` (GHSA-qwww-vcr4-c8h2, an RSC-mode CSRF bypass). This app is a plain client-side Vite SPA — it never uses React Router's RSC/server-actions mode — so the vulnerable code path isn't reachable here. Left on the latest version (`7.18.1`) rather than downgrading: every older 7.x release back through 6.0.0 is affected by a much larger set of real, applicable CVEs (XSS, open redirect, even an unauth RCE via `turbo-stream` deserialization) that `npm audit` doesn't surface until you actually install one of those versions and re-scan.

## Project layout

- `control-plane/` — Express + `ws`:
  - Core: `index.ts` (routes + all WS upgrade handlers), `store.ts` (users/roles/connections/organizations/audit CRUD), `db.ts` (real SQLite persistence), `state.ts` (live sessions + recording), `rbac.ts` (matching engine + delegated-admin + direct-assignment), `cidr.ts` (IP matching), `guac.ts` (Guacamole protocol), `dbClients.ts` (Postgres/MySQL wrapper), `sshJit.ts` (ephemeral SSH keys)
  - Auth & security: `auth.ts` (JWT + revocation), `oidc.ts` (SSO), `webauthn.ts` (passkeys), `totp.ts` (MFA), `rateLimiter.ts` (rate limiting)
  - Infra discovery & diagrams: `infraDiscovery.ts`, `infraRoutes.ts`, `infraCloudSync.ts` / `infraCloudSyncAzure.ts` / `infraCloudSyncGcp.ts`, `awsSigV4.ts`, `autoDiagram.ts`, `diagramStore.ts`, `infraSnapshots.ts`, `demoSeed.ts`
  - Ops tooling: `monitors.ts`, `alertEmail.ts`, `siemExport.ts`, `pluginSystem.ts`, `webhookDelivery.ts`, `compliance.ts`
- `agent/` — connects out to the control plane, spawns a real PTY per SSH-agent session, sends a 20s heartbeat ping, optionally reports discovered Docker/Podman resources
- `web/` — React + Vite, 30+ pages under `web/src/pages/` (see `App.tsx` for the full route table, `Sidebar.tsx` for access gating), `guac-client.ts` (browser-side Guacamole renderer), `CommandPalette.tsx`, `NotificationBell.tsx`, `components/diagram/` (the draw.io-style editor)
- `docker-compose.yml` — the four passive Docker targets (guacd, rdp-target, ssh-target, db-target) plus a self-hosted Dex instance for OIDC testing
- `start.sh` / `stop.sh` / `demo-reset.sh` — one-command bring-up (including all demo data), teardown, and clean-slate reset
