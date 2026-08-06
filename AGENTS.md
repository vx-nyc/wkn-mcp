# AGENTS.md - AI Agent Instructions for vx-mcp

Instructions for AI agents working on `@vx-nyc/vx-mcp`, the v1 installer.

## What this package is (and isn't)

As of v1.0.0, this package is **only an installer**. It writes config so
Claude Code, Cursor, Codex, OpenClaw, Hermes, Claude Desktop, Windsurf, Cline,
Zed, and VS Code (+ GitHub Copilot Chat) connect to the hosted VX MCP server
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

**Exception, not a loophole:** Claude Desktop's config format only
understands local stdio servers — it has no config-file-based remote
HTTP/OAuth transport. The Claude Desktop installer therefore writes an entry
that runs the third-party `mcp-remote` bridge via `npx`, which itself speaks
Streamable HTTP + OAuth to the hosted VX endpoint. This is *configuring
Claude Desktop*, not this package shipping a runtime — vx-mcp still never
runs a server process, stores a credential, or reads a `VX_*` env var. Do not
"fix" this by inventing a static-token/stdio path for vx-mcp itself.

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
  installer.ts     # install/uninstall/detect for every supported client
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

1. Research the client's actual config file path per OS from its own docs —
   never guess. If you can't confirm a path, leave that platform out rather
   than shipping a wrong one (see `claudeDesktopConfigPath` returning `null`
   on Linux for the pattern).
2. Add the client tag to `SupportedClientTarget` / `SUPPORTED_CLIENT_TARGETS`
   / `CLIENT_LABELS` in `src/installer.ts`.
3. If the client stores MCP servers as a named map under one JSON key
   (most do), add a spec to the `JsonMcpClientSpec` table and thin
   `installX`/`uninstallX` wrappers around `installJsonMcpClient` /
   `uninstallJsonMcpClient` — don't hand-roll the merge/remove logic per
   client. Otherwise (TOML, YAML, a CLI-driven client) follow the
   Codex/Hermes/OpenClaw pattern instead.
4. Every installX/uninstallX must accept `(deps, options: InstallOptions)`,
   be idempotent, merge rather than overwrite existing file content, support
   `options.dryRun` (route file writes through `writeOrPreview`), and point
   at the URL from `installUrl(options)` — not `VX_MCP_URL` directly — so
   `connect --compartment <name>` scopes this client the same as every other
   one. If any code path compares a stored URL back to `VX_MCP_URL` (for
   readiness or status), use `isVxMcpUrl()`/prefix-tolerant matching instead
   of strict equality, since a compartment-scoped URL has a `?compartment=`
   suffix.
5. Add a case to `getClientReadiness()` (reuse `jsonMcpClientReadiness` for
   JSON-map clients) and to `detectClient()` so `doctor`/`detect` both cover
   it.
6. Wire it into `runInstall()` / `runUninstall()`.
7. Add tests in `test/installer.test.ts`: upsert/remove merge safety,
   install/uninstall round-trip, dry-run no-op, and any unusual failure mode
   (e.g. Zed's JSONC comments must not be corrupted).
8. Update README with a section in the Quick Start and in the CLI/uninstall
   command lists.

## Publishing

`@vx-nyc/vx-mcp` is published to **GitHub Packages** (`https://npm.pkg.github.com`),
not npmjs.org. Do not add npm registry tokens or npmjs publish steps.

Release flow:

1. Merge changes to `main`.
2. Run `manual-package-release.yml` with a new `vX.Y.Z` tag.
3. `publish.yml` builds, publishes to GitHub Packages with `GITHUB_TOKEN`, and
   creates the GitHub Release.

Local install for testing a published version:

```bash
npm config set @vx-nyc:registry https://npm.pkg.github.com
export NODE_AUTH_TOKEN=$(gh auth token)
npx @vx-nyc/vx-mcp doctor
```

Do NOT add a new env var or a way to override the URL for normal use. The
URL is canonical; if a different endpoint is needed for a test, parameterize
inside the function but keep the public CLI surface URL-free.
