import * as vscode from 'vscode';
import * as path from 'path';
import { StartDebuggerTool } from '../startDebuggerTool';
import {
  getExtensionRoot,
  ensurePowerShellExtension,
  activateCopilotDebugger,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Integration tests for multi-root workspace scenarios
// Tests individual workspaces (a: PowerShell, b: Node.js) and compound launch configs

suite('Multi-Root Workspace Integration', () => {
  test('workspace A (PowerShell) - individual debug session', async function () {
    // Skip PowerShell tests in CI - they require PowerShell runtime
    if (process.env.CI) {
      console.log(
        'Skipping PowerShell workspace test in CI (use Node.js tests for coverage)'
      );
      this.skip();
      return;
    }

    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/a/test.ps1')
    );
    const workspaceFolder = path.join(extensionRoot, 'test-workspace/a');

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
        timeout_seconds: 60,
        variableFilter: ['PWD', 'HOME'],
        breakpointConfig: {
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

    const parts: any[] = (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Workspace A (PowerShell) output:\n', textOutput);

    // Verify the debug session stopped
    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (/Error starting debug session/i.test(textOutput)) {
      throw new Error('Encountered error starting debug session');
    }
    if (!/(Debug session .* stopped|breakpoint)/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }

    // Verify we're in the correct file
    if (!/test\.ps1/i.test(textOutput)) {
      throw new Error('Debug session did not stop in test.ps1');
    }
  });

  test('workspace B (Node.js) - individual debug session', async function () {
    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/b/test.js')
    );
    const workspaceFolder = path.join(extensionRoot, 'test-workspace/b');

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['randomValue'],
        breakpointConfig: {
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

    const parts: any[] = (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Workspace B (Node.js) output:\n', textOutput);

    // Verify the debug session stopped
    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (/Error starting debug session/i.test(textOutput)) {
      throw new Error('Encountered error starting debug session');
    }
    if (!/(Debug session .* stopped|breakpoint)/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }

    // Verify we're in the correct file
    if (!/test\.js/i.test(textOutput)) {
      throw new Error('Debug session did not stop in test.js');
    }
  });

  test('workspace A with conditional breakpoint (PowerShell)', async function () {
    // Skip PowerShell tests in CI - they require PowerShell runtime
    if (process.env.CI) {
      console.log(
        'Skipping PowerShell conditional breakpoint test in CI (use Node.js tests for coverage)'
      );
      this.skip();
      return;
    }

    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/a/test.ps1')
    );
    const workspaceFolder = path.join(extensionRoot, 'test-workspace/a');

    await openScriptDocument(scriptUri);
    const hasPowerShell = await ensurePowerShellExtension();
    if (!hasPowerShell) {
      this.skip();
      return;
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set conditional breakpoint in loop
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i'],
        breakpointConfig: {
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

    const parts: any[] = (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Workspace A conditional breakpoint output:\n', textOutput);

    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (!/(Debug session .* stopped|breakpoint)/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }
  });

  test('workspace B with conditional breakpoint (Node.js)', async function () {
    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/b/test.js')
    );
    const workspaceFolder = path.join(extensionRoot, 'test-workspace/b');

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set conditional breakpoint in loop
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i'],
        breakpointConfig: {
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

    const parts: any[] = (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Workspace B conditional breakpoint output:\n', textOutput);

    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (!/(Debug session .* stopped|breakpoint)/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }
  });
});
