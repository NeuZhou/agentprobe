import type { AgentTrace, TraceStep, StepType } from './types';

export interface SimulatorOptions {
  agent: string;
  steps: number;
  tools?: string[];
  seed?: number;
  includeErrors?: boolean;
}

export interface SimulatedTrace extends AgentTrace {
  metadata: {
    simulated: true;
    agent: string;
    seed: number;
    [key: string]: any;
  };
}

// Simple seeded PRNG
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

const DEFAULT_TOOLS = ['search', 'calculate', 'summarize', 'fetch', 'analyze'];

const SAMPLE_QUERIES: Record<string, string[]> = {
  research: ['Find recent papers on transformers', 'Summarize the key findings', 'Compare methodologies'],
  coding: ['Read the source file', 'Find the bug', 'Write a fix', 'Run the tests'],
  weather: ['Get current weather', 'Check forecast', 'Compare temperatures'],
  default: ['Process the input', 'Analyze results', 'Generate output'],
};

const SAMPLE_OUTPUTS: Record<string, string[]> = {
  research: ['Found 5 relevant papers', 'Key findings include improved attention mechanisms', 'The comparison shows method A outperforms B'],
  coding: ['File contains 200 lines', 'Bug found on line 42: off-by-one error', 'Fix applied successfully', 'All tests pass'],
  weather: ['Current temperature: 22°C, partly cloudy', '5-day forecast shows warming trend', 'Tokyo is 5°C warmer than London'],
  default: ['Processing complete', 'Analysis shows positive results', 'Output generated successfully'],
};

/**
 * Generate a synthetic agent trace without calling any LLM.
 */
export function simulateTrace(options: SimulatorOptions): SimulatedTrace {
  const seed = options.seed ?? Date.now();
  const rand = seededRandom(seed);
  const tools = options.tools ?? DEFAULT_TOOLS;
  const queries = SAMPLE_QUERIES[options.agent] ?? SAMPLE_QUERIES.default;
  const outputs = SAMPLE_OUTPUTS[options.agent] ?? SAMPLE_OUTPUTS.default;

  const baseTime = new Date('2025-01-01T12:00:00Z');
  let timeOffset = 0;
  const steps: TraceStep[] = [];

  for (let i = 0; i < options.steps; i++) {
    const stepTypes: StepType[] = [];

    // Pattern: thought → llm_call → tool_call → tool_result → output
    if (i === 0) {
      stepTypes.push('thought', 'llm_call', 'tool_call', 'tool_result');
    } else if (i === options.steps - 1) {
      stepTypes.push('llm_call', 'output');
    } else {
      stepTypes.push('llm_call', 'tool_call', 'tool_result');
    }

    for (const type of stepTypes) {
      timeOffset += Math.floor(rand() * 2000) + 100;
      const ts = new Date(baseTime.getTime() + timeOffset).toISOString();
      const duration = Math.floor(rand() * 1000) + 50;

      const step: TraceStep = {
        type,
        timestamp: ts,
        data: {},
        duration_ms: duration,
      };

      switch (type) {
        case 'thought':
          step.data.content = `Planning step ${i + 1}: ${queries[i % queries.length]}`;
          break;
        case 'llm_call': {
          const inputTokens = Math.floor(rand() * 500) + 100;
          const outputTokens = Math.floor(rand() * 300) + 50;
          step.data.model = 'gpt-4';
          step.data.tokens = { input: inputTokens, output: outputTokens };
          break;
        }
        case 'tool_call': {
          const tool = tools[Math.floor(rand() * tools.length)];
          step.data.tool_name = tool;
          step.data.tool_args = { query: queries[i % queries.length] };
          if (options.includeErrors && rand() < 0.1) {
            step.data.tool_args._simulate_error = true;
          }
          break;
        }
        case 'tool_result':
          step.data.tool_result = outputs[i % outputs.length];
          if (options.includeErrors && rand() < 0.1) {
            step.data.tool_result = { error: 'Simulated timeout', code: 'TIMEOUT' };
          }
          break;
        case 'output':
          step.data.content = outputs[i % outputs.length];
          break;
      }

      steps.push(step);
    }
  }

  return {
    id: `sim-${options.agent}-${seed}`,
    timestamp: baseTime.toISOString(),
    steps,
    metadata: {
      simulated: true,
      agent: options.agent,
      seed,
      tools_available: tools,
      steps_requested: options.steps,
    },
  };
}

/**
 * Generate multiple synthetic traces with variation.
 */
export function simulateBatch(options: SimulatorOptions, count: number): SimulatedTrace[] {
  const baseSeed = options.seed ?? Date.now();
  return Array.from({ length: count }, (_, i) =>
    simulateTrace({ ...options, seed: baseSeed + i })
  );
}
