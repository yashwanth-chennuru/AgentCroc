#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";

async function main() {
  // Validate config early so misconfig fails fast with a clear error on stderr.
  const config = loadConfig();

  const server = new McpServer({
    name: "agentcroc",
    version: "0.2.1",
  });

  registerTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
