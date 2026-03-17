/**
 * Tests for src/doctor.ts - System health checks
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkNodeVersion,
  checkTypeScript,
  checkApiKey,
  checkTestDirectory,
  checkConfigFile,
  runDoctor,
  formatDoctor,
} from '../src/doctor';

describe('Doctor', () => {
  describe('checkNodeVersion', () => {
    it('should return ok for current Node.js version', () => {
      // We're running on Node 24, should be ok
      const result = checkNodeVersion();
      expect(result.status).toBe('ok');
      expect(result.name).toBe('Node.js');
      expect(result.message).toContain(process.version);
    });
  });

  describe('checkTypeScript', () => {
    it('should return ok when TypeScript is installed', () => {
      // TypeScript is in devDependencies
      const result = checkTypeScript();
      expect(result.status).toBe('ok');
      expect(result.name).toBe('TypeScript');
    });
  });

  describe('checkApiKey', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return ok when env var is set', () => {
      process.env.TEST_API_KEY = 'sk-test123';
      const result = checkApiKey('Test Key', 'TEST_API_KEY', false);
      expect(result.status).toBe('ok');
      expect(result.message).toContain('TEST_API_KEY configured');
    });

    it('should return warn for optional missing key', () => {
      delete process.env.NONEXISTENT_KEY;
      const result = checkApiKey('Test Key', 'NONEXISTENT_KEY', false);
      expect(result.status).toBe('warn');
      expect(result.message).toContain('optional');
    });

    it('should return error for required missing key', () => {
      delete process.env.REQUIRED_KEY;
      const result = checkApiKey('Test Key', 'REQUIRED_KEY', true);
      expect(result.status).toBe('error');
      expect(result.message).not.toContain('optional');
    });
  });

  describe('checkTestDirectory', () => {
    it('should return ok for the project test directory', () => {
      const result = checkTestDirectory(path.resolve(__dirname, '..'));
      expect(result.status).toBe('ok');
      expect(result.message).toContain('Found');
    });

    it('should return warn when directory does not exist', () => {
      const result = checkTestDirectory('/nonexistent/path');
      expect(result.status).toBe('warn');
      expect(result.message).toContain('No tests/ directory');
    });
  });

  describe('checkConfigFile', () => {
    it('should return warn when config file does not exist', () => {
      const result = checkConfigFile('/nonexistent/path');
      expect(result.status).toBe('warn');
      expect(result.message).toContain('No .agentprobe/config.yml');
    });
  });

  describe('runDoctor', () => {
    it('should run all checks and return a result', () => {
      const result = runDoctor(path.resolve(__dirname, '..'));
      expect(result.checks.length).toBeGreaterThanOrEqual(4);
      expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(result.status);
      expect(typeof result.warnings).toBe('number');
      expect(typeof result.errors).toBe('number');
    });

    it('should use process.cwd() when no dir provided', () => {
      const result = runDoctor();
      expect(result.checks.length).toBeGreaterThanOrEqual(4);
    });

    it('should be UNHEALTHY when errors exist', () => {
      // If there are errors, status should be UNHEALTHY
      const result = runDoctor();
      if (result.errors > 0) {
        expect(result.status).toBe('UNHEALTHY');
      }
    });
  });

  describe('formatDoctor', () => {
    it('should format a healthy result', () => {
      const result = {
        checks: [
          { name: 'Node.js', status: 'ok' as const, message: 'v24.14.0' },
          { name: 'TypeScript', status: 'ok' as const, message: '5.3.3' },
        ],
        status: 'HEALTHY' as const,
        warnings: 0,
        errors: 0,
      };
      const output = formatDoctor(result);
      expect(output).toContain('🏥');
      expect(output).toContain('HEALTHY');
      expect(output).toContain('✅');
    });

    it('should format warnings and errors', () => {
      const result = {
        checks: [
          { name: 'Config', status: 'warn' as const, message: 'Not found', detail: 'Run init' },
          { name: 'API Key', status: 'error' as const, message: 'Missing' },
        ],
        status: 'UNHEALTHY' as const,
        warnings: 1,
        errors: 1,
      };
      const output = formatDoctor(result);
      expect(output).toContain('⚠️');
      expect(output).toContain('❌');
      expect(output).toContain('UNHEALTHY');
      expect(output).toContain('Run init');
      expect(output).toContain('1 warning');
      expect(output).toContain('1 error');
    });
  });
});
