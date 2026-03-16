# Changelog

All notable changes to AgentProbe will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-03-16

### Added
- **YAML duplicate key detection** — warns when same key appears twice (YAML silently overwrites)
- **Better error messages** — human-friendly errors with suggestions for file not found, invalid YAML, missing traces, invalid regex
- **OpenClaw adapter** (`src/adapters/openclaw.ts`) — convert OpenClaw session traces to AgentTrace
- **Interactive init** — `agentprobe init` now asks about agent type, provider, security/perf tests, CI
- **Stats command** — `agentprobe stats traces/` shows token usage, cost, tool frequency, slowest/most expensive traces
- **CONTRIBUTING.md** — developer guide for setup, testing, adding assertions/adapters
- **CHANGELOG.md** — this file

### Changed
- Improved README with philosophy, roadmap, comparison diagram, badges, contributing section
- npm publish preparation: `.npmignore`, `files` field, proper `exports`
- Version bump to 0.5.0

## [0.4.0] - 2026-03-16

### Added
- **Trace adapters** — OpenAI, Anthropic, LangChain, Generic JSONL format converters
- **Auto-detect** — `agentprobe convert` auto-detects trace format
- **Cost calculation** — token-based cost estimation with model-specific pricing
- **Regression detection** — `agentprobe baseline save/compare` for detecting test regressions
- **Plugin system** — register custom assertions, adapters, reporters via plugins
- **Config file** — `.agentproberc.yaml` for project-wide settings
- **HTML report** — `-f html` generates a standalone HTML test report

## [0.3.0] - 2026-03-16

### Added
- **Fault injection** — chaos engineering for agents: error, timeout, slow, corrupt modes
- **LLM-as-Judge** — use an LLM to score output quality with criteria or rubrics
- **Security test generation** — 30+ built-in attack patterns across 4 categories
- **GitHub Actions template** — `agentprobe init --ci github`
- **Trace viewer** — visual trace inspection in terminal
- **Trace diff** — compare two traces to detect behavioral drift

## [0.2.0] - 2026-03-16

### Added
- **Tool mocking** — `MockToolkit` with mock, mockOnce, mockSequence, mockError
- **Fixtures** — pre-configured test environments in YAML
- **Live agent execution** — run agents directly, not just replay traces
- **Snapshot testing** — behavioral snapshots like Jest
- **Watch mode** — re-run tests on file changes
- **Coverage report** — which tools are tested?
- **Parameterized tests** — `each:` expands one test into many
- **Tags & filtering** — `--tag security` runs only tagged tests
- **Hooks** — beforeAll, afterAll, beforeEach, afterEach

## [0.1.0] - 2026-03-16

### Added
- Initial release
- 11 assertion types: tool_called, tool_not_called, output_contains, output_not_contains, output_matches, max_steps, max_tokens, max_duration_ms, tool_sequence, tool_args_match, custom
- Trace recorder with OpenAI/Anthropic SDK patching
- YAML-based test runner
- Console, JSON, Markdown reporters
- CLI: run, record, replay, init
