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
  VX_DEFAULT_MAX_TOKENS,
  VX_DEFAULT_NAME,
  VX_NPM_PACKAGE_SPEC,
} from "./constants.js";
import { handleKeysCli } from "./keys.js";
import { handleMigrateCli } from "./migrate.js";
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

export const SUPPORTED_CLIENT_TARGETS = [
  "amp",
  "claude",
  "claude-desktop",
  "cline",
  "codex",
  "continue",
  "copilot-cli",
  "copilot-vscode",
  "cursor",
  "factory",
  "gemini-cli",
  "gemini-code-assist",
  "jetbrains",
  "junie",
  "kiro",
  "mcp",
  "nemoclaw",
  "opencode",
  "openclaw",
  "qoder",
  "qoder-cli",
  "vscode",
  "warp",
  "windsurf",
] as const;

export type SupportedClientTarget = (typeof SUPPORTED_CLIENT_TARGETS)[number];

export type ClientInstallArtifact = {
  target: SupportedClientTarget;
  title: string;
  kind: "json" | "json5" | "toml" | "shell" | "text";
  destination?: string;
  content: string;
  notes: string[];
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
  source: SupportedClientTarget,
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

export function buildStandardMcpConfigObject(
  launcher: PackagedLauncher = getPackagedLauncher(),
  env = getInstallEnv("mcp")
): CursorMcpConfig {
  return {
    command: launcher.command,
    args: launcher.args,
    env,
  };
}

export function buildTopLevelMcpConfigObject(
  env = getInstallEnv("mcp"),
  launcher: PackagedLauncher = getPackagedLauncher(),
  serverName = "vx"
): { mcpServers: Record<string, CursorMcpConfig> } {
  return {
    mcpServers: {
      [serverName]: buildStandardMcpConfigObject(launcher, env),
    },
  };
}

export function buildOpenCodeConfigObject(
  env = getInstallEnv("opencode"),
  launcher: PackagedLauncher = getPackagedLauncher()
): {
  $schema: string;
  mcp: Record<
    string,
    { type: "local"; command: string[]; env: Record<string, string> }
  >;
} {
  return {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      vx: {
        type: "local",
        command: [launcher.command, ...launcher.args],
        env,
      },
    },
  };
}

export function buildOpenClawPluginConfigObject(
  env = getInstallEnv("openclaw")
): {
  plugins: {
    entries: {
      "vx-memory": {
        enabled: true;
        config: Record<string, string | boolean | number>;
      };
    };
  };
} {
  const config: Record<string, string | boolean | number> = {
    apiBaseUrl: env.VX_API_BASE_URL,
    source: env.VX_SOURCE,
    name: env.VX_NAME,
    storeOnRequestOnly: false,
    maxTokens: VX_DEFAULT_MAX_TOKENS,
  };

  if (env.VX_API_KEY) {
    config.apiKey = env.VX_API_KEY;
  }
  if (env.VX_BEARER_TOKEN) {
    config.bearerToken = env.VX_BEARER_TOKEN;
  }

  return {
    plugins: {
      entries: {
        "vx-memory": {
          enabled: true,
          config,
        },
      },
    },
  };
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toVsCodeAddMcpCommand(
  env: Record<string, string>,
  launcher: PackagedLauncher = getPackagedLauncher()
): string {
  const payload = JSON.stringify({
    name: "io.github.vx-nyc/vx-mcp",
    command: launcher.command,
    args: launcher.args,
    env,
  });
  return `code --add-mcp '${payload}'`;
}

export function buildClientInstallArtifact(
  target: SupportedClientTarget,
  env = getInstallEnv(target),
  launcher: PackagedLauncher = getPackagedLauncher()
): ClientInstallArtifact {
  switch (target) {
    case "claude":
      return {
        target,
        title: "Claude Code MCP payload",
        kind: "json",
        content: toPrettyJson(buildClaudeMcpConfigObject(launcher, env)),
        notes: [
          "Managed install is available with: npx @vesselnyc/mcp-server install claude",
          "Manual registration uses: claude mcp add-json --scope user vx '<payload>'",
        ],
      };
    case "codex":
      return {
        target,
        title: "Codex config block",
        kind: "toml",
        destination: "~/.codex/config.toml",
        content: buildCodexTomlBlock(launcher, env),
        notes: [
          "Managed install is available with: npx @vesselnyc/mcp-server install codex",
        ],
      };
    case "cursor":
      return {
        target,
        title: "Cursor MCP config",
        kind: "json",
        destination: ".cursor/mcp.json",
        content: toPrettyJson(buildTopLevelMcpConfigObject(env, launcher)),
        notes: [
          `One-click deeplink: ${buildCursorDeeplink("vx", launcher, env)}`,
        ],
      };
    case "openclaw":
    case "nemoclaw":
      return {
        target,
        title: `${target} plugin config`,
        kind: "json",
        content: toPrettyJson(buildOpenClawPluginConfigObject(env)),
        notes: [
          `Install plugin with: openclaw plugins install ${VX_NPM_PACKAGE_SPEC}`,
          "Restart the gateway after enabling the plugin.",
        ],
      };
    case "opencode":
      return {
        target,
        title: "OpenCode config",
        kind: "json",
        destination: "~/.config/opencode/opencode.json",
        content: toPrettyJson(buildOpenCodeConfigObject(env, launcher)),
        notes: [],
      };
    case "amp":
      return {
        target,
        title: "Amp CLI install command",
        kind: "shell",
        content: `amp mcp add vx -- ${launcher.command} ${launcher.args.join(" ")}`,
        notes: [],
      };
    case "factory":
      return {
        target,
        title: "Factory CLI install command",
        kind: "shell",
        content: `droid mcp add vx "${launcher.command} ${launcher.args.join(" ")}"`,
        notes: [],
      };
    case "gemini-cli":
      return {
        target,
        title: "Gemini CLI install commands",
        kind: "shell",
        content: [
          `${"gemini mcp add vx"} ${launcher.command} ${launcher.args.join(" ")}`,
          `${"gemini mcp add -s user vx"} ${launcher.command} ${launcher.args.join(" ")}`,
        ].join("\n"),
        notes: [],
      };
    case "qoder-cli":
      return {
        target,
        title: "Qoder CLI install commands",
        kind: "shell",
        content: [
          `qodercli mcp add vx -- ${launcher.command} ${launcher.args.join(" ")}`,
          `qodercli mcp add -s user vx -- ${launcher.command} ${launcher.args.join(" ")}`,
        ].join("\n"),
        notes: [],
      };
    case "copilot-cli":
      return {
        target,
        title: "Copilot CLI setup steps",
        kind: "text",
        content: [
          "Start `copilot`.",
          "Run `/mcp add`.",
          "Set server name to `vx`.",
          `Set command to \`${launcher.command} ${launcher.args.join(" ")}\`.`,
          `Set environment variables from the snippet for source \`${env.VX_SOURCE}\`.`,
        ].join("\n"),
        notes: [],
      };
    case "copilot-vscode":
    case "vscode":
      return {
        target,
        title: "VS Code add-mcp command",
        kind: "shell",
        content: toVsCodeAddMcpCommand(env, launcher),
        notes: [
          toPrettyJson(buildTopLevelMcpConfigObject(env, launcher)),
        ],
      };
    case "claude-desktop":
    case "cline":
    case "continue":
    case "gemini-code-assist":
    case "jetbrains":
    case "junie":
    case "kiro":
    case "mcp":
    case "qoder":
    case "warp":
    case "windsurf":
      return {
        target,
        title: `${target} MCP config`,
        kind: "json",
        content: toPrettyJson(buildTopLevelMcpConfigObject(env, launcher)),
        notes: [],
      };
  }
}

function printArtifact(artifact: ClientInstallArtifact): void {
  console.log(`# ${artifact.title}`);
  if (artifact.destination) {
    console.log(`# destination: ${artifact.destination}`);
  }
  console.log(artifact.content);
  for (const note of artifact.notes) {
    console.log(`\n# ${note}`);
  }
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

export function installOpenClaw(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const artifact = buildClientInstallArtifact(
    "openclaw",
    getInstallEnv("openclaw", deps.env)
  );

  if (!deps.env.VX_API_KEY && !deps.env.VX_BEARER_TOKEN) {
    notes.push(
      "No VX credential was found in the current environment. Add `VX_API_KEY` or `VX_BEARER_TOKEN` before using the OpenClaw plugin."
    );
  }

  const openclawCli = findCli("openclaw", deps);
  if (!openclawCli) {
    notes.push(
      `OpenClaw CLI (\`openclaw\`) was not found, so automatic plugin installation was skipped. Run \`openclaw plugins install ${VX_NPM_PACKAGE_SPEC}\` manually.`
    );
    notes.push(artifact.content);
    return notes;
  }

  const installResult = deps.spawnSync(
    openclawCli,
    ["plugins", "install", VX_NPM_PACKAGE_SPEC],
    { encoding: "utf8" }
  );

  if (installResult.status === 0) {
    notes.push(
      `Installed the VX plugin for OpenClaw with \`openclaw plugins install ${VX_NPM_PACKAGE_SPEC}\`.`
    );
  } else {
    notes.push(
      `OpenClaw CLI was found but plugin installation failed: ${
        installResult.stderr.trim() || installResult.stdout.trim()
      }`
    );
    notes.push(
      `You can retry manually with: openclaw plugins install ${VX_NPM_PACKAGE_SPEC}`
    );
  }

  notes.push(artifact.content);
  return notes;
}

export async function handleCli(
  argv: string[],
  deps: InstallerDeps = defaultDeps
): Promise<boolean> {
  const [command, target] = argv;
  if (!command) {
    return false;
  }

  if (
    ((command === "install" &&
      (target === "claude" || target === "codex" || target === "openclaw")) ||
      (command === "uninstall" &&
        (target === "claude" || target === "codex")))
  ) {
    const notes =
      command === "install"
        ? target === "claude"
          ? installClaude(deps)
          : target === "codex"
            ? installCodex(deps)
            : installOpenClaw(deps)
        : target === "claude"
          ? uninstallClaude(deps)
          : uninstallCodex(deps);

    console.log(
      `${command === "install" ? "Completed" : "Removed"} VX ${target} ${
        command === "install" ? "setup" : "integration"
      }.`
    );
    for (const note of notes) {
      console.log(`- ${note}`);
    }
    return true;
  }

  if (command === "clients") {
    console.log("Managed install targets:");
    console.log("- claude");
    console.log("- codex");
    console.log("- openclaw");
    console.log("");
    console.log("Config/recipe targets:");
    for (const item of SUPPORTED_CLIENT_TARGETS) {
      console.log(`- ${item}`);
    }
    return true;
  }

  if (
    command === "config" &&
    target &&
    SUPPORTED_CLIENT_TARGETS.includes(target as SupportedClientTarget)
  ) {
    printArtifact(
      buildClientInstallArtifact(target as SupportedClientTarget, getInstallEnv(target as SupportedClientTarget, deps.env))
    );
    return true;
  }

  if (command === "migrate") {
    return handleMigrateCli(argv.slice(1), {
      ...deps,
    });
  }

  if (command === "keys") {
    return handleKeysCli(argv.slice(1), {
      env: deps.env,
      homedir: deps.homedir,
      existsSync: deps.existsSync,
      mkdirSync: deps.mkdirSync,
      readFileSync: deps.readFileSync,
      writeFileSync: deps.writeFileSync,
    });
  }

  if (command === "mcp") {
    return false;
  }

  console.log(
    "Usage: vx-mcp [mcp|clients|config <target>|install <claude|codex|openclaw>|uninstall <claude|codex>|migrate [all|codex|claude|openclaw] [--dry-run] [--context <name>] [--path <file>] [--openclaw-path <file>]|keys generate [--out-dir <path>] [--force] [--skip-upload]]"
  );
  return true;
}
