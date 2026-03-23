/**
 * Counterparty continuity e2e:
 * - Registers a fresh local VX user
 * - Stores memories for multiple counterparties (user, bot, agent, subagent)
 * - Verifies SDK, raw API, and MCP retrieval all bias toward the right counterparty
 *
 * This exercises the real local API the same way a client would.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createVxClient, type CounterpartyIdentity, type QueryResponse } from "../src/sdk/index.js";

type RegisteredUser = {
  apiKey: string;
  custodianId: string;
};

type EvalCase = {
  name: string;
  memories: Array<{ content: string }>;
  expected: string[];
  forbiddenTop1?: string[];
};

type EvalResult = {
  name: string;
  rr: number;
  hitAt3: boolean;
  cleanTop1: boolean;
  top1: string;
};

const VX_API_BASE_URL =
  process.env.VX_API_BASE_URL || process.env.VX_API_URL || "http://localhost:3000/v1";

function apiRoot(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
}

async function ensureBuilt(): Promise<void> {
  const distIndex = path.join(process.cwd(), "dist", "index.js");
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.js not found. Run `npm run build` in vx-mcp first.");
  }
}

async function ensureApiReachable(baseUrl: string): Promise<void> {
  const res = await fetch(`${apiRoot(baseUrl)}/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) {
    throw new Error(`VX API not reachable at ${apiRoot(baseUrl)} (${res.status})`);
  }
}

async function registerLocalUser(baseUrl: string): Promise<RegisteredUser> {
  const res = await fetch(`${apiRoot(baseUrl)}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `counterparty-${randomUUID()}@vx.test`,
      name: "Counterparty Continuity",
    }),
  });

  if (!res.ok) {
    throw new Error(`Register failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const apiKey = json?.data?.apiKey;
  const custodianId = json?.data?.id;
  if (!apiKey || !custodianId) {
    throw new Error("Register response did not include apiKey and custodianId.");
  }
  return { apiKey, custodianId };
}

function evaluateCase(testCase: EvalCase): EvalResult {
  const contents = testCase.memories.map((memory) => memory.content);
  const firstRelevantIndex = contents.findIndex((content) =>
    testCase.expected.some((fragment) => content.includes(fragment)),
  );
  const top3 = contents.slice(0, 3).join(" || ");
  const top1 = contents[0] || "";
  const cleanTop1 = !(testCase.forbiddenTop1 || []).some((fragment) => top1.includes(fragment));

  return {
    name: testCase.name,
    rr: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    hitAt3: testCase.expected.some((fragment) => top3.includes(fragment)),
    cleanTop1,
    top1,
  };
}

function printEvalResults(label: string, results: EvalResult[]): void {
  const meanReciprocalRank =
    results.reduce((sum, result) => sum + result.rr, 0) / Math.max(results.length, 1);
  const hitAt3 = results.filter((result) => result.hitAt3).length / Math.max(results.length, 1);
  const cleanTop1 = results.filter((result) => result.cleanTop1).length / Math.max(results.length, 1);

  console.log(`\n${label}`);
  for (const result of results) {
    console.log(
      `- ${result.name}: RR=${result.rr.toFixed(2)} hit@3=${result.hitAt3 ? "yes" : "no"} clean-top1=${result.cleanTop1 ? "yes" : "no"}`,
    );
    console.log(`  top1: ${result.top1}`);
  }
  console.log(
    `Aggregate: MRR=${meanReciprocalRank.toFixed(2)} hit@3=${(hitAt3 * 100).toFixed(0)}% clean-top1=${(cleanTop1 * 100).toFixed(0)}%`,
  );

  if (meanReciprocalRank < 0.75 || hitAt3 < 1 || cleanTop1 < 0.83) {
    throw new Error(
      `${label} retrieval quality is below target (expected MRR >= 0.75, hit@3 = 100%, clean-top1 >= 83%).`,
    );
  }
}

async function callToolText(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed: ${(result.content?.[0] as { text?: string } | undefined)?.text || "unknown error"}`);
  }
  return (result.content?.[0] as { text?: string } | undefined)?.text || "";
}

function extractMemoryId(text: string): string | null {
  const match = text.match(/ID:\s*([^\s)]+)/);
  return match ? match[1] || null : null;
}

async function queryViaMcp(
  client: Client,
  name: "vx_query" | "vx_recall",
  args: Record<string, unknown>,
): Promise<QueryResponse> {
  const text = await callToolText(client, name, args);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const memories = lines
    .filter((line) => /^\[\d+\]/.test(line))
    .map((line, index) => ({
      id: `${name}-${index}`,
      content: line.replace(/^\[\d+\]\s*/, ""),
      context: "",
      memoryType: "SEMANTIC",
    }));
  return { memories, total: memories.length };
}

async function main(): Promise<void> {
  await ensureBuilt();
  await ensureApiReachable(VX_API_BASE_URL);
  const { apiKey } = await registerLocalUser(VX_API_BASE_URL);
  const runId = `cp-${Date.now()}`;

  const sdk = createVxClient({
    apiBaseUrl: VX_API_BASE_URL,
    apiKey,
    source: "vx-client",
  });

  const orbit: CounterpartyIdentity = { id: "orbit", kind: "agent", client: "vx-client" };
  const atlas: CounterpartyIdentity = { id: "atlas", kind: "agent", client: "vx-client" };
  const sam: CounterpartyIdentity = { id: "sam", kind: "user", client: "vx-client" };
  const planner: CounterpartyIdentity = { id: "planner", kind: "bot", client: "vx-client" };
  const nova: CounterpartyIdentity = { id: "nova", kind: "subagent", client: "vx-client" };

  await sdk.createMemoriesBatch([
    {
      content: `${runId} Maya prefers concise infrastructure updates overall.`,
      context: "identity/preferences",
      memoryType: "SEMANTIC",
    },
    {
      content: `${runId} With orbit, Maya was planning a PostgreSQL logical replication cutover for VX.`,
      memoryType: "SEMANTIC",
      counterparty: orbit,
    },
    {
      content: `${runId} Orbit should keep infra follow-ups concise and operational.`,
      memoryType: "SEMANTIC",
      counterparty: orbit,
    },
    {
      content: `${runId} Orbit previously debugged Redis connection spikes during deploys.`,
      memoryType: "EPISODIC",
      counterparty: orbit,
    },
    {
      content: `${runId} With atlas, Maya was assembling a narrated dental lecture on the pregnant patient.`,
      memoryType: "SEMANTIC",
      counterparty: atlas,
    },
    {
      content: `${runId} Atlas should explain clinical material step by step with more detail.`,
      memoryType: "SEMANTIC",
      counterparty: atlas,
    },
    {
      content: `${runId} Atlas was formatting quiz questions for the lecture package.`,
      memoryType: "PROCEDURAL",
      counterparty: atlas,
    },
    {
      content: `${runId} Sam from product asked for a Friday demo focused on onboarding metrics.`,
      memoryType: "SEMANTIC",
      counterparty: sam,
    },
    {
      content: `${runId} Sam prefers visual summaries over raw logs.`,
      memoryType: "SEMANTIC",
      counterparty: sam,
    },
    {
      content: `${runId} The planner bot owns recurring sprint checklist reminders.`,
      memoryType: "PROCEDURAL",
      counterparty: planner,
    },
    {
      content: `${runId} Research subagent nova gathered papers about memory decay curves.`,
      memoryType: "EPISODIC",
      counterparty: nova,
    },
  ]);

  const sdkOrbit = await sdk.queryMemories({
    query: "where did we leave the database switchover?",
    counterparty: orbit,
    limit: 5,
  });
  const sdkAtlas = await sdk.queryMemories({
    query: "continue the lecture and quiz work",
    counterparty: atlas,
    limit: 5,
  });
  const sdkSam = await sdk.queryMemories({
    query: "what does Sam want for the demo?",
    counterparty: sam,
    limit: 5,
  });

  const apiQueryRes = await fetch(`${VX_API_BASE_URL}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      query: "how should I phrase infra follow-ups?",
      limit: 5,
      space: {
        digital: [{ platform: "agent", context: "orbit", app: "vx-client" }],
      },
    }),
  });
  if (!apiQueryRes.ok) {
    throw new Error(`Direct API query failed: ${apiQueryRes.status} ${await apiQueryRes.text()}`);
  }
  const apiQueryJson = await apiQueryRes.json();
  const apiOrbit: QueryResponse = apiQueryJson.data;

  const sdkEval = [
    evaluateCase({
      name: "SDK orbit switchover",
      memories: sdkOrbit.memories,
      expected: [`${runId} With orbit, Maya was planning a PostgreSQL logical replication cutover for VX.`],
      forbiddenTop1: ["atlas", "Sam"],
    }),
    evaluateCase({
      name: "SDK atlas lecture",
      memories: sdkAtlas.memories,
      expected: [
        `${runId} With atlas, Maya was assembling a narrated dental lecture on the pregnant patient.`,
        `${runId} Atlas was formatting quiz questions for the lecture package.`,
      ],
      forbiddenTop1: ["orbit", "Sam"],
    }),
    evaluateCase({
      name: "SDK Sam demo",
      memories: sdkSam.memories,
      expected: [`${runId} Sam from product asked for a Friday demo focused on onboarding metrics.`],
      forbiddenTop1: ["orbit", "atlas"],
    }),
    evaluateCase({
      name: "Direct API orbit tone",
      memories: apiOrbit.memories,
      expected: [`${runId} Orbit should keep infra follow-ups concise and operational.`],
      forbiddenTop1: ["atlas", "Sam"],
    }),
  ];
  printEvalResults("SDK + API counterparty retrieval", sdkEval);

  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(process.cwd(), "dist", "index.js")],
    env: {
      ...process.env,
      VX_API_BASE_URL,
      VX_API_KEY: apiKey,
      VX_SOURCE: "vx-client",
    },
  });
  const mcp = new Client({ name: "vx-counterparty-e2e", version: "0.1.0" }, { capabilities: {} });
  await mcp.connect(transport);

  const mcpStoreText = await callToolText(mcp, "vx_store", {
    content: `${runId} Orbit suggested staggering the deployment until after lunch to reduce risk.`,
    memoryType: "SEMANTIC",
    counterpartyId: "orbit",
    counterpartyKind: "agent",
    counterpartyClient: "vx-client",
  });
  const mcpStoreId = extractMemoryId(mcpStoreText);
  if (!mcpStoreId) {
    throw new Error(`vx_store did not return a memory ID: ${mcpStoreText}`);
  }

  const memoryRes = await fetch(`${VX_API_BASE_URL}/memories/${encodeURIComponent(mcpStoreId)}`, {
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
  });
  if (!memoryRes.ok) {
    throw new Error(`Stored MCP memory lookup failed: ${memoryRes.status} ${await memoryRes.text()}`);
  }
  const memoryJson = await memoryRes.json();
  const storedContent = memoryJson?.data?.content as string | undefined;
  const storedCounterpartyId = memoryJson?.data?.metadata?.counterpartyId as string | undefined;
  if (storedContent !== `${runId} Orbit suggested staggering the deployment until after lunch to reduce risk.`) {
    throw new Error("MCP write lookup returned unexpected content.");
  }
  if (storedCounterpartyId !== "orbit") {
    throw new Error("MCP write lookup did not preserve counterparty identity.");
  }
  console.log("\nMCP write path validated by direct memory lookup.");

  const mcpAtlas = await queryViaMcp(mcp, "vx_recall", {
    query: "continue the clinical package",
    limit: 5,
    counterpartyId: "atlas",
    counterpartyKind: "agent",
    counterpartyClient: "vx-client",
  });

  const mcpEval = [
    evaluateCase({
      name: "MCP atlas clinical package",
      memories: mcpAtlas.memories,
      expected: [
        `${runId} With atlas, Maya was assembling a narrated dental lecture on the pregnant patient.`,
        `${runId} Atlas was formatting quiz questions for the lecture package.`,
      ],
      forbiddenTop1: ["orbit", "Sam"],
    }),
  ];
  printEvalResults("MCP counterparty retrieval", mcpEval);

  await transport.close();
  console.log("\nCounterparty continuity test passed.");
}

main().catch((error) => {
  console.error("Counterparty continuity test failed:", error);
  process.exit(1);
});
