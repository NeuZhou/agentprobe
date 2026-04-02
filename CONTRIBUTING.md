# Contributing to AgentProbe

Thanks for your interest in contributing! AgentProbe is an open-source project and we welcome contributions of all kinds.

## Getting Started

```bash
git clone https://github.com/neuzhou/agentprobe.git
cd agentprobe
npm install
npm test
```

## Development Workflow

1. **Fork** the repo and create a branch from `master`
2. **Make changes** — add tests for new features
3. **Run tests** — `npm test`
4. **Lint** — `npm run lint`
5. **Format** — `npm run format`
6. **Submit a PR** with a clear description

## Project Structure

```
src/
  index.ts          # CLI entry point
  lib.ts            # Library exports
  runner.ts         # Test suite runner
  assertions.ts     # Core assertion engine
  security.ts       # Security scanning
  mocks.ts          # Tool mocking
  faults.ts         # Fault injection
  adapters/         # LLM provider adapters
  reporters/        # Output formatters
tests/              # Test files
docs/               # Documentation
```

## Code Style

- TypeScript strict mode
- Prettier for formatting (`npm run format`)
- ESLint for linting (`npm run lint`)
- Meaningful variable names over comments

## Writing Tests

Every new feature needs tests. We use [Vitest](https://vitest.dev/):

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Adding a New Assertion Type

1. Add the assertion logic in `src/assertions.ts`
2. Add the type to `Expectations` in `src/types.ts`
3. Add tests in `tests/`
4. Document in README.md

## Adding a New Adapter

1. Create `src/adapters/<provider>.ts`
2. Implement the `Adapter` interface
3. Register in `src/adapters/index.ts`
4. Add tests and update docs

## Commit Messages

Use conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `test:` Tests
- `refactor:` Code refactoring
- `chore:` Maintenance

## Reporting Issues

- Use GitHub Issues
- Include reproduction steps
- Include AgentProbe version (`agentprobe --version`)

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License.
