/**
 * Test Tagging & Filtering — v4.9.0
 *
 * Fluent tag filter for including/excluding tests by tags.
 * Supports CLI: --tag smoke --tag p0 --exclude-tag slow
 */

import type { TestCase } from './types';

// ===== TagFilter =====

export class TagFilter {
  private includeTags: string[] = [];
  private excludeTags: string[] = [];

  include(tags: string[]): TagFilter {
    const f = new TagFilter();
    f.includeTags = [...this.includeTags, ...tags];
    f.excludeTags = [...this.excludeTags];
    return f;
  }

  exclude(tags: string[]): TagFilter {
    const f = new TagFilter();
    f.includeTags = [...this.includeTags];
    f.excludeTags = [...this.excludeTags, ...tags];
    return f;
  }

  match(test: TestCase): boolean {
    const testTags = test.tags ?? [];

    // If exclude tags specified, reject tests that have any excluded tag
    if (this.excludeTags.length > 0) {
      if (testTags.some(t => this.excludeTags.includes(t))) return false;
    }

    // If include tags specified, require test to have at least one included tag
    if (this.includeTags.length > 0) {
      return testTags.some(t => this.includeTags.includes(t));
    }

    return true;
  }

  filterTests(tests: TestCase[]): TestCase[] {
    return tests.filter(t => this.match(t));
  }

  getIncludeTags(): string[] { return [...this.includeTags]; }
  getExcludeTags(): string[] { return [...this.excludeTags]; }
  isEmpty(): boolean { return this.includeTags.length === 0 && this.excludeTags.length === 0; }

  toString(): string {
    const parts: string[] = [];
    if (this.includeTags.length) parts.push(`include=[${this.includeTags.join(',')}]`);
    if (this.excludeTags.length) parts.push(`exclude=[${this.excludeTags.join(',')}]`);
    return parts.length ? parts.join(' ') : '(no filter)';
  }
}

/**
 * Parse CLI-style tag arguments into a TagFilter.
 */
export function parseTagArgs(args: string[]): TagFilter {
  let filter = new TagFilter();
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--tag' && i + 1 < args.length) {
      filter = filter.include([args[i + 1]]);
      i += 2;
    } else if (args[i] === '--exclude-tag' && i + 1 < args.length) {
      filter = filter.exclude([args[i + 1]]);
      i += 2;
    } else {
      i++;
    }
  }
  return filter;
}

/**
 * Extract all unique tags from a list of test cases.
 */
export function extractTags(tests: TestCase[]): string[] {
  const tags = new Set<string>();
  for (const t of tests) {
    if (t.tags) t.tags.forEach(tag => tags.add(tag));
  }
  return [...tags].sort();
}

/**
 * Group tests by tag for display.
 */
export function groupByTag(tests: TestCase[]): Map<string, TestCase[]> {
  const groups = new Map<string, TestCase[]>();
  for (const t of tests) {
    if (!t.tags || t.tags.length === 0) {
      const list = groups.get('(untagged)') ?? [];
      list.push(t);
      groups.set('(untagged)', list);
    } else {
      for (const tag of t.tags) {
        const list = groups.get(tag) ?? [];
        list.push(t);
        groups.set(tag, list);
      }
    }
  }
  return groups;
}

/**
 * Format tag statistics.
 */
export function formatTagStats(tests: TestCase[]): string {
  const groups = groupByTag(tests);
  const lines: string[] = ['Tag Statistics:', ''];
  for (const [tag, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${tag}: ${list.length} test(s)`);
  }
  return lines.join('\n');
}
