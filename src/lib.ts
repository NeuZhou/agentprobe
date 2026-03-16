/**
 * AgentProbe - Programmatic API
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

// Validation
export {
  validateSuite,
  validateExpectations,
  validateTrace,
  formatValidationErrors,
} from './validate';
export type { ValidationError, ValidationResult } from './validate';

// Replay
export { replayTrace, formatReplayResult } from './replay';
export type { ReplayOverride, ReplayConfig, ReplayResult } from './replay';

// Templates
export { expandTemplate, registerTemplate, listTemplates, isTemplate } from './templates';

// Multi-Agent Orchestration
export { evaluateOrchestration } from './orchestration';

// Golden Tests
export { recordGolden, saveGolden, loadGolden, verifyGolden } from './golden';

// Viewer
export { formatTraceTimeline } from './viewer';

// Conversation testing
export { evaluateConversation, formatConversationResult, splitTraceByTurns } from './conversation';
export type { ConversationTest, ConversationTurn, ConversationResult, TurnResult } from './conversation';

// Scoring
export { evaluateScoring, formatScoringResult } from './scoring';
export type { ScoringConfig, ScoringResult } from './scoring';

// Natural language test generation
export { generateFromNL, formatGeneratedTestsYaml } from './nlgen';
export type { GeneratedTest } from './nlgen';

// Trace anonymizer
export { anonymize, anonymizeTrace, anonymizeString } from './anonymize';
export type { AnonymizeOptions } from './anonymize';

// Performance profiling
export { profile, formatProfile } from './profiler';
export type { ProfileResult, PercentileStats, ToolProfile } from './profiler';

// Streaming recorder
export { StreamingRecorder } from './streaming';
export type { StreamingChunk, StreamingRecorderOptions } from './streaming';

// Trace search
export { searchTraces, matchTrace, formatSearchResults } from './search';
export type { SearchOptions, SearchMatch, SearchResult } from './search';

// Trace sampling
export { sampleTraces, sampleFiles } from './sampling';
export type { SamplingOptions } from './sampling';

// Config file support
export { loadExtendedConfig, getDefaultAdapter, getAdapterConfig, resolveOutputDir } from './config-file';
export type { ExtendedConfig, AdapterConfig } from './config-file';

// Diff reporter
export { diffRuns, formatRunDiff } from './reporters/diff';
export type { RunDiff } from './reporters/diff';

// Plugin marketplace
export { searchPlugins, installPlugin, uninstallPlugin, formatMarketplace } from './marketplace';
export type { MarketplacePlugin, MarketplaceSearchResult } from './marketplace';

// Trace export
export { exportTrace, listExportFormats } from './export';
export type { ExportFormat, ExportOptions } from './export';

// Dependencies graph
export { generateDependencyGraph, formatDependencyGraph } from './deps';

// Custom assertions API
export { registerAssertion, unregisterAssertion, hasAssertion, listAssertions, evaluateCustomAssertion, clearAssertions } from './custom-assertions';
export type { CustomAssertionFn } from './custom-assertions';

// Trace comparison
export { compareTraces, formatComparison } from './trace-compare';
export type { TraceComparison } from './trace-compare';

// Interactive explorer
export { loadReport, formatTestList, formatTestDetail, runExplorer } from './explorer';

// Watch mode (enhanced)
export { startWatch, watchTraceDir } from './watcher';
export type { WatchOptions, WatchSummary } from './watcher';

// Environment profiles
export { getProfile, listProfiles } from './config-file';
export type { ProfileConfig } from './config-file';

// Types - re-export everything
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
  ChainStep,
  CustomAssertionRef,
} from './types';
