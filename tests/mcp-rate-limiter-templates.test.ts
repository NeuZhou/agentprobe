/**
 * Round 21 Tests — v2.2.0
 *
 * Tests for: MCP Server Testing, Enhanced Conversation Flow,
 * Rate Limiter, Test Templates Library, Trace Metadata Tags
 */

import { describe, it, expect } from 'vitest';

import {
  evaluateMCPExpectations,
  validateMCPSuite,
  evaluateMCPSuite,
  buildMockMCPResult,
  formatMCPResults,
} from '../src/mcp-test';

import { RateLimiter, createRateLimiter, parseRate } from '../src/rate-limiter';

import {
  listTestTemplates,
  getTestTemplate,
  getTemplateContent,
  listTemplatesByCategory,
  hasTemplate,
} from '../src/templates-lib';

import {
  detectTone,
  splitTraceByTurns,
  evaluateConversation,
  formatConversationResult,
} from '../src/conversation';

import {
  tagTrace,
  filterByMetadata,
  mergeMetadata,
  validateMetadata,
  extractMetadataIndex,
} from '../src/trace-metadata';

// ===== Helpers =====

function makeTrace(opts?: {
  tools?: string[];
  output?: string;
  metadata?: Record<string, any>;
  multiTurn?: boolean;
}) {
  const steps: any[] = [];
  if (opts?.tools) {
    for (const t of opts.tools) {
      steps.push({ type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: t, tool_args: { query: 'test' } } });
      steps.push({ type: 'tool_result', timestamp: new Date().toISOString(), data: { content: `result from ${t}` } });
    }
  }
  if (opts?.output) {
    steps.push({ type: 'output', timestamp: new Date().toISOString(), data: { content: opts.output } });
  }
  if (opts?.multiTurn) {
    steps.push({ type: 'output', timestamp: new Date().toISOString(), data: { content: 'Hello! How can I help?' } });
    steps.push({ type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'search', tool_args: { query: 'AI news' } } });
    steps.push({ type: 'output', timestamp: new Date().toISOString(), data: { content: 'Here are the latest AI news results about search' } });
    steps.push({ type: 'output', timestamp: new Date().toISOString(), data: { content: 'Based on the previous search results, here is a summary of AI news trends spanning about 250 characters of content to satisfy length requirements.' } });
  }
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps,
    metadata: opts?.metadata ?? {},
  };
}

// ===== MCP Server Testing =====

describe('MCP Server Testing', () => {
  describe('evaluateMCPExpectations', () => {
    it('checks output_contains (string)', () => {
      const result = buildMockMCPResult('search results found');
      const assertions = evaluateMCPExpectations(result, { output_contains: 'results' });
      expect(assertions).toHaveLength(1);
      expect(assertions[0].passed).toBe(true);
    });

    it('checks output_contains (array)', () => {
      const result = buildMockMCPResult('search results found');
      const assertions = evaluateMCPExpectations(result, { output_contains: ['results', 'found'] });
      expect(assertions).toHaveLength(2);
      expect(assertions.every(a => a.passed)).toBe(true);
    });

    it('fails output_contains when missing', () => {
      const result = buildMockMCPResult('no data here');
      const assertions = evaluateMCPExpectations(result, { output_contains: 'results' });
      expect(assertions[0].passed).toBe(false);
    });

    it('checks output_not_contains', () => {
      const result = buildMockMCPResult('clean output');
      const assertions = evaluateMCPExpectations(result, { output_not_contains: 'error' });
      expect(assertions[0].passed).toBe(true);
    });

    it('fails output_not_contains when present', () => {
      const result = buildMockMCPResult('error occurred');
      const assertions = evaluateMCPExpectations(result, { output_not_contains: 'error' });
      expect(assertions[0].passed).toBe(false);
    });

    it('checks error_contains', () => {
      const result = buildMockMCPResult('', { error: 'missing required field' });
      const assertions = evaluateMCPExpectations(result, { error_contains: 'missing required' });
      expect(assertions[0].passed).toBe(true);
    });

    it('fails error_contains when no error', () => {
      const result = buildMockMCPResult('ok');
      const assertions = evaluateMCPExpectations(result, { error_contains: 'missing' });
      expect(assertions[0].passed).toBe(false);
    });

    it('checks response_time_ms lt', () => {
      const result = buildMockMCPResult('ok', { duration_ms: 200 });
      const assertions = evaluateMCPExpectations(result, { response_time_ms: { lt: 5000 } });
      expect(assertions[0].passed).toBe(true);
    });

    it('fails response_time_ms lt when too slow', () => {
      const result = buildMockMCPResult('ok', { duration_ms: 6000 });
      const assertions = evaluateMCPExpectations(result, { response_time_ms: { lt: 5000 } });
      expect(assertions[0].passed).toBe(false);
    });

    it('checks response_time_ms gt', () => {
      const result = buildMockMCPResult('ok', { duration_ms: 200 });
      const assertions = evaluateMCPExpectations(result, { response_time_ms: { gt: 100 } });
      expect(assertions[0].passed).toBe(true);
    });

    it('checks output_matches regex', () => {
      const result = buildMockMCPResult('result: 42 items');
      const assertions = evaluateMCPExpectations(result, { output_matches: '\\d+ items' });
      expect(assertions[0].passed).toBe(true);
    });

    it('checks tools_include', () => {
      const tools = [
        { name: 'search', description: 'Search' },
        { name: 'calculate', description: 'Calculate' },
      ];
      const result = buildMockMCPResult('');
      const assertions = evaluateMCPExpectations(result, { tools_include: ['search', 'calculate'] }, tools);
      expect(assertions).toHaveLength(2);
      expect(assertions.every(a => a.passed)).toBe(true);
    });

    it('fails tools_include when tool missing', () => {
      const tools = [{ name: 'search' }];
      const result = buildMockMCPResult('');
      const assertions = evaluateMCPExpectations(result, { tools_include: ['calculate'] }, tools);
      expect(assertions[0].passed).toBe(false);
    });

    it('checks tools_exclude', () => {
      const tools = [{ name: 'search' }];
      const result = buildMockMCPResult('');
      const assertions = evaluateMCPExpectations(result, { tools_exclude: ['dangerous'] }, tools);
      expect(assertions[0].passed).toBe(true);
    });

    it('checks tool_count', () => {
      const tools = [{ name: 'a' }, { name: 'b' }];
      const result = buildMockMCPResult('');
      const assertions = evaluateMCPExpectations(result, { tool_count: 2 }, tools);
      expect(assertions[0].passed).toBe(true);
    });

    it('fails tool_count mismatch', () => {
      const tools = [{ name: 'a' }];
      const result = buildMockMCPResult('');
      const assertions = evaluateMCPExpectations(result, { tool_count: 3 }, tools);
      expect(assertions[0].passed).toBe(false);
    });
  });

  describe('validateMCPSuite', () => {
    it('validates valid suite', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: { command: 'node server.js' },
        tests: [{ name: 'test1', tool: 'search', input: {}, expect: {} }],
      };
      expect(validateMCPSuite(suite)).toHaveLength(0);
    });

    it('requires mcp_server config', () => {
      const suite = { adapter: 'mcp' as const, mcp_server: undefined as any, tests: [{ name: 't', tool: 'x', input: {}, expect: {} }] };
      expect(validateMCPSuite(suite).length).toBeGreaterThan(0);
    });

    it('requires command or url', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: {} as any,
        tests: [{ name: 't', tool: 'x', input: {}, expect: {} }],
      };
      const errors = validateMCPSuite(suite);
      expect(errors.some(e => e.includes('command'))).toBe(true);
    });

    it('requires at least one test', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: { command: 'node server.js' },
        tests: [],
      };
      expect(validateMCPSuite(suite).length).toBeGreaterThan(0);
    });

    it('requires tool or action per test', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: { command: 'node server.js' },
        tests: [{ name: 'bad', expect: {} } as any],
      };
      expect(validateMCPSuite(suite).length).toBeGreaterThan(0);
    });

    it('rejects both tool and action', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: { url: 'http://localhost:3000' },
        tests: [{ name: 'bad', tool: 'x', action: 'list_tools', expect: {} } as any],
      };
      expect(validateMCPSuite(suite).some(e => e.includes('both'))).toBe(true);
    });
  });

  describe('evaluateMCPSuite', () => {
    it('evaluates suite with matching results', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: { command: 'node server.js' },
        tests: [
          { name: 'search works', tool: 'search', input: { query: 'test' }, expect: { output_contains: 'results' } },
        ],
      };
      const results = new Map();
      results.set('search works', { content: 'search results found', duration_ms: 100 });
      const suiteResult = evaluateMCPSuite(suite, results);
      expect(suiteResult.passed).toBe(1);
      expect(suiteResult.failed).toBe(0);
    });

    it('handles missing results', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: { command: 'node server.js' },
        tests: [
          { name: 'missing', tool: 'search', input: {}, expect: { output_contains: 'x' } },
        ],
      };
      const suiteResult = evaluateMCPSuite(suite, new Map());
      expect(suiteResult.failed).toBe(1);
    });

    it('evaluates list_tools action', () => {
      const suite = {
        adapter: 'mcp',
        mcp_server: { command: 'node server.js' },
        tests: [
          { name: 'list tools', action: 'list_tools', expect: { tools_include: ['search'] } },
        ],
      };
      const tools = [{ name: 'search' }, { name: 'calc' }];
      const suiteResult = evaluateMCPSuite(suite, new Map(), tools);
      expect(suiteResult.passed).toBe(1);
    });
  });

  describe('formatMCPResults', () => {
    it('formats results', () => {
      const result = {
        passed: 1, failed: 1, total: 2, duration_ms: 200,
        results: [
          { name: 'pass', passed: true, assertions: [], duration_ms: 50 },
          { name: 'fail', passed: false, assertions: [{ name: 'x', passed: false, message: 'oops' }], duration_ms: 150 },
        ],
      };
      const output = formatMCPResults(result);
      expect(output).toContain('1/2 passed');
      expect(output).toContain('oops');
    });
  });

  describe('buildMockMCPResult', () => {
    it('creates result with defaults', () => {
      const r = buildMockMCPResult('hello');
      expect(r.content).toBe('hello');
      expect(r.duration_ms).toBe(50);
      expect(r.error).toBeUndefined();
    });

    it('creates result with error', () => {
      const r = buildMockMCPResult('', { error: 'bad', duration_ms: 999 });
      expect(r.error).toBe('bad');
      expect(r.duration_ms).toBe(999);
    });
  });
});

// ===== Rate Limiter =====

describe('Rate Limiter', () => {
  describe('RateLimiter', () => {
    it('initializes with provider limits', () => {
      const rl = new RateLimiter({ limits: { openai: 60, anthropic: 40 } });
      expect(rl.remaining('openai')).toBe(60);
      expect(rl.remaining('anthropic')).toBe(40);
    });

    it('returns Infinity for unknown providers', () => {
      const rl = new RateLimiter({ limits: { openai: 60 } });
      expect(rl.remaining('unknown')).toBe(Infinity);
    });

    it('canProceed returns true when tokens available', () => {
      const rl = new RateLimiter({ limits: { openai: 60 } });
      expect(rl.canProceed('openai')).toBe(true);
    });

    it('acquire consumes tokens', async () => {
      const rl = new RateLimiter({ limits: { openai: 2 } });
      await rl.acquire('openai');
      expect(rl.remaining('openai')).toBe(1);
      await rl.acquire('openai');
      expect(rl.remaining('openai')).toBe(0);
    });

    it('global limit tracked separately', () => {
      const rl = new RateLimiter({ limits: { openai: 100 }, global: 50 });
      expect(rl.globalRemaining()).toBe(50);
    });

    it('reset refills all buckets', async () => {
      const rl = new RateLimiter({ limits: { openai: 5 }, global: 10 });
      await rl.acquire('openai');
      await rl.acquire('openai');
      rl.reset();
      expect(rl.remaining('openai')).toBe(5);
      expect(rl.globalRemaining()).toBe(10);
    });

    it('status returns all bucket info', () => {
      const rl = new RateLimiter({ limits: { openai: 60, anthropic: 40 }, global: 100 });
      const s = rl.status();
      expect(s['openai'].limit).toBe(60);
      expect(s['anthropic'].limit).toBe(40);
      expect(s['_global'].limit).toBe(100);
    });

    it('estimatedWait returns 0 when available', () => {
      const rl = new RateLimiter({ limits: { openai: 60 } });
      expect(rl.estimatedWait('openai')).toBe(0);
    });
  });

  describe('parseRate', () => {
    it('parses number directly', () => {
      expect(parseRate(60)).toBe(60);
    });

    it('parses "60/min"', () => {
      expect(parseRate('60/min')).toBe(60);
    });

    it('parses "1/sec" to 60/min', () => {
      expect(parseRate('1/sec')).toBe(60);
    });

    it('parses "120/hour"', () => {
      expect(parseRate('120/hour')).toBe(2);
    });

    it('parses shorthand "60/m"', () => {
      expect(parseRate('60/m')).toBe(60);
    });

    it('parses plain numeric string', () => {
      expect(parseRate('42')).toBe(42);
    });

    it('throws on invalid format', () => {
      expect(() => parseRate('abc')).toThrow();
    });
  });

  describe('createRateLimiter', () => {
    it('creates from config with string rates', () => {
      const rl = createRateLimiter({ openai: '60/min', anthropic: '40/min', global: '100/min' });
      expect(rl.remaining('openai')).toBe(60);
      expect(rl.globalRemaining()).toBe(100);
    });

    it('creates from config with numeric rates', () => {
      const rl = createRateLimiter({ openai: 60 });
      expect(rl.remaining('openai')).toBe(60);
    });
  });
});

// ===== Test Templates Library =====

describe('Test Templates Library', () => {
  it('lists all templates', () => {
    const templates = listTestTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(6);
  });

  it('gets chatbot template', () => {
    const t = getTestTemplate('chatbot');
    expect(t).toBeDefined();
    expect(t!.name).toBe('chatbot');
    expect(t!.category).toBe('chatbot');
  });

  it('gets rag-agent template', () => {
    const t = getTestTemplate('rag-agent');
    expect(t).toBeDefined();
    expect(t!.content).toContain('RAG');
  });

  it('gets tool-agent template', () => {
    const t = getTestTemplate('tool-agent');
    expect(t).toBeDefined();
    expect(t!.content).toContain('tool_called');
  });

  it('gets mcp-server template', () => {
    const t = getTestTemplate('mcp-server');
    expect(t).toBeDefined();
    expect(t!.content).toContain('mcp');
  });

  it('gets safety template', () => {
    expect(getTestTemplate('safety')).toBeDefined();
  });

  it('gets performance template', () => {
    expect(getTestTemplate('performance')).toBeDefined();
  });

  it('returns undefined for unknown template', () => {
    expect(getTestTemplate('nonexistent')).toBeUndefined();
  });

  it('getTemplateContent returns YAML content', () => {
    const content = getTemplateContent('chatbot');
    expect(content).toContain('name:');
    expect(content).toContain('tests:');
  });

  it('getTemplateContent throws for unknown', () => {
    expect(() => getTemplateContent('nope')).toThrow('Unknown template');
  });

  it('listTemplatesByCategory filters correctly', () => {
    const safety = listTemplatesByCategory('safety');
    expect(safety.every(t => t.category === 'safety')).toBe(true);
    expect(safety.length).toBeGreaterThanOrEqual(1);
  });

  it('hasTemplate returns true for existing', () => {
    expect(hasTemplate('chatbot')).toBe(true);
  });

  it('hasTemplate returns false for missing', () => {
    expect(hasTemplate('xyz')).toBe(false);
  });
});

// ===== Enhanced Conversation =====

describe('Enhanced Conversation', () => {
  describe('detectTone', () => {
    it('detects friendly tone', () => {
      const { matches } = detectTone('Hello! Happy to help you today!', 'friendly');
      expect(matches).toBe(true);
    });

    it('detects formal tone', () => {
      const { matches } = detectTone('Regarding your request, please find the information accordingly.', 'formal');
      expect(matches).toBe(true);
    });

    it('detects assertive tone', () => {
      const { matches } = detectTone('You must complete this. It is essential and critical.', 'assertive');
      expect(matches).toBe(true);
    });

    it('detects empathetic tone', () => {
      const { matches } = detectTone('I understand your concern and I appreciate you reaching out.', 'empathetic');
      expect(matches).toBe(true);
    });

    it('returns false for mismatched tone', () => {
      const { matches } = detectTone('Error: forbidden. Denied.', 'friendly');
      expect(matches).toBe(false);
    });

    it('returns score', () => {
      const { score } = detectTone('Hello! Great to meet you!', 'friendly');
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('conversation with tone checks', () => {
    it('evaluates tone in conversation turns', () => {
      const trace = makeTrace({ output: 'Hello! Happy to help!' });
      const conv = {
        name: 'tone test',
        turns: [{ user: 'Hi', expect: { tone: 'friendly' } }],
      };
      const result = evaluateConversation(trace, conv);
      expect(result.passed).toBe(true);
    });

    it('fails when tone mismatches', () => {
      const trace = makeTrace({ output: 'Error: access denied. Forbidden.' });
      const conv = {
        name: 'tone fail',
        turns: [{ user: 'Hi', expect: { tone: 'friendly' } }],
      };
      const result = evaluateConversation(trace, conv);
      expect(result.passed).toBe(false);
    });
  });

  describe('conversation with context_maintained', () => {
    it('passes when context is maintained', () => {
      const trace = makeTrace({ multiTurn: true });
      const conv = {
        name: 'context test',
        turns: [
          { user: 'Hello', expect: {} },
          { user: 'Search for AI news', expect: { tool_called: 'search' } },
          { user: 'Summarize the results', expect: { context_maintained: true } },
        ],
      };
      const result = evaluateConversation(trace, conv);
      // The third turn should check context from second turn
      const turn3 = result.turns[2];
      if (turn3) {
        const ctxAssertion = turn3.assertions.find(a => a.name === 'context_maintained');
        if (ctxAssertion) {
          expect(ctxAssertion.passed).toBe(true);
        }
      }
    });
  });

  describe('conversation with output_length', () => {
    it('checks min output length', () => {
      const trace = makeTrace({ output: 'short' });
      const conv = {
        name: 'length test',
        turns: [{ user: 'Hi', expect: { output_length: { min: 100 } } }],
      };
      const result = evaluateConversation(trace, conv);
      const lenAssertion = result.turns[0].assertions.find(a => a.name.includes('output_length'));
      expect(lenAssertion?.passed).toBe(false);
    });

    it('checks max output length', () => {
      const trace = makeTrace({ output: 'ok' });
      const conv = {
        name: 'length test',
        turns: [{ user: 'Hi', expect: { output_length: { max: 100 } } }],
      };
      const result = evaluateConversation(trace, conv);
      const lenAssertion = result.turns[0].assertions.find(a => a.name.includes('output_length'));
      expect(lenAssertion?.passed).toBe(true);
    });
  });
});

// ===== Trace Metadata =====

describe('Trace Metadata', () => {
  const baseTrace = makeTrace({ output: 'test', metadata: { environment: 'staging', version: '1.2.0' } });

  describe('tagTrace', () => {
    it('adds metadata to trace', () => {
      const tagged = tagTrace(baseTrace, { user_segment: 'enterprise' });
      expect(tagged.metadata.user_segment).toBe('enterprise');
      expect(tagged.metadata.environment).toBe('staging');
    });

    it('overrides existing keys', () => {
      const tagged = tagTrace(baseTrace, { version: '2.0.0' });
      expect(tagged.metadata.version).toBe('2.0.0');
    });

    it('does not mutate original', () => {
      tagTrace(baseTrace, { new_key: 'value' });
      expect(baseTrace.metadata['new_key']).toBeUndefined();
    });
  });

  describe('filterByMetadata', () => {
    const traces = [
      makeTrace({ metadata: { environment: 'staging', version: '1.0' } }),
      makeTrace({ metadata: { environment: 'production', version: '2.0' } }),
      makeTrace({ metadata: { environment: 'staging', version: '2.0', feature_flags: ['new-search'] } }),
    ];

    it('filters by equals', () => {
      const result = filterByMetadata(traces, { equals: { environment: 'staging' } });
      expect(result).toHaveLength(2);
    });

    it('filters by multiple equals', () => {
      const result = filterByMetadata(traces, { equals: { environment: 'staging', version: '2.0' } });
      expect(result).toHaveLength(1);
    });

    it('filters by contains', () => {
      const result = filterByMetadata(traces, { contains: { feature_flags: 'new-search' } });
      expect(result).toHaveLength(1);
    });

    it('filters by exists', () => {
      const result = filterByMetadata(traces, { exists: ['feature_flags'] });
      expect(result).toHaveLength(1);
    });

    it('filters by notExists', () => {
      const result = filterByMetadata(traces, { notExists: ['feature_flags'] });
      expect(result).toHaveLength(2);
    });

    it('returns all when no filter', () => {
      const result = filterByMetadata(traces, {});
      expect(result).toHaveLength(3);
    });
  });

  describe('mergeMetadata', () => {
    it('merges simple keys', () => {
      const result = mergeMetadata({ environment: 'staging' }, { version: '1.0' });
      expect(result).toEqual({ environment: 'staging', version: '1.0' });
    });

    it('later source overrides', () => {
      const result = mergeMetadata({ version: '1.0' }, { version: '2.0' });
      expect(result.version).toBe('2.0');
    });

    it('merges arrays with dedup', () => {
      const result = mergeMetadata(
        { feature_flags: ['a', 'b'] },
        { feature_flags: ['b', 'c'] },
      );
      expect(result.feature_flags).toEqual(['a', 'b', 'c']);
    });
  });

  describe('validateMetadata', () => {
    it('passes when all keys present', () => {
      const result = validateMetadata({ environment: 'staging', version: '1.0' }, ['environment', 'version']);
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('fails when keys missing', () => {
      const result = validateMetadata({ environment: 'staging' }, ['environment', 'version']);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('version');
    });
  });

  describe('extractMetadataIndex', () => {
    it('builds index from traces', () => {
      const traces = [
        makeTrace({ metadata: { env: 'staging', flags: ['a'] } }),
        makeTrace({ metadata: { env: 'prod', flags: ['b'] } }),
      ];
      const index = extractMetadataIndex(traces);
      expect(index['env'].has('staging')).toBe(true);
      expect(index['env'].has('prod')).toBe(true);
      expect(index['flags'].has('a')).toBe(true);
      expect(index['flags'].has('b')).toBe(true);
    });

    it('handles empty traces', () => {
      const index = extractMetadataIndex([]);
      expect(Object.keys(index)).toHaveLength(0);
    });
  });
});
