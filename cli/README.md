# remotely-cli

A minimal CLI for the Remotely control plane — speaks the same REST + WebSocket
protocol the web app uses, no server-side changes needed.

```
npm install
npx tsx src/index.ts login <username> [--url http://control-plane:4000]
npx tsx src/index.ts whoami
npx tsx src/index.ts resources
npx tsx src/index.ts ssh <resourceId> [--login <user>]
npx tsx src/index.ts logout
```

Session (bearer token) is stored at `~/.remotely-cli/session.json` — plain
JSON, not a system keychain. Fine for a POC, not for anything real.

Only SSH sessions (`ssh-agent` and `ssh-direct` resource types) are
supported so far — RDP/database need a real client (canvas rendering /
SQL console) that doesn't make sense as a terminal passthrough.
