# Remotely — POC

A working proof of concept of the core architecture behind "Remotely" (the
127-feature spec): browser-based access to SSH, RDP, and databases; full
RBAC (allow/deny labels, resource-type scoping, login allowlists, session
TTL, source-IP CIDR); user/role/connection/organization administration with
full edit everywhere and delegated (tenant) admin; direct per-user and
per-folder connection assignment (bypasses RBAC labels entirely — a plain
"share this with them"); connections and roles organized into folders and
categories; a notification center; theming; session recording; and an
audit log. This is **not** the 127-feature product — see
[Scope, honestly](#scope-honestly) for exactly what's real and what's cut.

## Architecture

```
 [Client A network]              [Client B network]
   agent (client-a-web-01)          agent (client-b-web-01)
   labels: client=acme-corp         labels: client=globex-inc
        │  dials OUT (ws)                │  dials OUT (ws)
        └──────────────┐   ┌─────────────┘
                        ▼   ▼
                  control-plane (Express + ws)
                  - JWT login, full RBAC engine (rbac.ts)
                  - users/roles/connections admin CRUD (store.ts)
                  - delegated/tenant admin (manageLabels)
                  - multiplexes ssh-agent traffic to the
                    right agent's outbound connection
                  - dials ssh-direct connections itself (ssh2)
                  - dials database connections itself (pg)
                  - relays RDP sessions through guacd (guac.ts)
                  - tees SSH output to a recording file
                  - appends every event to an audit log
                        ▲            ▲            ▲
      browser WS, JWT   │            │ TCP (ssh2) │ TCP (pg)
                        │      ┌─────┴─────┐  ┌────┴─────┐
                  web (React)  │   guacd   │  │ db-target │
                  - login, resource browser │  │ (Postgres)│
                    (folders + search),     │  └──────────┘
                    xterm.js SSH terminal,  ▼
                    canvas RDP console,  rdp-target (xrdp)
                    SQL console, audit,
                    recordings, notification
                    bell, user/role/connection
                    admin, theme switcher
```

Two SSH architectures coexist on purpose, matching the trade-off discussed
earlier in this project: **ssh-agent** resources dial *out* to the control
plane (zero inbound ports on the client network — the Teleport model);
**ssh-direct** resources are dialed *by* the control plane using stored
host+credentials (no agent to deploy — the Devolutions/jump-host model).
Same for RDP (via guacd) and Database (via `pg`) — all three of these are
control-plane-dialed, all show up as ordinary "Connections" you add through
the UI.

## Run it

```bash
cd /Users/yogesht/Projects/building-with-kiro/remotely-poc
docker start guacd rdp-target ssh-target db-target   # see "Docker targets" below if not created yet
./start.sh
```

Open **http://localhost:5173**:

| User | Password | What they see |
|---|---|---|
| `admin` | `admin123` | Full admin — every resource, every type, every login, Users/Roles/Connections/Organizations/Audit/Recordings |
| `acme-admin` | `acmeadmin123` | **Delegated (tenant) admin** — manages only acme-corp's users + connections; can't see Roles/Recordings/Organizations, can't grant admin roles, can't touch other tenants |
| `alice` | `alice123` | Plain user — scoped to acme-corp **SSH-agent** resources only (excludes RDP/database/ssh-direct even though the label matches, via `resourceTypes`) |
| `bob` | `bob1234567` | Plain user with **zero roles** — access comes entirely from direct connection/folder assignment (see below); demonstrates that path independent of RBAC labels |

```bash
./stop.sh   # kill the four Node processes (control plane, 2 agents, web)
```

## What's real

| Feature | Real, not mocked |
|---|---|
| Browser SSH (reverse-tunnel agent) | Yes — real `node-pty`, real shell |
| Browser SSH (direct-dial, no agent) | Yes — real `ssh2` connection to a real container, add-and-go from the UI |
| Browser RDP viewer | Rendering **confirmed** (real `guacd` + real `xrdp` desktop, screenshotted); input (mouse/key) sends correctly per protocol but **isn't confirmed to reach the session** — see the caveat further down |
| Browser database console | Yes — real `pg` connection, real SQL execution, real result sets, every query text audited |
| **Add Connection** UI | Yes — create ssh-direct/rdp/database connections with host+credentials+labels+folder, connectable immediately |
| **Full edit everywhere** | Yes — users (organization + password reset), connections (all fields), roles (all fields) all have real edit forms, not just create/delete |
| Folders (connections) + categories (roles) | Yes — both admin pages group by folder/category, same pattern as the end-user Resources page |
| **Direct per-user / per-folder assignment** | Yes — a connection or an entire folder can be shared directly with specific users, bypassing RBAC label matching entirely; verified with a zero-role user (`bob`) who gets access purely from this path |
| **Organizations** (org-level setup) | Yes — a real entity (not a free-typed string): `/api/admin/organizations` CRUD, a dedicated admin page, and User/Connection forms now pick from a dropdown instead of typing a tenant string |
| Global search | Yes — client-side search across name/folder/labels/type on Resources |
| Notification center | Yes — bell shows recent denials/expirations/admin actions, scoped to you (or everything, if full admin) |
| Full RBAC engine | Yes — allow/deny labels, resource-type scoping, login allowlist, session TTL auto-disconnect, source-IP CIDR, time-bound roles, multiple roles per user, direct assignment — all scripted-tested, not just eyeballed |
| **Delegated/tenant admin** | Yes — a role's `manageLabels` grants admin-lite access (CRUD users + connections) scoped to a label pattern, without the full `admin` role; verified it can't escalate, can't cross tenants, can't touch roles or organizations |
| User/role/connection/organization administration | Yes — full CRUD via REST + real UI, not just seed data |
| Theming | Yes — dark/light + 4 accents, persisted, live-switchable |
| SSH session recording + replay | Yes — byte + timestamp captured, replayed via xterm.js (RDP/database sessions aren't recorded this way — see Scope) |
| Structured, append-only audit log | Yes — JSONL, every login/deny/session/admin-action/query/assignment/file-transfer event |
| **RDP clipboard control per-role** | Connection-level verified (guacd accepts `disable-copy`/`disable-paste` params without error); actual copy/paste behavior inherits the same unverifiable-interactivity caveat as RDP input generally |
| **Bulk actions** | Yes — multi-select + bulk delete/role-change on Users, bulk delete/assign/move-folder on Connections |
| **Command palette (Cmd/Ctrl+K)** | Yes — fuzzy search across resources + admin pages, keyboard nav, confirmed via scripted open→filter→navigate test |
| **Agent Health dashboard** | Yes — agents send a 20s heartbeat; page shows live uptime/last-seen/latency/active-sessions, auto-refreshes, verified with real sub-10ms latency data |
| **File transfer (SFTP)** | Yes, for `ssh-direct` connections — real directory listing/upload/download against a real container, byte-for-byte round-trip verified. Not built for `ssh-agent` resources (would need a new file-op protocol relayed through the agent's tunnel) |

### RBAC — what was actually tested

Each of these was verified with a scripted WS/API test, not just eyeballed: deny-label overriding a wildcard allow; resource-type scoping (an SSH-only role correctly can't see the RDP/database resources even with a matching label); login allowlist denial; session TTL auto-kill; source-IP CIDR denial; a zero-role user gaining access purely through direct connection assignment, then through a folder-level bulk assignment; and for delegated admin specifically — cannot view Roles or Organizations (403), cannot grant the `admin` role or another delegated-admin role (blocked), cannot create/move a user into a tenant outside their scope (blocked), can freely manage their own tenant's users and connections.

## RDP caveat (unchanged from before, still true)

Reuses **Apache Guacamole's `guacd`** rather than reimplementing RDP.
Rendering is confirmed with real screenshots of a live remote desktop.
Mouse/keyboard input is sent in the correct Guacamole wire format
(verified at the raw protocol level) but had no observed effect on the
test `xrdp` container — most likely an X11-input quirk in that specific
community Docker image, not proven either way. Try a different RDP target
before investing more time here.

## Docker targets (create once)

```bash
docker network create remotely-net

# guacd — the Guacamole protocol daemon RDP sessions relay through
docker run -d --name guacd --network remotely-net -p 4822:4822 guacamole/guacd:1.5.5

# rdp-target — a real Linux desktop reachable over RDP (dialed by guacd, inside the network)
docker run -d --name rdp-target --network remotely-net -p 3389:3389 danielguerra/ubuntu-xrdp
docker exec rdp-target bash -c "echo 'ubuntu:demo1234' | chpasswd"

# ssh-target — a real SSH server (dialed directly by the control plane, hence localhost port)
docker run -d --name ssh-target --network remotely-net -p 2222:2222 \
  -e PASSWORD_ACCESS=true -e USER_NAME=demo -e USER_PASSWORD=demo1234 -e SUDO_ACCESS=true \
  linuxserver/openssh-server

# db-target — a real Postgres (dialed directly by the control plane)
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
agent-vs-central-relay distinction from the earlier architecture
conversation, showing up in miniature.

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

- **Real auth** — password + JWT, no SSO/SAML/OIDC, no MFA/WebAuthn, no short-lived certs/mTLS. Still the single biggest gap vs. a real deployment.
- **Custom dashboards, per-tenant billing metrics, SLA monitoring, white-label branding** — reporting/cosmetic layers on top of data that already exists (audit log, connections), not built this round.
- **JIT access requests, approval workflows, break-glass**
- **AI features** (anomaly detection, risk scoring, summarization) — entire category, untouched.
- **Compliance tooling, SIEM export, Terraform/SDK/plugin ecosystem**
- **Agent auto-update, health dashboard, IAM-based joining** — agents use a single shared static token.
- **RDP/database session recording** — only SSH sessions get byte-for-byte replay; database gets per-query audit text instead (arguably the more useful record for a DB anyway), RDP gets neither.
- **True OS-user impersonation** — `login`/`username` is RBAC-*enforced* (a role can be denied a specific login) but an ssh-agent session still runs as whichever OS user the agent process itself runs as.
- **Packaged/installable agent binary** — still a dev script, see above.

## Known rough edges

- `node-pty`'s prebuilt `spawn-helper` binary isn't executable by default until you `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` in `agent/` after a fresh install.
- `AGENT_JOIN_TOKEN`, `JWT_SECRET`, and every Docker target's password are hardcoded dev defaults.
- No persistence beyond the JSONL audit log and SSH recordings — restarting the control plane resets users/roles/connections back to the seed data in `control-plane/src/store.ts`.
- `guacd`/`rdp-target`/`ssh-target`/`db-target` are Docker containers, not part of `start.sh`/`stop.sh` — `docker start`/`stop` them separately.
- Delegated-admin scoping on `/api/audit` filters by tenant/connection ownership; the notification bell uses a simpler "your own events only" rule for non-full-admins — intentionally less precise, it's a glanceable feed, not the compliance record.
- File downloads authenticate via a `?token=` query param (the session JWT lands in server logs / browser history) since `<a href>` navigation can't set an Authorization header — fine for a POC, would want a short-lived signed URL for anything real.

## Project layout

- `control-plane/` — Express + `ws`: `index.ts` (routes + WS handlers for ssh-agent/ssh-direct/rdp/database), `store.ts` (users/roles/connections/organizations/audit), `rbac.ts` (matching engine + delegated-admin + direct-assignment helpers), `state.ts` (live agents + sessions), `guac.ts` (Guacamole protocol handshake), `cidr.ts` (IP matching)
- `agent/` — connects out to the control plane, spawns a real PTY per SSH-agent session, sends a 20s heartbeat ping
- `web/` — React + Vite: `pages/` (Login, Resources, Terminal, RdpConsole, Database, Files, Audit, Recordings, Replay, Users, Roles, Connections, Organizations, AgentHealth), `guac-client.ts` (browser-side Guacamole renderer), `theme.tsx`, `NotificationBell.tsx`, `CommandPalette.tsx`
- `start.sh` / `stop.sh` — run/kill the control plane, both SSH agents, and the web dev server
