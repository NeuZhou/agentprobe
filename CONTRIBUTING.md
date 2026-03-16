# Contributing to AgentProbe

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/neuzhou/agentprobe.git
cd agentprobe
npm install
npm run build
```

### Running in Dev Mode

```bash
npm run dev -- run tests/example.test.yaml
```

### Running Tests

```bash
npm test              # Run once
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## Project Structure

```
src/
├── index.ts          # CLI entry point (commander)
├── runner.ts         # Test suite runner
├── assertions.ts     # All assertion evaluators
├── recorder.ts       # Trace recorder (SDK patching)
├── reporter.ts       # Console/JSON/Markdown/HTML output
├── types.ts          # TypeScript type definitions
├── stats.ts          # Trace statistics
├── yaml-validator.ts # YAML parsing with duplicate key detection
├── mocks.ts          # MockToolkit
├── fixtures.ts       # Test fixtures
├── snapshots.ts      # Snapshot testing
├── faults.ts         # Fault injection
├── judge.ts          # LLM-as-Judge
├── security.ts       # Security test generation
├── cost.ts           # Cost calculation
├── coverage.ts       # Tool coverage
├── config.ts         # Config file loading
├── plugins.ts        # Plugin system
├── regression.ts     # Baseline regression detection
├── watcher.ts        # Watch mode
├── viewer.ts         # Trace viewer
├── diff.ts           # Trace diff
├── ci.ts             # CI workflow generation
├── reporters/        # Format-specific reporters
└── adapters/         # Trace format adapters
    ├── index.ts      # Auto-detect + registry
    ├── openai.ts
    ├── anthropic.ts
    ├── langchain.ts
    ├── generic.ts
    └── openclaw.ts
```

## Adding a New Assertion Type

1. Add the field to `Expectations` in `src/types.ts`
2. Add the evaluation logic in `src/assertions.ts` (follow the existing pattern)
3. Add tests in `tests/`
4. Update README.md assertion table

Example pattern:
```typescript
// In assertions.ts
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

## Adding a New Adapter

1. Create `src/adapters/myformat.ts` with:
   - `detectMyFormat(input: any): boolean` — returns true if the input matches
   - `convertMyFormat(input: any): AgentTrace` — converts to AgentTrace
2. Register in `src/adapters/index.ts`:
   - Import your functions
   - Add to the `adapters` array
3. Add tests

## PR Guidelines

- **One feature per PR** — keep it focused
- **Include tests** — for new assertions, adapters, or bug fixes
- **Update docs** — README, CHANGELOG for user-facing changes
- **TypeScript** — all code in TypeScript, strict mode

## Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add stats command for trace analysis
fix: handle invalid regex in output_matches
docs: add contributing guide
refactor: extract YAML validation to separate module
```

## Code Style

- TypeScript strict mode
- 2-space indentation
- No semicolons (except where required)
- Prefer `const` over `let`
- Use `chalk` for colored console output
- Export types with `export type` / `export interface`

## Questions?

Open an issue or start a discussion on GitHub.
