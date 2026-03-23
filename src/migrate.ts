import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  type Dirent,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { VX_DEFAULT_API_BASE_URL } from "./constants.js";
import { assertVxCredentials, normalizeApiBaseUrl } from "./runtime.js";
import {
  createVxClient,
  type CreateMemoryInput,
  type CreateMemoriesBatchResponse,
  type VxApiClient,
} from "./sdk/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_MAX_CHUNK_CHARS = 4000;
const MIN_CHUNK_CHARS = 200;

export type MigrationSource = "codex" | "claude" | "openclaw";
export type MigrationMode = MigrationSource | "all";
export type MigrationRole = "user" | "assistant";

export type MigrationTurn = {
  source: MigrationSource;
  sessionId: string;
  role: MigrationRole;
  content: string;
  sequence: number;
  timestamp?: string;
  project?: string;
  cwd?: string;
};

export type MigrationChunk = {
  source: MigrationSource;
  memory: CreateMemoryInput;
};

export type MigrationSourceReport = {
  source: MigrationSource;
  sessionsDetected: number;
  turnsImported: number;
  fragmentsCreated: number;
  itemsSkipped: number;
  status: "ready" | "skipped";
  reason?: string;
};

export type MigrationReport = {
  dryRun: boolean;
  context?: string;
  importedAt: string;
  totalSourcesProcessed: number;
  totalSessionsDetected: number;
  totalTurnsImported: number;
  totalFragmentsCreated: number;
  totalItemsSkipped: number;
  result?: CreateMemoriesBatchResponse;
  sources: MigrationSourceReport[];
};

export type ParsedMigrationInput = {
  mode: MigrationMode;
  dryRun: boolean;
  context?: string;
  path?: string;
  openclawPath?: string;
};

export type MigrationDeps = {
  env: NodeJS.ProcessEnv;
  homedir: typeof homedir;
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
  readdirSync: typeof readdirSync;
  statSync: typeof statSync;
  now: () => Date;
  createClient: (config: {
    apiBaseUrl: string;
    apiKey?: string;
    bearerToken?: string;
    custodianId?: string;
    source: string;
  }) => VxApiClient;
};

const defaultDeps: MigrationDeps = {
  env: process.env,
  homedir,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  now: () => new Date(),
  createClient: (config) => createVxClient(config),
};

function resolveDeps(overrides: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    ...defaultDeps,
    ...overrides,
    env: overrides.env ?? defaultDeps.env,
  };
}

function readCliVersion(deps: Pick<MigrationDeps, "readFileSync">): string {
  try {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(deps.readFileSync(packageJsonPath, "utf8")) as {
      version?: string;
    };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function isConversationRole(value: unknown): value is MigrationRole {
  return value === "user" || value === "assistant";
}

function safeParseJson(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readJsonlFile(
  filePath: string,
  onLine: (line: string) => void | Promise<void>
): Promise<void> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      await onLine(line);
    }
  } finally {
    lines.close();
    input.close();
  }
}

function normalizeMultilineText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractCodexMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = content.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const block = item as { type?: string; text?: unknown };
    if (
      (block.type === "input_text" ||
        block.type === "output_text" ||
        block.type === "text") &&
      typeof block.text === "string"
    ) {
      return [block.text];
    }

    return [];
  });

  return normalizeMultilineText(textParts);
}

function extractClaudeMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = content.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const block = item as { type?: string; text?: unknown };
    if (block.type === "text" && typeof block.text === "string") {
      return [block.text];
    }

    return [];
  });

  return normalizeMultilineText(textParts);
}

function looksLikeCodexScaffolding(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("<user_instructions>") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("# Context from my IDE setup:")
  );
}

function chunkTurnContent(raw: string, maxChunkChars: number): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const chunks: string[] = [];
  const paragraphs = trimmed.split(/\n\s*\n/);
  let current = "";

  for (const paragraph of paragraphs) {
    const line = paragraph.trim();
    if (!line) {
      continue;
    }

    if (current.length + line.length + 2 <= maxChunkChars) {
      current = current ? `${current}\n\n${line}` : line;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= maxChunkChars) {
      current = line;
      continue;
    }

    for (let start = 0; start < line.length; start += maxChunkChars) {
      const nextChunk = line.slice(start, start + maxChunkChars).trim();
      if (nextChunk) {
        chunks.push(nextChunk);
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function listFilesRecursive(
  root: string,
  deps: Pick<MigrationDeps, "existsSync" | "readdirSync" | "statSync">
): string[] {
  if (!deps.existsSync(root)) {
    return [];
  }

  const results: string[] = [];
  const walk = (dir: string) => {
    const entries = deps.readdirSync(dir, {
      withFileTypes: true,
    }) as Dirent[];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && extname(entry.name) === ".jsonl") {
        results.push(fullPath);
      }
    }
  };

  walk(root);
  return results.sort();
}

function resolveCodexPaths(
  deps: Pick<MigrationDeps, "homedir" | "existsSync" | "readdirSync" | "statSync">
): { files: string[]; mode: "archive" | "history" | "missing" } {
  const home = deps.homedir();
  const archiveDir = join(home, ".codex", "archived_sessions");
  const archiveFiles = deps.existsSync(archiveDir)
    ? deps
        .readdirSync(archiveDir)
        .filter((name) => extname(name) === ".jsonl")
        .map((name) => join(archiveDir, name))
        .sort()
    : [];

  if (archiveFiles.length > 0) {
    return { files: archiveFiles, mode: "archive" };
  }

  const historyPath = join(home, ".codex", "history.jsonl");
  if (deps.existsSync(historyPath)) {
    return { files: [historyPath], mode: "history" };
  }

  return { files: [], mode: "missing" };
}

function resolveClaudePaths(
  deps: Pick<MigrationDeps, "homedir" | "existsSync" | "readdirSync" | "statSync">
): { files: string[]; mode: "projects" | "history" | "missing" } {
  const home = deps.homedir();
  const projectsDir = join(home, ".claude", "projects");
  const projectFiles = listFilesRecursive(projectsDir, deps);
  if (projectFiles.length > 0) {
    return { files: projectFiles, mode: "projects" };
  }

  const historyPath = join(home, ".claude", "history.jsonl");
  if (deps.existsSync(historyPath)) {
    return { files: [historyPath], mode: "history" };
  }

  return { files: [], mode: "missing" };
}

async function parseCodexArchiveFile(
  filePath: string,
  _deps: Pick<MigrationDeps, "readFileSync">
): Promise<{ turns: MigrationTurn[]; skipped: number; sessionIds: Set<string> }> {
  const turns: MigrationTurn[] = [];
  const sessionIds = new Set<string>();
  let skipped = 0;
  let sessionId = basename(filePath, ".jsonl");
  let cwd: string | undefined;
  let sequence = 0;

  await readJsonlFile(filePath, async (line) => {
    if (!line.trim()) {
      return;
    }

    const record = safeParseJson(line) as
      | {
          timestamp?: string;
          type?: string;
          payload?: {
            id?: string;
            cwd?: string;
            type?: string;
            role?: string;
            content?: unknown;
          };
        }
      | null;

    if (!record) {
      skipped += 1;
      return;
    }

    if (record.type === "session_meta") {
      if (record.payload?.id) {
        sessionId = record.payload.id;
      }
      if (record.payload?.cwd) {
        cwd = record.payload.cwd;
      }
      sessionIds.add(sessionId);
      return;
    }

    if (record.type !== "response_item" || record.payload?.type !== "message") {
      return;
    }

    const role = record.payload.role;
    if (!isConversationRole(role)) {
      skipped += 1;
      return;
    }

    const content = extractCodexMessageText(record.payload.content);
    if (!content || looksLikeCodexScaffolding(content)) {
      skipped += 1;
      return;
    }

    sequence += 1;
    sessionIds.add(sessionId);
    turns.push({
      source: "codex",
      sessionId,
      role,
      content,
      sequence,
      timestamp: record.timestamp,
      cwd,
    });
  });

  return { turns, skipped, sessionIds };
}

async function parseCodexHistoryFile(
  filePath: string,
  _deps: Pick<MigrationDeps, "readFileSync">
): Promise<{ turns: MigrationTurn[]; skipped: number; sessionIds: Set<string> }> {
  const turns: MigrationTurn[] = [];
  const sessionIds = new Set<string>();
  const sequenceBySession = new Map<string, number>();
  let skipped = 0;

  await readJsonlFile(filePath, async (line) => {
    if (!line.trim()) {
      return;
    }

    const record = safeParseJson(line) as
      | {
          session_id?: string;
          ts?: number;
          text?: string;
        }
      | null;

    if (!record || typeof record.text !== "string" || !record.text.trim()) {
      skipped += 1;
      return;
    }

    const sessionId = record.session_id || "codex-history";
    const nextSequence = (sequenceBySession.get(sessionId) || 0) + 1;
    sequenceBySession.set(sessionId, nextSequence);
    sessionIds.add(sessionId);
    turns.push({
      source: "codex",
      sessionId,
      role: "user",
      content: record.text.trim(),
      sequence: nextSequence,
      timestamp:
        typeof record.ts === "number"
          ? new Date(record.ts * 1000).toISOString()
          : undefined,
    });
  });

  return { turns, skipped, sessionIds };
}

async function parseClaudeProjectFile(
  filePath: string,
  _deps: Pick<MigrationDeps, "readFileSync">
): Promise<{ turns: MigrationTurn[]; skipped: number; sessionIds: Set<string> }> {
  const turns: MigrationTurn[] = [];
  const sessionIds = new Set<string>();
  const sequenceBySession = new Map<string, number>();
  let skipped = 0;

  await readJsonlFile(filePath, async (line) => {
    if (!line.trim()) {
      return;
    }

    const record = safeParseJson(line) as
      | {
          type?: string;
          cwd?: string;
          sessionId?: string;
          timestamp?: string;
          message?: {
            role?: string;
            content?: unknown;
          };
        }
      | null;

    if (!record || (record.type !== "user" && record.type !== "assistant")) {
      return;
    }

    const role = record.message?.role || record.type;
    if (!isConversationRole(role)) {
      skipped += 1;
      return;
    }

    const content = extractClaudeMessageText(record.message?.content);
    if (!content) {
      skipped += 1;
      return;
    }

    const sessionId = record.sessionId || basename(filePath, ".jsonl");
    const nextSequence = (sequenceBySession.get(sessionId) || 0) + 1;
    sequenceBySession.set(sessionId, nextSequence);
    sessionIds.add(sessionId);
    turns.push({
      source: "claude",
      sessionId,
      role,
      content,
      sequence: nextSequence,
      timestamp: record.timestamp,
      cwd: record.cwd,
    });
  });

  return { turns, skipped, sessionIds };
}

async function parseClaudeHistoryFile(
  filePath: string,
  _deps: Pick<MigrationDeps, "readFileSync">
): Promise<{ turns: MigrationTurn[]; skipped: number; sessionIds: Set<string> }> {
  const turns: MigrationTurn[] = [];
  const sessionIds = new Set<string>();
  const sessionId = "claude-history";
  let skipped = 0;
  let sequence = 0;

  await readJsonlFile(filePath, async (line) => {
    if (!line.trim()) {
      return;
    }

    const record = safeParseJson(line) as
      | {
          display?: string;
          timestamp?: number;
          project?: string;
        }
      | null;

    if (!record || typeof record.display !== "string" || !record.display.trim()) {
      skipped += 1;
      return;
    }

    sequence += 1;
    sessionIds.add(sessionId);
    turns.push({
      source: "claude",
      sessionId,
      role: "user",
      content: record.display.trim(),
      sequence,
      timestamp:
        typeof record.timestamp === "number"
          ? new Date(record.timestamp).toISOString()
          : undefined,
      project: record.project,
    });
  });

  return { turns, skipped, sessionIds };
}

function parseOpenClawObject(
  value: unknown,
  sessionFallback: string,
  sequenceCounter: Map<string, number>
): { turn?: MigrationTurn; skipped: boolean } {
  if (!value || typeof value !== "object") {
    return { skipped: true };
  }

  const record = value as {
    sessionId?: string;
    role?: string;
    content?: unknown;
    timestamp?: string;
    project?: string;
    cwd?: string;
  };

  if (!isConversationRole(record.role) || typeof record.content !== "string") {
    return { skipped: true };
  }

  const content = record.content.trim();
  if (!content) {
    return { skipped: true };
  }

  const sessionId = record.sessionId || sessionFallback;
  const nextSequence = (sequenceCounter.get(sessionId) || 0) + 1;
  sequenceCounter.set(sessionId, nextSequence);

  return {
    skipped: false,
    turn: {
      source: "openclaw",
      sessionId,
      role: record.role,
      content,
      sequence: nextSequence,
      timestamp: record.timestamp,
      project: record.project,
      cwd: record.cwd,
    },
  };
}

async function parseOpenClawFile(
  filePath: string,
  deps: Pick<MigrationDeps, "readFileSync">
): Promise<{ turns: MigrationTurn[]; skipped: number; sessionIds: Set<string> }> {
  const turns: MigrationTurn[] = [];
  const sessionIds = new Set<string>();
  const sequenceCounter = new Map<string, number>();
  let skipped = 0;
  const sessionFallback = basename(filePath, extname(filePath)) || "openclaw-import";

  if (extname(filePath) === ".json") {
    const raw = deps.readFileSync(filePath, "utf8").trim();
    if (!raw) {
      return { turns: [], skipped: 0, sessionIds: new Set() };
    }
    const parsed = safeParseJson(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const result = parseOpenClawObject(item, sessionFallback, sequenceCounter);
      if (result.skipped || !result.turn) {
        skipped += 1;
        continue;
      }
      sessionIds.add(result.turn.sessionId);
      turns.push(result.turn);
    }
    return { turns, skipped, sessionIds };
  }

  await readJsonlFile(filePath, async (line) => {
    if (!line.trim()) {
      return;
    }
    const parsed = safeParseJson(line);
    const result = parseOpenClawObject(parsed, sessionFallback, sequenceCounter);
    if (result.skipped || !result.turn) {
      skipped += 1;
      return;
    }
    sessionIds.add(result.turn.sessionId);
    turns.push(result.turn);
  });

  return { turns, skipped, sessionIds };
}

function buildChunksForTurns(
  turns: MigrationTurn[],
  options: {
    context?: string;
    importedAt: string;
    migrationVersion: string;
    maxChunkChars?: number;
  }
): MigrationChunk[] {
  const maxChunkChars = Math.max(
    MIN_CHUNK_CHARS,
    options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS
  );

  return turns.flatMap((turn) => {
    const fragments = chunkTurnContent(turn.content, maxChunkChars);
    const chunkCount = fragments.length;

    return fragments.map((fragment, index) => ({
      source: turn.source,
      memory: {
        content: fragment,
        context: options.context,
        source: turn.source,
        memoryType: "EPISODIC",
        metadata: {
          importedFrom: turn.source,
          importedAt: options.importedAt,
          originalSessionId: turn.sessionId,
          originalRole: turn.role,
          originalTimestamp: turn.timestamp,
          originalProject: turn.project,
          originalCwd: turn.cwd,
          sequence: turn.sequence,
          chunkIndex: index + 1,
          chunkCount,
          migrationVersion: options.migrationVersion,
        },
      },
    }));
  });
}

function summarizeSource(
  source: MigrationSource,
  turns: MigrationTurn[],
  chunks: MigrationChunk[],
  itemsSkipped: number,
  reason?: string
): MigrationSourceReport {
  const sessionIds = new Set(turns.map((turn) => turn.sessionId));
  return {
    source,
    sessionsDetected: sessionIds.size,
    turnsImported: turns.length,
    fragmentsCreated: chunks.length,
    itemsSkipped,
    status: reason ? "skipped" : "ready",
    reason,
  };
}

function formatReport(report: MigrationReport): string {
  const lines = [
    `VX migration ${report.dryRun ? "dry run" : "completed"}.`,
    `Context override: ${report.context || "none"}`,
    `Sources processed: ${report.totalSourcesProcessed}`,
    `Sessions detected: ${report.totalSessionsDetected}`,
    `Turns imported: ${report.totalTurnsImported}`,
    `Fragments created: ${report.totalFragmentsCreated}`,
    `Items skipped: ${report.totalItemsSkipped}`,
  ];

  if (report.result?.errors?.length) {
    lines.push(`Import errors: ${report.result.errors.length}`);
  }

  for (const source of report.sources) {
    lines.push(
      [
        `[${source.source}]`,
        `status=${source.status}`,
        `sessions=${source.sessionsDetected}`,
        `turns=${source.turnsImported}`,
        `fragments=${source.fragmentsCreated}`,
        `skipped=${source.itemsSkipped}`,
        source.reason ? `reason=${source.reason}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  return lines.join("\n");
}

export function parseMigrateCliArgs(args: string[]): ParsedMigrationInput {
  let mode: MigrationMode = "all";
  let index = 0;

  if (args[0] && !args[0].startsWith("--")) {
    const candidate = args[0];
    if (
      candidate === "all" ||
      candidate === "codex" ||
      candidate === "claude" ||
      candidate === "openclaw"
    ) {
      mode = candidate;
      index = 1;
    } else {
      throw new Error(`Unknown migration target: ${candidate}`);
    }
  }

  let dryRun = false;
  let context: string | undefined;
  let path: string | undefined;
  let openclawPath: string | undefined;

  while (index < args.length) {
    const arg = args[index]!;
    const [flag, inlineValue] = arg.split("=", 2);

    switch (flag) {
      case "--dry-run":
        dryRun = true;
        index += 1;
        break;
      case "--context":
        context = inlineValue ?? args[index + 1];
        if (!context) {
          throw new Error("--context requires a value");
        }
        index += inlineValue ? 1 : 2;
        break;
      case "--path":
        path = inlineValue ?? args[index + 1];
        if (!path) {
          throw new Error("--path requires a value");
        }
        index += inlineValue ? 1 : 2;
        break;
      case "--openclaw-path":
        openclawPath = inlineValue ?? args[index + 1];
        if (!openclawPath) {
          throw new Error("--openclaw-path requires a value");
        }
        index += inlineValue ? 1 : 2;
        break;
      default:
        throw new Error(`Unknown migrate flag: ${arg}`);
    }
  }

  if (mode === "openclaw" && !path) {
    throw new Error("`vx-mcp migrate openclaw` requires `--path <file>`.");
  }

  return {
    mode,
    dryRun,
    context,
    path,
    openclawPath,
  };
}

function collectSourceFiles(
  source: MigrationSource,
  input: ParsedMigrationInput,
  deps: MigrationDeps
): { files: string[]; reason?: string } {
  if (source === "codex") {
    const discovered = resolveCodexPaths(deps);
    if (discovered.mode === "missing") {
      return { files: [], reason: "no local Codex transcripts found" };
    }
    return { files: discovered.files };
  }

  if (source === "claude") {
    const discovered = resolveClaudePaths(deps);
    if (discovered.mode === "missing") {
      return { files: [], reason: "no local Claude transcripts found" };
    }
    return { files: discovered.files };
  }

  const openclawPath = input.mode === "openclaw" ? input.path : input.openclawPath;
  if (!openclawPath) {
    return {
      files: [],
      reason: "OpenClaw export path not provided; skipped",
    };
  }

  const resolvedPath = resolve(openclawPath);
  if (!deps.existsSync(resolvedPath)) {
    if (input.mode === "openclaw") {
      throw new Error(`OpenClaw export not found at ${resolvedPath}`);
    }
    return {
      files: [],
      reason: `OpenClaw export not found at ${resolvedPath}`,
    };
  }

  return { files: [resolvedPath] };
}

async function collectSourcePreviewData(
  source: MigrationSource,
  input: ParsedMigrationInput,
  deps: MigrationDeps
): Promise<{ turns: MigrationTurn[]; itemsSkipped: number; reason?: string }> {
  const sourceFiles = collectSourceFiles(source, input, deps);
  if (sourceFiles.reason) {
    return { turns: [], itemsSkipped: 0, reason: sourceFiles.reason };
  }

  if (source === "codex") {
    const discovered = resolveCodexPaths(deps);
    let turns: MigrationTurn[] = [];
    let itemsSkipped = 0;
    for (const filePath of sourceFiles.files) {
      const parsed =
        discovered.mode === "archive"
          ? await parseCodexArchiveFile(filePath, deps)
          : await parseCodexHistoryFile(filePath, deps);
      turns = turns.concat(parsed.turns);
      itemsSkipped += parsed.skipped;
    }

    return { turns, itemsSkipped };
  }

  if (source === "claude") {
    const discovered = resolveClaudePaths(deps);
    let turns: MigrationTurn[] = [];
    let itemsSkipped = 0;
    for (const filePath of sourceFiles.files) {
      const parsed =
        discovered.mode === "projects"
          ? await parseClaudeProjectFile(filePath, deps)
          : await parseClaudeHistoryFile(filePath, deps);
      turns = turns.concat(parsed.turns);
      itemsSkipped += parsed.skipped;
    }

    return { turns, itemsSkipped };
  }

  const parsed = await parseOpenClawFile(sourceFiles.files[0]!, deps);
  return { turns: parsed.turns, itemsSkipped: parsed.skipped };
}

export async function runMigration(
  input: ParsedMigrationInput,
  deps: Partial<MigrationDeps> = {}
): Promise<{ report: MigrationReport; output: string; memories: CreateMemoryInput[] }> {
  const resolvedDeps = resolveDeps(deps);
  const importedAt = resolvedDeps.now().toISOString();
  const migrationVersion = readCliVersion(resolvedDeps);
  const sources: MigrationSource[] =
    input.mode === "all" ? ["codex", "claude", "openclaw"] : [input.mode];

  const sourceReports: MigrationSourceReport[] = [];
  const memories: CreateMemoryInput[] = [];

  let result: CreateMemoriesBatchResponse | undefined;
  if (input.dryRun) {
    for (const source of sources) {
      const collected = await collectSourcePreviewData(source, input, resolvedDeps);
      const chunks = buildChunksForTurns(collected.turns, {
        context: input.context,
        importedAt,
        migrationVersion,
      });

      memories.push(...chunks.map((chunk) => chunk.memory));
      sourceReports.push(
        summarizeSource(
          source,
          collected.turns,
          chunks,
          collected.itemsSkipped,
          collected.reason
        )
      );
    }
  } else {
    const apiBaseUrl = normalizeApiBaseUrl(
      resolvedDeps.env.VX_API_BASE_URL ||
        resolvedDeps.env.VX_API_URL ||
        VX_DEFAULT_API_BASE_URL
    );
    const config = {
      apiBaseUrl,
      apiKey: resolvedDeps.env.VX_API_KEY,
      bearerToken: resolvedDeps.env.VX_BEARER_TOKEN,
      custodianId: resolvedDeps.env.VX_CUSTODIAN_ID,
      source: "mcp",
    };

    assertVxCredentials(config);
    const client = resolvedDeps.createClient(config);
    const createdMemories: NonNullable<CreateMemoriesBatchResponse["memories"]> = [];
    const aggregatedErrors: NonNullable<CreateMemoriesBatchResponse["errors"]> = [];
    let created = 0;

    for (const source of sources) {
      const sourceFiles = collectSourceFiles(source, input, resolvedDeps);
      if (sourceFiles.reason) {
        sourceReports.push({
          source,
          sessionsDetected: 0,
          turnsImported: 0,
          fragmentsCreated: 0,
          itemsSkipped: 0,
          status: "skipped",
          reason: sourceFiles.reason,
        });
        continue;
      }

      const aggregate: MigrationSourceReport = {
        source,
        sessionsDetected: 0,
        turnsImported: 0,
        fragmentsCreated: 0,
        itemsSkipped: 0,
        status: "ready",
      };

      for (const filePath of sourceFiles.files) {
        const importResult = await client.createImport({
          provider: source,
          file: resolvedDeps.readFileSync(filePath),
          filename: basename(filePath),
          baseContext: input.context,
          sourceLabel: basename(filePath),
          dryRun: false,
        });

        aggregate.sessionsDetected += importResult.summary.sessions;
        aggregate.turnsImported += importResult.summary.turns;
        aggregate.fragmentsCreated += importResult.summary.preparedMemories;
        aggregate.itemsSkipped += importResult.summary.skippedItems;
        created += importResult.imported;
        if (importResult.sample?.length) {
          createdMemories.push(...importResult.sample);
        }
        if (importResult.errors?.length) {
          aggregatedErrors.push(...importResult.errors);
        }
      }

      sourceReports.push(aggregate);
    }

    result = {
      created,
      memories: createdMemories,
      errors: aggregatedErrors.length > 0 ? aggregatedErrors : undefined,
    };
  }

  const report: MigrationReport = {
    dryRun: input.dryRun,
    context: input.context,
    importedAt,
    totalSourcesProcessed: sourceReports.length,
    totalSessionsDetected: sourceReports.reduce(
      (sum, source) => sum + source.sessionsDetected,
      0
    ),
    totalTurnsImported: sourceReports.reduce(
      (sum, source) => sum + source.turnsImported,
      0
    ),
    totalFragmentsCreated: sourceReports.reduce(
      (sum, source) => sum + source.fragmentsCreated,
      0
    ),
    totalItemsSkipped: sourceReports.reduce(
      (sum, source) => sum + source.itemsSkipped,
      0
    ),
    result,
    sources: sourceReports,
  };

  return {
    report,
    output: formatReport(report),
    memories,
  };
}

export async function handleMigrateCli(
  args: string[],
  deps: Partial<MigrationDeps> = {}
): Promise<boolean> {
  const parsed = parseMigrateCliArgs(args);
  const { output } = await runMigration(parsed, deps);
  console.log(output);
  return true;
}
