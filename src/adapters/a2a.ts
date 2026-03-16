/**
 * A2A (Agent-to-Agent) Protocol Test Adapter
 *
 * Google's A2A protocol enables agent-to-agent communication via a standard HTTP API.
 * This adapter provides first-class testing support for A2A-compatible agents,
 * including task lifecycle management, streaming, and agent card discovery.
 *
 * @see https://github.com/google/A2A
 */

import type { AssertionResult } from '../types';

// ===== A2A Protocol Types =====

export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  version?: string;
  capabilities?: AgentCapability[];
  authentication?: AuthenticationInfo;
  provider?: ProviderInfo;
  skills?: AgentSkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  supportsStreaming?: boolean;
  supportsPushNotifications?: boolean;
}

export interface AgentCapability {
  name: string;
  description?: string;
}

export interface AuthenticationInfo {
  schemes: string[];
  credentials?: string;
}

export interface ProviderInfo {
  organization: string;
  url?: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2ATask {
  id: string;
  sessionId?: string;
  status: TaskStatus;
  messages: A2AMessage[];
  artifacts?: TaskArtifact[];
  metadata?: Record<string, any>;
}

export interface TaskStatus {
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'canceled' | 'failed';
  message?: string;
  timestamp?: string;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: MessagePart[];
  metadata?: Record<string, any>;
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { name: string; mimeType: string; bytes?: string; uri?: string } }
  | { type: 'data'; data: Record<string, any> };

export interface TaskArtifact {
  name?: string;
  description?: string;
  parts: MessagePart[];
  index?: number;
}

export interface A2AResponse {
  id: string;
  jsonrpc: '2.0';
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// ===== Adapter Config =====

export interface A2AAdapterConfig {
  agentUrl: string;
  capabilities?: string[];
  timeout_ms?: number;
  auth?: { type: 'bearer'; token: string } | { type: 'api-key'; key: string; header?: string };
  headers?: Record<string, string>;
}

// ===== Test Types =====

export interface A2ATestCase {
  name: string;
  message: string;
  sessionId?: string;
  expectedState?: TaskStatus['state'];
  expectedOutput?: string | string[];
  expectedArtifacts?: number;
  maxRoundtrips?: number;
  timeout_ms?: number;
  streaming?: boolean;
}

export interface A2ATestResult {
  name: string;
  passed: boolean;
  task?: A2ATask;
  assertions: AssertionResult[];
  duration_ms: number;
  error?: string;
  roundtrips?: number;
}

// ===== A2A Adapter =====

export class A2AAdapter {
  private config: A2AAdapterConfig;
  private agentCard: AgentCard | null = null;

  constructor(config: A2AAdapterConfig) {
    this.config = config;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
    if (this.config.auth) {
      if (this.config.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${this.config.auth.token}`;
      } else if (this.config.auth.type === 'api-key') {
        headers[this.config.auth.header || 'X-API-Key'] = this.config.auth.key;
      }
    }
    return headers;
  }

  /**
   * Fetch the agent card from /.well-known/agent.json
   */
  async getAgentCard(): Promise<AgentCard> {
    if (this.agentCard) return this.agentCard;

    const baseUrl = this.config.agentUrl.replace(/\/$/, '');
    const url = `${baseUrl}/.well-known/agent.json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout_ms || 10000);

    try {
      const resp = await fetch(url, {
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`Failed to fetch agent card: ${resp.status} ${resp.statusText}`);
      }
      this.agentCard = (await resp.json()) as AgentCard;
      return this.agentCard;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Send a JSON-RPC request to the A2A agent
   */
  private async rpc(method: string, params: Record<string, any>): Promise<A2AResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout_ms || 30000);

    try {
      const resp = await fetch(this.config.agentUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`A2A RPC failed: ${resp.status} ${resp.statusText}`);
      }
      return (await resp.json()) as A2AResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Create and send a task (tasks/send)
   */
  async send(message: string, sessionId?: string): Promise<A2ATask> {
    const params: any = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: {
        role: 'user',
        parts: [{ type: 'text', text: message }],
      },
    };
    if (sessionId) params.sessionId = sessionId;

    const resp = await this.rpc('tasks/send', params);
    if (resp.error) {
      throw new Error(`A2A task error: ${resp.error.message} (code: ${resp.error.code})`);
    }
    return resp.result as A2ATask;
  }

  /**
   * Send a task with streaming (tasks/sendSubscribe)
   */
  async *sendStream(
    message: string,
    sessionId?: string,
  ): AsyncGenerator<TaskStatus | A2AMessage | TaskArtifact> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const params: any = {
      id: taskId,
      message: {
        role: 'user',
        parts: [{ type: 'text', text: message }],
      },
    };
    if (sessionId) params.sessionId = sessionId;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout_ms || 60000);

    try {
      const resp = await fetch(this.config.agentUrl, {
        method: 'POST',
        headers: { ...this.getHeaders(), Accept: 'text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `ap-stream-${Date.now()}`,
          method: 'tasks/sendSubscribe',
          params,
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`A2A stream failed: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.result) yield data.result;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get task status
   */
  async getTask(taskId: string): Promise<A2ATask> {
    const resp = await this.rpc('tasks/get', { id: taskId });
    if (resp.error) {
      throw new Error(`Failed to get task: ${resp.error.message}`);
    }
    return resp.result as A2ATask;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<A2ATask> {
    const resp = await this.rpc('tasks/cancel', { id: taskId });
    if (resp.error) {
      throw new Error(`Failed to cancel task: ${resp.error.message}`);
    }
    return resp.result as A2ATask;
  }

  /**
   * Run an A2A test case
   */
  async runTest(tc: A2ATestCase): Promise<A2ATestResult> {
    const assertions: AssertionResult[] = [];
    const start = Date.now();

    try {
      let task: A2ATask;

      if (tc.streaming) {
        // Collect streaming results
        const events: any[] = [];
        for await (const event of this.sendStream(tc.message, tc.sessionId)) {
          events.push(event);
        }
        // Last event should be the completed task
        task = events[events.length - 1] as A2ATask;
        if (!task?.status) {
          task = { id: 'stream', sessionId: tc.sessionId, status: { state: 'completed' }, messages: [] };
        }
      } else {
        task = await this.send(tc.message, tc.sessionId);
      }

      // Assert expected state
      if (tc.expectedState) {
        assertions.push({
          name: 'task_state',
          passed: task.status.state === tc.expectedState,
          expected: tc.expectedState,
          actual: task.status.state,
          message: task.status.state === tc.expectedState
            ? `Task reached expected state: ${tc.expectedState}`
            : `Expected state ${tc.expectedState}, got ${task.status.state}`,
        });
      }

      // Assert output content
      if (tc.expectedOutput) {
        const outputs = Array.isArray(tc.expectedOutput) ? tc.expectedOutput : [tc.expectedOutput];
        const allText = extractText(task);
        for (const expected of outputs) {
          assertions.push({
            name: 'output_contains',
            passed: allText.includes(expected),
            expected,
            actual: allText.slice(0, 200),
            message: allText.includes(expected)
              ? `Output contains "${expected}"`
              : `Output missing "${expected}"`,
          });
        }
      }

      // Assert artifacts
      if (tc.expectedArtifacts !== undefined) {
        const count = task.artifacts?.length || 0;
        assertions.push({
          name: 'artifact_count',
          passed: count === tc.expectedArtifacts,
          expected: tc.expectedArtifacts,
          actual: count,
        });
      }

      const passed = assertions.every((a) => a.passed);
      return { name: tc.name, passed, task, assertions, duration_ms: Date.now() - start };
    } catch (err: any) {
      assertions.push({ name: 'execution', passed: false, message: err.message });
      return { name: tc.name, passed: false, assertions, duration_ms: Date.now() - start, error: err.message };
    }
  }

  /**
   * Run multiple A2A test cases
   */
  async runTests(cases: A2ATestCase[]): Promise<A2ATestResult[]> {
    const results: A2ATestResult[] = [];
    for (const tc of cases) {
      results.push(await this.runTest(tc));
    }
    return results;
  }
}

// ===== Helpers =====

function extractText(task: A2ATask): string {
  const parts: string[] = [];
  for (const msg of task.messages || []) {
    for (const part of msg.parts) {
      if (part.type === 'text') parts.push(part.text);
    }
  }
  for (const artifact of task.artifacts || []) {
    for (const part of artifact.parts) {
      if (part.type === 'text') parts.push(part.text);
    }
  }
  return parts.join('\n');
}

/**
 * Validate an agent card structure
 */
export function validateAgentCard(card: any): AssertionResult[] {
  const results: AssertionResult[] = [];

  results.push({
    name: 'card_has_name',
    passed: typeof card?.name === 'string' && card.name.length > 0,
    message: card?.name ? `Agent name: ${card.name}` : 'Missing agent name',
  });

  results.push({
    name: 'card_has_url',
    passed: typeof card?.url === 'string' && card.url.startsWith('http'),
    message: card?.url ? `Agent URL: ${card.url}` : 'Missing or invalid agent URL',
  });

  if (card?.capabilities) {
    results.push({
      name: 'card_capabilities_valid',
      passed: Array.isArray(card.capabilities) && card.capabilities.every((c: any) => typeof c.name === 'string'),
      message: 'Capabilities should be an array of objects with name',
    });
  }

  if (card?.skills) {
    results.push({
      name: 'card_skills_valid',
      passed: Array.isArray(card.skills) && card.skills.every((s: any) => s.id && s.name),
      message: 'Skills should have id and name',
    });
  }

  if (card?.authentication) {
    results.push({
      name: 'card_auth_has_schemes',
      passed: Array.isArray(card.authentication.schemes) && card.authentication.schemes.length > 0,
      message: 'Authentication should declare at least one scheme',
    });
  }

  return results;
}
