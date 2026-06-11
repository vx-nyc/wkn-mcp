# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.7] - 2026-06-11

### Fixed

- `vx-mcp login hermes` now treats Hermes' printed OAuth failures and login
  timeouts as command failures, even when Hermes exits with status `0`.

## [1.0.6] - 2026-06-11

### Added

- `vx-mcp login hermes` now runs a host-side Docker OAuth helper so Hermes
  Docker can receive browser callbacks on `127.0.0.1:8989`.

### Fixed

- Hermes MCP installs now pin `oauth.redirect_port: 8989`, making OAuth
  callback URLs stable and usable from the host browser.
- `doctor` now points Docker-based Hermes users at the VX MCP login helper
  instead of suggesting an in-container login flow whose localhost callback is
  not reachable from the host browser.

## [1.0.5] - 2026-06-11

### Fixed

- `doctor` now reports Hermes OAuth dynamic client registration compatibility
  errors explicitly instead of mistaking the `Auth: OAuth 2.1 PKCE` test output
  for a generic pending-approval state.
- Hermes Docker MCP tests now wait long enough to capture OAuth registration
  validation failures before summarizing readiness.

## [1.0.4] - 2026-06-11

### Fixed

- Hermes MCP installs now mark VX as an OAuth MCP server, allowing
  `hermes mcp login vx` to start the browser authorization flow instead of
  treating the server as unauthenticated.

## [1.0.3] - 2026-06-11

### Fixed

- OpenClaw readiness now reports OAuth-required setup as a manual authorization
  step instead of a generic probe failure.
- OpenClaw install can configure hosted OAuth MCP via `npx openclaw` when an
  existing OpenClaw profile/config is present, while `install all` still falls
  back to manual instructions on machines without OpenClaw configured.

## [1.0.2] - 2026-06-09

### Changed

- Agent setup guidance now includes `vx_librarian_seed` as the normal MCP tool
  path for initializing Librarian reality as VX memories, instead of copying
  policy into local prompts.
- OpenClaw installs and readiness checks include `vx_librarian_seed` in the
  core VX tool filter.

## [1.0.1] - 2026-06-06

### Added

- `install all` to wire every supported local MCP client in one command.
- ChatGPT setup guidance for connecting the hosted VX MCP endpoint through
  ChatGPT Apps / developer mode.

### Changed

- Claude Code installs now use user scope so the VX MCP server is available
  across projects and visible in `claude mcp list`.
- `doctor` now inspects the Hermes executable format when startup fails, so a
  Linux/ELF Hermes binary on macOS is reported as a concrete runtime
  incompatibility instead of only surfacing `ENOEXEC`.
- Agent setup guidance now starts with `vx_librarian_context` and `vx_reality`
  so connected agents load purpose, policy, and reality from VX memory instead
  of copied local prompts.

## [1.0.0] - 2026-05-10

### BREAKING

- **Removed the stdio MCP server.** v1 is HTTP-transport only. The package
  no longer ships an MCP runtime; it is purely an installer that wires up
  Claude Code / Cursor / Codex / OpenClaw to the hosted endpoint at
  `https://api.onememory.co/mcp`.
- **Removed static API key authentication.** `VX_API_KEY` and
  `VX_BEARER_TOKEN` env vars are no longer read by this package. Clients
  authenticate via OAuth 2.1 (RFC 6749 + RFC 7591 dynamic client registration
  + RFC 9728 protected resource metadata) on first use; the OAuth flow is
  handled by your MCP client, not by this package.
- **Removed the `mcp` runtime command.** The `vx-mcp` binary now exposes
  only `install`, `uninstall`, `clients`, `--version`, and `--help`.
- **Removed subpath exports `./client` and `./types`.** They were thin
  wrappers around the now-removed local SDK. Pin v0.5.x if you need them,
  or call the public REST API directly.
- **Removed the `@modelcontextprotocol/sdk` runtime dependency.** The
  installer is pure Node stdlib + your client's CLI.

### Migration

After upgrading, re-run `npx @vx-nyc/vx-mcp install <claude|cursor|codex|openclaw>`
for every client. The installer overwrites your existing stdio entry with an
HTTP entry. Remove any `VX_API_KEY` / `VX_BEARER_TOKEN` references from your
shell profile. On the first VX tool call your client will open your browser
to sign in — use the account that owned your v0.x key and your memories will
be available.

### Added

- HTTP installer paths for Claude Code (`claude mcp add --transport http`),
  Cursor (`~/.cursor/mcp.json`), Codex (`~/.codex/config.toml`), and OpenClaw
  plugin config.
- `uninstall <client>` for every supported target.
- Idempotency: re-running `install` does not duplicate entries.

## [0.5.8] - 2026-03-23

### Changed
- Production rollout tag aligned to the current stable mainline release.
- No functional delta versus the stabilized mainline code; this version exists to promote the current server-backed import, device-key, and plugin-first client support to a new production tag.

## [0.5.6] - 2026-03-23

### Added
- Public-repo guardrails with `AGENTS.md` and a pull request template checklist.
- Counterparty continuity coverage and source-default validation for the MCP server and SDK.
- Public `./client` and `./types` exports so the package can be used programmatically without depending on a separate SDK package.
- Contributing guidance and a basic usage example adapted to the current MCP package.

### Changed
- The published MCP package is now self-contained and no longer depends on a separate SDK package at runtime.
- Counterparty-aware source defaults now flow through the SDK, MCP runtime, and e2e coverage.
- Tag-based publishing now skips the version rewrite when the tagged commit is already versioned correctly.

## [0.5.3] - 2026-03-20

### Changed
- Merged the plugin-first VX MCP refresh into `main` and released from the mainline branch.

## [0.5.2] - 2026-03-20

### Changed
- Release metadata cleanup.

## [0.5.1] - 2026-03-20

### Changed
- Updated Claude plugin marketplace copy from "Persistent VX memory" to "VX Universal memory".

## [0.5.0] - 2026-03-20

### Added
- Plugin-first install flows for Claude Code, Codex, and OpenClaw.
- MCP prompt support with `vx_memory_workflow` and `vx_memory_import`.
- Native OpenClaw plugin tools plus `vx_status` for setup verification.
- Knowledge-context tools: `vx_contexts_list` and `vx_contexts_create`.
- Bundled Claude, Codex, and OpenClaw skill guidance aligned to the same public VX workflow.
- Release-readiness coverage for installers, prompts, OpenClaw config/runtime, README consistency, and runtime config normalization.

### Changed
- Claude and Codex adapters now register the packaged server as `npx -y vx-mcp-server@latest mcp`.
- Host source tags are now specific to the integration, including `claude-code`, `claude-desktop`, `codex`, and `openclaw`.
- `VX_API_BASE_URL` is now the canonical config output for new installs and docs, while `VX_API_URL` remains a backward-compatible runtime fallback.
- Shared VX tool execution now flows through one runtime path used by both MCP and OpenClaw integrations.
- README rewritten around user-oriented install steps and continuity benefits instead of internal implementation detail.

## [0.1.0] - 2026-02-15

### Added
- Initial release
- `vx_store` - Store memories with content, context, type, and importance
- `vx_query` - Semantic search across memories
- `vx_list` - List memories with filters and pagination
- `vx_delete` - Delete memories by ID
- `vx_context` - Get context packets for conversations
- Support for Claude Desktop, Cursor, VS Code + Continue, Windsurf
- Full MCP protocol compliance via @modelcontextprotocol/sdk
