import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert Google Gemini (Google AI / Vertex AI) API response logs to AgentTrace.
 * Accepts a single generateContent response or array of responses.
 */
export function convertGemini(input: any): AgentTrace {
  const responses = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const resp of responses) {
    const ts = new Date().toISOString();
    const model = resp.modelVersion ?? resp.model ?? 'gemini';
    const usage = resp.usageMetadata;

    for (const candidate of resp.candidates ?? []) {
      const content = candidate.content;
      if (!content?.parts) continue;

      for (const part of content.parts) {
        if (part.functionCall) {
          steps.push({
            type: 'tool_call',
            timestamp: ts,
            data: {
              model,
              tool_name: part.functionCall.name,
              tool_args: part.functionCall.args ?? {},
              tokens: usage
                ? { input: usage.promptTokenCount, output: usage.candidatesTokenCount }
                : undefined,
            },
          });
        } else if (part.functionResponse) {
          steps.push({
            type: 'tool_result',
            timestamp: ts,
            data: {
              model,
              tool_name: part.functionResponse.name,
              tool_result: part.functionResponse.response,
            },
          });
        } else if (part.text) {
          steps.push({
            type: 'output',
            timestamp: ts,
            data: {
              model,
              content: part.text,
              tokens: usage
                ? { input: usage.promptTokenCount, output: usage.candidatesTokenCount }
                : undefined,
            },
          });
        }
      }
    }
  }

  return {
    id: `gemini-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: { source: 'gemini', model: responses[0]?.modelVersion ?? responses[0]?.model },
  };
}

/**
 * Detect Gemini response format.
 */
export function detectGemini(input: any): boolean {
  if (Array.isArray(input)) return input.some((i) => i?.candidates && Array.isArray(i.candidates));
  return !!input?.candidates && Array.isArray(input.candidates);
}
