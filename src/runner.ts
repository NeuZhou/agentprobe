import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import YAML from 'yaml';
import type { TestSuite, TestCase, TestResult, SuiteResult, AgentTrace, RunOptions, HookConfig } from './types';
import { evaluate } from './assertions';
import { loadTrace } from './recorder';
import { MockToolkit } from './mocks';
import { loadFixture, applyFixtureMocks, applyFixtureEnv, restoreEnv } from './fixtures';
import { matchSnapshot, SnapshotConfig } from './snapshots';

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

export async function runSuite(suitePath: string, options?: RunOptions): Promise<SuiteResult> {
  const raw = fs.readFileSync(suitePath, 'utf-8');
  const suite: TestSuite = YAML.parse(raw);
  const suiteDir = path.dirname(suitePath);
  const start = Date.now();
  const results: TestResult[] = [];

  // Expand parameterized tests, then filter by tags
  let tests = expandTests(suite.tests);
  tests = filterByTags(tests, options?.tags);

  // Run beforeAll hook
  runHook(suite.hooks?.beforeAll);

  for (const test of tests) {
    // Run beforeEach hook
    runHook(suite.hooks?.beforeEach);

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

      // Apply inline mocks
      if (test.mocks) {
        for (const [toolName, response] of Object.entries(test.mocks)) {
          const r = response;
          toolkit.mock(toolName, () => r);
        }
      }

      let trace: AgentTrace;

      if (test.trace) {
        // Replay mode: load existing trace
        const tracePath = path.isAbsolute(test.trace) ? test.trace : path.join(suiteDir, test.trace);
        trace = loadTrace(tracePath);
      } else if (test.agent) {
        // Live agent execution
        trace = await executeAgent(test, toolkit, suiteDir);
      } else {
        // Synthetic trace
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

      results.push({
        name: test.name,
        passed,
        assertions,
        duration_ms: Date.now() - testStart,
        trace,
        tags: test.tags,
      });

      // Restore env
      if (Object.keys(envBackup).length > 0) restoreEnv(envBackup);
    } catch (err: any) {
      results.push({
        name: test.name,
        passed: false,
        assertions: [],
        duration_ms: Date.now() - testStart,
        error: err.message,
        tags: test.tags,
      });
    }

    // Run afterEach hook
    runHook(suite.hooks?.afterEach);
  }

  // Run afterAll hook
  runHook(suite.hooks?.afterAll);

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
    // Run via shell command, capture stdout
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
    // Dynamic import
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
