/**
 * Unit tests for MCP tool handlers using a mocked VX client.
 * No real HTTP or mock server; verifies handler → SDK call wiring and response shape.
 */

import { describe, it, expect, vi } from "vitest";
import type { VxClientLike } from "../src/handlers.js";
import {
  handleVxContextsCreate,
  handleVxContextsList,
  handleVxStore,
  handleVxQuery,
  handleVxRecall,
  handleVxList,
  handleVxDelete,
  handleVxContext,
  handleVxImportText,
  handleVxImportBatch,
} from "../src/handlers.js";

const meta = { source: "test", name: "TestVX" };

function createMockClient(overrides: Partial<VxClientLike> = {}): VxClientLike {
  return {
    createMemory: vi.fn().mockResolvedValue({ id: "mem-1", content: "x", context: "ctx", memoryType: "SEMANTIC" }),
    createContext: vi.fn().mockResolvedValue({
      name: "work/project-alpha",
      description: "Project Alpha",
      memory_count: 0,
    }),
    listContexts: vi.fn().mockResolvedValue({
      contexts: [
        {
          name: "work/project-alpha",
          description: "Project Alpha",
          memory_count: 2,
          last_updated: "2026-03-20T00:00:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    }),
    queryMemories: vi.fn().mockResolvedValue({
      memories: [{ id: "mem-1", content: "hello world", context: "e2e", memoryType: "semantic", score: 0.9 }],
      total: 1,
    }),
    queryHybrid: vi.fn().mockResolvedValue({
      data: {
        memories: [{ id: "mem-1", content: "hybrid result", context: "e2e", memoryType: "semantic", score: 0.85 }],
        total: 1,
      },
    }),
    buildContextPacket: vi.fn().mockResolvedValue({
      formatted: "Context line 1\nContext line 2",
      memoriesUsed: 2,
    }),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("MCP tool handlers", () => {
  it("vx_store calls createMemory with content/context/memoryType and returns ID", async () => {
    const client = createMockClient();
    const out = await handleVxStore(
      client,
      { content: "my memory", context: "work", memoryType: "SEMANTIC" },
      meta
    );
    expect(client.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "my memory",
        context: "work",
        memoryType: "SEMANTIC",
        source: "test",
        metadata: expect.objectContaining({ vxName: "TestVX", client: "mcp-server" }),
      })
    );
    expect(out).toContain("✓ Memory stored");
    expect(out).toContain("ID: mem-1");
  });

  it("vx_query calls queryMemories and returns formatted list", async () => {
    const client = createMockClient();
    const out = await handleVxQuery(client, {
      query: "hello",
      limit: 5,
      contexts: ["work/project-alpha", "work/project-beta"],
    });
    expect(client.queryMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "hello",
        limit: 5,
        contexts: ["work/project-alpha", "work/project-beta"],
      })
    );
    expect(out).toContain("Found 1 relevant memories");
    expect(out).toContain("hello world");
  });

  it("vx_query returns message when no memories", async () => {
    const client = createMockClient({
      queryMemories: vi.fn().mockResolvedValue({ memories: [], total: 0 }),
    });
    const out = await handleVxQuery(client, { query: "nonexistent" });
    expect(out).toBe("No relevant memories found.");
  });

  it("vx_store forwards counterparty identity through createMemory", async () => {
    const client = createMockClient();
    await handleVxStore(
      client,
      {
        content: "Discussed deployment strategy",
        counterpartyId: "orbit",
        counterpartyKind: "agent",
        counterpartyClient: "vx-client",
      },
      meta
    );
    expect(client.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        counterparty: {
          id: "orbit",
          kind: "agent",
          client: "vx-client",
        },
      })
    );
  });

  it("vx_query forwards counterparty identity through queryMemories", async () => {
    const client = createMockClient();
    await handleVxQuery(
      client,
      {
        query: "deployment strategy",
        counterpartyId: "orbit",
        counterpartyKind: "agent",
      },
      { source: "codex" }
    );
    expect(client.queryMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "deployment strategy",
        source: "codex",
        counterparty: {
          id: "orbit",
          kind: "agent",
          client: undefined,
          session: undefined,
        },
      })
    );
  });

  it("vx_recall calls queryHybrid and returns formatted list", async () => {
    const client = createMockClient();
    const out = await handleVxRecall(client, { query: "recall me", limit: 10 });
    expect(client.queryHybrid).toHaveBeenCalledWith(
      expect.objectContaining({ query: "recall me", limit: 10 })
    );
    expect(out).toContain("relevant memories (hybrid recall)");
    expect(out).toContain("hybrid result");
  });

  it("vx_recall switches to queryMemories when counterparty identity is provided", async () => {
    const client = createMockClient();
    const out = await handleVxRecall(
      client,
      {
        query: "what were we doing",
        counterpartyId: "atlas",
        counterpartyKind: "subagent",
        limit: 5,
      },
      { source: "codex" }
    );
    expect(client.queryMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "what were we doing",
        limit: 5,
        source: "codex",
        counterparty: {
          id: "atlas",
          kind: "subagent",
          client: undefined,
          session: undefined,
        },
      })
    );
    expect(client.queryHybrid).not.toHaveBeenCalled();
    expect(out).toContain("counterparty recall");
  });

  it("vx_list calls queryMemories with query * and returns list", async () => {
    const client = createMockClient();
    const out = await handleVxList(client, { limit: 20, context: "e2e" });
    expect(client.queryMemories).toHaveBeenCalledWith(
      expect.objectContaining({ query: "*", limit: 20, contexts: ["e2e"], minScore: 0 })
    );
    expect(out).toContain("Showing 1 of 1 memories");
    expect(out).toContain("mem-1");
  });

  it("vx_delete calls deleteMemory and returns success", async () => {
    const client = createMockClient();
    const out = await handleVxDelete(client, { id: "mem-123" });
    expect(client.deleteMemory).toHaveBeenCalledWith("mem-123");
    expect(out).toContain("✓ Memory deleted successfully");
    expect(out).toContain("mem-123");
  });

  it("vx_context calls buildContextPacket and returns formatted context", async () => {
    const client = createMockClient();
    const out = await handleVxContext(client, {
      topic: "testing",
      contexts: ["work/project-alpha"],
      maxTokens: 4000,
    });
    expect(client.buildContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "testing",
        contexts: ["work/project-alpha"],
        maxTokens: 4000,
      })
    );
    expect(out).toContain("Context from 2 memories");
    expect(out).toContain("Context line 1");
  });

  it("vx_context returns message when no context", async () => {
    const client = createMockClient({
      buildContextPacket: vi.fn().mockResolvedValue({ formatted: "", memoriesUsed: 0 }),
    });
    const out = await handleVxContext(client, { topic: "empty" });
    expect(out).toBe("No relevant context found for this topic.");
  });

  it("vx_import_text calls importFromText and returns import count", async () => {
    const client = createMockClient();
    (client as any).createMemory = vi.fn().mockResolvedValue({ id: "c1", content: "chunk", context: "import", memoryType: "SEMANTIC" });
    const out = await handleVxImportText(
      client,
      { text: "First paragraph.\n\nSecond paragraph.", context: "e2e" },
      meta
    );
    expect(out).toMatch(/✓ Imported \d+ memory chunk\(s\) into VX/);
  });

  it("vx_import_batch calls importMemories and returns count", async () => {
    const client = createMockClient();
    (client as any).createMemoriesBatch = vi.fn().mockResolvedValue({
      created: 2,
      memories: [{ id: "a" }, { id: "b" }],
    });
    const out = await handleVxImportBatch(
      client,
      {
        memories: [
          { content: "A", context: "batch" },
          { content: "B", context: "batch" },
        ],
      },
      meta
    );
    expect(out).toContain("Imported 2 of 2 memories into VX");
  });

  it("vx_contexts_list returns formatted knowledge contexts", async () => {
    const client = createMockClient();
    const out = await handleVxContextsList(client, {
      prefix: "work/",
      includeStats: true,
    });

    expect(client.listContexts).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "work/", includeStats: true })
    );
    expect(out).toContain("knowledge contexts");
    expect(out).toContain("work/project-alpha");
    expect(out).toContain("Project Alpha");
  });

  it("vx_contexts_create creates a knowledge context", async () => {
    const client = createMockClient();
    const out = await handleVxContextsCreate(client, {
      name: "work/project-alpha",
      description: "Project Alpha",
    });

    expect(client.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "work/project-alpha",
        description: "Project Alpha",
      })
    );
    expect(out).toContain("Knowledge context created");
    expect(out).toContain("work/project-alpha");
  });
});
