// Stderr-only logger. MCP stdio uses stdout for the protocol, so logs MUST
// go to stderr. We intentionally avoid pulling in a logger dependency.

type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold: number =
  order[(process.env['WAVE_MCP_LOG_LEVEL'] as Level) ?? 'info'] ?? order.info;

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (order[level] < threshold) return;
  const payload = fields ? ` ${JSON.stringify(fields)}` : '';
  process.stderr.write(`[waveapps-mcp] ${level} ${msg}${payload}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>): void => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>): void => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>): void => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>): void => emit('error', msg, fields),
};
