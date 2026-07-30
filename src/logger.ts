import { config } from './config.js';

/**
 * Minimal structured logger mirroring the 2care `log.info('event.name', {...})`
 * pattern. Emits one JSON line per event so call/tool/orchestration events can be
 * grepped and the `orch.eval` A/B metrics diffed.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, event: string, data?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[config.logLevel]) return;
  const line = {
    t: new Date().toISOString(),
    level,
    event,
    ...(data ?? {}),
  };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => emit('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => emit('error', event, data),
};
