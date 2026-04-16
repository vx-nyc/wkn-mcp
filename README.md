# vx-mcp-server

Plugin-first VX memory for Claude, Codex, Cursor, OpenClaw, and other MCP clients.

VX gives your assistant durable memory for:

- user preferences
- project decisions
- setup choices
- recurring workflows
- imported notes or prior chat history

Users get more continuity across sessions and spend less time repeating themselves.

## Requirements

- Node.js 18 or newer
- A VX API base URL, usually `https://api.vx.dev/v1`
- One VX credential: `VX_API_KEY` or `VX_BEARER_TOKEN`

## Quick Start

### Claude Code

Default path:

```bash
npx vx-mcp-server install claude
```

This installs:

- the packaged VX MCP server in Claude Code
- a bundled `/vx-memory` slash command with the recommended recall/store/import workflow

Secondary path: Claude Code plugin marketplace

```text
/plugin marketplace add vx-nyc/vx-mcp
/plugin install vx-mcp
```

Fallback: Claude Desktop MCP config

```json
{
  "mcpServers": {
    "vx": {
      "command": "npx",
      "args": ["-y", "vx-mcp-server@latest", "mcp"],
      "env": {
        "VX_API_BASE_URL": "https://api.vx.dev/v1",
        "VX_API_KEY": "your-api-key",
        "VX_NAME": "VX",
        "VX_SOURCE": "claude-desktop"
      }
    }
  }
}
```

### Codex

Default path:

```bash
npx vx-mcp-server install codex
```

This installs:

- the packaged VX MCP server in `~/.codex/config.toml`
- a bundled Codex skill at `~/.codex/skills/vx-memory/SKILL.md`

Direct CLI fallback:

```bash
codex mcp add vx -- npx -y vx-mcp-server@latest mcp
```

Manual `~/.codex/config.toml` fallback:

```toml
[mcp_servers.vx]
command = "npx"
args = ["-y", "vx-mcp-server@latest", "mcp"]

[mcp_servers.vx.env]
VX_API_BASE_URL = "https://api.vx.dev/v1"
VX_API_KEY = "your-api-key"
VX_NAME = "VX"
VX_SOURCE = "codex"
```

### Cursor

One-click install:

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-111111?style=for-the-badge)](cursor://anysphere.cursor-deeplink/mcp/install?name=vx&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInZ4LW1jcC1zZXJ2ZXJAbGF0ZXN0IiwibWNwIl0sImVudiI6eyJWWF9BUElfQkFTRV9VUkwiOiJodHRwczovL2FwaS52eC5kZXYvdjEiLCJWWF9BUElfS0VZIjoieW91ci1hcGkta2V5IiwiVlhfTkFNRSI6IlZYIiwiVlhfU09VUkNFIjoiY3Vyc29yIn19)

After adding it, set your VX credential in Cursor before first use.

Manual `.cursor/mcp.json` fallback:

```json
{
  "mcpServers": {
    "vx": {
      "command": "npx",
      "args": ["-y", "vx-mcp-server@latest", "mcp"],
      "env": {
        "VX_API_BASE_URL": "https://api.vx.dev/v1",
        "VX_API_KEY": "your-api-key",
        "VX_NAME": "VX",
        "VX_SOURCE": "cursor"
      }
    }
  }
}
```

### OpenClaw

Install the native plugin:

```bash
openclaw plugins install vx-mcp-server
openclaw gateway restart
```

Add plugin config once:

```json5
{
  plugins: {
    entries: {
      "vx-memory": {
        enabled: true,
        config: {
          apiBaseUrl: "https://api.vx.dev/v1",
          apiKey: "your-api-key",
          source: "openclaw",
          name: "VX",
          storeOnRequestOnly: false,
          maxTokens: 4000
        }
      }
    }
  }
}
```

Verify setup:

1. Ask OpenClaw to run `vx_status`.
2. Store one small preference with `vx_store`.
3. Recall it with `vx_recall` or `vx_context`.

Compared with regular OpenClaw, VX adds durable recall of preferences, decisions, imported history, and recurring workflows across sessions.

### NemoClaw

If your NemoClaw deployment supports OpenClaw plugins, use the same install and config flow as OpenClaw.

If it exposes MCP configuration instead, use the standard MCP config shown below with `VX_SOURCE` set to `openclaw` or `nemoclaw`.

## Standard MCP Config

Use this in any MCP client that accepts a local command:

```json
{
  "mcpServers": {
    "vx": {
      "command": "npx",
      "args": ["-y", "vx-mcp-server@latest", "mcp"],
      "env": {
        "VX_API_BASE_URL": "https://api.vx.dev/v1",
        "VX_API_KEY": "your-api-key",
        "VX_NAME": "VX",
        "VX_SOURCE": "mcp"
      }
    }
  }
}
```

## Bundled Guidance

This package ships host-specific guidance so the memory workflow feels native instead of generic:

- Claude Code: bundled `/vx-memory` slash command
- Codex: bundled `vx-memory` skill
- OpenClaw: bundled `vx-memory` skill plus native `vx_status`
- MCP prompts: `vx_memory_workflow` and `vx_memory_import`

Recommended workflow in every host:

1. Recall first with `vx_recall`.
2. Use `vx_context` when one topic needs broader continuity.
3. Use `vx_contexts_list` to inspect existing knowledge contexts and `vx_contexts_create` when a new namespace is needed.
4. Store new durable facts with `vx_store` one item at a time inside the right knowledge context.
5. Use `vx_import_text` or `vx_import_batch` to migrate prior notes or exports.
6. Never store secrets, tokens, private keys, or credentials.

## Tools

| Tool | Purpose |
| --- | --- |
| `vx_store` | Store one durable fact, preference, decision, or procedure |
| `vx_recall` | Hybrid recall for focused questions |
| `vx_query` | Semantic search across stored memory |
| `vx_list` | Browse stored memory with optional filters |
| `vx_delete` | Remove a memory by ID |
| `vx_context` | Build a broader context packet for one topic |
| `vx_contexts_list` | List available knowledge contexts |
| `vx_contexts_create` | Create a new knowledge context |
| `vx_import_text` | Import exports, transcripts, or long notes |
| `vx_import_batch` | Import a curated batch of atomic memories |

OpenClaw also exposes:

- `vx_status` to verify plugin readiness

## Environment Variables

| Variable | Description |
| --- | --- |
| `VX_API_BASE_URL` | Canonical VX API base URL including `/v1` |
| `VX_API_URL` | Backward-compatible fallback without `/v1`; prefer `VX_API_BASE_URL` for new setups |
| `VX_API_KEY` | VX API key |
| `VX_BEARER_TOKEN` | VX bearer token |
| `VX_NAME` | Friendly display name, default `VX` |
| `VX_SOURCE` | Host/source label stored with memory metadata. Recommended values: `claude-code`, `claude-desktop`, `codex`, `openclaw`, `mcp` |
| `VX_MCP_STORE_ON_REQUEST_ONLY` | Set to `1` or `true` to avoid automatic durable storage outside explicit memory moments |
| `VX_CUSTODIAN_ID` | Optional custodian identifier for multi-tenant setups |

## Verify In One Prompt

Use this after installation:

```text
Remember that I prefer TypeScript over JavaScript, then tell me my coding preference.
```

The assistant should store the preference and then recall it from VX.

## CLI

```bash
vx-mcp [mcp|install <claude|codex>|uninstall <claude|codex>]
```

## Programmatic Usage

This package also exports a lightweight client wrapper for direct VX API access.

```ts
import { VXClient } from "vx-mcp-server/client";

const client = new VXClient({
  apiBaseUrl: "https://api.vx.dev/v1",
  apiKey: process.env.VX_API_KEY!,
  source: "codex",
});

const stored = await client.store({
  content: "User prefers TypeScript over JavaScript.",
  context: "preferences/language",
  memoryType: "SEMANTIC",
  importance: 0.8,
});

const query = await client.query({
  query: "What language does the user prefer?",
  context: "preferences/language",
  limit: 3,
});

await client.delete(stored.id);
```

Available subpath exports:

- `vx-mcp-server/client`
- `vx-mcp-server/types`

## Development

```bash
npm run build
npm test
```

Use `VX_API_BASE_URL`, `VX_API_KEY`, or `VX_BEARER_TOKEN` when running against a real VX environment.

See `CONTRIBUTING.md` for contributor workflow and public-repo safety rules.

## Manual QA

Use this checklist before publishing a release.

### Claude Code

1. Run `npx vx-mcp-server install claude` with `VX_API_BASE_URL` and one VX credential set.
2. Confirm Claude Code shows the `vx` MCP server and `/vx-memory` slash command.
3. Run `/vx-memory` and verify the guidance mentions recall, context packets, knowledge contexts, atomic storage, and imports.
4. Create a knowledge context, store one preference inside it, then recall it in a fresh chat.
5. Run `npx vx-mcp-server uninstall claude` and confirm the MCP server and slash command are removed.

### Codex

1. Run `npx vx-mcp-server install codex` with `VX_API_BASE_URL` and one VX credential set.
2. Confirm `~/.codex/config.toml` contains a single managed VX block with `npx -y vx-mcp-server@latest mcp`.
3. Confirm `~/.codex/skills/vx-memory/SKILL.md` exists and matches the shipped workflow guidance.
4. Start Codex, verify the VX MCP server loads, create a knowledge context, store one preference inside it, then recall it in a fresh session.
5. Run `npx vx-mcp-server uninstall codex` and confirm the managed block and installed skill are removed cleanly.

### OpenClaw

1. Run `openclaw plugins install vx-mcp-server` and restart the gateway.
2. Add `plugins.entries.vx-memory.config` with `apiBaseUrl` and one VX credential.
3. Verify `vx_status` reports the plugin as ready.
4. Verify `vx_contexts_create` and `vx_contexts_list` work, then store memory inside that knowledge context.
5. Verify `vx_store`, `vx_recall`, `vx_context`, `vx_import_text`, and `vx_import_batch` are callable.
6. Start a fresh session and confirm a stored preference is still recalled.

### Package

1. Run `npm run build`.
2. Run `npm test`.
