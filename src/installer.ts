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
  VX_DEFAULT_API_BASE_URL,
  VX_DEFAULT_NAME,
  VX_NPM_PACKAGE_SPEC,
} from "./constants.js";
import { normalizeApiBaseUrl, normalizeSourceTag } from "./runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CODEX_BLOCK_START = "# BEGIN VX MCP";
export const CODEX_BLOCK_END = "# END VX MCP";

export type PackagedLauncher = {
  command: string;
  args: string[];
};

export type CursorMcpConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
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

function escapeTomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function ensureDir(path: string, deps: InstallerDeps): void {
  deps.mkdirSync(path, { recursive: true });
}

function readText(path: string, deps: InstallerDeps): string {
  return deps.readFileSync(path, "utf8");
}

function resolveCredentialEnv(
  env: NodeJS.ProcessEnv
): Record<string, string> {
  if (env.VX_BEARER_TOKEN) {
    return { VX_BEARER_TOKEN: env.VX_BEARER_TOKEN };
  }

  if (env.VX_API_KEY) {
    return { VX_API_KEY: env.VX_API_KEY };
  }

  return {};
}

export function getPackagedLauncher(): PackagedLauncher {
  return {
    command: "npx",
    args: ["-y", VX_NPM_PACKAGE_SPEC, "mcp"],
  };
}

export function getInstallEnv(
  source: "claude" | "codex" | "cursor",
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const sourceTag = source === "claude" ? "claude-code" : source;
  return {
    VX_API_BASE_URL: normalizeApiBaseUrl(
      env.VX_API_BASE_URL || env.VX_API_URL || VX_DEFAULT_API_BASE_URL
    ),
    VX_NAME: env.VX_NAME || VX_DEFAULT_NAME,
    VX_SOURCE: normalizeSourceTag(sourceTag),
    ...resolveCredentialEnv(env),
  };
}

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

function formatTomlArray(values: string[]): string {
  return `[${values.map((value) => `"${escapeTomlString(value)}"`).join(", ")}]`;
}

export function buildCodexTomlBlock(
  launcher: PackagedLauncher = getPackagedLauncher(),
  env = getInstallEnv("codex")
): string {
  const envLines = Object.entries(env).map(
    ([key, value]) => `${key} = "${escapeTomlString(value)}"`
  );

  return [
    CODEX_BLOCK_START,
    "[mcp_servers.vx]",
    `command = "${escapeTomlString(launcher.command)}"`,
    `args = ${formatTomlArray(launcher.args)}`,
    "",
    "[mcp_servers.vx.env]",
    ...envLines,
    CODEX_BLOCK_END,
  ].join("\n");
}

export function buildClaudeMcpConfigObject(
  launcher: PackagedLauncher = getPackagedLauncher(),
  env = getInstallEnv("claude")
): {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    type: "stdio",
    command: launcher.command,
    args: launcher.args,
    env,
  };
}

export function buildClaudeMcpConfig(
  launcher: PackagedLauncher = getPackagedLauncher(),
  env = getInstallEnv("claude")
): string {
  return JSON.stringify(buildClaudeMcpConfigObject(launcher, env));
}

export function buildCursorMcpConfigObject(
  launcher: PackagedLauncher = getPackagedLauncher(),
  env = getInstallEnv("cursor")
): CursorMcpConfig {
  return {
    command: launcher.command,
    args: launcher.args,
    env,
  };
}

export function buildCursorDeeplink(
  name = "vx",
  launcher: PackagedLauncher = getPackagedLauncher(),
  env = getInstallEnv("cursor")
): string {
  const encodedConfig = Buffer.from(
    JSON.stringify(buildCursorMcpConfigObject(launcher, env)),
    "utf8"
  ).toString("base64");

  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(encodedConfig)}`;
}

function copySkill(
  sourceParts: string[],
  destination: string,
  deps: InstallerDeps
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

export function installClaude(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const claudeCommandsDir = join(deps.homedir(), ".claude", "commands");
  const commandPath = join(claudeCommandsDir, "vx-memory.md");
  ensureDir(claudeCommandsDir, deps);
  copySkill(["skills", "claude", "vx-memory", "vx-memory.md"], commandPath, deps);
  notes.push(`Installed Claude Code slash command at ${commandPath}`);

  if (!deps.env.VX_API_KEY && !deps.env.VX_BEARER_TOKEN) {
    notes.push(
      "No VX credential was found in the current environment. Add `VX_API_KEY` or `VX_BEARER_TOKEN` in Claude Code before using VX."
    );
  }

  const claudeCli = findCli("claude", deps);
  if (!claudeCli) {
    notes.push(
      "Claude Code CLI (`claude`) was not found, so MCP registration was skipped. Run `claude mcp add-json --scope user vx '<json>'` after installing Claude Code."
    );
    return notes;
  }

  const addResult = deps.spawnSync(
    claudeCli,
    [
      "mcp",
      "add-json",
      "--scope",
      "user",
      "vx",
      buildClaudeMcpConfig(getPackagedLauncher(), getInstallEnv("claude", deps.env)),
    ],
    { encoding: "utf8" }
  );

  if (addResult.status === 0) {
    notes.push(
      "Registered the packaged VX MCP server with Claude Code using `claude mcp add-json --scope user`."
    );
  } else {
    notes.push(
      `Claude Code CLI was found but MCP registration failed: ${
        addResult.stderr.trim() || addResult.stdout.trim()
      }`
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
    const removeResult = deps.spawnSync(claudeCli, ["mcp", "remove", "vx"], {
      encoding: "utf8",
    });
    if (removeResult.status === 0) {
      notes.push("Removed the VX MCP server from Claude Code.");
    } else {
      notes.push(
        `Claude Code CLI was found but MCP removal failed: ${
          removeResult.stderr.trim() || removeResult.stdout.trim()
        }`
      );
    }
  }

  return notes;
}

export function installCodex(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const codexHome = deps.env.CODEX_HOME || join(deps.homedir(), ".codex");
  const skillsDir = join(codexHome, "skills", "vx-memory");
  const skillPath = join(skillsDir, "SKILL.md");
  ensureDir(skillsDir, deps);
  copySkill(["skills", "codex", "vx-memory", "SKILL.md"], skillPath, deps);
  notes.push(`Installed Codex skill at ${skillPath}`);

  if (!deps.env.VX_API_KEY && !deps.env.VX_BEARER_TOKEN) {
    notes.push(
      "No VX credential was found in the current environment. Add `VX_API_KEY` or `VX_BEARER_TOKEN` in Codex before using VX."
    );
  }

  const configPath = join(codexHome, "config.toml");
  const current = deps.existsSync(configPath) ? readText(configPath, deps) : "";
  const updated = upsertCodexManagedBlock(
    current,
    buildCodexTomlBlock(getPackagedLauncher(), getInstallEnv("codex", deps.env))
  );
  ensureDir(dirname(configPath), deps);
  deps.writeFileSync(configPath, updated, "utf8");
  notes.push(`Updated Codex MCP config at ${configPath}`);

  return notes;
}

export function uninstallCodex(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const codexHome = deps.env.CODEX_HOME || join(deps.homedir(), ".codex");
  const skillDir = join(codexHome, "skills", "vx-memory");
  if (deps.existsSync(skillDir)) {
    deps.rmSync(skillDir, { recursive: true, force: true });
    notes.push(`Removed Codex skill at ${skillDir}`);
  }

  const configPath = join(codexHome, "config.toml");
  if (deps.existsSync(configPath)) {
    const stripped = stripCodexManagedBlock(readText(configPath, deps));
    deps.writeFileSync(configPath, stripped ? `${stripped}\n` : "", "utf8");
    notes.push(`Removed VX MCP configuration from ${configPath}`);
  }

  return notes;
}

export function handleCli(argv: string[], deps: InstallerDeps = defaultDeps): boolean {
  const [command, target] = argv;
  if (!command) {
    return false;
  }

  if (
    (command === "install" || command === "uninstall") &&
    (target === "claude" || target === "codex")
  ) {
    const notes =
      command === "install"
        ? target === "claude"
          ? installClaude(deps)
          : installCodex(deps)
        : target === "claude"
          ? uninstallClaude(deps)
          : uninstallCodex(deps);

    console.log(`${command === "install" ? "Installed" : "Uninstalled"} VX ${target} adapter.`);
    for (const note of notes) {
      console.log(`- ${note}`);
    }
    return true;
  }

  if (command === "mcp") {
    return false;
  }

  console.log("Usage: vx-mcp [mcp|install <claude|codex>|uninstall <claude|codex>]");
  return true;
}
