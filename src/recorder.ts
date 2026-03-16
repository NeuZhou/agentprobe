/* eslint-disable @typescript-eslint/no-this-alias */
import type { AgentTrace, TraceStep } from './types';
import * as fs from 'fs';
import * as crypto from 'crypto';

export class Recorder {
  private trace: AgentTrace;

  constructor(metadata: Record<string, any> = {}) {
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
    const origCreate =
      openaiModule.OpenAI?.Chat?.Completions?.prototype?.create ??
      openaiModule?.default?.Chat?.Completions?.prototype?.create;

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
    const MessagesClass =
      anthropicModule?.Anthropic?.Messages?.prototype ??
      anthropicModule?.default?.Messages?.prototype;

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

  /**
   * Monkey-patch Google Gemini SDK (generativelanguage API) to record calls.
   */
  patchGemini(geminiModule: any): void {
    const recorder = this;

    // Try to patch generateContent on the model
    const modelProto = geminiModule?.GenerativeModel?.prototype;
    if (!modelProto?.generateContent) return;

    const origGenerate = modelProto.generateContent;
    modelProto.generateContent = function (this: any, ...args: any[]) {
      const start = Date.now();
      recorder.addStep({
        type: 'llm_call',
        data: {
          model: this.model ?? 'gemini',
          messages: args[0]?.contents ?? args[0],
        },
      });

      const result = origGenerate.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.then((res: any) => {
          const response = res?.response;
          const candidates = response?.candidates ?? [];
          for (const candidate of candidates) {
            for (const part of candidate?.content?.parts ?? []) {
              if (part.functionCall) {
                recorder.addStep({
                  type: 'tool_call',
                  data: {
                    tool_name: part.functionCall.name,
                    tool_args: part.functionCall.args ?? {},
                  },
                  duration_ms: Date.now() - start,
                });
              } else if (part.text) {
                recorder.addStep({
                  type: 'output',
                  data: { content: part.text },
                  duration_ms: Date.now() - start,
                });
              }
            }
          }
          return res;
        });
      }
      return result;
    };
  }

  /**
   * Explicit Ollama support (OpenAI-compatible, patches fetch-based calls).
   * Ollama uses the same OpenAI chat completions format, so patchOpenAI works.
   * This method provides explicit labeling in traces.
   */
  patchOllama(): void {
    // Ollama is OpenAI-compatible — add metadata marker
    this.trace.metadata.provider = this.trace.metadata.provider ?? 'ollama';
  }

  /**
   * Monkey-patch Azure OpenAI SDK (different base URL, same SDK).
   * Azure OpenAI uses the same @azure/openai or openai SDK with azure config.
   */
  patchAzureOpenAI(azureModule: any): void {
    const recorder = this;

    // Azure OpenAI uses the same OpenAI SDK structure
    // Try patching the azure-specific client
    const ClientProto = azureModule?.AzureOpenAI?.prototype ?? azureModule?.OpenAIClient?.prototype;

    if (!ClientProto) {
      // Fall back to standard OpenAI patching (Azure OpenAI v2 uses openai SDK)
      this.patchOpenAI(azureModule);
      this.trace.metadata.provider = 'azure-openai';
      return;
    }

    // Patch getChatCompletions for older @azure/openai SDK
    if (ClientProto.getChatCompletions) {
      const origChat = ClientProto.getChatCompletions;
      ClientProto.getChatCompletions = function (this: any, ...args: any[]) {
        const start = Date.now();
        recorder.addStep({
          type: 'llm_call',
          data: {
            model: args[0], // deployment name
            messages: args[1],
          },
        });

        const result = origChat.apply(this, args);
        if (result && typeof result.then === 'function') {
          return result.then((res: any) => {
            const choice = res?.choices?.[0];
            if (choice?.message?.toolCalls) {
              for (const tc of choice.message.toolCalls) {
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
    }

    recorder.trace.metadata.provider = 'azure-openai';
  }
}

// ===== Trace Sampling for High-Volume Production =====

export type SamplingStrategy = 'random' | 'reservoir' | 'priority';

export interface PriorityRule {
  /** Always capture error traces */
  error?: 'always';
  /** Capture traces costing more than this USD amount */
  cost_gt?: number;
  /** Capture traces longer than this duration string e.g. "10s" */
  duration_gt?: string;
  /** Capture traces with specific tool names */
  tool_used?: string;
}

export interface TraceSamplingConfig {
  /** Sampling rate 0.0-1.0 (e.g. 0.1 = 10%) */
  rate: number;
  /** Sampling strategy */
  strategy: SamplingStrategy;
  /** Priority rules that override the sampling rate (always captured) */
  priority_rules?: PriorityRule[];
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Parse a duration string to milliseconds for priority rules.
 */
function parseDurationMs(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  switch (match[2].toLowerCase()) {
    case 'ms': return val;
    case 's': return val * 1000;
    case 'm': return val * 60_000;
    case 'h': return val * 3_600_000;
    default: return 0;
  }
}

/**
 * Determine if a trace should be captured based on priority rules.
 * Priority rules override the random sampling rate.
 */
export function matchesPriorityRule(trace: AgentTrace, rules: PriorityRule[]): boolean {
  for (const rule of rules) {
    // Error rule: capture if any step has an error-like indicator
    if (rule.error === 'always') {
      const hasError = trace.metadata?.error ||
        trace.steps.some(s => s.data.content?.toLowerCase().includes('error') ||
          s.type === 'tool_result' && s.data.tool_result?.error);
      if (hasError) return true;
    }

    // Cost rule
    if (rule.cost_gt != null) {
      const cost = trace.metadata?.cost ?? 0;
      if (cost > rule.cost_gt) return true;
    }

    // Duration rule
    if (rule.duration_gt) {
      const thresholdMs = parseDurationMs(rule.duration_gt);
      const totalDuration = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
      if (totalDuration > thresholdMs) return true;
    }

    // Tool rule
    if (rule.tool_used) {
      const hasTool = trace.steps.some(s => s.type === 'tool_call' && s.data.tool_name === rule.tool_used);
      if (hasTool) return true;
    }
  }
  return false;
}

/**
 * Create a trace sampler that decides whether to keep each trace.
 */
export function createSampler(config: TraceSamplingConfig): (trace: AgentTrace) => boolean {
  let counter = 0;
  const rng = config.seed != null ? seededRng(config.seed) : Math.random;

  return (trace: AgentTrace): boolean => {
    // Priority rules always override
    if (config.priority_rules?.length && matchesPriorityRule(trace, config.priority_rules)) {
      return true;
    }

    counter++;

    switch (config.strategy) {
      case 'random':
        return rng() < config.rate;

      case 'reservoir':
        // Reservoir sampling: always keep first N, then probabilistically replace
        const capacity = Math.max(1, Math.ceil(counter * config.rate));
        if (counter <= capacity) return true;
        return rng() < capacity / counter;

      case 'priority':
        // Priority strategy: only capture based on rules (already checked above)
        // Fall back to rate-based for non-priority traces
        return rng() < config.rate;

      default:
        return rng() < config.rate;
    }
  };
}

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadTrace(path: string): AgentTrace {
  const raw = fs.readFileSync(path, 'utf-8');
  return JSON.parse(raw) as AgentTrace;
}
