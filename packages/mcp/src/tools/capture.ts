import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Hipp0Client } from '../../../sdk/src/index.js';
import type { Hipp0ServerConfig } from '../server.js';

export function registerCaptureTools(
  server: McpServer,
  client: Hipp0Client,
  config: Hipp0ServerConfig,
): void {
  server.registerTool(
    'hipp0_auto_capture',
    {
      title: 'Auto-capture decisions from conversation',
      description:
        'Analyzes conversation text and automatically extracts decisions, assumptions, and contradictions using the Hipp0 distillery pipeline.',
      inputSchema: {
        conversation_text: z
          .string()
          .min(1)
          .describe('The conversation text to analyze for extractable decisions.'),
        session_id: z
          .string()
          .optional()
          .describe('Optional session ID to associate extracted decisions with.'),
        agent_name: z
          .string()
          .optional()
          .describe('Agent name to attribute extracted decisions to.'),
      },
    },
    async (args) => {
      const result = await client.distill(config.projectId, {
        conversation_text: args.conversation_text,
        session_id: args.session_id,
        agent_name: args.agent_name,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                decisions_extracted: result.decisions_extracted,
                contradictions_found: result.contradictions_found,
                details: result.decisions.map((d) => ({
                  id: d.id,
                  title: d.title,
                  confidence: d.confidence,
                  tags: d.tags,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
