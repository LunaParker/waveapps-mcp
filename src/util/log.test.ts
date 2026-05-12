import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('log', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    vi.resetModules();
  });

  it('writes info messages to stderr at default level', async () => {
    const { log } = await import('./log.js');
    log.info('hello');
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(String(writeSpy.mock.calls[0]?.[0])).toMatch(/info hello/);
  });

  it('includes structured fields when provided', async () => {
    const { log } = await import('./log.js');
    log.warn('careful', { k: 'v', n: 1 });
    const line = String(writeSpy.mock.calls[0]?.[0]);
    expect(line).toContain('warn careful');
    expect(line).toContain('"k":"v"');
    expect(line).toContain('"n":1');
  });

  it('suppresses debug messages by default', async () => {
    const { log } = await import('./log.js');
    log.debug('quiet');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('emits debug when WAVE_MCP_LOG_LEVEL=debug', async () => {
    const prev = process.env['WAVE_MCP_LOG_LEVEL'];
    process.env['WAVE_MCP_LOG_LEVEL'] = 'debug';
    vi.resetModules();
    try {
      const { log } = await import('./log.js');
      log.debug('chatter');
      expect(writeSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete process.env['WAVE_MCP_LOG_LEVEL'];
      else process.env['WAVE_MCP_LOG_LEVEL'] = prev;
    }
  });

  it('error level always emits', async () => {
    const { log } = await import('./log.js');
    log.error('boom');
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(String(writeSpy.mock.calls[0]?.[0])).toMatch(/error boom/);
  });

  it('falls back to "info" threshold when WAVE_MCP_LOG_LEVEL is garbage', async () => {
    const prev = process.env['WAVE_MCP_LOG_LEVEL'];
    process.env['WAVE_MCP_LOG_LEVEL'] = 'nonsense';
    vi.resetModules();
    try {
      const { log } = await import('./log.js');
      log.debug('quiet');
      log.info('audible');
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(String(writeSpy.mock.calls[0]?.[0])).toMatch(/info audible/);
    } finally {
      if (prev === undefined) delete process.env['WAVE_MCP_LOG_LEVEL'];
      else process.env['WAVE_MCP_LOG_LEVEL'] = prev;
    }
  });
});
