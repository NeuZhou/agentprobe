/**
 * MCP Config Generator - Generate MCP client configuration for popular AI clients.
 *
 * Supports: Claude Desktop, Cursor, OpenClaw, and generic stdio config.
 */

export type MCPClientType = 'claude' | 'cursor' | 'openclaw' | 'generic';

export interface MCPConfigOptions {
  /** Name for the MCP server entry */
  name?: string;
  /** Path to agentprobe binary (default: npx @neuzhou/agentprobe) */
  command?: string;
  /** Additional arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

export interface MCPClientConfig {
  client: MCPClientType;
  config: Record<string, any>;
  filePath: string;
  instructions: string;
}

const DEFAULT_NAME = 'agentprobe';
const DEFAULT_COMMAND = 'npx';
const DEFAULT_ARGS = ['@neuzhou/agentprobe', 'mcp', 'serve'];

function getServerEntry(opts: MCPConfigOptions): Record<string, any> {
  const command = opts.command ?? DEFAULT_COMMAND;
  const args = opts.args ?? DEFAULT_ARGS;
  const entry: Record<string, any> = { command, args };
  if (opts.env && Object.keys(opts.env).length > 0) entry.env = opts.env;
  if (opts.cwd) entry.cwd = opts.cwd;
  return entry;
}

/**
 * Generate Claude Desktop MCP configuration.
 */
export function generateClaudeConfig(opts: MCPConfigOptions = {}): MCPClientConfig {
  const name = opts.name ?? DEFAULT_NAME;
  return {
    client: 'claude',
    config: {
      mcpServers: {
        [name]: getServerEntry(opts),
      },
    },
    filePath: process.platform === 'win32'
      ? '%APPDATA%\\Claude\\claude_desktop_config.json'
      : '~/Library/Application Support/Claude/claude_desktop_config.json',
    instructions: [
      `Add the following to your Claude Desktop config:`,
      ``,
      `1. Open Claude Desktop → Settings → Developer → Edit Config`,
      `2. Add the "agentprobe" entry under "mcpServers"`,
      `3. Restart Claude Desktop`,
    ].join('\n'),
  };
}

/**
 * Generate Cursor MCP configuration.
 */
export function generateCursorConfig(opts: MCPConfigOptions = {}): MCPClientConfig {
  const name = opts.name ?? DEFAULT_NAME;
  return {
    client: 'cursor',
    config: {
      mcpServers: {
        [name]: getServerEntry(opts),
      },
    },
    filePath: '.cursor/mcp.json',
    instructions: [
      `Add the following to your Cursor MCP config:`,
      ``,
      `1. Create .cursor/mcp.json in your project root`,
      `2. Paste the config below`,
      `3. Reload Cursor`,
    ].join('\n'),
  };
}

/**
 * Generate OpenClaw MCP configuration.
 */
export function generateOpenClawConfig(opts: MCPConfigOptions = {}): MCPClientConfig {
  const name = opts.name ?? DEFAULT_NAME;
  return {
    client: 'openclaw',
    config: {
      tools: {
        [name]: {
          type: 'mcp',
          ...getServerEntry(opts),
        },
      },
    },
    filePath: 'openclaw.config.json',
    instructions: [
      `Add the following to your OpenClaw config:`,
      ``,
      `1. Add the tool entry to your openclaw.config.json`,
      `2. Restart OpenClaw gateway`,
    ].join('\n'),
  };
}

/**
 * Generate generic stdio MCP configuration.
 */
export function generateGenericConfig(opts: MCPConfigOptions = {}): MCPClientConfig {
  const name = opts.name ?? DEFAULT_NAME;
  return {
    client: 'generic',
    config: {
      [name]: {
        transport: 'stdio',
        ...getServerEntry(opts),
      },
    },
    filePath: 'mcp-config.json',
    instructions: [
      `Generic MCP stdio configuration:`,
      ``,
      `Use this with any MCP-compatible client.`,
      `The server communicates via JSON-RPC 2.0 over stdin/stdout.`,
    ].join('\n'),
  };
}

/**
 * Generate MCP config for a specific client.
 */
export function generateMCPConfig(client: MCPClientType, opts: MCPConfigOptions = {}): MCPClientConfig {
  switch (client) {
    case 'claude': return generateClaudeConfig(opts);
    case 'cursor': return generateCursorConfig(opts);
    case 'openclaw': return generateOpenClawConfig(opts);
    case 'generic': return generateGenericConfig(opts);
    default: throw new Error(`Unknown MCP client: ${client}`);
  }
}

/**
 * Format MCP config for display.
 */
export function formatMCPConfig(config: MCPClientConfig): string {
  const lines: string[] = [];
  lines.push(`\n🔧 MCP Configuration for ${config.client}`);
  lines.push('='.repeat(40));
  lines.push(config.instructions);
  lines.push('');
  lines.push(`Config file: ${config.filePath}`);
  lines.push('');
  lines.push(JSON.stringify(config.config, null, 2));
  return lines.join('\n');
}

/** List supported MCP clients. */
export function listMCPClients(): MCPClientType[] {
  return ['claude', 'cursor', 'openclaw', 'generic'];
}
