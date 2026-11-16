import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";
import { apiTokenClients } from "./workspaces.ts";

/**
 * Entry point for the Runa MCP server over stdio. Reads configuration from
 * the environment and boots. Per the Omni startup-warning convention the
 * server never crashes for a missing token: it warns on stderr and every tool
 * returns a clear error until the credential is set.
 */
const main = async (): Promise<void> => {
  const config = loadConfig();

  if (!config.apiToken) {
    console.warn(
      "RUNA_API_TOKEN not set, Runa tools will return an error until it is configured",
    );
  }

  const server = createServer(apiTokenClients(config));
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log readiness to stderr; stdout is reserved for the MCP protocol channel
  console.error(`runa-mcp ready (api: ${config.apiUrl})`);
};

main().catch((error) => {
  console.error("runa-mcp failed to start:", error);
  process.exit(1);
});
