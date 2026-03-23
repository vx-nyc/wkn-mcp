import {
  VxApiClient,
  createVxClient,
  type CreateMemoryInput,
  type VxMemory,
} from "./sdk/index.js";
import type {
  ContextPacketInput,
  ContextPacketResult,
  InternalSdkClientConfig,
  Memory,
  QueryMemoriesInput,
  QueryResult,
  StoreMemoryInput,
  UpdateMemoryInput,
  ListMemoriesInput,
  ListResult,
  VXClientConfig,
  VXErrorCode,
} from "./types.js";
import { VXError } from "./types.js";

const CLIENT_VERSION = "0.5.6";
const DEFAULT_API_BASE_URL = "https://api.vx.dev/v1";

function normalizeApiBaseUrl(rawBase?: string): string {
  const base = (rawBase || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export function detectSource(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  if (env.CURSOR_SESSION_ID || cwd.toLowerCase().includes("cursor")) return "cursor";
  if (env.WINDSURF_SESSION || cwd.toLowerCase().includes("windsurf")) return "windsurf";
  if (cwd.toLowerCase().includes("codex")) return "codex";
  if (env.CLAUDE_DESKTOP || cwd.includes("Claude")) return "claude-desktop";
  if (cwd.toLowerCase().includes("openclaw")) return "openclaw";
  if (env.VSCODE_PID || cwd.toLowerCase().includes("vscode")) return "vscode";
  return "mcp";
}

function mapStatusToErrorCode(status: number): VXErrorCode {
  switch (status) {
    case 400:
    case 422:
      return "VALIDATION_ERROR";
    case 401:
    case 403:
      return "UNAUTHORIZED";
    case 404:
      return "NOT_FOUND";
    case 429:
      return "RATE_LIMITED";
    case 500:
    case 502:
    case 503:
    case 504:
      return "SERVER_ERROR";
    default:
      return "UNKNOWN";
  }
}

function resolveClientConfig(
  config: VXClientConfig,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): InternalSdkClientConfig {
  const apiBaseUrl = normalizeApiBaseUrl(
    config.apiBaseUrl || config.apiUrl || env.VX_API_BASE_URL || env.VX_API_URL,
  );
  const apiKey = config.apiKey || env.VX_API_KEY;
  const bearerToken = config.bearerToken || env.VX_BEARER_TOKEN;

  if (!apiKey && !bearerToken) {
    throw new VXError(
      "VX_API_KEY or VX_BEARER_TOKEN is required.",
      "VALIDATION_ERROR",
    );
  }

  return {
    apiBaseUrl,
    apiKey,
    bearerToken,
    custodianId: config.custodianId || env.VX_CUSTODIAN_ID,
    source: config.source || detectSource(env, cwd),
    requestTimeoutMs: config.requestTimeoutMs,
    apiHealthRetryCount: config.apiHealthRetryCount,
    apiHealthRetryDelayMs: config.apiHealthRetryDelayMs,
    apiHealthTimeoutMs: config.apiHealthTimeoutMs,
  };
}

function healthUrl(apiBaseUrl: string): string {
  return apiBaseUrl.endsWith("/v1")
    ? `${apiBaseUrl.slice(0, -3)}/health`
    : `${apiBaseUrl}/health`;
}

function makeHeaders(config: InternalSdkClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client": `vx-mcp/${CLIENT_VERSION}`,
    "X-Source": config.source || "mcp",
  };

  if (config.apiKey) headers["X-API-Key"] = config.apiKey;
  if (config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`;
  if (config.custodianId) headers["X-Custodian-Id"] = config.custodianId;

  return headers;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (response.ok) {
    return (json.data ?? json) as T;
  }

  throw new VXError(
    json.error?.message || `VX request failed with HTTP ${response.status}`,
    mapStatusToErrorCode(response.status),
    response.status,
    response.status >= 500 || response.status === 429,
  );
}

function mapStoreInput(input: StoreMemoryInput): CreateMemoryInput {
  const metadata = {
    ...(input.metadata || {}),
    ...(typeof input.importance === "number" ? { importance: input.importance } : {}),
  };

  return {
    content: input.content,
    context: input.context,
    memoryType: input.memoryType,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    source: input.source,
  };
}

function mapQueryInput(input: QueryMemoriesInput) {
  return {
    query: input.query,
    limit: input.limit,
    contexts: input.context ? [input.context] : undefined,
    memoryTypes: input.memoryType ? [input.memoryType] : undefined,
    minScore: input.minScore,
  };
}

function assertNonEmpty(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new VXError(`${field} is required`, "VALIDATION_ERROR");
  }
}

export class VXClient {
  private readonly config: InternalSdkClientConfig;

  private readonly sdk: VxApiClient;

  constructor(config: VXClientConfig, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()) {
    this.config = resolveClientConfig(config, env, cwd);
    this.sdk = createVxClient(this.config);
  }

  async healthCheck(): Promise<{ ok: boolean; latency: number }> {
    const startedAt = Date.now();
    const response = await fetch(healthUrl(this.config.apiBaseUrl), {
      method: "GET",
      headers: makeHeaders(this.config),
    });
    return {
      ok: response.ok,
      latency: Date.now() - startedAt,
    };
  }

  async store(input: StoreMemoryInput): Promise<Memory> {
    assertNonEmpty(input.content, "content");
    return this.sdk.createMemory(mapStoreInput(input));
  }

  async update(input: UpdateMemoryInput): Promise<Memory> {
    assertNonEmpty(input.id, "id");
    if (
      input.content === undefined &&
      input.context === undefined &&
      input.memoryType === undefined &&
      input.importance === undefined &&
      input.metadata === undefined
    ) {
      throw new VXError(
        "At least one field must be provided for update",
        "VALIDATION_ERROR",
      );
    }

    const metadata = {
      ...(input.metadata || {}),
      ...(typeof input.importance === "number" ? { importance: input.importance } : {}),
    };

    const response = await fetch(
      `${this.config.apiBaseUrl}/memories/${encodeURIComponent(input.id)}`,
      {
        method: "PATCH",
        headers: makeHeaders(this.config),
        body: JSON.stringify({
          content: input.content,
          context: input.context,
          memoryType: input.memoryType,
          metadata: Object.keys(metadata).length ? metadata : undefined,
        }),
      },
    );

    return parseJsonResponse<VxMemory>(response);
  }

  async query(input: QueryMemoriesInput): Promise<QueryResult> {
    assertNonEmpty(input.query, "query");
    return this.sdk.queryMemories(mapQueryInput(input));
  }

  async list(input: ListMemoriesInput = {}): Promise<ListResult> {
    const result = await this.sdk.listMemories({
      limit: input.limit,
      offset: input.offset,
      context: input.context,
      memoryType: input.memoryType,
    });

    return {
      memories: result.memories,
      total: result.total,
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      hasMore: result.hasMore,
    };
  }

  async delete(id: string): Promise<void> {
    assertNonEmpty(id, "id");
    await this.sdk.deleteMemory(id);
  }

  async getContextPacket(input: ContextPacketInput): Promise<ContextPacketResult> {
    assertNonEmpty(input.topic, "topic");
    const packet = await this.sdk.buildContextPacket({
      query: input.topic,
      maxTokens: input.maxTokens,
    });

    return {
      context: packet.formatted,
      memoryCount: packet.memoriesUsed,
      memories: packet.memories,
      tokensUsed: packet.tokensUsed,
      truncated: packet.truncated,
    };
  }
}

export function createClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): VXClient {
  return new VXClient(
    {
      apiBaseUrl: env.VX_API_BASE_URL || env.VX_API_URL,
      apiKey: env.VX_API_KEY,
      bearerToken: env.VX_BEARER_TOKEN,
      custodianId: env.VX_CUSTODIAN_ID,
      source: env.VX_SOURCE,
    },
    env,
    cwd,
  );
}
