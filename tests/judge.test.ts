import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTrace, output } from './helpers';

// We'll test the judge module by mocking the fetch call
describe('judge', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_BASE_URL', 'https://fake.api');
  });

  it('judgeOutput calls LLM and returns score', async () => {
    const mockResponse = { score: 0.9, reasoning: 'Good output' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { judgeOutput } = await import('../src/judge');
    const result = await judgeOutput('test output', { criteria: 'Is it good?', threshold: 0.7 });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.9);
    expect(result.reasoning).toBe('Good output');

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rubric scoring with weights', async () => {
    const mockResponse = {
      scores: [
        { criterion: 'accuracy', score: 0.8, reasoning: 'accurate' },
        { criterion: 'clarity', score: 0.6, reasoning: 'ok' },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { judgeWithRubric } = await import('../src/judge');
    const result = await judgeWithRubric('test output', {
      rubric: [
        { criterion: 'accuracy', weight: 0.7 },
        { criterion: 'clarity', weight: 0.3 },
      ],
      threshold: 0.7,
    });
    // 0.8*0.7 + 0.6*0.3 = 0.56+0.18 = 0.74
    expect(result.overallScore).toBeCloseTo(0.74);
    expect(result.passed).toBe(true);
    expect(result.scores).toHaveLength(2);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('threshold fail', async () => {
    const mockResponse = { score: 0.3, reasoning: 'Poor' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { judgeOutput } = await import('../src/judge');
    const result = await judgeOutput('bad output', { criteria: 'Quality?', threshold: 0.7 });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.3);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
