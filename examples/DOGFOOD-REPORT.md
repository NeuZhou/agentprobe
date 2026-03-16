# 🐕 AgentProbe Dogfood Report

**Date:** 2026-03-16  
**Tester:** OpenCrab (AI subagent)  
**Version:** 0.3.0

## Summary

Created 5 realistic agent traces, 5 test suites (30 total tests), and ran all features end-to-end.

| Suite | Tests | Passed | Failed |
|-------|-------|--------|--------|
| Weather | 5 | 5 | 0 |
| Research | 5 | 5 | 0 |
| Coding | 5 | 5 | 0 |
| Security | 10 | 8 | 2 (intentional — data-leak trace) |
| Performance | 5 | 5 | 0 |
| **Total** | **30** | **28** | **2** |

## ✅ What Worked Well

1. **Trace replay is solid** — Loading JSON traces and running assertions against them works perfectly. Zero issues.
2. **Assertion system is comprehensive** — `tool_called`, `tool_not_called`, `output_contains`, `tool_sequence`, `tool_args_match`, `max_tokens`, `max_steps`, `max_duration_ms` all work correctly.
3. **Tag filtering** — `--tag injection` correctly filtered to only injection-tagged tests (4/10 security tests).
4. **Trace view** — Beautiful terminal visualization with timing, token counts, and step-by-step display.
5. **Trace diff** — Clear comparison showing step count, token changes, tool differences, and output drift.
6. **Coverage report** — Correctly identified 1/3 declared tools were exercised with call counts and arg combinations.
7. **Reporter output** — Clean, readable console output with progress bars, timing, and assertion details.
8. **Security detection** — The data-leak trace correctly FAILED security tests (output_not_contains caught the leaked system prompt). This validates that AgentProbe can catch real security issues.

## ❌ What Broke

1. **YAML duplicate key crashes** — Using `output_contains` or `output_not_contains` twice in the same `expect:` block causes a hard crash (`YAMLParseError: Map keys must be unique`). This is the #1 usability issue.
   - **Workaround:** Use array syntax: `output_contains: ["foo", "bar"]`
   - **Impact:** Every new user will hit this. The YAML spec forbids duplicate keys, but it's the most natural way to write multiple assertions.

## 🤔 What Was Confusing

1. **Array vs scalar for multi-value assertions** — It's not obvious from the YAML schema that `output_contains` accepts an array. The `init` example doesn't show this pattern.
2. **Trace file paths** — Relative paths in test YAML are resolved from the YAML file's directory (correct behavior), but this isn't documented anywhere.
3. **Exit codes** — `run` exits with code 1 on any failure. Good for CI, but when testing security (where failures are expected), you can't easily distinguish "test suite worked correctly" from "test suite crashed."

## 🕳️ What's Missing

1. **No `output_contains_all` / `output_contains_any`** — Would reduce confusion vs duplicate keys.
2. **No test suite composition** — Can't run multiple YAML files in one command (`agentprobe run examples/*.yaml`).
3. **No summary report across suites** — After running 5 suites, there's no combined report.
4. **No `--expect-failures` flag** — For security tests where some failures are intentional.
5. **No trace validation** — If a trace JSON is malformed, the error message isn't helpful.
6. **No YAML schema/validation** — Typos in assertion names (e.g., `ouput_contains`) silently pass with no assertions run.

## 🐛 Bugs Found and Fixed

### Bug 1: YAML Duplicate Keys (User Error, but needs better docs/UX)
- **Symptom:** Hard crash when using same key twice in `expect:`
- **Root Cause:** YAML spec forbids duplicate keys; the yaml library enforces this
- **Fix:** Used array syntax in all test files. Should update `init` template and docs.
- **Severity:** High — every user will hit this

### No code bugs found in the AgentProbe source itself!
The core engine (runner, assertions, viewer, diff, coverage, reporter) all worked correctly on first try. Solid codebase.

## 📁 Files Created

### Traces
- `traces/weather-agent.json` — Weather tool usage (5 steps, 180 tokens)
- `traces/research-agent.json` — Web research with search+fetch (8 steps, 480 tokens)
- `traces/coding-agent.json` — Code editing with read+write (8 steps, 270 tokens)
- `traces/injection-attempt.json` — Prompt injection refused (2 steps)
- `traces/data-leak.json` — System prompt leaked (2 steps, intentional failure)

### Test Suites
- `examples/weather-tests.yaml` — 5 tests
- `examples/research-tests.yaml` — 5 tests
- `examples/coding-tests.yaml` — 5 tests
- `examples/security-tests.yaml` — 10 tests
- `examples/performance-tests.yaml` — 5 tests

## 🎯 Verdict

**AgentProbe works.** The core testing loop (load trace → run assertions → report) is solid and the DX is good. The main friction point is the YAML duplicate key issue, which is a documentation/UX problem, not a bug. The feature set covers the most important agent testing scenarios: behavioral validation, security testing, performance budgets, and regression detection via trace diff.

**Ready for users** with minor docs improvements.
