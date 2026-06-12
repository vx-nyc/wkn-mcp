/**
 * Canonical defaults for the v1 installer.
 *
 * v1 of vx-mcp is HTTP-transport only. The package no longer ships a local
 * MCP server; clients connect directly to the hosted VX endpoint and
 * complete an OAuth flow on first use. There is no static credential and no
 * env-var auth. `VX_MCP_URL` is only a development/test endpoint override so
 * local stacks can run the same installer and readiness checks before release.
 */
export const VX_MCP_URL = process.env.VX_MCP_URL || "https://api.onememory.co/mcp";
export const VX_MCP_SERVER_NAME = "vx";
export const VX_PACKAGE_NAME = "@vx-nyc/vx-mcp";
export const HERMES_OAUTH_REDIRECT_PORT = 8989;
