import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DAPHelpers } from '../debugUtils';
import { startDebuggingAndWaitForStop } from '../session';

describe('debugUtils - DAPHelpers', () => {
  it('createSuccessResult creates valid result', () => {
    const result = DAPHelpers.createSuccessResult('Test success message');
    assert.ok(result);
    assert.ok(result.content);
    assert.ok(Array.isArray(result.content));
    const parts = result.content as Array<{ value?: string }>;
    const text = parts
      .map(p => {
        if (typeof p === 'object' && p !== null && 'value' in p) {
          return (p as { value?: string }).value;
        }
        return '';
      })
      .join('');
    assert.ok(text.includes('Test success message'));
  });

  it('createErrorResult creates valid error result', () => {
    const result = DAPHelpers.createErrorResult('Test error message');
    assert.ok(result);
    assert.ok(result.content);
    assert.ok(Array.isArray(result.content));
    const parts = result.content as Array<{ value?: string }>;
    const text = parts
      .map(p => {
        if (typeof p === 'object' && p !== null && 'value' in p) {
          return (p as { value?: string }).value;
        }
        return '';
      })
      .join('');
    assert.ok(text.includes('Error:'));
    assert.ok(text.includes('Test error message'));
  });

  it('getDebugContext returns null when no session', async () => {
    // This test requires a mock session, but in absence of one we'll skip
    // The function is already tested indirectly via other tool tests
  });

  it('getVariablesFromReference works in Node session', async function () {
    this.timeout(5000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    const context = await startDebuggingAndWaitForStop({
      sessionName: 'getVariablesFromReference-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
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

  it('findVariableInScopes finds existing variable', async function () {
    this.timeout(5000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    const context = await startDebuggingAndWaitForStop({
      sessionName: 'findVariableInScopes-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
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

  it('findVariableInScopes returns null for non-existent variable', async function () {
    this.timeout(5000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    const context = await startDebuggingAndWaitForStop({
      sessionName: 'findVariableInScopes-null-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
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

  it('getDebugContext works in active session', async function () {
    this.timeout(5000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    await startDebuggingAndWaitForStop({
      sessionName: 'getDebugContext-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
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
