import { afterEach, describe, expect, it, vi } from "vitest";
import { createVxClient } from "../src/sdk/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function getRequestBody(fetchMock: ReturnType<typeof vi.fn>, path: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(path));
  if (!call) {
    throw new Error(`Expected fetch call for ${path}`);
  }

  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sdk source defaults", () => {
  it("adds configured source to counterparty queries", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return jsonResponse({ status: "ok" });
      }
      if (url.endsWith("/query")) {
        return jsonResponse({ data: { memories: [], total: 0 } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createVxClient({
      apiBaseUrl: "http://localhost:3000/v1",
      apiKey: "test-api-key",
      source: "codex",
    });

    await client.queryMemories({
      query: "continue the infra handoff",
      counterparty: { id: "orbit", kind: "agent", client: "vx-client" },
    });

    expect(getRequestBody(fetchMock, "/query")).toMatchObject({
      query: "continue the infra handoff",
      source: "codex",
      space: {
        digital: [
          {
            platform: "agent",
            context: "orbit",
            app: "vx-client",
          },
        ],
      },
    });
  });

  it("keeps an explicit source override on counterparty queries", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return jsonResponse({ status: "ok" });
      }
      if (url.endsWith("/query")) {
        return jsonResponse({ data: { memories: [], total: 0 } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createVxClient({
      apiBaseUrl: "http://localhost:3000/v1",
      apiKey: "test-api-key",
      source: "codex",
    });

    await client.queryMemories({
      query: "continue the infra handoff",
      source: "openclaw",
      counterparty: { id: "orbit", kind: "agent", client: "vx-client" },
    });

    expect(getRequestBody(fetchMock, "/query")).toMatchObject({
      source: "openclaw",
    });
  });

  it("adds configured source to counterparty stores", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return jsonResponse({ status: "ok" });
      }
      if (url.endsWith("/memories")) {
        return jsonResponse({
          data: {
            id: "mem-1",
            content: "stored",
            memoryType: "SEMANTIC",
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createVxClient({
      apiBaseUrl: "http://localhost:3000/v1",
      apiKey: "test-api-key",
      source: "codex",
    });

    await client.createMemory({
      content: "Orbit prefers concise infra updates.",
      counterparty: { id: "orbit", kind: "agent", client: "vx-client" },
    });

    expect(getRequestBody(fetchMock, "/memories")).toMatchObject({
      source: "codex",
      context: "counterparty/agent/orbit",
      metadata: {
        counterpartyId: "orbit",
        counterpartyKind: "agent",
        counterpartyClient: "vx-client",
      },
      spaceContext: {
        digital: [
          {
            platform: "agent",
            context: "orbit",
            app: "vx-client",
          },
        ],
      },
    });
  });
});
