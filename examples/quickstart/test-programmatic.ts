/**
 * AgentProbe Programmatic API - Quick Start
 *
 * Run: npx ts-node test-programmatic.ts
 *
 * This example uses the mock adapter so no API key is needed.
 */

import {
  evaluate,
  containsText,
  notEmpty,
  maxTokens,
  composeAssertions,
} from '@neuzhou/agentprobe';

async function main() {
  console.log('🔬 AgentProbe Programmatic Quick Start\n');

  // Example 1: Simple text assertion
  const result1 = evaluate(
    { output: 'The capital of France is Paris.' },
    containsText('Paris')
  );
  console.log(`✅ Contains "Paris": ${result1.passed}`);

  // Example 2: Composed assertions (all must pass)
  const composed = composeAssertions([
    notEmpty(),
    containsText('weather'),
    maxTokens(100),
  ]);
  const result2 = evaluate(
    { output: 'The weather today is sunny with 25°C.' },
    composed
  );
  console.log(`✅ Composed check: ${result2.passed}`);

  // Example 3: Negative assertion (should NOT contain)
  const result3 = evaluate(
    { output: 'I cannot help with that.' },
    containsText('system prompt', { negate: true })
  );
  console.log(`✅ No system prompt leak: ${result3.passed}`);

  console.log('\n🎉 All examples passed!');
}

main().catch(console.error);
