import { describe, expect, it, vi } from "vitest";
import {
  buildCodexTomlBlock,
  buildOpenClawPluginConfig,
  CODEX_BLOCK_START,
  CODEX_BLOCK_END,
  handleCli,
  installAll,
  installClaude,
  installCursor,
  installCodex,
  installOpenClaw,
  removeCursorVxEntry,
  stripCodexManagedBlock,
  uninstallClaude,
  uninstallCodex,
  uninstallCursor,
  upsertCodexManagedBlock,
  upsertCursorVxEntry,
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

describe("installOpenClaw", () => {
  it("falls back to manual instructions when the CLI is missing", () => {
    const deps = createDeps();
    mockSpawn(deps, { status: 1 });
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
    expect(notes).toContain("openclaw plugins install @vx-nyc/vx-mcp");
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
