import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCursorDeeplink, getInstallEnv, getPackagedLauncher } from "../src/installer.js";

describe("README smoke checks", () => {
  it("documents the primary install flows and shipped assets", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

    expect(readme).toContain("npx vx-mcp-server install claude");
    expect(readme).toContain("npx vx-mcp-server install codex");
    expect(readme).toContain("### Cursor");
    expect(readme).toContain("openclaw plugins install vx-mcp-server");
    expect(readme).toContain("\"args\": [\"-y\", \"vx-mcp-server@latest\", \"mcp\"]");
    expect(readme).toContain("VX_API_BASE_URL");
    expect(readme).toContain("VX_NAME");
    expect(readme).toContain("VX_SOURCE");
    expect(readme).toContain("claude-code");
    expect(readme).toContain("claude-desktop");
    expect(readme).toContain("vx_memory_workflow");
    expect(readme).toContain("vx_memory_import");
    expect(readme).toContain("vx_status");

    for (const toolName of [
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
    ]) {
      expect(readme).toContain(toolName);
    }

    expect(existsSync(join(process.cwd(), ".claude-plugin/plugin.json"))).toBe(true);
    expect(existsSync(join(process.cwd(), "openclaw.plugin.json"))).toBe(true);
    expect(existsSync(join(process.cwd(), "skills/claude/vx-memory/vx-memory.md"))).toBe(
      true
    );
    expect(existsSync(join(process.cwd(), "skills/codex/vx-memory/SKILL.md"))).toBe(true);
    expect(existsSync(join(process.cwd(), "skills/openclaw/vx-memory/SKILL.md"))).toBe(
      true
    );
  });

  it("includes a Cursor one-click deeplink with the expected packaged config", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const match = readme.match(
      /\[!\[Add to Cursor\]\([^)]+\)\]\((cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=[^)]+)\)/
    );
    const parsed = new URL(match?.[1] ?? "");
    const encodedConfig = parsed.searchParams.get("config");

    expect(parsed.protocol).toBe("cursor:");
    expect(parsed.hostname).toBe("anysphere.cursor-deeplink");
    expect(parsed.pathname).toBe("/mcp/install");
    expect(parsed.searchParams.get("name")).toBe("vx");
    expect(encodedConfig).toBeTruthy();

    const actualConfig = JSON.parse(
      Buffer.from(encodedConfig!, "base64").toString("utf8")
    );
    const expectedDeeplink = buildCursorDeeplink(
      "vx",
      getPackagedLauncher(),
      getInstallEnv("cursor", {
        VX_API_BASE_URL: "https://api.vx.dev/v1",
        VX_API_KEY: "your-api-key",
        VX_NAME: "VX",
      })
    );
    const expectedConfig = JSON.parse(
      Buffer.from(new URL(expectedDeeplink).searchParams.get("config")!, "base64").toString(
        "utf8"
      )
    );

    expect(actualConfig).toEqual(expectedConfig);
  });
});
