import assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DAPHelpers } from '../debugUtils';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  assertPowerShellExtension,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Integration tests for multi-root workspace scenarios
// Tests individual workspaces (a: PowerShell, b: Node.js) and compound launch configs

/**
 * Collect all variables from all scopes in the current debug session
 */
async function collectAllVariables(
  activeSession: vscode.DebugSession,
  scopes: { name: string; variablesReference: number }[]
): Promise<{ name: string; value: string }[]> {
  const allVariables: { name: string; value: string }[] = [];
  for (const scope of scopes) {
    const vars = await DAPHelpers.getVariablesFromReference(
      activeSession,
      scope.variablesReference
    );
    allVariables.push(...vars);
  }
  return allVariables;
}

/**
 * Assert that specific variables are present in the collected variables
 */
function assertVariablesPresent(
  allVariables: { name: string; value: string }[],
  expectedVariables: string[]
): void {
  // Check that expected variables are present
  for (const varName of expectedVariables) {
    const found = allVariables.some(
      v => v.name === varName || v.name.includes(varName)
    );
    assert.ok(
      found,
      `Expected variable '${varName}' to be present in: ${JSON.stringify(
        allVariables.map(v => v.name)
      )}`
    );
  }
}

describe('multi-Root Workspace Integration', () => {
  // NOTE: These tests are currently SKIPPED due to how VS Code's test runner handles multi-root workspaces.
  //
  // Discovery: VS Code test runner spawns TWO separate extension host processes:
  // 1. Process 1 - Always has 1 workspace folder (the project root)
  // 2. Process 2 - Always has 3 workspace folders (the multi-root workspace)
  //
  // Both processes run the test suite. The `before` hook detects which process it's running in
  // and skips all tests in Process 1 (wrong workspace), while Process 2 would have the correct
  // workspace setup. Currently, tests are also individually skipped pending further work.
  //
  // The workspace configuration is static per process - determined at startup, not dynamically loaded.
  // Therefore, no polling/waiting is needed - we can immediately check the workspace state.
  //
  // Related GitHub issues:
  // - microsoft/vscode-test#38: Multi-root requires VS Code reload, difficult in tests
  // - microsoft/vscode-test#79: Workspace settings not always respected
  //
  // The tests remain in the codebase as documentation of the intended multi-root functionality.

  before(function () {
    // Log test host information to understand which process we're in
    console.log('=== Multi-root Workspace Test Host Info ===');
    console.log('Process ID:', process.pid);
    console.log('Process title:', process.title);
    console.log('VS Code version:', vscode.version);
    console.log('VS Code app name:', vscode.env.appName);
    console.log('VS Code remote name:', vscode.env.remoteName || 'local');
    console.log(
      'Initial workspace folders:',
      vscode.workspace.workspaceFolders?.length || 0
    );
    if (vscode.workspace.workspaceFolders) {
      console.log(
        'Initial folders:',
        vscode.workspace.workspaceFolders.map(f => ({
          name: f.name,
          path: f.uri.fsPath,
        }))
      );
    }
    console.log('==========================================');

    // Check workspace folders immediately - no polling needed
    // We discovered that VS Code spawns 2 extension host processes:
    // - Process 1: Always has 1 folder (project root) - we skip tests here
    // - Process 2: Always has 3 folders (multi-root workspace) - tests would run here
    // The workspace state is determined at process startup, no waiting required.

    assert.ok(
      vscode.workspace.workspaceFolders?.length,
      'No workspace folders found. Ensure test-workspace.code-workspace is being loaded by the test runner.'
    );

    // Check if we have the multi-root workspace (3 folders)
    if (vscode.workspace.workspaceFolders.length < 3) {
      const foldersFound = vscode.workspace.workspaceFolders.map(f => ({
        name: f.name,
        path: f.uri.fsPath,
      }));
      console.warn(
        `Running in test host without multi-root workspace. ` +
          `Expected 3 folders, got ${vscode.workspace.workspaceFolders.length}. ` +
          `Folders found: ${JSON.stringify(foldersFound)}\n` +
          `All multi-root workspace tests will be skipped in this host.`
      );
      // Skip all tests in this suite since we're in the wrong test host
      this.skip();
      return;
    }

    // Verify we have exactly 3 workspace folders
    assert.strictEqual(
      vscode.workspace.workspaceFolders.length,
      3,
      `Expected 3 workspace folders from test-workspace.code-workspace, got ${vscode.workspace.workspaceFolders.length}`
    );

    console.log(
      'Multi-root workspace loaded successfully with folders:',
      vscode.workspace.workspaceFolders.map(f => f.name)
    );
  });

  it('workspace A (PowerShell) - individual debug session', async function () {
    // Skip PowerShell tests in CI - they require PowerShell runtime
    if (process.env.CI) {
      console.log(
        'Skipping PowerShell workspace test in CI (use Node.js tests for coverage)'
      );
      this.skip();
      return;
    }

    this.timeout(5000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/a/test.ps1')
    );
    // Use workspace-a folder specifically
    const workspaceFolder =
      vscode.workspace.workspaceFolders!.find(f => f.name === 'workspace-a')
        ?.uri.fsPath || vscode.workspace.workspaceFolders![1].uri.fsPath;

    await openScriptDocument(scriptUri);
    await assertPowerShellExtension();
    await activateCopilotDebugger();

    const configurationName = 'Run a/test.ps1';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'workspace-a-pwsh',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: 1,
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      1,
      `Expected to stop at line 1, but stopped at line ${context.frame.line}`
    );

    // Assert the file path contains the expected file
    assert.ok(
      context.frame.source?.path?.includes('test.ps1'),
      `Expected file path to contain 'test.ps1', got: ${context.frame.source?.path}`
    );

    // Collect variables from scopes using active session
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session after breakpoint hit');

    const allVariables = await collectAllVariables(
      activeSession,
      context.scopes
    );

    // Verify that we got the expected variables
    assertVariablesPresent(allVariables, ['PWD', 'HOME']);
  });

  it('workspace B (Node.js) - individual debug session', async function () {
    this.timeout(5000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/b/test.js')
    );
    // Use workspace-b folder specifically
    const workspaceFolder =
      vscode.workspace.workspaceFolders!.find(f => f.name === 'workspace-b')
        ?.uri.fsPath || vscode.workspace.workspaceFolders![2].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run b/test.js';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'workspace-b-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: 1,
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      1,
      `Expected to stop at line 1, but stopped at line ${context.frame.line}`
    );

    // Assert the file path contains the expected file
    assert.ok(
      context.frame.source?.path?.includes('test.js'),
      `Expected file path to contain 'test.js', got: ${context.frame.source?.path}`
    );

    // Collect variables from scopes using active session
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session after breakpoint hit');

    const allVariables = await collectAllVariables(
      activeSession,
      context.scopes
    );

    // Verify that we got the expected variables
    assertVariablesPresent(allVariables, ['randomValue']);
  });

  it('workspace A with conditional breakpoint (PowerShell)', async function () {
    // Skip PowerShell tests in CI - they require PowerShell runtime
    if (process.env.CI) {
      console.log(
        'Skipping PowerShell conditional breakpoint test in CI (use Node.js tests for coverage)'
      );
      this.skip();
      return;
    }

    this.timeout(5000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/a/test.ps1')
    );
    // Use workspace-a folder specifically
    const workspaceFolder =
      vscode.workspace.workspaceFolders!.find(f => f.name === 'workspace-a')
        ?.uri.fsPath || vscode.workspace.workspaceFolders![1].uri.fsPath;

    await openScriptDocument(scriptUri);
    await assertPowerShellExtension();
    await activateCopilotDebugger();

    const configurationName = 'Run a/test.ps1';
    const condition = '$i -ge 3';
    const lineInsideLoop = 8;

    const context = await startDebuggingAndWaitForStop({
      sessionName: 'workspace-a-conditional-pwsh',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: lineInsideLoop,
            condition,
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      lineInsideLoop,
      `Expected to stop at line ${lineInsideLoop}, but stopped at line ${context.frame.line}`
    );

    // Collect variables from scopes using active session
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session after breakpoint hit');

    const allVariables = await collectAllVariables(
      activeSession,
      context.scopes
    );

    // Verify we got the variable 'i' and that its value is >= 3
    const iVariable = allVariables.find(v => v.name === 'i' || v.name === '$i');
    assert.ok(iVariable, "Variable 'i' should be present");
    const iValue = Number.parseInt(iVariable.value, 10);
    assert.ok(
      iValue >= 3,
      `Conditional breakpoint should stop when i >= 3, but i = ${iValue}`
    );
  });

  it('workspace B with conditional breakpoint (Node.js)', async function () {
    this.timeout(5000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/b/test.js')
    );
    // Use workspace-b folder specifically
    const workspaceFolder =
      vscode.workspace.workspaceFolders!.find(f => f.name === 'workspace-b')
        ?.uri.fsPath || vscode.workspace.workspaceFolders![2].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run b/test.js';
    const condition = 'i >= 3';
    const lineInsideLoop = 9;

    const context = await startDebuggingAndWaitForStop({
      sessionName: 'workspace-b-conditional-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: lineInsideLoop,
            condition,
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      lineInsideLoop,
      `Expected to stop at line ${lineInsideLoop}, but stopped at line ${context.frame.line}`
    );

    // Collect variables from scopes using active session
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session after breakpoint hit');

    const allVariables = await collectAllVariables(
      activeSession,
      context.scopes
    );

    // Verify we got the variable 'i' and that its value is >= 3
    const iVariable = allVariables.find(v => v.name === 'i');
    assert.ok(iVariable, "Variable 'i' should be present");
    const iValue = Number.parseInt(iVariable.value, 10);
    assert.ok(
      iValue >= 3,
      `Conditional breakpoint should stop when i >= 3, but i = ${iValue}`
    );
  });
});
