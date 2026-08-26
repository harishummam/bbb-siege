import pino, { type Logger } from 'pino';

export function resolveLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.argv.includes('--verbose') || process.argv.includes('-v')) return 'debug';
  return 'info';
}

export function createLogger(name: string): Logger {
  return pino({ name, level: resolveLevel() });
}
