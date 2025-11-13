import assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GetVariablesTool } from '../getVariablesTool';
import { startDebuggingAndWaitForStop } from '../session';

describe('getVariablesTool', () => {
  it('prepareInvocation returns correct message', async () => {
    const tool = new GetVariablesTool();

    const maybePrepared = tool.prepareInvocation?.({
      input: {},
    });

    const prepared = await Promise.resolve(maybePrepared);
    const invocationMessage =
      typeof prepared?.invocationMessage === 'string'
        ? prepared.invocationMessage
        : prepared?.invocationMessage?.value;
    assert.ok(
      invocationMessage?.includes('variables'),
      'Should mention variables in message'
    );
  });

  it('getVariables throws error when no session', async () => {
    const tool = new GetVariablesTool();
    // Ensure no active session
    if (vscode.debug.activeDebugSession) {
      // Skip test if there's an active session from previous tests
      return;
    }
    await assert.rejects(
      async () => await tool.getVariables(),
      /No active debug session|Unable to get debug context/,
      'Should throw error when no active session'
    );
  });

  it('get all variables in Node session', async function () {
    this.timeout(5000);
    // Start a Node debug session hitting a breakpoint in test.js
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    await startDebuggingAndWaitForStop({
      sessionName: 'get-variables-node',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
            line: 5, // after randomValue assignment
          },
        ],
      },
    });
    // Get all variables using structured method
    const getVarsTool = new GetVariablesTool();
    const variablesData = await getVarsTool.getVariables();

    // Test structured output directly - no regex needed!
    assert.strictEqual(variablesData.type, 'variables', 'Should have type');
    assert.ok(variablesData.sessionId, 'Should have sessionId');
    assert.ok(Array.isArray(variablesData.scopes), 'Should have scopes array');
    assert.ok(
      variablesData.scopes.length > 0,
      'Should have at least one scope'
    );

    // Check that we got some variables
    const allVariables = variablesData.scopes.flatMap(s => s.variables);
    assert.ok(
      allVariables.length > 0,
      'Should have at least one variable in scopes'
    );
  });

  it('get variables in PowerShell session', async function () {
    this.timeout(5000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const ps1Path = path.join(extensionRoot, 'test-workspace/test.ps1');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    await startDebuggingAndWaitForStop({
      sessionName: 'get-variables-powershell',
      workspaceFolder,
      nameOrConfiguration: 'Run test.ps1',
      breakpointConfig: {
        breakpoints: [
          {
            path: ps1Path,
            line: 4,
          },
        ],
      },
    });
    // Get all variables using structured method
    const getVarsTool = new GetVariablesTool();
    const variablesData = await getVarsTool.getVariables();

    // Test structured output directly - no regex needed!
    assert.strictEqual(variablesData.type, 'variables', 'Should have type');
    assert.ok(Array.isArray(variablesData.scopes), 'Should have scopes');
    assert.ok(
      variablesData.scopes.length > 0,
      'Should have at least one scope'
    );
  });
});
