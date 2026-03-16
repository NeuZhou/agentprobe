/**
 * Run the research agent with recording enabled, save trace.
 *
 * Usage:
 *   npx ts-node examples/agents/run-research.ts
 */

import { Recorder } from '../../src/recorder';
import { runAgent } from './research-agent';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const question = 'Research the population of Tokyo and calculate the population density given an area of 2,194 km²';

  const recorder = new Recorder({
    agent: 'research-agent',
    question,
    timestamp: new Date().toISOString(),
  });

  console.log('🔬 Running Research Agent with recording...\n');
  console.log(`📋 Task: ${question}\n`);

  const answer = await runAgent(question, recorder);

  console.log(`\n📝 Result:\n${answer}`);

  // Ensure output dir exists
  const outDir = path.join(__dirname, '..', 'traces');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const tracePath = path.join(outDir, 'e2e-research.json');
  recorder.save(tracePath);
  console.log(`\n💾 Trace saved to: ${tracePath}`);

  // Print trace summary
  const trace = recorder.getTrace();
  const toolCalls = trace.steps.filter(s => s.type === 'tool_call').map(s => s.data.tool_name);
  console.log(`\n📊 Summary:`);
  console.log(`   Steps: ${trace.steps.length}`);
  console.log(`   Tool calls: ${toolCalls.join(', ')}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
