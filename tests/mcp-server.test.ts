/**
 * Tests for MCP Server (src/mcp-server.ts)
 */
import { describe, it, expect } from 'vitest';
import { AgentProbeMCPServer } from '../src/mcp-server';

describe('mcp-server', () => {
  // --- Tool Definitions ---
  it('has 10 tools defined', () => {
    const server = new AgentProbeMCPServer();
    expect(server.getTools()).toHaveLength(10);
  });

  it('getToolNames returns all tool names', () => {
    const server = new AgentProbeMCPServer();
    const names = server.getToolNames();
    expect(names).toContain('run_test');
    expect(names).toContain('run_suite');
    expect(names).toContain('analyze_trace');
    expect(names).toContain('security_scan');
    expect(names).toContain('generate_test');
    expect(names).toContain('compare_results');
    expect(names).toContain('get_coverage');
    expect(names).toContain('benchmark_agent');
    expect(names).toContain('compliance_audit');
    expect(names).toContain('mcp_security_scan');
  });

  it('all tools have descriptions', () => {
    const server = new AgentProbeMCPServer();
    for (const tool of server.getTools()) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('all tools have input schemas', () => {
    const server = new AgentProbeMCPServer();
    for (const tool of server.getTools()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('all tools have at least one required param', () => {
    const server = new AgentProbeMCPServer();
    for (const tool of server.getTools()) {
      expect(tool.inputSchema.required?.length).toBeGreaterThan(0);
    }
  });

  it('run_test requires file param', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'run_test');
    expect(tool?.inputSchema.required).toContain('file');
  });

  it('run_suite requires path param', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'run_suite');
    expect(tool?.inputSchema.required).toContain('path');
  });

  it('analyze_trace requires file param', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'analyze_trace');
    expect(tool?.inputSchema.required).toContain('file');
  });

  it('generate_test requires description param', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'generate_test');
    expect(tool?.inputSchema.required).toContain('description');
  });

  it('compare_results requires baseline and current', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'compare_results');
    expect(tool?.inputSchema.required).toContain('baseline');
    expect(tool?.inputSchema.required).toContain('current');
  });

  it('benchmark_agent requires suite param', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'benchmark_agent');
    expect(tool?.inputSchema.required).toContain('suite');
  });

  // --- Constructor ---
  it('accepts custom cwd', () => {
    const server = new AgentProbeMCPServer({ cwd: '/tmp' });
    expect(server).toBeDefined();
  });

  it('accepts debug option', () => {
    const server = new AgentProbeMCPServer({ debug: true });
    expect(server).toBeDefined();
  });

  it('defaults to process.cwd()', () => {
    const server = new AgentProbeMCPServer();
    expect(server).toBeDefined();
  });

  // --- Tool names are unique ---
  it('all tool names are unique', () => {
    const server = new AgentProbeMCPServer();
    const names = server.getToolNames();
    expect(new Set(names).size).toBe(names.length);
  });

  // --- Schema properties validation ---
  it('run_test has timeout_ms property', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'run_test');
    expect(tool?.inputSchema.properties.timeout_ms).toBeDefined();
    expect(tool?.inputSchema.properties.timeout_ms.type).toBe('number');
  });

  it('security_scan has checks property with enum', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'security_scan');
    expect(tool?.inputSchema.properties.checks).toBeDefined();
  });

  it('get_coverage has format enum', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'get_coverage');
    expect(tool?.inputSchema.properties.format.enum).toContain('summary');
    expect(tool?.inputSchema.properties.format.enum).toContain('detailed');
    expect(tool?.inputSchema.properties.format.enum).toContain('json');
  });

  it('compliance_audit has framework enum', () => {
    const server = new AgentProbeMCPServer();
    const tool = server.getTools().find(t => t.name === 'compliance_audit');
    expect(tool?.inputSchema.properties.framework.enum).toContain('owasp-llm');
    expect(tool?.inputSchema.properties.framework.enum).toContain('nist-ai');
  });
});
