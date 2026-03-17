/**
 * Round 41 Tests — v4.3.0 Features
 * - Agent Debugging Tools (debugger.ts)
 * - Fluent Assertion Builder (assertion-builder.ts)
 * - Test Generator from Docs (doc-gen.ts)
 */
import { describe, it, expect } from 'vitest';
import { makeTrace, toolCall, output, llmCall } from './helpers';
import {
  formatStep, buildContext, formatContext, matchesBreakpoint,
  parseBreakpoint, createDebugState, processCommand, formatDebugHeader,
} from '../src/debugger';
import type { DebugBreakpoint } from '../src/debugger';
import { AssertionBuilder } from '../src/assertion-builder';
import type { AssertionCheck } from '../src/assertion-builder';
import {
  parseMarkdownEndpoints, generateFromMarkdown, generateFromOpenAPISpec,
  formatDocGenStats,
} from '../src/doc-gen';
import type { OpenAPISpec } from '../src/openapi';

// ─── Test Trace Fixtures ─────────────────────────────────────────────

const sampleTrace = makeTrace([
  { type: 'llm_call', data: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Find flights to Paris' }], tokens: { input: 50, output: 30 } }, duration_ms: 200 },
  { type: 'tool_call', data: { tool_name: 'search_flights', tool_args: { destination: 'Paris' } }, duration_ms: 150 },
  { type: 'tool_result', data: { tool_name: 'search_flights', tool_result: { flights: [{ price: 350 }] } }, duration_ms: 5 },
  { type: 'thought', data: { content: 'Found a flight for $350, let me present this' }, duration_ms: 10 },
  { type: 'output', data: { content: 'I found a flight to Paris for $350!' }, duration_ms: 100 },
]);

const miniSpec: OpenAPISpec = {
  openapi: '3.0.0',
  info: { title: 'Travel API', version: '1.0.0' },
  paths: {
    '/flights': {
      get: {
        operationId: 'search_flights',
        summary: 'Search available flights',
        parameters: [
          { name: 'destination', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'List of flights' } },
        tags: ['flights'],
      },
    },
    '/bookings': {
      post: {
        operationId: 'create_booking',
        summary: 'Create a booking',
        requestBody: { required: true, content: { 'application/json': { schema: {} } } },
        responses: { '201': { description: 'Booking created' } },
        tags: ['bookings'],
      },
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Debugger Tests
// ═══════════════════════════════════════════════════════════════════════

describe('AgentDebugger', () => {
  describe('formatStep', () => {
    it('formats llm_call steps', () => {
      const result = formatStep(sampleTrace.steps[0], 0, 5);
      expect(result).toContain('Step 1/5');
      expect(result).toContain('User');
      expect(result).toContain('Find flights to Paris');
    });

    it('formats tool_call steps', () => {
      const result = formatStep(sampleTrace.steps[1], 1, 5);
      expect(result).toContain('Step 2/5');
      expect(result).toContain('search_flights');
    });

    it('formats tool_result steps', () => {
      const result = formatStep(sampleTrace.steps[2], 2, 5);
      expect(result).toContain('search_flights');
    });

    it('formats thought steps', () => {
      const result = formatStep(sampleTrace.steps[3], 3, 5);
      expect(result).toContain('💭');
      expect(result).toContain('Thought');
    });

    it('formats output steps', () => {
      const result = formatStep(sampleTrace.steps[4], 4, 5);
      expect(result).toContain('Agent → User');
      expect(result).toContain('Paris');
    });

    it('truncates long content', () => {
      const longTrace = makeTrace([
        { type: 'output', data: { content: 'A'.repeat(200) }, duration_ms: 10 },
      ]);
      const result = formatStep(longTrace.steps[0], 0, 1);
      expect(result).toContain('...');
      expect(result.length).toBeLessThan(200);
    });
  });

  describe('buildContext', () => {
    it('accumulates tokens', () => {
      const ctx = buildContext(sampleTrace, 0);
      expect(ctx.totalTokens).toBe(80); // 50+30
    });

    it('tracks called tools', () => {
      const ctx = buildContext(sampleTrace, 2);
      expect(ctx.toolsCalled).toContain('search_flights');
    });

    it('tracks step durations', () => {
      const ctx = buildContext(sampleTrace, 4);
      expect(ctx.stepDurations.length).toBe(5);
    });
  });

  describe('formatContext', () => {
    it('produces readable output', () => {
      const ctx = buildContext(sampleTrace, 4);
      const formatted = formatContext(ctx);
      expect(formatted).toContain('Context:');
      expect(formatted).toContain('tokens=');
      expect(formatted).toContain('tools_called=');
    });
  });

  describe('matchesBreakpoint', () => {
    it('matches by step number', () => {
      const bp: DebugBreakpoint = { step: 2 };
      expect(matchesBreakpoint(sampleTrace.steps[1], 1, [bp])).toBe(true);
      expect(matchesBreakpoint(sampleTrace.steps[0], 0, [bp])).toBe(false);
    });

    it('matches by tool name', () => {
      const bp: DebugBreakpoint = { toolName: 'search_flights' };
      expect(matchesBreakpoint(sampleTrace.steps[1], 1, [bp])).toBe(true);
    });

    it('matches by type', () => {
      const bp: DebugBreakpoint = { type: 'output' };
      expect(matchesBreakpoint(sampleTrace.steps[4], 4, [bp])).toBe(true);
      expect(matchesBreakpoint(sampleTrace.steps[0], 0, [bp])).toBe(false);
    });

    it('matches by condition', () => {
      const bp: DebugBreakpoint = { condition: (_s, i) => i === 3 };
      expect(matchesBreakpoint(sampleTrace.steps[3], 3, [bp])).toBe(true);
    });
  });

  describe('parseBreakpoint', () => {
    it('parses step breakpoints', () => {
      expect(parseBreakpoint('step=5')).toEqual({ step: 5 });
    });

    it('parses tool breakpoints', () => {
      expect(parseBreakpoint('tool=search')).toEqual({ toolName: 'search' });
    });

    it('parses type breakpoints', () => {
      expect(parseBreakpoint('type=llm_call')).toEqual({ type: 'llm_call' });
    });

    it('returns null for invalid', () => {
      expect(parseBreakpoint('invalid')).toBeNull();
    });
  });

  describe('processCommand', () => {
    it('steps forward', () => {
      const state = createDebugState(sampleTrace);
      const { state: newState, output: out } = processCommand(state, 'step');
      expect(newState.currentStep).toBe(1);
      expect(out).toContain('search_flights');
    });

    it('inspects context', () => {
      const state = createDebugState(sampleTrace);
      const { output: out } = processCommand(state, 'inspect');
      expect(out).toContain('Context:');
    });

    it('quits', () => {
      const state = createDebugState(sampleTrace);
      const { quit } = processCommand(state, 'quit');
      expect(quit).toBe(true);
    });

    it('goes back', () => {
      let state = createDebugState(sampleTrace);
      state = processCommand(state, 'step').state;
      state = processCommand(state, 'step').state;
      const { state: backState } = processCommand(state, 'back');
      expect(backState.currentStep).toBe(1);
    });

    it('continues to breakpoint', () => {
      let state = createDebugState(sampleTrace);
      state = processCommand(state, 'b tool=search_flights').state;
      const { state: newState, output: out } = processCommand(state, 'continue');
      expect(out).toContain('Breakpoint hit');
      expect(newState.currentStep).toBe(1);
    });

    it('lists all steps', () => {
      const state = createDebugState(sampleTrace);
      const { output: out } = processCommand(state, 'list');
      expect(out).toContain('Step 1/5');
      expect(out).toContain('Step 5/5');
    });

    it('warns at last step', () => {
      let state = createDebugState(sampleTrace);
      for (let i = 0; i < 5; i++) state = processCommand(state, 'step').state;
      const { output: out } = processCommand(state, 'step');
      expect(out).toContain('Already at last step');
    });

    it('handles unknown commands', () => {
      const state = createDebugState(sampleTrace);
      const { output: out } = processCommand(state, 'xyz');
      expect(out).toContain('Unknown command');
    });
  });

  describe('formatDebugHeader', () => {
    it('shows trace info', () => {
      const header = formatDebugHeader(sampleTrace);
      expect(header).toContain('AgentProbe Debugger');
      expect(header).toContain('5 steps');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Assertion Builder Tests
// ═══════════════════════════════════════════════════════════════════════

describe('AssertionBuilder', () => {
  it('checks response contains', () => {
    const assertion = new AssertionBuilder()
      .that('response')
      .contains('Paris')
      .build();
    const result = assertion.evaluate(sampleTrace);
    expect(result.passed).toBe(true);
  });

  it('fails when response missing text', () => {
    const assertion = new AssertionBuilder()
      .that('response')
      .contains('London')
      .build();
    const result = assertion.evaluate(sampleTrace);
    expect(result.passed).toBe(false);
  });

  it('checks tool calls', () => {
    const assertion = new AssertionBuilder()
      .hasToolCall('search_flights')
      .build();
    const result = assertion.evaluate(sampleTrace);
    expect(result.passed).toBe(true);
  });

  it('checks tool call with args', () => {
    const assertion = new AssertionBuilder()
      .hasToolCall('search_flights', { destination: 'Paris' })
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('checks cost less than', () => {
    const assertion = new AssertionBuilder()
      .costLessThan(1.0)
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('checks completed within', () => {
    const assertion = new AssertionBuilder()
      .completedWithin(10000)
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('fails completedWithin with tight bound', () => {
    const assertion = new AssertionBuilder()
      .completedWithin(1) // 1ms — too tight
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(false);
  });

  it('chains multiple assertions', () => {
    const assertion = new AssertionBuilder()
      .that('response')
      .contains('Paris')
      .and().hasToolCall('search_flights')
      .and().costLessThan(1.0)
      .and().completedWithin(10000)
      .build();
    const result = assertion.evaluate(sampleTrace);
    expect(result.passed).toBe(true);
    expect(result.checks.length).toBe(4);
  });

  it('negates with not()', () => {
    const assertion = new AssertionBuilder()
      .that('response')
      .not().contains('London')
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('checks regex matches', () => {
    const assertion = new AssertionBuilder()
      .that('response')
      .matches(/\$\d+/)
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('checks step count', () => {
    const assertion = new AssertionBuilder()
      .stepCount(3, 10)
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('checks tokens less than', () => {
    const assertion = new AssertionBuilder()
      .tokensLessThan(1000)
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('checks tool order', () => {
    const assertion = new AssertionBuilder()
      .toolOrder('search_flights')
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('checks tool called times', () => {
    const assertion = new AssertionBuilder()
      .toolCalledTimes('search_flights', 1)
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('supports custom predicate', () => {
    const assertion = new AssertionBuilder()
      .satisfies('has-steps', t => t.steps.length > 0)
      .build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });

  it('provides summary in results', () => {
    const assertion = new AssertionBuilder()
      .contains('Paris')
      .and().contains('London')
      .build();
    const result = assertion.evaluate(sampleTrace);
    expect(result.summary).toContain('1/2');
  });

  it('toString describes checks', () => {
    const assertion = new AssertionBuilder()
      .contains('Paris')
      .build();
    const str = assertion.toString();
    expect(str).toContain('contains');
  });

  it('noErrors passes on clean trace', () => {
    const assertion = new AssertionBuilder().noErrors().build();
    expect(assertion.evaluate(sampleTrace).passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Doc Gen Tests
// ═══════════════════════════════════════════════════════════════════════

describe('DocGen', () => {
  describe('parseMarkdownEndpoints', () => {
    it('extracts endpoints from markdown', () => {
      const md = `
## GET /api/users
List all users

## POST /api/users
Create a new user

## DELETE /api/users/{id}
Delete a user
`;
      const eps = parseMarkdownEndpoints(md);
      expect(eps.length).toBe(3);
      expect(eps[0].method).toBe('get');
      expect(eps[0].path).toBe('/api/users');
      expect(eps[2].method).toBe('delete');
    });

    it('handles backtick-wrapped endpoints', () => {
      const md = '`GET` `/api/items`\n';
      const eps = parseMarkdownEndpoints(md);
      expect(eps.length).toBe(1);
    });

    it('returns empty for no endpoints', () => {
      expect(parseMarkdownEndpoints('Just some text.')).toEqual([]);
    });
  });

  describe('generateFromMarkdown', () => {
    it('generates tests from markdown docs', () => {
      const md = `## GET /api/flights\nSearch flights\n\n## POST /api/bookings\nCreate booking`;
      const result = generateFromMarkdown(md, 'api.md', { agent: 'travel-agent' });
      expect(result.format).toBe('markdown');
      expect(result.stats.totalTests).toBeGreaterThan(0);
      expect(result.stats.endpoints).toBe(2);
    });

    it('respects includeHappyPath=false', () => {
      const md = `## GET /api/test\nTest endpoint`;
      const withHappy = generateFromMarkdown(md, 'test.md', { agent: 'a', includeHappyPath: true });
      const noHappy = generateFromMarkdown(md, 'test.md', { agent: 'a', includeHappyPath: false });
      expect(noHappy.stats.totalTests).toBeLessThan(withHappy.stats.totalTests);
    });
  });

  describe('generateFromOpenAPISpec', () => {
    it('generates tests from OpenAPI spec', () => {
      const result = generateFromOpenAPISpec(miniSpec, 'spec.yaml', { agent: 'travel' });
      expect(result.format).toBe('openapi');
      expect(result.stats.endpoints).toBe(2);
      expect(result.stats.totalTests).toBeGreaterThan(0);
    });

    it('includes edge case tests', () => {
      const result = generateFromOpenAPISpec(miniSpec, 'spec.yaml', {
        agent: 'travel',
        includeEdgeCases: true,
      });
      expect(result.stats.edgeCases).toBeGreaterThan(0);
    });

    it('includes security tests when enabled', () => {
      const result = generateFromOpenAPISpec(miniSpec, 'spec.yaml', {
        agent: 'travel',
        includeSecurity: true,
      });
      expect(result.stats.security).toBeGreaterThan(0);
    });

    it('respects maxTestsPerEndpoint', () => {
      const result = generateFromOpenAPISpec(miniSpec, 'spec.yaml', {
        agent: 'travel',
        includeEdgeCases: true,
        includeSecurity: true,
        maxTestsPerEndpoint: 2,
      });
      // Each endpoint should have at most 2 tests
      const grouped = new Map<string, number>();
      for (const t of result.suite.tests) {
        const key = t.expect.tool_called;
        grouped.set(key, (grouped.get(key) ?? 0) + 1);
      }
      for (const count of grouped.values()) {
        expect(count).toBeLessThanOrEqual(2);
      }
    });

    it('generates YAML output', () => {
      const result = generateFromOpenAPISpec(miniSpec, 'spec.yaml', { agent: 'travel' });
      expect(result.yaml).toContain('Travel API');
      expect(result.yaml).toContain('search_flights');
    });

    it('filters by tags', () => {
      const all = generateFromOpenAPISpec(miniSpec, 'spec.yaml', { agent: 'travel' });
      const filtered = generateFromOpenAPISpec(miniSpec, 'spec.yaml', {
        agent: 'travel',
        tags: ['flights'],
      });
      expect(filtered.stats.totalTests).toBeLessThan(all.stats.totalTests);
    });
  });

  describe('formatDocGenStats', () => {
    it('formats stats readably', () => {
      const formatted = formatDocGenStats({
        totalTests: 25,
        happyPath: 10,
        errorHandling: 8,
        edgeCases: 7,
        security: 0,
        endpoints: 5,
      });
      expect(formatted).toContain('25 tests');
      expect(formatted).toContain('5 endpoints');
      expect(formatted).toContain('10 happy path');
    });
  });
});
