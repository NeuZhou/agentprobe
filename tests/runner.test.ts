import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runSuite } from '../src/runner';
import YAML from 'yaml';

const TMP_DIR = path.join(__dirname, '__tmp_runner__');

function writeSuite(filename: string, suite: any): string {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const p = path.join(TMP_DIR, filename);
  fs.writeFileSync(p, YAML.stringify(suite));
  return p;
}

function writeTrace(filename: string, trace: any): string {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const p = path.join(TMP_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(trace));
  return p;
}

function cleanup() {
  if (fs.existsSync(TMP_DIR)) {
    for (const f of fs.readdirSync(TMP_DIR)) {
      const fp = path.join(TMP_DIR, f);
      if (fs.statSync(fp).isDirectory()) {
        for (const sf of fs.readdirSync(fp)) fs.unlinkSync(path.join(fp, sf));
        fs.rmdirSync(fp);
      } else {
        fs.unlinkSync(fp);
      }
    }
    fs.rmdirSync(TMP_DIR);
  }
}

describe('runner', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('loads YAML suite and runs tests with traces', async () => {
    writeTrace('trace1.json', {
      id: 't1', timestamp: new Date().toISOString(),
      steps: [
        { type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'search' }, duration_ms: 5 },
        { type: 'output', timestamp: new Date().toISOString(), data: { content: 'found it' }, duration_ms: 5 },
      ],
      metadata: {},
    });

    const suitePath = writeSuite('suite.yaml', {
      name: 'Test Suite',
      tests: [{
        name: 'basic test',
        input: 'find something',
        trace: 'trace1.json',
        expect: { tool_called: 'search', output_contains: 'found' },
      }],
    });

    const result = await runSuite(suitePath);
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
  });

  it('parameterized tests expand correctly', async () => {
    writeTrace('trace_p.json', {
      id: 'tp', timestamp: new Date().toISOString(),
      steps: [{ type: 'output', timestamp: new Date().toISOString(), data: { content: 'ok' }, duration_ms: 1 }],
      metadata: {},
    });

    const suitePath = writeSuite('param.yaml', {
      name: 'Param Suite',
      tests: [{
        name: 'test ${val}',
        input: 'input ${val}',
        trace: 'trace_p.json',
        each: [{ val: 'alpha' }, { val: 'beta' }, { val: 'gamma' }],
        expect: { output_contains: 'ok' },
      }],
    });

    const result = await runSuite(suitePath);
    expect(result.total).toBe(3);
    expect(result.results.map(r => r.name)).toEqual(['test alpha', 'test beta', 'test gamma']);
  });

  it('tag filtering works', async () => {
    writeTrace('trace_tag.json', {
      id: 'tt', timestamp: new Date().toISOString(),
      steps: [{ type: 'output', timestamp: new Date().toISOString(), data: { content: 'x' }, duration_ms: 1 }],
      metadata: {},
    });

    const suitePath = writeSuite('tags.yaml', {
      name: 'Tag Suite',
      tests: [
        { name: 'fast', input: 'a', trace: 'trace_tag.json', tags: ['fast'], expect: { output_contains: 'x' } },
        { name: 'slow', input: 'b', trace: 'trace_tag.json', tags: ['slow'], expect: { output_contains: 'x' } },
        { name: 'both', input: 'c', trace: 'trace_tag.json', tags: ['fast', 'slow'], expect: { output_contains: 'x' } },
      ],
    });

    const result = await runSuite(suitePath, { tags: ['fast'] });
    expect(result.total).toBe(2);
    expect(result.results.map(r => r.name).sort()).toEqual(['both', 'fast']);
  });

  it('hooks execute in order', async () => {
    const hookLog = path.join(TMP_DIR, 'hook_log.txt');
    // Create the trace and empty log
    writeTrace('trace_hook.json', {
      id: 'th', timestamp: new Date().toISOString(),
      steps: [{ type: 'output', timestamp: new Date().toISOString(), data: { content: 'ok' }, duration_ms: 1 }],
      metadata: {},
    });
    fs.writeFileSync(hookLog, '');

    const isWin = process.platform === 'win32';
    const appendCmd = (text: string) =>
      isWin
        ? `powershell -Command "Add-Content -Path '${hookLog}' -Value '${text}' -NoNewline"`
        : `echo -n '${text}' >> '${hookLog}'`;

    const suitePath = writeSuite('hooks.yaml', {
      name: 'Hooks Suite',
      hooks: {
        beforeAll: { command: appendCmd('BA|') },
        afterAll: { command: appendCmd('AA|') },
        beforeEach: { command: appendCmd('BE|') },
        afterEach: { command: appendCmd('AE|') },
      },
      tests: [
        { name: 'test1', input: 'a', trace: 'trace_hook.json', expect: { output_contains: 'ok' } },
        { name: 'test2', input: 'b', trace: 'trace_hook.json', expect: { output_contains: 'ok' } },
      ],
    });

    await runSuite(suitePath);
    const log = fs.readFileSync(hookLog, 'utf-8').replace(/\r\n/g, '');
    // BA once, then (BE, AE) per test, then AA
    expect(log).toContain('BA|');
    expect(log).toContain('AA|');
    // BE and AE should appear twice each (2 tests)
    const beCount = (log.match(/BE\|/g) || []).length;
    const aeCount = (log.match(/AE\|/g) || []).length;
    expect(beCount).toBe(2);
    expect(aeCount).toBe(2);
  });
});
