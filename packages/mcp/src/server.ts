import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Hipp0Client } from '../../sdk/src/index.js';
import { registerAllTools } from './tools.js';

export interface Hipp0ServerConfig {
  apiUrl: string;
  apiKey?: string;
  projectId: string;
  agentId?: string;
}

export function createHipp0Server(config: Hipp0ServerConfig): McpServer {
  const client = new Hipp0Client({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  const server = new McpServer(
    {
      name: 'hipp0',
      version: '0.1.0',
    },
    {
      instructions:
        'Hipp0 decision-memory server. Use compile_context at the start of every task to load relevant decisions. Use add_decision to record choices. Use ask_decisions for natural language queries.',
    },
  );

  registerAllTools(server, client, { projectId: config.projectId, apiUrl: config.apiUrl });

  return server;
}

export { McpServer, StdioServerTransport };
