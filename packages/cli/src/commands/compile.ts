import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  getClient,
  getProjectId,
  handleError,
  formatDecision,
  formatNotification,
} from '../cli-helpers.js';

export function registerCompileCommand(program: Command): void {
  program
    .command('compile <agent> <task>')
    .description('Compile context for an agent and task')
    .option('-m, --max-tokens <n>', 'Max token budget', '50000')
    .option('--include-superseded', 'Include superseded decisions')
    .option('--markdown', 'Output as markdown (default: structured summary)')
    .action(
      async (
        agentName: string,
        task: string,
        opts: { maxTokens?: string; includeSuperseded?: boolean; markdown?: boolean },
      ) => {
        const client = getClient();
        const projectId = getProjectId();
        const spinner = ora(`Compiling context for ${chalk.bold(agentName)}...`).start();

        try {
          const pkg = await client.compileContext({
            agent_name: agentName,
            project_id: projectId,
            task_description: task,
            max_tokens: opts.maxTokens ? parseInt(opts.maxTokens, 10) : 50000,
            include_superseded: opts.includeSuperseded,
          });
          spinner.stop();

          if (opts.markdown) {
            console.warn(pkg.formatted_markdown);
            return;
          }

          console.warn(`\n${chalk.bold('Context Package')}`);
          console.warn(
            `  ${chalk.dim('Agent:')} ${pkg.agent.name} ${chalk.dim(`(${pkg.agent.role})`)}`,
          );
          console.warn(`  ${chalk.dim('Task:')} ${pkg.task}`);
          console.warn(`  ${chalk.dim('Compiled:')} ${new Date(pkg.compiled_at).toLocaleString()}`);
          console.warn(
            `  ${chalk.dim('Tokens:')} ${pkg.token_count.toLocaleString()} / ${chalk.dim(`${pkg.budget_used_pct}% of budget`)}`,
          );
          console.warn(
            `  ${chalk.dim('Decisions:')} ${pkg.decisions_included} included from ${pkg.decisions_considered} considered`,
          );
          console.warn(`  ${chalk.dim('Compiled in:')} ${pkg.compilation_time_ms}ms`);

          if (pkg.decisions.length) {
            console.warn(`\n${chalk.bold('Relevant Decisions:')}`);
            pkg.decisions.forEach((d, i) => formatDecision(d, i));
          }

          if (pkg.notifications.length) {
            console.warn(`\n${chalk.bold('Unread Notifications:')} (${pkg.notifications.length})`);
            pkg.notifications.forEach(formatNotification);
          }
        } catch (err) {
          handleError(err, spinner);
        }
      },
    );
}
