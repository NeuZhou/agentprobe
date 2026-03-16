import type { AgentTrace } from '../types';
import { convertOpenAI } from './openai';

/**
 * Convert OpenAI-compatible API responses to AgentTrace.
 * Works for DeepSeek, Groq, Kimi, and any provider following the OpenAI chat completions format.
 */
export function convertOpenAICompatible(input: any): AgentTrace {
  const trace = convertOpenAI(input);
  // Rebrand metadata source based on model name hints
  const model = trace.metadata?.model ?? '';
  if (model.includes('deepseek')) {
    trace.metadata.source = 'deepseek';
  } else if (model.includes('llama') || model.includes('mixtral') || model.includes('gemma')) {
    trace.metadata.source = 'groq';
  } else if (model.includes('moonshot') || model.includes('kimi')) {
    trace.metadata.source = 'kimi';
  } else {
    trace.metadata.source = 'openai-compatible';
  }
  trace.id = `${trace.metadata.source}-${Date.now()}`;
  return trace;
}

/**
 * Detect OpenAI-compatible format (same as OpenAI detection).
 */
export function detectOpenAICompatible(input: any): boolean {
  if (Array.isArray(input)) return input.some((i) => i?.object === 'chat.completion' || i?.choices);
  return input?.object === 'chat.completion' || !!input?.choices;
}
