import { describe, it, expect } from 'vitest';
import { convertOpenAI } from '../src/adapters/openai';
import { convertAnthropic } from '../src/adapters/anthropic';
import { convertGemini, detectGemini } from '../src/adapters/gemini';
import { convertOllama, detectOllama } from '../src/adapters/ollama';
import { convertOpenAICompatible, detectOpenAICompatible } from '../src/adapters/openai-compatible';
import { convertLangChain } from '../src/adapters/langchain';
import { convertGeneric } from '../src/adapters/generic';
import { detectOpenClaw, convertOpenClaw } from '../src/adapters/openclaw';
import { autoConvert, convertWith, registerAdapter } from '../src/adapters';
import type { AgentTrace } from '../src/types';

// ===== OpenAI Adapter =====

describe('OpenAI Adapter', () => {
  const singleCompletion = {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4',
    choices: [{
      message: {
        content: 'Hello there!',
        tool_calls: [
          { function: { name: 'search', arguments: '{"q":"test"}' } },
        ],
      },
    }],
    usage: { prompt_tokens: 50, completion_tokens: 30 },
  };

  it('converts single completion to AgentTrace', () => {
    const trace = convertOpenAI(singleCompletion);
    expect(trace.id).toMatch(/^openai-/);
    expect(trace.metadata.source).toBe('openai');
    expect(trace.metadata.model).toBe('gpt-4');
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  it('extracts tool calls with parsed arguments', () => {
    const trace = convertOpenAI(singleCompletion);
    const toolSteps = trace.steps.filter(s => s.type === 'tool_call');
    expect(toolSteps).toHaveLength(1);
    expect(toolSteps[0].data.tool_name).toBe('search');
    expect(toolSteps[0].data.tool_args).toEqual({ q: 'test' });
  });

  it('extracts text content as output', () => {
    const trace = convertOpenAI(singleCompletion);
    const outputs = trace.steps.filter(s => s.type === 'output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].data.content).toBe('Hello there!');
  });

  it('handles array of completions', () => {
    const trace = convertOpenAI([singleCompletion, singleCompletion]);
    expect(trace.steps.length).toBe(4); // 2 tool_calls + 2 outputs
  });

  it('handles completion with no tool_calls', () => {
    const simple = {
      object: 'chat.completion',
      model: 'gpt-3.5',
      choices: [{ message: { content: 'just text' } }],
    };
    const trace = convertOpenAI(simple);
    expect(trace.steps.filter(s => s.type === 'tool_call')).toHaveLength(0);
    expect(trace.steps.filter(s => s.type === 'output')).toHaveLength(1);
  });

  it('handles completion with no choices', () => {
    const empty = { object: 'chat.completion', model: 'gpt-4', choices: [] };
    const trace = convertOpenAI(empty);
    expect(trace.steps).toHaveLength(0);
  });

  it('handles invalid JSON in tool arguments', () => {
    const bad = {
      object: 'chat.completion',
      model: 'gpt-4',
      choices: [{
        message: {
          tool_calls: [{ function: { name: 'foo', arguments: 'not json' } }],
        },
      }],
    };
    const trace = convertOpenAI(bad);
    const tc = trace.steps.find(s => s.type === 'tool_call');
    expect(tc!.data.tool_args).toEqual({ raw: 'not json' });
  });

  it('extracts token usage', () => {
    const trace = convertOpenAI(singleCompletion);
    const step = trace.steps[0];
    expect(step.data.tokens).toEqual({ input: 50, output: 30 });
  });
});

// ===== Anthropic Adapter =====

describe('Anthropic Adapter', () => {
  const anthropicMsg = {
    type: 'message',
    role: 'assistant',
    model: 'claude-3-opus',
    content: [
      { type: 'text', text: 'Let me search for that.' },
      { type: 'tool_use', name: 'web_search', input: { query: 'agentprobe' } },
      { type: 'thinking', thinking: 'I need to verify this first.' },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  };

  it('converts anthropic message to AgentTrace', () => {
    const trace = convertAnthropic(anthropicMsg);
    expect(trace.id).toMatch(/^anthropic-/);
    expect(trace.metadata.source).toBe('anthropic');
    expect(trace.metadata.model).toBe('claude-3-opus');
  });

  it('extracts text blocks as output', () => {
    const trace = convertAnthropic(anthropicMsg);
    const outputs = trace.steps.filter(s => s.type === 'output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].data.content).toBe('Let me search for that.');
  });

  it('extracts tool_use blocks as tool_call', () => {
    const trace = convertAnthropic(anthropicMsg);
    const tools = trace.steps.filter(s => s.type === 'tool_call');
    expect(tools).toHaveLength(1);
    expect(tools[0].data.tool_name).toBe('web_search');
    expect(tools[0].data.tool_args).toEqual({ query: 'agentprobe' });
  });

  it('extracts thinking blocks as thought', () => {
    const trace = convertAnthropic(anthropicMsg);
    const thoughts = trace.steps.filter(s => s.type === 'thought');
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0].data.content).toBe('I need to verify this first.');
  });

  it('extracts token usage', () => {
    const trace = convertAnthropic(anthropicMsg);
    const step = trace.steps[0];
    expect(step.data.tokens).toEqual({ input: 100, output: 50 });
  });

  it('handles message with no content array (skips)', () => {
    const noContent = { type: 'message', role: 'assistant', model: 'claude', content: 'string' };
    const trace = convertAnthropic(noContent);
    expect(trace.steps).toHaveLength(0);
  });

  it('handles array of messages', () => {
    const trace = convertAnthropic([anthropicMsg, anthropicMsg]);
    expect(trace.steps.length).toBe(6);
  });

  it('handles empty content array', () => {
    const empty = { type: 'message', role: 'assistant', model: 'claude', content: [] };
    const trace = convertAnthropic(empty);
    expect(trace.steps).toHaveLength(0);
  });
});

// ===== Gemini Adapter =====

describe('Gemini Adapter', () => {
  const geminiResponse = {
    modelVersion: 'gemini-pro',
    candidates: [{
      content: {
        parts: [
          { text: 'Here is the answer.' },
          { functionCall: { name: 'calculator', args: { expr: '2+2' } } },
          { functionResponse: { name: 'calculator', response: { result: 4 } } },
        ],
      },
    }],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 },
  };

  it('detects Gemini format', () => {
    expect(detectGemini(geminiResponse)).toBe(true);
    expect(detectGemini([geminiResponse])).toBe(true);
    expect(detectGemini({ choices: [] })).toBe(false);
    expect(detectGemini(null)).toBe(false);
  });

  it('converts to AgentTrace', () => {
    const trace = convertGemini(geminiResponse);
    expect(trace.id).toMatch(/^gemini-/);
    expect(trace.metadata.source).toBe('gemini');
  });

  it('extracts text parts as output', () => {
    const trace = convertGemini(geminiResponse);
    const outputs = trace.steps.filter(s => s.type === 'output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].data.content).toBe('Here is the answer.');
  });

  it('extracts functionCall as tool_call', () => {
    const trace = convertGemini(geminiResponse);
    const tools = trace.steps.filter(s => s.type === 'tool_call');
    expect(tools).toHaveLength(1);
    expect(tools[0].data.tool_name).toBe('calculator');
    expect(tools[0].data.tool_args).toEqual({ expr: '2+2' });
  });

  it('extracts functionResponse as tool_result', () => {
    const trace = convertGemini(geminiResponse);
    const results = trace.steps.filter(s => s.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0].data.tool_result).toEqual({ result: 4 });
  });

  it('extracts token usage', () => {
    const trace = convertGemini(geminiResponse);
    const step = trace.steps.find(s => s.data.tokens);
    expect(step!.data.tokens).toEqual({ input: 40, output: 20 });
  });

  it('handles response with no candidates', () => {
    const empty = { modelVersion: 'gemini', candidates: [] };
    const trace = convertGemini(empty);
    expect(trace.steps).toHaveLength(0);
  });

  it('handles response with missing parts', () => {
    const noParts = { candidates: [{ content: {} }] };
    const trace = convertGemini(noParts);
    expect(trace.steps).toHaveLength(0);
  });
});

// ===== Ollama Adapter =====

describe('Ollama Adapter', () => {
  const ollamaResponse = {
    model: 'llama3',
    created_at: '2026-01-01T00:00:00Z',
    done: true,
    message: {
      content: 'Hello from Ollama',
      tool_calls: [
        { function: { name: 'read', arguments: { path: '/tmp' } } },
      ],
    },
    prompt_eval_count: 20,
    eval_count: 15,
  };

  it('detects Ollama format', () => {
    expect(detectOllama(ollamaResponse)).toBe(true);
    expect(detectOllama([ollamaResponse])).toBe(true);
    expect(detectOllama({ choices: [] })).toBe(false);
    expect(detectOllama(null)).toBe(false);
  });

  it('converts to AgentTrace', () => {
    const trace = convertOllama(ollamaResponse);
    expect(trace.id).toMatch(/^ollama-/);
    expect(trace.metadata.source).toBe('ollama');
    expect(trace.metadata.model).toBe('llama3');
  });

  it('extracts tool_calls', () => {
    const trace = convertOllama(ollamaResponse);
    const tools = trace.steps.filter(s => s.type === 'tool_call');
    expect(tools).toHaveLength(1);
    expect(tools[0].data.tool_name).toBe('read');
  });

  it('extracts text content', () => {
    const trace = convertOllama(ollamaResponse);
    const outputs = trace.steps.filter(s => s.type === 'output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].data.content).toBe('Hello from Ollama');
  });

  it('extracts token usage', () => {
    const trace = convertOllama(ollamaResponse);
    const step = trace.steps.find(s => s.data.tokens);
    expect(step!.data.tokens).toEqual({ input: 20, output: 15 });
  });

  it('handles response with no message (skips)', () => {
    const noMsg = { model: 'llama3', done: true };
    const trace = convertOllama(noMsg);
    expect(trace.steps).toHaveLength(0);
  });

  it('handles content-only response (no tools)', () => {
    const simple = { model: 'llama3', done: true, message: { content: 'just text' } };
    const trace = convertOllama(simple);
    expect(trace.steps.filter(s => s.type === 'tool_call')).toHaveLength(0);
    expect(trace.steps.filter(s => s.type === 'output')).toHaveLength(1);
  });
});

// ===== OpenAI-Compatible Adapter =====

describe('OpenAI-Compatible Adapter', () => {
  it('detects same format as OpenAI', () => {
    expect(detectOpenAICompatible({ object: 'chat.completion' })).toBe(true);
    expect(detectOpenAICompatible({ choices: [{}] })).toBe(true);
    expect(detectOpenAICompatible({ candidates: [] })).toBe(false);
  });

  it('rebrands source based on model name', () => {
    const deepseek = {
      object: 'chat.completion',
      model: 'deepseek-v2',
      choices: [{ message: { content: 'hi' } }],
    };
    const trace = convertOpenAICompatible(deepseek);
    expect(trace.metadata.source).toBe('deepseek');
  });

  it('detects groq models', () => {
    const groq = {
      object: 'chat.completion',
      model: 'llama-3-70b',
      choices: [{ message: { content: 'hi' } }],
    };
    const trace = convertOpenAICompatible(groq);
    expect(trace.metadata.source).toBe('groq');
  });

  it('detects kimi/moonshot models', () => {
    const kimi = {
      object: 'chat.completion',
      model: 'moonshot-v1',
      choices: [{ message: { content: 'hi' } }],
    };
    const trace = convertOpenAICompatible(kimi);
    expect(trace.metadata.source).toBe('kimi');
  });

  it('defaults to openai-compatible for unknown models', () => {
    const unknown = {
      object: 'chat.completion',
      model: 'some-custom-model',
      choices: [{ message: { content: 'hi' } }],
    };
    const trace = convertOpenAICompatible(unknown);
    expect(trace.metadata.source).toBe('openai-compatible');
  });
});

// ===== LangChain Adapter =====

describe('LangChain Adapter', () => {
  it('converts LLM runs', () => {
    const run = {
      type: 'llm',
      name: 'ChatOpenAI',
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-01-01T00:00:02Z',
      outputs: { generations: [[{ text: 'Generated text' }]] },
      serialized: { kwargs: { model_name: 'gpt-4' } },
    };
    const trace = convertLangChain(run);
    expect(trace.metadata.source).toBe('langchain');
    const llm = trace.steps.find(s => s.type === 'llm_call');
    expect(llm).toBeDefined();
    expect(llm!.data.model).toBe('gpt-4');
    expect(llm!.duration_ms).toBe(2000);
  });

  it('converts tool runs', () => {
    const run = {
      type: 'tool',
      name: 'calculator',
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-01-01T00:00:01Z',
      inputs: { expression: '2+2' },
      outputs: { output: '4' },
    };
    const trace = convertLangChain(run);
    const toolCall = trace.steps.find(s => s.type === 'tool_call');
    expect(toolCall!.data.tool_name).toBe('calculator');
    const toolResult = trace.steps.find(s => s.type === 'tool_result');
    expect(toolResult!.data.tool_result).toBe('4');
  });

  it('converts chain runs with output', () => {
    const run = {
      type: 'chain',
      name: 'MyChain',
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-01-01T00:00:03Z',
      outputs: { output: 'chain result' },
    };
    const trace = convertLangChain(run);
    const output = trace.steps.find(s => s.type === 'output');
    expect(output!.data.content).toBe('chain result');
  });

  it('handles child_runs recursively', () => {
    const run = {
      type: 'chain',
      name: 'Parent',
      child_runs: [
        { type: 'llm', name: 'Child', outputs: {} },
        { type: 'tool', name: 'ChildTool', inputs: {}, outputs: { output: 'done' } },
      ],
    };
    const trace = convertLangChain(run);
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  it('handles empty runs', () => {
    const trace = convertLangChain([]);
    expect(trace.steps).toHaveLength(0);
  });
});

// ===== Generic Adapter =====

describe('Generic Adapter', () => {
  it('converts array of log entries', () => {
    const entries = [
      { event: 'tool_call', tool: 'search', args: { q: 'test' }, timestamp: '2026-01-01T00:00:00Z' },
      { event: 'output', content: 'Result found', timestamp: '2026-01-01T00:00:01Z' },
    ];
    const trace = convertGeneric(entries);
    expect(trace.metadata.source).toBe('generic');
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0].type).toBe('tool_call');
    expect(trace.steps[1].type).toBe('output');
  });

  it('converts JSONL string', () => {
    const jsonl = `{"event":"llm_call","model":"gpt-4"}\n{"event":"output","content":"done"}`;
    const trace = convertGeneric(jsonl);
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0].type).toBe('llm_call');
  });

  it('handles numeric timestamps', () => {
    const entries = [{ event: 'output', ts: 1700000000000, content: 'test' }];
    const trace = convertGeneric(entries);
    expect(trace.steps[0].timestamp).toMatch(/^\d{4}-/);
  });

  it('maps event types correctly', () => {
    const entries = [
      { event: 'tool_call' },
      { event: 'tool_result' },
      { event: 'llm_completion' },
      { event: 'thinking' },
      { event: 'response' },
      { event: 'something_else' },
    ];
    const trace = convertGeneric(entries);
    expect(trace.steps[0].type).toBe('tool_call');
    expect(trace.steps[1].type).toBe('tool_result');
    expect(trace.steps[2].type).toBe('llm_call');
    expect(trace.steps[3].type).toBe('thought');
    expect(trace.steps[4].type).toBe('output');
    expect(trace.steps[5].type).toBe('output'); // fallback
  });

  it('handles invalid JSONL lines (skips bad lines)', () => {
    const jsonl = `{"event":"output","content":"good"}\nnot json\n{"event":"tool_call"}`;
    const trace = convertGeneric(jsonl);
    expect(trace.steps).toHaveLength(2);
  });

  it('handles single entry (not array)', () => {
    const entry = { event: 'output', content: 'single' };
    const trace = convertGeneric(entry);
    expect(trace.steps).toHaveLength(1);
  });
});

// ===== OpenClaw Adapter =====

describe('OpenClaw Adapter', () => {
  const openclawSession = {
    session_id: 'sess-123',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Searching...',
        tool_calls: [
          { id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{"q":"hello"}' } },
        ],
        model: 'claude-3',
        tokens: { input: 50, output: 20 },
      },
      { role: 'tool', name: 'search', content: 'search result' },
      { role: 'assistant', content: 'Here is what I found.' },
    ],
    created_at: '2026-01-01T00:00:00Z',
  };

  it('detects OpenClaw sessions', () => {
    expect(detectOpenClaw(openclawSession)).toBe(true);
    expect(detectOpenClaw({ choices: [] })).toBe(false);
    expect(detectOpenClaw(null)).toBe(false);
    expect(detectOpenClaw('string')).toBe(false);
  });

  it('converts to AgentTrace', () => {
    const trace = convertOpenClaw(openclawSession);
    expect(trace.id).toBe('sess-123');
    expect(trace.metadata.source).toBe('openclaw');
  });

  it('skips system messages', () => {
    const trace = convertOpenClaw(openclawSession);
    const systemSteps = trace.steps.filter(s => s.data.content === 'You are helpful.');
    expect(systemSteps).toHaveLength(0);
  });

  it('converts user messages to output', () => {
    const trace = convertOpenClaw(openclawSession);
    const userOutputs = trace.steps.filter(s => s.data.content === 'Hello');
    expect(userOutputs).toHaveLength(1);
    expect(userOutputs[0].type).toBe('output');
  });

  it('extracts tool calls from assistant messages', () => {
    const trace = convertOpenClaw(openclawSession);
    const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].data.tool_name).toBe('search');
    expect(toolCalls[0].data.tool_args).toEqual({ q: 'hello' });
  });

  it('extracts tool results', () => {
    const trace = convertOpenClaw(openclawSession);
    const toolResults = trace.steps.filter(s => s.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].data.tool_result).toBe('search result');
  });

  it('handles invalid JSON in tool arguments', () => {
    const session = {
      session_id: 'x',
      messages: [{
        role: 'assistant',
        tool_calls: [{ id: 'tc', type: 'function', function: { name: 'foo', arguments: 'not json' } }],
      }],
    };
    const trace = convertOpenClaw(session);
    const tc = trace.steps.find(s => s.type === 'tool_call');
    expect(tc!.data.tool_args).toEqual({ _raw: 'not json' });
  });

  it('handles assistant with no content and no tool_calls (llm_call)', () => {
    const session = {
      session_id: 'x',
      messages: [{ role: 'assistant', model: 'gpt-4' }],
    };
    const trace = convertOpenClaw(session);
    const llm = trace.steps.find(s => s.type === 'llm_call');
    expect(llm).toBeDefined();
  });

  it('uses history as fallback for messages', () => {
    const session = {
      session_id: 'x',
      history: [{ role: 'user', content: 'via history' }],
    };
    const trace = convertOpenClaw(session);
    expect(trace.steps[0].data.content).toBe('via history');
  });
});

// ===== autoConvert & convertWith =====

describe('autoConvert', () => {
  it('detects OpenAI format', () => {
    const trace = autoConvert({ object: 'chat.completion', model: 'gpt-4', choices: [{ message: { content: 'hi' } }] });
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  it('detects Gemini format', () => {
    const trace = autoConvert({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] });
    expect(trace.metadata.source).toBe('gemini');
  });

  it('detects Ollama format', () => {
    const trace = autoConvert({ model: 'llama3', message: { content: 'hi' }, done: true });
    expect(trace.metadata.source).toBe('ollama');
  });

  it('throws for unrecognized format', () => {
    expect(() => autoConvert({ random: 'data', unrecognizable: true })).toThrow('Unable to detect');
  });
});

describe('convertWith', () => {
  it('converts with named adapter', () => {
    const trace = convertWith('openai', { object: 'chat.completion', model: 'gpt-4', choices: [] });
    expect(trace.metadata.source).toBe('openai');
  });

  it('throws for unknown adapter name', () => {
    expect(() => convertWith('nonexistent', {})).toThrow('Unknown adapter');
  });
});

describe('registerAdapter', () => {
  it('registers and uses a custom adapter', () => {
    registerAdapter({
      name: 'custom-test',
      detect: (input: any) => input?.customFormat === true,
      convert: (input: any): AgentTrace => ({
        id: 'custom-test',
        timestamp: new Date().toISOString(),
        steps: [{ type: 'output', timestamp: '', data: { content: input.data } }],
        metadata: { source: 'custom-test' },
      }),
    });
    const trace = autoConvert({ customFormat: true, data: 'hello' });
    expect(trace.metadata.source).toBe('custom-test');
    expect(trace.steps[0].data.content).toBe('hello');
  });
});

// ===== Edge Cases: Empty / Corrupted Input =====

describe('Adapter Edge Cases', () => {
  it('OpenAI: empty choices array', () => {
    const trace = convertOpenAI({ choices: [] });
    expect(trace.steps).toHaveLength(0);
  });

  it('Anthropic: empty content blocks', () => {
    const trace = convertAnthropic({ type: 'message', role: 'assistant', content: [] });
    expect(trace.steps).toHaveLength(0);
  });

  it('Gemini: empty candidates', () => {
    const trace = convertGemini({ candidates: [] });
    expect(trace.steps).toHaveLength(0);
  });

  it('Ollama: array of responses', () => {
    const trace = convertOllama([
      { model: 'llama3', done: true, message: { content: 'a' } },
      { model: 'llama3', done: true, message: { content: 'b' } },
    ]);
    expect(trace.steps).toHaveLength(2);
  });

  it('OpenClaw: empty messages', () => {
    const trace = convertOpenClaw({ session_id: 'x', messages: [] });
    expect(trace.steps).toHaveLength(0);
  });
});
