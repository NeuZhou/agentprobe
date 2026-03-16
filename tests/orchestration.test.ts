import { describe, it, expect } from 'vitest';
import { evaluateOrchestration } from '../src/orchestration';
import { makeTrace, toolCall, output } from './helpers';
import type { AgentTrace } from '../src/types';

function makeNamedTrace(id: string, steps: any[], ts?: string): AgentTrace {
  return {
    id,
    timestamp: ts ?? new Date().toISOString(),
    steps: steps.map((s: any) => ({
      type: s.type ?? 'tool_call',
      timestamp: s.timestamp ?? ts ?? new Date().toISOString(),
      data: s.data ?? {},
      duration_ms: s.duration_ms ?? 10,
    })),
    metadata: {},
  };
}

describe('orchestration', () => {
  it('two agents, orchestrator delegates', () => {
    const agents: Record<string, AgentTrace> = {
      orchestrator: makeNamedTrace('orch', [
        toolCall('delegate', { agent: 'worker' }),
        output('done'),
      ]),
      worker: makeNamedTrace('worker', [toolCall('search'), output('result')]),
    };
    const results = evaluateOrchestration(agents, { delegated_to: ['worker'] }, 'orchestrator');
    expect(results.some(r => r.name.includes('delegated_to') && r.passed)).toBe(true);
  });

  it('all_agents_complete: all done', () => {
    const agents: Record<string, AgentTrace> = {
      a: makeNamedTrace('a', [output('done')]),
      b: makeNamedTrace('b', [output('done')]),
    };
    const results = evaluateOrchestration(agents, { all_agents_complete: true });
    const r = results.find(r => r.name === 'all_agents_complete');
    expect(r?.passed).toBe(true);
  });

  it('all_agents_complete: one missing output', () => {
    const agents: Record<string, AgentTrace> = {
      a: makeNamedTrace('a', [output('done')]),
      b: makeNamedTrace('b', [toolCall('search')]), // no output
    };
    const results = evaluateOrchestration(agents, { all_agents_complete: true });
    const r = results.find(r => r.name === 'all_agents_complete');
    expect(r?.passed).toBe(false);
  });

  it('total_steps across agents', () => {
    const agents: Record<string, AgentTrace> = {
      a: makeNamedTrace('a', [toolCall('x'), output('1')]),
      b: makeNamedTrace('b', [toolCall('y'), output('2')]),
    };
    const results = evaluateOrchestration(agents, { total_steps: { max: 10 } });
    const r = results.find(r => r.name.includes('total_steps'));
    expect(r?.passed).toBe(true);
  });

  it('total_steps exceeds max', () => {
    const agents: Record<string, AgentTrace> = {
      a: makeNamedTrace('a', [toolCall('x'), toolCall('y'), output('1')]),
      b: makeNamedTrace('b', [toolCall('z'), output('2')]),
    };
    const results = evaluateOrchestration(agents, { total_steps: { max: 3 } });
    const r = results.find(r => r.name.includes('total_steps'));
    expect(r?.passed).toBe(false);
  });

  it('agent_order assertion', () => {
    const agents: Record<string, AgentTrace> = {
      first: makeNamedTrace('first', [output('1')], '2024-01-01T00:00:00Z'),
      second: makeNamedTrace('second', [output('2')], '2024-01-01T00:01:00Z'),
    };
    const results = evaluateOrchestration(agents, { agent_order: ['first', 'second'] });
    const r = results.find(r => r.name.includes('agent_order'));
    expect(r?.passed).toBe(true);
  });

  it('delegated_to with missing agent', () => {
    const agents: Record<string, AgentTrace> = {
      orch: makeNamedTrace('orch', [output('done')]),
    };
    const results = evaluateOrchestration(agents, { delegated_to: ['nonexistent'] }, 'orch');
    const r = results.find(r => r.name.includes('nonexistent'));
    expect(r?.passed).toBe(false);
  });

  it('single agent (edge case)', () => {
    const agents: Record<string, AgentTrace> = {
      solo: makeNamedTrace('solo', [output('done')]),
    };
    const results = evaluateOrchestration(agents, { all_agents_complete: true });
    const r = results.find(r => r.name === 'all_agents_complete');
    expect(r?.passed).toBe(true);
  });

  it('three+ agents', () => {
    const agents: Record<string, AgentTrace> = {
      a: makeNamedTrace('a', [output('1')]),
      b: makeNamedTrace('b', [output('2')]),
      c: makeNamedTrace('c', [output('3')]),
    };
    const results = evaluateOrchestration(agents, { all_agents_complete: true });
    const r = results.find(r => r.name === 'all_agents_complete');
    expect(r?.passed).toBe(true);
  });

  it('total_steps min constraint', () => {
    const agents: Record<string, AgentTrace> = {
      a: makeNamedTrace('a', [output('1')]),
    };
    const results = evaluateOrchestration(agents, { total_steps: { min: 5 } });
    const r = results.find(r => r.name.includes('total_steps'));
    expect(r?.passed).toBe(false);
  });
});
