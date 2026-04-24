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
  type VxMemory,
  type ImportChatGPTInput,
  type ImportAnthropicInput,
  type ImportIngestResponse,
  type CascadeQueryInput,
  type CascadeQueryResponse,
  type EntityMergeInput,
  type EntityMergeResponse,
  type EmergentContextListInput,
  type EmergentContextListResponse,
  type CreateContextFromDescriptionInput,
  type ActivateContextResponse,
  type SkillsFindInput,
  type SkillsFindResponse,
  type SkillInvokeInput,
  type SkillInvokeResponse,
  type HealthDetailedResponse,
} from "./sdk/index.js";
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
  getMemoryById?(id: string): Promise<VxMemory>;
  // Phase 2 signal-first (optional so older SDK builds keep working).
  importChatGPT?(input: ImportChatGPTInput): Promise<ImportIngestResponse>;
  importAnthropic?(input: ImportAnthropicInput): Promise<ImportIngestResponse>;
  cascadeQuery?(input: CascadeQueryInput): Promise<CascadeQueryResponse>;
  mergeEntities?(input: EntityMergeInput): Promise<EntityMergeResponse>;
  listEmergentContexts?(params?: EmergentContextListInput): Promise<EmergentContextListResponse>;
  createContextFromDescription?(input: CreateContextFromDescriptionInput): Promise<VxKnowledgeContext>;
  activateContext?(name: string): Promise<ActivateContextResponse>;
  deactivateContext?(name: string): Promise<ActivateContextResponse>;
  findSkills?(input: SkillsFindInput): Promise<SkillsFindResponse>;
  invokeSkill?(input: SkillInvokeInput): Promise<SkillInvokeResponse>;
  healthDetailed?(): Promise<HealthDetailedResponse>;
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
    metadata?: Record<string, unknown>;
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
      ...(args.metadata || {}),
    },
  };
  if (typeof args.importance === "number") {
    input.metadata = { ...(input.metadata || {}), importance: args.importance };
  }
  const memory = await client.createMemory(input);
  return `✓ Memory stored by ${meta.name} (source: ${meta.source}, ID: ${memory.id})`;
}

export async function handleVxGet(
  client: VxClientLike,
  args: { id: string }
): Promise<string> {
  if (!client.getMemoryById) {
    throw new Error("vx_get is not supported by this client.");
  }
  const memory = await client.getMemoryById(args.id);
  const metaKeys = memory.metadata ? Object.keys(memory.metadata) : [];
  const metaLine = metaKeys.length ? `\nMetadata keys: ${metaKeys.join(", ")}` : "";
  const contextLine = memory.context ? `\nContext: ${memory.context}` : "";
  const typeLine = memory.memoryType ? `\nType: ${memory.memoryType}` : "";
  const content = memory.content ?? "(no content)";
  return `Memory ${memory.id}${contextLine}${typeLine}${metaLine}\n\n${content}`;
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

// =============================================================================
// Phase 2 signal-first handlers. Each wraps the matching SDK method and
// returns a short human-friendly string summary — the same contract as the
// existing handlers in this file.
// =============================================================================

function formatIngestSummary(
  provider: string,
  result: ImportIngestResponse,
): string {
  const parts: string[] = [];
  if (typeof result.prepared === "number") parts.push(`prepared: ${result.prepared}`);
  if (typeof result.imported === "number") parts.push(`imported: ${result.imported}`);
  if (result.dryRun) parts.push("dryRun");
  if (result.jobId) parts.push(`jobId: ${result.jobId}`);
  if (result.errors?.length) parts.push(`errors: ${result.errors.length}`);
  const detail = parts.length ? ` (${parts.join(" · ")})` : "";
  return `✓ ${provider} ingest queued${detail}.`;
}

export async function handleVxImportChatGPT(
  client: VxClientLike,
  args: { path: string; dryRun?: boolean; limit?: number }
): Promise<string> {
  if (!client.importChatGPT) {
    throw new Error("vx_import_chatgpt is not supported by this client.");
  }
  const result = await client.importChatGPT({
    path: args.path,
    dryRun: args.dryRun,
    limit: args.limit,
  });
  return formatIngestSummary("ChatGPT", result);
}

export async function handleVxImportAnthropic(
  client: VxClientLike,
  args: { path: string; dryRun?: boolean; limit?: number }
): Promise<string> {
  if (!client.importAnthropic) {
    throw new Error("vx_import_anthropic is not supported by this client.");
  }
  const result = await client.importAnthropic({
    path: args.path,
    dryRun: args.dryRun,
    limit: args.limit,
  });
  return formatIngestSummary("Anthropic", result);
}

export async function handleVxCascadeQuery(
  client: VxClientLike,
  args: {
    query: string;
    contexts?: string[];
    counterparty?: CounterpartyIdentity;
    counterpartyId?: string;
    counterpartyKind?: string;
    counterpartyClient?: string;
    counterpartySession?: string;
    channels?: string[];
    limit?: number;
  }
): Promise<string> {
  if (!client.cascadeQuery) {
    throw new Error("vx_cascade_query is not supported by this client.");
  }
  const counterparty =
    args.counterparty ??
    getCounterparty({
      counterpartyId: args.counterpartyId,
      counterpartyKind: args.counterpartyKind,
      counterpartyClient: args.counterpartyClient,
      counterpartySession: args.counterpartySession,
    });
  const result = await client.cascadeQuery({
    query: args.query,
    contexts: args.contexts,
    counterparty,
    channels: args.channels,
    limit: args.limit ?? 10,
  });
  if (!result.memories.length) {
    const queryIdLine = result.meta?.queryId ? ` (queryId: ${result.meta.queryId})` : "";
    return `No relevant memories found${queryIdLine}.`;
  }
  const channelsLine =
    result.meta?.channels?.length
      ? ` · channels: ${result.meta.channels.join(", ")}`
      : "";
  const queryIdLine = result.meta?.queryId ? ` · queryId: ${result.meta.queryId}` : "";
  const formatted = result.memories
    .map(
      (m, i) =>
        `[${i + 1}] ${m.content}${m.context ? ` (context: ${m.context})` : ""}${typeof m.score === "number" ? ` — score: ${m.score.toFixed(3)}` : ""}`
    )
    .join("\n\n");
  return `Found ${result.memories.length} memories via cascade${channelsLine}${queryIdLine}:\n\n${formatted}`;
}

export async function handleVxEntityMerge(
  client: VxClientLike,
  args: { canonical: string; aliases: string[]; confidence: number; confirm: boolean }
): Promise<string> {
  if (!client.mergeEntities) {
    throw new Error("vx_entity_merge is not supported by this client.");
  }
  if (!Array.isArray(args.aliases) || args.aliases.length === 0) {
    throw new Error("vx_entity_merge requires a non-empty `aliases` array.");
  }
  const result = await client.mergeEntities({
    canonical: args.canonical,
    aliases: args.aliases,
    confidence: args.confidence,
    confirm: args.confirm === true,
  });
  const status = result.merged
    ? "merged"
    : result.pending || !args.confirm
      ? "previewed (not confirmed)"
      : "submitted";
  const confLine = typeof result.confidence === "number" ? ` · confidence: ${result.confidence.toFixed(3)}` : "";
  const idLine = result.id ? ` · id: ${result.id}` : "";
  return `Entity ${status}: canonical=${result.canonical}, aliases=${result.aliases.length}${confLine}${idLine}`;
}

export async function handleVxContextsEmergentList(
  client: VxClientLike,
  args: { minSize?: number; limit?: number }
): Promise<string> {
  if (!client.listEmergentContexts) {
    throw new Error("vx_contexts_emergent_list is not supported by this client.");
  }
  const result = await client.listEmergentContexts({
    minSize: args.minSize,
    limit: args.limit ?? 20,
  });
  if (!result.contexts.length) {
    return "No emergent contexts found.";
  }
  const formatted = result.contexts
    .map((ctx, i) => {
      const details = [
        ctx.description,
        typeof ctx.size === "number" ? `size: ${ctx.size}` : null,
        typeof ctx.confidence === "number" ? `confidence: ${ctx.confidence.toFixed(3)}` : null,
        typeof ctx.active === "boolean" ? `active: ${ctx.active}` : null,
      ].filter(Boolean);
      return `[${i + 1}] ${ctx.name}${details.length ? ` — ${details.join(" · ")}` : ""}`;
    })
    .join("\n");
  return `Showing ${result.contexts.length} of ${result.total} emergent contexts:\n\n${formatted}`;
}

export async function handleVxContextsCreateFromDescription(
  client: VxClientLike,
  args: { name: string; description: string }
): Promise<string> {
  if (!client.createContextFromDescription) {
    throw new Error("vx_contexts_create_from_description is not supported by this client.");
  }
  const created = await client.createContextFromDescription({
    name: args.name,
    description: args.description,
  });
  const details = [created.description, formatContextCount(created)].filter(Boolean);
  return `✓ Knowledge context created from description: ${created.name}${details.length ? ` (${details.join(" · ")})` : ""}`;
}

export async function handleVxContextsActivate(
  client: VxClientLike,
  args: { name: string }
): Promise<string> {
  if (!client.activateContext) {
    throw new Error("vx_contexts_activate is not supported by this client.");
  }
  const result = await client.activateContext(args.name);
  return `✓ Knowledge context ${result.name} is now ${result.active ? "active" : "inactive"}.`;
}

export async function handleVxContextsDeactivate(
  client: VxClientLike,
  args: { name: string }
): Promise<string> {
  if (!client.deactivateContext) {
    throw new Error("vx_contexts_deactivate is not supported by this client.");
  }
  const result = await client.deactivateContext(args.name);
  return `✓ Knowledge context ${result.name} is now ${result.active ? "active" : "inactive"}.`;
}

export async function handleVxSkillsFind(
  client: VxClientLike,
  args: { triggerQuery: string; limit?: number }
): Promise<string> {
  if (!client.findSkills) {
    throw new Error("vx_skills_find is not supported by this client.");
  }
  const result = await client.findSkills({
    triggerQuery: args.triggerQuery,
    limit: args.limit ?? 5,
  });
  if (!result.skills.length) {
    return "No matching skills found.";
  }
  const formatted = result.skills
    .map((s, i) => {
      const details = [
        s.description,
        s.trigger ? `trigger: ${s.trigger}` : null,
        typeof s.score === "number" ? `score: ${s.score.toFixed(3)}` : null,
      ].filter(Boolean);
      return `[${i + 1}] ${s.name}${details.length ? ` — ${details.join(" · ")}` : ""}`;
    })
    .join("\n");
  return `Found ${result.skills.length} skill(s) matching "${args.triggerQuery}":\n\n${formatted}`;
}

export async function handleVxSkillsInvoke(
  client: VxClientLike,
  args: { name: string; execute?: boolean }
): Promise<string> {
  if (!client.invokeSkill) {
    throw new Error("vx_skills_invoke is not supported by this client.");
  }
  const result = await client.invokeSkill({
    name: args.name,
    execute: args.execute === true,
  });
  const mode = result.executed ? "executed" : "previewed";
  const stepsLine =
    Array.isArray(result.steps) && result.steps.length
      ? ` · steps: ${result.steps.length}`
      : "";
  const idLine = result.memoryId ? ` · memoryId: ${result.memoryId}` : "";
  return `✓ Skill ${result.name} ${mode}${stepsLine}${idLine}.`;
}

export async function handleVxHealthStatus(
  client: VxClientLike,
  _args: Record<string, unknown> = {}
): Promise<string> {
  if (!client.healthDetailed) {
    throw new Error("vx_health_status is not supported by this client.");
  }
  const report = await client.healthDetailed();
  const components = report.components ?? report.checks ?? {};
  const componentLines = Object.entries(components).map(([name, entry]) => {
    const status = entry?.status ?? "unknown";
    const msg = entry?.message ? ` — ${entry.message}` : "";
    return `  - ${name}: ${status}${msg}`;
  });
  const header = `VX status: ${report.status ?? "unknown"}${report.version ? ` · version: ${report.version}` : ""}${typeof report.uptime === "number" ? ` · uptime: ${report.uptime}s` : ""}`;
  if (componentLines.length === 0) {
    return header;
  }
  return `${header}\n${componentLines.join("\n")}`;
}
