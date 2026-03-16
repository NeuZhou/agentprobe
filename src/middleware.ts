/**
 * Trace Recorder Middleware — Drop-in middleware for popular frameworks
 *
 * Provides Express middleware and Vercel AI SDK wrapper for automatic
 * agent trace recording.
 *
 * @example
 * ```typescript
 * // Express
 * import { agentProbeMiddleware } from '@neuzhou/agentprobe';
 * app.use(agentProbeMiddleware({ output: './traces' }));
 *
 * // Vercel AI SDK
 * import { withAgentProbe } from '@neuzhou/agentprobe';
 * const model = withAgentProbe(openai('gpt-4'));
 * ```
 */

import type { AgentTrace, TraceStep, Message, ToolCall } from './types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface MiddlewareOptions {
  output: string;
  prefix?: string;
  includeHeaders?: boolean;
  includeBody?: boolean;
  flushInterval?: number;
  maxTraces?: number;
  filter?: (req: any) => boolean;
  onTrace?: (trace: AgentTrace) => void;
}

export interface TraceBuffer {
  traces: AgentTrace[];
  outputDir: string;
  maxTraces: number;
}

/**
 * Create a trace buffer for batching trace writes.
 */
export function createTraceBuffer(outputDir: string, maxTraces = 100): TraceBuffer {
  return {
    traces: [],
    outputDir,
    maxTraces,
  };
}

/**
 * Flush traces from buffer to disk.
 */
export function flushTraceBuffer(buffer: TraceBuffer): number {
  if (buffer.traces.length === 0) return 0;

  if (!fs.existsSync(buffer.outputDir)) {
    fs.mkdirSync(buffer.outputDir, { recursive: true });
  }

  const count = buffer.traces.length;
  for (const trace of buffer.traces) {
    const filename = `${trace.id}.json`;
    const filepath = path.join(buffer.outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(trace, null, 2));
  }
  buffer.traces = [];
  return count;
}

/**
 * Add a trace to the buffer, auto-flushing if full.
 */
export function addToBuffer(buffer: TraceBuffer, trace: AgentTrace): boolean {
  buffer.traces.push(trace);
  if (buffer.traces.length >= buffer.maxTraces) {
    flushTraceBuffer(buffer);
    return true; // flushed
  }
  return false;
}

/**
 * Build a trace from an HTTP request/response cycle.
 */
export function buildTraceFromHTTP(
  method: string,
  url: string,
  requestBody: any,
  responseBody: any,
  durationMs: number,
  metadata: Record<string, any> = {},
): AgentTrace {
  const steps: TraceStep[] = [];
  const now = new Date().toISOString();

  // Parse request as user message
  if (requestBody?.messages) {
    steps.push({
      type: 'llm_call',
      timestamp: now,
      data: {
        messages: requestBody.messages as Message[],
        model: requestBody.model,
      },
    });
  } else {
    steps.push({
      type: 'llm_call',
      timestamp: now,
      data: {
        content: typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody),
      },
    });
  }

  // Parse response for tool calls or output
  if (responseBody?.choices?.[0]?.message?.tool_calls) {
    const toolCalls: ToolCall[] = responseBody.choices[0].message.tool_calls;
    for (const tc of toolCalls) {
      steps.push({
        type: 'tool_call',
        timestamp: now,
        data: {
          tool_name: tc.function.name,
          tool_args: JSON.parse(tc.function.arguments || '{}'),
        },
      });
    }
  }

  if (responseBody?.choices?.[0]?.message?.content) {
    steps.push({
      type: 'output',
      timestamp: now,
      data: {
        content: responseBody.choices[0].message.content,
      },
      duration_ms: durationMs,
    });
  }

  return {
    id: crypto.randomUUID(),
    timestamp: now,
    steps,
    metadata: {
      ...metadata,
      method,
      url,
      duration_ms: durationMs,
      source: 'middleware',
    },
  };
}

/**
 * Create Express-compatible middleware for recording agent traces.
 */
export function agentProbeMiddleware(options: MiddlewareOptions): (req: any, res: any, next: any) => void {
  const buffer = createTraceBuffer(options.output, options.maxTraces);

  // Set up periodic flush
  if (options.flushInterval) {
    setInterval(() => flushTraceBuffer(buffer), options.flushInterval);
  }

  return (req: any, res: any, next: any) => {
    if (options.filter && !options.filter(req)) {
      return next();
    }

    const start = Date.now();
    const originalJson = res.json?.bind(res);

    if (originalJson) {
      res.json = (body: any) => {
        const duration = Date.now() - start;
        const trace = buildTraceFromHTTP(
          req.method,
          req.url,
          req.body,
          body,
          duration,
          {
            ...(options.includeHeaders ? { headers: req.headers } : {}),
            prefix: options.prefix,
          },
        );
        addToBuffer(buffer, trace);
        if (options.onTrace) options.onTrace(trace);
        return originalJson(body);
      };
    }

    next();
  };
}

/**
 * Wrapper configuration for AI SDK models.
 */
export interface WrapperOptions {
  output?: string;
  onTrace?: (trace: AgentTrace) => void;
  metadata?: Record<string, any>;
}

/**
 * Wrap a Vercel AI SDK model to record traces.
 * Returns a proxy that intercepts calls and records them.
 */
export function withAgentProbe(model: any, options: WrapperOptions = {}): any {
  const buffer = options.output ? createTraceBuffer(options.output) : null;

  return new Proxy(model, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function') return original;

      return async function (...args: any[]) {
        const start = Date.now();
        const result = await original.apply(target, args);
        const duration = Date.now() - start;

        const steps: TraceStep[] = [];
        const now = new Date().toISOString();

        // Record the call
        if (args[0]?.messages) {
          steps.push({
            type: 'llm_call',
            timestamp: now,
            data: {
              messages: args[0].messages,
              model: target.modelId ?? target.model ?? 'unknown',
            },
          });
        }

        // Record output
        if (result?.text || result?.content) {
          steps.push({
            type: 'output',
            timestamp: now,
            data: { content: result.text ?? result.content },
            duration_ms: duration,
          });
        }

        if (result?.toolCalls) {
          for (const tc of result.toolCalls) {
            steps.push({
              type: 'tool_call',
              timestamp: now,
              data: {
                tool_name: tc.toolName ?? tc.name,
                tool_args: tc.args,
              },
            });
          }
        }

        const trace: AgentTrace = {
          id: crypto.randomUUID(),
          timestamp: now,
          steps,
          metadata: {
            ...options.metadata,
            duration_ms: duration,
            source: 'ai-sdk-wrapper',
          },
        };

        if (buffer) addToBuffer(buffer, trace);
        if (options.onTrace) options.onTrace(trace);

        return result;
      };
    },
  });
}

/**
 * Format middleware stats.
 */
export function formatMiddlewareStats(buffer: TraceBuffer): string {
  return [
    `Trace Buffer Stats:`,
    `  Pending: ${buffer.traces.length}`,
    `  Output: ${buffer.outputDir}`,
    `  Max before flush: ${buffer.maxTraces}`,
  ].join('\n');
}
