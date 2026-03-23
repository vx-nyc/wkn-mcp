/**
 * Basic programmatic VX usage with the client helpers exported by vx-mcp.
 *
 * Run with:
 *   npx tsx examples/basic-usage.ts
 *
 * Required env:
 *   VX_API_BASE_URL
 *   VX_API_KEY or VX_BEARER_TOKEN
 */

import { createClientFromEnv } from "../src/client.js";

async function main() {
  const client = createClientFromEnv();

  const health = await client.healthCheck();
  console.log(`API reachable: ${health.ok} (${health.latency}ms)`);

  const stored = await client.store({
    content: "Example memory: user prefers TypeScript over JavaScript.",
    context: "examples/preferences",
    memoryType: "SEMANTIC",
    importance: 0.8,
  });
  console.log("Stored memory:", stored.id);

  const query = await client.query({
    query: "What language does the user prefer?",
    context: "examples/preferences",
    limit: 3,
  });
  console.log("Query results:", query.memories.map((memory) => memory.content));

  await client.delete(stored.id);
  console.log("Deleted memory:", stored.id);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
