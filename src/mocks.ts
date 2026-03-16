/**
 * Tool Mocking System - Like Jest's jest.fn() for agent tools
 */

export interface ToolMock {
  name: string;
  handler: (args: Record<string, any>) => any;
  callCount: number;
  calls: Array<{ args: Record<string, any>; timestamp: string }>;
}

export class MockToolkit {
  private mocks = new Map<string, ToolMock>();

  /**
   * Mock a tool with a custom handler (or default no-op).
   */
  mock(toolName: string, handler?: (args: any) => any): ToolMock {
    const mock: ToolMock = {
      name: toolName,
      handler: handler ?? (() => ({})),
      callCount: 0,
      calls: [],
    };
    this.mocks.set(toolName, mock);
    return mock;
  }

  /**
   * Mock a tool to return a fixed response once, then passthrough.
   */
  mockOnce(toolName: string, response: any): ToolMock {
    let used = false;
    return this.mock(toolName, () => {
      if (!used) {
        used = true;
        return response;
      }
      return undefined;
    });
  }

  /**
   * Mock a tool to return responses in sequence.
   */
  mockSequence(toolName: string, responses: any[]): ToolMock {
    let idx = 0;
    return this.mock(toolName, () => {
      if (idx < responses.length) {
        return responses[idx++];
      }
      return undefined;
    });
  }

  /**
   * Mock a tool to throw an error.
   */
  mockError(toolName: string, error: string): ToolMock {
    return this.mock(toolName, () => {
      throw new Error(error);
    });
  }

  /**
   * Restore one or all mocks.
   */
  restore(toolName?: string): void {
    if (toolName) {
      this.mocks.delete(toolName);
    } else {
      this.mocks.clear();
    }
  }

  /**
   * Invoke a mock (used by the runner to intercept tool calls).
   */
  invoke(toolName: string, args: Record<string, any>): { mocked: boolean; result?: any } {
    const mock = this.mocks.get(toolName);
    if (!mock) return { mocked: false };

    mock.callCount++;
    mock.calls.push({ args, timestamp: new Date().toISOString() });
    const result = mock.handler(args);
    return { mocked: true, result };
  }

  hasMock(toolName: string): boolean {
    return this.mocks.has(toolName);
  }

  getCallCount(toolName: string): number {
    return this.mocks.get(toolName)?.callCount ?? 0;
  }

  getCalls(toolName: string): any[] {
    return this.mocks.get(toolName)?.calls ?? [];
  }

  getMockedTools(): string[] {
    return [...this.mocks.keys()];
  }
}
