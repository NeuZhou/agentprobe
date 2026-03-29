import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Recorder, createSampler, matchesPriorityRule, loadTrace } from '../src/recorder';
import type { AgentTrace } from '../src/types';

vi.mock('fs');

describe('Recorder', () => {
  let recorder: Recorder;

  beforeEach(() => {
    recorder = new Recorder({ test: true });
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates a trace with a UUID id', () => {
      const trace = recorder.getTrace();
      expect(trace.id).toBeDefined();
      expect(typeof trace.id).toBe('string');
      expect(trace.id.length).toBeGreaterThan(10);
    });

    it('creates a trace with a valid ISO timestamp', () => {
      const trace = recorder.getTrace();
      expect(trace.timestamp).toBeDefined();
      const parsed = new Date(trace.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it('creates a trace with empty steps array', () => {
      const trace = recorder.getTrace();
      expect(trace.steps).toEqual([]);
    });

    it('stores metadata from constructor', () => {
      const r = new Recorder({ env: 'test', version: '1.0' });
      expect(r.getTrace().metadata).toEqual({ env: 'test', version: '1.0' });
    });

    it('defaults to empty metadata', () => {
      const r = new Recorder();
      expect(r.getTrace().metadata).toEqual({});
    });
  });

  describe('addStep', () => {
    it('adds a step with timestamp', () => {
      recorder.addStep({ type: 'llm_call', data: { model: 'gpt-4' } });
      const trace = recorder.getTrace();
      expect(trace.steps).toHaveLength(1);
      expect(trace.steps[0].type).toBe('llm_call');
      expect(trace.steps[0].data.model).toBe('gpt-4');
      expect(trace.steps[0].timestamp).toBeDefined();
    });

    it('adds multiple steps in order', () => {
      recorder.addStep({ type: 'llm_call', data: { model: 'gpt-4' } });
      recorder.addStep({ type: 'tool_call', data: { tool_name: 'read', tool_args: {} } });
      recorder.addStep({ type: 'output', data: { content: 'done' } });
      const trace = recorder.getTrace();
      expect(trace.steps).toHaveLength(3);
      expect(trace.steps.map(s => s.type)).toEqual(['llm_call', 'tool_call', 'output']);
    });

    it('preserves step data including tool_args', () => {
      recorder.addStep({
        type: 'tool_call',
        data: { tool_name: 'exec', tool_args: { command: 'ls -la' } },
        duration_ms: 150,
      });
      const step = recorder.getTrace().steps[0];
      expect(step.data.tool_name).toBe('exec');
      expect(step.data.tool_args).toEqual({ command: 'ls -la' });
      expect(step.duration_ms).toBe(150);
    });
  });

  describe('save', () => {
    it('writes trace JSON to file', () => {
      const writeSpy = vi.mocked(fs.writeFileSync);
      recorder.addStep({ type: 'output', data: { content: 'hello' } });
      recorder.save('/tmp/trace.json');
      expect(writeSpy).toHaveBeenCalledWith(
        '/tmp/trace.json',
        expect.any(String),
      );
      const written = JSON.parse(writeSpy.mock.calls[0][1] as string);
      expect(written.steps).toHaveLength(1);
      expect(written.steps[0].data.content).toBe('hello');
    });
  });

  describe('patchOllama', () => {
    it('sets provider metadata to ollama', () => {
      recorder.patchOllama();
      expect(recorder.getTrace().metadata.provider).toBe('ollama');
    });

    it('does not override existing provider', () => {
      const r = new Recorder({ provider: 'custom' });
      r.patchOllama();
      expect(r.getTrace().metadata.provider).toBe('custom');
    });
  });
});

describe('Trace Sampling', () => {
  function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
    return {
      id: 'test-trace',
      timestamp: new Date().toISOString(),
      steps: [],
      metadata: {},
      ...overrides,
    };
  }

  describe('createSampler', () => {
    it('random strategy respects sampling rate', () => {
      const sampler = createSampler({ rate: 1.0, strategy: 'random' });
      const trace = makeTrace();
      // rate 1.0 should always capture
      let captured = 0;
      for (let i = 0; i < 100; i++) {
        if (sampler(trace)) captured++;
      }
      expect(captured).toBe(100);
    });

    it('rate 0 captures nothing (random)', () => {
      const sampler = createSampler({ rate: 0, strategy: 'random', seed: 42 });
      const trace = makeTrace();
      let captured = 0;
      for (let i = 0; i < 100; i++) {
        if (sampler(trace)) captured++;
      }
      expect(captured).toBe(0);
    });

    it('seeded sampler produces deterministic results', () => {
      const results1: boolean[] = [];
      const results2: boolean[] = [];
      const s1 = createSampler({ rate: 0.5, strategy: 'random', seed: 123 });
      const s2 = createSampler({ rate: 0.5, strategy: 'random', seed: 123 });
      for (let i = 0; i < 50; i++) {
        results1.push(s1(makeTrace()));
        results2.push(s2(makeTrace()));
      }
      expect(results1).toEqual(results2);
    });

    it('reservoir strategy keeps early samples', () => {
      const sampler = createSampler({ rate: 0.5, strategy: 'reservoir', seed: 42 });
      // First trace should always be kept
      expect(sampler(makeTrace())).toBe(true);
    });

    it('priority strategy respects priority rules', () => {
      const sampler = createSampler({
        rate: 0,
        strategy: 'priority',
        priority_rules: [{ error: 'always' }],
      });
      const errorTrace = makeTrace({ metadata: { error: true } });
      expect(sampler(errorTrace)).toBe(true);
    });
  });

  describe('matchesPriorityRule', () => {
    it('matches error rule when trace has error metadata', () => {
      const trace = makeTrace({ metadata: { error: true } });
      expect(matchesPriorityRule(trace, [{ error: 'always' }])).toBe(true);
    });

    it('matches error rule when step has error content', () => {
      const trace = makeTrace({
        steps: [{
          type: 'tool_result',
          data: { tool_result: { error: 'connection failed' } },
          timestamp: new Date().toISOString(),
        }],
      });
      expect(matchesPriorityRule(trace, [{ error: 'always' }])).toBe(true);
    });

    it('matches cost_gt rule', () => {
      const trace = makeTrace({ metadata: { cost: 0.5 } });
      expect(matchesPriorityRule(trace, [{ cost_gt: 0.1 }])).toBe(true);
    });

    it('does not match cost_gt when cost is lower', () => {
      const trace = makeTrace({ metadata: { cost: 0.01 } });
      expect(matchesPriorityRule(trace, [{ cost_gt: 0.1 }])).toBe(false);
    });

    it('matches duration_gt rule', () => {
      const trace = makeTrace({
        steps: [
          { type: 'llm_call', data: {}, timestamp: '', duration_ms: 15000 },
        ],
      });
      expect(matchesPriorityRule(trace, [{ duration_gt: '10s' }])).toBe(true);
    });

    it('matches tool_used rule', () => {
      const trace = makeTrace({
        steps: [
          { type: 'tool_call', data: { tool_name: 'exec' }, timestamp: '' },
        ],
      });
      expect(matchesPriorityRule(trace, [{ tool_used: 'exec' }])).toBe(true);
    });

    it('does not match tool_used when tool not present', () => {
      const trace = makeTrace({
        steps: [
          { type: 'tool_call', data: { tool_name: 'read' }, timestamp: '' },
        ],
      });
      expect(matchesPriorityRule(trace, [{ tool_used: 'exec' }])).toBe(false);
    });

    it('returns false for empty rules', () => {
      const trace = makeTrace();
      expect(matchesPriorityRule(trace, [])).toBe(false);
    });
  });

  describe('loadTrace', () => {
    it('reads and parses a trace file', () => {
      const mockTrace: AgentTrace = {
        id: 'loaded',
        timestamp: '2025-01-01T00:00:00Z',
        steps: [],
        metadata: {},
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockTrace));
      const loaded = loadTrace('/path/to/trace.json');
      expect(loaded.id).toBe('loaded');
      expect(loaded.steps).toEqual([]);
    });
  });
});
