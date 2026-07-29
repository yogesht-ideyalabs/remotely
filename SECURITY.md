# Security Policy

Remotely is a proof-of-concept remote-access control plane — it brokers real
SSH, RDP, database, and Kubernetes sessions, so security issues here have
real consequences for anyone self-hosting it. Please report responsibly.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **yogeshinit@gmail.com** with:
- A description of the issue and its impact.
- Steps to reproduce (a minimal repro is very helpful).
- Any relevant logs, requests, or screenshots.

We'll acknowledge your report within a few days and keep you updated as we
investigate and fix it. Once a fix is released, we're happy to credit you
in the changelog if you'd like.

## Supported versions

This project does not yet have tagged releases with a formal support
window — security fixes land on the default branch. Track the repository
or watch releases once they exist.

## Before you self-host this

This started as (and largely remains) a proof of concept. Before running
it anywhere reachable beyond your own machine:

- **Set real values** for `JWT_SECRET`, `AGENT_JOIN_TOKEN`, and
  `SSH_JIT_INTERNAL_TOKEN` — the fallback defaults are publicly known
  (they're in this repository's source) and must never be used outside
  local development. The server logs a warning at startup if any of these
  are left unset; don't ignore it.
- **Change or disable the seeded demo accounts** (`admin`/`admin123` and
  friends) before exposing the control plane to anyone else.
- Put a real TLS-terminating reverse proxy in front of the control plane —
  it does not terminate TLS itself.
- Review [`README.md`](README.md)'s "Scope, honestly" section for what's
  genuinely production-hardened versus still POC-grade.
