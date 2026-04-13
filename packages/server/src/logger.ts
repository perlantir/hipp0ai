/**
 * Structured JSON logger for Hipp0 server.
 *
 * Levels: debug, info, warn, error
 * Output: one JSON line per log entry with timestamp, level, component, request_id, message, extra.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  request_id?: string;
  message: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function emit(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  child(overrides: { component?: string; request_id?: string }): Logger;
}

export function createLogger(component: string, requestId?: string): Logger {
  const log = (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
    if (!shouldLog(level)) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...extra,
    };
    if (requestId) entry.request_id = requestId;
    emit(entry);
  };

  return {
    debug: (msg, extra) => log('debug', msg, extra),
    info: (msg, extra) => log('info', msg, extra),
    warn: (msg, extra) => log('warn', msg, extra),
    error: (msg, extra) => log('error', msg, extra),
    child: (overrides) =>
      createLogger(overrides.component ?? component, overrides.request_id ?? requestId),
  };
}

// Default server-wide logger
export const logger = createLogger('server');
