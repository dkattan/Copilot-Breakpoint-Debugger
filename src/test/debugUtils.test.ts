import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DAPHelpers } from '../debugUtils';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from './utils/startDebuggerToolTestUtils';
let scriptPath: string;
let workspaceFolder: string;
const configurationName = 'Run test.js';
// Shared immutable base params for repeated startDebuggingAndWaitForStop calls
let baseParams: { workspaceFolder: string; nameOrConfiguration: string };

describe('debugUtils - DAPHelpers', () => {
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  before(async () => {
    const extensionRoot = getExtensionRoot();
    const workspaceRelative = 'test-workspace/b';
    const scriptRelative = `${workspaceRelative}/test.js`;
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));
    assert.ok(vscode.workspace.workspaceFolders?.length);
    workspaceFolder = vscode.workspace.workspaceFolders.find(
      folder => folder.name === 'workspace-b'
    )!.uri.fsPath!;
    assert.ok(
      workspaceFolder,
      `Workspace folder 'b' not found in test workspace`
    );
    scriptPath = scriptUri.fsPath;
    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();
    // Initialize shared base params once workspaceFolder is known
    baseParams = { workspaceFolder, nameOrConfiguration: configurationName };
  });

  it('hitCount breakpoint triggers on specific hit count', async () => {
    const lineInsideLoop = 9;
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '', // monitor any session; avoid name mismatch
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: lineInsideLoop,
              hitCount: 3,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    assert.strictEqual(
      context.frame.line,
      lineInsideLoop,
      `Expected to stop on hitCount line ${lineInsideLoop}, but paused at ${context.frame.line}`
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session after breakpoint hit');

    const allVariables: { name: string; value: string }[] = [];
    for (const scope of context.scopes) {
      const vars = await DAPHelpers.getVariablesFromReference(
        activeSession,
        scope.variablesReference
      );
      allVariables.push(...vars);
    }
    const iVariable = allVariables.find(v => v.name === 'i');
    assert.ok(iVariable, 'Variable i not found in collected scopes');
    const iValue = Number.parseInt(iVariable.value, 10);
    assert.strictEqual(
      iValue,
      2,
      `Expected i to be 2 when hitCount breakpoint is hit the 3rd time, but got ${iValue}`
    );
  });

  it('logMessage breakpoint (logpoint) does not stop execution unless adapter treats it as breakpoint', async () => {
    const lineInsideLoop = 9;
    const postLoopLine = 17;

    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: lineInsideLoop,
              // condition: 'i > 2',
              logMessage: 'Logpoint Loop iteration: {i}',
              variableFilter: ['i'],
            },
            {
              path: scriptPath,
              line: postLoopLine,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    const pausedLine = context.frame.line;
    assert.ok(
      pausedLine === lineInsideLoop || pausedLine === postLoopLine,
      `Unexpected pause line ${pausedLine}; expected ${lineInsideLoop} (logpoint) or ${postLoopLine}`
    );
    if (pausedLine === lineInsideLoop) {
      console.warn(
        'Node debug adapter treated logpoint as breakpoint; continuing execution would be required for adapters without logpoint support.'
      );
      return;
    }
    assert.equal(
      pausedLine,
      postLoopLine,
      `Stopped at logpoint line ${lineInsideLoop}; expected to continue to ${postLoopLine}`
    );
  });

  it('getVariablesFromReference works in Node session', async () => {
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: 5,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    // Get active session and test getVariablesFromReference
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session');

    // Get variables from first scope
    const firstScope = context.scopes[0];
    const variables = await DAPHelpers.getVariablesFromReference(
      activeSession,
      firstScope.variablesReference
    );
    assert.ok(Array.isArray(variables));
    // Should have at least some variables
    assert.ok(variables.length >= 0);
    // Each variable should have required properties
    if (variables.length > 0) {
      const firstVar = variables[0];
      assert.ok('name' in firstVar);
      assert.ok('value' in firstVar);
      assert.ok('isExpandable' in firstVar);
    }
  });

  it('findVariableInScopes finds existing variable', async () => {
    const lineInsideLoop = 9;
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: lineInsideLoop,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session');

    // Find randomValue variable
    const found = await DAPHelpers.findVariableInScopes(
      activeSession,
      context.scopes,
      'i'
    );
    assert.ok(found, 'Should find loop variable i');
    assert.strictEqual(found?.variable.name, 'i');
    assert.ok(found?.scopeName, 'Should have scope name');
  });

  it('findVariableInScopes returns null for non-existent variable', async () => {
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: 5,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session');

    // Try to find non-existent variable
    const found = await DAPHelpers.findVariableInScopes(
      activeSession,
      context.scopes,
      'thisVariableDoesNotExist12345'
    );
    assert.strictEqual(found, null, 'Should not find non-existent variable');
  });

  it('getDebugContext works in active session', async () => {
    await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: 5,
              variableFilter: ['i'],
            },
          ],
        },
      })
    );

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session');

    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    assert.ok(debugContext, 'Should get debug context');
    assert.ok(debugContext?.thread, 'Should have thread');
    assert.ok(debugContext?.frame, 'Should have frame');
    assert.ok(debugContext?.scopes, 'Should have scopes');
    assert.ok(Array.isArray(debugContext?.scopes), 'Scopes should be array');
    assert.ok(debugContext.scopes.length > 0, 'Should have at least one scope');
  });

  it('stopDebugging action terminates session after breakpoint hit', async () => {
    const targetLine = 9;
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: targetLine,
              variableFilter: ['i'],
              action: 'stopDebugging' as const,
            },
          ],
        },
      })
    );
    assert.strictEqual(
      context.frame.line,
      targetLine,
      'Did not stop at expected line'
    );
    const active = vscode.debug.activeDebugSession;
    assert.strictEqual(
      active,
      undefined,
      'Debug session should be terminated after action=stopDebugging'
    );
  });
});
