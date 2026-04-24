/**
 * Unit tests for the Phase 2 signal-first MCP tool handlers. Uses a mocked
 * VxClientLike so no real HTTP or live VX API is involved; verifies
 * handler → SDK method wiring and the human-readable output shape.
 *
 * Pattern mirrors the existing tests in `test/tools.test.ts` — each test
 * builds a small mock client (only the methods it needs) and asserts on
 * `expect(client.methodName).toHaveBeenCalledWith(...)`.
 */

import { describe, it, expect, vi } from "vitest";
import type { VxClientLike } from "../handlers.js";
import {
  handleVxImportChatGPT,
  handleVxImportAnthropic,
  handleVxCascadeQuery,
  handleVxEntityMerge,
  handleVxContextsEmergentList,
  handleVxContextsCreateFromDescription,
  handleVxContextsActivate,
  handleVxContextsDeactivate,
  handleVxSkillsFind,
  handleVxSkillsInvoke,
  handleVxHealthStatus,
} from "../handlers.js";

/**
 * Tiny helper — each test passes only the SDK methods it actually needs.
 * We cast through `unknown` because most properties on VxClientLike are
 * required; we're asserting handler wiring, not the full client surface.
 */
function mockClient(overrides: Partial<VxClientLike>): VxClientLike {
  return overrides as unknown as VxClientLike;
}

describe("Phase 2 MCP tool handlers", () => {
  it("vx_import_chatgpt calls importChatGPT and returns summary", async () => {
    const importChatGPT = vi.fn().mockResolvedValue({
      provider: "chatgpt",
      prepared: 12,
      imported: 12,
      dryRun: false,
      jobId: "job-123",
    });
    const client = mockClient({ importChatGPT });
    const out = await handleVxImportChatGPT(client, {
      path: "/tmp/conversations.json",
      dryRun: false,
      limit: 50,
    });
    expect(importChatGPT).toHaveBeenCalledWith({
      path: "/tmp/conversations.json",
      dryRun: false,
      limit: 50,
    });
    expect(out).toContain("ChatGPT ingest queued");
    expect(out).toContain("prepared: 12");
    expect(out).toContain("imported: 12");
    expect(out).toContain("jobId: job-123");
  });

  it("vx_import_chatgpt surfaces errors count", async () => {
    const importChatGPT = vi.fn().mockResolvedValue({
      provider: "chatgpt",
      prepared: 10,
      imported: 7,
      errors: [{ index: 3, error: "bad" }, { index: 8, error: "bad" }],
    });
    const client = mockClient({ importChatGPT });
    const out = await handleVxImportChatGPT(client, { path: "/tmp/c.json" });
    expect(out).toContain("errors: 2");
  });

  it("vx_import_chatgpt throws when client does not support it", async () => {
    const client = mockClient({});
    await expect(
      handleVxImportChatGPT(client, { path: "/tmp/c.json" })
    ).rejects.toThrow(/not supported/);
  });

  it("vx_import_anthropic calls importAnthropic and returns summary", async () => {
    const importAnthropic = vi.fn().mockResolvedValue({
      provider: "anthropic",
      prepared: 5,
      imported: 0,
      dryRun: true,
    });
    const client = mockClient({ importAnthropic });
    const out = await handleVxImportAnthropic(client, {
      path: "/tmp/export.json",
      dryRun: true,
    });
    expect(importAnthropic).toHaveBeenCalledWith({
      path: "/tmp/export.json",
      dryRun: true,
      limit: undefined,
    });
    expect(out).toContain("Anthropic ingest queued");
    expect(out).toContain("dryRun");
  });

  it("vx_cascade_query passes query/contexts/channels and formats meta", async () => {
    const cascadeQuery = vi.fn().mockResolvedValue({
      memories: [
        { id: "m1", content: "cascade hit one", context: "work", score: 0.91 },
        { id: "m2", content: "cascade hit two", context: "personal" },
      ],
      total: 2,
      meta: {
        queryId: "q-abc",
        channels: ["bm25", "ner-walk"],
      },
    });
    const client = mockClient({ cascadeQuery });
    const out = await handleVxCascadeQuery(client, {
      query: "deployment strategy",
      contexts: ["work/project-alpha"],
      channels: ["bm25", "ner-walk"],
      limit: 5,
      counterpartyId: "alice",
      counterpartyKind: "user",
    });
    expect(cascadeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "deployment strategy",
        contexts: ["work/project-alpha"],
        channels: ["bm25", "ner-walk"],
        limit: 5,
        counterparty: expect.objectContaining({
          id: "alice",
          kind: "user",
        }),
      })
    );
    expect(out).toContain("Found 2 memories via cascade");
    expect(out).toContain("channels: bm25, ner-walk");
    expect(out).toContain("queryId: q-abc");
    expect(out).toContain("cascade hit one");
    expect(out).toContain("score: 0.910");
  });

  it("vx_cascade_query reports empty result with queryId for explain", async () => {
    const cascadeQuery = vi.fn().mockResolvedValue({
      memories: [],
      total: 0,
      meta: { queryId: "q-empty" },
    });
    const client = mockClient({ cascadeQuery });
    const out = await handleVxCascadeQuery(client, { query: "nothing" });
    expect(out).toContain("No relevant memories found");
    expect(out).toContain("queryId: q-empty");
  });

  it("vx_entity_merge requires a non-empty aliases array", async () => {
    const mergeEntities = vi.fn();
    const client = mockClient({ mergeEntities });
    await expect(
      handleVxEntityMerge(client, {
        canonical: "Alice",
        aliases: [],
        confidence: 0.9,
        confirm: true,
      })
    ).rejects.toThrow(/aliases/);
    expect(mergeEntities).not.toHaveBeenCalled();
  });

  it("vx_entity_merge with confirm=true reports merged", async () => {
    const mergeEntities = vi.fn().mockResolvedValue({
      id: "ent-42",
      canonical: "Alice Smith",
      aliases: ["alice", "a. smith"],
      confidence: 0.92,
      merged: true,
    });
    const client = mockClient({ mergeEntities });
    const out = await handleVxEntityMerge(client, {
      canonical: "Alice Smith",
      aliases: ["alice", "a. smith"],
      confidence: 0.92,
      confirm: true,
    });
    expect(mergeEntities).toHaveBeenCalledWith({
      canonical: "Alice Smith",
      aliases: ["alice", "a. smith"],
      confidence: 0.92,
      confirm: true,
    });
    expect(out).toContain("Entity merged");
    expect(out).toContain("canonical=Alice Smith");
    expect(out).toContain("aliases=2");
    expect(out).toContain("id: ent-42");
  });

  it("vx_entity_merge with confirm=false reports preview", async () => {
    const mergeEntities = vi.fn().mockResolvedValue({
      canonical: "Alice Smith",
      aliases: ["alice"],
      confidence: 0.7,
      merged: false,
      pending: true,
    });
    const client = mockClient({ mergeEntities });
    const out = await handleVxEntityMerge(client, {
      canonical: "Alice Smith",
      aliases: ["alice"],
      confidence: 0.7,
      confirm: false,
    });
    expect(out).toContain("previewed");
  });

  it("vx_contexts_emergent_list formats list with size/confidence", async () => {
    const listEmergentContexts = vi.fn().mockResolvedValue({
      contexts: [
        {
          name: "emergent/cluster-a",
          description: "Cluster around deployment",
          size: 42,
          confidence: 0.88,
          active: false,
        },
        {
          name: "emergent/cluster-b",
          description: "Cluster around support",
          size: 19,
          confidence: 0.71,
          active: true,
        },
      ],
      total: 2,
    });
    const client = mockClient({ listEmergentContexts });
    const out = await handleVxContextsEmergentList(client, { minSize: 10, limit: 20 });
    expect(listEmergentContexts).toHaveBeenCalledWith({ minSize: 10, limit: 20 });
    expect(out).toContain("Showing 2 of 2 emergent contexts");
    expect(out).toContain("emergent/cluster-a");
    expect(out).toContain("size: 42");
    expect(out).toContain("confidence: 0.880");
    expect(out).toContain("active: true");
  });

  it("vx_contexts_emergent_list reports empty", async () => {
    const client = mockClient({
      listEmergentContexts: vi.fn().mockResolvedValue({ contexts: [], total: 0 }),
    });
    const out = await handleVxContextsEmergentList(client, {});
    expect(out).toBe("No emergent contexts found.");
  });

  it("vx_contexts_create_from_description calls SDK and reports name", async () => {
    const createContextFromDescription = vi.fn().mockResolvedValue({
      name: "work/project-gamma",
      description: "Inferred project context",
      memory_count: 0,
    });
    const client = mockClient({ createContextFromDescription });
    const out = await handleVxContextsCreateFromDescription(client, {
      name: "work/project-gamma",
      description: "All memories about project gamma",
    });
    expect(createContextFromDescription).toHaveBeenCalledWith({
      name: "work/project-gamma",
      description: "All memories about project gamma",
    });
    expect(out).toContain("Knowledge context created from description");
    expect(out).toContain("work/project-gamma");
  });

  it("vx_contexts_activate reports active=true", async () => {
    const activateContext = vi.fn().mockResolvedValue({
      name: "work/project-alpha",
      active: true,
    });
    const client = mockClient({ activateContext });
    const out = await handleVxContextsActivate(client, { name: "work/project-alpha" });
    expect(activateContext).toHaveBeenCalledWith("work/project-alpha");
    expect(out).toContain("work/project-alpha");
    expect(out).toContain("active");
  });

  it("vx_contexts_deactivate reports inactive", async () => {
    const deactivateContext = vi.fn().mockResolvedValue({
      name: "work/project-alpha",
      active: false,
    });
    const client = mockClient({ deactivateContext });
    const out = await handleVxContextsDeactivate(client, { name: "work/project-alpha" });
    expect(deactivateContext).toHaveBeenCalledWith("work/project-alpha");
    expect(out).toContain("inactive");
  });

  it("vx_skills_find returns formatted list with score and trigger", async () => {
    const findSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: "deploy-to-staging",
          description: "Deploy a service to staging",
          trigger: "deploy to staging",
          score: 0.81,
        },
        {
          name: "run-e2e",
          description: "Run E2E tests",
          score: 0.63,
        },
      ],
      total: 2,
    });
    const client = mockClient({ findSkills });
    const out = await handleVxSkillsFind(client, {
      triggerQuery: "how do I deploy",
      limit: 5,
    });
    expect(findSkills).toHaveBeenCalledWith({
      triggerQuery: "how do I deploy",
      limit: 5,
    });
    expect(out).toContain('Found 2 skill(s) matching "how do I deploy"');
    expect(out).toContain("deploy-to-staging");
    expect(out).toContain("trigger: deploy to staging");
    expect(out).toContain("score: 0.810");
  });

  it("vx_skills_find returns empty message", async () => {
    const client = mockClient({
      findSkills: vi.fn().mockResolvedValue({ skills: [], total: 0 }),
    });
    const out = await handleVxSkillsFind(client, { triggerQuery: "nothing" });
    expect(out).toBe("No matching skills found.");
  });

  it("vx_skills_invoke forwards execute=true and reports executed", async () => {
    const invokeSkill = vi.fn().mockResolvedValue({
      name: "deploy-to-staging",
      invoked: true,
      executed: true,
      steps: [{ step: 1 }, { step: 2 }, { step: 3 }],
      memoryId: "mem-skill-1",
    });
    const client = mockClient({ invokeSkill });
    const out = await handleVxSkillsInvoke(client, {
      name: "deploy-to-staging",
      execute: true,
    });
    expect(invokeSkill).toHaveBeenCalledWith({
      name: "deploy-to-staging",
      execute: true,
    });
    expect(out).toContain("Skill deploy-to-staging executed");
    expect(out).toContain("steps: 3");
    expect(out).toContain("memoryId: mem-skill-1");
  });

  it("vx_skills_invoke defaults to preview (execute=false)", async () => {
    const invokeSkill = vi.fn().mockResolvedValue({
      name: "deploy-to-staging",
      invoked: true,
      executed: false,
    });
    const client = mockClient({ invokeSkill });
    const out = await handleVxSkillsInvoke(client, { name: "deploy-to-staging" });
    expect(invokeSkill).toHaveBeenCalledWith({
      name: "deploy-to-staging",
      execute: false,
    });
    expect(out).toContain("previewed");
  });

  it("vx_health_status formats components", async () => {
    const healthDetailed = vi.fn().mockResolvedValue({
      status: "ok",
      version: "2.1.0",
      uptime: 12345,
      components: {
        db: { status: "ok" },
        redis: { status: "ok" },
        worker: { status: "degraded", message: "queue backlog" },
      },
    });
    const client = mockClient({ healthDetailed });
    const out = await handleVxHealthStatus(client, {});
    expect(healthDetailed).toHaveBeenCalledTimes(1);
    expect(out).toContain("VX status: ok");
    expect(out).toContain("version: 2.1.0");
    expect(out).toContain("uptime: 12345s");
    expect(out).toContain("- db: ok");
    expect(out).toContain("- redis: ok");
    expect(out).toContain("- worker: degraded — queue backlog");
  });

  it("vx_health_status handles minimal response", async () => {
    const healthDetailed = vi.fn().mockResolvedValue({ status: "ok" });
    const client = mockClient({ healthDetailed });
    const out = await handleVxHealthStatus(client, {});
    expect(out).toBe("VX status: ok");
  });

  it("every new handler throws a clear error when SDK method is missing", async () => {
    const empty = mockClient({});
    await expect(handleVxImportChatGPT(empty, { path: "x" })).rejects.toThrow(
      /vx_import_chatgpt is not supported/
    );
    await expect(handleVxImportAnthropic(empty, { path: "x" })).rejects.toThrow(
      /vx_import_anthropic is not supported/
    );
    await expect(handleVxCascadeQuery(empty, { query: "x" })).rejects.toThrow(
      /vx_cascade_query is not supported/
    );
    await expect(
      handleVxEntityMerge(empty, {
        canonical: "a",
        aliases: ["b"],
        confidence: 1,
        confirm: true,
      })
    ).rejects.toThrow(/vx_entity_merge is not supported/);
    await expect(handleVxContextsEmergentList(empty, {})).rejects.toThrow(
      /vx_contexts_emergent_list is not supported/
    );
    await expect(
      handleVxContextsCreateFromDescription(empty, { name: "a", description: "b" })
    ).rejects.toThrow(/vx_contexts_create_from_description is not supported/);
    await expect(handleVxContextsActivate(empty, { name: "a" })).rejects.toThrow(
      /vx_contexts_activate is not supported/
    );
    await expect(handleVxContextsDeactivate(empty, { name: "a" })).rejects.toThrow(
      /vx_contexts_deactivate is not supported/
    );
    await expect(handleVxSkillsFind(empty, { triggerQuery: "x" })).rejects.toThrow(
      /vx_skills_find is not supported/
    );
    await expect(handleVxSkillsInvoke(empty, { name: "x" })).rejects.toThrow(
      /vx_skills_invoke is not supported/
    );
    await expect(handleVxHealthStatus(empty)).rejects.toThrow(
      /vx_health_status is not supported/
    );
  });
});
