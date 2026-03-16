# Changelog

All notable changes to AgentProbe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-16

### Added
- **Streaming Recorder** (`src/streaming.ts`) — record agent traces from streaming responses (OpenAI, Anthropic, SSE formats)
- **Trace Search** (`src/search.ts`) — `agentprobe search "query" traces/` to search across multiple traces by tool, content, model, cost, step type
- **Assertion Negation** — universal `not:` wrapper to negate any assertion in test YAML
- **Per-test Timeout** — `timeout_ms` field on test cases kills long-running live executions
- **Trace Sampling** (`src/sampling.ts`) — `--sample N` / `--sample-pct P` for running tests on a subset of traces with reproducible seeded RNG
- 95 new tests (315 → 410)

## [1.0.0] - 2026-03-16

### Added
- **Multi-turn conversation testing** (`src/conversation.ts`) — test agent behavior across sequential turns with per-turn assertions
- **Weighted scoring** (`src/scoring.ts`) — assign weights to assertions and set pass thresholds for quality scoring
- **Natural language test generation** (`src/nlgen.ts`) — `agentprobe generate "description"` creates test YAML from English descriptions, no LLM needed
- **Trace anonymizer** (`src/anonymize.ts`) — `agentprobe trace anonymize` redacts API keys, emails, IPs, names, phone numbers before sharing
- **Performance profiler** (`src/profiler.ts`) — `agentprobe profile traces/` shows latency percentiles (p50/p95/p99), token efficiency, cost per query, bottleneck identification
- Full programmatic API for all new features

### Changed
- **KILLER README rewrite** — hero badges, 30-second demo, comparison table, architecture diagram, organized feature list
- Version bump to 1.0.0 🎉

## [0.9.0] - 2026-03-16

### Added
- **Golden test pattern** — `agentprobe golden record/verify` for reference run comparison
- **Assertion templates** — reusable assertion patterns with `template:` syntax
- **Trace replay with overrides** — modify tool responses during replay
- **Multi-agent orchestration testing** — test agent handoffs and delegation patterns
- **Parameterized test dependencies** — `depends_on` with execution ordering
- **Trace merge** — combine multiple agent traces into unified timeline
- **Suite validation** — `agentprobe validate` checks YAML/JSON without running

### Changed
- Expanded test coverage to 141 tests
- Improved error messages throughout

## [0.8.0] - 2026-03-16

### Added
- **Retry with backoff** — `retries` and `retry_delay_ms` per test case
- **Test dependencies** — `depends_on` for ordered execution with skip-on-fail
- **Environment variable support** — `--env-file`, per-suite and per-test `env`
- **Badge generation** — `--badge badge.svg` creates shields.io-style SVG badges
- **Suite validation** — validates YAML structure and expectations before running

## [0.7.0] - 2026-03-16

### Added
- **LLM-as-Judge rubric scoring** — multi-criteria evaluation with weighted rubrics
- **Composed assertions** — `all_of`, `any_of`, `none_of` for complex boolean logic
- **Fixture system** — reusable test environments with mock and env presets

## [0.6.0] - 2026-03-16

### Added
- **Test codegen from traces** — `agentprobe codegen trace.json` generates YAML tests (like Playwright codegen)
- **JUnit XML reporter** — `-f junit` for CI integration
- **HTML reporter** — standalone HTML test reports
- **Trace timeline** — Gantt-style visualization of agent execution

## [0.5.0] - 2026-03-16

### Added
- **YAML duplicate key detection** — warns when same key appears twice
- **Better error messages** — human-friendly errors with suggestions
- **OpenClaw adapter** — convert OpenClaw session traces to AgentTrace
- **Interactive init** — `agentprobe init` with guided setup
- **Stats command** — `agentprobe stats traces/` for aggregate analysis
- **CONTRIBUTING.md** and **CHANGELOG.md**

## [0.4.0] - 2026-03-16

### Added
- **Trace adapters** — OpenAI, Anthropic, LangChain, Generic JSONL converters
- **Auto-detect** — `agentprobe convert` auto-detects trace format
- **Cost calculation** — token-based cost estimation with model-specific pricing
- **Regression detection** — `agentprobe baseline save/compare`
- **Plugin system** — custom assertions, adapters, reporters via plugins
- **Config file** — `.agentproberc.yaml` for project-wide settings

## [0.3.0] - 2026-03-16

### Added
- **Fault injection** — chaos engineering: error, timeout, slow, corrupt modes
- **LLM-as-Judge** — score output quality with criteria or rubrics
- **Security test generation** — 30+ built-in attack patterns across 4 categories
- **GitHub Actions template** — `agentprobe init --ci github`
- **Trace viewer** — visual trace inspection in terminal
- **Trace diff** — compare two traces to detect behavioral drift

## [0.2.0] - 2026-03-16

### Added
- **Tool mocking** — `MockToolkit` with mock, mockOnce, mockSequence, mockError
- **Fixtures** — pre-configured test environments
- **Live agent execution** — run agents directly, not just replay traces
- **Snapshot testing** — behavioral snapshots
- **Watch mode** — re-run tests on file changes
- **Coverage report** — tool coverage analysis
- **Parameterized tests** — `each:` expansion
- **Tags & filtering** — `--tag` for running subsets
- **Hooks** — beforeAll, afterAll, beforeEach, afterEach

## [0.1.0] - 2026-03-16

### Added
- Initial release
- 11 assertion types
- Trace recorder with OpenAI/Anthropic SDK patching
- YAML-based test runner
- Console, JSON, Markdown reporters
- CLI: run, record, replay, init
