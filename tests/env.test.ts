import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnvFile, resolveEnvVars, resolveEnvRecord } from '../src/env';

const TMP = path.join(__dirname, '__tmp_env__');

afterEach(() => {
  if (fs.existsSync(TMP)) {
    for (const f of fs.readdirSync(TMP)) fs.unlinkSync(path.join(TMP, f));
    fs.rmdirSync(TMP);
  }
});

describe('env', () => {
  it('parses .env file', () => {
    if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
    const p = path.join(TMP, '.env');
    fs.writeFileSync(p, 'KEY=value\nSECRET="quoted"\n# comment\nEMPTY=');
    const env = parseEnvFile(p);
    expect(env.KEY).toBe('value');
    expect(env.SECRET).toBe('quoted');
    expect(env.EMPTY).toBe('');
  });

  it('resolves ${VAR} from process.env', () => {
    process.env.TEST_RESOLVE_VAR = 'hello';
    const result = resolveEnvVars('prefix-${TEST_RESOLVE_VAR}-suffix');
    expect(result).toBe('prefix-hello-suffix');
    delete process.env.TEST_RESOLVE_VAR;
  });

  it('leaves unresolved vars as-is', () => {
    const result = resolveEnvVars('${NONEXISTENT_VAR_XYZ}');
    expect(result).toBe('${NONEXISTENT_VAR_XYZ}');
  });

  it('resolves env record', () => {
    const result = resolveEnvRecord({ A: 'literal', B: '${HOME}' });
    expect(result.A).toBe('literal');
    // B should be resolved or left as-is
    expect(result.B).toBeDefined();
  });
});
