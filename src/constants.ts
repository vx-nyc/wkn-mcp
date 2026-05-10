/**
 * Canonical defaults for the v1 installer.
 *
 * v1 of vx-mcp is HTTP-transport only. The package no longer ships a local
 * MCP server; clients connect directly to the hosted VX endpoint and
 * complete an OAuth flow on first use. There is no static credential, no
 * env-var auth, and no `/v1` base URL suffix — clients point at `/mcp`.
 */
export const VX_MCP_URL = "https://api.onememory.co/mcp";
export const VX_MCP_SERVER_NAME = "vx";
export const VX_PACKAGE_NAME = "@vx-nyc/vx-mcp";
