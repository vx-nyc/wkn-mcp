import { describe, expect, it, vi } from "vitest";
import {
  buildClaudeMcpConfigObject,
  buildClientInstallArtifact,
  buildCodexTomlBlock,
  buildCursorDeeplink,
  buildCursorMcpConfigObject,
  buildOpenClawPluginConfigObject,
  buildOpenCodeConfigObject,
  CODEX_BLOCK_START,
  getInstallEnv,
  getPackagedLauncher,
  handleCli,
  installClaude,
  installOpenClaw,
  stripCodexManagedBlock,
  upsertCodexManagedBlock,
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
    env: {
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_API_KEY: "test-api-key",
      VX_NAME: "VX",
    },
    ...overrides,
  };

  return deps;
}

describe("installer helpers", () => {
  it("builds packaged Claude config with canonical env names", () => {
    const config = buildClaudeMcpConfigObject(
      getPackagedLauncher(),
      getInstallEnv("claude", {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_BEARER_TOKEN: "vx-token",
        VX_NAME: "VX",
      })
    );

    expect(config.command).toBe("npx");
    expect(config.args).toEqual(["-y", "@vesselnyc/mcp-server@latest", "mcp"]);
    expect(config.env).toEqual({
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_BEARER_TOKEN: "vx-token",
      VX_NAME: "VX",
      VX_SOURCE: "claude-code",
    });
    expect(config.env).not.toHaveProperty("VX_API_URL");
  });

  it("omits blank credentials from generated install env", () => {
    const env = getInstallEnv("codex", {
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_NAME: "VX",
    });

    expect(env).toEqual({
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_NAME: "VX",
      VX_SOURCE: "codex",
    });
  });

  it("supports additional host source tags beyond Claude, Codex, and Cursor", () => {
    const env = getInstallEnv("windsurf", {
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_NAME: "VX",
    });

    expect(env).toEqual({
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_NAME: "VX",
      VX_SOURCE: "windsurf",
    });
  });

  it("builds Codex TOML with packaged command and canonical env names", () => {
    const block = buildCodexTomlBlock(
      getPackagedLauncher(),
      getInstallEnv("codex", {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_API_KEY: "test-api-key",
        VX_NAME: "VX",
      })
    );

    expect(block).toContain('command = "npx"');
    expect(block).toContain('args = ["-y", "@vesselnyc/mcp-server@latest", "mcp"]');
    expect(block).toContain('VX_API_BASE_URL = "https://api.vx.dev/v1"');
    expect(block).toContain('VX_API_KEY = "test-api-key"');
    expect(block).toContain('VX_NAME = "VX"');
    expect(block).toContain('VX_SOURCE = "codex"');
    expect(block).not.toContain("VX_API_URL");
  });

  it("builds a Cursor deeplink with the expected packaged MCP config", () => {
    const env = getInstallEnv("cursor", {
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_API_KEY: "test-api-key",
      VX_NAME: "VX",
    });
    const deeplink = buildCursorDeeplink("vx", getPackagedLauncher(), env);
    const parsed = new URL(deeplink);
    const encodedConfig = parsed.searchParams.get("config");

    expect(parsed.protocol).toBe("cursor:");
    expect(parsed.hostname).toBe("anysphere.cursor-deeplink");
    expect(parsed.pathname).toBe("/mcp/install");
    expect(parsed.searchParams.get("name")).toBe("vx");
    expect(encodedConfig).toBeTruthy();

    const config = JSON.parse(
      Buffer.from(encodedConfig!, "base64").toString("utf8")
    );

    expect(config).toEqual(buildCursorMcpConfigObject(getPackagedLauncher(), env));
    expect(config.env).toEqual({
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_API_KEY: "test-api-key",
      VX_NAME: "VX",
      VX_SOURCE: "cursor",
    });
  });

  it("builds an OpenCode config with a local command array", () => {
    const config = buildOpenCodeConfigObject(
      getInstallEnv("opencode", {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_API_KEY: "test-api-key",
        VX_NAME: "VX",
      })
    );

    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.mcp.vx.command).toEqual(["npx", "-y", "@vesselnyc/mcp-server@latest", "mcp"]);
    expect(config.mcp.vx.env.VX_SOURCE).toBe("opencode");
  });

  it("builds an OpenClaw-compatible plugin config", () => {
    const config = buildOpenClawPluginConfigObject(
      getInstallEnv("openclaw", {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_BEARER_TOKEN: "vx-token",
        VX_NAME: "VX",
      })
    );

    expect(config.plugins.entries["vx-memory"].enabled).toBe(true);
    expect(config.plugins.entries["vx-memory"].config).toMatchObject({
      apiBaseUrl: "https://api.vx.dev/v1",
      bearerToken: "vx-token",
      source: "openclaw",
      name: "VX",
      maxTokens: 4000,
    });
  });

  it("builds install artifacts for command-based clients", () => {
    const artifact = buildClientInstallArtifact("amp", getInstallEnv("amp", {
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_API_KEY: "test-api-key",
      VX_NAME: "VX",
    }));

    expect(artifact.kind).toBe("shell");
    expect(artifact.content).toBe("amp mcp add vx -- npx -y @vesselnyc/mcp-server@latest mcp");
  });

  it("keeps the Codex managed block idempotent", () => {
    const block = buildCodexTomlBlock();
    const once = upsertCodexManagedBlock("model = \"gpt-5\"", block);
    const twice = upsertCodexManagedBlock(once, block);

    expect((twice.match(new RegExp(CODEX_BLOCK_START, "g")) || []).length).toBe(1);
    expect(stripCodexManagedBlock(twice)).toBe('model = "gpt-5"');
  });

  it("prints a generated config snippet for config targets", async () => {
    const deps = createDeps({
      env: {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_API_KEY: "test-api-key",
        VX_NAME: "VX",
      },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const handled = await handleCli(["config", "windsurf"], deps);

    expect(handled).toBe(true);
    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      '"VX_SOURCE": "windsurf"'
    );
  });
});

describe("installClaude", () => {
  it("installs the slash command and skips MCP registration when the CLI is missing", () => {
    const deps = createDeps();
    vi.mocked(deps.spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const notes = installClaude(deps);
    const slashCommandPath = join(deps.homedir(), ".claude", "commands", "vx-memory.md");

    expect(existsSync(slashCommandPath)).toBe(true);
    expect(notes.join("\n")).toContain("MCP registration was skipped");
  });

  it("warns when no VX credentials are present during install", () => {
    const deps = createDeps({
      env: {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_NAME: "VX",
      },
    });
    vi.mocked(deps.spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const notes = installClaude(deps);
    expect(notes.join("\n")).toContain("No VX credential was found");
  });

  it("registers the packaged MCP server when the Claude CLI is available", () => {
    const deps = createDeps();
    vi.mocked(deps.spawnSync)
      .mockReturnValueOnce({
        status: 0,
        stdout: "/usr/local/bin/claude\n",
        stderr: "",
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
        stderr: "",
        pid: 2,
        output: [],
        signal: null,
      });

    const notes = installClaude(deps);
    const claudeArgs = vi.mocked(deps.spawnSync).mock.calls[1]?.[1] ?? [];
    const parsedConfig = JSON.parse(String(claudeArgs[5] ?? "{}"));

    expect(notes.join("\n")).toContain("Registered the packaged VX MCP server");
    expect(claudeArgs.slice(0, 5)).toEqual([
      "mcp",
      "add-json",
      "--scope",
      "user",
      "vx",
    ]);
    expect(parsedConfig).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@vesselnyc/mcp-server@latest", "mcp"],
      env: {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_API_KEY: "test-api-key",
        VX_NAME: "VX",
        VX_SOURCE: "claude-code",
      },
    });
  });
});

describe("installOpenClaw", () => {
  it("falls back to manual install instructions when the CLI is missing", () => {
    const deps = createDeps();
    vi.mocked(deps.spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const notes = installOpenClaw(deps);
    expect(notes.join("\n")).toContain("automatic plugin installation was skipped");
    expect(notes.join("\n")).toContain('"source": "openclaw"');
  });

  it("runs the plugin install command when the OpenClaw CLI is available", () => {
    const deps = createDeps();
    vi.mocked(deps.spawnSync)
      .mockReturnValueOnce({
        status: 0,
        stdout: "/usr/local/bin/openclaw\n",
        stderr: "",
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
        stderr: "",
        pid: 2,
        output: [],
        signal: null,
      });

    const notes = installOpenClaw(deps);

    expect(notes.join("\n")).toContain("Installed the VX plugin for OpenClaw");
    expect(vi.mocked(deps.spawnSync).mock.calls[1]?.[1]).toEqual([
      "plugins",
      "install",
      "@vesselnyc/mcp-server@latest",
    ]);
    expect(notes.join("\n")).toContain('"storeOnRequestOnly": false');
  });
});
