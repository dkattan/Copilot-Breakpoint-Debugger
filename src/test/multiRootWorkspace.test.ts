import type { Variable } from '../debugUtils';
import type { DebugInfo, StartDebugSessionResult } from '../session';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { StartDebuggerTool } from '../startDebuggerTool';
import {
  activateCopilotDebugger,
  ensurePowerShellExtension,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Integration tests for multi-root workspace scenarios
// Tests individual workspaces (a: PowerShell, b: Node.js) and compound launch configs

/**
 * Extract structured debug info from tool result
 */
function extractDebugInfo(
  result: vscode.LanguageModelToolResult
): StartDebugSessionResult {
  // eslint-disable-next-line ts/no-explicit-any
  const rawResult = (result as any).__rawResult as StartDebugSessionResult;
  if (!rawResult) {
    throw new Error('No raw result attached to tool result');
  }
  return rawResult;
}

/**
 * Flatten variables from all scopes into a single array
 */
function flattenVariables(debugInfo: DebugInfo): Variable[] {
  if (!debugInfo.variables) {
    return [];
  }
  return debugInfo.variables.flatMap(scope => scope.variables);
}

/**
 * Assert that the debug session stopped successfully at a breakpoint
 */
function assertSuccessfulBreakpointHit(
  result: StartDebugSessionResult,
  expectedFile: string,
  expectedLine?: number
): DebugInfo {
  // Check that it's not an error
  assert.strictEqual(
    result.isError,
    false,
    'Debug session should not have errored'
  );

  // Check we have content
  assert.ok(result.content.length > 0, 'Result should have content');

  // First content should be text describing the stop
  const firstContent = result.content[0];
  assert.strictEqual(firstContent.type, 'text', 'First content should be text');
  assert.ok(
    firstContent.text,
    'First content should have text describing the stop'
  );

  // Should not be a timeout
  assert.ok(
    !firstContent.text.includes('timed out'),
    'Debug session should not have timed out'
  );

  // Should indicate it stopped
  assert.ok(
    /stopped at|stopped successfully/i.test(firstContent.text),
    `Expected stop message, got: ${firstContent.text}`
  );

  // Second content should be JSON with debug info
  const secondContent = result.content[1];
  assert.strictEqual(
    secondContent.type,
    'json',
    'Second content should be JSON'
  );
  assert.ok(secondContent.json, 'Second content should have json property');

  const debugInfo = secondContent.json as DebugInfo;

  // Validate breakpoint info structure
  assert.ok(debugInfo.breakpoint, 'Should have breakpoint info');
  assert.strictEqual(
    debugInfo.breakpoint.reason,
    'breakpoint',
    'Should have stopped at a breakpoint'
  );

  // Validate file path
  if (expectedFile) {
    assert.ok(
      debugInfo.breakpoint.filePath,
      'Should have file path in breakpoint info'
    );
    assert.ok(
      debugInfo.breakpoint.filePath.includes(expectedFile),
      `Expected file path to contain '${expectedFile}', got: ${debugInfo.breakpoint.filePath}`
    );
  }

  // Validate line number if provided
  if (expectedLine !== undefined) {
    assert.strictEqual(
      debugInfo.breakpoint.line,
      expectedLine,
      `Expected to stop at line ${expectedLine}, got: ${debugInfo.breakpoint.line}`
    );
  }

  // Validate we have call stack
  assert.ok(debugInfo.callStack, 'Should have call stack data');

  return debugInfo;
}

/**
 * Assert that specific variables are present in the debug info
 */
function assertVariablesPresent(
  debugInfo: DebugInfo,
  expectedVariables: string[]
): void {
  if (debugInfo.variablesError) {
    assert.fail(
      `Variables should be available, but got error: ${debugInfo.variablesError}`
    );
  }

  assert.ok(debugInfo.variables, 'Should have variables data');

  // Flatten variables from all scopes
  const allVariables = flattenVariables(debugInfo);

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

    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is being loaded by the test runner.'
      );
    }

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

    this.timeout(90000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/a/test.ps1')
    );
    // Use workspace-a folder specifically
    const workspaceFolder = vscode.workspace.workspaceFolders!.find(
      f => f.name === 'workspace-a'
    )?.uri.fsPath || vscode.workspace.workspaceFolders![1].uri.fsPath;

    await openScriptDocument(scriptUri);
    const hasPowerShell = await ensurePowerShellExtension();
    if (!hasPowerShell) {
      this.skip();
      return;
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['PWD', 'HOME'],
        configurationName: 'Run a/test.ps1',
        breakpointConfig: {
          disableExisting: true,
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 1,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    // Extract and validate structured output
    const structuredResult = extractDebugInfo(result);
    const debugInfo = assertSuccessfulBreakpointHit(
      structuredResult,
      'test.ps1',
      1
    );

    // Verify that the variable filter worked and we got the expected variables
    assertVariablesPresent(debugInfo, ['PWD', 'HOME']);
  });

  it('workspace B (Node.js) - individual debug session', async function () {
    this.timeout(90000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/b/test.js')
    );
    // Use workspace-b folder specifically
    const workspaceFolder = vscode.workspace.workspaceFolders!.find(
      f => f.name === 'workspace-b'
    )?.uri.fsPath || vscode.workspace.workspaceFolders![2].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['randomValue'],
        configurationName: 'Run b/test.js',
        breakpointConfig: {
          disableExisting: true,
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 1,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    // Extract and validate structured output
    const structuredResult = extractDebugInfo(result);
    const debugInfo = assertSuccessfulBreakpointHit(
      structuredResult,
      'test.js',
      1
    );

    // Verify that the variable filter worked and we got the expected variables
    assertVariablesPresent(debugInfo, ['randomValue']);
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

    this.timeout(90000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/a/test.ps1')
    );
    // Use workspace-a folder specifically
    const workspaceFolder = vscode.workspace.workspaceFolders!.find(
      f => f.name === 'workspace-a'
    )?.uri.fsPath || vscode.workspace.workspaceFolders![1].uri.fsPath;

    await openScriptDocument(scriptUri);
    const hasPowerShell = await ensurePowerShellExtension();
    if (!hasPowerShell) {
      this.skip();
      return;
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set conditional breakpoint in loop that should trigger when $i >= 3
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['i'],
        configurationName: 'Run a/test.ps1',
        breakpointConfig: {
          disableExisting: true,
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 8,
              condition: '$i -ge 3',
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    // Extract and validate structured output
    const structuredResult = extractDebugInfo(result);
    const debugInfo = assertSuccessfulBreakpointHit(
      structuredResult,
      'test.ps1',
      8
    );

    // Verify we got the variable 'i' and that its value is >= 3
    assertVariablesPresent(debugInfo, ['i']);

    // Verify the condition worked - i should be >= 3
    const allVariables = flattenVariables(debugInfo);
    const iVariable = allVariables.find(v => v.name === 'i' || v.name === '$i');
    assert.ok(iVariable, "Variable 'i' should be present");
    const iValue = Number.parseInt(iVariable.value, 10);
    assert.ok(
      iValue >= 3,
      `Conditional breakpoint should stop when i >= 3, but i = ${iValue}`
    );
  });

  it('workspace B with conditional breakpoint (Node.js)', async function () {
    this.timeout(90000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/b/test.js')
    );
    // Use workspace-b folder specifically
    const workspaceFolder = vscode.workspace.workspaceFolders!.find(
      f => f.name === 'workspace-b'
    )?.uri.fsPath || vscode.workspace.workspaceFolders![2].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set conditional breakpoint in loop that should trigger when i >= 3
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['i'],
        configurationName: 'Run b/test.js',
        breakpointConfig: {
          disableExisting: true,
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 9,
              condition: 'i >= 3',
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    // Extract and validate structured output
    const structuredResult = extractDebugInfo(result);
    const debugInfo = assertSuccessfulBreakpointHit(
      structuredResult,
      'test.js',
      9
    );

    // Verify we got the variable 'i' and that its value is >= 3
    assertVariablesPresent(debugInfo, ['i']);

    // Verify the condition worked - i should be >= 3
    const allVariables = flattenVariables(debugInfo);
    const iVariable = allVariables.find(v => v.name === 'i');
    assert.ok(iVariable, "Variable 'i' should be present");
    const iValue = Number.parseInt(iVariable.value, 10);
    assert.ok(
      iValue >= 3,
      `Conditional breakpoint should stop when i >= 3, but i = ${iValue}`
    );
  });
});
