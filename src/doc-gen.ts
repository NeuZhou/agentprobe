/**
 * Test Generator from Documentation — Generate test suites from API docs, README, etc.
 *
 * Supports OpenAPI/Swagger specs, Markdown API docs, and raw endpoint lists.
 *
 * @example
 * ```bash
 * agentprobe gen-from-docs --openapi spec.yaml --agent my-agent
 * agentprobe gen-from-docs --markdown api.md --agent my-agent
 * ```
 */

import * as fs from 'fs';
import { loadOpenAPISpec, generateFromOpenAPI, formatOpenAPITests } from './openapi';
import type { OpenAPISpec, OpenAPITestSuite, GeneratedEndpointTest } from './openapi';

// ─── Types ───────────────────────────────────────────────────────────

export interface DocGenOptions {
  agent: string;
  includeHappyPath?: boolean;
  includeErrorHandling?: boolean;
  includeEdgeCases?: boolean;
  includeSecurity?: boolean;
  maxTestsPerEndpoint?: number;
  tags?: string[];
}

export interface DocGenResult {
  source: string;
  format: 'openapi' | 'markdown' | 'raw';
  suite: OpenAPITestSuite;
  stats: DocGenStats;
  yaml: string;
}

export interface DocGenStats {
  totalTests: number;
  happyPath: number;
  errorHandling: number;
  edgeCases: number;
  security: number;
  endpoints: number;
}

export interface MarkdownEndpoint {
  method: string;
  path: string;
  description?: string;
  parameters?: Array<{ name: string; type: string; required: boolean }>;
  responseExample?: string;
}

// ─── OpenAPI Generation ──────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<DocGenOptions> = {
  agent: 'default-agent',
  includeHappyPath: true,
  includeErrorHandling: true,
  includeEdgeCases: true,
  includeSecurity: false,
  maxTestsPerEndpoint: 5,
  tags: [],
};

/**
 * Generate tests from an OpenAPI spec file.
 */
export function generateFromOpenAPIFile(
  filePath: string,
  options: DocGenOptions,
): DocGenResult {
  const spec = loadOpenAPISpec(filePath);
  return generateFromOpenAPISpec(spec, filePath, options);
}

/**
 * Generate tests from a parsed OpenAPI spec.
 */
export function generateFromOpenAPISpec(
  spec: OpenAPISpec,
  source: string,
  options: DocGenOptions,
): DocGenResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const baseSuite = generateFromOpenAPI(spec, opts.agent);

  // Count endpoints
  let endpointCount = 0;
  for (const methods of Object.values(spec.paths)) {
    endpointCount += Object.keys(methods).filter(m =>
      ['get', 'post', 'put', 'patch', 'delete'].includes(m),
    ).length;
  }

  // Generate additional tests based on options
  const additionalTests: GeneratedEndpointTest[] = [];

  if (opts.includeEdgeCases) {
    additionalTests.push(...generateEdgeCaseTests(spec, opts.agent));
  }

  if (opts.includeSecurity) {
    additionalTests.push(...generateSecurityTestsFromSpec(spec, opts.agent));
  }

  const allTests = [...baseSuite.tests, ...additionalTests];

  // Apply max tests per endpoint limit
  const grouped = new Map<string, GeneratedEndpointTest[]>();
  for (const t of allTests) {
    const key = t.expect.tool_called;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }
  const limitedTests: GeneratedEndpointTest[] = [];
  for (const tests of grouped.values()) {
    limitedTests.push(...tests.slice(0, opts.maxTestsPerEndpoint));
  }

  // Apply tag filter
  const finalTests = opts.tags.length > 0
    ? limitedTests.filter(t => t.tags.some(tag => opts.tags.includes(tag)))
    : limitedTests;

  const suite: OpenAPITestSuite = {
    ...baseSuite,
    tests: finalTests,
  };

  const stats = computeStats(finalTests, endpointCount);

  return {
    source,
    format: 'openapi',
    suite,
    stats,
    yaml: formatOpenAPITests(suite),
  };
}

// ─── Markdown Parsing ────────────────────────────────────────────────

/**
 * Parse API endpoints from a Markdown document.
 * Looks for patterns like: `GET /api/users` or `## POST /api/items`
 */
export function parseMarkdownEndpoints(content: string): MarkdownEndpoint[] {
  const endpoints: MarkdownEndpoint[] = [];
  const methodPattern = /(?:^|\n)\s*(?:#{1,6}\s+)?(`?)?(GET|POST|PUT|PATCH|DELETE)\1?\s+(`?)(\/\S+)\3/gi;

  let match: RegExpExecArray | null;
  while ((match = methodPattern.exec(content)) !== null) {
    const method = match[2].toLowerCase();
    const path = match[4];

    // Try to extract description from following lines
    const afterMatch = content.slice(match.index + match[0].length, match.index + match[0].length + 200);
    const descLine = afterMatch.match(/\n\s*(.+)/);
    const description = descLine?.[1]?.trim();

    // Try to extract parameters
    const params: Array<{ name: string; type: string; required: boolean }> = [];
    const paramPattern = /[|-]\s*`?(\w+)`?\s*[:|]\s*`?(\w+)`?\s*(?:[:|]\s*(required|optional))?/gi;
    let paramMatch: RegExpExecArray | null;
    const paramSection = content.slice(match.index, match.index + 500);
    while ((paramMatch = paramPattern.exec(paramSection)) !== null) {
      params.push({
        name: paramMatch[1],
        type: paramMatch[2],
        required: paramMatch[3]?.toLowerCase() === 'required',
      });
    }

    endpoints.push({ method, path, description, parameters: params.length > 0 ? params : undefined });
  }

  return endpoints;
}

/**
 * Generate tests from Markdown API documentation.
 */
export function generateFromMarkdown(
  content: string,
  source: string,
  options: DocGenOptions,
): DocGenResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const endpoints = parseMarkdownEndpoints(content);
  const tests: GeneratedEndpointTest[] = [];

  for (const ep of endpoints) {
    const toolName = `${ep.method}_${ep.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`.toLowerCase();

    // Happy path
    if (opts.includeHappyPath) {
      tests.push({
        name: `${ep.method.toUpperCase()} ${ep.path} — happy path`,
        input: ep.description || `${ep.method} ${ep.path}`,
        mocks: { [toolName]: { status: 200, body: { success: true } } },
        expect: { tool_called: toolName },
        tags: ['doc-gen', 'happy-path', ep.method],
      });
    }

    // Error handling
    if (opts.includeErrorHandling) {
      tests.push({
        name: `${ep.method.toUpperCase()} ${ep.path} — error handling`,
        input: ep.description || `${ep.method} ${ep.path}`,
        mocks: { [toolName]: { status: 500, body: { error: 'Server error' } } },
        expect: { tool_called: toolName },
        tags: ['doc-gen', 'error-handling', ep.method],
      });
    }

    // Edge case: empty response
    if (opts.includeEdgeCases) {
      tests.push({
        name: `${ep.method.toUpperCase()} ${ep.path} — empty response`,
        input: ep.description || `${ep.method} ${ep.path}`,
        mocks: { [toolName]: { status: 200, body: {} } },
        expect: { tool_called: toolName },
        tags: ['doc-gen', 'edge-case', ep.method],
      });
    }
  }

  const suite: OpenAPITestSuite = {
    name: `Tests from ${source}`,
    description: `Auto-generated from documentation: ${source}`,
    agent: opts.agent,
    tests,
  };

  const stats = computeStats(tests, endpoints.length);

  return {
    source,
    format: 'markdown',
    suite,
    stats,
    yaml: formatOpenAPITests(suite),
  };
}

/**
 * Generate from a Markdown file.
 */
export function generateFromMarkdownFile(
  filePath: string,
  options: DocGenOptions,
): DocGenResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  return generateFromMarkdown(content, filePath, options);
}

// ─── Edge Case & Security Generators ─────────────────────────────────

function generateEdgeCaseTests(spec: OpenAPISpec, _agent: string): GeneratedEndpointTest[] {
  const tests: GeneratedEndpointTest[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

      const toolName = op.operationId ||
        `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`.toLowerCase();

      // Empty response test
      tests.push({
        name: `${method.toUpperCase()} ${path} — empty response edge case`,
        input: `Try to ${method} ${path} and handle empty result`,
        mocks: { [toolName]: { status: 200, body: null } },
        expect: { tool_called: toolName },
        tags: ['openapi', 'edge-case'],
      });

      // Timeout test
      tests.push({
        name: `${method.toUpperCase()} ${path} — timeout edge case`,
        input: `${method} ${path}`,
        mocks: { [toolName]: { status: 408, body: { error: 'Request Timeout' } } },
        expect: { tool_called: toolName },
        tags: ['openapi', 'edge-case', 'timeout'],
      });
    }
  }

  return tests;
}

function generateSecurityTestsFromSpec(spec: OpenAPISpec, _agent: string): GeneratedEndpointTest[] {
  const tests: GeneratedEndpointTest[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

      const toolName = op.operationId ||
        `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`.toLowerCase();

      // 401 Unauthorized
      tests.push({
        name: `${method.toUpperCase()} ${path} — unauthorized access`,
        input: `${method} ${path} without credentials`,
        mocks: { [toolName]: { status: 401, body: { error: 'Unauthorized' } } },
        expect: { tool_called: toolName },
        tags: ['openapi', 'security', 'auth'],
      });

      // 403 Forbidden
      tests.push({
        name: `${method.toUpperCase()} ${path} — forbidden access`,
        input: `${method} ${path} with insufficient permissions`,
        mocks: { [toolName]: { status: 403, body: { error: 'Forbidden' } } },
        expect: { tool_called: toolName },
        tags: ['openapi', 'security', 'auth'],
      });
    }
  }

  return tests;
}

// ─── Stats ───────────────────────────────────────────────────────────

function computeStats(tests: GeneratedEndpointTest[], endpoints: number): DocGenStats {
  return {
    totalTests: tests.length,
    happyPath: tests.filter(t => !t.tags.includes('error-handling') && !t.tags.includes('edge-case') && !t.tags.includes('security')).length,
    errorHandling: tests.filter(t => t.tags.includes('error-handling')).length,
    edgeCases: tests.filter(t => t.tags.includes('edge-case')).length,
    security: tests.filter(t => t.tags.includes('security')).length,
    endpoints,
  };
}

/**
 * Format generation stats for display.
 */
export function formatDocGenStats(stats: DocGenStats): string {
  return [
    `Generated ${stats.totalTests} tests from ${stats.endpoints} endpoints:`,
    `  - ${stats.happyPath} happy path tests`,
    `  - ${stats.errorHandling} error handling tests`,
    `  - ${stats.edgeCases} edge case tests`,
    `  - ${stats.security} security tests`,
  ].join('\n');
}

/**
 * Auto-detect file format and generate tests.
 */
export function generateFromDocs(
  filePath: string,
  options: DocGenOptions,
): DocGenResult {
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.yaml') || ext.endsWith('.yml') || ext.endsWith('.json')) {
    // Try OpenAPI first
    try {
      return generateFromOpenAPIFile(filePath, options);
    } catch {
      // Fall through to markdown
    }
  }
  return generateFromMarkdownFile(filePath, options);
}
