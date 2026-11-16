import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import packageJson from "../package.json" with { type: "json" };
import { registerTools } from "./tools.ts";

import type { ClientProvider } from "./workspaces.ts";

/** Package version, read from package.json so releases stay in sync */
const VERSION = packageJson.version;

/** Build a fully configured MCP server with every Runa tool registered */
export const createServer = (clients: ClientProvider): McpServer => {
  const server = new McpServer({ name: "runa-mcp", version: VERSION });
  registerTools(server, clients);
  return server;
};
