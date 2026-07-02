/**
 * Minimal structured logger. Writes to STDERR so it never pollutes the chat UI
 * (which uses stdout). Redacts secrets (API keys, bearer tokens) on every line.
 * Reads LOG_LEVEL from env directly to stay dependency-free (no config cycle).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = RANK[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? RANK.info;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***'],
  [/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***'],
];

function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, repl]) => acc.replace(re, repl), text);
}

function safe(meta: unknown): string {
  try {
    return typeof meta === 'string' ? meta : JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

function emit(level: Level, msg: string, meta?: unknown): void {
  if (RANK[level] < threshold) return;
  const base = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const line = meta === undefined ? base : `${base} ${safe(meta)}`;
  // All levels go to stderr to keep stdout clean for the conversation.
  console.error(redact(line));
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit('debug', msg, meta),
  info: (msg: string, meta?: unknown) => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown) => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown) => emit('error', msg, meta),
};
