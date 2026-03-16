/**
 * Test Migration — convert tests from other frameworks to AgentProbe format.
 * @module migrate
 */
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export type SourceFormat = 'promptfoo' | 'deepeval' | 'langsmith' | 'custom';

export interface MigrateOptions {
  from: SourceFormat;
  inputDir: string;
  outputDir: string;
  dryRun?: boolean;
}

export interface MigrateResult {
  converted: number;
  skipped: number;
  errors: string[];
  outputFiles: string[];
}

export interface AgentProbeTest {
  name: string;
  input: string;
  expect: {
    output_contains?: string | string[];
    tool_called?: string | string[];
    max_steps?: number;
    max_cost_usd?: number;
  };
  tags?: string[];
}

/**
 * Convert a PromptFoo test config to AgentProbe format.
 */
export function convertPromptFoo(content: any): AgentProbeTest[] {
  const tests: AgentProbeTest[] = [];

  // PromptFoo uses { prompts, providers, tests } structure
  const rawTests = content.tests ?? content.evaluations ?? [];

  for (const t of rawTests) {
    const input = typeof t === 'string' ? t
      : t.vars?.input ?? t.vars?.prompt ?? t.description ?? '';

    if (!input) continue;

    const test: AgentProbeTest = {
      name: t.description ?? `migrated-${tests.length + 1}`,
      input,
      expect: {},
      tags: ['migrated', 'promptfoo'],
    };

    // Convert PromptFoo assertions
    if (t.assert) {
      for (const a of Array.isArray(t.assert) ? t.assert : [t.assert]) {
        if (a.type === 'contains' && a.value) {
          test.expect.output_contains = test.expect.output_contains
            ? [...(Array.isArray(test.expect.output_contains) ? test.expect.output_contains : [test.expect.output_contains]), a.value]
            : a.value;
        }
        if (a.type === 'function-call' && a.value) {
          test.expect.tool_called = a.value;
        }
      }
    }

    tests.push(test);
  }

  return tests;
}

/**
 * Convert a DeepEval test config to AgentProbe format.
 */
export function convertDeepEval(content: any): AgentProbeTest[] {
  const tests: AgentProbeTest[] = [];

  // DeepEval uses { test_cases } or array of test case objects
  const rawTests = content.test_cases ?? content.tests ?? (Array.isArray(content) ? content : []);

  for (const t of rawTests) {
    const input = t.input ?? t.query ?? t.prompt ?? '';
    if (!input) continue;

    const test: AgentProbeTest = {
      name: t.name ?? `migrated-${tests.length + 1}`,
      input,
      expect: {},
      tags: ['migrated', 'deepeval'],
    };

    // Convert expected output
    if (t.expected_output) {
      test.expect.output_contains = t.expected_output;
    }
    if (t.expected_tools) {
      test.expect.tool_called = t.expected_tools;
    }
    if (t.context?.max_tokens) {
      test.expect.max_steps = t.context.max_tokens;
    }

    tests.push(test);
  }

  return tests;
}

/**
 * Convert a LangSmith dataset to AgentProbe format.
 */
export function convertLangSmith(content: any): AgentProbeTest[] {
  const tests: AgentProbeTest[] = [];

  // LangSmith uses { examples } or array of examples
  const examples = content.examples ?? (Array.isArray(content) ? content : []);

  for (const ex of examples) {
    const input = ex.inputs?.input ?? ex.inputs?.question ?? JSON.stringify(ex.inputs ?? {});
    const test: AgentProbeTest = {
      name: ex.name ?? `migrated-${tests.length + 1}`,
      input,
      expect: {},
      tags: ['migrated', 'langsmith'],
    };

    if (ex.outputs?.output) {
      test.expect.output_contains = ex.outputs.output;
    }

    tests.push(test);
  }

  return tests;
}

/**
 * Run migration: read input files, convert, write output.
 */
export function migrate(options: MigrateOptions): MigrateResult {
  const result: MigrateResult = { converted: 0, skipped: 0, errors: [], outputFiles: [] };

  if (!fs.existsSync(options.inputDir)) {
    result.errors.push(`Input directory not found: ${options.inputDir}`);
    return result;
  }

  const files = fs.readdirSync(options.inputDir).filter(f =>
    f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
  );

  if (files.length === 0) {
    result.errors.push(`No YAML/JSON files found in ${options.inputDir}`);
    return result;
  }

  const allTests: AgentProbeTest[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(options.inputDir, file), 'utf-8');
      const content = file.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);

      let converted: AgentProbeTest[];
      switch (options.from) {
        case 'promptfoo': converted = convertPromptFoo(content); break;
        case 'deepeval': converted = convertDeepEval(content); break;
        case 'langsmith': converted = convertLangSmith(content); break;
        default:
          result.errors.push(`Unknown source format: ${options.from}`);
          continue;
      }

      allTests.push(...converted);
      result.converted += converted.length;
    } catch (err: any) {
      result.errors.push(`Error processing ${file}: ${err.message}`);
      result.skipped++;
    }
  }

  if (!options.dryRun && allTests.length > 0) {
    if (!fs.existsSync(options.outputDir)) {
      fs.mkdirSync(options.outputDir, { recursive: true });
    }

    const suite = {
      name: `migrated-from-${options.from}`,
      description: `Tests migrated from ${options.from} format`,
      tests: allTests.map(t => ({
        name: t.name,
        input: t.input,
        expect: t.expect,
        tags: t.tags,
      })),
    };

    const outFile = path.join(options.outputDir, `migrated-${options.from}.yaml`);
    fs.writeFileSync(outFile, YAML.stringify(suite));
    result.outputFiles.push(outFile);
  }

  return result;
}

/**
 * Format migration results for display.
 */
export function formatMigrateResult(result: MigrateResult): string {
  const lines: string[] = [];
  lines.push(`Migration complete:`);
  lines.push(`  Converted: ${result.converted} tests`);
  if (result.skipped > 0) lines.push(`  Skipped:   ${result.skipped} files`);
  if (result.errors.length > 0) {
    lines.push(`  Errors:`);
    for (const e of result.errors) lines.push(`    - ${e}`);
  }
  if (result.outputFiles.length > 0) {
    lines.push(`  Output:`);
    for (const f of result.outputFiles) lines.push(`    - ${f}`);
  }
  return lines.join('\n');
}
