# Contributing to AgentProbe

Thanks for your interest in contributing! AgentProbe is open-source and welcomes contributions of all kinds.

## 🛠️ Development Setup

```bash
git clone https://github.com/kazhou2024/agentprobe.git
cd agentprobe
npm install
npm run build
npm test
```

## 📝 How to Add Tests

1. Create a file in `tests/` named `your-feature.test.ts`
2. Import from `src/` — tests run with Vitest
3. Follow existing patterns:

```typescript
import { describe, test, expect } from 'vitest';
import { yourFunction } from '../src/your-module';

describe('YourFeature', () => {
  test('does the thing', () => {
    const result = yourFunction(input);
    expect(result).toBe(expected);
  });
});
```

4. Run: `npx vitest run tests/your-feature.test.ts`

## 🔌 How to Add Adapters

Adapters live in `src/adapters/`. Each adapter implements the `AgentAdapter` interface:

```typescript
// src/adapters/my-provider.ts
import { AgentAdapter, AdapterConfig, AgentResponse } from './index';

export class MyProviderAdapter implements AgentAdapter {
  async run(input: string, config: AdapterConfig): Promise<AgentResponse> {
    // Call your provider's API
    const response = await callMyProvider(input, config);
    return {
      output: response.text,
      tokens: response.usage?.total_tokens,
      cost: response.usage?.cost,
      time: response.elapsed,
      toolCalls: response.tool_calls || [],
    };
  }
}
```

Then register it in `src/adapters/index.ts`.

## 🧩 How to Write Plugins

Plugins extend AgentProbe with custom assertions, reporters, or hooks:

```typescript
import { definePlugin } from '@neuzhou/agentprobe';

export default definePlugin({
  name: 'my-plugin',

  // Custom assertions
  assertions: {
    'no-hallucination': (response, config) => ({
      pass: !containsHallucination(response.output),
      message: 'Response should not hallucinate',
    }),
  },

  // Lifecycle hooks
  hooks: {
    beforeRun: (suite) => { /* setup */ },
    afterRun: (results) => { /* cleanup */ },
  },
});
```

Install your plugin:
```bash
agentprobe plugins install ./path/to/my-plugin
```

## 🎨 Code Style

- **TypeScript** — strict mode enabled
- **No `any`** unless absolutely necessary (use `as any` sparingly with a comment)
- **Functions over classes** — prefer pure functions
- **Descriptive names** — `computeSafetyScore` not `css`
- **JSDoc** on exported functions
- Run `npm run lint` before committing

## 🔀 PR Process

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Write code + tests
4. Ensure all tests pass: `npm test`
5. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `chore:`
6. Open a PR against `main`
7. Address review comments
8. Squash merge on approval

## 📁 Project Structure

```
src/
├── index.ts          # CLI entry point
├── lib.ts            # Public API
├── runner.ts         # Test runner core
├── assertions.ts     # Built-in assertions
├── adapters/         # LLM provider adapters
├── reporters/        # Output formatters
├── plugins.ts        # Plugin system
└── ...               # Feature modules (100+ files)
tests/
├── *.test.ts         # Unit & integration tests
└── helpers.ts        # Shared test utilities
```

## 💬 Questions?

Open an issue on GitHub or check existing discussions.
