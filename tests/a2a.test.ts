/**
 * A2A Protocol Support Tests — v4.11.0
 *
 * 45 tests covering:
 * - A2A Adapter (13 tests)
 * - A2A Security Scanner (12 tests)
 * - Protocol Comparator (10 tests)
 * - Agent Discovery (10 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  A2AAdapter, validateAgentCard,
  type AgentCard, type A2ATask, type A2AAdapterConfig, type A2ATestCase,
} from '../src/adapters/a2a';
import {
  A2ASecurityScanner, formatSecurityReport,
  type SecurityReport, type SecurityFinding,
} from '../src/security/a2a-scanner';
import {
  ProtocolComparator, formatComparisonReport,
  type ComparisonTestCase, type ComparatorConfig,
} from '../src/protocol-compare';
import {
  AgentDiscovery, formatVerificationReport,
  type VerificationReport,
} from '../src/discovery';

// ===== Mock fetch =====

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(body: any, opts: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
  const { ok = true, status = 200, headers = {} } = opts;
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null,
    },
    json: async () => body,
    body: null,
  };
}

function mockSSEResponse(events: string[]) {
  const encoder = new TextEncoder();
  const data = events.map(e => `data: ${e}\n\n`).join('');
  let consumed = false;
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null,
    },
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => {
          if (consumed) return { done: true, value: undefined };
          consumed = true;
          return { done: false, value: encoder.encode(data) };
        },
      }),
    },
  };
}

const sampleAgentCard: AgentCard = {
  name: 'Test Agent',
  url: 'https://agent.example.com',
  version: '1.0.0',
  description: 'A test agent',
  capabilities: [{ name: 'chat' }, { name: 'code' }],
  skills: [{ id: 'sk1', name: 'Code Review', description: 'Reviews code' }],
  authentication: { schemes: ['bearer'] },
  provider: { organization: 'TestOrg', url: 'https://testorg.com' },
  supportsStreaming: true,
  supportsPushNotifications: false,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
};

const sampleTask: A2ATask = {
  id: 'task-123',
  status: { state: 'completed' },
  messages: [
    { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    { role: 'agent', parts: [{ type: 'text', text: 'Hi there!' }] },
  ],
  artifacts: [{ name: 'result', parts: [{ type: 'text', text: 'done' }], index: 0 }],
};

beforeEach(() => {
  mockFetch.mockReset();
});

// ================================================
// A2A Adapter Tests
// ================================================

describe('A2AAdapter', () => {
  const config: A2AAdapterConfig = { agentUrl: 'https://agent.example.com' };

  it('should fetch agent card from well-known URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));

    const adapter = new A2AAdapter(config);
    const card = await adapter.getAgentCard();

    expect(card.name).toBe('Test Agent');
    expect(card.url).toBe('https://agent.example.com');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://agent.example.com/.well-known/agent.json',
      expect.anything(),
    );
  });

  it('should cache agent card on subsequent calls', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));

    const adapter = new A2AAdapter(config);
    await adapter.getAgentCard();
    await adapter.getAgentCard();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should throw on agent card fetch failure', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false, status: 404 }));

    const adapter = new A2AAdapter(config);
    await expect(adapter.getAgentCard()).rejects.toThrow('Failed to fetch agent card');
  });

  it('should send a task via JSON-RPC', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));

    const adapter = new A2AAdapter(config);
    const task = await adapter.send('Hello');

    expect(task.id).toBe('task-123');
    expect(task.status.state).toBe('completed');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://agent.example.com',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should include bearer auth header when configured', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));

    const adapter = new A2AAdapter({
      agentUrl: 'https://agent.example.com',
      auth: { type: 'bearer', token: 'test-token' },
    });
    await adapter.send('Hello');

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['Authorization']).toBe('Bearer test-token');
  });

  it('should include API key header when configured', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));

    const adapter = new A2AAdapter({
      agentUrl: 'https://agent.example.com',
      auth: { type: 'api-key', key: 'my-key', header: 'X-Custom-Key' },
    });
    await adapter.send('Hello');

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['X-Custom-Key']).toBe('my-key');
  });

  it('should throw on JSON-RPC error response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      id: '1', jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request' },
    }));

    const adapter = new A2AAdapter(config);
    await expect(adapter.send('Hello')).rejects.toThrow('A2A task error: Invalid request');
  });

  it('should get task by ID', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));

    const adapter = new A2AAdapter(config);
    const task = await adapter.getTask('task-123');

    expect(task.id).toBe('task-123');
  });

  it('should cancel a task', async () => {
    const canceledTask = { ...sampleTask, status: { state: 'canceled' } };
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: canceledTask }));

    const adapter = new A2AAdapter(config);
    const task = await adapter.cancelTask('task-123');

    expect(task.status.state).toBe('canceled');
  });

  it('should handle streaming responses', async () => {
    const streamEvent = JSON.stringify({
      result: { id: 'task-s', status: { state: 'completed' }, messages: [], artifacts: [] },
    });
    mockFetch.mockResolvedValueOnce(mockSSEResponse([streamEvent]));

    const adapter = new A2AAdapter(config);
    const events: any[] = [];
    for await (const event of adapter.sendStream('Hello')) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
  });

  it('should run a test case and assert state', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));

    const adapter = new A2AAdapter(config);
    const tc: A2ATestCase = {
      name: 'state test',
      message: 'Hello',
      expectedState: 'completed',
    };
    const result = await adapter.runTest(tc);

    expect(result.passed).toBe(true);
    expect(result.assertions[0].name).toBe('task_state');
  });

  it('should run a test case and assert output', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));

    const adapter = new A2AAdapter(config);
    const tc: A2ATestCase = {
      name: 'output test',
      message: 'Hello',
      expectedOutput: 'Hi there!',
    };
    const result = await adapter.runTest(tc);

    expect(result.passed).toBe(true);
  });

  it('should fail when expected output is missing', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));

    const adapter = new A2AAdapter(config);
    const tc: A2ATestCase = {
      name: 'fail test',
      message: 'Hello',
      expectedOutput: 'NONEXISTENT_OUTPUT_STRING',
    };
    const result = await adapter.runTest(tc);

    expect(result.passed).toBe(false);
  });
});

// ================================================
// Agent Card Validation Tests
// ================================================

describe('validateAgentCard', () => {
  it('should validate a correct agent card', () => {
    const results = validateAgentCard(sampleAgentCard);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should fail on missing name', () => {
    const results = validateAgentCard({ url: 'https://example.com' });
    const nameResult = results.find(r => r.name === 'card_has_name');
    expect(nameResult?.passed).toBe(false);
  });

  it('should fail on missing URL', () => {
    const results = validateAgentCard({ name: 'Test' });
    const urlResult = results.find(r => r.name === 'card_has_url');
    expect(urlResult?.passed).toBe(false);
  });

  it('should validate capabilities structure', () => {
    const results = validateAgentCard({
      ...sampleAgentCard,
      capabilities: [{ name: 'chat' }],
    });
    const capResult = results.find(r => r.name === 'card_capabilities_valid');
    expect(capResult?.passed).toBe(true);
  });

  it('should validate auth schemes', () => {
    const results = validateAgentCard({
      ...sampleAgentCard,
      authentication: { schemes: ['bearer'] },
    });
    const authResult = results.find(r => r.name === 'card_auth_has_schemes');
    expect(authResult?.passed).toBe(true);
  });
});

// ================================================
// A2A Security Scanner Tests
// ================================================

describe('A2ASecurityScanner', () => {
  it('should flag HTTP (non-HTTPS) URLs', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));

    const scanner = new A2ASecurityScanner({ strictHttps: true });
    const report = await scanner.scanAgentCard('http://insecure.example.com');

    const httpFinding = report.findings.find(f => f.title === 'No HTTPS');
    expect(httpFinding).toBeDefined();
    expect(httpFinding?.severity).toBe('critical');
  });

  it('should pass HTTPS URLs', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));

    const scanner = new A2ASecurityScanner({ strictHttps: true });
    const report = await scanner.scanAgentCard('https://secure.example.com');

    const httpFinding = report.findings.find(f => f.title === 'No HTTPS');
    expect(httpFinding).toBeUndefined();
  });

  it('should flag missing authentication', async () => {
    const noAuthCard = { ...sampleAgentCard, authentication: undefined };
    mockFetch.mockResolvedValueOnce(mockResponse(noAuthCard));

    const scanner = new A2ASecurityScanner({ checkCapabilities: false });
    const report = await scanner.scanAgentCard('https://agent.example.com');

    const authFinding = report.findings.find(f => f.title === 'No authentication declared');
    expect(authFinding).toBeDefined();
    expect(authFinding?.severity).toBe('high');
  });

  it('should flag wildcard CORS', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard, {
      headers: { 'access-control-allow-origin': '*' },
    }));

    const scanner = new A2ASecurityScanner({ checkCapabilities: false });
    const report = await scanner.scanAgentCard('https://agent.example.com');

    const corsFinding = report.findings.find(f => f.title === 'Wildcard CORS');
    expect(corsFinding).toBeDefined();
  });

  it('should flag missing version', async () => {
    const noVersionCard = { ...sampleAgentCard, version: undefined };
    mockFetch.mockResolvedValueOnce(mockResponse(noVersionCard));

    const scanner = new A2ASecurityScanner({ checkCapabilities: false });
    const report = await scanner.scanAgentCard('https://agent.example.com');

    const versionFinding = report.findings.find(f => f.title === 'No version in agent card');
    expect(versionFinding).toBeDefined();
  });

  it('should report inaccessible agent card', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false, status: 404 }));

    const scanner = new A2ASecurityScanner();
    const report = await scanner.scanAgentCard('https://agent.example.com');

    const finding = report.findings.find(f => f.title === 'Agent card not accessible');
    expect(finding).toBeDefined();
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const scanner = new A2ASecurityScanner();
    const report = await scanner.scanAgentCard('https://agent.example.com');

    const finding = report.findings.find(f => f.title === 'Agent card fetch failed');
    expect(finding).toBeDefined();
  });

  it('should calculate security score', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));

    const scanner = new A2ASecurityScanner({ checkCapabilities: false });
    const report = await scanner.scanAgentCard('https://agent.example.com');

    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(typeof report.passed).toBe('boolean');
  });

  it('should format security report', async () => {
    const report: SecurityReport = {
      target: 'https://agent.example.com',
      timestamp: new Date().toISOString(),
      findings: [
        { severity: 'critical', category: 'transport', title: 'No HTTPS', description: 'Uses HTTP' },
        { severity: 'info', category: 'metadata', title: 'Version present', description: 'v1.0' },
      ],
      score: 70,
      passed: true,
      summary: '2 findings',
    };

    const output = formatSecurityReport(report);
    expect(output).toContain('A2A Security Report');
    expect(output).toContain('No HTTPS');
    expect(output).toContain('70/100');
  });

  it('should scan task isolation (data leakage)', async () => {
    // Task 1 response
    mockFetch.mockResolvedValueOnce(mockResponse({
      id: '1', jsonrpc: '2.0', result: sampleTask,
    }));
    // Task 2 response — no leakage
    mockFetch.mockResolvedValueOnce(mockResponse({
      id: '2', jsonrpc: '2.0', result: {
        ...sampleTask,
        messages: [{ role: 'agent', parts: [{ type: 'text', text: 'I cannot see previous tasks' }] }],
      },
    }));
    // Session fixation probe 1
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '3', jsonrpc: '2.0', result: sampleTask }));
    // Session fixation probe 2
    mockFetch.mockResolvedValueOnce(mockResponse({
      id: '4', jsonrpc: '2.0', result: {
        ...sampleTask,
        messages: [{ role: 'agent', parts: [{ type: 'text', text: 'No history found' }] }],
      },
    }));
    // Task enumeration
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '5', jsonrpc: '2.0', error: { code: -32600, message: 'Not found' } }));

    const scanner = new A2ASecurityScanner();
    const report = await scanner.scanTaskIsolation('https://agent.example.com');

    expect(report).toBeDefined();
    expect(report.findings).toBeDefined();
  });

  it('should scan push notifications', async () => {
    // Agent card fetch
    mockFetch.mockResolvedValueOnce(mockResponse({ ...sampleAgentCard, supportsPushNotifications: false }));

    const scanner = new A2ASecurityScanner();
    const report = await scanner.scanPushNotifications('https://agent.example.com');

    expect(report).toBeDefined();
    const finding = report.findings.find(f => f.title === 'Push notifications not supported');
    expect(finding).toBeDefined();
  });

  it('should run full scan combining all checks', async () => {
    // For scanAgentCard
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));
    // For verifyCapabilities streaming check
    mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false, status: 400 }));
    // For scanTaskIsolation (5 calls)
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(mockResponse({ id: `${i}`, jsonrpc: '2.0', result: sampleTask }));
    }
    // For scanPushNotifications agent card
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));

    const scanner = new A2ASecurityScanner();
    const report = await scanner.fullScan('https://agent.example.com');

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.score).toBeGreaterThanOrEqual(0);
  });
});

// ================================================
// Protocol Comparator Tests
// ================================================

describe('ProtocolComparator', () => {
  const comparatorConfig: ComparatorConfig = {
    mcpServer: 'https://mcp.example.com',
    a2aAgent: 'https://a2a.example.com',
    testCases: [
      { name: 'simple query', input: 'What is 2+2?', expectedOutput: '4' },
      { name: 'code gen', input: 'Write hello world', mcpTool: 'generate', mcpArgs: { lang: 'python' } },
    ],
    repetitions: 2,
    timeout_ms: 5000,
  };

  it('should run comparison and produce report', async () => {
    // 2 test cases × 2 reps × 2 protocols = 8 fetch calls
    for (let i = 0; i < 8; i++) {
      mockFetch.mockResolvedValueOnce(mockResponse({
        id: `${i}`, jsonrpc: '2.0',
        result: i < 4
          ? { content: [{ text: '4' }] }  // MCP
          : { ...sampleTask },             // A2A
      }));
    }

    const comparator = new ProtocolComparator(comparatorConfig);
    const report = await comparator.compareMCPvsA2A();

    expect(report.results).toHaveLength(2);
    expect(report.summary.totalTests).toBe(2);
    expect(report.summary.mcpWins + report.summary.a2aWins + report.summary.ties).toBe(2);
  });

  it('should handle MCP errors gracefully', async () => {
    // MCP fails, A2A succeeds
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '2', jsonrpc: '2.0', result: sampleTask }));

    const config: ComparatorConfig = {
      mcpServer: 'https://mcp.example.com',
      a2aAgent: 'https://a2a.example.com',
      testCases: [{ name: 'fail test', input: 'Hello' }],
      repetitions: 2,
    };

    const comparator = new ProtocolComparator(config);
    const report = await comparator.compareMCPvsA2A();

    expect(report.results[0].mcp.successRate).toBe(0);
  });

  it('should handle A2A errors gracefully', async () => {
    // MCP succeeds, A2A fails
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: { content: [{ text: 'ok' }] } }));
    mockFetch.mockRejectedValueOnce(new Error('Timeout'));

    const config: ComparatorConfig = {
      mcpServer: 'https://mcp.example.com',
      a2aAgent: 'https://a2a.example.com',
      testCases: [{ name: 'a2a fail', input: 'Hello' }],
      repetitions: 1,
    };

    const comparator = new ProtocolComparator(config);
    const report = await comparator.compareMCPvsA2A();

    expect(report.results[0].a2a.successRate).toBe(0);
  });

  it('should determine winner by success rate', async () => {
    // MCP success, A2A failure
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: { content: [{ text: 'ok' }] } }));
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '2', jsonrpc: '2.0', error: { code: -1, message: 'fail' } }));

    const config: ComparatorConfig = {
      mcpServer: 'https://mcp.example.com',
      a2aAgent: 'https://a2a.example.com',
      testCases: [{ name: 'winner test', input: 'Hello' }],
      repetitions: 1,
    };

    const comparator = new ProtocolComparator(config);
    const report = await comparator.compareMCPvsA2A();

    expect(report.results[0].winner).toBe('mcp');
  });

  it('should include auth header for A2A requests', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: { content: [{ text: 'ok' }] } }));
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '2', jsonrpc: '2.0', result: sampleTask }));

    const config: ComparatorConfig = {
      mcpServer: 'https://mcp.example.com',
      a2aAgent: 'https://a2a.example.com',
      testCases: [{ name: 'auth test', input: 'Hello' }],
      repetitions: 1,
      a2aAuth: { type: 'bearer', token: 'secret' },
    };

    const comparator = new ProtocolComparator(config);
    await comparator.compareMCPvsA2A();

    // The second call should be A2A with auth
    const a2aCall = mockFetch.mock.calls[1];
    expect(a2aCall[1].headers['Authorization']).toBe('Bearer secret');
  });

  it('should compute latency statistics', async () => {
    for (let i = 0; i < 6; i++) {
      mockFetch.mockResolvedValueOnce(mockResponse({
        id: `${i}`, jsonrpc: '2.0',
        result: i < 3 ? { content: [{ text: 'ok' }] } : sampleTask,
      }));
    }

    const config: ComparatorConfig = {
      mcpServer: 'https://mcp.example.com',
      a2aAgent: 'https://a2a.example.com',
      testCases: [{ name: 'latency test', input: 'Hello' }],
      repetitions: 3,
    };

    const comparator = new ProtocolComparator(config);
    const report = await comparator.compareMCPvsA2A();

    const mcpStats = report.results[0].mcp;
    expect(mcpStats.avgLatency_ms).toBeGreaterThanOrEqual(0);
    expect(mcpStats.p50Latency_ms).toBeGreaterThanOrEqual(0);
    expect(mcpStats.p95Latency_ms).toBeGreaterThanOrEqual(mcpStats.p50Latency_ms);
  });

  it('should generate summary recommendation', async () => {
    for (let i = 0; i < 4; i++) {
      mockFetch.mockResolvedValueOnce(mockResponse({ id: `${i}`, jsonrpc: '2.0', result: sampleTask }));
    }

    const config: ComparatorConfig = {
      mcpServer: 'https://mcp.example.com',
      a2aAgent: 'https://a2a.example.com',
      testCases: [{ name: 'rec test', input: 'Hello' }],
      repetitions: 2,
    };

    const comparator = new ProtocolComparator(config);
    const report = await comparator.compareMCPvsA2A();

    expect(report.summary.recommendation).toBeTruthy();
    expect(typeof report.summary.recommendation).toBe('string');
  });

  it('should format comparison report', () => {
    const report = {
      timestamp: new Date().toISOString(),
      mcpServer: 'https://mcp.test',
      a2aAgent: 'https://a2a.test',
      results: [{
        testCase: 'test1',
        mcp: { avgLatency_ms: 100, p50Latency_ms: 95, p95Latency_ms: 150, p99Latency_ms: 200, successRate: 1, totalCost_usd: 0, samples: [] },
        a2a: { avgLatency_ms: 120, p50Latency_ms: 110, p95Latency_ms: 180, p99Latency_ms: 250, successRate: 0.8, totalCost_usd: 0, samples: [] },
        winner: 'mcp' as const,
        latencyDiff_ms: -20,
        accuracyDiff: 0.2,
      }],
      summary: {
        totalTests: 1, mcpWins: 1, a2aWins: 0, ties: 0,
        mcpAvgLatency_ms: 100, a2aAvgLatency_ms: 120,
        mcpSuccessRate: 1, a2aSuccessRate: 0.8,
        mcpTotalCost_usd: 0, a2aTotalCost_usd: 0,
        recommendation: 'MCP wins',
      },
    };

    const output = formatComparisonReport(report);
    expect(output).toContain('Protocol Comparison');
    expect(output).toContain('MCP');
    expect(output).toContain('A2A');
  });

  it('should handle empty test cases', async () => {
    const config: ComparatorConfig = {
      mcpServer: 'https://mcp.example.com',
      a2aAgent: 'https://a2a.example.com',
      testCases: [],
      repetitions: 1,
    };

    const comparator = new ProtocolComparator(config);
    const report = await comparator.compareMCPvsA2A();

    expect(report.results).toHaveLength(0);
    expect(report.summary.totalTests).toBe(0);
  });
});

// ================================================
// Agent Discovery Tests
// ================================================

describe('AgentDiscovery', () => {
  it('should discover agent from URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));

    const discovery = new AgentDiscovery();
    const card = await discovery.discoverFromUrl('https://agent.example.com');

    expect(card).not.toBeNull();
    expect(card?.name).toBe('Test Agent');
  });

  it('should return null for non-existent agent', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false, status: 404 }));

    const discovery = new AgentDiscovery();
    const card = await discovery.discoverFromUrl('https://nonexistent.example.com');

    expect(card).toBeNull();
  });

  it('should return null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const discovery = new AgentDiscovery();
    const card = await discovery.discoverFromUrl('https://error.example.com');

    expect(card).toBeNull();
  });

  it('should return null for invalid agent card (missing name)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ url: 'https://example.com' }));

    const discovery = new AgentDiscovery();
    const card = await discovery.discoverFromUrl('https://example.com');

    expect(card).toBeNull();
  });

  it('should discover from registry', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      agents: [sampleAgentCard, { ...sampleAgentCard, name: 'Agent 2', url: 'https://agent2.com' }],
    }));

    const discovery = new AgentDiscovery({
      registryUrls: ['https://registry.example.com/agents'],
    });
    const cards = await discovery.discoverFromRegistry('test');

    expect(cards).toHaveLength(2);
  });

  it('should handle registry errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Registry down'));

    const discovery = new AgentDiscovery({
      registryUrls: ['https://broken-registry.example.com'],
    });
    const cards = await discovery.discoverFromRegistry('test');

    expect(cards).toHaveLength(0);
  });

  it('should discover batch of agents', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(sampleAgentCard));
    mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false, status: 404 }));

    const discovery = new AgentDiscovery();
    const results = await discovery.discoverBatch([
      'https://agent1.example.com',
      'https://agent2.example.com',
    ]);

    expect(results.size).toBe(2);
    expect(results.get('https://agent1.example.com')).not.toBeNull();
    expect(results.get('https://agent2.example.com')).toBeNull();
  });

  it('should verify capabilities of an agent', async () => {
    // Reachability check
    mockFetch.mockResolvedValueOnce(mockResponse({ error: { code: -32600 } }));
    // tasks/send check
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', jsonrpc: '2.0', result: sampleTask }));
    // Streaming check
    mockFetch.mockResolvedValueOnce(mockResponse({}, {
      headers: { 'content-type': 'text/event-stream' },
    }));
    // Skill check
    mockFetch.mockResolvedValueOnce(mockResponse({ id: '3', jsonrpc: '2.0', result: sampleTask }));

    const discovery = new AgentDiscovery();
    const report = await discovery.verifyCapabilities(sampleAgentCard);

    expect(report.agent).toBe('Test Agent');
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.results.length).toBeGreaterThan(0);
  });

  it('should report unreachable agent in verification', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const discovery = new AgentDiscovery();
    const report = await discovery.verifyCapabilities(sampleAgentCard);

    const reachableResult = report.results.find(r => r.capability === 'reachable');
    expect(reachableResult?.verified).toBe(false);
    expect(report.warnings).toContain('Agent is not reachable — capability verification skipped');
  });

  it('should format verification report', () => {
    const report: VerificationReport = {
      agent: 'Test Agent',
      url: 'https://agent.example.com',
      timestamp: new Date().toISOString(),
      results: [
        { capability: 'reachable', claimed: true, verified: true, details: 'OK' },
        { capability: 'streaming', claimed: true, verified: false, details: 'Not working' },
      ],
      overallScore: 50,
      warnings: ['Streaming not working'],
    };

    const output = formatVerificationReport(report);
    expect(output).toContain('Agent Verification');
    expect(output).toContain('Test Agent');
    expect(output).toContain('50/100');
    expect(output).toContain('✅');
    expect(output).toContain('❌');
  });
});
