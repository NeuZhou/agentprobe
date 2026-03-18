/**
 * Robustness tests for error handling improvements.
 * Tests for issues found during code review.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { loadTrace, Recorder } from '../src/recorder';
import { FaultInjector } from '../src/faults';
import { calculateCost, formatCostReport, findPricing } from '../src/cost';
import { parseChaosConfig } from '../src/chaos';
import type { AgentTrace } from '../src/types';

const TMP_DIR = path.join(__dirname, '__tmp_robustness__');

function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

afterAll(() => {
  if (fs.existsSync(TMP_DIR)) {
    for (const f of fs.readdirSync(TMP_DIR)) fs.unlinkSync(path.join(TMP_DIR, f));
    fs.rmdirSync(TMP_DIR);
  }
});

// ===== Issue 2: loadTrace error handling =====
describe('loadTrace robustness', () => {
  it('should throw a clear error when file does not exist', () => {
    expect(() => loadTrace('/nonexistent/path/trace.json')).toThrow();
  });

  it('should throw a clear error for invalid JSON', () => {
    ensureTmp();
    const p = path.join(TMP_DIR, 'invalid.json');
    fs.writeFileSync(p, '{ this is not valid json }}}');
    expect(() => loadTrace(p)).toThrow();
  });

  it('should load valid trace files', () => {
    ensureTmp();
    const trace: AgentTrace = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      steps: [],
      metadata: {},
    };
    const p = path.join(TMP_DIR, 'valid.json');
    fs.writeFileSync(p, JSON.stringify(trace));
    const loaded = loadTrace(p);
    expect(loaded.id).toBe('test-1');
    expect(loaded.steps).toEqual([]);
  });
});

// ===== Issue 3: FaultInjector double-random check =====
describe('FaultInjector consistency', () => {
  it('should respect probability=0 and never inject', async () => {
    const injector = new FaultInjector({
      myTool: { type: 'error', message: 'fail', probability: 0 },
    });
    let executed = 0;
    for (let i = 0; i < 50; i++) {
      await injector.wrapToolCall('myTool', async () => {
        executed++;
        return 'ok';
      });
    }
    expect(executed).toBe(50); // should always pass through
  });

  it('should respect probability=1 and always inject errors', async () => {
    const injector = new FaultInjector({
      myTool: { type: 'error', message: 'always-fail', probability: 1.0 },
    });
    let errors = 0;
    for (let i = 0; i < 10; i++) {
      try {
        await injector.wrapToolCall('myTool', async () => 'ok');
      } catch {
        errors++;
      }
    }
    expect(errors).toBe(10);
  });

  it('should pass through for un-faulted tools', async () => {
    const injector = new FaultInjector({
      faultyTool: { type: 'error', message: 'fail', probability: 1.0 },
    });
    const result = await injector.wrapToolCall('safeTool', async () => 'safe-result');
    expect(result).toBe('safe-result');
  });
});

// ===== Issue 4: parseChaosConfig file validation =====
describe('parseChaosConfig robustness', () => {
  it('should throw when file does not exist', () => {
    expect(() => parseChaosConfig('/nonexistent/chaos.yaml')).toThrow();
  });
});

// ===== Issue 9: findPricing fuzzy match could be ambiguous =====
describe('findPricing edge cases', () => {
  it('should match exact model names', () => {
    const pricing = findPricing('gpt-4o');
    expect(pricing.input).toBe(2.5);
    expect(pricing.output).toBe(10.0);
  });

  it('should handle completely unknown models with default pricing', () => {
    const pricing = findPricing('totally-unknown-model-xyz-999');
    // Should return default (gpt-4o-mini pricing)
    expect(pricing.input).toBe(0.15);
    expect(pricing.output).toBe(0.6);
  });

  it('should fuzzy match model variants', () => {
    const pricing = findPricing('gpt-4o-2024-11-20');
    expect(pricing.input).toBe(2.5); // should match gpt-4o
  });
});

// ===== Issue 10: CostReport with empty traces =====
describe('calculateCost edge cases', () => {
  it('should handle trace with no LLM steps', () => {
    const trace: AgentTrace = {
      id: 'no-llm',
      timestamp: new Date().toISOString(),
      steps: [
        {
          type: 'tool_call',
          timestamp: new Date().toISOString(),
          data: { tool_name: 'search', tool_args: {} },
        },
      ],
      metadata: {},
    };
    const cost = calculateCost(trace);
    expect(cost.total_cost).toBe(0);
    expect(cost.total_tokens).toBe(0);
    expect(cost.breakdowns).toHaveLength(0);
  });

  it('should format cost report correctly', () => {
    const trace: AgentTrace = {
      id: 'fmt-test',
      timestamp: new Date().toISOString(),
      steps: [
        {
          type: 'llm_call',
          timestamp: new Date().toISOString(),
          data: { model: 'gpt-4o', tokens: { input: 1000, output: 500 } },
        },
      ],
      metadata: {},
    };
    const report = calculateCost(trace);
    const formatted = formatCostReport(report);
    expect(formatted).toContain('gpt-4o');
    expect(formatted).toContain('1000');
    expect(formatted).toContain('500');
  });
});
