/**
 * Interactive Test Builder - Build agent tests via conversational prompts.
 *
 * @example
 * ```bash
 * agentprobe build-test
 * agentprobe build-test --output tests/my-test.yaml
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import type { TestCase, Expectations } from './types';
import * as readline from 'readline';

// ===== Types =====

export interface TestBuilderAnswers {
  description: string;
  input: string;
  expectedTool?: string;
  expectedOutput?: string;
  safetyChecks?: string[];
  maxSteps?: number;
  maxDurationMs?: number;
  tags?: string[];
}

export interface TestBuilderConfig {
  outputDir: string;
  format: 'yaml' | 'json';
}

export interface GeneratedTest {
  testCase: TestCase;
  filename: string;
  content: string;
}

// ===== Defaults =====

export const DEFAULT_BUILDER_CONFIG: TestBuilderConfig = {
  outputDir: 'tests',
  format: 'yaml',
};

// ===== Core Functions =====

/**
 * Convert builder answers to a test case.
 */
export function answersToTestCase(answers: TestBuilderAnswers): TestCase {
  const expect: Expectations = {};

  if (answers.expectedTool) {
    expect.tool_called = answers.expectedTool;
  }
  if (answers.expectedOutput) {
    expect.output_contains = answers.expectedOutput;
  }
  if (answers.maxSteps) {
    expect.max_steps = answers.maxSteps;
  }
  if (answers.maxDurationMs) {
    expect.max_duration_ms = answers.maxDurationMs;
  }
  if (answers.safetyChecks && answers.safetyChecks.length > 0) {
    expect.output_not_contains = answers.safetyChecks;
  }

  const testCase: TestCase = {
    name: answers.description,
    input: answers.input,
    expect,
  };

  if (answers.tags && answers.tags.length > 0) {
    testCase.tags = answers.tags;
  }

  return testCase;
}

/**
 * Generate a filename from a description.
 */
export function generateFilename(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Serialize a test case to YAML or JSON.
 */
export function serializeTest(testCase: TestCase, format: 'yaml' | 'json' = 'yaml'): string {
  const suite = {
    name: testCase.name,
    tests: [testCase],
  };
  return format === 'yaml' ? YAML.stringify(suite) : JSON.stringify(suite, null, 2);
}

/**
 * Build a test from answers and save to file.
 */
export function buildAndSave(answers: TestBuilderAnswers, config: TestBuilderConfig = DEFAULT_BUILDER_CONFIG): GeneratedTest {
  const testCase = answersToTestCase(answers);
  const filename = generateFilename(answers.description) + (config.format === 'yaml' ? '.yaml' : '.json');
  const content = serializeTest(testCase, config.format);
  const outputPath = path.join(config.outputDir, filename);

  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, content, 'utf-8');

  return { testCase, filename, content };
}

/**
 * Validate builder answers.
 */
export function validateAnswers(answers: Partial<TestBuilderAnswers>): string[] {
  const errors: string[] = [];
  if (!answers.description || answers.description.trim() === '') {
    errors.push('Description is required');
  }
  if (!answers.input || answers.input.trim() === '') {
    errors.push('Input prompt is required');
  }
  if (!answers.expectedTool && !answers.expectedOutput && (!answers.safetyChecks || answers.safetyChecks.length === 0)) {
    errors.push('At least one expectation is required (tool, output, or safety check)');
  }
  return errors;
}

/**
 * Interactive test builder using readline (for CLI).
 */
export async function interactiveBuild(config: TestBuilderConfig = DEFAULT_BUILDER_CONFIG): Promise<GeneratedTest> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question: string): Promise<string> =>
    new Promise(resolve => rl.question(question, resolve));

  try {
    console.log('\n🧪 AgentProbe Interactive Test Builder\n');

    const description = await ask('What should the agent do? > ');
    const input = await ask('What is the input prompt? > ');
    const expectedTool = await ask('What tool should it use? (blank to skip) > ');
    const expectedOutput = await ask('What should the output contain? (blank to skip) > ');
    const safetyRaw = await ask('Any safety checks? (comma-separated, blank to skip) > ');
    const tagsRaw = await ask('Tags? (comma-separated, blank to skip) > ');

    const answers: TestBuilderAnswers = {
      description,
      input: input || description,
      expectedTool: expectedTool || undefined,
      expectedOutput: expectedOutput || undefined,
      safetyChecks: safetyRaw ? safetyRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      tags: tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    };

    const errors = validateAnswers(answers);
    if (errors.length > 0) {
      throw new Error(`Validation failed:\n  ${errors.join('\n  ')}`);
    }

    const result = buildAndSave(answers, config);
    console.log(`\n✅ Generated test saved to ${config.outputDir}/${result.filename}\n`);
    return result;
  } finally {
    rl.close();
  }
}

/**
 * Format test preview for display.
 */
export function formatTestPreview(testCase: TestCase): string {
  const lines: string[] = [
    `📋 Test: ${testCase.name}`,
    `  Input: "${testCase.input}"`,
  ];
  if (testCase.expect.tool_called) {
    lines.push(`  Expected tool: ${testCase.expect.tool_called}`);
  }
  if (testCase.expect.output_contains) {
    const oc = Array.isArray(testCase.expect.output_contains)
      ? testCase.expect.output_contains.join(', ')
      : testCase.expect.output_contains;
    lines.push(`  Output contains: ${oc}`);
  }
  if (testCase.expect.output_not_contains) {
    const onc = Array.isArray(testCase.expect.output_not_contains)
      ? testCase.expect.output_not_contains.join(', ')
      : testCase.expect.output_not_contains;
    lines.push(`  Safety checks: ${onc}`);
  }
  if (testCase.tags) {
    lines.push(`  Tags: ${testCase.tags.join(', ')}`);
  }
  return lines.join('\n');
}
