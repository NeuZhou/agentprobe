/**
 * Round 37 — v3.9.0 Tests
 *
 * - MCP Server Testing Suite (security analysis)
 * - Agent Benchmark Database
 * - Multi-Turn Conversation Tester (context_retained, args_contain)
 * - Adapter Auto-Detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// MCP Testing
import {
  evaluateMCPExpectations, validateMCPSuite, evaluateMCPSuite,
  buildMockMCPResult, formatMCPResults,
  analyzeMCPSecurity, formatMCPSecurity, isDangerousTool,
} from '../src/mcp-test';
import type { MCPToolInfo, MCPToolResult, MCPTestSuite, MCPSecurityReport } from '../src/mcp-test';

// Benchmark DB
import { BenchmarkDB, formatComparison as formatBenchmarkComparison, formatDashboard } from '../src/benchmark-db';
import type { BenchmarkResult, DashboardData, TrendData } from '../src/benchmark-db';

// Conversation
import { evaluateConversation, splitTraceByTurns, detectTone, formatConversationResult } from '../src/conversation';
import type { ConversationTest } from '../src/conversation';
import type { AgentTrace } from '../src/types';

// Auto-detect
import { autoDetect, detectFromEnv, validateKey, formatAutoDetect } from '../src/auto-detect';

// ===== MCP Security Tests =====

describe('MCP Security Analysis', () => {
  const safeTools: MCPToolInfo[] = [
    { name: 'search', description: 'Search for documents by keyword', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'get_user', description: 'Get user profile by ID', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
  ];

  const dangerousTools: MCPToolInfo[] = [
    { name: 'delete_record', description: 'Deletes a record permanently', inputSchema: {} },
    { name: 'admin_reset', description: 'Resets the system' },
    { name: 'execute_query', description: 'Execute SQL query with confirmation', inputSchema: { type: 'object', properties: { query: { type: 'string' }, confirm: { type: 'boolean' } } } },
  ];

  it('should identify dangerous tool names', () => {
    expect(isDangerousTool('delete_record')).toBe(true);
    expect(isDangerousTool('admin_panel')).toBe(true);
    expect(isDangerousTool('execute_command')).toBe(true);
    expect(isDangerousTool('search')).toBe(false);
    expect(isDangerousTool('get_user')).toBe(false);
  });

  it('should pass security checks for safe tools', () => {
    const report = analyzeMCPSecurity(safeTools);
    expect(report.passed_count).toBe(2);
    expect(report.critical_issues).toHaveLength(0);
  });

  it('should flag dangerous tools without safeguards', () => {
    const report = analyzeMCPSecurity(dangerousTools);
    expect(report.critical_issues.length).toBeGreaterThan(0);
    const deleteCheck = report.tools.find(t => t.toolName === 'delete_record');
    expect(deleteCheck?.passed).toBe(false);
  });

  it('should pass dangerous tools with confirmation parameter', () => {
    const report = analyzeMCPSecurity(dangerousTools);
    const execCheck = report.tools.find(t => t.toolName === 'execute_query');
    // execute_query has a confirm param, so the dangerous_operation_safeguard should pass
    const safeguard = execCheck?.checks.find(c => c.name === 'dangerous_operation_safeguard');
    expect(safeguard?.passed).toBe(true);
  });

  it('should flag missing input schemas on dangerous tools as critical', () => {
    const report = analyzeMCPSecurity([
      { name: 'drop_table', description: 'Drop a database table' },
    ]);
    const check = report.tools[0].checks.find(c => c.name === 'input_validation');
    expect(check?.severity).toBe('critical');
    expect(check?.passed).toBe(false);
  });

  it('should format security report with pass/fail counts', () => {
    const report = analyzeMCPSecurity([...safeTools, ...dangerousTools]);
    const output = formatMCPSecurity(report);
    expect(output).toContain('MCP Security Report');
    expect(output).toContain('tools pass security checks');
  });

  it('should compute overall score', () => {
    const report = analyzeMCPSecurity(safeTools);
    expect(report.overall_score).toBeGreaterThan(50);
  });

  it('should handle empty tools list', () => {
    const report = analyzeMCPSecurity([]);
    expect(report.tools).toHaveLength(0);
    expect(report.overall_score).toBe(100);
  });
});

// ===== MCP Suite Evaluation (existing + enhanced) =====

describe('MCP Suite Evaluation', () => {
  it('should evaluate tool result assertions', () => {
    const result = buildMockMCPResult('Found 5 documents about TypeScript', { duration_ms: 120 });
    const assertions = evaluateMCPExpectations(result, {
      output_contains: 'TypeScript',
      response_time_ms: { lt: 200 },
    });
    expect(assertions.every(a => a.passed)).toBe(true);
  });

  it('should fail on missing output content', () => {
    const result = buildMockMCPResult('No results');
    const assertions = evaluateMCPExpectations(result, {
      output_contains: 'TypeScript',
    });
    expect(assertions[0].passed).toBe(false);
  });

  it('should validate tool count', () => {
    const tools: MCPToolInfo[] = [
      { name: 'a' }, { name: 'b' }, { name: 'c' },
    ];
    const assertions = evaluateMCPExpectations(
      buildMockMCPResult(''),
      { tool_count: 3 },
      tools,
    );
    expect(assertions[0].passed).toBe(true);
  });
});

// ===== Benchmark Database Tests =====

describe('BenchmarkDB', () => {
  let dbPath: string;
  let db: BenchmarkDB;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `agentprobe-test-${Date.now()}.json`);
    db = new BenchmarkDB(dbPath);
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('should record and retrieve benchmarks', () => {
    db.record({ testName: 'test1', passed: true, duration_ms: 100 });
    const all = db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].testName).toBe('test1');
    expect(all[0].runId).toBeTruthy();
    expect(all[0].timestamp).toBeTruthy();
  });

  it('should record batch benchmarks with shared runId', () => {
    const stored = db.recordBatch([
      { testName: 'a', passed: true, duration_ms: 50 },
      { testName: 'b', passed: false, duration_ms: 200 },
    ]);
    expect(stored[0].runId).toBe(stored[1].runId);
    expect(db.getAll()).toHaveLength(2);
  });

  it('should persist data to disk', () => {
    db.record({ testName: 'persist', passed: true, duration_ms: 100 });
    const db2 = new BenchmarkDB(dbPath);
    expect(db2.getAll()).toHaveLength(1);
  });

  it('should compute trend data', () => {
    for (let i = 0; i < 5; i++) {
      db.record({ testName: 'trend-test', passed: true, duration_ms: 100 + i * 10 });
    }
    const trend = db.trend('trend-test', 30);
    expect(trend.total_runs).toBe(5);
    expect(trend.avg_duration_ms).toBeGreaterThan(0);
    expect(trend.pass_rate).toBe(1);
  });

  it('should detect improving trend', () => {
    // First half: slow, second half: fast
    for (let i = 0; i < 4; i++) {
      db.record({ testName: 'improving', passed: true, duration_ms: 500 });
    }
    for (let i = 0; i < 4; i++) {
      db.record({ testName: 'improving', passed: true, duration_ms: 200 });
    }
    const trend = db.trend('improving', 30);
    expect(trend.trend_direction).toBe('improving');
  });

  it('should compare two runs', () => {
    db.record({ testName: 'test1', passed: true, duration_ms: 100, runId: 'run-a' });
    db.record({ testName: 'test1', passed: true, duration_ms: 50, runId: 'run-b' });
    db.record({ testName: 'test2', passed: true, duration_ms: 200, runId: 'run-a' });

    const comparison = db.compare('run-a', 'run-b');
    expect(comparison.tests).toHaveLength(2);
    expect(comparison.summary.improved).toBeGreaterThanOrEqual(1);
    expect(comparison.summary.removed_tests).toBe(1); // test2 not in run-b
  });

  it('should generate dashboard data', () => {
    db.record({ testName: 'a', passed: true, duration_ms: 100, cost_usd: 0.01 });
    db.record({ testName: 'b', passed: false, duration_ms: 300, cost_usd: 0.02 });

    const dashboard = db.report();
    expect(dashboard.total_tests).toBe(2);
    expect(dashboard.overall_pass_rate).toBe(0.5);
    expect(dashboard.cost_total_usd).toBeCloseTo(0.03);
  });

  it('should format dashboard data', () => {
    db.record({ testName: 'a', passed: true, duration_ms: 100 });
    const output = formatDashboard(db.report());
    expect(output).toContain('Benchmark Dashboard');
    expect(output).toContain('Pass Rate');
  });

  it('should format comparison results', () => {
    db.record({ testName: 'x', passed: true, duration_ms: 100, runId: 'r1' });
    db.record({ testName: 'x', passed: true, duration_ms: 80, runId: 'r2' });
    const output = formatBenchmarkComparison(db.compare('r1', 'r2'));
    expect(output).toContain('Benchmark Comparison');
  });

  it('should list runs', () => {
    db.record({ testName: 'a', passed: true, duration_ms: 100, runId: 'run-1' });
    db.record({ testName: 'b', passed: true, duration_ms: 200, runId: 'run-2' });
    expect(db.listRuns()).toContain('run-1');
    expect(db.listRuns()).toContain('run-2');
  });

  it('should clear all data', () => {
    db.record({ testName: 'a', passed: true, duration_ms: 100 });
    db.clear();
    expect(db.getAll()).toHaveLength(0);
  });
});

// ===== Multi-Turn Conversation Tests =====

describe('Multi-Turn Conversation (enhanced)', () => {
  function makeTrace(steps: Array<{ type: string; content?: string; tool_name?: string; tool_args?: Record<string, any> }>): AgentTrace {
    return {
      id: 'test-trace',
      timestamp: new Date().toISOString(),
      steps: steps.map(s => ({
        type: s.type as any,
        timestamp: new Date().toISOString(),
        data: {
          content: s.content,
          tool_name: s.tool_name,
          tool_args: s.tool_args,
        },
      })),
      metadata: {},
    };
  }

  it('should evaluate context_retained for specific keys', () => {
    const trace = makeTrace([
      { type: 'tool_call', tool_name: 'search_flights', tool_args: { destination: 'Paris', date: '2024-01-15' } },
      { type: 'output', content: 'Found flights to Paris' },
      { type: 'tool_call', tool_name: 'search_flights', tool_args: { destination: 'Paris', class: 'business' } },
      { type: 'output', content: 'Business class flights to Paris' },
    ]);

    const test: ConversationTest = {
      name: 'flight booking',
      turns: [
        {
          user: 'Book a flight to Paris',
          expect: { tool_called: 'search_flights', context_retained: ['destination'] },
        },
        {
          user: 'Make it business class',
          expect: { tool_called: 'search_flights', args_contain: { class: 'business', destination: 'Paris' } },
        },
      ],
    };

    const result = evaluateConversation(trace, test);
    expect(result.turns[0].passed).toBe(true);
  });

  it('should fail args_contain when args do not match', () => {
    const trace = makeTrace([
      { type: 'tool_call', tool_name: 'search', tool_args: { q: 'hello' } },
      { type: 'output', content: 'Results' },
      { type: 'tool_call', tool_name: 'search', tool_args: { q: 'world' } },
      { type: 'output', content: 'More results' },
    ]);

    const test: ConversationTest = {
      name: 'context fail',
      turns: [
        { user: 'Search hello', expect: {} },
        { user: 'Search world', expect: { args_contain: { q: 'missing_value' } } },
      ],
    };

    const result = evaluateConversation(trace, test);
    const turn2Assertions = result.turns[1].assertions;
    const argsCheck = turn2Assertions.find(a => a.name.startsWith('args_contain'));
    expect(argsCheck?.passed).toBe(false);
  });

  it('should check context_retained across turns', () => {
    const trace = makeTrace([
      { type: 'output', content: 'Booking for destination Paris date Monday' },
      { type: 'output', content: 'Updated to business class for Paris' },
    ]);

    const test: ConversationTest = {
      name: 'context retention',
      turns: [
        { user: 'Book Paris Monday', expect: { context_retained: ['destination', 'date'] } },
        { user: 'Make it business', expect: { context_retained: ['paris'] } },
      ],
    };

    const result = evaluateConversation(trace, test);
    // Turn 2 should find "paris" in output
    const turn2Retained = result.turns[1].assertions.filter(a => a.name.startsWith('context_retained'));
    expect(turn2Retained[0]?.passed).toBe(true);
  });

  it('should format conversation results', () => {
    const trace = makeTrace([
      { type: 'output', content: 'Hello' },
    ]);
    const test: ConversationTest = {
      name: 'simple',
      turns: [{ user: 'Hi', expect: { output_contains: 'Hello' } }],
    };
    const result = evaluateConversation(trace, test);
    const formatted = formatConversationResult(result);
    expect(formatted).toContain('simple');
  });
});

// ===== Tone Detection =====

describe('Tone Detection', () => {
  it('should detect friendly tone', () => {
    const { matches } = detectTone('Hi! I am glad to help you. Thanks for reaching out!', 'friendly');
    expect(matches).toBe(true);
  });

  it('should detect formal tone', () => {
    const { matches } = detectTone('Please kindly submit your request. Regarding your inquiry, we will respond accordingly.', 'formal');
    expect(matches).toBe(true);
  });

  it('should not false-positive on unrelated text', () => {
    const { matches } = detectTone('The result is 42.', 'humorous');
    expect(matches).toBe(false);
  });
});

// ===== Adapter Auto-Detection Tests =====

describe('Adapter Auto-Detection', () => {
  it('should detect OpenAI from env', () => {
    const detected = detectFromEnv({ OPENAI_API_KEY: 'sk-test1234567890abcdef' });
    expect(detected).toHaveLength(1);
    expect(detected[0].name).toBe('openai');
    expect(detected[0].valid).toBe(true);
  });

  it('should detect multiple providers', () => {
    const detected = detectFromEnv({
      OPENAI_API_KEY: 'sk-test1234567890abcdef',
      ANTHROPIC_API_KEY: 'sk-ant-test1234567890abcdef',
    });
    expect(detected).toHaveLength(2);
  });

  it('should flag invalid keys', () => {
    const detected = detectFromEnv({ OPENAI_API_KEY: 'bad' });
    expect(detected[0].valid).toBe(false);
  });

  it('should validate key prefixes', () => {
    expect(validateKey('sk-test1234567890', 'sk-')).toBe(true);
    expect(validateKey('wrong-prefix123', 'sk-')).toBe(false);
    expect(validateKey('', 'sk-')).toBe(false);
    expect(validateKey('your-api-key-here')).toBe(false);
  });

  it('should recommend highest priority valid adapter', () => {
    const result = autoDetect({
      env: {
        ANTHROPIC_API_KEY: 'sk-ant-test1234567890abcdef',
        GROQ_API_KEY: 'gsk_test1234567890abcdef',
      },
      checkLocal: false,
    });
    expect(result.recommended?.name).toBe('anthropic');
  });

  it('should warn when no adapters found', () => {
    const result = autoDetect({ env: {}, checkLocal: false });
    expect(result.detected).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should format auto-detect output', () => {
    const result = autoDetect({
      env: { OPENAI_API_KEY: 'sk-test1234567890abcdef' },
      checkLocal: false,
    });
    const output = formatAutoDetect(result);
    expect(output).toContain('Auto-Detection');
    expect(output).toContain('OpenAI');
    expect(output).toContain('RECOMMENDED');
  });

  it('should detect Azure OpenAI', () => {
    const detected = detectFromEnv({
      AZURE_OPENAI_API_KEY: 'abc123def456ghi789jkl012',
    });
    expect(detected[0].name).toBe('azure-openai');
  });

  it('should detect Groq with prefix validation', () => {
    const detected = detectFromEnv({
      GROQ_API_KEY: 'gsk_valid_key_here_1234567890',
    });
    expect(detected[0].valid).toBe(true);

    const invalid = detectFromEnv({
      GROQ_API_KEY: 'not-a-groq-key-12345678',
    });
    expect(invalid[0].valid).toBe(false);
  });
});

// ===== Split Trace by Turns =====

describe('splitTraceByTurns', () => {
  const trace: AgentTrace = {
    id: 'split-test',
    timestamp: new Date().toISOString(),
    steps: [
      { type: 'llm_call', timestamp: '', data: {} },
      { type: 'output', timestamp: '', data: { content: 'Response 1' } },
      { type: 'llm_call', timestamp: '', data: {} },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'hello' } } },
      { type: 'output', timestamp: '', data: { content: 'Response 2' } },
    ],
    metadata: {},
  };

  it('should split into correct number of turns', () => {
    const turns = splitTraceByTurns(trace, 2);
    expect(turns).toHaveLength(2);
  });

  it('should return single trace for turnCount=1', () => {
    const turns = splitTraceByTurns(trace, 1);
    expect(turns).toHaveLength(1);
    expect(turns[0].steps).toHaveLength(trace.steps.length);
  });

  it('should handle turnCount=0', () => {
    expect(splitTraceByTurns(trace, 0)).toHaveLength(0);
  });
});
