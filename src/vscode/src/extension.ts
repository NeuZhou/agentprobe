import * as vscode from 'vscode';
import { TestResultTreeProvider } from './treeProvider';
import { StatusBarManager } from './statusBar';
import * as path from 'path';

let statusBar: StatusBarManager;
let treeProvider: TestResultTreeProvider;

export function activate(context: vscode.ExtensionContext) {
  statusBar = new StatusBarManager();
  treeProvider = new TestResultTreeProvider();

  vscode.window.registerTreeDataProvider('agentprobeResults', treeProvider);

  // Command: Run Tests
  const runTests = vscode.commands.registerCommand('agentprobe.runTests', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor — open a test suite file first.');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    statusBar.setRunning();

    const terminal = vscode.window.createTerminal('AgentProbe');
    terminal.show();
    terminal.sendText(`npx agentprobe run "${filePath}" --format json --output .agentprobe-results.json`);

    // Watch for results file
    const watcher = vscode.workspace.createFileSystemWatcher('**/.agentprobe-results.json');
    const disposable = watcher.onDidChange(async (uri) => {
      try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const results = JSON.parse(Buffer.from(raw).toString('utf-8'));
        treeProvider.refresh(results);
        const passed = results.passed ?? 0;
        const failed = results.failed ?? 0;
        statusBar.setResult(passed, failed);
        if (failed > 0) {
          vscode.window.showWarningMessage(`AgentProbe: ${failed} test(s) failed.`);
        } else {
          vscode.window.showInformationMessage(`AgentProbe: All ${passed} tests passed!`);
        }
      } catch {
        statusBar.setError();
      }
      disposable.dispose();
      watcher.dispose();
    });

    context.subscriptions.push(disposable, watcher);
  });

  // Command: View Trace
  const viewTrace = vscode.commands.registerCommand('agentprobe.viewTrace', async () => {
    const files = await vscode.workspace.findFiles('**/*.trace.json', '**/node_modules/**', 20);
    if (files.length === 0) {
      vscode.window.showInformationMessage('No trace files found.');
      return;
    }

    const items = files.map(f => ({
      label: path.basename(f.fsPath),
      description: vscode.workspace.asRelativePath(f),
      uri: f,
    }));

    const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a trace file' });
    if (!selected) return;

    const doc = await vscode.workspace.openTextDocument(selected.uri);
    await vscode.window.showTextDocument(doc);
  });

  // Command: Generate Test
  const generateTest = vscode.commands.registerCommand('agentprobe.generateTest', async () => {
    const description = await vscode.window.showInputBox({
      prompt: 'Describe the test scenario',
      placeHolder: 'e.g., Agent should search for weather and return temperature',
    });
    if (!description) return;

    const terminal = vscode.window.createTerminal('AgentProbe');
    terminal.show();
    terminal.sendText(`npx agentprobe generate "${description}"`);
  });

  context.subscriptions.push(runTests, viewTrace, generateTest, statusBar.item);
}

export function deactivate() {
  statusBar?.dispose();
}
