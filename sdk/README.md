# @remotely/sdk

TypeScript/JavaScript client for the Remotely control-plane REST API. Environment-agnostic — works from Node scripts, CI jobs, or a browser.

## Install

This package isn't published to npm; use it as a local workspace dependency or `npm link` from within this monorepo:

```bash
cd sdk && npm install && npm run build
```

## Usage

```ts
import { RemotelyClient } from "@remotely/sdk";

const client = new RemotelyClient({ baseUrl: "http://localhost:4000" });

const result = await client.login("admin", "admin123");
if ("mfaRequired" in result) {
  const session = await client.verifyLoginMfa(result.mfaToken, "123456");
}

const resources = await client.listResources();
const req = await client.createAccessRequest("client-a-bastion-01", "demo", "need to check a log");
```

If you already have a session token (e.g. from a previous run), skip `login()`:

```ts
const client = new RemotelyClient({ baseUrl: "http://localhost:4000", token: savedToken });
```

## Scope

Wraps the REST surface: auth, resources, users, roles, connections, organizations, access requests, audit log. Anything not explicitly wrapped is reachable via the generic escape hatch:

```ts
await client.request("GET", "/api/admin/dashboard");
```

**Not covered**: the WebSocket session protocols (interactive SSH/RDP/database sessions, live co-watching) — those are a stateful, binary-framed protocol, not a fit for a request/response client. See the `ssh` command in `cli/src/index.ts` in this repo for a real reference implementation of that side.
