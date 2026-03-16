import * as fs from 'fs';
import YAML from 'yaml';
import type { TestCase } from './types';

export interface ImpactResult {
  changedFiles: string[];
  affectedTests: ImpactedTest[];
  unaffectedCount: number;
}

export interface ImpactedTest {
  name: string;
  file: string;
  reason: string;
}

/**
 * Analyze which tests are affected by a set of changed files.
 *
 * Heuristics:
 * - If a test references a tool whose name appears in a changed file path, it's affected
 * - If a test's trace file references a changed file, it's affected
 * - If a changed file is a core module, all tests may be affected
 */
export function analyzeImpact(
  changedFiles: string[],
  suiteFiles: string[],
): ImpactResult {
  const affectedTests: ImpactedTest[] = [];
  let totalTests = 0;

  // Extract tool/module names from changed file paths
  const changedNames = changedFiles.map((f) => {
    const base = f.replace(/\\/g, '/').split('/').pop() ?? '';
    return base.replace(/\.(ts|js|py|go|rs)$/, '').toLowerCase();
  });

  const coreModules = ['runner', 'assertions', 'types', 'config', 'index', 'lib'];
  const isCoreChange = changedNames.some((n) => coreModules.includes(n));

  for (const suiteFile of suiteFiles) {
    if (!fs.existsSync(suiteFile)) continue;

    const raw = fs.readFileSync(suiteFile, 'utf-8');
    let suite: any;
    try {
      suite = YAML.parse(raw);
    } catch {
      continue;
    }

    const tests: TestCase[] = suite.tests ?? [];
    totalTests += tests.length;

    for (const test of tests) {
      if (isCoreChange) {
        affectedTests.push({
          name: test.name,
          file: suiteFile,
          reason: 'core module changed',
        });
        continue;
      }

      // Check if test uses a tool that matches changed files
      const toolsCalled = Array.isArray(test.expect?.tool_called)
        ? test.expect.tool_called
        : test.expect?.tool_called
          ? [test.expect.tool_called]
          : [];

      const toolSequence = test.expect?.tool_sequence ?? [];
      const allTools = [...toolsCalled, ...toolSequence];

      for (const tool of allTools) {
        const toolLower = tool.toLowerCase();
        if (changedNames.some((n) => n.includes(toolLower) || toolLower.includes(n))) {
          affectedTests.push({
            name: test.name,
            file: suiteFile,
            reason: `uses tool: ${tool}`,
          });
          break;
        }
      }

      // Check input/tags for references to changed modules
      const inputLower = (test.input ?? '').toLowerCase();
      const tags = test.tags ?? [];
      for (const name of changedNames) {
        if (inputLower.includes(name) || tags.some((t) => t.toLowerCase().includes(name))) {
          if (!affectedTests.find((a) => a.name === test.name && a.file === suiteFile)) {
            affectedTests.push({
              name: test.name,
              file: suiteFile,
              reason: `references: ${name}`,
            });
          }
          break;
        }
      }
    }
  }

  return {
    changedFiles,
    affectedTests,
    unaffectedCount: totalTests - affectedTests.length,
  };
}

/**
 * Format impact analysis results.
 */
export function formatImpact(result: ImpactResult): string {
  const lines: string[] = [];
  lines.push(`\n🎯 Test Impact Analysis\n`);
  lines.push(`  Changed files: ${result.changedFiles.length}`);

  if (result.affectedTests.length === 0) {
    lines.push('  No tests affected by these changes.');
  } else {
    lines.push(`  Affected tests: ${result.affectedTests.length}\n`);
    for (const t of result.affectedTests) {
      lines.push(`    ${t.file}`);
      lines.push(`      → ${t.name} (${t.reason})`);
    }
  }

  lines.push(`\n  Unaffected: ${result.unaffectedCount} tests can be skipped`);
  lines.push('');
  return lines.join('\n');
}
