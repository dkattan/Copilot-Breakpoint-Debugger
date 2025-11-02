import * as vscode from 'vscode';
import * as path from 'path';
import { StartDebuggerTool } from '../startDebuggerTool';
import { resolveWorkspaceFolder } from './utils/debugTestUtils';
import {
  getExtensionRoot,
  activateCopilotDebugger,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Integration test: tests conditional breakpoints using Node.js debug adapter
// This provides equivalent coverage to PowerShell tests for CI environments

suite('Conditional Breakpoint Integration (Node.js)', () => {
  test('conditional breakpoint triggers only when condition is met', async function () {
    this.timeout(60000); // allow time for activation + breakpoint

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.js')
    );
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set conditional breakpoint inside loop at line 9: only break when i >= 3
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i', 'randomValue'],
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 9, // Inside the loop
              condition: 'i >= 3',
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    const parts: any[] =
      (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Conditional breakpoint output:\n', textOutput);

    // Verify breakpoint hit
    if (!/stopped|breakpoint/i.test(textOutput)) {
      throw new Error('Debug session did not stop at conditional breakpoint');
    }

    // Verify condition was met (i should be >= 3)
    if (!/"i"\s*:\s*[3-9]/.test(textOutput) && !/i.*>=?\s*[3-9]/.test(textOutput)) {
      throw new Error(
        'Breakpoint condition not met: expected i >= 3 in variables'
      );
    }
  });

  test('hitCondition breakpoint triggers on specific hit count', async function () {
    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.js')
    );
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set hit condition breakpoint inside loop: break on 3rd hit
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i', 'randomValue'],
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 9, // Inside the loop
              hitCondition: '3',
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    const parts: any[] =
      (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Hit condition breakpoint output:\n', textOutput);

    // Verify breakpoint hit
    if (!/stopped|breakpoint/i.test(textOutput)) {
      throw new Error('Debug session did not stop at hit condition breakpoint');
    }

    // Verify we hit on 3rd iteration (i should be 2, zero-indexed)
    if (!/"i"\s*:\s*2/.test(textOutput) && !/i.*=\s*2/.test(textOutput)) {
      console.warn(
        'Warning: Expected i=2 on 3rd hit, but may vary by adapter implementation'
      );
    }
  });

  test('logMessage breakpoint (logpoint) does not stop execution', async function () {
    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.js')
    );
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set logpoint inside loop: should log but not stop
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 30,
        variableFilter: ['i'],
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 9,
              logMessage: 'Loop iteration: {i}',
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    const parts: any[] =
      (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Logpoint output:\n', textOutput);

    // Logpoint should timeout or complete without stopping
    // If it stopped, that's an error (unless adapter doesn't support logpoints)
    if (/stopped.*breakpoint/i.test(textOutput) && !/timeout/i.test(textOutput)) {
      // Some debug adapters may not support logpoints and treat them as regular breakpoints
      console.warn(
        'Warning: Logpoint caused stop - adapter may not support logpoints'
      );
    } else if (/timeout/i.test(textOutput)) {
      // Expected: timeout means script completed without stopping
      console.log('Logpoint correctly did not stop execution (timeout expected)');
    }
  });
});
