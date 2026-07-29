# Plans

One file per non-trivial feature or initiative, written **before** building
and committed alongside the code that implements it. The point of this
folder is durability: it survives a session running out of context, a new
Claude instance with zero memory, or just time passing — `git log` plus
this folder should be enough for anyone (human or AI) to reconstruct why a
feature looks the way it does, not just what it does.

Not every change needs one — a one-line fix or a small copy edit doesn't.
Use it for anything that took a real design decision: a new subsystem, a
new connection type, a security-relevant change, anything where "why did
we build it this way" will matter later.

## Naming

`YYYY-MM-DD-feature-slug.md` — dated so the chronological order is visible
directly in a file listing, slugged so it's greppable.

## Template

```markdown
# <Feature name>

**Status:** planned | in progress | live | superseded by <link>
**Date:** YYYY-MM-DD

## Context
Why this is being built now — the problem, the ask, what prompted it.

## Design
The approach, key decisions, and why (not just what). Note anything
explicitly rejected or deferred, and why.

## Files touched
The real list, updated as work lands — not a plan-time guess left stale.

## Verification
How it was actually confirmed working (live checks, not just typecheck),
and any caveats/known gaps.
```

Once a feature is genuinely done, its plan doc stays as the historical
record — update **Status** and **Files touched** to reflect reality rather
than deleting it. If a later change supersedes the approach, point forward
with `Superseded by <link>` rather than editing history away.
