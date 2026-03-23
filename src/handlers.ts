/**
 * MCP tool handlers. Accept a VxClientLike so tests can inject a mock.
 */

import {
  importFromText,
  importMemories,
  type CreateMemoryInput,
  type CreateContextInput,
  type CounterpartyIdentity,
  type QueryMemoriesInput,
  type HybridQueryInput,
  type QueryResponse,
  type VxKnowledgeContext,
} from "@vx/sdk";
import { VX_MCP_SERVER_VERSION } from "./constants.js";

export type VxMemoryType =
  | "SEMANTIC"
  | "EPISODIC"
  | "EMOTIONAL"
  | "PROCEDURAL"
  | "CONTEXTUAL";

/** Minimal client interface used by handlers (real SDK client implements this). */
export type VxClientLike = {
  createMemory(input: CreateMemoryInput): Promise<{ id: string; content: string; context?: string; memoryType?: string }>;
  createMemoriesBatch?(memories: CreateMemoryInput[]): Promise<{ created: number; memories: unknown[]; errors?: Array<{ index: number; error: string }> }>;
  createContext?(input: CreateContextInput): Promise<VxKnowledgeContext>;
  getContext?(name: string): Promise<VxKnowledgeContext>;
  listContexts?(params?: { prefix?: string; includeStats?: boolean; limit?: number; offset?: number }): Promise<{ contexts: VxKnowledgeContext[]; total: number; limit: number; offset: number }>;
  queryMemories(input: QueryMemoriesInput): Promise<QueryResponse>;
  listMemories?(params?: { limit?: number; offset?: number; context?: string; memoryType?: string }): Promise<{ memories: { id: string; content: string; context?: string }[]; total: number; hasMore: boolean }>;
  queryHybrid(input: HybridQueryInput): Promise<QueryResponse | { data: QueryResponse }>;
  buildContextPacket(input: { query: string; contexts?: string[]; maxTokens?: number }): Promise<{ formatted: string; memoriesUsed: number }>;
  deleteMemory(id: string): Promise<void>;
};

function getCounterparty(args: {
  counterpartyId?: string;
  counterpartyKind?: string;
  counterpartyClient?: string;
  counterpartySession?: string;
}): CounterpartyIdentity | undefined {
  if (!args.counterpartyId) return undefined;
  return {
    id: args.counterpartyId,
    kind: args.counterpartyKind,
    client: args.counterpartyClient,
    session: args.counterpartySession,
  };
}

function formatContextCount(context: VxKnowledgeContext): string | null {
  const count = context.memory_count ?? context.memoryCount;
  return typeof count === "number" ? `memories: ${count}` : null;
}

function formatContextTimestamp(context: VxKnowledgeContext): string | null {
  const timestamp =
    context.last_updated ??
    context.lastUpdated ??
    context.updated_at ??
    context.updatedAt ??
    context.created_at ??
    context.createdAt;
  return timestamp ? `updated: ${timestamp}` : null;
}

export async function handleVxStore(
  client: VxClientLike,
  args: {
    content: string;
    context?: string;
    memoryType?: string;
    importance?: number;
    counterpartyId?: string;
    counterpartyKind?: string;
    counterpartyClient?: string;
    counterpartySession?: string;
  },
  meta: { source: string; name: string; client?: string }
): Promise<string> {
  const counterparty = getCounterparty(args);
  const input: CreateMemoryInput = {
    content: args.content,
    context: args.context,
    memoryType: (args.memoryType as CreateMemoryInput["memoryType"]) || "SEMANTIC",
    source: meta.source,
    counterparty,
    metadata: {
      source: meta.source,
      vxName: meta.name,
      client: meta.client ?? "mcp-server",
      version: VX_MCP_SERVER_VERSION,
    },
  };
  if (typeof args.importance === "number") {
    input.metadata = { ...(input.metadata || {}), importance: args.importance };
  }
  const memory = await client.createMemory(input);
  return `✓ Memory stored by ${meta.name} (source: ${meta.source}, ID: ${memory.id})`;
}

export async function handleVxQuery(
  client: VxClientLike,
  args: {
    query: string;
    limit?: number;
    context?: string;
    contexts?: string[];
    memoryType?: string;
    counterpartyId?: string;
    counterpartyKind?: string;
    counterpartyClient?: string;
    counterpartySession?: string;
  },
  meta?: { source: string }
): Promise<string> {
  const memoryTypes = args.memoryType ? [args.memoryType as VxMemoryType] : undefined;
  const counterparty = getCounterparty(args);
  const result = await client.queryMemories({
    query: args.query,
    limit: args.limit ?? 10,
    contexts: args.contexts?.length ? args.contexts : args.context ? [args.context] : undefined,
    memoryTypes,
    ...(counterparty ? { counterparty, source: meta?.source } : {}),
  });
  if (result.memories.length === 0) return "No relevant memories found.";
  const formatted = result.memories
    .map((m, i) => `[${i + 1}] ${m.content}${m.context ? ` (context: ${m.context})` : ""}`)
    .join("\n\n");
  return `Found ${result.memories.length} relevant memories:\n\n${formatted}`;
}

export async function handleVxRecall(
  client: VxClientLike,
  args: {
    query: string;
    contexts?: string[];
    memoryTypes?: string[];
    limit?: number;
    minScore?: number;
    counterpartyId?: string;
    counterpartyKind?: string;
    counterpartyClient?: string;
    counterpartySession?: string;
  },
  meta?: { source: string }
): Promise<string> {
  const counterparty = getCounterparty(args);
  let normalizedRecall: QueryResponse;
  if (counterparty) {
    normalizedRecall = await client.queryMemories({
      query: args.query,
      limit: args.limit ?? 10,
      contexts: args.contexts,
      memoryTypes: args.memoryTypes as VxMemoryType[] | undefined,
      minScore: args.minScore ?? 0,
      counterparty,
      source: meta?.source,
    });
  } else {
    const hybridResult = await client.queryHybrid({
      query: args.query,
      limit: args.limit ?? 10,
      contexts: args.contexts,
      memoryTypes: args.memoryTypes,
      minScore: args.minScore ?? 0,
    });
    normalizedRecall =
      hybridResult && typeof hybridResult === "object" && "data" in hybridResult
        ? hybridResult.data
        : hybridResult as QueryResponse;
  }
  if (!normalizedRecall.memories?.length) return "No relevant memories found.";
  const formatted = normalizedRecall.memories
    .map((m, i) => `[${i + 1}] ${m.content}${m.context ? ` (context: ${m.context})` : ""}`)
    .join("\n\n");
  return `Found ${normalizedRecall.memories.length} relevant memories (${counterparty ? "counterparty recall" : "hybrid recall"}):\n\n${formatted}`;
}

export async function handleVxList(
  client: VxClientLike,
  args: { limit?: number; offset?: number; context?: string; memoryType?: string }
): Promise<string> {
  const pageSize = args.limit ?? 20;
  if (client.listMemories) {
    const result = await client.listMemories({
      limit: pageSize,
      offset: args.offset ?? 0,
      context: args.context,
      memoryType: args.memoryType,
    });
    if (result.memories.length === 0) return "No memories found.";
    const formatted = result.memories
      .map((m, i) => `[${i + 1}] (${m.id}) ${(m.content ?? "").substring(0, 100)}${(m.content?.length ?? 0) > 100 ? "..." : ""}`)
      .join("\n");
    return `Showing ${result.memories.length} of ${result.total} memories:\n\n${formatted}`;
  }
  const memoryTypes = args.memoryType ? [args.memoryType as VxMemoryType] : undefined;
  const result = await client.queryMemories({
    query: "*",
    limit: pageSize,
    contexts: args.context ? [args.context] : undefined,
    memoryTypes,
    minScore: 0,
  });
  if (result.memories.length === 0) return "No memories found.";
  const formatted = result.memories
    .map((m, i) => `[${i + 1}] (${m.id}) ${m.content.substring(0, 100)}${m.content.length > 100 ? "..." : ""}`)
    .join("\n");
  return `Showing ${result.memories.length} of ${result.total} memories:\n\n${formatted}`;
}

export async function handleVxDelete(client: VxClientLike, args: { id: string }): Promise<string> {
  await client.deleteMemory(args.id);
  return `✓ Memory deleted successfully (ID: ${args.id})`;
}

export async function handleVxContext(
  client: VxClientLike,
  args: { topic: string; contexts?: string[]; maxTokens?: number }
): Promise<string> {
  const packet = await client.buildContextPacket({
    query: args.topic,
    contexts: args.contexts,
    maxTokens: args.maxTokens ?? 4000,
  });
  if (!packet.formatted || packet.memoriesUsed === 0) return "No relevant context found for this topic.";
  return `Context from ${packet.memoriesUsed} memories:\n\n${packet.formatted}`;
}

export async function handleVxContextsList(
  client: VxClientLike,
  args: { prefix?: string; includeStats?: boolean; limit?: number; offset?: number }
): Promise<string> {
  if (!client.listContexts) {
    throw new Error("VX knowledge contexts are not supported by this client.");
  }

  const result = await client.listContexts({
    prefix: args.prefix,
    includeStats: args.includeStats ?? true,
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  });

  if (result.contexts.length === 0) {
    return "No knowledge contexts found.";
  }

  const formatted = result.contexts
    .map((context, index) => {
      const detailParts = [
        context.description,
        formatContextCount(context),
        formatContextTimestamp(context),
      ].filter(Boolean);
      return `[${index + 1}] ${context.name}${detailParts.length ? ` — ${detailParts.join(" · ")}` : ""}`;
    })
    .join("\n");

  return `Showing ${result.contexts.length} of ${result.total} knowledge contexts:\n\n${formatted}`;
}

export async function handleVxContextsCreate(
  client: VxClientLike,
  args: { name: string; description?: string; settings?: Record<string, unknown>; scope?: string }
): Promise<string> {
  if (!client.createContext) {
    throw new Error("VX knowledge contexts are not supported by this client.");
  }

  const created = await client.createContext({
    name: args.name,
    description: args.description,
    settings: args.settings,
    scope: args.scope,
  });

  const detailParts = [created.description, formatContextCount(created)].filter(Boolean);
  return `✓ Knowledge context created: ${created.name}${detailParts.length ? ` (${detailParts.join(" · ")})` : ""}`;
}

export async function handleVxImportText(
  client: VxClientLike,
  args: { text: string; context?: string; memoryType?: string; maxChunkChars?: number },
  _meta: { source: string; name: string; client?: string }
): Promise<string> {
  const result = await importFromText(client as Parameters<typeof importFromText>[0], args.text, {
    defaultContext: args.context ?? "import",
    memoryType: (args.memoryType as CreateMemoryInput["memoryType"]) ?? "SEMANTIC",
    maxChunkChars: args.maxChunkChars,
  });
  const errMsg = result.errors?.length ? ` (${result.errors.length} chunk(s) failed)` : "";
  return `✓ Imported ${result.created} memory chunk(s) into VX${errMsg}.`;
}

export async function handleVxImportBatch(
  client: VxClientLike,
  args: {
    memories: Array<{ content: string; context?: string; memoryType?: string; importance?: number }>;
  },
  meta: { source: string; name: string; client?: string }
): Promise<string> {
  const inputs: CreateMemoryInput[] = (args.memories ?? []).map((m) => ({
    content: m.content,
    context: m.context,
    memoryType: (m.memoryType as CreateMemoryInput["memoryType"]) ?? "SEMANTIC",
    source: meta.source,
    metadata: {
      source: meta.source,
      vxName: meta.name,
      client: meta.client ?? "mcp-server",
      version: VX_MCP_SERVER_VERSION,
      ...(typeof m.importance === "number" ? { importance: m.importance } : {}),
    },
  }));
  const result = await importMemories(client as Parameters<typeof importMemories>[0], inputs);
  const errMsg = result.errors?.length ? ` (${result.errors.length} failed)` : "";
  return `✓ Imported ${result.created} of ${inputs.length} memories into VX${errMsg}.`;
}
