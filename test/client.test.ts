import { afterEach, describe, expect, it, vi } from "vitest";
import { VXClient, createClientFromEnv, detectSource } from "../src/client.js";
import { VXError } from "../src/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client helpers", () => {
  it("detects host source from env and cwd", () => {
    expect(detectSource({ CURSOR_SESSION_ID: "1" } as NodeJS.ProcessEnv, "/tmp/project")).toBe("cursor");
    expect(detectSource({} as NodeJS.ProcessEnv, "/tmp/Codex/project")).toBe("codex");
    expect(detectSource({ CLAUDE_DESKTOP: "1" } as NodeJS.ProcessEnv, "/tmp/project")).toBe("claude-desktop");
  });

  it("creates a client from environment variables", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: "mem_1",
            content: "hello",
            context: "prefs",
            memoryType: "SEMANTIC",
          },
        }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createClientFromEnv({
      VX_API_BASE_URL: "https://api.example.test/v1",
      VX_API_KEY: "test-key",
      VX_SOURCE: "codex",
    } as NodeJS.ProcessEnv, "/tmp/project");

    const stored = await client.store({ content: "hello", context: "prefs", importance: 0.7 });
    expect(stored.id).toBe("mem_1");

    const [, storeInit] = fetchMock.mock.calls[1]!;
    const body = JSON.parse(String(storeInit?.body));
    expect(body.metadata.importance).toBe(0.7);
    expect(body.source).toBe("codex");
  });

  it("maps singular query filters onto the SDK query shape", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            memories: [
              {
                id: "mem_2",
                content: "TypeScript preference",
                context: "prefs",
                memoryType: "SEMANTIC",
              },
            ],
            total: 1,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new VXClient({
      apiBaseUrl: "https://query.example.test/v1",
      apiKey: "test-key",
      source: "cursor",
    });
    const result = await client.query({
      query: "language preference",
      context: "prefs",
      memoryType: "SEMANTIC",
      limit: 3,
    });

    expect(result.total).toBe(1);
    const [, queryInit] = fetchMock.mock.calls[1]!;
    const body = JSON.parse(String(queryInit?.body));
    expect(body.contexts).toEqual(["prefs"]);
    expect(body.memoryTypes).toEqual(["SEMANTIC"]);
  });

  it("throws a validation error when credentials are missing", () => {
    expect(() => new VXClient({ apiBaseUrl: "https://api.example.test/v1" })).toThrow(VXError);
  });
});
