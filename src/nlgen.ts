/**
 * Natural language test generation.
 *
 * Maps common English phrases to AgentProbe assertions without LLM.
 * Pattern-matching based — fast, deterministic, free.
 */

export interface GeneratedTest {
  name: string;
  input: string;
  expect: Record<string, any>;
}

interface PatternRule {
  pattern: RegExp;
  extract: (match: RegExpMatchArray, full: string) => Partial<GeneratedTest>;
}

const TOOL_SYNONYMS: Record<string, string[]> = {
  weather: ['weather', 'forecast', 'temperature'],
  search: ['search', 'look up', 'find', 'query', 'google'],
  calculate: ['calculate', 'compute', 'math'],
  email: ['email', 'send email', 'mail'],
  database: ['database', 'db', 'query database', 'sql'],
  file: ['file', 'read file', 'write file', 'save'],
  api: ['api', 'call api', 'http', 'request', 'fetch'],
  translate: ['translate', 'translation'],
  summarize: ['summarize', 'summary'],
  code: ['code', 'write code', 'generate code', 'program'],
};

/**
 * Infer a tool name from a description phrase.
 */
function inferToolName(phrase: string): string | null {
  const lower = phrase.toLowerCase();
  for (const [tool, synonyms] of Object.entries(TOOL_SYNONYMS)) {
    for (const syn of synonyms) {
      if (lower.includes(syn)) {
        return `get_${tool}`;
      }
    }
  }
  // Try to extract "calls the X" or "calls X API"
  const callsMatch = lower.match(/calls?\s+(?:the\s+)?(\w+?)(?:\s+(?:api|tool|function))?(?:\s|$)/);
  if (callsMatch) {
    return callsMatch[1].toLowerCase();
  }
  return null;
}

/**
 * Infer an output pattern from a description.
 */
function inferOutputPattern(phrase: string): string | null {
  const lower = phrase.toLowerCase();

  if (lower.includes('temperature') || lower.includes('degrees')) {
    return '\\d+°[CF]';
  }
  if (lower.includes('url') || lower.includes('link')) {
    return 'https?://';
  }
  if (lower.includes('json')) {
    return '\\{.*\\}';
  }
  if (lower.includes('number') || lower.includes('count')) {
    return '\\d+';
  }
  if (lower.includes('email address')) {
    return '[\\w.-]+@[\\w.-]+';
  }
  if (lower.includes('date')) {
    return '\\d{4}-\\d{2}-\\d{2}';
  }
  return null;
}

const RULES: PatternRule[] = [
  // "Test that X does not call Y" (must be before "calls" rule)
  {
    pattern: /test\s+that\s+(.+?)\s+(?:does\s+not|doesn'?t|never)\s+calls?\s+(.+)$/i,
    extract: (match) => {
      const agent = match[1];
      const toolPhrase = match[2];
      const tool = inferToolName(toolPhrase) ?? toolPhrase.trim();
      return {
        input: `Test input for ${agent}`,
        expect: { tool_not_called: tool },
      };
    },
  },
  // "Test that X calls Y and returns Z"
  {
    pattern: /test\s+that\s+(.+?)\s+calls?\s+(?:the\s+)?(.+?)(?:\s+and\s+returns?\s+(.+))?$/i,
    extract: (match) => {
      const agent = match[1];
      const toolPhrase = match[2];
      const returnPhrase = match[3];
      const expect: Record<string, any> = {};

      const tool = inferToolName(toolPhrase);
      if (tool) expect.tool_called = tool;

      if (returnPhrase) {
        const pattern = inferOutputPattern(returnPhrase);
        if (pattern) {
          expect.output_matches = pattern;
        } else {
          const keyword = returnPhrase.replace(/['"]/g, '').trim();
          if (keyword) expect.output_contains = keyword;
        }
      }

      return {
        input: `Test input for ${agent}`,
        expect,
      };
    },
  },
  // "Test that output contains X"
  {
    pattern: /test\s+that\s+(?:the\s+)?output\s+contains?\s+['""]?(.+?)['""]?\s*$/i,
    extract: (match) => ({
      expect: { output_contains: match[1].trim() },
    }),
  },
  // "Test that output does not contain X"
  {
    pattern: /test\s+that\s+(?:the\s+)?output\s+(?:does\s+not|doesn'?t)\s+contain\s+['""]?(.+?)['""]?\s*$/i,
    extract: (match) => ({
      expect: { output_not_contains: match[1].trim() },
    }),
  },
  // "Test that X completes in under N steps"
  {
    pattern: /test\s+that\s+(.+?)\s+completes?\s+(?:in\s+)?(?:under|within|less\s+than)\s+(\d+)\s+steps?/i,
    extract: (match) => ({
      input: `Test input for ${match[1]}`,
      expect: { max_steps: parseInt(match[2], 10) },
    }),
  },
  // "Test that X uses less than N tokens"
  {
    pattern: /test\s+that\s+(.+?)\s+uses?\s+(?:less\s+than|under|within)\s+(\d+)\s+tokens?/i,
    extract: (match) => ({
      input: `Test input for ${match[1]}`,
      expect: { max_tokens: parseInt(match[2], 10) },
    }),
  },
  // "Test that X costs less than $Y"
  {
    pattern: /test\s+that\s+(.+?)\s+costs?\s+(?:less\s+than|under)\s+\$?([\d.]+)/i,
    extract: (match) => ({
      input: `Test input for ${match[1]}`,
      expect: { max_cost_usd: parseFloat(match[2]) },
    }),
  },
];

/**
 * Generate a test from a natural language description.
 */
export function generateFromNL(description: string): GeneratedTest {
  const name = description.replace(/^test\s+that\s+/i, '').trim();

  for (const rule of RULES) {
    const match = description.match(rule.pattern);
    if (match) {
      const partial = rule.extract(match, description);
      return {
        name: name.charAt(0).toUpperCase() + name.slice(1),
        input: partial.input ?? 'TODO: add test input',
        expect: partial.expect ?? {},
      };
    }
  }

  // Fallback: try to extract any tool or output hints
  const expect: Record<string, any> = {};
  const tool = inferToolName(description);
  if (tool) expect.tool_called = tool;
  const pattern = inferOutputPattern(description);
  if (pattern) expect.output_matches = pattern;

  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    input: 'TODO: add test input',
    expect: Object.keys(expect).length > 0 ? expect : { output_contains: 'TODO' },
  };
}

/**
 * Format generated tests as YAML string.
 */
export function formatGeneratedTestsYaml(tests: GeneratedTest[]): string {
  const lines: string[] = ['tests:'];
  for (const test of tests) {
    lines.push(`  - name: ${test.name}`);
    lines.push(`    input: "${test.input}"`);
    lines.push(`    expect:`);
    for (const [key, val] of Object.entries(test.expect)) {
      if (typeof val === 'string') {
        lines.push(`      ${key}: "${val}"`);
      } else {
        lines.push(`      ${key}: ${val}`);
      }
    }
  }
  return lines.join('\n');
}
