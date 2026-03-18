/**
 * Tests for src/config-file.ts - Configuration file loading and resolution
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadExtendedConfig,
  findExtendedConfigFile,
  getDefaultAdapter,
  getAdapterConfig,
  resolveOutputDir,
  loadEnvFromConfig,
  getProfile,
  listProfiles,
  type ExtendedConfig,
} from '../src/config-file';

describe('Config File', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('findExtendedConfigFile', () => {
    it('should find .agentproberc.yml', () => {
      fs.writeFileSync(path.join(tmpDir, '.agentproberc.yml'), 'timeout_ms: 5000');
      const found = findExtendedConfigFile(tmpDir);
      expect(found).toBe(path.join(tmpDir, '.agentproberc.yml'));
    });

    it('should find agentprobe.config.yaml', () => {
      fs.writeFileSync(path.join(tmpDir, 'agentprobe.config.yaml'), 'parallel: 4');
      const found = findExtendedConfigFile(tmpDir);
      expect(found).toBe(path.join(tmpDir, 'agentprobe.config.yaml'));
    });

    it('should return null when no config exists', () => {
      const found = findExtendedConfigFile(tmpDir);
      expect(found).toBeNull();
    });

    it('should search up parent directories', () => {
      const childDir = path.join(tmpDir, 'sub', 'child');
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.agentproberc.yml'), 'timeout_ms: 5000');
      const found = findExtendedConfigFile(childDir);
      expect(found).toBe(path.join(tmpDir, '.agentproberc.yml'));
    });
  });

  describe('loadExtendedConfig', () => {
    it('should load YAML config', () => {
      fs.writeFileSync(path.join(tmpDir, '.agentproberc.yml'), `
timeout_ms: 10000
parallel: 4
reporter: junit
`);
      const config = loadExtendedConfig(tmpDir);
      expect(config.timeout_ms).toBe(10000);
      expect(config.parallel).toBe(4);
      expect(config.reporter).toBe('junit');
    });

    it('should return empty object when no config file', () => {
      const config = loadExtendedConfig(tmpDir);
      expect(config).toEqual({});
    });

    it('should load config with adapters section', () => {
      fs.writeFileSync(path.join(tmpDir, '.agentproberc.yml'), `
adapters:
  default: openai
  openai:
    model: gpt-4
    api_key: sk-test
`);
      const config = loadExtendedConfig(tmpDir);
      expect(config.adapters?.default).toBe('openai');
    });

    it('should load config with profiles', () => {
      fs.writeFileSync(path.join(tmpDir, '.agentproberc.yml'), `
profiles:
  fast:
    timeout_ms: 5000
    parallel: true
  slow:
    timeout_ms: 30000
`);
      const config = loadExtendedConfig(tmpDir);
      expect(config.profiles?.fast?.timeout_ms).toBe(5000);
      expect(config.profiles?.slow?.timeout_ms).toBe(30000);
    });
  });

  describe('getDefaultAdapter', () => {
    it('should return default adapter name', () => {
      const config: ExtendedConfig = {
        adapters: { default: 'openai' },
      };
      expect(getDefaultAdapter(config)).toBe('openai');
    });

    it('should return undefined when no adapters', () => {
      expect(getDefaultAdapter({})).toBeUndefined();
    });
  });

  describe('getAdapterConfig', () => {
    it('should return adapter config by name', () => {
      const config: ExtendedConfig = {
        adapters: {
          openai: { model: 'gpt-4', api_key: 'sk-test' },
        },
      };
      const adapterConfig = getAdapterConfig(config, 'openai');
      expect(adapterConfig?.model).toBe('gpt-4');
    });

    it('should return undefined for string-only adapter', () => {
      const config: ExtendedConfig = {
        adapters: { default: 'openai' },
      };
      expect(getAdapterConfig(config, 'default')).toBeUndefined();
    });

    it('should return undefined for missing adapter', () => {
      expect(getAdapterConfig({}, 'missing')).toBeUndefined();
    });
  });

  describe('resolveOutputDir', () => {
    it('should default to ./reports', () => {
      const dir = resolveOutputDir({}, tmpDir);
      expect(dir).toBe(path.join(tmpDir, 'reports'));
    });

    it('should use configured output_dir', () => {
      const dir = resolveOutputDir({ output_dir: './custom-output' }, tmpDir);
      expect(dir).toBe(path.join(tmpDir, 'custom-output'));
    });

    it('should preserve absolute paths', () => {
      const absPath = path.join(os.tmpdir(), 'absolute-output');
      const dir = resolveOutputDir({ output_dir: absPath });
      expect(dir).toBe(absPath);
    });
  });

  describe('loadEnvFromConfig', () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      // Clean up any env vars we set
      for (const key of Object.keys(process.env)) {
        if (!(key in origEnv)) {
          delete process.env[key];
        }
      }
    });

    it('should load env from file', () => {
      const envPath = path.join(tmpDir, '.env.test');
      fs.writeFileSync(envPath, 'AGENTTEST_FOO=bar\nAGENTTEST_NUM=42\n');
      loadEnvFromConfig({ env_file: envPath });
      expect(process.env['AGENTTEST_FOO']).toBe('bar');
      expect(process.env['AGENTTEST_NUM']).toBe('42');
      delete process.env['AGENTTEST_FOO'];
      delete process.env['AGENTTEST_NUM'];
    });

    it('should skip comments and empty lines', () => {
      const envPath = path.join(tmpDir, '.env.test2');
      fs.writeFileSync(envPath, '# comment\n\nAGENTTEST_X=y\n');
      loadEnvFromConfig({ env_file: envPath });
      expect(process.env['AGENTTEST_X']).toBe('y');
      delete process.env['AGENTTEST_X'];
    });

    it('should strip quotes from values', () => {
      const envPath = path.join(tmpDir, '.env.test3');
      fs.writeFileSync(envPath, 'AGENTTEST_Q1="quoted"\nAGENTTEST_Q2=\'single\'\n');
      loadEnvFromConfig({ env_file: envPath });
      expect(process.env['AGENTTEST_Q1']).toBe('quoted');
      expect(process.env['AGENTTEST_Q2']).toBe('single');
      delete process.env['AGENTTEST_Q1'];
      delete process.env['AGENTTEST_Q2'];
    });

    it('should not override existing env vars', () => {
      process.env['AGENTTEST_EXISTING'] = 'original';
      const envPath = path.join(tmpDir, '.env.test4');
      fs.writeFileSync(envPath, 'AGENTTEST_EXISTING=override\n');
      loadEnvFromConfig({ env_file: envPath });
      expect(process.env['AGENTTEST_EXISTING']).toBe('original');
      delete process.env['AGENTTEST_EXISTING'];
    });

    it('should handle missing env file gracefully', () => {
      expect(() => loadEnvFromConfig({ env_file: '/nonexistent/.env' })).not.toThrow();
    });

    it('should do nothing when no env_file in config', () => {
      expect(() => loadEnvFromConfig({})).not.toThrow();
    });
  });

  describe('getProfile', () => {
    it('should return named profile', () => {
      const config: ExtendedConfig = {
        profiles: {
          fast: { timeout_ms: 5000, parallel: true },
        },
      };
      const profile = getProfile(config, 'fast');
      expect(profile?.timeout_ms).toBe(5000);
      expect(profile?.parallel).toBe(true);
    });

    it('should return undefined for missing profile', () => {
      expect(getProfile({}, 'missing')).toBeUndefined();
    });
  });

  describe('listProfiles', () => {
    it('should list all profile names', () => {
      const config: ExtendedConfig = {
        profiles: {
          fast: { timeout_ms: 5000 },
          slow: { timeout_ms: 30000 },
          debug: { timeout_ms: 60000 },
        },
      };
      const names = listProfiles(config);
      expect(names).toEqual(['fast', 'slow', 'debug']);
    });

    it('should return empty for no profiles', () => {
      expect(listProfiles({})).toEqual([]);
    });
  });
});
