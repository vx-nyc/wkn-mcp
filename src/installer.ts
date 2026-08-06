import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HERMES_OAUTH_REDIRECT_PORT,
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
  | "hermes"
  | "claude-desktop"
  | "windsurf"
  | "cline"
  | "zed"
  | "vscode";

export const SUPPORTED_CLIENT_TARGETS: readonly SupportedClientTarget[] = [
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
] as const;

const CLIENT_LABELS: Record<SupportedClientTarget, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  openclaw: "OpenClaw",
  hermes: "Hermes Agent",
  "claude-desktop": "Claude Desktop",
  windsurf: "Windsurf",
  cline: "Cline",
  zed: "Zed",
  vscode: "VS Code + Copilot",
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
const OPENCLAW_VX_RUNTIME_POLICY = {
  tools: {
    profile: "full",
    alsoAllow: ["group:plugins"],
    toolSearch: {
      enabled: true,
      mode: "tools",
      searchDefaultLimit: 8,
      maxSearchLimit: 20,
    },
  },
} as const;
const DEFAULT_HERMES_DOCKER_LOGIN_ATTEMPTS = 3;
const MAX_HERMES_DOCKER_LOGIN_ATTEMPTS = 10;
const HERMES_MCP_CONNECT_TIMEOUT_SECONDS = 180;

export type ReadinessStatus =
  | "ready"
  | "needs-install"
  | "missing-cli"
  | "runtime-error"
  | "manual-approval"
  | "unsupported";

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
  readdirSync: typeof readdirSync;
  readFileSync: typeof readFileSync;
  rmSync: typeof rmSync;
  writeFileSync: typeof writeFileSync;
  spawnSync: typeof spawnSync;
  homedir: typeof homedir;
  env: NodeJS.ProcessEnv;
  /** Defaults to `process.platform`. Overridable so tests can exercise
   *  Windows/macOS/Linux config-path logic deterministically on any host. */
  platform: NodeJS.Platform;
};

const defaultDeps: InstallerDeps = {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  spawnSync,
  homedir,
  env: process.env,
  platform: process.platform,
};

/** Options accepted by every installX/uninstallX function. */
export type InstallOptions = {
  /** When true, compute and describe the change but never touch disk or
   *  run a mutating command. */
  dryRun?: boolean;
  /** Bind this connection to a named compartment (ONE-118). Only the
   *  `connect` CLI command sets this, after `validateCompartmentName`
   *  passes. Plain `install` leaves it undefined and writes the bare
   *  `VX_MCP_URL`, exactly as it did before compartments existed. */
  compartment?: string;
};

// ---------------------------------------------------------------------------
// Compartments — per-tool access policy (ONE-118)
//
// vx-mcp is installer-only (see AGENTS.md): it does not mint credentials,
// call the VX REST API, or verify server-side enforcement. What it *can*
// guarantee, entirely from config it already writes, is this: every
// connection made through `connect` carries an explicit, non-empty
// compartment name in its URL, and `status` can always read that name back
// out of the client's own config — no separate, driftable local cache.
//
// This exists because of a confirmed production footgun: an empty scope
// (`scopeContextIds: []`) is normalized server-side to "grants everything",
// not "grants nothing". vx-mcp cannot fix that normalization from this repo,
// but it can make sure it is never the source of an empty or missing scope.
// ---------------------------------------------------------------------------

/** Query parameter carrying the compartment name on a client's connection
 *  URL. The hosted VX MCP endpoint is expected to treat a missing or empty
 *  value as deny-all, never as unscoped/allow-all. */
export const VX_COMPARTMENT_PARAM = "compartment";

/** Mirrors VX knowledge-context naming so a compartment can map directly
 *  onto one: letters, numbers, `-`, `_`, and `/` for hierarchical names
 *  (e.g. `work/deal-room`). */
const COMPARTMENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/;

export type CompartmentValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * The one gate `connect` must pass through before writing anything. There is
 * no "unscoped" result here: a missing, blank, or invalid name is always
 * rejected. This is what makes "refuse to write a config with no
 * compartment" true in practice rather than just documented.
 */
export function validateCompartmentName(value: string | undefined): CompartmentValidation {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      error:
        "Missing --compartment <name>. Every connection must be bound to a named compartment — there is no unscoped default.",
    };
  }
  if (!COMPARTMENT_NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: `Invalid compartment name "${trimmed}". Use letters, numbers, "-", "_", or "/" (e.g. "personal", "work/deal-room").`,
    };
  }
  return { ok: true, name: trimmed };
}

/**
 * Append `?compartment=<name>` to a VX MCP endpoint URL. Throws on an empty
 * name so this function can never itself produce an unscoped URL — the same
 * guarantee `validateCompartmentName` gives at the CLI layer, enforced again
 * here as the last function standing before a config write.
 */
export function buildCompartmentScopedUrl(url: string, compartment: string): string {
  const trimmed = compartment.trim();
  if (!trimmed) {
    throw new Error("buildCompartmentScopedUrl requires a non-empty compartment name.");
  }
  const parsed = new URL(url);
  parsed.searchParams.set(VX_COMPARTMENT_PARAM, trimmed);
  return parsed.toString();
}

/** Read the compartment back out of a URL already written to a client's own
 *  config/CLI state, so `status` never needs a second source of truth that
 *  could drift from what a client actually has. */
export function extractCompartment(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get(VX_COMPARTMENT_PARAM);
  } catch {
    return null;
  }
}

/** True for the canonical `VX_MCP_URL`, or that URL with any query string
 *  appended (e.g. a compartment-scoped connect URL) — never true for an
 *  unrelated endpoint. Used where existing code compared a stored URL to
 *  `VX_MCP_URL` with strict equality, which a compartment suffix would
 *  otherwise fail. */
function isVxMcpUrl(url: string): boolean {
  return url === VX_MCP_URL || url.startsWith(`${VX_MCP_URL}?`);
}

/** Every installX routes its outgoing URL through here: the bare
 *  `VX_MCP_URL` for a plain `install` (unchanged v1 behavior), or the
 *  compartment-scoped URL when called from `connect`. `options.compartment`
 *  is expected to already be validated by the CLI layer; this function
 *  stays permissive (silently falls back to the bare URL on a blank value)
 *  so it is never what crashes a caller — enforcement lives in `connect`. */
function installUrl(options: InstallOptions): string {
  const compartment = options.compartment?.trim();
  return compartment ? buildCompartmentScopedUrl(VX_MCP_URL, compartment) : VX_MCP_URL;
}

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

function formatJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJsonFile(path: string, value: unknown, deps: InstallerDeps): void {
  ensureDir(dirname(path), deps);
  deps.writeFileSync(path, formatJsonFile(value), "utf8");
}

// ---------------------------------------------------------------------------
// Dry-run helpers
//
// `--dry-run` must show exactly what would change without writing anything.
// `diffLines` is a minimal line-level diff (no LCS library dependency) that is
// good enough for short config files; `writeOrPreview` is the single place
// every installer routes a config-file write through so dry-run behaves
// identically everywhere.
// ---------------------------------------------------------------------------

function diffLines(before: string, after: string): string[] {
  const a = before.length ? before.split("\n") : [];
  const b = after.length ? after.split("\n") : [];

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }

  let aEnd = a.length - 1;
  let bEnd = b.length - 1;
  while (aEnd >= start && bEnd >= start && a[aEnd] === b[bEnd]) {
    aEnd -= 1;
    bEnd -= 1;
  }

  const lines: string[] = [];
  for (let i = 0; i < start; i += 1) lines.push(`  ${a[i]}`);
  for (let i = start; i <= aEnd; i += 1) lines.push(`- ${a[i]}`);
  for (let i = start; i <= bEnd; i += 1) lines.push(`+ ${b[i]}`);
  for (let i = aEnd + 1; i < a.length; i += 1) lines.push(`  ${a[i]}`);
  return lines;
}

/**
 * Route every config-file write through this so `--dry-run` is uniform:
 * when dry-running, nothing touches disk and the note is a labeled diff;
 * otherwise the file is written and `writeNote` describes what happened.
 *
 * `before` must be a representation comparable to `content`, not necessarily
 * the raw file bytes: text/block-marker editors (Codex, Hermes) pass the raw
 * file text since they only touch their own marked block and preserve
 * everything else byte-for-byte, but JSON "parse, merge, re-serialize"
 * editors (Cursor and friends) must pass the *canonically re-serialized*
 * previous value (e.g. `current ? formatJsonFile(current) : null`) — diffing
 * against raw bytes there would flag every formatting difference from
 * whatever originally wrote the file (different indent width, key order,
 * trailing commas, ...) as if the whole file were being rewritten, even
 * when the only real change is one added entry. Skipping the write when
 * `before === content` is also what keeps an already-correct file from being
 * gratuitously reformatted on a repeat, no-op install.
 */
function writeOrPreview(
  path: string,
  before: string | null,
  content: string,
  deps: InstallerDeps,
  dryRun: boolean,
  writeNote: string,
): string {
  if (before === content) {
    return dryRun
      ? `[dry-run] ${path} already reflects the selected VX MCP endpoint; no changes needed.`
      : `${path} already reflects the selected VX MCP endpoint; no changes needed.`;
  }

  if (dryRun) {
    const header =
      before === null ? `[dry-run] Would create ${path}:` : `[dry-run] Would update ${path}:`;
    return [header, ...diffLines(before ?? "", content)].join("\n");
  }

  ensureDir(dirname(path), deps);
  deps.writeFileSync(path, content, "utf8");
  return writeNote;
}

/** Dry-run-aware wrapper for a file removal (skill files, managed-block config
 *  files that become empty, etc). `describeChange` should describe the
 *  non-dry-run outcome, e.g. "Removed Codex skill at <path>". */
function removeOrPreview(
  path: string,
  deps: InstallerDeps,
  dryRun: boolean,
  describeChange: string,
  options: { recursive?: boolean } = {},
): string {
  if (dryRun) {
    return `[dry-run] Would remove ${path}`;
  }
  deps.rmSync(path, { recursive: options.recursive ?? false, force: true });
  return describeChange;
}

/** Dry-run-aware wrapper for copying a bundled skill/slash-command file. */
function copyOrPreview(
  sourceParts: string[],
  destination: string,
  deps: InstallerDeps,
  dryRun: boolean,
  describeChange: string,
): string {
  if (dryRun) {
    return `[dry-run] Would install ${destination}`;
  }
  copySkill(sourceParts, destination, deps);
  return describeChange;
}

// ---------------------------------------------------------------------------
// Cross-platform config path helpers
//
// Claude Desktop, VS Code (and the Cline extension that lives inside it), and
// Zed each pick a different base directory per OS. Cursor/Codex/Hermes/
// OpenClaw don't need this: their config lives at a fixed dotfile path under
// the home directory on every OS, which `homedir()` already resolves
// correctly without branching.
// ---------------------------------------------------------------------------

function windowsAppDataDir(deps: InstallerDeps): string {
  return deps.env.APPDATA || join(deps.homedir(), "AppData", "Roaming");
}

/**
 * macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
 * Windows: `%APPDATA%\Claude\claude_desktop_config.json`
 * Claude Desktop does not ship a Linux build, so there is no path to target
 * there — callers should treat a null return as "skip, not supported".
 */
function claudeDesktopConfigPath(deps: InstallerDeps): string | null {
  if (deps.platform === "darwin") {
    return join(
      deps.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (deps.platform === "win32") {
    return join(windowsAppDataDir(deps), "Claude", "claude_desktop_config.json");
  }
  return null;
}

/**
 * `~/.codeium/windsurf/mcp_config.json` on macOS, Linux, and Windows alike —
 * Windsurf resolves this relative to the home directory on every OS, so no
 * platform branching is needed (same shape as Cursor/Codex/Hermes).
 */
function windsurfConfigPath(deps: InstallerDeps): string {
  return join(deps.homedir(), ".codeium", "windsurf", "mcp_config.json");
}

/**
 * VS Code's per-user profile directory. This anchors both VS Code's own
 * `mcp.json` and the Cline extension's `globalStorage` settings file.
 */
function vsCodeUserDir(deps: InstallerDeps): string | null {
  if (deps.platform === "darwin") {
    return join(deps.homedir(), "Library", "Application Support", "Code", "User");
  }
  if (deps.platform === "win32") {
    return join(windowsAppDataDir(deps), "Code", "User");
  }
  if (deps.platform === "linux") {
    return join(deps.homedir(), ".config", "Code", "User");
  }
  return null;
}

/**
 * VS Code's native MCP config. GitHub Copilot Chat's agent mode in VS Code
 * shares this same file — there is no separate Copilot-specific config to
 * write for the in-VS-Code experience.
 */
function vsCodeMcpJsonPath(deps: InstallerDeps): string | null {
  const userDir = vsCodeUserDir(deps);
  return userDir ? join(userDir, "mcp.json") : null;
}

/**
 * Cline (VS Code extension id `saoudrizwan.claude-dev`) keeps its own MCP
 * config under the extension's `globalStorage` directory, separate from VS
 * Code's `mcp.json`. This targets the standard VS Code install; Cline running
 * inside VS Code Insiders, Cursor, or a portable profile uses a different
 * `globalStorage` root and needs manual setup.
 */
function clineMcpSettingsPath(deps: InstallerDeps): string | null {
  const userDir = vsCodeUserDir(deps);
  return userDir
    ? join(
        userDir,
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json",
      )
    : null;
}

/**
 * macOS/Linux: `~/.config/zed/settings.json` (respects `$XDG_CONFIG_HOME`)
 * Windows: `%APPDATA%\Zed\settings.json`
 * Source: Zed's own `docs/src/configuring-zed.md`.
 */
function zedSettingsPath(deps: InstallerDeps): string | null {
  if (deps.platform === "darwin" || deps.platform === "linux") {
    const configHome = deps.env.XDG_CONFIG_HOME || join(deps.homedir(), ".config");
    return join(configHome, "zed", "settings.json");
  }
  if (deps.platform === "win32") {
    return join(windowsAppDataDir(deps), "Zed", "settings.json");
  }
  return null;
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

function envPositiveInt(
  deps: InstallerDeps,
  key: string,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = deps.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
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

function hermesMcpServerName(deps: InstallerDeps): string {
  const name = deps.env.VX_MCP_HERMES_SERVER_NAME || VX_MCP_SERVER_NAME;
  return /^[a-zA-Z0-9_-]+$/.test(name) ? name : VX_MCP_SERVER_NAME;
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

function openClawMcpAddArgs(url: string = VX_MCP_URL, profileArgs: string[] = []): string[] {
  return [
    ...profileArgs,
    "mcp",
    "add",
    VX_MCP_SERVER_NAME,
    "--url",
    url,
    "--transport",
    "streamable-http",
    "--auth",
    "oauth",
    "--include",
    RECOMMENDED_OPENCLAW_VX_TOOLS.join(","),
    "--no-probe",
  ];
}

function openClawRuntimePolicyPatch(): string {
  return JSON.stringify(OPENCLAW_VX_RUNTIME_POLICY);
}

function applyOpenClawRuntimePolicy(
  executable: string,
  argsPrefix: string[],
  deps: InstallerDeps,
): { ok: true } | { ok: false; output: string } {
  const result = deps.spawnSync(
    executable,
    [...argsPrefix, "config", "patch", "--stdin"],
    {
      encoding: "utf8",
      input: openClawRuntimePolicyPatch(),
    },
  );
  if (result.status === 0) return { ok: true };
  return {
    ok: false,
    output: result.stderr?.trim() || result.stdout?.trim() || "unknown error",
  };
}

function openClawOAuthRequired(output: string): boolean {
  return /requires OAuth authorization|mcp login|OAuth is not complete|needs authentication/i.test(output);
}

function openClawAuthorizationFailed(output: string): string | null {
  if (!/401|Unauthorized|after successful authentication/i.test(output)) return null;
  try {
    const jsonStart = output.indexOf("{");
    const jsonEnd = output.lastIndexOf("}");
    const json = jsonStart >= 0 && jsonEnd > jsonStart ? output.slice(jsonStart, jsonEnd + 1) : output;
    const parsed = JSON.parse(json) as { diagnostics?: Array<{ message?: unknown }> };
    const message = parsed.diagnostics
      ?.map((diagnostic) => diagnostic.message)
      .find((message): message is string => typeof message === "string" && message.trim().length > 0);
    if (message) return message;
  } catch {
    // Non-JSON stderr from OpenClaw is still useful through the first line.
  }
  return firstLine(output) || "VX MCP returned an authorization error.";
}

function openClawOAuthCompletionNote(configPath: string, deps: InstallerDeps): string {
  const profileArgs = openClawProfileArgs(configPath, deps);
  return `If OpenClaw prints an authorization code step, complete it with: ${openClawCommand([...profileArgs, "mcp", "login", VX_MCP_SERVER_NAME, "--code", "<code>"])}`;
}

function normalizeAudience(value: string): string {
  return value.replace(/\/+$/, "");
}

function expectedMcpAudience(): string {
  try {
    return normalizeAudience(new URL(VX_MCP_URL).origin);
  } catch {
    return normalizeAudience(VX_MCP_URL.replace(/\/mcp$/, ""));
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function openClawOAuthDir(configPath: string): string {
  return join(dirname(configPath), "mcp-oauth");
}

function openClawTokenAudienceNote(configPath: string, deps: InstallerDeps): string | null {
  const oauthDir = openClawOAuthDir(configPath);
  if (!deps.existsSync(oauthDir)) return null;

  let files: string[] = [];
  try {
    files = deps.readdirSync(oauthDir);
  } catch {
    return null;
  }

  const expected = expectedMcpAudience();
  for (const file of files) {
    if (!file.startsWith(`${VX_MCP_SERVER_NAME}-`) || !file.endsWith(".json")) continue;
    const tokenState = readJsonFile<{ tokens?: { access_token?: string } }>(
      join(oauthDir, file),
      deps,
    );
    const accessToken = tokenState?.tokens?.access_token;
    if (!accessToken) continue;

    const payload = decodeJwtPayload(accessToken);
    const rawAud = payload?.aud;
    const audiences = Array.isArray(rawAud)
      ? rawAud.filter((aud): aud is string => typeof aud === "string")
      : typeof rawAud === "string"
        ? [rawAud]
        : [];
    if (!audiences.map(normalizeAudience).includes(expected)) {
      return `OpenClaw has an OAuth token for VX, but its token audience is ${audiences.length ? audiences.join(", ") : "empty"}. Run \`vx-mcp login openclaw\` again after the hosted VX MCP resource audience fix is deployed so the token includes ${expected}.`;
    }
  }

  return null;
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
        "Run `vx-mcp login openclaw` and approve the browser sign-in.",
        openClawOAuthCompletionNote(config.path, deps),
      ],
    };
  }
  const authorizationFailure = openClawAuthorizationFailed(probeOutput);
  if (authorizationFailure) {
    const tokenAudienceNote = openClawTokenAudienceNote(config.path, deps);
    return {
      status: "manual-approval",
      notes: [
        `OpenClaw MCP config includes VX at ${config.path}.`,
        `VX endpoint: ${config.url}`,
        ...(tokenAudienceNote ? [tokenAudienceNote] : []),
        `npx can run OpenClaw, but VX MCP authorization did not pass yet: ${authorizationFailure}.`,
      ],
    };
  }
  if (probe.status !== 0) {
    const tokenAudienceNote = openClawTokenAudienceNote(config.path, deps);
    return {
      status: "manual-approval",
      notes: [
        `OpenClaw MCP config includes VX at ${config.path}.`,
        `VX endpoint: ${config.url}`,
        ...(tokenAudienceNote ? [tokenAudienceNote] : []),
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

function hasSelectedMcpUrl(content: string): boolean {
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
  const serverName = hermesMcpServerName(deps);
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
  if (!list || list.status !== 0 || !listOutput.includes(serverName)) {
    return {
      status: "needs-install",
      notes: [
        ...notes,
        `Hermes is running in Docker, but its in-container MCP config does not list the '${serverName}' server.`,
        "Run `vx-mcp install hermes` against the Hermes home used by the container, or add VX from Hermes with `hermes mcp add`.",
      ],
    };
  }
  notes.push(
    hasSelectedMcpUrl(listOutput)
      ? "Hermes Docker MCP config lists the selected VX MCP endpoint."
      : `Hermes Docker MCP config lists '${serverName}'; endpoint display may be truncated, so smoke will verify with mcp test.`,
  );

  const test = deps.spawnSync(
    "docker",
    ["exec", containerName, "sh", "-lc", `timeout 15 ${hermesBin} mcp test ${serverName} 2>&1`],
    {
      encoding: "utf8",
      timeout: 20000,
    },
  );
  const testOutput = `${test?.stdout ?? ""}\n${test?.stderr ?? ""}`.trim();
  if (/Invalid registration response/i.test(testOutput)) {
    const invalidFields = ["logo_uri", "tos_uri", "policy_uri"]
      .filter((field) => testOutput.includes(field))
      .join(", ");
    return {
      status: "runtime-error",
      notes: [
        ...notes,
        `Hermes Docker reached VX OAuth registration, but the registration response is invalid${invalidFields ? ` for: ${invalidFields}` : ""}.`,
        `Deploy the VX OAuth registration compatibility fix, then rerun \`hermes mcp login ${serverName}\`.`,
      ],
    };
  }
  if (test?.status === 0 && /✓|success|connected/i.test(testOutput)) {
    return {
      status: "ready",
      notes: [...notes, "Hermes Docker MCP test reports VX is connected."],
    };
  }
  if (/401|Unauthorized|needs authentication|authorization required|oauth callback/i.test(testOutput)) {
    const authSummary = /401\s+Unauthorized/i.test(testOutput)
      ? "401 Unauthorized"
      : firstLine(testOutput) || "authentication required";
    return {
      status: "manual-approval",
      notes: [
        ...notes,
        `Hermes Docker can reach VX MCP, but OAuth is not complete: ${authSummary}.`,
        `Run \`vx-mcp login hermes\` from the host so the OAuth callback on 127.0.0.1:${HERMES_OAUTH_REDIRECT_PORT} can reach Hermes Docker, then approve sign-in in the browser.`,
      ],
    };
  }

  return {
    status: "manual-approval",
    notes: [
      ...notes,
      `Hermes Docker VX MCP connection still needs verification: ${firstLine(testOutput) || `exit ${test?.status ?? "unknown"}`}.`,
      `If OAuth is pending, run \`vx-mcp login hermes\` from the host and approve VX in the browser, then rerun vx-mcp doctor.`,
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
        "Hermes config points at the selected VX MCP endpoint, but no Hermes executable was found on PATH or at ~/.hermes/bin/tirith.",
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
        "Hermes config points at the selected VX MCP endpoint and the local Hermes runtime is executable.",
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
      `Hermes config points at the selected VX MCP endpoint, but the local runtime could not start: ${output || `exit ${result.status ?? "unknown"}`}`,
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
// Shared JSON "server map" helpers
//
// Claude Desktop, Windsurf, Cline, and VS Code all store MCP servers as a
// named map under one top-level key, differing only in the key name and the
// shape of each entry. Zed's `context_servers` follows the same shape inside
// a much larger settings file. These generics do the merge/remove once;
// each client below gets a small typed wrapper so the public API still
// matches the per-client `upsertXVxEntry`/`removeXVxEntry` convention used by
// Cursor (see AGENTS.md "Adding a new client").
// ---------------------------------------------------------------------------

function upsertJsonServerEntry(
  current: Record<string, unknown> | null,
  serversKey: string,
  serverName: string,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> =
    current && typeof current === "object" ? { ...current } : {};
  const servers = { ...((next[serversKey] as Record<string, unknown> | undefined) ?? {}) };
  servers[serverName] = entry;
  next[serversKey] = servers;
  return next;
}

function removeJsonServerEntry(
  current: Record<string, unknown> | null,
  serversKey: string,
  serverName: string,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    current && typeof current === "object" ? { ...current } : {};
  const servers = { ...((base[serversKey] as Record<string, unknown> | undefined) ?? {}) };
  delete servers[serverName];
  base[serversKey] = servers;
  return base;
}

// --- Claude Desktop ---------------------------------------------------------

export type ClaudeDesktopMcpFile = {
  mcpServers?: Record<string, { command: string; args: string[] } | Record<string, unknown>>;
};

/**
 * Claude Desktop's config only understands local stdio servers (`command` +
 * `args`) — it has no native remote-HTTP/OAuth transport in the config file
 * (remote servers there go through the separate "Custom Connectors" UI
 * instead, which is not a local file this CLI can drive). `mcp-remote` is the
 * community-standard stdio↔Streamable-HTTP bridge: Claude Desktop launches it
 * locally, it speaks stdio to Claude Desktop and HTTP to the hosted VX
 * endpoint, and it opens the browser itself for OAuth on first use. This
 * keeps vx-mcp itself free of any runtime or stored credential, consistent
 * with the no-stdio-fallback rule in AGENTS.md (which is about this
 * package's own architecture, not about the bridge Claude Desktop needs to
 * reach *any* remote MCP server).
 */
export function upsertClaudeDesktopVxEntry(
  current: ClaudeDesktopMcpFile | null,
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): ClaudeDesktopMcpFile {
  return upsertJsonServerEntry(current, "mcpServers", serverName, {
    command: "npx",
    args: ["-y", "mcp-remote", url],
  }) as ClaudeDesktopMcpFile;
}

export function removeClaudeDesktopVxEntry(
  current: ClaudeDesktopMcpFile | null,
  serverName: string = VX_MCP_SERVER_NAME,
): ClaudeDesktopMcpFile {
  return removeJsonServerEntry(current, "mcpServers", serverName) as ClaudeDesktopMcpFile;
}

// --- Windsurf ----------------------------------------------------------------

export type WindsurfMcpFile = {
  mcpServers?: Record<string, { serverUrl: string } | Record<string, unknown>>;
};

export function upsertWindsurfVxEntry(
  current: WindsurfMcpFile | null,
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): WindsurfMcpFile {
  return upsertJsonServerEntry(current, "mcpServers", serverName, {
    serverUrl: url,
  }) as WindsurfMcpFile;
}

export function removeWindsurfVxEntry(
  current: WindsurfMcpFile | null,
  serverName: string = VX_MCP_SERVER_NAME,
): WindsurfMcpFile {
  return removeJsonServerEntry(current, "mcpServers", serverName) as WindsurfMcpFile;
}

// --- Cline ---------------------------------------------------------------------

export type ClineMcpFile = {
  mcpServers?: Record<string, { type: "streamableHttp"; url: string } | Record<string, unknown>>;
};

export function upsertClineVxEntry(
  current: ClineMcpFile | null,
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): ClineMcpFile {
  // Cline requires the transport type spelled exactly "streamableHttp"
  // (camelCase, no hyphen); "streamable-http" or an omitted type silently
  // falls back to the legacy SSE transport and 405s against a streamable-only
  // server.
  return upsertJsonServerEntry(current, "mcpServers", serverName, {
    type: "streamableHttp",
    url,
  }) as ClineMcpFile;
}

export function removeClineVxEntry(
  current: ClineMcpFile | null,
  serverName: string = VX_MCP_SERVER_NAME,
): ClineMcpFile {
  return removeJsonServerEntry(current, "mcpServers", serverName) as ClineMcpFile;
}

// --- VS Code (+ GitHub Copilot Chat) --------------------------------------------

export type VsCodeMcpFile = {
  servers?: Record<string, { type: "http"; url: string } | Record<string, unknown>>;
};

export function upsertVsCodeVxEntry(
  current: VsCodeMcpFile | null,
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): VsCodeMcpFile {
  // Note the top-level key is `servers`, not `mcpServers` — different from
  // every other JSON-based client here.
  return upsertJsonServerEntry(current, "servers", serverName, {
    type: "http",
    url,
  }) as VsCodeMcpFile;
}

export function removeVsCodeVxEntry(
  current: VsCodeMcpFile | null,
  serverName: string = VX_MCP_SERVER_NAME,
): VsCodeMcpFile {
  return removeJsonServerEntry(current, "servers", serverName) as VsCodeMcpFile;
}

// --- Zed -------------------------------------------------------------------------

export type ZedSettingsFile = Record<string, unknown> & {
  context_servers?: Record<string, { url: string } | Record<string, unknown>>;
};

export function upsertZedVxEntry(
  current: ZedSettingsFile | null,
  url: string = VX_MCP_URL,
  serverName: string = VX_MCP_SERVER_NAME,
): ZedSettingsFile {
  // Zed prompts its own OAuth flow for a remote context server that has no
  // "Authorization" header configured, so a bare `{ url }` entry is correct.
  return upsertJsonServerEntry(current, "context_servers", serverName, {
    url,
  }) as ZedSettingsFile;
}

export function removeZedVxEntry(
  current: ZedSettingsFile | null,
  serverName: string = VX_MCP_SERVER_NAME,
): ZedSettingsFile {
  return removeJsonServerEntry(current, "context_servers", serverName) as ZedSettingsFile;
}

// --- Generic install/uninstall engine for the JSON "server map" clients ------

type JsonMcpClientSpec<TFile> = {
  label: string;
  resolvePath: (deps: InstallerDeps) => string | null;
  unsupportedNote: string;
  upsert: (current: TFile | null, url: string) => TFile;
  remove: (current: TFile | null) => TFile;
  afterInstallNotes: string[];
};

function installJsonMcpClient<TFile>(
  spec: JsonMcpClientSpec<TFile>,
  deps: InstallerDeps,
  options: InstallOptions,
): string[] {
  const notes: string[] = [];
  const path = spec.resolvePath(deps);
  if (!path) {
    notes.push(spec.unsupportedNote);
    return notes;
  }

  const dryRun = options.dryRun ?? false;
  const url = installUrl(options);
  const raw = deps.existsSync(path) ? readText(path, deps).trim() : "";
  const current = raw ? readJsonFile<TFile>(path, deps) : null;
  if (raw && current === null) {
    notes.push(
      `${path} exists but could not be parsed as JSON; leaving it untouched to avoid corrupting it. Add this entry by hand instead:`,
    );
    notes.push(formatJsonFile(spec.upsert(null, url)));
    return notes;
  }

  const next = spec.upsert(current, url);
  const before = current === null ? null : formatJsonFile(current);
  notes.push(
    writeOrPreview(
      path,
      before,
      formatJsonFile(next),
      deps,
      dryRun,
      options.compartment
        ? `Wrote ${spec.label} MCP config at ${path} (compartment: ${options.compartment})`
        : `Wrote ${spec.label} MCP config at ${path}`,
    ),
  );
  notes.push(...spec.afterInstallNotes);
  return notes;
}

function uninstallJsonMcpClient<TFile>(
  spec: JsonMcpClientSpec<TFile>,
  deps: InstallerDeps,
  options: InstallOptions,
): string[] {
  const notes: string[] = [];
  const path = spec.resolvePath(deps);
  if (!path) {
    notes.push(spec.unsupportedNote);
    return notes;
  }

  const dryRun = options.dryRun ?? false;
  if (!deps.existsSync(path)) {
    notes.push(`No ${spec.label} config found at ${path}; nothing to remove.`);
    return notes;
  }

  const current = readJsonFile<TFile>(path, deps);
  if (current === null) {
    notes.push(
      `${path} could not be parsed as JSON; leaving it untouched. Remove the "${VX_MCP_SERVER_NAME}" entry by hand.`,
    );
    return notes;
  }

  const next = spec.remove(current);
  notes.push(
    writeOrPreview(
      path,
      formatJsonFile(current),
      formatJsonFile(next),
      deps,
      dryRun,
      `Removed the VX entry from ${path}`,
    ),
  );
  return notes;
}

const claudeDesktopSpec: JsonMcpClientSpec<ClaudeDesktopMcpFile> = {
  label: "Claude Desktop",
  resolvePath: claudeDesktopConfigPath,
  unsupportedNote:
    "Claude Desktop's config location is only confidently known for macOS and Windows; skipping on this platform (Claude Desktop has no Linux build).",
  upsert: (current, url) => upsertClaudeDesktopVxEntry(current, url),
  remove: (current) => removeClaudeDesktopVxEntry(current),
  afterInstallNotes: [
    `Claude Desktop only supports local (stdio) MCP servers, so this entry runs the \`mcp-remote\` bridge (via npx) to reach ${VX_MCP_URL} over Streamable HTTP.`,
    "Restart Claude Desktop; on first VX tool call, mcp-remote opens your browser to sign in via OAuth. vx-mcp itself never sees or stores a credential.",
  ],
};

const windsurfSpec: JsonMcpClientSpec<WindsurfMcpFile> = {
  label: "Windsurf",
  resolvePath: (deps) => windsurfConfigPath(deps),
  unsupportedNote: "Windsurf's config location could not be determined on this platform; skipping.",
  upsert: (current, url) => upsertWindsurfVxEntry(current, url),
  remove: (current) => removeWindsurfVxEntry(current),
  afterInstallNotes: [
    "Restart Windsurf (or reload the Cascade panel); it will open your browser to sign in via OAuth on first VX tool use.",
  ],
};

const clineSpec: JsonMcpClientSpec<ClineMcpFile> = {
  label: "Cline",
  resolvePath: clineMcpSettingsPath,
  unsupportedNote:
    "Cline's settings path is derived from VS Code's per-user profile directory, which could not be determined on this platform; skipping.",
  upsert: (current, url) => upsertClineVxEntry(current, url),
  remove: (current) => removeClineVxEntry(current),
  afterInstallNotes: [
    "Reload VS Code (or the Cline panel); it will open your browser to sign in via OAuth on first VX tool use.",
    "This targets the standard VS Code install of the Cline extension. Cline running inside VS Code Insiders, Cursor, or a portable profile uses a different globalStorage path and needs manual setup.",
  ],
};

const vsCodeSpec: JsonMcpClientSpec<VsCodeMcpFile> = {
  label: "VS Code",
  resolvePath: vsCodeMcpJsonPath,
  unsupportedNote:
    "VS Code's per-user config directory could not be determined on this platform; skipping.",
  upsert: (current, url) => upsertVsCodeVxEntry(current, url),
  remove: (current) => removeVsCodeVxEntry(current),
  afterInstallNotes: [
    "This is VS Code's native MCP config, shared by GitHub Copilot Chat's agent mode — no separate Copilot-only config is needed.",
    "Reload VS Code; it will open your browser to sign in via OAuth on first VX tool use.",
  ],
};

const zedSpec: JsonMcpClientSpec<ZedSettingsFile> = {
  label: "Zed",
  resolvePath: zedSettingsPath,
  unsupportedNote: "Zed's settings location could not be determined on this platform; skipping.",
  upsert: (current, url) => upsertZedVxEntry(current, url),
  remove: (current) => removeZedVxEntry(current),
  afterInstallNotes: [
    "Zed runs its own OAuth flow the first time it calls a VX tool, since no Authorization header is configured.",
  ],
};

export function installClaudeDesktop(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return installJsonMcpClient(claudeDesktopSpec, deps, options);
}

export function uninstallClaudeDesktop(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return uninstallJsonMcpClient(claudeDesktopSpec, deps, options);
}

export function installWindsurf(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return installJsonMcpClient(windsurfSpec, deps, options);
}

export function uninstallWindsurf(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return uninstallJsonMcpClient(windsurfSpec, deps, options);
}

export function installCline(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return installJsonMcpClient(clineSpec, deps, options);
}

export function uninstallCline(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return uninstallJsonMcpClient(clineSpec, deps, options);
}

export function installVsCode(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return installJsonMcpClient(vsCodeSpec, deps, options);
}

export function uninstallVsCode(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return uninstallJsonMcpClient(vsCodeSpec, deps, options);
}

export function installZed(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return installJsonMcpClient(zedSpec, deps, options);
}

export function uninstallZed(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  return uninstallJsonMcpClient(zedSpec, deps, options);
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
export function installClaude(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const dryRun = options.dryRun ?? false;
  const url = installUrl(options);

  const claudeCommandsDir = join(deps.homedir(), ".claude", "commands");
  const commandPath = join(claudeCommandsDir, "vx-memory.md");
  notes.push(
    copyOrPreview(
      ["skills", "claude", "vx-memory", "vx-memory.md"],
      commandPath,
      deps,
      dryRun,
      `Installed Claude Code slash command at ${commandPath}`,
    ),
  );

  const claudeCli = findCli("claude", deps);
  if (!claudeCli) {
    notes.push(
      "Claude Code CLI (`claude`) was not found on PATH. Install Claude Code, then run:",
    );
    notes.push(
      `  claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${url}`,
    );
    notes.push(
      "Claude Code will open your browser to sign in via OAuth on first use.",
    );
    return notes;
  }

  if (dryRun) {
    notes.push(
      `[dry-run] Would run: claude mcp remove --scope user ${VX_MCP_SERVER_NAME} (pre-flight cleanup, ignoring errors)`,
    );
    notes.push(
      `[dry-run] Would run: claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${url}`,
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
      url,
    ],
    { encoding: "utf8" },
  );

  if (addResult.status === 0) {
    notes.push(
      `Registered VX MCP server with Claude Code: \`claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${url}\``,
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
      `Retry manually: claude mcp add --scope user --transport http ${VX_MCP_SERVER_NAME} ${url}`,
    );
  }

  return notes;
}

export function uninstallClaude(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const dryRun = options.dryRun ?? false;
  const commandPath = join(deps.homedir(), ".claude", "commands", "vx-memory.md");
  if (deps.existsSync(commandPath)) {
    notes.push(
      removeOrPreview(
        commandPath,
        deps,
        dryRun,
        `Removed Claude Code slash command at ${commandPath}`,
      ),
    );
  }

  const claudeCli = findCli("claude", deps);
  if (claudeCli) {
    if (dryRun) {
      notes.push(`[dry-run] Would run: claude mcp remove --scope user ${VX_MCP_SERVER_NAME}`);
      return notes;
    }
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

export function installCursor(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const path = cursorMcpJsonPath(deps);
  const current = readJsonFile<CursorMcpFile>(path, deps);
  const next = upsertCursorVxEntry(current, installUrl(options));
  notes.push(
    writeOrPreview(
      path,
      current === null ? null : formatJsonFile(current),
      formatJsonFile(next),
      deps,
      options.dryRun ?? false,
      options.compartment
        ? `Wrote Cursor MCP config at ${path} (compartment: ${options.compartment})`
        : `Wrote Cursor MCP config at ${path}`,
    ),
  );
  notes.push(
    "Restart Cursor; it will open your browser to sign in via OAuth on first VX tool use.",
  );
  return notes;
}

export function uninstallCursor(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const path = cursorMcpJsonPath(deps);
  const current = readJsonFile<CursorMcpFile>(path, deps);
  if (!current) {
    notes.push(`No Cursor MCP config found at ${path}; nothing to remove.`);
    return notes;
  }
  const next = removeCursorVxEntry(current);
  notes.push(
    writeOrPreview(
      path,
      formatJsonFile(current),
      formatJsonFile(next),
      deps,
      options.dryRun ?? false,
      `Removed the VX entry from ${path}`,
    ),
  );
  return notes;
}

// ---------------------------------------------------------------------------
// Codex installer
// ---------------------------------------------------------------------------

function codexHome(deps: InstallerDeps): string {
  return deps.env.CODEX_HOME || join(deps.homedir(), ".codex");
}

export function installCodex(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const dryRun = options.dryRun ?? false;
  const home = codexHome(deps);

  const skillsDir = join(home, "skills", "vx-memory");
  const skillPath = join(skillsDir, "SKILL.md");
  notes.push(
    copyOrPreview(
      ["skills", "codex", "vx-memory", "SKILL.md"],
      skillPath,
      deps,
      dryRun,
      `Installed Codex skill at ${skillPath}`,
    ),
  );

  const configPath = join(home, "config.toml");
  const before = deps.existsSync(configPath) ? readText(configPath, deps) : null;
  const updated = upsertCodexManagedBlock(before ?? "", buildCodexTomlBlock(installUrl(options)));
  notes.push(
    writeOrPreview(
      configPath,
      before,
      updated,
      deps,
      dryRun,
      options.compartment
        ? `Updated Codex MCP config at ${configPath} (compartment: ${options.compartment})`
        : `Updated Codex MCP config at ${configPath}`,
    ),
  );
  notes.push(
    "Restart Codex; it will open your browser to sign in via OAuth on first VX tool use.",
  );
  return notes;
}

export function uninstallCodex(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const dryRun = options.dryRun ?? false;
  const home = codexHome(deps);

  const skillDir = join(home, "skills", "vx-memory");
  if (deps.existsSync(skillDir)) {
    notes.push(
      removeOrPreview(skillDir, deps, dryRun, `Removed Codex skill at ${skillDir}`, {
        recursive: true,
      }),
    );
  }

  const configPath = join(home, "config.toml");
  if (deps.existsSync(configPath)) {
    const before = readText(configPath, deps);
    const stripped = stripCodexManagedBlock(before);
    notes.push(
      writeOrPreview(
        configPath,
        before,
        stripped ? `${stripped}\n` : "",
        deps,
        dryRun,
        `Removed VX MCP configuration from ${configPath}`,
      ),
    );
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
    `    connect_timeout: ${HERMES_MCP_CONNECT_TIMEOUT_SECONDS}`,
    "    auth: oauth",
    "    oauth:",
    `      redirect_port: ${HERMES_OAUTH_REDIRECT_PORT}`,
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

export function stripHermesServerBlock(content: string, serverName: string = VX_MCP_SERVER_NAME): string {
  const lines = content.split(/\r?\n/);
  const mcpIndex = lines.findIndex((line) => /^mcp_servers:\s*$/.test(line));
  if (mcpIndex === -1) return content.trimEnd();

  const nextLines: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (index <= mcpIndex) {
      nextLines.push(lines[index]);
      continue;
    }

    const line = lines[index] ?? "";
    if (/^\S/.test(line) && line.trim() !== "") {
      nextLines.push(...lines.slice(index));
      break;
    }

    if (line === `  ${serverName}:`) {
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index] ?? "";
        if (/^  [^ ].*:\s*$/.test(candidate) || (/^\S/.test(candidate) && candidate.trim() !== "")) {
          index -= 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    nextLines.push(line);
  }

  return nextLines.join("\n").trimEnd();
}

export function upsertHermesManagedBlock(
  content: string,
  block: string = buildHermesManagedBlock(),
): string {
  const stripped = stripHermesServerBlock(stripHermesManagedBlock(content));
  const lines = stripped ? stripped.split(/\r?\n/) : [];
  const mcpIndex = lines.findIndex((line) => /^mcp_servers:\s*$/.test(line));

  if (mcpIndex === -1) {
    return `${stripped}${stripped ? "\n\n" : ""}mcp_servers:\n${block}\n`;
  }

  const nextLines = [...lines];
  nextLines.splice(mcpIndex + 1, 0, ...block.split("\n"));
  return `${nextLines.join("\n").trimEnd()}\n`;
}

export function installHermes(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const dryRun = options.dryRun ?? false;
  const home = hermesHome(deps);

  const skillDir = join(home, "skills", "vx-memory");
  const skillPath = join(skillDir, "SKILL.md");
  notes.push(
    copyOrPreview(
      ["skills", "hermes", "vx-memory", "SKILL.md"],
      skillPath,
      deps,
      dryRun,
      `Installed Hermes skill at ${skillPath}`,
    ),
  );

  const configPath = hermesConfigPath(deps);
  const before = deps.existsSync(configPath) ? readText(configPath, deps) : null;
  const updated = upsertHermesManagedBlock(before ?? "", buildHermesManagedBlock(installUrl(options)));
  notes.push(
    writeOrPreview(
      configPath,
      before,
      updated,
      deps,
      dryRun,
      options.compartment
        ? `Updated Hermes MCP config at ${configPath} (compartment: ${options.compartment})`
        : `Updated Hermes MCP config at ${configPath}`,
    ),
  );
  notes.push(
    "Restart Hermes Agent; it will discover VX MCP tools on startup and open your browser to sign in via OAuth on first VX tool use.",
  );
  notes.push(
    `If Hermes runs in Docker, use \`vx-mcp login hermes\` so the OAuth callback on 127.0.0.1:${HERMES_OAUTH_REDIRECT_PORT} can reach the container.`,
  );
  return notes;
}

function hermesDockerOAuthLoginShell(attempts: number): string {
  return [
    "set -u",
    `attempts=${attempts}`,
    "tmp=$(mktemp)",
    "cleanup() { rm -f \"$tmp\" \"$tmp.status\"; }",
    "trap cleanup EXIT",
    "python3 - <<'PY' &",
    "import socket, threading, time",
    "LISTEN = ('0.0.0.0', 8990)",
    `TARGET = ('127.0.0.1', ${HERMES_OAUTH_REDIRECT_PORT})`,
    "def pipe(src, dst):",
    "    try:",
    "        while True:",
    "            data = src.recv(65536)",
    "            if not data:",
    "                break",
    "            dst.sendall(data)",
    "    except Exception:",
    "        pass",
    "    finally:",
    "        for sock in (src, dst):",
    "            try:",
    "                sock.close()",
    "            except Exception:",
    "                pass",
    "server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
    "server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)",
    "server.bind(LISTEN)",
    "server.listen(50)",
    "while True:",
    "    client, _ = server.accept()",
    "    target = None",
    "    for _ in range(200):",
    "        try:",
    "            target = socket.create_connection(TARGET, timeout=0.25)",
    "            break",
    "        except OSError:",
    "            time.sleep(0.05)",
    "    if target is None:",
    "        client.close()",
    "        continue",
    "    threading.Thread(target=pipe, args=(client, target), daemon=True).start()",
    "    threading.Thread(target=pipe, args=(target, client), daemon=True).start()",
    "PY",
    "forwarder_pid=$!",
    "cleanup_forwarder() { kill \"$forwarder_pid\" >/dev/null 2>&1 || true; cleanup; }",
    "trap cleanup_forwarder EXIT",
    "echo 'VX MCP Hermes OAuth: open the authorization URL as soon as Hermes prints it.'",
    "echo \"Hermes login may time out if approval is not completed quickly; this helper will try up to ${attempts} time(s).\"",
    "attempt=1",
    "last_status=1",
    "while [ \"$attempt\" -le \"$attempts\" ]; do",
    "  : > \"$tmp\"",
    "  rm -f \"$tmp.status\"",
    "  echo \"VX MCP Hermes OAuth attempt ${attempt}/${attempts}.\"",
    "  (/opt/hermes/.venv/bin/python - <<'PYLOGIN' 2>&1; echo $? > \"$tmp.status\") | tee \"$tmp\"",
    "from hermes_cli.config import load_config",
    "from hermes_cli.mcp_config import _get_mcp_servers, _probe_single_server",
    "from hermes_cli.colors import Colors, color",
    "from tools.mcp_oauth_manager import get_manager",
    "",
    "name = 'vx'",
    "servers = _get_mcp_servers(load_config())",
    "if name not in servers:",
    "    raise SystemExit(\"Server 'vx' not found in Hermes config\")",
    "server_config = servers[name]",
    "if server_config.get('auth') != 'oauth':",
    "    raise SystemExit(f\"Server 'vx' is not configured for OAuth (auth={server_config.get('auth')})\")",
    "try:",
    "    get_manager().remove(name)",
    "except Exception as exc:",
    "    print(color(f\"  ⚠ Could not clear existing OAuth state: {exc}\", Colors.YELLOW))",
    "print()",
    "print(color(\"  Starting OAuth flow for 'vx'...\", Colors.DIM))",
    "try:",
    "    tools = _probe_single_server(name, server_config, connect_timeout=180)",
    "    if tools:",
    "        print(color(f\"  ✓ Authenticated — {len(tools)} tool(s) available\", Colors.GREEN))",
    "    else:",
    "        print(color(\"  ✓ Authenticated (server reported no tools)\", Colors.GREEN))",
    "except Exception as exc:",
    "    print(color(f\"  ✗ Authentication failed: {exc}\", Colors.RED))",
    "    raise SystemExit(1)",
    "PYLOGIN",
    "  hermes_status=$(cat \"$tmp.status\" 2>/dev/null || echo 1)",
    "  last_status=\"$hermes_status\"",
    "  if grep -qi 'Authenticated' \"$tmp\"; then",
    "    exit 0",
    "  fi",
    "  if grep -qi 'Authentication failed\\|Connection failed' \"$tmp\"; then",
    "    exit 1",
    "  fi",
    "  if [ \"$attempt\" -lt \"$attempts\" ]; then",
    "    echo 'Hermes OAuth did not complete before this attempt ended. Starting a fresh authorization attempt; use the newest URL printed below.'",
    "  fi",
    "  attempt=$((attempt + 1))",
    "done",
    "exit \"$last_status\"",
  ].join("\n");
}

export function loginHermes(deps: InstallerDeps = defaultDeps): string[] {
  const notes = installHermes(deps);
  const home = hermesHome(deps);
  const attempts = envPositiveInt(
    deps,
    "VX_MCP_HERMES_LOGIN_ATTEMPTS",
    DEFAULT_HERMES_DOCKER_LOGIN_ATTEMPTS,
    MAX_HERMES_DOCKER_LOGIN_ATTEMPTS,
  );
  const result = deps.spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "-p",
      `127.0.0.1:${HERMES_OAUTH_REDIRECT_PORT}:8990`,
      "-v",
      `${home}:/opt/data`,
      "-e",
      "HERMES_HOME=/opt/data",
      "--entrypoint",
      "sh",
      "nousresearch/hermes-agent",
      "-lc",
      hermesDockerOAuthLoginShell(attempts),
    ],
    {
      stdio: "inherit",
      encoding: "utf8",
    },
  );

  if (result.status === 0) {
    notes.push("Hermes OAuth completed through the Docker login helper.");
  } else {
    notes.push(
      `Hermes Docker OAuth helper exited with status ${result.status ?? "unknown"} after ${attempts} attempt(s). Open the newest printed URL quickly and approve VX, or rerun with VX_MCP_HERMES_LOGIN_ATTEMPTS=5.`,
    );
  }
  return notes;
}

function loginHermesSucceeded(notes: string[]): boolean {
  return notes.some((note) => note.includes("OAuth completed"));
}

export function loginOpenClaw(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const config = openClawVxConfig(deps);
  if (!config) {
    notes.push("OpenClaw VX MCP config was not found. Run `vx-mcp install openclaw` first.");
    return notes;
  }

  notes.push(`OpenClaw MCP config includes VX at ${config.path}.`);
  if (config.missingRequiredTools.length > 0) {
    notes.push(openClawToolFilterFixNote(config.missingRequiredTools));
  }

  const profileArgs = openClawProfileArgs(config.path, deps);
  const openclawCli = findCli("openclaw", deps);
  const npxCli = openclawCli ? null : findCli("npx", deps);
  if (!openclawCli && !npxCli) {
    notes.push(
      `Neither OpenClaw CLI nor npx was found. Run manually once available: ${openClawCommand([...profileArgs, "mcp", "login", VX_MCP_SERVER_NAME])}`,
    );
    return notes;
  }

  const command = openclawCli || npxCli!;
  const args = openclawCli
    ? [...profileArgs, "mcp", "login", VX_MCP_SERVER_NAME]
    : ["-y", "openclaw", ...profileArgs, "mcp", "login", VX_MCP_SERVER_NAME];
  const result = deps.spawnSync(command, args, {
    stdio: "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    notes.push(
      `OpenClaw OAuth login exited with status ${result.status ?? "unknown"}. Approve the browser sign-in, then rerun vx-mcp doctor.`,
    );
    return notes;
  }

  const readiness = openClawProbeReadiness(config, deps);
  if (!readiness) {
    notes.push(
      "OpenClaw login command finished, but VX MCP could not verify OAuth because npx is unavailable. Rerun `vx-mcp doctor` to confirm the connection.",
    );
  } else if (openClawOAuthRequired(readiness.notes.join("\n"))) {
    notes.push(
      "OpenClaw OAuth still requires approval. Open the authorization URL printed by OpenClaw, approve VX, complete the `--code <code>` step if OpenClaw prints one, then rerun `vx-mcp smoke openclaw`.",
    );
    notes.push(openClawOAuthCompletionNote(config.path, deps));
  } else {
    notes.push("OpenClaw OAuth completed.");
    notes.push(...readiness.notes);
  }
  return notes;
}

function loginOpenClawSucceeded(notes: string[]): boolean {
  return notes.some((note) => note.includes("OAuth completed"));
}

export function smokeOpenClaw(deps: InstallerDeps = defaultDeps): string[] {
  const notes: string[] = [];
  const config = openClawVxConfig(deps);
  if (!config) {
    notes.push("OpenClaw VX MCP config was not found. Run `vx-mcp install openclaw` first.");
    return notes;
  }

  notes.push(`OpenClaw MCP config includes VX at ${config.path}.`);
  notes.push(`VX endpoint: ${config.url}`);
  if (config.missingRequiredTools.length > 0) {
    notes.push(openClawToolFilterFixNote(config.missingRequiredTools));
    return notes;
  }

  const readiness = openClawProbeReadiness(config, deps);
  if (!readiness) {
    notes.push(
      "OpenClaw smoke could not run because npx is unavailable. Install OpenClaw or npx, then rerun `vx-mcp smoke openclaw`.",
    );
    return notes;
  }

  for (const note of readiness.notes) {
    if (!notes.includes(note)) notes.push(note);
  }
  if (readiness.status !== "ready") {
    notes.push(
      "OpenClaw VX smoke is not ready yet. Complete the OAuth/model step above, then rerun `vx-mcp smoke openclaw`.",
    );
    return notes;
  }

  notes.push("OpenClaw VX smoke ready: OAuth, required VX tools, and model auth are available.");
  const profileArgs = openClawProfileArgs(config.path, deps);
  notes.push(
    [
      "Live proof command:",
      openClawCommand([...profileArgs, "agent", "--local", "--json"]),
      "--session-key agent:vx-smoke:one-memory",
      '--message "Use VX MCP tools. First call vx_librarian_context, then call vx_store to save this memory in VX: VX OpenClaw live smoke can write and recall shared context. Then call vx_recall for VX OpenClaw live smoke and answer with the context and retrieved memory."',
    ].join(" "),
  );
  return notes;
}

function smokeOpenClawSucceeded(notes: string[]): boolean {
  return notes.some((note) => note.includes("OpenClaw VX smoke ready"));
}

function hermesNativeSmokeReadiness(
  executable: string,
  deps: InstallerDeps,
): Pick<ClientReadiness, "status" | "notes"> {
  const serverName = hermesMcpServerName(deps);
  const version = deps.spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  const versionOutput = `${version.stdout ?? ""}\n${version.stderr ?? ""}`.trim();
  if (version.status !== 0) {
    return {
      status: "runtime-error",
      notes: [
        `Hermes config points at the selected VX MCP endpoint, but the local runtime could not start: ${versionOutput || `exit ${version.status ?? "unknown"}`}`,
      ],
    };
  }

  const notes = [
    `Hermes config points at the selected VX MCP endpoint and the local Hermes runtime is executable: ${firstLine(versionOutput) || "version detected"}.`,
  ];
  const test = deps.spawnSync(executable, ["mcp", "test", serverName], {
    encoding: "utf8",
    timeout: 20000,
  });
  const testOutput = `${test.stdout ?? ""}\n${test.stderr ?? ""}`.trim();
  if (/Invalid registration response/i.test(testOutput)) {
    const invalidFields = ["logo_uri", "tos_uri", "policy_uri"]
      .filter((field) => testOutput.includes(field))
      .join(", ");
    return {
      status: "runtime-error",
      notes: [
        ...notes,
        `Hermes reached VX OAuth registration, but the registration response is invalid${invalidFields ? ` for: ${invalidFields}` : ""}.`,
        `Update VX MCP compatibility or Hermes runtime support, then rerun \`hermes mcp login ${serverName}\`.`,
      ],
    };
  }
  if (test.status === 0 && /✓|success|connected/i.test(testOutput)) {
    return {
      status: "ready",
      notes: [...notes, "Hermes MCP test reports VX is connected."],
    };
  }
  if (/401|Unauthorized|needs authentication|authorization required|oauth callback/i.test(testOutput)) {
    const authSummary = /401\s+Unauthorized/i.test(testOutput)
      ? "401 Unauthorized"
      : firstLine(testOutput) || "authentication required";
    return {
      status: "manual-approval",
      notes: [
        ...notes,
        `Hermes can reach VX MCP, but OAuth is not complete: ${authSummary}.`,
        `Run \`vx-mcp login hermes\` or \`hermes mcp login ${serverName}\`, approve VX in the browser, then rerun \`vx-mcp smoke hermes\`.`,
      ],
    };
  }

  return {
    status: "manual-approval",
    notes: [
      ...notes,
      `Hermes VX MCP connection still needs verification: ${firstLine(testOutput) || `exit ${test.status ?? "unknown"}`}.`,
      `Run \`vx-mcp login hermes\` or \`hermes mcp login ${serverName}\`, approve VX in the browser, then rerun \`vx-mcp smoke hermes\`.`,
    ],
  };
}

function hermesSmokeReadiness(deps: InstallerDeps): Pick<ClientReadiness, "status" | "notes"> {
  const configPath = hermesConfigPath(deps);
  const content = deps.existsSync(configPath) ? readText(configPath, deps) : "";
  const serverName = hermesMcpServerName(deps);
  if (!content.includes("mcp_servers:") || !content.includes(`${serverName}:`) || !hasSelectedMcpUrl(content)) {
    const docker = hermesDockerReadiness(deps);
    if (docker) return docker;
    return getClientReadiness("hermes", deps);
  }

  const executable = hermesExecutableCandidate(deps);
  if (executable) {
    const native = hermesNativeSmokeReadiness(executable, deps);
    if (native.status !== "runtime-error") return native;

    const docker = hermesDockerReadiness(deps);
    if (docker) {
      if (docker.status === "ready") return docker;
      return {
        status: docker.status,
        notes: [
          ...docker.notes,
          ...native.notes,
        ],
      };
    }
    return native;
  }

  const docker = hermesDockerReadiness(deps);
  if (docker) return docker;

  return getClientReadiness("hermes", deps);
}

export function smokeHermes(deps: InstallerDeps = defaultDeps): string[] {
  const readiness = hermesSmokeReadiness(deps);
  const notes = [...readiness.notes];
  if (readiness.status !== "ready") {
    notes.push(
      "Hermes VX smoke is not ready yet. Complete the install/OAuth/runtime step above, then rerun `vx-mcp smoke hermes`.",
    );
    return notes;
  }

  notes.push("Hermes VX smoke ready: MCP config and runtime checks are available.");
  notes.push(
    [
      "Live proof prompt:",
      "Use VX MCP tools. First call vx_librarian_context, then save this memory in VX:",
      "VX Hermes live smoke can write and recall shared context. Then recall VX Hermes live smoke and answer with the retrieved memory.",
    ].join(" "),
  );
  return notes;
}

function smokeHermesSucceeded(notes: string[]): boolean {
  return notes.some((note) => note.includes("Hermes VX smoke ready"));
}

export function uninstallHermes(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const dryRun = options.dryRun ?? false;
  const home = hermesHome(deps);

  const skillDir = join(home, "skills", "vx-memory");
  if (deps.existsSync(skillDir)) {
    notes.push(
      removeOrPreview(skillDir, deps, dryRun, `Removed Hermes skill at ${skillDir}`, {
        recursive: true,
      }),
    );
  }

  const configPath = hermesConfigPath(deps);
  if (deps.existsSync(configPath)) {
    const before = readText(configPath, deps);
    const stripped = stripHermesManagedBlock(before);
    notes.push(
      writeOrPreview(
        configPath,
        before,
        stripped ? `${stripped}\n` : "",
        deps,
        dryRun,
        `Removed VX MCP configuration from ${configPath}`,
      ),
    );
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
    // Tolerate a trailing `?compartment=...` (or any other query string) so a
    // compartment-scoped `connect` is still recognized as a VX MCP entry.
    if (typeof url === "string" && /\/mcp\/?(\?[^\s]*)?$/i.test(url)) {
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

export function installOpenClaw(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const dryRun = options.dryRun ?? false;
  const url = installUrl(options);
  const snippet = JSON.stringify(buildOpenClawPluginConfig(url), null, 2);

  const openclawCli = findCli("openclaw", deps);
  if (!openclawCli) {
    if (hasOpenClawInstallSignal(deps)) {
      const npxCli = findCli("npx", deps);
      if (!npxCli) {
        notes.push(
          "OpenClaw config was found, but `npx` was not found on PATH for automatic setup.",
        );
      } else if (dryRun) {
        const profileArgs = openClawInstallProfileArgs(deps);
        notes.push(
          `[dry-run] Would run: ${openClawCommand(openClawMcpAddArgs(url, profileArgs))}`,
        );
        notes.push(
          "[dry-run] Would run: openclaw config patch --stdin to enable plugin tools and compact tool search.",
        );
        notes.push(
          `[dry-run] Would print the login command: ${openClawCommand([...profileArgs, "mcp", "login", VX_MCP_SERVER_NAME])}`,
        );
        return notes;
      } else {
        const profileArgs = openClawInstallProfileArgs(deps);
        const addArgs = ["-y", "openclaw", ...openClawMcpAddArgs(url, profileArgs)];
        const addResult = deps.spawnSync(npxCli, addArgs, { encoding: "utf8" });
        if (addResult.status === 0) {
          notes.push(
            `Configured OpenClaw VX MCP through npx: \`${openClawCommand(openClawMcpAddArgs(url, profileArgs))}\``,
          );
          notes.push(
            `Exposed the core VX MCP tools for OpenClaw: ${RECOMMENDED_OPENCLAW_VX_TOOLS.join(", ")}`,
          );
          const policyResult = applyOpenClawRuntimePolicy(
            npxCli,
            ["-y", "openclaw", ...profileArgs],
            deps,
          );
          if (policyResult.ok) {
            notes.push(
              "Prepared OpenClaw for live VX turns with plugin tools enabled and compact tool search.",
            );
          } else {
            notes.push(
              `OpenClaw MCP was configured, but live-turn tool policy could not be updated automatically: ${policyResult.output}`,
            );
            notes.push(
              "Run manually: openclaw config patch --stdin with tools.alsoAllow=[\"group:plugins\"] and tools.toolSearch enabled.",
            );
          }
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
          `Retry manually: ${openClawCommand(openClawMcpAddArgs(url, profileArgs))}`,
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

  if (dryRun) {
    notes.push(`[dry-run] Would run: openclaw plugins install ${VX_PACKAGE_NAME}`);
    notes.push(
      `[dry-run] Would run: openclaw mcp tools ${VX_MCP_SERVER_NAME} --include ${RECOMMENDED_OPENCLAW_VX_TOOLS.join(",")}`,
    );
    if (options.compartment) {
      notes.push(
        `[dry-run] Would run: openclaw ${openClawMcpAddArgs(url, []).join(" ")} (binds this connection to compartment "${options.compartment}")`,
      );
    }
    notes.push(
      "[dry-run] Would run: openclaw config patch --stdin to enable plugin tools and compact tool search.",
    );
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

    if (options.compartment) {
      const addArgs = openClawMcpAddArgs(url, []);
      const addResult = deps.spawnSync(openclawCli, addArgs, { encoding: "utf8" });
      if (addResult.status === 0) {
        notes.push(`Bound OpenClaw's VX MCP connection to compartment "${options.compartment}".`);
      } else {
        notes.push(
          `OpenClaw plugin installed, but scoping the connection to compartment "${options.compartment}" failed: ${
            addResult.stderr?.trim() || addResult.stdout?.trim() || "unknown error"
          }`,
        );
        notes.push(`Retry manually: openclaw ${addArgs.join(" ")}`);
      }
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

  const profileArgs = openClawInstallProfileArgs(deps);
  const policyResult = applyOpenClawRuntimePolicy(openclawCli, profileArgs, deps);
  if (policyResult.ok) {
    notes.push(
      "Prepared OpenClaw for live VX turns with plugin tools enabled and compact tool search.",
    );
  } else {
    notes.push(
      `OpenClaw plugin installed, but live-turn tool policy could not be updated automatically: ${policyResult.output}`,
    );
    notes.push(
      "Run manually: openclaw config patch --stdin with tools.alsoAllow=[\"group:plugins\"] and tools.toolSearch enabled.",
    );
  }

  notes.push("Add this to your OpenClaw plugin config:");
  notes.push(snippet);
  notes.push(
    "OpenClaw will open your browser to sign in via OAuth on first VX tool use.",
  );
  return notes;
}

export function uninstallOpenClaw(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  const openclawCli = findCli("openclaw", deps);
  if (!openclawCli) {
    notes.push(
      `OpenClaw CLI (\`openclaw\`) was not found on PATH. Remove the plugin manually with \`openclaw plugins remove ${VX_PACKAGE_NAME}\`.`,
    );
    return notes;
  }
  if (options.dryRun) {
    notes.push(`[dry-run] Would run: openclaw plugins remove ${VX_PACKAGE_NAME}`);
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
            : item.status === "unsupported"
              ? "unsupported"
              : "needs-install";
  return `${item.label}: ${icon}`;
}

/**
 * Shared readiness check for the JSON "server map" clients: `ready` when the
 * live config file already contains a vx entry pointing at the selected VX
 * MCP endpoint, `unsupported` when this platform's config path is unknown,
 * `needs-install` otherwise. Re-reads the file on every call (no caching), so
 * it notices when a client's own auto-update wiped the entry out from under
 * us.
 */
function jsonMcpClientReadiness<TFile>(
  target: SupportedClientTarget,
  spec: Pick<JsonMcpClientSpec<TFile>, "resolvePath" | "unsupportedNote">,
  serversKey: string,
  deps: InstallerDeps,
): ClientReadiness {
  const label = CLIENT_LABELS[target];
  const path = spec.resolvePath(deps);
  if (!path) {
    return { target, label, status: "unsupported", notes: [spec.unsupportedNote] };
  }

  const current = readJsonFile<Record<string, unknown>>(path, deps);
  const servers = current?.[serversKey] as Record<string, unknown> | undefined;
  const entry = servers?.[VX_MCP_SERVER_NAME];
  const entryJson = entry ? JSON.stringify(entry) : "";
  if (entry && entryJson.includes(VX_MCP_URL)) {
    return {
      target,
      label,
      status: "ready",
      notes: [`${label} MCP config at ${path} points at the selected VX MCP endpoint.`],
    };
  }

  return {
    target,
    label,
    status: "needs-install",
    notes: [`Run: vx-mcp install ${target}`],
  };
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
      if (entry && "type" in entry && entry.type === "http" && typeof entry.url === "string" && isVxMcpUrl(entry.url)) {
        return {
          target,
          label: CLIENT_LABELS.cursor,
          status: "ready",
          notes: ["Cursor MCP config points at the selected VX MCP endpoint."],
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
      if (content.includes(`[mcp_servers.${VX_MCP_SERVER_NAME}]`) && hasSelectedMcpUrl(content)) {
        return {
          target,
          label: CLIENT_LABELS.codex,
          status: "ready",
          notes: ["Codex MCP config points at the selected VX MCP endpoint."],
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
      if (config && !isVxMcpUrl(config.url)) {
        return {
          target,
          label: CLIENT_LABELS.openclaw,
          status: "needs-install",
          notes: [
            `OpenClaw MCP config includes VX at ${config.path}, but it points at ${config.url}.`,
            `Selected VX MCP endpoint: ${VX_MCP_URL}`,
            "Run: vx-mcp install openclaw",
          ],
        };
      }
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
      const serverName = hermesMcpServerName(deps);
      if (content.includes("mcp_servers:") && content.includes(`${serverName}:`) && hasSelectedMcpUrl(content)) {
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
    case "claude-desktop":
      return jsonMcpClientReadiness(target, claudeDesktopSpec, "mcpServers", deps);
    case "windsurf":
      return jsonMcpClientReadiness(target, windsurfSpec, "mcpServers", deps);
    case "cline":
      return jsonMcpClientReadiness(target, clineSpec, "mcpServers", deps);
    case "vscode":
      return jsonMcpClientReadiness(target, vsCodeSpec, "servers", deps);
    case "zed":
      return jsonMcpClientReadiness(target, zedSpec, "context_servers", deps);
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

// ---------------------------------------------------------------------------
// Status — per-tool access (ONE-118)
//
// Answers "what can <client> see?" in one command. Every client's
// compartment lives inside the same URL `install`/`connect` already wrote
// into that client's own config — there is no second, vx-mcp-owned record
// to keep in sync. `status` just reads each config back and extracts the
// `compartment` query parameter from whatever URL string it finds.
// ---------------------------------------------------------------------------

/** Pull a VX MCP URL out of one JSON server-map entry, whatever shape that
 *  client uses for it: a plain `url`/`serverUrl` field, or (Claude Desktop)
 *  a URL buried in the `mcp-remote` bridge's `args`. */
function extractUrlFromJsonEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.url === "string") return record.url;
  if (typeof record.serverUrl === "string") return record.serverUrl;
  if (Array.isArray(record.args)) {
    const found = record.args.find(
      (arg): arg is string => typeof arg === "string" && arg.startsWith(VX_MCP_URL),
    );
    if (found) return found;
  }
  return null;
}

function jsonClientConfiguredUrl<TFile>(
  spec: Pick<JsonMcpClientSpec<TFile>, "resolvePath">,
  serversKey: string,
  deps: InstallerDeps,
): string | null {
  const path = spec.resolvePath(deps);
  if (!path) return null;
  const current = readJsonFile<Record<string, unknown>>(path, deps);
  const servers = current?.[serversKey] as Record<string, unknown> | undefined;
  return extractUrlFromJsonEntry(servers?.[VX_MCP_SERVER_NAME]);
}

function codexConfiguredUrl(deps: InstallerDeps): string | null {
  const configPath = join(codexHome(deps), "config.toml");
  if (!deps.existsSync(configPath)) return null;
  const content = readText(configPath, deps);
  const match = content.match(/\[mcp_servers\.vx\][^[]*?url\s*=\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

function hermesConfiguredUrl(deps: InstallerDeps): string | null {
  const configPath = hermesConfigPath(deps);
  if (!deps.existsSync(configPath)) return null;
  const content = readText(configPath, deps);
  const serverName = hermesMcpServerName(deps);
  const match = content.match(new RegExp(`${serverName}:\\s*\\n\\s*url:\\s*"([^"]+)"`));
  return match?.[1] ?? null;
}

/** Parses the `vx: <url> ...` line `claude mcp list` prints, the same shape
 *  `claudeMcpListStatus` already matches against for readiness. */
function claudeConfiguredUrl(deps: InstallerDeps): string | null {
  const cli = findCli("claude", deps);
  if (!cli) return null;
  const result = deps.spawnSync(cli, ["mcp", "list"], { encoding: "utf8", timeout: 10000 });
  if (result.status !== 0) return null;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${VX_MCP_SERVER_NAME}:`) && entry.includes(VX_MCP_URL));
  if (!line) return null;
  const match = line.match(/(https?:\/\/\S+)/);
  return match?.[1] ?? null;
}

function configuredVxUrl(target: SupportedClientTarget, deps: InstallerDeps): string | null {
  switch (target) {
    case "claude":
      return claudeConfiguredUrl(deps);
    case "cursor":
      return extractUrlFromJsonEntry(
        readJsonFile<CursorMcpFile>(cursorMcpJsonPath(deps), deps)?.mcpServers?.[VX_MCP_SERVER_NAME],
      );
    case "codex":
      return codexConfiguredUrl(deps);
    case "openclaw":
      return openClawVxConfig(deps)?.url ?? null;
    case "hermes":
      return hermesConfiguredUrl(deps);
    case "claude-desktop":
      return jsonClientConfiguredUrl(claudeDesktopSpec, "mcpServers", deps);
    case "windsurf":
      return jsonClientConfiguredUrl(windsurfSpec, "mcpServers", deps);
    case "cline":
      return jsonClientConfiguredUrl(clineSpec, "mcpServers", deps);
    case "vscode":
      return jsonClientConfiguredUrl(vsCodeSpec, "servers", deps);
    case "zed":
      return jsonClientConfiguredUrl(zedSpec, "context_servers", deps);
  }
}

export type ClientAccessStatus = {
  target: SupportedClientTarget;
  label: string;
  connected: boolean;
  /** The bound compartment name, or `null` when either not connected or
   *  connected without one (a legacy/unscoped `install`). */
  compartment: string | null;
  url: string | null;
};

/** The single source `status` (and anything else asking "what can this
 *  client see?") reads from: whatever URL is actually sitting in that
 *  client's own config or CLI state right now. */
export function getClientAccessStatus(
  target: SupportedClientTarget,
  deps: InstallerDeps = defaultDeps,
): ClientAccessStatus {
  const label = CLIENT_LABELS[target];
  const url = configuredVxUrl(target, deps);
  if (!url) {
    return { target, label, connected: false, compartment: null, url: null };
  }
  return { target, label, connected: true, compartment: extractCompartment(url), url };
}

export function buildStatusReport(deps: InstallerDeps = defaultDeps): string[] {
  const rows = SUPPORTED_CLIENT_TARGETS.map((target) => getClientAccessStatus(target, deps));
  const lines = [`VX MCP per-client access (${VX_MCP_URL})`, ""];
  for (const row of rows) {
    if (!row.connected) {
      lines.push(`- ${row.label}: not connected`);
      continue;
    }
    if (row.compartment) {
      lines.push(`- ${row.label}: connected — compartment "${row.compartment}"`);
    } else {
      lines.push(
        `- ${row.label}: connected — UNSCOPED (no named compartment; can read everything this account grants)`,
      );
      lines.push(`    Run: vx-mcp connect ${row.target} --compartment <name> to scope it`);
    }
  }
  lines.push("");
  lines.push(
    "Compartments are carried in each client's own connection URL; the hosted VX MCP endpoint is responsible for enforcing them.",
  );
  lines.push(
    "vx-mcp only writes client config and reads it back here — it does not store credentials or verify enforcement itself.",
  );
  return lines;
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
  lines.push("  1. During OAuth consent, choose the Knowledge Contexts this agent may use.");
  lines.push("  2. For OpenClaw, run vx-mcp smoke openclaw after consent to verify tools and model readiness.");
  lines.push("  3. If the vx-librarian context is empty, call vx_librarian_seed once.");
  lines.push("  4. Call vx_librarian_context to load VX purpose and memory policy from VX memory.");
  lines.push("  5. Call vx_reality with the context the agent should use.");
  lines.push("  Do not copy VX policy into local prompts; keep agent reality in VX contexts.");
  return lines;
}

// ---------------------------------------------------------------------------
// Detection — which supported AI tools are actually installed on this
// machine, independent of whether VX is configured for them yet. Meant for
// a GUI (vx-mac-app) to offer "we found N tools — connect them?" instead of
// making the user pick blind from a list.
// ---------------------------------------------------------------------------

export type ClientDetection = {
  target: SupportedClientTarget;
  label: string;
  installed: boolean;
  evidence: string[];
};

type DetectionSignal = { evidence: string };

function detectByCli(binary: string, deps: InstallerDeps): DetectionSignal | null {
  const path = findCli(binary, deps);
  return path ? { evidence: `\`${binary}\` CLI found on PATH (${path})` } : null;
}

function detectByPath(
  path: string | null,
  deps: InstallerDeps,
  label: string,
): DetectionSignal | null {
  return path && deps.existsSync(path) ? { evidence: `Found ${label} at ${path}` } : null;
}

/** Only meaningful on macOS, where installed apps live under /Applications
 *  with a predictable bundle name. There is no equivalently reliable,
 *  install-location-independent signal for Windows or Linux app bundles. */
function macAppBundlePath(deps: InstallerDeps, appName: string): string | null {
  return deps.platform === "darwin" ? join("/Applications", `${appName}.app`) : null;
}

function detectClient(target: SupportedClientTarget, deps: InstallerDeps): ClientDetection {
  const label = CLIENT_LABELS[target];
  const signals: DetectionSignal[] = [];
  const add = (signal: DetectionSignal | null) => {
    if (signal) signals.push(signal);
  };

  switch (target) {
    case "claude":
      add(detectByCli("claude", deps));
      add(detectByPath(join(deps.homedir(), ".claude"), deps, "~/.claude"));
      break;
    case "cursor":
      add(detectByPath(macAppBundlePath(deps, "Cursor"), deps, "Cursor.app"));
      add(detectByPath(join(deps.homedir(), ".cursor"), deps, "~/.cursor"));
      break;
    case "codex":
      add(detectByCli("codex", deps));
      add(detectByPath(codexHome(deps), deps, "the Codex home directory"));
      break;
    case "openclaw":
      add(detectByCli("openclaw", deps));
      for (const candidate of openClawConfigPathCandidates(deps)) {
        add(detectByPath(candidate, deps, candidate));
      }
      break;
    case "hermes": {
      const executable = hermesExecutableCandidate(deps);
      if (executable) add({ evidence: `Hermes executable found at ${executable}` });
      add(detectByPath(hermesHome(deps), deps, "~/.hermes"));
      break;
    }
    case "claude-desktop": {
      add(detectByPath(macAppBundlePath(deps, "Claude"), deps, "Claude.app"));
      const configPath = claudeDesktopConfigPath(deps);
      add(
        detectByPath(
          configPath ? dirname(configPath) : null,
          deps,
          "the Claude Desktop config directory",
        ),
      );
      break;
    }
    case "windsurf":
      add(detectByPath(macAppBundlePath(deps, "Windsurf"), deps, "Windsurf.app"));
      add(detectByPath(dirname(windsurfConfigPath(deps)), deps, "~/.codeium/windsurf"));
      break;
    case "cline": {
      const path = clineMcpSettingsPath(deps);
      // .../globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
      // -> .../globalStorage/saoudrizwan.claude-dev
      const extensionDir = path ? dirname(dirname(path)) : null;
      add(detectByPath(extensionDir, deps, "the Cline extension's globalStorage directory"));
      break;
    }
    case "vscode":
      add(detectByCli("code", deps));
      add(detectByPath(macAppBundlePath(deps, "Visual Studio Code"), deps, "Visual Studio Code.app"));
      add(detectByPath(vsCodeUserDir(deps), deps, "the VS Code user profile directory"));
      break;
    case "zed": {
      add(detectByCli("zed", deps));
      add(detectByPath(macAppBundlePath(deps, "Zed"), deps, "Zed.app"));
      const settingsPath = zedSettingsPath(deps);
      add(detectByPath(settingsPath ? dirname(settingsPath) : null, deps, "the Zed config directory"));
      break;
    }
  }

  return {
    target,
    label,
    installed: signals.length > 0,
    evidence: signals.map((signal) => signal.evidence),
  };
}

/** Detect every supported client, independent of VX config state. */
export function detectClients(deps: InstallerDeps = defaultDeps): ClientDetection[] {
  return SUPPORTED_CLIENT_TARGETS.map((target) => detectClient(target, deps));
}

export function formatDetectReport(detections: ClientDetection[]): string[] {
  const found = detections.filter((item) => item.installed);
  const lines = [
    `Detected ${found.length} of ${detections.length} supported AI tools on this machine:`,
  ];
  for (const item of detections) {
    lines.push(`- ${item.label}: ${item.installed ? "found" : "not found"}`);
    for (const evidence of item.evidence) {
      lines.push(`  ${evidence}`);
    }
  }
  if (found.length > 0) {
    lines.push("");
    lines.push(`Connect them: vx-mcp install ${found.map((item) => item.target).join(" && vx-mcp install ")}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Bulk installer
// ---------------------------------------------------------------------------

export function installAll(
  deps: InstallerDeps = defaultDeps,
  options: InstallOptions = {},
): string[] {
  const notes: string[] = [];
  for (const target of SUPPORTED_CLIENT_TARGETS) {
    notes.push(`${CLIENT_LABELS[target]}:`);
    for (const note of runInstall(target, deps, options)) {
      notes.push(`  ${note}`);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const ALL_TARGETS_USAGE = SUPPORTED_CLIENT_TARGETS.join("|");

const USAGE = [
  `Usage: vx-mcp <command> [target] [--dry-run] [--json]`,
  ``,
  `Commands:`,
  `  connect <${ALL_TARGETS_USAGE}> --compartment <name>`,
  `                                             Wire up one client, scoped to a named compartment`,
  `  install <all|${ALL_TARGETS_USAGE}>`,
  `                                             Wire up clients to ${VX_MCP_URL} (no compartment)`,
  `  uninstall <${ALL_TARGETS_USAGE}>`,
  `                                             Remove the VX MCP entry`,
  `  status                                    Show every connected client and its bound compartment`,
  `  login <openclaw|hermes|all>               Authorize OAuth MCP clients that support CLI login`,
  `  smoke <openclaw|hermes>                   Verify MCP OAuth/tools/model readiness before a live agent turn`,
  `  doctor                                    Report local VX MCP readiness`,
  `  detect                                    Report which supported AI tools are installed on this machine`,
  `  clients                                   List supported clients`,
  `  --compartment <name>                      With connect: the named compartment to bind (required)`,
  `  --dry-run                                 With connect/install/uninstall: print exactly what would change, write nothing`,
  `  --json                                    With detect: emit machine-readable JSON`,
  `  --version, -v                             Print package version`,
  `  --help, -h                                Show this message`,
  ``,
  `OAuth happens automatically. Your client will open your browser to sign`,
  `in on the first VX tool call. No API key is needed.`,
  ``,
  `Every connect requires a named compartment — there is no unscoped default.`,
  `An empty or missing compartment is refused rather than written, because an`,
  `unscoped connection can read everything the account grants.`,
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

/** Pulls a `--flag <value>` pair out of argv, returning the value and the
 *  remaining args with both the flag and its value removed. Used for
 *  `--compartment <name>`, which (unlike `--dry-run`/`--json`) takes a value
 *  rather than being a bare boolean switch. */
function extractFlagValue(argv: string[], flag: string): { value: string | undefined; rest: string[] } {
  const index = argv.indexOf(flag);
  if (index === -1) return { value: undefined, rest: argv };
  const value = argv[index + 1];
  const rest = [...argv.slice(0, index), ...argv.slice(index + 2)];
  return { value, rest };
}

export async function handleCli(
  argv: string[],
  deps: InstallerDeps = defaultDeps,
): Promise<boolean> {
  const { value: compartmentArg, rest: afterCompartment } = extractFlagValue(argv, "--compartment");
  const dryRun = afterCompartment.includes("--dry-run");
  const json = afterCompartment.includes("--json");
  const positional = afterCompartment.filter((arg) => arg !== "--dry-run" && arg !== "--json");
  const [command, target] = positional;

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

  if (command === "status") {
    for (const line of buildStatusReport(deps)) {
      console.log(line);
    }
    return true;
  }

  if (command === "connect") {
    if (!target || !isSupportedClient(target)) {
      console.error(
        `Unknown target ${target ? `\`${target}\`` : "(missing)"}. Supported: ${SUPPORTED_CLIENT_TARGETS.join(", ")}.`,
      );
      printHelp();
      return true;
    }

    const validation = validateCompartmentName(compartmentArg);
    if (!validation.ok) {
      console.error(validation.error);
      console.error(
        "Refusing to connect without a named compartment: an unscoped connection can read everything this account grants.",
      );
      process.exitCode = 1;
      return true;
    }

    const notes = runInstall(target, deps, { dryRun, compartment: validation.name });
    console.log(
      `${dryRun ? "Previewed connecting" : "Connected"} ${CLIENT_LABELS[target]} scoped to compartment "${validation.name}".`,
    );
    for (const note of notes) {
      console.log(`- ${note}`);
    }
    if (!dryRun) {
      console.log(`Run \`vx-mcp status\` to confirm what ${CLIENT_LABELS[target]} can now see.`);
    }
    return true;
  }

  if (command === "detect") {
    const detections = detectClients(deps);
    if (json) {
      console.log(JSON.stringify(detections, null, 2));
    } else {
      for (const line of formatDetectReport(detections)) {
        console.log(line);
      }
    }
    return true;
  }

  if (command === "login") {
    if (target === "openclaw") {
      const notes = loginOpenClaw(deps);
      console.log("Started VX MCP login for OpenClaw.");
      for (const note of notes) {
        console.log(`- ${note}`);
      }
      if (!loginOpenClawSucceeded(notes)) {
        process.exitCode = 1;
      }
      return true;
    }

    if (target === "hermes") {
      const notes = loginHermes(deps);
      console.log("Started VX MCP login for Hermes.");
      for (const note of notes) {
        console.log(`- ${note}`);
      }
      if (!loginHermesSucceeded(notes)) {
        process.exitCode = 1;
      }
      return true;
    }

    if (target === "all") {
      const openClawNotes = loginOpenClaw(deps);
      console.log("Started VX MCP login for OpenClaw.");
      for (const note of openClawNotes) {
        console.log(`- ${note}`);
      }

      const hermesNotes = loginHermes(deps);
      console.log("Started VX MCP login for Hermes.");
      for (const note of hermesNotes) {
        console.log(`- ${note}`);
      }

      if (!loginOpenClawSucceeded(openClawNotes) || !loginHermesSucceeded(hermesNotes)) {
        process.exitCode = 1;
      }
      return true;
    }

    {
      console.error("Unknown login target. Supported: openclaw, hermes, all.");
      printHelp();
      return true;
    }
  }

  if (command === "smoke") {
    if (target === "openclaw") {
      const notes = smokeOpenClaw(deps);
      console.log("VX MCP smoke for OpenClaw.");
      for (const note of notes) {
        console.log(`- ${note}`);
      }
      if (!smokeOpenClawSucceeded(notes)) {
        process.exitCode = 1;
      }
      return true;
    }

    if (target === "hermes") {
      const notes = smokeHermes(deps);
      console.log("VX MCP smoke for Hermes.");
      for (const note of notes) {
        console.log(`- ${note}`);
      }
      if (!smokeHermesSucceeded(notes)) {
        process.exitCode = 1;
      }
      return true;
    }

    {
      console.error("Unknown smoke target. Supported: openclaw, hermes.");
      printHelp();
      return true;
    }
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
      notes = installAll(deps, { dryRun });
    } else if (isSupportedClient(target)) {
      notes =
        command === "install"
          ? runInstall(target, deps, { dryRun })
          : runUninstall(target, deps, { dryRun });
    } else {
      console.error(`Unknown target \`${target}\`.`);
      printHelp();
      return true;
    }

    const verb = command === "install"
      ? (dryRun ? "Previewed install of" : "Installed")
      : (dryRun ? "Previewed removal of" : "Removed");
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

function runInstall(
  target: SupportedClientTarget,
  deps: InstallerDeps,
  options: InstallOptions = {},
): string[] {
  switch (target) {
    case "claude":
      return installClaude(deps, options);
    case "cursor":
      return installCursor(deps, options);
    case "codex":
      return installCodex(deps, options);
    case "openclaw":
      return installOpenClaw(deps, options);
    case "hermes":
      return installHermes(deps, options);
    case "claude-desktop":
      return installClaudeDesktop(deps, options);
    case "windsurf":
      return installWindsurf(deps, options);
    case "cline":
      return installCline(deps, options);
    case "zed":
      return installZed(deps, options);
    case "vscode":
      return installVsCode(deps, options);
  }
}

function runUninstall(
  target: SupportedClientTarget,
  deps: InstallerDeps,
  options: InstallOptions = {},
): string[] {
  switch (target) {
    case "claude":
      return uninstallClaude(deps, options);
    case "cursor":
      return uninstallCursor(deps, options);
    case "codex":
      return uninstallCodex(deps, options);
    case "openclaw":
      return uninstallOpenClaw(deps, options);
    case "claude-desktop":
      return uninstallClaudeDesktop(deps, options);
    case "windsurf":
      return uninstallWindsurf(deps, options);
    case "cline":
      return uninstallCline(deps, options);
    case "zed":
      return uninstallZed(deps, options);
    case "vscode":
      return uninstallVsCode(deps, options);
    case "hermes":
      return uninstallHermes(deps, options);
  }
}
