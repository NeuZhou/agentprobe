import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import YAML from 'yaml';
import chalk from 'chalk';
import type { TestSuite, TestCase, TestResult, SuiteResult, AgentTrace, RunOptions, HookConfig } from './types';
import { parseYamlWithValidation } from './yaml-validator';
import { evaluate } from './assertions';
import { loadTrace } from './recorder';
import { MockToolkit } from './mocks';
import { loadFixture, applyFixtureMocks, applyFixtureEnv, restoreEnv } from './fixtures';
import { matchSnapshot, SnapshotConfig } from './snapshots';
import { withRetry, formatRetryInfo } from './retry';
import { buildExecutionPlan, shouldSkip, type DepTestCase } from './deps';
import { parseEnvFile, resolveEnvRecord, applyEnv, restoreProcessEnv } from './env';

function runHook(hook: HookConfig | undefined): void {
  if (!hook?.command) return;
  execSync(hook.command, { stdio: 'pipe' });
}

/**
 * Expand parameterized tests (each).
 */
function expandTests(tests: TestCase[]): TestCase[] {
  const expanded: TestCase[] = [];
  for (const test of tests) {
    if (test.each && test.each.length > 0) {
      for (const params of test.each) {
        let name = test.name;
        let input = test.input;
        for (const [key, val] of Object.entries(params)) {
          name = name.replace(`\${${key}}`, String(val));
          input = input.replace(`\${${key}}`, String(val));
        }
        expanded.push({ ...test, name, input, each: undefined });
      }
    } else {
      expanded.push(test);
    }
  }
  return expanded;
}

/**
 * Filter tests by tags.
 */
function filterByTags(tests: TestCase[], tags?: string[]): TestCase[] {
  if (!tags || tags.length === 0) return tests;
  return tests.filter(t => t.tags?.some(tag => tags.includes(tag)));
}

/**
 * Run a single test case and return the result.
 */
async function runSingleTest(
  test: TestCase,
  suiteDir: string,
  options?: RunOptions,
): Promise<TestResult> {
  const testStart = Date.now();
  try {
    const toolkit = new MockToolkit();

    // Apply fixture mocks if specified
    let envBackup: Record<string, string | undefined> = {};
    if (test.fixture) {
      const fixturePath = path.isAbsolute(test.fixture) ? test.fixture : path.join(suiteDir, test.fixture);
      const fixture = loadFixture(fixturePath);
      applyFixtureMocks(fixture, toolkit, path.dirname(fixturePath));
      envBackup = applyFixtureEnv(fixture);
    }

    // Apply test-level env vars
    let testEnvBackup: Record<string, string | undefined> = {};
    if (test.env) {
      const resolved = resolveEnvRecord(test.env);
      testEnvBackup = applyEnv(resolved);
    }

    // Apply inline mocks
    if (test.mocks) {
      for (const [toolName, response] of Object.entries(test.mocks)) {
        const r = response;
        toolkit.mock(toolName, () => r);
      }
    }

    let trace: AgentTrace;

    if (test.trace) {
      const tracePath = path.isAbsolute(test.trace) ? test.trace : path.join(suiteDir, test.trace);
      if (!fs.existsSync(tracePath)) {
        throw new Error(
          `Trace file not found: ${tracePath}\n` +
          `💡 Record a trace first: agentprobe record --script your-agent.js -o ${test.trace}`
        );
      }
      trace = loadTrace(tracePath);
    } else if (test.agent) {
      trace = await executeAgent(test, toolkit, suiteDir);
    } else {
      trace = {
        id: `synthetic-${Date.now()}`,
        timestamp: new Date().toISOString(),
        steps: [],
        metadata: { input: test.input, context: test.context },
      };
    }

    const assertions = evaluate(trace, test.expect);

    // Snapshot testing
    if (test.expect.snapshot) {
      const snapConfig: SnapshotConfig = {
        updateSnapshots: options?.updateSnapshots ?? false,
        snapshotDir: path.join(suiteDir, '__snapshots__'),
      };
      const snapResult = matchSnapshot(trace, test.name, snapConfig);
      if (!snapResult.match) {
        assertions.push({
          name: 'snapshot',
          passed: false,
          message: `Snapshot mismatch:\n${snapResult.diff}`,
        });
      } else {
        assertions.push({
          name: 'snapshot',
          passed: true,
          message: snapResult.created ? 'Snapshot created' : snapResult.updated ? 'Snapshot updated' : 'Snapshot matched',
        });
      }
    }

    const passed = assertions.every(a => a.passed);

    // Restore env
    if (Object.keys(testEnvBackup).length > 0) restoreProcessEnv(testEnvBackup);
    if (Object.keys(envBackup).length > 0) restoreEnv(envBackup);

    return {
      name: test.name,
      passed,
      assertions,
      duration_ms: Date.now() - testStart,
      trace,
      tags: test.tags,
    };
  } catch (err: any) {
    return {
      name: test.name,
      passed: false,
      assertions: [],
      duration_ms: Date.now() - testStart,
      error: err.message,
      tags: test.tags,
    };
  }
}

/**
 * Run tests in parallel with concurrency limit.
 */
async function runParallel<T>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers: Promise<void>[] = [];

  for (let i = 0; i < Math.min(maxConcurrency, items.length); i++) {
    workers.push((async () => {
      while (index < items.length) {
        const currentIndex = index++;
        if (currentIndex >= items.length) break;
        await fn(items[currentIndex]);
      }
    })());
  }

  await Promise.all(workers);
}

export async function runSuite(suitePath: string, options?: RunOptions): Promise<SuiteResult> {
  const raw = fs.readFileSync(suitePath, 'utf-8');

  const { parsed: suite, warnings } = parseYamlWithValidation(raw, suitePath) as { parsed: TestSuite; warnings: string[] };
  for (const w of warnings) {
    console.error(chalk.yellow(w));
  }

  if (!suite || !suite.tests) {
    throw new Error(
      `Invalid test suite: ${suitePath}\n` +
      `Expected a YAML file with 'name' and 'tests' fields.\n` +
      `💡 Run 'agentprobe init' to generate an example.`
    );
  }

  const suiteDir = path.dirname(suitePath);
  const start = Date.now();
  const results: TestResult[] = [];

  // Load .env file if specified in options
  if (options?.envFile) {
    const envFilePath = path.isAbsolute(options.envFile) ? options.envFile : path.resolve(options.envFile);
    if (fs.existsSync(envFilePath)) {
      const envVars = parseEnvFile(envFilePath);
      for (const [key, value] of Object.entries(envVars)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }

  // Expand parameterized tests, then filter by tags
  let tests = expandTests(suite.tests);
  tests = filterByTags(tests, options?.tags);

  const isParallel = suite.config?.parallel ?? false;
  const maxConcurrency = suite.config?.max_concurrency ?? 4;

  // Run beforeAll hook
  runHook(suite.hooks?.beforeAll);

  if (isParallel) {
    // Build execution plan for dependencies
    const plan = buildExecutionPlan(tests as DepTestCase[]);
    const completedResults = new Map<string, boolean>();

    console.log(chalk.cyan(`Running ${tests.length} tests (${maxConcurrency} parallel)...`));

    for (const group of plan.groups) {
      const groupResults: TestResult[] = [];

      await runParallel(group, maxConcurrency, async (test) => {
        runHook(suite.hooks?.beforeEach);

        // Check dependencies
        const skipCheck = shouldSkip(test, completedResults);
        if (skipCheck.skip) {
          const result: TestResult = {
            name: test.name,
            passed: false,
            assertions: [],
            duration_ms: 0,
            tags: test.tags,
            skipped: true,
            skipReason: skipCheck.reason,
          };
          groupResults.push(result);
          completedResults.set(test.id ?? test.name, false);
          runHook(suite.hooks?.afterEach);
          return;
        }

        const runFn = () => runSingleTest(test, suiteDir, options);

        let result: TestResult;
        if (test.retries && test.retries > 0) {
          const retryResult = await withRetry(runFn, {
            retries: test.retries,
            retry_delay_ms: test.retry_delay_ms,
          });
          result = { ...retryResult, attempts: retryResult.attempts };
        } else {
          result = await runFn();
        }

        groupResults.push(result);
        completedResults.set(test.id ?? test.name, result.passed);
        runHook(suite.hooks?.afterEach);
      });

      results.push(...groupResults);
    }
  } else {
    // Sequential execution with dependency support
    const completedResults = new Map<string, boolean>();

    for (const test of tests as DepTestCase[]) {
      runHook(suite.hooks?.beforeEach);

      // Check dependencies
      const skipCheck = shouldSkip(test, completedResults);
      if (skipCheck.skip) {
        results.push({
          name: test.name,
          passed: false,
          assertions: [],
          duration_ms: 0,
          tags: test.tags,
          skipped: true,
          skipReason: skipCheck.reason,
        });
        completedResults.set(test.id ?? test.name, false);
        runHook(suite.hooks?.afterEach);
        continue;
      }

      const runFn = () => runSingleTest(test, suiteDir, options);

      let result: TestResult;
      if (test.retries && test.retries > 0) {
        const retryResult = await withRetry(runFn, {
          retries: test.retries,
          retry_delay_ms: test.retry_delay_ms,
        });
        result = { ...retryResult, attempts: retryResult.attempts };
      } else {
        result = await runFn();
      }

      results.push(result);
      completedResults.set(test.id ?? test.name, result.passed);
      runHook(suite.hooks?.afterEach);
    }
  }

  // Run afterAll hook
  runHook(suite.hooks?.afterAll);

  // Strict mode checks
  if (suite.config?.strict) {
    const strictErrors: string[] = [];

    // Check for unused mocks across all tests
    // (We can only check at suite level - warn about tests with mocks where trace doesn't use those tools)
    for (const result of results) {
      if (result.trace) {
        const calledTools = new Set(result.trace.steps.filter(s => s.type === 'tool_call').map(s => s.data.tool_name));
        const testDef = tests.find(t => t.name === result.name);
        if (testDef?.mocks) {
          for (const mockName of Object.keys(testDef.mocks)) {
            if (!calledTools.has(mockName)) {
              strictErrors.push(`Unused mock "${mockName}" in test "${result.name}"`);
            }
          }
        }
      }
    }

    // Check for uncovered tools (tools called but not asserted on)
    for (const result of results) {
      if (result.trace) {
        const calledTools = new Set(result.trace.steps.filter(s => s.type === 'tool_call').map(s => s.data.tool_name));
        const testDef = tests.find(t => t.name === result.name);
        if (testDef?.expect?.tool_called) {
          const asserted = new Set(Array.isArray(testDef.expect.tool_called)
            ? testDef.expect.tool_called : [testDef.expect.tool_called]);
          for (const tool of calledTools) {
            if (tool && !asserted.has(tool)) {
              strictErrors.push(`Uncovered tool "${tool}" in test "${result.name}" (called but not asserted)`);
            }
          }
        }
      }
    }

    // Check for assertion warnings
    for (const result of results) {
      for (const assertion of result.assertions) {
        if (assertion.message && !assertion.passed) {
          strictErrors.push(`Assertion warning in "${result.name}": ${assertion.message}`);
        }
      }
    }

    if (strictErrors.length > 0) {
      console.error(chalk.red('\n⚠️  Strict mode violations:'));
      for (const err of strictErrors) {
        console.error(chalk.red(`  • ${err}`));
      }
      // Mark suite as having additional failures
      const extraFailures = strictErrors.length;
      // We don't add fake results but we note it
      console.error(chalk.red(`\n  ${extraFailures} strict mode violation(s)`));
    }
  }

  const passed = results.filter(r => r.passed).length;
  return {
    name: suite.name,
    passed,
    failed: results.length - passed,
    total: results.length,
    duration_ms: Date.now() - start,
    results,
  };
}

/**
 * Execute an agent and capture its trace.
 */
async function executeAgent(test: TestCase, toolkit: MockToolkit, suiteDir: string): Promise<AgentTrace> {
  const agent = test.agent!;
  const trace: AgentTrace = {
    id: `live-${Date.now()}`,
    timestamp: new Date().toISOString(),
    steps: [],
    metadata: { input: test.input, agent },
  };

  if (agent.command) {
    const result = execSync(agent.command, {
      cwd: suiteDir,
      env: { ...process.env, AGENT_INPUT: test.input },
      timeout: 60000,
      encoding: 'utf-8',
    });
    trace.steps.push({
      type: 'output',
      timestamp: new Date().toISOString(),
      data: { content: result },
    });
  } else if (agent.module || agent.script) {
    const modPath = agent.module || agent.script!;
    const resolved = path.isAbsolute(modPath) ? modPath : path.join(suiteDir, modPath);
    const mod = await import(resolved);
    const entry = agent.entry ?? 'run';
    if (typeof mod[entry] === 'function') {
      const output = await mod[entry](test.input, {
        mockToolkit: toolkit,
      });
      if (output) {
        trace.steps.push({
          type: 'output',
          timestamp: new Date().toISOString(),
          data: { content: String(output) },
        });
      }
    }
  }

  return trace;
}
