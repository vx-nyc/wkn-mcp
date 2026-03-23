/**
 * E2E test: MCP server + SDK against a real VX API only (no mock server).
 * Loads test/.env.e2e if VX_BEARER_TOKEN/VX_API_KEY are not set.
 * If no credentials or server unreachable: skips and exits 0.
 * For full e2e: point VX_API_BASE_URL at a reachable VX API and set credentials.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createVxClient, importFromText } from "../src/sdk/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

function loadTestEnv(): void {
  if (process.env.VX_BEARER_TOKEN || process.env.VX_API_KEY) return;
  const envPath = path.join(process.cwd(), "test", ".env.e2e");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        process.env[key] = value;
      }
    }
  }
}
loadTestEnv();

const VX_API_BASE_URL =
  process.env.VX_API_BASE_URL || process.env.VX_API_URL || "http://localhost:3000/v1";
const VX_API_KEY = process.env.VX_API_KEY;
const VX_BEARER_TOKEN = process.env.VX_BEARER_TOKEN;
const envAuth = VX_BEARER_TOKEN ? { bearerToken: VX_BEARER_TOKEN } : VX_API_KEY ? { apiKey: VX_API_KEY } : null;
type AuthConfig = { apiKey?: string; bearerToken?: string };

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSdkQuery(
  query: () => Promise<{ memories: Array<{ id: string; content: string }> }>,
  predicate: (memories: Array<{ id: string; content: string }>) => boolean,
  label: string,
): Promise<{ memories: Array<{ id: string; content: string }> }> {
  let lastResult: { memories: Array<{ id: string; content: string }> } | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastResult = await query();
    if (predicate(lastResult.memories)) {
      return lastResult;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250 * (attempt + 1));
  }
  throw new Error(label);
}

async function waitForToolText(
  query: () => Promise<string>,
  predicate: (text: string) => boolean,
  label: string,
): Promise<string> {
  let lastText = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastText = await query();
    if (predicate(lastText)) {
      return lastText;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250 * (attempt + 1));
  }
  throw new Error(label);
}

async function ensureBuilt(): Promise<void> {
  const distIndex = path.join(process.cwd(), "dist", "index.js");
  if (!fs.existsSync(distIndex)) {
    console.error("dist/index.js not found. Run: npm run build");
    process.exit(1);
  }
}

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

function isLocalApi(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl);
}

async function registerLocalUser(baseUrl: string): Promise<AuthConfig> {
  const response = await fetch(`${apiRoot(baseUrl)}/v1/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `mcp-e2e-${randomUUID()}@vx.test`,
      name: "VX MCP E2E",
    }),
  });

  if (!response.ok) {
    throw new Error(`Register failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  const apiKey = json?.data?.apiKey as string | undefined;
  if (!apiKey) {
    throw new Error("Register response did not include apiKey.");
  }
  return { apiKey };
}

async function resolveAuth(baseUrl: string): Promise<AuthConfig | null> {
  if (isLocalApi(baseUrl)) {
    try {
      return await registerLocalUser(baseUrl);
    } catch (error) {
      if (envAuth) {
        console.warn("Falling back to provided VX credentials after local register failed:", error);
        return envAuth;
      }
      throw error;
    }
  }

  return envAuth;
}

async function runSdkSmoke(auth: AuthConfig): Promise<boolean> {
  if (!auth) {
    console.log("Skipping SDK smoke: no VX_API_KEY or VX_BEARER_TOKEN.");
    return false;
  }
  const client = createVxClient({
    apiBaseUrl: VX_API_BASE_URL,
    ...auth,
  });
  const id = `e2e-${Date.now()}`;
  const content = `E2E smoke memory ${id}`;
  const memory = await client.createMemory({
    content,
    context: "e2e/smoke",
    memoryType: "SEMANTIC",
  });
  console.log("SDK createMemory:", memory.id);
  const result = await waitForSdkQuery(
    () => client.queryMemories({ query: "E2E smoke", limit: 5 }),
    (memories) => memories.some((m) => m.id === memory.id),
    "SDK smoke: created memory not found in query",
  );
  const found = result.memories.some((m) => m.id === memory.id);
  if (!found) throw new Error("SDK smoke: created memory not found in query");
  console.log("SDK smoke: create + query OK");

  const importId = `e2e-sdk-import-${Date.now()}`;
  const importResult = await importFromText(client, `SDK import smoke content ${importId}`, {
    defaultContext: "e2e/sdk",
    memoryType: "SEMANTIC",
  });
  if (importResult.created < 1) throw new Error("SDK smoke: importFromText created no memories");
  const importQuery = await waitForSdkQuery(
    () => client.queryMemories({ query: importId, limit: 5 }),
    (memories) => memories.some((m) => m.content.includes(importId)),
    "SDK smoke: import text not found in query",
  );
  const importFound = importQuery.memories.some((m) => m.content.includes(importId));
  if (!importFound) throw new Error("SDK smoke: import text not found in query");
  console.log("SDK smoke: importFromText + query OK");
  return true;
}

async function runMcpE2e(auth: AuthConfig): Promise<boolean> {
  if (!auth) {
    console.log("Skipping MCP e2e: no VX_API_KEY or VX_BEARER_TOKEN.");
    return false;
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(process.cwd(), "dist", "index.js")],
    env: {
      ...process.env,
      VX_API_BASE_URL,
      ...(auth.bearerToken ? { VX_BEARER_TOKEN: auth.bearerToken } : {}),
      ...(auth.apiKey ? { VX_API_KEY: auth.apiKey } : {}),
    },
  });

  const client = new Client(
    { name: "vx-mcp-e2e", version: "0.5.4" },
    { capabilities: {} }
  );

  await client.connect(transport);

  const listRes = await client.listTools();
  const toolNames = listRes.tools.map((t) => t.name);
  const required = [
    "vx_store",
    "vx_recall",
    "vx_query",
    "vx_list",
    "vx_delete",
    "vx_context",
    "vx_contexts_list",
    "vx_contexts_create",
    "vx_import_text",
    "vx_import_batch",
  ];
  for (const name of required) {
    if (!toolNames.includes(name)) throw new Error(`Missing tool: ${name}`);
  }
  console.log("MCP ListTools OK:", toolNames.length, "tools");

  const unique = `e2e-mcp-${Date.now()}`;
  const storeRes = await client.callTool({
    name: "vx_store",
    arguments: {
      content: unique,
      context: "e2e/mcp",
      memoryType: "SEMANTIC",
    },
  });
  if (storeRes.isError) throw new Error(`vx_store failed: ${storeRes.content?.[0]?.type === "text" ? (storeRes.content[0] as { text: string }).text : storeRes}`);
  const storeText = (storeRes.content?.[0] as { text?: string })?.text ?? "";
  const idMatch = storeText.match(/ID:\s*([^\s)]+)/);
  const memoryId = idMatch ? idMatch[1]!.trim() : null;
  if (!memoryId) throw new Error("vx_store did not return memory ID");
  console.log("MCP vx_store OK, id:", memoryId);

  const queryRes = await client.callTool({
    name: "vx_query",
    arguments: { query: unique, limit: 5 },
  });
  if (queryRes.isError) throw new Error(`vx_query failed: ${(queryRes.content?.[0] as { text?: string })?.text}`);
  const queryText = (queryRes.content?.[0] as { text?: string })?.text ?? "";
  if (!queryText.includes(unique)) throw new Error("vx_query did not return stored memory");
  console.log("MCP vx_query OK");

  const recallRes = await client.callTool({
    name: "vx_recall",
    arguments: { query: unique, limit: 5 },
  });
  if (recallRes.isError) throw new Error(`vx_recall failed: ${(recallRes.content?.[0] as { text?: string })?.text}`);
  const recallText = (recallRes.content?.[0] as { text?: string })?.text ?? "";
  if (!recallText.includes(unique)) throw new Error("vx_recall did not return stored memory");
  console.log("MCP vx_recall OK");

  const listRes2 = await client.callTool({
    name: "vx_list",
    arguments: { limit: 20, context: "e2e/mcp" },
  });
  if (listRes2.isError) throw new Error(`vx_list failed: ${(listRes2.content?.[0] as { text?: string })?.text}`);
  const listText = (listRes2.content?.[0] as { text?: string })?.text ?? "";
  if (!listText.includes(memoryId)) throw new Error("vx_list did not include stored memory");
  console.log("MCP vx_list OK");

  const contextName = `e2e/context-${Date.now()}`;
  const createContextRes = await client.callTool({
    name: "vx_contexts_create",
    arguments: {
      name: contextName,
      description: "E2E context",
    },
  });
  if (createContextRes.isError) throw new Error(`vx_contexts_create failed: ${(createContextRes.content?.[0] as { text?: string })?.text}`);

  const listContextsRes = await client.callTool({
    name: "vx_contexts_list",
    arguments: { prefix: "e2e/" },
  });
  if (listContextsRes.isError) throw new Error(`vx_contexts_list failed: ${(listContextsRes.content?.[0] as { text?: string })?.text}`);
  const listContextsText = (listContextsRes.content?.[0] as { text?: string })?.text ?? "";
  if (!listContextsText.includes(contextName)) throw new Error("vx_contexts_list did not include created context");
  console.log("MCP vx_contexts_create + vx_contexts_list OK");

  const importUnique = `e2e-import-${Date.now()}`;
  const importTextRes = await client.callTool({
    name: "vx_import_text",
    arguments: { text: `First chunk. ${importUnique} second chunk.`, context: "e2e/import", memoryType: "SEMANTIC" },
  });
  if (importTextRes.isError) throw new Error(`vx_import_text failed: ${(importTextRes.content?.[0] as { text?: string })?.text}`);
  console.log("MCP vx_import_text OK");
  const sdkClient = createVxClient({
    apiBaseUrl: VX_API_BASE_URL,
    ...auth,
  });

  const batchUnique = `e2e-batch-${Date.now()}`;
  const importBatchRes = await client.callTool({
    name: "vx_import_batch",
    arguments: {
      memories: [
        { content: `Batch A ${batchUnique}`, context: "e2e/batch", memoryType: "SEMANTIC" },
        { content: `Batch B ${batchUnique}`, context: "e2e/batch", memoryType: "SEMANTIC" },
      ],
    },
  });
  if (importBatchRes.isError) throw new Error(`vx_import_batch failed: ${(importBatchRes.content?.[0] as { text?: string })?.text}`);
  const queryImportText = await waitForToolText(
    async () => {
      const res = await client.callTool({
        name: "vx_query",
        arguments: { query: importUnique, limit: 5 },
      });
      if (res.isError) throw new Error(`vx_query after import_text failed`);
      return (res.content?.[0] as { text?: string })?.text ?? "";
    },
    (text) => text.includes(importUnique),
    "vx_query did not return import_text memory",
  );
  if (!queryImportText.includes(importUnique)) throw new Error("vx_query did not return import_text memory");
  const batchQuery = await waitForSdkQuery(
    () => sdkClient.listMemories({ context: "e2e/batch", limit: 20 }),
    (memories) =>
      memories.some((memory) => memory.content.includes(`Batch A ${batchUnique}`)) &&
      memories.some((memory) => memory.content.includes(`Batch B ${batchUnique}`)),
    "SDK list did not return import_batch memories",
  );
  const batchAFound = batchQuery.memories.some((memory) => memory.content.includes(`Batch A ${batchUnique}`));
  const batchBFound = batchQuery.memories.some((memory) => memory.content.includes(`Batch B ${batchUnique}`));
  if (!batchAFound || !batchBFound) throw new Error("SDK list did not return import_batch memories");
  console.log("MCP vx_import_batch OK");

  const contextRes = await client.callTool({
    name: "vx_context",
    arguments: { topic: "e2e mcp test", contexts: [contextName] },
  });
  if (contextRes.isError) throw new Error(`vx_context failed: ${(contextRes.content?.[0] as { text?: string })?.text}`);
  console.log("MCP vx_context OK");

  const deleteRes = await client.callTool({
    name: "vx_delete",
    arguments: { id: memoryId },
  });
  if (deleteRes.isError) throw new Error(`vx_delete failed: ${(deleteRes.content?.[0] as { text?: string })?.text}`);
  console.log("MCP vx_delete OK");

  const queryAfter = await client.callTool({
    name: "vx_query",
    arguments: { query: unique, limit: 5 },
  });
  if (queryAfter.isError) throw new Error(`vx_query after delete failed`);
  const afterText = (queryAfter.content?.[0] as { text?: string })?.text ?? "";
  if (afterText.includes(unique)) throw new Error("vx_query still returned deleted memory");
  console.log("MCP e2e: deleted memory no longer in query OK");

  await transport.close();
  return true;
}

async function main() {
  await ensureBuilt();
  const baseUrl = apiRoot(VX_API_BASE_URL);
  let reachable = false;
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    reachable = res.ok;
  } catch {
    // ignore
  }
  if (!reachable) {
    console.log("E2E skipped: VX API not reachable at", baseUrl, "- point VX_API_BASE_URL at a reachable API to run e2e.");
    process.exit(0);
  }
  const auth = await resolveAuth(VX_API_BASE_URL);
  if (!auth) {
    console.log("E2E skipped: no VX credentials for remote API and local auto-register unavailable.");
    process.exit(0);
  }
  console.log("E2E: SDK smoke...");
  await runSdkSmoke(auth);
  console.log("E2E: MCP client...");
  await runMcpE2e(auth);
  console.log("E2E completed successfully.");
}

main().catch((err) => {
  console.error("E2E failed:", err);
  process.exit(1);
});
