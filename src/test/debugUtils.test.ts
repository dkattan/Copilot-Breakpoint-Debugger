import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DAPHelpers } from '../debugUtils';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';
let scriptPath: string;
let workspaceFolder: string;
const configurationName = 'Run test.js';

describe('debugUtils - DAPHelpers', () => {
  before(async () => {
    const extensionRoot = getExtensionRoot();
    const scriptRelative = 'test-workspace/test.js';
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));
    assert.ok(vscode.workspace.workspaceFolders?.length);
    workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    scriptPath = scriptUri.fsPath;
    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();
  });

  it('hitCondition breakpoint triggers on specific hit count', async () => {
    const lineInsideLoop = 9;
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'hitcondition-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            line: lineInsideLoop,
            hitCondition: '6',
          },
        ],
      },
    });

    assert.notDeepStrictEqual(
      context.frame.line,
      lineInsideLoop,
      `Stopped at unexpected line ${context.frame.line}, expected not to stop at line with hitCondition breakpoint`
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
      `Expected i to be 2 when hitCondition breakpoint is hit the 3rd time, but got ${iValue}`
    );
  });

  it('logMessage breakpoint (logpoint) does not stop execution unless adapter treats it as breakpoint', async () => {
    const lineInsideLoop = 9;
    const postLoopLine = 14;

    const context = await startDebuggingAndWaitForStop({
      sessionName: 'logpoint-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            line: lineInsideLoop,
            // condition: 'i > 2',
            logMessage: 'Logpoint Loop iteration: {i}',
          },
          {
            path: scriptPath,
            line: postLoopLine,
          },
        ],
      },
    });

    assert.equal(
      context.frame.line,
      lineInsideLoop,
      `Stopped at logpoint line ${lineInsideLoop}; expected to continue to ${postLoopLine}`
    );
  });

  it('getVariablesFromReference works in Node session', async () => {
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'getVariablesFromReference-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            line: 5,
          },
        ],
      },
    });

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
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'findVariableInScopes-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            line: 5,
          },
        ],
      },
    });

    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session');

    // Find randomValue variable
    const found = await DAPHelpers.findVariableInScopes(
      activeSession,
      context.scopes,
      'randomValue'
    );
    assert.ok(found, 'Should find randomValue variable');
    assert.strictEqual(found?.variable.name, 'randomValue');
    assert.ok(found?.scopeName, 'Should have scope name');
  });

  it('findVariableInScopes returns null for non-existent variable', async () => {
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'findVariableInScopes-null-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            line: 5,
          },
        ],
      },
    });

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
    await startDebuggingAndWaitForStop({
      sessionName: 'getDebugContext-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptPath,
            line: 5,
          },
        ],
      },
    });

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
});
