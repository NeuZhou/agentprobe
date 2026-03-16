/**
 * Agent Playground — Interactive test playground for agent behaviors.
 *
 * Modes:
 * - Interactive: type messages, see agent responses and tool calls
 * - Record: capture interaction as test case
 * - Replay: replay recorded session with assertions
 *
 * @since 4.5.0
 */

import YAML from 'yaml';
import type { AgentTrace } from './types';

// ─── Types ───────────────────────────────────────────────────────────

export type PlaygroundMode = 'interactive' | 'record' | 'replay';

export interface PlaygroundConfig {
  /** Display name */
  name?: string;
  /** Default mode */
  mode?: PlaygroundMode;
  /** Model to use for interactive/record */
  model?: string;
  /** Available tools */
  tools?: PlaygroundToolDef[];
  /** System prompt */
  systemPrompt?: string;
  /** Max turns before auto-stop */
  maxTurns?: number;
  /** Timeout per turn (ms) */
  turnTimeout?: number;
  /** Auto-record interactions */
  autoRecord?: boolean;
}

export interface PlaygroundToolDef {
  name: string;
  description?: string;
  handler?: (args: Record<string, any>) => any | Promise<any>;
}

export interface PlaygroundMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: PlaygroundToolCall[];
  toolCallId?: string;
  timestamp: string;
}

export interface PlaygroundToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
  duration_ms?: number;
}

export interface PlaygroundSession {
  id: string;
  config: PlaygroundConfig;
  mode: PlaygroundMode;
  messages: PlaygroundMessage[];
  trace: AgentTrace;
  startedAt: string;
  endedAt?: string;
  turnCount: number;
  totalTokens: number;
  assertions?: SessionAssertion[];
}

export interface SessionAssertion {
  name: string;
  passed: boolean;
  message?: string;
}

export interface ReplayOptions {
  /** Session to replay */
  session: PlaygroundSession;
  /** Assertions to check during replay */
  assertions?: ReplayAssertion[];
  /** Speed multiplier (1.0 = real-time) */
  speed?: number;
  /** Override tool responses */
  toolOverrides?: Record<string, any>;
}

export interface ReplayAssertion {
  /** Turn number (1-based) */
  afterTurn: number;
  check: (session: PlaygroundSession) => boolean;
  name: string;
}

export interface ReplayResult {
  session: PlaygroundSession;
  assertions: SessionAssertion[];
  passed: boolean;
  duration_ms: number;
}

// ─── Playground ──────────────────────────────────────────────────────

let sessionCounter = 0;

export class AgentPlayground {
  readonly config: PlaygroundConfig;

  constructor(config: PlaygroundConfig = {}) {
    this.config = {
      name: config.name ?? 'AgentProbe Playground',
      mode: config.mode ?? 'interactive',
      model: config.model ?? 'gpt-4o',
      tools: config.tools ?? [],
      systemPrompt: config.systemPrompt,
      maxTurns: config.maxTurns ?? 50,
      turnTimeout: config.turnTimeout ?? 30000,
      autoRecord: config.autoRecord ?? false,
    };
  }

  /**
   * Start a new playground session.
   */
  startSession(mode?: PlaygroundMode): PlaygroundSession {
    const id = `session-${++sessionCounter}-${Date.now()}`;
    const now = new Date().toISOString();
    const session: PlaygroundSession = {
      id,
      config: this.config,
      mode: mode ?? this.config.mode ?? 'interactive',
      messages: [],
      trace: {
        id: `trace-${id}`,
        timestamp: now,
        steps: [],
        metadata: {
          playground: true,
          model: this.config.model,
          mode: mode ?? this.config.mode,
        },
      },
      startedAt: now,
      turnCount: 0,
      totalTokens: 0,
    };

    if (this.config.systemPrompt) {
      session.messages.push({
        role: 'system',
        content: this.config.systemPrompt,
        timestamp: now,
      });
    }

    return session;
  }

  /**
   * Send a user message and get assistant response (simulated).
   */
  sendMessage(session: PlaygroundSession, userMessage: string): PlaygroundMessage {
    if (session.turnCount >= (this.config.maxTurns ?? 50)) {
      throw new Error(`Max turns (${this.config.maxTurns}) reached`);
    }

    const now = new Date().toISOString();

    // Add user message
    session.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: now,
    });

    // Record in trace
    session.trace.steps.push({
      type: 'llm_call',
      timestamp: now,
      data: {
        model: this.config.model,
        messages: [{ role: 'user', content: userMessage }],
        tokens: { input: estimateTokens(userMessage), output: 0 },
      },
      duration_ms: 0,
    });

    // Simulated assistant response
    const response: PlaygroundMessage = {
      role: 'assistant',
      content: `[Playground] Response to: ${userMessage}`,
      timestamp: new Date().toISOString(),
    };

    session.messages.push(response);
    session.turnCount++;
    session.totalTokens += estimateTokens(userMessage) + estimateTokens(response.content);

    // Record output in trace
    session.trace.steps.push({
      type: 'output',
      timestamp: response.timestamp,
      data: { content: response.content },
      duration_ms: 10,
    });

    return response;
  }

  /**
   * Simulate a tool call in the session.
   */
  callTool(session: PlaygroundSession, toolName: string, args: Record<string, any> = {}): PlaygroundToolCall {
    const toolDef = this.config.tools?.find(t => t.name === toolName);
    const start = Date.now();
    let result: any;

    if (toolDef?.handler) {
      result = toolDef.handler(args);
    } else {
      result = { mock: true, tool: toolName, args };
    }

    const duration = Date.now() - start;
    const call: PlaygroundToolCall = {
      id: `call-${Date.now()}`,
      name: toolName,
      args,
      result,
      duration_ms: duration,
    };

    // Add to trace
    session.trace.steps.push({
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      data: { tool_name: toolName, tool_args: args },
      duration_ms: duration,
    });

    session.trace.steps.push({
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      data: { tool_name: toolName, tool_result: result },
      duration_ms: 0,
    });

    return call;
  }

  /**
   * End the session.
   */
  endSession(session: PlaygroundSession): void {
    session.endedAt = new Date().toISOString();
  }

  /**
   * Export a recorded session as YAML test case.
   */
  recordToYAML(session: PlaygroundSession): string {
    const userMessages = session.messages.filter(m => m.role === 'user');
    const toolCalls = session.trace.steps
      .filter(s => s.type === 'tool_call')
      .map(s => s.data.tool_name)
      .filter(Boolean);
    const outputs = session.messages
      .filter(m => m.role === 'assistant')
      .map(m => m.content);

    const testCase: Record<string, any> = {
      name: `${session.config.name ?? 'Playground'} Session`,
      description: `Recorded from playground session ${session.id}`,
      tests: userMessages.map((msg, i) => {
        const tc: Record<string, any> = {
          name: `Turn ${i + 1}: ${msg.content.slice(0, 50)}`,
          input: msg.content,
          expect: {} as Record<string, any>,
        };
        if (toolCalls.length > 0) {
          tc.expect.tool_called = toolCalls;
        }
        if (outputs[i]) {
          const words = outputs[i].split(/\s+/).filter(w => w.length > 3).slice(0, 3);
          if (words.length > 0) {
            tc.expect.output_contains = words;
          }
        }
        return tc;
      }),
    };

    return YAML.stringify(testCase);
  }

  /**
   * Replay a recorded session with assertions.
   */
  replay(options: ReplayOptions): ReplayResult {
    const start = Date.now();
    const { session: original, assertions = [], toolOverrides } = options;

    const replaySession = this.startSession('replay');
    const results: SessionAssertion[] = [];

    for (let i = 0; i < original.messages.length; i++) {
      const msg = original.messages[i];
      if (msg.role === 'user') {
        this.sendMessage(replaySession, msg.content);

        // Check assertions after this turn
        const turnAssertions = assertions.filter(a => a.afterTurn === replaySession.turnCount);
        for (const a of turnAssertions) {
          const passed = a.check(replaySession);
          results.push({ name: a.name, passed, message: passed ? 'OK' : 'Assertion failed' });
        }
      }
    }

    // Replay tool calls with optional overrides
    for (const step of original.trace.steps) {
      if (step.type === 'tool_call' && step.data.tool_name) {
        const args = toolOverrides?.[step.data.tool_name] ?? step.data.tool_args ?? {};
        this.callTool(replaySession, step.data.tool_name, args);
      }
    }

    this.endSession(replaySession);
    replaySession.assertions = results;

    return {
      session: replaySession,
      assertions: results,
      passed: results.every(r => r.passed),
      duration_ms: Date.now() - start,
    };
  }
}

/**
 * Get the messages as a conversation transcript.
 */
export function formatTranscript(session: PlaygroundSession): string {
  return session.messages
    .map(m => {
      const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
      return `[${role}] ${m.content}`;
    })
    .join('\n');
}

/**
 * Get session stats.
 */
export function getSessionStats(session: PlaygroundSession): {
  turns: number;
  messages: number;
  toolCalls: number;
  tokens: number;
  duration_ms: number;
} {
  const toolCalls = session.trace.steps.filter(s => s.type === 'tool_call').length;
  const startTime = new Date(session.startedAt).getTime();
  const endTime = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();

  return {
    turns: session.turnCount,
    messages: session.messages.length,
    toolCalls,
    tokens: session.totalTokens,
    duration_ms: endTime - startTime,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
