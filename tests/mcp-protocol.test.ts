/**
 * Tests for MCP Protocol (src/mcp-protocol.ts)
 */
import { describe, it, expect } from 'vitest';
import {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  encodeMessage,
  parseMessages,
  validateRequest,
  isNotification,
  isResponse,
  ErrorCodes,
} from '../src/mcp-protocol';

describe('mcp-protocol', () => {
  // --- createRequest ---
  it('creates a valid JSON-RPC request', () => {
    const req = createRequest(1, 'tools/list');
    expect(req.jsonrpc).toBe('2.0');
    expect(req.id).toBe(1);
    expect(req.method).toBe('tools/list');
  });

  it('creates request with params', () => {
    const req = createRequest('abc', 'tools/call', { name: 'run_test' });
    expect(req.params).toEqual({ name: 'run_test' });
  });

  it('omits params when undefined', () => {
    const req = createRequest(1, 'ping');
    expect('params' in req).toBe(false);
  });

  // --- createResponse ---
  it('creates a valid response', () => {
    const res = createResponse(1, { tools: [] });
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result).toEqual({ tools: [] });
  });

  // --- createErrorResponse ---
  it('creates error response with code and message', () => {
    const res = createErrorResponse(1, ErrorCodes.MethodNotFound, 'not found');
    expect(res.error?.code).toBe(-32601);
    expect(res.error?.message).toBe('not found');
  });

  it('creates error response with data', () => {
    const res = createErrorResponse(1, -32600, 'bad', { detail: 'x' });
    expect(res.error?.data).toEqual({ detail: 'x' });
  });

  // --- createNotification ---
  it('creates a notification without id', () => {
    const n = createNotification('notifications/initialized');
    expect(n.jsonrpc).toBe('2.0');
    expect(n.method).toBe('notifications/initialized');
    expect('id' in n).toBe(false);
  });

  // --- encodeMessage ---
  it('encodes message with Content-Length header', () => {
    const msg = createRequest(1, 'ping');
    const encoded = encodeMessage(msg);
    expect(encoded).toContain('Content-Length:');
    expect(encoded).toContain('\r\n\r\n');
    const body = encoded.split('\r\n\r\n')[1];
    expect(JSON.parse(body).method).toBe('ping');
  });

  it('Content-Length matches byte length', () => {
    const msg = createRequest(1, 'test', { emoji: '🎉' });
    const encoded = encodeMessage(msg);
    const match = encoded.match(/Content-Length:\s*(\d+)/);
    const body = encoded.split('\r\n\r\n')[1];
    expect(parseInt(match![1])).toBe(Buffer.byteLength(body));
  });

  // --- parseMessages ---
  it('parses a single complete message', () => {
    const msg = createRequest(1, 'ping');
    const encoded = encodeMessage(msg);
    const { messages, remaining } = parseMessages(encoded);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
    expect(remaining).toBe('');
  });

  it('parses multiple messages', () => {
    const m1 = createRequest(1, 'a');
    const m2 = createRequest(2, 'b');
    const encoded = encodeMessage(m1) + encodeMessage(m2);
    const { messages } = parseMessages(encoded);
    expect(messages).toHaveLength(2);
  });

  it('returns remaining buffer for incomplete message', () => {
    const msg = createRequest(1, 'ping');
    const encoded = encodeMessage(msg);
    const partial = encoded.substring(0, encoded.length - 5);
    const { messages, remaining } = parseMessages(partial);
    expect(messages).toHaveLength(0);
    expect(remaining.length).toBeGreaterThan(0);
  });

  it('handles empty buffer', () => {
    const { messages, remaining } = parseMessages('');
    expect(messages).toHaveLength(0);
    expect(remaining).toBe('');
  });

  it('skips malformed JSON', () => {
    const bad = 'Content-Length: 3\r\n\r\n{x}';
    const { messages } = parseMessages(bad);
    expect(messages).toHaveLength(0);
  });

  // --- validateRequest ---
  it('validates a proper request', () => {
    expect(validateRequest({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(true);
  });

  it('rejects request without method', () => {
    expect(validateRequest({ jsonrpc: '2.0', id: 1 })).toBe(false);
  });

  it('rejects null', () => {
    expect(validateRequest(null)).toBeFalsy();
  });

  // --- isNotification ---
  it('identifies notification (no id)', () => {
    expect(isNotification({ jsonrpc: '2.0', method: 'notify' })).toBe(true);
  });

  it('rejects request as notification', () => {
    expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
  });

  // --- isResponse ---
  it('identifies response with result', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
  });

  it('identifies error response', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true);
  });

  it('rejects request as response', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
  });

  // --- ErrorCodes ---
  it('has standard JSON-RPC error codes', () => {
    expect(ErrorCodes.ParseError).toBe(-32700);
    expect(ErrorCodes.InvalidRequest).toBe(-32600);
    expect(ErrorCodes.MethodNotFound).toBe(-32601);
    expect(ErrorCodes.InvalidParams).toBe(-32602);
    expect(ErrorCodes.InternalError).toBe(-32603);
  });

  it('has MCP-specific error codes', () => {
    expect(ErrorCodes.ToolNotFound).toBe(-32001);
    expect(ErrorCodes.ToolExecutionError).toBe(-32002);
    expect(ErrorCodes.ServerNotInitialized).toBe(-32003);
  });
});
