import { describe, it, expect } from 'vitest';
import { FaultInjector, FaultInjectionError } from '../src/faults';

describe('FaultInjector', () => {
  it('error injection throws', async () => {
    const injector = new FaultInjector({ tool: { type: 'error', message: 'Boom' } });
    await expect(injector.wrapToolCall('tool', async () => 'ok')).rejects.toThrow('Boom');
  });

  it('error injection throws FaultInjectionError', async () => {
    const injector = new FaultInjector({ tool: { type: 'error', message: 'fail' } });
    try {
      await injector.wrapToolCall('tool', async () => 'ok');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(FaultInjectionError);
      expect((e as FaultInjectionError).toolName).toBe('tool');
    }
  });

  it('timeout injection delays then throws', async () => {
    const injector = new FaultInjector({ tool: { type: 'timeout', delay_ms: 10 } });
    const start = Date.now();
    await expect(injector.wrapToolCall('tool', async () => 'ok')).rejects.toThrow('Timeout');
    expect(Date.now() - start).toBeGreaterThanOrEqual(8);
  });

  it('slow injection delays then returns', async () => {
    const injector = new FaultInjector({ tool: { type: 'slow', delay_ms: 10 } });
    const start = Date.now();
    const result = await injector.wrapToolCall('tool', async () => 'ok');
    expect(result).toBe('ok');
    expect(Date.now() - start).toBeGreaterThanOrEqual(8);
  });

  it('corrupt injection modifies result', async () => {
    const injector = new FaultInjector({ tool: { type: 'corrupt' } });
    const result = await injector.wrapToolCall('tool', async () => 'Hello world this is a long string');
    expect(result).not.toBe('Hello world this is a long string');
    expect(result).toContain('corrupted');
  });

  it('probability 0 never injects', async () => {
    const injector = new FaultInjector({ tool: { type: 'error', message: 'Boom', probability: 0 } });
    // Run 10 times, should never throw
    for (let i = 0; i < 10; i++) {
      const result = await injector.wrapToolCall('tool', async () => 'ok');
      expect(result).toBe('ok');
    }
  });

  it('probability 1 always injects', async () => {
    const injector = new FaultInjector({ tool: { type: 'error', message: 'Boom', probability: 1 } });
    for (let i = 0; i < 5; i++) {
      await expect(injector.wrapToolCall('tool', async () => 'ok')).rejects.toThrow('Boom');
    }
  });

  it('passes through for unconfigured tools', async () => {
    const injector = new FaultInjector({ other: { type: 'error' } });
    const result = await injector.wrapToolCall('tool', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('summary returns configured faults', () => {
    const injector = new FaultInjector({
      search: { type: 'error', message: 'fail' },
      api: { type: 'slow', delay_ms: 1000, probability: 0.5 },
    });
    const summary = injector.summary();
    expect(summary).toHaveLength(2);
    expect(summary[0]).toContain('search');
    expect(summary[1]).toContain('api');
  });
});
