import * as vscode from 'vscode';

export interface TestResultData {
  name: string;
  passed: number;
  failed: number;
  total: number;
  results: Array<{
    name: string;
    passed: boolean;
    duration_ms: number;
    error?: string;
  }>;
}

export class TestResultItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly testPassed?: boolean,
    public readonly duration?: number,
    public readonly error?: string,
  ) {
    super(label, collapsibleState);
    if (testPassed !== undefined) {
      this.iconPath = new vscode.ThemeIcon(
        testPassed ? 'pass' : 'error',
        testPassed
          ? new vscode.ThemeColor('testing.iconPassed')
          : new vscode.ThemeColor('testing.iconFailed'),
      );
      this.description = `${duration ?? 0}ms`;
      if (error) {
        this.tooltip = error;
      }
    }
  }
}

export class TestResultTreeProvider implements vscode.TreeDataProvider<TestResultItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TestResultItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private data: TestResultData | null = null;

  refresh(data: TestResultData) {
    this.data = data;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TestResultItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TestResultItem): TestResultItem[] {
    if (!this.data) return [];

    if (!element) {
      // Root: show summary + each test
      const summary = new TestResultItem(
        `${this.data.passed}/${this.data.total} passed`,
        vscode.TreeItemCollapsibleState.None,
      );
      summary.iconPath = new vscode.ThemeIcon(
        this.data.failed === 0 ? 'pass-filled' : 'error',
      );

      const tests = this.data.results.map(
        r => new TestResultItem(
          r.name,
          vscode.TreeItemCollapsibleState.None,
          r.passed,
          r.duration_ms,
          r.error,
        ),
      );

      return [summary, ...tests];
    }

    return [];
  }
}
