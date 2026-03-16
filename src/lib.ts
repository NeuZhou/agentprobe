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
export { mergeTraces, splitTrace, formatMergedConversation } from './merge';
export type { MergedTrace, MergedStep, HandoffPoint, ContextFlow } from './merge';

// Code generation
export { generateTests, generateFromNLEnhanced, generateFromNLMultiEnhanced } from './codegen';
export {
  detailedLatencyBreakdown, stepPercentiles, identifyBottleneck,
  formatDetailedBreakdown,
} from './perf-profiler';
export type { DetailedLatencyBreakdown, PercentileSet } from './perf-profiler';

// Security
export { generateSecurityTests } from './security';

// Stats
export { computeStats, formatStats, computeDetailedStats, formatDetailedStats } from './stats';
export type { DetailedStats } from './stats';

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

// Test suggestions
export { suggestTests, formatSuggestions } from './suggest';
export type { TestSuggestion } from './suggest';

// Trace validation
export { validateTraceFormat, validateTraceFile, formatTraceValidation } from './trace-validator';
export type { TraceValidationResult, TraceValidationMessage } from './trace-validator';

// Regression manager
export {
  addRegressionSnapshot,
  loadRegressionSnapshot,
  listRegressionSnapshots,
  compareRegressionSnapshots,
  formatRegressionComparison,
  formatSnapshotList,
} from './regression-manager';
export type { RegressionSnapshot, RegressionComparison } from './regression-manager';

// Budget enforcement
export { checkBudget, getDailyCost, recordCost, formatBudgetCheck } from './budget';
export type { BudgetConfig, BudgetCheck } from './budget';

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

// OpenTelemetry integration
export { traceToOTel, traceToOTLP, OTelExporter, toJaegerSpans, toZipkinSpans } from './otel';
export type { OTelSpan, OTelExport, OTelExporterConfig, OTelFormat, OTelMetric, OTelMetricsExport, JaegerSpan, ZipkinSpan } from './otel';
export { TraceStore } from './trace-store';
export type { TraceSearchQuery, TraceStoreStats } from './trace-store';
export { findAffectedSuites, formatWatchEvent, formatWatchSession, startSmartWatch } from './watch';
export type { SmartWatchOptions, WatchEvent, WatchSession } from './watch';
export { generateConfig, generateSampleTests, generateProfiles, executeInit, formatInitResult } from './init';
export type { AdapterChoice, InitOptions, InitResult } from './init';
export { runDoctor, formatDoctor, checkNodeVersion, checkTypeScript, checkApiKey, checkTestDirectory, checkConfigFile } from './doctor';
export type { DoctorCheck, DoctorResult, CheckStatus } from './doctor';

// Flaky test detection
export { detectFlaky, formatFlaky } from './flaky';
export type { FlakyResult, FlakySuiteResult } from './flaky';

// Test impact analysis
export { analyzeImpact, formatImpact, parseGitDiffOutput, estimateSavings } from './impact';
export type { ImpactResult, ImpactedTest } from './impact';

// Assertion builder
export { buildAssertion, buildSuite, parseBuilderInput } from './builder';
export type { BuilderAnswers } from './builder';

// Benchmark suites
export { getBenchmarkSuite, listBenchmarkSuites } from './benchmarks';
export type { BenchmarkSuite } from './benchmarks';

// Compliance framework
export { checkCompliance, checkComplianceDir, loadComplianceConfig, formatComplianceResult } from './compliance';
export type { CompliancePolicy, ComplianceConfig, ComplianceViolation, ComplianceResult } from './compliance';

// Trace simulator
export { simulateTrace, simulateBatch } from './simulator';
export type { SimulatorOptions, SimulatedTrace } from './simulator';

// Webhook notifications — see v3.5.0 section below

// Test prioritization
export { prioritizeTests, loadHistory, saveHistory, updateHistory, formatPrioritization } from './prioritize';
export type { PrioritizedTest, PrioritizationResult } from './prioritize';

// Report comparison
export { compareReports, formatReportDelta, generateDeltaHTML } from './reporters/compare';
export type { ReportDelta } from './reporters/compare';

// Portal
export { generatePortal, buildPortalData, generatePortalHTML, loadReports, computeTrends, computeFlaky, computeSlowest, computeCosts, detectGaps } from './portal';
export type { PortalOptions, PortalData, TrendPoint, FlakyEntry, SlowestEntry, CostEntry, CoverageGap } from './portal';

// Health check
export { checkHealth, formatHealth } from './health';
export type { AdapterHealthResult, HealthCheckResult } from './health';

// Test matrix
export { generateCombinations, buildMatrixResult, parseMatrixOptions, loadMatrixTests, formatMatrix } from './matrix';
export type { MatrixConfig, MatrixCell, MatrixResult } from './matrix';

// Performance regression
export { loadPerfReport, detectPerfChanges, formatPerfChanges, buildDurationMap } from './perf-regression';
export type { PerfChange, PerfRegressionResult, PerfCheckOptions } from './perf-regression';

// Enhanced anonymization
export { anonymizeWithReport, anonymizeReversible, deanonymize, formatAnonymizationReport } from './anonymize';
export type { AnonymizationReport, AnonymizationRedaction, AnonymizationMapping } from './anonymize';

// SDK — High-level programmatic API
export { AgentProbe } from './sdk';
export type { AgentProbeOptions, AdapterType, TestOptions, RecordOptions, DiffResult, BatchTestResult } from './sdk';

// Streaming progress
export { ProgressTracker, renderProgressBar, formatEntry, formatProgress, fromSuiteResult } from './progress';
export type { TestStatus, ProgressEntry, ProgressState, ProgressOptions, ProgressCallback } from './progress';

// Snapshot update
export { planSnapshotUpdate, formatUpdatePlan, applySnapshotUpdate, hasOutdatedSnapshots } from './snapshot-update';
export type { SnapshotDiff, SnapshotUpdatePlan, SnapshotFileUpdate } from './snapshot-update';

// Error catalog
export { AgentProbeError, getError, getAllErrors, getErrorsByCategory, formatError, formatErrorCatalog } from './errors';
export type { ErrorInfo, ErrorCategory } from './errors';

// Trace compression
export { compressTrace, decompressTrace, compressDirectory, decompressDirectory, compressToFile, decompressFromFile, formatCompressionStats } from './compress';
export type { CompressedArchive, CompressedEntry, CompressionStats } from './compress';

// MCP Server
export { AgentProbeMCPServer, startMCPServer } from './mcp-server';
export type { MCPToolDefinition, MCPServerOptions } from './mcp-server';

// MCP Protocol
export { ErrorCodes, encodeMessage, parseMessages, createRequest, createResponse, createErrorResponse, createNotification, validateRequest, isNotification, isResponse } from './mcp-protocol';
export type { JSONRPCRequest, JSONRPCResponse, JSONRPCNotification, JSONRPCError, JSONRPCMessage } from './mcp-protocol';

// MCP Config
export { generateMCPConfig, generateClaudeConfig, generateCursorConfig, generateOpenClawConfig, formatMCPConfig, listMCPClients } from './mcp-config';
export type { MCPClientType, MCPConfigOptions, MCPClientConfig } from './mcp-config';

// MCP Server Testing
export { evaluateMCPExpectations, validateMCPSuite, evaluateMCPSuite, buildMockMCPResult, formatMCPResults, analyzeMCPSecurity, formatMCPSecurity, isDangerousTool } from './mcp-test';
export type { MCPServerConfig, MCPExpectations, MCPTestCase, MCPTestSuite, MCPToolInfo, MCPToolResult, MCPTestResult, MCPSuiteResult, MCPSecurityCheck, MCPSecurityCheckItem, MCPSecurityReport } from './mcp-test';

// Rate Limiter
export { RateLimiter, createRateLimiter, parseRate } from './rate-limiter';
export type { RateLimitConfig, RateLimiterOptions } from './rate-limiter';

// Test Templates Library
export { listTestTemplates, getTestTemplate, getTemplateContent, listTemplatesByCategory, hasTemplate } from './templates-lib';
export type { TestTemplate } from './templates-lib';

// Enhanced Conversation (tone detection, context maintenance)
export { detectTone } from './conversation';
export type { ToneLabel, ConversationExpectations } from './conversation';

// Adapter Auto-Detection
export { autoDetect, detectFromEnv, detectFromConfig, formatAutoDetect, validateKey } from './auto-detect';
export type { DetectedAdapter, AutoDetectResult } from './auto-detect';

// Benchmark Database
export { BenchmarkDB, formatComparison as formatBenchmarkComparison, formatDashboard } from './benchmark-db';
export type { BenchmarkResult, StoredBenchmark, TrendData, TrendPoint as BenchmarkTrendPoint, ComparisonResult as BenchmarkComparisonResult, ComparisonEntry, DashboardData } from './benchmark-db';

// Trace Metadata
export { tagTrace, filterByMetadata, mergeMetadata, validateMetadata, extractMetadataIndex } from './trace-metadata';
export type { TraceMetadata, MetadataFilter } from './trace-metadata';

// Multi-Agent Testing
export { AgentRegistry, parseMultiAgentConfig, detectDelegation, evaluateConversationStep, formatMultiAgentResult } from './multi-agent';
export type { AgentDefinition, MultiAgentTest, MultiAgentResult, DelegationEvent, ConversationStepResult } from './multi-agent';

// Cost Optimizer
export { analyzeTestCosts, findDuplicateTests, optimizeCosts, formatCostOptimization } from './cost-optimizer';
export type { CostOptimizationReport, CostRecommendation, TestCostEntry } from './cost-optimizer';

// Regression Detector
export { createSnapshot, compareSnapshots, formatRegressionReport, DEFAULT_THRESHOLDS } from './regression-detector';
export type { ReportSnapshot, TestSnapshot, RegressionChange, RegressionReport, RegressionThresholds } from './regression-detector';

// Environment Profiles
export { loadProfiles, resolveProfile, validateProfile, applyProfile, formatProfiles, listProfileNames, scaffoldProfiles } from './profiles';
export type { EnvironmentProfile, ProfilesConfig } from './profiles';

// Enhanced Plugin System
export { registerPlugin, unregisterPlugin, getRegisteredPlugins, getPlugin, clearAllPlugins, runPluginHook, watchPlugin, unwatchPlugin } from './plugins';
export type { AgentProbePlugin, PluginHooks } from './plugins';

// v2.6.0 — Benchmark Suite
export { getStandardBenchmark, loadBenchmarkSuite, scoreBenchmark, formatBenchmarkReport, listBenchmarkSuiteNames } from './benchmark-suite';
export type { BenchmarkTask, BenchmarkSuiteConfig, BenchmarkCategoryScore, BenchmarkReport } from './benchmark-suite';

// v2.6.0 — Flaky Detector
export { analyzeFlakiness, detectFlakyTests, formatFlakyReport } from './flaky-detector';
export type { FlakyTestReport, FlakyDetectorConfig } from './flaky-detector';

// v2.6.0 — Trace Similarity
export { toolSequenceSimilarity, outputSimilarity, traceSimilarity, findSimilarTraces, formatSimilarityResults } from './similarity';
export type { SimilarityResult } from './similarity';

// v2.6.0 — Coverage Map
export { buildCoverageMap, formatCoverageMap, coverageMapFromFile } from './coverage-map';
export type { CoverageCategory, CoverageEntry, CoverageMap } from './coverage-map';

// v2.6.0 — Notification Hub — see v3.5.0 section below

// v2.8.0 — Agent Debugger
export {
  formatStep, buildContext, formatContext, matchesBreakpoint,
  parseBreakpoint, createDebugState, processCommand, formatDebugHeader,
} from './debugger';
export type { DebugBreakpoint, DebugContext, DebugState } from './debugger';

// v2.8.0 — Trace Recorder Middleware
export {
  createTraceBuffer, flushTraceBuffer, addToBuffer,
  buildTraceFromHTTP, agentProbeMiddleware, withAgentProbe, formatMiddlewareStats,
} from './middleware';
export type { MiddlewareOptions, TraceBuffer, WrapperOptions } from './middleware';

// v2.8.0 — Test Scheduler
export {
  parseCronField, parseCron, matchesCron, nextCronMatch,
  validateSchedule, getDueEntries, resolveEntry, createRun,
  formatSchedule, formatRun,
} from './scheduler';
export type { ScheduleEntry, ScheduleConfig, ScheduleRun } from './scheduler';

// v2.8.0 — Agent Contract Testing
export {
  parseContract, checkCapabilities, checkBehaviors, checkSafety,
  verifyContract, formatContractResult,
} from './contract';
export type { CapabilitySpec, AgentContract, ContractViolation, ContractResult } from './contract';

// v2.8.0 — Trace Format Converters
export {
  toLangSmith, toOpenTelemetry, toArize, fromLangSmith,
  fromOpenTelemetry, fromArize, convertTrace, listFormats, detectFormat,
} from './converters';
export type { TraceFormat, LangSmithRun, LangSmithTrace, ArizeSpan, ArizeTrace } from './converters';

// v2.9.0
export {
  loadGovernanceData, generateGovernanceDashboard, formatGovernance, computeFleetOverview,
} from './governance';
export type { AgentReport, GovernanceData, FleetOverview } from './governance';

export { detectAnomalies, formatAnomalies } from './anomaly';
export type { AnomalyResult, Anomaly, BaselineStats } from './anomaly';

export { profilePerformance, formatPerformanceProfile } from './behavior-profiler';
export type { PerformanceProfile } from './behavior-profiler';

export { generateFromNLMulti } from './nlgen';

export { getTheme, applyTheme, getThemeNames, listThemes, formatThemes } from './themes';
export type { Theme } from './themes';

// v3.2.0 - Load Testing
export {
  parseDuration, percentile, aggregateResults, classifyError,
  formatLoadTestResult,
} from './load-test';
export type { LoadTestConfig, LoadTestResult, LoadTestError } from './load-test';

// v3.2.0 - Trace Search Engine
export {
  tokenize, scoreStep, scoreTrace, extractPreview,
  searchEngine, formatSearchEngineResult,
} from './search-engine';
export type { SearchEngineOptions, SearchHit, SearchEngineResult } from './search-engine';

// v3.2.0 - Health Dashboard
export {
  collectDashboardMetrics, formatUptime, generateDashboardHTML,
} from './health-dashboard';
export type { DashboardConfig, DashboardMetrics, DashboardRun } from './health-dashboard';

// v3.2.0 - Test Migration
export {
  convertPromptFoo, convertDeepEval, convertLangSmith,
  migrate, formatMigrateResult,
} from './migrate';
export type { SourceFormat, MigrateOptions, MigrateResult, AgentProbeTest } from './migrate';

// v3.2.0 - Smart Trace Sampling
export {
  matchesPriorityRule, createSampler,
} from './recorder';
export type { SamplingStrategy, PriorityRule, TraceSamplingConfig } from './recorder';

// v3.5.0 - Agent Fingerprinting (enhanced)
export {
  buildFingerprint, loadTraces, formatFingerprint,
  compareFingerprints, detectDrift, AgentFingerprinter,
} from './fingerprint';
export type {
  AgentFingerprint, ToolUsage, ErrorRecovery,
  DriftDimension, DriftReport,
} from './fingerprint';

// v3.5.0 - Flake Manager
export {
  FlakeManager, formatFlakeReport,
} from './flake-manager';
export type {
  FlakeEntry, FlakeRecord, FlakeReport, FlakeManagerConfig,
} from './flake-manager';

// v3.5.0 - Trace Timeline Viewer
export {
  parseTimeline, formatTimelineAscii, generateTimelineHTML, writeTimelineHTML,
} from './timeline';
export type { TimelineEvent, TimelineSummary } from './timeline';

// v3.5.0 - Agent Version Registry
export {
  VersionRegistry, formatVersionDiff,
} from './version-registry';
export type {
  AgentMeta, VersionEntry, VersionDiff, DiffChange,
} from './version-registry';

// v3.5.0 - Webhook Notifications (re-export)
export {
  buildPayload, formatWebhookPayload, sendWebhook, triggerWebhooks,
  buildPagerDutyPayload, buildEmailBody,
  sendNotification, triggerNotifications,
} from './webhooks';
export type {
  WebhookConfig, WebhookPayload, WebhooksConfig, WebhookFormat, WebhookEvent,
  NotificationConfig, NotificationHubConfig, NotificationType,
  SlackNotificationConfig, PagerDutyNotificationConfig, HttpNotificationConfig, EmailNotificationConfig,
} from './webhooks';

// v3.6.0 - Agent Sandbox
export {
  AgentSandbox, validateSandboxConfig, isToolAllowed, estimateCostFromSteps,
  checkViolations, buildSandboxResult, computeSandboxStats, formatSandboxResult,
} from './sandbox';
export type {
  SandboxConfig, SandboxViolation, SandboxResult, SandboxStats,
} from './sandbox';

// v3.6.0 - Regression Test Generator
export {
  extractIntent, extractToolSequence, extractErrors, normalizeIntent,
  groupByIntent, groupByToolPattern, findErrorTraces, detectPatterns,
  generateTestFromPattern, generateRegressionTests, toTestCases, formatRegressionGenResult,
} from './regression-gen';
export type {
  RegressionTestConfig, TracePattern, GeneratedRegressionTest, RegressionGenResult,
} from './regression-gen';

// v3.6.0 - Multi-Model Comparison
export {
  parseModelNames, extractMetrics, buildComparisonMatrix, scoreModel,
  compareModels, formatComparisonTable, generateComparisonHTML,
} from './model-compare';
export type {
  ModelConfig, ModelMetrics, ComparisonResult, ComparisonCell, ComparisonConfig,
} from './model-compare';

// v3.6.0 - Test Coverage Analyzer
export {
  extractTestedTools, analyzeToolCoverage, extractIntentsFromTraces,
  analyzeIntentCoverage, analyzeErrorPathCoverage, analyzeSafetyCoverage,
  analyzeCoverageComplete, formatCoverageAnalysis,
} from './coverage-analyzer';
export type {
  CoverageConfig, ToolCoverageResult, IntentCoverageResult,
  ErrorPathCoverageResult, SafetyCoverageResult, CoverageAnalysis,
} from './coverage-analyzer';

// v3.6.0 - Config Validator
export {
  validateConfigStructure, validateAdapters, validateHooks, validatePlugins,
  validateConfig, formatConfigValidation,
} from './config-validator';
export type {
  ConfigValidationIssue, ConfigValidationResult, AdapterKeyInfo, PluginInfo, ConfigShape,
} from './config-validator';

// v4.0.0 - Visual Test Studio
export {
  loadStudioData, generateStudioHTML, writeStudio, studioFromSuiteResult,
} from './studio';
export type {
  StudioConfig, StudioTestEntry, StudioData,
} from './studio';

// v4.0.0 - Test Orchestrator
export {
  TestOrchestrator, createOrchestrator, formatOrchestratorResult,
} from './orchestrator';
export type {
  AgentConfig as OrchestratorAgentConfig, Interaction, FlowMode, FlowStep,
  OrchestratorContext, AgentRunResult, InteractionResult, OrchestratorResult,
} from './orchestrator';

// v4.0.0 - Enhanced Contracts (guarantees, named behaviors)
export {
  checkGuarantees, checkNamedBehavior,
} from './contract';
export type {
  GuaranteeSpec, BehaviorGuarantee,
} from './contract';

// v4.1.0 - Git Integration
export {
  parseCommitLine, parseDiffStat, parseNumstat,
  diffSuiteResults, buildCommitResult, generateGitReport, calculateTrend, formatGitReport,
  parseBisectExpression, bisectSearch, formatBisectResult,
} from './git-integration';
export type {
  CommitTestResult, GitReport, GitTrend, BisectOptions, BisectResult, GitDiffFile, GitDiff,
} from './git-integration';

// v4.1.0 - Natural Language Assertions
export {
  parseNLAssertion, categorizeAssertion, extractKeywords,
  evaluateNLAssertion, evaluateNLTest, nlResultsToAssertions, formatNLResults,
} from './nl-assert';
export type {
  NLAssertion, NLAssertionCategory, NLTestCase, NLTestSuite, NLEvalResult, NLTestResult,
} from './nl-assert';

// v4.2.0 - Compliance Framework
export { ComplianceFramework, formatFrameworkReport } from './compliance-framework';
export type {
  ComplianceRule, ComplianceCheckResult, ComplianceFinding, ComplianceReport as FrameworkComplianceReport,
  RegulationResult,
} from './compliance-framework';

// v4.2.0 - Test Dependency Analyzer
export { TestDependencyAnalyzer, formatExecutionPlan } from './test-deps';
export type {
  DependencyGraph as TestDependencyGraph, TestNode, TestGroup, TestChain, TestExecutionPlan,
} from './test-deps';

// v4.2.0 - Snapshot Approval Workflow
export {
  loadApprovalState, saveApprovalState, submitForReview, approveSnapshot,
  rejectSnapshot, getApprovalSummary, getPendingReviews, formatApprovalState,
  diffSnapshots,
} from './snapshot-approval';
export type {
  SnapshotRecord, SnapshotStatus, ApprovalState, ApprovalSummary, SnapshotFieldDiff,
} from './snapshot-approval';

// v4.3.0 - Fluent Assertion Builder
export {
  AssertionBuilder,
} from './assertion-builder';
export type {
  AssertionTarget, AssertionCheck, AssertionCheckResult, BuiltAssertion,
} from './assertion-builder';
export type { AssertionResult as FluentAssertionResult } from './assertion-builder';

// v4.3.0 - Test Generator from Docs
export {
  generateFromDocs, generateFromOpenAPIFile, generateFromOpenAPISpec,
  generateFromMarkdown, generateFromMarkdownFile, parseMarkdownEndpoints,
  formatDocGenStats,
} from './doc-gen';
export type {
  DocGenOptions, DocGenResult, DocGenStats, MarkdownEndpoint,
} from './doc-gen';
