import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getClient, getProjectId, handleError, formatDecision } from '../cli-helpers.js';

export function registerDistillCommand(program: Command): void {
  program
    .command('distill <file>')
    .description('Extract decisions from a conversation file')
    .option('-a, --agent <name>', 'Agent name for attribution')
    .option('--session', 'Also create a session summary')
    .action(async (file: string, opts: { agent?: string; session?: boolean }) => {
      const client = getClient();
      const projectId = getProjectId();

      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }

      const conversationText = readFileSync(filePath, 'utf-8');
      if (!conversationText.trim()) {
        console.error(chalk.red('File is empty'));
        process.exit(1);
      }

      const spinner = ora(`Distilling decisions from ${chalk.bold(file)}...`).start();

      try {
        const result = opts.session
          ? await client.distillSession(projectId, {
              conversation_text: conversationText,
              agent_name: opts.agent ?? 'cli',
            })
          : await client.distill(projectId, {
              conversation_text: conversationText,
              agent_name: opts.agent,
            });

        spinner.succeed(chalk.green(`Extracted ${result.decisions_extracted} decision(s)`));

        if (result.decisions.length === 0) {
          console.warn(chalk.dim('  No decisions were found in the conversation.'));
          return;
        }

        result.decisions.forEach((d, i) => formatDecision(d, i));

        if (result.session_summary) {
          console.warn(`\n${chalk.bold('Session Summary Created:')}`);
          console.warn(`  ${chalk.dim('ID:')} ${chalk.cyan(result.session_summary.id)}`);
          console.warn(`  ${chalk.dim('Topic:')} ${result.session_summary.topic}`);
          console.warn(`  ${chalk.dim('Date:')} ${result.session_summary.session_date}`);
        }
      } catch (err) {
        handleError(err, spinner);
      }
    });
}
