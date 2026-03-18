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
import { matchSnapshot, extractSnapshot } from '../src/snapshots';
import { evaluate } from '../src/assertions';
import { makeTrace, toolCall, output } from './helpers';
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

// ===== Issue: evaluate with tool_call steps missing tool_name =====
describe('evaluate assertions edge cases', () => {
  it('should handle tool_call steps with undefined tool_name', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: {} },  // no tool_name
      toolCall('search'),
      output('result'),
    ]);
    const results = evaluate(trace, { tool_called: 'search' });
    expect(results[0].passed).toBe(true);
  });

  it('should handle output_contains with no output steps', () => {
    const trace = makeTrace([toolCall('search')]);
    const results = evaluate(trace, { output_contains: 'hello' });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('does not contain');
  });

  it('should handle output_matches with invalid regex gracefully', () => {
    const trace = makeTrace([output('hello world')]);
    const results = evaluate(trace, { output_matches: '[invalid regex' });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Invalid regex');
  });

  it('should handle max_steps with empty trace', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { max_steps: 5 });
    expect(results[0].passed).toBe(true);
  });

  it('should handle tool_sequence with empty trace', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { tool_sequence: ['search', 'process'] });
    expect(results[0].passed).toBe(false);
  });

  it('should handle tool_args_match when tool was not called', () => {
    const trace = makeTrace([toolCall('other')]);
    const results = evaluate(trace, { tool_args_match: { search: { query: 'test' } } });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('was not called');
  });

  it('should handle chain with empty trace', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { chain: [{ tool_called: 'search' }] });
    expect(results[0].passed).toBe(false);
  });

  it('should handle not() wrapper correctly', () => {
    const trace = makeTrace([output('hello world')]);
    const results = evaluate(trace, { not: { output_contains: 'goodbye' } });
    // 'goodbye' is not in output, so the inner assertion fails, and NOT inverts → passed
    expect(results[0].passed).toBe(true);
  });

  it('should handle custom assertion with valid expression', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const results = evaluate(trace, { custom: 'toolCalls.length === 1' });
    expect(results[0].passed).toBe(true);
  });

  it('should handle custom assertion with invalid expression', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { custom: '(() => { throw new Error("boom") })()' });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Error');
  });

  it('should handle max_cost_usd assertion', () => {
    const trace: AgentTrace = {
      id: 'cost-test',
      timestamp: new Date().toISOString(),
      steps: [{
        type: 'llm_call',
        timestamp: new Date().toISOString(),
        data: { model: 'gpt-4o', tokens: { input: 1000, output: 500 } },
      }],
      metadata: {},
    };
    const results = evaluate(trace, { max_cost_usd: 1.0 });
    expect(results[0].passed).toBe(true); // very small cost
  });
});

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

// ===== Issue: matchSnapshot created flag bug =====
describe('matchSnapshot created flag', () => {
  const snapDir = path.join(TMP_DIR, '__snapshots_test__');

  afterAll(() => {
    if (fs.existsSync(snapDir)) {
      for (const f of fs.readdirSync(snapDir)) fs.unlinkSync(path.join(snapDir, f));
      fs.rmdirSync(snapDir);
    }
  });

  it('should report created=true when creating a new snapshot', () => {
    ensureTmp();
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const result = matchSnapshot(trace, 'new-snapshot-test', {
      updateSnapshots: false,
      snapshotDir: snapDir,
    });
    expect(result.match).toBe(true);
    expect(result.created).toBe(true);
  });

  it('should match an existing snapshot', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    // First call creates it
    matchSnapshot(trace, 'existing-snap-test', {
      updateSnapshots: false,
      snapshotDir: snapDir,
    });
    // Second call should match
    const result = matchSnapshot(trace, 'existing-snap-test', {
      updateSnapshots: false,
      snapshotDir: snapDir,
    });
    expect(result.match).toBe(true);
    expect(result.created).toBeFalsy();
  });

  it('extractSnapshot should handle empty trace', () => {
    const trace = makeTrace([]);
    const snap = extractSnapshot(trace);
    expect(snap.toolsCalled).toEqual([]);
    expect(snap.toolCallOrder).toEqual([]);
    expect(snap.hasOutput).toBe(false);
    expect(snap.stepCount).toBe(0);
  });
});

// ===== Recorder tests =====
describe('Recorder', () => {
  it('should generate unique trace IDs', () => {
    const r1 = new Recorder();
    const r2 = new Recorder();
    expect(r1.getTrace().id).not.toBe(r2.getTrace().id);
  });

  it('should add steps with timestamp', () => {
    const r = new Recorder({ test: true });
    r.addStep({ type: 'llm_call', data: { model: 'gpt-4' } });
    r.addStep({ type: 'tool_call', data: { tool_name: 'search' } });
    const trace = r.getTrace();
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0].timestamp).toBeTruthy();
    expect(trace.steps[1].timestamp).toBeTruthy();
    expect(trace.metadata.test).toBe(true);
  });

  it('should save and load trace via file', () => {
    ensureTmp();
    const r = new Recorder({ source: 'test' });
    r.addStep({ type: 'output', data: { content: 'hello' } });
    const p = path.join(TMP_DIR, 'recorder-save.json');
    r.save(p);
    const loaded = loadTrace(p);
    expect(loaded.steps).toHaveLength(1);
    expect(loaded.steps[0].data.content).toBe('hello');
  });
});
