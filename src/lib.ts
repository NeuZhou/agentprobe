/**
 * AgentProbe — Programmatic API
 *
 * Library entry point (separate from CLI).
 *
 * @example
 * ```typescript
 * import { runSuite, evaluate, Recorder, MockToolkit, FaultInjector } from 'agentprobe';
 * import type { AgentTrace, TestSuite, Expectations, SuiteResult } from 'agentprobe';
 *
 * // Run a suite
 * const results = await runSuite('tests.yaml');
 * console.log(`${results.passed}/${results.total} passed`);
 *
 * // Evaluate a single trace
 * const trace = loadTrace('trace.json');
 * const assertions = evaluate(trace, { tool_called: 'search', max_steps: 10 });
 * ```
 */

// Core evaluation
export { evaluate } from './assertions';
export { evaluateComposed, evaluateAllOf, evaluateAnyOf, evaluateNoneOf } from './compose';

// Runner
export { runSuite } from './runner';

// Recording
export { Recorder, loadTrace } from './recorder';

// Mocking & Fault Injection
export { MockToolkit } from './mocks';
export { FaultInjector } from './faults';

// Reporters
export { report } from './reporter';
export { reportJUnit } from './reporters/junit';

// Trace operations
export { mergeTraces, splitTrace } from './merge';
export type { MergedTrace, MergedStep } from './merge';

// Code generation
export { generateTests } from './codegen';

// Security
export { generateSecurityTests } from './security';

// Stats
export { computeStats, formatStats } from './stats';

// Cost
export { calculateCost, formatCostReport } from './cost';

// Coverage
export { analyzeCoverage, formatCoverage } from './coverage';

// Types — re-export everything
export type {
  AgentTrace,
  TraceStep,
  StepType,
  Message,
  ToolCall,
  TestSuite,
  TestCase,
  TestConfig,
  TestResult,
  SuiteResult,
  AssertionResult,
  Expectations,
  ReportFormat,
  RunOptions,
  FaultSpec,
  JudgeSpec,
  AgentConfig,
  HookConfig,
  SuiteHooks,
} from './types';
