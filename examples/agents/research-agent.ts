/**
 * Multi-tool Research Agent using Ollama (qwen2.5:7b)
 *
 * Demonstrates a complex agent with 4 tools:
 * - web_search(query) → mock search results
 * - read_url(url) → mock page content
 * - save_note(content) → mock saves findings
 * - calculate(expr) → actually evaluates math
 *
 * Usage:
 *   npx ts-node examples/agents/research-agent.ts "Research Tokyo population"
 *   npx ts-node examples/agents/research-agent.ts --record "Research Tokyo population"
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
      name: 'web_search',
      description: 'Search the web for information. Returns a list of search results with titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_url',
      description: 'Read the content of a web page given its URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to read' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_note',
      description: 'Save research findings as a note for later reference.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Note content to save' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Evaluate a math expression and return the numeric result.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'A math expression like "14000000 / 2194"' },
        },
        required: ['expression'],
      },
    },
  },
];

// --- Mock tool implementations ---
function webSearch(query: string): string {
  // Mock search results about Tokyo
  if (query.toLowerCase().includes('tokyo') && query.toLowerCase().includes('population')) {
    return JSON.stringify([
      {
        title: 'Tokyo Population 2026 - World Population Review',
        url: 'https://worldpopulationreview.com/cities/tokyo',
        snippet: 'Tokyo has a population of approximately 13,960,000 in the city proper and 37,400,000 in the greater metropolitan area.',
      },
      {
        title: 'Tokyo Demographics - Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Tokyo',
        snippet: 'As of 2025, Tokyo city proper has 13.96 million residents with an area of 2,194 km².',
      },
    ]);
  }
  return JSON.stringify([
    { title: 'No relevant results', url: 'https://example.com', snippet: 'Try a different query.' },
  ]);
}

function readUrl(url: string): string {
  if (url.includes('worldpopulationreview') || url.includes('tokyo')) {
    return 'Tokyo Population Data:\n\nTokyo, the capital of Japan, has a population of approximately 13,960,000 (13.96 million) in the city proper as of 2025. The greater Tokyo metropolitan area has about 37.4 million residents, making it the most populous metropolitan area in the world.\n\nArea: 2,194 km² (city proper)\nPopulation density: approximately 6,363 people per km²';
  }
  return 'Page content not available.';
}

const savedNotes: string[] = [];
function saveNote(content: string): string {
  savedNotes.push(content);
  return `Note saved successfully. Total notes: ${savedNotes.length}`;
}

function calculate(expression: string): string {
  try {
    const sanitized = expression.replace(/[^0-9+\-*/().%\s,]/g, '');
    if (!sanitized.trim()) return 'Error: invalid expression';
    const result = Function(`"use strict"; return (${sanitized})`)();
    return String(result);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'web_search': return webSearch(args.query ?? '');
    case 'read_url': return readUrl(args.url ?? '');
    case 'save_note': return saveNote(args.content ?? '');
    case 'calculate': return calculate(args.expression ?? '');
    default: return `Error: unknown tool "${name}"`;
  }
}

// --- Agent loop ---
export async function runAgent(input: string, recorder?: Recorder, maxSteps = 15): Promise<string> {
  const systemPrompt = 'You are a research assistant. Use web_search to find information, read_url to get page details, calculate for math, and save_note to record your findings. Be thorough and precise with numbers.';

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const start = Date.now();
    const response = await client.chat.completions.create({
      model: 'qwen2.5:7b',
      messages,
      tools,
    });
    const duration = Date.now() - start;

    const choice = response.choices[0];
    if (!choice?.message) break;

    if (recorder) {
      recorder.addStep({
        type: 'llm_call',
        data: {
          model: 'qwen2.5:7b',
          tokens: {
            input: response.usage?.prompt_tokens,
            output: response.usage?.completion_tokens,
          },
        },
        duration_ms: duration,
      });
    }

    messages.push(choice.message as ChatCompletionMessageParam);

    if (!choice.message.tool_calls?.length) {
      const content = choice.message.content ?? '(no response)';
      if (recorder) {
        recorder.addStep({
          type: 'output',
          data: { content },
        });
      }
      return content;
    }

    for (const tc of choice.message.tool_calls) {
      const fn = (tc as any).function;
      let args: Record<string, any>;
      try {
        args = JSON.parse(fn.arguments || '{}');
      } catch {
        args = {};
      }

      if (recorder) {
        recorder.addStep({
          type: 'tool_call',
          data: { tool_name: fn.name, tool_args: args },
        });
      }

      const result = executeTool(fn.name, args);

      if (recorder) {
        recorder.addStep({
          type: 'tool_result',
          data: { tool_name: fn.name, tool_result: result },
        });
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  const fallback = '(max steps reached)';
  if (recorder) {
    recorder.addStep({ type: 'output', data: { content: fallback } });
  }
  return fallback;
}

// --- CLI entry point ---
async function main() {
  const args = process.argv.slice(2);
  const shouldRecord = args.includes('--record');
  const question = args.filter(a => a !== '--record').join(' ')
    || 'Research the population of Tokyo and calculate the population density given an area of 2,194 km²';

  const recorder = shouldRecord
    ? new Recorder({ agent: 'research-agent', question })
    : undefined;

  console.log(`🔬 Research Agent`);
  console.log(`📋 Task: ${question}\n`);

  const answer = await runAgent(question, recorder);
  console.log(`\n📝 Result:\n${answer}`);

  if (recorder) {
    const tracePath = path.join(__dirname, '..', 'traces', 'e2e-research.json');
    recorder.save(tracePath);
    console.log(`\n💾 Trace saved to: ${tracePath}`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
