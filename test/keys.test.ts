import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleKeysCli } from "../src/keys.js";

describe("handleKeysCli", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    consoleSpy.mockClear();
  });

  it("generates a device keypair and uploads the public key when credentials are present", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "vx-mcp-keys-"));
    const createClient = vi.fn(() => ({
      getMemoryKeyInfo: vi.fn(async () => ({ hasKey: false })),
      setMemoryPublicKey: vi.fn(async () => ({
        algorithm: "rsa-oaep-sha256",
        fingerprint: "uploaded-fingerprint",
      })),
    }));

    const handled = await handleKeysCli(
      ["generate", "--out-dir", outDir],
      {
        env: {
          VX_API_BASE_URL: "https://api.vx.dev/v1",
          VX_API_KEY: "test-key",
        },
        createClient: createClient as never,
      }
    );

    expect(handled).toBe(true);
    expect(existsSync(join(outDir, "memory-private.pem"))).toBe(true);
    expect(existsSync(join(outDir, "memory-public.pem"))).toBe(true);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing keypair and skips upload when credentials are missing", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "vx-mcp-keys-"));
    const publicKeyPath = join(outDir, "memory-public.pem");

    vi.mocked(console.log).mockClear();

    await handleKeysCli(
      ["generate", "--out-dir", outDir, "--skip-upload"],
      { env: {} }
    );

    const firstPublicKey = readFileSync(publicKeyPath, "utf8");

    const createClient = vi.fn();
    await handleKeysCli(
      ["generate", "--out-dir", outDir],
      {
        env: {},
        createClient: createClient as never,
      }
    );

    expect(readFileSync(publicKeyPath, "utf8")).toBe(firstPublicKey);
    expect(createClient).not.toHaveBeenCalled();
    expect(consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "Reused the existing device memory keypair"
    );
  });
});
