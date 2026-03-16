import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import type { TestSuite, TestResult, SuiteResult, AgentTrace } from './types';
import { evaluate } from './assertions';
import { loadTrace } from './recorder';

export async function runSuite(suitePath: string): Promise<SuiteResult> {
  const raw = fs.readFileSync(suitePath, 'utf-8');
  const suite: TestSuite = YAML.parse(raw);
  const suiteDir = path.dirname(suitePath);
  const start = Date.now();
  const results: TestResult[] = [];

  for (const test of suite.tests) {
    const testStart = Date.now();
    try {
      let trace: AgentTrace;

      if (test.trace) {
        // Replay mode: load existing trace
        const tracePath = path.isAbsolute(test.trace) ? test.trace : path.join(suiteDir, test.trace);
        trace = loadTrace(tracePath);
      } else {
        // No trace provided — create a minimal synthetic trace from test input
        // In a real scenario, this would invoke the agent
        trace = {
          id: `synthetic-${Date.now()}`,
          timestamp: new Date().toISOString(),
          steps: [],
          metadata: { input: test.input, context: test.context },
        };
      }

      const assertions = evaluate(trace, test.expect);
      const passed = assertions.every(a => a.passed);

      results.push({
        name: test.name,
        passed,
        assertions,
        duration_ms: Date.now() - testStart,
        trace,
      });
    } catch (err: any) {
      results.push({
        name: test.name,
        passed: false,
        assertions: [],
        duration_ms: Date.now() - testStart,
        error: err.message,
      });
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
