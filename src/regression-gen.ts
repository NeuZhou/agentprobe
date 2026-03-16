/**
 * Regression Test Generator — Auto-generate regression tests from production traces
 * Analyzes traces to identify common intents, error paths, and tool usage patterns.
 * @module
 */

import type { AgentTrace, TraceStep, TestCase, Expectations } from './types';

export interface RegressionTestConfig {
  minTraces?: number;
  maxTests?: number;
  includeErrorPaths?: boolean;
  includeToolPatterns?: boolean;
  includeIntents?: boolean;
  confidenceThreshold?: number;
}

export interface TracePattern {
  type: 'intent' | 'error_path' | 'tool_pattern';
  name: string;
  frequency: number;
  confidence: number;
  exampleTraceIds: string[];
}

export interface GeneratedRegressionTest {
  name: string;
  source: 'intent' | 'error_path' | 'tool_pattern';
  input: string;
  expectations: Expectations;
  basedOn: string[];  // trace ids
  confidence: number;
}

export interface RegressionGenResult {
  totalTraces: number;
  patternsFound: TracePattern[];
  testsGenerated: GeneratedRegressionTest[];
  coverage: {
    intents: number;
    errorPaths: number;
    toolPatterns: number;
  };
}

/**
 * Extract the user intent (first user message) from a trace
 */
export function extractIntent(trace: AgentTrace): string | null {
  for (const step of trace.steps) {
    if (step.type === 'llm_call' && step.data.messages) {
      const userMsg = step.data.messages.find(m => m.role === 'user');
      if (userMsg) return userMsg.content;
    }
  }
  return null;
}

/**
 * Extract tool sequence from a trace
 */
export function extractToolSequence(trace: AgentTrace): string[] {
  return trace.steps
    .filter(s => s.type === 'tool_call' && s.data.tool_name)
    .map(s => s.data.tool_name!);
}

/**
 * Extract error steps from a trace
 */
export function extractErrors(trace: AgentTrace): TraceStep[] {
  return trace.steps.filter(s =>
    (s.type === 'tool_result' && s.data.tool_result && typeof s.data.tool_result === 'object' && s.data.tool_result.error) ||
    (s.type === 'output' && s.data.content && /error|fail|exception/i.test(s.data.content))
  );
}

/**
 * Normalize intent string for grouping
 */
export function normalizeIntent(intent: string): string {
  return intent.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Group traces by their primary intent
 */
export function groupByIntent(traces: AgentTrace[]): Map<string, AgentTrace[]> {
  const groups = new Map<string, AgentTrace[]>();
  for (const trace of traces) {
    const intent = extractIntent(trace);
    if (!intent) continue;
    const key = normalizeIntent(intent);
    const group = groups.get(key) ?? [];
    group.push(trace);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Group traces by tool usage pattern (tool sequence as key)
 */
export function groupByToolPattern(traces: AgentTrace[]): Map<string, AgentTrace[]> {
  const groups = new Map<string, AgentTrace[]>();
  for (const trace of traces) {
    const seq = extractToolSequence(trace);
    if (seq.length === 0) continue;
    const key = seq.join(' → ');
    const group = groups.get(key) ?? [];
    group.push(trace);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Find traces that contain errors
 */
export function findErrorTraces(traces: AgentTrace[]): AgentTrace[] {
  return traces.filter(t => extractErrors(t).length > 0);
}

/**
 * Detect patterns from a collection of traces
 */
export function detectPatterns(traces: AgentTrace[], config: RegressionTestConfig = {}): TracePattern[] {
  const threshold = config.confidenceThreshold ?? 0.3;
  const patterns: TracePattern[] = [];

  // Intent patterns
  if (config.includeIntents !== false) {
    const intentGroups = groupByIntent(traces);
    for (const [intent, group] of intentGroups) {
      const freq = group.length / traces.length;
      if (freq >= threshold || group.length >= 3) {
        patterns.push({
          type: 'intent',
          name: intent.slice(0, 80),
          frequency: group.length,
          confidence: Math.min(freq * 2, 1),
          exampleTraceIds: group.slice(0, 3).map(t => t.id),
        });
      }
    }
  }

  // Tool patterns
  if (config.includeToolPatterns !== false) {
    const toolGroups = groupByToolPattern(traces);
    for (const [pattern, group] of toolGroups) {
      const freq = group.length / traces.length;
      if (freq >= threshold || group.length >= 2) {
        patterns.push({
          type: 'tool_pattern',
          name: pattern,
          frequency: group.length,
          confidence: Math.min(freq * 2, 1),
          exampleTraceIds: group.slice(0, 3).map(t => t.id),
        });
      }
    }
  }

  // Error paths
  if (config.includeErrorPaths !== false) {
    const errorTraces = findErrorTraces(traces);
    if (errorTraces.length > 0) {
      // Group error traces by the tool that failed
      const errorGroups = new Map<string, AgentTrace[]>();
      for (const trace of errorTraces) {
        const errors = extractErrors(trace);
        const key = errors.map(e => e.data.tool_name ?? 'output').join(',');
        const group = errorGroups.get(key) ?? [];
        group.push(trace);
        errorGroups.set(key, group);
      }
      for (const [errorKey, group] of errorGroups) {
        patterns.push({
          type: 'error_path',
          name: `error: ${errorKey}`,
          frequency: group.length,
          confidence: Math.min(group.length / errorTraces.length, 1),
          exampleTraceIds: group.slice(0, 3).map(t => t.id),
        });
      }
    }
  }

  return patterns.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Generate a regression test from a pattern and example trace
 */
export function generateTestFromPattern(pattern: TracePattern, exampleTrace: AgentTrace): GeneratedRegressionTest {
  const intent = extractIntent(exampleTrace) ?? 'unknown input';
  const tools = extractToolSequence(exampleTrace);
  const expectations: Expectations = {};

  switch (pattern.type) {
    case 'intent':
      if (tools.length > 0) expectations.tool_called = tools[0];
      expectations.max_steps = Math.max(exampleTrace.steps.length * 2, 10);
      break;
    case 'tool_pattern':
      expectations.tool_sequence = tools;
      break;
    case 'error_path':
      if (tools.length > 0) expectations.tool_called = tools;
      break;
  }

  return {
    name: `regression: ${pattern.name}`,
    source: pattern.type,
    input: intent,
    expectations,
    basedOn: pattern.exampleTraceIds,
    confidence: pattern.confidence,
  };
}

/**
 * Generate regression tests from traces
 */
export function generateRegressionTests(traces: AgentTrace[], config: RegressionTestConfig = {}): RegressionGenResult {
  const maxTests = config.maxTests ?? 50;
  const patterns = detectPatterns(traces, config);
  const tests: GeneratedRegressionTest[] = [];

  const traceMap = new Map(traces.map(t => [t.id, t]));

  for (const pattern of patterns) {
    if (tests.length >= maxTests) break;
    const exampleId = pattern.exampleTraceIds[0];
    const example = traceMap.get(exampleId);
    if (!example) continue;
    tests.push(generateTestFromPattern(pattern, example));
  }

  return {
    totalTraces: traces.length,
    patternsFound: patterns,
    testsGenerated: tests,
    coverage: {
      intents: patterns.filter(p => p.type === 'intent').length,
      errorPaths: patterns.filter(p => p.type === 'error_path').length,
      toolPatterns: patterns.filter(p => p.type === 'tool_pattern').length,
    },
  };
}

/**
 * Convert generated tests to TestCase format
 */
export function toTestCases(generated: GeneratedRegressionTest[]): TestCase[] {
  return generated.map(g => ({
    name: g.name,
    input: g.input,
    tags: ['regression', g.source],
    expect: g.expectations,
  }));
}

/**
 * Format regression generation result
 */
export function formatRegressionGenResult(result: RegressionGenResult): string {
  const lines: string[] = [];
  lines.push(`🔄 Regression Test Generator`);
  lines.push(`  Analyzed ${result.totalTraces} traces`);
  lines.push(`  Generated ${result.testsGenerated.length} regression tests covering:`);
  lines.push(`  - ${result.coverage.intents} common user intents`);
  lines.push(`  - ${result.coverage.errorPaths} error handling paths`);
  lines.push(`  - ${result.coverage.toolPatterns} tool usage patterns`);
  if (result.patternsFound.length > 0) {
    lines.push(`  Top patterns:`);
    for (const p of result.patternsFound.slice(0, 5)) {
      lines.push(`    [${p.type}] ${p.name} (freq: ${p.frequency}, conf: ${(p.confidence * 100).toFixed(0)}%)`);
    }
  }
  return lines.join('\n');
}
