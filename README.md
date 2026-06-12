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

For local product verification, set `VX_MCP_URL` to point the installer and
readiness checks at a dev MCP endpoint, for example
`VX_MCP_URL=http://localhost:3000/mcp npm run start -- doctor`. Production
users should leave this unset.

## Requirements

- Node.js 18 or newer
- A VX account (you'll be prompted to sign up / sign in via your browser on
  first use; no setup needed up front)

## Quick start

### All supported local clients

```bash
npx @vx-nyc/vx-mcp install all
```

This runs the installer for Claude Code, Cursor, Codex, OpenClaw, and Hermes
Agent in one pass. Clients that support local config files are updated directly. Clients
that require their own CLI are configured when the CLI is on your PATH; if a
CLI is missing, the installer prints the exact manual command or config
snippet to apply.

Check readiness without changing any local config:

```bash
npx @vx-nyc/vx-mcp doctor
```

The doctor reports local config status for Claude Code, Cursor, Codex,
OpenClaw, Hermes Agent, and the manual ChatGPT remote-MCP setup path. When a
local runtime is discoverable, it also verifies that the runtime can start so a
config-only install is not mistaken for a working agent instance.

### Claude Code

```bash
npx @vx-nyc/vx-mcp install claude
```

This runs
`claude mcp add --scope user --transport http vx https://api.onememory.co/mcp`
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
`openclaw plugins install @vx-nyc/vx-mcp`, expose the core VX MCP tools, and
enable OpenClaw's compact tool-search surface for live agent turns. The compact
tool surface matters for local embedded agents because it keeps the MCP/plugin
catalog out of the prompt while still letting OpenClaw call VX tools.
The installer also prints the plugin config snippet.
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

OpenClaw handles the OAuth flow when it first connects to the MCP endpoint. To
start that sign-in explicitly after install, run:

```bash
npx @vx-nyc/vx-mcp login openclaw
```

If OpenClaw prints an authorization-code step after approval, complete it in the
same profile, for example:

```bash
npx openclaw --dev mcp login vx --code <code>
```

After approving VX and choosing the Knowledge Contexts OpenClaw may use, run
the smoke check:

```bash
npx @vx-nyc/vx-mcp smoke openclaw
```

The smoke check verifies OAuth, required VX tools, and model readiness before a
live agent turn. When everything is ready, it prints a concrete proof command
that calls `vx_librarian_context`, `vx_store`, and `vx_recall`.

If a live OpenClaw turn reports unknown VX tools or immediately attempts
compaction, rerun `npx @vx-nyc/vx-mcp install openclaw`. The installer applies
OpenClaw's `group:plugins` tool policy and `toolSearch` setting so VX MCP tools
are enabled without overflowing the local agent prompt.

To start every supported CLI login helper in one pass:

```bash
npx @vx-nyc/vx-mcp login all
```

### Hermes Agent

```bash
npx @vx-nyc/vx-mcp install hermes
```

This adds the hosted VX MCP endpoint to `~/.hermes/config.yaml` under
`mcp_servers` and installs a bundled Hermes skill. Restart Hermes Agent after
installing so it can discover the VX tools.

Manual equivalent — add this block under `mcp_servers` in
`~/.hermes/config.yaml`:

```yaml
mcp_servers:
  vx:
    url: "https://api.onememory.co/mcp"
    auth: oauth
    oauth:
      redirect_port: 8989
    headers:
      X-Counterparty-Id: "hermes:agent"
      X-Counterparty-Kind: "personal-agent"
      X-Counterparty-Client: "hermes"
```

Hermes Agent discovers tools with the `mcp_vx_` prefix and handles OAuth when
it first connects to the MCP endpoint. The `X-Counterparty-*` headers are
non-secret provenance hints so VX can label Hermes memories and graph activity
clearly; they do not grant access.

If Hermes is running in Docker, use the host-side login helper so the OAuth
browser callback can reach the container:

```bash
npx @vx-nyc/vx-mcp login hermes
```

Open the printed VX authorization URL immediately and approve access before the
Hermes login timeout. Native Hermes builds can still use `hermes mcp login vx`
directly.

Run `npx @vx-nyc/vx-mcp doctor` after installing. If Hermes was installed with a
Linux/ELF `tirith` binary on macOS, the doctor will report the incompatible
executable and ask for a macOS-compatible Hermes build before VX can verify a
live Hermes workflow.

After approving VX, run the Hermes smoke check:

```bash
npx @vx-nyc/vx-mcp smoke hermes
```

When Hermes is ready, the smoke check prints a live proof prompt that asks
Hermes to load `vx_librarian_context`, store a memory, recall it, and answer
from the retrieved context.

### ChatGPT

ChatGPT connects to remote MCP servers through ChatGPT Apps / developer mode,
not a local config file that this CLI can edit.

Use the VX MCP URL when creating the app:

```text
https://api.onememory.co/mcp
```

Choose OAuth if prompted. After ChatGPT scans the tools and you enable the app,
it can use the same hosted VX MCP endpoint as the locally configured clients.

## Authentication

VX uses standard OAuth 2.1 (RFC 6749) with dynamic client registration
(RFC 7591) and OAuth-protected resource metadata (RFC 9728).

You don't configure any of this. The supported MCP clients handle the entire
flow on their own: they discover `auth.onememory.co`, register themselves
dynamically, open your browser for sign-in / consent, and store the resulting
token in their own keychain.

During consent, choose the Knowledge Contexts the client may use. The agent can
only read or write memories inside the contexts you select; choosing a parent
context includes its subcontexts.

If you have an existing per-device VX API key from a previous version, it is
**not used** by v1 — clients connect over OAuth-authenticated HTTP instead.

## Uninstall

```bash
npx @vx-nyc/vx-mcp uninstall claude
npx @vx-nyc/vx-mcp uninstall cursor
npx @vx-nyc/vx-mcp uninstall codex
npx @vx-nyc/vx-mcp uninstall openclaw
npx @vx-nyc/vx-mcp uninstall hermes
```

Each command removes the entry added by the corresponding `install`.

## Bundled guidance

This package ships host-specific guidance so the memory workflow feels native:

- Claude Code: `/vx-memory` slash command (installed to `~/.claude/commands/`)
- Codex: `vx-memory` skill (installed to `~/.codex/skills/`)
- OpenClaw: `vx-memory` skill packaged with the plugin
- Hermes Agent: `vx-memory` skill (installed to `~/.hermes/skills/`)

Recommended workflow:

1. If the `vx-librarian` context is empty, call `vx_librarian_seed` once. This
   stores the Librarian's governing purpose and memory policy as normal VX
   memories instead of copying that policy into local prompts.
2. Load the VX Librarian context with `vx_librarian_context` so the agent gets
   its purpose and memory policy from VX memory.
3. Resolve the active reality with `vx_reality` when an agent is joining or
   continuing a scoped workstream.
4. Recall first with `vx_recall` for focused questions.
5. Use `vx_context` when one topic needs broader continuity.
6. Use `vx_contexts_list` to inspect existing contexts and `vx_contexts_create`
   when a new namespace is needed.
7. Store new durable facts with `vx_store` one item at a time inside the right
   context.
8. Use `vx_import_text` or `vx_import_batch` to migrate prior notes or exports.
9. Never store secrets, tokens, private keys, or credentials.

## Tools

The hosted MCP server exposes the same VX tool catalog you had in v0.x:

| Tool | Purpose |
| --- | --- |
| `vx_store` | Store one durable fact, preference, decision, or procedure |
| `vx_librarian_seed` | Initialize or refresh the Librarian's governed context as VX memories |
| `vx_librarian_context` | Load the Librarian's purpose, memory policy, and setup guidance from VX memory |
| `vx_reality` | Resolve the active contexts, delivered memories, capability grants, and exclusions for an agent turn |
| `vx_recall` | Recall durable VX memory relevant to the current question |
| `vx_query` | Search stored VX memory for named procedures, entities, or prior context |
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
vx-mcp install <all|claude|cursor|codex|openclaw|hermes>
vx-mcp uninstall <claude|cursor|codex|openclaw|hermes>
vx-mcp login <openclaw|hermes|all>
vx-mcp smoke <openclaw|hermes>
vx-mcp doctor
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

Local stack smoke checks can override the MCP endpoint without changing code:

```bash
VX_MCP_URL=http://localhost:3000/mcp node dist/index.js doctor
```

This package is released through `manual-package-release.yml`: merge to `main`,
run the workflow with a new `vX.Y.Z` tag, and let it dispatch `publish.yml`.
`publish.yml` can also be run manually with an existing tag for retries. It
publishes `@vx-nyc/vx-mcp` to the public npm registry and creates the GitHub
Release notes. GitHub Packages is not used for the public installer because
the documented `npx @vx-nyc/vx-mcp ...` commands must work without a GitHub
Packages token. See `CHANGELOG.md` for release history.

Once the npm package exists and has trusted publishing configured for this
repository workflow, `publish.yml` publishes through GitHub OIDC instead of a
long-lived npm token. The first npm publish still needs a working bootstrap
publish token because trusted publishing is configured on the npm package after
that package exists. `manual-package-release.yml` checks which path applies
before creating a tag so a broken bootstrap token cannot leave a half-created
release. If a publish retry is needed after a tag already exists, run
`publish.yml` manually with that existing tag instead of creating a new one.

See `CONTRIBUTING.md` for contributor workflow and public-repo safety rules.
