import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { resolveVxConfig } from "../src/runtime.js";
import type { VxClientLike } from "../src/handlers.js";

function createMockClient(): VxClientLike {
  return {
    createMemory: vi.fn().mockResolvedValue({
      id: "mem-1",
      content: "stored",
      context: "ctx",
      memoryType: "SEMANTIC",
    }),
    queryMemories: vi.fn().mockResolvedValue({ memories: [], total: 0 }),
    queryHybrid: vi.fn().mockResolvedValue({ data: { memories: [], total: 0 } }),
    buildContextPacket: vi.fn().mockResolvedValue({ formatted: "", memoriesUsed: 0 }),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MCP prompt support", () => {
  it("registers VX prompts and returns source-specific prompt text", async () => {
    const config = resolveVxConfig({
      apiBaseUrl: "https://api.vx.dev/v1",
      apiKey: "test-api-key",
      source: "codex",
      name: "VX",
      client: "mcp-server",
      maxTokens: 2222,
    });
    const server = createMcpServer({
      config,
      client: createMockClient(),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "vx-mcp-tests", version: "0.5.6" },
      { capabilities: { prompts: {} } }
    );

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const list = await client.listPrompts();
    const names = list.prompts.map((prompt) => prompt.name);
    expect(names).toEqual(
      expect.arrayContaining(["vx_memory_workflow", "vx_memory_import"])
    );

    const workflowPrompt = await client.getPrompt({
      name: "vx_memory_workflow",
      arguments: { topic: "release workflow" },
    });
    const text = workflowPrompt.messages[0]?.content.type === "text"
      ? workflowPrompt.messages[0].content.text
      : "";

    expect(text).toContain("Use VX as the durable memory layer in Codex.");
    expect(text).toContain("release workflow");
    expect(text).toContain("vx_context");
    expect(text).toContain("vx_contexts_create");
    expect(text).toContain("2222 tokens");
  });
});
