/**
 * Natural Language Test Assertions — write test assertions in plain English.
 *
 * Evaluates assertions like "Response mentions temperature" against agent outputs
 * using pattern matching, keyword extraction, and semantic heuristics.
 *
 * @module nl-assert
 */

import type { AssertionResult } from './types';

// ===== Types =====

export interface NLAssertion {
  text: string;
  negated: boolean;
  category: NLAssertionCategory;
  keywords: string[];
}

export type NLAssertionCategory =
  | 'contains'
  | 'not_contains'
  | 'tone'
  | 'format'
  | 'factual'
  | 'length'
  | 'safety'
  | 'custom';

export interface NLTestCase {
  input: string;
  assertions: string[];
  tags?: string[];
}

export interface NLTestSuite {
  name: string;
  description?: string;
  tests: NLTestCase[];
}

export interface NLEvalResult {
  assertion: string;
  passed: boolean;
  confidence: number;
  reason: string;
}

export interface NLTestResult {
  input: string;
  output: string;
  results: NLEvalResult[];
  allPassed: boolean;
}

// ===== Parsing =====

const NEGATION_PREFIXES = [
  'no ', 'not ', 'never ', 'without ', 'doesn\'t ', 'does not ',
  'shouldn\'t ', 'should not ', 'must not ', 'mustn\'t ',
];

const TONE_KEYWORDS = [
  'tone', 'polite', 'friendly', 'helpful', 'concise', 'formal', 'informal',
  'professional', 'casual', 'empathetic', 'neutral', 'assertive', 'warm',
];

const FORMAT_KEYWORDS = [
  'format', 'bullet', 'numbered', 'list', 'markdown', 'json', 'table',
  'heading', 'paragraph', 'code block', 'structured',
];

const SAFETY_KEYWORDS = [
  'hallucinate', 'fabricate', 'make up', 'invent', 'false', 'misleading',
  'harmful', 'offensive', 'bias', 'inappropriate', 'toxic', 'unsafe',
];

/**
 * Parse a natural language assertion string into structured form.
 */
export function parseNLAssertion(text: string): NLAssertion {
  const lower = text.toLowerCase().trim();
  let negated = false;

  for (const prefix of NEGATION_PREFIXES) {
    if (lower.startsWith(prefix)) {
      negated = true;
      break;
    }
  }

  const category = categorizeAssertion(lower);
  const keywords = extractKeywords(lower);

  return { text, negated, category, keywords };
}

/**
 * Categorize an assertion into a type.
 */
export function categorizeAssertion(text: string): NLAssertionCategory {
  const lower = text.toLowerCase();

  if (SAFETY_KEYWORDS.some((k) => lower.includes(k))) return 'safety';
  if (TONE_KEYWORDS.some((k) => lower.includes(k))) return 'tone';
  if (FORMAT_KEYWORDS.some((k) => lower.includes(k))) return 'format';
  if (lower.includes('length') || lower.includes('word') || lower.includes('character') || lower.includes('short') || lower.includes('brief')) return 'length';

  // Check for negation
  for (const prefix of NEGATION_PREFIXES) {
    if (lower.startsWith(prefix)) return 'not_contains';
  }

  if (lower.includes('mention') || lower.includes('include') || lower.includes('contain') || lower.includes('reference') || lower.includes('provide')) return 'contains';

  return 'custom';
}

/**
 * Extract meaningful keywords from assertion text.
 */
export function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'and', 'but', 'or',
    'nor', 'not', 'no', 'so', 'yet', 'both', 'either', 'neither',
    'response', 'output', 'answer', 'result', 'mentions', 'includes',
    'contains', 'provides', 'that', 'this', 'it', 'its',
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

// ===== Evaluation =====

/**
 * Evaluate a single NL assertion against an output string.
 */
export function evaluateNLAssertion(assertion: NLAssertion, output: string): NLEvalResult {
  const lower = output.toLowerCase();

  switch (assertion.category) {
    case 'contains':
      return evalContains(assertion, lower);
    case 'not_contains':
      return evalNotContains(assertion, lower);
    case 'tone':
      return evalTone(assertion, lower);
    case 'format':
      return evalFormat(assertion, lower);
    case 'length':
      return evalLength(assertion, output);
    case 'safety':
      return evalSafety(assertion, lower);
    default:
      return evalCustom(assertion, lower);
  }
}

function evalContains(assertion: NLAssertion, output: string): NLEvalResult {
  const found = assertion.keywords.filter((k) => output.includes(k));
  const ratio = assertion.keywords.length > 0 ? found.length / assertion.keywords.length : 0;
  const passed = assertion.negated ? ratio === 0 : ratio > 0;
  return {
    assertion: assertion.text,
    passed,
    confidence: Math.max(0.5, ratio),
    reason: passed
      ? `Found keywords: ${found.join(', ')}`
      : `Missing keywords: ${assertion.keywords.filter((k) => !output.includes(k)).join(', ')}`,
  };
}

function evalNotContains(assertion: NLAssertion, output: string): NLEvalResult {
  // For negated assertions, check that keywords are NOT present
  const found = assertion.keywords.filter((k) => output.includes(k));
  const passed = found.length === 0;
  return {
    assertion: assertion.text,
    passed,
    confidence: passed ? 0.9 : 0.3,
    reason: passed
      ? 'None of the negated keywords found in output'
      : `Found negated keywords: ${found.join(', ')}`,
  };
}

function evalTone(assertion: NLAssertion, output: string): NLEvalResult {
  // Simple heuristic tone analysis
  const toneIndicators: Record<string, string[]> = {
    helpful: ['here', 'help', 'try', 'you can', 'suggest', 'recommend', 'hope'],
    concise: [],  // checked by length
    polite: ['please', 'thank', 'sorry', 'appreciate', 'kindly'],
    formal: ['therefore', 'furthermore', 'consequently', 'regarding'],
    friendly: ['!', 'great', 'glad', 'happy', 'awesome', 'sure'],
    professional: ['recommend', 'advise', 'solution', 'approach'],
  };

  const matchedTones: string[] = [];
  for (const [tone, indicators] of Object.entries(toneIndicators)) {
    if (assertion.keywords.includes(tone)) {
      if (tone === 'concise') {
        if (output.length < 500) matchedTones.push(tone);
      } else {
        const hits = indicators.filter((i) => output.includes(i));
        if (hits.length > 0) matchedTones.push(tone);
      }
    }
  }

  const requestedTones = assertion.keywords.filter((k) => Object.keys(toneIndicators).includes(k));
  const passed = assertion.negated
    ? matchedTones.length === 0
    : requestedTones.length === 0 || matchedTones.length > 0;

  return {
    assertion: assertion.text,
    passed,
    confidence: passed ? 0.7 : 0.4,
    reason: passed
      ? `Tone matches: ${matchedTones.join(', ') || 'acceptable'}`
      : `Expected tone: ${requestedTones.join(', ')}`,
  };
}

function evalFormat(assertion: NLAssertion, output: string): NLEvalResult {
  const checks: Record<string, boolean> = {
    bullet: /[-•*]\s/.test(output),
    numbered: /\d+[.)]\s/.test(output),
    list: /[-•*]\s|\d+[.)]\s/.test(output),
    markdown: /[#*_`[\]]/.test(output),
    json: (() => { try { JSON.parse(output); return true; } catch { return false; } })(),
    table: /\|.*\|/.test(output),
    'code block': /```/.test(output),
  };

  const matchedFormats = assertion.keywords.filter((k) => checks[k]);
  const passed = assertion.negated
    ? matchedFormats.length === 0
    : matchedFormats.length > 0 || assertion.keywords.every((k) => !Object.keys(checks).includes(k));

  return {
    assertion: assertion.text,
    passed,
    confidence: passed ? 0.85 : 0.3,
    reason: passed
      ? `Format check passed: ${matchedFormats.join(', ') || 'ok'}`
      : `Missing format: ${assertion.keywords.join(', ')}`,
  };
}

function evalLength(assertion: NLAssertion, output: string): NLEvalResult {
  const wordCount = output.split(/\s+/).filter(Boolean).length;
  const isShort = assertion.keywords.some((k) => ['short', 'brief', 'concise'].includes(k));
  const passed = isShort ? wordCount < 100 : wordCount > 0;

  return {
    assertion: assertion.text,
    passed,
    confidence: passed ? 0.8 : 0.4,
    reason: `Word count: ${wordCount}${isShort ? ' (expected short)' : ''}`,
  };
}

function evalSafety(assertion: NLAssertion, _output: string): NLEvalResult {
  // Safety assertions with negation (e.g., "No hallucinated data sources")
  // In a real system this would use an LLM judge; here we check surface patterns
  const suspiciousPatterns = [
    /according to .{3,30} study/i,
    /research (shows|proves|confirms)/i,
    /\d{4} report/i,
    /source: /i,
  ];

  const found = suspiciousPatterns.filter((p) => p.test(_output));

  // For safety, negated means "should NOT have these"
  const passed = assertion.negated ? found.length === 0 : found.length > 0;

  return {
    assertion: assertion.text,
    passed,
    confidence: 0.6,  // Lower confidence for heuristic safety
    reason: passed
      ? 'No suspicious patterns detected'
      : `Found ${found.length} suspicious pattern(s)`,
  };
}

function evalCustom(assertion: NLAssertion, output: string): NLEvalResult {
  // Fallback: keyword matching
  const found = assertion.keywords.filter((k) => output.includes(k));
  const ratio = assertion.keywords.length > 0 ? found.length / assertion.keywords.length : 1;
  const passed = assertion.negated ? ratio === 0 : ratio > 0.3;

  return {
    assertion: assertion.text,
    passed,
    confidence: Math.max(0.4, ratio * 0.9),
    reason: `Keyword match: ${found.length}/${assertion.keywords.length}`,
  };
}

// ===== Suite execution =====

/**
 * Evaluate all NL assertions for a test case against an output.
 */
export function evaluateNLTest(testCase: NLTestCase, output: string): NLTestResult {
  const results = testCase.assertions.map((text) => {
    const parsed = parseNLAssertion(text);
    return evaluateNLAssertion(parsed, output);
  });

  return {
    input: testCase.input,
    output,
    results,
    allPassed: results.every((r) => r.passed),
  };
}

/**
 * Convert NL eval results to standard AssertionResults for integration with the test runner.
 */
export function nlResultsToAssertions(nlResult: NLTestResult): AssertionResult[] {
  return nlResult.results.map((r) => ({
    name: `nl: ${r.assertion}`,
    passed: r.passed,
    expected: r.assertion,
    actual: r.reason,
    message: `[confidence: ${(r.confidence * 100).toFixed(0)}%] ${r.reason}`,
  }));
}

/**
 * Format NL test results for display.
 */
export function formatNLResults(results: NLTestResult[]): string {
  const lines: string[] = [];
  lines.push('\n📝 Natural Language Assertion Results\n');

  for (const test of results) {
    lines.push(`  Input: "${test.input}"`);
    for (const r of test.results) {
      const icon = r.passed ? '✅' : '❌';
      lines.push(`    ${icon} ${r.assertion}`);
      lines.push(`       ${r.reason} (confidence: ${(r.confidence * 100).toFixed(0)}%)`);
    }
    lines.push('');
  }

  const total = results.reduce((n, t) => n + t.results.length, 0);
  const passed = results.reduce((n, t) => n + t.results.filter((r) => r.passed).length, 0);
  lines.push(`  Total: ${passed}/${total} assertions passed`);
  lines.push('');

  return lines.join('\n');
}
