import { describe, expect, it, vi } from "vitest";
import {
  buildCodexTomlBlock,
  buildHermesManagedBlock,
  buildOpenClawPluginConfig,
  CODEX_BLOCK_START,
  CODEX_BLOCK_END,
  doctor,
  getClientReadiness,
  HERMES_BLOCK_START,
  handleCli,
  installAll,
  installClaude,
  installCursor,
  installCodex,
  installHermes,
  installOpenClaw,
  removeCursorVxEntry,
  stripHermesManagedBlock,
  stripCodexManagedBlock,
  smokeHermes,
  smokeOpenClaw,
  uninstallHermes,
  uninstallClaude,
  uninstallCodex,
  uninstallCursor,
  upsertCodexManagedBlock,
  upsertCursorVxEntry,
  upsertHermesManagedBlock,
  type InstallerDeps,
} from "../src/installer.js";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VX_URL = "https://api.onememory.co/mcp";

function createDeps(overrides: Partial<InstallerDeps> = {}): InstallerDeps {
  const home = mkdtempSync(join(tmpdir(), "vx-mcp-installer-"));
  const spawn = vi.fn<InstallerDeps["spawnSync"]>();

  const deps: InstallerDeps = {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    spawnSync: spawn,
    homedir: () => home,
    env: {},
    ...overrides,
  };

  return deps;
}

function mockSpawn(deps: InstallerDeps, ...returns: { status: number; stdout?: string; stderr?: string }[]) {
  const fn = vi.mocked(deps.spawnSync);
  for (const r of returns) {
    fn.mockReturnValueOnce({
      status: r.status,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      pid: 1,
      output: [],
      signal: null,
    });
  }
}

describe("Codex managed-block helpers", () => {
  it("builds a Codex TOML block with the streamable_http transport", () => {
    const block = buildCodexTomlBlock();

    expect(block).toContain('[mcp_servers.vx]');
    expect(block).toContain(`url = "${VX_URL}"`);
    expect(block).toContain('transport = "streamable_http"');
    expect(block.startsWith(CODEX_BLOCK_START)).toBe(true);
    expect(block.endsWith(CODEX_BLOCK_END)).toBe(true);
  });

  it("does not emit any env vars or API key references", () => {
    const block = buildCodexTomlBlock();
    expect(block).not.toContain("VX_API_KEY");
    expect(block).not.toContain("VX_BEARER_TOKEN");
    expect(block).not.toContain("VX_API_BASE_URL");
    expect(block).not.toContain("mcp_servers.vx.env");
  });

  it("upserting the same managed block twice is idempotent", () => {
    const block = buildCodexTomlBlock();
    const once = upsertCodexManagedBlock('model = "gpt-5"', block);
    const twice = upsertCodexManagedBlock(once, block);

    expect((twice.match(new RegExp(CODEX_BLOCK_START, "g")) || []).length).toBe(1);
    expect(stripCodexManagedBlock(twice)).toBe('model = "gpt-5"');
  });
});

describe("Cursor mcp.json upsert", () => {
  it("creates the mcpServers map when the file is empty", () => {
    const next = upsertCursorVxEntry(null);
    expect(next.mcpServers?.vx).toEqual({ type: "http", url: VX_URL });
  });

  it("preserves other servers when upserting vx", () => {
    const next = upsertCursorVxEntry({
      mcpServers: {
        github: { type: "http", url: "https://api.github.com/mcp" },
      },
    });
    expect(next.mcpServers?.github).toEqual({
      type: "http",
      url: "https://api.github.com/mcp",
    });
    expect(next.mcpServers?.vx).toEqual({ type: "http", url: VX_URL });
  });

  it("upsert is idempotent", () => {
    const once = upsertCursorVxEntry(null);
    const twice = upsertCursorVxEntry(once);
    expect(twice).toEqual(once);
  });

  it("removeCursorVxEntry deletes only the vx key", () => {
    const next = removeCursorVxEntry({
      mcpServers: {
        github: { type: "http", url: "https://api.github.com/mcp" },
        vx: { type: "http", url: VX_URL },
      },
    });
    expect(next.mcpServers?.github).toBeDefined();
    expect(next.mcpServers?.vx).toBeUndefined();
  });
});

describe("OpenClaw plugin config", () => {
  it("emits an HTTP-only config with no static credentials", () => {
    const config = buildOpenClawPluginConfig();
    const entry = config.plugins.entries["vx-memory"];
    expect(entry.enabled).toBe(true);
    expect(entry.config.apiBaseUrl).toBe(VX_URL);
    expect(entry.config.source).toBe("openclaw");
    expect(entry.config).not.toHaveProperty("apiKey");
    expect(entry.config).not.toHaveProperty("bearerToken");
  });
});

describe("installClaude", () => {
  it("falls back to printable command when Claude CLI is missing", () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 1 }); // findCli -> not found
    const notes = installClaude(deps);
    const slashCommandPath = join(deps.homedir(), ".claude", "commands", "vx-memory.md");
    expect(existsSync(slashCommandPath)).toBe(true);
    expect(notes.join("\n")).toContain(
      "claude mcp add --scope user --transport http vx https://api.onememory.co/mcp",
    );
  });

  it("registers with Claude Code using --transport http when CLI is available", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/claude\n" }, // findCli
      { status: 0 }, // mcp remove (pre-flight cleanup)
      { status: 0 }, // mcp add
    );

    const notes = installClaude(deps);
    const calls = vi.mocked(deps.spawnSync).mock.calls;

    expect(calls[1]?.[1]).toEqual([
      "mcp",
      "remove",
      "--scope",
      "user",
      "vx",
    ]);

    // The 3rd spawnSync call is the actual `claude mcp add`.
    const addArgs = calls[2]?.[1] ?? [];
    expect(addArgs).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      "vx",
      VX_URL,
    ]);
    expect(notes.join("\n")).toContain("Registered VX MCP server with Claude Code");
  });
});

describe("installCursor", () => {
  it("writes ~/.cursor/mcp.json with the HTTP entry", () => {
    const deps = createDeps();
    installCursor(deps);
    const path = join(deps.homedir(), ".cursor", "mcp.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.mcpServers.vx).toEqual({ type: "http", url: VX_URL });
  });

  it("is idempotent across repeat installs", () => {
    const deps = createDeps();
    installCursor(deps);
    installCursor(deps);
    const path = join(deps.homedir(), ".cursor", "mcp.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(parsed.mcpServers)).toEqual(["vx"]);
  });

  it("uninstall removes only the vx entry", () => {
    const deps = createDeps();
    const path = join(deps.homedir(), ".cursor", "mcp.json");
    mkdirSync(join(deps.homedir(), ".cursor"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          github: { type: "http", url: "https://api.github.com/mcp" },
          vx: { type: "http", url: VX_URL },
        },
      }),
      "utf8",
    );
    uninstallCursor(deps);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers.vx).toBeUndefined();
  });
});

describe("installCodex", () => {
  it("writes the managed block to ~/.codex/config.toml", () => {
    const deps = createDeps();
    installCodex(deps);
    const config = readFileSync(
      join(deps.homedir(), ".codex", "config.toml"),
      "utf8",
    );
    expect(config).toContain(CODEX_BLOCK_START);
    expect(config).toContain(`url = "${VX_URL}"`);
    expect(config).toContain('transport = "streamable_http"');
  });

  it("is idempotent across repeat installs", () => {
    const deps = createDeps();
    installCodex(deps);
    installCodex(deps);
    const config = readFileSync(
      join(deps.homedir(), ".codex", "config.toml"),
      "utf8",
    );
    expect((config.match(new RegExp(CODEX_BLOCK_START, "g")) || []).length).toBe(1);
  });

  it("uninstall strips the managed block but preserves other config", () => {
    const deps = createDeps();
    const codexHome = join(deps.homedir(), ".codex");
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, "config.toml"),
      `model = "gpt-5"\n\n${buildCodexTomlBlock()}\n`,
      "utf8",
    );
    uninstallCodex(deps);
    const config = readFileSync(
      join(codexHome, "config.toml"),
      "utf8",
    );
    expect(config).toContain('model = "gpt-5"');
    expect(config).not.toContain(CODEX_BLOCK_START);
  });
});

describe("Hermes config helpers", () => {
  it("builds a managed Hermes MCP block with an HTTP URL, provenance headers, and no static credentials", () => {
    const block = buildHermesManagedBlock();
    expect(block).toContain(HERMES_BLOCK_START);
    expect(block).toContain("  vx:");
    expect(block).toContain(`    url: "${VX_URL}"`);
    expect(block).toContain("    auth: oauth");
    expect(block).toContain("    oauth:");
    expect(block).toContain("      redirect_port: 8989");
    expect(block).toContain("headers:");
    expect(block).toContain('X-Counterparty-Id: "hermes:agent"');
    expect(block).toContain('X-Counterparty-Kind: "personal-agent"');
    expect(block).toContain('X-Counterparty-Client: "hermes"');
    expect(block).not.toContain("Authorization");
    expect(block).not.toContain("apiKey");
    expect(block).not.toContain("bearerToken");
  });

  it("adds mcp_servers when Hermes config is empty", () => {
    const next = upsertHermesManagedBlock("");
    expect(next).toContain("mcp_servers:");
    expect(next).toContain(`url: "${VX_URL}"`);
  });

  it("preserves existing Hermes MCP servers and is idempotent", () => {
    const current = [
      "theme: dark",
      "",
      "mcp_servers:",
      "  time:",
      "    command: \"uvx\"",
      "    args: [\"mcp-server-time\"]",
    ].join("\n");

    const once = upsertHermesManagedBlock(current);
    const twice = upsertHermesManagedBlock(once);

    expect(twice).toContain("  time:");
    expect(twice).toContain("    command: \"uvx\"");
    expect((twice.match(new RegExp(HERMES_BLOCK_START, "g")) || []).length).toBe(1);
  });

  it("strips only the managed Hermes VX block", () => {
    const current = upsertHermesManagedBlock([
      "mcp_servers:",
      "  time:",
      "    command: \"uvx\"",
    ].join("\n"));

    const stripped = stripHermesManagedBlock(current);
    expect(stripped).toContain("  time:");
    expect(stripped).not.toContain(HERMES_BLOCK_START);
    expect(stripped).not.toContain(`url: "${VX_URL}"`);
  });
});

describe("installHermes", () => {
  it("writes ~/.hermes/config.yaml with the HTTP MCP entry and copies the skill", () => {
    const deps = createDeps();
    const notes = installHermes(deps);
    const configPath = join(deps.homedir(), ".hermes", "config.yaml");
    const skillPath = join(deps.homedir(), ".hermes", "skills", "vx-memory", "SKILL.md");
    const config = readFileSync(configPath, "utf8");

    expect(existsSync(skillPath)).toBe(true);
    expect(config).toContain("mcp_servers:");
    expect(config).toContain("  vx:");
    expect(config).toContain(`url: "${VX_URL}"`);
    expect(config).toContain("auth: oauth");
    expect(config).toContain("redirect_port: 8989");
    expect(config).toContain('X-Counterparty-Client: "hermes"');
    expect(notes.join("\n")).toContain("Restart Hermes Agent");
    expect(notes.join("\n")).toContain("vx-mcp login hermes");
  });

  it("is idempotent across repeat installs", () => {
    const deps = createDeps();
    installHermes(deps);
    installHermes(deps);
    const config = readFileSync(
      join(deps.homedir(), ".hermes", "config.yaml"),
      "utf8",
    );
    expect((config.match(new RegExp(HERMES_BLOCK_START, "g")) || []).length).toBe(1);
  });

  it("uninstall strips the managed block but preserves other Hermes config", () => {
    const deps = createDeps();
    const hermesHome = join(deps.homedir(), ".hermes");
    mkdirSync(hermesHome, { recursive: true });
    writeFileSync(
      join(hermesHome, "config.yaml"),
      upsertHermesManagedBlock([
        "theme: dark",
        "mcp_servers:",
        "  time:",
        "    command: \"uvx\"",
      ].join("\n")),
      "utf8",
    );

    uninstallHermes(deps);
    const config = readFileSync(join(hermesHome, "config.yaml"), "utf8");
    expect(config).toContain("theme: dark");
    expect(config).toContain("  time:");
    expect(config).not.toContain(HERMES_BLOCK_START);
    expect(config).not.toContain(`url: "${VX_URL}"`);
  });
});

describe("installOpenClaw", () => {
  it("falls back to manual instructions when the CLI is missing", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
    );
    const notes = installOpenClaw(deps);
    expect(notes.join("\n")).toContain("openclaw plugins install @vx-nyc/vx-mcp");
    expect(notes.join("\n")).toContain(VX_URL);
  });

  it("does not run OpenClaw through npx without an existing OpenClaw config signal", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
    );

    const notes = installOpenClaw(deps);
    expect(vi.mocked(deps.spawnSync)).toHaveBeenCalledTimes(1);
    expect(notes.join("\n")).toContain("openclaw plugins install @vx-nyc/vx-mcp");
    expect(notes.join("\n")).not.toContain("Configured OpenClaw VX MCP through npx");
  });

  it("uses npx OpenClaw to write the hosted OAuth MCP config when the global CLI is missing", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".openclaw-dev", "openclaw.json"), "{}\n", "utf8");
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      { status: 0, stdout: "Saved MCP server vx\n" },
    );

    const notes = installOpenClaw(deps);
    expect(vi.mocked(deps.spawnSync).mock.calls[2]?.[1]).toEqual([
      "-y",
      "openclaw",
      "--dev",
      "mcp",
      "add",
      "vx",
      "--url",
      VX_URL,
      "--transport",
      "streamable-http",
      "--auth",
      "oauth",
      "--include",
      "vx_librarian_seed,vx_librarian_context,vx_reality,vx_recall,vx_store",
      "--no-probe",
    ]);
    expect(notes.join("\n")).toContain("Configured OpenClaw VX MCP through npx");
    expect(notes.join("\n")).toContain("npx openclaw --dev mcp login vx");
    expect(notes.join("\n")).not.toContain("Add this to your OpenClaw plugin config");
  });

  it("runs `openclaw plugins install` when the CLI is available", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/openclaw\n" },
      { status: 0 },
      { status: 0 },
    );
    const notes = installOpenClaw(deps);
    expect(vi.mocked(deps.spawnSync).mock.calls[1]?.[1]).toEqual([
      "plugins",
      "install",
      "@vx-nyc/vx-mcp",
    ]);
    expect(vi.mocked(deps.spawnSync).mock.calls[2]?.[1]).toEqual([
      "mcp",
      "tools",
      "vx",
      "--include",
      "vx_librarian_seed,vx_librarian_context,vx_reality,vx_recall,vx_store",
    ]);
    expect(notes.join("\n")).toContain("Installed the VX plugin for OpenClaw");
    expect(notes.join("\n")).toContain("Exposed the core VX MCP tools for OpenClaw");
  });
});

describe("installAll", () => {
  it("wires every supported local client in one command", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 1 }, // Claude CLI lookup
      { status: 1 }, // OpenClaw CLI lookup
    );

    const notes = installAll(deps).join("\n");

    expect(existsSync(join(deps.homedir(), ".claude", "commands", "vx-memory.md"))).toBe(true);
    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(true);
    expect(existsSync(join(deps.homedir(), ".codex", "config.toml"))).toBe(true);
    expect(notes).toContain("Claude Code");
    expect(notes).toContain("Cursor");
    expect(notes).toContain("Codex");
    expect(notes).toContain("OpenClaw");
    expect(notes).toContain("Hermes Agent");
    expect(notes).toContain("openclaw plugins install @vx-nyc/vx-mcp");
    expect(existsSync(join(deps.homedir(), ".hermes", "config.yaml"))).toBe(true);
  });
});

describe("doctor/readiness", () => {
  it("reports Cursor and Codex as ready when their configs point to VX", () => {
    const deps = createDeps();
    installCursor(deps);
    installCodex(deps);

    expect(getClientReadiness("cursor", deps)).toMatchObject({
      label: "Cursor",
      status: "ready",
    });
    expect(getClientReadiness("codex", deps)).toMatchObject({
      label: "Codex",
      status: "ready",
    });
  });

  it("reports Hermes ready only when config is present and the runtime is executable", () => {
    const deps = createDeps();
    installHermes(deps);
    const hermesBin = join(deps.homedir(), ".hermes", "bin");
    mkdirSync(hermesBin, { recursive: true });
    writeFileSync(join(hermesBin, "tirith"), "", "utf8");
    mockSpawn(
      deps,
      { status: 1 }, // command -v hermes
      { status: 1 }, // command -v tirith
      { status: 0, stdout: "Hermes Agent 1.0.0\n" },
    );

    expect(getClientReadiness("hermes", deps)).toMatchObject({
      label: "Hermes Agent",
      status: "ready",
    });
  });

  it("reports Hermes runtime errors instead of marking config-only installs ready", () => {
    const deps = createDeps();
    installHermes(deps);
    const hermesBin = join(deps.homedir(), ".hermes", "bin");
    mkdirSync(hermesBin, { recursive: true });
    writeFileSync(join(hermesBin, "tirith"), "", "utf8");
    mockSpawn(
      deps,
      { status: 1 }, // command -v hermes
      { status: 1 }, // command -v tirith
      { status: 126, stderr: "exec format error\n" },
      {
        status: 0,
        stdout:
          "/tmp/.hermes/bin/tirith: ELF 64-bit LSB pie executable, ARM aarch64, for GNU/Linux\n",
      },
    );

    expect(getClientReadiness("hermes", deps)).toMatchObject({
      label: "Hermes Agent",
      status: "runtime-error",
      notes: expect.arrayContaining([
        expect.stringContaining("exec format error"),
        expect.stringContaining("Linux/ELF binary"),
        expect.stringContaining("macOS-compatible Hermes build"),
      ]),
    });
  });

  it("reports Docker Hermes as present but not ready when VX MCP OAuth is pending", () => {
    const deps = createDeps();
    installHermes(deps);
    const hermesBin = join(deps.homedir(), ".hermes", "bin");
    mkdirSync(hermesBin, { recursive: true });
    writeFileSync(join(hermesBin, "tirith"), "", "utf8");
    mockSpawn(
      deps,
      { status: 1 }, // command -v hermes
      { status: 1 }, // command -v tirith
      { status: 126, stderr: "exec format error\n" },
      {
        status: 0,
        stdout:
          "/tmp/.hermes/bin/tirith: ELF 64-bit LSB pie executable, ARM aarch64, for GNU/Linux\n",
      },
      { status: 0, stdout: "hermes-dashboard\n" },
      { status: 0, stdout: "Hermes Agent v0.14.0\nProject: /opt/hermes\n" },
      {
        status: 0,
        stdout:
          "Name Transport Tools Status\nvx https://api.onememory.co/mcp all ✓ enabled\n",
      },
      {
        status: 0,
        stdout:
          "Testing 'vx'...\n✗ Connection failed: Client error '401 Unauthorized' for url 'https://api.onememory.co/mcp'\n",
      },
    );

    expect(getClientReadiness("hermes", deps)).toMatchObject({
      label: "Hermes Agent",
      status: "manual-approval",
      notes: expect.arrayContaining([
        expect.stringContaining("Hermes Docker container 'hermes-dashboard' is running"),
        expect.stringContaining("MCP config lists the selected VX MCP endpoint"),
        expect.stringContaining("OAuth is not complete"),
        expect.stringContaining("401 Unauthorized"),
        expect.stringContaining("vx-mcp login hermes"),
        expect.stringContaining("Host Hermes executable is not usable"),
      ]),
    });
  });

  it("reports Hermes OAuth registration compatibility errors before generic auth guidance", () => {
    const deps = createDeps();
    installHermes(deps);
    mockSpawn(
      deps,
      { status: 1 }, // command -v hermes
      { status: 1 }, // command -v tirith
      { status: 0, stdout: "hermes-dashboard\n" },
      { status: 0, stdout: "Hermes Agent v0.14.0\nProject: /opt/hermes\n" },
      {
        status: 0,
        stdout:
          "Name Transport Tools Status\nvx https://api.onememory.co/mcp all ✓ enabled\n",
      },
      {
        status: 0,
        stdout: [
          "Testing 'vx'...",
          "Transport: HTTP → https://api.onememory.co/mcp",
          "Auth: OAuth 2.1 PKCE",
          "✗ Connection failed: Invalid registration response: 3 validation errors for OAuthClientInformationFull",
          "logo_uri",
          "tos_uri",
          "policy_uri",
        ].join("\n"),
      },
    );

    expect(getClientReadiness("hermes", deps)).toMatchObject({
      label: "Hermes Agent",
      status: "runtime-error",
      notes: expect.arrayContaining([
        expect.stringContaining("registration response is invalid"),
        expect.stringContaining("logo_uri, tos_uri, policy_uri"),
        expect.stringContaining("Deploy the VX OAuth registration compatibility fix"),
      ]),
    });
  });

  it("reports Claude Code ready when `claude mcp list` says VX is connected", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".claude", "commands"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".claude", "commands", "vx-memory.md"), "# VX\n", "utf8");
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/claude\n" },
      { status: 0, stdout: "vx: https://api.onememory.co/mcp (HTTP) - ✓ Connected\n" },
    );

    expect(getClientReadiness("claude", deps)).toMatchObject({
      label: "Claude Code",
      status: "ready",
      notes: ["Claude Code reports the VX MCP server is connected."],
    });
  });

  it("reports Claude Code manual when VX is registered but OAuth is pending", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".claude", "commands"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".claude", "commands", "vx-memory.md"), "# VX\n", "utf8");
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/claude\n" },
      { status: 0, stdout: "vx: https://api.onememory.co/mcp (HTTP) - ! Needs authentication\n" },
    );

    expect(getClientReadiness("claude", deps)).toMatchObject({
      label: "Claude Code",
      status: "manual-approval",
    });
  });

  it("reports Claude Code needs install when the CLI list has no VX entry", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/claude\n" },
      { status: 0, stdout: "github: https://example.com/mcp - ✓ Connected\n" },
    );

    expect(getClientReadiness("claude", deps)).toMatchObject({
      label: "Claude Code",
      status: "needs-install",
      notes: expect.arrayContaining(["Run: vx-mcp install claude"]),
    });
  });

  it("recognizes OpenClaw dev MCP config even when the CLI is not on PATH", () => {
    const deps = createDeps();
    const configPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: VX_URL,
                transport: "streamable-http",
                headers: { "X-API-Key": "vx_test_local" },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 1 }, // command -v npx
    );

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "manual-approval",
      notes: expect.arrayContaining([
        expect.stringContaining("OpenClaw MCP config includes VX"),
        expect.stringContaining(VX_URL),
        expect.stringContaining("OpenClaw CLI is not on PATH"),
      ]),
    });
  });

  it("reports OpenClaw needs reinstall when the config points at a different MCP endpoint", () => {
    const deps = createDeps();
    const configPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: "http://localhost:3000/mcp",
                transport: "streamable-http",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    mockSpawn(deps, { status: 1 });

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "needs-install",
      notes: expect.arrayContaining([
        expect.stringContaining("points at http://localhost:3000/mcp"),
        expect.stringContaining(`Selected VX MCP endpoint: ${VX_URL}`),
        "Run: vx-mcp install openclaw",
      ]),
    });
  });

  it("uses npx OpenClaw probe to distinguish MCP connectivity from missing model auth", () => {
    const deps = createDeps();
    const configPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: VX_URL,
                transport: "streamable-http",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { launch: VX_URL, tools: 24 } },
          tools: [
            "vx__vx_librarian_seed",
            "vx__vx_librarian_context",
            "vx__vx_reality",
            ...Array.from({ length: 21 }, (_, index) => `vx__tool_${index}`),
          ],
          diagnostics: [],
        }),
      },
      {
        status: 0,
        stdout:
          "Auth overview\nProviders w/ OAuth/tokens (0): -\n\nMissing auth\n- openai Run `openclaw --profile dev models auth login --provider openai`",
      },
    );

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "manual-approval",
      notes: expect.arrayContaining([
        expect.stringContaining("npx OpenClaw MCP probe discovered 24 tools"),
        expect.stringContaining("model auth is still missing"),
      ]),
    });
    expect(vi.mocked(deps.spawnSync).mock.calls[2]?.[1]).toEqual([
      "-y",
      "openclaw",
      "--dev",
      "mcp",
      "probe",
      "vx",
      "--json",
    ]);
  });

  it("reports OpenClaw OAuth login as the next step when the hosted MCP server requires authorization", () => {
    const deps = createDeps();
    const configPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: "https://api.onememory.co/mcp",
                transport: "streamable-http",
                auth: "oauth",
                toolFilter: {
                  include: [
                    "vx_librarian_seed",
                    "vx_librarian_context",
                    "vx_reality",
                    "vx_recall",
                    "vx_store",
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      {
        status: 0,
        stdout: JSON.stringify({
          generatedAt: "2026-06-11T00:21:20.568Z",
          servers: {},
          tools: [],
          diagnostics: [
            {
              serverName: "vx",
              message: 'Error: MCP server "vx" requires OAuth authorization. Run openclaw mcp login vx.',
            },
          ],
        }),
      },
    );

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "manual-approval",
      notes: expect.arrayContaining([
        expect.stringContaining("OAuth is not complete"),
        expect.stringContaining("vx-mcp login openclaw"),
        expect.stringContaining("mcp login vx --code <code>"),
      ]),
    });
  });

  it("treats local Ollama marker auth as ready for OpenClaw live turns", () => {
    const deps = createDeps();
    const configPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: VX_URL,
                transport: "streamable-http",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { launch: VX_URL, tools: 24 } },
          tools: [
            "vx__vx_librarian_seed",
            "vx__vx_librarian_context",
            "vx__vx_reality",
            ...Array.from({ length: 21 }, (_, index) => `vx__tool_${index}`),
          ],
          diagnostics: [],
        }),
      },
      {
        status: 0,
        stdout: [
          "Default       : ollama/qwen3.6:35b-mlx",
          "Configured models (1): ollama/qwen3.6:35b-mlx",
          "",
          "Auth overview",
          "Providers w/ OAuth/tokens (0): -",
          "- ollama effective=models.json:marker(ollama-local) | models.json=marker(ollama-local)",
          "",
          "OAuth/token status",
          "- none",
        ].join("\n"),
      },
    );

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "ready",
      notes: expect.arrayContaining([
        expect.stringContaining("npx OpenClaw MCP probe discovered 24 tools"),
        expect.stringContaining("model auth appears configured"),
      ]),
    });
  });

  it("reports an OpenClaw VX tool filter that hides the librarian context tool", () => {
    const deps = createDeps();
    const configPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: VX_URL,
                transport: "streamable-http",
                toolFilter: {
                  include: ["vx_reality", "vx_recall", "vx_store"],
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/openclaw\n" },
    );

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "manual-approval",
      notes: expect.arrayContaining([
        expect.stringContaining("tool filter excludes vx_librarian_seed, vx_librarian_context"),
        expect.stringContaining("openclaw mcp tools vx --include vx_librarian_seed,vx_librarian_context,vx_reality,vx_recall,vx_store"),
      ]),
    });
  });

  it("reports an OpenClaw probe that cannot see required VX tools", () => {
    const deps = createDeps();
    const configPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: VX_URL,
                transport: "streamable-http",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" },
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { launch: VX_URL, tools: 3 } },
          tools: ["vx__vx_reality", "vx__vx_recall", "vx__vx_store"],
          diagnostics: [],
        }),
      },
    );

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "manual-approval",
      notes: expect.arrayContaining([
        expect.stringContaining("not the required VX tools: vx_librarian_seed, vx_librarian_context"),
        expect.stringContaining("openclaw mcp tools vx --include vx_librarian_seed,vx_librarian_context,vx_reality,vx_recall,vx_store"),
      ]),
    });
  });

  it("reports missing local CLIs without mutating user config", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 1 }, // claude lookup
      { status: 1 }, // openclaw lookup
    );

    const beforeCodex = existsSync(join(deps.homedir(), ".codex", "config.toml"));
    const lines = doctor(deps).join("\n");
    const afterCodex = existsSync(join(deps.homedir(), ".codex", "config.toml"));

    expect(beforeCodex).toBe(false);
    expect(afterCodex).toBe(false);
    expect(lines).toContain("Claude Code: missing-cli");
    expect(lines).toContain("OpenClaw: missing-cli");
    expect(lines).toContain("ChatGPT: manual");
    expect(lines).toContain("vx-mcp install cursor");
    expect(lines).toContain("vx-mcp install hermes");
    expect(lines).toContain("During OAuth consent, choose the Knowledge Contexts");
    expect(lines).toContain("vx-mcp smoke openclaw");
    expect(lines).toContain("vx_librarian_seed");
    expect(lines).toContain("vx_librarian_context");
    expect(lines).toContain("vx_reality");
    expect(lines).toContain("Do not copy VX policy into local prompts");
  });
});

describe("handleCli", () => {
  it("prints usage when called with no args", async () => {
    const deps = createDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const handled = await handleCli([], deps);
    expect(handled).toBe(true);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "Usage: vx-mcp",
    );
  });

  it("prints version with --version", async () => {
    const deps = createDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["--version"], deps);
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects unknown install target", async () => {
    const deps = createDeps();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["install", "unknown"], deps);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "Unknown target",
    );
  });

  it("dispatches install cursor", async () => {
    const deps = createDeps();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["install", "cursor"], deps);
    const path = join(deps.homedir(), ".cursor", "mcp.json");
    expect(existsSync(path)).toBe(true);
  });

  it("dispatches install all", async () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 1 }, // Claude CLI lookup
      { status: 1 }, // OpenClaw CLI lookup
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["install", "all"], deps);
    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(true);
    expect(existsSync(join(deps.homedir(), ".codex", "config.toml"))).toBe(true);
    expect(existsSync(join(deps.homedir(), ".hermes", "config.yaml"))).toBe(true);
  });

  it("dispatches doctor", async () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 1 }, // claude lookup
      { status: 1 }, // openclaw lookup
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["doctor"], deps);
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("VX MCP readiness");
    expect(output).toContain("ChatGPT");
    expect(output).toContain("During OAuth consent, choose the Knowledge Contexts");
    expect(output).toContain("vx-mcp smoke openclaw");
    expect(output).toContain("vx_librarian_seed");
    expect(output).toContain("vx_librarian_context");
  });

  it("dispatches Hermes Docker login helper", async () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 0 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["login", "hermes"], deps);

    const config = readFileSync(join(deps.homedir(), ".hermes", "config.yaml"), "utf8");
    const spawn = vi.mocked(deps.spawnSync);
    const [command, args] = spawn.mock.calls[0];
    const shellScript = String(args.at(-1));
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");

    expect(command).toBe("docker");
    expect(args).toContain("run");
    expect(args).toContain("127.0.0.1:8989:8990");
    expect(args).toContain("nousresearch/hermes-agent");
    expect(shellScript).toContain("open the authorization URL as soon as Hermes prints it");
    expect(shellScript).toContain("attempts=3");
    expect(shellScript).toContain("attempt ${attempt}/${attempts}");
    expect(shellScript).toContain("use the newest URL printed below");
    expect(shellScript).toContain("Authentication failed");
    expect(config).toContain("redirect_port: 8989");
    expect(output).toContain("Started VX MCP login for Hermes");
  });

  it("lets operators increase Hermes Docker OAuth login attempts", async () => {
    const deps = createDeps({ env: { VX_MCP_HERMES_LOGIN_ATTEMPTS: "5" } });
    mockSpawn(deps, { status: 1 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["login", "hermes"], deps);

    const spawn = vi.mocked(deps.spawnSync);
    const shellScript = String(spawn.mock.calls[0]?.[1].at(-1));
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(shellScript).toContain("attempts=5");
    expect(output).toContain("after 5 attempt(s)");
    expect(output).toContain("VX_MCP_HERMES_LOGIN_ATTEMPTS=5");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("reports Hermes Docker login helper failures", async () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 1 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["login", "hermes"], deps);

    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("exited with status 1");
    expect(output).toContain("after 3 attempt(s)");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("dispatches OpenClaw OAuth login through npx when a dev config exists", async () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      join(deps.homedir(), ".openclaw-dev", "openclaw.json"),
      JSON.stringify({
        mcp: {
          servers: {
            vx: {
              url: VX_URL,
              transport: "streamable-http",
              auth: "oauth",
            },
          },
        },
      }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // openclaw CLI lookup
      { status: 0, stdout: "/usr/bin/npx\n" },
      { status: 0, stdout: "Authenticated\n" },
      { status: 0, stdout: "/usr/bin/npx\n" },
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { tools: 5 } },
          tools: [
            "vx__vx_librarian_seed",
            "vx__vx_librarian_context",
            "vx__vx_reality",
            "vx__vx_recall",
            "vx__vx_store",
          ],
        }),
      },
      {
        status: 0,
        stdout:
          "Auth overview\nProviders w/ OAuth/tokens (0): -\n\nMissing auth\n- openai Run `openclaw --profile dev models auth login --provider openai`",
      },
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["login", "openclaw"], deps);

    const spawn = vi.mocked(deps.spawnSync);
    expect(spawn.mock.calls[2]?.[0]).toBe("/usr/bin/npx");
    expect(spawn.mock.calls[2]?.[1]).toEqual([
      "-y",
      "openclaw",
      "--dev",
      "mcp",
      "login",
      "vx",
    ]);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "Started VX MCP login for OpenClaw",
    );
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "OpenClaw OAuth completed",
    );
  });

  it("does not report OpenClaw OAuth complete when the follow-up probe still needs auth", async () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      join(deps.homedir(), ".openclaw-dev", "openclaw.json"),
      JSON.stringify({
        mcp: {
          servers: {
            vx: {
              url: VX_URL,
              transport: "streamable-http",
              auth: "oauth",
            },
          },
        },
      }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // openclaw CLI lookup
      { status: 0, stdout: "/usr/bin/npx\n" },
      { status: 0, stdout: "Open this URL to authorize \"vx\": https://auth.onememory.co/oauth2/auth" },
      { status: 0, stdout: "/usr/bin/npx\n" },
      {
        status: 0,
        stdout: JSON.stringify({
          diagnostics: [
            {
              serverName: "vx",
              message:
                'Error: MCP server "vx" requires OAuth authorization. Run openclaw mcp login vx.',
            },
          ],
        }),
      },
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["login", "openclaw"], deps);

    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("OpenClaw OAuth still requires approval");
    expect(output).toContain("mcp login vx --code <code>");
    expect(output).not.toContain("OpenClaw OAuth completed");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("dispatches OpenClaw smoke and fails while OAuth is incomplete", async () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      join(deps.homedir(), ".openclaw-dev", "openclaw.json"),
      JSON.stringify({ mcp: { servers: { vx: { url: VX_URL } } } }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/bin/npx\n" },
      {
        status: 0,
        stdout: JSON.stringify({
          diagnostics: [
            {
              serverName: "vx",
              message:
                'Error: MCP server "vx" requires OAuth authorization. Run openclaw mcp login vx.',
            },
          ],
        }),
      },
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["smoke", "openclaw"], deps);

    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("VX MCP smoke for OpenClaw");
    expect(output).toContain("mcp login vx --code <code>");
    expect(output).toContain("OpenClaw VX smoke is not ready yet");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("prints a live proof command when OpenClaw smoke is ready", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      join(deps.homedir(), ".openclaw-dev", "openclaw.json"),
      JSON.stringify({ mcp: { servers: { vx: { url: VX_URL } } } }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/bin/npx\n" },
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { tools: 5 } },
          tools: [
            "vx__vx_librarian_seed",
            "vx__vx_librarian_context",
            "vx__vx_reality",
            "vx__vx_recall",
            "vx__vx_store",
          ],
        }),
      },
      { status: 0, stdout: "Auth overview\nProviders w/ OAuth/tokens (1): openai" },
    );

    const notes = smokeOpenClaw(deps);

    expect(notes.join("\n")).toContain("OpenClaw VX smoke ready");
    expect(notes.join("\n")).toContain("Live proof command:");
    expect(notes.join("\n")).toContain("vx_librarian_context");
    expect(notes.join("\n")).toContain("vx_store");
  });

  it("prints the selected OpenClaw profile in the live proof command", () => {
    const deps = createDeps({ env: { VX_MCP_OPENCLAW_PROFILE: "local-vx" } });
    mkdirSync(join(deps.homedir(), ".openclaw-local-vx"), { recursive: true });
    writeFileSync(
      join(deps.homedir(), ".openclaw-local-vx", "openclaw.json"),
      JSON.stringify({ mcp: { servers: { vx: { url: VX_URL } } } }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/bin/npx\n" },
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { tools: 5 } },
          tools: [
            "vx__vx_librarian_seed",
            "vx__vx_librarian_context",
            "vx__vx_reality",
            "vx__vx_recall",
            "vx__vx_store",
          ],
        }),
      },
      { status: 0, stdout: "Auth overview\nProviders w/ OAuth/tokens (1): ollama" },
    );

    const notes = smokeOpenClaw(deps);

    expect(notes.join("\n")).toContain("OpenClaw VX smoke ready");
    expect(notes.join("\n")).toContain("npx openclaw --profile local-vx agent --local --json");
    expect(notes.join("\n")).not.toContain("npx openclaw --dev agent --local --json");
  });

  it("reports Hermes smoke not ready when install is missing", () => {
    const deps = createDeps();

    const notes = smokeHermes(deps);

    expect(notes.join("\n")).toContain("Run: vx-mcp install hermes");
    expect(notes.join("\n")).toContain("Hermes VX smoke is not ready yet");
  });

  it("prints a live proof prompt when Hermes smoke is ready", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".hermes", "bin"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".hermes", "bin", "tirith"), "", "utf8");
    writeFileSync(
      join(deps.homedir(), ".hermes", "config.yaml"),
      [
        "mcp_servers:",
        "  vx:",
        `    url: ${VX_URL}`,
        "    transport: http",
      ].join("\n"),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // hermes CLI lookup
      { status: 1 }, // tirith CLI lookup
      { status: 0, stdout: "Hermes Agent v0.14.0" },
      { status: 0, stdout: "✓ connected" },
    );

    const notes = smokeHermes(deps);

    expect(notes.join("\n")).toContain("Hermes VX smoke ready");
    expect(notes.join("\n")).toContain("Live proof prompt:");
    expect(notes.join("\n")).toContain("vx_librarian_context");
  });

  it("does not mark Hermes smoke ready until MCP auth is verified", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".hermes", "bin"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".hermes", "bin", "tirith"), "", "utf8");
    writeFileSync(
      join(deps.homedir(), ".hermes", "config.yaml"),
      [
        "mcp_servers:",
        "  vx:",
        `    url: ${VX_URL}`,
        "    transport: http",
      ].join("\n"),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // hermes CLI lookup
      { status: 1 }, // tirith CLI lookup
      { status: 0, stdout: "Hermes Agent v0.14.0" },
      { status: 1, stderr: "401 Unauthorized" },
    );

    const notes = smokeHermes(deps);

    expect(notes.join("\n")).toContain("OAuth is not complete");
    expect(notes.join("\n")).toContain("Hermes VX smoke is not ready yet");
    expect(notes.join("\n")).not.toContain("Hermes VX smoke ready");
  });

  it("reports native Hermes registration failures before OAuth guidance", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".hermes", "bin"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".hermes", "bin", "tirith"), "", "utf8");
    writeFileSync(
      join(deps.homedir(), ".hermes", "config.yaml"),
      [
        "mcp_servers:",
        "  vx:",
        `    url: ${VX_URL}`,
        "    transport: http",
      ].join("\n"),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // hermes CLI lookup
      { status: 1 }, // tirith CLI lookup
      { status: 0, stdout: "Hermes Agent v0.14.0" },
      {
        status: 1,
        stderr: "Invalid registration response for OAuthClientInformationFull: logo_uri",
      },
    );

    const notes = smokeHermes(deps);

    expect(notes.join("\n")).toContain("registration response is invalid for: logo_uri");
    expect(notes.join("\n")).not.toContain("OAuth is not complete");
    expect(notes.join("\n")).toContain("Hermes VX smoke is not ready yet");
  });

  it("falls back to Hermes Docker smoke when the native binary cannot start", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".hermes", "bin"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".hermes", "bin", "tirith"), "", "utf8");
    writeFileSync(
      join(deps.homedir(), ".hermes", "config.yaml"),
      [
        "mcp_servers:",
        "  vx:",
        `    url: ${VX_URL}`,
        "    transport: http",
      ].join("\n"),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // hermes CLI lookup
      { status: 1 }, // tirith CLI lookup
      { status: 126, stderr: "exec format error" },
      { status: 0, stdout: "hermes-dashboard\n" },
      { status: 0, stdout: "Hermes Agent v0.14.0" },
      { status: 0, stdout: `vx ${VX_URL}` },
      { status: 0, stdout: "✓ connected" },
    );

    const notes = smokeHermes(deps);

    expect(notes.join("\n")).toContain("Hermes Docker MCP test reports VX is connected");
    expect(notes.join("\n")).toContain("Hermes VX smoke ready");
  });

  it("supports Hermes Docker smoke without a host Hermes config", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "hermes-dashboard\n" },
      { status: 0, stdout: "Hermes Agent v0.14.0" },
      { status: 0, stdout: `vx ${VX_URL}` },
      { status: 0, stdout: "✓ connected" },
    );

    const notes = smokeHermes(deps);

    expect(notes.join("\n")).toContain("Hermes Docker MCP config lists the selected VX MCP endpoint");
    expect(notes.join("\n")).toContain("Hermes VX smoke ready");
  });

  it("supports a custom Hermes MCP server name for Docker smoke", () => {
    const deps = createDeps({ env: { VX_MCP_HERMES_SERVER_NAME: "vx-local" } });
    mockSpawn(
      deps,
      { status: 0, stdout: "hermes-dashboard\n" },
      { status: 0, stdout: "Hermes Agent v0.14.0" },
      { status: 0, stdout: "vx-local http://host.docker.intern..." },
      { status: 0, stdout: "Authorization: Bear***0000\n✓ connected" },
    );

    const notes = smokeHermes(deps);
    const calls = vi.mocked(deps.spawnSync).mock.calls;

    expect(notes.join("\n")).toContain("Hermes VX smoke ready");
    expect(notes.join("\n")).toContain("endpoint display may be truncated");
    expect(calls[3]?.[1]).toEqual([
      "exec",
      "hermes-dashboard",
      "sh",
      "-lc",
      "timeout 15 /opt/hermes/.venv/bin/hermes mcp test vx-local 2>&1",
    ]);
  });

  it("dispatches Hermes smoke from the CLI", async () => {
    const deps = createDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["smoke", "hermes"], deps);

    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("VX MCP smoke for Hermes");
    expect(output).toContain("Hermes VX smoke is not ready yet");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("dispatches login all for OpenClaw and Hermes", async () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      join(deps.homedir(), ".openclaw-dev", "openclaw.json"),
      JSON.stringify({ mcp: { servers: { vx: { url: VX_URL } } } }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // openclaw CLI lookup
      { status: 0, stdout: "/usr/bin/npx\n" },
      { status: 0, stdout: "Authenticated\n" },
      { status: 0, stdout: "/usr/bin/npx\n" },
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { tools: 5 } },
          tools: [
            "vx__vx_librarian_seed",
            "vx__vx_librarian_context",
            "vx__vx_reality",
            "vx__vx_recall",
            "vx__vx_store",
          ],
        }),
      },
      { status: 0, stdout: "Auth overview\nProviders w/ OAuth/tokens (1): openai" },
      { status: 0 }, // Hermes Docker helper
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["login", "all"], deps);

    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Started VX MCP login for OpenClaw");
    expect(output).toContain("Started VX MCP login for Hermes");
  });
});

describe("uninstallClaude", () => {
  it("does not crash when CLI is missing or slash command is absent", () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 1 });
    const notes = uninstallClaude(deps);
    expect(notes.join("\n")).toContain("Claude Code CLI was not found");
  });

  it("removes the user-scoped Claude Code MCP entry when the CLI is available", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/claude\n" },
      { status: 0 },
    );

    uninstallClaude(deps);

    expect(vi.mocked(deps.spawnSync).mock.calls[1]?.[1]).toEqual([
      "mcp",
      "remove",
      "--scope",
      "user",
      "vx",
    ]);
  });
});
