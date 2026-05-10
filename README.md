# vx-mcp

Installer for the hosted [VX](https://onememory.co) memory MCP server.

VX gives your AI assistant durable memory for:

- user preferences
- project decisions
- recurring workflows
- imported notes or prior chat history

This package is **just an installer**. The MCP server itself is hosted at
`https://api.onememory.co/mcp` and handles OAuth automatically — there is no
API key to manage, and nothing runs locally beyond the wiring step.

## Requirements

- Node.js 18 or newer
- A VX account (you'll be prompted to sign up / sign in via your browser on
  first use; no setup needed up front)

## Quick start

### Claude Code

```bash
npx @vx-nyc/vx-mcp install claude
```

This runs `claude mcp add --transport http vx https://api.onememory.co/mcp`
and installs the bundled `/vx-memory` slash command. On the first VX tool
call, Claude Code will open your browser to sign in.

If the `claude` CLI is not on your PATH, the installer prints the equivalent
command for you to run yourself.

### Cursor

```bash
npx @vx-nyc/vx-mcp install cursor
```

This writes the VX entry to `~/.cursor/mcp.json` as an HTTP MCP server. Cursor
will open your browser to sign in on first use.

Manual equivalent — add this block to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vx": {
      "type": "http",
      "url": "https://api.onememory.co/mcp"
    }
  }
}
```

### Codex

```bash
npx @vx-nyc/vx-mcp install codex
```

This appends a managed block to `~/.codex/config.toml` and installs the
bundled Codex skill. On first use, Codex opens your browser to sign in.

Manual equivalent — add this to `~/.codex/config.toml`:

```toml
[mcp_servers.vx]
url = "https://api.onememory.co/mcp"
transport = "streamable_http"
```

### OpenClaw

```bash
npx @vx-nyc/vx-mcp install openclaw
```

If the `openclaw` CLI is on your PATH this will run
`openclaw plugins install @vx-nyc/vx-mcp` and print the plugin config snippet.
Otherwise it prints the snippet for manual install:

```json
{
  "plugins": {
    "entries": {
      "vx-memory": {
        "enabled": true,
        "config": {
          "apiBaseUrl": "https://api.onememory.co/mcp",
          "source": "openclaw"
        }
      }
    }
  }
}
```

OpenClaw handles the OAuth flow when it first connects to the MCP endpoint.

## Authentication

VX uses standard OAuth 2.1 (RFC 6749) with dynamic client registration
(RFC 7591) and OAuth-protected resource metadata (RFC 9728).

You don't configure any of this. The supported MCP clients handle the entire
flow on their own: they discover `auth.onememory.co`, register themselves
dynamically, open your browser for sign-in / consent, and store the resulting
token in their own keychain.

If you have an existing per-device VX API key from a previous version, it is
**not used** by v1 — clients connect over OAuth-authenticated HTTP instead.

## Uninstall

```bash
npx @vx-nyc/vx-mcp uninstall claude
npx @vx-nyc/vx-mcp uninstall cursor
npx @vx-nyc/vx-mcp uninstall codex
npx @vx-nyc/vx-mcp uninstall openclaw
```

Each command removes the entry added by the corresponding `install`.

## Bundled guidance

This package ships host-specific guidance so the memory workflow feels native:

- Claude Code: `/vx-memory` slash command (installed to `~/.claude/commands/`)
- Codex: `vx-memory` skill (installed to `~/.codex/skills/`)
- OpenClaw: `vx-memory` skill packaged with the plugin

Recommended workflow:

1. Recall first with `vx_recall`.
2. Use `vx_context` when one topic needs broader continuity.
3. Use `vx_contexts_list` to inspect existing contexts and `vx_contexts_create`
   when a new namespace is needed.
4. Store new durable facts with `vx_store` one item at a time inside the right
   context.
5. Use `vx_import_text` or `vx_import_batch` to migrate prior notes or exports.
6. Never store secrets, tokens, private keys, or credentials.

## Tools

The hosted MCP server exposes the same VX tool catalog you had in v0.x:

| Tool | Purpose |
| --- | --- |
| `vx_store` | Store one durable fact, preference, decision, or procedure |
| `vx_recall` | Hybrid recall for focused questions |
| `vx_query` | Semantic search across stored memory |
| `vx_list` | Browse stored memory with optional filters |
| `vx_delete` | Remove a memory by ID |
| `vx_context` | Build a broader context packet for one topic |
| `vx_contexts_list` | List available contexts |
| `vx_contexts_create` | Create a new context |
| `vx_import_text` | Import exports, transcripts, or long notes |
| `vx_import_batch` | Import a curated batch of atomic memories |

…plus the cascade query, entity merge, emergent contexts, skills, and health
tools. See your client's tool list after installation.

## CLI

```bash
vx-mcp install <claude|cursor|codex|openclaw>
vx-mcp uninstall <claude|cursor|codex|openclaw>
vx-mcp clients
vx-mcp --version
vx-mcp --help
```

## Migrating from v0.x

If you used vx-mcp v0.x with `VX_API_KEY` env var:

1. Run `npx @vx-nyc/vx-mcp@1 install <client>` for each client you use.
2. The new install path overwrites the stdio entry with an HTTP entry pointed
   at `https://api.onememory.co/mcp`.
3. Remove any `VX_API_KEY` / `VX_BEARER_TOKEN` references from your shell
   profile — they are no longer used by this package.
4. On first tool call, your client will open your browser. Sign in with the
   same account that owned your v0.x API key and your existing memories will
   be available.

The v0.x stdio binary and all `VX_*` env-var configuration paths were removed
in v1.0.0.

## Development

```bash
npm install
npm run build
npm test
```

This package is published from `main` to GitHub Packages on tag push. See
`CHANGELOG.md` for release notes.

See `CONTRIBUTING.md` for contributor workflow and public-repo safety rules.
