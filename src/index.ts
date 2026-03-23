#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { handleCli } from "./installer.js";
import { createMcpServer } from "./mcp.js";
import {
  assertVxCredentials,
  createConfiguredVxClient,
  resolveVxConfig,
} from "./runtime.js";

// Fail fast with a clear message if the MCP host launched us with Node < 18
const cliArgs = process.argv.slice(2);
try {
  if (await handleCli(cliArgs)) {
    process.exit(0);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const nodeMajor = parseInt(process.version.slice(1).split(".")[0], 10);
if (nodeMajor < 18) {
  console.error(
    `[vx-mcp] Requires Node.js 18 or later. You have ${process.version}. ` +
      "Set your default Node to 18+ (e.g. `nvm alias default 22` or `nvm use 22`) and restart your MCP host, or use the direct Node path in your MCP config. " +
      "See: https://github.com/vx-nyc/vx-mcp#troubleshooting"
  );
  process.exit(1);
}

// =============================================================================
// Configuration
// =============================================================================

const config = resolveVxConfig();

try {
  assertVxCredentials(config);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const server = createMcpServer({
  config,
  client: createConfiguredVxClient(config),
});

function createHttpModeServer() {
  return createMcpServer({
    config,
    client: createConfiguredVxClient(config),
  });
}

// =============================================================================
// Main
// =============================================================================

const MCP_TRANSPORT = process.env.VX_MCP_TRANSPORT ?? "stdio";
const MCP_HTTP_PORT = parseInt(process.env.VX_MCP_HTTP_PORT ?? "3100", 10);
const MCP_HTTP_HOST = process.env.VX_MCP_HTTP_HOST ?? "127.0.0.1";
const MCP_HTTPS = process.env.VX_MCP_HTTPS === "1" || process.env.VX_MCP_HTTPS === "true";
const MCP_HTTPS_KEY_PATH = process.env.VX_MCP_HTTPS_KEY_PATH;
const MCP_HTTPS_CERT_PATH = process.env.VX_MCP_HTTPS_CERT_PATH;
const MCP_OAUTH_CLIENT_ID = process.env.VX_MCP_OAUTH_CLIENT_ID;
const MCP_OAUTH_CLIENT_SECRET = process.env.VX_MCP_OAUTH_CLIENT_SECRET;

function sendUnauthorized(res: import("node:http").ServerResponse) {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": "Bearer",
  }).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    })
  );
}

function checkHttpAuth(req: import("node:http").IncomingMessage): boolean {
  if (!MCP_OAUTH_CLIENT_ID || !MCP_OAUTH_CLIENT_SECRET) return true;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const [id, secret] = decoded.split(":", 2);
    if (id === MCP_OAUTH_CLIENT_ID && secret === MCP_OAUTH_CLIENT_SECRET) return true;
  }
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === MCP_OAUTH_CLIENT_SECRET) return true;
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      const [id, secret] = decoded.split(":", 2);
      if (id === MCP_OAUTH_CLIENT_ID && secret === MCP_OAUTH_CLIENT_SECRET) return true;
    } catch {
      /* ignore */
    }
  }
  const idHeader = req.headers["x-oauth-client-id"];
  const secretHeader = req.headers["x-oauth-client-secret"];
  if (
    typeof idHeader === "string" &&
    typeof secretHeader === "string" &&
    idHeader === MCP_OAUTH_CLIENT_ID &&
    secretHeader === MCP_OAUTH_CLIENT_SECRET
  )
    return true;
  return false;
}

async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHttp() {
  const requestHandler = async (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    parsedBody: unknown
  ) => {
    if (req.method !== "POST" && req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method Not Allowed" },
          id: null,
        })
      );
      return;
    }

    if (!checkHttpAuth(req)) {
      sendUnauthorized(res);
      return;
    }

    let body = parsedBody;
    if (body === undefined && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          })
        );
        return;
      }
    }

    try {
      const mcpServer = createHttpModeServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      res.on("close", () => {
        transport.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
    } catch (err) {
      console.error("HTTP MCP error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: null,
          })
        );
      }
    }
  };

  const createHandler = () => {
    return (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
      let parsedBody: unknown = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            parsedBody = raw ? JSON.parse(raw) : undefined;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error" },
                id: null,
              })
            );
            return;
          }
          void requestHandler(req, res, parsedBody);
        });
      } else {
        void requestHandler(req, res, parsedBody);
      }
    };
  };

  const handler = createHandler();

  if (MCP_HTTPS && MCP_HTTPS_KEY_PATH && MCP_HTTPS_CERT_PATH) {
    const key = readFileSync(MCP_HTTPS_KEY_PATH);
    const cert = readFileSync(MCP_HTTPS_CERT_PATH);
    const httpsServer = createHttpsServer({ key, cert }, (req, res) => handler(req, res));
    httpsServer.listen(MCP_HTTP_PORT, MCP_HTTP_HOST, () => {
      const displayHost = MCP_HTTP_HOST === "0.0.0.0" ? "0.0.0.0 (all interfaces)" : MCP_HTTP_HOST;
      console.error(`VX MCP Server running on https://${displayHost}:${MCP_HTTP_PORT}/`);
      console.error("Connect at: https://localhost:3100");
      if (MCP_OAUTH_CLIENT_ID && MCP_OAUTH_CLIENT_SECRET) {
        console.error(`OAuth Client ID: ${MCP_OAUTH_CLIENT_ID} | OAuth Client Secret: (use the value you set)`);
      }
    });
  } else {
    const httpServer = createHttpServer(async (req, res) => {
      if (req.method !== "POST" && req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method Not Allowed" },
            id: null,
          })
        );
        return;
      }

      if (!checkHttpAuth(req)) {
        sendUnauthorized(res);
        return;
      }

      let parsedBody: unknown = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          parsedBody = raw ? JSON.parse(raw) : undefined;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32700, message: "Parse error" },
              id: null,
            })
          );
          return;
        }
      }

      try {
        const mcpServer = createHttpModeServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
        res.on("close", () => {
          transport.close().catch(() => {});
          mcpServer.close().catch(() => {});
        });
      } catch (err) {
        console.error("HTTP MCP error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal error" },
              id: null,
            })
          );
        }
      }
    });

    httpServer.listen(MCP_HTTP_PORT, MCP_HTTP_HOST, () => {
      const displayHost = MCP_HTTP_HOST === "0.0.0.0" ? "0.0.0.0 (all interfaces)" : MCP_HTTP_HOST;
      console.error(`VX MCP Server running on http://${displayHost}:${MCP_HTTP_PORT}/`);
    });
  }
}

async function main() {
  if (MCP_TRANSPORT === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
