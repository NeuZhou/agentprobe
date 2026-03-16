import type { TestCase } from './types';
import * as fs from 'fs';

export type CoverageCategory =
  | 'Tool Usage'
  | 'Error Handling'
  | 'Multi-turn'
  | 'Safety'
  | 'Edge Cases'
  | 'Performance';

export interface CoverageEntry {
  category: CoverageCategory;
  testCount: number;
  coveragePercent: number;
  gap?: string;
}

export interface CoverageMap {
  entries: CoverageEntry[];
  totalTests: number;
  overallCoverage: number;
}

const CATEGORY_RULES: Record<CoverageCategory, {
  detect: (t: TestCase) => boolean;
  target: number;
  gapHint: string;
}> = {
  'Tool Usage': {
    detect: (t) => !!(t.expect.tool_called || t.expect.tool_not_called || t.expect.tool_sequence || t.expect.tool_args_match),
    target: 10,
    gapHint: 'Add tests for tool selection and tool argument validation',
  },
  'Error Handling': {
    detect: (t) => !!(t.faults || t.expect.tool_not_called || t.input === '' || /error|fail|invalid|broken/i.test(t.input)),
    target: 8,
    gapHint: 'Add fault injection and graceful degradation tests',
  },
  'Multi-turn': {
    detect: (t) => !!(t.expect.chain || t.expect.tool_sequence || (t.expect.max_steps && t.expect.max_steps > 5)),
    target: 8,
    gapHint: 'Add multi-step conversation and chain tests',
  },
  'Safety': {
    detect: (t) => !!(t.expect.output_not_contains || (t.tags && t.tags.includes('safety')) || /inject|hack|ignore|malware|exfil/i.test(t.input)),
    target: 10,
    gapHint: 'Add prompt injection and data exfiltration tests',
  },
  'Edge Cases': {
    detect: (t) => !!(t.input === '' || t.input.length > 500 || /gibberish|nonsense|empty|edge/i.test(t.name) || (t.tags && t.tags.includes('edge'))),
    target: 8,
    gapHint: 'Add tests for empty input, very long input, and unusual formats',
  },
  'Performance': {
    detect: (t) => !!(t.expect.max_duration_ms || t.expect.max_tokens || t.expect.max_cost_usd || (t.tags && t.tags.includes('perf'))),
    target: 6,
    gapHint: 'Add latency, token budget, and cost constraint tests',
  },
};

/**
 * Analyze test cases and produce a coverage map.
 */
export function buildCoverageMap(tests: TestCase[]): CoverageMap {
  const entries: CoverageEntry[] = [];
  let totalCoverage = 0;

  for (const [category, rule] of Object.entries(CATEGORY_RULES) as [CoverageCategory, typeof CATEGORY_RULES[CoverageCategory]][]) {
    const matching = tests.filter(rule.detect);
    const pct = Math.min(100, Math.round((matching.length / rule.target) * 100));
    const needed = Math.max(0, rule.target - matching.length);
    entries.push({
      category,
      testCount: matching.length,
      coveragePercent: pct,
      gap: needed > 0 ? `${rule.gapHint} (need ${needed} more)` : undefined,
    });
    totalCoverage += pct;
  }

  return {
    entries,
    totalTests: tests.length,
    overallCoverage: Math.round(totalCoverage / entries.length),
  };
}

/**
 * Format coverage map as ASCII bar chart.
 */
export function formatCoverageMap(map: CoverageMap): string {
  const lines: string[] = ['🗺️  Agent Coverage Map', '┌─────────────────────────────────────┐'];

  for (const entry of map.entries) {
    const filled = Math.round(entry.coveragePercent / 10);
    const empty = 10 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const label = entry.category.padEnd(16);
    lines.push(`│ ${label}[${bar}] ${String(entry.coveragePercent).padStart(3)}% │`);
  }

  lines.push('└─────────────────────────────────────┘');

  const gaps = map.entries.filter(e => e.gap);
  if (gaps.length > 0) {
    lines.push('');
    lines.push('Gaps:');
    for (const g of gaps) {
      lines.push(`  ${g.category}: ${g.gap}`);
    }
  }

  return lines.join('\n');
}

/**
 * Load tests from YAML and build coverage map.
 */
export function coverageMapFromFile(filePath: string): CoverageMap {
  const YAML = require('yaml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const suite = YAML.parse(raw);
  return buildCoverageMap(suite.tests || []);
}
