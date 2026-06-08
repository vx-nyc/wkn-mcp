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
    expect(config).toContain('X-Counterparty-Client: "hermes"');
    expect(notes.join("\n")).toContain("Restart Hermes Agent");
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
      { status: 1 }, // command -v npx
    );
    const notes = installOpenClaw(deps);
    expect(notes.join("\n")).toContain("openclaw plugins install @vx-nyc/vx-mcp");
    expect(notes.join("\n")).toContain(VX_URL);
  });

  it("runs `openclaw plugins install` when the CLI is available", () => {
    const deps = createDeps();
    mockSpawn(
      deps,
      { status: 0, stdout: "/usr/local/bin/openclaw\n" },
      { status: 0 },
    );
    const notes = installOpenClaw(deps);
    expect(vi.mocked(deps.spawnSync).mock.calls[1]?.[1]).toEqual([
      "plugins",
      "install",
      "@vx-nyc/vx-mcp",
    ]);
    expect(notes.join("\n")).toContain("Installed the VX plugin for OpenClaw");
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
        expect.stringContaining("MCP config lists the hosted VX endpoint"),
        expect.stringContaining("OAuth is not complete"),
        expect.stringContaining("401 Unauthorized"),
        expect.stringContaining("Host Hermes executable is not usable"),
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
                url: "http://localhost:3000/mcp",
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
        expect.stringContaining("http://localhost:3000/mcp"),
        expect.stringContaining("OpenClaw CLI is not on PATH"),
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
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { launch: "http://localhost:3000/mcp", tools: 23 } },
          tools: Array.from({ length: 23 }, (_, index) => `vx__tool_${index}`),
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
        expect.stringContaining("npx OpenClaw MCP probe discovered 23 tools"),
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
    mockSpawn(
      deps,
      { status: 1 }, // command -v openclaw
      { status: 0, stdout: "/usr/bin/npx\n" }, // command -v npx
      {
        status: 0,
        stdout: JSON.stringify({
          servers: { vx: { launch: "http://localhost:3000/mcp", tools: 23 } },
          tools: Array.from({ length: 23 }, (_, index) => `vx__tool_${index}`),
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
        expect.stringContaining("npx OpenClaw MCP probe discovered 23 tools"),
        expect.stringContaining("model auth appears configured"),
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
    expect(output).toContain("vx_librarian_context");
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
