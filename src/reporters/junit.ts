import type { SuiteResult } from '../types';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate JUnit XML report from suite results.
 * Compatible with Jenkins, GitHub Actions, Azure DevOps, and other CI systems.
 */
export function reportJUnit(result: SuiteResult): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  const failures = result.results.filter((r) => !r.passed && !r.skipped).length;
  const skipped = result.results.filter((r) => r.skipped).length;
  const time = (result.duration_ms / 1000).toFixed(3);

  lines.push(
    `<testsuites tests="${result.total}" failures="${failures}" skipped="${skipped}" time="${time}" name="${escapeXml(result.name)}">`,
  );
  lines.push(
    `  <testsuite name="${escapeXml(result.name)}" tests="${result.total}" failures="${failures}" skipped="${skipped}" time="${time}">`,
  );

  for (const test of result.results) {
    const testTime = (test.duration_ms / 1000).toFixed(3);
    const className = escapeXml(result.name.replace(/\s+/g, '.'));
    const testName = escapeXml(test.name);

    if (test.skipped) {
      lines.push(`    <testcase classname="${className}" name="${testName}" time="${testTime}">`);
      lines.push(`      <skipped message="${escapeXml(test.skipReason ?? 'Skipped')}" />`);
      lines.push(`    </testcase>`);
    } else if (!test.passed) {
      lines.push(`    <testcase classname="${className}" name="${testName}" time="${testTime}">`);

      const failedAssertions = test.assertions.filter((a) => !a.passed);
      const message = failedAssertions
        .map(
          (a) =>
            a.message ??
            `${a.name}: expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`,
        )
        .join('\n');
      const errorMsg = test.error ? `\nError: ${test.error}` : '';

      lines.push(
        `      <failure message="${escapeXml(failedAssertions[0]?.message ?? test.error ?? 'Test failed')}">`,
      );
      lines.push(escapeXml(message + errorMsg));
      lines.push(`      </failure>`);
      lines.push(`    </testcase>`);
    } else {
      lines.push(`    <testcase classname="${className}" name="${testName}" time="${testTime}" />`);
    }
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');

  return lines.join('\n');
}
