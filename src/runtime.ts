import { createVxClient } from "./sdk/index.js";
import {
  handleVxContext,
  handleVxContextsCreate,
  handleVxContextsList,
  handleVxDelete,
  handleVxImportBatch,
  handleVxImportText,
  handleVxList,
  handleVxQuery,
  handleVxRecall,
  handleVxStore,
  type VxClientLike,
} from "./handlers.js";
import {
  VX_DEFAULT_API_BASE_URL,
  VX_DEFAULT_MAX_TOKENS,
  VX_DEFAULT_NAME,
} from "./constants.js";
import { discoverApiBaseUrl } from "./discover.js";
import type { VxToolName } from "./catalog.js";

export type VxResolvedConfig = {
  apiBaseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  custodianId?: string;
  source: string;
  name: string;
  storeOnRequestOnly: boolean;
  maxTokens: number;
  client: string;
};

export function normalizeSourceTag(source: string): string {
  switch (source) {
    case "claude":
      return "claude-code";
    default:
      return source;
  }
}

export type VxConfigInput = Partial<
  Omit<VxResolvedConfig, "apiBaseUrl" | "maxTokens" | "storeOnRequestOnly"> & {
    apiBaseUrl?: string;
    maxTokens?: number;
    storeOnRequestOnly?: boolean;
  }
>;

export type VxToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === "1" || value === "true";
}

export function detectSource(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string {
  if (env.CURSOR_SESSION_ID || cwd.toLowerCase().includes("cursor")) {
    return "cursor";
  }
  if (env.WINDSURF_SESSION || cwd.toLowerCase().includes("windsurf")) {
    return "windsurf";
  }
  if (cwd.toLowerCase().includes("codex")) {
    return "codex";
  }
  if (env.CLAUDE_DESKTOP || cwd.includes("Claude")) {
    return "claude-desktop";
  }
  if (cwd.toLowerCase().includes("openclaw")) {
    return "openclaw";
  }
  if (env.VSCODE_PID || cwd.toLowerCase().includes("vscode")) {
    return "vscode";
  }
  return "mcp";
}

export function normalizeApiBaseUrl(rawBase?: string): string {
  const base = (rawBase || VX_DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

/**
 * Async config resolution with service discovery.
 * Priority: explicit input > env var > discovered URL > hardcoded default.
 */
export async function resolveVxConfigAsync(
  input: VxConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Promise<VxResolvedConfig> {
  const explicitUrl = input.apiBaseUrl || env.VX_API_BASE_URL || env.VX_API_URL;
  const discoveredUrl = explicitUrl ? null : await discoverApiBaseUrl();
  return resolveVxConfig(
    { ...input, apiBaseUrl: explicitUrl || discoveredUrl || undefined },
    env,
    cwd
  );
}

export function resolveVxConfig(
  input: VxConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): VxResolvedConfig {
  return {
    apiBaseUrl: normalizeApiBaseUrl(
      input.apiBaseUrl || env.VX_API_BASE_URL || env.VX_API_URL || VX_DEFAULT_API_BASE_URL
    ),
    apiKey: input.apiKey || env.VX_API_KEY,
    bearerToken: input.bearerToken || env.VX_BEARER_TOKEN,
    custodianId: input.custodianId || env.VX_CUSTODIAN_ID,
    source: normalizeSourceTag(input.source || env.VX_SOURCE || detectSource(env, cwd)),
    name: input.name || env.VX_NAME || VX_DEFAULT_NAME,
    storeOnRequestOnly:
      input.storeOnRequestOnly ??
      parseBoolean(env.VX_MCP_STORE_ON_REQUEST_ONLY) ??
      false,
    maxTokens:
      typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens)
        ? input.maxTokens
        : VX_DEFAULT_MAX_TOKENS,
    client: input.client || "mcp-server",
  };
}

export function hasCredentials(config: Pick<VxResolvedConfig, "apiKey" | "bearerToken">): boolean {
  return Boolean(config.apiKey || config.bearerToken);
}

export function assertVxCredentials(
  config: Pick<VxResolvedConfig, "apiKey" | "bearerToken">
): void {
  if (!hasCredentials(config)) {
    throw new Error("VX_API_KEY or VX_BEARER_TOKEN is required.");
  }
}

export function createConfiguredVxClient(config: VxResolvedConfig): VxClientLike {
  assertVxCredentials(config);
  return createVxClient({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    bearerToken: config.bearerToken,
    custodianId: config.custodianId,
    source: config.source,
  });
}

export async function executeVxOperation(
  client: VxClientLike,
  name: VxToolName,
  args: Record<string, unknown>,
  config: VxResolvedConfig
): Promise<string> {
  const meta = {
    source: config.source,
    name: config.name,
    client: config.client,
  };

  switch (name) {
    case "vx_store":
      return handleVxStore(client, args as Parameters<typeof handleVxStore>[1], meta);
    case "vx_query":
      return handleVxQuery(client, args as Parameters<typeof handleVxQuery>[1], meta);
    case "vx_recall":
      return handleVxRecall(client, args as Parameters<typeof handleVxRecall>[1], meta);
    case "vx_list":
      return handleVxList(client, args as Parameters<typeof handleVxList>[1]);
    case "vx_delete":
      return handleVxDelete(client, args as Parameters<typeof handleVxDelete>[1]);
    case "vx_context":
      return handleVxContext(client, {
        maxTokens: config.maxTokens,
        ...(args as Parameters<typeof handleVxContext>[1]),
      });
    case "vx_contexts_list":
      return handleVxContextsList(
        client,
        args as Parameters<typeof handleVxContextsList>[1]
      );
    case "vx_contexts_create":
      return handleVxContextsCreate(
        client,
        args as Parameters<typeof handleVxContextsCreate>[1]
      );
    case "vx_import_text":
      return handleVxImportText(
        client,
        args as Parameters<typeof handleVxImportText>[1],
        meta
      );
    case "vx_import_batch":
      return handleVxImportBatch(
        client,
        args as Parameters<typeof handleVxImportBatch>[1],
        meta
      );
  }
}

export function formatToolTextResult(text: string): VxToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

export function formatToolError(error: unknown): VxToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export async function executeConfiguredTool(
  name: VxToolName,
  args: Record<string, unknown>,
  config: VxResolvedConfig,
  clientFactory: (config: VxResolvedConfig) => VxClientLike = createConfiguredVxClient
): Promise<VxToolResult> {
  try {
    const client = clientFactory(config);
    const text = await executeVxOperation(client, name, args, config);
    return formatToolTextResult(text);
  } catch (error) {
    return formatToolError(error);
  }
}

export function getVxStatusText(config: VxResolvedConfig): string {
  const credentialLine = config.apiKey
    ? "Credential: API key configured"
    : config.bearerToken
      ? "Credential: bearer token configured"
      : "Credential: missing";

  return [
    `${config.name} for OpenClaw is ${
      hasCredentials(config) ? "ready to use." : "not configured yet."
    }`,
    `API base URL: ${config.apiBaseUrl}`,
    credentialLine,
    `Source tag: ${config.source}`,
    `Store only on explicit request: ${config.storeOnRequestOnly ? "yes" : "no"}`,
    `Default context packet size: ${config.maxTokens} tokens`,
    hasCredentials(config)
      ? "Try `vx_status`, then ask OpenClaw to recall or store a small preference to verify continuity."
      : "Add `apiKey` or `bearerToken` under `plugins.entries.vx-memory.config` to enable recall and storage.",
  ].join("\n");
}
