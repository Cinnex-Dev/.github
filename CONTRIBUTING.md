# Contributing to Cinnex-Dev projects

## Comment and issue voice

All issue bodies, PR bodies, and review comments use **plain English** aimed at a non-technical reader. Think of it as writing a complaint card to a store manager, not a stack trace for an engineer.

### Attribution line (required)

The **first line** of every issue, PR body, or comment must be one of:

```
Claude Code - YY-MM-DD
CW - YY-MM-DD
```

Use `Claude Code` when the content was drafted by Claude Code. Use `CW` when drafted by Chuck Wong. No other attribution formats.

### Plain English zone (everything before `## Implementation`)

- No React / Next.js / CSS property names
- No file paths, commit hashes, or API route names
- No layout jargon ("flex", "grid", "z-index")
- Write as if explaining to someone who uses the app but doesn't build it

### Technical zone (`## Implementation` heading and below)

All technical details — file paths, commit hashes, CSS classes, API endpoints, stack traces — go **only** under a `## Implementation` heading at the bottom of the body. If you need to reference code anywhere in a comment, add this heading.

### Lint script

Each repo that has a `scripts/lint-gh-comment.mjs` file enforces these rules automatically. Copy it from `cn-square-vip-program` when setting up a new repo. Run it before posting:

```bash
npm run lint:comment -- /tmp/gh-body.md
```

The script must exit 0 before any `gh issue create`, `gh issue comment`, `gh pr create`, or `gh pr comment` call.

## Issue templates

Blank issues are disabled org-wide. Use one of the three templates:

| Template | When to use |
|---|---|
| **Bug report** | Something is broken and a user is affected |
| **Feature request** | A new user-facing capability is needed |
| **Chore / Infra** | Tooling, config, dependency, or refactor work |

## PR template

All PRs use the shared PR template (`.github/pull_request_template.md`). The `Fixes #N` line in the PR body auto-closes the linked issue when the PR is merged to `main`.
