# AgentProbe Code Review Report 🔬

**Reviewer:** 螃蟹 🦀 (Systematic Code Review)
**Date:** 2026-03-18
**Commit range:** `afb3647..a0f0cc8` (5 review commits)

---

## Health Score: **B+**

A solid, well-architected testing framework with real implementations across 165+ source files, comprehensive TypeScript strict mode, and a strong test suite. The codebase has genuine substance — not a scaffold or prototype. Key deductions are for some code duplication across parallel module evolutions, a few missing convenience APIs, and some unguarded JSON.parse calls.

---

## Test Results

| Metric | Before Review | After Review |
|--------|:------------:|:------------:|
| Test files | 97 | 98 |
| Tests total | 2,878 | 2,907 |
| Tests passing | 2,872 | **2,907** |
| Tests failing | **6** | **0** |
| TypeScript errors | 0 | 0 |

**Source:** 46,602 lines across 165+ modules
**Tests:** 28,681 lines across 98 test files
**Test/Source ratio:** 0.62 (good)
**Assertions:** 4,773 `expect()` calls (avg ~49/file)

---

## Issues Found (by Severity)

### 🔴 Critical (0)
None.

### 🟠 High (3)

| # | Issue | Status |
|---|-------|--------|
| H1 | `CostReport` missing `total_tokens`, `input_tokens`, `output_tokens` — 6 tests failing | ✅ Fixed |
| H2 | `matchSnapshot()` `created` flag always `false` — checked `fs.existsSync` AFTER writing file | ✅ Fixed |
| H3 | `Recorder.patchOpenAI()` uses raw `JSON.parse()` on tool_call arguments — crashes on malformed streaming data | ✅ Fixed |

### 🟡 Medium (7)

| # | Issue | Status |
|---|-------|--------|
| M1 | `new Function()` used in custom assertions (`assertions.ts`) — code injection risk from user YAML | ⚠️ Documented |
| M2 | Duplicate modules: `snapshot.ts` (410 lines) vs `snapshots.ts` (93 lines) — both export `extractSnapshot` and `matchSnapshot` | ⚠️ Documented |
| M3 | 13 sets of duplicate function names across different files (e.g., `loadTraces` in 3 files, `classifyError` in 3 files) | ⚠️ Documented |
| M4 | `findPricing()` was not exported — prevented testing and reuse | ✅ Fixed |
| M5 | Dangling JSDoc comment in `deps.ts` (orphaned doc comment without function) | ✅ Fixed |
| M6 | Same `patchAzureOpenAI()` had unguarded `JSON.parse` | ✅ Fixed |
| M7 | Many `fs.readFileSync` calls without try-catch (30+ occurrences across modules) | ⚠️ Documented |

### 🔵 Low (5)

| # | Issue | Status |
|---|-------|--------|
| L1 | `__judgePromises` attached to results array via `(results as any)` — unconventional pattern | ⚠️ Documented |
| L2 | `FaultInjector.shouldInject()` uses `Math.random()` — not deterministic/seedable | ⚠️ Documented |
| L3 | 4 moderate npm audit vulnerabilities | ⚠️ Documented |
| L4 | `evaluateExpectations()` in `validate.ts` doesn't recursively validate `all_of`/`any_of`/`none_of` contents | ⚠️ Documented |
| L5 | `PRICING` table in `cost.ts` uses slightly outdated model names (e.g., missing `claude-4` variants) | ⚠️ Documented |

---

## Fixes Applied (5 commits, TDD)

### Fix 1: CostReport convenience fields
**Commit:** `169e411`
- Added `input_tokens`, `output_tokens`, `total_tokens` to `CostReport` interface and return value
- **Tests:** 6 failing → 6 passing

### Fix 2: Export findPricing + Robustness tests
**Commit:** `037791d`
- Exported `findPricing()` for testability
- Added 12 robustness tests: loadTrace error handling, FaultInjector edge cases, chaos config validation, pricing fuzzy matching, empty trace cost calculation

### Fix 3: Assertion edge case tests
**Commit:** `fe7b52f`
- Added 11 tests for `evaluate()` edge cases: undefined tool_name, empty traces, invalid regex, not() wrapper, custom assertions, max_cost_usd

### Fix 4: Snapshot created flag bug
**Commit:** `06ef058`
- **Bug:** `matchSnapshot()` checked `fs.existsSync()` AFTER `writeFileSync`, so `created` was always `false`
- **Fix:** Capture file existence before writing
- Added 3 snapshot tests including extractSnapshot edge case

### Fix 5: Safe JSON.parse in Recorder + cleanup
**Commit:** `a0f0cc8`
- Replaced raw `JSON.parse(tc.function.arguments)` with `safeParseArgs()` in both `patchOpenAI()` and `patchAzureOpenAI()`
- Removed dangling JSDoc comment in `deps.ts`
- Added 3 Recorder unit tests

---

## Architecture Assessment

### Strengths 💪
1. **Strict TypeScript** — `strict: true`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters` all enabled. Zero TS errors.
2. **Real implementations** — No stubs or fake modules. Every exported function has meaningful logic.
3. **Comprehensive type system** — Well-defined interfaces for all data structures (30+ exported types).
4. **Rich assertion engine** — 17+ built-in assertion types with detailed error messages including suggestions.
5. **Solid plugin architecture** — Clean hook-based plugin system with lifecycle management.
6. **Multi-provider LLM support** — 7 native LLM providers with auto-routing.
7. **Good test quality** — Only 4% of assertions are trivial `toBeDefined/toBeTruthy`. Most tests verify specific behavior.
8. **Security awareness** — ClawGuard integration, prompt injection patterns, PII detection built in.

### Weaknesses ⚠️
1. **Module duplication** — `snapshot.ts` vs `snapshots.ts`, 13 duplicate function names across files. Evolution artifacts.
2. **Unguarded file I/O** — 30+ `fs.readFileSync` calls lack try-catch error handling.
3. **Code injection surface** — `new Function()` in custom assertions is a security concern for untrusted YAML.
4. **Massive barrel export** — `lib.ts` is 700+ lines of re-exports, making tree-shaking difficult.
5. **No integration tests** — All tests are unit tests. No end-to-end tests running the CLI against actual YAML suites with real traces.

---

## Remaining Recommendations

### Priority 1 (High Impact)
1. **Merge `snapshot.ts` and `snapshots.ts`** — Consolidate into one module, update all imports.
2. **Add try-catch to file I/O** — Especially `loadTrace()`, `parseChaosConfig()`, `loadBaseline()` and similar functions that read user-provided paths.
3. **Sandbox `new Function()`** — Consider using `vm.runInNewContext()` or a restricted evaluator for custom assertions.

### Priority 2 (Medium Impact)
4. **Deduplicate cross-module functions** — Create shared utilities for `loadTraces`, `classifyError`, `parseDuration`, `percentile`.
5. **Add end-to-end CLI tests** — Test `agentprobe run`, `agentprobe security`, `agentprobe codegen` against fixture YAML files.
6. **Update pricing table** — Add newer model variants (Claude 4, GPT-4.1, etc).

### Priority 3 (Nice to Have)
7. **Make FaultInjector deterministic** — Add seedable random for reproducible chaos testing.
8. **Split `lib.ts`** — Consider separate entry points per feature area for better tree-shaking.
9. **Add npm audit fix** — Address 4 moderate vulnerabilities.
10. **Add CI pipeline** — GitHub Actions workflow for automated testing on PR.

---

## Summary

AgentProbe is a **well-built, production-quality testing framework** with genuine depth. The codebase demonstrates strong TypeScript discipline, comprehensive feature coverage, and real (not scaffolded) implementations. The 6 failing tests were caused by a missing convenience API in the cost module, and additional bugs were found and fixed in snapshot tracking and JSON parsing safety.

The main areas for improvement are code deduplication from rapid feature evolution, hardening file I/O error paths, and adding integration-level testing. The architecture is sound and the project is in good shape for an 0.1.x release.

**Final score: B+** — Solid engineering with a few evolutionary rough edges to polish.
