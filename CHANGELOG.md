# Changelog

All notable changes to AgentProbe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-03-16

### 🎉 Major Release — Production Ready

AgentProbe 2.0 is a milestone release marking the framework as production-ready. This release focuses on polish, comprehensive documentation, and developer experience.

### Added
- Complete README rewrite — hero section, feature matrix, architecture diagram, comparison table
- Full documentation suite: getting-started, assertions, adapters, CLI reference, configuration, security testing, CI integration
- CONTRIBUTING.md with architecture overview and extension guides

### Changed
- Version bump to 2.0.0
- 781 tests passing across 40 test files
- All documentation updated to reflect current feature set

## [1.9.0] - 2026-03-16

### Added
- **VSCode Extension** (`src/vscode/`) — inline test results, trace tree view, status bar integration
- **GitHub Action** — reusable action for CI pipelines
- **Deterministic Replay** (`src/replay.ts`) — exact reproduction of agent behavior with seed support
- **OpenAPI Test Generation** (`src/openapi.ts`) — generate tests from OpenAPI/Swagger specs
- **Trace Visualization** (`src/viz.ts`) — Mermaid diagrams, text trees, and HTML visualizations of traces

## [1.8.0] - 2026-03-16

### Added
- **Web Portal** (`src/portal.ts`) — standalone HTML dashboard for test results
- **Health Check** (`src/health.ts`) — validate project setup and dependencies
- **Test Matrix** (`src/matrix.ts`) — run tests across multiple configurations (models, adapters, params)
- **Performance Regression Detection** (`src/perf-regression.ts`) — detect latency/cost regressions between runs
- **Enhanced Anonymizer** — additional PII patterns (credit cards, SSNs, phone numbers)

## [1.7.0] - 2026-03-16

### Added
- **CI Templates** (`src/ci.ts`) — generate GitHub Actions, GitLab CI, CircleCI configs
- **Detailed Coverage Reports** (`src/coverage-report.ts`) — tool-level and assertion-level coverage
- **Behavior Profiler** (`src/behavior-profiler.ts`) — categorize agent behaviors across traces
- **Mutation Testing** (`src/mutation.ts`) — mutate traces to verify assertion sensitivity
- **Internationalization** (`src/i18n.ts`) — locale-aware output formatting
- **Dependency Resolver** (`src/deps.ts`) — enhanced test dependency graph with cycle detection

## [1.6.0] - 2026-03-16

### Added
- **Compliance Framework** (`src/compliance.ts`) — PII detection, cost limits, tool allowlists/denylists
- **Trace Simulator** (`src/simulator.ts`) — generate synthetic traces without calling LLMs
- **Webhook Notifications** (`src/webhooks.ts`) — Slack, Teams, Discord notifications on test events
- **Test Prioritization** (`src/prioritize.ts`) — smart ordering: failures first, change-affected next, slowest last
- **Merge Enhancement** (`src/merge.ts`) — handoff detection, context flow tracking
- **Report Comparison** (`src/reporters/compare.ts`) — HTML delta reports between test runs

## [1.5.0] - 2026-03-16

### Added
- **OpenTelemetry Integration** (`src/otel.ts`) — export traces as OTel spans
- **Flaky Test Detection** (`src/flaky.ts`) — identify non-deterministic tests across runs
- **Impact Analysis** (`src/impact.ts`) — determine which tests are affected by code changes
- **Assertion Builder** (`src/builder.ts`) — fluent API for constructing assertions programmatically
- **Benchmarks** (`src/benchmarks.ts`) — performance benchmarks for the framework itself
- **Enhanced Stats** — percentile distributions, model-level breakdowns

## [1.4.0] - 2026-03-16

### Added
- **AI Test Suggestions** (`src/suggest.ts`) — analyze traces and suggest missing test cases
- **Trace Validator** (`src/trace-validator.ts`) — validate trace structure and completeness
- **Regression Manager** (`src/regression-manager.ts`) — automated regression tracking across releases
- **Budget Enforcement** (`src/budget.ts`) — hard limits on token/cost usage with abort support
- **Multi-Suite Support** — run multiple suite files with glob patterns and `--recursive`

## [1.3.0] - 2026-03-16

### Added
- **Interactive Explorer** (`src/explorer.ts`) — terminal-based trace browser
- **Custom Assertions** (`src/custom-assertions.ts`) — register and load custom assertion functions
- **Trace Compare** (`src/trace-compare.ts`) — structured comparison of trace pairs
- **Watch Enhancement** — watch trace directories for new files
- **Chain Assertions** — sequential assertion dependencies
- **Config Profiles** — named environment profiles in `.agentproberc.yml`

## [1.2.0] - 2026-03-16

### Added
- **Config File Support** (`src/config-file.ts`) — `.agentproberc.yml` / `agentprobe.config.ts`
- **Diff Reporter** (`src/reporters/diff.ts`) — side-by-side test run comparison
- **Plugin Marketplace** (`src/marketplace.ts`) — browse and install community plugins
- **Trace Export** (`src/export.ts`) — export to OpenTelemetry, LangSmith, CSV
- **Dependency Graph** — Mermaid diagrams of test dependencies

## [1.1.0] - 2026-03-16

### Added
- **Streaming Recorder** (`src/streaming.ts`) — record from streaming responses (SSE)
- **Trace Search** (`src/search.ts`) — search across traces by tool, content, model, cost
- **Assertion Negation** — `not:` wrapper for any assertion
- **Per-test Timeout** — `timeout_ms` field
- **Trace Sampling** (`src/sampling.ts`) — `--sample N` / `--sample-pct P`
- Test suite expanded to 410 tests

## [1.0.0] - 2026-03-16

### Added
- **Multi-turn Conversation Testing** (`src/conversation.ts`)
- **Weighted Scoring** (`src/scoring.ts`) — assertion weights and pass thresholds
- **Natural Language Test Generation** (`src/nlgen.ts`) — `agentprobe generate "description"`
- **Trace Anonymizer** (`src/anonymize.ts`) — redact API keys, emails, IPs, names
- **Performance Profiler** (`src/profiler.ts`) — latency percentiles, bottleneck identification
- Full programmatic API

### Changed
- Complete README rewrite with hero section, demos, architecture diagram

## [0.9.0] - 2026-03-16

### Added
- Golden test pattern — `agentprobe golden record/verify`
- Assertion templates — reusable patterns
- Trace replay with overrides
- Multi-agent orchestration testing
- Trace merge for unified timelines
- Suite validation command

## [0.8.0] - 2026-03-16

### Added
- Retry with backoff (`retries`, `retry_delay_ms`)
- Test dependencies (`depends_on`)
- Environment variable support (`--env-file`)
- Badge generation (`--badge`)
- Suite validation before execution

## [0.7.0] - 2026-03-16

### Added
- LLM-as-Judge with rubric scoring
- Composed assertions (`all_of`, `any_of`, `none_of`)
- Fixture system for reusable test environments

## [0.6.0] - 2026-03-16

### Added
- Test codegen from traces (`agentprobe codegen`)
- JUnit XML reporter
- HTML reporter with dashboard
- Trace timeline visualization

## [0.5.0] - 2026-03-16

### Added
- YAML duplicate key detection
- Human-friendly error messages
- OpenClaw adapter
- Interactive init wizard
- Stats command
- CONTRIBUTING.md and CHANGELOG.md

## [0.4.0] - 2026-03-16

### Added
- Trace adapters (OpenAI, Anthropic, LangChain, Generic JSONL)
- Auto-detect trace format
- Cost calculation with model-specific pricing
- Regression detection with baselines
- Plugin system
- Config file support

## [0.3.0] - 2026-03-16

### Added
- Fault injection (error, timeout, slow, corrupt modes)
- LLM-as-Judge assertions
- Security test generation (30+ patterns)
- GitHub Actions CI template
- Trace viewer and trace diff

## [0.2.0] - 2026-03-16

### Added
- Tool mocking (`MockToolkit`)
- Fixtures and snapshot testing
- Live agent execution
- Watch mode
- Coverage report
- Parameterized tests (`each:`)
- Tags & filtering (`--tag`)
- Hooks (beforeAll, afterAll, beforeEach, afterEach)

## [0.1.0] - 2026-03-16

### Added
- Initial release
- 11 assertion types
- Trace recorder with OpenAI/Anthropic SDK patching
- YAML-based test runner
- Console, JSON, Markdown reporters
- CLI: run, record, replay, init
