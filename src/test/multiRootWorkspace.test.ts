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

function flattenScopeVariables(
  scopeVariables?: {
    scopeName: string;
    variables: { name: string; value: string }[];
  }[]
): { name: string; value: string }[] {
  if (!scopeVariables?.length) {
    return [];
  }
  const flattened: { name: string; value: string }[] = [];
  for (const scope of scopeVariables) {
    for (const variable of scope.variables) {
      flattened.push({ name: variable.name, value: variable.value });
    }
  }
  return flattened;
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
      (v) => v.name === varName || v.name.includes(varName)
    );
    assert.ok(
      found,
      `Expected variable '${varName}' to be present in: ${JSON.stringify(
        allVariables.map((v) => v.name)
      )}`
    );
  }
}

describe('multi-Root Workspace Integration', () => {
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  before(() => {
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
        vscode.workspace.workspaceFolders.map((f) => ({
          name: f.name,
          path: f.uri.fsPath,
        }))
      );
    }
    console.log('==========================================');

    assert.ok(
      vscode.workspace.workspaceFolders?.length,
      'No workspace folders found. Ensure test-workspace.code-workspace is being loaded by the test runner.'
    );
    assert.equal(
      vscode.workspace.name,
      'test-workspace (Workspace)',
      'Unexpected workspace name, should at least have (Workspace) to indicate a .code-workspace is open'
    );
  });

  it('workspace B (Node.js) - individual debug session', async function () {
    // This is typically fast, but can exceed 60s when running after other debug-heavy tests.
    this.timeout(120_000);

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, 'test-workspace', 'b');
    const scriptUri = vscode.Uri.file(path.join(workspaceFolder, 'test.js'));
    const bpSnippet = 'Loop iteration';

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const doc = await vscode.workspace.openTextDocument(scriptUri);
    const expectedLine =
      doc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes(bpSnippet)) + 1;
    assert.ok(expectedLine > 0, 'Expected breakpoint snippet to exist in test.js');

    const configurationName = 'Run test.js';
    const baseParams = {
      workspaceFolder,
      nameOrConfiguration: configurationName,
    };

    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: 'workspace-b-node',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              code: bpSnippet,
              onHit: 'break' as const,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      expectedLine,
      `Expected to stop at line ${expectedLine}, but stopped at line ${context.frame.line}`
    );

    // Assert the file path contains the expected file
    assert.ok(
      context.frame.source?.path?.includes('test.js'),
      `Expected file path to contain 'test.js', got: ${context.frame.source?.path}`
    );

    const preCollected = flattenScopeVariables(context.scopeVariables);
    assert.ok(
      preCollected.length,
      'Expected variables to be pre-collected in scopeVariables'
    );
    const allVariables = preCollected;

    // Verify that we got the expected variables
    assertVariablesPresent(allVariables, ['i']);
  });

  it('workspace B with conditional breakpoint (Node.js)', async function () {
    // This test is fast in isolation, but under full-suite load VS Code's debug adapter
    // startup + initial stop/continue hop can occasionally push beyond 60s on CI.
    this.timeout(120_000);

    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, 'test-workspace', 'b');
    const scriptUri = vscode.Uri.file(path.join(workspaceFolder, 'test.js'));

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run test.js';
    const baseParams = {
      workspaceFolder,
      nameOrConfiguration: configurationName,
    };
    const condition = 'i >= 3';
    const bpSnippet = 'Loop iteration';
    const doc = await vscode.workspace.openTextDocument(scriptUri);
    const expectedLine =
      doc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes(bpSnippet)) + 1;
    assert.ok(expectedLine > 0, 'Expected breakpoint snippet to exist in test.js');

    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: 'workspace-b-conditional-node',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              code: bpSnippet,
              condition,
              onHit: 'break' as const,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      expectedLine,
      `Expected to stop at line ${expectedLine}, but stopped at line ${context.frame.line}`
    );

    const preCollected = flattenScopeVariables(context.scopeVariables);
    assert.ok(
      preCollected.length,
      'Expected variables to be pre-collected in scopeVariables'
    );
    const allVariables = preCollected;

    // Verify we got the variable 'i' and that its value is >= 3
    const iVariable = allVariables.find((v) => v.name === 'i');
    assert.ok(iVariable, "Variable 'i' should be present");
    const iValue = Number.parseInt(iVariable.value, 10);
    assert.ok(
      iValue >= 3,
      `Conditional breakpoint should stop when i >= 3, but i = ${iValue}`
    );
  });
});
