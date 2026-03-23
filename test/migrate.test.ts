import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  handleMigrateCli,
  parseMigrateCliArgs,
  runMigration,
  type MigrationDeps,
  type ParsedMigrationInput,
} from "../src/migrate.js";

const FIXED_NOW = new Date("2026-03-23T12:00:00.000Z");
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

function writeJsonl(path: string, records: unknown[]): void {
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function createFixtureHome(): {
  home: string;
  openclawJsonlPath: string;
} {
  const home = mkdtempSync(join(tmpdir(), "vx-mcp-migrate-"));

  const codexArchiveDir = join(home, ".codex", "archived_sessions");
  mkdirSync(codexArchiveDir, { recursive: true });
  const longCodexReply = `This is a very long Codex response.\n\n${"A".repeat(4200)}`;
  writeJsonl(join(codexArchiveDir, "session-1.jsonl"), [
    {
      timestamp: "2026-03-20T09:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "codex-session-1",
        cwd: "/workspace/codex-app",
      },
    },
    {
      timestamp: "2026-03-20T09:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<user_instructions>\nDo not import this." }],
      },
    },
    {
      timestamp: "2026-03-20T09:01:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Need a release checklist for the billing service." }],
      },
    },
    {
      timestamp: "2026-03-20T09:02:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: longCodexReply }],
      },
    },
    {
      timestamp: "2026-03-20T09:02:30.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
      },
    },
  ]);

  const claudeProjectsDir = join(home, ".claude", "projects", "billing");
  mkdirSync(claudeProjectsDir, { recursive: true });
  writeJsonl(join(claudeProjectsDir, "session-a.jsonl"), [
    {
      type: "progress",
      timestamp: "2026-03-21T10:00:00.000Z",
    },
    {
      type: "user",
      sessionId: "claude-session-a",
      cwd: "/workspace/claude-app",
      timestamp: "2026-03-21T10:01:00.000Z",
      message: {
        role: "user",
        content: "Can you review the onboarding flow copy?",
      },
    },
    {
      type: "assistant",
      sessionId: "claude-session-a",
      cwd: "/workspace/claude-app",
      timestamp: "2026-03-21T10:02:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal" },
          { type: "text", text: "Yes. The onboarding flow should reduce friction in the first step." },
        ],
      },
    },
    {
      type: "user",
      sessionId: "claude-session-a",
      cwd: "/workspace/claude-app",
      timestamp: "2026-03-21T10:03:00.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: [{ type: "tool_reference", tool_name: "Bash" }] }],
      },
    },
    {
      type: "assistant",
      sessionId: "claude-session-a",
      cwd: "/workspace/claude-app",
      timestamp: "2026-03-21T10:04:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash", input: { command: "pwd" } }],
      },
    },
  ]);

  const openclawJsonlPath = join(home, "openclaw-export.jsonl");
  writeJsonl(openclawJsonlPath, [
    {
      sessionId: "openclaw-session-1",
      role: "user",
      content: "Remember the deployment gate for QA signoff.",
      timestamp: "2026-03-22T08:00:00.000Z",
      cwd: "/workspace/openclaw-app",
    },
    {
      sessionId: "openclaw-session-1",
      role: "assistant",
      content: "Stored. QA signoff is required before deploy.",
      timestamp: "2026-03-22T08:01:00.000Z",
      project: "openclaw-demo",
    },
    {
      bad: "record",
    },
  ]);

  return { home, openclawJsonlPath };
}

function createMigrationDeps(
  home: string,
  overrides: Partial<MigrationDeps> = {}
): Partial<MigrationDeps> {
  return {
    env: {
      VX_API_BASE_URL: "https://api.vx.dev/v1",
      VX_API_KEY: "test-key",
      ...overrides.env,
    },
    homedir: () => home,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe("parseMigrateCliArgs", () => {
  it("defaults to migrate all", () => {
    expect(parseMigrateCliArgs([])).toEqual({
      mode: "all",
      dryRun: false,
      context: undefined,
      path: undefined,
      openclawPath: undefined,
    });
  });

  it("requires --path for explicit OpenClaw migration", () => {
    expect(() => parseMigrateCliArgs(["openclaw"])).toThrow(
      "`vx-mcp migrate openclaw` requires `--path <file>`."
    );
  });
});

describe("runMigration", () => {
  it("imports Codex turns as episodic memories and preserves chunk metadata", async () => {
    const { home } = createFixtureHome();
    const input: ParsedMigrationInput = {
      mode: "codex",
      dryRun: true,
      context: undefined,
    };

    const { report, memories } = await runMigration(
      input,
      createMigrationDeps(home)
    );

    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({
      source: "codex",
      sessionsDetected: 1,
      turnsImported: 2,
      status: "ready",
    });
    expect(report.sources[0]!.fragmentsCreated).toBeGreaterThan(report.sources[0]!.turnsImported);
    expect(memories.every((memory) => memory.memoryType === "EPISODIC")).toBe(true);
    expect(memories.some((memory) => memory.context !== undefined)).toBe(false);
    expect(memories[0]!.metadata).toMatchObject({
      importedFrom: "codex",
      importedAt: FIXED_NOW.toISOString(),
      originalSessionId: "codex-session-1",
      originalRole: "user",
      originalCwd: "/workspace/codex-app",
      migrationVersion: PACKAGE_VERSION.version,
    });
    expect(
      memories
        .filter((memory) => memory.metadata?.originalRole === "assistant")
        .map((memory) => memory.metadata?.chunkIndex)
    ).toEqual([1, 2, 3]);
  });

  it("imports Claude project transcripts and ignores non-text tool chatter", async () => {
    const { home } = createFixtureHome();

    const { report, memories } = await runMigration(
      {
        mode: "claude",
        dryRun: true,
        context: "shared/mentor",
      },
      createMigrationDeps(home)
    );

    expect(report.sources[0]).toMatchObject({
      source: "claude",
      sessionsDetected: 1,
      turnsImported: 2,
      fragmentsCreated: 2,
      itemsSkipped: 2,
    });
    expect(memories.map((memory) => memory.context)).toEqual([
      "shared/mentor",
      "shared/mentor",
    ]);
    expect(memories[1]!.content).toContain("reduce friction");
    expect(memories[1]!.metadata).toMatchObject({
      importedFrom: "claude",
      originalSessionId: "claude-session-a",
      originalCwd: "/workspace/claude-app",
      originalRole: "assistant",
    });
  });

  it("skips OpenClaw in migrate all when no export path is provided", async () => {
    const { home } = createFixtureHome();

    const { report } = await runMigration(
      {
        mode: "all",
        dryRun: true,
      },
      createMigrationDeps(home)
    );

    expect(report.sources).toHaveLength(3);
    expect(report.sources[2]).toMatchObject({
      source: "openclaw",
      status: "skipped",
      reason: "OpenClaw export path not provided; skipped",
    });
    expect(report.totalTurnsImported).toBe(4);
  });

  it("processes Codex, Claude, and OpenClaw together when a path is provided", async () => {
    const { home, openclawJsonlPath } = createFixtureHome();

    const { report } = await runMigration(
      {
        mode: "all",
        dryRun: true,
        openclawPath: openclawJsonlPath,
      },
      createMigrationDeps(home)
    );

    expect(report.sources.map((source) => source.status)).toEqual([
      "ready",
      "ready",
      "ready",
    ]);
    expect(report.totalSessionsDetected).toBe(3);
    expect(report.totalTurnsImported).toBe(6);
    expect(report.sources[2]).toMatchObject({
      source: "openclaw",
      turnsImported: 2,
      itemsSkipped: 1,
    });
  });

  it("uploads raw source files to the server import endpoint when dry-run is disabled", async () => {
    const { home, openclawJsonlPath } = createFixtureHome();
    const createImport = vi.fn(async (input: { provider: string }) => ({
      provider: input.provider,
      totalPrepared: 2,
      imported: 2,
      sample: [],
      summary: {
        provider: input.provider,
        sessions: 1,
        turns: 2,
        preparedMemories: 2,
        chunkedMemories: 0,
        skippedItems: 1,
      },
    }));
    const createClient = vi.fn(() => ({
      createImport,
    }) as unknown as ReturnType<MigrationDeps["createClient"]>);

    const { report, memories } = await runMigration(
      {
        mode: "all",
        dryRun: false,
        context: "shared/imports",
        openclawPath: openclawJsonlPath,
      },
      createMigrationDeps(home, {
        createClient,
        env: {
          VX_API_BASE_URL: "https://api.vx.dev/v1",
          VX_API_KEY: "test-key",
        },
      })
    );

    expect(createClient).toHaveBeenCalled();
    expect(createImport).toHaveBeenCalledTimes(3);
    expect(createImport.mock.calls.every((call) => call[0]?.baseContext === "shared/imports")).toBe(true);
    expect(report.result?.created).toBe(6);
    expect(report.totalSessionsDetected).toBe(3);
    expect(report.totalTurnsImported).toBe(6);
    expect(memories).toEqual([]);
  });
});

describe("handleMigrateCli", () => {
  it("prints a dry-run summary for Codex migration", async () => {
    const { home } = createFixtureHome();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const handled = await handleMigrateCli(
      ["codex", "--dry-run"],
      createMigrationDeps(home)
    );

    expect(handled).toBe(true);
    expect(logSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "VX migration dry run."
    );
  });

  it("fails clearly when an explicit OpenClaw path does not exist", async () => {
    const { home } = createFixtureHome();

    await expect(
      handleMigrateCli(
        ["openclaw", "--path", join(home, "missing.jsonl"), "--dry-run"],
        createMigrationDeps(home)
      )
    ).rejects.toThrow("OpenClaw export not found");
  });
});
