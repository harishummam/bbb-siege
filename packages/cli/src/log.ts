import { Writable } from 'node:stream';
import type { LogBuffer } from '@bbb-siege/metrics';
import pino, { type Logger } from 'pino';

export function resolveLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.argv.includes('--verbose') || process.argv.includes('-v')) return 'debug';
  return 'info';
}

export function createLogger(name: string, buffer?: LogBuffer): Logger {
  const stdoutLevel = resolveLevel();
  if (!buffer) return pino({ name, level: stdoutLevel });

  const bufferStream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) buffer.push(line);
      }
      callback();
    },
  });

  return pino(
    { name, level: 'debug' },
    pino.multistream([
      { level: stdoutLevel, stream: process.stdout },
      { level: 'debug', stream: bufferStream },
    ])
  );
}
