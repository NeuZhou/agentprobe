/**
 * Test Dependencies — DAG-based test execution ordering.
 */

import type { TestCase } from './types';

export interface DepTestCase extends TestCase {
  id?: string;
  depends_on?: string | string[];
}

export interface ExecutionPlan {
  /** Groups of tests that can run in parallel within each group, sequential between groups */
  groups: DepTestCase[][];
  /** Map of test id to its dependents */
  dependencyMap: Map<string, string[]>;
}

/**
 * Build an execution plan from tests with dependencies.
 * Tests without deps go first. Tests with deps wait for their deps.
 */
export function buildExecutionPlan(tests: DepTestCase[]): ExecutionPlan {
  const idMap = new Map<string, DepTestCase>();
  const dependencyMap = new Map<string, string[]>();

  // Index tests by id
  for (const test of tests) {
    if (test.id) {
      idMap.set(test.id, test);
    }
  }

  // Build reverse dependency map
  for (const test of tests) {
    if (test.depends_on) {
      const deps = Array.isArray(test.depends_on) ? test.depends_on : [test.depends_on];
      for (const dep of deps) {
        if (!dependencyMap.has(dep)) dependencyMap.set(dep, []);
        dependencyMap.get(dep)!.push(test.id ?? test.name);
      }
    }
  }

  // Topological sort into groups
  const resolved = new Set<string>();
  const groups: DepTestCase[][] = [];
  let remaining = [...tests];

  while (remaining.length > 0) {
    const ready: DepTestCase[] = [];
    const notReady: DepTestCase[] = [];

    for (const test of remaining) {
      const deps = test.depends_on
        ? Array.isArray(test.depends_on)
          ? test.depends_on
          : [test.depends_on]
        : [];

      if (deps.every((d) => resolved.has(d))) {
        ready.push(test);
      } else {
        notReady.push(test);
      }
    }

    if (ready.length === 0) {
      // Circular dependency or missing deps — just push remaining
      groups.push(notReady);
      break;
    }

    groups.push(ready);
    for (const test of ready) {
      resolved.add(test.id ?? test.name);
    }
    remaining = notReady;
  }

  return { groups, dependencyMap };
}

/**
 * Generate a Mermaid diagram of test dependencies.
 */
export function generateDependencyGraph(tests: DepTestCase[]): string {
  const lines: string[] = ['graph TD'];

  // Add all nodes
  for (const test of tests) {
    const id = sanitizeMermaidId(test.id ?? test.name);
    const label = test.name.replace(/"/g, "'");
    lines.push(`  ${id}["${label}"]`);
  }

  // Add edges
  for (const test of tests) {
    const testId = sanitizeMermaidId(test.id ?? test.name);
    if (test.depends_on) {
      const deps = Array.isArray(test.depends_on) ? test.depends_on : [test.depends_on];
      for (const dep of deps) {
        const depId = sanitizeMermaidId(dep);
        lines.push(`  ${depId} --> ${testId}`);
      }
    }
  }

  return lines.join('\n');
}

function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Format dependency graph info for terminal display.
 */
export function formatDependencyGraph(tests: DepTestCase[]): string {
  const plan = buildExecutionPlan(tests);
  const lines: string[] = ['📊 Test Dependency Graph\n'];

  for (let i = 0; i < plan.groups.length; i++) {
    lines.push(`  Group ${i + 1} (parallel):`);
    for (const test of plan.groups[i]) {
      const deps = test.depends_on
        ? Array.isArray(test.depends_on) ? test.depends_on : [test.depends_on]
        : [];
      const depStr = deps.length > 0 ? ` ← depends on: ${deps.join(', ')}` : '';
      lines.push(`    • ${test.id ?? test.name}${depStr}`);
    }
  }

  lines.push('\n  Mermaid diagram:');
  lines.push('  ```mermaid');
  lines.push('  ' + generateDependencyGraph(tests).split('\n').join('\n  '));
  lines.push('  ```');

  return lines.join('\n');
}

/**
 * Check if a test should be skipped because a dependency failed.
 */
export function shouldSkip(
  test: DepTestCase,
  completedResults: Map<string, boolean>,
): { skip: boolean; reason?: string } {
  if (!test.depends_on) return { skip: false };

  const deps = Array.isArray(test.depends_on) ? test.depends_on : [test.depends_on];
  for (const dep of deps) {
    const passed = completedResults.get(dep);
    if (passed === undefined) {
      return { skip: true, reason: `Dependency "${dep}" was not executed` };
    }
    if (!passed) {
      return { skip: true, reason: `Dependency "${dep}" failed` };
    }
  }
  return { skip: false };
}
