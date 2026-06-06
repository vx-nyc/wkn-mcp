import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VX_MCP_SERVER_NAME,
  VX_MCP_URL,
  VX_PACKAGE_NAME,
} from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CODEX_BLOCK_START = "# BEGIN VX MCP";
export const CODEX_BLOCK_END = "# END VX MCP";

export type SupportedClientTarget =
  | "claude"
  | "cursor"
  | "codex"
  | "openclaw";

export const SUPPORTED_CLIENT_TARGETS: readonly SupportedClientTarget[] = [
  "claude",
  "cursor",
  "codex",
  "openclaw",
] as const;

const CLIENT_LABELS: Record<SupportedClientTarget, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  openclaw: "OpenClaw",
};

export type InstallerDeps = {
  copyFileSync: typeof copyFileSync;
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  rmSync: typeof rmSync;
  writeFileSync: typeof writeFileSync;
  spawnSync: typeof spawnSync;
  homedir: typeof homedir;
  env: NodeJS.ProcessEnv;
};

const defaultDeps: InstallerDeps = {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  spawnSync,
  homedir,
  env: process.env,
};

function repoRootFromModule(): string {
  return resolve(__dirname, "..");
}

function ensureDir(path: string, deps: InstallerDeps): void {
  deps.mkdirSync(path, { recursive: true });
}

function readText(path: string, deps: InstallerDeps): string {
  return deps.readFileSync(path, "utf8");
}

function readJsonFile<T>(path: string, deps: InstallerDeps): T | null {
  if (!deps.existsSync(path)) return null;
  const raw = readText(path, deps).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, value: unknown, deps: InstallerDeps): void {
  ensureDir(dirname(path), deps);
  deps.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copySkill(
  sourceParts: string[],
  destination: string,
  deps: InstallerDeps,
): void {
  const source = join(repoRootFromModule(), ...sourceParts);
  ensureDir(dirname(destination), deps);
  deps.copyFileSync(source, destination);
}

function findCli(binary: string, deps: InstallerDeps): string | null {
  const result = deps.spawnSync("bash", ["-lc", `command -v ${binary}`], {
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

// ---------------------------------------------------------------------------
// Codex managed-block helpers (still used by the TOML installer for idempotency)
// ---------------------------------------------------------------------------

export function stripCodexManagedBlock(content: string): string {
  const start = content.indexOf(CODEX_BLOCK_START);
  const end = content.indexOf(CODEX_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return content.trim();
  }
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end + CODEX_BLOCK_END.length).trimStart();
  return `${before}${before && after ? "\n\n" : ""}${after}`.trim();
}

export function upsertCodexManagedBlock(content: string, block: string): string {
  const stripped = stripCodexManagedBlock(content);
  return `${stripped}${stripped ? "\n\n" : ""}${block.trim()}\n`;
}

function escapeTomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * TOML block for `~/.codex/config.toml` pointing Codex at the hosted MCP
 * endpoint. Codex resolves `transport = "streamable_http"` + `url` to the
 * RFC-9728 OAuth flow and prompts the user in their browser on first use.
 */
export function buildCodexTomlBlock(
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): string {
  return [
    CODEX_BLOCK_START,
    `[mcp_servers.${serverName}]`,
    `url = "${escapeTomlString(url)}"`,
    `transport = "streamable_http"`,
    CODEX_BLOCK_END,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Cursor config helpers
// ---------------------------------------------------------------------------

export type CursorHttpServerEntry = {
  type: "http";
  url: string;
};

export type CursorMcpFile = {
  mcpServers?: Record<string, CursorHttpServerEntry | Record<string, unknown>>;
};

/**
 * Idempotently upsert the VX entry into a `~/.cursor/mcp.json` document.
 * Preserves any other servers the user has configured.
 */
export function upsertCursorVxEntry(
  current: CursorMcpFile | null,
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): CursorMcpFile {
  const existing: CursorMcpFile = current && typeof current === "object" ? { ...current } : {};
  const servers = { ...(existing.mcpServers ?? {}) };
  servers[serverName] = { type: "http", url };
  return { ...existing, mcpServers: servers };
}

export function removeCursorVxEntry(
  current: CursorMcpFile | null,
  serverName: string = VX_MCP_SERVER_NAME,
): CursorMcpFile {
  if (!current) return { mcpServers: {} };
  const servers = { ...(current.mcpServers ?? {}) };
  delete servers[serverName];
  return { ...current, mcpServers: servers };
}

// ---------------------------------------------------------------------------
// Claude Code installer
// ---------------------------------------------------------------------------

/**
 * Register the hosted VX MCP server with Claude Code.
 *
 * Primary path: shell out to `claude mcp add --transport http vx <url>`. The
 * Claude Code CLI owns the OAuth handshake — it stores the resulting tokens
 * in its own keychain. We never see a credential.
 *
 * Fallback (no `claude` CLI on PATH): the user gets a printable command and a
 * note pointing at the docs. The slash command is still copied.
 */
export function installClaude(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];

  const claudeCommandsDir = join(deps.homedir(), ".claude", "commands");
  const commandPath = join(claudeCommandsDir, "vx-memory.md");
  ensureDir(claudeCommandsDir, deps);
  copySkill(["skills", "claude", "vx-memory", "vx-memory.md"], commandPath, deps);
  notes.push(`Installed Claude Code slash command at ${commandPath}`);

  const claudeCli = findCli("claude", deps);
  if (!claudeCli) {
    notes.push(
      "Claude Code CLI (`claude`) was not found on PATH. Install Claude Code, then run:",
    );
    notes.push(
      `  claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${VX_MCP_URL}`,
    );
    notes.push(
      "Claude Code will open your browser to sign in via OAuth on first use.",
    );
    return notes;
  }

  // Make the install idempotent: if vx is already registered, remove it first
  // so the re-run produces a clean configuration.
  deps.spawnSync(
    claudeCli,
    ["mcp", "remove", "--scope", "user", VX_MCP_SERVER_NAME],
    { encoding: "utf8" },
  );

  const addResult = deps.spawnSync(
    claudeCli,
    [
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      VX_MCP_SERVER_NAME,
      VX_MCP_URL,
    ],
    { encoding: "utf8" },
  );

  if (addResult.status === 0) {
    notes.push(
      `Registered VX MCP server with Claude Code: \`claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${VX_MCP_URL}\``,
    );
    notes.push(
      "On first tool call, Claude Code will open your browser to sign in.",
    );
  } else {
    notes.push(
      `Claude Code CLI was found but MCP registration failed: ${
        addResult.stderr?.trim() || addResult.stdout?.trim() || "unknown error"
      }`,
    );
    notes.push(
      `Retry manually: claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${VX_MCP_URL}`,
    );
  }

  return notes;
}

export function uninstallClaude(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const commandPath = join(deps.homedir(), ".claude", "commands", "vx-memory.md");
  if (deps.existsSync(commandPath)) {
    deps.rmSync(commandPath);
    notes.push(`Removed Claude Code slash command at ${commandPath}`);
  }

  const claudeCli = findCli("claude", deps);
  if (claudeCli) {
    const removeResult = deps.spawnSync(
      claudeCli,
      ["mcp", "remove", "--scope", "user", VX_MCP_SERVER_NAME],
      { encoding: "utf8" },
    );
    if (removeResult.status === 0) {
      notes.push("Removed the VX MCP server from Claude Code.");
    } else {
      notes.push(
        `Claude Code CLI was found but MCP removal failed: ${
          removeResult.stderr?.trim() || removeResult.stdout?.trim() || "unknown error"
        }`,
      );
    }
  } else {
    notes.push(
      "Claude Code CLI was not found on PATH. Remove the VX entry manually with `claude mcp remove --scope user vx` once Claude Code is installed.",
    );
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Cursor installer
// ---------------------------------------------------------------------------

function cursorMcpJsonPath(deps: InstallerDeps): string {
  return join(deps.homedir(), ".cursor", "mcp.json");
}

export function installCursor(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const path = cursorMcpJsonPath(deps);
  const current = readJsonFile<CursorMcpFile>(path, deps);
  const next = upsertCursorVxEntry(current);
  writeJsonFile(path, next, deps);
  notes.push(`Wrote Cursor MCP config at ${path}`);
  notes.push(
    "Restart Cursor; it will open your browser to sign in via OAuth on first VX tool use.",
  );
  return notes;
}

export function uninstallCursor(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const path = cursorMcpJsonPath(deps);
  const current = readJsonFile<CursorMcpFile>(path, deps);
  if (!current) {
    notes.push(`No Cursor MCP config found at ${path}; nothing to remove.`);
    return notes;
  }
  const next = removeCursorVxEntry(current);
  writeJsonFile(path, next, deps);
  notes.push(`Removed the VX entry from ${path}`);
  return notes;
}

// ---------------------------------------------------------------------------
// Codex installer
// ---------------------------------------------------------------------------

function codexHome(deps: InstallerDeps): string {
  return deps.env.CODEX_HOME || join(deps.homedir(), ".codex");
}

export function installCodex(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const home = codexHome(deps);

  const skillsDir = join(home, "skills", "vx-memory");
  const skillPath = join(skillsDir, "SKILL.md");
  ensureDir(skillsDir, deps);
  copySkill(["skills", "codex", "vx-memory", "SKILL.md"], skillPath, deps);
  notes.push(`Installed Codex skill at ${skillPath}`);

  const configPath = join(home, "config.toml");
  const current = deps.existsSync(configPath) ? readText(configPath, deps) : "";
  const updated = upsertCodexManagedBlock(current, buildCodexTomlBlock());
  ensureDir(dirname(configPath), deps);
  deps.writeFileSync(configPath, updated, "utf8");
  notes.push(`Updated Codex MCP config at ${configPath}`);
  notes.push(
    "Restart Codex; it will open your browser to sign in via OAuth on first VX tool use.",
  );
  return notes;
}

export function uninstallCodex(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const home = codexHome(deps);

  const skillDir = join(home, "skills", "vx-memory");
  if (deps.existsSync(skillDir)) {
    deps.rmSync(skillDir, { recursive: true, force: true });
    notes.push(`Removed Codex skill at ${skillDir}`);
  }

  const configPath = join(home, "config.toml");
  if (deps.existsSync(configPath)) {
    const stripped = stripCodexManagedBlock(readText(configPath, deps));
    deps.writeFileSync(configPath, stripped ? `${stripped}\n` : "", "utf8");
    notes.push(`Removed VX MCP configuration from ${configPath}`);
  }
  return notes;
}

// ---------------------------------------------------------------------------
// OpenClaw installer
// ---------------------------------------------------------------------------

/**
 * Build the OpenClaw plugin config snippet pointing at the hosted MCP URL.
 *
 * OAuth is handled by the OpenClaw runtime — there's no `apiKey` or
 * `bearerToken` to configure. If your OpenClaw version doesn't yet handle
 * OAuth-protected MCP servers, upgrade it; static credentials are no longer
 * supported in v1.
 */
export function buildOpenClawPluginConfig(
  url: string = VX_MCP_URL,
): {
  plugins: {
    entries: {
      "vx-memory": {
        enabled: true;
        config: { apiBaseUrl: string; source: "openclaw" };
      };
    };
  };
} {
  return {
    plugins: {
      entries: {
        "vx-memory": {
          enabled: true,
          config: {
            apiBaseUrl: url,
            source: "openclaw",
          },
        },
      },
    },
  };
}

export function installOpenClaw(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const snippet = JSON.stringify(buildOpenClawPluginConfig(), null, 2);

  const openclawCli = findCli("openclaw", deps);
  if (!openclawCli) {
    notes.push(
      `OpenClaw CLI (\`openclaw\`) was not found on PATH. Install OpenClaw, then run:`,
    );
    notes.push(`  openclaw plugins install ${VX_PACKAGE_NAME}`);
    notes.push("Add this to your OpenClaw plugin config:");
    notes.push(snippet);
    return notes;
  }

  const installResult = deps.spawnSync(
    openclawCli,
    ["plugins", "install", VX_PACKAGE_NAME],
    { encoding: "utf8" },
  );

  if (installResult.status === 0) {
    notes.push(
      `Installed the VX plugin for OpenClaw: \`openclaw plugins install ${VX_PACKAGE_NAME}\``,
    );
  } else {
    notes.push(
      `OpenClaw CLI was found but plugin installation failed: ${
        installResult.stderr?.trim() || installResult.stdout?.trim() || "unknown error"
      }`,
    );
    notes.push(
      `Retry manually: openclaw plugins install ${VX_PACKAGE_NAME}`,
    );
  }

  notes.push("Add this to your OpenClaw plugin config:");
  notes.push(snippet);
  notes.push(
    "OpenClaw will open your browser to sign in via OAuth on first VX tool use.",
  );
  return notes;
}

export function uninstallOpenClaw(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const openclawCli = findCli("openclaw", deps);
  if (!openclawCli) {
    notes.push(
      `OpenClaw CLI (\`openclaw\`) was not found on PATH. Remove the plugin manually with \`openclaw plugins remove ${VX_PACKAGE_NAME}\`.`,
    );
    return notes;
  }
  const result = deps.spawnSync(
    openclawCli,
    ["plugins", "remove", VX_PACKAGE_NAME],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    notes.push(`Removed the VX plugin from OpenClaw.`);
  } else {
    notes.push(
      `OpenClaw CLI was found but plugin removal failed: ${
        result.stderr?.trim() || result.stdout?.trim() || "unknown error"
      }`,
    );
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Bulk installer
// ---------------------------------------------------------------------------

export function installAll(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  for (const target of SUPPORTED_CLIENT_TARGETS) {
    notes.push(`${CLIENT_LABELS[target]}:`);
    for (const note of runInstall(target, deps)) {
      notes.push(`  ${note}`);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const USAGE = [
  `Usage: vx-mcp <command> [target]`,
  ``,
  `Commands:`,
  `  install <all|claude|cursor|codex|openclaw>  Wire up clients to ${VX_MCP_URL}`,
  `  uninstall <claude|cursor|codex|openclaw>    Remove the VX MCP entry`,
  `  clients                                   List supported clients`,
  `  --version, -v                             Print package version`,
  `  --help, -h                                Show this message`,
  ``,
  `OAuth happens automatically. Your client will open your browser to sign`,
  `in on the first VX tool call. No API key is needed.`,
].join("\n");

function readPackageVersion(deps: InstallerDeps): string {
  try {
    const pkgPath = join(repoRootFromModule(), "package.json");
    const pkg = JSON.parse(readText(pkgPath, deps)) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function printHelp(): void {
  console.log(USAGE);
}

export function isSupportedClient(value: string): value is SupportedClientTarget {
  return (SUPPORTED_CLIENT_TARGETS as readonly string[]).includes(value);
}

export async function handleCli(
  argv: string[],
  deps: InstallerDeps = defaultDeps,
): Promise<boolean> {
  const [command, target] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return true;
  }

  if (command === "--version" || command === "-v") {
    console.log(readPackageVersion(deps));
    return true;
  }

  if (command === "clients") {
    console.log("Supported clients:");
    for (const item of SUPPORTED_CLIENT_TARGETS) {
      console.log(`  - ${item}`);
    }
    return true;
  }

  if (command === "install" || command === "uninstall") {
    const supportsAll = command === "install" && target === "all";
    if (!target || (!supportsAll && !isSupportedClient(target))) {
      console.error(
        `Unknown target ${target ? `\`${target}\`` : "(missing)"}. Supported: ${
          command === "install"
            ? `all, ${SUPPORTED_CLIENT_TARGETS.join(", ")}`
            : SUPPORTED_CLIENT_TARGETS.join(", ")
        }.`,
      );
      printHelp();
      return true;
    }

    let notes: string[];
    if (command === "install" && supportsAll) {
      notes = installAll(deps);
    } else if (isSupportedClient(target)) {
      notes =
        command === "install"
          ? runInstall(target, deps)
          : runUninstall(target, deps);
    } else {
      console.error(`Unknown target \`${target}\`.`);
      printHelp();
      return true;
    }

    const verb = command === "install" ? "Installed" : "Removed";
    console.log(
      `${verb} VX MCP for ${supportsAll ? "all supported clients" : target}.`,
    );
    for (const note of notes) {
      console.log(`- ${note}`);
    }
    return true;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return true;
}

function runInstall(target: SupportedClientTarget, deps: InstallerDeps): string[] {
  switch (target) {
    case "claude":
      return installClaude(deps);
    case "cursor":
      return installCursor(deps);
    case "codex":
      return installCodex(deps);
    case "openclaw":
      return installOpenClaw(deps);
  }
}

function runUninstall(target: SupportedClientTarget, deps: InstallerDeps): string[] {
  switch (target) {
    case "claude":
      return uninstallClaude(deps);
    case "cursor":
      return uninstallCursor(deps);
    case "codex":
      return uninstallCodex(deps);
    case "openclaw":
      return uninstallOpenClaw(deps);
  }
}
