import YAML from 'yaml';

export interface BuilderAnswers {
  action: string;
  tool?: string;
  outputContains?: string;
  maxSteps?: number;
  maxTokens?: number;
  maxCost?: number;
  securityCheck?: boolean;
}

/**
 * Generate a test case YAML string from builder answers.
 */
export function buildAssertion(answers: BuilderAnswers): string {
  const expect: Record<string, any> = {};

  if (answers.tool) {
    expect.tool_called = answers.tool;
  }

  if (answers.outputContains) {
    expect.output_contains = answers.outputContains;
  }

  if (answers.maxSteps) {
    expect.max_steps = answers.maxSteps;
  }

  if (answers.maxTokens) {
    expect.max_tokens = answers.maxTokens;
  }

  if (answers.maxCost) {
    expect.max_cost_usd = answers.maxCost;
  }

  if (answers.securityCheck) {
    expect.tool_not_called = 'exec';
    expect.output_not_contains = 'system prompt';
  }

  const testCase = {
    name: `Test: ${answers.action}`,
    input: answers.action,
    expect,
  };

  return YAML.stringify(testCase);
}

/**
 * Generate a complete test suite YAML from multiple builder answers.
 */
export function buildSuite(
  name: string,
  tests: BuilderAnswers[],
): string {
  const suite = {
    name,
    tests: tests.map((t) => {
      const expect: Record<string, any> = {};
      if (t.tool) expect.tool_called = t.tool;
      if (t.outputContains) expect.output_contains = t.outputContains;
      if (t.maxSteps) expect.max_steps = t.maxSteps;
      if (t.maxTokens) expect.max_tokens = t.maxTokens;
      if (t.maxCost) expect.max_cost_usd = t.maxCost;
      if (t.securityCheck) {
        expect.tool_not_called = 'exec';
        expect.output_not_contains = 'system prompt';
      }
      return {
        name: `Test: ${t.action}`,
        input: t.action,
        expect,
      };
    }),
  };

  return YAML.stringify(suite);
}

/**
 * Parse question-answer pairs into BuilderAnswers.
 * Supports a simple key=value format.
 */
export function parseBuilderInput(lines: string[]): BuilderAnswers {
  const answers: BuilderAnswers = { action: '' };

  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=').trim();
    const k = key.trim().toLowerCase();

    switch (k) {
      case 'action':
        answers.action = value;
        break;
      case 'tool':
        answers.tool = value;
        break;
      case 'output':
      case 'output_contains':
        answers.outputContains = value;
        break;
      case 'max_steps':
        answers.maxSteps = parseInt(value, 10);
        break;
      case 'max_tokens':
        answers.maxTokens = parseInt(value, 10);
        break;
      case 'max_cost':
        answers.maxCost = parseFloat(value);
        break;
      case 'security':
        answers.securityCheck = value === 'true' || value === 'yes';
        break;
    }
  }

  return answers;
}
