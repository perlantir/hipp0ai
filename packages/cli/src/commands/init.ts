import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Hipp0Client } from '@hipp0/sdk';
import { getClient, prompt, handleError } from '../cli-helpers.js';

const _require = createRequire(import.meta.url);

/**
 * Generate a Hipp0-style API key: "h0_local_" + 16 random characters.
 */
function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const { randomUUID } = crypto;
  // Use the UUID entropy but reformat as a shorter key.
  const uuid = randomUUID().replace(/-/g, '');
  // Take 16 hex chars and map them to the alphanumeric set.
  const raw = uuid.slice(0, 16);
  const mapped = raw
    .split('')
    .map((ch) => chars[parseInt(ch, 16) % chars.length])
    .join('');
  return `h0_local_${mapped}`;
}

/**
 * Spawn the Hipp0 server as a detached background process and write a PID
 * file so that `hipp0 stop` can terminate it later.
 */
function spawnServer(
  dir: string,
  sqlitePath: string,
  apiKey: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Locate the server entry-point relative to this CLI package.
    let serverEntry: string;
    try {
      // When installed via npm both packages land next to each other.
      serverEntry = _require.resolve('@hipp0/server');
    } catch {
      // Fallback for monorepo / development usage.
      serverEntry = path.resolve(
        path.dirname(_require.resolve('@hipp0/cli/package.json')),
        '..',
        'server',
        'dist',
        'index.js',
      );
    }

    const child = spawn(process.execPath, [serverEntry], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        HIPP0_SQLITE_PATH: sqlitePath,
        HIPP0_API_KEY: apiKey,
      },
      cwd: dir,
    });

    child.on('error', reject);

    child.unref();

    // Write PID file so `hipp0 stop` can signal the process.
    const pid = child.pid;
    if (pid === undefined) {
      reject(new Error('Failed to obtain server PID'));
      return;
    }

    const pidFile = path.join(dir, '.hipp0.pid');
    fs.writeFileSync(pidFile, String(pid), 'utf-8');

    resolve(pid);
  });
}

export function registerInitCommand(program: Command): void {
  program
    .command('init [name]')
    .description('Create a new Hipp0 project (or initialise a local server if no API URL is set)')
    .option('-d, --description <desc>', 'Project description')
    .option('-p, --port <port>', 'Port for the local server', '3100')
    .action(async (name?: string, opts?: { description?: string; port?: string }) => {
      const apiUrl = process.env.HIPP0_API_URL;

      // ------------------------------------------------------------------
      // Remote-API mode: HIPP0_API_URL is set → existing behaviour
      // ------------------------------------------------------------------
      if (apiUrl) {
        const client = getClient();

        const projectName = name ?? (await prompt(chalk.bold('Project name: ')));
        if (!projectName) {
          console.error(chalk.red('Project name is required'));
          process.exit(1);
        }

        const description =
          opts?.description ?? (await prompt(chalk.dim('Description (optional): ')));

        const spinner = ora('Creating project...').start();
        try {
          const project = await client.createProject({
            name: projectName,
            description: description || undefined,
          });
          spinner.succeed(chalk.green(`Project created!`));
          console.warn(`\n  ${chalk.bold('Name:')}    ${project.name}`);
          console.warn(`  ${chalk.bold('ID:')}      ${chalk.cyan(project.id)}`);
          if (project.description) console.warn(`  ${chalk.bold('Desc:')}    ${project.description}`);
          console.warn(
            `\n${chalk.dim('Set the following environment variable to use this project:')}`,
          );
          console.warn(chalk.yellow(`  export HIPP0_PROJECT_ID="${project.id}"`));
        } catch (err) {
          handleError(err, spinner);
        }
        return;
      }

      // ------------------------------------------------------------------
      // Local SQLite mode: no HIPP0_API_URL → zero-infrastructure setup
      // ------------------------------------------------------------------
      const port = parseInt(opts?.port ?? '3100', 10);

      // Determine working directory.
      let dir: string;
      if (name) {
        dir = path.resolve(process.cwd(), name);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.warn(chalk.dim(`Created directory: ${dir}`));
        }
      } else {
        dir = process.cwd();
      }

      const sqlitePath = path.join(dir, 'hipp0.db');
      const apiKey = generateApiKey();

      const spinner = ora('Initialising local Hipp0…').start();

      try {
        // Initialise the SQLite database (runs migrations via the adapter).
        const { initDb, closeDb } = await import('@hipp0/core/db/index.js');
        const db = await initDb({ dialect: 'sqlite', sqlitePath });
        // Verify it's reachable.
        await db.query('SELECT 1 AS ok');
        // Close the handle here - the server process will re-open it.
        await closeDb();

        spinner.text = 'Starting server...';

        // Start the server as a background process.
        await spawnServer(dir, sqlitePath, apiKey, port);

        // Give the server a moment to bind to the port before creating project.
        await new Promise((r) => setTimeout(r, 1500));

        // Auto-create a default project so the user can start immediately
        spinner.text = 'Creating project...';
        const projectName = name || path.basename(dir);
        let projectId: string | null = null;
        try {
          const res = await fetch(`http://localhost:${port}/api/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ name: projectName, description: opts?.description || `Hipp0 project: ${projectName}` }),
          });
          if (res.ok) {
            const project = await res.json() as { id: string };
            projectId = project.id;
          }
        } catch {
          // Server might not be ready yet, that's ok
        }

        // Write .env file for easy CLI usage
        const envLines = [
          `HIPP0_API_URL=http://localhost:${port}`,
          `HIPP0_API_KEY=${apiKey}`,
        ];
        if (projectId) {
          envLines.push(`HIPP0_PROJECT_ID=${projectId}`);
        }
        fs.writeFileSync(path.join(dir, '.env'), envLines.join('\n') + '\n', 'utf-8');

        // Add .env to .gitignore if a git repo
        const gitignorePath = path.join(dir, '.gitignore');
        if (fs.existsSync(path.join(dir, '.git')) || !fs.existsSync(gitignorePath)) {
          const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
          if (!existing.includes('.env')) {
            fs.appendFileSync(gitignorePath, `${existing.endsWith('\n') || !existing ? '' : '\n'}.env\nhipp0.db\n.hipp0.pid\n`);
          }
        }

        spinner.succeed(chalk.green('Hipp0 is running!'));

        const relativePath = path.relative(process.cwd(), sqlitePath) || './hipp0.db';
        console.warn('');
        console.warn(`  ${chalk.bold('API:')}       http://localhost:${port}`);
        console.warn(`  ${chalk.bold('Database:')}  ${relativePath}`);
        console.warn(`  ${chalk.bold('API Key:')}   ${chalk.cyan(apiKey)}`);
        if (projectId) {
          console.warn(`  ${chalk.bold('Project:')}   ${chalk.cyan(projectId)}`);
        }
        console.warn('');
        if (name) {
          console.warn(chalk.bold('  Quick start:'));
          console.warn(chalk.dim(`    cd ${name}`));
        } else {
          console.warn(chalk.bold('  Quick start:'));
        }
        console.warn(chalk.dim(`    source .env`));
        console.warn(chalk.dim(`    hipp0 add "Use PostgreSQL for persistence" --by architect --tags database,infrastructure`));
        console.warn(chalk.dim(`    hipp0 compile builder "implement the data layer"`));
        console.warn('');
        console.warn(chalk.dim(`  To stop: hipp0 stop`));
      } catch (err) {
        handleError(err, spinner);
      }
    });
}
