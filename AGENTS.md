# AGENTS.md - AI Agent Instructions for vx-mcp

Instructions for AI agents working on `@vx-nyc/vx-mcp`, the v1 installer.

## What this package is (and isn't)

As of v1.0.0, this package is **only an installer**. It writes config so
Claude Code, Cursor, Codex, OpenClaw, and Hermes connect to the hosted VX MCP server
at `https://api.onememory.co/mcp` over HTTP, with OAuth handled by the
client. It does not:

- ship an MCP runtime
- read or accept any `VX_*` env vars
- handle authentication itself
- talk to the VX REST API
- depend on `@modelcontextprotocol/sdk`

If a change introduces any of the above, it does not belong in v1. Adding
stdio fallback, env-var auth, or a local server would re-introduce the
maintenance and security problems v1 was created to remove.

## Public repo guardrails

This repository is public. Treat it as public at all times.

- Never mention private repositories, local private paths, or internal
  workspace structure.
- Never document or reference internal infrastructure, deployment details,
  environments, or operational topology.
- Never describe proprietary architecture, internal retrieval approaches, or
  implementation details that are not already intentionally public.
- Never include notes in commits, PR bodies, code comments, tests, or docs
  that mention patches made in a separate private repository.
- Keep guidance generic: refer to "the hosted VX MCP endpoint" or
  documented public URLs, never to how it is run.

## Documentation rules

- Document only the public installer surface and the public MCP endpoint.
- If a detail is not needed by an external user of this package, leave it
  out.
- When in doubt, prefer less detail and describe the user-facing outcome
  instead of internals.

## PR rules

- PR titles, descriptions, commit messages, and inline code comments must be
  safe to publish verbatim.
- Before opening or updating a PR, scan the diff for private repo names,
  local absolute paths, infrastructure references, and internal architecture
  language.
- If a change depends on private backend work, describe only the public
  behavior required by this repo.

## Layout

```
src/
  index.ts         # CLI entry, dispatches to handleCli()
  installer.ts     # install/uninstall for claude, cursor, codex, openclaw, hermes
  constants.ts     # canonical URL + package name + server name
test/
  installer.test.ts
skills/
  claude/vx-memory/vx-memory.md        # Claude Code slash command body
  codex/vx-memory/SKILL.md             # Codex skill body
  hermes/vx-memory/SKILL.md            # Hermes Agent skill body
  openclaw/vx-memory/                  # OpenClaw skill bundle
.claude-plugin/
  plugin.json       # Claude Code marketplace plugin
  marketplace.json  # Claude Code marketplace manifest
openclaw.plugin.json
```

## Adding a new client

1. Add the client tag to `SUPPORTED_CLIENT_TARGETS` in `src/installer.ts`.
2. Implement `installX(deps)` and `uninstallX(deps)`. Both must be
   idempotent. Both must point at `VX_MCP_URL` from `constants.ts`.
3. Wire it into `runInstall()` / `runUninstall()`.
4. Add tests in `test/installer.test.ts`.
5. Update README with a section in the Quick Start.

Do NOT add a new env var or a way to override the URL for normal use. The
URL is canonical; if a different endpoint is needed for a test, parameterize
inside the function but keep the public CLI surface URL-free.
