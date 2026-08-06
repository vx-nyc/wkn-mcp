import { describe, expect, it, vi } from "vitest";
import {
  buildCodexTomlBlock,
  buildCompartmentScopedUrl,
  buildHermesManagedBlock,
  buildOpenClawPluginConfig,
  buildStatusReport,
  CODEX_BLOCK_START,
  CODEX_BLOCK_END,
  detectClients,
  doctor,
  extractCompartment,
  formatDetectReport,
  getClientAccessStatus,
  getClientReadiness,
  HERMES_BLOCK_START,
  handleCli,
  installAll,
  installClaude,
  installClaudeDesktop,
  installCline,
  installCursor,
  installCodex,
  installHermes,
  installOpenClaw,
  installVsCode,
  installWindsurf,
  installZed,
  validateCompartmentName,
  removeClaudeDesktopVxEntry,
  removeClineVxEntry,
  removeCursorVxEntry,
  removeVsCodeVxEntry,
  removeWindsurfVxEntry,
  removeZedVxEntry,
  stripHermesManagedBlock,
  stripHermesServerBlock,
  stripCodexManagedBlock,
  smokeHermes,
  smokeOpenClaw,
  uninstallHermes,
  uninstallClaude,
  uninstallClaudeDesktop,
  uninstallCline,
  uninstallCodex,
  uninstallCursor,
  uninstallVsCode,
  uninstallWindsurf,
  uninstallZed,
  upsertCodexManagedBlock,
  upsertClaudeDesktopVxEntry,
  upsertClineVxEntry,
  upsertCursorVxEntry,
  upsertHermesManagedBlock,
  upsertVsCodeVxEntry,
  upsertWindsurfVxEntry,
  upsertZedVxEntry,
  type InstallerDeps,
} from "../src/installer.js";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    spawnSync: spawn,
    homedir: () => home,
    env: {},
    // Default to macOS so cross-platform config-path logic (Claude Desktop,
    // VS Code, Cline, Zed) is deterministic regardless of the CI runner's
    // actual OS. Tests exercising Windows/Linux paths override this.
    platform: "darwin",
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

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
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
    expect(block).toContain("    connect_timeout: 180");
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

  it("removes legacy Hermes vx server entries while preserving other MCP servers", () => {
    const current = [
      "theme: dark",
      "",
      "mcp_servers:",
      "  vx:",
      "    url: https://api.onememory.co/mcp",
      "    auth: oauth",
      "  vx-local:",
      "    url: http://host.docker.internal:3000/mcp",
      "  time:",
      "    command: \"uvx\"",
    ].join("\n");

    const stripped = stripHermesServerBlock(current);

    expect(stripped).not.toContain("  vx:\n");
    expect(stripped).not.toContain("https://api.onememory.co/mcp");
    expect(stripped).toContain("  vx-local:");
    expect(stripped).toContain("  time:");
  });

  it("upserts one managed Hermes vx block over legacy vx entries", () => {
    const current = [
      "mcp_servers:",
      "  vx:",
      "    url: https://api.onememory.co/mcp",
      "    auth: oauth",
      "  vx-local:",
      "    url: http://host.docker.internal:3000/mcp",
    ].join("\n");

    const next = upsertHermesManagedBlock(current);

    expect((next.match(/^  vx:$/gm) || []).length).toBe(1);
    expect(next).toContain("connect_timeout: 180");
    expect(next).toContain("  vx-local:");
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
    expect(config).toContain("connect_timeout: 180");
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
      { status: 0, stdout: "Applied 1 config update(s).\n" },
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
    expect(notes.join("\n")).toContain("Prepared OpenClaw for live VX turns");
    expect(notes.join("\n")).toContain("npx openclaw --dev mcp login vx");
    expect(notes.join("\n")).not.toContain("Add this to your OpenClaw plugin config");
    expect(vi.mocked(deps.spawnSync).mock.calls[3]?.[1]).toEqual([
      "-y",
      "openclaw",
      "--dev",
      "config",
      "patch",
      "--stdin",
    ]);
    expect(vi.mocked(deps.spawnSync).mock.calls[3]?.[2]).toMatchObject({
      input: expect.stringContaining("toolSearch"),
    });
  });

  it("runs `openclaw plugins install` when the CLI is available", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/openclaw\n" },
      { status: 0 },
      { status: 0 },
      { status: 0, stdout: "Applied 1 config update(s).\n" },
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
    expect(notes.join("\n")).toContain("Prepared OpenClaw for live VX turns");
    expect(vi.mocked(deps.spawnSync).mock.calls[3]?.[1]).toEqual([
      "config",
      "patch",
      "--stdin",
    ]);
    expect(vi.mocked(deps.spawnSync).mock.calls[3]?.[2]).toMatchObject({
      input: expect.stringContaining("group:plugins"),
    });
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

  it("reports OpenClaw OAuth tokens that are missing the VX API audience", () => {
    const deps = createDeps();
    const openclawDir = join(deps.homedir(), ".openclaw-dev");
    const configPath = join(openclawDir, "openclaw.json");
    mkdirSync(join(openclawDir, "mcp-oauth"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              vx: {
                url: VX_URL,
                transport: "streamable-http",
                auth: "oauth",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(openclawDir, "mcp-oauth", "vx-test-client.json"),
      JSON.stringify({
        tokens: {
          access_token: unsignedJwt({
            iss: "https://auth.onememory.co",
            aud: [],
            client_id: "test-client",
          }),
        },
      }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      {
        status: 0,
        stdout: JSON.stringify({
          generatedAt: "2026-06-12T15:53:19.305Z",
          servers: {},
          tools: [],
          diagnostics: [
            {
              serverName: "vx",
              message:
                "Error: Streamable HTTP error: Server returned 401 after successful authentication",
            },
          ],
        }),
      },
    );

    expect(getClientReadiness("openclaw", deps)).toMatchObject({
      label: "OpenClaw",
      status: "manual-approval",
      notes: expect.arrayContaining([
        expect.stringContaining("token audience is empty"),
        expect.stringContaining("MCP resource audience fix"),
        expect.stringContaining("vx-mcp login openclaw"),
        expect.stringContaining("https://api.onememory.co"),
        expect.stringContaining("401 after successful authentication"),
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
    expect(shellScript).toContain("_probe_single_server(name, server_config, connect_timeout=180)");
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

// ---------------------------------------------------------------------------
// New clients: Claude Desktop, Windsurf, Cline, VS Code, Zed
// ---------------------------------------------------------------------------

describe("Claude Desktop mcpServers upsert", () => {
  it("bridges through mcp-remote since Claude Desktop has no native HTTP transport", () => {
    const next = upsertClaudeDesktopVxEntry(null);
    expect(next.mcpServers?.vx).toEqual({
      command: "npx",
      args: ["-y", "mcp-remote", VX_URL],
    });
  });

  it("preserves other stdio servers when upserting vx", () => {
    const next = upsertClaudeDesktopVxEntry({
      mcpServers: { other: { command: "node", args: ["server.js"] } },
    });
    expect(next.mcpServers?.other).toEqual({ command: "node", args: ["server.js"] });
    expect(next.mcpServers?.vx).toBeDefined();
  });

  it("removeClaudeDesktopVxEntry deletes only the vx key", () => {
    const next = removeClaudeDesktopVxEntry({
      mcpServers: {
        other: { command: "node", args: ["server.js"] },
        vx: { command: "npx", args: ["-y", "mcp-remote", VX_URL] },
      },
    });
    expect(next.mcpServers?.other).toBeDefined();
    expect(next.mcpServers?.vx).toBeUndefined();
  });
});

describe("Windsurf mcpServers upsert", () => {
  it("uses serverUrl (Windsurf's field name for remote MCP)", () => {
    const next = upsertWindsurfVxEntry(null);
    expect(next.mcpServers?.vx).toEqual({ serverUrl: VX_URL });
  });

  it("removeWindsurfVxEntry deletes only the vx key", () => {
    const next = removeWindsurfVxEntry({
      mcpServers: { other: { serverUrl: "https://other.example/mcp" }, vx: { serverUrl: VX_URL } },
    });
    expect(next.mcpServers?.other).toBeDefined();
    expect(next.mcpServers?.vx).toBeUndefined();
  });
});

describe("Cline mcpServers upsert", () => {
  it('uses "streamableHttp" (camelCase) — anything else silently falls back to SSE in Cline', () => {
    const next = upsertClineVxEntry(null);
    expect(next.mcpServers?.vx).toEqual({ type: "streamableHttp", url: VX_URL });
  });

  it("removeClineVxEntry deletes only the vx key", () => {
    const next = removeClineVxEntry({
      mcpServers: {
        other: { type: "streamableHttp", url: "https://other.example/mcp" },
        vx: { type: "streamableHttp", url: VX_URL },
      },
    });
    expect(next.mcpServers?.other).toBeDefined();
    expect(next.mcpServers?.vx).toBeUndefined();
  });
});

describe("VS Code mcp.json upsert", () => {
  it('uses the "servers" top-level key, not "mcpServers"', () => {
    const next = upsertVsCodeVxEntry(null);
    expect(next.servers?.vx).toEqual({ type: "http", url: VX_URL });
    expect((next as Record<string, unknown>).mcpServers).toBeUndefined();
  });

  it("removeVsCodeVxEntry deletes only the vx key", () => {
    const next = removeVsCodeVxEntry({
      servers: { other: { type: "http", url: "https://other.example/mcp" }, vx: { type: "http", url: VX_URL } },
    });
    expect(next.servers?.other).toBeDefined();
    expect(next.servers?.vx).toBeUndefined();
  });
});

describe("Zed context_servers upsert", () => {
  it("writes a bare url with no headers so Zed runs its own OAuth flow", () => {
    const next = upsertZedVxEntry(null);
    expect(next.context_servers?.vx).toEqual({ url: VX_URL });
  });

  it("preserves unrelated top-level Zed settings (theme, vim_mode, ...)", () => {
    const next = upsertZedVxEntry({ theme: "One Dark", vim_mode: true });
    expect(next.theme).toBe("One Dark");
    expect(next.vim_mode).toBe(true);
    expect(next.context_servers?.vx).toEqual({ url: VX_URL });
  });

  it("removeZedVxEntry deletes only the vx key and preserves other settings", () => {
    const next = removeZedVxEntry({
      theme: "One Dark",
      context_servers: { other: { url: "https://other.example/mcp" }, vx: { url: VX_URL } },
    });
    expect(next.theme).toBe("One Dark");
    expect(next.context_servers?.other).toBeDefined();
    expect(next.context_servers?.vx).toBeUndefined();
  });
});

describe("installClaudeDesktop", () => {
  it("writes the mcp-remote bridge entry on macOS", () => {
    const deps = createDeps({ platform: "darwin" });
    const notes = installClaudeDesktop(deps);
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.mcpServers.vx).toEqual({ command: "npx", args: ["-y", "mcp-remote", VX_URL] });
    expect(notes.join("\n")).toContain("mcp-remote");
  });

  it("writes to %APPDATA%\\Claude on Windows", () => {
    const appData = mkdtempSync(join(tmpdir(), "vx-mcp-appdata-"));
    const deps = createDeps({ platform: "win32", env: { APPDATA: appData } });
    installClaudeDesktop(deps);
    const path = join(appData, "Claude", "claude_desktop_config.json");
    expect(existsSync(path)).toBe(true);
  });

  it("skips cleanly on Linux instead of guessing a path", () => {
    const deps = createDeps({ platform: "linux" });
    const notes = installClaudeDesktop(deps);
    expect(notes.join("\n")).toContain("skipping");
    expect(
      existsSync(join(deps.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")),
    ).toBe(false);
  });

  it("merges with an existing config instead of overwriting other servers", () => {
    const deps = createDeps();
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    mkdirSync(join(deps.homedir(), "Library", "Application Support", "Claude"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { other: { command: "node", args: ["s.js"] } } }),
      "utf8",
    );
    installClaudeDesktop(deps);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.mcpServers.other).toBeDefined();
    expect(parsed.mcpServers.vx).toBeDefined();
  });

  it("is idempotent across repeat installs", () => {
    const deps = createDeps();
    installClaudeDesktop(deps);
    installClaudeDesktop(deps);
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(parsed.mcpServers)).toEqual(["vx"]);
  });

  it("does not touch a config file it cannot parse as JSON", () => {
    const deps = createDeps();
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    mkdirSync(join(deps.homedir(), "Library", "Application Support", "Claude"), { recursive: true });
    writeFileSync(path, "{ not valid json", "utf8");
    const notes = installClaudeDesktop(deps);
    expect(readFileSync(path, "utf8")).toBe("{ not valid json");
    expect(notes.join("\n")).toContain("could not be parsed as JSON");
  });

  it("uninstall removes only the vx entry", () => {
    const deps = createDeps();
    installClaudeDesktop(deps);
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    const before = JSON.parse(readFileSync(path, "utf8"));
    before.mcpServers.other = { command: "node", args: ["s.js"] };
    writeFileSync(path, JSON.stringify(before), "utf8");

    uninstallClaudeDesktop(deps);
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.mcpServers.other).toBeDefined();
    expect(after.mcpServers.vx).toBeUndefined();
  });
});

describe("installWindsurf / installCline / installVsCode / installZed", () => {
  it("installWindsurf writes ~/.codeium/windsurf/mcp_config.json with serverUrl", () => {
    const deps = createDeps();
    installWindsurf(deps);
    const path = join(deps.homedir(), ".codeium", "windsurf", "mcp_config.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.mcpServers.vx).toEqual({ serverUrl: VX_URL });
  });

  it("installCline writes into the VS Code globalStorage path for saoudrizwan.claude-dev", () => {
    const deps = createDeps();
    installCline(deps);
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    );
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.mcpServers.vx).toEqual({ type: "streamableHttp", url: VX_URL });
  });

  it("installVsCode writes ~/.../Code/User/mcp.json under the servers key", () => {
    const deps = createDeps();
    installVsCode(deps);
    const path = join(deps.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.servers.vx).toEqual({ type: "http", url: VX_URL });
  });

  it("installZed writes ~/.config/zed/settings.json under context_servers", () => {
    const deps = createDeps();
    installZed(deps);
    const path = join(deps.homedir(), ".config", "zed", "settings.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.context_servers.vx).toEqual({ url: VX_URL });
  });

  it("installZed preserves unrelated settings and never corrupts a JSONC file with comments", () => {
    const deps = createDeps();
    const path = join(deps.homedir(), ".config", "zed", "settings.json");
    mkdirSync(join(deps.homedir(), ".config", "zed"), { recursive: true });
    const originalWithComments = '{\n  // a comment\n  "vim_mode": true\n}\n';
    writeFileSync(path, originalWithComments, "utf8");

    const notes = installZed(deps);

    expect(readFileSync(path, "utf8")).toBe(originalWithComments);
    expect(notes.join("\n")).toContain("could not be parsed as JSON");
    expect(notes.join("\n")).toContain(VX_URL);
  });

  it("uninstallWindsurf/Cline/VsCode/Zed each remove only the vx entry", () => {
    const deps = createDeps();
    installWindsurf(deps);
    installCline(deps);
    installVsCode(deps);
    installZed(deps);

    uninstallWindsurf(deps);
    uninstallCline(deps);
    uninstallVsCode(deps);
    uninstallZed(deps);

    const windsurfPath = join(deps.homedir(), ".codeium", "windsurf", "mcp_config.json");
    const clinePath = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    );
    const vsCodePath = join(deps.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
    const zedPath = join(deps.homedir(), ".config", "zed", "settings.json");

    expect(JSON.parse(readFileSync(windsurfPath, "utf8")).mcpServers.vx).toBeUndefined();
    expect(JSON.parse(readFileSync(clinePath, "utf8")).mcpServers.vx).toBeUndefined();
    expect(JSON.parse(readFileSync(vsCodePath, "utf8")).servers.vx).toBeUndefined();
    expect(JSON.parse(readFileSync(zedPath, "utf8")).context_servers.vx).toBeUndefined();
  });

  it("uninstall is a no-op that reports nothing-to-remove when never installed", () => {
    const deps = createDeps();
    const notes = uninstallWindsurf(deps);
    expect(notes.join("\n")).toContain("nothing to remove");
  });
});

describe("cross-platform config path resolution", () => {
  it("VS Code / Cline resolve under %APPDATA%\\Code\\User on Windows", () => {
    const appData = mkdtempSync(join(tmpdir(), "vx-mcp-appdata-"));
    const deps = createDeps({ platform: "win32", env: { APPDATA: appData } });
    installVsCode(deps);
    installCline(deps);
    expect(existsSync(join(appData, "Code", "User", "mcp.json"))).toBe(true);
    expect(
      existsSync(
        join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
      ),
    ).toBe(true);
  });

  it("VS Code / Cline resolve under ~/.config/Code/User on Linux", () => {
    const deps = createDeps({ platform: "linux" });
    installVsCode(deps);
    expect(existsSync(join(deps.homedir(), ".config", "Code", "User", "mcp.json"))).toBe(true);
  });

  it("Zed resolves under %APPDATA%\\Zed on Windows", () => {
    const appData = mkdtempSync(join(tmpdir(), "vx-mcp-appdata-"));
    const deps = createDeps({ platform: "win32", env: { APPDATA: appData } });
    installZed(deps);
    expect(existsSync(join(appData, "Zed", "settings.json"))).toBe(true);
  });

  it("Zed respects XDG_CONFIG_HOME on Linux", () => {
    const xdg = mkdtempSync(join(tmpdir(), "vx-mcp-xdg-"));
    const deps = createDeps({ platform: "linux", env: { XDG_CONFIG_HOME: xdg } });
    installZed(deps);
    expect(existsSync(join(xdg, "zed", "settings.json"))).toBe(true);
  });

  it("Windsurf resolves the same ~/.codeium/windsurf path on every platform", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const deps = createDeps({ platform });
      installWindsurf(deps);
      expect(existsSync(join(deps.homedir(), ".codeium", "windsurf", "mcp_config.json"))).toBe(true);
    }
  });
});

describe("--dry-run", () => {
  it("installCursor --dry-run writes nothing and shows a diff preview", () => {
    const deps = createDeps();
    const path = join(deps.homedir(), ".cursor", "mcp.json");
    const notes = installCursor(deps, { dryRun: true });
    expect(existsSync(path)).toBe(false);
    expect(notes.join("\n")).toContain("[dry-run]");
    expect(notes.join("\n")).toContain(VX_URL);
  });

  it("installClaudeDesktop --dry-run writes nothing but previews the exact diff against an existing file", () => {
    const deps = createDeps();
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    mkdirSync(join(deps.homedir(), "Library", "Application Support", "Claude"), { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "node", args: [] } } }), "utf8");
    const before = readFileSync(path, "utf8");

    const notes = installClaudeDesktop(deps, { dryRun: true });

    expect(readFileSync(path, "utf8")).toBe(before);
    expect(notes.join("\n")).toContain("[dry-run] Would update");
    expect(notes.join("\n")).toContain("+");
  });

  it("a second dry-run after a real install reports no changes needed", () => {
    const deps = createDeps();
    installWindsurf(deps);
    const notes = installWindsurf(deps, { dryRun: true });
    expect(notes.join("\n")).toContain("already reflects the selected VX MCP endpoint");
  });

  it("uninstallCodex --dry-run leaves the managed block in place", () => {
    const deps = createDeps();
    installCodex(deps);
    const configPath = join(deps.homedir(), ".codex", "config.toml");
    const before = readFileSync(configPath, "utf8");

    const notes = uninstallCodex(deps, { dryRun: true });

    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(notes.join("\n")).toContain("[dry-run]");
  });

  it("installClaude --dry-run does not call the Claude CLI and does not copy the slash command", () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 0, stdout: "/usr/local/bin/claude\n" });
    const notes = installClaude(deps, { dryRun: true });
    const commandPath = join(deps.homedir(), ".claude", "commands", "vx-memory.md");

    expect(existsSync(commandPath)).toBe(false);
    expect(vi.mocked(deps.spawnSync)).toHaveBeenCalledTimes(1); // only the findCli lookup
    expect(notes.join("\n")).toContain("[dry-run] Would run: claude mcp add");
  });

  it("does not show an entire file as changed just because it uses different JSON formatting than our canonical output", () => {
    // Regression test: a real-world config file (different indentation, key
    // order, no vx key yet) must produce a diff that isolates the actual
    // change, not a full-file rewrite, even though we always *write*
    // canonically re-serialized JSON.
    const deps = createDeps();
    const path = join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    mkdirSync(join(deps.homedir(), "Library", "Application Support", "Claude"), { recursive: true });
    const differentlyFormatted =
      '{\n    "mcpServers": {\n        "other": {"command": "node", "args": ["s.js"]}\n    },\n    "somePreference": true\n}\n';
    writeFileSync(path, differentlyFormatted, "utf8");

    const notes = installClaudeDesktop(deps, { dryRun: true }).join("\n");

    // The unrelated preference line must NOT appear as a removed/re-added line.
    expect(notes).not.toContain('- "somePreference": true');
    expect(notes).not.toContain('+ "somePreference": true');
    // But the new vx entry must show up as an addition.
    expect(notes).toContain("+     \"vx\": {");
  });

  it("a real (non-dry-run) install that changes nothing semantically does not rewrite/reformat the file", () => {
    const deps = createDeps();
    const path = join(deps.homedir(), ".codeium", "windsurf", "mcp_config.json");
    mkdirSync(join(deps.homedir(), ".codeium", "windsurf"), { recursive: true });
    // Already has the correct vx entry, but hand-formatted differently than
    // our canonical 2-space output (single line, no trailing newline).
    const handFormatted = `{"mcpServers":{"vx":{"serverUrl":"${VX_URL}"}}}`;
    writeFileSync(path, handFormatted, "utf8");

    installWindsurf(deps, { dryRun: false });

    expect(readFileSync(path, "utf8")).toBe(handFormatted);
  });

  it("handleCli forwards --dry-run through install/uninstall regardless of flag position", async () => {
    const deps = createDeps();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["install", "cursor", "--dry-run"], deps);
    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(false);

    await handleCli(["--dry-run", "install", "cursor"], deps);
    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(false);
  });
});

describe("detectClients", () => {
  it("reports installed: false with no evidence when nothing is found", () => {
    const deps = createDeps();
    mockSpawn(deps, ...Array(20).fill({ status: 1 }));
    const detections = detectClients(deps);
    const windsurf = detections.find((d) => d.target === "windsurf");
    expect(windsurf).toMatchObject({ installed: false, evidence: [] });
  });

  it("detects a client from a CLI on PATH", () => {
    const deps = createDeps();
    // Detection issues several `command -v <binary>` probes across targets;
    // respond based on which binary is being checked rather than call order.
    vi.mocked(deps.spawnSync).mockImplementation((_cmd, args) => {
      const script = String((args as string[] | undefined)?.at(-1) ?? "");
      const found = script.includes("command -v codex");
      return {
        status: found ? 0 : 1,
        stdout: found ? "/usr/local/bin/codex\n" : "",
        stderr: "",
        pid: 1,
        output: [],
        signal: null,
      };
    });
    const detections = detectClients(deps);
    const codex = detections.find((d) => d.target === "codex");
    expect(codex?.installed).toBe(true);
    expect(codex?.evidence.join("\n")).toContain("codex");
    expect(detections.find((d) => d.target === "claude")?.installed).toBe(false);
  });

  it("detects a client from an existing config directory even without a CLI", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".cursor"), { recursive: true });
    mockSpawn(deps, ...Array(20).fill({ status: 1 }));
    const detections = detectClients(deps);
    const cursor = detections.find((d) => d.target === "cursor");
    expect(cursor?.installed).toBe(true);
  });

  it("returns one detection per supported client target", () => {
    const deps = createDeps();
    mockSpawn(deps, ...Array(20).fill({ status: 1 }));
    const detections = detectClients(deps);
    expect(detections.map((d) => d.target).sort()).toEqual(
      [
        "claude",
        "claude-desktop",
        "cline",
        "codex",
        "cursor",
        "hermes",
        "openclaw",
        "vscode",
        "windsurf",
        "zed",
      ].sort(),
    );
  });

  it("formatDetectReport counts found tools and suggests connecting them", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".cursor"), { recursive: true });
    mockSpawn(deps, ...Array(20).fill({ status: 1 }));
    const report = formatDetectReport(detectClients(deps)).join("\n");
    expect(report).toMatch(/Detected \d+ of \d+ supported AI tools/);
    expect(report).toContain("Cursor: found");
    expect(report).toContain("vx-mcp install cursor");
  });
});

describe("getClientReadiness for new clients", () => {
  it("reports needs-install before installing", () => {
    const deps = createDeps();
    expect(getClientReadiness("windsurf", deps)).toMatchObject({ status: "needs-install" });
    expect(getClientReadiness("vscode", deps)).toMatchObject({ status: "needs-install" });
  });

  it("reports ready once installed, and re-reads live state (no caching)", () => {
    const deps = createDeps();
    installVsCode(deps);
    expect(getClientReadiness("vscode", deps)).toMatchObject({ status: "ready" });

    // Simulate the client rewriting its own config on an update and losing
    // the vx entry — doctor must notice on the very next call.
    const path = join(deps.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
    writeFileSync(path, JSON.stringify({ servers: {} }), "utf8");
    expect(getClientReadiness("vscode", deps)).toMatchObject({ status: "needs-install" });
  });

  it("reports unsupported for Claude Desktop on Linux instead of a wrong path", () => {
    const deps = createDeps({ platform: "linux" });
    expect(getClientReadiness("claude-desktop", deps)).toMatchObject({ status: "unsupported" });
  });
});

describe("handleCli detect", () => {
  it("prints a human-readable report by default", async () => {
    const deps = createDeps();
    mockSpawn(deps, ...Array(20).fill({ status: 1 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["detect"], deps);
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/Detected \d+ of \d+ supported AI tools/);
  });

  it("prints machine-readable JSON with --json", async () => {
    const deps = createDeps();
    mockSpawn(deps, ...Array(20).fill({ status: 1 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["detect", "--json"], deps);
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("target");
    expect(parsed[0]).toHaveProperty("installed");
  });
});

describe("install all includes every new client", () => {
  it("wires Claude Desktop, Windsurf, Cline, Zed, and VS Code alongside the existing clients", () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 1 }, { status: 1 });

    const notes = installAll(deps).join("\n");

    expect(existsSync(join(deps.homedir(), ".codeium", "windsurf", "mcp_config.json"))).toBe(true);
    expect(existsSync(join(deps.homedir(), ".config", "zed", "settings.json"))).toBe(true);
    expect(
      existsSync(join(deps.homedir(), "Library", "Application Support", "Code", "User", "mcp.json")),
    ).toBe(true);
    expect(notes).toContain("Claude Desktop");
    expect(notes).toContain("Windsurf");
    expect(notes).toContain("Cline");
    expect(notes).toContain("Zed");
    expect(notes).toContain("VS Code + Copilot");
  });
});

describe("compartment helpers (ONE-118)", () => {
  it("validateCompartmentName rejects missing, blank, and invalid names", () => {
    expect(validateCompartmentName(undefined)).toMatchObject({ ok: false });
    expect(validateCompartmentName("")).toMatchObject({ ok: false });
    expect(validateCompartmentName("   ")).toMatchObject({ ok: false });
    expect(validateCompartmentName("bad name!")).toMatchObject({ ok: false });
    expect(validateCompartmentName("has space")).toMatchObject({ ok: false });
  });

  it("validateCompartmentName accepts simple and hierarchical names", () => {
    expect(validateCompartmentName("personal")).toEqual({ ok: true, name: "personal" });
    expect(validateCompartmentName("work/deal-room")).toEqual({
      ok: true,
      name: "work/deal-room",
    });
    expect(validateCompartmentName("  personal  ")).toEqual({ ok: true, name: "personal" });
  });

  it("buildCompartmentScopedUrl appends the compartment query param", () => {
    expect(buildCompartmentScopedUrl(VX_URL, "personal")).toBe(`${VX_URL}?compartment=personal`);
  });

  it("buildCompartmentScopedUrl throws rather than ever producing an unscoped URL", () => {
    expect(() => buildCompartmentScopedUrl(VX_URL, "")).toThrow();
    expect(() => buildCompartmentScopedUrl(VX_URL, "   ")).toThrow();
  });

  it("extractCompartment round-trips through buildCompartmentScopedUrl, including hierarchical names", () => {
    const scoped = buildCompartmentScopedUrl(VX_URL, "work/deal-room");
    expect(extractCompartment(scoped)).toBe("work/deal-room");
  });

  it("extractCompartment returns null for an unscoped URL or garbage input", () => {
    expect(extractCompartment(VX_URL)).toBeNull();
    expect(extractCompartment(null)).toBeNull();
    expect(extractCompartment(undefined)).toBeNull();
    expect(extractCompartment("not a url")).toBeNull();
  });
});

describe("handleCli connect", () => {
  it("refuses to write any config when --compartment is missing", async () => {
    const deps = createDeps();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["connect", "cursor"], deps);

    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(false);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "there is no unscoped default",
    );
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("refuses to write any config when --compartment is blank", async () => {
    const deps = createDeps();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["connect", "cursor", "--compartment", "   "], deps);

    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(false);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("refuses an invalid compartment name without writing anything", async () => {
    const deps = createDeps();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["connect", "cursor", "--compartment", "bad name!"], deps);

    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(false);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("Invalid compartment name");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("writes a compartment-scoped URL for a JSON client and reports success", async () => {
    const deps = createDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;

    await handleCli(["connect", "cursor", "--compartment", "personal"], deps);

    const parsed = JSON.parse(readFileSync(join(deps.homedir(), ".cursor", "mcp.json"), "utf8"));
    expect(parsed.mcpServers.vx).toEqual({ type: "http", url: `${VX_URL}?compartment=personal` });
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      'Connected Cursor scoped to compartment "personal"',
    );
    expect(process.exitCode).toBe(undefined);
  });

  it("supports hierarchical compartment names end to end", async () => {
    const deps = createDeps();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["connect", "cursor", "--compartment", "work/deal-room"], deps);

    const parsed = JSON.parse(readFileSync(join(deps.homedir(), ".cursor", "mcp.json"), "utf8"));
    expect(extractCompartment(parsed.mcpServers.vx.url)).toBe("work/deal-room");
  });

  it("changing the compartment later just re-runs connect with the new name", async () => {
    const deps = createDeps();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["connect", "cursor", "--compartment", "personal"], deps);
    await handleCli(["connect", "cursor", "--compartment", "work"], deps);

    const parsed = JSON.parse(readFileSync(join(deps.homedir(), ".cursor", "mcp.json"), "utf8"));
    expect(extractCompartment(parsed.mcpServers.vx.url)).toBe("work");
    // Idempotent: still exactly one vx entry, no duplicates.
    expect(Object.keys(parsed.mcpServers)).toEqual(["vx"]);
  });

  it("--dry-run previews a connect without writing anything", async () => {
    const deps = createDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["connect", "cursor", "--compartment", "personal", "--dry-run"], deps);

    expect(existsSync(join(deps.homedir(), ".cursor", "mcp.json"))).toBe(false);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("[dry-run] Would create");
  });

  it("rejects an unknown connect target", async () => {
    const deps = createDeps();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["connect", "not-a-client", "--compartment", "personal"], deps);

    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("Unknown target");
  });

  it("scopes Claude Code's `claude mcp add` URL to the compartment", async () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/claude\n" }, // findCli
      { status: 0 }, // mcp remove (pre-flight cleanup)
      { status: 0 }, // mcp add
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCli(["connect", "claude", "--compartment", "personal"], deps);

    const calls = vi.mocked(deps.spawnSync).mock.calls;
    const addArgs = calls[2]?.[1] ?? [];
    expect(addArgs).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      "vx",
      `${VX_URL}?compartment=personal`,
    ]);
  });

  it("scopes OpenClaw's mcp add through npx to the compartment", async () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(join(deps.homedir(), ".openclaw-dev", "openclaw.json"), "{}\n", "utf8");
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      { status: 0, stdout: "Saved MCP server vx\n" },
      { status: 0, stdout: "Applied 1 config update(s).\n" },
    );

    const notes = installOpenClaw(deps, { compartment: "personal" });

    expect(vi.mocked(deps.spawnSync).mock.calls[2]?.[1]).toEqual([
      "-y",
      "openclaw",
      "--dev",
      "mcp",
      "add",
      "vx",
      "--url",
      `${VX_URL}?compartment=personal`,
      "--transport",
      "streamable-http",
      "--auth",
      "oauth",
      "--include",
      "vx_librarian_seed,vx_librarian_context,vx_reality,vx_recall,vx_store",
      "--no-probe",
    ]);
    expect(notes.join("\n")).toContain("Configured OpenClaw VX MCP through npx");
  });

  it("scopes OpenClaw's connection when its CLI is already on PATH", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/openclaw\n" }, // findCli
      { status: 0 }, // plugins install
      { status: 0 }, // mcp tools --include
      { status: 0 }, // mcp add --url <scoped>
      { status: 0, stdout: "Applied 1 config update(s).\n" }, // config patch --stdin
    );

    const notes = installOpenClaw(deps, { compartment: "work" });

    const calls = vi.mocked(deps.spawnSync).mock.calls;
    expect(calls[3]?.[1]).toEqual([
      "mcp",
      "add",
      "vx",
      "--url",
      `${VX_URL}?compartment=work`,
      "--transport",
      "streamable-http",
      "--auth",
      "oauth",
      "--include",
      "vx_librarian_seed,vx_librarian_context,vx_reality,vx_recall,vx_store",
      "--no-probe",
    ]);
    expect(notes.join("\n")).toContain('Bound OpenClaw\'s VX MCP connection to compartment "work"');
  });

  it("does not change OpenClaw's CLI-present install path when no compartment is requested", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/openclaw\n" },
      { status: 0 },
      { status: 0 },
      { status: 0, stdout: "Applied 1 config update(s).\n" },
    );

    installOpenClaw(deps);

    // Exactly the same 4 calls as the pre-compartment behavior: no extra
    // `mcp add` call is introduced when `install` (not `connect`) is used.
    expect(vi.mocked(deps.spawnSync).mock.calls.length).toBe(4);
  });
});

describe("compartment-scoped readiness (ONE-118 regression guard)", () => {
  it("still reports Cursor ready when connected with a compartment-scoped URL", () => {
    const deps = createDeps();
    installCursor(deps, { compartment: "personal" });
    expect(getClientReadiness("cursor", deps)).toMatchObject({ status: "ready" });
  });

  it("still reports OpenClaw's config as pointing at the selected endpoint when compartment-scoped", () => {
    const deps = createDeps();
    mkdirSync(join(deps.homedir(), ".openclaw-dev"), { recursive: true });
    writeFileSync(
      join(deps.homedir(), ".openclaw-dev", "openclaw.json"),
      JSON.stringify({
        mcp: { servers: { vx: { url: `${VX_URL}?compartment=personal`, auth: "oauth" } } },
      }),
      "utf8",
    );
    mockSpawn(
      deps,
      { status: 1 }, // openclaw CLI lookup
      { status: 1 }, // npx lookup (readiness falls back to manual-approval, not a mismatch)
    );
    const readiness = getClientReadiness("openclaw", deps);
    expect(readiness.notes.join("\n")).not.toContain("but it points at");
  });
});

describe("status (ONE-118)", () => {
  it("reports every client as not connected on a clean machine", () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 1 }); // `claude` CLI lookup, not found
    for (const target of [
      "claude",
      "cursor",
      "codex",
      "openclaw",
      "hermes",
      "claude-desktop",
      "windsurf",
      "cline",
      "zed",
      "vscode",
    ] as const) {
      expect(getClientAccessStatus(target, deps)).toMatchObject({ connected: false, compartment: null });
    }
  });

  it("reads the compartment back from a client connected through `connect`", () => {
    const deps = createDeps();
    installCursor(deps, { compartment: "personal" });
    expect(getClientAccessStatus("cursor", deps)).toMatchObject({
      connected: true,
      compartment: "personal",
    });
  });

  it("flags a plain `install` (no compartment) as connected but unscoped", () => {
    const deps = createDeps();
    installWindsurf(deps);
    expect(getClientAccessStatus("windsurf", deps)).toMatchObject({
      connected: true,
      compartment: null,
    });
  });

  it("buildStatusReport prints a compartment line for scoped clients and an UNSCOPED warning for legacy ones", () => {
    const deps = createDeps();
    installCursor(deps, { compartment: "personal" });
    installWindsurf(deps);
    mockSpawn(deps, { status: 1 }); // `claude` CLI lookup, not found
    const report = buildStatusReport(deps).join("\n");
    expect(report).toContain('Cursor: connected — compartment "personal"');
    expect(report).toContain("Windsurf: connected — UNSCOPED");
    expect(report).toContain("vx-mcp connect windsurf --compartment <name>");
    expect(report).toContain("Claude Code: not connected");
  });

  it("reads the compartment back for every client type after connect", () => {
    const deps = createDeps();
    // 3 calls to install Claude (findCli, mcp remove, mcp add), then 2 more
    // for getClientAccessStatus("claude", ...) below (findCli, mcp list) —
    // Claude Code's own state is opaque to vx-mcp, so status must re-query
    // `claude mcp list` exactly like readiness does.
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/claude\n" },
      { status: 0 },
      { status: 0 },
      { status: 0, stdout: "/usr/local/bin/claude\n" },
      { status: 0, stdout: `vx: ${VX_URL}?compartment=claude-scope (HTTP) - ✓ Connected\n` },
    );
    installClaude(deps, { compartment: "claude-scope" });
    installCodex(deps, { compartment: "codebase" });
    installHermes(deps, { compartment: "hermes-scope" });
    installClaudeDesktop(deps, { compartment: "desktop" });

    expect(getClientAccessStatus("claude", deps)).toMatchObject({ compartment: "claude-scope" });
    expect(getClientAccessStatus("codex", deps)).toMatchObject({ compartment: "codebase" });
    expect(getClientAccessStatus("hermes", deps)).toMatchObject({ compartment: "hermes-scope" });
    expect(getClientAccessStatus("claude-desktop", deps)).toMatchObject({ compartment: "desktop" });
  });

  it("status reverses fully after uninstall", async () => {
    const deps = createDeps();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["connect", "cursor", "--compartment", "personal"], deps);
    expect(getClientAccessStatus("cursor", deps).connected).toBe(true);

    await handleCli(["uninstall", "cursor"], deps);
    expect(getClientAccessStatus("cursor", deps)).toMatchObject({ connected: false, compartment: null });
  });

  it("`vx-mcp status` CLI command prints the report", async () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 1 }); // `claude` CLI lookup, not found
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(["status"], deps);
    const output = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("VX MCP per-client access");
  });
});
