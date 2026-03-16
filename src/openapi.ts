/**
 * Test Generation from OpenAPI specs.
 *
 * Reads an OpenAPI/Swagger spec and generates AgentProbe test cases
 * for each endpoint the agent might call as a tool.
 */

import * as fs from 'fs';
import YAML from 'yaml';

export interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenAPIOperation>>;
  servers?: Array<{ url: string }>;
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    content?: Record<string, { schema?: any }>;
    required?: boolean;
  };
  responses?: Record<string, { description?: string; content?: any }>;
  tags?: string[];
}

export interface OpenAPIParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required?: boolean;
  schema?: { type?: string; enum?: any[]; default?: any; example?: any };
  description?: string;
}

export interface GeneratedEndpointTest {
  name: string;
  input: string;
  mocks: Record<string, any>;
  expect: {
    tool_called: string;
    tool_args_match?: Record<string, any>;
  };
  tags: string[];
}

export interface OpenAPITestSuite {
  name: string;
  description: string;
  agent: string;
  tests: GeneratedEndpointTest[];
}

/**
 * Load and parse an OpenAPI spec from file (JSON or YAML).
 */
export function loadOpenAPISpec(filePath: string): OpenAPISpec {
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return YAML.parse(raw);
  }
}

/**
 * Derive a tool name from method + path.
 */
function deriveToolName(method: string, path: string, operationId?: string): string {
  if (operationId) return operationId;
  // /users/{id} GET → get_users_by_id
  const cleaned = path
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${method}_${cleaned}`.toLowerCase();
}

/**
 * Generate example value for a parameter.
 */
function exampleValue(param: OpenAPIParameter): any {
  if (param.schema?.example !== undefined) return param.schema.example;
  if (param.schema?.default !== undefined) return param.schema.default;
  if (param.schema?.enum?.length) return param.schema.enum[0];
  switch (param.schema?.type) {
    case 'integer': case 'number': return 1;
    case 'boolean': return true;
    case 'array': return [];
    default: return `test_${param.name}`;
  }
}

/**
 * Generate a natural language prompt that would trigger calling this endpoint.
 */
function generatePrompt(method: string, path: string, op: OpenAPIOperation): string {
  const action = method === 'get' ? 'retrieve' : method === 'post' ? 'create' : method === 'put' ? 'update' : method === 'delete' ? 'remove' : method;
  const resource = path.split('/').filter(p => p && !p.startsWith('{')).pop() || 'resource';
  const desc = op.summary || op.description || '';
  return desc
    ? `${desc}`
    : `${action} the ${resource.replace(/-/g, ' ')}`;
}

/**
 * Generate mock response for an endpoint.
 */
function generateMockResponse(op: OpenAPIOperation): any {
  const successCode = Object.keys(op.responses || {}).find(c => c.startsWith('2')) || '200';
  const resp = op.responses?.[successCode];
  return { status: parseInt(successCode), body: { success: true, message: resp?.description || 'OK' } };
}

/**
 * Generate tests from an OpenAPI spec.
 */
export function generateFromOpenAPI(spec: OpenAPISpec, agentName: string): OpenAPITestSuite {
  const tests: GeneratedEndpointTest[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method) === -1) continue;

      const toolName = deriveToolName(method, path, op.operationId);
      const params = op.parameters || [];
      const requiredParams = params.filter(p => p.required);

      // Basic call test
      const args: Record<string, any> = {};
      for (const p of requiredParams) {
        args[p.name] = exampleValue(p);
      }

      tests.push({
        name: `${method.toUpperCase()} ${path} — should call ${toolName}`,
        input: generatePrompt(method, path, op),
        mocks: { [toolName]: generateMockResponse(op) },
        expect: {
          tool_called: toolName,
          ...(Object.keys(args).length > 0 ? { tool_args_match: args } : {}),
        },
        tags: ['openapi', method, ...(op.tags || [])],
      });

      // Error handling test
      tests.push({
        name: `${method.toUpperCase()} ${path} — handles error gracefully`,
        input: generatePrompt(method, path, op),
        mocks: { [toolName]: { status: 500, body: { error: 'Internal Server Error' } } },
        expect: {
          tool_called: toolName,
        },
        tags: ['openapi', 'error-handling', method],
      });

      // Missing required params test (if any required params exist)
      if (requiredParams.length > 0) {
        tests.push({
          name: `${method.toUpperCase()} ${path} — asks for missing required params`,
          input: `Do something with ${path.split('/').pop()?.replace(/[{}]/g, '')}`,
          mocks: { [toolName]: generateMockResponse(op) },
          expect: {
            tool_called: toolName,
          },
          tags: ['openapi', 'params', method],
        });
      }
    }
  }

  return {
    name: `${spec.info.title} API Tests`,
    description: `Auto-generated from OpenAPI spec v${spec.info.version}`,
    agent: agentName,
    tests,
  };
}

/**
 * Format generated tests as YAML.
 */
export function formatOpenAPITests(suite: OpenAPITestSuite): string {
  return YAML.stringify({
    name: suite.name,
    description: suite.description,
    agent: { module: suite.agent },
    tests: suite.tests,
  });
}
