/**
 * hipp0 start  — start the Hipp0 server using hipp0.db in the current dir.
 * hipp0 stop   — send SIGTERM to the server recorded in .hipp0.pid.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

const PID_FILE = '.hipp0.pid';
const DEFAULT_PORT = 3100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pidFilePath(dir: string): string {
  return path.join(dir, PID_FILE);
}

function readPid(dir: string): number | null {
  const file = pidFilePath(dir);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

/** Check whether a process with the given PID is still running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a Hipp0-style API key: "h0_local_" + 16 random characters.
 */
function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const uuid = crypto.randomUUID().replace(/-/g, '');
  const raw = uuid.slice(0, 16);
  const mapped = raw
    .split('')
    .map((ch) => chars[parseInt(ch, 16) % chars.length])
    .join('');
  return `h0_local_${mapped}`;
}

/**
 * Locate the @hipp0/server entry-point, tolerating both installed and
 * monorepo layouts.
 */
function resolveServerEntry(): string {
  try {
    return _require.resolve('@hipp0/server');
  } catch {
    // Monorepo fallback: look relative to this package.
    return path.resolve(
      path.dirname(_require.resolve('@hipp0/cli/package.json')),
      '..',
      'server',
      'dist',
      'index.js',
    );
  }
}

/**
 * Start the server as a detached background process.
 * Returns the PID.
 */
function spawnServer(
  dir: string,
  sqlitePath: string,
  apiKey: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverEntry = resolveServerEntry();

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

    const pid = child.pid;
    if (pid === undefined) {
      reject(new Error('Failed to obtain server PID'));
      return;
    }

    // Persist the PID so `hipp0 stop` can find it.
    fs.writeFileSync(pidFilePath(dir), String(pid), 'utf-8');

    resolve(pid);
  });
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerServerCommands(program: Command): void {
    // hipp0 start
  program
    .command('start')
    .description('Start the Hipp0 server (uses hipp0.db in the current directory)')
    .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
    .option('--api-key <key>', 'API key (generated automatically if omitted)')
    .action(async (opts: { port?: string; apiKey?: string }) => {
      const dir = process.cwd();
      const port = parseInt(opts.port ?? String(DEFAULT_PORT), 10);
      const sqlitePath = path.join(dir, 'hipp0.db');

      // If no database exists, delegate to hipp0 init to do full initialisation.
      if (!fs.existsSync(sqlitePath)) {
        console.warn(
          chalk.yellow('No hipp0.db found in the current directory. Running `hipp0 init`…'),
        );
        // Re-invoke the CLI with `init` so we get the full init flow.
        const cliEntry = process.argv[1];
        if (!cliEntry) {
          console.error(chalk.red('Cannot locate CLI entry-point.'));
          process.exit(1);
        }
        const child = spawn(process.execPath, [cliEntry, 'init', '--port', String(port)], {
          stdio: 'inherit',
          cwd: dir,
        });
        child.on('exit', (code) => process.exit(code ?? 0));
        return;
      }

      // Check if server is already running.
      const existingPid = readPid(dir);
      if (existingPid !== null && isRunning(existingPid)) {
        console.warn(
          chalk.yellow(`[hipp0] Server is already running (PID ${existingPid})`),
        );
        console.warn(chalk.dim(`  API:       http://localhost:${port}`));
        console.warn(chalk.dim(`  Dashboard: http://localhost:${port}/dashboard`));
        return;
      }

      const apiKey = opts.apiKey ?? generateApiKey();
      const spinner = ora('Starting Hipp0 server…').start();

      try {
        const pid = await spawnServer(dir, sqlitePath, apiKey, port);
        // Give the process a moment to bind before reporting success.
        await new Promise((r) => setTimeout(r, 800));

        if (!isRunning(pid)) {
          spinner.fail('Server process exited unexpectedly. Check logs.');
          process.exit(1);
        }

        // Write .env if it doesn't exist
        const envPath = path.join(dir, '.env');
        if (!fs.existsSync(envPath)) {
          const envLines = [
            `HIPP0_API_URL=http://localhost:${port}`,
            `HIPP0_API_KEY=${apiKey}`,
          ];
          fs.writeFileSync(envPath, envLines.join('\n') + '\n', 'utf-8');
        }

        spinner.succeed(chalk.green('Hipp0 server started'));
        console.warn('');
        console.warn(`  ${chalk.bold('API:')}       http://localhost:${port}`);
        console.warn(`  ${chalk.bold('Database:')}  ./hipp0.db`);
        console.warn(`  ${chalk.bold('API Key:')}   ${chalk.cyan(apiKey)}`);
        console.warn(`  ${chalk.bold('PID:')}       ${pid}`);
        console.warn('');
        console.warn(chalk.dim(`  Run: source .env`));
        console.warn(chalk.dim(`  To stop: hipp0 stop`));
      } catch (err) {
        spinner.fail('Failed to start server');
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }
    });

    // hipp0 stop
  program
    .command('stop')
    .description('Stop the running Hipp0 server')
    .action(async () => {
      const dir = process.cwd();
      const pid = readPid(dir);

      if (pid === null) {
        console.error(
          chalk.red(
            `No .hipp0.pid file found in ${dir}. Is the server running from this directory?`,
          ),
        );
        process.exit(1);
      }

      if (!isRunning(pid)) {
        console.warn(chalk.yellow(`Process ${pid} is not running. Cleaning up stale PID file.`));
        fs.unlinkSync(pidFilePath(dir));
        return;
      }

      const spinner = ora(`Stopping server (PID ${pid})…`).start();

      try {
        process.kill(pid, 'SIGTERM');

        // Wait up to 5 s for the process to exit gracefully.
        const deadline = Date.now() + 5000;
        while (isRunning(pid) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
        }

        if (isRunning(pid)) {
          // Force-kill if it didn't exit in time.
          process.kill(pid, 'SIGKILL');
          spinner.warn(chalk.yellow('Server did not stop gracefully; sent SIGKILL.'));
        } else {
          spinner.succeed(chalk.green('Hipp0 server stopped.'));
        }

        // Remove the PID file.
        const pf = pidFilePath(dir);
        if (fs.existsSync(pf)) fs.unlinkSync(pf);
      } catch (err) {
        spinner.fail('Failed to stop server');
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }
    });
}
