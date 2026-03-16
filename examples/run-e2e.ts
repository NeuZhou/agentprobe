/**
 * E2E Runner: Generate trace with real LLM, then test it
 *
 * Usage: npx ts-node examples/run-e2e.ts
 */

import { runAgent } from './agents/simple-agent';
import { Recorder } from '../src/recorder';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const tracePath = path.join(__dirname, 'traces', 'e2e-calculator.json');
  const tracesDir = path.dirname(tracePath);
  if (!fs.existsSync(tracesDir)) fs.mkdirSync(tracesDir, { recursive: true });

  // --- Step 1: Patch OpenAI and run agent to generate trace ---
  console.log('═══ Step 1: Running agent with Ollama (qwen2.5:7b) ═══\n');

  const recorder = new Recorder({ agent: 'simple-calculator', question: 'What is 42 * 17?' });
  const openaiModule = require('openai');
  recorder.patchOpenAI(openaiModule);

  const answer = await runAgent('What is 42 * 17?');
  console.log(`🤖 Agent answer: ${answer}`);

  recorder.save(tracePath);
  console.log(`📝 Trace saved: ${tracePath}\n`);

  // --- Step 2: Show trace summary ---
  console.log('═══ Step 2: Trace Summary ═══\n');
  const trace = recorder.getTrace();
  console.log(`  ID:    ${trace.id}`);
  console.log(`  Steps: ${trace.steps.length}`);
  for (const step of trace.steps) {
    const detail = step.type === 'tool_call'
      ? ` → ${step.data.tool_name}(${JSON.stringify(step.data.tool_args)})`
      : step.type === 'output'
        ? ` → "${step.data.content?.slice(0, 80)}..."`
        : ` → ${step.data.model ?? ''}`;
    console.log(`  [${step.type}]${detail}`);
  }

  // --- Step 3: Run assertions ---
  console.log('\n═══ Step 3: Running Assertions ═══\n');

  const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
  const outputs = trace.steps.filter(s => s.type === 'output');

  const checks = [
    {
      name: 'Tool "calculate" was called',
      pass: toolCalls.some(s => s.data.tool_name === 'calculate'),
    },
    {
      name: 'Output contains a number',
      pass: outputs.some(s => /\d+/.test(s.data.content ?? '')),
    },
    {
      name: 'Output contains 714',
      pass: outputs.some(s => (s.data.content ?? '').includes('714')),
    },
    {
      name: 'Trace has ≤ 10 steps',
      pass: trace.steps.length <= 10,
    },
  ];

  let allPassed = true;
  for (const c of checks) {
    const icon = c.pass ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}`);
    if (!c.pass) allPassed = false;
  }

  console.log(`\n${allPassed ? '🎉 All checks passed!' : '💥 Some checks failed!'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('E2E run failed:', err);
  process.exit(1);
});
