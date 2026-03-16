/**
 * Tests for MCP Config Generator (src/mcp-config.ts)
 */
import { describe, it, expect } from 'vitest';
import {
  generateMCPConfig,
  generateClaudeConfig,
  generateCursorConfig,
  generateOpenClawConfig,
  generateGenericConfig,
  formatMCPConfig,
  listMCPClients,
} from '../src/mcp-config';

describe('mcp-config', () => {
  // --- listMCPClients ---
  it('lists all supported clients', () => {
    const clients = listMCPClients();
    expect(clients).toContain('claude');
    expect(clients).toContain('cursor');
    expect(clients).toContain('openclaw');
    expect(clients).toContain('generic');
    expect(clients).toHaveLength(4);
  });

  // --- Claude config ---
  it('generates Claude Desktop config with defaults', () => {
    const config = generateClaudeConfig();
    expect(config.client).toBe('claude');
    expect(config.config.mcpServers.agentprobe).toBeDefined();
    expect(config.config.mcpServers.agentprobe.command).toBe('npx');
    expect(config.config.mcpServers.agentprobe.args).toContain('@neuzhou/agentprobe');
  });

  it('generates Claude config with custom name', () => {
    const config = generateClaudeConfig({ name: 'myprobe' });
    expect(config.config.mcpServers.myprobe).toBeDefined();
  });

  it('Claude config has correct file path', () => {
    const config = generateClaudeConfig();
    expect(config.filePath).toContain('Claude');
  });

  // --- Cursor config ---
  it('generates Cursor config', () => {
    const config = generateCursorConfig();
    expect(config.client).toBe('cursor');
    expect(config.filePath).toBe('.cursor/mcp.json');
    expect(config.config.mcpServers.agentprobe).toBeDefined();
  });

  // --- OpenClaw config ---
  it('generates OpenClaw config', () => {
    const config = generateOpenClawConfig();
    expect(config.client).toBe('openclaw');
    expect(config.config.tools.agentprobe.type).toBe('mcp');
  });

  // --- Generic config ---
  it('generates generic config', () => {
    const config = generateGenericConfig();
    expect(config.client).toBe('generic');
    expect(config.config.agentprobe.transport).toBe('stdio');
  });

  // --- generateMCPConfig dispatcher ---
  it('dispatches to correct generator', () => {
    expect(generateMCPConfig('claude').client).toBe('claude');
    expect(generateMCPConfig('cursor').client).toBe('cursor');
    expect(generateMCPConfig('openclaw').client).toBe('openclaw');
    expect(generateMCPConfig('generic').client).toBe('generic');
  });

  it('throws on unknown client', () => {
    expect(() => generateMCPConfig('unknown' as any)).toThrow('Unknown MCP client');
  });

  // --- Custom options ---
  it('passes custom command', () => {
    const config = generateClaudeConfig({ command: '/usr/local/bin/agentprobe' });
    expect(config.config.mcpServers.agentprobe.command).toBe('/usr/local/bin/agentprobe');
  });

  it('passes env vars', () => {
    const config = generateCursorConfig({ env: { API_KEY: 'test' } });
    expect(config.config.mcpServers.agentprobe.env.API_KEY).toBe('test');
  });

  it('passes cwd', () => {
    const config = generateGenericConfig({ cwd: '/projects/myagent' });
    expect(config.config.agentprobe.cwd).toBe('/projects/myagent');
  });

  it('omits env when empty', () => {
    const config = generateClaudeConfig();
    expect(config.config.mcpServers.agentprobe.env).toBeUndefined();
  });

  // --- formatMCPConfig ---
  it('formats config with client name and JSON', () => {
    const config = generateClaudeConfig();
    const formatted = formatMCPConfig(config);
    expect(formatted).toContain('claude');
    expect(formatted).toContain('mcpServers');
    expect(formatted).toContain('agentprobe');
  });
});
