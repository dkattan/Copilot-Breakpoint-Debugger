import assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExpandVariableTool } from '../expandVariableTool';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

describe('expandVariableTool', () => {
  it('prepareInvocation includes variable name', async () => {
    const tool = new ExpandVariableTool();
    const maybePrepared = tool.prepareInvocation
      ? tool.prepareInvocation({
          input: { variableName: 'myVar' },
        })
      : undefined;

    const prepared = await Promise.resolve(maybePrepared);
    const invocationMessage =
      typeof prepared?.invocationMessage === 'string'
        ? prepared.invocationMessage
        : prepared?.invocationMessage?.value;
    assert.ok(
      invocationMessage?.includes('myVar'),
      'Invocation message should include variable name'
    );
  });

  it('expandVariable throws error for invalid variable', async () => {
    const tool = new ExpandVariableTool();
    // This will throw if no session OR if variable not found
    await assert.rejects(
      async () => await tool.expandVariable('foo'),
      /No active debug session|not found|Unable to get debug context/,
      'Should throw error for invalid variable or no session'
    );
  });

  it('expand variable in Node session', async function () {
    this.timeout(5000);
    // Start a Node debug session hitting a breakpoint in test.js
    const extensionRoot = getExtensionRoot();
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const scriptUri = vscode.Uri.file(jsPath);

    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run test.js';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'expand-var-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
            line: 5, // after randomValue assignment
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      5,
      'Should stop at line 5'
    );

    // Expand a variable (like 'process' which should be expandable)
    const expandTool = new ExpandVariableTool();
    const expandedData = await expandTool.expandVariable('process');

    // Test structured output directly - no regex needed!
    assert.ok(expandedData.variable, 'Should have variable');
    assert.strictEqual(
      expandedData.variable.name,
      'process',
      'Variable name should be process'
    );
    assert.ok(
      Array.isArray(expandedData.children),
      'Should have children array'
    );
    // process is expandable, so should have children
    if (expandedData.variable.isExpandable) {
      assert.ok(
        expandedData.children.length > 0,
        'Expandable variable should have children'
      );
    }
  });

  it('expand non-expandable variable in Node session', async function () {
    this.timeout(5000);
    const extensionRoot = getExtensionRoot();
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const scriptUri = vscode.Uri.file(jsPath);

    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run test.js';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'expand-non-expandable-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
            line: 5,
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      5,
      'Should stop at line 5'
    );

    // Expand randomValue which is a simple number
    const expandTool = new ExpandVariableTool();
    const expandedData = await expandTool.expandVariable('randomValue');

    // Test structured output directly - no regex needed!
    assert.ok(expandedData.variable, 'Should have variable');
    assert.strictEqual(
      expandedData.variable.name,
      'randomValue',
      'Variable name should be randomValue'
    );
    assert.ok(
      Array.isArray(expandedData.children),
      'Should have children array'
    );
    // randomValue is a simple number, not expandable
    assert.strictEqual(
      expandedData.variable.isExpandable,
      false,
      'randomValue should not be expandable'
    );
    assert.strictEqual(
      expandedData.children.length,
      0,
      'Non-expandable variable should have empty children'
    );
  });

  it('expandVariable throws error for non-existent variable', async function () {
    this.timeout(5000);
    const extensionRoot = getExtensionRoot();
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const scriptUri = vscode.Uri.file(jsPath);

    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run test.js';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'expand-non-existent-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
            line: 5,
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    assert.strictEqual(
      context.frame.line,
      5,
      'Should stop at line 5'
    );

    // Try to expand a variable that doesn't exist - should throw error
    const expandTool = new ExpandVariableTool();
    await assert.rejects(
      async () => await expandTool.expandVariable('thisVariableDoesNotExist'),
      /not found/,
      'Should throw error for non-existent variable'
    );
  });
});
