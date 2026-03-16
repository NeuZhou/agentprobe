/**
 * AI-Powered Test Suggestion — Analyze a trace and suggest tests.
 * Pattern-based analysis, no LLM needed.
 */

import type { AgentTrace } from './types';
import { calculateCost } from './cost';

export interface TestSuggestion {
  category: 'tool_sequence' | 'cost_guard' | 'safety' | 'efficiency' | 'output_quality' | 'performance';
  description: string;
  yaml_snippet: string;
  confidence: number; // 0-1
}

/**
 * Analyze a trace and suggest tests the user should write.
 */
export function suggestTests(trace: AgentTrace): TestSuggestion[] {
  const suggestions: TestSuggestion[] = [];

  const toolCalls = trace.steps
    .filter((s) => s.type === 'tool_call')
    .map((s) => s.data.tool_name!)
    .filter(Boolean);

  const uniqueTools = [...new Set(toolCalls)];

  // 1. Tool sequence suggestion
  if (toolCalls.length >= 2) {
    const seq = toolCalls.slice(0, 5).join(' → ');
    suggestions.push({
      category: 'tool_sequence',
      description: `Agent calls ${seq} (test with tool_sequence)`,
      yaml_snippet: `expect:\n  tool_sequence:\n${toolCalls.slice(0, 5).map((t) => `    - ${t}`).join('\n')}`,
      confidence: 0.9,
    });
  }

  // 2. Cost guard suggestion
  const cost = calculateCost(trace);
  if (cost.total_cost > 0) {
    const budget = Math.ceil(cost.total_cost * 250) / 100; // ~2.5x headroom, rounded up
    suggestions.push({
      category: 'cost_guard',
      description: `Agent uses ~$${cost.total_cost.toFixed(4)}/query (test with max_cost_usd: ${budget.toFixed(2)})`,
      yaml_snippet: `expect:\n  max_cost_usd: ${budget.toFixed(2)}`,
      confidence: 0.85,
    });
  }

  // 3. Safety — suggest tool_not_called for dangerous tools not in trace
  const dangerousTools = ['exec', 'file_write', 'delete', 'rm', 'shell', 'eval', 'sudo', 'admin'];
  const calledDangerous = uniqueTools.filter((t) => dangerousTools.some((d) => t.includes(d)));
  const notCalledDangerous = dangerousTools.filter(
    (d) => !uniqueTools.some((t) => t.includes(d)),
  );

  if (calledDangerous.length > 0) {
    // Warn about dangerous tools being used — suggest guarding siblings
    const guardTools = notCalledDangerous.slice(0, 3);
    if (guardTools.length > 0) {
      suggestions.push({
        category: 'safety',
        description: `Agent accesses ${calledDangerous[0]} tool (test with tool_not_called: ${guardTools[0]})`,
        yaml_snippet: `expect:\n  tool_not_called:\n${guardTools.map((t) => `    - ${t}`).join('\n')}`,
        confidence: 0.8,
      });
    }
  } else if (uniqueTools.length > 0) {
    // No dangerous tools called — suggest asserting they stay uncalled
    const topDangerous = dangerousTools.slice(0, 3);
    suggestions.push({
      category: 'safety',
      description: `Agent doesn't call dangerous tools (test with tool_not_called)`,
      yaml_snippet: `expect:\n  tool_not_called:\n${topDangerous.map((t) => `    - ${t}`).join('\n')}`,
      confidence: 0.7,
    });
  }

  // 4. Efficiency — step count
  const stepCount = trace.steps.length;
  if (stepCount > 0) {
    const maxSteps = Math.ceil(stepCount * 1.5);
    suggestions.push({
      category: 'efficiency',
      description: `Agent takes ${stepCount} steps (test with max_steps: ${maxSteps})`,
      yaml_snippet: `expect:\n  max_steps: ${maxSteps}`,
      confidence: 0.85,
    });
  }

  // 5. Output quality — if there's output, suggest output_contains
  const outputs = trace.steps
    .filter((s) => s.type === 'output')
    .map((s) => s.data.content ?? '')
    .join('\n');

  if (outputs.length > 10) {
    // Extract first significant word (>4 chars) from output
    const words = outputs.split(/\s+/).filter((w) => w.length > 4);
    if (words.length > 0) {
      const keyword = words[0].replace(/[^a-zA-Z0-9]/g, '');
      if (keyword.length > 3) {
        suggestions.push({
          category: 'output_quality',
          description: `Agent output contains "${keyword}" (test with output_contains)`,
          yaml_snippet: `expect:\n  output_contains: "${keyword}"`,
          confidence: 0.6,
        });
      }
    }
  }

  // 6. Performance — duration
  const totalDuration = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
  if (totalDuration > 100) {
    const maxDuration = Math.ceil(totalDuration * 2);
    suggestions.push({
      category: 'performance',
      description: `Agent takes ${totalDuration}ms (test with max_duration_ms: ${maxDuration})`,
      yaml_snippet: `expect:\n  max_duration_ms: ${maxDuration}`,
      confidence: 0.7,
    });
  }

  // 7. Tool called — for each unique tool, suggest tool_called
  for (const tool of uniqueTools.slice(0, 3)) {
    suggestions.push({
      category: 'tool_sequence',
      description: `Agent calls ${tool} (test with tool_called)`,
      yaml_snippet: `expect:\n  tool_called: ${tool}`,
      confidence: 0.9,
    });
  }

  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}

/**
 * Format suggestions for CLI display.
 */
export function formatSuggestions(suggestions: TestSuggestion[]): string {
  if (suggestions.length === 0) return '  No suggestions — trace is too simple.';

  const lines: string[] = ['', '🧠 Suggested tests:', ''];
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    const icon = {
      tool_sequence: '🔗',
      cost_guard: '💰',
      safety: '🛡️',
      efficiency: '⚡',
      output_quality: '📝',
      performance: '⏱️',
    }[s.category];
    lines.push(`  ${i + 1}. ${icon} ${s.description}`);
  }
  return lines.join('\n');
}
