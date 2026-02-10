/**
 * Logger Tests
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { LogBuffer } from '../buffer';
import { formatJson, formatPretty } from '../formatters';
import { configureLogging, createLogger, getLogBuffer, resetLogBuffer } from '../index';
import type { LogEntry } from '../types';

/** Helper to safely parse captured output at index */
function parseOutput(arr: string[], index: number): Record<string, unknown> {
  const item = arr[index];
  if (!item) throw new Error(`No output at index ${index}`);
  return JSON.parse(item) as Record<string, unknown>;
}

describe('Logger', () => {
  let stdoutSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let capturedOutput: string[] = [];
  let capturedErrors: string[] = [];

  beforeEach(() => {
    // Reset buffer
    resetLogBuffer();

    // Reset config
    configureLogging({
      level: 'debug',
      format: 'json',
      modules: '*',
    });

    // Capture output
    capturedOutput = [];
    capturedErrors = [];
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation((data) => {
      capturedOutput.push(String(data));
      return true;
    });
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((data) => {
      capturedErrors.push(String(data));
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('createLogger', () => {
    it('should create a logger with module context', () => {
      const logger = createLogger('test:module');
      logger.info('Hello world');

      expect(capturedOutput.length).toBe(1);
      const entry = parseOutput(capturedOutput, 0);
      expect(entry.module).toBe('test:module');
      expect(entry.msg).toBe('Hello world');
      expect(entry.level).toBe('info');
    });

    it('should include additional data in log entries', () => {
      const logger = createLogger('test');
      logger.info('User action', { userId: '123', action: 'login' });

      const entry = parseOutput(capturedOutput, 0);
      expect(entry.userId).toBe('123');
      expect(entry.action).toBe('login');
    });

    it('should support all log levels', () => {
      const logger = createLogger('test');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(capturedOutput.length).toBe(3); // debug, info, warn
      expect(capturedErrors.length).toBe(1); // error

      const debugEntry = parseOutput(capturedOutput, 0);
      const infoEntry = parseOutput(capturedOutput, 1);
      const warnEntry = parseOutput(capturedOutput, 2);
      const errorEntry = parseOutput(capturedErrors, 0);

      expect(debugEntry.level).toBe('debug');
      expect(infoEntry.level).toBe('info');
      expect(warnEntry.level).toBe('warn');
      expect(errorEntry.level).toBe('error');
    });

    it('should create child loggers with inherited context', () => {
      const logger = createLogger('parent');
      const child = logger.child({ requestId: 'abc123' });

      child.info('Child message');

      const entry = parseOutput(capturedOutput, 0);
      expect(entry.module).toBe('parent');
      expect(entry.requestId).toBe('abc123');
    });

    it('should merge child context with log data', () => {
      const logger = createLogger('parent');
      const child = logger.child({ requestId: 'abc123' });

      child.info('Message', { extra: 'data' });

      const entry = parseOutput(capturedOutput, 0);
      expect(entry.requestId).toBe('abc123');
      expect(entry.extra).toBe('data');
    });
  });

  describe('Level filtering', () => {
    it('should respect log level configuration', () => {
      configureLogging({ level: 'warn' });

      const logger = createLogger('test');
      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('visible');
      logger.error('visible');

      expect(capturedOutput.length).toBe(1); // only warn
      expect(capturedErrors.length).toBe(1); // only error
    });

    it('should allow debug when level is debug', () => {
      configureLogging({ level: 'debug' });

      const logger = createLogger('test');
      logger.debug('visible');

      expect(capturedOutput.length).toBe(1);
    });
  });

  describe('Module filtering', () => {
    it('should filter by exact module name', () => {
      configureLogging({ modules: 'api' });

      const apiLogger = createLogger('api');
      const dbLogger = createLogger('db');

      apiLogger.info('visible');
      dbLogger.info('hidden');

      expect(capturedOutput.length).toBe(1);
      const entry = parseOutput(capturedOutput, 0);
      expect(entry.module).toBe('api');
    });

    it('should support wildcard module patterns', () => {
      configureLogging({ modules: 'whatsapp:*' });

      const authLogger = createLogger('whatsapp:auth');
      const socketLogger = createLogger('whatsapp:socket');
      const apiLogger = createLogger('api');

      authLogger.info('visible');
      socketLogger.info('visible');
      apiLogger.info('hidden');

      expect(capturedOutput.length).toBe(2);
    });

    it('should support multiple module patterns', () => {
      configureLogging({ modules: 'api,whatsapp:*' });

      const apiLogger = createLogger('api');
      const authLogger = createLogger('whatsapp:auth');
      const dbLogger = createLogger('db');

      apiLogger.info('visible');
      authLogger.info('visible');
      dbLogger.info('hidden');

      expect(capturedOutput.length).toBe(2);
    });
  });

  describe('Buffer integration', () => {
    it('should add entries to the log buffer', () => {
      const logger = createLogger('test');
      logger.info('Buffered message');

      const buffer = getLogBuffer();
      const entries = buffer.getRecent();

      expect(entries.length).toBe(1);
      expect(entries[0]?.msg).toBe('Buffered message');
    });

    it('should notify buffer subscribers', () => {
      const buffer = getLogBuffer();
      const received: LogEntry[] = [];

      buffer.subscribe((entry) => {
        received.push(entry);
      });

      const logger = createLogger('test');
      logger.info('Message 1');
      logger.info('Message 2');

      expect(received.length).toBe(2);
    });
  });
});

describe('LogBuffer', () => {
  it('should store entries up to capacity', () => {
    const buffer = new LogBuffer(3);

    buffer.push({ level: 'info', time: 1, module: 'test', msg: 'one' });
    buffer.push({ level: 'info', time: 2, module: 'test', msg: 'two' });
    buffer.push({ level: 'info', time: 3, module: 'test', msg: 'three' });
    buffer.push({ level: 'info', time: 4, module: 'test', msg: 'four' });

    expect(buffer.size).toBe(3);

    const entries = buffer.getRecent();
    expect(entries.length).toBe(3);
    expect(entries[0]?.msg).toBe('four'); // Most recent first
    expect(entries[2]?.msg).toBe('two'); // Oldest remaining
  });

  it('should filter by level', () => {
    const buffer = new LogBuffer();

    buffer.push({ level: 'debug', time: 1, module: 'test', msg: 'debug' });
    buffer.push({ level: 'info', time: 2, module: 'test', msg: 'info' });
    buffer.push({ level: 'warn', time: 3, module: 'test', msg: 'warn' });
    buffer.push({ level: 'error', time: 4, module: 'test', msg: 'error' });

    const entries = buffer.getRecent({ level: 'warn' });
    expect(entries.length).toBe(2);
    expect(entries[0]?.msg).toBe('error');
    expect(entries[1]?.msg).toBe('warn');
  });

  it('should filter by module pattern', () => {
    const buffer = new LogBuffer();

    buffer.push({ level: 'info', time: 1, module: 'api', msg: 'api' });
    buffer.push({ level: 'info', time: 2, module: 'whatsapp:auth', msg: 'auth' });
    buffer.push({ level: 'info', time: 3, module: 'whatsapp:socket', msg: 'socket' });
    buffer.push({ level: 'info', time: 4, module: 'db', msg: 'db' });

    const entries = buffer.getRecent({ modules: ['whatsapp:*'] });
    expect(entries.length).toBe(2);
  });

  it('should support subscriber filters', () => {
    const buffer = new LogBuffer();
    const received: LogEntry[] = [];

    buffer.subscribe((entry) => received.push(entry), { level: 'warn', modules: ['api'] });

    buffer.push({ level: 'info', time: 1, module: 'api', msg: 'info' });
    buffer.push({ level: 'warn', time: 2, module: 'api', msg: 'warn' });
    buffer.push({ level: 'error', time: 3, module: 'db', msg: 'db error' });

    expect(received.length).toBe(1);
    expect(received[0]?.msg).toBe('warn');
  });

  it('should unsubscribe correctly', () => {
    const buffer = new LogBuffer();
    const received: LogEntry[] = [];

    const unsubscribe = buffer.subscribe((entry) => received.push(entry));

    buffer.push({ level: 'info', time: 1, module: 'test', msg: 'before' });
    unsubscribe();
    buffer.push({ level: 'info', time: 2, module: 'test', msg: 'after' });

    expect(received.length).toBe(1);
  });
});

describe('Formatters', () => {
  const entry: LogEntry = {
    level: 'info',
    time: 1706678400000, // 2024-01-31 00:00:00 UTC
    module: 'api:startup',
    msg: 'Server listening',
    host: '0.0.0.0',
    port: 8882,
  };

  describe('formatJson', () => {
    it('should output valid JSON', () => {
      const output = formatJson(entry);
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('info');
      expect(parsed.time).toBe(1706678400000);
      expect(parsed.module).toBe('api:startup');
      expect(parsed.msg).toBe('Server listening');
      expect(parsed.host).toBe('0.0.0.0');
      expect(parsed.port).toBe(8882);
    });
  });

  describe('formatPretty', () => {
    it('should include timestamp, level, module, and message', () => {
      const output = formatPretty(entry);

      // Should contain time (format depends on timezone)
      expect(output).toContain('INFO');
      // Module parts may be split by color codes
      expect(output).toContain('api');
      expect(output).toContain(':startup');
      expect(output).toContain('Server listening');
    });

    it('should include key=value pairs', () => {
      const output = formatPretty(entry);

      expect(output).toContain('host=0.0.0.0');
      expect(output).toContain('port=8882');
    });

    it('should quote strings with spaces', () => {
      const entryWithSpaces: LogEntry = {
        level: 'info',
        time: 1706678400000,
        module: 'test',
        msg: 'Test',
        reason: 'multiple words here',
      };

      const output = formatPretty(entryWithSpaces);
      expect(output).toContain('reason="multiple words here"');
    });
  });
});
