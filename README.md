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

`@vx-nyc/vx-mcp` is published on **GitHub Packages** (`npm.pkg.github.com`), not
the public npm registry.

One-time registry setup:

```bash
npm config set @vx-nyc:registry https://npm.pkg.github.com
```

Authenticate with a GitHub token that has `read:packages`. If you use GitHub
CLI, this is usually enough:

```bash
export NODE_AUTH_TOKEN=$(gh auth token)
```

### Connect one client to a named compartment

```bash
npx @vx-nyc/vx-mcp connect cursor --compartment personal
npx @vx-nyc/vx-mcp connect claude-desktop --compartment work-laptop
```

`connect` is the compartment-aware way to wire up a single client. Every
`connect` requires `--compartment <name>` — there is no unscoped default, and
vx-mcp refuses to write a config without one. The compartment name is written
into that client's own connection URL, so a work laptop's Cursor and a
personal machine's Claude Desktop can be bound to different compartments and
never end up sharing knowledge that shouldn't cross.

To change a client's compartment later, just run `connect` again with a new
name — it's idempotent, the same as `install`.

Check what every connected client can see in one command:

```bash
npx @vx-nyc/vx-mcp status
```

This reports, per client: not connected, connected with a named compartment,
or connected but **unscoped** (a plain `install`, with no compartment — flagged
because an unscoped connection can read everything the account grants).

### Which tools do you already have installed?

```bash
npx @vx-nyc/vx-mcp detect
```

Scans this machine for every supported client (Claude Code, Cursor, Codex,
OpenClaw, Hermes Agent, Claude Desktop, Windsurf, Cline, Zed, and VS Code) and
reports which ones it found — from a CLI on PATH, an installed app, or an
existing config directory — without changing anything. Add `--json` for
machine-readable output.

### All supported local clients

```bash
npx @vx-nyc/vx-mcp install all
```

This runs the installer for every supported client in one pass. Clients that
support local config files are updated directly. Clients that require their
own CLI are configured when the CLI is on your PATH; if a CLI is missing, the
installer prints the exact manual command or config snippet to apply.

Preview exactly what would change first, without writing anything:

```bash
npx @vx-nyc/vx-mcp install all --dry-run
```

`--dry-run` works with every `install`/`uninstall` target and prints a diff of
the config file it would write (or "already reflects the selected VX MCP
endpoint" if there's nothing to do).

### Install without GitHub Packages auth

If you prefer not to configure GitHub Packages auth, install directly from the
GitHub repo (same CLI):

```bash
npx --package github:vx-nyc/vx-mcp vx-mcp install all
```

Check readiness without changing any local config:

```bash
npx @vx-nyc/vx-mcp doctor
```

The doctor reports local config status for every supported client and the
manual ChatGPT remote-MCP setup path. When a local runtime is discoverable, it
also verifies that the runtime can start so a config-only install is not
mistaken for a working agent instance. Because it re-reads each client's live
config on every run, it also notices when a client update wiped out the VX
entry — rerunning `install` fixes that the same way it did the first time.

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

### Claude Desktop

```bash
npx @vx-nyc/vx-mcp install claude-desktop
```

Config path: macOS `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows `%APPDATA%\Claude\claude_desktop_config.json`. (Claude Desktop has no
Linux build.)

Claude Desktop's config only understands local (stdio) MCP servers — it has no
built-in remote-HTTP/OAuth transport. This installer writes an entry that runs
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) via `npx`, the
community-standard bridge that speaks stdio to Claude Desktop and Streamable
HTTP to the hosted VX endpoint, opening your browser for OAuth on first use.
vx-mcp itself never sees or stores a credential.

Manual equivalent — add this block to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vx": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://api.onememory.co/mcp"]
    }
  }
}
```

Restart Claude Desktop after installing.

### Windsurf

```bash
npx @vx-nyc/vx-mcp install windsurf
```

This writes the VX entry to `~/.codeium/windsurf/mcp_config.json` (same path
on macOS, Linux, and Windows). Windsurf's Cascade agent will open your browser
to sign in on first use.

Manual equivalent:

```json
{
  "mcpServers": {
    "vx": {
      "serverUrl": "https://api.onememory.co/mcp"
    }
  }
}
```

### Cline

```bash
npx @vx-nyc/vx-mcp install cline
```

Config path: macOS
`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`,
Windows `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`,
Linux `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`.
This targets the standard VS Code install of the Cline extension; Cline
running inside VS Code Insiders, Cursor, or a portable profile uses a
different path and needs manual setup.

Manual equivalent:

```json
{
  "mcpServers": {
    "vx": {
      "type": "streamableHttp",
      "url": "https://api.onememory.co/mcp"
    }
  }
}
```

### Zed

```bash
npx @vx-nyc/vx-mcp install zed
```

Config path: macOS/Linux `~/.config/zed/settings.json` (respects
`$XDG_CONFIG_HOME`), Windows `%APPDATA%\Zed\settings.json`. Zed already
prompts its own OAuth flow for a remote context server with no `Authorization`
header configured, so no extra sign-in step is needed beyond approving it in
Zed.

Manual equivalent — add this under `context_servers` in `settings.json`:

```json
{
  "context_servers": {
    "vx": {
      "url": "https://api.onememory.co/mcp"
    }
  }
}
```

If your `settings.json` uses `//` comments, the installer leaves it untouched
rather than risk corrupting it — it prints this snippet for you to paste in by
hand instead.

### VS Code + Copilot

```bash
npx @vx-nyc/vx-mcp install vscode
```

Config path: macOS `~/Library/Application Support/Code/User/mcp.json`,
Windows `%APPDATA%\Code\User\mcp.json`, Linux `~/.config/Code/User/mcp.json`.
This is VS Code's native MCP config, shared by GitHub Copilot Chat's agent
mode — there's no separate Copilot-only config to write.

Manual equivalent — note the top-level key is `servers`, not `mcpServers`:

```json
{
  "servers": {
    "vx": {
      "type": "http",
      "url": "https://api.onememory.co/mcp"
    }
  }
}
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
    connect_timeout: 180
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
Hermes login timeout. The helper writes a single managed `vx` entry, removes
older duplicate `vx` entries, and uses an extended OAuth probe timeout so a
normal browser approval has time to complete. Native Hermes builds can still
use `hermes mcp login vx` directly.

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

## Compartments — per-tool access

`connect <client> --compartment <name>` binds that client's connection to a
named compartment instead of a bare, unscoped endpoint. The compartment name
travels as a `compartment` query parameter on the URL vx-mcp writes into that
client's own config (or passes to its CLI) — there is no separate credential
or local database vx-mcp keeps track of. `vx-mcp status` reads the same URL
back out of each client's config to report what it's bound to, so the two
never drift apart.

vx-mcp itself does not mint credentials, call the VX REST API, or verify
server-side enforcement — it is an installer, not a runtime. What it does
guarantee, entirely at this layer, is that `connect` never writes a config
with a missing or empty compartment: a connection is either explicitly scoped
or refused outright, never silently unscoped.

Plain `install` (without `--compartment`) still works exactly as before, for
backward compatibility — but `status` will call it out as **UNSCOPED** so it's
never a surprise which of your connected clients can read everything.

## Uninstall

```bash
npx @vx-nyc/vx-mcp uninstall claude
npx @vx-nyc/vx-mcp uninstall cursor
npx @vx-nyc/vx-mcp uninstall codex
npx @vx-nyc/vx-mcp uninstall openclaw
npx @vx-nyc/vx-mcp uninstall hermes
npx @vx-nyc/vx-mcp uninstall claude-desktop
npx @vx-nyc/vx-mcp uninstall windsurf
npx @vx-nyc/vx-mcp uninstall cline
npx @vx-nyc/vx-mcp uninstall zed
npx @vx-nyc/vx-mcp uninstall vscode
```

Each of these removes only the `vx` entry it added — every other server in
that config file, and the file itself, is left exactly as it was. Add
`--dry-run` to preview the removal first.

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

### Continuity: starting in one tool, finishing in another

Anything already stored in VX is available to any connected client through
`vx_recall`/`vx_context`, subject to that client's compartment — that is
ambient continuity for existing knowledge, and it needs no extra setup beyond
`connect`.

For handing off a specific, current piece of work between tools, the bundled
guidance above teaches each agent an explicit convention:

1. **Hand off**: store one atomic memory in a `handoff/<slug>` context, and
   have the agent tell you exactly what it stored.
2. **Pick up**: in the other tool, recall that `handoff/<slug>` context, and
   have the agent state plainly what it retrieved before acting on it.
3. **Don't carry this**: ask the agent to delete the hand-off memory (or the
   whole `handoff/<slug>` context) — one action, and it's gone.

This is deliberately explicit rather than automatic: vx-mcp does not watch or
capture what happens inside any connected tool, so nothing crosses over
unless an agent is asked to store or recall it. Passive, ambient capture of
an entire conversation as it happens is a separate, not-yet-shipped client.

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
vx-mcp connect <claude|cursor|codex|openclaw|hermes|claude-desktop|windsurf|cline|zed|vscode> --compartment <name> [--dry-run]
vx-mcp install <all|claude|cursor|codex|openclaw|hermes|claude-desktop|windsurf|cline|zed|vscode> [--dry-run]
vx-mcp uninstall <claude|cursor|codex|openclaw|hermes|claude-desktop|windsurf|cline|zed|vscode> [--dry-run]
vx-mcp status
vx-mcp login <openclaw|hermes|all>
vx-mcp smoke <openclaw|hermes>
vx-mcp doctor
vx-mcp detect [--json]
vx-mcp clients
vx-mcp --version
vx-mcp --help
```

`--dry-run` prints exactly what a `connect`/`install`/`uninstall` would
change — a diff of the config file it would write — without touching disk.
`detect` reports which supported clients are actually present on this machine
(from a CLI on PATH, an installed app, or an existing config directory), so a
GUI can offer "we found N tools — connect them?" instead of a blind picklist;
`--json` emits the same data as machine-readable JSON. `status` reports every
connected client and the compartment (if any) it's bound to — see
"Compartments — per-tool access" above.

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
publishes `@vx-nyc/vx-mcp` to **GitHub Packages** and creates the GitHub Release
notes. CI uses `GITHUB_TOKEN` with `packages: write`; no npmjs.org token is
required. If a publish retry is needed after a tag already exists, run
`publish.yml` manually with that existing tag instead of creating a new one.

See `CONTRIBUTING.md` for contributor workflow and public-repo safety rules.
