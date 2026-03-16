import type { AgentTrace } from '../types';
import { convertOpenAI } from './openai';
import { convertLangChain } from './langchain';
import { convertAnthropic } from './anthropic';
import { convertGeneric } from './generic';
import { detectOpenClaw, convertOpenClaw } from './openclaw';

export interface TraceAdapter {
  name: string;
  detect(input: any): boolean;
  convert(input: any): AgentTrace;
}

const adapters: TraceAdapter[] = [
  { name: 'openclaw', detect: detectOpenClaw, convert: convertOpenClaw },
  { name: 'openai', detect: detectOpenAI, convert: convertOpenAI },
  { name: 'langchain', detect: detectLangChain, convert: convertLangChain },
  { name: 'anthropic', detect: detectAnthropic, convert: convertAnthropic },
  { name: 'generic', detect: detectGeneric, convert: convertGeneric },
];

function detectOpenAI(input: any): boolean {
  if (Array.isArray(input)) return input.some(i => i?.object === 'chat.completion' || i?.choices);
  return input?.object === 'chat.completion' || !!input?.choices;
}

function detectLangChain(input: any): boolean {
  if (Array.isArray(input)) return input.some(i => i?.type === 'llm' || i?.type === 'chain' || i?.type === 'tool' || i?.serialized);
  return input?.type === 'llm' || input?.type === 'chain' || !!input?.serialized;
}

function detectAnthropic(input: any): boolean {
  if (Array.isArray(input)) return input.some(i => i?.type === 'message' && i?.role === 'assistant' && Array.isArray(i?.content));
  return input?.type === 'message' && input?.role === 'assistant' && Array.isArray(input?.content);
}

function detectGeneric(input: any): boolean {
  if (Array.isArray(input)) return input.some(i => i?.event || i?.level || i?.msg);
  return !!input?.event || !!input?.level || !!input?.msg;
}

/**
 * Auto-detect trace format and convert to AgentTrace.
 */
export function autoConvert(input: any): AgentTrace {
  for (const adapter of adapters) {
    if (adapter.detect(input)) {
      return adapter.convert(input);
    }
  }
  throw new Error('Unable to detect trace format. Supported: openai, langchain, anthropic, generic (JSONL)');
}

/**
 * Convert using a specific adapter by name.
 */
export function convertWith(name: string, input: any): AgentTrace {
  const adapter = adapters.find(a => a.name === name);
  if (!adapter) throw new Error(`Unknown adapter: ${name}. Available: ${adapters.map(a => a.name).join(', ')}`);
  return adapter.convert(input);
}

/**
 * Register a custom adapter (from plugins).
 */
export function registerAdapter(adapter: TraceAdapter): void {
  adapters.push(adapter);
}
