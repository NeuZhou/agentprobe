# AgentProbe Quick Start Example

A self-contained example you can copy and run in 3 steps.

## Steps

```bash
# 1. Install
npm install @neuzhou/agentprobe

# 2. Run the YAML test (no API key needed - uses mock adapter)
npx agentprobe run test-mock.yaml

# 3. Run the programmatic test
npx ts-node test-programmatic.ts
```

## What's here

| File | Description |
|------|-------------|
| `test-mock.yaml` | YAML-based test using the mock adapter (no LLM needed) |
| `test-programmatic.ts` | TypeScript programmatic API example |
| `test-security.yaml` | Prompt injection resistance test |
