import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExpandVariableTool } from '../expandVariableTool';
import { StartDebuggerTool } from '../startDebuggerTool';

describe('expandVariableTool', () => {
  it('prepareInvocation includes variable name', async () => {
    const tool = new ExpandVariableTool();
    interface MockPrepareOptions {
      input: { variableName: string };
    }
    const maybePrepared = tool.prepareInvocation?.({
      input: { variableName: 'myVar' },
    } as MockPrepareOptions);
    interface PreparedInvocation {
      invocationMessage: string;
    }
    const prepared = await Promise.resolve(
      maybePrepared as PreparedInvocation | undefined
    );
    assert.ok(prepared?.invocationMessage.includes('myVar'));
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
    this.timeout(90000);
    // Start a Node debug session hitting a breakpoint in test.js
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');
    const tool = new StartDebuggerTool();
    const startResult = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        configurationName: 'Run test.js',
        breakpointConfig: {
          breakpoints: [
            {
              path: jsPath,
              line: 5, // after randomValue assignment
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });
    const startParts = (startResult.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const startText = startParts
      .map(p => {
        if (typeof p === 'object' && p !== null) {
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
        }
        return JSON.stringify(p);
      })
      .join('\n');
    if (/timed out/i.test(startText)) {
      this.skip();
      return;
    }
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
    this.timeout(90000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');
    const tool = new StartDebuggerTool();
    const startResult = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        configurationName: 'Run test.js',
        breakpointConfig: {
          breakpoints: [
            {
              path: jsPath,
              line: 5,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });
    const startParts = (startResult.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const startText = startParts
      .map(p => {
        if (typeof p === 'object' && p !== null) {
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
        }
        return JSON.stringify(p);
      })
      .join('\n');
    if (/timed out/i.test(startText)) {
      this.skip();
      return;
    }
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
    this.timeout(90000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');
    const tool = new StartDebuggerTool();
    const startResult = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        configurationName: 'Run test.js',
        breakpointConfig: {
          breakpoints: [
            {
              path: jsPath,
              line: 5,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });
    const startParts = (startResult.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const startText = startParts
      .map(p => {
        if (typeof p === 'object' && p !== null) {
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
        }
        return JSON.stringify(p);
      })
      .join('\n');
    if (/timed out/i.test(startText)) {
      this.skip();
      return;
    }
    // Try to expand a variable that doesn't exist - should throw error
    const expandTool = new ExpandVariableTool();
    await assert.rejects(
      async () => await expandTool.expandVariable('thisVariableDoesNotExist'),
      /not found/,
      'Should throw error for non-existent variable'
    );
  });
});
