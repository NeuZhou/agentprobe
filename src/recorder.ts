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

  /**
   * Monkey-patch Google Gemini SDK (generativelanguage API) to record calls.
   */
  patchGemini(geminiModule: any): void {
    const recorder = this;
    const GenerativeModel = geminiModule?.GenerativeModel?.prototype
      ?? geminiModule?.GoogleGenerativeAI?.prototype;

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
    const ClientProto = azureModule?.AzureOpenAI?.prototype
      ?? azureModule?.OpenAIClient?.prototype;

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

export function loadTrace(path: string): AgentTrace {
  const raw = fs.readFileSync(path, 'utf-8');
  return JSON.parse(raw) as AgentTrace;
}
