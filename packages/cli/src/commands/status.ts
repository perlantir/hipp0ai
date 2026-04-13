import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  getClient,
  getProjectId,
  handleError,
  formatStats,
  renderAsciiGraph,
} from '../cli-helpers.js';

export function registerStatusCommands(program: Command): void {
  program
    .command('status')
    .description('Show project stats overview')
    .action(async () => {
      const client = getClient();
      const projectId = getProjectId();
      const spinner = ora('Loading project status...').start();

      try {
        const [stats, project] = await Promise.all([
          client.getProjectStats(projectId),
          client.getProject(projectId),
        ]);
        spinner.stop();

        console.warn(`\n${chalk.bold.blue(`Project: ${project.name}`)}`);
        console.warn(`  ${chalk.dim('ID:')} ${chalk.cyan(project.id)}`);
        if (project.description) console.warn(`  ${chalk.dim('Desc:')} ${project.description}`);

        formatStats(stats);
      } catch (err) {
        handleError(err, spinner);
      }
    });

  program
    .command('graph')
    .description('Show full project decision graph as ASCII')
    .action(async () => {
      const client = getClient();
      const projectId = getProjectId();
      const spinner = ora('Loading project graph...').start();

      try {
        const graph = await client.getProjectGraph(projectId);
        spinner.stop();

        console.warn(
          chalk.bold(`\nProject Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`),
        );
        renderAsciiGraph(graph);
      } catch (err) {
        handleError(err, spinner);
      }
    });
}
