import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from './utils/startDebuggerToolTestUtils';

/**
 * Auto-selection logic test:
 * Verifies that when NO configuration name is provided, NO defaultLaunchConfiguration is set,
 * and EXACTLY ONE launch configuration exists for the workspace folder, the debugger starts
 * using that sole configuration without error.
 */
describe('auto-select sole launch configuration', () => {
  const originalLaunchConfigs: vscode.DebugConfiguration[] = [];
  let originalDefaultSetting: string | undefined;
  let workspaceFolderPath: string;
  let folder: vscode.WorkspaceFolder | undefined;

  before(async () => {
    const extensionRoot = getExtensionRoot();
    workspaceFolderPath = path.join(extensionRoot, 'test-workspace', 'b');
    // Find the VS Code workspace folder object that matches path '.../test-workspace/b'
    folder = vscode.workspace.workspaceFolders?.find(f => {
      const normalized = path
        .normalize(f.uri.fsPath)
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
      const target = path
        .normalize(workspaceFolderPath)
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
      return normalized === target;
    });
    assert.ok(
      folder,
      'workspace-b folder should be present for auto-selection test'
    );

    // Capture original launch configurations & default setting (scoped to folder)
    const launchConfig = vscode.workspace.getConfiguration(
      'launch',
      folder.uri
    );
    const configs =
      (launchConfig.get<unknown>(
        'configurations'
      ) as vscode.DebugConfiguration[]) || [];
    originalLaunchConfigs.push(...configs);
    // Acquire workspace-level setting (not folder scoped) for defaultLaunchConfiguration
    const settings = vscode.workspace.getConfiguration('copilot-debugger');
    originalDefaultSetting = settings.get<string>('defaultLaunchConfiguration');
  });

  after(async () => {
    // Restore original launch configurations & default setting
    if (folder) {
      const launchConfig = vscode.workspace.getConfiguration(
        'launch',
        folder.uri
      );
      await launchConfig.update(
        'configurations',
        originalLaunchConfigs,
        vscode.ConfigurationTarget.WorkspaceFolder
      );
      const settings = vscode.workspace.getConfiguration('copilot-debugger');
      await settings.update(
        'defaultLaunchConfiguration',
        originalDefaultSetting,
        vscode.ConfigurationTarget.Workspace
      );
    }
  });

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it('auto-selects sole launch configuration when none specified', async () => {
    assert.ok(folder, 'workspace-b folder must be resolved');

    const settings = vscode.workspace.getConfiguration('copilot-debugger');
    // Clear defaultLaunchConfiguration at workspace scope so auto-selection branch can trigger
    await settings.update(
      'defaultLaunchConfiguration',
      '',
      vscode.ConfigurationTarget.Workspace
    );

    const launchConfig = vscode.workspace.getConfiguration(
      'launch',
      folder!.uri
    );
    const singleConfig: vscode.DebugConfiguration | undefined =
      originalLaunchConfigs.find(c => c.name === 'Run test.js');
    assert.ok(
      singleConfig,
      "Expected to find existing 'Run test.js' configuration"
    );

    // Replace configurations with only the single Node.js config
    await launchConfig.update(
      'configurations',
      [singleConfig!],
      vscode.ConfigurationTarget.WorkspaceFolder
    );

    // Open target script & activate extension
    const scriptUri = vscode.Uri.file(
      path.join(workspaceFolderPath, 'test.js')
    );
    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    // Invoke underlying start logic WITHOUT providing nameOrConfiguration to trigger auto-select
    const lineInsideLoop = 9;
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'auto-select-test',
      workspaceFolder: workspaceFolderPath,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: lineInsideLoop,
            variableFilter: ['i'],
          },
        ],
      },
    });

    // Assert we stopped at expected breakpoint line
    assert.strictEqual(
      context.frame.line,
      lineInsideLoop,
      'Did not stop at expected breakpoint line'
    );

    // Ensure active debug session is present and its configuration name matches the auto-selected one
    const active = vscode.debug.activeDebugSession;
    assert.ok(
      active,
      'Active debug session should exist after auto-selection start'
    );
    // VS Code may decorate session name (e.g., add PID). Validate underlying configuration program points to test.js
    const programPath = String(active!.configuration.program || '');
    assert.ok(
      /test\.js$/i.test(programPath) || /test\.js/i.test(active!.name),
      `Expected auto-selected configuration program to reference test.js, got program='${programPath}' name='${active!.name}'`
    );
  });
});
