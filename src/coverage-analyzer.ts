/**
 * Test Coverage Analyzer — Analyze what agent tests cover
 * Reports tool coverage, intent coverage, error path coverage, and safety coverage.
 * @module
 */

import type { TestCase, TestSuite, AgentTrace } from './types';

export interface CoverageConfig {
  declaredTools?: string[];
  productionTraces?: AgentTrace[];
  safetyKeywords?: string[];
}

export interface ToolCoverageResult {
  totalDeclared: number;
  totalTested: number;
  percentage: number;
  testedTools: string[];
  missingTools: string[];
}

export interface IntentCoverageResult {
  totalIntents: number;
  coveredIntents: number;
  percentage: number;
  coveredList: string[];
  uncoveredList: string[];
}

export interface ErrorPathCoverageResult {
  totalPaths: number;
  coveredPaths: number;
  percentage: number;
}

export interface SafetyCoverageResult {
  totalTests: number;
  safetyTests: number;
  percentage: number;
  categories: string[];
}

export interface CoverageAnalysis {
  tool: ToolCoverageResult;
  intent: IntentCoverageResult;
  errorPath: ErrorPathCoverageResult;
  safety: SafetyCoverageResult;
  overallScore: number;
}

const DEFAULT_SAFETY_KEYWORDS = ['safety', 'security', 'injection', 'jailbreak', 'harmful', 'malicious', 'exploit', 'xss', 'sql_injection'];

/**
 * Extract all tool names referenced in test expectations
 */
export function extractTestedTools(tests: TestCase[]): string[] {
  const tools = new Set<string>();
  for (const test of tests) {
    const exp = test.expect;
    if (exp.tool_called) {
      const arr = Array.isArray(exp.tool_called) ? exp.tool_called : [exp.tool_called];
      arr.forEach(t => tools.add(t));
    }
    if (exp.tool_not_called) {
      const arr = Array.isArray(exp.tool_not_called) ? exp.tool_not_called : [exp.tool_not_called];
      arr.forEach(t => tools.add(t));
    }
    if (exp.tool_sequence) {
      exp.tool_sequence.forEach(t => tools.add(t));
    }
    if (exp.tool_args_match) {
      Object.keys(exp.tool_args_match).forEach(t => tools.add(t));
    }
  }
  return [...tools].sort();
}

/**
 * Analyze tool coverage
 */
export function analyzeToolCoverage(tests: TestCase[], declaredTools: string[]): ToolCoverageResult {
  const testedTools = extractTestedTools(tests);
  const testedSet = new Set(testedTools);
  const missingTools = declaredTools.filter(t => !testedSet.has(t));

  return {
    totalDeclared: declaredTools.length,
    totalTested: testedTools.length,
    percentage: declaredTools.length > 0 ? Math.round((testedSet.size / declaredTools.length) * 100) : 100,
    testedTools,
    missingTools,
  };
}

/**
 * Extract intents from production traces
 */
export function extractIntentsFromTraces(traces: AgentTrace[]): string[] {
  const intents = new Set<string>();
  for (const trace of traces) {
    for (const step of trace.steps) {
      if (step.type === 'llm_call' && step.data.messages) {
        const userMsg = step.data.messages.find(m => m.role === 'user');
        if (userMsg) {
          intents.add(userMsg.content.toLowerCase().trim().slice(0, 100));
        }
      }
    }
  }
  return [...intents];
}

/**
 * Analyze intent coverage by comparing test inputs against production intents
 */
export function analyzeIntentCoverage(tests: TestCase[], traces: AgentTrace[]): IntentCoverageResult {
  const intents = extractIntentsFromTraces(traces);
  if (intents.length === 0) {
    return { totalIntents: 0, coveredIntents: 0, percentage: 100, coveredList: [], uncoveredList: [] };
  }

  const testInputs = tests.map(t => t.input.toLowerCase().trim());
  const covered: string[] = [];
  const uncovered: string[] = [];

  for (const intent of intents) {
    const isCovered = testInputs.some(input =>
      input.includes(intent.slice(0, 30)) || intent.includes(input.slice(0, 30))
    );
    if (isCovered) covered.push(intent);
    else uncovered.push(intent);
  }

  return {
    totalIntents: intents.length,
    coveredIntents: covered.length,
    percentage: Math.round((covered.length / intents.length) * 100),
    coveredList: covered,
    uncoveredList: uncovered,
  };
}

/**
 * Analyze error path coverage
 */
export function analyzeErrorPathCoverage(tests: TestCase[]): ErrorPathCoverageResult {
  const errorTests = tests.filter(t =>
    t.faults !== undefined ||
    t.expect.tool_not_called !== undefined ||
    (t.tags && t.tags.some(tag => /error|fail|edge/i.test(tag)))
  );
  const total = Math.max(tests.length, 1);
  return {
    totalPaths: total,
    coveredPaths: errorTests.length,
    percentage: Math.round((errorTests.length / total) * 100),
  };
}

/**
 * Analyze safety coverage
 */
export function analyzeSafetyCoverage(tests: TestCase[], keywords?: string[]): SafetyCoverageResult {
  const safetyKw = keywords ?? DEFAULT_SAFETY_KEYWORDS;
  const categories = new Set<string>();

  const safetyTests = tests.filter(t => {
    const nameAndInput = `${t.name} ${t.input} ${(t.tags ?? []).join(' ')}`.toLowerCase();
    for (const kw of safetyKw) {
      if (nameAndInput.includes(kw)) {
        categories.add(kw);
        return true;
      }
    }
    return false;
  });

  return {
    totalTests: tests.length,
    safetyTests: safetyTests.length,
    percentage: tests.length > 0 ? Math.round((safetyTests.length / tests.length) * 100) : 0,
    categories: [...categories],
  };
}

/**
 * Run full coverage analysis
 */
export function analyzeCoverageComplete(tests: TestCase[], config: CoverageConfig = {}): CoverageAnalysis {
  const tool = analyzeToolCoverage(tests, config.declaredTools ?? []);
  const intent = analyzeIntentCoverage(tests, config.productionTraces ?? []);
  const errorPath = analyzeErrorPathCoverage(tests);
  const safety = analyzeSafetyCoverage(tests, config.safetyKeywords);

  const overallScore = Math.round(
    (tool.percentage * 0.3 + intent.percentage * 0.25 + errorPath.percentage * 0.2 + safety.percentage * 0.25)
  );

  return { tool, intent, errorPath, safety, overallScore };
}

/**
 * Format coverage analysis for display
 */
export function formatCoverageAnalysis(analysis: CoverageAnalysis): string {
  const lines: string[] = [];
  lines.push('📋 Test Coverage');
  lines.push(`  Tool coverage: ${analysis.tool.percentage}% (${analysis.tool.totalTested}/${analysis.tool.totalDeclared} tools tested)`);
  if (analysis.tool.missingTools.length > 0) {
    lines.push(`  Missing: [${analysis.tool.missingTools.join(', ')}]`);
  }
  lines.push(`  Intent coverage: ${analysis.intent.percentage}% (based on production traces)`);
  lines.push(`  Error path coverage: ${analysis.errorPath.percentage}%`);
  lines.push(`  Safety coverage: ${analysis.safety.percentage}%`);
  lines.push(`  Overall score: ${analysis.overallScore}%`);
  return lines.join('\n');
}
