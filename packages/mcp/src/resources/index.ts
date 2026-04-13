import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Hipp0Client } from '../../../sdk/src/index.js';
import type { Hipp0ServerConfig } from '../server.js';

export function registerResources(
  server: McpServer,
  client: Hipp0Client,
  config: Hipp0ServerConfig,
): void {
  server.registerResource(
    'hipp0-decisions',
    'hipp0://decisions',
    {
      description: 'All active decisions for the current project in readable list format.',
      mimeType: 'text/plain',
    },
    async (_uri) => {
      const decisions = await client.listDecisions(config.projectId, {
        status: 'active',
        limit: 200,
      });

      const lines = decisions.map(
        (d, i) =>
          `${i + 1}. [${d.id}] ${d.title}\n   Status: ${d.status} | Confidence: ${d.confidence}\n   Tags: ${d.tags.join(', ') || 'none'}\n   Made by: ${d.made_by} | ${d.created_at.slice(0, 10)}\n   ${d.description}`,
      );

      return {
        contents: [
          {
            uri: 'hipp0://decisions',
            mimeType: 'text/plain',
            text:
              lines.length > 0
                ? `# Active Decisions (${decisions.length})\n\n${lines.join('\n\n')}`
                : '# Active Decisions\n\nNo active decisions found.',
          },
        ],
      };
    },
  );

  server.registerResource(
    'hipp0-decision-detail',
    new ResourceTemplate('hipp0://decisions/{id}', { list: undefined }),
    {
      description: 'Full detail for a single decision by ID.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = variables['id'] as string;
      const decision = await client.getDecision(id);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(decision, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'hipp0-decision-graph',
    new ResourceTemplate('hipp0://decisions/{id}/graph', { list: undefined }),
    {
      description: 'Decision graph rooted at the given decision ID (depth 2).',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = variables['id'] as string;
      const graph = await client.getGraph(id, 2);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(graph, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'hipp0-contradictions',
    'hipp0://contradictions',
    {
      description: 'All unresolved contradictions detected between project decisions.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const contradictions = await client.getContradictions(config.projectId, 'unresolved');

      return {
        contents: [
          {
            uri: 'hipp0://contradictions',
            mimeType: 'application/json',
            text: JSON.stringify(contradictions, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'hipp0-sessions',
    'hipp0://sessions',
    {
      description: 'Recent session summaries for the current project.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const sessions = await client.listSessions(config.projectId);

      return {
        contents: [
          {
            uri: 'hipp0://sessions',
            mimeType: 'application/json',
            text: JSON.stringify(sessions, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'hipp0-agents',
    'hipp0://agents',
    {
      description: 'All agents registered for the current project.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const agents = await client.listAgents(config.projectId);

      return {
        contents: [
          {
            uri: 'hipp0://agents',
            mimeType: 'application/json',
            text: JSON.stringify(agents, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'hipp0-project-status',
    'hipp0://project/status',
    {
      description:
        'Project health overview — decision counts, contradiction count, agent activity.',
      mimeType: 'text/plain',
    },
    async (_uri) => {
      const [stats, project] = await Promise.all([
        client.getProjectStats(config.projectId),
        client.getProject(config.projectId),
      ]);

      const recentActivity = stats.recent_activity
        .slice(0, 10)
        .map((e) => `  - ${e.event_type} at ${e.created_at.slice(0, 16)}`)
        .join('\n');

      const text = [
        `# Project: ${project.name}`,
        `ID: ${config.projectId}`,
        project.description ? `Description: ${project.description}` : '',
        '',
        '## Decision Health',
        `  Active:      ${stats.active_decisions}`,
        `  Pending:     ${stats.pending_decisions}`,
        `  Superseded:  ${stats.superseded_decisions}`,
        `  Total:       ${stats.total_decisions}`,
        `  Edges:       ${stats.total_edges}`,
        '',
        '## Agents & Sessions',
        `  Agents:      ${stats.total_agents}`,
        `  Sessions:    ${stats.total_sessions}`,
        `  Artifacts:   ${stats.total_artifacts}`,
        '',
        '## Issues',
        `  Unresolved contradictions: ${stats.unresolved_contradictions}`,
        '',
        '## Recent Activity',
        recentActivity || '  No recent activity.',
      ]
        .filter((l) => l !== undefined)
        .join('\n');

      return {
        contents: [
          {
            uri: 'hipp0://project/status',
            mimeType: 'text/plain',
            text,
          },
        ],
      };
    },
  );
}
