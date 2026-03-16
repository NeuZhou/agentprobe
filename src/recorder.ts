import type { AgentTrace, TraceStep } from './types';
import * as fs from 'fs';
import * as crypto from 'crypto';

export class Recorder {
  private trace: AgentTrace;
  private startTime: number;

  constructor(metadata: Record<string, any> = {}) {
    this.startTime = Date.now();
    this.trace = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      steps: [],
      metadata,
    };
  }

  addStep(step: Omit<TraceStep, 'timestamp'>): void {
    this.trace.steps.push({
      ...step,
      timestamp: new Date().toISOString(),
    });
  }

  getTrace(): AgentTrace {
    return this.trace;
  }

  save(outputPath: string): void {
    fs.writeFileSync(outputPath, JSON.stringify(this.trace, null, 2));
  }

  /**
   * Monkey-patch OpenAI SDK to record calls.
   * Usage: recorder.patchOpenAI(require('openai'))
   */
  patchOpenAI(openaiModule: any): void {
    const recorder = this;
    const origCreate = openaiModule.OpenAI?.Chat?.Completions?.prototype?.create
      ?? openaiModule?.default?.Chat?.Completions?.prototype?.create;

    if (!origCreate) {
      // Try patching instance-based
      return;
    }

    const patch = function (this: any, ...args: any[]) {
      const start = Date.now();
      recorder.addStep({
        type: 'llm_call',
        data: {
          model: args[0]?.model,
          messages: args[0]?.messages,
        },
      });

      const result = origCreate.apply(this, args);

      if (result && typeof result.then === 'function') {
        return result.then((res: any) => {
          const choice = res?.choices?.[0];
          if (choice?.message?.tool_calls) {
            for (const tc of choice.message.tool_calls) {
              recorder.addStep({
                type: 'tool_call',
                data: {
                  tool_name: tc.function.name,
                  tool_args: JSON.parse(tc.function.arguments || '{}'),
                },
                duration_ms: Date.now() - start,
              });
            }
          }
          if (choice?.message?.content) {
            recorder.addStep({
              type: 'output',
              data: { content: choice.message.content },
              duration_ms: Date.now() - start,
            });
          }
          return res;
        });
      }
      return result;
    };

    // Patch at prototype level
    if (openaiModule.OpenAI?.Chat?.Completions?.prototype) {
      openaiModule.OpenAI.Chat.Completions.prototype.create = patch;
    }
  }

  /**
   * Monkey-patch Anthropic SDK to record calls.
   */
  patchAnthropic(anthropicModule: any): void {
    const recorder = this;
    const MessagesClass = anthropicModule?.Anthropic?.Messages?.prototype
      ?? anthropicModule?.default?.Messages?.prototype;

    if (!MessagesClass?.create) return;

    const origCreate = MessagesClass.create;
    MessagesClass.create = function (this: any, ...args: any[]) {
      const start = Date.now();
      recorder.addStep({
        type: 'llm_call',
        data: {
          model: args[0]?.model,
          messages: args[0]?.messages,
        },
      });

      const result = origCreate.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.then((res: any) => {
          for (const block of res?.content ?? []) {
            if (block.type === 'tool_use') {
              recorder.addStep({
                type: 'tool_call',
                data: {
                  tool_name: block.name,
                  tool_args: block.input,
                },
                duration_ms: Date.now() - start,
              });
            } else if (block.type === 'text') {
              recorder.addStep({
                type: 'output',
                data: { content: block.text },
                duration_ms: Date.now() - start,
              });
            }
          }
          return res;
        });
      }
      return result;
    };
  }
}

export function loadTrace(path: string): AgentTrace {
  const raw = fs.readFileSync(path, 'utf-8');
  return JSON.parse(raw) as AgentTrace;
}
