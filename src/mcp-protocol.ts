/**
 * MCP Protocol - JSON-RPC 2.0 over stdio for Model Context Protocol.
 *
 * Implements the low-level transport for MCP communication:
 * - Message framing (Content-Length headers)
 * - JSON-RPC request/response/notification
 * - Error codes per MCP spec
 */

// ===== Types =====

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: JSONRPCError;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// ===== Error Codes =====

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // MCP-specific
  ToolNotFound: -32001,
  ToolExecutionError: -32002,
  ServerNotInitialized: -32003,
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ===== Helpers =====

export function createRequest(id: string | number, method: string, params?: Record<string, any>): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) };
}

export function createResponse(id: string | number | null, result: any): JSONRPCResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createErrorResponse(id: string | number | null, code: number, message: string, data?: any): JSONRPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined && { data }) } };
}

export function createNotification(method: string, params?: Record<string, any>): JSONRPCNotification {
  return { jsonrpc: '2.0', method, ...(params !== undefined && { params }) };
}

/**
 * Encode a JSON-RPC message with Content-Length header for stdio transport.
 */
export function encodeMessage(msg: JSONRPCMessage): string {
  const body = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

/**
 * Parse incoming data stream, extracting complete JSON-RPC messages.
 * Returns parsed messages and any remaining buffer.
 */
export function parseMessages(buffer: string): { messages: JSONRPCMessage[]; remaining: string } {
  const messages: JSONRPCMessage[] = [];
  let remaining = buffer;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const headerEnd = remaining.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = remaining.substring(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Skip malformed header
      remaining = remaining.substring(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;

    if (remaining.length < bodyEnd) break; // incomplete

    const body = remaining.substring(bodyStart, bodyEnd);
    remaining = remaining.substring(bodyEnd);

    try {
      const parsed = JSON.parse(body);
      if (parsed.jsonrpc === '2.0') {
        messages.push(parsed);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return { messages, remaining };
}

/**
 * Validate a JSON-RPC request.
 */
export function validateRequest(msg: any): msg is JSONRPCRequest {
  return (
    msg &&
    msg.jsonrpc === '2.0' &&
    typeof msg.method === 'string' &&
    (msg.id !== undefined)
  );
}

/**
 * Check if a message is a notification (no id).
 */
export function isNotification(msg: any): msg is JSONRPCNotification {
  return msg && msg.jsonrpc === '2.0' && typeof msg.method === 'string' && msg.id === undefined;
}

/**
 * Check if a message is a response.
 */
export function isResponse(msg: any): msg is JSONRPCResponse {
  return msg && msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg);
}
