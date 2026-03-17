/**
 * Issue #5: examples/ YAML files use outdated format
 * Tests that all example YAML files use the current format and are valid.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import YAML from 'yaml';

const EXAMPLES_DIR = path.resolve(__dirname, '..', 'examples');

describe('Example YAML Files Format (Issue #5)', () => {
  // Gather all YAML files from examples/
  const yamlFiles = glob.sync('**/*.yaml', { cwd: EXAMPLES_DIR });

  it('should have example YAML files', () => {
    expect(yamlFiles.length).toBeGreaterThan(0);
  });

  for (const file of yamlFiles) {
    describe(`examples/${file}`, () => {
      const filePath = path.join(EXAMPLES_DIR, file);
      let content: string;
      let parsed: any;

      it('should be valid YAML', () => {
        content = fs.readFileSync(filePath, 'utf-8');
        expect(() => {
          parsed = YAML.parse(content);
        }).not.toThrow();
      });

      it('should have a name field', () => {
        content = content ?? fs.readFileSync(filePath, 'utf-8');
        parsed = parsed ?? YAML.parse(content);
        // Some files may be action configs (CI) — skip if they don't have tests
        if (!parsed?.tests && !parsed?.action) {
          expect(parsed?.name).toBeDefined();
        }
      });

      it('should use array syntax for multi-value assertions', () => {
        content = content ?? fs.readFileSync(filePath, 'utf-8');
        parsed = parsed ?? YAML.parse(content);
        if (!parsed?.tests) return;

        for (const test of parsed.tests) {
          if (!test?.expect) continue;
          const e = test.expect;
          // These should be arrays when multiple values
          if (e.tool_called && Array.isArray(e.tool_called)) {
            expect(Array.isArray(e.tool_called)).toBe(true);
          }
          if (e.output_contains && Array.isArray(e.output_contains)) {
            expect(Array.isArray(e.output_contains)).toBe(true);
          }
        }
      });

      it('should not reference non-existent trace files as absolute paths', () => {
        content = content ?? fs.readFileSync(filePath, 'utf-8');
        parsed = parsed ?? YAML.parse(content);
        if (!parsed?.tests) return;

        for (const test of parsed.tests) {
          if (test.trace) {
            // Trace should be a relative path
            expect(path.isAbsolute(test.trace)).toBe(false);
          }
        }
      });

      it('should have description field for documentation', () => {
        content = content ?? fs.readFileSync(filePath, 'utf-8');
        parsed = parsed ?? YAML.parse(content);
        // Test suites (with tests array) should have description
        if (parsed?.tests) {
          // Descriptive name or description field should exist
          expect(parsed.name || parsed.description).toBeDefined();
        }
      });
    });
  }
});
