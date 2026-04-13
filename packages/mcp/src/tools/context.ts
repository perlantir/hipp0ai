import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Hipp0Client } from '../../../sdk/src/index.js';
import type { Hipp0ServerConfig } from '../server.js';
import type { ContextPackage as CoreContextPackage } from '../../../core/src/types.js';
import { condenseCompileResponse, computeWingSources } from '@hipp0/core';

export function registerContextTools(
  server: McpServer,
  client: Hipp0Client,
  config: Hipp0ServerConfig,
): void {
  server.registerTool(
    'hipp0_compile_context',
    {
      title: 'Compile context for a task',
      description:
        'Compiles a ranked, token-budgeted context package of decisions, artifacts, and notifications relevant to the current task. Call this at the start of every significant task. Use format="condensed" for 10-15x smaller output.',
      inputSchema: {
        agent_name: z.string().min(1).describe('Name of the agent requesting context.'),
        task_description: z
          .string()
          .min(1)
          .describe('Description of the current task to compile context for.'),
        max_tokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum token budget for the compiled context. Defaults to agent budget.'),
        format: z
          .enum(['full', 'condensed', 'both'])
          .optional()
          .describe('Response format: "full" (default), "condensed" (Hipp0Condensed shorthand, ~10x smaller), or "both".'),
        namespace: z
          .string()
          .optional()
          .describe('Filter decisions by namespace. Comma-separated for multiple. Global (null namespace) decisions always included.'),
      },
    },
    async (args) => {
      const pkg = await client.compileContext({
        agent_name: args.agent_name,
        project_id: config.projectId,
        task_description: args.task_description,
        max_tokens: args.max_tokens,
        namespace: args.namespace,
      });

      const format = args.format ?? 'full';

      // Condensed: return compact Hipp0Condensed string directly
      // Cast SDK ContextPackage → core ContextPackage (structurally identical at runtime)
      if (format === 'condensed') {
        const condensed = condenseCompileResponse({ contextPackage: pkg as unknown as CoreContextPackage });
        return {
          content: [
            {
              type: 'text' as const,
              text: condensed.condensed_context,
            },
          ],
        };
      }

      // Both: return full + condensed
      if (format === 'both') {
        const condensed = condenseCompileResponse({ contextPackage: pkg as unknown as CoreContextPackage });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  formatted_markdown: pkg.formatted_markdown,
                  condensed_context: condensed.condensed_context,
                  compression_metrics: {
                    original_tokens: condensed.original_tokens,
                    compressed_tokens: condensed.compressed_tokens,
                    compression_ratio: condensed.compression_ratio,
                    format_version: condensed.format_version,
                  },
                  stats: {
                    token_count: pkg.token_count,
                    budget_used_pct: pkg.budget_used_pct,
                    decisions_considered: pkg.decisions_considered,
                    decisions_included: pkg.decisions_included,
                    compilation_time_ms: pkg.compilation_time_ms,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Compute wing sources from decisions
      const decisions = (pkg as unknown as CoreContextPackage).decisions ?? [];
      const wing_sources = (pkg as unknown as { wing_sources?: Record<string, number> }).wing_sources ??
        computeWingSources(decisions, args.agent_name);

      // Full (default)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                formatted_markdown: pkg.formatted_markdown,
                wing_sources,
                stats: {
                  token_count: pkg.token_count,
                  budget_used_pct: pkg.budget_used_pct,
                  decisions_considered: pkg.decisions_considered,
                  decisions_included: pkg.decisions_included,
                  compilation_time_ms: pkg.compilation_time_ms,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

    // hipp0_my_wing_summary — agent's own wing stats
  server.registerTool(
    'hipp0_my_wing_summary',
    {
      title: 'Get wing summary for an agent',
      description:
        'Returns the requesting agent\'s wing stats: decision count, top domains, cross-wing affinity, and connections. Use this to understand which other agents\' decisions are most useful to you.',
      inputSchema: {
        agent_name: z.string().min(1).describe('Name of the agent to get wing stats for.'),
      },
    },
    async (args) => {
      try {
        const apiBase = (config as unknown as Record<string, string>).apiUrl ?? 'http://localhost:3100';
        const response = await fetch(
          `${apiBase}/api/agents/${encodeURIComponent(args.agent_name)}/wing?project_id=${config.projectId}`,
        );
        if (!response.ok) {
          return {
            content: [{ type: 'text' as const, text: `Failed to get wing stats: ${response.statusText}` }],
            isError: true,
          };
        }
        const data = await response.json();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error fetching wing stats: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
