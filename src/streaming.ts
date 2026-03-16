import type { AgentTrace, TraceStep } from './types';
import * as crypto from 'crypto';
import * as fs from 'fs';

export interface StreamingChunk {
  type: 'openai' | 'anthropic' | 'sse';
  data: any;
  timestamp: string;
  raw?: string;
}

export interface StreamingRecorderOptions {
  format?: 'openai' | 'anthropic' | 'sse' | 'auto';
  metadata?: Record<string, any>;
}

type ChunkHandler = (chunk: StreamingChunk) => void;
type CompleteHandler = (trace: AgentTrace) => void;
type ErrorHandler = (error: Error) => void;

/**
 * Records agent traces from streaming responses.
 * Supports OpenAI streaming, Anthropic streaming, and raw SSE format.
 */
export class StreamingRecorder {
  private chunks: StreamingChunk[] = [];
  private format: 'openai' | 'anthropic' | 'sse' | 'auto';
  private metadata: Record<string, any>;
  private chunkHandlers: ChunkHandler[] = [];
  private completeHandlers: CompleteHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private assembledContent = '';
  private toolCalls: Map<number, { name: string; arguments: string }> = new Map();
  private startTime: number = Date.now();
  private finished = false;
  private cachedTrace: AgentTrace | null = null;

  constructor(options: StreamingRecorderOptions = {}) {
    this.format = options.format ?? 'auto';
    this.metadata = options.metadata ?? {};
  }

  /** Register a chunk listener */
  onChunk(handler: ChunkHandler): void {
    this.chunkHandlers.push(handler);
  }

  /** Register a completion listener */
  onComplete(handler: CompleteHandler): void {
    this.completeHandlers.push(handler);
  }

  /** Register an error listener */
  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  /** Feed a raw chunk into the recorder */
  recordChunk(data: any, format?: 'openai' | 'anthropic' | 'sse'): void {
    if (this.finished) return;

    const detectedFormat = format ?? this.detectFormat(data);
    const chunk: StreamingChunk = {
      type: detectedFormat,
      data,
      timestamp: new Date().toISOString(),
    };

    this.chunks.push(chunk);

    // Process based on format
    switch (detectedFormat) {
      case 'openai':
        this.processOpenAIChunk(data);
        break;
      case 'anthropic':
        this.processAnthropicChunk(data);
        break;
      case 'sse':
        this.processSSEChunk(data);
        break;
    }

    for (const handler of this.chunkHandlers) {
      handler(chunk);
    }
  }

  /** Parse and record an SSE text block (multiple `data:` lines) */
  recordSSE(text: string): void {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') {
        this.finish();
        return;
      }
      if (trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          this.recordChunk(parsed, 'sse');
        } catch {
          // non-JSON SSE data, record as raw
          this.recordChunk({ raw: trimmed.slice(6) }, 'sse');
        }
      }
    }
  }

  /** Signal that streaming is complete and assemble the trace */
  finish(): AgentTrace {
    if (this.finished) return this.cachedTrace!;
    this.finished = true;
    this.cachedTrace = this.assembleTrace();
    for (const handler of this.completeHandlers) {
      handler(this.cachedTrace);
    }
    return this.cachedTrace;
  }

  /** Get all recorded chunks */
  getChunks(): StreamingChunk[] {
    return [...this.chunks];
  }

  /** Check if recording is finished */
  isFinished(): boolean {
    return this.finished;
  }

  /** Save the assembled trace to a file */
  save(outputPath: string): void {
    const trace = this.finished ? this.assembleTrace() : this.finish();
    fs.writeFileSync(outputPath, JSON.stringify(trace, null, 2));
  }

  private detectFormat(data: any): 'openai' | 'anthropic' | 'sse' {
    if (this.format !== 'auto') return this.format;

    // OpenAI streaming chunks have choices[].delta
    if (data?.choices?.[0]?.delta !== undefined) return 'openai';
    if (data?.object === 'chat.completion.chunk') return 'openai';

    // Anthropic streaming has type field like content_block_delta, message_start, etc.
    if (data?.type && typeof data.type === 'string') {
      const anthropicTypes = [
        'message_start', 'content_block_start', 'content_block_delta',
        'content_block_stop', 'message_delta', 'message_stop',
      ];
      if (anthropicTypes.includes(data.type)) return 'anthropic';
    }

    return 'sse';
  }

  private processOpenAIChunk(data: any): void {
    const delta = data?.choices?.[0]?.delta;
    if (!delta) return;

    if (delta.content) {
      this.assembledContent += delta.content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!this.toolCalls.has(idx)) {
          this.toolCalls.set(idx, { name: '', arguments: '' });
        }
        const existing = this.toolCalls.get(idx)!;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
      }
    }
  }

  private processAnthropicChunk(data: any): void {
    switch (data.type) {
      case 'content_block_start':
        if (data.content_block?.type === 'tool_use') {
          const idx = data.index ?? this.toolCalls.size;
          this.toolCalls.set(idx, {
            name: data.content_block.name ?? '',
            arguments: '',
          });
        }
        break;
      case 'content_block_delta':
        if (data.delta?.type === 'text_delta') {
          this.assembledContent += data.delta.text ?? '';
        } else if (data.delta?.type === 'input_json_delta') {
          const idx = data.index ?? this.toolCalls.size - 1;
          const existing = this.toolCalls.get(idx);
          if (existing) {
            existing.arguments += data.delta.partial_json ?? '';
          }
        }
        break;
    }
  }

  private processSSEChunk(data: any): void {
    // SSE can carry OpenAI or Anthropic format inside
    if (data?.choices?.[0]?.delta) {
      this.processOpenAIChunk(data);
    } else if (data?.type && data.type.startsWith('content_block')) {
      this.processAnthropicChunk(data);
    } else if (data?.content || data?.text) {
      this.assembledContent += data.content ?? data.text ?? '';
    }
  }

  private assembleTrace(): AgentTrace {
    const steps: TraceStep[] = [];
    const totalDuration = Date.now() - this.startTime;

    // Add LLM call step
    steps.push({
      type: 'llm_call',
      timestamp: new Date(this.startTime).toISOString(),
      data: {
        model: this.chunks[0]?.data?.model ?? this.metadata.model ?? 'unknown',
        tokens: {
          input: this.metadata.input_tokens,
          output: this.metadata.output_tokens,
        },
      },
      duration_ms: totalDuration,
    });

    // Add tool call steps
    for (const [, tc] of this.toolCalls) {
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = JSON.parse(tc.arguments || '{}');
      } catch {
        parsedArgs = { _raw: tc.arguments };
      }
      steps.push({
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: {
          tool_name: tc.name,
          tool_args: parsedArgs,
        },
      });
    }

    // Add output step if we have assembled content
    if (this.assembledContent) {
      steps.push({
        type: 'output',
        timestamp: new Date().toISOString(),
        data: { content: this.assembledContent },
      });
    }

    return {
      id: this.metadata.id ?? crypto.randomUUID(),
      timestamp: new Date(this.startTime).toISOString(),
      steps,
      metadata: {
        ...this.metadata,
        streaming: true,
        chunk_count: this.chunks.length,
        format: this.format,
      },
    };
  }
}
