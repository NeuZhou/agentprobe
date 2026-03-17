import { describe, test, expect } from 'vitest';
import { convertCrewAI, detectCrewAI } from '../src/adapters/crewai';
import { convertAutoGen, detectAutoGen } from '../src/adapters/autogen';
import { convertMCP, detectMCP } from '../src/adapters/mcp';
import { autoConvert, convertWith } from '../src/adapters';

// ===== Mock Data =====

const mockCrewAITrace = {
  crew_id: 'crew-123',
  created_at: '2026-03-17T08:00:00Z',
  tasks: [
    {
      task_id: 'task-1',
      agent: 'researcher',
      started_at: '2026-03-17T08:00:01Z',
      finished_at: '2026-03-17T08:00:05Z',
      llm_calls: [
        {
          model: 'gpt-4',
          prompt: 'Research topic X',
          response: 'Here are my findings...',
          tokens: { input: 100, output: 200 },
        },
      ],
      tools_used: [
        { name: 'web_search', input: { query: 'topic X' }, output: 'search results...' },
      ],
      output: 'Research complete: topic X is...',
    },
    {
      task_id: 'task-2',
      agent: 'writer',
      started_at: '2026-03-17T08:00:06Z',
      error: 'Token limit exceeded',
    },
  ],
  metadata: { version: '0.1.0' },
};

const mockAutoGenTrace = {
  session_id: 'session-456',
  created_at: '2026-03-17T09:00:00Z',
  messages: [
    {
      sender: 'user_proxy',
      content: 'Solve this math problem',
      timestamp: '2026-03-17T09:00:01Z',
    },
    {
      sender: 'assistant',
      role: 'assistant',
      content: 'Let me use a tool to solve this.',
      model: 'gpt-4',
      usage: { prompt_tokens: 50, completion_tokens: 30 },
      tool_calls: [
        { id: 'tc-1', function: { name: 'calculator', arguments: '{"expression":"2+2"}' } },
      ],
      timestamp: '2026-03-17T09:00:02Z',
    },
    {
      sender: 'user_proxy',
      tool_responses: [{ tool_call_id: 'tc-1', content: '4' }],
      timestamp: '2026-03-17T09:00:03Z',
    },
    {
      sender: 'assistant',
      role: 'assistant',
      content: 'The answer is 4.',
      model: 'gpt-4',
      usage: { prompt_tokens: 80, completion_tokens: 10 },
      timestamp: '2026-03-17T09:00:04Z',
    },
  ],
};

const mockMCPTrace = {
  session_id: 'mcp-789',
  created_at: '2026-03-17T10:00:00Z',
  server: { name: 'my-mcp-server', version: '1.0.0' },
  events: [
    {
      type: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/tmp/data.txt' } },
      timestamp: '2026-03-17T10:00:01Z',
      duration_ms: 50,
    },
    {
      type: 'tools/result',
      params: { name: 'read_file' },
      result: { content: 'file contents here' },
      timestamp: '2026-03-17T10:00:02Z',
      duration_ms: 5,
    },
    {
      type: 'resources/read',
      params: { uri: 'file:///config.json' },
      timestamp: '2026-03-17T10:00:03Z',
    },
    {
      type: 'resources/result',
      result: { contents: [{ text: '{"key":"value"}' }] },
      timestamp: '2026-03-17T10:00:04Z',
    },
    {
      type: 'completion',
      model: 'claude-3',
      result: 'Based on the file, here is my analysis...',
      tokens: { input: 150, output: 80 },
      timestamp: '2026-03-17T10:00:05Z',
      duration_ms: 2000,
    },
    {
      type: 'error',
      error: { code: -32600, message: 'Invalid request' },
      timestamp: '2026-03-17T10:00:06Z',
    },
  ],
};

// ===== CrewAI Tests =====

describe('CrewAI Adapter', () => {
  test('detectCrewAI returns true for CrewAI traces', () => {
    expect(detectCrewAI(mockCrewAITrace)).toBe(true);
  });

  test('detectCrewAI returns false for non-CrewAI data', () => {
    expect(detectCrewAI({ messages: [] })).toBe(false);
    expect(detectCrewAI({ choices: [] })).toBe(false);
    expect(detectCrewAI(null)).toBe(false);
  });

  test('detectCrewAI works with arrays', () => {
    expect(detectCrewAI([mockCrewAITrace])).toBe(true);
    expect(detectCrewAI([{ foo: 'bar' }])).toBe(false);
  });

  test('convertCrewAI produces valid AgentTrace', () => {
    const trace = convertCrewAI(mockCrewAITrace);
    expect(trace.id).toMatch(/^crewai-/);
    expect(trace.metadata.source).toBe('crewai');
    expect(trace.metadata.crew_id).toBe('crew-123');
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  test('convertCrewAI extracts LLM calls', () => {
    const trace = convertCrewAI(mockCrewAITrace);
    const llmSteps = trace.steps.filter((s) => s.type === 'llm_call');
    expect(llmSteps).toHaveLength(1);
    expect(llmSteps[0].data.model).toBe('gpt-4');
    expect(llmSteps[0].data.tokens).toEqual({ input: 100, output: 200 });
  });

  test('convertCrewAI extracts tool calls and results', () => {
    const trace = convertCrewAI(mockCrewAITrace);
    const toolCalls = trace.steps.filter((s) => s.type === 'tool_call');
    const toolResults = trace.steps.filter((s) => s.type === 'tool_result');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].data.tool_name).toBe('web_search');
    expect(toolResults).toHaveLength(1);
  });

  test('convertCrewAI handles task errors', () => {
    const trace = convertCrewAI(mockCrewAITrace);
    const errorSteps = trace.steps.filter((s) => s.data.content?.includes('Error:'));
    expect(errorSteps).toHaveLength(1);
    expect(errorSteps[0].data.content).toContain('Token limit exceeded');
  });

  test('convertCrewAI computes duration', () => {
    const trace = convertCrewAI(mockCrewAITrace);
    const outputs = trace.steps.filter((s) => s.type === 'output' && s.duration_ms);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].duration_ms).toBe(4000);
  });
});

// ===== AutoGen Tests =====

describe('AutoGen Adapter', () => {
  test('detectAutoGen returns true for AutoGen traces', () => {
    expect(detectAutoGen(mockAutoGenTrace)).toBe(true);
  });

  test('detectAutoGen returns false for non-AutoGen data', () => {
    expect(detectAutoGen({ tasks: [] })).toBe(false);
    expect(detectAutoGen({ candidates: [] })).toBe(false);
    expect(detectAutoGen(null)).toBe(false);
  });

  test('detectAutoGen works with arrays', () => {
    expect(detectAutoGen([mockAutoGenTrace])).toBe(true);
  });

  test('convertAutoGen produces valid AgentTrace', () => {
    const trace = convertAutoGen(mockAutoGenTrace);
    expect(trace.id).toMatch(/^autogen-/);
    expect(trace.metadata.source).toBe('autogen');
    expect(trace.metadata.session_id).toBe('session-456');
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  test('convertAutoGen extracts tool calls', () => {
    const trace = convertAutoGen(mockAutoGenTrace);
    const toolCalls = trace.steps.filter((s) => s.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].data.tool_name).toBe('calculator');
    expect(toolCalls[0].data.tool_args).toEqual({ expression: '2+2' });
  });

  test('convertAutoGen extracts tool responses', () => {
    const trace = convertAutoGen(mockAutoGenTrace);
    const toolResults = trace.steps.filter((s) => s.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].data.tool_result).toBe('4');
  });

  test('convertAutoGen extracts LLM calls with tokens', () => {
    const trace = convertAutoGen(mockAutoGenTrace);
    const llmSteps = trace.steps.filter((s) => s.type === 'llm_call');
    expect(llmSteps).toHaveLength(2);
    expect(llmSteps[0].data.tokens).toEqual({ input: 50, output: 30 });
  });

  test('convertAutoGen handles user messages as output', () => {
    const trace = convertAutoGen(mockAutoGenTrace);
    const outputs = trace.steps.filter((s) => s.type === 'output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].data.content).toBe('Solve this math problem');
  });
});

// ===== MCP Tests =====

describe('MCP Adapter', () => {
  test('detectMCP returns true for MCP traces', () => {
    expect(detectMCP(mockMCPTrace)).toBe(true);
  });

  test('detectMCP returns false for non-MCP data', () => {
    expect(detectMCP({ tasks: [] })).toBe(false);
    expect(detectMCP({ messages: [{ sender: 'a' }] })).toBe(false);
    expect(detectMCP(null)).toBe(false);
  });

  test('detectMCP works with arrays', () => {
    expect(detectMCP([mockMCPTrace])).toBe(true);
  });

  test('convertMCP produces valid AgentTrace', () => {
    const trace = convertMCP(mockMCPTrace);
    expect(trace.id).toMatch(/^mcp-/);
    expect(trace.metadata.source).toBe('mcp');
    expect(trace.metadata.server).toEqual({ name: 'my-mcp-server', version: '1.0.0' });
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  test('convertMCP extracts tool calls', () => {
    const trace = convertMCP(mockMCPTrace);
    const toolCalls = trace.steps.filter((s) => s.type === 'tool_call');
    expect(toolCalls).toHaveLength(2); // tools/call + resources/read
    expect(toolCalls[0].data.tool_name).toBe('read_file');
    expect(toolCalls[0].data.tool_args).toEqual({ path: '/tmp/data.txt' });
    expect(toolCalls[0].duration_ms).toBe(50);
  });

  test('convertMCP extracts tool results', () => {
    const trace = convertMCP(mockMCPTrace);
    const toolResults = trace.steps.filter((s) => s.type === 'tool_result');
    expect(toolResults).toHaveLength(2); // tools/result + resources/result
  });

  test('convertMCP extracts LLM completions', () => {
    const trace = convertMCP(mockMCPTrace);
    const llmSteps = trace.steps.filter((s) => s.type === 'llm_call');
    expect(llmSteps).toHaveLength(1);
    expect(llmSteps[0].data.model).toBe('claude-3');
    expect(llmSteps[0].data.tokens).toEqual({ input: 150, output: 80 });
    expect(llmSteps[0].duration_ms).toBe(2000);
  });

  test('convertMCP handles errors', () => {
    const trace = convertMCP(mockMCPTrace);
    const errors = trace.steps.filter((s) => s.data.content?.includes('Error'));
    expect(errors).toHaveLength(1);
    expect(errors[0].data.content).toContain('-32600');
    expect(errors[0].data.content).toContain('Invalid request');
  });
});

// ===== Integration with autoConvert =====

describe('New Adapters Integration', () => {
  test('autoConvert detects CrewAI', () => {
    const trace = autoConvert(mockCrewAITrace);
    expect(trace.metadata.source).toBe('crewai');
  });

  test('autoConvert detects AutoGen', () => {
    const trace = autoConvert(mockAutoGenTrace);
    expect(trace.metadata.source).toBe('autogen');
  });

  test('autoConvert detects MCP', () => {
    const trace = autoConvert(mockMCPTrace);
    expect(trace.metadata.source).toBe('mcp');
  });

  test('convertWith works for new adapters', () => {
    expect(convertWith('crewai', mockCrewAITrace).metadata.source).toBe('crewai');
    expect(convertWith('autogen', mockAutoGenTrace).metadata.source).toBe('autogen');
    expect(convertWith('mcp', mockMCPTrace).metadata.source).toBe('mcp');
  });

  test('empty traces produce valid output', () => {
    const emptyCrewAI = { crew_id: 'x', tasks: [] };
    const emptyAutoGen = { session_id: 'x', messages: [] };
    const emptyMCP = { session_id: 'x', events: [], server: { name: 'test' } };

    expect(convertCrewAI(emptyCrewAI).steps).toHaveLength(0);
    expect(convertAutoGen(emptyAutoGen).steps).toHaveLength(0);
    expect(convertMCP(emptyMCP).steps).toHaveLength(0);
  });
});
