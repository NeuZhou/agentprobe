# Contributing to AgentProbe

Thanks for your interest in contributing to AgentProbe! This guide covers everything you need to get started.

## Development Setup

```bash
git clone https://github.com/neuzhou/agentprobe.git
cd agentprobe
npm install
npm run build
```

### Running Tests

```bash
npm test                # Run all 781 tests
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

### Development Mode

```bash
npm run dev -- run tests/example.test.yaml
```

## Project Structure

```
agentprobe/
├── src/
│   ├── index.ts              # CLI entry point (commander)
│   ├── runner.ts             # Test suite runner — core orchestration
│   ├── assertions.ts         # All assertion evaluators (11 types)
│   ├── types.ts              # TypeScript type definitions
│   ├── lib.ts                # Public API exports
│   │
│   ├── # Recording & Replay
│   ├── recorder.ts           # Trace recorder (OpenAI/Anthropic SDK patching)
│   ├── streaming.ts          # Streaming response recorder
│   ├── replay.ts             # Deterministic trace replay
│   ├── snapshots.ts          # Snapshot testing
│   │
│   ├── # Assertions & Scoring
│   ├── compose.ts            # all_of, any_of, none_of
│   ├── scoring.ts            # Weighted scoring with thresholds
│   ├── judge.ts              # LLM-as-Judge assertions
│   ├── custom-assertions.ts  # Custom assertion registry
│   ├── builder.ts            # Fluent assertion builder API
│   │
│   ├── # Reporting
│   ├── reporter.ts           # Console/JSON/Markdown output
│   ├── reporters/
│   │   ├── html.ts           # HTML dashboard
│   │   ├── junit.ts          # JUnit XML for CI
│   │   ├── diff.ts           # Side-by-side comparison
│   │   └── compare.ts        # Report delta comparison
│   │
│   ├── # Adapters
│   ├── adapters/
│   │   ├── index.ts          # Auto-detect + adapter registry
│   │   ├── openai.ts         # OpenAI trace format
│   │   ├── anthropic.ts      # Anthropic trace format
│   │   ├── langchain.ts      # LangChain trace format
│   │   ├── openclaw.ts       # OpenClaw session traces
│   │   └── generic.ts        # Generic JSONL format
│   │
│   ├── # Analysis & Profiling
│   ├── profiler.ts           # Performance profiling (p50/p95/p99)
│   ├── stats.ts              # Aggregate statistics
│   ├── cost.ts               # Token cost estimation
│   ├── coverage.ts           # Tool coverage analysis
│   ├── coverage-report.ts    # Detailed coverage reports
│   ├── diff.ts               # Trace diff (behavioral drift)
│   ├── trace-compare.ts      # Structured trace comparison
│   ├── behavior-profiler.ts  # Behavior categorization
│   ├── impact.ts             # Change impact analysis
│   ├── flaky.ts              # Flaky test detection
│   │
│   ├── # Generation & Codegen
│   ├── nlgen.ts              # Natural language → YAML tests
│   ├── codegen.ts            # Trace → test codegen
│   ├── security.ts           # Security test generation (30+ patterns)
│   ├── openapi.ts            # OpenAPI → test generation
│   ├── templates.ts          # Assertion templates
│   │
│   ├── # Testing Features
│   ├── conversation.ts       # Multi-turn conversation testing
│   ├── mocks.ts              # MockToolkit
│   ├── fixtures.ts           # Fixture system
│   ├── faults.ts             # Fault injection
│   ├── golden.ts             # Golden test pattern
│   ├── orchestration.ts      # Multi-agent orchestration
│   ├── mutation.ts           # Mutation testing
│   │
│   ├── # Infrastructure
│   ├── config.ts             # Config file loading
│   ├── config-file.ts        # .agentproberc.yml support
│   ├── plugins.ts            # Plugin system
│   ├── marketplace.ts        # Plugin marketplace
│   ├── regression.ts         # Baseline regression detection
│   ├── regression-manager.ts # Automated regression tracking
│   ├── watcher.ts            # Watch mode
│   ├── badge.ts              # SVG badge generation
│   ├── ci.ts                 # CI workflow generation
│   ├── deps.ts               # Test dependency graph
│   ├── env.ts                # Environment variable loading
│   ├── validate.ts           # Suite YAML validation
│   ├── yaml-validator.ts     # YAML parsing + duplicate key detection
│   │
│   ├── # Advanced
│   ├── anonymize.ts          # Trace PII anonymizer
│   ├── compliance.ts         # Compliance framework
│   ├── simulator.ts          # Synthetic trace generation
│   ├── webhooks.ts           # Webhook notifications
│   ├── prioritize.ts         # Test prioritization
│   ├── search.ts             # Cross-trace search
│   ├── sampling.ts           # Trace sampling
│   ├── export.ts             # Trace export (OTel, LangSmith, CSV)
│   ├── otel.ts               # OpenTelemetry integration
│   ├── budget.ts             # Budget enforcement
│   ├── suggest.ts            # AI test suggestions
│   ├── trace-validator.ts    # Trace structure validation
│   ├── explorer.ts           # Interactive trace browser
│   ├── portal.ts             # Web portal generator
│   ├── health.ts             # Project health check
│   ├── matrix.ts             # Test matrix execution
│   ├── perf-regression.ts    # Performance regression detection
│   ├── merge.ts              # Trace merge
│   ├── viewer.ts             # Terminal trace viewer
│   ├── viz.ts                # Trace visualization (Mermaid, HTML)
│   ├── i18n.ts               # Internationalization
│   ├── retry.ts              # Retry with backoff
│   └── benchmarks.ts         # Framework benchmarks
│
├── tests/                    # 781 tests across 40 files
├── benchmarks/               # Performance benchmarks
├── docs/                     # Documentation
├── examples/                 # Example traces and test suites
└── src/vscode/               # VSCode extension
```

## How to Contribute

### Adding a New Assertion Type

1. Add the field to `Expectations` interface in `src/types.ts`
2. Add evaluation logic in `src/assertions.ts`:

```typescript
if (expect.my_assertion != null) {
  const passed = /* your logic */;
  results.push({
    name: `my_assertion: ${expect.my_assertion}`,
    passed,
    expected: expect.my_assertion,
    actual: /* actual value */,
  });
}
```

3. Add tests in `tests/`
4. Update `docs/assertions.md`

### Adding a New Adapter

1. Create `src/adapters/myformat.ts`:

```typescript
export function detectMyFormat(input: any): boolean {
  // Return true if the input matches your format
}

export function convertMyFormat(input: any): AgentTrace {
  // Convert to AgentTrace
}
```

2. Register in `src/adapters/index.ts`
3. Add tests and update `docs/adapters.md`

### Adding a New Reporter

1. Create `src/reporters/myformat.ts`
2. Wire into `src/reporter.ts`
3. Add CLI option in `src/index.ts`

### Adding a New CLI Command

1. Add the command in `src/index.ts` using Commander
2. Implement business logic in a separate `src/myfeature.ts`
3. Add tests and update `docs/cli-reference.md`

## Code Style

- **TypeScript strict mode** — all code must pass `tsc` with strict enabled
- **2-space indentation**
- **No semicolons** (except where required)
- **`const` over `let`**
- **`chalk`** for colored console output
- **Export types** with `export type` / `export interface`

```bash
npm run lint        # Check
npm run lint:fix    # Auto-fix
npm run format      # Prettier
```

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add stats command for trace analysis
fix: handle invalid regex in output_matches
docs: update assertions documentation
test: add edge case tests for conversation evaluator
refactor: extract YAML validation to separate module
chore: bump dependencies
```

## PR Guidelines

1. **One feature per PR** — keep it focused
2. **Include tests** — new features need tests, bug fixes need regression tests
3. **Update docs** — user-facing changes need README/docs updates
4. **All tests pass** — `npm test` must be green
5. **Lint clean** — `npm run lint` must pass

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. `npm run build && npm test`
4. Commit: `chore: release vX.Y.Z`
5. Tag: `git tag vX.Y.Z`
6. Push: `git push && git push --tags`
7. `npm publish`

## Questions?

Open an [issue](https://github.com/neuzhou/agentprobe/issues) or start a discussion on GitHub.
