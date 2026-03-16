/**
 * LLM-as-Judge Assertions — Use an LLM to evaluate agent output quality.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface JudgeConfig {
  criteria: string;
  model?: string; // default: gpt-4o-mini
  threshold?: number; // default: 0.7
}

export interface RubricCriterion {
  criterion: string;
  weight: number;
}

export interface JudgeRubricConfig {
  rubric: RubricCriterion[];
  model?: string;
  threshold?: number;
}

export interface JudgeResult {
  passed: boolean;
  score: number;
  reasoning: string;
  model: string;
  cached: boolean;
}

export interface RubricResult {
  passed: boolean;
  overallScore: number;
  scores: Array<{ criterion: string; score: number; weight: number; reasoning: string }>;
  model: string;
  cached: boolean;
}

// Simple in-memory + file cache
const CACHE_DIR = '.agentprobe-cache';
const memoryCache = new Map<string, any>();

function cacheKey(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function getCached<T>(key: string): T | undefined {
  if (memoryCache.has(key)) return memoryCache.get(key);
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    memoryCache.set(key, data);
    return data;
  }
  return undefined;
}

function setCache(key: string, value: any): void {
  memoryCache.set(key, value);
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
}

/**
 * Call an OpenAI-compatible API for judging.
 * Supports OPENAI_API_KEY + OPENAI_BASE_URL env vars.
 */
async function callLLM(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY env var required for LLM-as-Judge. Set it or use a cached result.',
    );
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    throw new Error(`LLM API error ${resp.status}: ${await resp.text()}`);
  }

  const data: any = await resp.json();
  return data.choices[0].message.content;
}

/**
 * Simple judge: evaluate output against a single criterion.
 */
export async function judgeOutput(output: string, config: JudgeConfig): Promise<JudgeResult> {
  const model = config.model || 'gpt-4o-mini';
  const threshold = config.threshold ?? 0.7;

  const key = cacheKey(`judge:${model}:${config.criteria}:${output}`);
  const cached = getCached<JudgeResult>(key);
  if (cached) return { ...cached, cached: true };

  const systemPrompt = `You are an impartial judge evaluating AI agent output quality.
Score the output 0.0 to 1.0 based on the given criterion.
Respond in JSON: {"score": <number>, "reasoning": "<brief explanation>"}`;

  const userPrompt = `Criterion: ${config.criteria}

Agent output:
${output}`;

  const response = await callLLM(model, systemPrompt, userPrompt);
  const parsed = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());

  const result: JudgeResult = {
    passed: parsed.score >= threshold,
    score: parsed.score,
    reasoning: parsed.reasoning,
    model,
    cached: false,
  };

  setCache(key, result);
  return result;
}

/**
 * Rubric-based judge: evaluate output against multiple weighted criteria.
 */
export async function judgeWithRubric(
  output: string,
  config: JudgeRubricConfig,
): Promise<RubricResult> {
  const model = config.model || 'gpt-4o-mini';
  const threshold = config.threshold ?? 0.7;

  const rubricStr = config.rubric.map((r) => `${r.criterion} (weight: ${r.weight})`).join('\n');
  const key = cacheKey(`rubric:${model}:${rubricStr}:${output}`);
  const cached = getCached<RubricResult>(key);
  if (cached) return { ...cached, cached: true };

  const systemPrompt = `You are an impartial judge evaluating AI agent output quality.
Score each criterion 0.0 to 1.0.
Respond in JSON: {"scores": [{"criterion": "<name>", "score": <number>, "reasoning": "<brief>"}]}`;

  const userPrompt = `Criteria:
${rubricStr}

Agent output:
${output}`;

  const response = await callLLM(model, systemPrompt, userPrompt);
  const parsed = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());

  const scores = config.rubric.map((r, i) => ({
    criterion: r.criterion,
    score: parsed.scores[i]?.score ?? 0,
    weight: r.weight,
    reasoning: parsed.scores[i]?.reasoning ?? '',
  }));

  const overallScore = scores.reduce((sum, s) => sum + s.score * s.weight, 0);

  const result: RubricResult = {
    passed: overallScore >= threshold,
    overallScore,
    scores,
    model,
    cached: false,
  };

  setCache(key, result);
  return result;
}
