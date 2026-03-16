/**
 * Test Dependency Graph — Analyze dependencies between tests for optimal execution.
 *
 * @example
 * ```typescript
 * const analyzer = new TestDependencyAnalyzer(suite);
 * const groups = analyzer.findParallelGroups();
 * const critical = analyzer.findCriticalPath();
 * const plan = analyzer.optimize();
 * ```
 */

import type { TestSuite, TestCase } from './types';

// ===== Types =====

export interface DependencyGraph {
  nodes: Map<string, TestNode>;
  edges: DependencyEdge[];
}

export interface TestNode {
  name: string;
  id: string;
  dependsOn: string[];
  dependedBy: string[];
  estimatedDurationMs: number;
  tags: string[];
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface TestGroup {
  level: number;
  tests: string[];
}

export interface TestChain {
  path: string[];
  totalEstimatedMs: number;
}

export interface TestExecutionPlan {
  phases: TestGroup[];
  criticalPath: TestChain;
  estimatedTotalMs: number;
  parallelEfficiency: number; // ratio of parallel vs sequential time
}

// ===== TestDependencyAnalyzer =====

export class TestDependencyAnalyzer {
  private graph: DependencyGraph;
  private testMap: Map<string, TestCase>;

  constructor(suite: TestSuite) {
    this.testMap = new Map();
    for (const test of suite.tests) {
      const key = test.id ?? test.name;
      this.testMap.set(key, test);
    }
    this.graph = this.buildGraph(suite);
  }

  private buildGraph(suite: TestSuite): DependencyGraph {
    const nodes = new Map<string, TestNode>();
    const edges: DependencyEdge[] = [];

    // Create nodes
    for (const test of suite.tests) {
      const key = test.id ?? test.name;
      const deps = test.depends_on
        ? (Array.isArray(test.depends_on) ? test.depends_on : [test.depends_on])
        : [];

      nodes.set(key, {
        name: test.name,
        id: key,
        dependsOn: deps,
        dependedBy: [],
        estimatedDurationMs: test.timeout_ms ?? 5000,
        tags: test.tags ?? [],
      });
    }

    // Build edges and reverse links
    for (const [key, node] of nodes) {
      for (const dep of node.dependsOn) {
        edges.push({ from: dep, to: key });
        const parent = nodes.get(dep);
        if (parent) {
          parent.dependedBy.push(key);
        }
      }
    }

    return { nodes, edges };
  }

  /** Get the dependency graph. */
  analyze(): DependencyGraph {
    return this.graph;
  }

  /** Find groups of tests that can run in parallel (topological levels). */
  findParallelGroups(): TestGroup[] {
    const { nodes } = this.graph;
    const inDegree = new Map<string, number>();
    const remaining = new Set<string>();

    for (const [key, node] of nodes) {
      inDegree.set(key, node.dependsOn.filter(d => nodes.has(d)).length);
      remaining.add(key);
    }

    const groups: TestGroup[] = [];
    let level = 0;

    while (remaining.size > 0) {
      const ready: string[] = [];
      for (const key of remaining) {
        if ((inDegree.get(key) ?? 0) <= 0) {
          ready.push(key);
        }
      }

      if (ready.length === 0) {
        // Remaining tests have unresolvable deps (circular or missing) - add them all
        groups.push({ level, tests: Array.from(remaining) });
        break;
      }

      groups.push({ level, tests: ready.sort() });

      for (const key of ready) {
        remaining.delete(key);
        const node = nodes.get(key)!;
        for (const child of node.dependedBy) {
          inDegree.set(child, (inDegree.get(child) ?? 1) - 1);
        }
      }

      level++;
    }

    return groups;
  }

  /** Find the critical path (longest sequential chain by estimated duration). */
  findCriticalPath(): TestChain {
    const { nodes } = this.graph;
    const memo = new Map<string, { path: string[]; totalMs: number }>();

    const dfs = (key: string, visited: Set<string>): { path: string[]; totalMs: number } => {
      if (memo.has(key)) return memo.get(key)!;
      if (visited.has(key)) return { path: [key], totalMs: 0 }; // cycle guard

      visited.add(key);
      const node = nodes.get(key);
      if (!node) return { path: [], totalMs: 0 };

      let longest = { path: [] as string[], totalMs: 0 };
      for (const dep of node.dependsOn) {
        if (nodes.has(dep)) {
          const sub = dfs(dep, visited);
          if (sub.totalMs > longest.totalMs) {
            longest = sub;
          }
        }
      }

      const result = {
        path: [...longest.path, key],
        totalMs: longest.totalMs + node.estimatedDurationMs,
      };
      memo.set(key, result);
      visited.delete(key);
      return result;
    };

    let criticalPath: TestChain = { path: [], totalEstimatedMs: 0 };

    for (const key of nodes.keys()) {
      const result = dfs(key, new Set());
      if (result.totalMs > criticalPath.totalEstimatedMs) {
        criticalPath = { path: result.path, totalEstimatedMs: result.totalMs };
      }
    }

    return criticalPath;
  }

  /** Detect circular dependencies. */
  detectCircular(): string[][] {
    const { nodes } = this.graph;
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (key: string, stack: string[]): void => {
      if (inStack.has(key)) {
        const cycleStart = stack.indexOf(key);
        if (cycleStart >= 0) {
          cycles.push(stack.slice(cycleStart));
        }
        return;
      }
      if (visited.has(key)) return;

      visited.add(key);
      inStack.add(key);
      stack.push(key);

      const node = nodes.get(key);
      if (node) {
        for (const dep of node.dependsOn) {
          if (nodes.has(dep)) {
            dfs(dep, [...stack]);
          }
        }
      }

      inStack.delete(key);
    };

    for (const key of nodes.keys()) {
      visited.clear();
      inStack.clear();
      dfs(key, []);
    }

    // Deduplicate cycles
    const seen = new Set<string>();
    return cycles.filter(c => {
      const normalized = [...c].sort().join(',');
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  /** Generate optimal execution plan. */
  optimize(): TestExecutionPlan {
    const phases = this.findParallelGroups();
    const criticalPath = this.findCriticalPath();
    const { nodes } = this.graph;

    // Sequential time = sum of all test durations
    let sequentialMs = 0;
    for (const node of nodes.values()) {
      sequentialMs += node.estimatedDurationMs;
    }

    // Parallel time = sum of max duration per phase
    let parallelMs = 0;
    for (const phase of phases) {
      let maxInPhase = 0;
      for (const testId of phase.tests) {
        const node = nodes.get(testId);
        if (node && node.estimatedDurationMs > maxInPhase) {
          maxInPhase = node.estimatedDurationMs;
        }
      }
      parallelMs += maxInPhase;
    }

    return {
      phases,
      criticalPath,
      estimatedTotalMs: parallelMs,
      parallelEfficiency: sequentialMs > 0 ? parallelMs / sequentialMs : 1,
    };
  }
}

/** Format execution plan for console output. */
export function formatExecutionPlan(plan: TestExecutionPlan): string {
  const lines: string[] = [];
  lines.push(`\n📊 Test Execution Plan`);
  lines.push(`   Phases: ${plan.phases.length} | Efficiency: ${(plan.parallelEfficiency * 100).toFixed(0)}% of sequential`);
  lines.push(`   Estimated time: ${plan.estimatedTotalMs}ms`);
  lines.push('');

  for (const phase of plan.phases) {
    lines.push(`   Phase ${phase.level}: [${phase.tests.join(', ')}]`);
  }

  if (plan.criticalPath.path.length > 0) {
    lines.push('');
    lines.push(`   Critical path: ${plan.criticalPath.path.join(' → ')} (${plan.criticalPath.totalEstimatedMs}ms)`);
  }

  lines.push('');
  return lines.join('\n');
}
