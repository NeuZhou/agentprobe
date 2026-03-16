import * as vscode from 'vscode';

export class StatusBarManager {
  public readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'agentprobe.runTests';
    this.setIdle();
    this.item.show();
  }

  setIdle() {
    this.item.text = '$(beaker) AgentProbe';
    this.item.tooltip = 'Click to run tests';
    this.item.backgroundColor = undefined;
  }

  setRunning() {
    this.item.text = '$(sync~spin) AgentProbe: Running...';
    this.item.tooltip = 'Tests are running';
    this.item.backgroundColor = undefined;
  }

  setResult(passed: number, failed: number) {
    if (failed === 0) {
      this.item.text = `$(pass) AgentProbe: ${passed} passed`;
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `$(error) AgentProbe: ${failed} failed`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    this.item.tooltip = `Passed: ${passed}, Failed: ${failed}`;
  }

  setError() {
    this.item.text = '$(warning) AgentProbe: Error';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  dispose() {
    this.item.dispose();
  }
}
