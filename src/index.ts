#!/usr/bin/env node

/**
 * vx-mcp v1 entrypoint.
 *
 * v1 is HTTP-transport only. This binary is purely an installer for Claude
 * Code, Cursor, Codex, OpenClaw, Hermes, Claude Desktop, Windsurf, Cline, Zed,
 * and VS Code (+ GitHub Copilot Chat) — it writes the right config so those
 * clients connect to the hosted VX MCP endpoint and complete the OAuth flow
 * on first use. There is no local server, no static credential, and no
 * env-var auth in this package any more.
 */
import { handleCli } from "./installer.js";

const argv = process.argv.slice(2);

(async () => {
  try {
    await handleCli(argv);
    process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
