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
export const HERMES_BLOCK_START = "  # BEGIN VX MCP";
export const HERMES_BLOCK_END = "  # END VX MCP";

export type SupportedClientTarget =
  | "claude"
  | "cursor"
  | "codex"
  | "openclaw"
  | "hermes";

export const SUPPORTED_CLIENT_TARGETS: readonly SupportedClientTarget[] = [
  "claude",
  "cursor",
  "codex",
  "openclaw",
  "hermes",
] as const;

const CLIENT_LABELS: Record<SupportedClientTarget, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  openclaw: "OpenClaw",
  hermes: "Hermes Agent",
};

const REQUIRED_OPENCLAW_VX_TOOLS = [
  "vx_librarian_seed",
  "vx_librarian_context",
  "vx_reality",
] as const;
const RECOMMENDED_OPENCLAW_VX_TOOLS = [
  "vx_librarian_seed",
  "vx_librarian_context",
  "vx_reality",
  "vx_recall",
  "vx_store",
] as const;

export type ReadinessStatus =
  | "ready"
  | "needs-install"
  | "missing-cli"
  | "runtime-error"
  | "manual-approval";

export type ClientReadiness = {
  target: SupportedClientTarget | "chatgpt";
  label: string;
  status: ReadinessStatus;
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

function openClawProfileArgs(configPath: string, deps: InstallerDeps): string[] {
  const devConfigPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
  if (configPath === devConfigPath) return ["--dev"];
  const match = configPath.match(/\.openclaw-([^/]+)\/openclaw\.json$/);
  return match?.[1] ? ["--profile", match[1]] : [];
}

function openClawCommand(args: string[]): string {
  return ["npx", "openclaw", ...args].join(" ");
}

function hasOpenClawInstallSignal(deps: InstallerDeps): boolean {
  if (deps.env.VX_MCP_OPENCLAW_CONFIG_PATH) return true;
  if (deps.env.VX_MCP_OPENCLAW_PROFILE || deps.env.OPENCLAW_PROFILE) return true;
  return (
    deps.existsSync(join(deps.homedir(), ".openclaw-dev", "openclaw.json")) ||
    deps.existsSync(join(deps.homedir(), ".openclaw", "openclaw.json"))
  );
}

function openClawInstallProfileArgs(deps: InstallerDeps): string[] {
  const explicit = deps.env.VX_MCP_OPENCLAW_CONFIG_PATH;
  if (explicit) return openClawProfileArgs(explicit, deps);
  const profile = deps.env.VX_MCP_OPENCLAW_PROFILE || deps.env.OPENCLAW_PROFILE;
  if (profile) return ["--profile", profile];
  const devConfigPath = join(deps.homedir(), ".openclaw-dev", "openclaw.json");
  const defaultConfigPath = join(deps.homedir(), ".openclaw", "openclaw.json");
  if (deps.existsSync(devConfigPath) && !deps.existsSync(defaultConfigPath)) return ["--dev"];
  return [];
}

function openClawMcpAddArgs(profileArgs: string[] = []): string[] {
  return [
    ...profileArgs,
    "mcp",
    "add",
    VX_MCP_SERVER_NAME,
    "--url",
    VX_MCP_URL,
    "--transport",
    "streamable-http",
    "--auth",
    "oauth",
    "--include",
    RECOMMENDED_OPENCLAW_VX_TOOLS.join(","),
    "--no-probe",
  ];
}

function openClawOAuthRequired(output: string): boolean {
  return /requires OAuth authorization|mcp login|OAuth is not complete|needs authentication/i.test(output);
}

function openClawProbeReadiness(
  config: { path: string; url: string; missingRequiredTools: string[] },
  deps: InstallerDeps,
): Pick<ClientReadiness, "status" | "notes"> | null {
  const npxCli = findCli("npx", deps);
  if (!npxCli) return null;

  const profileArgs = openClawProfileArgs(config.path, deps);
  const probe = deps.spawnSync(
    npxCli,
    ["-y", "openclaw", ...profileArgs, "mcp", "probe", VX_MCP_SERVER_NAME, "--json"],
    {
      encoding: "utf8",
      timeout: 15000,
    },
  );
  const probeOutput = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`.trim();
  if (openClawOAuthRequired(probeOutput)) {
    return {
      status: "manual-approval",
      notes: [
        `OpenClaw MCP config includes VX at ${config.path}.`,
        `VX endpoint: ${config.url}`,
        "OpenClaw can reach the VX MCP server, but OAuth is not complete yet.",
        `Run \`${openClawCommand([...profileArgs, "mcp", "login", VX_MCP_SERVER_NAME])}\` and approve the browser sign-in.`,
      ],
    };
  }
  if (probe.status !== 0) {
    return {
      status: "manual-approval",
      notes: [
        `OpenClaw MCP config includes VX at ${config.path}.`,
        `VX endpoint: ${config.url}`,
        ...(config.missingRequiredTools.length > 0
          ? [openClawToolFilterFixNote(config.missingRequiredTools)]
          : []),
        `npx can run OpenClaw, but VX MCP probe did not pass yet: ${firstLine(probeOutput) || `exit ${probe.status ?? "unknown"}`}.`,
      ],
    };
  }

  let toolCount = 0;
  let probedTools: string[] | null = null;
  try {
    const parsed = JSON.parse(probe.stdout ?? "{}") as {
      servers?: Record<string, { tools?: number }>;
      tools?: unknown[];
    };
    probedTools = Array.isArray(parsed.tools)
      ? parsed.tools.filter((tool): tool is string => typeof tool === "string")
      : null;
    toolCount =
      parsed.servers?.[VX_MCP_SERVER_NAME]?.tools ??
      (probedTools ? probedTools.length : 0);
  } catch {
    toolCount = 0;
  }

  const missingRequiredTools =
    config.missingRequiredTools.length > 0
      ? config.missingRequiredTools
      : probedTools
        ? missingRequiredOpenClawTools(probedTools)
        : [];
  if (missingRequiredTools.length > 0) {
    return {
      status: "manual-approval",
      notes: [
        `OpenClaw MCP config includes VX at ${config.path}.`,
        `VX endpoint: ${config.url}`,
        `npx OpenClaw MCP probe discovered ${toolCount || "VX"} tools, but not the required VX tools: ${missingRequiredTools.join(", ")}.`,
        openClawToolFilterFixNote(missingRequiredTools),
      ],
    };
  }

  const models = deps.spawnSync(
    npxCli,
    ["-y", "openclaw", ...profileArgs, "models", "status"],
    {
      encoding: "utf8",
      timeout: 15000,
    },
  );
  const modelOutput = `${models.stdout ?? ""}\n${models.stderr ?? ""}`.trim();
  const missingModelAuth = openClawModelAuthMissing(models.status ?? 0, modelOutput);

  return {
    status: missingModelAuth ? "manual-approval" : "ready",
    notes: [
      `OpenClaw MCP config includes VX at ${config.path}.`,
      `VX endpoint: ${config.url}`,
      `npx OpenClaw MCP probe discovered ${toolCount || "VX"} tools.`,
      ...(missingModelAuth
        ? [
            "OpenClaw model auth is still missing, so a live agent turn cannot run yet.",
            "Run `npx openclaw --dev models auth login --provider openai` or configure an OpenClaw model provider.",
          ]
        : ["OpenClaw model auth appears configured; run a live OpenClaw turn to complete the end-to-end proof."]),
    ],
  };
}

function openClawModelAuthMissing(status: number, modelOutput: string): boolean {
  if (status !== 0) return true;
  const hasLocalMarker = /marker\(ollama-local\)|effective=.*ollama-local/i.test(modelOutput);
  if (hasLocalMarker) return false;
  return /Missing auth|effective=missing|status=missing/i.test(modelOutput);
}

function hasHostedUrl(content: string): boolean {
  return content.includes(VX_MCP_URL);
}

function claudeMcpListStatus(cli: string, deps: InstallerDeps): ClientReadiness | null {
  const result = deps.spawnSync(cli, ["mcp", "list"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) return null;

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const vxLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${VX_MCP_SERVER_NAME}:`) && line.includes(VX_MCP_URL));

  if (!vxLine) {
    return {
      target: "claude",
      label: CLIENT_LABELS.claude,
      status: "needs-install",
      notes: [`Run: vx-mcp install claude`],
    };
  }

  if (/connected/i.test(vxLine) && !/needs authentication/i.test(vxLine)) {
    return {
      target: "claude",
      label: CLIENT_LABELS.claude,
      status: "ready",
      notes: ["Claude Code reports the VX MCP server is connected."],
    };
  }

  if (/needs authentication|auth/i.test(vxLine)) {
    return {
      target: "claude",
      label: CLIENT_LABELS.claude,
      status: "manual-approval",
      notes: [
        "Claude Code has VX registered, but OAuth is not complete yet.",
        "Trigger a VX tool call in Claude Code and approve the browser sign-in.",
      ],
    };
  }

  return {
    target: "claude",
    label: CLIENT_LABELS.claude,
    status: "manual-approval",
    notes: [`Claude Code lists VX, but reported an unknown state: ${vxLine}`],
  };
}

function hermesExecutableCandidate(deps: InstallerDeps): string | null {
  const fromPath = findCli("hermes", deps) ?? findCli("tirith", deps);
  if (fromPath) return fromPath;

  const bundled = join(hermesHome(deps), "bin", "tirith");
  return deps.existsSync(bundled) ? bundled : null;
}

function executableFormatNote(executable: string, deps: InstallerDeps): string | null {
  const result = deps.spawnSync("file", [executable], {
    encoding: "utf8",
    timeout: 2000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0 || !output) return null;
  if (/\bELF\b/i.test(output)) {
    return `Installed Hermes executable is a Linux/ELF binary (${output}). This machine needs a macOS-compatible Hermes build.`;
  }
  return `Installed Hermes executable format: ${output}`;
}

function firstLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function hermesDockerReadiness(deps: InstallerDeps): Pick<ClientReadiness, "status" | "notes"> | null {
  const containerName = deps.env.VX_MCP_HERMES_DOCKER_CONTAINER || "hermes-dashboard";
  const hermesBin = deps.env.VX_MCP_HERMES_DOCKER_BIN || "/opt/hermes/.venv/bin/hermes";
  const ps = deps.spawnSync("docker", ["ps", "--format", "{{.Names}}"], {
    encoding: "utf8",
    timeout: 3000,
  });

  if (!ps || typeof ps.status !== "number" || ps.status !== 0) return null;
  const running = (ps.stdout ?? "")
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (!running.includes(containerName)) return null;

  const version = deps.spawnSync(
    "docker",
    ["exec", containerName, "sh", "-lc", `${hermesBin} --version 2>&1 | sed -n '1,5p'`],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  );
  const versionOutput = `${version?.stdout ?? ""}\n${version?.stderr ?? ""}`.trim();
  if (!version || version.status !== 0) {
    return {
      status: "runtime-error",
      notes: [
        `Hermes Docker container '${containerName}' is running, but the Hermes CLI could not start: ${versionOutput || `exit ${version?.status ?? "unknown"}`}`,
      ],
    };
  }

  const notes = [
    `Hermes Docker container '${containerName}' is running and executable: ${firstLine(versionOutput) || "version detected"}.`,
  ];

  const list = deps.spawnSync(
    "docker",
    ["exec", containerName, "sh", "-lc", `${hermesBin} mcp list 2>&1`],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  );
  const listOutput = `${list?.stdout ?? ""}\n${list?.stderr ?? ""}`.trim();
  if (!list || list.status !== 0 || !hasHostedUrl(listOutput)) {
    return {
      status: "needs-install",
      notes: [
        ...notes,
        "Hermes is running in Docker, but its in-container MCP config does not list the hosted VX endpoint.",
        "Run `vx-mcp install hermes` against the Hermes home used by the container, or add VX from Hermes with `hermes mcp add`.",
      ],
    };
  }
  notes.push("Hermes Docker MCP config lists the hosted VX endpoint.");

  const test = deps.spawnSync(
    "docker",
    ["exec", containerName, "sh", "-lc", `timeout 8 ${hermesBin} mcp test vx 2>&1`],
    {
      encoding: "utf8",
      timeout: 10000,
    },
  );
  const testOutput = `${test?.stdout ?? ""}\n${test?.stderr ?? ""}`.trim();
  if (/401|Unauthorized|needs authentication|auth/i.test(testOutput)) {
    const authSummary = /401\s+Unauthorized/i.test(testOutput)
      ? "401 Unauthorized"
      : firstLine(testOutput) || "authentication required";
    return {
      status: "manual-approval",
      notes: [
        ...notes,
        `Hermes Docker can reach VX MCP, but OAuth is not complete: ${authSummary}.`,
        "Run `hermes mcp login vx` inside the Hermes container or trigger a VX tool call and approve sign-in.",
      ],
    };
  }
  if (test?.status === 0 && /✓|success|connected/i.test(testOutput)) {
    return {
      status: "ready",
      notes: [...notes, "Hermes Docker MCP test reports VX is connected."],
    };
  }

  return {
    status: "manual-approval",
    notes: [
      ...notes,
      `Hermes Docker VX MCP connection still needs verification: ${firstLine(testOutput) || `exit ${test?.status ?? "unknown"}`}.`,
      "Trigger a VX tool call in Hermes and approve OAuth if prompted, then rerun vx-mcp doctor.",
    ],
  };
}

function hermesRuntimeReadiness(deps: InstallerDeps): Pick<ClientReadiness, "status" | "notes"> {
  const executable = hermesExecutableCandidate(deps);
  if (!executable) {
    const docker = hermesDockerReadiness(deps);
    if (docker) return docker;
    return {
      status: "manual-approval",
      notes: [
        "Hermes config points at the hosted VX endpoint, but no Hermes executable was found on PATH or at ~/.hermes/bin/tirith.",
        "Launch or reinstall Hermes Agent, then rerun vx-mcp doctor.",
      ],
    };
  }

  const result = deps.spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });

  if (result.status === 0) {
    return {
      status: "ready",
      notes: [
        "Hermes config points at the hosted VX endpoint and the local Hermes runtime is executable.",
        "Restart Hermes Agent if it was already running before this install.",
      ],
    };
  }

  const spawnError = (result as { error?: Error }).error?.message ?? "";
  const output = `${spawnError}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
  const formatNote =
    /ENOEXEC|exec format/i.test(output) ? executableFormatNote(executable, deps) : null;
  const docker = hermesDockerReadiness(deps);
  if (docker) {
    return {
      status: docker.status,
      notes: [
        ...docker.notes,
        `Host Hermes executable is not usable: ${output || `exit ${result.status ?? "unknown"}`}`,
        ...(formatNote ? [formatNote] : []),
      ],
    };
  }
  return {
    status: "runtime-error",
    notes: [
      `Hermes config points at the hosted VX endpoint, but the local runtime could not start: ${output || `exit ${result.status ?? "unknown"}`}`,
      ...(formatNote ? [formatNote] : []),
      "Reinstall or relaunch Hermes Agent with a build compatible with this machine, then rerun vx-mcp doctor.",
    ],
  };
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
// Hermes Agent installer
// ---------------------------------------------------------------------------

function hermesHome(deps: InstallerDeps): string {
  return join(deps.homedir(), ".hermes");
}

function hermesConfigPath(deps: InstallerDeps): string {
  return join(hermesHome(deps), "config.yaml");
}

export function buildHermesManagedBlock(
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): string {
  return [
    HERMES_BLOCK_START,
    `  ${serverName}:`,
    `    url: "${url.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    "    auth: oauth",
    "    headers:",
    '      X-Counterparty-Id: "hermes:agent"',
    '      X-Counterparty-Kind: "personal-agent"',
    '      X-Counterparty-Client: "hermes"',
    HERMES_BLOCK_END,
  ].join("\n");
}

export function stripHermesManagedBlock(content: string): string {
  const start = content.indexOf(HERMES_BLOCK_START);
  const end = content.indexOf(HERMES_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return content.trimEnd();
  }

  const before = content.slice(0, start).replace(/[ \t]*$/, "");
  const after = content
    .slice(end + HERMES_BLOCK_END.length)
    .replace(/^\r?\n/, "");
  return `${before}${after}`.trimEnd();
}

export function upsertHermesManagedBlock(
  content: string,
  block: string = buildHermesManagedBlock(),
): string {
  const stripped = stripHermesManagedBlock(content);
  const lines = stripped ? stripped.split(/\r?\n/) : [];
  const mcpIndex = lines.findIndex((line) => /^mcp_servers:\s*$/.test(line));

  if (mcpIndex === -1) {
    return `${stripped}${stripped ? "\n\n" : ""}mcp_servers:\n${block}\n`;
  }

  const nextLines = [...lines];
  nextLines.splice(mcpIndex + 1, 0, ...block.split("\n"));
  return `${nextLines.join("\n").trimEnd()}\n`;
}

export function installHermes(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const home = hermesHome(deps);

  const skillDir = join(home, "skills", "vx-memory");
  const skillPath = join(skillDir, "SKILL.md");
  ensureDir(skillDir, deps);
  copySkill(["skills", "hermes", "vx-memory", "SKILL.md"], skillPath, deps);
  notes.push(`Installed Hermes skill at ${skillPath}`);

  const configPath = hermesConfigPath(deps);
  const current = deps.existsSync(configPath) ? readText(configPath, deps) : "";
  const updated = upsertHermesManagedBlock(current);
  ensureDir(dirname(configPath), deps);
  deps.writeFileSync(configPath, updated, "utf8");
  notes.push(`Updated Hermes MCP config at ${configPath}`);
  notes.push(
    "Restart Hermes Agent; it will discover VX MCP tools on startup and open your browser to sign in via OAuth on first VX tool use.",
  );
  return notes;
}

export function uninstallHermes(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const home = hermesHome(deps);

  const skillDir = join(home, "skills", "vx-memory");
  if (deps.existsSync(skillDir)) {
    deps.rmSync(skillDir, { recursive: true, force: true });
    notes.push(`Removed Hermes skill at ${skillDir}`);
  }

  const configPath = hermesConfigPath(deps);
  if (deps.existsSync(configPath)) {
    const stripped = stripHermesManagedBlock(readText(configPath, deps));
    deps.writeFileSync(configPath, stripped ? `${stripped}\n` : "", "utf8");
    notes.push(`Removed VX MCP configuration from ${configPath}`);
  } else {
    notes.push(`No Hermes config found at ${configPath}; nothing to remove.`);
  }

  return notes;
}

// ---------------------------------------------------------------------------
// OpenClaw installer
// ---------------------------------------------------------------------------

type OpenClawMcpServerEntry = {
  url?: string;
  transport?: string;
  headers?: Record<string, string>;
  toolFilter?: {
    include?: unknown;
  };
};

type OpenClawConfigFile = {
  mcp?: {
    servers?: Record<string, OpenClawMcpServerEntry | Record<string, unknown>>;
  };
};

function openClawConfigPathCandidates(deps: InstallerDeps): string[] {
  const explicit = deps.env.VX_MCP_OPENCLAW_CONFIG_PATH;
  const profile = deps.env.VX_MCP_OPENCLAW_PROFILE || deps.env.OPENCLAW_PROFILE;
  const candidates = [
    ...(explicit ? [explicit] : []),
    ...(profile ? [join(deps.homedir(), `.openclaw-${profile}`, "openclaw.json")] : []),
    join(deps.homedir(), ".openclaw", "openclaw.json"),
    join(deps.homedir(), ".openclaw-dev", "openclaw.json"),
  ];

  return [...new Set(candidates)];
}

function openClawToolNamesInclude(tools: string[], toolName: string): boolean {
  return tools.includes(toolName) || tools.includes(`vx__${toolName}`);
}

function missingRequiredOpenClawTools(tools: string[]): string[] {
  return REQUIRED_OPENCLAW_VX_TOOLS.filter((toolName) => !openClawToolNamesInclude(tools, toolName));
}

function openClawConfiguredToolFilterMissing(entry: OpenClawMcpServerEntry): string[] {
  const include = entry.toolFilter?.include;
  if (!Array.isArray(include)) return [];
  const tools = include.filter((tool): tool is string => typeof tool === "string");
  if (tools.length === 0) return [];
  return missingRequiredOpenClawTools(tools);
}

function openClawToolFilterFixNote(missing: string[]): string {
  return `OpenClaw VX tool filter excludes ${missing.join(", ")}. Remove the filter or run: openclaw mcp tools ${VX_MCP_SERVER_NAME} --include ${RECOMMENDED_OPENCLAW_VX_TOOLS.join(",")}`;
}

function openClawVxConfig(deps: InstallerDeps): { path: string; url: string; missingRequiredTools: string[] } | null {
  for (const path of openClawConfigPathCandidates(deps)) {
    const config = readJsonFile<OpenClawConfigFile>(path, deps);
    const entry = config?.mcp?.servers?.[VX_MCP_SERVER_NAME];
    const url = entry && typeof entry === "object" ? (entry as OpenClawMcpServerEntry).url : "";
    if (typeof url === "string" && /\/mcp\/?$/i.test(url)) {
      return {
        path,
        url,
        missingRequiredTools: openClawConfiguredToolFilterMissing(entry as OpenClawMcpServerEntry),
      };
    }
  }

  return null;
}

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
    if (hasOpenClawInstallSignal(deps)) {
      const npxCli = findCli("npx", deps);
      if (!npxCli) {
        notes.push(
          "OpenClaw config was found, but `npx` was not found on PATH for automatic setup.",
        );
      } else {
        const profileArgs = openClawInstallProfileArgs(deps);
        const addArgs = ["-y", "openclaw", ...openClawMcpAddArgs(profileArgs)];
        const addResult = deps.spawnSync(npxCli, addArgs, { encoding: "utf8" });
        if (addResult.status === 0) {
          notes.push(
            `Configured OpenClaw VX MCP through npx: \`${openClawCommand(openClawMcpAddArgs(profileArgs))}\``,
          );
          notes.push(
            `Exposed the core VX MCP tools for OpenClaw: ${RECOMMENDED_OPENCLAW_VX_TOOLS.join(", ")}`,
          );
          notes.push(
            `Run \`${openClawCommand([...profileArgs, "mcp", "login", VX_MCP_SERVER_NAME])}\` to authorize VX with OAuth.`,
          );
          return notes;
        }
        notes.push(
          `npx can run OpenClaw, but automatic MCP configuration failed: ${
            addResult.stderr?.trim() || addResult.stdout?.trim() || "unknown error"
          }`,
        );
        notes.push(
          `Retry manually: ${openClawCommand(openClawMcpAddArgs(profileArgs))}`,
        );
      }
    }
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
    const toolResult = deps.spawnSync(
      openclawCli,
      [
        "mcp",
        "tools",
        VX_MCP_SERVER_NAME,
        "--include",
        RECOMMENDED_OPENCLAW_VX_TOOLS.join(","),
      ],
      { encoding: "utf8" },
    );
    if (toolResult.status === 0) {
      notes.push(
        `Exposed the core VX MCP tools for OpenClaw: ${RECOMMENDED_OPENCLAW_VX_TOOLS.join(", ")}`,
      );
    } else {
      notes.push(
        `OpenClaw plugin installed, but the VX tool filter could not be updated automatically: ${
          toolResult.stderr?.trim() || toolResult.stdout?.trim() || "unknown error"
        }`,
      );
      notes.push(
        `Run manually: openclaw mcp tools ${VX_MCP_SERVER_NAME} --include ${RECOMMENDED_OPENCLAW_VX_TOOLS.join(",")}`,
      );
    }
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
// Readiness / doctor
// ---------------------------------------------------------------------------

function readinessLine(item: ClientReadiness): string {
  const icon =
    item.status === "ready"
      ? "ready"
      : item.status === "manual-approval"
        ? "manual"
        : item.status === "missing-cli"
          ? "missing-cli"
          : item.status === "runtime-error"
            ? "runtime-error"
            : "needs-install";
  return `${item.label}: ${icon}`;
}

export function getClientReadiness(
  target: SupportedClientTarget | "chatgpt",
  deps: InstallerDeps = defaultDeps,
): ClientReadiness {
  switch (target) {
    case "claude": {
      const commandPath = join(deps.homedir(), ".claude", "commands", "vx-memory.md");
      const cli = findCli("claude", deps);
      if (!cli) {
        return {
          target,
          label: CLIENT_LABELS.claude,
          status: "missing-cli",
          notes: [
            "Claude Code CLI was not found on PATH.",
            `Install later with: claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${VX_MCP_URL}`,
          ],
        };
      }
      const cliStatus = claudeMcpListStatus(cli, deps);
      if (cliStatus) {
        if (!deps.existsSync(commandPath)) {
          return {
            ...cliStatus,
            notes: [...cliStatus.notes, "The bundled /vx-memory slash command is not installed."],
          };
        }
        return cliStatus;
      }
      if (!deps.existsSync(commandPath)) {
        return {
          target,
          label: CLIENT_LABELS.claude,
          status: "needs-install",
          notes: [`Run: vx-mcp install claude`],
        };
      }
      return {
        target,
        label: CLIENT_LABELS.claude,
        status: "manual-approval",
        notes: [
          "Slash command is installed. Claude Code owns MCP registration and OAuth state.",
          "First VX tool use may still open a browser for OAuth approval.",
        ],
      };
    }
    case "cursor": {
      const path = cursorMcpJsonPath(deps);
      const current = readJsonFile<CursorMcpFile>(path, deps);
      const entry = current?.mcpServers?.[VX_MCP_SERVER_NAME];
      if (entry && "type" in entry && entry.type === "http" && entry.url === VX_MCP_URL) {
        return {
          target,
          label: CLIENT_LABELS.cursor,
          status: "ready",
          notes: ["Cursor MCP config points at the hosted VX endpoint."],
        };
      }
      return {
        target,
        label: CLIENT_LABELS.cursor,
        status: "needs-install",
        notes: [`Run: vx-mcp install cursor`],
      };
    }
    case "codex": {
      const configPath = join(codexHome(deps), "config.toml");
      const content = deps.existsSync(configPath) ? readText(configPath, deps) : "";
      if (content.includes(`[mcp_servers.${VX_MCP_SERVER_NAME}]`) && hasHostedUrl(content)) {
        return {
          target,
          label: CLIENT_LABELS.codex,
          status: "ready",
          notes: ["Codex MCP config points at the hosted VX endpoint."],
        };
      }
      return {
        target,
        label: CLIENT_LABELS.codex,
        status: "needs-install",
        notes: [`Run: vx-mcp install codex`],
      };
    }
    case "openclaw": {
      const config = openClawVxConfig(deps);
      const cli = findCli("openclaw", deps);
      if (config && !cli) {
        const npxReadiness = openClawProbeReadiness(config, deps);
        if (npxReadiness) {
          return {
            target,
            label: CLIENT_LABELS.openclaw,
            status: npxReadiness.status,
            notes: npxReadiness.notes,
          };
        }
        return {
          target,
          label: CLIENT_LABELS.openclaw,
          status: "manual-approval",
          notes: [
            `OpenClaw MCP config includes VX at ${config.path}.`,
            `VX endpoint: ${config.url}`,
            "OpenClaw CLI is not on PATH. Use `npx openclaw --dev mcp probe vx` or install OpenClaw to run a live agent turn.",
          ],
        };
      }
      if (config && cli) {
        if (config.missingRequiredTools.length > 0) {
          return {
            target,
            label: CLIENT_LABELS.openclaw,
            status: "manual-approval",
            notes: [
              `OpenClaw MCP config includes VX at ${config.path}.`,
              `VX endpoint: ${config.url}`,
              openClawToolFilterFixNote(config.missingRequiredTools),
            ],
          };
        }
        return {
          target,
          label: CLIENT_LABELS.openclaw,
          status: "manual-approval",
          notes: [
            `OpenClaw MCP config includes VX at ${config.path}.`,
            `VX endpoint: ${config.url}`,
            "Run `openclaw mcp probe vx`, then configure model auth before a live agent turn.",
          ],
        };
      }
      if (!cli) {
        return {
          target,
          label: CLIENT_LABELS.openclaw,
          status: "missing-cli",
          notes: [
            "OpenClaw CLI was not found on PATH.",
            `Install later with: openclaw plugins install ${VX_PACKAGE_NAME}`,
          ],
        };
      }
      return {
        target,
        label: CLIENT_LABELS.openclaw,
        status: "manual-approval",
        notes: [
          "OpenClaw CLI is available. Plugin config is owned by OpenClaw.",
          `Run or verify: openclaw plugins install ${VX_PACKAGE_NAME}`,
        ],
      };
    }
    case "hermes": {
      const configPath = hermesConfigPath(deps);
      const content = deps.existsSync(configPath) ? readText(configPath, deps) : "";
      if (content.includes("mcp_servers:") && content.includes(`${VX_MCP_SERVER_NAME}:`) && hasHostedUrl(content)) {
        const runtime = hermesRuntimeReadiness(deps);
        return {
          target,
          label: CLIENT_LABELS.hermes,
          status: runtime.status,
          notes: runtime.notes,
        };
      }
      return {
        target,
        label: CLIENT_LABELS.hermes,
        status: "needs-install",
        notes: [`Run: vx-mcp install hermes`],
      };
    }
    case "chatgpt":
      return {
        target,
        label: "ChatGPT",
        status: "manual-approval",
        notes: [
          "ChatGPT uses remote MCP app configuration, not a local file this CLI can edit.",
          `Use MCP URL: ${VX_MCP_URL}`,
        ],
      };
  }
}

export function doctor(deps: InstallerDeps = defaultDeps): string[] {
  const checks = [...SUPPORTED_CLIENT_TARGETS, "chatgpt" as const].map((target) =>
    getClientReadiness(target, deps),
  );
  const lines = [`VX MCP readiness (${VX_MCP_URL})`];
  for (const check of checks) {
    lines.push(`- ${readinessLine(check)}`);
    for (const note of check.notes) {
      lines.push(`  ${note}`);
    }
  }
  lines.push("");
  lines.push("First agent check:");
  lines.push("  1. If the vx-librarian context is empty, call vx_librarian_seed once.");
  lines.push("  2. Call vx_librarian_context to load VX purpose and memory policy from VX memory.");
  lines.push("  3. Call vx_reality with the context the agent should use.");
  lines.push("  Do not copy VX policy into local prompts; keep agent reality in VX contexts.");
  return lines;
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
  `  install <all|claude|cursor|codex|openclaw|hermes>  Wire up clients to ${VX_MCP_URL}`,
  `  uninstall <claude|cursor|codex|openclaw|hermes>    Remove the VX MCP entry`,
  `  doctor                                    Report local VX MCP readiness`,
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

  if (command === "doctor" || command === "readiness") {
    for (const line of doctor(deps)) {
      console.log(line);
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
    case "hermes":
      return installHermes(deps);
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
    case "hermes":
      return uninstallHermes(deps);
  }
}
