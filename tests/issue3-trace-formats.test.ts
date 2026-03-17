/**
 * Issue #3: Support more trace formats (CrewAI, AutoGen)
 * Tests for enhanced CrewAI and AutoGen converters, plus new format support.
 */
import { describe, it, expect } from 'vitest';
import { convertCrewAI, detectCrewAI } from '../src/adapters/crewai';
import { convertAutoGen, detectAutoGen } from '../src/adapters/autogen';
import { autoConvert, convertWith } from '../src/adapters/index';
import {
  convertTrace,
  detectFormat,
  listFormats,
  type TraceFormat,
} from '../src/converters';

describe('Trace Format Support (Issue #3)', () => {
  describe('CrewAI Adapter', () => {
    const crewAITrace = {
      crew_id: 'crew-123',
      tasks: [
        {
          task_id: 'task-1',
          description: 'Research AI trends',
          agent: 'researcher',
          status: 'completed',
          output: 'AI trends include multi-agent systems and tool use.',
          tools_used: [
            { name: 'web_search', input: { query: 'AI trends 2026' }, output: 'Results...' },
          ],
          llm_calls: [
            {
              model: 'gpt-4',
              prompt: 'Research AI trends',
              response: 'The latest AI trends...',
              tokens: { input: 100, output: 200 },
            },
          ],
          started_at: '2026-01-01T00:00:00Z',
          finished_at: '2026-01-01T00:01:00Z',
        },
        {
          task_id: 'task-2',
          description: 'Write blog post',
          agent: 'writer',
          status: 'completed',
          output: 'Here is a blog post about AI trends.',
          tools_used: [],
          llm_calls: [
            {
              model: 'gpt-4',
              prompt: 'Write a blog post',
              response: 'Blog post content...',
              tokens: { input: 150, output: 300 },
            },
          ],
          started_at: '2026-01-01T00:01:00Z',
          finished_at: '2026-01-01T00:02:00Z',
        },
      ],
      metadata: { crew_name: 'content-crew' },
      created_at: '2026-01-01T00:00:00Z',
    };

    it('should detect CrewAI trace format', () => {
      expect(detectCrewAI(crewAITrace)).toBe(true);
    });

    it('should detect CrewAI in array format', () => {
      expect(detectCrewAI([crewAITrace])).toBe(true);
    });

    it('should not detect non-CrewAI traces', () => {
      expect(detectCrewAI({ messages: [] })).toBe(false);
      expect(detectCrewAI({ steps: [] })).toBe(false);
    });

    it('should convert CrewAI trace to AgentTrace', () => {
      const result = convertCrewAI(crewAITrace);
      expect(result.id).toContain('crewai');
      expect(result.metadata.source).toBe('crewai');
      expect(result.metadata.crew_id).toBe('crew-123');
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('should preserve LLM call data', () => {
      const result = convertCrewAI(crewAITrace);
      const llmSteps = result.steps.filter((s) => s.type === 'llm_call');
      expect(llmSteps.length).toBe(2);
      expect(llmSteps[0].data.model).toBe('gpt-4');
      expect(llmSteps[0].data.tokens).toEqual({ input: 100, output: 200 });
    });

    it('should preserve tool call data', () => {
      const result = convertCrewAI(crewAITrace);
      const toolSteps = result.steps.filter((s) => s.type === 'tool_call');
      expect(toolSteps.length).toBe(1);
      expect(toolSteps[0].data.tool_name).toBe('web_search');
    });

    it('should preserve task outputs', () => {
      const result = convertCrewAI(crewAITrace);
      const outputSteps = result.steps.filter((s) => s.type === 'output');
      expect(outputSteps.length).toBe(2);
    });

    it('should handle task errors', () => {
      const errorTrace = {
        crew_id: 'crew-err',
        tasks: [
          {
            task_id: 'task-err',
            agent: 'worker',
            error: 'Connection refused',
            started_at: '2026-01-01T00:00:00Z',
          },
        ],
      };
      const result = convertCrewAI(errorTrace);
      const errorOutputs = result.steps.filter(
        (s) => s.type === 'output' && s.data.content?.includes('Error'),
      );
      expect(errorOutputs.length).toBe(1);
    });

    it('should work via autoConvert', () => {
      const result = autoConvert(crewAITrace);
      expect(result.metadata.source).toBe('crewai');
    });

    it('should work via convertWith', () => {
      const result = convertWith('crewai', crewAITrace);
      expect(result.metadata.source).toBe('crewai');
    });
  });

  describe('AutoGen Adapter', () => {
    const autoGenTrace = {
      session_id: 'session-456',
      messages: [
        {
          sender: 'user_proxy',
          content: 'Find the weather in Tokyo',
          role: 'user',
          timestamp: '2026-01-01T00:00:00Z',
        },
        {
          sender: 'assistant',
          content: null,
          role: 'assistant',
          tool_calls: [
            {
              id: 'tc-1',
              function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' },
            },
          ],
          model: 'gpt-4',
          usage: { prompt_tokens: 50, completion_tokens: 30 },
          timestamp: '2026-01-01T00:00:01Z',
        },
        {
          sender: 'tool_executor',
          tool_responses: [
            { tool_call_id: 'tc-1', content: '{"temp": 20, "condition": "sunny"}' },
          ],
          timestamp: '2026-01-01T00:00:02Z',
        },
        {
          sender: 'assistant',
          content: 'The weather in Tokyo is 20°C and sunny.',
          role: 'assistant',
          model: 'gpt-4',
          usage: { prompt_tokens: 100, completion_tokens: 25 },
          timestamp: '2026-01-01T00:00:03Z',
        },
      ],
      summary: 'Weather lookup completed',
      metadata: { group_chat: false },
      created_at: '2026-01-01T00:00:00Z',
    };

    it('should detect AutoGen trace format', () => {
      expect(detectAutoGen(autoGenTrace)).toBe(true);
    });

    it('should detect AutoGen in array format', () => {
      expect(detectAutoGen([autoGenTrace])).toBe(true);
    });

    it('should not detect non-AutoGen traces', () => {
      expect(detectAutoGen({ tasks: [] })).toBe(false);
      expect(detectAutoGen({ steps: [] })).toBe(false);
    });

    it('should convert AutoGen trace to AgentTrace', () => {
      const result = convertAutoGen(autoGenTrace);
      expect(result.id).toContain('autogen');
      expect(result.metadata.source).toBe('autogen');
      expect(result.metadata.session_id).toBe('session-456');
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('should preserve tool call data', () => {
      const result = convertAutoGen(autoGenTrace);
      const toolSteps = result.steps.filter((s) => s.type === 'tool_call');
      expect(toolSteps.length).toBe(1);
      expect(toolSteps[0].data.tool_name).toBe('get_weather');
      expect(toolSteps[0].data.tool_args).toEqual({ location: 'Tokyo' });
    });

    it('should preserve tool responses', () => {
      const result = convertAutoGen(autoGenTrace);
      const toolResults = result.steps.filter((s) => s.type === 'tool_result');
      expect(toolResults.length).toBe(1);
    });

    it('should preserve LLM call data with token counts', () => {
      const result = convertAutoGen(autoGenTrace);
      const llmSteps = result.steps.filter((s) => s.type === 'llm_call');
      expect(llmSteps.length).toBeGreaterThanOrEqual(1);
      // The last assistant message should have token info
      const withTokens = llmSteps.filter((s) => s.data.tokens);
      expect(withTokens.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle group chat format', () => {
      const groupTrace = {
        session_id: 'group-1',
        messages: [
          { sender: 'planner', content: 'Let me plan', role: 'assistant', timestamp: '2026-01-01T00:00:00Z' },
          { sender: 'coder', content: 'I will code', role: 'assistant', timestamp: '2026-01-01T00:00:01Z' },
          { sender: 'reviewer', content: 'Looks good', role: 'assistant', timestamp: '2026-01-01T00:00:02Z' },
        ],
      };
      const result = convertAutoGen(groupTrace);
      expect(result.steps.length).toBe(3);
    });

    it('should work via autoConvert', () => {
      const result = autoConvert(autoGenTrace);
      expect(result.metadata.source).toBe('autogen');
    });
  });

  describe('Format conversion roundtrip', () => {
    const sampleTrace = {
      id: 'test-trace-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      steps: [
        {
          type: 'llm_call' as const,
          timestamp: '2026-01-01T00:00:00.000Z',
          data: {
            model: 'gpt-4',
            tokens: { input: 100, output: 50 },
          },
          duration_ms: 500,
        },
        {
          type: 'tool_call' as const,
          timestamp: '2026-01-01T00:00:01.000Z',
          data: {
            tool_name: 'search',
            tool_args: { query: 'test' },
          },
          duration_ms: 200,
        },
        {
          type: 'output' as const,
          timestamp: '2026-01-01T00:00:02.000Z',
          data: {
            content: 'Search results',
          },
          duration_ms: 100,
        },
      ],
      metadata: {},
    };

    it('should convert agentprobe → langsmith → agentprobe', () => {
      const langsmith = convertTrace(sampleTrace, 'agentprobe', 'langsmith');
      expect(langsmith.runs).toBeDefined();
      const back = convertTrace(langsmith, 'langsmith', 'agentprobe');
      expect(back.steps.length).toBeGreaterThanOrEqual(2);
    });

    it('should convert agentprobe → opentelemetry → agentprobe', () => {
      const otel = convertTrace(sampleTrace, 'agentprobe', 'opentelemetry');
      expect(otel.resourceSpans).toBeDefined();
      const back = convertTrace(otel, 'opentelemetry', 'agentprobe');
      expect(back.steps.length).toBeGreaterThanOrEqual(2);
    });

    it('should convert agentprobe → arize → agentprobe', () => {
      const arize = convertTrace(sampleTrace, 'agentprobe', 'arize');
      expect(arize.spans).toBeDefined();
      const back = convertTrace(arize, 'arize', 'agentprobe');
      expect(back.steps.length).toBeGreaterThanOrEqual(2);
    });

    it('should list all supported formats', () => {
      const formats = listFormats();
      expect(formats).toContain('agentprobe');
      expect(formats).toContain('langsmith');
      expect(formats).toContain('opentelemetry');
      expect(formats).toContain('arize');
      expect(formats).toContain('crewai');
      expect(formats).toContain('autogen');
    });

    it('should detect formats correctly', () => {
      expect(detectFormat(sampleTrace)).toBe('agentprobe');
      expect(detectFormat({ runs: [] })).toBe('langsmith');
      expect(detectFormat({ resourceSpans: [] })).toBe('opentelemetry');
      expect(detectFormat({ spans: [{ span_kind: 'LLM' }] })).toBe('arize');
    });
  });

  describe('CrewAI format in converters', () => {
    it('should list crewai as a supported format', () => {
      const formats = listFormats();
      expect(formats).toContain('crewai');
    });

    it('should detect crewai format', () => {
      const crewAI = {
        crew_id: 'test',
        tasks: [{ task_id: 't1', agent: 'a1' }],
      };
      expect(detectFormat(crewAI)).toBe('crewai');
    });

    it('should convert crewai → agentprobe via convertTrace', () => {
      const crewAI = {
        crew_id: 'test',
        tasks: [
          {
            task_id: 't1',
            agent: 'researcher',
            output: 'Done',
            llm_calls: [{ model: 'gpt-4', response: 'result' }],
          },
        ],
        created_at: '2026-01-01T00:00:00Z',
      };
      const result = convertTrace(crewAI, 'crewai', 'agentprobe');
      expect(result.steps).toBeDefined();
      expect(result.metadata.source).toBe('crewai');
    });
  });

  describe('AutoGen format in converters', () => {
    it('should list autogen as a supported format', () => {
      const formats = listFormats();
      expect(formats).toContain('autogen');
    });

    it('should detect autogen format', () => {
      const ag = {
        session_id: 's1',
        messages: [{ sender: 'agent', content: 'hello' }],
      };
      expect(detectFormat(ag)).toBe('autogen');
    });

    it('should convert autogen → agentprobe via convertTrace', () => {
      const ag = {
        session_id: 's1',
        messages: [
          {
            sender: 'assistant',
            content: 'Hello',
            role: 'assistant',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
        created_at: '2026-01-01T00:00:00Z',
      };
      const result = convertTrace(ag, 'autogen', 'agentprobe');
      expect(result.steps).toBeDefined();
      expect(result.metadata.source).toBe('autogen');
    });
  });
});
