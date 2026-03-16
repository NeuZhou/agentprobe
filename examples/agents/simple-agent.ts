/**
 * Simple Calculator Agent using Ollama (qwen2.5:7b)
 *
 * This agent demonstrates a minimal tool-calling loop:
 * 1. Send user question to LLM with tool definitions
 * 2. If LLM requests a tool call, execute it and feed result back
 * 3. Repeat until LLM produces a final text answer
 *
 * Usage:
 *   npx ts-node examples/agents/simple-agent.ts "What is 42 * 17?"
 *   npx ts-node examples/agents/simple-agent.ts --record "What is 123 + 456?"
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { Recorder } from '../../src/recorder';
import * as path from 'path';

// --- Ollama OpenAI-compatible client ---
const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
});

// --- Tool definitions ---
const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Evaluate a math expression and return the numeric result',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'A math expression like "42 * 17"' },
        },
        required: ['expression'],
      },
    },
  },
];

// --- Tool implementation ---
function calculate(expression: string): string {
  try {
    // Safe-ish eval for simple math (no arbitrary code)
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
    if (!sanitized.trim()) return 'Error: invalid expression';
    const result = Function(`"use strict"; return (${sanitized})`)();
    return String(result);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

function executeTool(name: string, args: Record<string, any>): string {
  if (name === 'calculate') return calculate(args.expression ?? '');
  return `Error: unknown tool "${name}"`;
}

// --- Agent loop ---
export async function runAgent(input: string, maxSteps = 10): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant. Use the calculate tool for any math. Be concise.',
    },
    { role: 'user', content: input },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const response = await client.chat.completions.create({
      model: 'qwen2.5:7b',
      messages,
      tools,
    });

    const choice = response.choices[0];
    if (!choice?.message) break;

    messages.push(choice.message as ChatCompletionMessageParam);

    // If no tool calls, we have the final answer
    if (!choice.message.tool_calls?.length) {
      return choice.message.content ?? '(no response)';
    }

    // Execute each tool call
    for (const tc of choice.message.tool_calls) {
      const fn = (tc as any).function;
      const args = JSON.parse(fn.arguments || '{}');
      const result = executeTool(fn.name, args);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return '(max steps reached)';
}

// --- CLI entry point ---
async function main() {
  const args = process.argv.slice(2);
  const shouldRecord = args.includes('--record');
  const question = args.filter(a => a !== '--record').join(' ') || 'What is 42 * 17?';

  let recorder: Recorder | undefined;

  if (shouldRecord) {
    recorder = new Recorder({ agent: 'simple-calculator', question });
    // Patch OpenAI at the prototype level
    const openaiModule = require('openai');
    recorder.patchOpenAI(openaiModule);
  }

  console.log(`🤖 Question: ${question}`);
  const answer = await runAgent(question);
  console.log(`💡 Answer: ${answer}`);

  if (recorder) {
    const tracePath = path.join(__dirname, '..', 'traces', 'e2e-calculator.json');
    recorder.save(tracePath);
    console.log(`📝 Trace saved to: ${tracePath}`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
