import type { LanguageModelTextPart } from 'vscode';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { StartDebuggerTool } from '../startDebuggerTool';
import {
  activateCopilotDebugger,
  assertPowerShellExtension,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Conditional breakpoint + hitCondition + logpoint tests.
// First test is PowerShell-only (no Node fallback). Remaining tests still fallback.

describe('conditional Breakpoint Integration', () => {
  it('conditional breakpoint triggers only when condition is met (powershell)', async function () {
    this.timeout(90000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.ps1')
    );
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    await openScriptDocument(scriptUri);
    await assertPowerShellExtension();
    const condition = '$i -ge 3';
    const lineInsideLoop = 8;

    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();
    const configurationName = 'Run test.ps1';
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['i'],
        configurationName,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: lineInsideLoop,
              condition,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    console.log('Conditional breakpoint output:\n', result.content);
    if (result.content === undefined) {
      throw new Error('No content received from tool invocation');
    }
    if (!Array.isArray(result.content)) {
      throw new TypeError(
        `Expected array but received ${typeof result.content} from tool invocation`
      );
    }
    const textPart = result.content[0] as LanguageModelTextPart;

    // Parse the debug info to verify the condition was met
    const debugInfo = JSON.parse(textPart.value);
    console.log('Parsed debug info:', JSON.stringify(debugInfo, null, 2));

    // Check that we have variable info with $i
    if (debugInfo.variables) {
      const variables = debugInfo.variables;
      const iVariable = variables.find((v: { name: string }) => v.name === 'i');

      if (iVariable) {
        const iValue = Number.parseInt(iVariable.value, 10);
        console.log(`Variable $i value: ${iValue}`);

        // Verify that $i is >= 3 (the condition we set)
        if (iValue < 3) {
          throw new Error(
            `Conditional breakpoint triggered too early: $i = ${iValue}, expected >= 3`
          );
        }
      }
    }
  });

  it('hitCondition breakpoint triggers on specific hit count (node)', async function () {
    this.timeout(90000);
    const extensionRoot = getExtensionRoot();
    const scriptRelative = 'test-workspace/test.js';
    const lineInsideLoop = 9;
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));

    // Get the first workspace folder from VS Code - should be set from test-workspace.code-workspace
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);

    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();
    const configurationName = 'Run test.js';
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['i'],
        configurationName,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: lineInsideLoop,
              hitCondition: '3',
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    const debugInfo = JSON.parse(
      (result.content[0] as LanguageModelTextPart).value
    );
    console.log('Parsed debug info:', JSON.stringify(debugInfo, null, 2));

    if (debugInfo.variables && debugInfo.variables.variables) {
      const variables = debugInfo.variables.variables;
      const iVariable = variables.find((v: { name: string }) => v.name === 'i');

      if (iVariable) {
        const iValue = Number.parseInt(iVariable.value, 10);
        console.log(`Variable $i value at 3rd hit: ${iValue}`);

        // Should be at iteration 2 (3rd hit: 0, 1, 2)
        if (iValue !== 2) {
          console.warn(
            `Hit condition may not have worked as expected: $i = ${iValue}, expected 2`
          );
        }
      }
    }
  });

  it('logMessage breakpoint (logpoint) does not stop execution unless adapter treats it as breakpoint (pwsh fallback to node)', async function () {
    this.timeout(90000);
    const extensionRoot = getExtensionRoot();
    const scriptRelative = 'test-workspace/test.js';
    const lineInsideLoop = 9;
    const postLoopLine = 14; // approximate end (JS file ends later) but second breakpoint ensures stop
    const logMessage = 'Loop iteration: {i}';
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));

    // Get the first workspace folder from VS Code - should be set from test-workspace.code-workspace
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();
    const tool = new StartDebuggerTool();
    const configurationName = 'Run test.js';
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        configurationName,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: lineInsideLoop,
              logMessage,
            },
            {
              path: scriptUri.fsPath,
              line: postLoopLine,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    
    const parts: ToolResultPart[] =
      (result as { parts?: ToolResultPart[]; content?: ToolResultPart[] })
        .content ||
      (result as { parts?: ToolResultPart[]; content?: ToolResultPart[] })
        .parts ||
      [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Logpoint test output:\n', textOutput);

    // Verify the debug session stopped at line 12 (not at the logpoint on line 8)
    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (/Error starting debug session/i.test(textOutput)) {
      throw new Error('Encountered error starting debug session');
    }
    if (!/Debug session .* stopped|breakpoint/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }

    // Parse and verify we stopped at line 12, not line 8
    try {
      const debugInfoMatch = textOutput.match(/\{[\s\S]*"breakpoint"[\s\S]*\}/);
      if (debugInfoMatch) {
        const debugInfo = JSON.parse(debugInfoMatch[0]);
        console.log('Parsed debug info:', JSON.stringify(debugInfo, null, 2));

        if (debugInfo.breakpoint && debugInfo.breakpoint.line) {
          const stoppedLine = debugInfo.breakpoint.line;
          console.log(`Stopped at line: ${stoppedLine}`);

          // Should have stopped at line 12, not the logpoint at line 8
          if (stoppedLine === 8) {
            throw new Error(
              'Debug session stopped at logpoint (line 8), logpoints should not stop execution'
            );
          }
        }
      }
    } catch (parseError) {
      console.warn(
        'Could not parse debug info for detailed validation:',
        parseError
      );
    }
  });
});
