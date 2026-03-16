# Changelog

All notable changes to AgentProbe are documented here.

## [4.5.0] - 2026-03-17

### Added
- **Agent Playground** (`src/playground.ts`) — Interactive test playground with session management, message sending, tool calling, recording to YAML, and replay with assertions
- **Test Reporter Plugins** — Multiple output formats:
  - `reporters/json.ts` — Structured JSON report with token/cost/summary metadata
  - `reporters/markdown.ts` — Detailed Markdown report with summary tables, failures, and cost breakdown
  - `reporters/github.ts` — GitHub Actions annotations (`::error`, `::warning`, `::notice`) with step summary for `GITHUB_STEP_SUMMARY`
- **Fixture Manager** (`src/fixtures.ts`) — `FixtureManager` class for reusable test setup/teardown with built-in fixtures: `mockLLM`, `mockTools`, `traceCapture`, `costTracker`
- 47 new tests covering all v4.5.0 features

## [4.3.0] - 2026-03-16

### Changed
- **World-class README rewrite** — hero section, problem statement, quick start, full feature showcase with code examples, comparison table vs promptfoo/deepeval/ragas/giskard, architecture diagram, adapter reference, CLI reference
- Updated CONTRIBUTING.md with development workflow, project structure, and contribution guidelines

## [3.8.0] - 2026-03-16

### Added
- Full README rewrite with architecture diagram, CLI reference, comparison table
- CONTRIBUTING.md guide
- Complete CHANGELOG history

### Fixed
- `formatABTest` crash when using legacy `modelA`/`modelB` result shape (round22 test failures)

## [3.7.0] - 2026-03-16

### Added
- A/B testing framework with chi-squared significance testing
- Enhanced anonymizer with configurable PII patterns
- Report exporter (PDF, CSV, Markdown)
- Retry policy engine with exponential backoff
- Metrics collector with aggregation

## [3.6.0] - 2026-03-16

### Added
- Agent sandbox for isolated test execution
- Regression test generator from traces
- Model comparison matrix
- Coverage analyzer with gap detection
- Config validator with schema checks

## [3.5.0] - 2026-03-16

### Added
- Agent fingerprinting - behavioral DNA for agents
- Flake manager with quarantine and auto-retry
- Timeline viewer (HTML export)
- Version registry for tracking agent versions
- Webhook notifications

## [3.4.0] - 2026-03-16

### Added
- Canary deployment testing
- Dependency graph visualization
- Enhanced trace compression (gzip/brotli)
- SLA trend analysis
- Test builder fluent API

## [3.3.0] - 2026-03-16

### Added
- Agent replay with deterministic verification
- CI Jenkins template
- Cost estimator for test planning
- Plugin registry with versioning
- Smart test prioritizer (risk-based)

## [3.2.0] - 2026-03-16

### Added
- Load testing with concurrent agent execution
- Trace search engine (full-text + semantic)
- Health dashboard (real-time)
- Test migration tool (format upgrades)
- Smart sampling for large test suites

## [3.1.0] - 2026-03-16

### Added
- `OTelExporter` class for programmatic OpenTelemetry integration
- `TraceStore` for persistent trace management
- Watch mode (`agentprobe watch`)
- `agentprobe init` scaffolding command
- `agentprobe doctor` diagnostic command

## [3.0.0] - 2026-03-16

### Changed
- **Major milestone**: production-grade release
- Stabilized all public APIs
- Comprehensive error handling across all modules

## [2.9.0] - 2026-03-16

### Added
- Governance dashboard
- Anomaly detection (statistical + ML)
- Performance profiler
- Report themes (dark, light, corporate)
- Enhanced NL codegen with few-shot examples

## [2.8.0] - 2026-03-16

### Added
- Agent debugger (step-through traces)
- Middleware pipeline for request/response transformation
- Test scheduler (cron-based)
- Contract testing framework
- Format converters (Promptfoo, DeepEval, custom)

## [2.7.0] - 2026-03-16

### Added
- Chaos testing framework (fault injection, latency, token corruption)
- Compliance reports (SOC2, HIPAA, custom)
- Agent diff (compare versions side-by-side)
- Custom assertion builder (visual)

## [2.6.0] - 2026-03-16

### Added
- Benchmark suite with statistical analysis
- Flaky test detector
- Trace similarity scoring
- Coverage map visualization
- Notification hub (Slack, email, webhook)

## [2.5.0] - 2026-03-16

### Added
- Multi-agent testing (orchestration, delegation)
- Cost optimizer with recommendations
- Regression detector (automatic)
- Enhanced plugin system with lifecycle hooks
- Environment profiles

## [2.4.0] - 2026-03-16

### Added
- Safety score computation
- Canary testing (gradual rollout)
- Trace lineage graphs
- Smart retry with backoff
- Test hooks (before/after)

## [2.3.0] - 2026-03-16

### Added
- A/B testing with statistical significance
- Agent fingerprinting (v1)
- SLA monitoring and alerts
- Trace enrichment with metadata
- Group-based test filtering

## [2.2.0] - 2026-03-16

### Added
- MCP server testing
- Rate limiter for API calls
- Templates library (20+ templates)
- Enhanced conversation testing (multi-turn)
- Trace metadata annotations

## [2.1.0] - 2026-03-16

### Added
- SDK API for programmatic use
- Streaming progress reporter
- Snapshot update workflow
- Error catalog with fix suggestions
- Trace compression

## [2.0.0] - 2026-03-16

### Changed
- **Production-ready release** with complete documentation
- Public API stabilization
- Full test coverage

## [1.9.0] - 2026-03-16

### Added
- VS Code extension
- GitHub Action
- Deterministic replay engine
- OpenAPI test generator
- Trace visualization (terminal)

## [1.8.0] - 2026-03-16

### Added
- Report portal (web UI)
- Health check command
- Test matrix (multi-model × multi-prompt)
- Performance regression detection
- Enhanced anonymizer

## [1.7.0] - 2026-03-16

### Added
- CI templates (GitHub Actions, GitLab, Azure Pipelines, CircleCI)
- Coverage reports (HTML)
- Profiler
- Mutation testing
- i18n support
- Dependency resolver

## [1.6.0] - 2026-03-16

### Added
- Compliance framework
- Trace simulator
- Webhooks
- Test prioritization
- Enhanced merge
- Report comparison

## [1.5.0] - 2026-03-16

### Added
- OpenTelemetry integration
- Flaky test detection
- Impact analysis
- Assertion builder
- Benchmarks
- Enhanced statistics

## [1.4.0] - 2026-03-16

### Added
- AI-powered test suggestions
- Trace validator
- Regression manager
- Budget enforcement
- Multi-suite support

## [1.3.0] - 2026-03-16

### Added
- Interactive explorer
- Custom assertions API
- Trace comparison
- Watch mode enhancement
- Chain assertions
- Environment profiles

## [1.2.0] - 2026-03-16

### Added
- Config file support (`.agentprobe.yml`)
- Diff reporter
- Plugin marketplace
- Trace export (JSON, CSV)
- Dependency graph

## [1.1.0] - 2026-03-16

### Added
- Streaming recorder
- Trace search
- Assertion negation (`not:`)
- Configurable timeouts
- Sampling support
- 410 tests

## [1.0.0] - 2026-03-16

### Added
- Conversation testing (multi-turn)
- Weighted scoring
- Natural language test generation
- PII anonymizer
- Profiler
- **First stable release**

## [0.9.0] - 2026-03-16

### Added
- Assertion explanations
- Trace replay
- Test templates
- Orchestration testing
- Golden test patterns
- Timeline visualization
- Enhanced HTML dashboard

## [0.8.0] - 2026-03-16

### Changed
- Strict TypeScript
- ESLint configuration
- Input validation
- JSDoc documentation
- Error handling overhaul
- GitHub issue/PR templates

## [0.7.0] - 2026-03-16

### Added
- Ecosystem integrations
- Advanced testing patterns

## [0.5.0] - 2026-03-16

### Added
- Trace diff for behavioral drift
- Trace viewer
- GitHub Actions CI
- Security test patterns
- LLM-as-Judge assertions
- Fault injection

## [0.3.0] - 2026-03-16

### Added
- Live agent execution
- Parameterized tests
- Test tags and hooks
- Tool coverage report
- Watch mode
- Snapshot testing

## [0.2.0] - 2026-03-16

### Added
- Fixtures system
- Tool mocking
- Reporter with colors and stats

## [0.1.0] - 2026-03-16

### Added
- Initial MVP - Playwright for AI Agents
- YAML test suites
- CLI runner
- Basic assertions (contains, regex, cost-under, latency-under)
- OpenAI adapter
